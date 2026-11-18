import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronDown,
  Clock,
  Layers,
  Play,
  RotateCcw,
  Search,
  Send,
  Shuffle,
  Volume2,
} from 'lucide-react';
import { resolveDialogueTtsText, soundFx, speakChinese } from '../lib/audio';
import type { LessonDetail, LessonSummary, TestAttemptRecord } from '../types';

interface TestSectionProps {
  lesson: LessonDetail;
  attempts: TestAttemptRecord[];
  onSaveAttempt: (payload: {
    lessonId: string | null;
    examTitle?: string | null;
    score: number;
    totalQuestions: number;
    correctCount: number;
    durationSeconds: number;
    answers: Record<string, number>;
  }) => void;
  onGoToVocab: () => void;
  isComprehensiveExam?: boolean;
  loadingExam?: boolean;
  onRefreshExam?: () => void;
  onBackToStudy?: () => void;
  availableLessons?: LessonSummary[];
  selectedLessonIds?: string[];
  onChangeSelectedLessons?: (lessonIds: string[]) => void;
}

function getTestDurationSeconds(questionCount: number): number {
  if (questionCount <= 0) return 1200;
  // Scale exam time proportionally (~50s per question, minimum 20 minutes)
  const minutes = Math.max(20, Math.round((questionCount * 50) / 60));
  return minutes * 60;
}

