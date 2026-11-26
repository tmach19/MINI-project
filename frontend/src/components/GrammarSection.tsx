import React, { useMemo } from 'react';
import { AlertTriangle, Calculator, GitBranch, Volume2 } from 'lucide-react';
import { speakText } from '../lib/audio';
import type { GrammarItem, LanguageCode, LessonDetail } from '../types';

interface GrammarSectionProps {
  lang?: LanguageCode;
  lesson: LessonDetail;
}

function scoreClientGrammarQuality(g: GrammarItem): number {
  let score = 0;
  if (/^g\d+_\d+$/.test(g.id)) score += 100;
  if (g.examples?.length) score += 50 + Math.min(g.examples.length, 10) * 5;
  if (g.notes?.trim()) score += 20;
  if (g.explanation?.trim()) score += 10;
  if (g.formula?.trim()) score += 5;
  return score;
}

export const GrammarSection: React.FC<GrammarSectionProps> = ({ lang, lesson }) => {
  const isEnglish = lang === 'en' || lesson.languageCode === 'en';
  const effectiveLang: LanguageCode = isEnglish ? 'en' : 'zh';
  const grammarList = useMemo(() => {
    const raw = lesson.grammar || [];
    const byTitle = new Map<string, { index: number; item: GrammarItem }>();
    const ordered: Array<GrammarItem | null> = [];
    for (const item of raw) {
      const key = (item.title || '').trim();
      if (!key) continue;
      const existing = byTitle.get(key);
      if (!existing) {
        byTitle.set(key, { index: ordered.length, item });
        ordered.push(item);
      } else if (scoreClientGrammarQuality(item) > scoreClientGrammarQuality(existing.item)) {
        ordered[existing.index] = item;
        byTitle.set(key, { index: existing.index, item });
      }
    }
    return ordered.filter((x): x is GrammarItem => Boolean(x));
  }, [lesson.grammar]);

  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <GitBranch className="w-3.5 h-3.5" /> Module 3: Ngữ pháp trọng tâm
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">Cấu trúc & Quy tắc ngữ pháp</h2>
          <p className="text-white/90 text-sm mt-1">
            Nắm vững công thức câu, phân biệt cách dùng và nghe câu ví dụ thực tế.
          </p>
        </div>

        <div className="bg-white/10 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20 text-center">
          <span className="text-3xl font-black">{grammarList.length}</span>
          <p className="text-xs text-white/80 uppercase font-medium">Cấu trúc bài này</p>
        </div>
      </div>

      {grammarList.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-10 text-center text-sm text-gray-500 dark:text-slate-400">
          Buổi học này chưa có mục ngữ pháp nào.
        </div>
      ) : (
        grammarList.map((g, gIdx) => (
          <div
            key={g.id || gIdx}
            className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden"
          >
            <div className="p-6 bg-blue-50/60 dark:bg-blue-950/30 border-b border-blue-100 dark:border-slate-800 flex items-start gap-4">
              <span className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                #{gIdx + 1}
              </span>
              <div className="flex-grow">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">{g.title}</h3>
                {g.formula && (
                  <div className="inline-flex items-start gap-2 mt-2 px-4 py-2 bg-white dark:bg-slate-800 rounded-xl border border-blue-200 dark:border-blue-800 text-xs font-mono font-bold text-blue-700 dark:text-blue-300">
                    <Calculator className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-line">Công thức: {g.formula}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 md:p-8 space-y-6">
              {g.explanation && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Giải thích chi tiết
                  </h4>
                  <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed bg-stone-50/60 dark:bg-slate-800/50 p-4 rounded-2xl border border-stone-100 dark:border-slate-800 whitespace-pre-line">
                    {g.explanation}
                  </p>
                </div>
              )}

              {g.notes && (
                <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold">Lưu ý cho người Việt:</strong>
                    <div className="mt-1 leading-relaxed whitespace-pre-line">{g.notes}</div>
                  </div>
                </div>
              )}

              {g.examples.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Ví dụ thực tế
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {g.examples.map((ex, exIdx) => (
                      <div
                        key={exIdx}
                        className="p-4 rounded-2xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 space-y-1"
                      >
                        <div
                          className={`${
                            isEnglish ? 'text-sm sm:text-base' : 'chinese-font text-base'
                          } font-bold text-gray-900 dark:text-white flex items-center justify-between gap-2`}
                        >
                          <span>{ex.hanzi}</span>
                          <button
                            onClick={() => speakText(ex.hanzi, effectiveLang)}
                            className="text-gray-400 hover:text-blue-600 p-1 shrink-0"
                            title="Nghe câu ví dụ"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>
                        {ex.pinyin && (
                          <div className="text-xs font-mono text-red-600 dark:text-red-400">{ex.pinyin}</div>
                        )}
                        <div className="text-xs text-gray-600 dark:text-slate-400 italic">→ {ex.meaning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};
