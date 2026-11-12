import { describe, it, expect } from 'vitest';
import {
  archiveSummaryApiHint,
  buildReadingArchivePrompt,
  buildReadingArchiveTranscript,
  isArchiveSummaryApiConfigured,
  readingArchiveFragmentId,
  wrapArchiveSummaryWithDate,
} from '../features/readingRoom/archive';
import {
  markWindowMemoryArchived,
  setWindowArchived,
} from '../features/readingRoom/discussion';
import type {
  ReadingDiscussionMessage,
  ReadingDiscussionWindow,
  ReadingMessageReference,
} from '../features/readingRoom/types';

/**
 * 共读室 · 第三期「写进记忆」的纯逻辑。
 *
 * 真正发请求（`summarizeReadingRoomForMemory`）和真正写记忆宫殿
 * （`importExternalMemoryText`）都不在这里测——那两样要网络和向量库。
 * 这个文件锁住的是**坏了用户很难发现**的几条：
 *
 * - 心象、划线前后文不进总结输入
 * - 一个窗口多本书时书名分得开
 * - 表情标签不以原始指令的样子进总结
 * - 「没配副 LLM」和「请求失败」是两件事
 * - 撤销归档不清掉已经写进记忆的标记
 */

const reference = (patch: Partial<ReadingMessageReference> = {}): ReadingMessageReference => ({
  bookId: 'b1',
  bookTitle: '玻璃城堡',
  chapterTitle: '第三章',
  highlightId: 'h1',
  quote: '他看着窗外，没有回答。',
  ...patch,
});

let seq = 0;
const message = (patch: Partial<ReadingDiscussionMessage> = {}): ReadingDiscussionMessage => {
  seq += 1;
  return {
    id: `rm_${seq}`,
    windowId: 'rw_1',
    role: 'user',
    content: '这段写得真好',
    createdAt: 1_762_900_000_000 + seq * 1_000,
    ...patch,
  };
};

const window = (patch: Partial<ReadingDiscussionWindow> = {}): ReadingDiscussionWindow => ({
  id: 'rw_1',
  charId: 'c1',
  name: '讨论 1',
  createdAt: 1_762_900_000_000,
  updatedAt: 1_762_900_000_000,
  ...patch,
});

describe('共读归档 · 转写给总结模型的内容', () => {
  it('用户和角色的发言按原顺序出现', () => {
    const text = buildReadingArchiveTranscript([
      message({ role: 'user', content: '你怎么看这段' }),
      message({ role: 'assistant', content: '我觉得他在逃' }),
      message({ role: 'user', content: '我也这么想' }),
    ]);
    expect(text.indexOf('你怎么看这段')).toBeLessThan(text.indexOf('我觉得他在逃'));
    expect(text.indexOf('我觉得他在逃')).toBeLessThan(text.indexOf('我也这么想'));
  });

  it('引用卡片把书名、章节、划线原文都带上', () => {
    const text = buildReadingArchiveTranscript([
      message({ reference: reference(), content: '这句有点疼' }),
    ]);
    expect(text).toContain('玻璃城堡');
    expect(text).toContain('第三章');
    expect(text).toContain('他看着窗外，没有回答。');
    expect(text).toContain('这句有点疼');
  });

  it('只划线没说话也保留引用原文', () => {
    const text = buildReadingArchiveTranscript([
      message({ reference: reference(), content: '' }),
    ]);
    expect(text).toContain('他看着窗外，没有回答。');
    expect(text).toContain('没有另外说什么');
  });

  it('一个窗口讨论多本书时，每条引用各自的书名都在', () => {
    const text = buildReadingArchiveTranscript([
      message({ reference: reference({ bookTitle: '玻璃城堡' }), content: 'A' }),
      message({ role: 'assistant', content: '嗯' }),
      message({ reference: reference({ bookId: 'b2', bookTitle: '长夜难明', chapterTitle: '第十章' }), content: 'B' }),
    ]);
    expect(text).toContain('玻璃城堡');
    expect(text).toContain('长夜难明');
    expect(text).toContain('第十章');
  });

  it('心象不进总结输入', () => {
    const text = buildReadingArchiveTranscript([
      message({
        role: 'assistant',
        content: '我也觉得',
        thinkingChain: '她其实在说自己，不要直接点破',
      }),
    ]);
    expect(text).toContain('我也觉得');
    // 心象是角色没说出口的话，当成发言会让总结写出它从没表达过的态度。
    expect(text).not.toContain('不要直接点破');
  });

  it('划线前后文不会凭空出现在转写里', () => {
    // before / after 从第二期起就不进库，归档时也不许重新构造。
    const text = buildReadingArchiveTranscript([
      message({ reference: reference(), content: '这段' }),
    ]);
    expect(text).not.toContain('before');
    expect(text).not.toContain('after');
  });

  it('表情标签转成人话，不是原始指令', () => {
    const text = buildReadingArchiveTranscript([
      message({ role: 'assistant', content: '哈哈[[SEND_EMOJI: 开心]]' }),
    ]);
    expect(text).not.toContain('SEND_EMOJI');
    expect(text).toContain('开心');
  });

  it('没有可用消息时转写是空的（调用方据此报错，不发请求）', () => {
    expect(buildReadingArchiveTranscript([]).trim()).toBe('');
  });

  it('只有空内容的消息也算没东西可总结', () => {
    expect(buildReadingArchiveTranscript([
      message({ content: '   ' }),
      message({ role: 'assistant', content: '' }),
    ]).trim()).toBe('');
  });
});

