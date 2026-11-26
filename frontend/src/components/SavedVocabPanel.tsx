import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Eye,
  Flag,
  PenTool,
  RefreshCw,
  Search,
  Trash2,
  Volume2,
} from 'lucide-react';
import { getEnAudioUrl, getEnImageUrl } from '../languages/config';
import { api } from '../lib/api';
import { speakChinese, speakEnglish } from '../lib/audio';
import { LoadingCard } from './common/LoadingState';
import { VocabDetailModal } from './common/VocabDetailModal';
import type {
  LanguageCode,
  LessonSummary,
  MarkedVocabCard,
  VocabularyItem,
} from '../types';

interface SavedVocabPanelProps {
  lang?: LanguageCode;
  userId: string;
  lessons: LessonSummary[];
  onToggleMarked?: (vocabId: string) => Promise<void> | void;
  onOpenLesson?: (lessonId: string, tab?: 'vocab' | 'test') => void;
  onOpenWriter?: (vocab: VocabularyItem) => void;
  onOpenAiDictionary?: (word: string) => void;
}

export const SavedVocabPanel: React.FC<SavedVocabPanelProps> = ({
  lang = 'zh',
  userId,
  lessons,
  onToggleMarked,
  onOpenLesson,
  onOpenWriter,
  onOpenAiDictionary,
}) => {
  const isEnglish = lang === 'en';
  const [markedCards, setMarkedCards] = useState<MarkedVocabCard[]>([]);
  const [loadingMarked, setLoadingMarked] = useState(false);
  const [markedError, setMarkedError] = useState<string | null>(null);
  const [markedSearch, setMarkedSearch] = useState('');
  const [lessonFilter, setLessonFilter] = useState<string>('all');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const loadMarkedFromDb = useCallback(async () => {
    setLoadingMarked(true);
    setMarkedError(null);
    try {
      const res = await api.getMarkedCards(lang);
      setMarkedCards(res.cards);
    } catch (err) {
      setMarkedError(err instanceof Error ? err.message : 'Không tải được danh sách từ đã đánh dấu');
    } finally {
      setLoadingMarked(false);
    }
  }, [lang]);

  useEffect(() => {
    void loadMarkedFromDb();
  }, [userId, loadMarkedFromDb]);

  const lessonOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    lessons.forEach((l, idx) => map.set(l.id, idx));
    return map;
  }, [lessons]);

  const orderedMarkedCards = useMemo(() => {
    return [...markedCards].sort((a, b) => {
      const idxA = lessonOrderMap.get(a.lessonId) ?? Number.MAX_SAFE_INTEGER;
      const idxB = lessonOrderMap.get(b.lessonId) ?? Number.MAX_SAFE_INTEGER;
      return idxA - idxB;
    });
  }, [markedCards, lessonOrderMap]);

  const markedLessonOptions = useMemo(() => {
    const seen = new Map<string, string>();
    orderedMarkedCards.forEach((c) => {
      if (!seen.has(c.lessonId)) seen.set(c.lessonId, c.lessonTitle);
    });
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
  }, [orderedMarkedCards]);

  const filteredMarkedCards = useMemo(() => {
    const q = markedSearch.trim().toLowerCase();
    return orderedMarkedCards.filter((card) => {
      if (lessonFilter !== 'all' && card.lessonId !== lessonFilter) return false;
      if (!q) return true;
      return [card.hanzi, card.pinyin, card.sinoVietnamese, card.meaning, card.lessonTitle]
        .filter(Boolean)
        .some((val) => val!.toLowerCase().includes(q));
    });
  }, [orderedMarkedCards, lessonFilter, markedSearch]);

  const detailIndex = useMemo(
    () => (selectedCardId ? filteredMarkedCards.findIndex((c) => c.id === selectedCardId) : -1),
    [filteredMarkedCards, selectedCardId]
  );
  const detailCard =
    detailIndex >= 0
      ? filteredMarkedCards[detailIndex]
      : selectedCardId
        ? orderedMarkedCards.find((c) => c.id === selectedCardId) || null
        : null;

  const handleRefresh = () => {
    setMarkedSearch('');
    setLessonFilter('all');
    void loadMarkedFromDb();
  };

  const handleUnmarkCard = async (vocabId: string) => {
    if (!onToggleMarked) return;
    setRemovingId(vocabId);
    try {
      let nextSelectedAfterRemove: string | null = selectedCardId;
      if (selectedCardId === vocabId) {
        const curIdx = filteredMarkedCards.findIndex((c) => c.id === vocabId);
        const remaining = filteredMarkedCards.filter((c) => c.id !== vocabId);
        if (remaining.length === 0) {
          nextSelectedAfterRemove = null;
        } else {
          const targetIdx = Math.min(Math.max(0, curIdx), remaining.length - 1);
          nextSelectedAfterRemove = remaining[targetIdx].id;
        }
      }
      await onToggleMarked(vocabId);
      setMarkedCards((prev) => prev.filter((c) => c.id !== vocabId));
      setSelectedCardId(nextSelectedAfterRemove);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5 sm:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Flag className="w-4 h-4" />
            </span>
            Danh sách từ đã đánh dấu
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
              {orderedMarkedCards.length}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Ôn tập nhanh các từ vựng bạn đã gắn cờ khó nhớ trên toàn bộ giáo trình. Bấm vào từ hoặc biểu tượng con mắt để xem chi tiết.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={markedSearch}
              onChange={(e) => setMarkedSearch(e.target.value)}
              placeholder={
                isEnglish ? 'Tìm từ tiếng Anh, IPA, nghĩa...' : 'Tìm chữ Hán, Pinyin, nghĩa...'
              }
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-red-500"
            />
          </div>

          {markedLessonOptions.length > 1 && (
            <select
              value={lessonFilter}
              onChange={(e) => setLessonFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 max-w-[180px] truncate"
            >
              <option value="all">Tất cả bài ({orderedMarkedCards.length})</option>
              {markedLessonOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.title.split(' - ')[0]}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={loadingMarked}
            onClick={handleRefresh}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50 transition"
            title="Xóa bộ lọc tìm kiếm và tải lại danh sách"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMarked ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {markedError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
          {markedError}
        </div>
      )}

      {loadingMarked && markedCards.length === 0 ? (
        <LoadingCard compact message="Đang tải danh sách từ đã đánh dấu..." />
      ) : filteredMarkedCards.length === 0 ? (
        <div className="py-12 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
          <Flag className="w-8 h-8 text-amber-400 mx-auto opacity-80" />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {orderedMarkedCards.length === 0
              ? 'Bạn chưa đánh dấu từ vựng nào'
              : 'Không tìm thấy từ nào khớp bộ lọc'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {orderedMarkedCards.length === 0
              ? 'Hãy bấm biểu tượng lá cờ ở thẻ hoặc bảng từ vựng trong mỗi buổi học để lưu từ cần ôn lại tại đây.'
              : 'Thử xóa từ khóa tìm kiếm hoặc chọn lại tất cả bài học.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 uppercase text-[11px] border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-3.5 w-12 text-center">STT</th>
                <th className="py-3 px-3.5">{isEnglish ? 'Từ tiếng Anh' : 'Chữ Hán'}</th>
                <th className="py-3 px-3.5">{isEnglish ? 'IPA & CEFR' : 'Pinyin & Hán Việt'}</th>
                <th className="py-3 px-3.5">Nghĩa tiếng Việt</th>
                <th className="py-3 px-3.5">Thuộc bài</th>
                <th className="py-3 px-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredMarkedCards.map((card, idx) => {
                const shortLesson = card.lessonTitle.split(':')[0] || card.lessonTitle;
                const thumbUrl = isEnglish ? getEnImageUrl(card.meta, 'thumb') : null;
                return (
                  <tr
                    key={card.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
                  >
                    <td className="py-3 px-3.5 text-center font-mono text-slate-400 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="flex items-center gap-2">
                        {thumbUrl && (
                          <img
                            src={thumbUrl}
                            alt={card.hanzi}
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                            className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCardId(card.id)}
                          className={`${
                            isEnglish ? 'text-base' : 'chinese-font text-lg'
                          } font-bold text-slate-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 underline decoration-dotted underline-offset-4 decoration-slate-300 dark:decoration-slate-700 hover:decoration-purple-400 transition text-left`}
                          title={`Xem chi tiết từ "${card.hanzi}"`}
                        >
                          {card.hanzi}
                        </button>
                        {card.type && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hidden sm:inline">
                            {card.type}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3.5">
                      <span
                        className={`block font-mono font-semibold ${
                          isEnglish
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {card.pinyin}
                      </span>
                      {card.sinoVietnamese && (
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                          {card.sinoVietnamese}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-slate-800 dark:text-slate-200 font-medium max-w-xs">
                      {card.meaning}
                    </td>
                    <td className="py-3 px-3.5">
                      {onOpenLesson ? (
                        <button
                          type="button"
                          onClick={() => onOpenLesson(card.lessonId, 'vocab')}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-200/80 dark:border-red-800/70 text-red-700 dark:text-red-300 font-semibold transition text-left"
                          title={`Mở ${card.lessonTitle}`}
                        >
                          <span>{shortLesson}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-75" />
                        </button>
                      ) : (
                        <span className="inline-block px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                          {card.lessonTitle}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedCardId(card.id)}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition"
                          title="Xem chi tiết từ vựng"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            isEnglish
                              ? speakEnglish(card.hanzi, {
                                  accent: 'us',
                                  audioUrl: getEnAudioUrl(card.meta, 'us'),
                                })
                              : speakChinese(card.hanzi)
                          }
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
                          title="Nghe phát âm"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        {!isEnglish && onOpenWriter && (
                          <button
                            type="button"
                            onClick={() => onOpenWriter(card)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
                            title="Luyện viết chữ Hán"
                          >
                            <PenTool className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onToggleMarked && (
                          <button
                            type="button"
                            disabled={removingId === card.id}
                            onClick={() => void handleUnmarkCard(card.id)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 transition"
                            title="Bỏ đánh dấu từ này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Xem chi tiết từ đã đánh dấu (dùng chung VocabDetailModal đầy đủ như Từ điển AI) */}
      {detailCard && (
        <VocabDetailModal
          lang={lang}
          vocab={detailCard}
          lessonTitle={detailCard.lessonTitle}
          onOpenLesson={onOpenLesson ? () => onOpenLesson(detailCard.lessonId, 'vocab') : undefined}
          currentIndex={detailIndex}
          totalCount={filteredMarkedCards.length}
          onPrev={
            filteredMarkedCards.length > 1 && detailIndex >= 0
              ? () => {
                  const prev =
                    filteredMarkedCards[
                      (detailIndex - 1 + filteredMarkedCards.length) % filteredMarkedCards.length
                    ];
                  if (prev) setSelectedCardId(prev.id);
                }
              : undefined
          }
          onNext={
            filteredMarkedCards.length > 1 && detailIndex >= 0
              ? () => {
                  const next = filteredMarkedCards[(detailIndex + 1) % filteredMarkedCards.length];
                  if (next) setSelectedCardId(next.id);
                }
              : undefined
          }
          isMarked={true}
          markActionMode="unmark_only"
          markLoading={removingId === detailCard.id}
          onToggleMarked={onToggleMarked ? () => void handleUnmarkCard(detailCard.id) : undefined}
          onOpenWriter={onOpenWriter}
          onOpenAiDictionary={onOpenAiDictionary}
          onClose={() => setSelectedCardId(null)}
        />
      )}
    </div>
  );
};
