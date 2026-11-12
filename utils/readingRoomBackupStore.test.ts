import { describe, it, expect } from 'vitest';
import { ReadingRoomStore } from '../features/readingRoom/store';
import { buildReadingRoomBackup, parseReadingRoomBackup } from './readingRoomBackup';
import type { ReadingBook } from '../features/readingRoom/types';

/**
 * 共读室 · 备份真的读写 IndexedDB 的那一段（`exportAll` / `importAll`）。
 *
 * **单独一个文件，不并进 `readingRoomStore.test.ts`。**
 * 那个文件里的用例靠各自唯一的 id 互相隔离，而 `importAll` 会
 * **清空七张表**——放在一起会把别人的数据冲掉，而且是随机顺序下的随机失败。
 * 这里每个用例都自己先 import 一个已知状态，再断言。
 *
 * fake-indexeddb 由 test-setup.ts 注入。不要 deleteDatabase：
 * store.ts 内部是单例连接，会把删库请求 block 住。
 */

let seed = 0;
const uniqueId = (prefix: string): string => `${prefix}-${++seed}-${Date.now()}`;

const book = (id: string, title: string): ReadingBook => ({
  id,
  title,
  fileName: `${title}.txt`,
  charCount: 16,
  encoding: 'utf-8',
  chapters: [{ start: 0, end: 16, title: '第一章' }],
  chaptersDetected: true,
  createdAt: 1_000,
  updatedAt: 1_000,
});

describe('共读室备份 · 落库往返', () => {
  it('导出再导入，书、正文、划线、窗口、消息、选择都回来了', async () => {
    const bookId = uniqueId('b');
    const charId = uniqueId('c');
    const windowId = uniqueId('rw');
    await ReadingRoomStore.importAll({
      books: [book(bookId, '玻璃城堡')],
      contents: [{ bookId, content: '正文一共十六个字符。' }],
      progress: [{ bookId, offset: 8, updatedAt: 2 }],
      highlights: [{
        id: uniqueId('h'),
        bookId,
        startOffset: 2,
        endOffset: 6,
        text: '一共十六',
        color: 'rgba(255, 203, 92, 0.48)',
        createdAt: 1,
        updatedAt: 1,
      }],
      windows: [{ id: windowId, charId, name: '聊玻璃城堡', createdAt: 1, updatedAt: 3 }],
      messages: [{
        id: uniqueId('rm'),
        windowId,
        role: 'user',
        content: '这段写得真好',
        createdAt: 4,
      }],
      selection: { id: 'current', charId, windowId, updatedAt: 5 },
    });

    const exported = await ReadingRoomStore.exportAll();
    expect(exported.books?.map(item => item.title)).toEqual(['玻璃城堡']);
    expect(exported.contents?.[0].content).toBe('正文一共十六个字符。');
    expect(exported.progress?.[0].offset).toBe(8);
    expect(exported.highlights?.[0].text).toBe('一共十六');
    expect(exported.windows?.[0].name).toBe('聊玻璃城堡');
    expect(exported.messages?.[0].content).toBe('这段写得真好');
    expect(exported.selection?.windowId).toBe(windowId);

    // 再走一遍完整链路：包装 → 校验 → 落库 → 读出来。
    const payload = buildReadingRoomBackup(exported);
    const parsed = parseReadingRoomBackup(payload);
    expect(parsed).not.toBeNull();
    await ReadingRoomStore.importAll(parsed!);
    const again = await ReadingRoomStore.exportAll();
    expect(again.books?.[0].title).toBe('玻璃城堡');
    expect(again.messages?.[0].content).toBe('这段写得真好');
  });

  it('导入是覆盖：原来的书不会和备份里的混在一起', async () => {
    const oldId = uniqueId('b');
    await ReadingRoomStore.importAll({ books: [book(oldId, '导入前的书')] });
    expect((await ReadingRoomStore.listBooks()).map(item => item.title)).toEqual(['导入前的书']);

    const newId = uniqueId('b');
    await ReadingRoomStore.importAll({ books: [book(newId, '备份里的书')] });
    // 久拍板走覆盖：导入备份 = 回到那个时间点，不是两边合并。
    expect((await ReadingRoomStore.listBooks()).map(item => item.title)).toEqual(['备份里的书']);
  });

  it('导入空对象会把共读室清空（所以调用方必须先判断 parse 结果不是 null）', async () => {
    await ReadingRoomStore.importAll({ books: [book(uniqueId('b'), '待清空')] });
    await ReadingRoomStore.importAll({});
    expect(await ReadingRoomStore.listBooks()).toEqual([]);
    expect(await ReadingRoomStore.getSelection()).toBeNull();
  });

  it('第三期那两个字段落库之后读得回来', async () => {
    const charId = uniqueId('c');
    const windowId = uniqueId('rw');
    await ReadingRoomStore.importAll({
      windows: [{
        id: windowId,
        charId,
        name: '已写进记忆的窗口',
        archivedAt: 500,
        memoryArchivedAt: 600,
        memoryArchiveSummary: '【11月12日，我和她读了那本书】',
        createdAt: 1,
        updatedAt: 2,
      }],
    });
    const rows = await ReadingRoomStore.listWindows(charId);
    expect(rows[0].memoryArchivedAt).toBe(600);
    expect(rows[0].memoryArchiveSummary).toBe('【11月12日，我和她读了那本书】');
  });

  it('当前选择的主键被强制成固定值，不会多出第二行', async () => {
    const charId = uniqueId('c');
    await ReadingRoomStore.importAll({
      selection: { id: '被改过的主键', charId, updatedAt: 9 } as any,
    });
    const selection = await ReadingRoomStore.getSelection();
    expect(selection?.id).toBe('current');
    expect(selection?.charId).toBe(charId);
  });
});