function formatDurationMmSs(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getCategoryBadge(cat?: string | null) {
  const map: Record<string, { label: string; cls: string }> = {
    translate_zh_vi: { label: 'Dịch Trung → Việt', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    translate_vi_zh: { label: 'Dịch Việt → Trung', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    fill_blank: { label: 'Điền từ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    vocab: { label: 'Từ vựng', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    listening: { label: 'Nghe HSK', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    reading: { label: 'Đọc hiểu', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
    grammar: { label: 'Ngữ pháp', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  };
  return map[cat || ''] || { label: 'Tổng hợp', cls: 'bg-stone-100 text-gray-700 border-stone-200' };
}

export const TestSection: React.FC<TestSectionProps> = ({
  lesson,
  attempts,
  onSaveAttempt,
  onGoToVocab,
  isComprehensiveExam = false,
  loadingExam = false,
  onRefreshExam,
  onBackToStudy,
  availableLessons = [],
  selectedLessonIds = [],
  onChangeSelectedLessons,
}) => {
  const questions = lesson.comprehensiveTest || [];
  const totalSeconds = getTestDurationSeconds(questions.length);
  const [isActive, setIsActive] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [timeRemaining, setTimeRemaining] = useState(totalSeconds);
  const [finalScore, setFinalScore] = useState(0);

  // Dropdown chọn bài cho Kiểm tra tổng hợp
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [lessonSearch, setLessonSearch] = useState('');
  const [draftIds, setDraftIds] = useState<string[]>(selectedLessonIds);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftIds(selectedLessonIds);
  }, [selectedLessonIds]);

  const filteredLessons = useMemo(() => {
    const q = lessonSearch.trim().toLowerCase();
    if (!q) return availableLessons;
    return availableLessons.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.hskLevel.toLowerCase().includes(q) ||
        (l.unit || '').toLowerCase().includes(q)
    );
  }, [availableLessons, lessonSearch]);

  const allFilteredSelected =
    filteredLessons.length > 0 && filteredLessons.every((l) => draftIds.includes(l.id));
  const someFilteredSelected =
    filteredLessons.some((l) => draftIds.includes(l.id)) && !allFilteredSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected, dropdownOpen]);

  const commitDraftIfChanged = (nextIds: string[]) => {
    const prevSet = new Set(selectedLessonIds);
    const changed =
      nextIds.length !== prevSet.size || nextIds.some((id) => !prevSet.has(id));
    if (changed && onChangeSelectedLessons) {
      onChangeSelectedLessons(nextIds);
    }
  };

  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        commitDraftIfChanged(draftIds);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
        setDraftIds(selectedLessonIds);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen, draftIds, selectedLessonIds]);

  const toggleDraftLesson = (id: string) => {
    setDraftIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllDraft = () => {
    const visibleIds = filteredLessons.map((l) => l.id);
    if (visibleIds.length === 0) return;
    if (allFilteredSelected) {
      const visibleSet = new Set(visibleIds);
      setDraftIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      setDraftIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const selectedScopeSummary = useMemo(() => {
    if (availableLessons.length === 0) return 'Tất cả bài học';
    if (selectedLessonIds.length === 0) return 'Chưa chọn bài nào';
    if (selectedLessonIds.length === availableLessons.length) {
      return `Tất cả buổi học (${availableLessons.length} bài)`;
    }
    if (selectedLessonIds.length === 1) {
      const one = availableLessons.find((l) => l.id === selectedLessonIds[0]);
      return one ? one.title : '1 bài học';
    }
    return `Đã chọn ${selectedLessonIds.length} / ${availableLessons.length} bài`;
  }, [availableLessons, selectedLessonIds]);

  useEffect(() => {
    setIsActive(false);
    setIsSubmitted(false);
    setAnswers({});
    setCurrentIdx(0);
    setTimeRemaining(totalSeconds);
  }, [lesson.id, lesson.comprehensiveTest, totalSeconds]);

  const submitTest = () => {
    setIsActive(false);
    setIsSubmitted(true);
    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (answers[idx] === q.correctIndex) correctCount++;
    });
    const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
    setFinalScore(score);

    if (score >= 80) soundFx.playVictory();
    else if (score >= 50) soundFx.playCorrect();
    else soundFx.playWrong();

    const stringKeyAnswers: Record<string, number> = {};
    Object.entries(answers).forEach(([k, v]) => {
      stringKeyAnswers[k] = v;
    });

    onSaveAttempt({
      lessonId: isComprehensiveExam ? null : lesson.id,
      examTitle: isComprehensiveExam ? lesson.title : null,
      score,
      totalQuestions: questions.length,
      correctCount,
      durationSeconds: Math.max(0, totalSeconds - timeRemaining),
      answers: stringKeyAnswers,
    });
  };

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  useEffect(() => {
    if (isActive && timeRemaining === 0) {
      submitTest();
    }
  }, [isActive, timeRemaining]);

  const startTest = () => {
    if (questions.length === 0) return;
    setAnswers({});
    setCurrentIdx(0);
    setTimeRemaining(totalSeconds);
    setIsSubmitted(false);
    setIsActive(true);
  };

  const lessonAttempts = isComprehensiveExam
    ? attempts.filter((a) => a.lessonId === null)
    : attempts.filter((a) => a.lessonId === lesson.id);

  if (!isActive && !isSubmitted) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {isComprehensiveExam && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {onBackToStudy ? (
              <button
                type="button"
                onClick={onBackToStudy}
                className="px-3.5 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition"
              >
                <ArrowLeft className="w-4 h-4" /> Quay lại buổi học
              </button>
            ) : (
              <div />
            )}

            {availableLessons.length > 0 && onChangeSelectedLessons && (
              <div ref={dropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setDropdownOpen((prev) => !prev)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-bold inline-flex items-center gap-2 transition shadow-sm ${
                    dropdownOpen
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200'
                      : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-100 dark:hover:bg-slate-800 text-gray-800 dark:text-slate-100'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <span className="max-w-[230px] truncate">{selectedScopeSummary}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      dropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-40 p-3 space-y-2.5 pop-in">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={lessonSearch}
                        onChange={(e) => setLessonSearch(e.target.value)}
                        placeholder="Tìm buổi học muốn ôn tập..."
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs text-gray-900 dark:text-white focus:outline-none"
                      />
                    </div>

                    {filteredLessons.length > 0 && (
                      <label className="px-2.5 py-2 rounded-xl bg-stone-50 dark:bg-slate-800/80 border border-stone-200/80 dark:border-slate-700 flex items-center justify-between gap-2 text-xs cursor-pointer select-none">
                        <div className="flex items-center gap-2">
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAllDraft}
                            className="rounded border-stone-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                          />
                          <span className="font-bold text-gray-900 dark:text-white">
                            {lessonSearch.trim() ? 'Chọn tất cả kết quả lọc' : 'Chọn tất cả'}
                          </span>
                        </div>
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">
                          {draftIds.length}/{availableLessons.length} bài
                        </span>
                      </label>
                    )}

                    <div className="max-h-60 overflow-y-auto divide-y divide-stone-100 dark:divide-slate-800">
                      {filteredLessons.length === 0 ? (
                        <p className="py-6 text-center text-xs text-gray-400 dark:text-slate-500">
                          Không tìm thấy buổi học phù hợp.
                        </p>
                      ) : (
                        filteredLessons.map((item) => {
                          const checked = draftIds.includes(item.id);
                          return (
                            <label
                              key={item.id}
                              className="py-2 px-2 flex items-center justify-between gap-2 text-xs rounded-lg cursor-pointer hover:bg-stone-50 dark:hover:bg-slate-800/60"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDraftLesson(item.id)}
                                  className="rounded border-stone-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                                />
                                <span className="font-semibold text-gray-800 dark:text-slate-200 truncate">
                                  {item.title}
                                </span>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                                  item.isSystem
                                    ? 'bg-stone-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
                                    : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                {item.isSystem ? item.hskLevel : 'Tự tạo'}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="pt-2 border-t border-stone-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setDraftIds([])}
                        disabled={draftIds.length === 0}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-600 dark:text-slate-300 hover:text-red-600 disabled:opacity-40"
                      >
                        Bỏ chọn hết
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDropdownOpen(false);
                          commitDraftIfChanged(draftIds);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                      >
                        <Shuffle className="w-3.5 h-3.5" /> Áp dụng &amp; Bốc đề
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 rounded-3xl p-8 text-white shadow-xl text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md mx-auto flex items-center justify-center">
            <Award className="w-8 h-8" />
          </div>
          <span className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-wider">
            {isComprehensiveExam
              ? `${selectedLessonIds.length} bài học • Đề ngẫu nhiên`
              : 'Module 5'}
          </span>
          <h2 className="text-3xl font-bold">
            {isComprehensiveExam ? lesson.title : 'Bài kiểm tra tổng hợp cả buổi'}
          </h2>
          <p className="text-white/90 text-sm max-w-lg mx-auto">
            {isComprehensiveExam
              ? lesson.description
              : 'Đánh giá toàn diện từ vựng, nghe HSK, đọc hiểu và dịch nghĩa. Điểm thi được lưu vào lịch sử học tập.'}
          </p>
          <div className="grid grid-cols-3 gap-4 pt-3 max-w-md mx-auto">
            <div className="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span className="text-2xl font-black">{loadingExam ? '...' : questions.length}</span>
              <p className="text-[11px] uppercase text-white/80">Câu hỏi</p>
            </div>
            <div className="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span className="text-2xl font-black">100</span>
              <p className="text-[11px] uppercase text-white/80">Thang điểm</p>
            </div>
            <div className="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span className="text-2xl font-black">{loadingExam ? '...' : formatDurationMmSs(totalSeconds)}</span>
              <p className="text-[11px] uppercase text-white/80">Thời gian</p>
            </div>
          </div>

          <div className="pt-2">
            <button
              disabled={loadingExam || questions.length === 0}
              onClick={startTest}
              className="px-8 py-3.5 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-2xl font-bold text-sm shadow-lg inline-flex items-center gap-2 transition"
            >
              <Play className="w-4 h-4" />
              {loadingExam
                ? 'Đang tạo bộ đề...'
                : questions.length === 0
                  ? 'Chưa có câu hỏi'
                  : 'Bắt đầu làm bài thi'}
            </button>
          </div>
        </div>

        {lessonAttempts.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-6 space-y-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Lịch sử thi bài này</h3>
            <div className="space-y-2">
              {lessonAttempts.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 flex-wrap text-xs p-3 rounded-xl bg-stone-50 dark:bg-slate-800/60"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-500 dark:text-slate-400">
                      {new Date(a.submittedAt).toLocaleString('vi-VN')}
                    </span>
                    {isComprehensiveExam && (
                      <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-[11px] font-medium text-gray-700 dark:text-slate-300">
                        {a.examTitle || a.lessonTitle || 'Kiểm tra tổng hợp (26 bài)'}
                      </span>
                    )}
                  </div>
                  <span className="font-bold text-red-600 dark:text-red-400">
                    {a.score}/100 ({a.correctCount}/{a.totalQuestions} câu đúng)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isSubmitted) {
    const correctCount = questions.filter((q, idx) => answers[idx] === q.correctIndex).length;
    let sealText = '及格 (ĐẠT)';
    let sealColor = 'text-emerald-600 border-emerald-600';
    if (finalScore >= 90) {
      sealText = '优秀 (XUẤT SẮC)';
      sealColor = 'text-red-600 border-red-600';
    } else if (finalScore >= 70) {
      sealText = '良好 (KHÁ GIỎI)';
      sealColor = 'text-blue-600 border-blue-600';
    } else if (finalScore < 50) {
      sealText = '需努力 (CỐ GẮNG)';
      sealColor = 'text-amber-600 border-amber-600';
    }

    return (
      <div className="max-w-3xl mx-auto space-y-8 pop-in">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-xl p-8 text-center space-y-6 relative overflow-hidden">
          <div className="absolute top-6 right-6">
            <div className={`chinese-seal chinese-serif ${sealColor}`}>{sealText}</div>
          </div>
          <div>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white">Kết quả bài kiểm tra</h3>
            <p className="text-xs text-gray-500 mt-1">{lesson.title}</p>
          </div>
          <div className="text-6xl md:text-7xl font-black text-red-600 font-mono">
            {finalScore}
            <span className="text-2xl text-gray-400 font-normal">/100</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Đúng <strong className="text-emerald-600">{correctCount}</strong> / {questions.length} câu hỏi
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={startTest}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Làm lại bộ này
            </button>
            {isComprehensiveExam && onRefreshExam && (
              <button
                type="button"
                disabled={loadingExam}
                onClick={onRefreshExam}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Shuffle className="w-3.5 h-3.5" /> Bốc bộ đề khác
              </button>
            )}
            <button
              onClick={isComprehensiveExam && onBackToStudy ? onBackToStudy : onGoToVocab}
              className="px-6 py-2.5 bg-stone-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-xl text-xs font-bold"
            >
              {isComprehensiveExam ? 'Quay lại buổi học' : 'Ôn lại từ vựng'}
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-6 space-y-4">
          <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-red-600" /> Chi tiết đáp án & Giải thích
          </h4>
          {questions.map((q, idx) => {
            const uAns = answers[idx];
            const isRight = uAns === q.correctIndex;
            const badge = getCategoryBadge(q.category);
            return (
              <div
                key={q.id || idx}
                className={`p-4 rounded-2xl border space-y-2 text-xs ${
                  isRight
                    ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20'
                    : 'border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-bold px-2 py-0.5 rounded-md text-white ${
                        isRight ? 'bg-emerald-600' : 'bg-red-600'
                      }`}
                    >
                      Câu {idx + 1}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md border font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                    {isComprehensiveExam && q.lessonTitle && (
                      <span className="px-2 py-0.5 rounded-md bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-stone-200 dark:border-slate-700 font-medium">
                        {q.lessonTitle.split(':')[0]}
                      </span>
                    )}
                  </div>
                  <span className={`font-bold ${isRight ? 'text-emerald-700' : 'text-red-700'}`}>
                    {isRight ? '✓ Chính xác' : uAns === undefined ? '✗ Bỏ trống' : '✗ Chưa đúng'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white whitespace-pre-line">
                  {q.question}
                </p>
                {uAns !== undefined && !isRight && (
                  <p className="text-red-600 dark:text-red-400">
                    Bạn chọn: <strong>{String.fromCharCode(65 + uAns)}. {q.options[uAns]}</strong>
                  </p>
                )}
                <p className="text-emerald-700 dark:text-emerald-300">
                  Đáp án đúng: <strong>{String.fromCharCode(65 + q.correctIndex)}. {q.options[q.correctIndex]}</strong>
                </p>
                {q.explanation && <p className="text-gray-600 dark:text-slate-400 italic">💡 {q.explanation}</p>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const currQ = questions[currentIdx];
  const badge = getCategoryBadge(currQ?.category);
  const mins = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
  const secs = (timeRemaining % 60).toString().padStart(2, '0');

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-bold">
              Câu {currentIdx + 1} / {questions.length}
            </span>
            <span className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-sm font-bold text-red-600">
            <Clock className="w-4 h-4" /> {mins}:{secs}
          </div>
        </div>

        {currQ?.passage && (
          <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-slate-800 border border-amber-200 dark:border-slate-700 text-xs chinese-font whitespace-pre-line text-gray-800 dark:text-slate-200">
            {currQ.passage}
          </div>
        )}

        {currQ?.audioText && (
          <button
            onClick={() =>
              speakChinese(
                resolveDialogueTtsText(
                  currQ.audioText!,
                  isComprehensiveExam ? undefined : lesson.texts
                )
              )
            }
            className="px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Volume2 className="w-4 h-4" /> Bấm để nghe đoạn ghi âm
          </button>
        )}

        <p className="text-base font-bold text-gray-900 dark:text-white whitespace-pre-line">
          {currQ?.question}
        </p>

        <div className="space-y-2.5">
          {currQ?.options.map((opt, idx) => {
            const selected = answers[currentIdx] === idx;
            return (
              <button
                key={idx}
                onClick={() => setAnswers((prev) => ({ ...prev, [currentIdx]: idx }))}
                className={`w-full text-left p-3.5 rounded-2xl border text-sm transition flex items-center gap-3 ${
                  selected
                    ? 'border-red-600 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 font-semibold'
                    : 'border-stone-200 dark:border-slate-700 hover:border-red-300 text-gray-800 dark:text-slate-200'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold ${
                    selected ? 'bg-red-600 text-white' : 'bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300'
                  }`}
                >
                  {String.fromCharCode(65 + idx)}
                </span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs font-bold disabled:opacity-40"
          >
            ← Câu trước
          </button>
          <button
            disabled={currentIdx >= questions.length - 1}
            onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
            className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-xs font-bold disabled:opacity-40"
          >
            Câu tiếp →
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-5 flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase text-gray-500">Bảng câu hỏi</h4>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((_, idx) => {
              const answered = answers[idx] !== undefined;
              const isCurr = idx === currentIdx;
              return (
                <button
                  key={idx}
                  onClick={() => setCurrentIdx(idx)}
                  className={`h-9 rounded-xl text-xs font-bold transition ${
                    isCurr
                      ? 'ring-2 ring-red-600 bg-red-600 text-white'
                      : answered
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={submitTest}
          className="w-full py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md"
        >
          <Send className="w-4 h-4" /> Nộp bài ({Object.keys(answers).length}/{questions.length})
        </button>
      </div>
    </div>
  );
};
