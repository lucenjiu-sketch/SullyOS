/**
 * 共读室：与角色一起逐段读一本书。
 *
 * 书的正文**不进聊天上下文**。全文留在本地 IndexedDB，只有用户划线选中的片段
 * 和它前后的少量原文会在讨论时发给模型。这是和协同工作最根本的区别：
 * 协同把附件正文整段塞进 system prompt（上限 30 万字符），一本长篇装不下也不该装。
 */

/** 章节在全文里的位置。正文本身不复制，按 [start, end) 从 content 切。 */
export interface ReadingChapter {
  /** 在 ReadingBookContent.content 里的起始字符偏移（含）。 */
  start: number;
  /** 结束字符偏移（不含）。 */
  end: number;
  title: string;
}

/** 书架条目。不含正文，列书架时不必读出整本。 */
export interface ReadingBook {
  id: string;
  title: string;
  /** 用户可改的作者名；TXT 里一般读不到，默认留空。 */
  author?: string;
  /** 原始文件名，用于区分同名书。 */
  fileName: string;
  /** 正文总字符数。 */
  charCount: number;
  /** 实际解码用的编码，便于「换个编码重读」时显示当前值。 */
  encoding: ReadingEncoding;
  chapters: ReadingChapter[];
  /** 章节是不是真从正文里认出来的；false 表示整本当一章兜底。 */
  chaptersDetected: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 正文单独一张表：书架列表和阅读进度的读写都不该把整本正文带出来。 */
export interface ReadingBookContent {
  bookId: string;
  content: string;
}

export type ReadingEncoding = 'utf-8' | 'gbk' | 'big5' | 'utf-16le' | 'utf-16be';

/** 阅读进度。按字符偏移记，换字号、换排版都不会跑位。 */
export interface ReadingProgress {
  bookId: string;
  /** 上次读到的字符偏移。 */
  offset: number;
  updatedAt: number;
}

export const readingRoomId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
