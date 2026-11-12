import { spaceDatabaseName, SESSION_SPACE_ID, assertUserSpaceAvailable } from '../../utils/userSpaces';
import type { ReadingBook, ReadingBookContent, ReadingHighlight, ReadingProgress } from './types';

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
 */

const DB_VERSION = 2;
const STORE_BOOKS = 'books';
const STORE_CONTENTS = 'contents';
const STORE_PROGRESS = 'progress';
const STORE_HIGHLIGHTS = 'highlights';
const INDEX_HIGHLIGHT_BOOK = 'by_book';

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

  /** 删书会连带删掉正文、进度和划线；讨论窗口在下一次推送时一并处理。 */
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
};