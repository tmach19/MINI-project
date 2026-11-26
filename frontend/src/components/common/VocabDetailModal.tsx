import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flag,
  Loader2,
  PenTool,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { getEnAudioUrl, getEnImageUrl } from '../../languages/config';
import { api } from '../../lib/api';
import { speakChinese, speakEnglish } from '../../lib/audio';
import {
  cleanEnglishSenseVi,
  EnglishMeaningLines,
  getPosBadgeClass,
} from './EnglishMeaningLines';
import { ModalCloseButton, ModalShell } from './ModalShell';
import type {
  AiDictionaryEntry,
  AiDictionaryExample,
  LanguageCode,
  VocabularyItem,
} from '../../types';

// Cache chi tiết AI dùng chung trong phiên giữa Tab Từ vựng và Tab Từ đã đánh dấu (0ms khi mở lại)
const sessionAiVocabDetailCache = new Map<string, AiDictionaryEntry | null>();

function cleanPrimaryHanzi(rawHanzi: string): string {
  return (
    (rawHanzi || '')
      .replace(/\([^)]*\)|（[^）]*）/g, '')
      .split(/[/／、,，]/)[0]
      ?.replace(/[^\u4e00-\u9fff]/g, '')
      .trim() || ''
  );
}

function extractHanziChars(text: string): string[] {
  const seen = new Set<string>();
  const chars: string[] = [];
  for (const ch of Array.from(text || '')) {
    if (/[\u4e00-\u9fff]/.test(ch) && !seen.has(ch)) {
      seen.add(ch);
      chars.push(ch);
    }
  }
  return chars.slice(0, 12);
}

