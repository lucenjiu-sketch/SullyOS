import type { ReadingChapter, ReadingEncoding } from './types';

/**
 * TXT 导入：解码 + 章节识别。
 * 全是纯函数（只依赖 TextDecoder），便于直接跑单测而不碰 IndexedDB。
 */

/** 单本书的字符上限。超出会截断并在界面上说明，不静默丢。 */
export const READING_MAX_CHARS = 5_000_000;

const UTF8_DECODER_OPTIONS = { fatal: true } as const;

/** 浏览器 TextDecoder 认的编码名；gbk 在国产小说里最常见。 */
const ENCODING_CANDIDATES: ReadingEncoding[] = ['utf-8', 'gbk', 'big5'];

/**
 * 乱码率：不可见控制字符 + U+FFFD 替换符占比。
 * 用错编码解 GBK 文本会产出大量 U+FFFD，所以这个比例能区分对错。
 */
export const garbledRatio = (text: string): number => {
  if (!text) return 1;
  const sample = text.slice(0, 20_000);
  let bad = 0;
  for (const char of sample) {
    const code = char.codePointAt(0)!;
    if (code === 0xfffd) { bad += 1; continue; }
    // 允许 \t \n \r，其余 C0/C1 控制字符都算坏。
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) bad += 1;
    else if (code >= 0x7f && code <= 0x9f) bad += 1;
  }
  return bad / Math.max(1, [...sample].length);
};

const decodeWith = (bytes: Uint8Array, encoding: string, fatal: boolean): string | null => {
  try {
    return new TextDecoder(encoding, fatal ? UTF8_DECODER_OPTIONS : undefined).decode(bytes);
  } catch {
    return null;
  }
};

/** 认 BOM。有 BOM 就没有猜的必要，直接定编码。 */
const bomEncoding = (bytes: Uint8Array): ReadingEncoding | null => {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
};

export interface DecodeResult {
  text: string;
  encoding: ReadingEncoding;
  /** 猜出来的结果仍然偏乱时为 true；界面据此提示「换个编码重读」。 */
  suspectGarbled: boolean;
}

/**
 * 解码 TXT 字节。
 *
 * 判断顺序：BOM → 严格 UTF-8（fatal，非法字节立刻失败）→ 按乱码率挑候选编码。
 * 指定 forced 时只用那一种，不再猜——「换个编码重读」走这条路。
 */
export const decodeReadingText = (buffer: ArrayBuffer, forced?: ReadingEncoding): DecodeResult => {
  const bytes = new Uint8Array(buffer);

  if (forced) {
    const text = decodeWith(bytes, forced, false) ?? '';
    return { text, encoding: forced, suspectGarbled: garbledRatio(text) > 0.02 };
  }

  const bom = bomEncoding(bytes);
  if (bom) {
    const text = decodeWith(bytes, bom, false) ?? '';
    return { text, encoding: bom, suspectGarbled: garbledRatio(text) > 0.02 };
  }

  // fatal UTF-8 是最可靠的一步：GBK 正文几乎必然包含非法 UTF-8 序列而直接抛错。
  const strictUtf8 = decodeWith(bytes, 'utf-8', true);
  if (strictUtf8 !== null) {
    return { text: strictUtf8, encoding: 'utf-8', suspectGarbled: false };
  }

  let best: DecodeResult | null = null;
  for (const encoding of ENCODING_CANDIDATES) {
    const text = decodeWith(bytes, encoding, false);
    if (text === null) continue;
    const ratio = garbledRatio(text);
    if (!best || ratio < garbledRatio(best.text)) {
      best = { text, encoding, suspectGarbled: ratio > 0.02 };
    }
    if (ratio <= 0.001) break;
  }
  return best ?? { text: '', encoding: 'utf-8', suspectGarbled: true };
};

/** 统一换行并去掉零宽字符；偏移量在这一步之后才固定下来。 */
export const normalizeReadingText = (raw: string): string => raw
  .replace(/\r\n?/g, '\n')
  .replace(/[\u200b-\u200d\ufeff]/g, '')
  .replace(/\n{4,}/g, '\n\n\n');

/**
 * 章节标题。只认行首、整行独立、且短于 40 字的标题行——
 * 正文里出现「第三章里写过」这种句子不会被误判成标题。
 *
 * 认不出来是**静默**的：调用方必须检查 chaptersDetected，
 * 界面要告诉用户「这本书没识别出目录」，否则整本会挤成一章。
 */
const CHAPTER_PATTERNS: RegExp[] = [
  /^\s*第\s*[0-9０-９一二三四五六七八九十百千零〇两]+\s*[章回卷节篇折]\s*[^\n]{0,36}$/,
  /^\s*(?:序|序章|序言|楔子|前言|后记|尾声|番外|附录|终章|引子)\s*[^\n]{0,36}$/,
  /^\s*(?:Chapter|CHAPTER|chapter)\s+[0-9IVXLC]+\s*[^\n]{0,36}$/,
  /^\s*[0-9]{1,3}\s*[、.．]\s*\S[^\n]{0,34}$/,
];

const looksLikeChapterTitle = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return false;
  return CHAPTER_PATTERNS.some(pattern => pattern.test(trimmed));
};

/**
 * 切章。返回的区间覆盖整篇正文且互不重叠，
 * 所以阅读器可以只按 [start, end) 取文，不必另存副本。
 */
export const detectReadingChapters = (
  content: string,
): { chapters: ReadingChapter[]; detected: boolean } => {
  const found: Array<{ start: number; title: string }> = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    if (looksLikeChapterTitle(line)) {
      found.push({ start: offset, title: line.trim() });
    }
    offset += line.length + 1; // +1 补回被 split 吃掉的 '\n'
  }

  // 只认出一两个标题时，多半是正文里的巧合而不是真目录，宁可整本当一章。
  if (found.length < 3) {
    return {
      chapters: [{ start: 0, end: content.length, title: '全文' }],
      detected: false,
    };
  }

  const chapters: ReadingChapter[] = [];
  // 第一个标题之前的内容（书名页、简介）不能丢，单独成一节。
  if (found[0].start > 0) {
    chapters.push({ start: 0, end: found[0].start, title: '开头' });
  }
  found.forEach((item, index) => {
    chapters.push({
      start: item.start,
      end: index + 1 < found.length ? found[index + 1].start : content.length,
      title: item.title,
    });
  });
  return { chapters, detected: true };
};

export interface ParsedReadingFile {
  title: string;
  content: string;
  encoding: ReadingEncoding;
  chapters: ReadingChapter[];
  chaptersDetected: boolean;
  suspectGarbled: boolean;
  truncated: boolean;
}

/** 文件名去扩展名当书名；用户之后可以在书架里改。 */
export const titleFromFileName = (fileName: string): string => fileName
  .replace(/\.[^.]+$/, '')
  .replace(/[_]+/g, ' ')
  .trim() || '未命名';

export const parseReadingFile = (
  fileName: string,
  buffer: ArrayBuffer,
  forced?: ReadingEncoding,
): ParsedReadingFile => {
  const decoded = decodeReadingText(buffer, forced);
  const normalized = normalizeReadingText(decoded.text);
  const truncated = normalized.length > READING_MAX_CHARS;
  const content = truncated ? normalized.slice(0, READING_MAX_CHARS) : normalized;
  const { chapters, detected } = detectReadingChapters(content);
  return {
    title: titleFromFileName(fileName),
    content,
    encoding: decoded.encoding,
    chapters,
    chaptersDetected: detected,
    suspectGarbled: decoded.suspectGarbled,
    truncated,
  };
};