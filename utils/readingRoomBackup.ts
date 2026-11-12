import type {
  ReadingBook,
  ReadingBookContent,
  ReadingDiscussionMessage,
  ReadingDiscussionWindow,
  ReadingHighlight,
  ReadingProgress,
  ReadingRoomBackupData,
  ReadingSelection,
} from '../features/readingRoom/types';

/**
 * 共读室 · 备份的导出包装和导入校验。
 *
 * ## 为什么要有这一层
 *
 * 备份文件是可以被编辑、被跨版本导入、被截断的。`ReadingRoomStore.importAll`
 * 会**先清空七张表再写入**，所以让没校验过的数据走到那一步，意味着
 * 「拿一份坏备份就能把书架清空」。这里把每一行筛一遍，坏的丢掉、好的留下。
 *
 * ## 跨版本兼容（久问过这件事）
 *
 * - **这份备份导进原版 SullyOS**：原版的导入逻辑是一个字段一个字段点名取的
 *   （`OSContext` 的 `importFullData`），`readingRoom` 这个键它不认识，
 *   会被原样忽略。不报错，也不会弄坏别的数据。
 * - **原版的备份导进这个版本**：读不到 `readingRoom`，`parseReadingRoomBackup`
 *   返回 `null`，调用方跳过恢复、**不动现有数据**。
 *   不是错误，是「这份备份里没有共读室这一块」。
 *
 * 这两条都靠 `formatVersion` 之外的东西成立，所以**不要为这个功能
 * 去动备份的 formatVersion**，那会让原版拒绝导入整个文件。
 */

/** 这一块数据自己的版本号。和备份的 formatVersion 无关，纯粹给以后改结构留的余地。 */
export const READING_ROOM_BACKUP_VERSION = 1;

export interface ReadingRoomBackupPayload {
  version: number;
  data: ReadingRoomBackupData;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const str = (value: unknown): string | undefined => (
  typeof value === 'string' ? value : undefined
);

const num = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

/**
 * 逐行筛。
 *
 * `pick` 返回 `null` 就把这一行丢掉。**丢掉而不是整包拒绝**：
 * 一本书的某个字段坏了，不该让整个书架恢复不了。
 */
const rows = <T>(value: unknown, pick: (row: Record<string, unknown>) => T | null): T[] => {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const picked = pick(row);
    if (picked !== null) out.push(picked);
  }
  return out;
};

/**
 * 把当前共读室的数据包成备份里的那一块。
 *
 * 全空就返回 `undefined`——没用过共读室的人的备份里不该多一个空对象。
 */
export function buildReadingRoomBackup(
  data: ReadingRoomBackupData | null | undefined,
): ReadingRoomBackupPayload | undefined {
  if (!data) return undefined;
  const empty = (data.books?.length || 0) === 0
    && (data.contents?.length || 0) === 0
    && (data.progress?.length || 0) === 0
    && (data.highlights?.length || 0) === 0
    && (data.windows?.length || 0) === 0
    && (data.messages?.length || 0) === 0
    && !data.selection;
  if (empty) return undefined;
  return { version: READING_ROOM_BACKUP_VERSION, data };
}

/**
 * 从备份里把共读室那一块读出来并校验。
 *
 * 返回 `null` 的三种情况，调用方都该**跳过恢复、不动现有数据**：
 * - 备份里没有这一块（原版导出的，或者没用过共读室）
 * - 形状不对（不是对象）
 * - 筛完一行都不剩
 *
 * 版本号比当前大时**仍然尝试恢复**：结构是只增字段的，
 * 旧版本读新备份最坏情况是丢掉几个不认识的字段，比整块拒绝好。
 */
