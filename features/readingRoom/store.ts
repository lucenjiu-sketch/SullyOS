import { spaceDatabaseName, SESSION_SPACE_ID, assertUserSpaceAvailable } from '../../utils/userSpaces';
import {
  READING_SELECTION_ID,
  type ReadingBook,
  type ReadingBookContent,
  type ReadingDiscussionMessage,
  type ReadingDiscussionWindow,
  type ReadingHighlight,
  type ReadingProgress,
  type ReadingSelection,
} from './types';

/**
 * 共读室的独立数据库，不动主库。
 *
 * 分表的理由：书架一屏可能列十几本，正文动辄几百万字符。
 * 把 content 放进 ReadingBook 会让「列书架」这个动作每次读出整个书库。
 *
 * 第一期不接入备份导出（Settings → 导出）。清浏览器数据、换设备会丢，
 * 三期做完后再统一接 OSContext 的备份通道。
 *
 * ## 版本历史
 *
 * - v1：books / contents / progress
 * - v2：加 highlights（划线）。划线按 bookId 建索引，列一本书的划线不必全表扫。
 *   **升级是加表，不改旧表**，所以 v1 存的书和进度原样保留。
 * - v3：加 windows（讨论窗口，按 charId 建索引）和 selection（当前选了谁、用哪个窗口）。
 *   同样只加表。窗口**只挂角色不挂书**，当前选择是**应用级全局的一行记录**，
 *   换书不动它——这是久定的，别改成按书存。
 * - v4：加 messages（讨论消息，按 windowId 建索引）。又是只加表，v1–v3 的数据原样留着。
 *   消息里的引用**只有书名 / 章节 / 划线原文**，划线前后那些原文不进库（见 types.ts）。
 */

const DB_VERSION = 4;
const STORE_BOOKS = 'books';
const STORE_CONTENTS = 'contents';
const STORE_PROGRESS = 'progress';
const STORE_HIGHLIGHTS = 'highlights';
const STORE_WINDOWS = 'windows';
const STORE_SELECTION = 'selection';
const STORE_MESSAGES = 'messages';
const INDEX_HIGHLIGHT_BOOK = 'by_book';
const INDEX_WINDOW_CHAR = 'by_char';
const INDEX_MESSAGE_WINDOW = 'by_window';

const connections = new Map<string, Promise<IDBDatabase>>();

export const openReadingRoomSpace = (spaceId = SESSION_SPACE_ID): Promise<IDBDatabase> => {
  const DB_NAME = spaceDatabaseName('SullyOS_ReadingRoom', spaceId);
  const existing = connections.get(spaceId);
  if (existing) return existing;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CONTENTS)) {
        db.createObjectStore(STORE_CONTENTS, { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        db.createObjectStore(STORE_PROGRESS, { keyPath: 'bookId' });
      }
      // v2 新增。用 createObjectStore 的返回值直接建索引，不必再开事务。
      if (!db.objectStoreNames.contains(STORE_HIGHLIGHTS)) {
        const store = db.createObjectStore(STORE_HIGHLIGHTS, { keyPath: 'id' });
        store.createIndex(INDEX_HIGHLIGHT_BOOK, 'bookId', { unique: false });
      }
      // v3 新增。窗口按角色建索引：列一个角色的窗口不必全表扫。
      if (!db.objectStoreNames.contains(STORE_WINDOWS)) {
        const store = db.createObjectStore(STORE_WINDOWS, { keyPath: 'id' });
        store.createIndex(INDEX_WINDOW_CHAR, 'charId', { unique: false });
      }
      // v3 新增。当前选择只有一行（主键恒为 READING_SELECTION_ID）。
      if (!db.objectStoreNames.contains(STORE_SELECTION)) {
        db.createObjectStore(STORE_SELECTION, { keyPath: 'id' });
      }
      // v4 新增。消息按窗口建索引：读一个窗口的历史不必全表扫。
      // 消息只挂 windowId，不挂 bookId——是哪本书写在 message.reference 里。
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
        store.createIndex(INDEX_MESSAGE_WINDOW, 'windowId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const drop = () => { if (connections.get(spaceId) === pending) connections.delete(spaceId); };
      db.onversionchange = () => { db.close(); drop(); };
      db.onclose = drop;
      resolve(db);
    };
    request.onerror = () => {
      if (connections.get(spaceId) === pending) connections.delete(spaceId);
      reject(request.error);
    };
    request.onblocked = () => {
      if (connections.get(spaceId) === pending) connections.delete(spaceId);
      reject(new Error('共读室数据库被其它标签页占用，请关闭其它页面后重试'));
    };
  });
  connections.set(spaceId, pending);
  return pending;
};

