import { describe, it, expect } from 'vitest';
import {
  buildHighlightContext,
  DEFAULT_HIGHLIGHT_COLOR,
  describeCaret,
  highlightDisplayText,
  highlightSliceOnPage,
  highlightSummary,
  isHighlightTruncated,
  MAX_HIGHLIGHT_CHARS,
  normalizeHighlightRange,
  nudgeOffset,
  READING_HIGHLIGHT_COLORS,
  sortHighlightsByPosition,
  splitByHighlights,
} from '../features/readingRoom/highlight';
import { sentenceRangeAt } from '../features/readingRoom/caret';
import type { ReadingHighlight } from '../features/readingRoom/types';

const highlight = (
  startOffset: number,
  endOffset: number,
  id = `h_${startOffset}_${endOffset}`,
): ReadingHighlight => ({
  id,
  bookId: 'book_1',
  startOffset,
  endOffset,
  text: '',
  color: DEFAULT_HIGHLIGHT_COLOR,
  createdAt: 0,
  updatedAt: 0,
});

describe('共读室 · 划线区间', () => {
  it('两次长按不分先后，谁先谁后都能得到同一个区间', () => {
    expect(normalizeHighlightRange(30, 10, 100)).toEqual({ startOffset: 10, endOffset: 30 });
    expect(normalizeHighlightRange(10, 30, 100)).toEqual({ startOffset: 10, endOffset: 30 });
  });

  it('两次按在同一个位置不算划线（否则会存下一条看不见的记录）', () => {
    expect(normalizeHighlightRange(20, 20, 100)).toBeNull();
  });

  it('超出正文长度的位置被夹回边界内', () => {
    expect(normalizeHighlightRange(-50, 9_999, 80)).toEqual({ startOffset: 0, endOffset: 80 });
  });

  it('过长的划线被截断到上限，并且能被识别出截断过', () => {
    const range = normalizeHighlightRange(0, MAX_HIGHLIGHT_CHARS + 500, 1_000_000)!;
    expect(range.endOffset - range.startOffset).toBe(MAX_HIGHLIGHT_CHARS);
    expect(isHighlightTruncated(0, MAX_HIGHLIGHT_CHARS + 500)).toBe(true);
    expect(isHighlightTruncated(0, 100)).toBe(false);
  });
});

describe('共读室 · 划线与页的交集', () => {
  it('一条划线跨三页：每页各露出自己那一截，拼起来等于整条', () => {
    const item = highlight(50, 260);
    const pages: Array<[number, number]> = [[0, 100], [100, 200], [200, 300]];
    const slices = pages.map(([start, end]) => highlightSliceOnPage(item, start, end));
    expect(slices[0]).toEqual({ startOffset: 50, endOffset: 100 });
    expect(slices[1]).toEqual({ startOffset: 100, endOffset: 200 });
    expect(slices[2]).toEqual({ startOffset: 200, endOffset: 260 });
    const covered = slices.reduce(
      (total, slice) => total + (slice ? slice.endOffset - slice.startOffset : 0),
      0,
    );
    expect(covered).toBe(item.endOffset - item.startOffset);
  });

  it('不在这一页的划线返回 null，不会凭空画出底色', () => {
    expect(highlightSliceOnPage(highlight(10, 40), 100, 200)).toBeNull();
    expect(highlightSliceOnPage(highlight(300, 400), 100, 200)).toBeNull();
  });

  it('改字号导致页边界变化后，同一条划线仍然定位在原来那句话上', () => {
    const item = highlight(120, 180);
    // 同一条划线，两套完全不同的分页，覆盖到的字符总数必须一样。
    const coverage = (pages: Array<[number, number]>): number => pages.reduce((total, [start, end]) => {
      const slice = highlightSliceOnPage(item, start, end);
      return total + (slice ? slice.endOffset - slice.startOffset : 0);
    }, 0);
    expect(coverage([[0, 100], [100, 200], [200, 300]])).toBe(60);
    expect(coverage([[0, 137], [137, 251], [251, 300]])).toBe(60);
  });
});

