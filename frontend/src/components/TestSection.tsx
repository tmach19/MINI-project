import React, { useEffect, useState } from 'react';
import { Award, CheckCircle2, Clock, Play, RotateCcw, Send, Volume2 } from 'lucide-react';
import { soundFx, speakChinese } from '../lib/audio';
import type { LessonDetail, TestAttemptRecord } from '../types';

interface TestSectionProps {
  lesson: LessonDetail;
  attempts: TestAttemptRecord[];
  onSaveAttempt: (payload: {
    lessonId: string;
    score: number;
    totalQuestions: number;
    correctCount: number;
    durationSeconds: number;
    answers: Record<string, number>;
  }) => void;
  onGoToVocab: () => void;
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
}) => {
  const questions = lesson.comprehensiveTest || [];
  const totalSeconds = getTestDurationSeconds(questions.length);
  const [isActive, setIsActive] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [timeRemaining, setTimeRemaining] = useState(totalSeconds);
  const [finalScore, setFinalScore] = useState(0);

  useEffect(() => {
    setIsActive(false);
    setIsSubmitted(false);
    setAnswers({});
    setCurrentIdx(0);
    setTimeRemaining(totalSeconds);
  }, [lesson.id, totalSeconds]);

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
      lessonId: lesson.id,
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

  const lessonAttempts = attempts.filter((a) => a.lessonId === lesson.id);

  if (!isActive && !isSubmitted) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 rounded-3xl p-8 text-white shadow-xl text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md mx-auto flex items-center justify-center">
            <Award className="w-8 h-8" />
          </div>
          <span className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-wider">
            Module 5
          </span>
          <h2 className="text-3xl font-bold">Bài kiểm tra tổng hợp cả buổi</h2>
          <p className="text-white/90 text-sm max-w-lg mx-auto">
            Đánh giá toàn diện từ vựng, nghe HSK, đọc hiểu và dịch nghĩa. Điểm thi được lưu vào lịch sử học tập.
          </p>
          <div className="grid grid-cols-3 gap-4 pt-3 max-w-md mx-auto">
            <div className="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span className="text-2xl font-black">{questions.length}</span>
              <p className="text-[11px] uppercase text-white/80">Câu hỏi</p>
            </div>
            <div className="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span className="text-2xl font-black">100</span>
              <p className="text-[11px] uppercase text-white/80">Thang điểm</p>
            </div>
            <div className="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span className="text-2xl font-black">{formatDurationMmSs(totalSeconds)}</span>
              <p className="text-[11px] uppercase text-white/80">Thời gian</p>
            </div>
          </div>

          <button
            disabled={questions.length === 0}
            onClick={startTest}
            className="mt-4 px-8 py-3.5 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-2xl font-bold text-sm shadow-lg inline-flex items-center gap-2 transition"
          >
            <Play className="w-4 h-4" /> {questions.length === 0 ? 'Chưa có câu hỏi' : 'Bắt đầu làm bài thi'}
          </button>
        </div>

        {lessonAttempts.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-6 space-y-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Lịch sử thi bài này</h3>
            <div className="space-y-2">
              {lessonAttempts.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-xs p-3 rounded-xl bg-stone-50 dark:bg-slate-800/60"
                >
                  <span className="text-gray-500 dark:text-slate-400">
                    {new Date(a.submittedAt).toLocaleString('vi-VN')}
                  </span>
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
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={startTest}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Làm lại
            </button>
            <button
              onClick={onGoToVocab}
              className="px-6 py-2.5 bg-stone-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-xl text-xs font-bold"
            >
              Ôn lại từ vựng
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
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
            onClick={() => speakChinese(currQ.audioText!)}
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
