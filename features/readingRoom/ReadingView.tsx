import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, List, Minus, Plus, ArrowsHorizontal, ArrowsVertical } from '@phosphor-icons/react';
import {
  pageAtOffset,
  nextPage,
  previousPage,
  progressPercent,
  type ReadingPage,
} from './paginate';
import { splitParagraphs, verticalChapterRange } from './layout';
import type { ReadingBook } from './types';

/**
 * 沉浸式阅读视图。
 *
 * 没有常驻顶栏：屏幕上只有正文和左上角一行很小的章节名。
 * 点屏幕中间那一块才弹出菜单（返回 / 目录 / 字号 / 翻页方式）。
 *
 * 两种翻页方式：
 * - 横翻：手指左右滑动整页翻。一章读完底部留白，再翻一页进下一章。
 * - 竖滑：连续滚动，只渲染当前章前后几章，长篇不会把 DOM 撑爆。
 */

export type ReadingFlipMode = 'horizontal' | 'vertical';

export const READING_FONT_SIZES = [16, 18, 20, 22, 24, 26] as const;

interface ReadingViewProps {
  book: ReadingBook;
  content: string;
  /** 打开时的阅读位置（字符偏移）。 */
  initialOffset: number;
  fontSize: number;
  flipMode: ReadingFlipMode;
  onChangeFontSize: (size: number) => void;
  onChangeFlipMode: (mode: ReadingFlipMode) => void;
  /** 位置变化时回调，由上层落库。 */
  onOffsetChange: (offset: number) => void;
  onExit: () => void;
}