describe('共读室 · 段落按划线切片', () => {
  const content = '甲乙丙丁戊己庚辛壬癸';

  it('切出的片段拼起来必须等于原文那一段，不多不少', () => {
    const segments = splitByHighlights(content, 0, content.length, [highlight(2, 5), highlight(7, 9)]);
    expect(segments.map(segment => segment.text).join('')).toBe(content);
  });

  it('划过的片段带上划线，没划的不带', () => {
    const segments = splitByHighlights(content, 0, content.length, [highlight(2, 5)]);
    expect(segments.map(segment => [segment.text, segment.highlight?.id ?? null])).toEqual([
      ['甲乙', null],
      ['丙丁戊', 'h_2_5'],
      ['己庚辛壬癸', null],
    ]);
  });

  it('每个片段的偏移能直接回原文取到同样的字', () => {
    const segments = splitByHighlights(content, 0, content.length, [highlight(3, 6)]);
    segments.forEach(segment => {
      expect(content.slice(segment.offset, segment.offset + segment.text.length)).toBe(segment.text);
    });
  });

  it('重叠的两条划线不会产生重复文字（靠前那条占住重叠部分）', () => {
    const segments = splitByHighlights(content, 0, content.length, [highlight(1, 6), highlight(4, 8)]);
    expect(segments.map(segment => segment.text).join('')).toBe(content);
    expect(segments.filter(segment => segment.highlight).map(segment => segment.text)).toEqual(['乙丙丁戊己', '庚辛']);
  });

  it('只渲染页内那一段时，页外的划线不参与切分', () => {
    const segments = splitByHighlights(content, 4, 8, [highlight(0, 2), highlight(5, 7)]);
    expect(segments.map(segment => segment.text).join('')).toBe('戊己庚辛');
    expect(segments.filter(segment => segment.highlight).map(segment => segment.text)).toEqual(['己庚']);
  });

  it('没有划线时整段作为一个片段返回', () => {
    const segments = splitByHighlights(content, 0, content.length, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].highlight).toBeNull();
  });

  it('空区间返回空数组，不会产生一个空片段', () => {
    expect(splitByHighlights(content, 5, 5, [])).toEqual([]);
  });
});

describe('共读室 · 划线文本整理', () => {
  it('跨段落的划线在显示时把换行和全角缩进压成空格', () => {
    expect(highlightDisplayText('他推开门。\n\u3000\u3000外面在下雨。')).toBe('他推开门。 外面在下雨。');
  });

  it('摘要超长时截断补省略号', () => {
    expect(highlightSummary('一二三四五六', 4)).toBe('一二三四…');
    expect(highlightSummary('一二三四五六', 60)).toBe('一二三四五六');
  });

  it('发给角色的上下文只取划线前后少量原文，不含全书', () => {
    const content = `${'前'.repeat(1_000)}划线这句${'后'.repeat(1_000)}`;
    const excerpt = buildHighlightContext(content, { startOffset: 1_000, endOffset: 1_004 }, 50);
    expect(excerpt.quote).toBe('划线这句');
    expect(excerpt.before).toBe('前'.repeat(50));
    expect(excerpt.after).toBe('后'.repeat(50));
    // 整本书两千多字符，带出去的只有一百出头。
    expect(excerpt.before.length + excerpt.quote.length + excerpt.after.length).toBeLessThan(200);
  });

  it('书首和书尾的划线取上下文不会越界', () => {
    const content = '开头的话。结尾的话。';
    const head = buildHighlightContext(content, { startOffset: 0, endOffset: 5 }, 100);
    expect(head.before).toBe('');
    const tail = buildHighlightContext(content, { startOffset: 5, endOffset: content.length }, 100);
    expect(tail.after).toBe('');
  });
});

describe('共读室 · 划线列表顺序与配色', () => {
  it('划线按在正文里出现的顺序排，不按创建时间', () => {
    const sorted = sortHighlightsByPosition([highlight(300, 320), highlight(10, 20), highlight(100, 150)]);
    expect(sorted.map(item => item.startOffset)).toEqual([10, 100, 300]);
  });

  it('默认颜色来自可选配色，且都是半透明（压住文字也看得清）', () => {
    expect(READING_HIGHLIGHT_COLORS).toContain(DEFAULT_HIGHLIGHT_COLOR);
    READING_HIGHLIGHT_COLORS.forEach(color => {
      const alpha = Number(color.match(/,\s*([\d.]+)\s*\)$/)?.[1]);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    });
  });
});

