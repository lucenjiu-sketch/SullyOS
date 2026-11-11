/**
 * 按屏幕实际容量分页。
 *
 * 第一版按固定字符数切页是错的：一页 2400 字远超手机一屏能显示的量，
 * 用户必须先上下滚完才能左右翻，等于两种翻页方式混在一起。
 * 正确做法是量出这一屏真正装得下多少字，让每页刚好一屏、完全不用滚动。
 *
 * 这里只放纯逻辑：是否装得下由调用方用真实 DOM 测量后通过 fits 回调告知，
 * 所以这套分页可以在没有浏览器的环境里单测。
 */

/**
 * 预分块的目标大小。
 *
 * 不直接对整章做测量分页：一本「无目录」的书整章可能上百万字，
 * 一次量出几千页会把页面卡死。所以先按字符数把章切成块（这一步是纯计算、
 * 确定性的，复用 paginate.ts 的 pageAtOffset），再只对当前块做测量分页。
 * 块是内部概念，用户看不到，但它保证了：
 * 同一块 + 同一字号 + 同一屏幕 → 永远得到同样的页边界，前后翻页不会错位。
 */
export const READING_BLOCK_SIZE = 3_000;

/** 二分时的下限：至少放一个字，否则空页会导致死循环。 */
const MIN_PAGE_CHARS = 1;

/**
 * 在 [blockStart, blockEnd) 内找出每一页的起始偏移。
 *
 * fits(start, length) 必须回答「从 start 取 length 个字符，排版后放得下一屏吗」。
 * 返回的数组首项总是 blockStart；页的结束位置是下一项，最后一页到 blockEnd。
 */
export const paginateBlock = (
  blockStart: number,
  blockEnd: number,
  fits: (start: number, length: number) => boolean,
): number[] => {
  if (blockEnd <= blockStart) return [blockStart];
  const starts = [blockStart];
  let cursor = blockStart;
  // 块大小有上限，所以这个循环的轮数是有界的；break 只用于防御测量函数异常。
  while (cursor < blockEnd) {
    const length = fitLength(cursor, blockEnd - cursor, fits);
    const next = cursor + length;
    if (next <= cursor) break;
    cursor = next;
    if (cursor < blockEnd) starts.push(cursor);
  }
  return starts;
};

/**
 * 二分出从 start 开始最多能放多少字符。
 * 找到长度后再往回退到一个合适的断点，避免把一行词句切得太难看。
 */
export const fitLength = (
  start: number,
  available: number,
  fits: (start: number, length: number) => boolean,
): number => {
  if (available <= MIN_PAGE_CHARS) return Math.max(MIN_PAGE_CHARS, available);
  // 整段都放得下（章末那一页通常如此）就不必二分。
  if (fits(start, available)) return available;

  let low = MIN_PAGE_CHARS;
  let high = available;
  let best = MIN_PAGE_CHARS;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (fits(start, middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
};

/**
 * 当前页在页起点列表里的下标。
 * 找不到精确匹配时返回它所属的那一页，这样从任意偏移恢复阅读都能对上。
 */
export const pageIndexForOffset = (pageStarts: number[], offset: number): number => {
  for (let index = pageStarts.length - 1; index >= 0; index -= 1) {
    if (offset >= pageStarts[index]) return index;
  }
  return 0;
};