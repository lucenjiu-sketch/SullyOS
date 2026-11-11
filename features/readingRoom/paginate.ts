import type { ReadingBook, ReadingChapter } from './types';

/**
 * 阅读器的翻页与定位。纯函数，不碰 DOM，方便单测。
 *
 * 一切都用「全文字符偏移」表达。字号、行距、屏幕宽度都不参与计算，
 * 所以用户改字号不会让进度跑位，第二期的划线也能用同一套坐标。
 */

/** 一页的目标字符数。手机竖屏下约等于三到四屏滑动。 */
export const READING_PAGE_SIZE = 2_400;

/** 为了不把句子切断，允许在目标长度上下这个范围内找断点。 */
const PAGE_SNAP_WINDOW = 400;

export interface ReadingPage {
  start: number;
  end: number;
  /** 这一页起始处所属的章节下标。 */
  chapterIndex: number;
}

export const chapterIndexAtOffset = (chapters: ReadingChapter[], offset: number): number => {
  if (chapters.length === 0) return 0;
  for (let index = chapters.length - 1; index >= 0; index -= 1) {
    if (offset >= chapters[index].start) return index;
  }
  return 0;
};

/**
 * 从 start 往后找这一页的结束位置。
 *
 * 优先在段落边界（空行）断开，其次在句末标点断开，都找不到就硬切。
 * 页不会跨章：遇到下一章开头就停住，让新章从新的一页开始。
 */
export const findPageEnd = (
  content: string,
  chapters: ReadingChapter[],
  start: number,
  pageSize = READING_PAGE_SIZE,
): number => {
  const chapter = chapters[chapterIndexAtOffset(chapters, start)];
  const hardLimit = Math.min(content.length, chapter ? chapter.end : content.length);
  const target = start + pageSize;
  if (target >= hardLimit) return hardLimit;

  const windowStart = Math.max(start + 1, target - PAGE_SNAP_WINDOW);
  const windowEnd = Math.min(hardLimit, target + PAGE_SNAP_WINDOW);
  const slice = content.slice(windowStart, windowEnd);

  // 段落边界优先：从后往前找最后一个换行，让断点尽量接近目标长度。
  const paragraphBreak = slice.lastIndexOf('\n');
  if (paragraphBreak > 0) return windowStart + paragraphBreak + 1;

  // 退一步找句末标点。
  const sentenceEnd = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('”'),
  );
  if (sentenceEnd > 0) return windowStart + sentenceEnd + 1;

  return Math.min(hardLimit, target);
};

/** 往前翻：从 end 倒推一页的起点。按同样的断点规则，所以来回翻页是稳定的。 */
export const findPageStart = (
  content: string,
  chapters: ReadingChapter[],
  end: number,
  pageSize = READING_PAGE_SIZE,
): number => {
  const chapter = chapters[chapterIndexAtOffset(chapters, Math.max(0, end - 1))];
  const hardFloor = chapter ? chapter.start : 0;
  const target = end - pageSize;
  if (target <= hardFloor) return hardFloor;

  const windowStart = Math.max(hardFloor, target - PAGE_SNAP_WINDOW);
  const windowEnd = Math.min(end - 1, target + PAGE_SNAP_WINDOW);
  if (windowEnd <= windowStart) return hardFloor;
  const slice = content.slice(windowStart, windowEnd);

  const paragraphBreak = slice.indexOf('\n');
  if (paragraphBreak >= 0) return windowStart + paragraphBreak + 1;
  return Math.max(hardFloor, target);
};

/** 当前页：给定任意偏移，返回包含它的那一页。章首对齐，避免半截章节。 */
export const pageAtOffset = (
  content: string,
  chapters: ReadingChapter[],
  offset: number,
  pageSize = READING_PAGE_SIZE,
): ReadingPage => {
  const clamped = Math.max(0, Math.min(offset, Math.max(0, content.length - 1)));
  const chapterIndex = chapterIndexAtOffset(chapters, clamped);
  const chapter = chapters[chapterIndex];
  let start = chapter ? chapter.start : 0;
  // 从章首按页长往前推，保证分页结果只取决于偏移本身，与翻页历史无关。
  while (true) {
    const end = findPageEnd(content, chapters, start, pageSize);
    if (clamped < end || end >= (chapter ? chapter.end : content.length)) {
      return { start, end, chapterIndex };
    }
    start = end;
  }
};

export const nextPage = (
  content: string,
  chapters: ReadingChapter[],
  current: ReadingPage,
  pageSize = READING_PAGE_SIZE,
): ReadingPage | null => {
  if (current.end >= content.length) return null;
  const start = current.end;
  return {
    start,
    end: findPageEnd(content, chapters, start, pageSize),
    chapterIndex: chapterIndexAtOffset(chapters, start),
  };
};

export const previousPage = (
  content: string,
  chapters: ReadingChapter[],
  current: ReadingPage,
  pageSize = READING_PAGE_SIZE,
): ReadingPage | null => {
  if (current.start <= 0) return null;
  // 上一页的末尾就是当前页的开头，交给 pageAtOffset 对齐，保证往回翻和往前翻一致。
  return pageAtOffset(content, chapters, current.start - 1, pageSize);
};

/** 进度百分比。0 到 100 的整数，书为空时返回 0。 */
export const progressPercent = (book: Pick<ReadingBook, 'charCount'>, offset: number): number => {
  if (!book.charCount) return 0;
  return Math.max(0, Math.min(100, Math.round((offset / book.charCount) * 100)));
};