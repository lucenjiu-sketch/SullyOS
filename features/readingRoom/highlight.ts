import type { ReadingHighlight } from './types';

/**
 * 划线的纯逻辑：区间规范化、与当前页求交、文本整理。
 *
 * 这一层**完全不碰 DOM**，所以可以单测。真实的「手指按在哪个字上」由
 * ReadingView 用浏览器接口解析成偏移后再交给这里，见 `caret.ts`。
 *
 * ## 为什么划线不按页存
 *
 * 一条划线只存起止的全文字符偏移（`startOffset` / `endOffset`）。
 * 页边界取决于字号和屏幕，会变；全文偏移不会。改字号后分页重算，
 * 划线仍然落在同一句话上——渲染时拿当前页的范围和划线求交就行。
 */

/** 划线可选的底色。值直接进 CSS，故意用半透明，压在文字下面仍然看得清字。 */
export const READING_HIGHLIGHT_COLORS = [
  'rgba(255, 203, 92, 0.48)',
  'rgba(130, 212, 160, 0.45)',
  'rgba(146, 194, 246, 0.45)',
  'rgba(238, 160, 190, 0.42)',
] as const;

export const DEFAULT_HIGHLIGHT_COLOR = READING_HIGHLIGHT_COLORS[0];

/** 一条划线最多能覆盖多少字符。防止误操作把半本书划成一条。 */
export const MAX_HIGHLIGHT_CHARS = 5_000;

/** 划线交互的状态机。翻页时必须保留 `selecting-end` 和已记下的起点。 */
export type HighlightSelectionMode = 'idle' | 'selecting-end';

export interface HighlightSelectionState {
  mode: HighlightSelectionMode;
  /** 已确定的起点（全文偏移）。idle 时为 null。 */
  startOffset: number | null;
}

export const IDLE_HIGHLIGHT_SELECTION: HighlightSelectionState = {
  mode: 'idle',
  startOffset: null,
};

export interface HighlightRange {
  startOffset: number;
  endOffset: number;
}

/**
 * 把两次长按的位置整理成一个区间。
 *
 * 用户不必先按前面再按后面：两个偏移谁大谁小都接受，这里排序。
 * 两次按在同一个字上（长度 0）不算划线，返回 null——否则会存下一条看不见的划线。
 */
export const normalizeHighlightRange = (
  first: number,
  second: number,
  contentLength: number,
): HighlightRange | null => {
  const clamp = (value: number): number => Math.max(0, Math.min(Math.trunc(value), contentLength));
  const start = clamp(Math.min(first, second));
  const end = clamp(Math.max(first, second));
  if (end <= start) return null;
  return { startOffset: start, endOffset: Math.min(end, start + MAX_HIGHLIGHT_CHARS) };
};

/** 区间是否被截断过（命中 MAX_HIGHLIGHT_CHARS），用于提示用户。 */
export const isHighlightTruncated = (first: number, second: number): boolean => (
  Math.abs(second - first) > MAX_HIGHLIGHT_CHARS
);

/**
 * 一条划线在 [pageStart, pageEnd) 这一页里露出的部分。
 *
 * 跨页划线靠这个函数自然衔接：第一页露前半截、第二页露后半截，
 * 底层仍是同一条记录。完全不在这一页的返回 null。
 */
export const highlightSliceOnPage = (
  highlight: Pick<ReadingHighlight, 'startOffset' | 'endOffset'>,
  pageStart: number,
  pageEnd: number,
): HighlightRange | null => {
  const start = Math.max(highlight.startOffset, pageStart);
  const end = Math.min(highlight.endOffset, pageEnd);
  if (end <= start) return null;
  return { startOffset: start, endOffset: end };
};

export interface HighlightSegment {
  text: string;
  /** 这一小段在全文里的起始偏移，便于点击时定位到具体某条划线。 */
  offset: number;
  /** 命中的划线；null 表示这一段没有被划。 */
  highlight: ReadingHighlight | null;
}

/**
 * 把 [start, end) 这段正文按划线切成「划过的」和「没划过的」若干小段。
 *
 * 渲染一个段落时用它：返回的片段按顺序拼起来**必须等于原文那一段**，
 * 不能多也不能少，否则屏幕上的字就和原文对不上了（有测试锁着）。
 *
 * 多条划线重叠时，位置靠前的那条优先占据重叠部分——不去做颜色混合，
 * 混色会让「这里到底有几条划线」变得看不出来。
 */
