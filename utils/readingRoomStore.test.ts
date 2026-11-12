import { describe, it, expect } from 'vitest';
import { ReadingRoomStore } from '../features/readingRoom/store';
import { applyMessageToWindow, createDiscussionMessage, createDiscussionWindow } from '../features/readingRoom/discussion';
import type { ReadingBook, ReadingDiscussionWindow } from '../features/readingRoom/types';

/**
 * 共读室数据库（v4）的落库行为。
 *
 * 纯逻辑的部分在 `readingRoomDiscussion.test.ts`；这里只测**真的读写
 * IndexedDB 才会暴露的那几件事**：
 *
 * - v3 升 v4 之后旧表的数据还在（只加表、不改旧表）
 * - 消息按 windowId 隔离，别的窗口一条都不混进来
 * - 删窗口连带删它的消息，而且不碰同角色的其它窗口
 *
 * fake-indexeddb 由 test-setup.ts 注入。整个文件共用一个库连接
 * （store.ts 内部是单例），所以每个用例用**各自唯一的 id**互相隔离，
 * 不去 deleteDatabase —— 单例连接会把删库请求 block 住。
 */

let seed = 0;
const uniqueId = (prefix: string): string => `${prefix}-${++seed}-${Date.now()}`;

const book = (id: string, title: string): ReadingBook => ({
  id,
  title,
  fileName: `${title}.txt`,
  charCount: 12,
  encoding: 'utf-8',
  chapters: [{ start: 0, end: 12, title: '第一章' }],
  chaptersDetected: true,
  createdAt: 1_000,
  updatedAt: 1_000,
});

const messageIn = (window: ReadingDiscussionWindow, content: string, at: number) => createDiscussionMessage({
  windowId: window.id,
  role: 'user',
  content,
  now: at,
});

describe('共读室 store · v4 升级', () => {
  it('加了 messages 表之后，书、正文、进度、划线、窗口都还在', async () => {
    const bookId = uniqueId('b');
    const charId = uniqueId('c');
    await ReadingRoomStore.saveBook(book(bookId, '升级前就有的书'), '正文十二个字符。');
    await ReadingRoomStore.saveProgress({ bookId, offset: 5, updatedAt: 1 });
    await ReadingRoomStore.saveHighlight({
      id: uniqueId('h'),
      bookId,
      startOffset: 0,
      endOffset: 4,
      text: '正文十二',
      color: 'rgba(255, 203, 92, 0.48)',
      createdAt: 1,
      updatedAt: 1,
    });
    const window = createDiscussionWindow(charId, [], 1);
    await ReadingRoomStore.saveWindow(window);

    expect((await ReadingRoomStore.getBook(bookId))?.title).toBe('升级前就有的书');
    expect(await ReadingRoomStore.getContent(bookId)).toBe('正文十二个字符。');
    expect((await ReadingRoomStore.getProgress(bookId))?.offset).toBe(5);
    expect(await ReadingRoomStore.listHighlights(bookId)).toHaveLength(1);
    expect(await ReadingRoomStore.listWindows(charId)).toHaveLength(1);
  });
});

