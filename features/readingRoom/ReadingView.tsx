import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, List, Minus, Plus, ArrowsHorizontal, ArrowsVertical, Highlighter, Check, Trash, CaretLeft, CaretRight, ChatCircleDots } from '@phosphor-icons/react';
import { chapterIndexAtOffset, pageAtOffset, progressPercent } from './paginate';
import { paginateBlock, pageIndexForOffset, READING_BLOCK_SIZE } from './measure';
import { READING_PARAGRAPH_GAP_EM, splitParagraphs, verticalChapterRange } from './layout';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  describeCaret,
  highlightDisplayText,
  highlightSummary,
  IDLE_HIGHLIGHT_SELECTION,
  isHighlightTruncated,
  normalizeHighlightRange,
  nudgeOffset,
  splitByHighlights,
  type HighlightSelectionState,
} from './highlight';
// sentenceRangeAt 没在这里用：它是「偏移解析完全不准」时的退路
// （长按直接选整句），留在 caret.ts 里备用，有测试锁着。
import { OFFSET_ATTRIBUTE, resolveOffsetAtPoint } from './caret';
import ReadingDiscussionPanel from './ReadingDiscussionPanel';
import type { ReadingBook, ReadingDiscussionMessage, ReadingHighlight, ReadingMessageReference } from './types';
import type { Emoji, EmojiCategory } from '../../types';

/**
 * 沉浸式阅读视图。
 *
 * 上下各有一条固定的留白带（上面放很淡的章节名，下面留空），正文只占中间那块。
 *
 * 左右滑模式：每页**刚好一屏**，用隐藏容器真实测量出这一屏装得下多少字
 * （见 measure.ts）。整页不可滚动——需要上下滚才能看完一页，说明分页错了。
 * 竖滑模式：连续滚动，只渲染当前章前后几章。
 *
 * 唤出菜单的手势按模式分开，避免和翻页手势抢：
 * - 左右滑模式：左右滑翻页，**往下滑**唤菜单
 * - 竖滑模式：上下滚动阅读，**往右滑**唤菜单
 *
 * ## 为什么正文区必须是独立的一层（别把留白改回 padding）
 *
 * 测量的依据是正文区的 `clientHeight`，而 `clientHeight` **包含 padding**。
 * 曾经上下留白是用 padding 写在同一个元素上的，于是量出来的高度比真正能
 * 排字的区域多了上下两条留白，每页多塞进约两行——露在屏幕外，底下那行只剩一半。
 * 现在留白是 flex 的兄弟节点，正文区自己没有纵向 padding，量到的就是真实可排区域。
 *
 * ## 测量容器必须和正文排得一模一样
 *
 * 正文是按段落渲染的（每段之间有间距），所以测量时也要按段落建 DOM，
 * 不能图省事塞一整串纯文本——那样量出的高度偏小，同样会多塞。
 * 两边共用 `textStyle` 和 `READING_PARAGRAPH_GAP_EM`，改一处记得对齐另一处。
 */

export type ReadingFlipMode = 'horizontal' | 'vertical';

export const READING_FONT_SIZES = [16, 18, 20, 22, 24, 26] as const;

interface ReadingViewProps {
  book: ReadingBook;
  content: string;
  initialOffset: number;
  fontSize: number;
  flipMode: ReadingFlipMode;
  /** 这本书已有的划线。全局共用，不分角色。 */
  highlights: ReadingHighlight[];
  /**
   * 当前选的共读对象和窗口。两个都有才说得上话。
   * 任一为空时右侧小把手仍然在，点了给提示（久要的「不能静默失败」）。
   */
  discussionCharName?: string;
  discussionWindowName?: string;
  /** 当前窗口的讨论消息。由 App 负责读库，这里只显示。 */
  discussionMessages: ReadingDiscussionMessage[];
  /** 正在等角色回话。 */
  discussionSending: boolean;
  /** 这一轮的流式增量。 */
  discussionStreaming: string;
  /** 上一轮失败的原因。 */
  discussionError?: string;
  onChangeFontSize: (size: number) => void;
  onChangeFlipMode: (mode: ReadingFlipMode) => void;
  onOffsetChange: (offset: number) => void;
  onCreateHighlight: (range: { startOffset: number; endOffset: number; text: string; color: string }) => void;
  onDeleteHighlight: (highlightId: string) => void;
  /**
   * 发一条讨论消息。
   *
   * `range` 是划线在全文里的位置，App 用它现取前后文（`buildHighlightContext`）。
   * **前后文不经过这里也不进库**，只属于那一轮请求。
   */
  onSendDiscussion: (
    text: string,
    reference?: ReadingMessageReference,
    range?: { startOffset: number; endOffset: number },
  ) => void;
  onStopDiscussion: () => void;
  onDismissDiscussionError: () => void;
  /** 删一条讨论消息。 */
  onDeleteDiscussionMessage: (messageId: string) => void;
  /** 表情库。角色发表情时面板要靠它找到真图。 */
  discussionEmojis: Emoji[];
  discussionEmojiCategories: EmojiCategory[];
  onExit: () => void;
}

/** 滑动多远算一次手势。太小会被手抖触发，太大会觉得滑不动。 */
const SWIPE_THRESHOLD = 45;
/** 翻页动画时长，与下面 inline transition 一致。 */
const FLIP_ANIMATION_MS = 170;

/** 长按多久算「按住」而不是点一下。久反馈太久或太灵敏的话，调这个值。 */
const LONG_PRESS_MS = 400;
/** 长按期间允许的手指漂移。超过就认为用户在滑动，不触发长按。 */
const LONG_PRESS_TOLERANCE = 12;

