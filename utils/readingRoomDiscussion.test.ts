import { describe, it, expect } from 'vitest';
import {
  applyMessageToWindow,
  createDiscussionMessage,
  createDiscussionWindow,
  emptySelection,
  filterWindows,
  MAX_MESSAGE_PREVIEW_CHARS,
  MAX_WINDOW_NAME_CHARS,
  messagePreviewText,
  nextWindowName,
  normalizeWindowName,
  reconcileSelection,
  recomputeWindowPreview,
  renameWindow,
  setWindowArchived,
  sortMessagesByTime,
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

  it('改名只动名字，id 不变 —— 挂在这个 id 下的消息不受影响', () => {
    const base = window('w1', 'c1', '讨论 1');
    const renamed = renameWindow(base, '聊聊第三章', 7_000);
    expect(renamed.id).toBe('w1');
    expect(renamed.charId).toBe('c1');
    expect(renamed.createdAt).toBe(base.createdAt);
    expect(renamed.name).toBe('聊聊第三章');
  });

  it('改完名字 updatedAt 跟着走', () => {
    const renamed = renameWindow(window('w1', 'c1', '讨论 1'), '新名字', 7_000);
    expect(renamed.updatedAt).toBe(7_000);
  });

  it('名字没真的变就返回同一个对象（调用方靠它跳过写库）', () => {
    const base = window('w1', 'c1', '讨论 1');
    // 只多了首尾空白，规范化之后和原名一样。
    expect(renameWindow(base, '  讨论 1 ', 9_999)).toBe(base);
    expect(renameWindow(base, '讨论 1', 9_999)).toBe(base);
  });

  it('改成空白名等于没改，不该把 updatedAt 刷新', () => {
    const base = window('w1', 'c1', '讨论 1');
    expect(renameWindow(base, '    ', 9_999)).toBe(base);
  });

  it('归档状态不会被改名带掉', () => {
    const base = window('w1', 'c1', '讨论 1', { archivedAt: 500 });
    expect(renameWindow(base, '新名字', 7_000).archivedAt).toBe(500);
  });
});

describe('共读室 · 消息预览', () => {
  it('换行和多余空白压成一个空格', () => {
    expect(messagePreviewText('第一行\n\n  第二行  ')).toBe('第一行 第二行');
  });

  it('太长的截断加省略号', () => {
    const preview = messagePreviewText('字'.repeat(200));
    expect(preview).toHaveLength(MAX_MESSAGE_PREVIEW_CHARS + 1);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('刚好到上限不加省略号', () => {
    const preview = messagePreviewText('字'.repeat(MAX_MESSAGE_PREVIEW_CHARS));
    expect(preview.endsWith('…')).toBe(false);
  });

  it('全是空白的内容给出空串', () => {
    expect(messagePreviewText('   \n  ')).toBe('');
  });

  it('表情标签换成「[表情]」，不是一行看不懂的符号', () => {
    expect(messagePreviewText('这段真好 [[SEND_EMOJI: 开心]]')).toBe('这段真好 [表情]');
  });

  it('只发了表情没说话，预览就是「[表情]」', () => {
    expect(messagePreviewText('[[SEND_EMOJI: 呆猫: 亲亲额头]]')).toBe('[表情]');
  });

  it('多个表情各换一个', () => {
    expect(messagePreviewText('[[SEND_EMOJI:a]][[SEND_EMOJI:b]]')).toBe('[表情][表情]');
  });

  it('全角冒号的写法也认', () => {
    expect(messagePreviewText('[[SEND_EMOJI：开心]]')).toBe('[表情]');
  });
});

describe('共读室 · 讨论消息', () => {
  it('消息挂在 windowId 下，不带 bookId —— 一个窗口会堆好几本书', () => {
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '这段写得真好',
      now: 100,
    });
    expect(message.windowId).toBe('w1');
    expect(Object.keys(message)).not.toContain('bookId');
    expect(message.createdAt).toBe(100);
  });

  it('没有引用的闲聊消息不带 reference 字段', () => {
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '随便聊聊',
      now: 1,
    });
    expect(Object.keys(message)).not.toContain('reference');
  });

  it('引用只存书名 / 章节 / 划线原文，前后文一个字都不进去', () => {
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '为什么他要这样说',
      reference: {
        bookId: 'b1',
        bookTitle: '某本书',
        chapterTitle: '第三章',
        highlightId: 'h1',
        quote: '他看着窗外，没有回答。',
      },
      now: 1,
    });
    // 这是整个第二期最要紧的一条：存进库的引用里不能出现 before / after。
    // 存了的话，之后每次读历史都会把前后文带回来，等于反复发给模型。
    expect(Object.keys(message.reference!).sort()).toEqual(
      ['bookId', 'bookTitle', 'chapterTitle', 'highlightId', 'quote'],
    );
    expect(JSON.stringify(message)).not.toContain('before');
    expect(JSON.stringify(message)).not.toContain('after');
  });

  it('消息按时间正序排，不管塞进来的顺序', () => {
    const make = (id: string, at: number) => ({
      ...createDiscussionMessage({ windowId: 'w1', role: 'user' as const, content: id, now: at }),
      id,
    });
    const sorted = sortMessagesByTime([make('c', 30), make('a', 10), make('b', 20)]);
    expect(sorted.map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('排序不改原数组', () => {
    const rows = [
      { ...createDiscussionMessage({ windowId: 'w1', role: 'user', content: 'x', now: 9 }), id: 'x' },
      { ...createDiscussionMessage({ windowId: 'w1', role: 'user', content: 'y', now: 1 }), id: 'y' },
    ];
    sortMessagesByTime(rows);
    expect(rows.map(item => item.id)).toEqual(['x', 'y']);
  });
});

describe('共读室 · 窗口上的消息痕迹', () => {
  const message = (content: string, at: number) => createDiscussionMessage({
    windowId: 'w1',
    role: 'assistant',
    content,
    now: at,
  });

  it('存下预览和时间，updatedAt 跟着走', () => {
    const updated = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('我也喜欢这一段', 5_000));
    expect(updated.lastMessagePreview).toBe('我也喜欢这一段');
    expect(updated.lastMessageAt).toBe(5_000);
    expect(updated.updatedAt).toBe(5_000);
  });

  it('updatedAt 跟着消息走，所以现有的「最近用过的在前面」直接成立', () => {
    const rows = [
      applyMessageToWindow(window('old', 'c1', '讨论 1', { updatedAt: 10 }), message('旧的', 20)),
      applyMessageToWindow(window('new', 'c1', '讨论 2', { updatedAt: 10 }), message('新的', 900)),
    ];
    expect(filterWindows(rows, 'active').map(item => item.id)).toEqual(['new', 'old']);
  });

  it('预览存的是摘要不是整条消息 —— 列窗口不该把所有讨论读一遍', () => {
    const updated = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('字'.repeat(500), 1));
    expect(updated.lastMessagePreview!.length).toBeLessThanOrEqual(MAX_MESSAGE_PREVIEW_CHARS + 1);
  });

  it('空内容的消息不覆盖已有预览（流式刚开始时内容还是空的）', () => {
    const base = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('已经有的回复', 100));
    expect(applyMessageToWindow(base, message('', 200))).toBe(base);
  });

  it('改名和归档不会生出消息预览', () => {
    const base = window('w1', 'c1', '讨论 1');
    expect(renameWindow(base, '新名字', 1).lastMessagePreview).toBeUndefined();
    expect(setWindowArchived(base, true, 1).lastMessagePreview).toBeUndefined();
  });

  it('来了新消息，预览换成新的那条', () => {
    const first = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('第一条', 100));
    const second = applyMessageToWindow(first, message('第二条', 200));
    expect(second.lastMessagePreview).toBe('第二条');
    expect(second.lastMessageAt).toBe(200);
  });
});

