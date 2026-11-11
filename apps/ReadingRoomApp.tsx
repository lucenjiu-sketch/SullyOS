import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import {
  ArrowLeft,
  BookOpenText,
  Books,
  CaretLeft,
  CaretRight,
  DotsThreeVertical,
  List,
  Plus,
  TextAa,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { ReadingRoomStore } from '../features/readingRoom/store';
import { parseReadingFile, READING_MAX_CHARS } from '../features/readingRoom/parse';
import {
  pageAtOffset,
  nextPage,
  previousPage,
  progressPercent,
  type ReadingPage,
} from '../features/readingRoom/paginate';
import { readingRoomId, type ReadingBook, type ReadingEncoding } from '../features/readingRoom/types';
import { trackEvent } from '../utils/analytics';

/**
 * 共读室 · 第一期：书架 + 阅读器。
 *
 * 这一期没有角色、没有 AI、没有划线。划线和讨论窗口在第二期，
 * 归档进记忆宫殿在第三期。正文全程只留在本地，不进任何请求。
 */

const FONT_SIZES = [16, 18, 20, 22, 24] as const;
const FONT_SIZE_KEY = 'sullyos_reading_font_size';
const ENCODING_LABELS: Record<ReadingEncoding, string> = {
  'utf-8': 'UTF-8',
  gbk: 'GBK / GB18030',
  big5: 'Big5（繁体）',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
};
const RETRY_ENCODINGS: ReadingEncoding[] = ['utf-8', 'gbk', 'big5', 'utf-16le'];

const formatCharCount = (count: number): string => (
  count >= 10_000 ? `${(count / 10_000).toFixed(1)} 万字` : `${count} 字`
);

const ReadingRoomApp: React.FC = () => {
  const { closeApp, addToast, showError } = useOS();

  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [progressByBook, setProgressByBook] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  // 打开的书。content 只在读的时候取，书架列表不带正文。
  const [openBook, setOpenBook] = useState<ReadingBook | null>(null);
  const [content, setContent] = useState('');
  const [page, setPage] = useState<ReadingPage | null>(null);
  const [showChapters, setShowChapters] = useState(false);
  const [showBookMenu, setShowBookMenu] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem(FONT_SIZE_KEY));
    return FONT_SIZES.includes(saved as typeof FONT_SIZES[number]) ? saved : 18;
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  /** 上次导入的原始字节，留着给「换个编码重读」用，不必让用户再选一次文件。 */
  const lastBufferRef = useRef<{ bookId: string; fileName: string; buffer: ArrayBuffer } | null>(null);

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
      // 重新解码不改用户已经编辑过的书名。
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
      addToast('文字看起来有点乱，可以在书的菜单里换个编码重读', 'info');
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
      const buffer = await file.arrayBuffer();
      const book = await importBuffer(file.name, buffer);
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
      // 字节只在本次会话里缓存：重开 App 之后要换编码得重新选一次文件。
      addToast('换编码需要重新选一次这本 TXT 文件', 'info');
      fileInputRef.current?.click();
      return;
    }
    setImporting(true);
    try {
      await importBuffer(cached.fileName, cached.buffer, { bookId: book.id, encoding });
      addToast(`已按 ${ENCODING_LABELS[encoding]} 重读`, 'success');
      setShowBookMenu(null);
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
      setOpenBook(book);
      setContent(text);
      setPage(pageAtOffset(text, book.chapters, progress?.offset || 0));
      trackEvent('共读室打开书');
    } catch (error: any) {
      showError?.('打不开这本书', error?.message || String(error));
    }
  }, [addToast, showError]);

  const handleDeleteBook = useCallback(async (book: ReadingBook) => {
    if (!window.confirm(`把《${book.title}》从书架删掉？正文和阅读进度会一起删除。`)) return;
    try {
      await ReadingRoomStore.deleteBook(book.id);
      setShowBookMenu(null);
      if (openBook?.id === book.id) { setOpenBook(null); setContent(''); setPage(null); }
      await refreshShelf();
      addToast('已从书架移除', 'success');
    } catch (error: any) {
      showError?.('没能删掉这本书', error?.message || String(error));
    }
  }, [addToast, openBook, refreshShelf, showError]);

  const handleRename = useCallback(async (book: ReadingBook) => {
    const title = window.prompt('这本书叫什么？', book.title)?.trim();
    setShowBookMenu(null);
    if (!title || title === book.title) return;
    try {
      await ReadingRoomStore.saveBook({ ...book, title, updatedAt: Date.now() });
      await refreshShelf();
    } catch (error: any) {
      showError?.('改名没保存上', error?.message || String(error));
    }
  }, [refreshShelf, showError]);

  /** 进度在翻页时就落库，不等退出——手机上随时可能被系统回收。 */
  const persistProgress = useCallback((bookId: string, offset: number) => {
    void ReadingRoomStore.saveProgress({ bookId, offset, updatedAt: Date.now() })
      .catch(error => console.warn('[ReadingRoom] 阅读进度没存上', error));
    setProgressByBook(previous => ({ ...previous, [bookId]: offset }));
  }, []);

  const goToPage = useCallback((target: ReadingPage | null) => {
    if (!target || !openBook) return;
    setPage(target);
    persistProgress(openBook.id, target.start);
    textRef.current?.scrollTo({ top: 0 });
  }, [openBook, persistProgress]);

  const handleJumpChapter = useCallback((chapterIndex: number) => {
    if (!openBook) return;
    const chapter = openBook.chapters[chapterIndex];
    if (!chapter) return;
    setShowChapters(false);
    goToPage(pageAtOffset(content, openBook.chapters, chapter.start));
  }, [content, goToPage, openBook]);

  const pageText = useMemo(
    () => (page ? content.slice(page.start, page.end) : ''),
    [content, page],
  );

  const currentChapter = openBook && page ? openBook.chapters[page.chapterIndex] : null;
  const percent = openBook && page ? progressPercent(openBook, page.start) : 0;

  // ——— 阅读界面 ———
  if (openBook && page) {
    return (
      <div className="h-full w-full bg-[#f6f1e7] flex flex-col text-stone-900">
        <div className="shrink-0 bg-[#f6f1e7]/95 backdrop-blur border-b border-stone-300" style={{ paddingTop: 'var(--safe-top)' }}>
          <div className="flex items-center gap-1 px-2 py-2">
            <button
              onClick={() => { setOpenBook(null); setContent(''); setPage(null); void refreshShelf(); }}
              className="p-2 rounded-full active:scale-90 transition-transform"
              aria-label="回到书架"
            >
              <ArrowLeft size={20} weight="bold" className="text-stone-600" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{openBook.title}</p>
              <p className="truncate text-[11px] text-stone-500">
                {currentChapter?.title || '全文'} · {percent}%
              </p>
            </div>
            <button
              onClick={() => setShowChapters(true)}
              className="p-2 rounded-full active:scale-90 transition-transform"
              aria-label="目录"
            >
              <List size={20} weight="bold" className="text-stone-600" />
            </button>
            <button
              onClick={() => setFontSize(size => FONT_SIZES[(FONT_SIZES.indexOf(size as typeof FONT_SIZES[number]) + 1) % FONT_SIZES.length])}
              className="p-2 rounded-full active:scale-90 transition-transform"
              aria-label="字号"
            >
              <TextAa size={20} weight="bold" className="text-stone-600" />
            </button>
          </div>
        </div>

        <div
          ref={textRef}
          className="flex-1 overflow-y-auto no-scrollbar px-5 py-4"
          style={{ fontSize, lineHeight: 1.9 }}
        >
          {/* 整页用一个 whiteSpace: pre-wrap 的块渲染：
              第二期要按字符偏移还原划线位置，拆成多个 <p> 会让偏移映射变复杂。 */}
          <div style={{ whiteSpace: 'pre-wrap', textIndent: '2em', fontFamily: 'Georgia, "Noto Serif SC", serif' }}>
            {pageText}
          </div>
          <div className="h-16" />
        </div>

        <div className="shrink-0 border-t border-stone-300 bg-[#f6f1e7]" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <button
              onClick={() => goToPage(previousPage(content, openBook.chapters, page))}
              disabled={page.start <= 0}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-stone-200/70 text-sm active:scale-95 transition disabled:opacity-35"
            >
              <CaretLeft size={16} weight="bold" /> 上一页
            </button>
            <div className="flex-1 h-1.5 rounded-full bg-stone-300 overflow-hidden">
              <div className="h-full bg-stone-600 transition-all" style={{ width: `${percent}%` }} />
            </div>
            <button
              onClick={() => goToPage(nextPage(content, openBook.chapters, page))}
              disabled={page.end >= content.length}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-stone-200/70 text-sm active:scale-95 transition disabled:opacity-35"
            >
              下一页 <CaretRight size={16} weight="bold" />
            </button>
          </div>
        </div>

        {showChapters && (
          <div className="absolute inset-0 z-30 flex" onClick={() => setShowChapters(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative ml-auto h-full w-[78%] max-w-sm bg-[#f6f1e7] shadow-2xl flex flex-col"
              onClick={event => event.stopPropagation()}
              style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
            >
              <div className="px-4 py-3 border-b border-stone-300">
                <p className="text-sm font-semibold">目录</p>
                <p className="text-[11px] text-stone-500">
                  {openBook.chaptersDetected
                    ? `${openBook.chapters.length} 章`
                    : '这本 TXT 没识别出章节，整本当成一章'}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar">
                {openBook.chapters.map((chapter, index) => (
                  <button
                    key={`${chapter.start}_${index}`}
                    onClick={() => handleJumpChapter(index)}
                    className={`w-full text-left px-4 py-3 text-sm border-b border-stone-200/70 active:bg-stone-200/60 ${index === page.chapterIndex ? 'bg-stone-200/80 font-semibold' : ''}`}
                  >
                    <span className="line-clamp-1">{chapter.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ——— 书架 ———
  return (
    <div className="h-full w-full bg-[#f6f1e7] flex flex-col text-stone-900">
      <div className="shrink-0 border-b border-stone-300 bg-[#f6f1e7]" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="flex items-center px-3 py-3 gap-2">
          <button onClick={closeApp} className="p-2 -ml-1 rounded-full active:scale-90 transition-transform" aria-label="返回">
            <ArrowLeft size={20} weight="bold" className="text-stone-600" />
          </button>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <BookOpenText size={20} weight="fill" /> 共读室
          </h1>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="ml-auto flex items-center gap-1 px-3 py-2 rounded-xl bg-stone-800 text-stone-50 text-sm active:scale-95 transition disabled:opacity-50"
          >
            <Plus size={16} weight="bold" /> {importing ? '导入中…' : '上传 TXT'}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={handlePickFile}
      />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4" style={{ paddingBottom: 'var(--safe-bottom)' }}>
        <div className="mb-4 flex gap-2 rounded-xl bg-stone-800 px-3 py-2.5 text-[11px] leading-relaxed text-stone-100">
          <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-300" />
          <span>
            书只存在这台设备上，<b>不会进备份</b>，清浏览器数据或换设备会丢。
            划线、和角色讨论、归档进记忆宫殿还没做（第二、三期）。
          </span>
        </div>

        {loading && <p className="py-16 text-center text-sm text-stone-400">正在翻开书架…</p>}

        {!loading && books.length === 0 && (
          <div className="py-16 text-center">
            <Books size={48} weight="thin" className="mx-auto text-stone-400" />
            <p className="mt-3 text-sm text-stone-500">书架是空的</p>
            <p className="mt-1 text-xs text-stone-400">点右上角「上传 TXT」放一本进来</p>
          </div>
        )}

        <div className="space-y-2.5">
          {books.map(book => {
            const offset = progressByBook[book.id] || 0;
            const percentOfBook = progressPercent(book, offset);
            return (
              <div key={book.id} className="relative rounded-2xl border border-stone-300 bg-[#fbf7ef] shadow-sm">
                <button onClick={() => handleOpenBook(book)} className="w-full px-4 py-3.5 text-left active:bg-stone-200/40 rounded-2xl">
                  <p className="pr-8 font-semibold leading-snug line-clamp-2">{book.title}</p>
                  <p className="mt-1 text-[11px] text-stone-500">
                    {formatCharCount(book.charCount)}
                    {' · '}
                    {book.chaptersDetected ? `${book.chapters.length} 章` : '无目录'}
                    {' · '}
                    {ENCODING_LABELS[book.encoding]}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-300">
                      <div className="h-full bg-stone-600" style={{ width: `${percentOfBook}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-stone-500">
                      {offset > 0 ? `${percentOfBook}%` : '未开始'}
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => setShowBookMenu(current => (current === book.id ? null : book.id))}
                  className="absolute right-2 top-2.5 p-1.5 rounded-full active:scale-90 transition-transform"
                  aria-label="这本书的更多操作"
                >
                  <DotsThreeVertical size={18} weight="bold" className="text-stone-500" />
                </button>

                {showBookMenu === book.id && (
                  <div className="absolute right-2 top-11 z-20 w-56 overflow-hidden rounded-xl border border-stone-300 bg-white shadow-xl">
                    <button onClick={() => handleRename(book)} className="w-full px-3 py-2.5 text-left text-sm active:bg-stone-100">
                      改书名
                    </button>
                    <div className="border-t border-stone-200 px-3 pt-2 pb-1 text-[10px] text-stone-400">
                      文字乱码时换个编码重读
                    </div>
                    {RETRY_ENCODINGS.map(encoding => (
                      <button
                        key={encoding}
                        onClick={() => handleReopenWithEncoding(book, encoding)}
                        disabled={importing}
                        className={`w-full px-3 py-2 text-left text-xs active:bg-stone-100 disabled:opacity-40 ${book.encoding === encoding ? 'font-semibold text-stone-900' : 'text-stone-600'}`}
                      >
                        {ENCODING_LABELS[encoding]}{book.encoding === encoding ? '（当前）' : ''}
                      </button>
                    ))}
                    <button
                      onClick={() => handleDeleteBook(book)}
                      className="flex w-full items-center gap-1.5 border-t border-stone-200 px-3 py-2.5 text-left text-sm text-red-600 active:bg-red-50"
                    >
                      <Trash size={15} weight="bold" /> 从书架删除
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ReadingRoomApp;