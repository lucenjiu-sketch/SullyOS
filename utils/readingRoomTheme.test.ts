import { describe, it, expect } from 'vitest';
import {
  READING_THEMES,
  resolveReadingTheme,
  resolveReadingThemeMode,
  type ReadingTheme,
} from '../features/readingRoom/theme';
import { READING_FONT_SIZES } from '../features/readingRoom/ReadingView';

/*
 * 这个文件守的是夜间模式最容易出的那种错：**漏一个键**。
 *
 * 两套主题都是宽松的字符串字典，漏键 TypeScript 抓不到（接口要求必填，
 * 但如果以后有人用 Partial 或类型断言绕过去就没人管了），构建也不报错。
 * 表现是夜间模式下某块地方 `backgroundColor: undefined`，颜色直接不生效——
 * 只有真机点开那个弹窗才看得见。所以用测试盯着。
 */

describe('共读室 · 日夜主题', () => {
  const dayKeys = Object.keys(READING_THEMES.day).sort();
  const nightKeys = Object.keys(READING_THEMES.night).sort();

  it('两套主题的键完全一致，一个不多一个不少', () => {
    expect(nightKeys).toEqual(dayKeys);
  });

  it('每个键都有非空的值，不会出现 undefined 塞进 style', () => {
    (Object.keys(READING_THEMES) as Array<keyof typeof READING_THEMES>).forEach(mode => {
      const theme = READING_THEMES[mode];
      (Object.keys(theme) as Array<keyof ReadingTheme>).forEach(key => {
        const value = theme[key];
        expect(typeof value, `${mode}.${String(key)} 应该是字符串`).toBe('string');
        expect(value.trim().length, `${mode}.${String(key)} 不能是空串`).toBeGreaterThan(0);
      });
    });
  });

  it('日间和夜间的底色真的不一样（不是复制粘贴忘了改）', () => {
    expect(READING_THEMES.night.pageBg).not.toBe(READING_THEMES.day.pageBg);
    expect(READING_THEMES.night.bodyInk).not.toBe(READING_THEMES.day.bodyInk);
    expect(READING_THEMES.night.sheetBg).not.toBe(READING_THEMES.day.sheetBg);
    expect(READING_THEMES.night.bubbleBg).not.toBe(READING_THEMES.day.bubbleBg);
  });

  it('日间那套没被动过：底色和正文色还是久验收过的值', () => {
    expect(READING_THEMES.day.pageBg).toBe('#f6ecd9');
    expect(READING_THEMES.day.bodyInk).toBe('#3a3027');
    expect(READING_THEMES.day.sheetBg).toBe('#fbf6ec');
  });

  it('resolveReadingTheme 认 night，其它一切退回日间', () => {
    expect(resolveReadingTheme('night')).toBe(READING_THEMES.night);
    expect(resolveReadingTheme('day')).toBe(READING_THEMES.day);
    // localStorage 被手改、或者以后删掉某个模式，都不该让界面空掉。
    expect(resolveReadingTheme('')).toBe(READING_THEMES.day);
    expect(resolveReadingTheme(null)).toBe(READING_THEMES.day);
    expect(resolveReadingTheme(undefined)).toBe(READING_THEMES.day);
    expect(resolveReadingTheme('sepia')).toBe(READING_THEMES.day);
  });

  it('resolveReadingThemeMode 归一出来的值一定是合法模式', () => {
    expect(resolveReadingThemeMode('night')).toBe('night');
    expect(resolveReadingThemeMode('day')).toBe('day');
    expect(resolveReadingThemeMode(null)).toBe('day');
    expect(resolveReadingThemeMode('NIGHT')).toBe('day');
  });
});

describe('共读室 · 字号档位', () => {
  it('最小字号下探到 13（久要求 16 还是偏大）', () => {
    expect(READING_FONT_SIZES[0]).toBe(13);
  });

  it('档位严格递增，没有重复值', () => {
    const sizes = [...READING_FONT_SIZES];
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  /*
   * 小字区间 1px 一档、大字 2px 一档是刻意的：13–18 每一级观感差别明显，
   * 20 以上再细分就只是档位变多。这条断言是为了防止以后有人「顺手统一步长」。
   */
  it('18 及以下每档差 1px，20 以上每档差 2px', () => {
    const sizes = [...READING_FONT_SIZES];
    sizes.slice(1).forEach((size, index) => {
      const step = size - sizes[index];
      expect(step, `${sizes[index]} → ${size} 的步长`).toBe(size <= 18 ? 1 : 2);
    });
  });

  /*
   * 默认值 20 必须在档位里：`ReadingRoomApp` 读 localStorage 时会校验
   * 存的值在不在这个数组里，不在就退回 20。要是 20 自己也不在数组里，
   * 「缩小一档」的下标计算会从一个不存在的位置起步。
   */
  it('默认字号 20 在档位里', () => {
    expect(READING_FONT_SIZES).toContain(20);
  });
});