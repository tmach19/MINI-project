import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Flame,
  Gamepad2,
  Keyboard,
  Layers,
  ListChecks,
  Medal,
  RotateCcw,
  Shuffle,
  SortAsc,
  Trophy,
  Volume2,
  XCircle,
} from 'lucide-react';
import { soundFx, speakChinese } from '../lib/audio';
import { api } from '../lib/api';
import { shuffleArray } from '../lib/constants';
import { getAvatarPreset, isImageMediaUrl } from '../lib/profileMedia';
import type {
  ExpandedQuizQuestion,
  GameLeaderboardEntry,
  GameMode,
  LessonDetail,
  ScrambleExercise,
  TranslationExercise,
  VocabularyItem,
} from '../types';

interface GamesSectionProps {
  lesson: LessonDetail;
  currentUserId?: string;
}

const GAME_MODE_LABELS: Record<GameMode, string> = {
  tri_match: '1. Ghép bộ 3',
  scramble: '2. Sắp xếp câu',
  translation: '3. Dịch Việt-Trung',
  expanded_quiz: '4. Trắc nghiệm',
};

function formatDurationClock(seconds: number): string {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatPlayedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

const SCRAMBLE_DECK_SIZE = 6;
const TRANS_DECK_SIZE = 6;
const QUIZ_DECK_SIZE = 10;

function pickNextDeck<T extends { id: string }>(
  pool: T[],
  prevIds: string[],
  deckSize: number
): T[] {
  if (pool.length === 0) return [];
  if (pool.length <= deckSize) return shuffleArray(pool);

  const prevSet = new Set(prevIds);
  const unseen = shuffleArray(pool.filter((item) => !prevSet.has(item.id)));
  const seen = shuffleArray(pool.filter((item) => prevSet.has(item.id)));
  return shuffleArray([...unseen, ...seen].slice(0, deckSize));
}

function normalizeClean(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s,.;:!?'"“”‘’()（）！？。，、]/g, '')
    .trim();
}

const PINYIN_TONE_MAP: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'u', ǘ: 'u', ǚ: 'u', ǜ: 'u', ü: 'u',
};

function stripPinyinTones(str: string): string {
  return normalizeClean(str).replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, (ch) => PINYIN_TONE_MAP[ch] ?? ch);
}

