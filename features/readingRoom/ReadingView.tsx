import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, List, Minus, Plus, ArrowsHorizontal, ArrowsVertical } from '@phosphor-icons/react';
import { chapterIndexAtOffset, pageAtOffset, progressPercent } from './paginate';
import { paginateBlock, pageIndexForOffset, READING_BLOCK_SIZE } from './measure';
import { READING_PARAGRAPH_GAP_EM, splitParagraphs, verticalChapterRange } from './layout';
import type { ReadingBook } from './types';

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
  onChangeFontSize: (size: number) => void;
  onChangeFlipMode: (mode: ReadingFlipMode) => void;
  onOffsetChange: (offset: number) => void;
  onExit: () => void;
}

/** 滑动多远算一次手势。太小会被手抖触发，太大会觉得滑不动。 */
const SWIPE_THRESHOLD = 45;
/** 翻页动画时长，与下面 inline transition 一致。 */
const FLIP_ANIMATION_MS = 170;

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
  onChangeFontSize,
  onChangeFlipMode,
  onOffsetChange,
  onExit,
}) => {
  /** 当前阅读位置（全文字符偏移）。所有视图状态都由它派生。 */
  const [offset, setOffset] = useState(initialOffset);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [flipping, setFlipping] = useState<'next' | 'prev' | null>(null);

  /** 当前块的页起点列表。测量得出，字号或屏幕变化后重算。 */
  const [pageStarts, setPageStarts] = useState<number[]>([]);

  const pageRef = useRef<HTMLDivElement>(null);
  /** 隐藏的测量容器：与正文同样的宽度和排版，用来试排。 */
  const measureRef = useRef<HTMLDivElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const programmaticScrollRef = useRef(false);
  const flipTimerRef = useRef<number | null>(null);

  const chapterIndex = chapterIndexAtOffset(book.chapters, offset);
  const chapter = book.chapters[chapterIndex];
  const percent = progressPercent(book, offset);

  useEffect(() => () => {
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
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

  // ——— 手势 ———
  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    const origin = touchRef.current;
    touchRef.current = null;
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
  }, [flipMode, flipTo]);

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
                  data-offset={paragraph.offset}
                  style={{ margin: 0, marginTop: index > 0 ? `${READING_PARAGRAPH_GAP_EM}em` : 0 }}
                >
                  {paragraph.text}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div
            ref={verticalRef}
            onScroll={handleVerticalScroll}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="min-h-0 flex-1 overflow-y-auto no-scrollbar"
            style={{ paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}
          >
            {verticalParagraphs.map((paragraph, index) => (
              <p
                key={paragraph.offset}
                data-offset={paragraph.offset}
                style={{
                  ...textStyle,
                  margin: 0,
                  marginTop: index > 0 ? `${READING_PARAGRAPH_GAP_EM}em` : 0,
                }}
              >
                {paragraph.text}
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
      {atBookStart && !menuOpen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(var(--safe-bottom)+7px)] text-center text-[10px] text-stone-400/80">
          {flipMode === 'horizontal' ? '左右滑翻页 · 向下滑唤出菜单' : '上下滑阅读 · 向右滑唤出菜单'}
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

      {/* 读到最后一页时给个收尾提示，免得以为是卡住了。 */}
      {atBookEnd && !menuOpen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(var(--safe-bottom)+14px)] text-center text-[10px] text-stone-400/80">
          已经是最后一页了
        </div>
      )}
    </div>
  );
};

export default ReadingView;