describe('共读归档 · 总结提示词', () => {
  it('角色名和用户名都是变量', () => {
    const prompt = buildReadingArchivePrompt('尚州', '陆沫久');
    expect(prompt).toContain('尚州');
    expect(prompt).toContain('陆沫久');
    expect(buildReadingArchivePrompt('周绪文', '小久')).toContain('小久');
  });

  it('要求第一人称，不是读书报告', () => {
    const prompt = buildReadingArchivePrompt('尚州', '陆沫久');
    expect(prompt).toContain('第一人称');
    expect(prompt).toContain('我和陆沫久');
  });

  it('禁止编造双方没表达过的东西', () => {
    const prompt = buildReadingArchivePrompt('尚州', '陆沫久');
    expect(prompt).toContain('不许虚构');
    // 不能把书里人物的经历写成真实发生过的事。
    expect(prompt).toContain('书里人物');
  });

  it('禁止系统性词汇和 Markdown', () => {
    const prompt = buildReadingArchivePrompt('尚州', '陆沫久');
    expect(prompt).toContain('Markdown');
    expect(prompt).toContain('共读窗口');
  });

  it('用户名空着也不会出现空洞的称呼', () => {
    expect(buildReadingArchivePrompt('尚州', '  ')).toContain('我和用户');
  });
});

describe('共读归档 · 副 LLM 配置判断', () => {
  it('三样齐了才算配好', () => {
    expect(isArchiveSummaryApiConfigured({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-1',
      model: 'gpt-4o-mini',
    })).toBe(true);
  });

  it('缺任意一样都算没配', () => {
    expect(isArchiveSummaryApiConfigured({ baseUrl: '', apiKey: 'sk-1', model: 'm' })).toBe(false);
    expect(isArchiveSummaryApiConfigured({ baseUrl: 'u', apiKey: '', model: 'm' })).toBe(false);
    expect(isArchiveSummaryApiConfigured({ baseUrl: 'u', apiKey: 'sk-1', model: '' })).toBe(false);
    expect(isArchiveSummaryApiConfigured(null)).toBe(false);
    expect(isArchiveSummaryApiConfigured(undefined)).toBe(false);
  });

  it('全是空白也算没配', () => {
    expect(isArchiveSummaryApiConfigured({ baseUrl: '  ', apiKey: ' ', model: ' ' })).toBe(false);
  });

  it('没配的提示告诉用户去哪里配，并给出手写这条退路', () => {
    expect(archiveSummaryApiHint()).toContain('记忆宫殿');
    expect(archiveSummaryApiHint()).toContain('神经链接');
  });
});

