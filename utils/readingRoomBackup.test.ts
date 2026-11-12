import { describe, it, expect } from 'vitest';
import {
  buildReadingRoomBackup,
  parseReadingRoomBackup,
  READING_ROOM_BACKUP_VERSION,
} from './readingRoomBackup';
import type { ReadingRoomBackupData } from '../features/readingRoom/types';

/**
 * 共读室 · 备份的导出包装和导入校验。
 *
 * 这个文件锁住的是**坏了会丢数据或者弄坏界面**的几条：
 *
 * - 原版备份（没有 readingRoom 这一块）导进来时不能清空现有数据
 * - 坏掉的划线区间不能写进库（会让正文页面显示异常，而且不报错）
 * - 孤儿数据（正文没对应的书、消息没对应的窗口）要筛掉
 * - 一行坏的不该让整包恢复失败
 */

const book = (patch: Record<string, unknown> = {}) => ({
  id: 'b1',
  title: '玻璃城堡',
  fileName: 'glass.txt',
  charCount: 1000,
  encoding: 'utf-8',
  chapters: [{ start: 0, end: 500, title: '第一章' }],
  chaptersDetected: true,
  createdAt: 1,
  updatedAt: 2,
  ...patch,
});

const highlight = (patch: Record<string, unknown> = {}) => ({
  id: 'h1',
  bookId: 'b1',
  startOffset: 10,
  endOffset: 30,
  text: '他看着窗外',
  color: '#ffe',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const window = (patch: Record<string, unknown> = {}) => ({
  id: 'rw1',
  charId: 'c1',
  name: '讨论 1',
  createdAt: 1,
  updatedAt: 2,
  ...patch,
});

const message = (patch: Record<string, unknown> = {}) => ({
  id: 'rm1',
  windowId: 'rw1',
  role: 'user',
  content: '这段写得好',
  createdAt: 3,
  ...patch,
});

const full = (): ReadingRoomBackupData => ({
  books: [book()] as any,
  contents: [{ bookId: 'b1', content: '正文正文' }],
  progress: [{ bookId: 'b1', offset: 20, updatedAt: 5 }],
  highlights: [highlight()] as any,
  windows: [window()] as any,
  messages: [message()] as any,
  selection: { id: 'current', charId: 'c1', windowId: 'rw1', updatedAt: 6 },
});

describe('共读室备份 · 导出包装', () => {
  it('有数据就带上版本号', () => {
    const payload = buildReadingRoomBackup(full());
    expect(payload?.version).toBe(READING_ROOM_BACKUP_VERSION);
    expect(payload?.data.books).toHaveLength(1);
  });

  it('书的正文也进备份（久选的方案 A）', () => {
    // 只备份划线不备份正文的话，重新导入的 TXT 必须逐字节一致，
    // 否则划线会静默错位。所以正文必须在。
    expect(buildReadingRoomBackup(full())?.data.contents?.[0].content).toBe('正文正文');
  });

  it('没用过共读室时不往备份里塞空对象', () => {
    expect(buildReadingRoomBackup({
      books: [], contents: [], progress: [], highlights: [], windows: [], messages: [],
    })).toBeUndefined();
    expect(buildReadingRoomBackup(null)).toBeUndefined();
    expect(buildReadingRoomBackup(undefined)).toBeUndefined();
  });

  it('只有一条讨论消息也算有数据', () => {
    expect(buildReadingRoomBackup({ windows: [window()] as any, messages: [message()] as any }))
      .not.toBeUndefined();
  });
});

describe('共读室备份 · 原版兼容', () => {
  it('原版备份里没有这一块时返回 null（调用方据此跳过，不清空现有数据）', () => {
    // 这是最要紧的一条：原版 SullyOS 导出的备份没有 readingRoom 字段。
    // 返回非 null 会让 importAll 清空七张表，等于导一次原版备份就丢掉所有书。
    expect(parseReadingRoomBackup(undefined)).toBeNull();
    expect(parseReadingRoomBackup(null)).toBeNull();
  });

  it('形状不对也返回 null', () => {
    expect(parseReadingRoomBackup('字符串')).toBeNull();
    expect(parseReadingRoomBackup(123)).toBeNull();
    expect(parseReadingRoomBackup([])).toBeNull();
  });

  it('有这一块但筛完什么都不剩，也返回 null', () => {
    expect(parseReadingRoomBackup({ version: 1, data: { books: [], messages: [] } })).toBeNull();
    // 全是坏行的情况也一样。
    expect(parseReadingRoomBackup({ version: 1, data: { books: [{ title: '没有 id' }] } })).toBeNull();
  });

  it('版本号比当前新时仍然尝试恢复，不整块拒绝', () => {
    const parsed = parseReadingRoomBackup({ version: 99, data: full() });
    expect(parsed?.books).toHaveLength(1);
  });

  it('来回走一趟，数据对得上', () => {
    const payload = buildReadingRoomBackup(full());
    const parsed = parseReadingRoomBackup(payload);
    expect(parsed?.books?.[0].title).toBe('玻璃城堡');
    expect(parsed?.contents?.[0].content).toBe('正文正文');
    expect(parsed?.highlights?.[0].startOffset).toBe(10);
    expect(parsed?.messages?.[0].content).toBe('这段写得好');
    expect(parsed?.selection?.windowId).toBe('rw1');
  });

  it('没有 version 外壳、直接给数据也能读（手工改过的备份）', () => {
    expect(parseReadingRoomBackup(full())?.books).toHaveLength(1);
  });
});

describe('共读室备份 · 坏数据筛除', () => {
  it('没有 id 的书丢掉，别的书照样恢复', () => {
    const parsed = parseReadingRoomBackup({
      data: { books: [book(), { title: '没有 id' }, book({ id: 'b2', title: '长夜难明' })] },
    });
    expect(parsed?.books?.map(item => item.id)).toEqual(['b1', 'b2']);
  });

  it('坏掉的划线区间筛掉', () => {
    // NaN 或者反过来的区间会让「划线和当前页求交」算出离谱结果——
    // 正文里凭空出现一大片底色，或者这一页空掉，而且不报错。
    const parsed = parseReadingRoomBackup({
      data: {
        books: [book()],
        highlights: [
          highlight(),
          highlight({ id: 'bad1', startOffset: 50, endOffset: 50 }),
          highlight({ id: 'bad2', startOffset: 80, endOffset: 30 }),
          highlight({ id: 'bad3', startOffset: -5, endOffset: 10 }),
          highlight({ id: 'bad4', startOffset: Number.NaN, endOffset: 10 }),
          highlight({ id: 'bad5', startOffset: '10', endOffset: 30 }),
        ],
      },
    });
    expect(parsed?.highlights?.map(item => item.id)).toEqual(['h1']);
  });

  it('划线所属的书不在了就丢掉', () => {
    const parsed = parseReadingRoomBackup({
      data: { books: [book()], highlights: [highlight(), highlight({ id: 'h2', bookId: '不存在' })] },
    });
    expect(parsed?.highlights?.map(item => item.id)).toEqual(['h1']);
  });

  it('孤儿正文和孤儿进度丢掉', () => {
    const parsed = parseReadingRoomBackup({
      data: {
        books: [book()],
        contents: [{ bookId: 'b1', content: 'ok' }, { bookId: '野的', content: 'x' }],
        progress: [{ bookId: 'b1', offset: 1, updatedAt: 1 }, { bookId: '野的', offset: 1, updatedAt: 1 }],
      },
    });
    expect(parsed?.contents?.map(item => item.bookId)).toEqual(['b1']);
    expect(parsed?.progress?.map(item => item.bookId)).toEqual(['b1']);
  });

  it('消息挂在不存在的窗口上就丢掉', () => {
    // 孤儿消息比没有更糟：占着库但任何界面都读不到（消息只按 windowId 取）。
    const parsed = parseReadingRoomBackup({
      data: { windows: [window()], messages: [message(), message({ id: 'rm2', windowId: '野的' })] },
    });
    expect(parsed?.messages?.map(item => item.id)).toEqual(['rm1']);
  });

  it('角色不明的窗口丢掉（窗口只认 charId）', () => {
    const parsed = parseReadingRoomBackup({
      data: { windows: [window(), { id: 'rw2', name: '没有角色' }] },
    });
    expect(parsed?.windows?.map(item => item.id)).toEqual(['rw1']);
  });

  it('role 不是 user / assistant 的消息丢掉', () => {
    const parsed = parseReadingRoomBackup({
      data: {
        windows: [window()],
        messages: [message(), message({ id: 'rm2', role: 'system' }), message({ id: 'rm3', role: 'tool' })],
      },
    });
    expect(parsed?.messages?.map(item => item.id)).toEqual(['rm1']);
  });

  it('当前选择指向不存在的窗口时，只丢掉窗口那一半，角色留着', () => {
    const parsed = parseReadingRoomBackup({
      data: {
        windows: [window()],
        selection: { id: 'current', charId: 'c1', windowId: '野的', updatedAt: 1 },
      },
    });
    expect(parsed?.selection?.charId).toBe('c1');
    expect(parsed?.selection?.windowId).toBeUndefined();
  });

  it('chapters 不是数组时退回空数组，书本身留着', () => {
    // 分页逻辑直接遍历 chapters，给个字符串会在打开书的瞬间抛错。
    const parsed = parseReadingRoomBackup({ data: { books: [book({ chapters: '第一章' })] } });
    expect(parsed?.books?.[0].chapters).toEqual([]);
    expect(parsed?.books?.[0].id).toBe('b1');
  });

  it('坏掉的章节区间单独筛掉，好的留下', () => {
    const parsed = parseReadingRoomBackup({
      data: {
        books: [book({
          chapters: [
            { start: 0, end: 100, title: '好的' },
            { start: 200, end: 100, title: '反的' },
            { start: 0, end: 0, title: '空的' },
            ' 不是对象 ',
          ],
        })],
      },
    });
    expect(parsed?.books?.[0].chapters).toHaveLength(1);
    expect(parsed?.books?.[0].chapters[0].title).toBe('好的');
  });

  it('不是数组的表整个当空的，不影响别的表', () => {
    const parsed = parseReadingRoomBackup({
      data: { books: [book()], highlights: '坏了', messages: { a: 1 } },
    });
    expect(parsed?.books).toHaveLength(1);
    expect(parsed?.highlights).toEqual([]);
    expect(parsed?.messages).toEqual([]);
  });

  it('时间戳缺失时补上，不让窗口排序炸掉', () => {
    const parsed = parseReadingRoomBackup({
      data: { windows: [{ id: 'rw9', charId: 'c1', name: 'x' }] },
    });
    expect(typeof parsed?.windows?.[0].updatedAt).toBe('number');
    expect(Number.isFinite(parsed?.windows?.[0].updatedAt)).toBe(true);
  });

  it('第三期那两个字段跟着备份走', () => {
    const parsed = parseReadingRoomBackup({
      data: {
        windows: [window({ memoryArchivedAt: 999, memoryArchiveSummary: '【11月12日，我和她读了书】' })],
      },
    });
    expect(parsed?.windows?.[0].memoryArchivedAt).toBe(999);
    expect(parsed?.windows?.[0].memoryArchiveSummary).toBe('【11月12日，我和她读了书】');
  });
});