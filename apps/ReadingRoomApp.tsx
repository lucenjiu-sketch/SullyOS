import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { ArrowLeft, Books, Plus, Trash, WarningCircle, PencilSimple, TextAa } from '@phosphor-icons/react';
import { ReadingRoomStore } from '../features/readingRoom/store';
import { parseReadingFile, READING_MAX_CHARS } from '../features/readingRoom/parse';
import { progressPercent } from '../features/readingRoom/paginate';
import { coverPalette, coverTitleLines } from '../features/readingRoom/layout';
import ReadingView, { READING_FONT_SIZES, type ReadingFlipMode } from '../features/readingRoom/ReadingView';
import { readingRoomId, type ReadingBook, type ReadingEncoding } from '../features/readingRoom/types';
import { trackEvent } from '../utils/analytics';

/**
 * 共读室 · 第一期：书架 + 沉浸式阅读器。
 *
 * 划线和与角色讨论在第二期，归档进记忆宫殿在第三期。
 * 正文全程只留在本地 IndexedDB，不进任何 API 请求。
 */

const FONT_SIZE_KEY = 'sullyos_reading_font_size';
const FLIP_MODE_KEY = 'sullyos_reading_flip_mode';

const ENCODING_LABELS: Record<ReadingEncoding, string> = {
  'utf-8': 'UTF-8',
  gbk: 'GBK / GB18030',
  big5: 'Big5（繁体）',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
};
const RETRY_ENCODINGS: ReadingEncoding[] = ['utf-8', 'gbk', 'big5', 'utf-16le'];

/** 长按多久算「长按」。短于这个就是普通点击（打开书）。 */
const LONG_PRESS_MS = 460;

const formatCharCount = (count: number): string => (
  count >= 10_000 ? `${(count / 10_000).toFixed(1)} 万字` : `${count} 字`
);