describe('共读室 · 删掉一条之后的预览', () => {
  const message = (id: string, content: string, at: number) => ({
    ...createDiscussionMessage({ windowId: 'w1', role: 'user' as const, content, now: at }),
    id,
  });

  it('删掉最后一条，预览退回上一条', () => {
    const rows = [message('a', '第一条', 100), message('b', '第二条', 200)];
    const base = applyMessageToWindow(window('w1', 'c1', '讨论 1'), rows[1]);
    const updated = recomputeWindowPreview(base, [rows[0]]);
    expect(updated.lastMessagePreview).toBe('第一条');
    expect(updated.lastMessageAt).toBe(100);
  });

  it('删掉中间那条，预览还是最后一条', () => {
    const rows = [message('a', '第一条', 100), message('b', '中间', 150), message('c', '最后', 200)];
    const base = applyMessageToWindow(window('w1', 'c1', '讨论 1'), rows[2]);
    const updated = recomputeWindowPreview(base, [rows[0], rows[2]]);
    expect(updated.lastMessagePreview).toBe('最后');
  });

  it('删到一条不剩，预览清空（列表会显示「还没有讨论记录」）', () => {
    const base = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('a', '唯一一条', 100));
    const updated = recomputeWindowPreview(base, []);
    expect(updated.lastMessagePreview).toBeUndefined();
    expect(updated.lastMessageAt).toBeUndefined();
  });

  it('updatedAt 不往回退 —— 删一条不该让窗口掉到列表最底下', () => {
    const base = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('a', '唯一一条', 9_000));
    expect(recomputeWindowPreview(base, []).updatedAt).toBe(base.updatedAt);
  });

  it('剩下的只有空内容消息时，预览也清空', () => {
    // 只带引用、没写感想的那种消息，预览本来就是空的。
    const base = applyMessageToWindow(window('w1', 'c1', '讨论 1'), message('a', '有内容', 100));
    const updated = recomputeWindowPreview(base, [message('b', '   ', 200)]);
    expect(updated.lastMessagePreview).toBeUndefined();
  });

  it('不改名字、不改归档状态', () => {
    const base = setWindowArchived(window('w1', 'c1', '聊聊第三章'), true, 500);
    const updated = recomputeWindowPreview(base, []);
    expect(updated.name).toBe('聊聊第三章');
    expect(updated.archivedAt).toBe(500);
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