import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Layers,
  PenTool,
  RotateCw,
  Search,
  Shuffle,
  Volume2,
} from 'lucide-react';
import { getEnAudioUrl, getEnImageUrl } from '../languages/config';
import { soundFx, speakChinese, speakEnglish } from '../lib/audio';
import { shuffleArray } from '../lib/constants';
import { EnglishMeaningLines, groupEnglishMeaningsByPos } from './common/EnglishMeaningLines';
import { VocabDetailModal } from './common/VocabDetailModal';
import type { LanguageCode, LessonDetail, MarkedVocabRecord, VocabularyItem } from '../types';

const preloadedImageUrls = new Set<string>();
const preloadedImagePool: HTMLImageElement[] = [];

function preloadImage(url: string | null): void {
  if (!url || typeof window === 'undefined' || preloadedImageUrls.has(url)) return;
  preloadedImageUrls.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  preloadedImagePool.push(img);
  if (preloadedImagePool.length > 120) {
    preloadedImagePool.shift();
  }
}

interface VocabSectionProps {
  lang?: LanguageCode;
  lesson: LessonDetail;
  markedMap: Record<string, MarkedVocabRecord>;
  onToggleMarked: (vocabId: string) => void;
  onOpenWriter?: (vocab: VocabularyItem) => void;
  onOpenAiDictionary?: (word: string) => void;
  canUseBookmark?: boolean;
  onRequireBookmarkAccess?: () => void;
}