const openDatabase = () => { assertUserSpaceAvailable(SESSION_SPACE_ID); return openReadingRoomSpace(); };

export async function deleteReadingRoomSpace(spaceId: string): Promise<void> {
  (await connections.get(spaceId))?.close();
  connections.delete(spaceId);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(spaceDatabaseName('SullyOS_ReadingRoom', spaceId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他 SullyOS 标签页后重试重置'));
  });
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const commitTransaction = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('共读室数据写入中断'));
});

export const ReadingRoomStore = {
  listBooks: async (): Promise<ReadingBook[]> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_BOOKS, 'readonly');
    const rows = await requestResult(transaction.objectStore(STORE_BOOKS).getAll()) as ReadingBook[];
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getBook: async (bookId: string): Promise<ReadingBook | null> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_BOOKS, 'readonly');
    const row = await requestResult(transaction.objectStore(STORE_BOOKS).get(bookId)) as ReadingBook | undefined;
    return row || null;
  },

  /** 书和正文一个事务写入，避免书架出现一本点开没内容的书。 */
  saveBook: async (book: ReadingBook, content?: string): Promise<void> => {
    const db = await openDatabase();
    const names = content === undefined ? [STORE_BOOKS] : [STORE_BOOKS, STORE_CONTENTS];
    const transaction = db.transaction(names, 'readwrite');
    transaction.objectStore(STORE_BOOKS).put(book);
    if (content !== undefined) {
      const row: ReadingBookContent = { bookId: book.id, content };
      transaction.objectStore(STORE_CONTENTS).put(row);
    }
    await commitTransaction(transaction);
  },

  getContent: async (bookId: string): Promise<string | null> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_CONTENTS, 'readonly');
    const row = await requestResult(transaction.objectStore(STORE_CONTENTS).get(bookId)) as ReadingBookContent | undefined;
    return row ? row.content : null;
  },

  /**
   * 删书会连带删掉正文、进度和划线。
   *
   * **讨论消息不跟着删**：窗口不属于书，一个窗口里堆着好几本书的讨论，
   * 按书去删会在历史中间挖出一个洞。消息里的 `reference` 存了当时的书名，
   * 书删掉之后翻历史照样看得出在说哪本（引用卡片不依赖书还在不在）。
   */
  deleteBook: async (bookId: string): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(
      [STORE_BOOKS, STORE_CONTENTS, STORE_PROGRESS, STORE_HIGHLIGHTS],
      'readwrite',
    );
    transaction.objectStore(STORE_BOOKS).delete(bookId);
    transaction.objectStore(STORE_CONTENTS).delete(bookId);
    transaction.objectStore(STORE_PROGRESS).delete(bookId);
    // 划线按 id 为主键，只能通过索引逐条删。
    const index = transaction.objectStore(STORE_HIGHLIGHTS).index(INDEX_HIGHLIGHT_BOOK);
    const cursorRequest = index.openCursor(IDBKeyRange.only(bookId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await commitTransaction(transaction);
  },

  getProgress: async (bookId: string): Promise<ReadingProgress | null> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_PROGRESS, 'readonly');
    const row = await requestResult(transaction.objectStore(STORE_PROGRESS).get(bookId)) as ReadingProgress | undefined;
    return row || null;
  },

  saveProgress: async (progress: ReadingProgress): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_PROGRESS, 'readwrite');
    transaction.objectStore(STORE_PROGRESS).put(progress);
    await commitTransaction(transaction);
  },

  listProgress: async (): Promise<ReadingProgress[]> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_PROGRESS, 'readonly');
    return requestResult(transaction.objectStore(STORE_PROGRESS).getAll()) as Promise<ReadingProgress[]>;
  },

  /** 一本书的所有划线，按在正文里出现的顺序返回。 */
  listHighlights: async (bookId: string): Promise<ReadingHighlight[]> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_HIGHLIGHTS, 'readonly');
    const index = transaction.objectStore(STORE_HIGHLIGHTS).index(INDEX_HIGHLIGHT_BOOK);
    const rows = await requestResult(index.getAll(IDBKeyRange.only(bookId))) as ReadingHighlight[];
    return rows.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  },

  saveHighlight: async (highlight: ReadingHighlight): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_HIGHLIGHTS, 'readwrite');
    transaction.objectStore(STORE_HIGHLIGHTS).put(highlight);
    await commitTransaction(transaction);
  },

  deleteHighlight: async (highlightId: string): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_HIGHLIGHTS, 'readwrite');
    transaction.objectStore(STORE_HIGHLIGHTS).delete(highlightId);
    await commitTransaction(transaction);
  },

  // ——— 讨论窗口（v3）———
  //
  // 窗口只按 charId 归属，**没有 bookId**。切书不换窗口是久定的交互，
  // 要是哪天加了 bookId，那条交互就跟着没了。

  /** 一个角色名下的全部窗口（含已归档）。分栏交给 `filterWindows`。 */
  listWindows: async (charId: string): Promise<ReadingDiscussionWindow[]> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_WINDOWS, 'readonly');
    const index = transaction.objectStore(STORE_WINDOWS).index(INDEX_WINDOW_CHAR);
    const rows = await requestResult(index.getAll(IDBKeyRange.only(charId))) as ReadingDiscussionWindow[];
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  saveWindow: async (window: ReadingDiscussionWindow): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_WINDOWS, 'readwrite');
    transaction.objectStore(STORE_WINDOWS).put(window);
    await commitTransaction(transaction);
  },

  /**
   * 删一个窗口，连带删掉它名下的全部消息。
   *
   * 两件事在**同一个事务**里：只删窗口不删消息，那些消息就成了孤儿——
   * 永远读不到，又一直占着空间。
   *
   * 消息的主键是 id，只能通过 `by_window` 索引逐条删（照 `deleteBook` 那个写法）。
   * 索引范围锁死在这一个 windowId 上，**同一个角色的其它窗口不会被碰到**。
   */
  deleteWindow: async (windowId: string): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_WINDOWS, STORE_MESSAGES], 'readwrite');
    transaction.objectStore(STORE_WINDOWS).delete(windowId);
    const index = transaction.objectStore(STORE_MESSAGES).index(INDEX_MESSAGE_WINDOW);
    const cursorRequest = index.openCursor(IDBKeyRange.only(windowId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await commitTransaction(transaction);
  },

  // ——— 讨论消息（v4）———
  //
  // 消息只挂 windowId。是哪本书、哪一章、划了哪句，都在 message.reference 里，
  // **而且只有书名 / 章节 / 划线原文**——划线前后的那些原文属于单次请求，不进这张表。

  /** 一个窗口的全部消息，按时间正序。别的窗口一条都不会混进来。 */
  listMessages: async (windowId: string): Promise<ReadingDiscussionMessage[]> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_MESSAGES, 'readonly');
    const index = transaction.objectStore(STORE_MESSAGES).index(INDEX_MESSAGE_WINDOW);
    const rows = await requestResult(index.getAll(IDBKeyRange.only(windowId))) as ReadingDiscussionMessage[];
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },

  /**
   * 存一条消息，同时把窗口上的预览和时间刷新。
   *
   * **两张表一个事务**：消息写进去了但窗口预览没更新，列表就会显示上一条，
   * 看着像消息没发出去。
   *
   * 窗口那一份由调用方算好传进来（用 `applyMessageToWindow`），
   * 这里不读旧窗口再改——读-改-写跨两个事务的话，中间那一下别人改过就会被覆盖。
   */
  saveMessage: async (
    message: ReadingDiscussionMessage,
    window?: ReadingDiscussionWindow,
  ): Promise<void> => {
    const db = await openDatabase();
    const names = window ? [STORE_MESSAGES, STORE_WINDOWS] : [STORE_MESSAGES];
    const transaction = db.transaction(names, 'readwrite');
    transaction.objectStore(STORE_MESSAGES).put(message);
    if (window) transaction.objectStore(STORE_WINDOWS).put(window);
    await commitTransaction(transaction);
  },

  deleteMessage: async (messageId: string): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    transaction.objectStore(STORE_MESSAGES).delete(messageId);
    await commitTransaction(transaction);
  },

  // ——— 当前选择（v3）———
  //
  // 单行记录，不跟书绑定。读不到就返回 null，由调用方用 `emptySelection()` 兜。

  getSelection: async (): Promise<ReadingSelection | null> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_SELECTION, 'readonly');
    const row = await requestResult(
      transaction.objectStore(STORE_SELECTION).get(READING_SELECTION_ID),
    ) as ReadingSelection | undefined;
    return row || null;
  },

  saveSelection: async (selection: ReadingSelection): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_SELECTION, 'readwrite');
    // 主键强制成固定值：多出第二行的话，「当前选择」就有两个答案了。
    transaction.objectStore(STORE_SELECTION).put({ ...selection, id: READING_SELECTION_ID });
    await commitTransaction(transaction);
  },
};