import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsOutSimple, ArrowsInSimple, PaperPlaneRight, X, Quotes } from '@phosphor-icons/react';
import { highlightSummary } from './highlight';
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
 * ## 这一包不接 AI
 *
 * `onSend` 把消息交给外面落库，角色回复是下一包的事。
 * 面板自己不发请求、不认识 API，**别在这里塞请求组装**。
 */

/** 半屏占多宽。久要的是「盖住右半边」，留一点让她看见底下还是正文。 */
const HALF_WIDTH = '56%';

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
  onClearQuote: () => void;
  onSend: (text: string, reference?: ReadingMessageReference) => void;
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

const ReadingDiscussionPanel: React.FC<ReadingDiscussionPanelProps> = ({
  open,
  charName,
  windowName,
  messages,
  pendingQuote,
  onClearQuote,
  onSend,
  onClose,
}) => {
  const [full, setFull] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  /** 新消息进来就滚到底。引用变化时也滚一下：输入区变高了，不滚会挡住最后一条。 */
  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, open, pendingQuote]);

  const canSend = useMemo(
    () => Boolean(draft.trim()) || Boolean(pendingQuote),
    [draft, pendingQuote],
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

  return (
    <>
      {/*
        面板。用 translateX 滑进滑出，关着的时候 pointer-events-none，
        不挡正文上的长按和翻页。
      */}
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
            <span className="block truncate text-[10px] text-stone-400">{windowName}</span>
          </span>
          <button
            onClick={() => setFull(previous => !previous)}
            className="shrink-0 rounded-lg bg-stone-200/80 p-1.5 transition active:scale-90"
            aria-label={full ? '收回半屏' : '展开全屏'}
          >
            {full
              ? <ArrowsInSimple size={14} weight="bold" />
              : <ArrowsOutSimple size={14} weight="bold" />}
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
          {messages.length === 0 ? (
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
                    className={`max-w-[88%] rounded-2xl px-3 py-2 ${
                      message.role === 'user'
                        ? 'bg-stone-700 text-stone-50'
                        : 'bg-white text-stone-700 ring-1 ring-stone-200'
                    }`}
                  >
                    {message.reference && (
                      <QuoteCard reference={message.reference} tone={message.role} />
                    )}
                    {message.content && (
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{message.content}</p>
                    )}
                  </div>
                </div>
              ))}
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
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="mb-0.5 shrink-0 rounded-xl bg-stone-700 p-2.5 text-stone-50 transition active:scale-90 disabled:opacity-35"
              aria-label="发送"
            >
              <PaperPlaneRight size={15} weight="fill" />
            </button>
          </div>
          <p className="mt-1 text-[9px] text-stone-400">
            角色还不会回话（下一步才接）。这里发的内容已经存下来了。
          </p>
        </div>
      </div>
    </>
  );
};

export default ReadingDiscussionPanel;