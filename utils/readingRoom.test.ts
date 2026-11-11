import { describe, it, expect } from 'vitest';
import {
  decodeReadingText,
  detectReadingChapters,
  garbledRatio,
  normalizeReadingText,
  parseReadingFile,
  titleFromFileName,
} from '../features/readingRoom/parse';
import {
  chapterIndexAtOffset,
  findPageEnd,
  nextPage,
  pageAtOffset,
  previousPage,
  progressPercent,
} from '../features/readingRoom/paginate';

const utf8 = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/** 手搓一小段 GBK 字节：'中文' = D6 D0 CE C4，在 UTF-8 下是非法序列。 */
const gbkBytes = (): ArrayBuffer => new Uint8Array([
  0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0xb2, 0xe2, 0xca, 0xd4,
]).buffer;

describe('共读室 · TXT 解码', () => {
  it('纯 ASCII / UTF-8 正文按 utf-8 解出且不报乱码', () => {
    const result = decodeReadingText(utf8('第一章 开始\n他推开门。'));
    expect(result.encoding).toBe('utf-8');
    expect(result.suspectGarbled).toBe(false);
    expect(result.text).toContain('他推开门');
  });

  it('带 BOM 的 UTF-8 不会把 BOM 当正文', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('正文')]);
    const result = decodeReadingText(withBom.buffer);
    expect(result.encoding).toBe('utf-8');
    expect(normalizeReadingText(result.text)).toBe('正文');
  });

  it('GBK 正文不会被当成 UTF-8（fatal 解码拦住后改猜 gbk）', () => {
    const result = decodeReadingText(gbkBytes());
    expect(result.encoding).toBe('gbk');
    expect(result.text).toContain('中文');
  });

  it('指定编码时不再自动猜，供「换个编码重读」使用', () => {
    const result = decodeReadingText(gbkBytes(), 'big5');
    expect(result.encoding).toBe('big5');
  });

  it('乱码率能区分正常文本和替换符文本', () => {
    expect(garbledRatio('正常的一段中文')).toBeLessThan(0.01);
    expect(garbledRatio('\ufffd\ufffd\ufffd\ufffd')).toBeGreaterThan(0.9);
  });
});

describe('共读室 · 章节识别', () => {
  it('认出常见的「第N章」目录，区间连续覆盖全文', () => {
    const content = '第一章 启程\n内容一\n第二章 相遇\n内容二\n第三章 别离\n内容三';
    const { chapters, detected } = detectReadingChapters(content);
    expect(detected).toBe(true);
    expect(chapters.map(chapter => chapter.title)).toEqual(['第一章 启程', '第二章 相遇', '第三章 别离']);
    expect(chapters[0].start).toBe(0);
    expect(chapters[chapters.length - 1].end).toBe(content.length);
    chapters.forEach((chapter, index) => {
      if (index > 0) expect(chapter.start).toBe(chapters[index - 1].end);
    });
  });

  it('首个标题之前的内容单独成节，不会被丢掉', () => {
    const content = '书名：某本书\n作者：某人\n第一章 甲\nA\n第二章 乙\nB\n第三章 丙\nC';
    const { chapters } = detectReadingChapters(content);
    expect(chapters[0].title).toBe('开头');
    expect(content.slice(chapters[0].start, chapters[0].end)).toContain('书名');
  });

  it('正文里提到「第三章」的句子不算标题（整行匹配 + 长度上限）', () => {
    const content = '他想起第三章里写过的那句话，于是合上了书本并且长长地叹了一口气。';
    const { detected, chapters } = detectReadingChapters(content);
    expect(detected).toBe(false);
    expect(chapters).toHaveLength(1);
  });

  it('只认出两个标题时宁可整本当一章，避免半真半假的目录', () => {
    const { detected, chapters } = detectReadingChapters('第一章 甲\nA\n第二章 乙\nB');
    expect(detected).toBe(false);
    expect(chapters[0].title).toBe('全文');
  });

  it('序章 / 楔子 / 番外也认', () => {
    const content = '楔子\nA\n第一章 甲\nB\n番外 后来\nC';
    const { chapters, detected } = detectReadingChapters(content);
    expect(detected).toBe(true);
    expect(chapters.map(chapter => chapter.title)).toEqual(['楔子', '第一章 甲', '番外 后来']);
  });
});

