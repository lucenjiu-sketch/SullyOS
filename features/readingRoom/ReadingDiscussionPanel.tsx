import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowsOutSimple,
  ArrowsInSimple,
  CaretDown,
  PaperPlaneRight,
  PencilSimple,
  Stop,
  Trash,
  WarningCircle,
  X,
  Quotes,
} from '@phosphor-icons/react';
import { highlightSummary } from './highlight';
import { normalizeCollaborationVisibleText, parseCollaborationMarkdown } from '../collaboration/markdown';
import type { CollaborationInlineSpan } from '../collaboration/markdown';
import type { ReadingDiscussionMessage, ReadingMessageReference } from './types';

/**
 * 共读室 · 讨论面板。
 *
 * ## 为什么是独立组件，不写进 ReadingView
 *
 * 阅读页的分页靠测量正文区的真实高度（见 `ReadingView.tsx` 顶部注释）。
 * 把面板做成阅读页布局里的一块，正文宽度就会跟着变，测量容器和正文
 * 不再一致——那正是 `b173df6f` 修过的那个病。
 *
 * 现在面板是**绝对定位盖在上面的一层**，和正文是兄弟节点：
 * 正文的宽度、字号、分页、当前页在面板开合时一个字节都不会变。
 * 久明确要求过「不要挤压原本读书的文字」，这是从结构上保证，不靠小心。
 *
 * ## 事件必须拦在这一层
 *
 * 阅读页在正文上挂了 touchstart / touchmove / touchend（翻页 + 长按划线）。
 * 面板盖在上面，里面的滑动和长按**绝不能冒泡过去**，否则在聊天记录里
 * 往上滑会翻页、按久一点会弹出划线小条。所以根节点上把这三个事件都停住。
 *
 * ## Markdown 复用协同那套解析器
 *
 * 项目里**没有装 Markdown 库**（package.json 里没有 marked / react-markdown），
 * 协同是自己手写的一个小解析器。这里复用它，所以支持到粗体、斜体、
 * 行内代码、链接、列表、引用、代码块、分割线，**没有表格**。
 * 想要表格得先让久同意装依赖。
 */

/** 半屏占多宽。久要的是「盖住右半边」，留一点让她看见底下还是正文。 */
const HALF_WIDTH = '56%';

/** 气泡上长按多久算长按。和阅读页正文那边一致，手感统一。 */
const BUBBLE_LONG_PRESS_MS = 400;
/** 长按期间允许的手指漂移。超过就认为她在滑聊天记录，不弹菜单。 */
const BUBBLE_LONG_PRESS_TOLERANCE = 12;

export interface ReadingDiscussionPanelProps {
  open: boolean;
  /** 角色名，显示在标题上。没选角色时面板不该被打开。 */
  charName: string;
  windowName: string;
  messages: ReadingDiscussionMessage[];
  /**
   * 输入框上方那块引用。
   *
   * 由外面持有（阅读页），**不是面板自己的 state**：面板关掉再打开、
   * 半屏切全屏都不该让它消失。久的要求是「引用内容不能因为打开面板、
   * 切换半屏和全屏而丢失」。
   */
  pendingQuote?: ReadingMessageReference;
  /** 正在等角色回话。这一轮的增量在 `streamingText` 里。 */
  sending: boolean;
  /** 流式增量。空串表示还没开口（显示「正在想」）。 */
  streamingText: string;
  /** 上一轮失败的原因。**失败不删用户消息**，只在底部挂这条提示。 */
  errorText?: string;
  onClearQuote: () => void;
  onSend: (text: string, reference?: ReadingMessageReference) => void;
  onStop: () => void;
  onDismissError: () => void;
  /** 删一条消息（两边都能删；角色那条连心象一起删）。 */
  onDeleteMessage: (messageId: string) => void;
  /**
   * 把自己那条收回输入框重新编辑。
   *
   * 库里那条会被删掉，正文和引用回到输入区——久要的就是这个：
   * 「点编辑的话那条消息就回到输入框，同时对话框里那条消失。」
   */
  onEditMessage: (message: ReadingDiscussionMessage) => void;
  /**
   * 「收回来改」时要填进输入框的草稿。
   *
   * 由外面给：阅读页删掉那条消息、把引用放回待发送区，同时把正文从这里
   * 送进来。**每次都带一个新的 `token`**，面板靠它判断「这是一次新的回填」
   * ——不然同一句话改两次就只生效一次。
   */
  draftSeed?: { text: string; token: number };
  onClose: () => void;
}

