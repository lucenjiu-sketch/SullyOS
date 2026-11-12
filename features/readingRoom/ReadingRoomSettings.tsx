import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowCounterClockwise,
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
  MAX_WINDOW_NAME_CHARS,
  renameWindow,
  setWindowArchived,
  type ReadingWindowFilter,
} from './discussion';
import { ReadingRoomStore } from './store';
import type { ReadingDiscussionWindow } from './types';

/**
 * 共读室 · 设置页。
 *
 * 只管两件事：**选这次共读的角色**、**选这个角色名下的讨论窗口**。
 *
 * 不放划线列表（划线留在阅读页原位置，久要求的），不放书籍管理，
 * 也不发任何请求——面板和 AI 是后面两包的事。
 *
 * ## 窗口现在能管不能进
 *
 * 能建、能选、能改名、能归档、能删，消息表也已经有了（v4），
 * 但还没有进去说话的地方——讨论面板是下一包。界面上写明了这件事，
 * 免得被当成坏掉。
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

const ReadingRoomSettings: React.FC<Props> = ({
  characters,
  selectedCharId,
  selectedWindowId,
  onSelectChar,
  onSelectWindow,
  onError,
}) => {
  const [windows, setWindows] = useState<ReadingDiscussionWindow[]>([]);
  const [filter, setFilter] = useState<ReadingWindowFilter>('active');
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 改名弹窗。null = 没在改名。 */
  const [renaming, setRenaming] = useState<RenameDraft | null>(null);

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
          这个选择是共读室全局的，换书不会变。讨论窗口现在还不能进去说话——
          面板和引用发送是下一步要做的。
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
          窗口和当前选择都存在这台设备上，和书一样不会进备份。
          归档只是收起来，不会删掉里面的内容。
        </span>
      </p>

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