describe('共读室 · 落点微调与预览', () => {
  const content = '他推开门。外面在下雨。';

  it('微调一次挪一个字符，正负都行', () => {
    expect(nudgeOffset(5, 1, content.length)).toBe(6);
    expect(nudgeOffset(5, -1, content.length)).toBe(4);
  });

  it('微调不会挪出正文范围', () => {
    expect(nudgeOffset(0, -1, content.length)).toBe(0);
    expect(nudgeOffset(content.length - 1, 1, content.length)).toBe(content.length - 1);
    expect(nudgeOffset(0, -99, content.length)).toBe(0);
  });

  it('空正文时微调不会得到负数', () => {
    expect(nudgeOffset(0, -1, 0)).toBe(0);
    expect(nudgeOffset(0, 1, 0)).toBe(0);
  });

  it('预览给出落点那个字，以及前后各一小段', () => {
    const preview = describeCaret(content, 5, 3);
    expect(preview.charAt).toBe('外');
    expect(preview.before).toBe('开门。');
    expect(preview.after).toBe('面在下');
  });

  it('预览里的落点字和 content 同一个位置对得上（和正文高亮是同一处）', () => {
    for (let offset = 0; offset < content.length; offset += 1) {
      expect(describeCaret(content, offset).charAt).toBe(content[offset]);
    }
  });

  it('换行显示成可见符号，不会让预览看起来断掉', () => {
    const multi = '第一段。\n第二段。';
    expect(describeCaret(multi, 4).charAt).toBe('⏎');
    // 从偏移 5 往前取 5 个字符是「第一段。\n」，换行要显示成空格而不是真的断行。
    expect(describeCaret(multi, 5, 5).before).toBe('第一段。 ');
  });

  it('落在正文末尾之后时 charAt 为空，不报错', () => {
    expect(describeCaret(content, content.length).charAt).toBe('');
  });
});

describe('共读室 · 终点含落点那个字', () => {
  const content = '甲乙丙丁戊';

  it('正向划线时终点那个字被划进去', () => {
    // 用户起点按在「乙」(1)、终点按在「丁」(3)，期望划到「乙丙丁」。
    // 终点加一由 ReadingView 做，这里锁住区间语义本身。
    const range = normalizeHighlightRange(1, 3 + 1, content.length)!;
    expect(content.slice(range.startOffset, range.endOffset)).toBe('乙丙丁');
  });

  it('只按同一个字两次也能划出那一个字', () => {
    const range = normalizeHighlightRange(2, 2 + 1, content.length)!;
    expect(content.slice(range.startOffset, range.endOffset)).toBe('丙');
  });
});
describe('共读室 · 整句范围（偏移解析退化时的兜底）', () => {
  const content = '他推开门。外面在下雨。远处有人在喊。';

  it('按在句子中间时选中整句，含句末标点', () => {
    expect(sentenceRangeAt(content, 2)).toEqual({ startOffset: 0, endOffset: 5 });
    expect(content.slice(0, 5)).toBe('他推开门。');
  });

  it('第二句、第三句同样只选中自己那一句', () => {
    const second = sentenceRangeAt(content, 7);
    expect(content.slice(second.startOffset, second.endOffset)).toBe('外面在下雨。');
    const third = sentenceRangeAt(content, 14);
    expect(content.slice(third.startOffset, third.endOffset)).toBe('远处有人在喊。');
  });

  it('换行是句子边界，但不会被包进选中范围', () => {
    const multi = '第一段。\n第二段。';
    const range = sentenceRangeAt(multi, 6);
    expect(multi.slice(range.startOffset, range.endOffset)).toBe('第二段。');
  });

  it('范围永远非空，越界的位置也不会崩', () => {
    expect(sentenceRangeAt(content, 9_999).endOffset).toBeGreaterThan(sentenceRangeAt(content, 9_999).startOffset);
    expect(sentenceRangeAt('', 0)).toEqual({ startOffset: 0, endOffset: 1 });
  });
});