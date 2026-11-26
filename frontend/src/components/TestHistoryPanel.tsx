import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { LoadingCard, LoadingSpinner } from './common/LoadingState';
import type {
  LanguageCode,
  LessonAttemptDetailRecord,
  LessonSummary,
  LessonTestSummaryRecord,
  TestAttemptRecord,
} from '../types';

type HistorySubTab = 'comprehensive' | 'lesson';

interface TestHistoryPanelProps {
  lang?: LanguageCode;
  userId: string;
  lessons: LessonSummary[];
  attempts: TestAttemptRecord[];
  onOpenLesson?: (lessonId: string, tab?: 'vocab' | 'test') => void;
  onOpenExam?: () => void;
}

function formatDurationSeconds(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins === 0) return `${rem}s`;
  return `${mins}p ${String(rem).padStart(2, '0')}s`;
}

export const TestHistoryPanel: React.FC<TestHistoryPanelProps> = ({
  lang = 'zh',
  userId,
  lessons,
  attempts,
  onOpenLesson,
  onOpenExam,
}) => {
  const isEnglish = lang === 'en';
  const [comprehensiveAttempts, setComprehensiveAttempts] = useState<LessonAttemptDetailRecord[]>(() =>
    attempts
      .filter((a) => !a.lessonId && (!a.languageCode || a.languageCode === lang))
      .map((a) => ({
        id: a.id,
        lessonId: a.lessonId,
        examTitle: a.examTitle ?? null,
        score: a.score,
        totalQuestions: a.totalQuestions,
        correctCount: a.correctCount,
        durationSeconds: a.durationSeconds,
        submittedAt: a.submittedAt,
      }))
  );
  const [lessonTestSummaries, setLessonTestSummaries] = useState<LessonTestSummaryRecord[]>([]);
  const [expandedLessonIds, setExpandedLessonIds] = useState<Record<string, boolean>>({});
  const [lessonDetailsCache, setLessonDetailsCache] = useState<
    Record<string, LessonAttemptDetailRecord[]>
  >({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Record<string, boolean>>({});
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [historySubTab, setHistorySubTab] = useState<HistorySubTab>('comprehensive');
  const [historySelectedLessonIds, setHistorySelectedLessonIds] = useState<string[]>(() =>
    lessons.map((l) => l.id)
  );
  const didInitHistoryLessons = useRef(lessons.length > 0);
  const [lessonDropdownOpen, setLessonDropdownOpen] = useState(false);
  const lessonDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!didInitHistoryLessons.current && lessons.length > 0) {
      didInitHistoryLessons.current = true;
      setHistorySelectedLessonIds(lessons.map((l) => l.id));
    }
  }, [lessons]);

  useEffect(() => {
    if (!lessonDropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (lessonDropdownRef.current && !lessonDropdownRef.current.contains(e.target as Node)) {
        setLessonDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLessonDropdownOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lessonDropdownOpen]);

  useEffect(() => {
    setExpandedLessonIds({});
    setLessonDetailsCache({});
    setLessonTestSummaries([]);
    setComprehensiveAttempts(
      attempts
        .filter((a) => !a.lessonId && (!a.languageCode || a.languageCode === lang))
        .map((a) => ({
          id: a.id,
          lessonId: a.lessonId,
          examTitle: a.examTitle ?? null,
          score: a.score,
          totalQuestions: a.totalQuestions,
          correctCount: a.correctCount,
          durationSeconds: a.durationSeconds,
          submittedAt: a.submittedAt,
        }))
    );
    setHistorySelectedLessonIds(lessons.map((l) => l.id));
    didInitHistoryLessons.current = lessons.length > 0;
  }, [lang]);

  useEffect(() => {
    setComprehensiveAttempts(
      attempts
        .filter((a) => !a.lessonId && (!a.languageCode || a.languageCode === lang))
        .map((a) => ({
          id: a.id,
          lessonId: a.lessonId,
          examTitle: a.examTitle ?? null,
          score: a.score,
          totalQuestions: a.totalQuestions,
          correctCount: a.correctCount,
          durationSeconds: a.durationSeconds,
          submittedAt: a.submittedAt,
        }))
    );
    setLessonDetailsCache({});
  }, [attempts, lang]);

  const loadAttemptsFromDb = useCallback(async () => {
    setLoadingAttempts(true);
    setAttemptsError(null);
    try {
      const [summaryRes, compRes] = await Promise.all([
        api.getLessonTestSummary(lang),
        api.getLessonAttemptDetails('__comprehensive__', lang),
      ]);
      setLessonTestSummaries(summaryRes.items);
      setComprehensiveAttempts(compRes.attempts);
    } catch (err) {
      setAttemptsError(err instanceof Error ? err.message : 'Không tải được lịch sử làm bài');
    } finally {
      setLoadingAttempts(false);
    }
  }, [lang]);

  useEffect(() => {
    void loadAttemptsFromDb();
  }, [userId, loadAttemptsFromDb]);

  const handleToggleLessonRow = async (lessonId: string, attemptCount: number) => {
    if (attemptCount <= 0) return;
    const nextExpanded = !expandedLessonIds[lessonId];
    setExpandedLessonIds((prev) => ({ ...prev, [lessonId]: nextExpanded }));
    if (nextExpanded && !lessonDetailsCache[lessonId] && !loadingDetailIds[lessonId]) {
      setLoadingDetailIds((prev) => ({ ...prev, [lessonId]: true }));
      try {
        const res = await api.getLessonAttemptDetails(lessonId, lang);
        setLessonDetailsCache((prev) => ({ ...prev, [lessonId]: res.attempts }));
      } catch (err) {
        setAttemptsError(
          err instanceof Error ? err.message : 'Không tải được chi tiết lượt kiểm tra'
        );
      } finally {
        setLoadingDetailIds((prev) => ({ ...prev, [lessonId]: false }));
      }
    }
  };

  const allLessonsSelected =
    lessons.length > 0 && lessons.every((l) => historySelectedLessonIds.includes(l.id));

  const totalLessonAttemptCount = useMemo(
    () => lessonTestSummaries.reduce((sum, item) => sum + item.attemptCount, 0),
    [lessonTestSummaries]
  );

  const filteredLessonSummaries = useMemo(() => {
    if (allLessonsSelected || historySelectedLessonIds.length === 0) return lessonTestSummaries;
    const selectedSet = new Set(historySelectedLessonIds);
    return lessonTestSummaries.filter((item) => selectedSet.has(item.lessonId));
  }, [allLessonsSelected, historySelectedLessonIds, lessonTestSummaries]);

  const historyStats = useMemo(() => {
    if (historySubTab === 'comprehensive') {
      const total = comprehensiveAttempts.length;
      const avgScore =
        total > 0
          ? Math.round(comprehensiveAttempts.reduce((sum, a) => sum + a.score, 0) / total)
          : 0;
      const bestScore = total > 0 ? Math.max(...comprehensiveAttempts.map((a) => a.score)) : 0;
      return { total, avgScore, bestScore };
    }

    const total = filteredLessonSummaries.reduce((sum, item) => sum + item.attemptCount, 0);
    const totalScoreSum = filteredLessonSummaries.reduce((sum, item) => sum + item.scoreSum, 0);
    const avgScore = total > 0 ? Math.round(totalScoreSum / total) : 0;
    const bestScores = filteredLessonSummaries
      .map((item) => item.bestScore)
      .filter((s): s is number => s !== null);
    const bestScore = bestScores.length > 0 ? Math.max(...bestScores) : 0;
    return { total, avgScore, bestScore };
  }, [historySubTab, comprehensiveAttempts, filteredLessonSummaries]);

  const lessonFilterLabel = useMemo(() => {
    if (allLessonsSelected) return 'Tất cả bài học';
    if (historySelectedLessonIds.length === 0) return 'Chưa chọn (hiện tất cả)';
    if (historySelectedLessonIds.length === 1) {
      const found = lessons.find((l) => l.id === historySelectedLessonIds[0]);
      return found ? found.title.split(' - ')[0] : '1 bài học';
    }
    return `Đã chọn ${historySelectedLessonIds.length} bài học`;
  }, [allLessonsSelected, historySelectedLessonIds, lessons]);

  const toggleHistoryLesson = (lessonId: string) => {
    setHistorySelectedLessonIds((prev) =>
      prev.includes(lessonId) ? prev.filter((id) => id !== lessonId) : [...prev, lessonId]
    );
  };

  const toggleAllHistoryLessons = () => {
    setHistorySelectedLessonIds(allLessonsSelected ? [] : lessons.map((l) => l.id));
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5 sm:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <Award className="w-4 h-4" />
            </span>
            Tổng hợp lịch sử làm bài
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Theo dõi điểm số, tỷ lệ câu đúng và chi tiết từng lượt kiểm tra của bạn.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {historySubTab === 'lesson' && (
            <div ref={lessonDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setLessonDropdownOpen((prev) => !prev)}
                aria-expanded={lessonDropdownOpen}
                className={`px-3 py-2 rounded-xl border text-xs font-medium inline-flex items-center justify-between gap-2 min-w-[180px] max-w-[230px] transition ${
                  lessonDropdownOpen
                    ? 'border-red-500 bg-red-50/70 dark:bg-red-950/30 text-slate-900 dark:text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70'
                }`}
              >
                <span className="truncate">{lessonFilterLabel}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${
                    lessonDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {lessonDropdownOpen && (
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-72 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-40 overflow-hidden pop-in">
                  <div className="p-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                    <button
                      type="button"
                      onClick={toggleAllHistoryLessons}
                      className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                        allLessonsSelected
                          ? 'bg-red-50 dark:bg-red-900/35 text-red-700 dark:text-red-200'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          allLessonsSelected
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {allLessonsSelected && <Check className="w-3 h-3" />}
                      </span>
                      <span>Tất cả bài học</span>
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                    {lessons.map((l) => {
                      const checked = historySelectedLessonIds.includes(l.id);
                      const shortTitle = l.title.split(' - ')[0];
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => toggleHistoryLesson(l.id)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-2.5 transition ${
                            checked
                              ? 'bg-red-50/80 dark:bg-red-900/25 text-red-700 dark:text-red-200 font-semibold'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              checked
                                ? 'bg-red-600 border-red-600 text-white'
                                : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </span>
                          <span className="truncate">{shortTitle}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setLessonDropdownOpen(false);
                setHistorySubTab('comprehensive');
              }}
              className={`px-3 py-1.5 rounded-lg transition ${
                historySubTab === 'comprehensive'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Kiểm tra tổng hợp ({comprehensiveAttempts.length})
            </button>
            <button
              type="button"
              onClick={() => setHistorySubTab('lesson')}
              className={`px-3 py-1.5 rounded-lg transition ${
                historySubTab === 'lesson'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Kiểm tra theo bài học ({totalLessonAttemptCount})
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
          <span className="text-slate-500 dark:text-slate-400 block">Tổng lượt thi</span>
          <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
            {historyStats.total}
          </span>
        </div>
        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
          <span className="text-slate-500 dark:text-slate-400 block">Điểm trung bình</span>
          <span className="text-xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
            {historyStats.avgScore}/100
          </span>
        </div>
        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
          <span className="text-slate-500 dark:text-slate-400 block">Điểm cao nhất</span>
          <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
            {historyStats.bestScore}/100
          </span>
        </div>
      </div>

      {attemptsError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
          {attemptsError}
        </div>
      )}

      {loadingAttempts && lessonTestSummaries.length === 0 && comprehensiveAttempts.length === 0 ? (
        <LoadingCard compact message="Đang tải lịch sử làm bài..." />
      ) : historySubTab === 'comprehensive' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 uppercase text-[11px] border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-3.5 w-12 text-center">STT</th>
                <th className="py-3 px-3.5">Loại kiểm tra</th>
                <th className="py-3 px-3.5 text-center">Điểm số</th>
                <th className="py-3 px-3.5 text-center">Số câu đúng</th>
                <th className="py-3 px-3.5 text-center">Thời gian làm</th>
                <th className="py-3 px-3.5 text-center">Ngày nộp bài</th>
                <th className="py-3 px-3.5 text-right">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(comprehensiveAttempts.length === 0 ? [null] : comprehensiveAttempts).map((a, idx) => {
                const scoreColor = a
                  ? a.score >= 80
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                    : a.score >= 60
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70'
                      : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70'
                  : '';

                const rawTitle =
                  a?.examTitle?.trim() ||
                  (isEnglish ? 'Kiểm tra tổng hợp (CEFR A1)' : 'Kiểm tra tổng hợp (26 bài)');
                const scopeMatch = rawTitle.match(/^(.*?)\s*\((\d+\s*bài[^()]*)\)$/i);
                const displayTitle = scopeMatch ? scopeMatch[1].trim() : rawTitle;
                const lessonCountNote = scopeMatch
                  ? `Tổng hợp ${scopeMatch[2].trim()}`
                  : rawTitle === 'Kiểm tra tổng hợp'
                    ? isEnglish
                      ? 'Tổng hợp CEFR A1'
                      : 'Tổng hợp 26 bài'
                    : null;

                return (
                  <tr
                    key={a ? a.id : 'comprehensive-empty'}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
                  >
                    <td className="py-3 px-3.5 text-center font-mono text-slate-400 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onOpenExam?.()}
                          disabled={!onOpenExam}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 border border-purple-200/80 dark:border-purple-800/70 text-purple-700 dark:text-purple-300 font-semibold transition text-left disabled:cursor-default"
                          title={rawTitle}
                        >
                          <Award className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{displayTitle}</span>
                          {onOpenExam && <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-75" />}
                        </button>
                        {a && lessonCountNote && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                            {lessonCountNote}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-center tabular-nums">
                      {a ? (
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-lg border font-mono font-bold ${scoreColor}`}
                        >
                          {a.score}/100
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-center font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                      {a ? `${a.correctCount}/${a.totalQuestions}` : <span className="text-slate-400 font-mono">-</span>}
                    </td>
                    <td className="py-3 px-3.5 text-center font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {a ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {formatDurationSeconds(a.durationSeconds)}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-center font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                      {a ? new Date(a.submittedAt).toLocaleString('vi-VN') : '-'}
                    </td>
                    <td className="py-3 px-3.5 text-right whitespace-nowrap">
                      {!a ? (
                        <span className="text-slate-400 font-mono">-</span>
                      ) : a.score >= 60 ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-bold">
                          Đạt
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-red-600 dark:text-red-400 font-bold">
                          Chưa đạt
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 uppercase text-[11px] border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-3.5 w-12 text-center">STT</th>
                <th className="py-3 px-3.5">Thuộc bài</th>
                <th className="py-3 px-3.5 text-center">Điểm TB</th>
                <th className="py-3 px-3.5 text-center">Câu đúng TB</th>
                <th className="py-3 px-3.5 text-center">Thời gian TB</th>
                <th className="py-3 px-3.5 text-center">Gần nhất</th>
                <th className="py-3 px-3.5 text-right">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLessonSummaries.map((item, idx) => {
                const hasAttempts = item.attemptCount > 0;
                const isExpanded = Boolean(expandedLessonIds[item.lessonId]);
                const isLoadingDetails = Boolean(loadingDetailIds[item.lessonId]);
                const details = lessonDetailsCache[item.lessonId] || [];
                const shortLessonTitle = item.lessonTitle.split(' - ')[0] || item.lessonTitle;
                const avgScoreColor =
                  item.avgScore !== null
                    ? item.avgScore >= 80
                      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                      : item.avgScore >= 60
                        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70'
                        : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70'
                    : '';

                return (
                  <React.Fragment key={item.lessonId}>
                    <tr
                      onClick={() => void handleToggleLessonRow(item.lessonId, item.attemptCount)}
                      className={`transition ${
                        hasAttempts
                          ? 'cursor-pointer hover:bg-slate-50/90 dark:hover:bg-slate-800/50'
                          : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'
                      } ${isExpanded ? 'bg-slate-50/70 dark:bg-slate-800/35' : ''}`}
                    >
                      <td className="py-3 px-3.5 text-center font-mono text-slate-400 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {hasAttempts ? (
                            <ChevronRight
                              className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
                                isExpanded ? 'rotate-90 text-red-500' : ''
                              }`}
                            />
                          ) : (
                            <span className="w-4 h-4 inline-block flex-shrink-0" />
                          )}

                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200/80 dark:border-red-800/70 text-red-700 dark:text-red-300 font-semibold"
                            title={item.lessonTitle}
                          >
                            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{shortLessonTitle}</span>
                          </span>

                          {hasAttempts && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-mono font-bold tabular-nums">
                              {item.attemptCount} lượt
                            </span>
                          )}

                          {onOpenLesson && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenLesson(item.lessonId, 'test');
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                              title={`Mở bài kiểm tra ${shortLessonTitle}`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-center tabular-nums">
                        {item.avgScore !== null ? (
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-lg border font-mono font-bold ${avgScoreColor}`}
                          >
                            {item.avgScore}/100
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-center font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {item.avgCorrect !== null && item.totalQuestions ? (
                          `${item.avgCorrect}/${item.totalQuestions}`
                        ) : (
                          <span className="text-slate-400 font-mono">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                        {item.avgDurationSeconds !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {formatDurationSeconds(item.avgDurationSeconds)}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                        {item.lastSubmittedAt
                          ? new Date(item.lastSubmittedAt).toLocaleString('vi-VN')
                          : '-'}
                      </td>
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        {item.status === 'unattempted' ? (
                          <span className="text-slate-400 font-mono">-</span>
                        ) : item.status === 'passed' ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-bold">
                            Đạt
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-red-600 dark:text-red-400 font-bold">
                            Chưa đạt
                          </span>
                        )}
                      </td>
                    </tr>

                    {isExpanded && hasAttempts && (
                      <tr className="bg-slate-50/60 dark:bg-slate-900/80">
                        <td colSpan={7} className="px-6 py-3">
                          {isLoadingDetails ? (
                            <div className="py-4 flex items-center justify-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
                              <LoadingSpinner size="sm" />
                              <span>Đang tải chi tiết từng lần kiểm tra...</span>
                            </div>
                          ) : details.length === 0 ? (
                            <div className="py-2 text-center text-xs text-slate-500 dark:text-slate-400">
                              Không có dữ liệu chi tiết.
                            </div>
                          ) : (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 overflow-hidden">
                              <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                  <tr className="bg-slate-100/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-800">
                                    <th className="py-2 px-3 w-20 text-center">Lần thi</th>
                                    <th className="py-2 px-3 text-center">Điểm số</th>
                                    <th className="py-2 px-3 text-center">Số câu đúng</th>
                                    <th className="py-2 px-3 text-center">Thời gian làm</th>
                                    <th className="py-2 px-3 text-center">Ngày nộp bài</th>
                                    <th className="py-2 px-3 text-right">Trạng thái</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                                  {details.map((d, dIdx) => {
                                    const attemptNum = details.length - dIdx;
                                    const dColor =
                                      d.score >= 80
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : d.score >= 60
                                          ? 'text-blue-600 dark:text-blue-400'
                                          : 'text-red-600 dark:text-red-400';
                                    return (
                                      <tr
                                        key={d.id}
                                        className="hover:bg-slate-50 dark:hover:bg-slate-800/30"
                                      >
                                        <td className="py-2 px-3 text-center font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                          Lần {attemptNum}
                                        </td>
                                        <td
                                          className={`py-2 px-3 text-center font-mono font-bold tabular-nums ${dColor}`}
                                        >
                                          {d.score}/100
                                        </td>
                                        <td className="py-2 px-3 text-center font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                                          {d.correctCount}/{d.totalQuestions}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                                          {formatDurationSeconds(d.durationSeconds)}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                          {new Date(d.submittedAt).toLocaleString('vi-VN')}
                                        </td>
                                        <td className="py-2 px-3 text-right">
                                          {d.score >= 60 ? (
                                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                              Đạt
                                            </span>
                                          ) : (
                                            <span className="text-red-600 dark:text-red-400 font-bold">
                                              Chưa đạt
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
