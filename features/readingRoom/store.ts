import { spaceDatabaseName, SESSION_SPACE_ID, assertUserSpaceAvailable } from '../../utils/userSpaces';
import type { ReadingBook, ReadingBookContent, ReadingProgress } from './types';

/**
 * 共读室的独立数据库，不动主库。
 *
 * 分表的理由：书架一屏可能列十几本，正文动辄几百万字符。
 * 把 content 放进 ReadingBook 会让「列书架」这个动作每次读出整个书库。
 *
 * 第一期不接入备份导出（Settings → 导出）。清浏览器数据、换设备会丢，
 * 三期做完后再统一接 OSContext 的备份通道。
 */

const DB_VERSION = 1;
const STORE_BOOKS = 'books';
const STORE_CONTENTS = 'contents';
const STORE_PROGRESS = 'progress';

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

  /** 删书会连带删掉正文和进度；划线和讨论在第二期有各自的表，到时一并处理。 */
  deleteBook: async (bookId: string): Promise<void> => {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_BOOKS, STORE_CONTENTS, STORE_PROGRESS], 'readwrite');
    transaction.objectStore(STORE_BOOKS).delete(bookId);
    transaction.objectStore(STORE_CONTENTS).delete(bookId);
    transaction.objectStore(STORE_PROGRESS).delete(bookId);
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
};