describe('共读室 store · 消息按窗口隔离', () => {
  it('只读得到自己窗口的消息，按时间正序', async () => {
    const charId = uniqueId('c');
    const mine = createDiscussionWindow(charId, [], 1);
    const other = createDiscussionWindow(charId, [mine], 2);
    await ReadingRoomStore.saveWindow(mine);
    await ReadingRoomStore.saveWindow(other);

    // 故意乱序存，读出来必须是正序。
    await ReadingRoomStore.saveMessage(messageIn(mine, '第三句', 300));
    await ReadingRoomStore.saveMessage(messageIn(mine, '第一句', 100));
    await ReadingRoomStore.saveMessage(messageIn(mine, '第二句', 200));
    await ReadingRoomStore.saveMessage(messageIn(other, '别的窗口说的话', 150));

    const rows = await ReadingRoomStore.listMessages(mine.id);
    expect(rows.map(row => row.content)).toEqual(['第一句', '第二句', '第三句']);
    expect(rows.every(row => row.windowId === mine.id)).toBe(true);
  });

  it('空窗口读出空数组，不是 undefined', async () => {
    const window = createDiscussionWindow(uniqueId('c'), [], 1);
    await ReadingRoomStore.saveWindow(window);
    expect(await ReadingRoomStore.listMessages(window.id)).toEqual([]);
  });

  it('存消息时窗口预览在同一个事务里一起更新', async () => {
    const charId = uniqueId('c');
    const window = createDiscussionWindow(charId, [], 1);
    await ReadingRoomStore.saveWindow(window);

    const message = messageIn(window, '这一段让我想起很久以前的事', 5_000);
    await ReadingRoomStore.saveMessage(message, applyMessageToWindow(window, message));

    const [stored] = await ReadingRoomStore.listWindows(charId);
    expect(stored.lastMessagePreview).toBe('这一段让我想起很久以前的事');
    expect(stored.lastMessageAt).toBe(5_000);
  });

  it('引用存进库再读出来，书名章节划线原文都还在', async () => {
    const window = createDiscussionWindow(uniqueId('c'), [], 1);
    await ReadingRoomStore.saveWindow(window);
    await ReadingRoomStore.saveMessage(createDiscussionMessage({
      windowId: window.id,
      role: 'user',
      content: '他为什么不回答',
      reference: {
        bookId: 'b-gone',
        bookTitle: '某本书',
        chapterTitle: '第三章',
        highlightId: 'h1',
        quote: '他看着窗外，没有回答。',
      },
      now: 1,
    }));

    const [row] = await ReadingRoomStore.listMessages(window.id);
    expect(row.reference?.bookTitle).toBe('某本书');
    expect(row.reference?.chapterTitle).toBe('第三章');
    expect(row.reference?.quote).toBe('他看着窗外，没有回答。');
    // 前后文不该在库里，重新打开窗口时也就不会被再发一遍。
    expect(JSON.stringify(row)).not.toContain('before');
    expect(JSON.stringify(row)).not.toContain('after');
  });
});

describe('共读室 store · 删窗口', () => {
  it('连带删掉这个窗口的全部消息', async () => {
    const window = createDiscussionWindow(uniqueId('c'), [], 1);
    await ReadingRoomStore.saveWindow(window);
    await ReadingRoomStore.saveMessage(messageIn(window, '一', 1));
    await ReadingRoomStore.saveMessage(messageIn(window, '二', 2));
    expect(await ReadingRoomStore.listMessages(window.id)).toHaveLength(2);

    await ReadingRoomStore.deleteWindow(window.id);
    expect(await ReadingRoomStore.listMessages(window.id)).toEqual([]);
  });

  it('不碰同一个角色的其它窗口', async () => {
    const charId = uniqueId('c');
    const doomed = createDiscussionWindow(charId, [], 1);
    const keeper = createDiscussionWindow(charId, [doomed], 2);
    await ReadingRoomStore.saveWindow(doomed);
    await ReadingRoomStore.saveWindow(keeper);
    await ReadingRoomStore.saveMessage(messageIn(doomed, '要被删的', 1));
    await ReadingRoomStore.saveMessage(messageIn(keeper, '要留下的', 2));

    await ReadingRoomStore.deleteWindow(doomed.id);

    const left = await ReadingRoomStore.listWindows(charId);
    expect(left.map(row => row.id)).toEqual([keeper.id]);
    const kept = await ReadingRoomStore.listMessages(keeper.id);
    expect(kept.map(row => row.content)).toEqual(['要留下的']);
  });

  it('删书不动讨论消息 —— 窗口不属于书，按书删会在历史里挖个洞', async () => {
    const bookId = uniqueId('b');
    const window = createDiscussionWindow(uniqueId('c'), [], 1);
    await ReadingRoomStore.saveBook(book(bookId, '待删的书'), '正文');
    await ReadingRoomStore.saveWindow(window);
    await ReadingRoomStore.saveMessage(createDiscussionMessage({
      windowId: window.id,
      role: 'user',
      content: '聊这本书',
      reference: { bookId, bookTitle: '待删的书', chapterTitle: '第一章', quote: '正文' },
      now: 1,
    }));

    await ReadingRoomStore.deleteBook(bookId);

    const rows = await ReadingRoomStore.listMessages(window.id);
    expect(rows).toHaveLength(1);
    // 书没了，但当时的书名还记在引用里，翻历史仍然看得出在说哪本。
    expect(rows[0].reference?.bookTitle).toBe('待删的书');
  });
});
