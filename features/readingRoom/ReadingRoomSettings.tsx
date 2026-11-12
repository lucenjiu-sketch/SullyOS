import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowCounterClockwise,
  Brain,
  CheckCircle,
  ChatCircleDots,
  PencilSimple,
  Plus,
  Trash,
  UserCircle,
} from '@phosphor-icons/react';
import TokenImg from '../../components/os/TokenImg';
import type { CharacterProfile } from '../../types';
import {
  createDiscussionWindow,
  filterWindows,
  markWindowMemoryArchived,
  MAX_WINDOW_NAME_CHARS,
  renameWindow,
  setWindowArchived,
  type ReadingWindowFilter,
} from './discussion';
import ReadingArchiveReview from './ReadingArchiveReview';
import { ReadingRoomStore } from './store';
import type { ReadingDiscussionWindow } from './types';

/**
 * 共读室 · 设置页。
 *
 * 只管两件事：**选这次共读的角色**、**选这个角色名下的讨论窗口**。
 *
 * 不放划线列表（划线留在阅读页原位置，久要求的），不放书籍管理，
 * 也不发任何请求——讨论在阅读页的面板里进行，这里只负责选和管。
 *
 * ## 为什么窗口列表的重建要小心
 *
 * 列表重建会把滚动位置顶回最上面。久真机报过这个：选中靠下、需要滑动
 * 才点到的窗口之后，列表跳回顶部，要再滑一次才看得见选中态。
 * 两个原因都修掉了（见 `refreshWindows` 的注释，以及 App 那边
 * `handleSettingsError` 为什么必须是稳定引用）。
 * **往这里加 effect 时先想一遍：它会不会每次重渲染都重读一次窗口。**
 *
 * ## 选择为什么存在库里而不是 state
 *
 * 退出 App 再进来要还记得上次选了谁。存在 `ReadingRoomStore` 的 selection 表
 * （单行记录），不跟书绑定——换书不改选择，是久定的。
 */

interface Props {
  characters: CharacterProfile[];
  selectedCharId?: string;
  selectedWindowId?: string;
  onSelectChar: (charId: string) => void;
  onSelectWindow: (windowId: string | undefined) => void;
  onError: (title: string, detail: string) => void;
  /**
   * 第三期：把一个窗口的讨论总结成一段角色第一人称的经历。
   *
   * 由 App 层实现（副 LLM 的配置在 `useOS()` 那一层）。
   * 返回 `null` 表示**副 LLM 没配**，这时候预览页开成手写模式；
   * 抛错表示这一次失败了（网络 / 渠道 / 模型没给出东西），可以重试。
   */
  onSummarizeWindow: (window: ReadingDiscussionWindow) => Promise<string | null>;
  /**
   * 第三期：把用户确认过的那段话真正写进角色的记忆。
   *
   * 成功返回一句给用户看的话（存到哪儿了），失败抛错。
   * **抛错时这个函数不许留下半截状态**——窗口由这边在成功之后才标记。
   */
  onArchiveToMemory: (window: ReadingDiscussionWindow, summary: string) => Promise<string>;
  /** 成功的提示。走 App 的 toast。 */
  onNotify: (message: string) => void;
}