describe('共读归档 · 日期壳', () => {
  it('同一天只写一天', () => {
    const at = new Date(2026, 10, 12, 9, 0, 0).getTime();
    expect(wrapArchiveSummaryWithDate('我和她读了那本书', at, at))
      .toBe('【11月12日，我和她读了那本书】');
  });

  it('跨天写成区间', () => {
    const start = new Date(2026, 10, 5, 23, 0, 0).getTime();
    const end = new Date(2026, 10, 12, 1, 0, 0).getTime();
    expect(wrapArchiveSummaryWithDate('读了两次', start, end))
      .toBe('【11月5日～11月12日，读了两次】');
  });
});

describe('共读归档 · 归档 id', () => {
  it('按窗口固定，同一个窗口两次拿到同一个 id', () => {
    expect(readingArchiveFragmentId('rw_1')).toBe(readingArchiveFragmentId('rw_1'));
    expect(readingArchiveFragmentId('rw_1')).toBe('reading_room_archive_rw_1');
  });

  it('不同窗口不会撞', () => {
    expect(readingArchiveFragmentId('rw_1')).not.toBe(readingArchiveFragmentId('rw_2'));
  });
});

describe('共读归档 · 窗口状态', () => {
  it('写进记忆后记下时间和那段总结', () => {
    const updated = markWindowMemoryArchived(window(), '【11月12日，我和她读了书】', 1_762_999_000_000);
    expect(updated.memoryArchivedAt).toBe(1_762_999_000_000);
    expect(updated.memoryArchiveSummary).toBe('【11月12日，我和她读了书】');
  });

  it('没归档过的窗口写进记忆时顺手归档，已归档的保留原来的归档时间', () => {
    expect(markWindowMemoryArchived(window(), 's', 1_762_999_000_000).archivedAt)
      .toBe(1_762_999_000_000);
    expect(markWindowMemoryArchived(window({ archivedAt: 111 }), 's', 1_762_999_000_000).archivedAt)
      .toBe(111);
  });

  it('撤销归档不清掉已经写进记忆的标记', () => {
    // 记忆写进去就撤不回来。清掉这两个字段只会让界面谎称没写过，
    // 然后在记忆宫殿里重复写出几条很像的记忆。
    const archived = markWindowMemoryArchived(window(), '那段总结', 1_762_999_000_000);
    const reverted = setWindowArchived(archived, false, 1_763_000_000_000);
    expect(reverted.archivedAt).toBeUndefined();
    expect(reverted.memoryArchivedAt).toBe(1_762_999_000_000);
    expect(reverted.memoryArchiveSummary).toBe('那段总结');
  });

  it('普通归档不会凭空标记成写过记忆', () => {
    const archived = setWindowArchived(window(), true);
    expect(archived.memoryArchivedAt).toBeUndefined();
    expect(archived.memoryArchiveSummary).toBeUndefined();
  });

  it('旧窗口只有 archivedAt 时，不算写过记忆', () => {
    // 第二期之前归档过的窗口没有 memoryArchivedAt，别把它们当成已写入。
    expect(window({ archivedAt: 1 }).memoryArchivedAt).toBeUndefined();
  });

  it('写进记忆不碰窗口里的消息预览和名字', () => {
    const base = window({ name: '聊玻璃城堡', lastMessagePreview: '他看着窗外', lastMessageAt: 123 });
    const updated = markWindowMemoryArchived(base, 's');
    expect(updated.name).toBe('聊玻璃城堡');
    expect(updated.lastMessagePreview).toBe('他看着窗外');
    expect(updated.lastMessageAt).toBe(123);
  });
});