function renderHighlightedExample(
  text: string,
  targetWord: string,
  isEnglish = false
): React.ReactNode {
  if (!text || !targetWord) return text;
  if (isEnglish) {
    const cleanTarget = targetWord.replace(/\([^)]*\)/g, '').trim();
    if (!cleanTarget || cleanTarget.length > 32) return text;
    const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(\\b${escaped}(?:s|es|ed|ing|er|est)?\\b)`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    return parts.map((part, idx) =>
      idx % 2 === 1 ? (
        <mark
          key={idx}
          className="bg-indigo-100/90 dark:bg-indigo-500/30 text-indigo-900 dark:text-indigo-200 rounded px-0.5 font-extrabold"
        >
          {part}
        </mark>
      ) : (
        <React.Fragment key={idx}>{part}</React.Fragment>
      )
    );
  }

  const cleanTarget = cleanPrimaryHanzi(targetWord);
  if (!cleanTarget || cleanTarget.length > 6) return text;
  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'g'));
  if (parts.length <= 1) return text;
  return parts.map((part, idx) =>
    part === cleanTarget ? (
      <mark
        key={idx}
        className="bg-amber-100/90 dark:bg-amber-500/25 text-amber-800 dark:text-amber-300 rounded px-0.5 font-black"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

function isPlaceholderExample(hanzi?: string | null, meaning?: string | null): boolean {
  if (!hanzi) return true;
  if (/这是关于.*的常用句子/.test(hanzi)) return true;
  if (meaning && /Đây là câu ví dụ/i.test(meaning)) return true;
  return false;
}

function isPlaceholderRadical(radical?: string | null): boolean {
  return Boolean(radical && /^Bộ cấu tạo\s*\[/i.test(radical.trim()));
}

function isPlaceholderBreakdown(breakdown?: string | null): boolean {
  return Boolean(breakdown && /^Ghép từ các chữ Hán:/i.test(breakdown.trim()));
}

export interface VocabDetailModalProps {
  lang?: LanguageCode;
  vocab: VocabularyItem;
  lessonTitle?: string | null;
  onOpenLesson?: () => void;
  currentIndex?: number;
  totalCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
  isMarked?: boolean;
  markActionMode?: 'toggle' | 'unmark_only';
  markLoading?: boolean;
  onToggleMarked?: () => void;
  onOpenWriter?: (vocab: VocabularyItem) => void;
  onOpenAiDictionary?: (word: string) => void;
  onClose: () => void;
}

export const VocabDetailModal: React.FC<VocabDetailModalProps> = ({
  lang,
  vocab,
  lessonTitle,
  onOpenLesson,
  currentIndex = -1,
  totalCount = 0,
  onPrev,
  onNext,
  isMarked = false,
  markActionMode = 'toggle',
  markLoading = false,
  onToggleMarked,
  onOpenWriter,
  onOpenAiDictionary,
  onClose,
}) => {
  const isEnglish = lang === 'en' || Boolean(vocab.meta?.wordId);
  const effectiveLang: LanguageCode = isEnglish ? 'en' : 'zh';
  const hasRichEnMeta = Boolean(isEnglish && vocab.meta?.senses && vocab.meta.senses.length > 0);

  const [aiDetailEntry, setAiDetailEntry] = useState<AiDictionaryEntry | null>(null);
  const [aiDetailLoading, setAiDetailLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setImgError(false);
  }, [vocab.id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    const queryWord = isEnglish
      ? vocab.hanzi.trim()
      : cleanPrimaryHanzi(vocab.hanzi) || vocab.hanzi.trim();

    // Với từ Word Atlas tiếng Anh đã có sẵn senses/examples/collocations/tipVi trong DB -> mở tức thì 0ms, không tốn AI token
    if (!queryWord || !onOpenAiDictionary || hasRichEnMeta) {
      setAiDetailEntry(null);
      setAiDetailLoading(false);
      return;
    }

    const cacheKey = `${effectiveLang}::${queryWord.toLowerCase()}`;
    if (sessionAiVocabDetailCache.has(cacheKey)) {
      setAiDetailEntry(sessionAiVocabDetailCache.get(cacheKey) || null);
      setAiDetailLoading(false);
      return;
    }

    let cancelled = false;
    setAiDetailEntry(null);
    setAiDetailLoading(true);

    api
      .aiDictionary({
        query: queryWord,
        direction: isEnglish ? 'en_vi' : 'zh_vi',
        lang: effectiveLang,
      })
      .then((res) => {
        if (cancelled) return;
        const entry = res.aiResult || null;
        sessionAiVocabDetailCache.set(cacheKey, entry);
        setAiDetailEntry(entry);
      })
      .catch(() => {
        if (!cancelled) setAiDetailEntry(null);
      })
      .finally(() => {
        if (!cancelled) setAiDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vocab.id, vocab.hanzi, isEnglish, effectiveLang, hasRichEnMeta, onOpenAiDictionary]);

  useEffect(() => {
    if (totalCount <= 1 || (!onPrev && !onNext)) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [totalCount, onPrev, onNext]);

  const enFullImgUrl = isEnglish ? getEnImageUrl(vocab.meta, 'full') : null;
  const enUsAudioUrl = isEnglish ? getEnAudioUrl(vocab.meta, 'us') : null;
  const enUkAudioUrl = isEnglish ? getEnAudioUrl(vocab.meta, 'uk') : null;

  const resolvedDetail = useMemo(() => {
    const meta = vocab.meta || null;
    const wordType = vocab.type || aiDetailEntry?.wordType || null;
    const sinoVietnamese = vocab.sinoVietnamese || aiDetailEntry?.sinoVietnamese || null;
    const radical = !isPlaceholderRadical(vocab.radical)
      ? vocab.radical || aiDetailEntry?.radical || null
      : aiDetailEntry?.radical || (!aiDetailLoading ? vocab.radical : null) || null;
    const breakdown = !isPlaceholderBreakdown(vocab.breakdown)
      ? vocab.breakdown || aiDetailEntry?.breakdown || null
      : aiDetailEntry?.breakdown || (!aiDetailLoading ? vocab.breakdown : null) || null;
    const mnemonic = meta?.tipVi || vocab.mnemonic || aiDetailEntry?.mnemonic || null;
    const noteVi = meta?.noteVi || null;
    const grammarNote = aiDetailEntry?.grammarNote || null;
    const extraMeanings = aiDetailEntry?.meanings || [];
    const compounds = aiDetailEntry?.compounds || [];
    const chars = isEnglish ? [] : extractHanziChars(vocab.hanzi);

    const enExamples: Array<{
      en: string;
      vi: string;
      audioKind?: 'ex' | 'ex2' | null;
    }> = [];
    if (isEnglish) {
      if (meta?.examples && meta.examples.length > 0) {
        meta.examples.forEach((ex, i) => {
          if (ex.en?.trim()) {
            enExamples.push({
              en: ex.en.trim(),
              vi: ex.vi?.trim() || '',
              audioKind: ex.audioKind ?? (i === 0 ? 'ex' : i === 1 ? 'ex2' : null),
            });
          }
        });
      } else if (vocab.example && vocab.exampleMeaning) {
        enExamples.push({
          en: vocab.example,
          vi: vocab.exampleMeaning,
          audioKind: 'ex',
        });
      }
      for (const ex of aiDetailEntry?.examples || []) {
        if (ex.hanzi && !enExamples.some((item) => item.en === ex.hanzi.trim())) {
          enExamples.push({ en: ex.hanzi.trim(), vi: ex.meaning, audioKind: null });
        }
      }
    }

    const examples: AiDictionaryExample[] = [];
    const seenEx = new Set<string>();
    if (!isEnglish) {
      if (
        vocab.example &&
        !isPlaceholderExample(vocab.example, vocab.exampleMeaning) &&
        vocab.exampleMeaning
      ) {
        examples.push({
          hanzi: vocab.example,
          pinyin: vocab.examplePinyin || '',
          meaning: vocab.exampleMeaning,
        });
        seenEx.add(vocab.example.trim());
      }
      for (const ex of aiDetailEntry?.examples || []) {
        const key = ex.hanzi.trim();
        if (key && !seenEx.has(key)) {
          seenEx.add(key);
          examples.push(ex);
        }
      }
    }

    return {
      meta,
      wordType,
      sinoVietnamese,
      radical,
      breakdown,
      mnemonic,
      noteVi,
      grammarNote,
      extraMeanings,
      compounds,
      chars,
      examples,
      enExamples,
    };
  }, [vocab, aiDetailEntry, aiDetailLoading, isEnglish]);

  const meta = resolvedDetail.meta;

  return (
    <ModalShell
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      flexColumn
      ariaLabelledBy="vocab-detail-modal-title"
    >
      {/* Header */}
      <div
        className={`px-6 py-4 border-b border-stone-200 dark:border-slate-800 flex items-start justify-between gap-3 ${
          isEnglish
            ? 'bg-gradient-to-r from-indigo-50/90 via-white to-sky-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40'
            : 'bg-gradient-to-r from-amber-50/90 via-white to-red-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80'
        }`}
      >
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {!isEnglish && (
              <span className="px-2.5 py-0.5 rounded-lg border text-[11px] font-bold bg-red-50 dark:bg-red-950/50 border-red-200/70 dark:border-red-900/60 text-red-700 dark:text-red-300">
                {resolvedDetail.wordType || 'Từ vựng'}
              </span>
            )}
            {isEnglish && (meta?.cefr || resolvedDetail.sinoVietnamese) && (
              <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300 text-[11px] font-bold uppercase tracking-wider">
                {meta?.cefr || resolvedDetail.sinoVietnamese}
              </span>
            )}
            {lessonTitle &&
              (onOpenLesson ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLesson();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-stone-100 hover:bg-stone-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition truncate max-w-[260px]"
                  title={`Mở ${lessonTitle}`}
                >
                  <span className="truncate">{lessonTitle}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-75" />
                </button>
              ) : !isEnglish ? (
                <span className="px-2.5 py-0.5 rounded-lg bg-stone-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[260px]">
                  {lessonTitle}
                </span>
              ) : null)}
          </div>

          <div className="flex items-baseline gap-3 flex-wrap pt-0.5">
            <h3
              id="vocab-detail-modal-title"
              className={`${
                isEnglish ? 'tracking-tight' : 'chinese-serif'
              } text-3xl sm:text-4xl font-black text-slate-900 dark:text-white leading-tight`}
            >
              {vocab.hanzi}
            </h3>
            {isEnglish ? (
              <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
                {meta?.usIpa && (
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                    US {meta.usIpa}
                  </span>
                )}
                {meta?.ukIpa && meta.ukIpa !== meta.usIpa && (
                  <span className="text-sky-600 dark:text-sky-400 font-bold">
                    UK {meta.ukIpa}
                  </span>
                )}
                {!meta?.usIpa && !meta?.ukIpa && vocab.pinyin && (
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                    {vocab.pinyin}
                  </span>
                )}
              </div>
            ) : (
              <>
                <span className="text-lg font-mono font-bold text-red-600 dark:text-red-400">
                  {vocab.pinyin}
                </span>
                {resolvedDetail.sinoVietnamese && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-bold uppercase tracking-wider">
                    Hán Việt: {resolvedDetail.sinoVietnamese}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
          {isEnglish ? (
            <>
              <button
                type="button"
                onClick={() =>
                  speakEnglish(vocab.hanzi, { accent: 'us', audioUrl: enUsAudioUrl })
                }
                className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 shadow-sm transition active:scale-95"
                title="Nghe phát âm giọng Mỹ (US)"
              >
                <Volume2 className="w-3.5 h-3.5" /> US
              </button>
              <button
                type="button"
                onClick={() =>
                  speakEnglish(vocab.hanzi, { accent: 'uk', audioUrl: enUkAudioUrl })
                }
                className="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold inline-flex items-center gap-1 shadow-sm transition active:scale-95"
                title="Nghe phát âm giọng Anh (UK)"
              >
                <Volume2 className="w-3.5 h-3.5" /> UK
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => speakChinese(vocab.hanzi)}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition active:scale-95"
              title="Nghe phát âm"
            >
              <Volume2 className="w-3.5 h-3.5" /> Nghe phát âm
            </button>
          )}
          <ModalCloseButton onClick={onClose} />
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="p-6 overflow-y-auto space-y-4 text-xs">
        {/* Nghĩa tiếng Việt (+ Ảnh minh họa & Senses cho Tiếng Anh) */}
        <div className="p-4 rounded-2xl bg-stone-50 dark:bg-slate-800/60 border border-stone-200/80 dark:border-slate-800 flex flex-col sm:flex-row gap-4">
          {isEnglish && enFullImgUrl && !imgError && (
            <div className="shrink-0 mx-auto sm:mx-0">
              <img
                src={enFullImgUrl}
                alt={vocab.hanzi}
                loading="lazy"
                onError={() => setImgError(true)}
                className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl object-cover border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
              />
            </div>
          )}

          <div className="space-y-2.5 min-w-0 flex-1">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
                Nghĩa tiếng Việt
              </span>
              {isEnglish ? (
                hasRichEnMeta && meta?.senses ? (
                  <div className="space-y-1.5">
                    {meta.senses.map((sense, sIdx) => (
                      <div
                        key={`${sense.pos}-${sIdx}`}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-stone-200/70 dark:border-slate-700/80 space-y-0.5"
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {sense.pos && (
                            <span
                              className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold ${getPosBadgeClass(sense.pos)}`}
                            >
                              {sense.pos}
                            </span>
                          )}
                          <span className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                            {cleanEnglishSenseVi(sense.vi)}
                          </span>
                        </div>
                        {sense.en && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                            {sense.en}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EnglishMeaningLines vocab={vocab} size="lg" />
                )
              ) : (
                <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                  {vocab.meaning}
                </p>
              )}
            </div>

            {!isEnglish && resolvedDetail.extraMeanings.length > 1 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {resolvedDetail.extraMeanings.map((m, mIdx) => (
                  <span
                    key={`${m}-${mIdx}`}
                    className="px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300"
                  >
                    {mIdx + 1}. {m}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ENGLISH-SPECIFIC: Word Family, Synonyms / Antonyms, Tip & Note */}
        {isEnglish ? (
          <>
            {((meta?.wordFamily && meta.wordFamily.length > 0) ||
              (meta?.synonyms && meta.synonyms.length > 0) ||
              (meta?.antonyms && meta.antonyms.length > 0)) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {meta?.wordFamily && meta.wordFamily.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 block">
                      Họ từ (Word Family)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.wordFamily.map((wf) => (
                        <button
                          key={wf}
                          type="button"
                          onClick={() => {
                            if (!onOpenAiDictionary) return;
                            onClose();
                            onOpenAiDictionary(wf);
                          }}
                          className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-indigo-400 font-semibold transition"
                        >
                          {wf}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {((meta?.synonyms && meta.synonyms.length > 0) ||
                  (meta?.antonyms && meta.antonyms.length > 0)) && (
                  <div
                    className={`p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800 space-y-2 ${
                      !(meta?.wordFamily && meta.wordFamily.length > 0) ? 'md:col-span-2' : ''
                    }`}
                  >
                    {meta?.synonyms && meta.synonyms.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                          Từ đồng nghĩa
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {meta.synonyms.map((syn) => (
                            <span
                              key={syn}
                              className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 font-semibold"
                            >
                              {syn}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {meta?.antonyms && meta.antonyms.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 block">
                          Từ trái nghĩa
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {meta.antonyms.map((ant) => (
                            <span
                              key={ant}
                              className="px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200/70 dark:border-rose-800/60 text-rose-800 dark:text-rose-300 font-semibold"
                            >
                              {ant}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {(resolvedDetail.mnemonic || resolvedDetail.noteVi || resolvedDetail.grammarNote) && (
              <div className="space-y-2.5">
                {resolvedDetail.mnemonic && (
                  <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 block">
                      💡 Mẹo nhớ &amp; Phân biệt
                    </span>
                    <p className="text-amber-950 dark:text-amber-100 leading-relaxed">
                      {resolvedDetail.mnemonic}
                    </p>
                  </div>
                )}
                {(resolvedDetail.noteVi || resolvedDetail.grammarNote) && (
                  <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-900/50 space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 block">
                      Lưu ý cách dùng &amp; Ngữ pháp
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                      {resolvedDetail.noteVi || resolvedDetail.grammarNote}
                    </p>
                  </div>
                )}
              </div>
            )}

            {aiDetailLoading && (
              <div className="p-3.5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/70 dark:border-indigo-900/50 flex items-center gap-2.5 text-indigo-700 dark:text-indigo-300">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Đang tải collocations, ngữ pháp và câu ví dụ song ngữ...</span>
              </div>
            )}

            {resolvedDetail.enExamples.length > 0 && (
              <div className="space-y-2 pt-1">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Câu ví dụ song ngữ
                </h5>
                <div className="space-y-2">
                  {resolvedDetail.enExamples.map((ex, exIdx) => {
                    const exAudioUrl = ex.audioKind
                      ? getEnAudioUrl(vocab.meta, ex.audioKind)
                      : null;
                    return (
                      <div
                        key={`${ex.en}-${exIdx}`}
                        className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800 flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          {ex.audioKind === 'ex2' && (
                            <span className="inline-block px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase">
                              Mở rộng / IELTS
                            </span>
                          )}
                          <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-relaxed">
                            {renderHighlightedExample(ex.en, vocab.hanzi, true)}
                          </p>
                          {ex.vi && (
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              {ex.vi}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            speakEnglish(ex.en, { accent: 'us', audioUrl: exAudioUrl })
                          }
                          className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 shrink-0 transition"
                          title="Nghe câu ví dụ"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* CHINESE-SPECIFIC: Bộ thủ, Chiết tự, Mẹo nhớ & Cách dùng ngữ pháp */}
            {(resolvedDetail.radical ||
              resolvedDetail.breakdown ||
              resolvedDetail.mnemonic ||
              resolvedDetail.grammarNote) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {resolvedDetail.radical && (
                  <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800 space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">
                      Bộ thủ
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 font-medium leading-relaxed">
                      {resolvedDetail.radical}
                    </p>
                  </div>
                )}
                {resolvedDetail.breakdown && (
                  <div
                    className={`p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800 space-y-1 ${
                      !resolvedDetail.radical ? 'md:col-span-2' : ''
                    }`}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">
                      Chiết tự &amp; Cấu tạo
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                      {resolvedDetail.breakdown}
                    </p>
                  </div>
                )}
                {resolvedDetail.mnemonic && (
                  <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 space-y-1 md:col-span-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 block">
                      💡 Mẹo ghi nhớ
                    </span>
                    <p className="text-amber-950 dark:text-amber-100 leading-relaxed">
                      {resolvedDetail.mnemonic}
                    </p>
                  </div>
                )}
                {resolvedDetail.grammarNote && (
                  <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-900/50 space-y-1 md:col-span-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 block">
                      Cách dùng &amp; Ngữ pháp
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                      {resolvedDetail.grammarNote}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Loading mở rộng từ AI */}
            {aiDetailLoading && (
              <div className="p-3.5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/70 dark:border-purple-900/50 flex items-center gap-2.5 text-purple-700 dark:text-purple-300">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Đang tải từ ghép phổ biến, ngữ pháp và câu ví dụ song ngữ...</span>
              </div>
            )}

            {/* Từ ghép phổ biến */}
            {resolvedDetail.compounds.length > 0 && (
              <div className="space-y-2 pt-1">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Từ ghép phổ biến
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {resolvedDetail.compounds.map((comp, cIdx) => (
                    <div
                      key={`${comp.hanzi}-${cIdx}`}
                      className="p-2.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800 hover:border-purple-400 dark:hover:border-purple-500/70 flex items-center justify-between gap-2 transition group"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!onOpenAiDictionary) return;
                          onClose();
                          onOpenAiDictionary(comp.hanzi);
                        }}
                        title={
                          onOpenAiDictionary ? `Mở "${comp.hanzi}" trong Từ điển AI` : comp.hanzi
                        }
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="chinese-serif text-sm font-bold text-slate-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition">
                            {renderHighlightedExample(comp.hanzi, vocab.hanzi, false)}
                          </span>
                          {comp.pinyin && (
                            <span className="text-[11px] font-mono text-red-600 dark:text-red-400">
                              {comp.pinyin}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                          {comp.meaning}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => speakChinese(comp.hanzi)}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-slate-500 hover:text-amber-600 shrink-0"
                        title={`Nghe phát âm ${comp.hanzi}`}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tập viết từng chữ Hán */}
            {onOpenWriter && resolvedDetail.chars.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                  <PenTool className="w-3.5 h-3.5" /> Tập viết từng chữ:
                </span>
                {resolvedDetail.chars.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() =>
                      onOpenWriter({
                        id: `${vocab.id}_${ch}`,
                        hanzi: ch,
                        pinyin: vocab.pinyin,
                        meaning: vocab.meaning,
                      })
                    }
                    className="chinese-serif px-3 py-1 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-stone-200 dark:border-slate-700 text-base font-bold text-slate-900 dark:text-white transition"
                    title={`Luyện viết chữ ${ch}`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            )}

            {/* Câu ví dụ song ngữ */}
            {resolvedDetail.examples.length > 0 && (
              <div className="space-y-2 pt-1">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Câu ví dụ song ngữ
                </h5>
                <div className="space-y-2">
                  {resolvedDetail.examples.map((ex, exIdx) => (
                    <div
                      key={`${ex.hanzi}-${exIdx}`}
                      className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <p className="chinese-serif text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-relaxed">
                          {renderHighlightedExample(ex.hanzi, vocab.hanzi, false)}
                        </p>
                        {ex.pinyin && (
                          <p className="font-mono text-xs text-red-600 dark:text-red-400">
                            {ex.pinyin}
                          </p>
                        )}
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {ex.meaning}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => speakChinese(ex.hanzi)}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 shrink-0 transition"
                        title="Nghe câu ví dụ"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions & Prev/Next navigation */}
      <div className="px-6 py-3.5 border-t border-stone-200 dark:border-slate-800 bg-stone-50/80 dark:bg-slate-900/90 flex items-center justify-between gap-2 flex-wrap">
        {totalCount > 1 && currentIndex >= 0 && onPrev && onNext ? (
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPrev}
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-stone-200 dark:border-slate-700 hover:border-stone-300 dark:hover:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 transition"
              title="Từ trước (←)"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Trước
            </button>
            <span className="px-2 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {currentIndex + 1} / {totalCount}
            </span>
            <button
              type="button"
              onClick={onNext}
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-stone-200 dark:border-slate-700 hover:border-stone-300 dark:hover:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 transition"
              title="Từ tiếp theo (→)"
            >
              Tiếp <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {!isEnglish && onOpenWriter && (
            <button
              type="button"
              onClick={() => onOpenWriter(vocab)}
              className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800/70 text-blue-700 dark:text-blue-300 text-xs font-bold inline-flex items-center gap-1.5 transition"
              title="Luyện viết thứ tự nét chữ Hán"
            >
              <PenTool className="w-3.5 h-3.5" /> Tập viết
            </button>
          )}
          {onOpenAiDictionary && (
            <button
              type="button"
              onClick={() => {
                const word = isEnglish
                  ? vocab.hanzi.trim()
                  : cleanPrimaryHanzi(vocab.hanzi) || vocab.hanzi;
                onClose();
                onOpenAiDictionary(word);
              }}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
              title={`Phân tích chi tiết "${vocab.hanzi}" bằng AI`}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI chi tiết
            </button>
          )}
          {onToggleMarked &&
            (markActionMode === 'unmark_only' ? (
              <button
                type="button"
                disabled={markLoading}
                onClick={onToggleMarked}
                className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40 transition"
                title="Bỏ đánh dấu từ này"
              >
                <Trash2 className="w-3.5 h-3.5" /> Bỏ đánh dấu
              </button>
            ) : (
              <button
                type="button"
                disabled={markLoading}
                onClick={onToggleMarked}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40 transition ${
                  isMarked
                    ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200'
                    : 'bg-white dark:bg-slate-800 border-stone-200 dark:border-slate-700 hover:border-amber-400 text-slate-700 dark:text-slate-200'
                }`}
                title={isMarked ? 'Bỏ đánh dấu từ này' : 'Đánh dấu từ cần ôn lại'}
              >
                <Flag className={`w-3.5 h-3.5 ${isMarked ? 'fill-current text-amber-500' : ''}`} />
                {isMarked ? 'Đã đánh dấu' : 'Đánh dấu'}
              </button>
            ))}
        </div>
      </div>
    </ModalShell>
  );
};
