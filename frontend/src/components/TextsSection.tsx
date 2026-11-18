import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Headphones, HelpCircle, Lock, Play, Square, Volume2, XCircle } from 'lucide-react';
import {
  buildSpeakerVoiceMap,
  resolveDialogueTtsText,
  soundFx,
  speakChinese,
  stopChineseSpeech,
} from '../lib/audio';
import type { LessonDetail } from '../types';

const SPEAKER_BADGE_STYLES = [
  'text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/40',
  'text-sky-800 dark:text-sky-300 bg-sky-100/80 dark:bg-sky-900/40',
  'text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-900/40',
  'text-purple-800 dark:text-purple-300 bg-purple-100/80 dark:bg-purple-900/40',
  'text-rose-800 dark:text-rose-300 bg-rose-100/80 dark:bg-rose-900/40',
];

interface TextsSectionProps {
  lesson: LessonDetail;
  canChangeSpeechRate?: boolean;
  onRequireAuth?: () => void;
}

export const TextsSection: React.FC<TextsSectionProps> = ({
  lesson,
  canChangeSpeechRate = true,
  onRequireAuth,
}) => {
  const [speechRate, setSpeechRate] = useState(1.0);
  const [showPinyin, setShowPinyin] = useState(true);
  const [showMeaning, setShowMeaning] = useState(true);
  const [playingTextIdx, setPlayingTextIdx] = useState<number | null>(null);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number>(-1);
  const [lqAnswers, setLqAnswers] = useState<Record<string, number>>({});
  const isPlayingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const stopDialogue = () => {
    isPlayingRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    stopChineseSpeech();
    setPlayingTextIdx(null);
    setActiveSentenceIdx(-1);
  };

  useEffect(() => {
    stopDialogue();
    setLqAnswers({});
    return () => stopDialogue();
  }, [lesson.id]);

  useEffect(() => {
    if (!canChangeSpeechRate) {
      setSpeechRate(1.0);
    }
  }, [canChangeSpeechRate]);

  const playFullDialogue = (textIndex: number) => {
    const textItem = lesson.texts[textIndex];
    if (!textItem || textItem.sentences.length === 0) return;

    stopDialogue();
    isPlayingRef.current = true;
    setPlayingTextIdx(textIndex);

    const speakerList = Array.from(
      new Set(textItem.sentences.map((s) => (s.speaker || '').trim()).filter(Boolean))
    );
    const voiceMap = buildSpeakerVoiceMap(speakerList);

    const playStep = (idx: number) => {
      if (!isPlayingRef.current) return;
      if (idx >= textItem.sentences.length) {
        stopDialogue();
        return;
      }
      setActiveSentenceIdx(idx);
      const sentence = textItem.sentences[idx];
      const spKey = (sentence.speaker || '').trim();
      speakChinese(
        sentence.hanzi,
        speechRate,
        () => {
          if (isPlayingRef.current) {
            timerRef.current = window.setTimeout(() => playStep(idx + 1), 650);
          }
        },
        voiceMap[spKey]
      );
    };

    playStep(0);
  };

  const texts = lesson.texts || [];

  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <Headphones className="w-3.5 h-3.5" /> Module 2: Bài khoá & Luyện nghe HSK
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">Hội thoại thực tế & Luyện nghe</h2>
          <p className="text-white/90 text-sm mt-1">
            Nghe từng câu hoặc cả bài hội thoại, tùy chỉnh tốc độ và làm câu hỏi nghe hiểu.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/20 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              Tốc độ:
              {!canChangeSpeechRate && (
                <Lock className="w-3 h-3 text-white/80" />
              )}
            </span>
            <select
              value={canChangeSpeechRate ? speechRate : 1.0}
              onChange={(e) => {
                if (!canChangeSpeechRate) {
                  onRequireAuth?.();
                  return;
                }
                setSpeechRate(parseFloat(e.target.value));
              }}
              title={!canChangeSpeechRate ? 'Đăng nhập để thay đổi tốc độ đọc' : undefined}
              className="bg-white text-gray-800 rounded-lg px-2 py-1 font-semibold focus:outline-none"
            >
              <option value={0.7}>Chậm (0.7x)</option>
              <option value={0.9}>Vừa (0.9x)</option>
              <option value={1.0}>Tự nhiên (1.0x)</option>
            </select>
          </div>
          <div className="flex items-center gap-3 border-l border-white/30 pl-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showPinyin}
                onChange={() => setShowPinyin((s) => !s)}
                className="rounded"
              />
              <span>Hiện Pinyin</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showMeaning}
                onChange={() => setShowMeaning((s) => !s)}
                className="rounded"
              />
              <span>Hiện nghĩa</span>
            </label>
          </div>
        </div>
      </div>

      {texts.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-10 text-center text-sm text-gray-500 dark:text-slate-400">
          Buổi học này chưa có bài khoá hội thoại.
        </div>
      ) : (
        texts.map((textItem, tIndex) => {
          const speakerList = Array.from(
            new Set(textItem.sentences.map((s) => (s.speaker || '').trim()).filter(Boolean))
          );
          const voiceMap = buildSpeakerVoiceMap(speakerList);

          return (
          <div
            key={textItem.id || tIndex}
            className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden"
          >
            <div className="p-6 bg-emerald-50/50 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
                    Bài khoá #{tIndex + 1}
                  </span>
                  {speakerList.length >= 2 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/80 dark:bg-slate-800/80 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300">
                      {speakerList.length} người thoại • đa giọng đọc
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                  {textItem.title}
                </h3>
                {textItem.description && (
                  <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">{textItem.description}</p>
                )}
              </div>

              {playingTextIdx === tIndex ? (
                <button
                  onClick={stopDialogue}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm"
                >
                  <Square className="w-3.5 h-3.5" /> Dừng đọc
                </button>
              ) : (
                <button
                  onClick={() => playFullDialogue(tIndex)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" /> Nghe toàn bài khoá
                </button>
              )}
            </div>

            <div className="p-6 md:p-8 space-y-3">
              {textItem.sentences.map((s, sIndex) => {
                const isActive = playingTextIdx === tIndex && activeSentenceIdx === sIndex;
                const spKey = (s.speaker || '').trim();
                const spIdx = Math.max(0, speakerList.indexOf(spKey));
                const badgeClass = SPEAKER_BADGE_STYLES[spIdx % SPEAKER_BADGE_STYLES.length];
                return (
                  <div
                    key={s.id || sIndex}
                    className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-start gap-2.5 sm:gap-4 ${
                      isActive
                        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 sm:translate-x-1'
                        : 'border-stone-100 dark:border-slate-800 bg-stone-50/50 dark:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 sm:w-28 md:w-32 flex-shrink-0">
                      <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-lg ${badgeClass}`}>
                        {s.speaker || 'Người nói'}
                      </span>
                      <button
                        onClick={() => speakChinese(s.hanzi, speechRate, undefined, voiceMap[spKey])}
                        className="sm:hidden flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-slate-800 hover:bg-emerald-600 dark:hover:bg-emerald-600 hover:text-white border border-stone-200 dark:border-slate-700 dark:hover:border-emerald-500 text-gray-600 dark:text-slate-300 flex items-center justify-center transition active:scale-95"
                        title="Nghe câu này"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex-grow min-w-0 space-y-1">
                      <div className="chinese-font text-lg md:text-xl font-semibold text-gray-900 dark:text-white break-words">
                        {s.displayHanzi || s.hanzi}
                      </div>
                      {showPinyin && s.pinyin && (
                        <div className="font-mono text-xs text-red-600 dark:text-red-400 font-medium break-words">
                          {s.pinyin}
                        </div>
                      )}
                      {showMeaning && s.meaning && (
                        <div className="text-xs text-gray-600 dark:text-slate-400 italic break-words">{s.meaning}</div>
                      )}
                    </div>
                    <button
                      onClick={() => speakChinese(s.hanzi, speechRate, undefined, voiceMap[spKey])}
                      className="hidden sm:flex flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-slate-800 hover:bg-emerald-600 dark:hover:bg-emerald-600 hover:text-white border border-stone-200 dark:border-slate-700 dark:hover:border-emerald-500 text-gray-600 dark:text-slate-300 items-center justify-center transition active:scale-95"
                      title="Nghe câu này"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {textItem.listeningQuestions.length > 0 && (
              <div className="p-6 md:p-8 bg-amber-50/40 dark:bg-slate-800/30 border-t border-amber-100 dark:border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center">
                    <HelpCircle className="w-4 h-4" />
                  </span>
                  <div>
                    <h4 className="font-bold text-gray-900 dark:text-white text-base">
                      Câu hỏi luyện nghe hiểu HSK
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      Bấm nút loa để nghe đoạn ghi âm và chọn đáp án đúng.
                    </p>
                  </div>
                </div>

                {textItem.listeningQuestions.map((q, qIndex) => {
                  const key = `${tIndex}-${qIndex}`;
                  const selected = lqAnswers[key];
                  const answered = selected !== undefined;

                  return (
                    <div
                      key={q.id || qIndex}
                      className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-amber-200/80 dark:border-slate-700 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-md">
                          Câu hỏi #{qIndex + 1}
                        </span>
                        <button
                          onClick={() =>
                            speakChinese(
                              resolveDialogueTtsText(q.audioText || q.question, [textItem]),
                              speechRate
                            )
                          }
                          className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                        >
                          <Volume2 className="w-3.5 h-3.5" /> Nghe câu hỏi HSK
                        </button>
                      </div>

                      <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">{q.question}</div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {q.options.map((opt, optIdx) => {
                          const isCorrect = optIdx === q.correctIndex;
                          const isSelected = optIdx === selected;
                          let cls =
                            'border-stone-200 dark:border-slate-700 hover:border-amber-400 text-gray-700 dark:text-slate-200';
                          if (answered) {
                            if (isCorrect) {
                              cls =
                                'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 font-semibold';
                            } else if (isSelected) {
                              cls =
                                'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 font-semibold';
                            }
                          }
                          return (
                            <button
                              key={optIdx}
                              disabled={answered}
                              onClick={() => {
                                setLqAnswers((prev) => ({ ...prev, [key]: optIdx }));
                                if (optIdx === q.correctIndex) soundFx.playCorrect();
                                else soundFx.playWrong();
                              }}
                              className={`text-left p-3 rounded-xl border text-xs transition flex items-center gap-2.5 ${cls}`}
                            >
                              <span className="w-6 h-6 rounded-lg bg-stone-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold flex-shrink-0">
                                {String.fromCharCode(65 + optIdx)}
                              </span>
                              <span>{opt}</span>
                            </button>
                          );
                        })}
                      </div>

                      {answered && (
                        <div
                          className={`text-xs p-3 rounded-xl border flex items-start gap-2 ${
                            selected === q.correctIndex
                              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                          }`}
                        >
                          {selected === q.correctIndex ? (
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          )}
                          <div>
                            <strong>{selected === q.correctIndex ? 'Chính xác!' : 'Chưa đúng!'}</strong>{' '}
                            {q.explanation}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })
      )}
    </div>
  );
};