const windowTimeLabel = (value: number): string => {
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 正在改名的那个窗口。`draft` 是输入框里的字，没确定之前不碰原窗口。 */
interface RenameDraft {
  window: ReadingDiscussionWindow;
  draft: string;
}

/**
 * 「写进记忆」这件事的全部状态。null = 没在归档。
 *
 * **总结生成和写入是两个阶段，中间夹着用户确认。**
 * `generating` 为真时转圈；`summary` 有值就显示出来给她改；
 * `saving` 为真时正在跑记忆宫殿那条管线。
 *
 * `manual` 为真 = 副 LLM 没配，预览页开成空白手写模式。
 */
interface ArchiveFlow {
  window: ReadingDiscussionWindow;
  generating: boolean;
  saving: boolean;
  summary?: string;
  error?: string;
  manual: boolean;
}

const ReadingRoomSettings: React.FC<Props> = ({
  characters,
  selectedCharId,
  selectedWindowId,
  onSelectChar,
  onSelectWindow,
  onError,
  onSummarizeWindow,
  onArchiveToMemory,
  onNotify,
}) => {
  const [windows, setWindows] = useState<ReadingDiscussionWindow[]>([]);
  const [filter, setFilter] = useState<ReadingWindowFilter>('active');
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 改名弹窗。null = 没在改名。 */
  const [renaming, setRenaming] = useState<RenameDraft | null>(null);
  /** 「写进记忆」的流程状态。null = 没在归档。 */
  const [archiving, setArchiving] = useState<ArchiveFlow | null>(null);

  const selectedChar = useMemo(
    () => characters.find(char => char.id === selectedCharId),
    [characters, selectedCharId],
  );

  /**
   * 换角色就重读窗口。不同角色的窗口不能混在一起，所以不做跨角色缓存。
   *
   * 读完顺手决定停在哪一栏：全是已归档时停在空的「未归档」栏会让人
   * 以为窗口丢了。**这件事只在这里做一次**，不要再挂一个盯着 `windows`
   * 的 effect —— 那样归档 / 撤销归档改完列表，分栏会被强行切走，
   * 用户正看着的那一栏自己跳掉。
   */
  const refreshWindows = useCallback(async (charId: string | undefined) => {
    if (!charId) { setWindows([]); return; }
    setLoadingWindows(true);
    try {
      const rows = await ReadingRoomStore.listWindows(charId);
      setWindows(rows);
      if (rows.length > 0) {
        setFilter(rows.some(window => !window.archivedAt) ? 'active' : 'archived');
      }
    } catch (error: any) {
      onError('读不出这个角色的讨论窗口', error?.message || String(error));
      setWindows([]);
    } finally {
      setLoadingWindows(false);
    }
  }, [onError]);

  useEffect(() => { void refreshWindows(selectedCharId); }, [refreshWindows, selectedCharId]);

  const shown = useMemo(() => filterWindows(windows, filter), [windows, filter]);
  const activeCount = windows.filter(window => !window.archivedAt).length;
  const archivedCount = windows.length - activeCount;

  const handleCreateWindow = useCallback(async () => {
    if (!selectedCharId || busy) return;
    setBusy(true);
    try {
      const created = createDiscussionWindow(selectedCharId, windows);
      await ReadingRoomStore.saveWindow(created);
      setWindows(previous => [created, ...previous]);
      // 新建完直接选中它，省一次点击。
      setFilter('active');
      onSelectWindow(created.id);
    } catch (error: any) {
      onError('新窗口没建成', error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, onError, onSelectWindow, selectedCharId, windows]);

  const handleArchive = useCallback(async (window: ReadingDiscussionWindow, archived: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = setWindowArchived(window, archived);
      await ReadingRoomStore.saveWindow(updated);
      setWindows(previous => previous.map(item => (item.id === window.id ? updated : item)));
    } catch (error: any) {
      onError('归档状态没改上', error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, onError]);

  const handleDelete = useCallback(async (window: ReadingDiscussionWindow) => {
    if (busy) return;
    if (!globalThis.confirm?.(`删掉「${window.name}」？里面的讨论记录会一起删掉。`)) return;
    setBusy(true);
    try {
      await ReadingRoomStore.deleteWindow(window.id);
      setWindows(previous => previous.filter(item => item.id !== window.id));
      // 删掉的正好是选中那个，就把选择清空，不留一个指向空气的 id。
      if (selectedWindowId === window.id) onSelectWindow(undefined);
    } catch (error: any) {
      onError('窗口没删掉', error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, onError, onSelectWindow, selectedWindowId]);

  /**
   * 确定改名。
   *
   * `renameWindow` 在名字没真的变时返回同一个对象，这里靠 `===` 跳过写库——
   * 点开弹窗什么都没改就按确定，不该把这个窗口的 `updatedAt` 刷新（它会跳到列表最前）。
   */
  const handleRenameConfirm = useCallback(async () => {
    if (!renaming || busy) return;
    const updated = renameWindow(renaming.window, renaming.draft);
    if (updated === renaming.window) { setRenaming(null); return; }
    setBusy(true);
    try {
      await ReadingRoomStore.saveWindow(updated);
      setWindows(previous => previous.map(item => (item.id === updated.id ? updated : item)));
      setRenaming(null);
    } catch (error: any) {
      onError('名字没改上', error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, onError, renaming]);

  /**
   * 跑一次总结。开归档流程和「重新生成」都走这里。
   *
   * **失败只记在 `archiving.error` 上，窗口一个字都不改。**
   * 她可以直接按「重新生成」重试——网卡一下不该变成「没配置」，
   * 也不该让窗口显示成已写入。
   */
  const runSummary = useCallback(async (window: ReadingDiscussionWindow) => {
    setArchiving({ window, generating: true, saving: false, manual: false });
    try {
      const summary = await onSummarizeWindow(window);
      // null = 副 LLM 没配。开成手写模式，不是报错。
      setArchiving({
        window,
        generating: false,
        saving: false,
        summary: summary ?? '',
        manual: summary === null,
      });
    } catch (error: any) {
      setArchiving({
        window,
        generating: false,
        saving: false,
        error: error?.message || String(error),
        manual: false,
      });
    }
  }, [onSummarizeWindow]);

  /**
   * 点「写进记忆」。
   *
   * 已经写过的窗口要先问一遍：记忆宫殿按内容相似度去重，**不认我们的归档 id**，
   * 所以重复写有可能在宫殿里留下几条相近的记忆。神经链接那条不会重复。
   */
  const handleArchiveToMemory = useCallback(async (window: ReadingDiscussionWindow) => {
    if (busy || archiving) return;
    if (window.memoryArchivedAt && !globalThis.confirm?.(
      `「${window.name}」已经写进记忆了。再写一次的话，记忆宫殿里可能会多出一条很像的记忆。继续吗？`,
    )) return;
    await runSummary(window);
  }, [archiving, busy, runSummary]);

  /**
   * 她确认之后，真正写入。
   *
   * 顺序是定的：**先写记忆，成功了才标记窗口。** 反过来写会出现
   * 「界面说写好了，角色脑子里什么都没有」——而她没办法自己发现。
   *
   * 窗口元数据保存失败时记忆已经进去了，所以那一步单独提示，
   * 并且不清掉预览（她能看到发生在哪一步）。
   */
  const handleArchiveConfirm = useCallback(async (finalSummary: string) => {
    if (!archiving || archiving.saving) return;
    const target = archiving.window;
    setArchiving({ ...archiving, saving: true, error: undefined });
    let message: string;
    try {
      message = await onArchiveToMemory(target, finalSummary);
    } catch (error: any) {
      // 记忆没写进去。窗口保持原状，她改过的文字留着，可以直接再点一次。
      setArchiving(previous => (previous && previous.window.id === target.id
        ? { ...previous, saving: false, summary: finalSummary, error: error?.message || String(error) }
        : previous));
      return;
    }
    try {
      const updated = markWindowMemoryArchived(target, finalSummary);
      await ReadingRoomStore.saveWindow(updated);
      setWindows(previous => previous.map(item => (item.id === target.id ? updated : item)));
      setArchiving(null);
      onNotify(message);
    } catch (error: any) {
      setArchiving(previous => (previous && previous.window.id === target.id
        ? {
          ...previous,
          saving: false,
          summary: finalSummary,
          error: `记忆已经写进去了，但这个窗口的状态没存上：${error?.message || String(error)}。`
            + '不用再写一次，重开共读室看一下这个窗口就好。',
        }
        : previous));
    }
  }, [archiving, onArchiveToMemory, onNotify]);

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-4" style={{ paddingBottom: 16 }}>
      {/* ——— 当前选择，一眼能看到 ——— */}
      <div className="mt-3 rounded-xl bg-stone-700 px-3.5 py-3 text-stone-100">
        <p className="text-[10px] uppercase tracking-wider text-stone-400">这次和谁一起读</p>
        <p className="mt-1 text-sm font-semibold">
          {selectedChar ? selectedChar.name : '还没选角色'}
          <span className="mx-1.5 text-stone-500">·</span>
          <span className="font-normal text-stone-300">
            {selectedWindowId
              ? windows.find(window => window.id === selectedWindowId)?.name || '窗口已失效'
              : '还没选窗口'}
          </span>
        </p>
        <p className="mt-1.5 text-[10px] leading-relaxed text-stone-400">
          这个选择是共读室全局的，换书不会变。在书里向右边那个小把手
          点一下，就能和他讨论划线。
        </p>
      </div>

      {/* ——— 角色 ——— */}
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
          <UserCircle size={15} weight="bold" className="text-stone-500" /> 共读对象
        </p>
        {characters.length === 0 ? (
          <p className="rounded-xl bg-white/70 px-3 py-4 text-[12px] leading-relaxed text-stone-500">
            还没有角色。先去神经链接里建一个，再回来这里选。
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-x-3 gap-y-4">
            {characters.map(char => {
              const picked = char.id === selectedCharId;
              return (
                <button
                  key={char.id}
                  onClick={() => onSelectChar(char.id)}
                  className="flex flex-col items-center transition-transform active:scale-95"
                >
                  <span
                    className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-stone-200 text-sm font-semibold text-stone-500 ${picked ? 'ring-[3px] ring-orange-500 ring-offset-2 ring-offset-[#f7f4ee]' : ''}`}
                  >
                    {char.avatar
                      ? <TokenImg value={char.avatar} alt={char.name} className="h-full w-full object-cover" />
                      : (char.name?.[0] || '角')}
                  </span>
                  <span className={`mt-1.5 line-clamp-1 text-[11px] ${picked ? 'font-semibold text-orange-700' : 'text-stone-600'}`}>
                    {char.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ——— 窗口 ——— */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
            <ChatCircleDots size={15} weight="bold" className="text-stone-500" /> 讨论窗口
          </p>
          <button
            onClick={handleCreateWindow}
            disabled={!selectedCharId || busy}
            className="ml-auto flex items-center gap-1 rounded-lg bg-stone-700 px-2.5 py-1.5 text-[11px] text-stone-50 transition active:scale-95 disabled:opacity-35"
          >
            <Plus size={12} weight="bold" /> 新建窗口
          </button>
        </div>

        {!selectedCharId ? (
          <p className="rounded-xl bg-white/70 px-3 py-4 text-[12px] leading-relaxed text-stone-500">
            先选一个共读对象，再选窗口。窗口属于角色，不同角色的窗口是分开的。
          </p>
        ) : (
          <>
            <div className="mb-2.5 flex gap-2">
              {([
                ['active', '未归档', activeCount],
                ['archived', '已归档', archivedCount],
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] transition active:scale-95 ${filter === value ? 'bg-stone-700 text-stone-50' : 'bg-white/80 text-stone-600'}`}
                >
                  {label}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>

            {loadingWindows ? (
              <p className="px-1 py-6 text-center text-[12px] text-stone-400">正在读窗口…</p>
            ) : shown.length === 0 ? (
              <p className="rounded-xl bg-white/70 px-3 py-4 text-[12px] leading-relaxed text-stone-500">
                {filter === 'active'
                  ? `${selectedChar?.name || '这个角色'}名下还没有未归档的窗口，点右上角「新建窗口」开一个。`
                  : '这一栏是空的。归档过的窗口会收到这里，不会删掉。'}
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {shown.map(window => {
                  const picked = window.id === selectedWindowId;
                  return (
                    <div
                      key={window.id}
                      className={`rounded-xl bg-white px-3.5 py-3 transition ${picked ? 'ring-2 ring-orange-500' : 'ring-1 ring-stone-200'}`}
                    >
                      <button
                        onClick={() => onSelectWindow(picked ? undefined : window.id)}
                        className="flex w-full items-start gap-2 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-stone-800">
                            {window.name}
                          </span>
                          {/* 预览只显示摘要，完整消息在 messages 表里。 */}
                          <span className={`mt-1 block line-clamp-2 text-[11px] leading-relaxed ${window.lastMessagePreview ? 'text-stone-600' : 'text-stone-400'}`}>
                            {window.lastMessagePreview || '还没有讨论记录'}
                          </span>
                          <span className="mt-1 block text-[10px] text-stone-400">
                            {window.lastMessageAt
                              ? `最近 ${windowTimeLabel(window.lastMessageAt)}`
                              : `建于 ${windowTimeLabel(window.createdAt)}`}
                            {window.archivedAt ? ' · 已归档' : ''}
                            {window.memoryArchivedAt ? ' · 已写进记忆' : ''}
                          </span>
                        </span>
                        {picked && (
                          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-orange-500" />
                        )}
                      </button>
                      <div className="mt-2.5 flex items-center gap-3 border-t border-stone-100 pt-2">
                        <button
                          onClick={() => setRenaming({ window, draft: window.name })}
                          disabled={busy}
                          className="flex items-center gap-1 text-[11px] text-stone-500 transition active:scale-95 disabled:opacity-40"
                        >
                          <PencilSimple size={12} weight="bold" /> 改名
                        </button>
                        <button
                          onClick={() => handleArchive(window, !window.archivedAt)}
                          disabled={busy}
                          className="flex items-center gap-1 text-[11px] text-stone-500 transition active:scale-95 disabled:opacity-40"
                        >
                          {window.archivedAt
                            ? <><ArrowCounterClockwise size={12} weight="bold" /> 撤销归档</>
                            : <><Archive size={12} weight="bold" /> 归档</>}
                        </button>
                        <button
                          onClick={() => handleDelete(window)}
                          disabled={busy}
                          className="ml-auto flex items-center gap-1 text-[11px] text-red-600/90 transition active:scale-95 disabled:opacity-40"
                        >
                          <Trash size={12} weight="bold" /> 删除
                        </button>
                      </div>
                      {/*
                        「写进记忆」单独一行，和「归档」分开。
                        归档只是把窗口收起来（纯界面），写进记忆是真的改角色的脑子，
                        两件事混在一个按钮里会让撤销归档这个动作也被拖进总结流程。
                      */}
                      <button
                        onClick={() => void handleArchiveToMemory(window)}
                        disabled={busy || !!archiving || !window.lastMessageAt}
                        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] transition active:scale-95 disabled:opacity-40 ${window.memoryArchivedAt ? 'bg-stone-100 text-stone-500' : 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'}`}
                      >
                        <Brain size={13} weight="bold" />
                        {window.memoryArchivedAt
                          ? '已写进记忆 · 再写一次'
                          : window.lastMessageAt ? '写进记忆' : '还没有讨论，写不了'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-6 flex gap-2 px-1 text-[10px] leading-relaxed text-stone-400">
        <Archive size={13} weight="bold" className="mt-0.5 shrink-0" />
        <span>
          书、划线、窗口和讨论都会进备份（导出时选「文本」或「完整」）。
          导入备份会<b>覆盖</b>这里现有的书和讨论。
          归档只是收起来，不会删掉里面的内容。
          「写进记忆」是另一件事：那段话会存进角色的长期记忆，撤销归档不会把它删掉。
        </span>
      </p>

      {/* ——— 写进记忆的预览 ——— */}
      {archiving && (
        <ReadingArchiveReview
          window={archiving.window}
          characterName={selectedChar?.name || '这个角色'}
          generating={archiving.generating}
          saving={archiving.saving}
          summary={archiving.summary}
          error={archiving.error}
          manualHint={archiving.manual
            ? '记忆宫殿的副 LLM 还没配好，所以没法自动总结。可以自己写一段，确认后会存进角色的神经链接。'
            : undefined}
          onRegenerate={() => void runSummary(archiving.window)}
          onConfirm={finalSummary => void handleArchiveConfirm(finalSummary)}
          onCancel={() => { if (!archiving.saving) setArchiving(null); }}
        />
      )}

      {/* ——— 改名弹窗 ——— */}
      {renaming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          onClick={() => setRenaming(null)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-xs rounded-2xl bg-[#fbf6ec] px-4 py-4 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <p className="mb-2 text-[12px] font-semibold text-stone-700">给这个窗口改个名字</p>
            <input
              value={renaming.draft}
              onChange={event => setRenaming({ ...renaming, draft: event.target.value })}
              maxLength={MAX_WINDOW_NAME_CHARS}
              autoFocus
              className="w-full rounded-xl bg-white px-3 py-2.5 text-[13px] text-stone-800 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-orange-400"
              placeholder={renaming.window.name}
            />
            <p className="mt-1.5 text-[10px] text-stone-400">
              最多 {MAX_WINDOW_NAME_CHARS} 个字。留空就保持原来的名字；
              改名不影响里面已有的讨论记录。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRenameConfirm}
                disabled={busy}
                className="flex-1 rounded-xl bg-stone-700 py-2.5 text-sm text-stone-50 transition active:scale-95 disabled:opacity-40"
              >
                改好了
              </button>
              <button
                onClick={() => setRenaming(null)}
                className="rounded-xl bg-stone-200/80 px-4 py-2.5 text-sm transition active:scale-95"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingRoomSettings;