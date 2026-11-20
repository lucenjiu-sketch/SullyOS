import type { ReadingBook } from './types';

/**
 * 共读室 · 书架管理模式的纯逻辑（勾选、全选、确认文案）。
 *
 * 和 `discussion.ts` 一个路子：**完全不碰 DOM、不碰库**，所以能单测。
 * 批量删除是不可撤销的操作，判断「到底要删哪几本」这件事值得有测试盯着。
 */

/** 勾选集合。写成别名省得到处写 Set<string>。 */
export type ShelfSelection = ReadonlySet<string>;

export const EMPTY_SHELF_SELECTION: ShelfSelection = new Set<string>();

/**
 * 勾上或取消一本书。
 *
 * 返回新集合（React 要靠引用变化触发重渲染），但**没有实际变化时返回原集合**，
 * 和 `discussion.ts` 里 `reconcileSelection` 那几个函数口径一致。
 */
export const toggleShelfSelection = (
  selected: ShelfSelection,
  bookId: string,
): ShelfSelection => {
  const next = new Set(selected);
  if (next.has(bookId)) next.delete(bookId);
  else next.add(bookId);
  return next;
};

/**
 * 把勾选集合和当前书架对一遍，丢掉已经不在书架上的 id。
 *
 * 为什么需要：管理模式进行中书架可能变（换封面会刷新书架、
 * 恢复备份会整批换掉）。集合里留着不存在的 id，会让「已选 3 本」
 * 和屏幕上看到的勾不一致，删除时还会去删不存在的书。
 *
 * 没有变化时返回原集合，调用方靠 `===` 跳过 setState。
 */
export const reconcileShelfSelection = (
  selected: ShelfSelection,
  books: Pick<ReadingBook, 'id'>[],
): ShelfSelection => {
  const alive = new Set(books.map(book => book.id));
  const next = new Set<string>();
  selected.forEach(id => { if (alive.has(id)) next.add(id); });
  return next.size === selected.size ? selected : next;
};

/** 全选 / 取消全选。已经全选时再点就是清空。 */
export const toggleSelectAll = (
  selected: ShelfSelection,
  books: Pick<ReadingBook, 'id'>[],
): ShelfSelection => (
  isAllSelected(selected, books) ? new Set<string>() : new Set(books.map(book => book.id))
);

/**
 * 是不是全选了。
 *
 * **空书架不算全选**：否则一本书都没有时按钮会显示「取消全选」，
 * 点了什么也不会发生。
 */
export const isAllSelected = (
  selected: ShelfSelection,
  books: Pick<ReadingBook, 'id'>[],
): boolean => books.length > 0 && books.every(book => selected.has(book.id));

/** 按书架顺序取出选中的书。删除确认框要按这个顺序列书名。 */
export const selectedBooks = (
  selected: ShelfSelection,
  books: ReadingBook[],
): ReadingBook[] => books.filter(book => selected.has(book.id));

/** 确认框里最多列几本书名，再多就折成「等 N 本」。 */
const CONFIRM_TITLE_LIMIT = 5;

/**
 * 批量删除的确认文案。
 *
 * 必须把**书名列出来**：只说「删除 3 本书？」的话，勾错了也看不出来，
 * 而这一步之后就没有退路了（删书连带删正文、进度、那些书的所有划线）。
 * 书太多时折叠，但数量始终说清楚。
 */
export const describeDeleteConfirm = (books: ReadingBook[]): string => {
  if (books.length === 0) return '';
  const titles = books.slice(0, CONFIRM_TITLE_LIMIT).map(book => `《${book.title}》`).join('\n');
  const rest = books.length - CONFIRM_TITLE_LIMIT;
  const list = rest > 0 ? `${titles}\n…等 ${books.length} 本` : titles;
  return `要从书架删掉这 ${books.length} 本吗？\n\n${list}\n\n`
    + '正文、阅读进度和这些书上的划线会一起删掉，删了找不回来。\n'
    + '已经「写进记忆」的讨论不受影响。';
};