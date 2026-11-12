import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, Brain, WarningCircle, X } from '@phosphor-icons/react';
import type { ReadingDiscussionWindow } from './types';

/**
 * 共读室 · 写进记忆前的预览页。
 *
 * ## 为什么是独立组件，不塞进设置页
 *
 * 设置页（`ReadingRoomSettings.tsx`）那边的窗口列表重建会把滚动位置顶回去，
 * 久真机报过（`d0089a76`）。这个预览有「生成中 / 可编辑 / 失败可重试」三种状态，
 * 塞进去就要再碰一遍那条踩过坑的渲染路径。**别搬进去。**
 *
 * ## 它自己不发任何请求
 *
 * 总结和写入都由 App 层做（`memoryPalaceConfig` / `updateCharacter` 在那一层）。
 * 这里只负责显示、让用户改字、把三个动作回调出去。
 *
 * ## 久要的流程
 *
 * 点「写进记忆」→ 转圈总结 → **弹出来给她看一眼** → 她点确认 → 真正写入。
 * 取消等于什么都没发生：不写记忆、不改 `archivedAt`、不改 `memoryArchivedAt`。
 */

export interface ReadingArchiveReviewProps {
  window: ReadingDiscussionWindow;
  characterName: string;
  /** 正在生成总结。生成中不给确认，避免写进一段还没出来的文字。 */
  generating: boolean;
  /** 正在写入记忆宫殿（第二段等待：提取 + 向量化）。 */
  saving: boolean;
  /**
   * 生成出来的总结。`undefined` = 还没有（正在生成，或者生成失败）。
   *
   * 空字符串是有意义的状态：副 LLM 没配时 App 会传 `''`，
   * 让久自己手写一段直接存进神经链接。
   */
  summary?: string;
  /** 这一轮的失败原因。有值时显示红条，原来的文字不清掉。 */
  error?: string;
  /** 没配副 LLM、只能手写的提示。有值时显示一条说明。 */
  manualHint?: string;
  onRegenerate: () => void;
  /** 确认写入。参数是用户最终看到（可能改过）的文字。 */
  onConfirm: (finalSummary: string) => void;
  onCancel: () => void;
}

const ReadingArchiveReview: React.FC<ReadingArchiveReviewProps> = ({
  window: discussionWindow,
  characterName,
  generating,
  saving,
  summary,
  error,
  manualHint,
  onRegenerate,
  onConfirm,
  onCancel,
}) => {
  const [draft, setDraft] = useState(summary ?? '');
  /**
   * 跟踪上一次收到的 `summary`，**只在它真的换了的时候**覆盖输入框。
   *
   * 不能直接 `useEffect(..., [summary])` 无条件写回：父组件重渲染时
   * `summary` 值没变也会触发，把久刚改的字冲掉。重新生成会给到一段新文本，
   * 那时候才该覆盖。
   */
  const lastSummaryRef = useRef<string | undefined>(summary);
  useEffect(() => {
    if (summary === lastSummaryRef.current) return;
    lastSummaryRef.current = summary;
    if (summary !== undefined) setDraft(summary);
  }, [summary]);

  const busy = generating || saving;
  const trimmed = draft.trim();
  const canConfirm = !busy && trimmed.length > 0;

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(trimmed);
  }, [canConfirm, onConfirm, trimmed]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* 遮罩。生成中/写入中点外面不关，免得正在写记忆时被误关掉。 */}
      <div
        className="absolute inset-0 bg-black/45"
        onClick={() => { if (!busy) onCancel(); }}
      />
      <div className="relative w-full rounded-t-2xl bg-[#fbf6ec] px-4 pb-5 pt-4 shadow-2xl">
        <div className="flex items-start gap-2">
          <Brain size={18} weight="bold" className="mt-0.5 shrink-0 text-orange-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-stone-800">
              写进 {characterName} 的记忆
            </p>
            <p className="mt-0.5 truncate text-[10px] text-stone-500">
              来自「{discussionWindow.name}」
            </p>
          </div>
          <button
            onClick={() => { if (!busy) onCancel(); }}
            disabled={busy}
            className="shrink-0 rounded-lg p-1 text-stone-400 transition active:scale-90 disabled:opacity-30"
            aria-label="关闭"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {manualHint && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            {manualHint}
          </p>
        )}

        {generating ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-8 ring-1 ring-stone-200">
            <span className="flex gap-1">
              {[0, 1, 2].map(index => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-400"
                  style={{ animationDelay: `${index * 160}ms` }}
                />
              ))}
            </span>
            <span className="text-[12px] text-stone-500">
              正在把这次共读写成一段 {characterName} 自己的记忆…
            </span>
          </div>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              disabled={saving}
              rows={7}
              className="mt-3 w-full resize-none rounded-xl bg-white px-3 py-2.5 text-[13px] leading-relaxed text-stone-800 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-orange-400 disabled:opacity-60"
              placeholder={`用 ${characterName} 的口吻写一段「我和你一起读了什么」…`}
            />
            <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-stone-400">
              这段话可以直接改。确认之后会存进 {characterName} 的记忆，
              以后日常聊天里TA就记得一起读过这本书。
            </p>
          </>
        )}

        {error && (
          <p className="mt-2.5 flex gap-1.5 rounded-xl bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-700 ring-1 ring-red-200">
            <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {saving && (
          <p className="mt-2.5 rounded-xl bg-stone-100 px-3 py-2.5 text-[11px] leading-relaxed text-stone-600">
            正在存进记忆宫殿。这一步要把这段话整理成可以回想起来的记忆，
            会比刚才久一点，别关页面。
          </p>
        )}

        <div className="mt-3.5 flex items-center gap-2">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 rounded-xl bg-orange-600 py-3 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-35"
          >
            {saving ? '正在写入…' : '写进记忆'}
          </button>
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="flex items-center gap-1 rounded-xl bg-stone-200/80 px-3.5 py-3 text-[12px] text-stone-700 transition active:scale-95 disabled:opacity-35"
          >
            <ArrowClockwise size={13} weight="bold" /> 重新生成
          </button>
        </div>
        <button
          onClick={onCancel}
          disabled={saving}
          className="mt-2 w-full rounded-xl py-2 text-[12px] text-stone-500 transition active:scale-95 disabled:opacity-35"
        >
          先不写，关掉
        </button>
      </div>
    </div>
  );
};

export default ReadingArchiveReview;