function tokenizeWords(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[,.;:!?'"“”‘’()（）！？。，、/]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isZhToViCompleteMatch(
  userInput: string,
  expectedMeaning?: string | null,
  acceptedKeywords?: string[]
): boolean {
  const cleanUser = normalizeClean(userInput);
  if (!cleanUser) return false;

  const expectedClean = normalizeClean(expectedMeaning || '');
  if (expectedClean && cleanUser === expectedClean) return true;

  const expectedWords = tokenizeWords(expectedMeaning || '');
  if (expectedWords.length > 0) {
    const userWords = tokenizeWords(userInput);
    const minRequiredWords =
      expectedWords.length <= 4 ? expectedWords.length : Math.ceil(expectedWords.length * 0.8);
    if (userWords.length < minRequiredWords) return false;

    const remainingCounts = new Map<string, number>();
    for (const w of userWords) {
      remainingCounts.set(w, (remainingCounts.get(w) || 0) + 1);
    }

    let matched = 0;
    for (const w of expectedWords) {
      const left = remainingCounts.get(w) || 0;
      if (left > 0) {
        matched++;
        remainingCounts.set(w, left - 1);
      }
    }

    if (matched < minRequiredWords) return false;

    // Ensure the user did not stop mid-sentence by checking the tail of longer sentences
    if (expectedWords.length >= 5) {
      const userWordSet = new Set(userWords);
      const tailWords = expectedWords.slice(-2);
      if (!tailWords.some((w) => userWordSet.has(w))) return false;
    }

    return true;
  }

  const keywords = (acceptedKeywords || []).filter(Boolean);
  if (keywords.length === 0) return false;
  const userLower = userInput.toLowerCase().trim();
  return keywords.every((kw) => userLower.includes(kw.toLowerCase()));
}

export const GamesSection: React.FC<GamesSectionProps> = ({ lesson, currentUserId }) => {
  const [mode, setMode] = useState<GameMode>('tri_match');

  // --- Leaderboard ---
  const [lbMode, setLbMode] = useState<GameMode | 'all'>('tri_match');
  const [lbEntries, setLbEntries] = useState<GameLeaderboardEntry[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    setLbLoading(true);
    setLbError(null);
    try {
      const res = await api.getGameLeaderboard({
        lessonId: lesson.id,
        gameMode: lbMode === 'all' ? undefined : lbMode,
        limit: 30,
      });
      setLbEntries(res.entries || []);
    } catch (err) {
      setLbError((err as Error).message || 'Không tải được bảng xếp hạng.');
    } finally {
      setLbLoading(false);
    }
  }, [lesson.id, lbMode]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    setLbMode(mode);
  }, [mode]);

  const submitScore = useCallback(
    async (payload: {
      gameMode: GameMode;
      score: number;
      maxScore?: number | null;
      durationSeconds: number;
    }) => {
      try {
        await api.submitGameScore({
          lessonId: lesson.id,
          ...payload,
        });
        setSavedNotice(`Đã lưu kết quả (${payload.score} điểm) lên bảng xếp hạng!`);
        window.setTimeout(() => setSavedNotice(null), 4000);
        await fetchLeaderboard();
      } catch (err) {
        console.warn('[GamesSection] Không lưu được điểm trò chơi:', err);
      }
    },
    [lesson.id, fetchLeaderboard]
  );

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
  const triSubmittedRef = useRef(false);

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
    triSubmittedRef.current = false;
  };

  const startTriMatch = () => {
    const pool = shuffleArray(lesson.vocabulary || []).slice(0, 4);
    setTriWords(pool);
    resetTriMatch();
  };

  useEffect(() => {
    startTriMatch();
    const scPool = lesson.exercises?.sentenceScramble || [];
    setScrambleDeck(pickNextDeck(scPool, [], SCRAMBLE_DECK_SIZE));
    setScrambleIdx(0);
    setSelectedTokens([]);
    setScrambleResult(null);
    setScrambleScoreMap({});
    setScrambleStarted(false);
    setScrambleTime(0);
    setScrambleDone(false);
    scrambleSubmittedRef.current = false;
    setDragSource(null);
    setDragOverPos(null);
    setDragOverBox(null);

    const trPool = (lesson.exercises?.translationExercises || []).filter(
      (t) => t.direction === transMode
    );
    setTransDeck(pickNextDeck(trPool, [], TRANS_DECK_SIZE));
    setTransIdx(0);
    setTransInput('');
    setTransChecked(false);
    setShowTransHint(false);
    setShowTransAnswer(false);
    setTransScoreMap({});
    setTransStarted(false);
    setTransTime(0);
    setTransDone(false);
    transSubmittedRef.current = false;

    const qPool = lesson.exercises?.expandedQuiz || [];
    setQuizDeck(pickNextDeck(qPool, [], QUIZ_DECK_SIZE));
    setQuizIdx(0);
    setQuizAnswers({});
    setQuizDone(false);
    setQuizStreak(0);
    setQuizStarted(false);
    setQuizTime(0);
    quizSubmittedRef.current = false;
  }, [lesson.id, lesson.exercises]);

  useEffect(() => {
    if (mode !== 'tri_match' || !triStarted || triDone || triWords.length === 0) return;
    const id = window.setInterval(() => setTriTime((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [mode, triStarted, triDone, triWords.length]);

  useEffect(() => {
    if (!triDone || triWords.length === 0 || triSubmittedRef.current) return;
    triSubmittedRef.current = true;
    const n = triWords.length;
    const maxScore = 75 * n * (n + 1);
    void submitScore({
      gameMode: 'tri_match',
      score: triScore,
      maxScore,
      durationSeconds: triTime,
    });
  }, [triDone, triWords.length, triScore, triTime, submitScore]);

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
  const scramblePool = lesson.exercises?.sentenceScramble || [];
  const [scrambleDeck, setScrambleDeck] = useState<ScrambleExercise[]>([]);
  const [scrambleIdx, setScrambleIdx] = useState(0);
  const [selectedTokens, setSelectedTokens] = useState<number[]>([]);
  const [scrambleResult, setScrambleResult] = useState<boolean | null>(null);
  const [scrambleScoreMap, setScrambleScoreMap] = useState<Record<number, boolean>>({});
  const [scrambleStarted, setScrambleStarted] = useState(false);
  const [scrambleTime, setScrambleTime] = useState(0);
  const [scrambleDone, setScrambleDone] = useState(false);
  const scrambleSubmittedRef = useRef(false);
  const [dragSource, setDragSource] = useState<
    { type: 'selected'; pos: number } | { type: 'pool'; idx: number } | null
  >(null);
  const [dragOverPos, setDragOverPos] = useState<number | null>(null);
  const [dragOverBox, setDragOverBox] = useState<'selected' | 'pool' | null>(null);
  const touchMovedRef = useRef(false);
  const currScramble = scrambleDeck[scrambleIdx];

  useEffect(() => {
    if (mode !== 'scramble' || !scrambleStarted || scrambleDone || scrambleDeck.length === 0) return;
    const id = window.setInterval(() => setScrambleTime((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [mode, scrambleStarted, scrambleDone, scrambleDeck.length]);

  const scrambleCorrectCount = useMemo(
    () => Object.values(scrambleScoreMap).filter(Boolean).length,
    [scrambleScoreMap]
  );

  useEffect(() => {
    if (!scrambleDone || scrambleDeck.length === 0 || scrambleSubmittedRef.current) return;
    scrambleSubmittedRef.current = true;
    void submitScore({
      gameMode: 'scramble',
      score: scrambleCorrectCount * 100,
      maxScore: scrambleDeck.length * 100,
      durationSeconds: scrambleTime,
    });
  }, [scrambleDone, scrambleDeck.length, scrambleCorrectCount, scrambleTime, submitScore]);

  const clearScrambleDrag = () => {
    setDragSource(null);
    setDragOverPos(null);
    setDragOverBox(null);
    window.setTimeout(() => {
      touchMovedRef.current = false;
    }, 50);
  };

  const handleScrambleDropOnSelected = (targetPos?: number) => {
    if (!dragSource) return;
    setScrambleResult(null);

    if (dragSource.type === 'selected') {
      const fromPos = dragSource.pos;
      setSelectedTokens((prev) => {
        if (fromPos < 0 || fromPos >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromPos, 1);
        const dest =
          targetPos === undefined
            ? next.length
            : Math.max(0, Math.min(targetPos, next.length));
        next.splice(dest, 0, moved);
        return next;
      });
      soundFx.playFlip();
    } else if (dragSource.type === 'pool') {
      const poolIdx = dragSource.idx;
      setSelectedTokens((prev) => {
        if (prev.includes(poolIdx)) return prev;
        const next = [...prev];
        const dest =
          targetPos === undefined
            ? next.length
            : Math.max(0, Math.min(targetPos, next.length));
        next.splice(dest, 0, poolIdx);
        return next;
      });
      soundFx.playFlip();
    }
    clearScrambleDrag();
  };

  const handleScrambleDropOnPool = () => {
    if (!dragSource || dragSource.type !== 'selected') {
      clearScrambleDrag();
      return;
    }
    const removePos = dragSource.pos;
    setScrambleResult(null);
    setSelectedTokens((prev) => prev.filter((_, i) => i !== removePos));
    clearScrambleDrag();
  };

  const restartScrambleRound = () => {
    setScrambleIdx(0);
    setSelectedTokens([]);
    setScrambleResult(null);
    setScrambleScoreMap({});
    setScrambleStarted(false);
    setScrambleTime(0);
    setScrambleDone(false);
    scrambleSubmittedRef.current = false;
    setDragSource(null);
    setDragOverPos(null);
    setDragOverBox(null);
    clearScrambleDrag();
  };

  const refreshScrambleDeck = () => {
    setScrambleDeck((prev) =>
      pickNextDeck(
        scramblePool,
        prev.map((x) => x.id),
        SCRAMBLE_DECK_SIZE
      )
    );
    restartScrambleRound();
  };

  const shuffledTokens = useMemo(() => {
    if (!currScramble) return [];
    return currScramble.tokens
      .map((text, idx) => ({ text, origIdx: idx }))
      .sort((a, b) => ((a.text.charCodeAt(0) + scrambleIdx) % 7) - ((b.text.charCodeAt(0) + scrambleIdx) % 7));
  }, [currScramble, scrambleIdx]);

  // --- Game 3: Bilingual Translation ---
  const [transMode, setTransMode] = useState<'vi_to_zh' | 'zh_to_vi'>('vi_to_zh');
  const [transDeck, setTransDeck] = useState<TranslationExercise[]>([]);
  const [transIdx, setTransIdx] = useState(0);
  const [transInput, setTransInput] = useState('');
  const [transChecked, setTransChecked] = useState(false);
  const [transCorrect, setTransCorrect] = useState(false);
  const [showTransHint, setShowTransHint] = useState(false);
  const [showTransAnswer, setShowTransAnswer] = useState(false);
  const [transScoreMap, setTransScoreMap] = useState<Record<number, boolean>>({});
  const [transStarted, setTransStarted] = useState(false);
  const [transTime, setTransTime] = useState(0);
  const [transDone, setTransDone] = useState(false);
  const transSubmittedRef = useRef(false);

  const transPool = useMemo(
    () => (lesson.exercises?.translationExercises || []).filter((t) => t.direction === transMode),
    [lesson.exercises, transMode]
  );
  const currTrans = transDeck[transIdx];

  useEffect(() => {
    if (mode !== 'translation' || !transStarted || transDone || transDeck.length === 0) return;
    const id = window.setInterval(() => setTransTime((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [mode, transStarted, transDone, transDeck.length]);

  const transCorrectCount = useMemo(
    () => Object.values(transScoreMap).filter(Boolean).length,
    [transScoreMap]
  );

  useEffect(() => {
    if (!transDone || transDeck.length === 0 || transSubmittedRef.current) return;
    transSubmittedRef.current = true;
    void submitScore({
      gameMode: 'translation',
      score: transCorrectCount * 100,
      maxScore: transDeck.length * 100,
      durationSeconds: transTime,
    });
  }, [transDone, transDeck.length, transCorrectCount, transTime, submitScore]);

  const restartTransRound = () => {
    setTransIdx(0);
    setTransInput('');
    setTransChecked(false);
    setShowTransHint(false);
    setShowTransAnswer(false);
    setTransScoreMap({});
    setTransStarted(false);
    setTransTime(0);
    setTransDone(false);
    transSubmittedRef.current = false;
  };

  const refreshTransDeck = (targetDir?: 'vi_to_zh' | 'zh_to_vi') => {
    const dir = targetDir || transMode;
    const pool = (lesson.exercises?.translationExercises || []).filter((t) => t.direction === dir);
    setTransDeck((prev) =>
      pickNextDeck(
        pool,
        targetDir ? [] : prev.map((x) => x.id),
        TRANS_DECK_SIZE
      )
    );
    restartTransRound();
  };

  const handleCheckTranslation = () => {
    if (!currTrans) return;
    const cleanUser = normalizeClean(transInput);
    if (!cleanUser) {
      setTransChecked(false);
      return;
    }

    setTransStarted(true);
    setTransChecked(true);

    let ok = false;
    if (currTrans.direction === 'vi_to_zh') {
      const cleanZh = normalizeClean(currTrans.expectedChinese || '');
      const cleanPy = normalizeClean(currTrans.acceptedPinyin || '');
      const cleanUserNoTone = stripPinyinTones(transInput);
      const cleanPyNoTone = stripPinyinTones(currTrans.acceptedPinyin || '');
      ok =
        cleanUser === cleanZh ||
        (Boolean(cleanPy) && (cleanUser === cleanPy || cleanUserNoTone === cleanPyNoTone));
    } else {
      ok = isZhToViCompleteMatch(
        transInput,
        currTrans.expectedMeaning,
        currTrans.acceptedKeywords
      );
    }

    setTransCorrect(ok);
    setTransScoreMap((prev) => ({ ...prev, [transIdx]: ok || Boolean(prev[transIdx]) }));
    if (ok) soundFx.playCorrect();
    else soundFx.playWrong();
  };

  // --- Game 4: Expanded Quiz ---
  const quizPool = lesson.exercises?.expandedQuiz || [];
  const [quizDeck, setQuizDeck] = useState<ExpandedQuizQuestion[]>([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizStreak, setQuizStreak] = useState(0);
  const [quizDone, setQuizDone] = useState(false);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizTime, setQuizTime] = useState(0);
  const quizSubmittedRef = useRef(false);
  const currQuiz = quizDeck[quizIdx];

  useEffect(() => {
    if (mode !== 'expanded_quiz' || !quizStarted || quizDone || quizDeck.length === 0) return;
    const id = window.setInterval(() => setQuizTime((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [mode, quizStarted, quizDone, quizDeck.length]);

  const quizCorrectCount = useMemo(
    () =>
      Object.entries(quizAnswers).filter(
        ([idx, ans]) => quizDeck[Number(idx)]?.correctIndex === ans
      ).length,
    [quizAnswers, quizDeck]
  );

  useEffect(() => {
    if (!quizDone || quizDeck.length === 0 || quizSubmittedRef.current) return;
    quizSubmittedRef.current = true;
    void submitScore({
      gameMode: 'expanded_quiz',
      score: quizCorrectCount * 100,
      maxScore: quizDeck.length * 100,
      durationSeconds: quizTime,
    });
  }, [quizDone, quizDeck.length, quizCorrectCount, quizTime, submitScore]);

  const restartQuizRound = () => {
    setQuizIdx(0);
    setQuizAnswers({});
    setQuizDone(false);
    setQuizStreak(0);
    setQuizStarted(false);
    setQuizTime(0);
    quizSubmittedRef.current = false;
  };

  const refreshQuizDeck = () => {
    setQuizDeck((prev) =>
      pickNextDeck(
        quizPool,
        prev.map((x) => x.id),
        QUIZ_DECK_SIZE
      )
    );
    restartQuizRound();
  };

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
            {scrambleDeck.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">Chưa có bài tập sắp xếp câu.</p>
            ) : scrambleDone ? (
              <div className="text-center py-8 space-y-4 pop-in">
                <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Hoàn thành Xếp câu Hán tự!
                </h3>
                <div className="flex justify-center gap-8 text-center">
                  <div>
                    <div className="text-2xl font-black text-purple-600">
                      {scrambleCorrectCount * 100}
                    </div>
                    <div className="text-xs text-gray-400">
                      Điểm ({scrambleCorrectCount}/{scrambleDeck.length} câu)
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-gray-800 dark:text-white">
                      {formatDurationClock(scrambleTime)}
                    </div>
                    <div className="text-xs text-gray-400">Thời gian</div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2.5 flex-wrap">
                  <button
                    onClick={restartScrambleRound}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Làm lại bộ này
                  </button>
                  {scramblePool.length > 1 && (
                    <button
                      type="button"
                      onClick={refreshScrambleDeck}
                      className="px-6 py-2.5 border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-gray-800 dark:text-slate-100 hover:text-purple-600 dark:hover:text-purple-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition"
                    >
                      <Shuffle className="w-3.5 h-3.5" /> Đổi bộ đề mới
                    </button>
                  )}
                </div>
              </div>
            ) : currScramble ? (
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-gray-500">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span>
                      Câu {scrambleIdx + 1} / {scrambleDeck.length}
                      {scramblePool.length > scrambleDeck.length && (
                        <span className="ml-1.5 text-gray-400">(Kho {scramblePool.length} câu)</span>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono font-bold text-gray-700 dark:text-slate-200">
                      <Clock className="w-3.5 h-3.5 text-purple-600" />
                      {formatDurationClock(scrambleTime)}
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold text-purple-700 dark:text-purple-400">
                      <Flame className="w-3.5 h-3.5 text-amber-500" /> {scrambleCorrectCount * 100} điểm
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => speakChinese(currScramble.targetHanzi)}
                      className="text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1"
                    >
                      <Volume2 className="w-3.5 h-3.5" /> Nghe câu mẫu
                    </button>
                    {scramblePool.length > 1 && (
                      <button
                        type="button"
                        onClick={refreshScrambleDeck}
                        className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-xs text-gray-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-300 dark:hover:border-purple-500 font-semibold flex items-center gap-1 transition active:scale-95"
                        title="Đổi sang bộ câu sắp xếp khác"
                      >
                        <Shuffle className="w-3.5 h-3.5" /> Đổi bộ đề
                      </button>
                    )}
                  </div>
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

                <div className="space-y-1.5">
                  <div
                    data-scramble-drop-box="selected"
                    onDragOver={(e) => {
                      if (!dragSource) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverBox('selected');
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverBox(null);
                        setDragOverPos(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleScrambleDropOnSelected();
                    }}
                    className={`min-h-[72px] p-4 rounded-2xl border-2 border-dashed flex flex-wrap gap-2 items-center transition ${
                      dragOverBox === 'selected' && dragOverPos === null
                        ? 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/20'
                        : 'border-stone-300 dark:border-slate-700'
                    }`}
                  >
                    {selectedTokens.length === 0 ? (
                      <span className="text-xs text-gray-400">
                        Bấm hoặc kéo thả các mảnh từ bên dưới vào đây để ghép câu...
                      </span>
                    ) : (
                      selectedTokens.map((tokIdx, pos) => {
                        const tok = shuffledTokens[tokIdx];
                        const isDragging = dragSource?.type === 'selected' && dragSource.pos === pos;
                        const isHovered = dragOverPos === pos && !isDragging;
                        return (
                          <button
                            key={`${tokIdx}-${pos}`}
                            type="button"
                            draggable
                            data-scramble-pos={pos}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', String(pos));
                              setDragSource({ type: 'selected', pos });
                            }}
                            onDragOver={(e) => {
                              if (!dragSource) return;
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'move';
                              setDragOverBox('selected');
                              setDragOverPos(pos);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleScrambleDropOnSelected(pos);
                            }}
                            onDragEnd={clearScrambleDrag}
                            onTouchStart={() => {
                              touchMovedRef.current = false;
                              setDragSource({ type: 'selected', pos });
                            }}
                            onTouchMove={(e) => {
                              if (!dragSource) return;
                              touchMovedRef.current = true;
                              const touch = e.touches[0];
                              if (!touch) return;
                              const el = document.elementFromPoint(touch.clientX, touch.clientY);
                              const posAttr = el?.closest('[data-scramble-pos]')?.getAttribute('data-scramble-pos');
                              const boxAttr = el?.closest('[data-scramble-drop-box]')?.getAttribute('data-scramble-drop-box');
                              setDragOverPos(posAttr !== null && posAttr !== undefined ? Number(posAttr) : null);
                              setDragOverBox(
                                boxAttr === 'selected' || boxAttr === 'pool' ? boxAttr : null
                              );
                            }}
                            onTouchEnd={() => {
                              if (!touchMovedRef.current) {
                                clearScrambleDrag();
                                return;
                              }
                              if (dragOverPos !== null) {
                                handleScrambleDropOnSelected(dragOverPos);
                              } else if (dragOverBox === 'selected') {
                                handleScrambleDropOnSelected();
                              } else if (dragOverBox === 'pool') {
                                handleScrambleDropOnPool();
                              } else {
                                clearScrambleDrag();
                              }
                            }}
                            onClick={() => {
                              if (touchMovedRef.current) return;
                              setScrambleResult(null);
                              setSelectedTokens((list) => list.filter((_, i) => i !== pos));
                            }}
                            className={`px-3.5 py-2 rounded-xl bg-purple-600 text-white chinese-font font-bold text-lg shadow-sm select-none touch-none cursor-grab active:cursor-grabbing transition ${
                              isDragging
                                ? 'opacity-40 scale-95'
                                : isHovered
                                  ? 'ring-2 ring-amber-400 scale-105'
                                  : 'hover:bg-purple-700'
                            }`}
                          >
                            {tok.text}
                          </button>
                        );
                      })
                    )}
                  </div>
                  {selectedTokens.length > 0 && (
                    <p className="text-[11px] text-gray-400 dark:text-slate-500">
                      Mẹo: Kéo thả các từ để đổi vị trí, hoặc bấm vào từ để bỏ chọn.
                    </p>
                  )}
                </div>

                <div
                  data-scramble-drop-box="pool"
                  onDragOver={(e) => {
                    if (dragSource?.type !== 'selected') return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverBox('pool');
                    setDragOverPos(null);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverBox(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleScrambleDropOnPool();
                  }}
                  className={`flex flex-wrap gap-2 justify-center p-2 rounded-2xl transition ${
                    dragOverBox === 'pool' && dragSource?.type === 'selected'
                      ? 'bg-red-50/50 dark:bg-red-950/20 ring-1 ring-red-300 dark:ring-red-800/60'
                      : ''
                  }`}
                >
                  {shuffledTokens.map((tok, idx) => {
                    const used = selectedTokens.includes(idx);
                    const isDraggingPool = dragSource?.type === 'pool' && dragSource.idx === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={used}
                        draggable={!used}
                        onDragStart={(e) => {
                          if (used) return;
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', `pool:${idx}`);
                          setDragSource({ type: 'pool', idx });
                        }}
                        onDragEnd={clearScrambleDrag}
                        onTouchStart={() => {
                          if (used) return;
                          touchMovedRef.current = false;
                          setDragSource({ type: 'pool', idx });
                        }}
                        onTouchMove={(e) => {
                          if (used || !dragSource) return;
                          touchMovedRef.current = true;
                          const touch = e.touches[0];
                          if (!touch) return;
                          const el = document.elementFromPoint(touch.clientX, touch.clientY);
                          const posAttr = el?.closest('[data-scramble-pos]')?.getAttribute('data-scramble-pos');
                          const boxAttr = el?.closest('[data-scramble-drop-box]')?.getAttribute('data-scramble-drop-box');
                          setDragOverPos(posAttr !== null && posAttr !== undefined ? Number(posAttr) : null);
                          setDragOverBox(
                            boxAttr === 'selected' || boxAttr === 'pool' ? boxAttr : null
                          );
                        }}
                        onTouchEnd={() => {
                          if (used || !touchMovedRef.current) {
                            clearScrambleDrag();
                            return;
                          }
                          if (dragOverPos !== null) {
                            handleScrambleDropOnSelected(dragOverPos);
                          } else if (dragOverBox === 'selected') {
                            handleScrambleDropOnSelected();
                          } else {
                            clearScrambleDrag();
                          }
                        }}
                        onClick={() => {
                          if (touchMovedRef.current) return;
                          soundFx.playFlip();
                          setScrambleStarted(true);
                          setScrambleResult(null);
                          setSelectedTokens((list) => [...list, idx]);
                        }}
                        className={`px-4 py-2 rounded-xl border text-lg chinese-font font-bold select-none touch-none transition ${
                          used
                            ? 'opacity-30 border-stone-200 dark:border-slate-700 cursor-default'
                            : isDraggingPool
                              ? 'opacity-50 border-purple-500 bg-purple-50 dark:bg-purple-950/30 cursor-grabbing'
                              : 'bg-white dark:bg-slate-800 border-stone-300 dark:border-slate-700 hover:border-purple-500 text-gray-900 dark:text-white cursor-grab active:cursor-grabbing'
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
                      clearScrambleDrag();
                    }}
                    className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs font-bold"
                  >
                    Xoá chọn lại
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={selectedTokens.length < shuffledTokens.length}
                      onClick={() => {
                        setScrambleStarted(true);
                        const built = selectedTokens.map((i) => shuffledTokens[i].text).join('');
                        const ok = normalizeClean(built) === normalizeClean(currScramble.targetHanzi);
                        setScrambleResult(ok);
                        setScrambleScoreMap((prev) => ({
                          ...prev,
                          [scrambleIdx]: ok || Boolean(prev[scrambleIdx]),
                        }));
                        if (ok) soundFx.playCorrect();
                        else soundFx.playWrong();
                      }}
                      className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition"
                    >
                      Kiểm tra
                    </button>
                    <button
                      onClick={() => {
                        if (scrambleIdx + 1 >= scrambleDeck.length) {
                          setScrambleDone(true);
                          soundFx.playVictory();
                        } else {
                          setScrambleIdx((i) => i + 1);
                          setSelectedTokens([]);
                          setScrambleResult(null);
                          clearScrambleDrag();
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-xs font-bold"
                    >
                      {scrambleIdx + 1 >= scrambleDeck.length ? 'Xem kết quả' : 'Câu tiếp →'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
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
                    refreshTransDeck('vi_to_zh');
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
                    refreshTransDeck('zh_to_vi');
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
              {transDeck.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-mono text-gray-400">
                    {transIdx + 1} / {transDeck.length}
                    {transPool.length > transDeck.length && ` (Kho ${transPool.length})`}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-gray-700 dark:text-slate-200">
                    <Clock className="w-3.5 h-3.5 text-purple-600" />
                    {formatDurationClock(transTime)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 dark:text-purple-400">
                    <Flame className="w-3.5 h-3.5 text-amber-500" /> {transCorrectCount * 100} điểm
                  </span>
                  {transPool.length > 1 && (
                    <button
                      type="button"
                      onClick={() => refreshTransDeck()}
                      className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-xs text-gray-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-300 dark:hover:border-purple-500 font-semibold flex items-center gap-1 transition active:scale-95"
                      title="Đổi sang bộ câu dịch khác"
                    >
                      <Shuffle className="w-3.5 h-3.5" /> Đổi bộ đề
                    </button>
                  )}
                </div>
              )}
            </div>

            {transDeck.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">Chưa có bài tập dịch cho chiều này.</p>
            ) : transDone ? (
              <div className="text-center py-8 space-y-4 pop-in">
                <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Hoàn thành Dịch song ngữ!
                </h3>
                <div className="flex justify-center gap-8 text-center">
                  <div>
                    <div className="text-2xl font-black text-purple-600">
                      {transCorrectCount * 100}
                    </div>
                    <div className="text-xs text-gray-400">
                      Điểm ({transCorrectCount}/{transDeck.length} câu)
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-gray-800 dark:text-white">
                      {formatDurationClock(transTime)}
                    </div>
                    <div className="text-xs text-gray-400">Thời gian</div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2.5 flex-wrap">
                  <button
                    onClick={restartTransRound}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Làm lại bộ này
                  </button>
                  {transPool.length > 1 && (
                    <button
                      type="button"
                      onClick={() => refreshTransDeck()}
                      className="px-6 py-2.5 border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-gray-800 dark:text-slate-100 hover:text-purple-600 dark:hover:text-purple-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition"
                    >
                      <Shuffle className="w-3.5 h-3.5" /> Đổi bộ đề mới
                    </button>
                  )}
                </div>
              </div>
            ) : currTrans ? (
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
                  onChange={(e) => {
                    setTransStarted(true);
                    setTransInput(e.target.value);
                    if (transChecked) setTransChecked(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                      e.preventDefault();
                      handleCheckTranslation();
                    }
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
                      type="button"
                      disabled={!transInput.trim()}
                      onClick={handleCheckTranslation}
                      className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition"
                    >
                      Kiểm tra
                    </button>
                    <button
                      onClick={() => {
                        if (transIdx + 1 >= transDeck.length) {
                          setTransDone(true);
                          soundFx.playVictory();
                        } else {
                          setTransIdx((i) => i + 1);
                          setTransInput('');
                          setTransChecked(false);
                          setShowTransHint(false);
                          setShowTransAnswer(false);
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-xs font-bold"
                    >
                      {transIdx + 1 >= transDeck.length ? 'Xem kết quả' : 'Câu tiếp →'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* GAME 4: EXPANDED QUIZ */}
        {mode === 'expanded_quiz' && (
          <div className="max-w-2xl mx-auto space-y-6">
            {quizDeck.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">Chưa có câu hỏi trắc nghiệm mở rộng.</p>
            ) : quizDone ? (
              <div className="text-center py-8 space-y-4 pop-in">
                <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Hoàn thành trắc nghiệm!</h3>
                <div className="flex justify-center gap-8 text-center">
                  <div>
                    <div className="text-2xl font-black text-purple-600">
                      {quizCorrectCount * 100}
                    </div>
                    <div className="text-xs text-gray-400">
                      Điểm ({quizCorrectCount}/{quizDeck.length} câu đúng)
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-gray-800 dark:text-white">
                      {formatDurationClock(quizTime)}
                    </div>
                    <div className="text-xs text-gray-400">Thời gian</div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2.5 flex-wrap">
                  <button
                    onClick={restartQuizRound}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Làm lại bộ này
                  </button>
                  {quizPool.length > 1 && (
                    <button
                      type="button"
                      onClick={refreshQuizDeck}
                      className="px-6 py-2.5 border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-gray-800 dark:text-slate-100 hover:text-purple-600 dark:hover:text-purple-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition"
                    >
                      <Shuffle className="w-3.5 h-3.5" /> Đổi bộ đề mới
                    </button>
                  )}
                </div>
              </div>
            ) : (
              currQuiz && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                    <span className="font-mono font-bold text-gray-500">
                      Câu {quizIdx + 1} / {quizDeck.length}
                      {quizPool.length > quizDeck.length && (
                        <span className="ml-1.5 font-sans font-normal text-gray-400">
                          (Kho {quizPool.length} câu)
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-gray-700 dark:text-slate-200">
                        <Clock className="w-3.5 h-3.5 text-purple-600" />
                        {formatDurationClock(quizTime)}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-bold">
                        Chuỗi đúng: {quizStreak}
                      </span>
                      {quizPool.length > 1 && (
                        <button
                          type="button"
                          onClick={refreshQuizDeck}
                          className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-xs text-gray-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-300 dark:hover:border-purple-500 font-semibold flex items-center gap-1 transition active:scale-95"
                          title="Đổi sang bộ câu hỏi trắc nghiệm khác"
                        >
                          <Shuffle className="w-3.5 h-3.5" /> Đổi bộ đề
                        </button>
                      )}
                    </div>
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
                            setQuizStarted(true);
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
                        if (quizIdx + 1 >= quizDeck.length) {
                          setQuizDone(true);
                          soundFx.playVictory();
                        } else {
                          setQuizIdx((i) => i + 1);
                        }
                      }}
                      className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold"
                    >
                      {quizIdx + 1 >= quizDeck.length ? 'Xem kết quả' : 'Câu tiếp →'}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* BẢNG XẾP HẠNG TRÒ CHƠI */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-lg p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-md shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Bảng xếp hạng kết quả
              </h3>
              {savedNotice && (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                  {savedNotice}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Hiển thị thành tích trong bài học này của tất cả thành viên, sắp xếp theo điểm cao nhất và thời gian hoàn thành nhanh nhất.
            </p>
          </div>
        </div>

        {/* Bộ lọc chế độ trò chơi */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'tri_match', label: '1. Ghép bộ 3' },
              { id: 'scramble', label: '2. Sắp xếp câu' },
              { id: 'translation', label: '3. Dịch Việt-Trung' },
              { id: 'expanded_quiz', label: '4. Trắc nghiệm' },
              { id: 'all', label: 'Tất cả chế độ' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLbMode(item.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                lbMode === item.id
                  ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                  : 'bg-stone-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-stone-200 dark:border-slate-700 hover:border-purple-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {lbError ? (
          <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {lbError}
          </div>
        ) : lbLoading && lbEntries.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            Đang tải bảng xếp hạng...
          </div>
        ) : lbEntries.length === 0 ? (
          <div className="py-10 text-center space-y-2 border border-dashed border-stone-200 dark:border-slate-800 rounded-2xl">
            <Medal className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">
              Chưa có kết quả nào được ghi nhận
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              Hãy hoàn thành một lượt chơi ở trên để lưu điểm và xuất hiện trên bảng xếp hạng!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-stone-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-gray-400 dark:text-slate-500">
                  <th className="py-2.5 px-3 font-bold w-16 text-center">Hạng</th>
                  <th className="py-2.5 px-3 font-bold">Người chơi</th>
                  <th className="py-2.5 px-3 font-bold text-right">Điểm</th>
                  <th className="py-2.5 px-3 font-bold text-center">Thời gian hoàn thành</th>
                  <th className="py-2.5 px-3 font-bold text-right">Thời điểm chơi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-slate-800/80 text-sm">
                {lbEntries.map((entry, idx) => {
                  const rank = idx + 1;
                  const isMe = Boolean(currentUserId && entry.userId === currentUserId);
                  const avatarPreset = getAvatarPreset(entry.avatarUrl);
                  const hasImageAvatar = isImageMediaUrl(entry.avatarUrl);
                  const rankBadgeClass =
                    rank === 1
                      ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                      : rank === 2
                        ? 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600'
                        : rank === 3
                          ? 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700'
                          : 'bg-stone-100 text-gray-600 border-stone-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';

                  return (
                    <tr
                      key={entry.id}
                      className={`transition ${
                        isMe
                          ? 'bg-purple-50/70 dark:bg-purple-950/30'
                          : 'hover:bg-stone-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border text-xs font-extrabold ${rankBadgeClass}`}
                        >
                          {rank <= 3 ? `#${rank}` : rank}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {hasImageAvatar ? (
                            <img
                              src={entry.avatarUrl!}
                              alt={entry.displayName}
                              className="w-10 h-10 rounded-xl object-cover border border-stone-200 dark:border-slate-700 shrink-0 shadow-sm"
                            />
                          ) : avatarPreset ? (
                            <div
                              className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarPreset.gradientClass} text-white flex items-center justify-center font-bold chinese-font text-lg shrink-0 shadow-sm`}
                            >
                              {avatarPreset.symbol}
                            </div>
                          ) : (
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-sm ${
                                entry.role === 'admin'
                                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white'
                                  : 'bg-gradient-to-br from-red-500 to-amber-500 text-white'
                              }`}
                            >
                              {getInitials(entry.displayName)}
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-gray-900 dark:text-white truncate">
                                {entry.displayName}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  entry.role === 'admin'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    : 'bg-stone-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {entry.role === 'admin' ? 'Quản trị viên' : 'Học viên'}
                              </span>
                              {isMe && (
                                <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 text-[10px] font-bold">
                                  Bạn
                                </span>
                              )}
                            </div>
                            {lbMode === 'all' && (
                              <div className="text-[11px] text-gray-400 dark:text-slate-500 truncate mt-0.5">
                                {GAME_MODE_LABELS[entry.gameMode]}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <span className="font-black text-purple-700 dark:text-purple-400">
                          {entry.score.toLocaleString('vi-VN')}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-slate-500 ml-1">
                          điểm{entry.maxScore ? ` / ${entry.maxScore.toLocaleString('vi-VN')}` : ''}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-slate-800 font-mono text-xs font-bold text-gray-700 dark:text-slate-200">
                          <Clock className="w-3 h-3 text-purple-600" />
                          {formatDurationClock(entry.durationSeconds)}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap text-xs text-gray-500 dark:text-slate-400 font-mono">
                        {formatPlayedAt(entry.playedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
