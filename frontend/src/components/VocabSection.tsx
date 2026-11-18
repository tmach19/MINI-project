import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Layers,
  PenTool,
  RotateCw,
  Search,
  Shuffle,
  Volume2,
} from 'lucide-react';
import { soundFx, speakChinese } from '../lib/audio';
import { shuffleArray } from '../lib/constants';
import type { LessonDetail, MarkedVocabRecord, VocabularyItem } from '../types';

interface VocabSectionProps {
  lesson: LessonDetail;
  markedMap: Record<string, MarkedVocabRecord>;
  onToggleMarked: (vocabId: string) => void;
  onOpenWriter: (vocab: VocabularyItem) => void;
  canUseBookmark?: boolean;
  onRequireBookmarkAccess?: () => void;
}

export const VocabSection: React.FC<VocabSectionProps> = ({
  lesson,
  markedMap,
  onToggleMarked,
  onOpenWriter,
  canUseBookmark = true,
  onRequireBookmarkAccess,
}) => {
  const [filter, setFilter] = useState<'all' | 'marked'>('all');
  const [tableMarkedOnly, setTableMarkedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shuffledOrder, setShuffledOrder] = useState<string[] | null>(null);
  const [showCols, setShowCols] = useState({
    pinyin: true,
    hvd: true,
    radical: true,
    meaning: true,
  });

  useEffect(() => {
    setFilter('all');
    setTableMarkedOnly(false);
    setCardIndex(0);
    setFlipped(false);
    setShuffledOrder(null);
  }, [lesson.id]);

  useEffect(() => {
    if (!canUseBookmark) {
      setFilter('all');
      setTableMarkedOnly(false);
    }
  }, [canUseBookmark]);

  const orderedVocab = useMemo(() => {
    const base = lesson.vocabulary || [];
    if (!shuffledOrder) return base;
    const map = new Map(base.map((v) => [v.id, v]));
    return shuffledOrder.map((id) => map.get(id)).filter((v): v is VocabularyItem => Boolean(v));
  }, [lesson.vocabulary, shuffledOrder]);

  // Danh sách riêng cho Flashcard bên trên
  const flashcardList = useMemo(() => {
    if (filter === 'marked') {
      return orderedVocab.filter((v) => Boolean(markedMap[v.id]));
    }
    return orderedVocab;
  }, [orderedVocab, filter, markedMap]);

  // Danh sách riêng cho Bảng từ vựng bên dưới
  const tableList = useMemo(() => {
    let list = lesson.vocabulary || [];
    if (tableMarkedOnly) {
      list = list.filter((v) => Boolean(markedMap[v.id]));
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((v) =>
        [v.hanzi, v.pinyin, v.meaning, v.sinoVietnamese, v.radical]
          .filter(Boolean)
          .some((val) => val!.toLowerCase().includes(q))
      );
    }
    return list;
  }, [lesson.vocabulary, tableMarkedOnly, markedMap, search]);

  const safeIndex = Math.min(cardIndex, Math.max(0, flashcardList.length - 1));
  const currentCard = flashcardList[safeIndex] || null;

  const totalCount = lesson.vocabulary.length;
  const markedCount = lesson.vocabulary.filter((v) => Boolean(markedMap[v.id])).length;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (flashcardList.length === 0) return;

      if (e.code === 'Space') {
        e.preventDefault();
        soundFx.playFlip();
        setFlipped((f) => !f);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        setFlipped(false);
        setCardIndex((i) => (i + 1) % flashcardList.length);
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        setFlipped(false);
        setCardIndex((i) => (i - 1 + flashcardList.length) % flashcardList.length);
      } else if (e.code === 'KeyS' && currentCard) {
        speakChinese(currentCard.hanzi);
      } else if (e.code === 'KeyF' && currentCard) {
        onToggleMarked(currentCard.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flashcardList.length, currentCard, onToggleMarked]);

  const handleShuffle = () => {
    const ids = shuffleArray(lesson.vocabulary.map((v) => v.id));
    setShuffledOrder(ids);
    setCardIndex(0);
    setFlipped(false);
  };

  const isCurrentMarked = currentCard ? Boolean(markedMap[currentCard.id]) : false;

  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="bg-gradient-to-r from-red-500 via-rose-500 to-amber-500 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <Layers className="w-3.5 h-3.5" /> Module 1: Từ vựng, Chiết tự & Tập viết
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">Thẻ ghi nhớ & Luyện viết chữ Hán</h2>
          <p className="text-white/90 text-sm mt-1">
            Lật thẻ xem Pinyin, Hán Việt, Bộ thủ, tập viết đúng thứ tự nét và gắn cờ các từ cần nhớ kỹ.
          </p>
        </div>

        <div className="flex items-center gap-5 bg-white/10 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20">
          <div className="text-center">
            <span className="text-3xl font-black">{totalCount}</span>
            <p className="text-xs text-white/80 uppercase font-medium">Tổng từ</p>
          </div>
          <div className="w-px h-10 bg-white/30" />
          <div className="text-center">
            <span className="text-3xl font-black text-amber-200">{markedCount}</span>
            <p className="text-xs text-white/80 uppercase font-medium">Đã gắn cờ</p>
          </div>
        </div>
      </div>

      {/* Flashcard Area */}
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
          <div className="inline-flex bg-stone-200/70 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => {
                setFilter('all');
                setCardIndex(0);
                setFlipped(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === 'all'
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Tất cả ({totalCount})
            </button>
            <button
              onClick={() => {
                if (!canUseBookmark) {
                  onRequireBookmarkAccess?.();
                  return;
                }
                setFilter('marked');
                setCardIndex(0);
                setFlipped(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                filter === 'marked'
                  ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-gray-600 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400'
              }`}
              title="Xem các thẻ đã gắn cờ trong bài này"
            >
              <Flag className={`w-3.5 h-3.5 ${filter === 'marked' || markedCount > 0 ? 'fill-current text-amber-500' : ''}`} />
              <span>({markedCount})</span>
            </button>
          </div>

          <button
            onClick={handleShuffle}
            className="px-3 py-1.5 text-gray-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition text-xs font-semibold flex items-center gap-1.5 active:scale-95"
          >
            <Shuffle className="w-3.5 h-3.5" /> Xáo trộn
          </button>
        </div>

        {!currentCard ? (
          <div className="h-80 bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 flex flex-col items-center justify-center p-6 text-center">
            <Search className="w-10 h-10 text-gray-300 dark:text-slate-600 mb-3" />
            <p className="text-gray-500 dark:text-slate-400 font-medium text-sm">
              Không có từ vựng nào khớp với từ khóa tìm kiếm.
            </p>
          </div>
        ) : (
          <>
            <div className="flashcard-container select-none">
              <div
                className={`flashcard-inner ${flipped ? 'flipped' : ''}`}
                onClick={() => {
                  soundFx.playFlip();
                  setFlipped((f) => !f);
                }}
              >
                {/* FRONT */}
                <div className="flashcard-front bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 shadow-xl p-4 sm:p-6 md:p-8 flex flex-col justify-between">
                  <div className="w-full flex items-start sm:items-center justify-between text-xs gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 flex-1">
                      <span className="font-semibold px-2.5 py-1 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md whitespace-nowrap">
                        {currentCard.type || 'Từ vựng'}
                      </span>
                      {currentCard.radical && (
                        <span className="px-2.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-md font-medium border border-amber-200/60 dark:border-amber-800/50 max-w-full sm:max-w-[240px] truncate min-w-0">
                          Bộ: {currentCard.radical}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                      <span className="font-mono text-gray-400 font-medium whitespace-nowrap">
                        {safeIndex + 1} / {flashcardList.length}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMarked(currentCard.id);
                        }}
                        className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl flex items-center gap-1 text-xs font-bold border transition active:scale-95 whitespace-nowrap flex-shrink-0 ${
                          isCurrentMarked
                            ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 text-amber-700 dark:text-amber-300'
                            : 'bg-stone-50 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-gray-500 dark:text-slate-300 hover:text-amber-600 hover:border-amber-400 dark:hover:bg-amber-900/30 dark:hover:text-amber-300 dark:hover:border-amber-500'
                        }`}
                        title="Đánh dấu thẻ này để xem lại ở tab Cờ (F)"
                      >
                        <Flag className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrentMarked ? 'fill-current' : ''}`} />
                        <span>{isCurrentMarked ? 'Đã đánh dấu' : 'Đánh dấu'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="my-auto flex flex-col items-center py-3 sm:py-4 px-2">
                    <div className="text-5xl sm:text-6xl md:text-8xl font-bold chinese-serif text-gray-900 dark:text-white tracking-wide text-center break-all hover:scale-105 transition-transform">
                      {currentCard.hanzi}
                    </div>
                  </div>

                  <div className="w-full flex items-center justify-between gap-2 text-xs border-t border-stone-100 dark:border-slate-800 pt-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          speakChinese(currentCard.hanzi);
                        }}
                        className="flex items-center gap-1.5 text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200/70 dark:border-red-800/60 hover:bg-red-100 dark:hover:bg-red-900/50 dark:hover:text-red-200 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                      >
                        <Volume2 className="w-3.5 h-3.5" /> Phát âm (S)
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenWriter(currentCard);
                        }}
                        className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 dark:hover:text-amber-200 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                      >
                        <PenTool className="w-3.5 h-3.5" /> Tập viết nét
                      </button>
                    </div>
                    <span className="text-gray-400 dark:text-slate-500 flex items-center gap-1 whitespace-nowrap">
                      <RotateCw className="w-3 h-3" /> Bấm thẻ / Space để lật
                    </span>
                  </div>
                </div>

                {/* BACK */}
                <div className="flashcard-back bg-gradient-to-br from-amber-50 to-orange-50 dark:from-slate-800 dark:to-slate-900 border border-amber-200 dark:border-slate-700 shadow-xl p-4 sm:p-6 md:p-8 flex flex-col justify-between">
                  <div className="w-full flex items-center justify-between gap-2 flex-wrap text-xs text-amber-800 dark:text-amber-300">
                    <span className="font-semibold px-2.5 py-1 bg-amber-200/60 dark:bg-amber-900/40 rounded-md">
                      Pinyin, Hán Việt &amp; Chiết tự
                    </span>
                    <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                      <span className="font-mono font-medium whitespace-nowrap">
                        {safeIndex + 1} / {flashcardList.length}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMarked(currentCard.id);
                        }}
                        className={`p-1.5 rounded-lg border transition flex-shrink-0 ${
                          isCurrentMarked
                            ? 'bg-amber-200/80 dark:bg-amber-900/50 border-amber-400 text-amber-800 dark:text-amber-200'
                            : 'bg-white/70 dark:bg-slate-800 border-amber-200 dark:border-slate-700 text-gray-500'
                        }`}
                        title="Đánh dấu thẻ này (F)"
                      >
                        <Flag className={`w-3.5 h-3.5 ${isCurrentMarked ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  </div>

                  <div className="my-2 flex-1 min-h-0 flex flex-col items-center w-full py-1 space-y-2.5 overflow-y-auto">
                    <div className="text-center">
                      <div className="flex items-baseline justify-center gap-3 flex-wrap">
                        <span className="text-3xl font-bold chinese-serif text-gray-900 dark:text-white">
                          {currentCard.hanzi}
                        </span>
                        <span className="text-xl font-semibold text-red-600 dark:text-red-400 font-mono">
                          {currentCard.pinyin}
                        </span>
                      </div>
                      {currentCard.sinoVietnamese && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 uppercase tracking-widest font-semibold">
                          Hán Việt: [ {currentCard.sinoVietnamese} ]
                        </div>
                      )}
                      <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                        {currentCard.meaning}
                      </div>
                    </div>

                    <div className="w-full bg-white/95 dark:bg-slate-900/90 p-4 rounded-2xl border border-amber-200 dark:border-slate-700 text-left space-y-1.5 text-xs">
                      {currentCard.radical && (
                        <p className="text-gray-800 dark:text-slate-200">
                          <span className="font-bold text-amber-800 dark:text-amber-400">Bộ thủ:</span>{' '}
                          {currentCard.radical}
                        </p>
                      )}
                      {currentCard.breakdown && (
                        <p className="text-gray-700 dark:text-slate-300">
                          <span className="font-bold text-amber-800 dark:text-amber-400">Cấu tạo:</span>{' '}
                          {currentCard.breakdown}
                        </p>
                      )}
                      {currentCard.mnemonic && (
                        <p className="text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-xl">
                          💡 <span className="font-bold">Mẹo nhớ:</span> {currentCard.mnemonic}
                        </p>
                      )}
                      {currentCard.example && (
                        <div className="pt-1 border-t border-stone-100 dark:border-slate-800">
                          <p className="chinese-font font-semibold text-gray-900 dark:text-white">
                            {currentCard.example}
                          </p>
                          {currentCard.examplePinyin && (
                            <p className="font-mono text-red-600 dark:text-red-400">{currentCard.examplePinyin}</p>
                          )}
                          {currentCard.exampleMeaning && (
                            <p className="text-gray-500 dark:text-slate-400 italic">{currentCard.exampleMeaning}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-[11px] text-center text-amber-800/70 dark:text-slate-400 pt-2 border-t border-amber-200/50 dark:border-slate-800">
                    Bấm phím F hoặc biểu tượng lá cờ để đánh dấu thẻ cần xem lại
                  </div>
                </div>
              </div>
            </div>

            {/* Simple Navigation */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setFlipped(false);
                  setCardIndex((i) => (i - 1 + flashcardList.length) % flashcardList.length);
                }}
                className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-xs font-bold text-gray-700 dark:text-slate-200 hover:bg-stone-50 dark:hover:bg-slate-800 hover:border-stone-300 dark:hover:border-slate-500 dark:hover:text-white flex items-center gap-1 transition active:scale-95"
              >
                <ChevronLeft className="w-4 h-4" /> Trước (A)
              </button>

              <button
                onClick={() => {
                  setFlipped(false);
                  setCardIndex((i) => (i + 1) % flashcardList.length);
                }}
                className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-xs font-bold text-gray-700 dark:text-slate-200 hover:bg-stone-50 dark:hover:bg-slate-800 hover:border-stone-300 dark:hover:border-slate-500 dark:hover:text-white flex items-center gap-1 transition active:scale-95"
              >
                Tiếp (D) <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Vocabulary Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-stone-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 flex-grow max-w-xl flex-wrap sm:flex-nowrap">
            <div className="relative flex-grow w-full sm:w-auto">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Lọc từ vựng trong buổi học này..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
              />
            </div>

            <button
              onClick={() => {
                if (!canUseBookmark) {
                  onRequireBookmarkAccess?.();
                  return;
                }
                setTableMarkedOnly((m) => !m);
              }}
              className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 transition active:scale-95 ${
                tableMarkedOnly
                  ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 text-amber-700 dark:text-amber-300 shadow-xs'
                  : 'bg-stone-50 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-amber-400 hover:text-amber-600 dark:hover:bg-amber-900/30 dark:hover:border-amber-500 dark:hover:text-amber-300'
              }`}
              title="Chỉ hiện các từ đã đánh dấu cờ trong bảng"
            >
              <Flag
                className={`w-3.5 h-3.5 ${tableMarkedOnly || markedCount > 0 ? 'fill-current text-amber-500' : ''}`}
              />
              <span>Đã đánh dấu ({markedCount})</span>
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs">
            {(
              [
                ['pinyin', 'Pinyin'],
                ['hvd', 'Hán Việt'],
                ['radical', 'Bộ thủ'],
                ['meaning', 'Nghĩa'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-gray-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={showCols[key]}
                  onChange={() => setShowCols((s) => ({ ...s, [key]: !s[key] }))}
                  className="rounded text-red-600"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-stone-50 dark:bg-slate-800/70 text-gray-500 dark:text-slate-400 uppercase font-bold">
              <tr>
                <th className="p-4">#</th>
                <th className="p-4">Hán tự</th>
                {showCols.pinyin && <th className="p-4">Pinyin</th>}
                {showCols.hvd && <th className="p-4">Hán Việt</th>}
                {showCols.radical && <th className="p-4">Bộ thủ / Mẹo</th>}
                {showCols.meaning && <th className="p-4">Nghĩa tiếng Việt</th>}
                <th className="p-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
              {tableList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-slate-400">
                    Không có từ vựng nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                tableList.map((v, idx) => {
                  const isMarked = Boolean(markedMap[v.id]);
                  return (
                    <tr
                      key={v.id}
                      className="hover:bg-stone-50/70 dark:hover:bg-slate-800/40 transition"
                    >
                      <td className="p-4 text-gray-400 font-mono">{idx + 1}</td>
                      <td className="p-4">
                        <span className="chinese-serif text-lg font-bold text-gray-900 dark:text-white">
                          {v.hanzi}
                        </span>
                      </td>
                      {showCols.pinyin && (
                        <td className="p-4 font-mono font-semibold text-red-600 dark:text-red-400">
                          {v.pinyin}
                        </td>
                      )}
                      {showCols.hvd && (
                        <td className="p-4 uppercase text-amber-700 dark:text-amber-400 font-semibold">
                          {v.sinoVietnamese || '—'}
                        </td>
                      )}
                      {showCols.radical && (
                        <td className="p-4 text-gray-600 dark:text-slate-300 max-w-xs">
                          {v.radical || '—'}
                        </td>
                      )}
                      {showCols.meaning && (
                        <td className="p-4 font-medium text-gray-800 dark:text-slate-200 max-w-xs">
                          {v.meaning}
                        </td>
                      )}
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => speakChinese(v.hanzi)}
                            className="p-1.5 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-900/40 text-gray-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-300 dark:hover:border-red-700 transition active:scale-95"
                            title="Phát âm"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onOpenWriter(v)}
                            className="p-1.5 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-900/40 text-gray-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-300 dark:hover:border-amber-700 transition active:scale-95"
                            title="Tập viết chữ Hán"
                          >
                            <PenTool className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onToggleMarked(v.id)}
                            className={`p-1.5 rounded-lg border transition active:scale-95 ${
                              isMarked
                                ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-600 text-amber-600 dark:text-amber-300'
                                : 'bg-stone-100 dark:bg-slate-800 border-transparent dark:border-slate-700 text-gray-400 dark:text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/40 hover:text-amber-600 dark:hover:text-amber-300 dark:hover:border-amber-700'
                            }`}
                            title={isMarked ? 'Bỏ đánh dấu' : 'Đánh dấu xem lại'}
                          >
                            <Flag className={`w-3.5 h-3.5 ${isMarked ? 'fill-current' : ''}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