export const splitByHighlights = (
  content: string,
  start: number,
  end: number,
  highlights: ReadingHighlight[],
): HighlightSegment[] => {
  const clampedEnd = Math.min(end, content.length);
  if (clampedEnd <= start) return [];

  const overlapping = highlights
    .map(highlight => {
      const slice = highlightSliceOnPage(highlight, start, clampedEnd);
      return slice ? { highlight, ...slice } : null;
    })
    .filter((item): item is { highlight: ReadingHighlight } & HighlightRange => item !== null)
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);

  const segments: HighlightSegment[] = [];
  let cursor = start;
  const push = (from: number, to: number, highlight: ReadingHighlight | null): void => {
    if (to <= from) return;
    segments.push({ text: content.slice(from, to), offset: from, highlight });
  };

  for (const item of overlapping) {
    // 已经被前一条划线盖掉的部分直接跳过，保证片段不重叠。
    if (item.endOffset <= cursor) continue;
    const from = Math.max(item.startOffset, cursor);
    push(cursor, from, null);
    push(from, item.endOffset, item.highlight);
    cursor = item.endOffset;
  }
  push(cursor, clampedEnd, null);
  return segments;
};

/**
 * 划线原文整理成一行可读的文字。
 *
 * 存下来的 `text` 是原文（含换行和 TXT 自带的全角空格缩进），列表里一行显示不下，
 * 发给角色时也不该带着缩进。这里把连续空白压成一个空格。
 */
export const highlightDisplayText = (text: string): string => text
  .replace(/[\s\u3000]+/g, ' ')
  .trim();

/** 列表里显示的摘要：太长会撑破一行。 */
export const highlightSummary = (text: string, maxChars = 60): string => {
  const flat = highlightDisplayText(text);
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
};

/**
 * 发给角色时附带的上下文：划线前后各取一段原文。
 *
 * **全书正文永不进请求**，这是共读室和协同工作最根本的区别。
 * 角色只看到划线本身加上这里取的少量前后文，足够理解「这句话在说什么」。
 */
export const HIGHLIGHT_CONTEXT_CHARS = 320;

export interface HighlightContextExcerpt {
  before: string;
  quote: string;
  after: string;
}

export const buildHighlightContext = (
  content: string,
  highlight: Pick<ReadingHighlight, 'startOffset' | 'endOffset'>,
  contextChars = HIGHLIGHT_CONTEXT_CHARS,
): HighlightContextExcerpt => ({
  before: highlightDisplayText(
    content.slice(Math.max(0, highlight.startOffset - contextChars), highlight.startOffset),
  ),
  quote: highlightDisplayText(content.slice(highlight.startOffset, highlight.endOffset)),
  after: highlightDisplayText(
    content.slice(highlight.endOffset, Math.min(content.length, highlight.endOffset + contextChars)),
  ),
});

/** 划线按出现顺序排（而不是按创建时间），列表读起来才和书的顺序一致。 */
export const sortHighlightsByPosition = (highlights: ReadingHighlight[]): ReadingHighlight[] => (
  [...highlights].sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)
);

/**
 * 微调落点。
 *
 * 取偏移靠浏览器排版接口，实测会差一两个字。随机偏差靠重选能解决，
 * **系统性偏差（总是偏同一个方向）只能靠微调**——重选十次都是一样的结果。
 * 所以一次挪一个字符，用户看着高亮走到对的字上。
 */
export const nudgeOffset = (offset: number, delta: number, contentLength: number): number => (
  Math.max(0, Math.min(offset + delta, Math.max(0, contentLength - 1)))
);

export interface CaretPreview {
  /** 落点所在的那个字符。空字符串表示落在正文末尾之后。 */
  charAt: string;
  /** 落点前面一小段，给用户判断位置。 */
  before: string;
  /** 落点后面一小段。 */
  after: string;
}

/**
 * 落点周围的文字，用来在小条上显示「起点落在这个字上」。
 *
 * 和 `buildHighlightContext` 分开：这个是给用户看落点的，取的范围很短，
 * 而且**要保留原样不压空白**——压掉空白会让显示的位置和实际落点错开。
 */
export const describeCaret = (
  content: string,
  offset: number,
  radius = 12,
): CaretPreview => ({
  before: content.slice(Math.max(0, offset - radius), offset).replace(/\n/g, ' '),
  charAt: content.slice(offset, offset + 1).replace(/\n/g, '⏎'),
  after: content.slice(offset + 1, offset + 1 + radius).replace(/\n/g, ' '),
});
