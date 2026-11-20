import { describe, it, expect } from 'vitest';
import {
  describeDeleteConfirm,
  EMPTY_SHELF_SELECTION,
  isAllSelected,
  reconcileShelfSelection,
  selectedBooks,
  toggleSelectAll,
  toggleShelfSelection,
} from '../features/readingRoom/shelf';
import type { ReadingBook } from '../features/readingRoom/types';

/*
 * 书架管理模式的纯逻辑。
 *
 * 值得有测试的理由很简单：这一套的出口是**不可撤销的批量删除**
 * （删书连带删正文、进度、那些书的所有划线）。「到底要删哪几本」
 * 算错一本都没有退路，而界面上看起来一切正常。
 */

const book = (id: string, title = `书${id}`): ReadingBook => ({
  id,
  title,
  fileName: `${id}.txt`,
  charCount: 100,
  encoding: 'utf-8',
  chapters: [],
  chaptersDetected: false,
  createdAt: 0,
  updatedAt: 0,
});

const shelf = [book('a'), book('b'), book('c')];

describe('共读室书架 · 勾选', () => {
  it('点一下勾上，再点一下取消', () => {
    const once = toggleShelfSelection(EMPTY_SHELF_SELECTION, 'a');
    expect(once.has('a')).toBe(true);
    const twice = toggleShelfSelection(once, 'a');
    expect(twice.has('a')).toBe(false);
  });

  it('勾选别的书不影响已勾的', () => {
    let selected = toggleShelfSelection(EMPTY_SHELF_SELECTION, 'a');
    selected = toggleShelfSelection(selected, 'c');
    expect([...selected].sort()).toEqual(['a', 'c']);
  });

  it('不改原集合（React 要靠引用变化重渲染）', () => {
    const before = toggleShelfSelection(EMPTY_SHELF_SELECTION, 'a');
    const after = toggleShelfSelection(before, 'b');
    expect(before.has('b')).toBe(false);
    expect(after).not.toBe(before);
  });
});

describe('共读室书架 · 全选', () => {
  it('没全选时点全选 → 选中所有书', () => {
    const selected = toggleSelectAll(EMPTY_SHELF_SELECTION, shelf);
    expect([...selected].sort()).toEqual(['a', 'b', 'c']);
  });

  it('已经全选时点一下 → 清空', () => {
    const all = toggleSelectAll(EMPTY_SHELF_SELECTION, shelf);
    expect(toggleSelectAll(all, shelf).size).toBe(0);
  });

  it('选了一部分时点全选 → 补齐成全选，不是清空', () => {
    const partial = toggleShelfSelection(EMPTY_SHELF_SELECTION, 'b');
    expect([...toggleSelectAll(partial, shelf)].sort()).toEqual(['a', 'b', 'c']);
  });

  /*
   * 空书架不算全选，否则按钮会写「取消全选」，点了什么也不会发生。
   * 管理按钮本来在空书架时就不显示，但这一层不该依赖那个前提。
   */
  it('空书架不算全选', () => {
    expect(isAllSelected(EMPTY_SHELF_SELECTION, [])).toBe(false);
    expect(isAllSelected(new Set(['a']), [])).toBe(false);
  });

  it('选中数够了但书对不上，不算全选', () => {
    // 三个 id、三本书，但有一个 id 不在书架上。
    expect(isAllSelected(new Set(['a', 'b', 'x']), shelf)).toBe(false);
  });
});

describe('共读室书架 · 勾选与书架对账', () => {
  /*
   * 书架会在管理模式进行中变化（换封面会刷新书架、恢复备份会整批换掉）。
   * 留着不存在的 id 会让「已选 N 本」和屏幕上的勾不一致，
   * 删除时还会去删不存在的书。
   */
  it('丢掉已经不在书架上的 id', () => {
    const selected = new Set(['a', 'x', 'c']);
    const next = reconcileShelfSelection(selected, shelf);
    expect([...next].sort()).toEqual(['a', 'c']);
  });

  it('没有变化时返回同一个集合（调用方靠 === 跳过 setState）', () => {
    const selected = new Set(['a', 'c']);
    expect(reconcileShelfSelection(selected, shelf)).toBe(selected);
  });

  it('书架空了就清空勾选', () => {
    expect(reconcileShelfSelection(new Set(['a']), []).size).toBe(0);
  });
});

describe('共读室书架 · 取出选中的书', () => {
  it('按书架顺序返回，不按勾选顺序', () => {
    // 先勾 c 再勾 a，结果仍然是书架上的顺序 a、c。
    let selected = toggleShelfSelection(EMPTY_SHELF_SELECTION, 'c');
    selected = toggleShelfSelection(selected, 'a');
    expect(selectedBooks(selected, shelf).map(item => item.id)).toEqual(['a', 'c']);
  });

  it('集合里有不存在的 id 时只返回真实存在的书', () => {
    expect(selectedBooks(new Set(['x', 'b']), shelf).map(item => item.id)).toEqual(['b']);
  });

  it('什么都没选时返回空数组', () => {
    expect(selectedBooks(EMPTY_SHELF_SELECTION, shelf)).toEqual([]);
  });
});

describe('共读室书架 · 删除确认文案', () => {
  /*
   * 确认框必须把书名列出来：只说「删除 3 本书？」的话，勾错了也看不出来，
   * 而这一步之后就没有退路了。
   */
  it('列出书名和数量', () => {
    const text = describeDeleteConfirm([book('a', '小王子'), book('b', '方舟')]);
    expect(text).toContain('这 2 本');
    expect(text).toContain('《小王子》');
    expect(text).toContain('《方舟》');
  });

  it('说清楚连带删掉什么，以及什么不受影响', () => {
    const text = describeDeleteConfirm([book('a')]);
    expect(text).toContain('划线');
    expect(text).toContain('找不回来');
    // 已经写进记忆的讨论不受影响——这一点要讲，否则她会以为记忆也没了。
    expect(text).toContain('写进记忆');
  });

  it('超过五本就折叠书名，但总数照说', () => {
    const many = Array.from({ length: 8 }, (_, index) => book(`b${index}`, `第${index}本`));
    const text = describeDeleteConfirm(many);
    expect(text).toContain('这 8 本');
    expect(text).toContain('等 8 本');
    expect(text).toContain('《第0本》');
    // 第六本之后不再逐个列出。
    expect(text).not.toContain('《第6本》');
  });

  it('没选书时返回空串（调用方据此不弹框）', () => {
    expect(describeDeleteConfirm([])).toBe('');
  });
});