/** 上下两条固定留白带的高度（px，不含安全区）。正文永远落在它们中间。 */
const TOP_BAND_HEIGHT = 30;
const BOTTOM_BAND_HEIGHT = 26;
/** 正文左右留白。测量容器必须用同一个值，否则每行字数不一样。 */
const SIDE_PADDING = 22;

/**
 * 把 [start, end) 这段正文按段落写进试排容器。
 *
 * 和真实正文的渲染必须一一对应：同样按 `splitParagraphs` 切段、
 * 同样的段间距、同样顶格不缩进。只要两边排得不一样，量出的容量就是错的。
 */
const renderParagraphsInto = (
  host: HTMLElement,
  content: string,
  start: number,
  end: number,
): void => {
  const nodes = splitParagraphs(content, start, end).map((paragraph, index) => {
    const node = document.createElement('p');
    node.textContent = paragraph.text;
    node.style.margin = '0';
    if (index > 0) node.style.marginTop = `${READING_PARAGRAPH_GAP_EM}em`;
    return node;
  });
  host.replaceChildren(...nodes);
};

const ReadingView: React.FC<ReadingViewProps> = ({
  book,
  content,
  initialOffset,
  fontSize,
  flipMode,
  highlights,
  discussionCharName,
  discussionWindowName,
  discussionMessages,
  discussionSending,
  discussionStreaming,
  discussionError,
  onChangeFontSize,
  onChangeFlipMode,
  onOffsetChange,
  onCreateHighlight,
  onDeleteHighlight,
  onSendDiscussion,
  onStopDiscussion,
  onDismissDiscussionError,
  onDeleteDiscussionMessage,
  discussionEmojis,
  discussionEmojiCategories,
  onExit,
}) => {
  /** 当前阅读位置（全文字符偏移）。所有视图状态都由它派生。 */
  const [offset, setOffset] = useState(initialOffset);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [highlightListOpen, setHighlightListOpen] = useState(false);
  const [flipping, setFlipping] = useState<'next' | 'prev' | null>(null);

  /**
   * 划线交互状态。**翻页不会清掉它**——这正是跨页划线的全部依据：
   * 起点记的是全文偏移，和当前显示哪一页无关。
   */
  const [selection, setSelection] = useState<HighlightSelectionState>(IDLE_HIGHLIGHT_SELECTION);
  /**
   * 刚长按到的落点（全文偏移）。
   *
   * 只存偏移，不存预览文字——预览和高亮都由它实时算出来，
   * 微调时才不会出现「高亮走了但文字还是旧的」。
   */
  const [pendingOffset, setPendingOffset] = useState<number | null>(null);
  /** 点到已有划线时弹出的操作条。 */
  const [activeHighlight, setActiveHighlight] = useState<ReadingHighlight | null>(null);
  /** 一次性的提示文字（划线存好了、范围太长被截断之类）。 */
  const [toast, setToast] = useState('');

  /** 讨论面板开着没有。关掉不清引用——引用由下面那个 state 自己留着。 */
  const [discussionOpen, setDiscussionOpen] = useState(false);
  /**
   * 待发送的引用。
   *
   * **放在阅读页而不是面板里**：面板关掉会卸载它自己的 state，
   * 而久要求「引用不能因为打开面板、切半屏全屏而丢失」。
   *
   * 连带记住划线的全文范围（`range`）：发送时 App 要用它现取前后文。
   * **范围本身不进库**，存进消息里的引用只有书名 / 章节 / 划线原文。
   */
  const [pendingQuote, setPendingQuote] = useState<{
    reference: ReadingMessageReference;
    range: { startOffset: number; endOffset: number };
  } | undefined>();
  /** 「收回来改」时要填进面板输入框的草稿。token 保证同一句话改两次都生效。 */
  const [draftSeed, setDraftSeed] = useState<{ text: string; token: number } | undefined>();

  /** 当前块的页起点列表。测量得出，字号或屏幕变化后重算。 */
  const [pageStarts, setPageStarts] = useState<number[]>([]);

  const pageRef = useRef<HTMLDivElement>(null);
  /** 隐藏的测量容器：与正文同样的宽度和排版，用来试排。 */
  const measureRef = useRef<HTMLDivElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const programmaticScrollRef = useRef(false);
  const flipTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  /** 这一次触摸是否已经被长按吃掉。吃掉后抬手不再判翻页。 */
  const longPressFiredRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const chapterIndex = chapterIndexAtOffset(book.chapters, offset);
  const chapter = book.chapters[chapterIndex];
  const percent = progressPercent(book, offset);

  useEffect(() => () => {
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2_200);
  }, []);

  /**
   * 当前块：先用纯计算把章切成固定大小的块，再只对这一块做测量分页。
   * 不直接量整章——「无目录」的书整章可能上百万字，一次量完会卡死。
   */
  const block = useMemo(
    () => pageAtOffset(content, book.chapters, offset, READING_BLOCK_SIZE),
    [book.chapters, content, offset],
  );

  /**
   * 测量分页。必须在布局阶段做（useLayoutEffect），
   * 否则会先闪一帧按旧页边界排的内容。
   *
   * 试排的 DOM 结构必须和真实正文一致（按段落 + 段间距），
   * 否则量出来的容量偏大，多出来的行会露在屏幕外。
   */
  useLayoutEffect(() => {
    if (flipMode !== 'horizontal') return;
    const host = measureRef.current;
    const viewport = pageRef.current;
    if (!host || !viewport) return;

    // 正文区自己没有纵向 padding，所以 clientHeight 就是真实可排高度。
    const limit = viewport.clientHeight;
    if (limit <= 0) return;

    const fits = (start: number, length: number): boolean => {
      renderParagraphsInto(host, content, start, start + length);
      return host.scrollHeight <= limit;
    };
    const starts = paginateBlock(block.start, block.end, fits);
    host.replaceChildren();
    setPageStarts(starts);
  }, [block.start, block.end, content, flipMode, fontSize]);

  const pageIndex = pageIndexForOffset(pageStarts, offset);
  const pageStart = pageStarts[pageIndex] ?? block.start;
  const pageEnd = pageStarts[pageIndex + 1] ?? block.end;
  /** 当前页的段落。和测量时用的是同一个切分函数，排版才对得上。 */
  const pageParagraphs = useMemo(
    () => splitParagraphs(content, pageStart, pageEnd),
    [content, pageEnd, pageStart],
  );

  /**
   * 只取和当前可见范围有交集的划线。
   * 一本书可能有几百条划线，没必要让每个段落都去比对全部。
   */
  const visibleHighlights = useMemo(() => {
    const from = flipMode === 'horizontal' ? pageStart : block.start - READING_BLOCK_SIZE;
    const to = flipMode === 'horizontal' ? pageEnd : block.end + READING_BLOCK_SIZE;
    return highlights.filter(item => item.endOffset > from && item.startOffset < to);
  }, [block.end, block.start, flipMode, highlights, pageEnd, pageStart]);

  const commitOffset = useCallback((next: number) => {
    setOffset(next);
    onOffsetChange(next);
  }, [onOffsetChange]);

  /**
   * 翻页。页内走 pageStarts，跨块/跨章时交给 pageAtOffset 算出相邻块，
   * 块内第一页/最后一页由下一轮测量确定。
   */
  const flipTo = useCallback((direction: 'next' | 'prev') => {
    if (flipping) return;
    let target: number | null = null;
    if (direction === 'next') {
      if (pageIndex + 1 < pageStarts.length) target = pageStarts[pageIndex + 1];
      else if (block.end < content.length) target = block.end; // 下一块（可能是下一章）
    } else if (pageIndex > 0) {
      target = pageStarts[pageIndex - 1];
    } else if (block.start > 0) {
      // 回到上一块。落在它的末尾，下一轮测量会把位置对齐到那一块的最后一页。
      target = block.start - 1;
    }
    if (target === null) return;

    const resolved = target;
    setFlipping(direction);
    flipTimerRef.current = window.setTimeout(() => {
      commitOffset(resolved);
      setFlipping(null);
    }, FLIP_ANIMATION_MS);
  }, [block.end, block.start, commitOffset, content.length, flipping, pageIndex, pageStarts]);

  /**
   * 往上一块翻时落点是「块末尾 - 1」，需要在测量完成后对齐到那一块的最后一页。
   * 判断依据：当前偏移落在最后一页之内但不等于它的起点。
   */
  useEffect(() => {
    if (flipMode !== 'horizontal' || pageStarts.length === 0) return;
    const start = pageStarts[pageIndexForOffset(pageStarts, offset)];
    if (start !== undefined && start !== offset) setOffset(start);
    // 只在测量结果变化时对齐，不把 offset 列进依赖，避免自触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipMode, pageStarts]);

  const goToOffset = useCallback((next: number) => {
    setChaptersOpen(false);
    commitOffset(next);
  }, [commitOffset]);

  // ——— 划线 ———

  /** 取消这一次划线，回到正常阅读。随时可用，不留残留状态。 */
  const cancelSelection = useCallback(() => {
    setSelection(IDLE_HIGHLIGHT_SELECTION);
    setPendingOffset(null);
  }, []);

  /**
   * 长按落点的处理。
   *
   * 先看按到的是不是已有划线——是就弹那条划线的操作条（删除 / 跳转），
   * 不是才进入「定起点 / 定终点」的流程。
   */
  const handleLongPress = useCallback((x: number, y: number) => {
    const point = resolveOffsetAtPoint(x, y);
    if (point === null) return;

    const hit = highlights.find(item => point >= item.startOffset && point < item.endOffset);
    if (hit && selection.mode === 'idle') {
      setActiveHighlight(hit);
      setPendingOffset(null);
      return;
    }
    setPendingOffset(point);
  }, [highlights, selection.mode]);

  /**
   * 微调落点，一次一个字符。
   *
   * 这是给「偏移总是偏同一个方向」准备的：那种情况重选多少次都一样，
   * 只有挪一格才能对上。随机偏差则靠取消重选。
   */
  const nudgePending = useCallback((delta: number) => {
    setPendingOffset(previous => (
      previous === null ? previous : nudgeOffset(previous, delta, content.length)
    ));
  }, [content.length]);

  /** 落点周围的原文，显示在小条上，让用户看清高亮落在哪个字。 */
  const caretPreview = useMemo(
    () => (pendingOffset === null ? null : describeCaret(content, pendingOffset)),
    [content, pendingOffset],
  );

  /** 把刚长按到的位置确定为起点，进入等终点状态。 */
  const confirmStart = useCallback(() => {
    if (pendingOffset === null) return;
    setSelection({ mode: 'selecting-end', startOffset: pendingOffset });
    setPendingOffset(null);
  }, [pendingOffset]);

  /**
   * 把刚长按到的位置确定为终点，存下这条划线。
   *
   * 起点和终点之间的正文由全文偏移直接切出来，**不要求两点在同一页**：
   * 中间隔多少页都是一条记录。
   *
   * 终点是**含**的：用户按在哪个字上，那个字就该被划进去，
   * 所以这里给终点加一，否则最后一个字总是漏掉。
   */
  const confirmEnd = useCallback(() => {
    if (pendingOffset === null || selection.startOffset === null) return;
    const first = selection.startOffset;
    const second = pendingOffset >= first ? pendingOffset + 1 : pendingOffset;
    const range = normalizeHighlightRange(first, second, content.length);
    if (!range) {
      showToast('起点和终点是同一个位置，没有划出内容');
      cancelSelection();
      return;
    }
    onCreateHighlight({
      ...range,
      text: content.slice(range.startOffset, range.endOffset),
      color: DEFAULT_HIGHLIGHT_COLOR,
    });
    showToast(isHighlightTruncated(first, second) ? '划线太长，已截断保存' : '划线已保存');
    cancelSelection();
  }, [cancelSelection, content, onCreateHighlight, pendingOffset, selection.startOffset, showToast]);

  const removeActiveHighlight = useCallback(() => {
    if (!activeHighlight) return;
    onDeleteHighlight(activeHighlight.id);
    setActiveHighlight(null);
    showToast('划线已删除');
  }, [activeHighlight, onDeleteHighlight, showToast]);

  // ——— 讨论 ———

  /** 角色和窗口都选好了才说得上话。 */
  const discussionReady = Boolean(discussionCharName && discussionWindowName);

  /**
   * 打开面板。没选角色或窗口时只给提示，**不静默新建窗口**（久的要求）。
   */
  const openDiscussion = useCallback((): boolean => {
    if (!discussionReady) {
      showToast(discussionCharName ? '还没选讨论窗口，去设置页选一个' : '还没选共读对象，去设置页选一个');
      return false;
    }
    setDiscussionOpen(true);
    return true;
  }, [discussionCharName, discussionReady, showToast]);

  /**
   * 「问角色」：把这条划线挂成待发送的引用，打开面板。
   *
   * **只挂引用，不发送**——久定的流程是她在输入框里补充感想之后再发。
   *
   * 引用里只存书名、章节、划线原文。划线前后那些原文属于请求那一轮
   * （下一包接 API 时用 `buildHighlightContext` 现取），不进这里也不进库。
   */
  const askAboutHighlight = useCallback((highlight: ReadingHighlight) => {
    const chapterTitle = book.chapters[chapterIndexAtOffset(book.chapters, highlight.startOffset)]?.title
      || '未分章';
    if (!openDiscussion()) return;
    setPendingQuote({
      reference: {
        bookId: book.id,
        bookTitle: book.title,
        chapterTitle,
        highlightId: highlight.id,
        quote: highlightDisplayText(highlight.text),
      },
      range: { startOffset: highlight.startOffset, endOffset: highlight.endOffset },
    });
    setActiveHighlight(null);
    setHighlightListOpen(false);
  }, [book.chapters, book.id, book.title, openDiscussion]);

  /**
   * 「收回来改」：删掉库里那条，把正文和引用放回输入区。
   *
   * 引用的范围（取前后文要用）**从划线表里重新找**：消息里只存了
   * highlightId，没存偏移。划线已经被删掉的话就只把正文放回去，
   * 引用不再附带——总比把一条指向空气的引用塞回去好。
   */
  const editMyMessage = useCallback((message: ReadingDiscussionMessage) => {
    onDeleteDiscussionMessage(message.id);
    setDraftSeed({ text: message.content, token: Date.now() });
    const reference = message.reference;
    if (!reference) { setPendingQuote(undefined); return; }
    const highlight = reference.highlightId
      ? highlights.find(item => item.id === reference.highlightId)
      : undefined;
    setPendingQuote(highlight
      ? {
        reference,
        range: { startOffset: highlight.startOffset, endOffset: highlight.endOffset },
      }
      : undefined);
    if (!highlight) showToast('那条划线已经删了，引用没放回来');
  }, [highlights, onDeleteDiscussionMessage, showToast]);

  // ——— 手势 ———
  /**
   * 长按和翻页怎么分开：
   *
   * 按下就起一个 400ms 的定时器，期间手指移动超过 12px 就取消它——
   * 滑动翻页必然带位移，长按必然几乎不动，两者天然互斥。
   * 定时器真的烧到了就记一个标记，抬手时直接忽略翻页判断，
   * 否则「长按完抬手手指稍微歪了一点」会既划线又翻页。
   */
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY };
    longPressFiredRef.current = false;
    clearLongPress();
    // 多指（缩放之类）不参与划线。
    if (event.touches.length > 1) return;
    const { clientX, clientY } = touch;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      handleLongPress(clientX, clientY);
    }, LONG_PRESS_MS);
  }, [clearLongPress, handleLongPress]);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    const origin = touchRef.current;
    if (!origin || longPressTimerRef.current === null) return;
    const touch = event.touches[0];
    if (!touch) return;
    const drifted = Math.abs(touch.clientX - origin.x) > LONG_PRESS_TOLERANCE
      || Math.abs(touch.clientY - origin.y) > LONG_PRESS_TOLERANCE;
    if (drifted) clearLongPress();
  }, [clearLongPress]);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    const origin = touchRef.current;
    touchRef.current = null;
    clearLongPress();
    // 这一下已经被长按吃掉了，不要再翻页。
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (!origin) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - origin.x;
    const deltaY = touch.clientY - origin.y;
    const horizontal = Math.abs(deltaX) > Math.abs(deltaY);

    if (flipMode === 'horizontal') {
      if (horizontal && Math.abs(deltaX) >= SWIPE_THRESHOLD) {
        flipTo(deltaX < 0 ? 'next' : 'prev');
        return;
      }
      // 往下滑唤出菜单（和 CoRead 一致）。往上滑留空，以后可以接别的操作。
      if (!horizontal && deltaY >= SWIPE_THRESHOLD) setMenuOpen(true);
      return;
    }

    // 竖滑模式：上下留给滚动，往右滑唤出菜单。
    if (horizontal && deltaX >= SWIPE_THRESHOLD) setMenuOpen(true);
  }, [clearLongPress, flipMode, flipTo]);

  // ——— 竖滑 ———
  const verticalParagraphs = useMemo(() => {
    if (flipMode !== 'vertical') return [];
    const { first, last } = verticalChapterRange(book.chapters, chapterIndex);
    const from = book.chapters[first]?.start ?? 0;
    const to = book.chapters[last]?.end ?? content.length;
    return splitParagraphs(content, from, to);
  }, [book.chapters, chapterIndex, content, flipMode]);

  useEffect(() => {
    if (flipMode !== 'vertical') return;
    const container = verticalRef.current;
    if (!container) return;
    programmaticScrollRef.current = true;
    let target: HTMLElement | null = null;
    for (const node of container.querySelectorAll<HTMLElement>('[data-offset]')) {
      if (Number(node.dataset.offset) >= offset) { target = node; break; }
    }
    if (target) container.scrollTop = Math.max(0, target.offsetTop - 12);
    const timer = window.setTimeout(() => { programmaticScrollRef.current = false; }, 150);
    return () => window.clearTimeout(timer);
    // offset 变化时不重滚：那通常就是这次滚动自己上报的，会打架。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipMode, verticalParagraphs]);

  const handleVerticalScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const container = verticalRef.current;
    if (!container) return;
    for (const node of container.querySelectorAll<HTMLElement>('[data-offset]')) {
      if (node.offsetTop + node.offsetHeight > container.scrollTop) {
        const top = Number(node.dataset.offset);
        setOffset(top);
        onOffsetChange(top);
        return;
      }
    }
  }, [onOffsetChange]);

  const bumpFontSize = useCallback((step: 1 | -1) => {
    const index = READING_FONT_SIZES.indexOf(fontSize as typeof READING_FONT_SIZES[number]);
    const base = index < 0 ? 1 : index;
    onChangeFontSize(READING_FONT_SIZES[Math.min(READING_FONT_SIZES.length - 1, Math.max(0, base + step))]);
  }, [fontSize, onChangeFontSize]);

  /**
   * 正文与测量容器必须共用这一份样式，否则量出来的页放不进真实页面。
   *
   * 没有 `textIndent`：原来那条首行缩进只对一页的**第一行**生效，
   * 于是上一页没读完的半句话到了新页开头也被缩两格，看着像新段落。
   * 缩进这件事交给段落本身（现在是顶格，不缩）。
   *
   * 也没有 `whiteSpace: pre-wrap`：段落是分开的 `<p>`，换行由段落结构表达，
   * 原文的空行不再照排——那会一次空掉一整行。
   */
  const textStyle: React.CSSProperties = {
    fontSize,
    lineHeight: 1.9,
    fontFamily: '"Noto Serif SC", Georgia, serif',
    color: '#3a3027',
    wordBreak: 'break-word',
  };

  const atBookStart = chapterIndex === 0 && pageIndex === 0 && block.start === 0;
  const atBookEnd = pageEnd >= content.length;

  /**
   * 段落正文：按划线切成若干片段，划过的加底色。
   *
   * 片段用 span 包起来，所以段落内部会有嵌套——`caret.ts` 取偏移那边用
   * TreeWalker 累加文本长度，不依赖「段落里只有一个文本节点」这个假设。
   *
   * 底色用 backgroundColor，**不改行高也不加 padding**：
   * 一旦影响排版高度，分页测量就会跟着变，而测量容器那边没有划线。
   * 落点高亮和起点标记同理，只换颜色，不碰尺寸。
   */
  const renderParagraphBody = (paragraph: { offset: number; text: string }): React.ReactNode => {
    const paragraphEnd = paragraph.offset + paragraph.text.length;
    const marks: Array<{ offset: number; kind: 'caret' | 'anchor' }> = [];
    if (pendingOffset !== null && pendingOffset >= paragraph.offset && pendingOffset < paragraphEnd) {
      marks.push({ offset: pendingOffset, kind: 'caret' });
    }
    // 已确定的起点也标出来，翻回那一页时能看见自己从哪里开始划的。
    if (
      selection.startOffset !== null
      && selection.startOffset >= paragraph.offset
      && selection.startOffset < paragraphEnd
    ) {
      marks.push({ offset: selection.startOffset, kind: 'anchor' });
    }

    const segments = splitByHighlights(
      content,
      paragraph.offset,
      paragraphEnd,
      visibleHighlights,
    );
    if (segments.length === 0) return paragraph.text;
    if (segments.length === 1 && !segments[0].highlight && marks.length === 0) return paragraph.text;

    /** 在一个片段里把落点/起点那一个字再切出来单独上色。 */
    const renderSegment = (segment: { text: string; offset: number; highlight: ReadingHighlight | null }): React.ReactNode => {
      const base: React.CSSProperties = segment.highlight
        ? { backgroundColor: segment.highlight.color, borderRadius: 2 }
        : {};
      const mark = marks.find(item => item.offset >= segment.offset && item.offset < segment.offset + segment.text.length);
      if (!mark) {
        return <span key={segment.offset} style={base}>{segment.text}</span>;
      }
      const cut = mark.offset - segment.offset;
      const markStyle: React.CSSProperties = mark.kind === 'caret'
        ? { backgroundColor: '#C2410C', color: '#FFF7ED', borderRadius: 2 }
        : { backgroundColor: 'rgba(194, 65, 12, 0.3)', borderRadius: 2 };
      return (
        <span key={segment.offset} style={base}>
          {segment.text.slice(0, cut)}
          <span style={markStyle}>{segment.text.slice(cut, cut + 1)}</span>
          {segment.text.slice(cut + 1)}
        </span>
      );
    };

    return segments.map(renderSegment);
  };
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f6ecd9]">
      {/*
        三层竖向结构：顶带 / 正文 / 底带。
        正文那一层是 flex-1 且自身没有纵向 padding，所以它的 clientHeight
        就是真正能排字的高度——测量依赖这一点，别把留白改回 padding。
      */}
      <div
        className="flex h-full w-full flex-col"
        style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
      >
        {/* 顶带：固定高度，放很淡的章节名。正文不会再压到它上面。 */}
        <div
          className="pointer-events-none flex shrink-0 items-end text-[11px] text-stone-400/90"
          style={{ height: TOP_BAND_HEIGHT, paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}
        >
          <span className="line-clamp-1">
            第{chapterIndex + 1}章{chapter?.title && chapter.title !== '全文' ? ` ${chapter.title}` : ''}
          </span>
        </div>

        {flipMode === 'horizontal' ? (
          <div
            ref={pageRef}
            className="min-h-0 flex-1 overflow-hidden"
            style={{ paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* 整页不可滚动：要滚才能读完一页就说明分页错了。 */}
            <div
              style={{
                ...textStyle,
                transform: flipping === 'next' ? 'translateX(-10%)' : flipping === 'prev' ? 'translateX(10%)' : 'translateX(0)',
                opacity: flipping ? 0.2 : 1,
                transition: `transform ${FLIP_ANIMATION_MS}ms ease-out, opacity ${FLIP_ANIMATION_MS}ms ease-out`,
              }}
            >
              {pageParagraphs.map((paragraph, index) => (
                <p
                  key={paragraph.offset}
                  {...{ [OFFSET_ATTRIBUTE]: paragraph.offset }}
                  style={{ margin: 0, marginTop: index > 0 ? `${READING_PARAGRAPH_GAP_EM}em` : 0 }}
                >
                  {renderParagraphBody(paragraph)}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div
            ref={verticalRef}
            onScroll={handleVerticalScroll}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="min-h-0 flex-1 overflow-y-auto no-scrollbar"
            style={{ paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}
          >
            {verticalParagraphs.map((paragraph, index) => (
              <p
                key={paragraph.offset}
                {...{ [OFFSET_ATTRIBUTE]: paragraph.offset }}
                style={{
                  ...textStyle,
                  margin: 0,
                  marginTop: index > 0 ? `${READING_PARAGRAPH_GAP_EM}em` : 0,
                }}
              >
                {renderParagraphBody(paragraph)}
              </p>
            ))}
          </div>
        )}

        {/* 底带：固定高度，故意留空（久说右下角不用放东西）。 */}
        <div className="pointer-events-none shrink-0" style={{ height: BOTTOM_BAND_HEIGHT }} />
      </div>

      {/*
        测量容器：左右留白与正文一致，绝对定位在屏外、不占布局。
        宽度要和正文那一层相同，否则每行能排的字数不一样，量了也白量。
      */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none absolute top-0 -z-10 opacity-0"
        style={{
          ...textStyle,
          left: SIDE_PADDING,
          right: SIDE_PADDING,
          visibility: 'hidden',
        }}
      />
{/* 第一次进来时提示手势，之后不再显示（只在最开头那一页出现）。 */}
      {atBookStart && !menuOpen && selection.mode === 'idle' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(var(--safe-bottom)+7px)] text-center text-[10px] text-stone-400/80">
          {flipMode === 'horizontal' ? '左右滑翻页 · 向下滑唤出菜单 · 长按划线' : '上下滑阅读 · 向右滑唤出菜单 · 长按划线'}
        </div>
      )}

      {/*
        右侧讨论把手。
        做成贴边的小竖条而不是大圆钮：它一直在屏幕上，存在感必须低。
        划线流程进行中（等终点、落点小条）时藏起来，免得和那些操作抢位置。
      */}
      {!discussionOpen && !menuOpen && selection.mode === 'idle' && pendingOffset === null && (
        <button
          onClick={() => openDiscussion()}
          className="absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-xl bg-stone-700/35 py-3 pl-1.5 pr-1 text-stone-50 backdrop-blur-sm transition active:scale-95"
          aria-label="打开讨论"
        >
          <ChatCircleDots size={15} weight="bold" />
          {discussionMessages.length > 0 && (
            <span className="mt-1 block text-[9px] tabular-nums leading-none opacity-80">
              {discussionMessages.length}
            </span>
          )}
        </button>
      )}

      {/*
        等终点时的常驻提示带。
        必须一直看得见：用户可能翻好几页去找终点，中途很容易忘记自己在划线。
      */}
      {selection.mode === 'selecting-end' && (
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-amber-200/95 px-3 shadow-sm"
          style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingBottom: 6 }}
        >
          <Highlighter size={14} weight="bold" className="shrink-0 text-amber-800" />
          <span className="flex-1 text-[11px] leading-tight text-amber-900">
            起点已定，可以翻页 · 再长按一次定终点
          </span>
          <button
            onClick={cancelSelection}
            className="shrink-0 rounded-lg bg-amber-800/85 px-2.5 py-1 text-[11px] text-amber-50 transition active:scale-95"
          >
            取消
          </button>
        </div>
      )}

      {/* 长按落点后的小条：确认这里是起点还是终点，可以先微调。 */}
      {pendingOffset !== null && caretPreview && (
        <div className="absolute inset-0 z-30" onClick={() => setPendingOffset(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[#fbf6ec] px-4 pt-4 shadow-[0_-8px_30px_rgba(0,0,0,0.18)]"
            onClick={event => event.stopPropagation()}
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
          >
            <p className="mb-1.5 text-[11px] text-stone-500">
              {selection.mode === 'selecting-end' ? '终点落在这个字上（这个字会划进去）' : '起点落在这个字上'}
            </p>

            {/* 落点那个字反白显示，和正文里的高亮是同一个位置。 */}
            <p className="mb-3 break-all text-[13px] leading-relaxed text-stone-500">
              {caretPreview.before}
              <span className="rounded bg-orange-700 px-0.5 font-semibold text-orange-50">
                {caretPreview.charAt || '␀'}
              </span>
              {caretPreview.after}
            </p>

            {/* 微调：系统性偏移靠重选解决不了，只能一格一格挪。 */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] text-stone-500">微调</span>
              <button
                onClick={() => nudgePending(-1)}
                className="rounded-lg bg-stone-200/80 px-3 py-1.5 transition active:scale-90"
                aria-label="往前挪一个字"
              >
                <CaretLeft size={14} weight="bold" />
              </button>
              <button
                onClick={() => nudgePending(1)}
                className="rounded-lg bg-stone-200/80 px-3 py-1.5 transition active:scale-90"
                aria-label="往后挪一个字"
              >
                <CaretRight size={14} weight="bold" />
              </button>
              <span className="ml-auto text-[10px] text-stone-400">选不准就取消重按</span>
            </div>

            <div className="flex gap-2">
              {selection.mode === 'selecting-end' ? (
                <button
                  onClick={confirmEnd}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-700 py-2.5 text-sm text-amber-50 transition active:scale-95"
                >
                  <Check size={16} weight="bold" /> 完成划线
                </button>
              ) : (
                <button
                  onClick={confirmStart}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-stone-700 py-2.5 text-sm text-stone-50 transition active:scale-95"
                >
                  <Highlighter size={16} weight="bold" /> 从这里划
                </button>
              )}
              <button
                onClick={() => { setPendingOffset(null); if (selection.mode === 'selecting-end') cancelSelection(); }}
                className="rounded-xl bg-stone-200/80 px-4 py-2.5 text-sm transition active:scale-95"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 长按在已有划线上：删除，或跳到它的位置。 */}
      {activeHighlight && (
        <div className="absolute inset-0 z-30" onClick={() => setActiveHighlight(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[#fbf6ec] px-4 pt-4 shadow-[0_-8px_30px_rgba(0,0,0,0.18)]"
            onClick={event => event.stopPropagation()}
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
          >
            <p className="mb-1 text-[11px] text-stone-500">这条划线</p>
            <p className="mb-3 line-clamp-3 text-[13px] leading-relaxed text-stone-700">
              {highlightSummary(activeHighlight.text, 120)}
            </p>
            {/* 问角色排在最前面：这是划线之后最常做的事。 */}
            <button
              onClick={() => askAboutHighlight(activeHighlight)}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-stone-700 py-2.5 text-sm text-stone-50 transition active:scale-95"
            >
              <ChatCircleDots size={16} weight="bold" />
              {discussionCharName ? `问${discussionCharName}` : '问角色'}
            </button>
            <div className="flex gap-2">
              <button
                onClick={removeActiveHighlight}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-100 py-2.5 text-sm text-red-700 transition active:scale-95"
              >
                <Trash size={16} weight="bold" /> 删除划线
              </button>
              <button
                onClick={() => setActiveHighlight(null)}
                className="rounded-xl bg-stone-200/80 px-4 py-2.5 text-sm transition active:scale-95"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一次性提示。放在底部中间，不挡正文。 */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(var(--safe-bottom)+34px)]">
          <span className="rounded-full bg-stone-800/85 px-3.5 py-1.5 text-[11px] text-stone-50 shadow-lg">
            {toast}
          </span>
        </div>
      )}



      {/* ——— 菜单 ——— */}
      {menuOpen && (
        <div className="absolute inset-0 z-30" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/25" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[#fbf6ec] shadow-[0_-8px_30px_rgba(0,0,0,0.18)]"
            onClick={event => event.stopPropagation()}
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
          >
            <div className="flex items-center gap-3 px-4 pt-4">
              <button
                onClick={onExit}
                className="flex items-center gap-1.5 rounded-xl bg-stone-200/80 px-3 py-2 text-sm transition active:scale-95"
              >
                <ArrowLeft size={16} weight="bold" /> 书架
              </button>
              <button
                onClick={() => { setMenuOpen(false); setChaptersOpen(true); }}
                className="flex items-center gap-1.5 rounded-xl bg-stone-200/80 px-3 py-2 text-sm transition active:scale-95"
              >
                <List size={16} weight="bold" /> 目录
              </button>
              <button
                onClick={() => { setMenuOpen(false); setHighlightListOpen(true); }}
                className="flex items-center gap-1.5 rounded-xl bg-stone-200/80 px-3 py-2 text-sm transition active:scale-95"
              >
                <Highlighter size={16} weight="bold" /> 划线
                {highlights.length > 0 && (
                  <span className="tabular-nums text-[11px] text-stone-500">{highlights.length}</span>
                )}
              </button>
              <span className="ml-auto text-xs tabular-nums text-stone-400">{percent}%</span>
            </div>

            <div className="mt-4 flex items-center gap-3 px-4">
              <span className="w-10 text-xs text-stone-500">字号</span>
              <button
                onClick={() => bumpFontSize(-1)}
                disabled={fontSize <= READING_FONT_SIZES[0]}
                className="rounded-lg bg-stone-200/80 p-2 transition active:scale-90 disabled:opacity-35"
                aria-label="缩小字号"
              >
                <Minus size={16} weight="bold" />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{fontSize}</span>
              <button
                onClick={() => bumpFontSize(1)}
                disabled={fontSize >= READING_FONT_SIZES[READING_FONT_SIZES.length - 1]}
                className="rounded-lg bg-stone-200/80 p-2 transition active:scale-90 disabled:opacity-35"
                aria-label="放大字号"
              >
                <Plus size={16} weight="bold" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 px-4 pb-4">
              <span className="w-10 shrink-0 text-xs text-stone-500">翻页</span>
              <div className="flex flex-1 gap-2">
                <button
                  onClick={() => onChangeFlipMode('horizontal')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm transition active:scale-95 ${flipMode === 'horizontal' ? 'bg-stone-700 text-stone-50' : 'bg-stone-200/80'}`}
                >
                  <ArrowsHorizontal size={16} weight="bold" /> 左右滑
                </button>
                <button
                  onClick={() => onChangeFlipMode('vertical')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm transition active:scale-95 ${flipMode === 'vertical' ? 'bg-stone-700 text-stone-50' : 'bg-stone-200/80'}`}
                >
                  <ArrowsVertical size={16} weight="bold" /> 上下滑
                </button>
              </div>
            </div>
            <p className="px-4 pb-1 text-[10px] leading-relaxed text-stone-400">
              {flipMode === 'horizontal' ? '左右滑翻页，向下滑唤出这个菜单' : '上下滑阅读，向右滑唤出这个菜单'}
            </p>
          </div>
        </div>
      )}

      {/* ——— 目录 ——— */}
      {chaptersOpen && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setChaptersOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative ml-auto flex h-full w-[80%] max-w-sm flex-col bg-[#fbf6ec] shadow-2xl"
            onClick={event => event.stopPropagation()}
            style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
          >
            <div className="border-b border-stone-300 px-4 py-3">
              <p className="truncate text-sm font-semibold">{book.title}</p>
              <p className="text-[11px] text-stone-500">
                {book.chaptersDetected ? `${book.chapters.length} 章 · ${percent}%` : '这本 TXT 没识别出章节'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar">
              {book.chapters.map((item, index) => (
                <button
                  key={`${item.start}_${index}`}
                  onClick={() => goToOffset(item.start)}
                  className={`w-full border-b border-stone-200/70 px-4 py-3 text-left text-sm active:bg-stone-200/60 ${index === chapterIndex ? 'bg-stone-200/80 font-semibold' : ''}`}
                >
                  <span className="line-clamp-1">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ——— 划线列表 ——— */}
      {highlightListOpen && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setHighlightListOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative ml-auto flex h-full w-[86%] max-w-sm flex-col bg-[#fbf6ec] shadow-2xl"
            onClick={event => event.stopPropagation()}
            style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
          >
            <div className="border-b border-stone-300 px-4 py-3">
              <p className="truncate text-sm font-semibold">我的划线</p>
              <p className="text-[11px] text-stone-500">
                {highlights.length > 0 ? `${highlights.length} 条 · 按书里的顺序排` : '还没有划线'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar">
              {highlights.length === 0 ? (
                <p className="px-4 py-6 text-[12px] leading-relaxed text-stone-500">
                  在正文上长按，选「从这里划」，翻页后再长按一次定终点。
                  划线可以跨页，中间隔多少页都算同一条。
                </p>
              ) : highlights.map(item => (
                <div key={item.id} className="border-b border-stone-200/70 px-4 py-3">
                  <button
                    onClick={() => { setHighlightListOpen(false); commitOffset(item.startOffset); }}
                    className="w-full text-left"
                  >
                    <span
                      className="mb-1 inline-block h-1.5 w-7 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <p className="line-clamp-3 text-[13px] leading-relaxed text-stone-700">
                      {highlightSummary(item.text, 120)}
                    </p>
                    <p className="mt-1 text-[10px] text-stone-400">
                      第{chapterIndexAtOffset(book.chapters, item.startOffset) + 1}章 ·
                      {' '}{item.endOffset - item.startOffset} 字
                    </p>
                  </button>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => askAboutHighlight(item)}
                      className="flex items-center gap-1 text-[11px] text-stone-600 transition active:scale-95"
                    >
                      <ChatCircleDots size={12} weight="bold" />
                      {discussionCharName ? `问${discussionCharName}` : '问角色'}
                    </button>
                    <button
                      onClick={() => { onDeleteHighlight(item.id); showToast('划线已删除'); }}
                      className="ml-auto flex items-center gap-1 text-[11px] text-red-600/90 transition active:scale-95"
                    >
                      <Trash size={12} weight="bold" /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 读到最后一页时给个收尾提示，免得以为是卡住了。 */}
      {atBookEnd && !menuOpen && selection.mode === 'idle' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(var(--safe-bottom)+14px)] text-center text-[10px] text-stone-400/80">
          已经是最后一页了
        </div>
      )}

      {/*
        讨论面板。**挂在最外层、绝对定位盖上去**，不是布局里的一块——
        正文那三层 flex 结构一个字节都不受它影响，分页测量照旧。
        别为了「看起来整齐」把它搬进上面那个 flex 容器里。
      */}
      {discussionReady && (
        <ReadingDiscussionPanel
          open={discussionOpen}
          charName={discussionCharName!}
          windowName={discussionWindowName!}
          messages={discussionMessages}
          pendingQuote={pendingQuote?.reference}
          sending={discussionSending}
          streamingText={discussionStreaming}
          errorText={discussionError}
          onClearQuote={() => setPendingQuote(undefined)}
          onSend={(text, reference) => onSendDiscussion(text, reference, pendingQuote?.range)}
          onStop={onStopDiscussion}
          onDismissError={onDismissDiscussionError}
          onDeleteMessage={onDeleteDiscussionMessage}
          onEditMessage={editMyMessage}
          emojis={discussionEmojis}
          emojiCategories={discussionEmojiCategories}
          draftSeed={draftSeed}
          onClose={() => setDiscussionOpen(false)}
        />
      )}
    </div>
  );
};

export default ReadingView;