const ReadingRoomApp: React.FC = () => {
  const { closeApp, addToast, showError } = useOS();

  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [progressByBook, setProgressByBook] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const [openBook, setOpenBook] = useState<ReadingBook | null>(null);
  const [content, setContent] = useState('');
  const [initialOffset, setInitialOffset] = useState(0);
  /** 长按书封弹出的操作面板。 */
  const [actionBook, setActionBook] = useState<ReadingBook | null>(null);

  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem(FONT_SIZE_KEY));
    return READING_FONT_SIZES.includes(saved as typeof READING_FONT_SIZES[number]) ? saved : 20;
  });
  const [flipMode, setFlipMode] = useState<ReadingFlipMode>(() => (
    localStorage.getItem(FLIP_MODE_KEY) === 'vertical' ? 'vertical' : 'horizontal'
  ));

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 上次导入的原始字节，供「换个编码重读」复用，不必让用户再选一次文件。 */
  const lastBufferRef = useRef<{ bookId: string; fileName: string; buffer: ArrayBuffer } | null>(null);
  const longPressRef = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });

  const refreshShelf = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, progress] = await Promise.all([
        ReadingRoomStore.listBooks(),
        ReadingRoomStore.listProgress(),
      ]);
      setBooks(rows);
      setProgressByBook(Object.fromEntries(progress.map(row => [row.bookId, row.offset])));
    } catch (error: any) {
      showError?.('共读室打不开本地书架', error?.message || String(error));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { void refreshShelf(); }, [refreshShelf]);
  useEffect(() => { localStorage.setItem(FONT_SIZE_KEY, String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem(FLIP_MODE_KEY, flipMode); }, [flipMode]);
  useEffect(() => () => {
    if (longPressRef.current.timer !== null) window.clearTimeout(longPressRef.current.timer);
  }, []);

  const importBuffer = useCallback(async (
    fileName: string,
    buffer: ArrayBuffer,
    options: { bookId?: string; encoding?: ReadingEncoding } = {},
  ) => {
    const parsed = parseReadingFile(fileName, buffer, options.encoding);
    if (!parsed.content.trim()) {
      addToast('这个文件里没读到文字，可能不是纯文本 TXT', 'error');
      return null;
    }
    const now = Date.now();
    const existing = options.bookId ? books.find(book => book.id === options.bookId) : undefined;
    const book: ReadingBook = {
      id: options.bookId || readingRoomId('book'),
      // 重新解码不覆盖用户已经改过的书名。
      title: existing?.title || parsed.title,
      author: existing?.author,
      fileName,
      charCount: parsed.content.length,
      encoding: parsed.encoding,
      chapters: parsed.chapters,
      chaptersDetected: parsed.chaptersDetected,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await ReadingRoomStore.saveBook(book, parsed.content);
    lastBufferRef.current = { bookId: book.id, fileName, buffer };

    if (parsed.truncated) {
      addToast(`这本书超过 ${(READING_MAX_CHARS / 10_000).toFixed(0)} 万字，只存了前面一部分`, 'info');
    }
    if (parsed.suspectGarbled) {
      addToast('文字看起来有点乱，长按书封可以换个编码重读', 'info');
    } else if (!parsed.chaptersDetected) {
      addToast('这本 TXT 没识别出章节目录，整本当成一章来读', 'info');
    }
    await refreshShelf();
    return book;
  }, [addToast, books, refreshShelf]);

  const handlePickFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const book = await importBuffer(file.name, await file.arrayBuffer());
      if (book) {
        trackEvent('共读室导入 TXT', { chapters: book.chaptersDetected ? 'detected' : 'none' });
        addToast(`《${book.title}》已放进书架`, 'success');
      }
    } catch (error: any) {
      showError?.('这本 TXT 没能导入', error?.message || String(error));
    } finally {
      setImporting(false);
    }
  }, [addToast, importBuffer, showError]);

  const handleReopenWithEncoding = useCallback(async (book: ReadingBook, encoding: ReadingEncoding) => {
    const cached = lastBufferRef.current;
    if (!cached || cached.bookId !== book.id) {
      // 原始字节只在本次会话里缓存：重开 App 后换编码要重新选一次文件。
      addToast('换编码需要重新选一次这本 TXT 文件', 'info');
      setActionBook(null);
      fileInputRef.current?.click();
      return;
    }
    setImporting(true);
    try {
      await importBuffer(cached.fileName, cached.buffer, { bookId: book.id, encoding });
      addToast(`已按 ${ENCODING_LABELS[encoding]} 重读`, 'success');
      setActionBook(null);
    } catch (error: any) {
      showError?.('换编码没成功', error?.message || String(error));
    } finally {
      setImporting(false);
    }
  }, [addToast, importBuffer, showError]);

  const handleOpenBook = useCallback(async (book: ReadingBook) => {
    try {
      const [text, progress] = await Promise.all([
        ReadingRoomStore.getContent(book.id),
        ReadingRoomStore.getProgress(book.id),
      ]);
      if (text === null) {
        addToast('这本书的正文找不到了，请重新导入', 'error');
        return;
      }
      setInitialOffset(progress?.offset || 0);
      setContent(text);
      setOpenBook(book);
      trackEvent('共读室打开书');
    } catch (error: any) {
      showError?.('打不开这本书', error?.message || String(error));
    }
  }, [addToast, showError]);

  const handleDeleteBook = useCallback(async (book: ReadingBook) => {
    if (!window.confirm(`把《${book.title}》从书架删掉？正文和阅读进度会一起删除。`)) return;
    try {
      await ReadingRoomStore.deleteBook(book.id);
      setActionBook(null);
      if (openBook?.id === book.id) { setOpenBook(null); setContent(''); }
      await refreshShelf();
      addToast('已从书架移除', 'success');
    } catch (error: any) {
      showError?.('没能删掉这本书', error?.message || String(error));
    }
  }, [addToast, openBook, refreshShelf, showError]);

  const handleRename = useCallback(async (book: ReadingBook) => {
    const title = window.prompt('这本书叫什么？', book.title)?.trim();
    setActionBook(null);
    if (!title || title === book.title) return;
    try {
      await ReadingRoomStore.saveBook({ ...book, title, updatedAt: Date.now() });
      await refreshShelf();
    } catch (error: any) {
      showError?.('改名没保存上', error?.message || String(error));
    }
  }, [refreshShelf, showError]);

  /** 翻页时就落库，不等退出——手机上随时可能被系统回收。 */
  const persistProgress = useCallback((bookId: string, offset: number) => {
    void ReadingRoomStore.saveProgress({ bookId, offset, updatedAt: Date.now() })
      .catch(error => console.warn('[ReadingRoom] 阅读进度没存上', error));
    setProgressByBook(previous => ({ ...previous, [bookId]: offset }));
  }, []);

  // ——— 阅读 ———
  if (openBook) {
    return (
      <ReadingView
        book={openBook}
        content={content}
        initialOffset={initialOffset}
        fontSize={fontSize}
        flipMode={flipMode}
        onChangeFontSize={setFontSize}
        onChangeFlipMode={setFlipMode}
        onOffsetChange={offset => persistProgress(openBook.id, offset)}
        onExit={() => { setOpenBook(null); setContent(''); void refreshShelf(); }}
      />
    );
  }

  // ——— 书架 ———
  const startLongPress = (book: ReadingBook) => {
    longPressRef.current.fired = false;
    longPressRef.current.timer = window.setTimeout(() => {
      longPressRef.current.fired = true;
      setActionBook(book);
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    if (longPressRef.current.timer !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#f7f4ee] text-stone-900">
      <div className="shrink-0 bg-[#f7f4ee]" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={closeApp} className="-ml-1 rounded-full p-2 active:scale-90 transition-transform" aria-label="返回">
            <ArrowLeft size={20} weight="bold" className="text-stone-600" />
          </button>
          <h1 className="text-[17px] font-bold">共读室</h1>
          <span className="ml-auto text-[11px] text-stone-400">{books.length > 0 ? `${books.length} 本` : ''}</span>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handlePickFile} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}>
        <div className="mb-4 flex gap-2 rounded-xl bg-stone-700 px-3 py-2.5 text-[11px] leading-relaxed text-stone-100">
          <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-300" />
          <span>
            书只存在这台设备上，<b>不会进备份</b>，清浏览器数据或换设备会丢。
            划线、和角色讨论、归档进记忆宫殿还没做（第二、三期）。长按书封可以改名或删除。
          </span>
        </div>

        {loading ? (
          <p className="py-20 text-center text-sm text-stone-400">正在翻开书架…</p>
        ) : (
          <div className="grid grid-cols-3 gap-x-3 gap-y-5">
            {books.map(book => {
              const offset = progressByBook[book.id] || 0;
              const percent = progressPercent(book, offset);
              const palette = coverPalette(book.id);
              return (
                <div key={book.id} className="flex flex-col">
                  <button
                    onPointerDown={() => startLongPress(book)}
                    onPointerUp={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onClick={() => { if (!longPressRef.current.fired) void handleOpenBook(book); }}
                    onContextMenu={event => { event.preventDefault(); setActionBook(book); }}
                    className="relative aspect-[3/4] w-full overflow-hidden rounded-[3px] text-left shadow-[2px_3px_8px_rgba(0,0,0,0.18)] transition-transform active:scale-[0.97]"
                    style={{ background: `linear-gradient(145deg, ${palette.from}, ${palette.to})` }}
                  >
                    {/* 书脊：靠左一条更深的窄边，让纯色块看起来像一本书。 */}
                    <span className="absolute inset-y-0 left-0 w-[6px] bg-black/15" />
                    <span
                      className="absolute inset-x-0 top-0 px-2 pb-2 pt-3 text-[11px] font-semibold leading-snug"
                      style={{ color: palette.ink, wordBreak: 'break-word' }}
                    >
                      {coverTitleLines(book.title)}
                    </span>
                    {percent > 0 && (
                      <span className="absolute bottom-1 right-1 rounded-sm bg-black/35 px-1 py-[1px] text-[9px] tabular-nums text-white/95">
                        {percent === 100 ? '读完' : `${percent}%`}
                      </span>
                    )}
                  </button>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-stone-600">{book.title}</p>
                </div>
              );
            })}

            {/* 最后一格：虚线空框 + 加号，点它上传 TXT。 */}
            <div className="flex flex-col">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex aspect-[3/4] w-full items-center justify-center rounded-[3px] border-2 border-dashed border-stone-300 bg-white/50 transition-transform active:scale-[0.97] disabled:opacity-50"
                aria-label="上传 TXT"
              >
                {importing
                  ? <span className="text-[11px] text-stone-400">导入中…</span>
                  : <Plus size={30} weight="light" className="text-stone-400" />}
              </button>
              <p className="mt-1.5 text-[11px] text-stone-400">上传 TXT</p>
            </div>
          </div>
        )}

        {!loading && books.length === 0 && (
          <div className="py-10 text-center">
            <Books size={40} weight="thin" className="mx-auto text-stone-300" />
            <p className="mt-2 text-xs text-stone-400">书架是空的，点上面那个加号放一本进来</p>
          </div>
        )}
      </div>

      {/* ——— 长按书封的操作面板 ——— */}
      {actionBook && (
        <div className="absolute inset-0 z-40" onClick={() => setActionBook(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white"
            onClick={event => event.stopPropagation()}
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}
          >
            <div className="border-b border-stone-200 px-4 py-3">
              <p className="line-clamp-1 text-sm font-semibold">{actionBook.title}</p>
              <p className="mt-0.5 text-[11px] text-stone-500">
                {formatCharCount(actionBook.charCount)}
                {' · '}
                {actionBook.chaptersDetected ? `${actionBook.chapters.length} 章` : '无目录'}
                {' · '}
                {ENCODING_LABELS[actionBook.encoding]}
              </p>
            </div>
            <button
              onClick={() => handleRename(actionBook)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-sm active:bg-stone-100"
            >
              <PencilSimple size={16} weight="bold" className="text-stone-500" /> 改书名
            </button>
            <div className="flex items-center gap-2 border-t border-stone-200 px-4 pb-1 pt-3 text-[11px] text-stone-400">
              <TextAa size={14} weight="bold" /> 文字乱码时换个编码重读
            </div>
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {RETRY_ENCODINGS.map(encoding => (
                <button
                  key={encoding}
                  onClick={() => handleReopenWithEncoding(actionBook, encoding)}
                  disabled={importing}
                  className={`rounded-lg px-2.5 py-1.5 text-xs transition active:scale-95 disabled:opacity-40 ${actionBook.encoding === encoding ? 'bg-stone-700 text-stone-50' : 'bg-stone-100 text-stone-600'}`}
                >
                  {ENCODING_LABELS[encoding]}
                </button>
              ))}
            </div>
            <button
              onClick={() => handleDeleteBook(actionBook)}
              className="flex w-full items-center gap-2 border-t border-stone-200 px-4 py-3.5 text-left text-sm text-red-600 active:bg-red-50"
            >
              <Trash size={16} weight="bold" /> 从书架删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingRoomApp;