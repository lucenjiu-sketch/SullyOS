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

/**
 * 一条划线。
 *
 * **跨多少页都只存一条记录**，不按页拆分：位置用全文字符偏移表达，
 * 与字号、屏幕、分页边界无关。改字号后分页会变，这条划线照样定位得到。
 *
 * `text` 存的是 `content.slice(startOffset, endOffset)` 的**原文**，
 * 包含其中的换行和缩进空白。保真是为了发给角色时给出的是原话；
 * 屏幕显示和发送前再去整理多余空白（见 `highlightDisplayText`）。
 */
export interface ReadingHighlight {
  id: string;
  bookId: string;
  /** 全文起始字符偏移（含）。 */
  startOffset: number;
  /** 全文结束字符偏移（不含）。 */
  endOffset: number;
  /** 划线范围内的原文，含空白。 */
  text: string;
  /** 划线底色，取自 READING_HIGHLIGHT_COLORS。 */
  color: string;
  /** 用户自己写的批注；第三期归档会用到。留空表示只划了线。 */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 一个讨论窗口。
 *
 * **只属于角色，不属于书。** 这是久定下来的：选窗口是用户的事，切书不换窗口。
 * 同一个窗口里可以堆着好几本书的讨论，发送时在内容里写明「正在读《某书》」，
 * 由角色自己分辨，不靠数据结构分。
 *
 * 和协同工作的 `CollaborationSession` 刻意分开存（各自的数据库），
 * 两边互不污染——久要的就是这个。
 */
export interface ReadingDiscussionWindow {
  id: string;
  /** 属于哪个角色（CharacterProfile.id）。不同角色的窗口不混在一起。 */
  charId: string;
  name: string;
  /** 有值就是已归档。口径与协同工作的 `archivedAt` 一致。 */
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 共读室当前选了谁、用哪个窗口。
 *
 * **应用级别的全局选择，不跟书绑定。** 换书不动它，除非用户主动改。
 * 单行记录，`id` 恒为 `READING_SELECTION_ID`。
 */
export interface ReadingSelection {
  id: string;
  charId?: string;
  windowId?: string;
  updatedAt: number;
}

/** 当前选择那一行的固定主键。 */
export const READING_SELECTION_ID = 'current';

export const readingRoomId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
