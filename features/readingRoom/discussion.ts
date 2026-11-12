/**
 * 共读室 · 讨论窗口的纯逻辑。
 *
 * 分栏、默认命名、失效选择的修复全在这里，不碰 DOM 也不碰 IndexedDB，
 * 这样这些规则能被测试直接锁住（见 `utils/readingRoomDiscussion.test.ts`）。
 *
 * ## 这一期只做「选择和管理」
 *
 * 发消息、拼上下文、召回历史都还没做。窗口现在是空壳：有 id、有名字、
 * 能选中、能归档。**别在这个文件里塞请求组装**，那是下一次推送的事。
 *
 * ## 窗口只属于角色，不属于书
 *
 * 久定的：「选窗口是用户的事情，不能随着切书而自动换窗口。」
 * 所以这里所有函数都只认 `charId`，没有一个参数是 bookId。
 * 角色要知道在读哪本书，靠发送时在内容里写明（下一期做），不靠数据结构分。
 */

import {
  READING_SELECTION_ID,
  readingRoomId,
  type ReadingDiscussionWindow,
  type ReadingSelection,
} from './types';

/** 窗口名长度上限。防止以后做改名时存进一篇作文。 */
export const MAX_WINDOW_NAME_CHARS = 40;

export type ReadingWindowFilter = 'active' | 'archived';

/**
 * 按归档状态挑出一栏。
 *
 * 排序和协同工作一致：**最近用过的在最前面**（`updatedAt` 倒序）。
 * 久在协同那边已经习惯这个顺序了，两边不一致会显得像 bug。
 */
export function filterWindows(
  windows: ReadingDiscussionWindow[],
  filter: ReadingWindowFilter,
): ReadingDiscussionWindow[] {
  const wanted = windows.filter(window => (
    filter === 'archived' ? Boolean(window.archivedAt) : !window.archivedAt
  ));
  return wanted.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 新窗口叫什么。
 *
 * 「讨论 1」「讨论 2」……**取当前最大编号 + 1，不是个数 + 1**：
 * 删掉「讨论 2」之后再新建，个数 + 1 会算出一个已经存在的「讨论 2」，
 * 列表里就出现两个同名窗口。已归档的窗口也参与计算，它们还在列表里看得见。
 */
export function nextWindowName(windows: ReadingDiscussionWindow[]): string {
  const used = windows.reduce((largest, window) => {
    const matched = /^讨论\s*(\d+)$/.exec(window.name.trim());
    if (!matched) return largest;
    return Math.max(largest, Number(matched[1]));
  }, 0);
  return `讨论 ${used + 1}`;
}

/** 建一个新窗口。默认进「未归档」栏。 */
export function createDiscussionWindow(
  charId: string,
  existing: ReadingDiscussionWindow[],
  now = Date.now(),
): ReadingDiscussionWindow {
  return {
    id: readingRoomId('rw'),
    charId,
    name: nextWindowName(existing),
    createdAt: now,
    updatedAt: now,
  };
}

/** 归档 / 撤销归档。口径与协同工作一致：`archivedAt` 有值即已归档。 */
export function setWindowArchived(
  window: ReadingDiscussionWindow,
  archived: boolean,
  now = Date.now(),
): ReadingDiscussionWindow {
  return {
    ...window,
    archivedAt: archived ? now : undefined,
    updatedAt: now,
  };
}

/** 清掉改名时多出来的空白，截到上限。空名退回原名。 */
export function normalizeWindowName(name: string, fallback: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_WINDOW_NAME_CHARS);
  return cleaned || fallback;
}

/**
 * 修一遍「当前选择」，把已经不存在的角色或窗口清掉。
 *
 * 为什么必须有这一步：角色和窗口是两个库里的东西，用户可能在角色页删掉角色、
 * 或者在这里删掉窗口，存下来的 id 就指向空气了。
 * 不修的话界面会显示一个点不动的选中态，看着像坏了。
 *
 * 规则：
 * - 角色不在名单里 → 角色和窗口一起清空（窗口是挂在角色下的，留着没意义）
 * - 窗口不存在，或者**属于别的角色** → 只清窗口，角色留着
 * - 都有效 → 原样返回**同一个对象**，这样调用方可以用 `===` 判断要不要落库
 */
export function reconcileSelection(
  selection: ReadingSelection,
  availableCharIds: readonly string[],
  windows: readonly ReadingDiscussionWindow[],
): ReadingSelection {
  const charValid = Boolean(selection.charId) && availableCharIds.includes(selection.charId!);
  if (!charValid) {
    if (!selection.charId && !selection.windowId) return selection;
    return { ...selection, charId: undefined, windowId: undefined };
  }
  const windowValid = Boolean(selection.windowId) && windows.some(window => (
    window.id === selection.windowId && window.charId === selection.charId
  ));
  if (selection.windowId && !windowValid) {
    return { ...selection, windowId: undefined };
  }
  return selection;
}

/** 空的当前选择。第一次打开共读室时用。 */
export function emptySelection(now = Date.now()): ReadingSelection {
  return { id: READING_SELECTION_ID, updatedAt: now };
}
