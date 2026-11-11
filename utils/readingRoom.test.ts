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
import {
  coverPalette,
  coverTitleLines,
  splitParagraphs,
  verticalChapterRange,
} from '../features/readingRoom/layout';
import {
  fitLength,
  pageIndexForOffset,
  paginateBlock,
} from '../features/readingRoom/measure';

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

describe('共读室 · 排版与书封', () => {
  it('段落偏移指向正文第一个字，不落在缩进空白上', () => {
    const content = '第一章\n\n    他推开门。\n\n外面在下雨。';
    const paragraphs = splitParagraphs(content, 0, content.length);
    expect(paragraphs.map(item => item.text)).toEqual(['第一章', '他推开门。', '外面在下雨。']);
    // 用偏移直接去原文取字，必须对得上——竖滑进度和第二期划线都依赖这一点。
    paragraphs.forEach(item => {
      expect(content.slice(item.offset, item.offset + item.text.length)).toBe(item.text);
    });
  });

  it('只切指定区间，不把别的章节带进来', () => {
    const content = '甲甲甲\n乙乙乙\n丙丙丙';
    const paragraphs = splitParagraphs(content, 4, 8);
    expect(paragraphs.map(item => item.text)).toEqual(['乙乙乙']);
  });

  it('同一本书的封面配色每次都一样', () => {
    expect(coverPalette('book_abc')).toEqual(coverPalette('book_abc'));
    expect(coverPalette('book_abc').from).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('过长的书名在封面上截断', () => {
    expect(coverTitleLines('短名')).toBe('短名');
    expect(coverTitleLines('一二三四五六七八九十', 4)).toBe('一二三四…');
  });

  it('竖滑渲染窗口夹在章节范围内，不越界', () => {
    const chapters = Array.from({ length: 10 }, (_, index) => ({
      start: index * 10, end: index * 10 + 10, title: `${index}`,
    }));
    expect(verticalChapterRange(chapters, 0)).toEqual({ first: 0, last: 2 });
    expect(verticalChapterRange(chapters, 5)).toEqual({ first: 3, last: 7 });
    expect(verticalChapterRange(chapters, 9)).toEqual({ first: 7, last: 9 });
  });
});

describe('共读室 · 按屏幕容量分页', () => {
  /**
   * 模拟一块屏幕：每行 capacityPerLine 个字，共 lines 行。
   * 真实环境里这个判断由浏览器排版给出，这里只要行为一致就能验证分页逻辑。
   */
  const screenFits = (capacity: number) => (_start: number, length: number) => length <= capacity;

  it('每页都放得下，且不会白白浪费空间', () => {
    const fits = screenFits(40);
    const starts = paginateBlock(0, 200, fits);
    starts.forEach((start, index) => {
      const end = starts[index + 1] ?? 200;
      const length = end - start;
      expect(fits(start, length)).toBe(true);
      // 除最后一页外，再多放一个字就应该放不下——否则是没填满。
      if (index + 1 < starts.length) expect(fits(start, length + 1)).toBe(false);
    });
  });

  it('页区间连续覆盖整块，不重不漏', () => {
    const starts = paginateBlock(100, 340, screenFits(37));
    expect(starts[0]).toBe(100);
    starts.forEach((start, index) => {
      if (index > 0) expect(start).toBeGreaterThan(starts[index - 1]);
    });
    const last = starts[starts.length - 1];
    expect(last).toBeLessThan(340);
  });

  it('整块就能放进一屏时只有一页', () => {
    expect(paginateBlock(0, 30, screenFits(100))).toEqual([0]);
  });

  it('空块也返回一页，不会死循环', () => {
    expect(paginateBlock(50, 50, screenFits(10))).toEqual([50]);
  });

  it('一个字都放不下时仍然前进一个字，避免卡死', () => {
    const starts = paginateBlock(0, 3, () => false);
    expect(starts).toEqual([0, 1, 2]);
  });

  it('二分出的长度就是放得下的最大值', () => {
    expect(fitLength(0, 100, screenFits(37))).toBe(37);
    expect(fitLength(0, 20, screenFits(999))).toBe(20);
  });

  it('同一块两次分页结果一致（来回翻页不会错位）', () => {
    const first = paginateBlock(0, 500, screenFits(43));
    const second = paginateBlock(0, 500, screenFits(43));
    expect(second).toEqual(first);
  });

  it('任意偏移都能定位回它所属的那一页', () => {
    const starts = [0, 40, 85, 130];
    expect(pageIndexForOffset(starts, 0)).toBe(0);
    expect(pageIndexForOffset(starts, 39)).toBe(0);
    expect(pageIndexForOffset(starts, 40)).toBe(1);
    expect(pageIndexForOffset(starts, 120)).toBe(2);
    expect(pageIndexForOffset(starts, 9_999)).toBe(3);
  });

  it('字号变大后页数变多，但每页仍放得下', () => {
    const small = paginateBlock(0, 300, screenFits(50));
    const large = paginateBlock(0, 300, screenFits(25));
    expect(large.length).toBeGreaterThan(small.length);
  });
});