export function parseReadingRoomBackup(value: unknown): ReadingRoomBackupData | null {
  if (!isRecord(value)) return null;
  const payload = isRecord(value.data) ? value.data : value;

  /*
   * 书：没有 id 就丢掉——正文、进度、划线全都按 bookId 挂在它上面，
   * 没 id 的书在书架上是一个点不开的壳。
   *
   * `chapters` 必须是数组：分页（`paginate.ts`）直接遍历它，
   * 给个字符串进去会在打开书的瞬间抛错。
   * 空数组是合法的——`chaptersDetected: false` 的书本来就整本当一章。
   */
  const books = rows<ReadingBook>(payload.books, row => {
    const id = str(row.id);
    if (!id) return null;
    const chapters = Array.isArray(row.chapters)
      ? row.chapters.filter(chapter => {
        if (!isRecord(chapter)) return false;
        const start = num(chapter.start);
        const end = num(chapter.end);
        return start !== undefined && end !== undefined && start >= 0 && end > start;
      })
      : [];
    return {
      ...row,
      id,
      title: str(row.title) || '未命名',
      fileName: str(row.fileName) || '',
      charCount: num(row.charCount) ?? 0,
      encoding: (str(row.encoding) || 'utf-8') as ReadingBook['encoding'],
      chapters,
      chaptersDetected: row.chaptersDetected === true,
      createdAt: num(row.createdAt) ?? Date.now(),
      updatedAt: num(row.updatedAt) ?? Date.now(),
    } as ReadingBook;
  });
  const bookIds = new Set(books.map(book => book.id));

  // 正文：必须对应一本还在的书。孤儿正文白占空间，而且永远读不到。
  const contents = rows<ReadingBookContent>(payload.contents, row => {
    const bookId = str(row.bookId);
    const content = str(row.content);
    if (!bookId || content === undefined || !bookIds.has(bookId)) return null;
    return { bookId, content };
  });

  const progress = rows<ReadingProgress>(payload.progress, row => {
    const bookId = str(row.bookId);
    const offset = num(row.offset);
    if (!bookId || !bookIds.has(bookId)) return null;
    return {
      bookId,
      offset: offset !== undefined && offset >= 0 ? offset : 0,
      updatedAt: num(row.updatedAt) ?? Date.now(),
    };
  });

  /*
   * 划线：**偏移必须是有限数字且 startOffset < endOffset**。
   *
   * 这是整个校验里最要紧的一条。划线按「全文字符偏移」存，渲染时和当前页
   * 求交（`highlight.ts`）。一个 NaN 或者反过来的区间会让求交算出离谱结果——
   * 表现是正文里凭空出现一大片底色，或者这一页直接空掉。
   * 坏在数据里、错在界面上，而且不报错，所以必须在写库前筛掉。
   */
  const highlights = rows<ReadingHighlight>(payload.highlights, row => {
    const id = str(row.id);
    const bookId = str(row.bookId);
    const startOffset = num(row.startOffset);
    const endOffset = num(row.endOffset);
    const text = str(row.text);
    if (!id || !bookId || !bookIds.has(bookId)) return null;
    if (startOffset === undefined || endOffset === undefined) return null;
    if (startOffset < 0 || endOffset <= startOffset) return null;
    if (text === undefined) return null;
    return {
      ...row,
      id,
      bookId,
      startOffset,
      endOffset,
      text,
      color: str(row.color) || '',
      createdAt: num(row.createdAt) ?? Date.now(),
      updatedAt: num(row.updatedAt) ?? Date.now(),
    } as ReadingHighlight;
  });

  /*
   * 窗口：只认 charId。窗口属于角色、不属于书，这是久定的，
   * 所以这里**不校验也不补 bookId**——那个字段压根不存在。
   */
  const windows = rows<ReadingDiscussionWindow>(payload.windows, row => {
    const id = str(row.id);
    const charId = str(row.charId);
    if (!id || !charId) return null;
    return {
      ...row,
      id,
      charId,
      name: str(row.name) || '讨论',
      createdAt: num(row.createdAt) ?? Date.now(),
      updatedAt: num(row.updatedAt) ?? Date.now(),
    } as ReadingDiscussionWindow;
  });
  const windowIds = new Set(windows.map(window => window.id));

  /*
   * 消息：必须挂在一个还在的窗口上。
   *
   * 孤儿消息比没有更糟——它占着库，但任何界面都读不到它
   * （消息只能按 windowId 索引取），等于一段看不见的历史。
   */
  const messages = rows<ReadingDiscussionMessage>(payload.messages, row => {
    const id = str(row.id);
    const windowId = str(row.windowId);
    const role = str(row.role);
    const content = str(row.content);
    if (!id || !windowId || !windowIds.has(windowId)) return null;
    if (role !== 'user' && role !== 'assistant') return null;
    if (content === undefined) return null;
    return {
      ...row,
      id,
      windowId,
      role,
      content,
      createdAt: num(row.createdAt) ?? Date.now(),
    } as ReadingDiscussionMessage;
  });

  /*
   * 当前选择：指向不存在的窗口就把那一半丢掉。
   *
   * 留着一个指向空气的 windowId，进 App 时 `reconcileSelection` 会去修，
   * 但在它修好之前界面会显示「窗口已失效」，白让人慌一下。
   */
  const rawSelection = isRecord(payload.selection) ? payload.selection : undefined;
  const selectionWindowId = str(rawSelection?.windowId);
  const selection: ReadingSelection | undefined = rawSelection
    ? {
      id: 'current',
      charId: str(rawSelection.charId),
      windowId: selectionWindowId && windowIds.has(selectionWindowId) ? selectionWindowId : undefined,
      updatedAt: num(rawSelection.updatedAt) ?? Date.now(),
    }
    : undefined;

  const nothing = books.length === 0
    && contents.length === 0
    && progress.length === 0
    && highlights.length === 0
    && windows.length === 0
    && messages.length === 0
    && !selection;
  if (nothing) return null;

  return { books, contents, progress, highlights, windows, messages, selection };
}