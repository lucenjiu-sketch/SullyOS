import type { ReadingChapter } from './types';

/**
 * 阅读界面的排版辅助：段落切分与书封配色。
 *
 * 段落带上它在全文里的起始偏移，这样上下滑模式可以用「最顶上那个段落的偏移」
 * 当阅读进度——是精确值，不是按滚动比例估的。第二期的划线也能复用这个坐标。
 */

export interface ReadingParagraph {
  /** 在全文里的起始字符偏移。 */
  offset: number;
  text: string;
}

/**
 * 把 [start, end) 这段正文切成段落。
 * 空行被吃掉（它们只是排版间隔），所以偏移不连续是正常的。
 *
 * 每行会 trim 掉首尾空白，**包括 TXT 里常见的全角空格缩进（U+3000）**。
 * 缩进交给排版决定，不留在正文里：原文自带两格 + 样式再缩两格会变成四格，
 * 而且样式缩进只对一页的第一行生效，上一页没读完的半句到新页开头也会被缩，
 * 看起来像凭空多出一个段落。offset 跟着跳过这些空白，所以
 * `content.slice(offset, offset + text.length)` 仍然等于 text（有守卫用例锁着）。
 */
export const splitParagraphs = (
  content: string,
  start: number,
  end: number,
): ReadingParagraph[] => {
  const slice = content.slice(start, Math.min(end, content.length));
  const paragraphs: ReadingParagraph[] = [];
  let cursor = 0;
  for (const line of slice.split('\n')) {
    const text = line.trim();
    if (text) {
      // 偏移要指向这一行里第一个非空白字符，划线才不会偏到缩进上。
      paragraphs.push({ offset: start + cursor + (line.length - line.trimStart().length), text });
    }
    cursor += line.length + 1;
  }
  return paragraphs;
};

/**
 * 书封配色。没有真封面图，按书名算一个稳定的颜色——
 * 同一本书每次打开颜色一样，书架看久了能靠颜色认书。
 */
const COVER_PALETTE: Array<{ from: string; to: string; ink: string }> = [
  { from: '#F98B5F', to: '#F2654E', ink: '#FFF6F0' },
  { from: '#FFC247', to: '#F7A325', ink: '#4A3407' },
  { from: '#6FC79A', to: '#44A878', ink: '#F3FFF8' },
  { from: '#6AAEF2', to: '#4283D8', ink: '#F2F8FF' },
  { from: '#B98BE0', to: '#9360C7', ink: '#FBF4FF' },
  { from: '#E58AAE', to: '#CF6189', ink: '#FFF4F8' },
  { from: '#7FC8CE', to: '#4FA3AC', ink: '#F1FDFE' },
  { from: '#C9A274', to: '#A87F52', ink: '#FFF8EE' },
];

export const coverPalette = (seed: string): { from: string; to: string; ink: string } => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000_007;
  }
  return COVER_PALETTE[Math.abs(hash) % COVER_PALETTE.length];
};

/** 封面上显示的书名：太长会撑破格子，截断后补省略号。 */
export const coverTitleLines = (title: string, maxChars = 18): string => (
  title.length > maxChars ? `${title.slice(0, maxChars)}…` : title
);

/**
 * 段落之间的间距（em，相对当前字号）。
 *
 * 原文的空行**不照排**：一个空行等于一整行高度，有的 TXT 段间有两三个空行，
 * 照排出来一屏只剩几行字。统一成这个小间距（参考微信读书的观感），
 * 字号变大时间距跟着变大，所以用 em 不用 px。
 */
export const READING_PARAGRAPH_GAP_EM = 0.55;

/**
 * 上下滑模式一次渲染几章。
 * 整本书一次性塞进 DOM 会让长篇直接卡死，所以只保留当前章附近的几章。
 */
export const VERTICAL_CHAPTER_WINDOW = 2;

export const verticalChapterRange = (
  chapters: ReadingChapter[],
  chapterIndex: number,
): { first: number; last: number } => ({
  first: Math.max(0, chapterIndex - VERTICAL_CHAPTER_WINDOW),
  last: Math.min(chapters.length - 1, chapterIndex + VERTICAL_CHAPTER_WINDOW),
});