describe('共读室 · 文件名与整体解析', () => {
  it('书名取文件名去扩展名', () => {
    expect(titleFromFileName('边城_沈从文.txt')).toBe('边城 沈从文');
    expect(titleFromFileName('.txt')).toBe('未命名');
  });

  it('parseReadingFile 一次给出正文、编码和目录', () => {
    const parsed = parseReadingFile(
      '测试书.txt',
      utf8('第一章 甲\n内容\n第二章 乙\n内容\n第三章 丙\n内容'),
    );
    expect(parsed.title).toBe('测试书');
    expect(parsed.chaptersDetected).toBe(true);
    expect(parsed.chapters).toHaveLength(3);
    expect(parsed.truncated).toBe(false);
  });
});

describe('共读室 · 分页', () => {
  const chapters = [
    { start: 0, end: 100, title: '一' },
    { start: 100, end: 260, title: '二' },
  ];
  const content = 'a'.repeat(100) + 'b'.repeat(160);

  it('定位偏移所在章节', () => {
    expect(chapterIndexAtOffset(chapters, 0)).toBe(0);
    expect(chapterIndexAtOffset(chapters, 99)).toBe(0);
    expect(chapterIndexAtOffset(chapters, 100)).toBe(1);
    expect(chapterIndexAtOffset(chapters, 250)).toBe(1);
  });

  it('一页不跨章：新章从新的一页开始', () => {
    expect(findPageEnd(content, chapters, 0, 500)).toBe(100);
    expect(findPageEnd(content, chapters, 100, 500)).toBe(260);
  });

  it('优先在段落边界断页，不把句子切断', () => {
    const paragraphs = `${'甲'.repeat(90)}\n${'乙'.repeat(90)}\n${'丙'.repeat(90)}`;
    const single = [{ start: 0, end: paragraphs.length, title: '全文' }];
    const end = findPageEnd(paragraphs, single, 0, 100);
    expect(paragraphs[end - 1]).toBe('\n');
  });

  it('翻页来回一致：下一页再上一页回到原处', () => {
    const long = 'x'.repeat(10_000);
    const single = [{ start: 0, end: long.length, title: '全文' }];
    const first = pageAtOffset(long, single, 0);
    const second = nextPage(long, single, first)!;
    expect(second.start).toBe(first.end);
    const back = previousPage(long, single, second)!;
    expect(back.start).toBe(first.start);
    expect(back.end).toBe(first.end);
  });

  it('同一个偏移总是落在同一页，和翻页历史无关', () => {
    const long = 'y'.repeat(20_000);
    const single = [{ start: 0, end: long.length, title: '全文' }];
    let page = pageAtOffset(long, single, 0);
    for (let step = 0; step < 4; step += 1) page = nextPage(long, single, page)!;
    const direct = pageAtOffset(long, single, page.start + 10);
    expect(direct.start).toBe(page.start);
    expect(direct.end).toBe(page.end);
  });

  it('最后一页之后没有下一页，第一页之前没有上一页', () => {
    const last = pageAtOffset(content, chapters, content.length - 1);
    expect(last.end).toBe(content.length);
    expect(nextPage(content, chapters, last)).toBeNull();
    const first = pageAtOffset(content, chapters, 0);
    expect(previousPage(content, chapters, first)).toBeNull();
  });

  it('进度百分比在 0 到 100 之间', () => {
    expect(progressPercent({ charCount: 0 }, 50)).toBe(0);
    expect(progressPercent({ charCount: 200 }, 50)).toBe(25);
    expect(progressPercent({ charCount: 200 }, 999)).toBe(100);
  });
});