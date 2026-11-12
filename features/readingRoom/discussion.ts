/**
 * 共读室 · 讨论窗口的纯逻辑。
 *
 * 分栏、默认命名、改名、消息预览、失效选择的修复全在这里，
 * 不碰 DOM 也不碰 IndexedDB，这样这些规则能被测试直接锁住
 * （见 `utils/readingRoomDiscussion.test.ts`）。
 *
 * ## 这个文件不碰请求组装
 *
 * 拼 system prompt、调 API、流式回复都不在这里。**划线前后的那些原文
 * （`buildHighlightContext` 的 before / after）一个字都不该出现在这个文件里**——
 * 它们只属于发出去的那一轮请求，不进数据库。这里只负责「存下来的东西长什么样」。
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
  type ReadingDiscussionMessage,
  type ReadingDiscussionWindow,
  type ReadingMessageReference,
  type ReadingSelection,
} from './types';

/** 窗口名长度上限。改名时截到这里，不存一篇作文。 */
export const MAX_WINDOW_NAME_CHARS = 40;

/** 列表里那行预览留多长。超过就截断加省略号。 */
export const MAX_MESSAGE_PREVIEW_CHARS = 50;

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
 * 改名。
 *
 * **名字没真的变就返回同一个对象**（`===` 成立），调用方靠它决定要不要写库——
 * 否则点开改名弹窗、什么都没改就按确定，也会把这个窗口的 `updatedAt` 刷新，
 * 它就莫名其妙跳到列表最前面去了。
 *
 * 改名**只动名字**：id 不变，所以挂在这个 id 下的消息一条都不受影响。
 */
export function renameWindow(
  window: ReadingDiscussionWindow,
  name: string,
  now = Date.now(),
): ReadingDiscussionWindow {
  const next = normalizeWindowName(name, window.name);
  if (next === window.name) return window;
  return { ...window, name: next, updatedAt: now };
}

/** 列表里显示的那行预览：压掉换行和多余空白，太长就截断。 */
export function messagePreviewText(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_MESSAGE_PREVIEW_CHARS
    ? `${flat.slice(0, MAX_MESSAGE_PREVIEW_CHARS)}…`
    : flat;
}

/**
 * 建一条讨论消息。
 *
 * `reference` 只接受已经精简过的引用（书名 / 章节 / 划线原文）。
 * **调用方不要把 `buildHighlightContext` 的结果整个塞进来**：那里面的
 * before / after 是这一轮请求用的临时上下文，存进库就会在之后每次
 * 读历史时跟着回来，等于把前后文反复发给模型。
 */
export function createDiscussionMessage(input: {
  windowId: string;
  role: ReadingDiscussionMessage['role'];
  content: string;
  reference?: ReadingMessageReference;
  thinkingChain?: string;
  now?: number;
}): ReadingDiscussionMessage {
  const createdAt = input.now ?? Date.now();
  return {
    id: readingRoomId('rm'),
    windowId: input.windowId,
    role: input.role,
    content: input.content,
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.thinkingChain ? { thinkingChain: input.thinkingChain } : {}),
    createdAt,
  };
}

/**
 * 把一条新消息的痕迹记到窗口上。
 *
 * `updatedAt` 跟着一起更新，所以「最近聊过的排在最前面」靠现有的
 * `filterWindows` 就成立了，不必再按 `lastMessageAt` 排一次。
 *
 * 没有正文的消息（流式刚开始、内容还是空的）不覆盖预览——
 * 否则列表里会闪出一条空预览。
 */
export function applyMessageToWindow(
  window: ReadingDiscussionWindow,
  message: ReadingDiscussionMessage,
): ReadingDiscussionWindow {
  const preview = messagePreviewText(message.content);
  if (!preview) return window;
  return {
    ...window,
    lastMessagePreview: preview,
    lastMessageAt: message.createdAt,
    updatedAt: message.createdAt,
  };
}

/** 消息按时间正序排。读历史和发给模型都用这个顺序。 */
export function sortMessagesByTime(
  messages: ReadingDiscussionMessage[],
): ReadingDiscussionMessage[] {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 删掉某条消息之后，重算窗口上的预览。
 *
 * 不做这件事的话：删掉最后一条，列表里那行预览还是它——看着像没删掉。
 * 删到一条不剩时把两个字段清空（`undefined`），列表会显示「还没有讨论记录」。
 *
 * `updatedAt` **不往回退**：它决定窗口在列表里的排序，删一条消息不该
 * 让这个窗口跳到最底下去。
 */
export function recomputeWindowPreview(
  window: ReadingDiscussionWindow,
  remaining: ReadingDiscussionMessage[],
): ReadingDiscussionWindow {
  const sorted = sortMessagesByTime(remaining);
  const last = [...sorted].reverse().find(message => messagePreviewText(message.content));
  if (!last) {
    return { ...window, lastMessagePreview: undefined, lastMessageAt: undefined };
  }
  return {
    ...window,
    lastMessagePreview: messagePreviewText(last.content),
    lastMessageAt: last.createdAt,
  };
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