/** 滑动多远才算一次翻页。太小会让轻微的手抖翻页，太大会觉得滑不动。 */
const SWIPE_THRESHOLD = 48;
/** 纵向位移超过这个值就认为用户想滚动或选字，放弃本次翻页。 */
const SWIPE_VERTICAL_TOLERANCE = 70;
/** 翻页动画时长，和下面 inline transition 保持一致。 */
const FLIP_ANIMATION_MS = 180;

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
  const [page, setPage] = useState<ReadingPage>(() => pageAtOffset(content, book.chapters, initialOffset));
  const [menuOpen, setMenuOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  /** 翻页动画方向：'next' 向左推出，'prev' 向右推出，null 表示静止。 */
  const [flipping, setFlipping] = useState<'next' | 'prev' | null>(null);

  const horizontalRef = useRef<HTMLDivElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  /** 竖滑模式下由程序触发的滚动，不该被当成用户移动了阅读位置。 */
  const programmaticScrollRef = useRef(false);
  const flipTimerRef = useRef<number | null>(null);

  const chapter = book.chapters[page.chapterIndex];
  const percent = progressPercent(book, page.start);

  useEffect(() => () => {
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
  }, []);

  // 换字号后页边界会变，位置要按当前偏移重新对齐，不能停在旧边界上。
  useEffect(() => {
    setPage(current => pageAtOffset(content, book.chapters, current.start));
  }, [book.chapters, content, fontSize]);

  const goToOffset = useCallback((offset: number) => {
    const target = pageAtOffset(content, book.chapters, offset);
    setPage(target);
    onOffsetChange(target.start);
  }, [book.chapters, content, onOffsetChange]);

  const flipTo = useCallback((direction: 'next' | 'prev') => {
    const target = direction === 'next'
      ? nextPage(content, book.chapters, page)
      : previousPage(content, book.chapters, page);
    if (!target) return;
    setFlipping(direction);
    // 动画放完再换内容，否则会闪一下旧文字。
    flipTimerRef.current = window.setTimeout(() => {
      setPage(target);
      onOffsetChange(target.start);
      setFlipping(null);
      horizontalRef.current?.scrollTo({ top: 0 });
    }, FLIP_ANIMATION_MS);
  }, [book.chapters, content, onOffsetChange, page]);

  // ——— 横翻手势 ———
  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    const origin = touchRef.current;
    touchRef.current = null;
    if (!origin || flipping) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - origin.x;
    const deltaY = touch.clientY - origin.y;

    // 纵向动得比横向多：用户在滚动或选字，不翻页。
    if (Math.abs(deltaY) > SWIPE_VERTICAL_TOLERANCE && Math.abs(deltaY) > Math.abs(deltaX)) return;

    if (Math.abs(deltaX) >= SWIPE_THRESHOLD) {
      flipTo(deltaX < 0 ? 'next' : 'prev');
      return;
    }

    // 几乎没动：当成点击。只有点在屏幕中央那块才弹菜单；
    // 两侧和上下边缘不做事，避免阅读时误触。
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratioX = (touch.clientX - bounds.left) / Math.max(1, bounds.width);
    const ratioY = (touch.clientY - bounds.top) / Math.max(1, bounds.height);
    if (ratioX > 0.3 && ratioX < 0.7 && ratioY > 0.15 && ratioY < 0.85) setMenuOpen(true);
  }, [flipTo, flipping]);

  // ——— 竖滑 ———
  const verticalParagraphs = useMemo(() => {
    if (flipMode !== 'vertical') return [];
    const { first, last } = verticalChapterRange(book.chapters, page.chapterIndex);
    const from = book.chapters[first]?.start ?? 0;
    const to = book.chapters[last]?.end ?? content.length;
    return splitParagraphs(content, from, to);
  }, [book.chapters, content, flipMode, page.chapterIndex]);

  /** 进入竖滑、或渲染窗口换了章时，滚到当前阅读位置。 */
  useEffect(() => {
    if (flipMode !== 'vertical') return;
    const container = verticalRef.current;
    if (!container) return;
    programmaticScrollRef.current = true;
    const nodes = container.querySelectorAll<HTMLElement>('[data-offset]');
    let target: HTMLElement | null = null;
    for (const node of nodes) {
      if (Number(node.dataset.offset) >= page.start) { target = node; break; }
    }
    if (target) container.scrollTop = Math.max(0, target.offsetTop - 12);
    const timer = window.setTimeout(() => { programmaticScrollRef.current = false; }, 150);
    return () => window.clearTimeout(timer);
    // page.start 变化时不重滚：那多半就是这次滚动本身上报的，会打架。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipMode, verticalParagraphs]);

  const handleVerticalScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const container = verticalRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>('[data-offset]');
    let topOffset: number | null = null;
    for (const node of nodes) {
      if (node.offsetTop + node.offsetHeight > container.scrollTop) {
        topOffset = Number(node.dataset.offset);
        break;
      }
    }
    if (topOffset === null) return;
    const aligned = pageAtOffset(content, book.chapters, topOffset);
    // 只在跨章时重设 page（会换渲染窗口）；同章内只上报偏移，避免每次滚动都重排。
    setPage(current => (current.chapterIndex === aligned.chapterIndex ? current : aligned));
    onOffsetChange(topOffset);
  }, [book.chapters, content, onOffsetChange]);

  const pageText = useMemo(() => content.slice(page.start, page.end), [content, page]);

  const bumpFontSize = useCallback((step: 1 | -1) => {
    const index = READING_FONT_SIZES.indexOf(fontSize as typeof READING_FONT_SIZES[number]);
    const base = index < 0 ? 1 : index;
    onChangeFontSize(READING_FONT_SIZES[Math.min(READING_FONT_SIZES.length - 1, Math.max(0, base + step))]);
  }, [fontSize, onChangeFontSize]);

  const textStyle: React.CSSProperties = {
    fontSize,
    lineHeight: 1.95,
    fontFamily: '"Noto Serif SC", Georgia, serif',
    color: '#3a3027',
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f6ecd9]">
      {/* 唯一的常驻信息：左上角一行很小很淡的章节名。 */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 z-10 px-6 pb-1 text-[11px] text-stone-400/90"
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <span className="line-clamp-1">
          第{page.chapterIndex + 1}章{chapter?.title && chapter.title !== '全文' ? ` ${chapter.title}` : ''}
        </span>
      </div>

      {flipMode === 'horizontal' ? (
        <div className="h-full w-full" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <div
            ref={horizontalRef}
            className="h-full w-full overflow-y-auto no-scrollbar px-6"
            style={{
              paddingTop: 'calc(var(--safe-top) + 40px)',
              paddingBottom: 'calc(var(--safe-bottom) + 28px)',
              transform: flipping === 'next' ? 'translateX(-12%)' : flipping === 'prev' ? 'translateX(12%)' : 'translateX(0)',
              opacity: flipping ? 0.25 : 1,
              transition: `transform ${FLIP_ANIMATION_MS}ms ease-out, opacity ${FLIP_ANIMATION_MS}ms ease-out`,
            }}
          >
            {/* 整页一个 pre-wrap 块：第二期按字符偏移还原划线时不必跨多个 <p> 做映射。 */}
            <div style={{ ...textStyle, whiteSpace: 'pre-wrap', textIndent: '2em' }}>{pageText}</div>
          </div>
        </div>
      ) : (
        <div
          ref={verticalRef}
          onScroll={handleVerticalScroll}
          onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratioX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
            if (ratioX > 0.3 && ratioX < 0.7) setMenuOpen(true);
          }}
          className="h-full w-full overflow-y-auto no-scrollbar px-6"
          style={{
            paddingTop: 'calc(var(--safe-top) + 40px)',
            paddingBottom: 'calc(var(--safe-bottom) + 40px)',
          }}
        >
          {verticalParagraphs.map(paragraph => (
            <p
              key={paragraph.offset}
              data-offset={paragraph.offset}
              className="mb-4"
              style={{ ...textStyle, textIndent: '2em' }}
            >
              {paragraph.text}
            </p>
          ))}
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
                className="flex items-center gap-1.5 rounded-xl bg-stone-200/80 px-3 py-2 text-sm active:scale-95 transition"
              >
                <ArrowLeft size={16} weight="bold" /> 书架
              </button>
              <button
                onClick={() => { setMenuOpen(false); setChaptersOpen(true); }}
                className="flex items-center gap-1.5 rounded-xl bg-stone-200/80 px-3 py-2 text-sm active:scale-95 transition"
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
                className="rounded-lg bg-stone-200/80 p-2 active:scale-90 transition disabled:opacity-35"
                aria-label="缩小字号"
              >
                <Minus size={16} weight="bold" />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{fontSize}</span>
              <button
                onClick={() => bumpFontSize(1)}
                disabled={fontSize >= READING_FONT_SIZES[READING_FONT_SIZES.length - 1]}
                className="rounded-lg bg-stone-200/80 p-2 active:scale-90 transition disabled:opacity-35"
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
                  onClick={() => { setChaptersOpen(false); goToOffset(item.start); }}
                  className={`w-full border-b border-stone-200/70 px-4 py-3 text-left text-sm active:bg-stone-200/60 ${index === page.chapterIndex ? 'bg-stone-200/80 font-semibold' : ''}`}
                >
                  <span className="line-clamp-1">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingView;