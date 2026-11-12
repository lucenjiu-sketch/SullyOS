import { describe, it, expect } from 'vitest';
import {
  createDiscussionWindow,
  emptySelection,
  filterWindows,
  MAX_WINDOW_NAME_CHARS,
  nextWindowName,
  normalizeWindowName,
  reconcileSelection,
  setWindowArchived,
} from '../features/readingRoom/discussion';
import { READING_SELECTION_ID, type ReadingDiscussionWindow, type ReadingSelection } from '../features/readingRoom/types';

const window = (
  id: string,
  charId: string,
  name: string,
  options: { archivedAt?: number; updatedAt?: number } = {},
): ReadingDiscussionWindow => ({
  id,
  charId,
  name,
  archivedAt: options.archivedAt,
  createdAt: 1_000,
  updatedAt: options.updatedAt ?? 1_000,
});

describe('共读室 · 窗口分栏', () => {
  it('未归档和已归档各挑出自己那一栏', () => {
    const rows = [
      window('w1', 'c1', '讨论 1'),
      window('w2', 'c1', '讨论 2', { archivedAt: 2_000 }),
      window('w3', 'c1', '讨论 3'),
    ];
    expect(filterWindows(rows, 'active').map(item => item.id)).toEqual(['w1', 'w3']);
    expect(filterWindows(rows, 'archived').map(item => item.id)).toEqual(['w2']);
  });

  it('两栏都按最近用过的排在前面', () => {
    const rows = [
      window('old', 'c1', '讨论 1', { updatedAt: 10 }),
      window('new', 'c1', '讨论 2', { updatedAt: 999 }),
      window('mid', 'c1', '讨论 3', { updatedAt: 500 }),
    ];
    expect(filterWindows(rows, 'active').map(item => item.id)).toEqual(['new', 'mid', 'old']);
  });

  it('归档栏空着时返回空数组，不返回 undefined', () => {
    expect(filterWindows([window('w1', 'c1', '讨论 1')], 'archived')).toEqual([]);
  });
});

describe('共读室 · 新窗口命名', () => {
  it('第一个窗口叫「讨论 1」', () => {
    expect(nextWindowName([])).toBe('讨论 1');
  });

  it('删掉中间那个再新建，不会撞出两个同名窗口', () => {
    // 「讨论 2」被删掉：按个数 + 1 会再算出一个「讨论 2」。
    const rows = [window('w1', 'c1', '讨论 1'), window('w3', 'c1', '讨论 3')];
    expect(nextWindowName(rows)).toBe('讨论 4');
  });

  it('已归档的窗口也占编号', () => {
    const rows = [window('w1', 'c1', '讨论 1', { archivedAt: 5 })];
    expect(nextWindowName(rows)).toBe('讨论 2');
  });

  it('用户改过名的窗口不参与编号计算', () => {
    const rows = [window('w1', 'c1', '聊聊第三章'), window('w2', 'c1', '讨论 1')];
    expect(nextWindowName(rows)).toBe('讨论 2');
  });
});

describe('共读室 · 建窗口和归档', () => {
  it('新窗口挂在指定角色下，默认不是归档状态', () => {
    const created = createDiscussionWindow('c7', [], 4_200);
    expect(created.charId).toBe('c7');
    expect(created.archivedAt).toBeUndefined();
    expect(created.createdAt).toBe(4_200);
    expect(filterWindows([created], 'active')).toHaveLength(1);
  });

  it('新窗口不带 bookId —— 窗口只属于角色，切书不换窗口', () => {
    const created = createDiscussionWindow('c1', [], 1);
    expect(Object.keys(created)).not.toContain('bookId');
  });

  it('归档写入时间戳，撤销归档把它清掉', () => {
    const base = window('w1', 'c1', '讨论 1');
    const archived = setWindowArchived(base, true, 8_000);
    expect(archived.archivedAt).toBe(8_000);
    expect(setWindowArchived(archived, false, 9_000).archivedAt).toBeUndefined();
  });

  it('归档不动窗口名和创建时间', () => {
    const base = window('w1', 'c1', '讨论 1');
    const archived = setWindowArchived(base, true, 8_000);
    expect(archived.name).toBe('讨论 1');
    expect(archived.createdAt).toBe(base.createdAt);
  });
});

describe('共读室 · 窗口改名', () => {
  it('空白名退回原名', () => {
    expect(normalizeWindowName('   ', '讨论 1')).toBe('讨论 1');
  });

  it('压掉中间多余空白', () => {
    expect(normalizeWindowName('  聊聊   第三章 ', '讨论 1')).toBe('聊聊 第三章');
  });

  it('超长名截到上限', () => {
    expect(normalizeWindowName('名'.repeat(80), '讨论 1')).toHaveLength(MAX_WINDOW_NAME_CHARS);
  });
});

describe('共读室 · 当前选择', () => {
  const selection = (patch: Partial<ReadingSelection> = {}): ReadingSelection => ({
    id: READING_SELECTION_ID,
    updatedAt: 0,
    ...patch,
  });

  it('角色和窗口都有效时原样返回同一个对象（调用方靠它判断要不要落库）', () => {
    const current = selection({ charId: 'c1', windowId: 'w1' });
    const rows = [window('w1', 'c1', '讨论 1')];
    expect(reconcileSelection(current, ['c1'], rows)).toBe(current);
  });

  it('角色被删掉时，角色和窗口一起清空', () => {
    const current = selection({ charId: 'gone', windowId: 'w1' });
    const fixed = reconcileSelection(current, ['c1'], [window('w1', 'c1', '讨论 1')]);
    expect(fixed.charId).toBeUndefined();
    expect(fixed.windowId).toBeUndefined();
  });

  it('窗口被删掉时只清窗口，角色留着', () => {
    const current = selection({ charId: 'c1', windowId: 'gone' });
    const fixed = reconcileSelection(current, ['c1'], [window('w1', 'c1', '讨论 1')]);
    expect(fixed.charId).toBe('c1');
    expect(fixed.windowId).toBeUndefined();
  });

  it('存着的窗口其实属于别的角色时，也算失效', () => {
    const current = selection({ charId: 'c1', windowId: 'w9' });
    const fixed = reconcileSelection(current, ['c1', 'c2'], [window('w9', 'c2', '讨论 1')]);
    expect(fixed.charId).toBe('c1');
    expect(fixed.windowId).toBeUndefined();
  });

  it('什么都没选过的时候不白生成新对象', () => {
    const current = emptySelection(0);
    expect(reconcileSelection(current, ['c1'], [])).toBe(current);
  });

  it('只选了角色、还没选窗口是合法状态', () => {
    const current = selection({ charId: 'c1' });
    expect(reconcileSelection(current, ['c1'], [])).toBe(current);
  });

  it('一个角色都没有时，选择被清干净', () => {
    const current = selection({ charId: 'c1', windowId: 'w1' });
    const fixed = reconcileSelection(current, [], [window('w1', 'c1', '讨论 1')]);
    expect(fixed.charId).toBeUndefined();
    expect(fixed.windowId).toBeUndefined();
  });

  it('空选择的主键是固定值 —— 多出第二行的话「当前选择」就有两个答案了', () => {
    expect(emptySelection(0).id).toBe(READING_SELECTION_ID);
  });
});