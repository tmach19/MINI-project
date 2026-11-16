import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Flame,
  Gamepad2,
  Keyboard,
  Layers,
  ListChecks,
  RotateCcw,
  Shuffle,
  SortAsc,
  Trophy,
  Volume2,
  XCircle,
} from 'lucide-react';
import { soundFx, speakChinese } from '../lib/audio';
import { shuffleArray } from '../lib/constants';
import type { LessonDetail, VocabularyItem } from '../types';

interface GamesSectionProps {
  lesson: LessonDetail;
}

type GameMode = 'tri_match' | 'scramble' | 'translation' | 'expanded_quiz';

function normalizeClean(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s,.;:!?'"“”‘’()（）！？。，、]/g, '')
    .trim();
}

export const GamesSection: React.FC<GamesSectionProps> = ({ lesson }) => {
  const [mode, setMode] = useState<GameMode>('tri_match');

  // --- Game 1: Triple Match ---
  const [triWords, setTriWords] = useState<VocabularyItem[]>([]);
  const [selHanzi, setSelHanzi] = useState<string | null>(null);
  const [selPinyin, setSelPinyin] = useState<string | null>(null);
  const [selMeaning, setSelMeaning] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [triScore, setTriScore] = useState(0);
  const [triCombo, setTriCombo] = useState(0);
  const [triTime, setTriTime] = useState(0);
  const [triStarted, setTriStarted] = useState(false);
  const [triDone, setTriDone] = useState(false);

  const resetTriMatch = () => {
    setSelHanzi(null);
    setSelPinyin(null);
    setSelMeaning(null);
    setMatchedIds([]);
    setTriScore(0);
    setTriCombo(0);
    setTriTime(0);
    setTriStarted(false);
    setTriDone(false);
  };

  const startTriMatch = () => {
    const pool = shuffleArray(lesson.vocabulary || []).slice(0, 4);
    setTriWords(pool);
    resetTriMatch();
  };

  useEffect(() => {
    startTriMatch();
    setScrambleIdx(0);
    setSelectedTokens([]);
    setScrambleResult(null);
    setTransIdx(0);
    setTransInput('');
    setTransChecked(false);
    setQuizIdx(0);
    setQuizAnswers({});
    setQuizDone(false);
    setQuizStreak(0);
  }, [lesson.id]);

  useEffect(() => {
    if (mode !== 'tri_match' || !triStarted || triDone || triWords.length === 0) return;
    const id = window.setInterval(() => setTriTime((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [mode, triStarted, triDone, triWords.length]);

  useEffect(() => {
    if (!selHanzi || !selPinyin || !selMeaning) return;
    const timer = window.setTimeout(() => {
      if (selHanzi === selPinyin && selPinyin === selMeaning) {
        soundFx.playCorrect();
        const nextMatched = [...matchedIds, selHanzi];
        const nextCombo = triCombo + 1;
        setMatchedIds(nextMatched);
        setTriCombo(nextCombo);
        setTriScore((s) => s + 150 * nextCombo);
        if (nextMatched.length === triWords.length) {
          setTriDone(true);
          soundFx.playVictory();
        }
      } else {
        soundFx.playWrong();
        setTriCombo(0);
      }
      setSelHanzi(null);
      setSelPinyin(null);
      setSelMeaning(null);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [selHanzi, selPinyin, selMeaning]);

  const triColumns = useMemo(() => {
    return {
      hanzi: [...triWords].sort((a, b) => a.id.localeCompare(b.id)),
      pinyin: [...triWords].sort((a, b) => b.id.localeCompare(a.id)),
      meaning: [...triWords].sort((a, b) => a.hanzi.localeCompare(b.hanzi)),
    };
  }, [triWords]);

  // --- Game 2: Sentence Scramble ---
  const scrambles = lesson.exercises?.sentenceScramble || [];
  const [scrambleIdx, setScrambleIdx] = useState(0);
  const [selectedTokens, setSelectedTokens] = useState<number[]>([]);
  const [scrambleResult, setScrambleResult] = useState<boolean | null>(null);
  const currScramble = scrambles[scrambleIdx];

  const shuffledTokens = useMemo(() => {
    if (!currScramble) return [];
    return currScramble.tokens
      .map((text, idx) => ({ text, origIdx: idx }))
      .sort((a, b) => ((a.text.charCodeAt(0) + scrambleIdx) % 7) - ((b.text.charCodeAt(0) + scrambleIdx) % 7));
  }, [currScramble, scrambleIdx]);

  // --- Game 3: Bilingual Translation (Đã sửa bug length > 5) ---
  const [transMode, setTransMode] = useState<'vi_to_zh' | 'zh_to_vi'>('vi_to_zh');
  const [transIdx, setTransIdx] = useState(0);
  const [transInput, setTransInput] = useState('');
  const [transChecked, setTransChecked] = useState(false);
  const [transCorrect, setTransCorrect] = useState(false);
  const [showTransHint, setShowTransHint] = useState(false);
  const [showTransAnswer, setShowTransAnswer] = useState(false);

  const transList = useMemo(
    () => (lesson.exercises?.translationExercises || []).filter((t) => t.direction === transMode),
    [lesson.exercises, transMode]
  );
  const currTrans = transList[transIdx];

  const handleCheckTranslation = () => {
    if (!currTrans) return;
    setTransChecked(true);
    const cleanUser = normalizeClean(transInput);

    if (currTrans.direction === 'vi_to_zh') {
      const cleanZh = normalizeClean(currTrans.expectedChinese || '');
      const cleanPy = normalizeClean(currTrans.acceptedPinyin || '');
      const ok =
        Boolean(cleanUser) &&
        (cleanUser === cleanZh || (Boolean(cleanPy) && cleanUser === cleanPy));
      setTransCorrect(ok);
      if (ok) soundFx.playCorrect();
      else soundFx.playWrong();
    } else {
      // zh_to_vi: kiểm tra từ khoá thật (không dùng || userText.length > 5 như code cũ)
      const userLower = transInput.toLowerCase().trim();
      const keywords = (currTrans.acceptedKeywords || []).filter(Boolean);
      const expectedClean = normalizeClean(currTrans.expectedMeaning || '');

      let ok = false;
      if (cleanUser && expectedClean && cleanUser === expectedClean) {
        ok = true;
      } else if (keywords.length > 0) {
        const hits = keywords.filter((kw) => userLower.includes(kw.toLowerCase())).length;
        ok = hits >= Math.ceil(keywords.length * 0.6);
      }
      setTransCorrect(ok);
      if (ok) soundFx.playCorrect();
      else soundFx.playWrong();
    }
  };

  // --- Game 4: Expanded Quiz ---
  const quizList = lesson.exercises?.expandedQuiz || [];
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizStreak, setQuizStreak] = useState(0);
  const [quizDone, setQuizDone] = useState(false);
  const currQuiz = quizList[quizIdx];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-rose-500 rounded-3xl p-6 text-white shadow-xl flex flex-col lg:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <Gamepad2 className="w-3.5 h-3.5" /> Module 4: Trò chơi & Bài tập tương tác
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">4 Chế độ luyện phản xạ</h2>
          <p className="text-white/90 text-sm mt-1">
            Ghép bộ 3, Xếp câu Hán tự, Dịch song ngữ (đã sửa chấm điểm chuẩn) và Trắc nghiệm mở rộng.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1.5 bg-white/20 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 text-xs font-semibold">
          {(
            [
              ['tri_match', '1. Ghép bộ 3', Layers],
              ['scramble', '2. Sắp xếp câu', SortAsc],
              ['translation', '3. Dịch Việt–Trung', Keyboard],
              ['expanded_quiz', '4. Trắc nghiệm', ListChecks],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`px-3 py-2 rounded-xl transition text-left flex items-center gap-1.5 ${
                mode === id ? 'bg-white text-purple-700 shadow-md font-bold' : 'text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Playground */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm p-6 md:p-8">
        {/* GAME 1: TRIPLE MATCH */}
        {mode === 'tri_match' && (
          <div>
            {triWords.length < 3 ? (
              <p className="text-center text-sm text-gray-500 py-8">
                Cần tối thiểu 3 từ vựng trong buổi học để chơi Ghép bộ 3.
              </p>
            ) : triDone ? (
              <div className="text-center py-10 space-y-4 max-w-md mx-auto pop-in">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 rounded-3xl mx-auto flex items-center justify-center">
                  <Trophy className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Hoàn tất ghép bộ 3!</h3>
                <div className="flex items-center justify-center gap-8 py-4 bg-stone-50 dark:bg-slate-800 rounded-2xl">
                  <div>
                    <div className="text-2xl font-black text-purple-600">{triScore}</div>
                    <div className="text-xs text-gray-400">Điểm</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-gray-800 dark:text-white">{triTime}s</div>
                    <div className="text-xs text-gray-400">Thời gian</div>
                  </div>
                </div>
                <button
                  onClick={startTriMatch}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Chơi ván mới
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-stone-100 dark:border-slate-800 pb-4 text-sm">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 font-mono font-bold text-gray-700 dark:text-slate-200">
                      <Clock className="w-4 h-4 text-purple-600" />
                      {Math.floor(triTime / 60).toString().padStart(2, '0')}:
                      {(triTime % 60).toString().padStart(2, '0')}
                    </span>
                    <span className="flex items-center gap-1.5 font-bold text-purple-700 dark:text-purple-400">
                      <Flame className="w-4 h-4 text-amber-500" /> {triScore} điểm
                    </span>
                    {triCombo > 1 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                        {triCombo}x Combo!
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={resetTriMatch}
                      className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700 text-xs text-gray-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-300 dark:hover:border-purple-500 font-semibold flex items-center gap-1 transition active:scale-95"
                      title="Đặt lại ván hiện tại (giữ 4 từ này, đưa giờ & điểm về 0)"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                    <button
                      onClick={startTriMatch}
                      className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-xs text-gray-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-300 dark:hover:border-purple-500 font-semibold flex items-center gap-1 transition active:scale-95"
                      title="Chọn 4 từ mới ngẫu nhiên"
                    >
                      <Shuffle className="w-3.5 h-3.5" /> Đổi bộ từ
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2.5 bg-red-50/40 dark:bg-red-950/20 p-4 rounded-2xl border border-red-100 dark:border-red-900/40">
                    <h4 className="text-xs font-bold text-red-700 dark:text-red-400 uppercase text-center">
                      1. Chữ Hán
                    </h4>
                    {triColumns.hanzi.map((w) => {
                      const matched = matchedIds.includes(w.id);
                      const selected = selHanzi === w.id;
                      return (
                        <button
                          key={w.id}
                          disabled={matched}
                          onClick={() => {
                            soundFx.playFlip();
                            setTriStarted(true);
                            setSelHanzi((prev) => (prev === w.id ? null : w.id));
                          }}
                          className={`w-full p-4 rounded-xl border-2 transition text-center active:scale-[0.99] ${
                            matched
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 opacity-50'
                              : selected
                                ? 'border-red-600 bg-red-100 dark:bg-red-900/40 ring-2 ring-red-300'
                                : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-red-300 dark:hover:border-red-500 dark:hover:bg-slate-700/80'
                          }`}
                        >
                          <div className="chinese-font text-3xl font-bold text-gray-900 dark:text-white">
                            {w.hanzi}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-2.5 bg-amber-50/40 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-100 dark:border-amber-900/40">
                    <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase text-center">
                      2. Pinyin
                    </h4>
                    {triColumns.pinyin.map((w) => {
                      const matched = matchedIds.includes(w.id);
                      const selected = selPinyin === w.id;
                      return (
                        <button
                          key={w.id}
                          disabled={matched}
                          onClick={() => {
                            soundFx.playFlip();
                            setTriStarted(true);
                            setSelPinyin((prev) => (prev === w.id ? null : w.id));
                          }}
                          className={`w-full p-4 rounded-xl border-2 transition text-center active:scale-[0.99] ${
                            matched
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 opacity-50'
                              : selected
                                ? 'border-amber-600 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300'
                                : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-amber-300 dark:hover:border-amber-500 dark:hover:bg-slate-700/80'
                          }`}
                        >
                          <div className="font-mono text-lg font-bold text-amber-700 dark:text-amber-300">
                            {w.pinyin}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-2.5 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/40">
                    <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase text-center">
                      3. Nghĩa tiếng Việt
                    </h4>
                    {triColumns.meaning.map((w) => {
                      const matched = matchedIds.includes(w.id);
                      const selected = selMeaning === w.id;
                      return (
                        <button
                          key={w.id}
                          disabled={matched}
                          onClick={() => {
                            soundFx.playFlip();
                            setTriStarted(true);
                            setSelMeaning((prev) => (prev === w.id ? null : w.id));
                          }}
                          className={`w-full p-4 rounded-xl border-2 transition text-center active:scale-[0.99] ${
                            matched
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 opacity-50'
                              : selected
                                ? 'border-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 ring-2 ring-emerald-300'
                                : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-300 dark:hover:border-emerald-500 dark:hover:bg-slate-700/80'
                          }`}
                        >
                          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                            {w.meaning}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* GAME 2: SENTENCE SCRAMBLE */}
        {mode === 'scramble' && (
          <div>
            {!currScramble ? (
              <p className="text-center text-sm text-gray-500 py-8">Chưa có bài tập sắp xếp câu.</p>
            ) : (
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    Câu {scrambleIdx + 1} / {scrambles.length}
                  </span>
                  <button
                    onClick={() => speakChinese(currScramble.targetHanzi)}
                    className="text-purple-600 font-semibold flex items-center gap-1"
                  >
                    <Volume2 className="w-3.5 h-3.5" /> Nghe câu mẫu
                  </button>
                </div>

                <div className="p-5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40 space-y-1">
                  <div className="text-xs uppercase font-bold text-purple-700 dark:text-purple-300">
                    Nghĩa cần ghép:
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white">
                    {currScramble.targetMeaning}
                  </div>
                  {currScramble.unlearnedHint && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
                      💡 {currScramble.unlearnedHint}
                    </p>
                  )}
                </div>

                <div className="min-h-[72px] p-4 rounded-2xl border-2 border-dashed border-stone-300 dark:border-slate-700 flex flex-wrap gap-2 items-center">
                  {selectedTokens.length === 0 ? (
                    <span className="text-xs text-gray-400">Bấm các mảnh từ bên dưới để ghép thành câu...</span>
                  ) : (
                    selectedTokens.map((tokIdx, pos) => {
                      const tok = shuffledTokens[tokIdx];
                      return (
                        <button
                          key={`${tokIdx}-${pos}`}
                          onClick={() => {
                            setScrambleResult(null);
                            setSelectedTokens((list) => list.filter((_, i) => i !== pos));
                          }}
                          className="px-3.5 py-2 rounded-xl bg-purple-600 text-white chinese-font font-bold text-lg shadow-sm"
                        >
                          {tok.text}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex flex-wrap gap-2 justify-center">
                  {shuffledTokens.map((tok, idx) => {
                    const used = selectedTokens.includes(idx);
                    return (
                      <button
                        key={idx}
                        disabled={used}
                        onClick={() => {
                          soundFx.playFlip();
                          setScrambleResult(null);
                          setSelectedTokens((list) => [...list, idx]);
                        }}
                        className={`px-4 py-2 rounded-xl border text-lg chinese-font font-bold transition ${
                          used
                            ? 'opacity-30 border-stone-200 dark:border-slate-700'
                            : 'bg-white dark:bg-slate-800 border-stone-300 dark:border-slate-700 hover:border-purple-500 text-gray-900 dark:text-white'
                        }`}
                      >
                        {tok.text}
                      </button>
                    );
                  })}
                </div>

                {scrambleResult !== null && (
                  <div
                    className={`p-4 rounded-2xl border text-xs flex items-center gap-2 ${
                      scrambleResult
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 text-emerald-800 dark:text-emerald-200'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 text-red-800 dark:text-red-200'
                    }`}
                  >
                    {scrambleResult ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          Chính xác! <strong className="chinese-font">{currScramble.targetHanzi}</strong> (
                          {currScramble.pinyin})
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        <span>
                          Chưa đúng thứ tự. Đáp án:{' '}
                          <strong className="chinese-font">{currScramble.targetHanzi}</strong>
                        </span>
                      </>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => {
                      setSelectedTokens([]);
                      setScrambleResult(null);
                    }}
                    className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs font-bold"
                  >
                    Xoá chọn lại
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const built = selectedTokens.map((i) => shuffledTokens[i].text).join('');
                        const ok = normalizeClean(built) === normalizeClean(currScramble.targetHanzi);
                        setScrambleResult(ok);
                        if (ok) soundFx.playCorrect();
                        else soundFx.playWrong();
                      }}
                      className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold"
                    >
                      Kiểm tra
                    </button>
                    <button
                      onClick={() => {
                        setScrambleIdx((i) => (i + 1) % scrambles.length);
                        setSelectedTokens([]);
                        setScrambleResult(null);
                      }}
                      className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-xs font-bold"
                    >
                      Câu tiếp →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* GAME 3: TRANSLATION */}
        {mode === 'translation' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="inline-flex bg-stone-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => {
                    setTransMode('vi_to_zh');
                    setTransIdx(0);
                    setTransInput('');
                    setTransChecked(false);
                    setShowTransHint(false);
                    setShowTransAnswer(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg ${
                    transMode === 'vi_to_zh'
                      ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  Việt → Trung (Gõ Hán tự / Pinyin)
                </button>
                <button
                  onClick={() => {
                    setTransMode('zh_to_vi');
                    setTransIdx(0);
                    setTransInput('');
                    setTransChecked(false);
                    setShowTransHint(false);
                    setShowTransAnswer(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg ${
                    transMode === 'zh_to_vi'
                      ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  Trung → Việt
                </button>
              </div>
              {transList.length > 0 && (
                <span className="text-xs font-mono text-gray-400">
                  {transIdx + 1} / {transList.length}
                </span>
              )}
            </div>

            {!currTrans ? (
              <p className="text-center text-sm text-gray-500 py-8">Chưa có bài tập dịch cho chiều này.</p>
            ) : (
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-stone-50 dark:bg-slate-800/60 border border-stone-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-purple-600 dark:text-purple-400">
                      {currTrans.direction === 'vi_to_zh' ? 'Dịch sang tiếng Trung' : 'Dịch sang tiếng Việt'}
                    </span>
                    {currTrans.chineseAudioText && (
                      <button
                        onClick={() => speakChinese(currTrans.chineseAudioText!)}
                        className="text-xs text-purple-600 font-semibold flex items-center gap-1"
                      >
                        <Volume2 className="w-3.5 h-3.5" /> Nghe câu
                      </button>
                    )}
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white chinese-font">
                    {currTrans.promptText}
                  </div>
                  {showTransHint && currTrans.hint && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">💡 {currTrans.hint}</p>
                  )}
                  {showTransAnswer && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
                      Đáp án:{' '}
                      {currTrans.direction === 'vi_to_zh'
                        ? `${currTrans.expectedChinese} (${currTrans.acceptedPinyin || ''})`
                        : currTrans.expectedMeaning}
                    </p>
                  )}
                </div>

                <input
                  type="text"
                  value={transInput}
                  onChange={(e) => setTransInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCheckTranslation();
                  }}
                  placeholder={
                    currTrans.direction === 'vi_to_zh'
                      ? 'Nhập Hán tự hoặc Pinyin...'
                      : 'Nhập nghĩa tiếng Việt...'
                  }
                  className="w-full p-3.5 rounded-2xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:border-purple-500"
                />

                {transChecked && (
                  <div
                    className={`p-4 rounded-2xl border text-xs ${
                      transCorrect
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 text-emerald-800 dark:text-emerald-200'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 text-red-800 dark:text-red-200'
                    }`}
                  >
                    <strong>{transCorrect ? 'Chính xác!' : 'Chưa khớp!'}</strong>{' '}
                    {currTrans.explanation}
                  </div>
                )}

                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowTransHint((s) => !s)}
                      className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold"
                    >
                      Gợi ý
                    </button>
                    <button
                      onClick={() => setShowTransAnswer((s) => !s)}
                      className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-xs font-semibold"
                    >
                      Xem đáp án
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCheckTranslation}
                      className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold"
                    >
                      Kiểm tra
                    </button>
                    <button
                      onClick={() => {
                        setTransIdx((i) => (i + 1) % transList.length);
                        setTransInput('');
                        setTransChecked(false);
                        setShowTransHint(false);
                        setShowTransAnswer(false);
                      }}
                      className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-xs font-bold"
                    >
                      Câu tiếp →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* GAME 4: EXPANDED QUIZ */}
        {mode === 'expanded_quiz' && (
          <div className="max-w-2xl mx-auto space-y-6">
            {quizList.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">Chưa có câu hỏi trắc nghiệm mở rộng.</p>
            ) : quizDone ? (
              <div className="text-center py-8 space-y-4 pop-in">
                <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Hoàn thành trắc nghiệm!</h3>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Bạn trả lời đúng{' '}
                  <strong className="text-emerald-600">
                    {quizList.filter((q, i) => quizAnswers[i] === q.correctIndex).length}
                  </strong>{' '}
                  / {quizList.length} câu.
                </p>
                <button
                  onClick={() => {
                    setQuizIdx(0);
                    setQuizAnswers({});
                    setQuizDone(false);
                    setQuizStreak(0);
                  }}
                  className="px-6 py-2.5 bg-purple-600 text-white rounded-xl text-xs font-bold"
                >
                  Làm lại
                </button>
              </div>
            ) : (
              currQuiz && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-gray-500">
                      Câu {quizIdx + 1} / {quizList.length}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-bold">
                      Chuỗi đúng: {quizStreak}
                    </span>
                  </div>

                  <div className="p-5 rounded-2xl bg-stone-50 dark:bg-slate-800/60 border border-stone-200 dark:border-slate-700 text-base font-bold text-gray-900 dark:text-white">
                    {currQuiz.question}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {currQuiz.options.map((opt, optIdx) => {
                      const chosen = quizAnswers[quizIdx];
                      const answered = chosen !== undefined;
                      const isRight = optIdx === currQuiz.correctIndex;
                      let cls =
                        'border-stone-200 dark:border-slate-700 hover:border-purple-400 text-gray-800 dark:text-slate-200';
                      if (answered) {
                        if (isRight) cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 font-bold';
                        else if (chosen === optIdx) cls = 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200';
                      }
                      return (
                        <button
                          key={optIdx}
                          disabled={answered}
                          onClick={() => {
                            setQuizAnswers((prev) => ({ ...prev, [quizIdx]: optIdx }));
                            if (optIdx === currQuiz.correctIndex) {
                              soundFx.playCorrect();
                              setQuizStreak((s) => s + 1);
                            } else {
                              soundFx.playWrong();
                              setQuizStreak(0);
                            }
                          }}
                          className={`p-3.5 rounded-xl border text-left text-xs transition flex items-center gap-2.5 ${cls}`}
                        >
                          <span className="w-6 h-6 rounded-lg bg-stone-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold">
                            {String.fromCharCode(65 + optIdx)}
                          </span>
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {quizAnswers[quizIdx] !== undefined && currQuiz.explanation && (
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200">
                      💡 {currQuiz.explanation}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        if (quizIdx + 1 >= quizList.length) setQuizDone(true);
                        else setQuizIdx((i) => i + 1);
                      }}
                      className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold"
                    >
                      {quizIdx + 1 >= quizList.length ? 'Xem kết quả' : 'Câu tiếp →'}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};