/** 历史气泡里的引用卡片。只显示书名 / 章节 / 划线原文，没有前后文。 */
const QuoteCard: React.FC<{
  reference: ReadingMessageReference;
  tone: 'user' | 'assistant';
}> = ({ reference, tone }) => (
  <div
    className={`mb-1.5 rounded-lg border-l-[3px] px-2 py-1.5 ${
      tone === 'user'
        ? 'border-amber-300/80 bg-black/10'
        : 'border-amber-400/70 bg-amber-50/70'
    }`}
  >
    <p className={`mb-0.5 text-[9px] ${tone === 'user' ? 'text-amber-100/90' : 'text-stone-500'}`}>
      《{reference.bookTitle}》· {reference.chapterTitle}
    </p>
    <p className={`line-clamp-3 text-[11px] leading-relaxed ${tone === 'user' ? 'text-amber-50/95' : 'text-stone-600'}`}>
      {highlightSummary(reference.quote, 120)}
    </p>
  </div>
);

const InlineSpans: React.FC<{ spans: CollaborationInlineSpan[] }> = ({ spans }) => (
  <>
    {spans.map((span, index) => {
      const key = `${span.kind}-${index}`;
      if (span.kind === 'bold') return <strong key={key} className="font-semibold">{span.text}</strong>;
      if (span.kind === 'italic') return <em key={key}>{span.text}</em>;
      if (span.kind === 'code') {
        return <code key={key} className="rounded bg-black/8 px-1 py-0.5 font-mono text-[0.92em]">{span.text}</code>;
      }
      if (span.kind === 'link' && span.href && /^(https?:|mailto:)/i.test(span.href)) {
        return (
          <a key={key} href={span.href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
            {span.text}
          </a>
        );
      }
      return <React.Fragment key={key}>{span.text}</React.Fragment>;
    })}
  </>
);

/** 角色回复的 Markdown。用户自己发的话不走这里（她写的就是原文）。 */
const MarkdownView: React.FC<{ content: string }> = ({ content }) => (
  <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-[12px] leading-relaxed">
    {parseCollaborationMarkdown(normalizeCollaborationVisibleText(content)).map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === 'blank') return <div key={key} className="h-2" aria-hidden />;
      if (block.type === 'divider') return <hr key={key} className="my-2.5 border-current/15" />;
      if (block.type === 'code') {
        return (
          <pre key={key} className="my-1.5 max-w-full overflow-x-auto rounded-lg bg-black/7 px-2 py-1.5 font-mono text-[11px] leading-5">
            <code>{block.text}</code>
          </pre>
        );
      }
      if (block.type === 'heading') {
        return (
          <div key={key} role="heading" aria-level={block.level} className="mb-1 mt-0.5 text-[1.08em] font-semibold leading-snug">
            <InlineSpans spans={block.spans} />
          </div>
        );
      }
      if (block.type === 'bullet') {
        return (
          <div key={key} className="flex gap-1.5 pl-0.5">
            <span aria-hidden>•</span><span className="min-w-0"><InlineSpans spans={block.spans} /></span>
          </div>
        );
      }
      if (block.type === 'ordered') {
        return (
          <div key={key} className="flex gap-1.5 pl-0.5">
            <span className="tabular-nums opacity-65">{block.ordinal}.</span>
            <span className="min-w-0"><InlineSpans spans={block.spans} /></span>
          </div>
        );
      }
      if (block.type === 'check') {
        return (
          <div key={key} className="flex gap-1.5 pl-0.5">
            <span aria-hidden className="opacity-75">{block.checked ? '☒' : '☐'}</span>
            <span className="min-w-0"><InlineSpans spans={block.spans} /></span>
          </div>
        );
      }
      if (block.type === 'quote') {
        return (
          <blockquote key={key} className="my-1 border-l-2 border-current/20 pl-2 italic opacity-80">
            <InlineSpans spans={block.spans} />
          </blockquote>
        );
      }
      return <p key={key} className="whitespace-pre-wrap"><InlineSpans spans={block.spans} /></p>;
    })}
  </div>
);