function scoreClientVocabQuality(v: VocabularyItem): number {
  let score = 0;
  if (/^v\d+_\d+$/.test(v.id)) score += 100;
  if (v.sinoVietnamese && v.sinoVietnamese.trim()) score += 40;
  if (v.radical && !/^Bộ cấu tạo\s*\[/i.test(v.radical.trim())) score += 30;
  if (v.breakdown && !/^Ghép từ các chữ Hán:/i.test(v.breakdown.trim())) score += 15;
  if (v.mnemonic && v.mnemonic.trim()) score += 10;
  if (v.example && !/这是关于.*的常用句子/.test(v.example)) score += 10;
  return score;
}

export const VocabSection: React.FC<VocabSectionProps> = ({
  lang,
  lesson,
  markedMap,
  onToggleMarked,
  onOpenWriter,
  onOpenAiDictionary,
  canUseBookmark = true,
  onRequireBookmarkAccess,
}) => {
  const isEnglish = lang === 'en' || lesson.languageCode === 'en';
  const effectiveLang: LanguageCode = isEnglish ? 'en' : 'zh';
  const [filter, setFilter] = useState<'all' | 'marked'>('all');
  const [tableMarkedOnly, setTableMarkedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shuffledOrder, setShuffledOrder] = useState<string[] | null>(null);
  const [selectedVocabId, setSelectedVocabId] = useState<string | null>(null);
  const [failedThumbIds, setFailedThumbIds] = useState<Record<string, boolean>>({});
  const [cardImgError, setCardImgError] = useState(false);
  const [showCols, setShowCols] = useState({
    pinyin: true,
    hvd: true,
    meaning: true,
  });

  const playVocabWord = (v: VocabularyItem, accent: 'us' | 'uk' = 'us') => {
    if (isEnglish) {
      speakEnglish(v.hanzi, { accent, audioUrl: getEnAudioUrl(v.meta, accent) });
      return;
    }
    speakChinese(v.hanzi);
  };

  useEffect(() => {
    setFilter('all');
    setTableMarkedOnly(false);
    setCardIndex(0);
    setFlipped(false);
    setShuffledOrder(null);
    setSelectedVocabId(null);
  }, [lesson.id]);

  useEffect(() => {
    if (!canUseBookmark) {
      setFilter('all');
      setTableMarkedOnly(false);
    }
  }, [canUseBookmark]);

  // Đảm bảo mỗi từ Hán tự chỉ xuất hiện duy nhất 1 dòng với bản ghi đầy đủ nhất
  const baseVocab = useMemo(() => {
    const raw = lesson.vocabulary || [];
    const byHanzi = new Map<string, { index: number; item: VocabularyItem }>();
    const ordered: Array<VocabularyItem | null> = [];
    for (const item of raw) {
      const key = (item.hanzi || '').trim();
      if (!key) continue;
      const existing = byHanzi.get(key);
      if (!existing) {
        byHanzi.set(key, { index: ordered.length, item });
        ordered.push(item);
      } else if (scoreClientVocabQuality(item) > scoreClientVocabQuality(existing.item)) {
        ordered[existing.index] = item;
        byHanzi.set(key, { index: existing.index, item });
      }
    }
    return ordered.filter((x): x is VocabularyItem => Boolean(x));
  }, [lesson.vocabulary]);

  const orderedVocab = useMemo(() => {
    if (!shuffledOrder) return baseVocab;
    const map = new Map(baseVocab.map((v) => [v.id, v]));
    return shuffledOrder.map((id) => map.get(id)).filter((v): v is VocabularyItem => Boolean(v));
  }, [baseVocab, shuffledOrder]);

  // Danh sách riêng cho Flashcard bên trên
  const flashcardList = useMemo(() => {
    if (filter === 'marked') {
      return orderedVocab.filter((v) => Boolean(markedMap[v.id]));
    }
    return orderedVocab;
  }, [orderedVocab, filter, markedMap]);

  // Danh sách riêng cho Bảng từ vựng bên dưới
  const tableList = useMemo(() => {
    let list = baseVocab;
    if (tableMarkedOnly) {
      list = list.filter((v) => Boolean(markedMap[v.id]));
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((v) =>
        [v.hanzi, v.pinyin, v.meaning, v.sinoVietnamese]
          .filter(Boolean)
          .some((val) => val!.toLowerCase().includes(q))
      );
    }
    return list;
  }, [baseVocab, tableMarkedOnly, markedMap, search]);

  const safeIndex = Math.min(cardIndex, Math.max(0, flashcardList.length - 1));
  const currentCard = flashcardList[safeIndex] || null;

  useEffect(() => {
    setCardImgError(false);
  }, [currentCard?.id]);

  // Preload ưu tiên ảnh của 4 thẻ kế tiếp & thẻ trước đó + ảnh full của thẻ hiện tại (cho modal Xem chi tiết)
  useEffect(() => {
    if (!isEnglish || flashcardList.length === 0) return;
    const offsets = [0, 1, 2, 3, 4, -1];
    for (const offset of offsets) {
      const idx = (safeIndex + offset + flashcardList.length) % flashcardList.length;
      const item = flashcardList[idx];
      if (item) preloadImage(getEnImageUrl(item.meta, 'thumb'));
    }
    if (currentCard) {
      preloadImage(getEnImageUrl(currentCard.meta, 'full'));
    }
  }, [isEnglish, flashcardList, safeIndex, currentCard]);

  // Khi vào bài mới, tải ngầm nhẹ toàn bộ ảnh thumb của bài (~25 ảnh × 10KB ≈ 250KB) khi trình duyệt rảnh
  useEffect(() => {
    if (!isEnglish || baseVocab.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const item of baseVocab) {
        preloadImage(getEnImageUrl(item.meta, 'thumb'));
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isEnglish, baseVocab]);

  const totalCount = baseVocab.length;
  const markedCount = baseVocab.filter((v) => Boolean(markedMap[v.id])).length;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedVocabId) return;
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
        playVocabWord(currentCard, 'us');
      } else if (e.code === 'KeyF' && currentCard) {
        onToggleMarked(currentCard.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedVocabId, flashcardList.length, currentCard, onToggleMarked, isEnglish]);

  const handleShuffle = () => {
    const ids = shuffleArray(baseVocab.map((v) => v.id));
    setShuffledOrder(ids);
    setCardIndex(0);
    setFlipped(false);
  };

  const detailNavList = useMemo(() => {
    if (!selectedVocabId) return tableList;
    if (tableList.some((v) => v.id === selectedVocabId)) return tableList;
    return baseVocab;
  }, [selectedVocabId, tableList, baseVocab]);

  const detailIndex = useMemo(
    () => (selectedVocabId ? detailNavList.findIndex((v) => v.id === selectedVocabId) : -1),
    [detailNavList, selectedVocabId]
  );

  const selectedVocab =
    detailIndex >= 0
      ? detailNavList[detailIndex]
      : selectedVocabId
        ? baseVocab.find((v) => v.id === selectedVocabId) || null
        : null;

  const isCurrentMarked = currentCard ? Boolean(markedMap[currentCard.id]) : false;

  return (
    <div className="space-y-8">
      {/* Banner */}
      <div
        className={`rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 ${
          isEnglish
            ? 'bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500'
            : 'bg-gradient-to-r from-red-500 via-rose-500 to-amber-500'
        }`}
      >
        <div>
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <Layers className="w-3.5 h-3.5" />{' '}
            {isEnglish
              ? 'Module 1: Từ vựng, Phát âm UK/US & Minh họa'
              : 'Module 1: Từ vựng, Chiết tự & Tập viết'}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">
            {isEnglish ? 'Thẻ ghi nhớ & Từ vựng Tiếng Anh' : 'Thẻ ghi nhớ & Luyện viết chữ Hán'}
          </h2>
          <p className="text-white/90 text-sm mt-1">
            {isEnglish
              ? 'Lật thẻ xem phiên âm IPA UK/US, định nghĩa Anh–Việt, collocations, nghe phát âm chuẩn và gắn cờ các từ cần nhớ kỹ.'
              : 'Lật thẻ xem Pinyin, Hán Việt, Bộ thủ, tập viết đúng thứ tự nét và gắn cờ các từ cần nhớ kỹ.'}
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
                      <span
                        className={`font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${
                          isEnglish
                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {isEnglish
                          ? groupEnglishMeaningsByPos(currentCard)
                              .map((r) => r.pos)
                              .filter(Boolean)
                              .join(' · ') ||
                            currentCard.type ||
                            'Từ vựng'
                          : currentCard.type || 'Từ vựng'}
                      </span>
                      {isEnglish ? (
                        <>
                          {(currentCard.meta?.cefr || currentCard.sinoVietnamese) && (
                            <span className="px-2 py-1 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 rounded-md font-bold border border-sky-200/60 dark:border-sky-800/50">
                              {currentCard.meta?.cefr || currentCard.sinoVietnamese}
                            </span>
                          )}
                          {currentCard.meta?.topic && (
                            <span className="px-2 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-md font-medium border border-emerald-200/60 dark:border-emerald-800/50 max-w-[180px] truncate">
                              {currentCard.meta.topic}
                            </span>
                          )}
                        </>
                      ) : (
                        currentCard.radical &&
                        !/^Bộ cấu tạo\s*\[/i.test(currentCard.radical.trim()) && (
                          <span className="px-2.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-md font-medium border border-amber-200/60 dark:border-amber-800/50 max-w-full sm:max-w-[240px] truncate min-w-0">
                            Bộ: {currentCard.radical}
                          </span>
                        )
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

                  <div className="my-auto flex flex-col items-center py-2 sm:py-4 px-2 gap-2.5">
                    {isEnglish && getEnImageUrl(currentCard.meta, 'thumb') && !cardImgError && (
                      <img
                        key={currentCard.id}
                        src={getEnImageUrl(currentCard.meta, 'thumb')!}
                        alt={currentCard.hanzi}
                        loading="eager"
                        decoding="async"
                        onError={() => setCardImgError(true)}
                        className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border border-stone-200 dark:border-slate-700 shadow-sm bg-stone-50 dark:bg-slate-800"
                      />
                    )}
                    <div
                      className={
                        isEnglish
                          ? 'text-4xl sm:text-5xl md:text-6xl font-black text-gray-900 dark:text-white tracking-tight text-center break-words hover:scale-105 transition-transform'
                          : 'text-5xl sm:text-6xl md:text-8xl font-bold chinese-serif text-gray-900 dark:text-white tracking-wide text-center break-all hover:scale-105 transition-transform'
                      }
                    >
                      {currentCard.hanzi}
                    </div>
                    {isEnglish && currentCard.pinyin && (
                      <div className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                        {currentCard.pinyin}
                      </div>
                    )}
                  </div>

                  <div className="w-full flex items-center justify-between gap-2 text-xs border-t border-stone-100 dark:border-slate-800 pt-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isEnglish ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playVocabWord(currentCard, 'us');
                            }}
                            className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200/70 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                          >
                            <Volume2 className="w-3.5 h-3.5" /> US (S)
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playVocabWord(currentCard, 'uk');
                            }}
                            className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/30 border border-sky-200/70 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/50 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                          >
                            <Volume2 className="w-3.5 h-3.5" /> UK
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              speakChinese(currentCard.hanzi);
                            }}
                            className="flex items-center gap-1.5 text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200/70 dark:border-red-800/60 hover:bg-red-100 dark:hover:bg-red-900/50 dark:hover:text-red-200 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                          >
                            <Volume2 className="w-3.5 h-3.5" /> Phát âm (S)
                          </button>
                          {onOpenWriter && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenWriter(currentCard);
                              }}
                              className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 dark:hover:text-amber-200 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                            >
                              <PenTool className="w-3.5 h-3.5" /> Tập viết nét
                            </button>
                          )}
                        </>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVocabId(currentCard.id);
                        }}
                        className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 border border-purple-200/70 dark:border-purple-800/60 hover:bg-purple-100 dark:hover:bg-purple-900/50 dark:hover:text-purple-200 px-3 py-1.5 rounded-lg font-semibold transition active:scale-95 whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" /> Xem chi tiết
                      </button>
                    </div>
                    <span className="text-gray-400 dark:text-slate-500 flex items-center gap-1 whitespace-nowrap">
                      <RotateCw className="w-3 h-3" /> Bấm thẻ / Space để lật
                    </span>
                  </div>
                </div>

                {/* BACK */}
                <div
                  className={`flashcard-back shadow-xl p-4 sm:p-6 md:p-8 flex flex-col justify-between ${
                    isEnglish
                      ? 'bg-gradient-to-br from-indigo-50 to-sky-50 dark:from-slate-800 dark:to-slate-900 border border-indigo-200 dark:border-slate-700'
                      : 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-slate-800 dark:to-slate-900 border border-amber-200 dark:border-slate-700'
                  }`}
                >
                  <div
                    className={`w-full flex items-center justify-between gap-2 flex-wrap text-xs ${
                      isEnglish
                        ? 'text-indigo-800 dark:text-indigo-300'
                        : 'text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    <span
                      className={`font-semibold px-2.5 py-1 rounded-md ${
                        isEnglish
                          ? 'bg-indigo-200/60 dark:bg-indigo-900/40'
                          : 'bg-amber-200/60 dark:bg-amber-900/40'
                      }`}
                    >
                      {isEnglish ? 'Phiên âm IPA, Định nghĩa & Ví dụ' : 'Pinyin, Hán Việt & Chiết tự'}
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
                        <span
                          className={`${
                            isEnglish ? 'tracking-tight' : 'chinese-serif'
                          } text-3xl font-bold text-gray-900 dark:text-white`}
                        >
                          {currentCard.hanzi}
                        </span>
                        <span
                          className={`text-base sm:text-lg font-semibold font-mono ${
                            isEnglish
                              ? 'text-indigo-600 dark:text-indigo-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {isEnglish && currentCard.meta?.usIpa
                            ? `US ${currentCard.meta.usIpa}${
                                currentCard.meta.ukIpa &&
                                currentCard.meta.ukIpa !== currentCard.meta.usIpa
                                  ? ` · UK ${currentCard.meta.ukIpa}`
                                  : ''
                              }`
                            : currentCard.pinyin}
                        </span>
                      </div>
                      {!isEnglish && currentCard.sinoVietnamese && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 uppercase tracking-widest font-semibold">
                          Hán Việt: [ {currentCard.sinoVietnamese} ]
                        </div>
                      )}
                      {isEnglish ? (
                        <div className="mt-1.5">
                          <EnglishMeaningLines vocab={currentCard} size="lg" centered />
                        </div>
                      ) : (
                        <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                          {currentCard.meaning}
                        </div>
                      )}
                      {isEnglish && currentCard.meta?.senses?.[0]?.en && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 italic mt-0.5">
                          {currentCard.meta.senses[0].en}
                        </div>
                      )}
                    </div>

                    <div
                      className={`w-full bg-white/95 dark:bg-slate-900/90 p-4 rounded-2xl border text-left space-y-1.5 text-xs ${
                        isEnglish
                          ? 'border-indigo-200 dark:border-slate-700'
                          : 'border-amber-200 dark:border-slate-700'
                      }`}
                    >
                      {currentCard.radical && (
                        <p className="text-gray-800 dark:text-slate-200">
                          <span
                            className={`font-bold ${
                              isEnglish
                                ? 'text-indigo-700 dark:text-indigo-400'
                                : 'text-amber-800 dark:text-amber-400'
                            }`}
                          >
                            {isEnglish ? 'Họ từ:' : 'Bộ thủ:'}
                          </span>{' '}
                          {currentCard.radical}
                        </p>
                      )}
                      {currentCard.breakdown && (
                        <p className="text-gray-700 dark:text-slate-300">
                          <span
                            className={`font-bold ${
                              isEnglish
                                ? 'text-indigo-700 dark:text-indigo-400'
                                : 'text-amber-800 dark:text-amber-400'
                            }`}
                          >
                            {isEnglish ? 'Liên quan:' : 'Cấu tạo:'}
                          </span>{' '}
                          {currentCard.breakdown}
                        </p>
                      )}
                      {(currentCard.meta?.tipVi || currentCard.mnemonic) && (
                        <p className="text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-xl">
                          💡 <span className="font-bold">Mẹo nhớ:</span>{' '}
                          {currentCard.meta?.tipVi || currentCard.mnemonic}
                        </p>
                      )}
                      {currentCard.example && (
                        <div className="pt-1 border-t border-stone-100 dark:border-slate-800 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p
                              className={`${
                                isEnglish ? '' : 'chinese-font'
                              } font-semibold text-gray-900 dark:text-white`}
                            >
                              {currentCard.example}
                            </p>
                            {!isEnglish && currentCard.examplePinyin && (
                              <p className="font-mono text-red-600 dark:text-red-400">
                                {currentCard.examplePinyin}
                              </p>
                            )}
                            {currentCard.exampleMeaning && (
                              <p className="text-gray-500 dark:text-slate-400 italic">
                                {currentCard.exampleMeaning}
                              </p>
                            )}
                          </div>
                          {isEnglish && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                speakEnglish(currentCard.example!, {
                                  accent: 'us',
                                  audioUrl: getEnAudioUrl(currentCard.meta, 'ex'),
                                });
                              }}
                              className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 shrink-0"
                              title="Nghe câu ví dụ"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
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
                ['pinyin', isEnglish ? 'Phiên âm IPA' : 'Pinyin'],
                ['hvd', isEnglish ? 'CEFR' : 'Hán Việt'],
                ['meaning', 'Nghĩa'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-gray-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={showCols[key]}
                  onChange={() => setShowCols((s) => ({ ...s, [key]: !s[key] }))}
                  className={`rounded ${isEnglish ? 'text-indigo-600' : 'text-red-600'}`}
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
                <th className="p-4">{isEnglish ? 'Từ tiếng Anh' : 'Hán tự'}</th>
                {showCols.pinyin && <th className="p-4">{isEnglish ? 'Phiên âm IPA' : 'Pinyin'}</th>}
                {showCols.hvd && <th className="p-4">{isEnglish ? 'CEFR' : 'Hán Việt'}</th>}
                {showCols.meaning && <th className="p-4">Nghĩa tiếng Việt</th>}
                <th className="p-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
              {tableList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500 dark:text-slate-400">
                    Không có từ vựng nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                tableList.map((v, idx) => {
                  const isMarked = Boolean(markedMap[v.id]);
                  const thumbUrl = isEnglish ? getEnImageUrl(v.meta, 'thumb') : null;
                  return (
                    <tr
                      key={v.id}
                      className="hover:bg-stone-50/70 dark:hover:bg-slate-800/40 transition"
                    >
                      <td className="p-4 text-gray-400 font-mono">{idx + 1}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2.5">
                          {thumbUrl && !failedThumbIds[v.id] && (
                            <img
                              src={thumbUrl}
                              alt={v.hanzi}
                              loading="lazy"
                              onError={() =>
                                setFailedThumbIds((prev) => ({ ...prev, [v.id]: true }))
                              }
                              onClick={() => setSelectedVocabId(v.id)}
                              className="w-10 h-10 rounded-xl object-cover border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 shrink-0 cursor-pointer hover:scale-105 transition"
                            />
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setSelectedVocabId(v.id)}
                              className={`${
                                isEnglish ? 'text-base tracking-tight' : 'chinese-serif text-lg'
                              } font-bold text-gray-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 underline decoration-dotted underline-offset-4 decoration-stone-300 dark:decoration-slate-700 hover:decoration-purple-400 transition text-left`}
                              title={`Xem chi tiết từ "${v.hanzi}"`}
                            >
                              {v.hanzi}
                            </button>
                            {!isEnglish && v.type && v.type !== 'Từ vựng' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hidden sm:inline">
                                {v.type}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {showCols.pinyin && (
                        <td
                          className={`p-4 font-mono font-semibold ${
                            isEnglish
                              ? 'text-indigo-600 dark:text-indigo-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {v.pinyin}
                        </td>
                      )}
                      {showCols.hvd && (
                        <td className="p-4 uppercase font-semibold">
                          {isEnglish ? (
                            <span className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-[11px]">
                              {v.meta?.cefr || v.sinoVietnamese || 'A1'}
                            </span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400">
                              {v.sinoVietnamese || '—'}
                            </span>
                          )}
                        </td>
                      )}
                      {showCols.meaning && (
                        <td className="p-4 font-medium text-gray-800 dark:text-slate-200 max-w-md whitespace-pre-line">
                          {isEnglish ? <EnglishMeaningLines vocab={v} /> : v.meaning}
                        </td>
                      )}
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedVocabId(v.id)}
                            className="p-1.5 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-purple-600 dark:text-purple-400 dark:hover:border-purple-700 transition active:scale-95"
                            title="Xem chi tiết từ vựng"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {isEnglish ? (
                            <>
                              <button
                                type="button"
                                onClick={() => playVocabWord(v, 'us')}
                                className="px-2 py-1 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 text-gray-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-300 font-bold text-[10px] inline-flex items-center gap-0.5 transition active:scale-95"
                                title="Phát âm giọng Mỹ (US)"
                              >
                                <Volume2 className="w-3 h-3" /> US
                              </button>
                              <button
                                type="button"
                                onClick={() => playVocabWord(v, 'uk')}
                                className="px-2 py-1 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-sky-900/40 text-gray-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-300 font-bold text-[10px] inline-flex items-center gap-0.5 transition active:scale-95"
                                title="Phát âm giọng Anh (UK)"
                              >
                                <Volume2 className="w-3 h-3" /> UK
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => speakChinese(v.hanzi)}
                                className="p-1.5 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-900/40 text-gray-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-300 dark:hover:border-red-700 transition active:scale-95"
                                title="Phát âm"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                              {onOpenWriter && (
                                <button
                                  type="button"
                                  onClick={() => onOpenWriter(v)}
                                  className="p-1.5 rounded-lg bg-stone-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-900/40 text-gray-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-300 dark:hover:border-amber-700 transition active:scale-95"
                                  title="Tập viết chữ Hán"
                                >
                                  <PenTool className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                          <button
                            type="button"
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

      {/* Modal Xem chi tiết từ vựng trong buổi học */}
      {selectedVocab && (
        <VocabDetailModal
          lang={effectiveLang}
          vocab={selectedVocab}
          lessonTitle={lesson.title}
          currentIndex={detailIndex}
          totalCount={detailNavList.length}
          onPrev={
            detailNavList.length > 1 && detailIndex >= 0
              ? () => {
                  const prev =
                    detailNavList[(detailIndex - 1 + detailNavList.length) % detailNavList.length];
                  if (prev) setSelectedVocabId(prev.id);
                }
              : undefined
          }
          onNext={
            detailNavList.length > 1 && detailIndex >= 0
              ? () => {
                  const next = detailNavList[(detailIndex + 1) % detailNavList.length];
                  if (next) setSelectedVocabId(next.id);
                }
              : undefined
          }
          isMarked={Boolean(markedMap[selectedVocab.id])}
          markActionMode="toggle"
          onToggleMarked={() => {
            if (!canUseBookmark) {
              onRequireBookmarkAccess?.();
              return;
            }
            onToggleMarked(selectedVocab.id);
          }}
          onOpenWriter={isEnglish ? undefined : onOpenWriter}
          onOpenAiDictionary={onOpenAiDictionary}
          onClose={() => setSelectedVocabId(null)}
        />
      )}
    </div>
  );
};
