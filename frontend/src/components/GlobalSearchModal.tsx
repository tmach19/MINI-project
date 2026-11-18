import React, { useEffect, useState } from 'react';
import { ArrowRight, Search, Sparkles, Volume2, X } from 'lucide-react';
import { api } from '../lib/api';
import { speakChinese } from '../lib/audio';
import { ModalShell } from './common/ModalShell';
import type { GlobalVocabHit } from '../types';

interface GlobalSearchModalProps {
  onClose: () => void;
  onJumpToLesson: (lessonId: string) => void;
  onOpenAiDictionary?: (initialQuery: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  onClose,
  onJumpToLesson,
  onOpenAiDictionary,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalVocabHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchVocab(trimmed);
        setResults(res.items);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-2xl" alignTop>
      <div className="p-4 border-b border-stone-200 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-red-600 flex-shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm từ vựng xuyên suốt 26 bài (Hán tự, Pinyin, Nghĩa, Hán Việt, Bộ thủ)..."
            className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-stone-100 dark:divide-slate-800">
          {!query.trim() && (
            <div className="p-10 text-center text-xs text-gray-400 dark:text-slate-500">
              Gõ bất kỳ chữ Hán (ví dụ: <span className="font-bold">学校</span>), Pinyin (<span className="font-bold">xuéxiào</span>) hoặc nghĩa tiếng Việt (<span className="font-bold">trường học</span>)...
            </div>
          )}

          {loading && (
            <div className="p-8 text-center text-xs text-gray-500">Đang tìm kiếm trên toàn bộ bài học...</div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="p-8 text-center space-y-3 text-xs text-gray-500 dark:text-slate-400">
              <p>Không tìm thấy từ vựng khớp với “{query}” trong 26 bài HSK.</p>
              {onOpenAiDictionary && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAiDictionary(query.trim());
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:opacity-95 text-white font-bold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Tra &amp; dịch “{query.trim()}” bằng Từ điển AI
                </button>
              )}
            </div>
          )}

          {results.map((item) => (
            <div
              key={item.id}
              className="p-4 hover:bg-stone-50 dark:hover:bg-slate-800/60 flex items-center justify-between gap-4 transition"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="chinese-serif text-xl font-bold text-gray-900 dark:text-white">
                    {item.hanzi}
                  </span>
                  <span className="text-xs font-mono text-red-600 dark:text-red-400 font-semibold">
                    {item.pinyin}
                  </span>
                  {item.sinoVietnamese && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-semibold uppercase">
                      {item.sinoVietnamese}
                    </span>
                  )}
                  <button
                    onClick={() => speakChinese(item.hanzi)}
                    className="p-1 rounded-md text-gray-400 hover:text-red-600"
                    title="Nghe phát âm"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-gray-700 dark:text-slate-200 font-medium">{item.meaning}</p>
                <p className="text-[11px] text-gray-400 dark:text-slate-400">
                  {item.hskLevel} • {item.lessonTitle}
                </p>
              </div>

              <button
                onClick={() => {
                  onJumpToLesson(item.lessonId);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 text-xs font-semibold flex items-center gap-1 flex-shrink-0 transition active:scale-95"
              >
                Mở bài <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {!loading && query.trim() && results.length > 0 && onOpenAiDictionary && (
            <div className="p-3 bg-stone-50/70 dark:bg-slate-800/40 flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-500 dark:text-slate-400">
                Muốn dịch câu dài hoặc xem giải thích mở rộng?
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAiDictionary(query.trim());
                }}
                className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold inline-flex items-center gap-1.5 flex-shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" /> Tra với Trợ lý AI
              </button>
            </div>
          )}
        </div>
    </ModalShell>
  );
};