/** 思考链折叠块。默认收起——它是心象，不是说出口的话。 */
const ThinkingBlock: React.FC<{ chain: string }> = ({ chain }) => {
  const [expanded, setExpanded] = useState(false);
  const text = chain.trim();
  if (!text) return null;
  return (
    <div className="mb-1.5 overflow-hidden rounded-lg border border-stone-200 bg-stone-50/90">
      <button
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left active:bg-stone-100"
      >
        <span className="text-[11px]">💭</span>
        <span className="flex-1 text-[9px] font-semibold tracking-wider text-stone-500">心象</span>
        <CaretDown size={11} className={`shrink-0 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto border-t border-stone-200/70 px-2 py-1.5 text-[10px] leading-relaxed whitespace-pre-wrap text-stone-600">
          {text}
        </div>
      )}
    </div>
  );
};

const ReadingDiscussionPanel: React.FC<ReadingDiscussionPanelProps> = ({
  open,
  charName,
  windowName,
  messages,
  pendingQuote,
  sending,
  streamingText,
  errorText,
  onClearQuote,
  onSend,
  onStop,
  onDismissError,
  onDeleteMessage,
  onEditMessage,
  draftSeed,
  onClose,
}) => {
  const [full, setFull] = useState(false);
  const [draft, setDraft] = useState('');
  /** 长按选中的那条消息。null = 没在选。 */
  const [actionMessage, setActionMessage] = useState<ReadingDiscussionMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 气泡长按的计时器和起点。滑动超过容差就取消——免得滑记录时误弹菜单。 */
  const longPressRef = useRef<{ timer: number | null; origin: { x: number; y: number } | null }>({
    timer: null,
    origin: null,
  });

  useEffect(() => () => {
    if (longPressRef.current.timer !== null) window.clearTimeout(longPressRef.current.timer);
  }, []);

  /** 面板一关就把菜单收掉，下次打开不该还浮着上次那个。 */
  useEffect(() => { if (!open) setActionMessage(null); }, [open]);

  /**
   * 「收回来改」时把原文填进输入框。
   *
   * 依赖 `token` 而不是 `text`：同一句话连着改两次，文本没变但 token 变了，
   * 这样第二次也能生效。
   */
  useEffect(() => {
    if (!draftSeed) return;
    setDraft(draftSeed.text);
  }, [draftSeed?.token]);

  /**
   * 滚到底。
   *
   * 流式期间 `streamingText` 每来一段都会触发，所以回复变长时视图会跟着走。
   * 引用变化时也滚一下：输入区变高了，不滚会挡住最后一条。
   */
  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, open, pendingQuote, streamingText, errorText]);

  const canSend = useMemo(
    () => !sending && (Boolean(draft.trim()) || Boolean(pendingQuote)),
    [draft, pendingQuote, sending],
  );

  /**
   * 发送。
   *
   * 允许「只有引用、没写感想」——久说过她可以不写额外感想直接发引用。
   * 发完清掉草稿和引用，引用由外面清（它不是面板的 state）。
   */
  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(draft.trim(), pendingQuote);
    setDraft('');
    onClearQuote();
  }, [canSend, draft, onClearQuote, onSend, pendingQuote]);

  /**
   * 把触摸事件停在面板里。
   *
   * 不能用 preventDefault：那会连带杀掉聊天记录区自己的滚动和输入框聚焦。
   * 只停传播，阅读页那三个 handler 就收不到了。
   */
  const stopTouch = useCallback((event: React.TouchEvent) => {
    event.stopPropagation();
  }, []);

  // ——— 气泡长按 ———
  //
  // 长按弹菜单，滑动超过容差就作罢。聊天记录区本身要能上下滑，
  // 所以不能把长按做成「按下就弹」。

  const clearLongPress = useCallback(() => {
    if (longPressRef.current.timer !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  }, []);

  const handleBubbleTouchStart = useCallback((
    event: React.TouchEvent,
    message: ReadingDiscussionMessage,
  ) => {
    event.stopPropagation();
    clearLongPress();
    if (event.touches.length > 1) return;
    const touch = event.touches[0];
    longPressRef.current.origin = { x: touch.clientX, y: touch.clientY };
    longPressRef.current.timer = window.setTimeout(() => {
      longPressRef.current.timer = null;
      setActionMessage(message);
    }, BUBBLE_LONG_PRESS_MS);
  }, [clearLongPress]);

  const handleBubbleTouchMove = useCallback((event: React.TouchEvent) => {
    event.stopPropagation();
    const origin = longPressRef.current.origin;
    if (!origin || longPressRef.current.timer === null) return;
    const touch = event.touches[0];
    if (!touch) return;
    const drifted = Math.abs(touch.clientX - origin.x) > BUBBLE_LONG_PRESS_TOLERANCE
      || Math.abs(touch.clientY - origin.y) > BUBBLE_LONG_PRESS_TOLERANCE;
    if (drifted) clearLongPress();
  }, [clearLongPress]);

  const handleBubbleTouchEnd = useCallback((event: React.TouchEvent) => {
    event.stopPropagation();
    clearLongPress();
    longPressRef.current.origin = null;
  }, [clearLongPress]);

  return (
    <div
      className="absolute inset-y-0 right-0 z-40 flex flex-col bg-[#fbf6ec] shadow-[-8px_0_30px_rgba(0,0,0,0.18)] transition-[transform,width] duration-200 ease-out"
      style={{
        width: full ? '100%' : HALF_WIDTH,
        transform: open ? 'translateX(0)' : 'translateX(105%)',
        pointerEvents: open ? 'auto' : 'none',
        paddingTop: 'var(--safe-top)',
      }}
      onTouchStart={stopTouch}
      onTouchMove={stopTouch}
      onTouchEnd={stopTouch}
      onClick={event => event.stopPropagation()}
    >
      {/* 标题栏：谁、哪个窗口、半屏/全屏、关闭。 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-stone-800">{charName}</span>
          <span className="block truncate text-[10px] text-stone-400">
            {sending ? '正在回话…' : windowName}
          </span>
        </span>
        <button
          onClick={() => setFull(previous => !previous)}
          className="shrink-0 rounded-lg bg-stone-200/80 p-1.5 transition active:scale-90"
          aria-label={full ? '收回半屏' : '展开全屏'}
        >
          {full ? <ArrowsInSimple size={14} weight="bold" /> : <ArrowsOutSimple size={14} weight="bold" />}
        </button>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg bg-stone-200/80 p-1.5 transition active:scale-90"
          aria-label="关闭讨论"
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      {/* 聊天记录。独立滚动区域。 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-3 py-3">
        {messages.length === 0 && !sending ? (
          <p className="px-1 py-6 text-[11px] leading-relaxed text-stone-400">
            还没有讨论。在正文里长按划线，选「问{charName}」，
            划的那段会出现在下面的输入框上方。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  onTouchStart={event => handleBubbleTouchStart(event, message)}
                  onTouchMove={handleBubbleTouchMove}
                  onTouchEnd={handleBubbleTouchEnd}
                  onTouchCancel={handleBubbleTouchEnd}
                  className={`max-w-[88%] select-none rounded-2xl px-3 py-2 transition ${
                    message.role === 'user'
                      ? 'bg-stone-700 text-stone-50'
                      : 'bg-white text-stone-700 ring-1 ring-stone-200'
                  } ${actionMessage?.id === message.id ? 'ring-2 ring-orange-400' : ''}`}
                >
                  {message.reference && (
                    <QuoteCard reference={message.reference} tone={message.role} />
                  )}
                  {message.thinkingChain && <ThinkingBlock chain={message.thinkingChain} />}
                  {message.content && (
                    message.role === 'assistant'
                      ? <MarkdownView content={message.content} />
                      : <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{message.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* 这一轮正在来的回复。还没开口时显示三个点。 */}
            {sending && (
              <div className="flex justify-start">
                <div className="max-w-[88%] rounded-2xl bg-white px-3 py-2 text-stone-700 ring-1 ring-stone-200">
                  {streamingText
                    ? <MarkdownView content={streamingText} />
                    : (
                      <span className="flex items-center gap-1 py-0.5">
                        {[0, 1, 2].map(index => (
                          <span
                            key={index}
                            className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-400"
                            style={{ animationDelay: `${index * 160}ms` }}
                          />
                        ))}
                      </span>
                    )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/*
        输入区固定在底部。
        `--keyboard-inset` 是项目里统一的键盘避让量（utils/iosStandalone.ts 设的），
        不加这一条键盘弹起来会把输入框压到屏幕外面。
      */}
      <div
        className="shrink-0 border-t border-stone-200 px-3 pt-2.5"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + var(--keyboard-inset, 0px) + 10px)' }}
      >
        {/* 失败提示。用户那条消息还在上面，没有被删掉。 */}
        {errorText && (
          <div className="mb-2 flex items-start gap-1.5 rounded-xl bg-red-50 px-2.5 py-2 ring-1 ring-red-200">
            <WarningCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-red-500" />
            <span className="min-w-0 flex-1 text-[10px] leading-relaxed text-red-700">
              {errorText}
              <span className="mt-0.5 block text-red-500/80">你刚才那条已经存下来了，没有丢。</span>
            </span>
            <button
              onClick={onDismissError}
              className="shrink-0 rounded-md bg-red-100 p-1 transition active:scale-90"
              aria-label="收起这条提示"
            >
              <X size={11} weight="bold" className="text-red-600" />
            </button>
          </div>
        )}

        {/* 待发送的引用，在输入框**上方**。久定的顺序：先引用，再写感想。 */}
        {pendingQuote && (
          <div className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-2.5 py-2 ring-1 ring-amber-200/80">
            <Quotes size={13} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[9px] text-stone-500">
                《{pendingQuote.bookTitle}》· {pendingQuote.chapterTitle}
              </span>
              <span className="mt-0.5 block line-clamp-3 text-[11px] leading-relaxed text-stone-700">
                {highlightSummary(pendingQuote.quote, 140)}
              </span>
            </span>
            <button
              onClick={onClearQuote}
              className="shrink-0 rounded-md bg-amber-200/70 p-1 transition active:scale-90"
              aria-label="去掉这段引用"
            >
              <X size={11} weight="bold" className="text-amber-800" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            rows={2}
            placeholder={pendingQuote ? '写点什么，或者直接发这段引用' : `和${charName}说点什么`}
            className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl bg-white px-2.5 py-2 text-[12px] leading-relaxed text-stone-800 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-orange-400"
          />
          {sending ? (
            <button
              onClick={onStop}
              className="mb-0.5 shrink-0 rounded-xl bg-red-100 p-2.5 text-red-700 transition active:scale-90"
              aria-label="停止生成"
            >
              <Stop size={15} weight="fill" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="mb-0.5 shrink-0 rounded-xl bg-stone-700 p-2.5 text-stone-50 transition active:scale-90 disabled:opacity-35"
              aria-label="发送"
            >
              <PaperPlaneRight size={15} weight="fill" />
            </button>
          )}
        </div>
      </div>

      {/*
        长按某条消息后的操作菜单。
        自己那条可以收回来重编辑；角色那条只能删（它说过的话没法替它改）。
      */}
      {actionMessage && (
        <div className="absolute inset-0 z-50" onClick={() => setActionMessage(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[#fbf6ec] px-3 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.2)]"
            onClick={event => event.stopPropagation()}
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
          >
            <p className="mb-1 text-[10px] text-stone-500">
              {actionMessage.role === 'user' ? '你说的这条' : `${charName}说的这条`}
            </p>
            <p className="mb-3 line-clamp-2 text-[11px] leading-relaxed text-stone-600">
              {actionMessage.content.replace(/\s+/g, ' ').trim()
                || (actionMessage.reference ? `［引用］${actionMessage.reference.quote}` : '（空消息）')}
            </p>

            {actionMessage.role === 'user' && (
              <button
                onClick={() => { onEditMessage(actionMessage); setActionMessage(null); }}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-stone-700 py-2.5 text-[13px] text-stone-50 transition active:scale-95"
              >
                <PencilSimple size={15} weight="bold" /> 收回来改
              </button>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { onDeleteMessage(actionMessage.id); setActionMessage(null); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-100 py-2.5 text-[13px] text-red-700 transition active:scale-95"
              >
                <Trash size={15} weight="bold" />
                {actionMessage.role === 'assistant' && actionMessage.thinkingChain ? '删掉（连心象）' : '删掉这条'}
              </button>
              <button
                onClick={() => setActionMessage(null)}
                className="rounded-xl bg-stone-200/80 px-4 py-2.5 text-[13px] transition active:scale-95"
              >
                取消
              </button>
            </div>

            <p className="mt-2 px-0.5 text-[9px] leading-relaxed text-stone-400">
              删掉之后，下一轮发给{charName}的历史里也不会再有这条。
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingDiscussionPanel;