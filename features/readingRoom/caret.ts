/**
 * 把「手指按在屏幕哪个点」换算成「全文第几个字」。
 *
 * 这是划线功能唯一依赖浏览器排版细节的地方，也是最脆的一环，所以单独成文件。
 *
 * ## 三层兜底，依次尝试
 *
 * 1. `document.caretPositionFromPoint`（标准，Firefox / 新版 Chrome）
 * 2. `document.caretRangeFromPoint`（WebKit / 旧 Chrome 的私有版本）
 * 3. 都没有时，退化成「按下的那个元素整体的起始偏移」——精度掉到段落级，
 *    但不会报错，用户仍然划得出东西（只是边界不如前两种准）。
 *
 * ## 偏移怎么算回全文
 *
 * 正文里每个段落元素都带 `data-offset`，值是这一段第一个字在全文里的位置
 * （由 `splitParagraphs` 给出，有守卫用例锁着它和原文对得上）。
 * 段落内部可能被划线切成多个 `<span>`，所以不能假设只有一层文本节点：
 * 这里用 TreeWalker 把命中点之前的所有文本长度累加起来，**不管嵌套多深**。
 */

/** 正文段落上标记全文起始偏移的属性名。渲染和解析共用这一个常量。 */
export const OFFSET_ATTRIBUTE = 'data-offset';

interface CaretHit {
  node: Node;
  offset: number;
}

/** 两套浏览器接口的差异收敛在这里。 */
const caretFromPoint = (x: number, y: number): CaretHit | null => {
  const target = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    if (typeof target.caretPositionFromPoint === 'function') {
      const position = target.caretPositionFromPoint(x, y);
      if (position?.offsetNode) return { node: position.offsetNode, offset: position.offset };
    }
  } catch {
    // Safari 某些版本在跨 shadow 边界时会抛异常，继续走下一种。
  }
  try {
    if (typeof target.caretRangeFromPoint === 'function') {
      const range = target.caretRangeFromPoint(x, y);
      if (range?.startContainer) return { node: range.startContainer, offset: range.startOffset };
    }
  } catch {
    // 同上，静默退化。
  }
  return null;
};

/** 往上找最近的、带 data-offset 的段落元素。 */
const closestOffsetHost = (node: Node | null): HTMLElement | null => {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.hasAttribute(OFFSET_ATTRIBUTE)) return current;
    current = current.parentNode;
  }
  return null;
};

/**
 * 命中节点在它所属段落里的字符位置。
 *
 * 用 TreeWalker 遍历段落内的所有文本节点，把排在命中点之前的长度加起来。
 * 划线把段落切成多个 span 之后，这个算法照样成立——测试里专门锁了嵌套的情况。
 */
export const offsetWithinHost = (host: HTMLElement, node: Node, nodeOffset: number): number => {
  if (node === host) {
    // 命中的是段落本身（通常是点在段落的空白边缘），按子节点序号折算。
    let total = 0;
    for (let index = 0; index < Math.min(nodeOffset, host.childNodes.length); index += 1) {
      total += host.childNodes[index].textContent?.length ?? 0;
    }
    return total;
  }

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let total = 0;
  let cursor = walker.nextNode();
  while (cursor) {
    if (cursor === node) return total + Math.min(nodeOffset, cursor.textContent?.length ?? 0);
    total += cursor.textContent?.length ?? 0;
    cursor = walker.nextNode();
  }
  // 没找到命中节点（理论上不该发生）：退回段首，不要返回一个瞎猜的位置。
  return 0;
};

/**
 * 解析触摸点对应的全文偏移。
 *
 * 返回 null 表示这个点不在正文上（比如按在页边距、菜单上），调用方应当忽略，
 * 而不是当成段首——那会让用户以为划线划错了位置。
 */
export const resolveOffsetAtPoint = (x: number, y: number): number | null => {
  const hit = caretFromPoint(x, y);
  const host = closestOffsetHost(hit?.node ?? document.elementFromPoint(x, y));
  if (!host) return null;

  const base = Number(host.getAttribute(OFFSET_ATTRIBUTE));
  if (!Number.isFinite(base)) return null;

  // 两套接口都不可用时只能定位到段首，精度掉到段落级但功能还在。
  if (!hit) return base;
  return base + offsetWithinHost(host, hit.node, hit.offset);
};

/**
 * 以 `point` 为中心，把当前这一「句」的范围算出来。
 *
 * 用在偏移解析退化到段落级时：与其让用户按出一个不准的点，不如整句选中。
 * 也用在第一次长按的提示上（让用户看见自己按到了哪句）。
 */
export const sentenceRangeAt = (
  content: string,
  point: number,
): { startOffset: number; endOffset: number } => {
  const breaks = new Set(['。', '！', '？', '；', '\n', '…']);
  let start = Math.max(0, Math.min(point, content.length - 1));
  let end = start;
  while (start > 0 && !breaks.has(content[start - 1])) start -= 1;
  while (end < content.length && !breaks.has(content[end])) end += 1;
  // 把句末标点本身也包进来，读起来才完整。
  if (end < content.length && breaks.has(content[end]) && content[end] !== '\n') end += 1;
  return { startOffset: start, endOffset: Math.max(end, start + 1) };
};