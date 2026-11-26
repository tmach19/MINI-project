import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Loader2, Volume2 } from 'lucide-react';
import { api } from '../../lib/api';
import { speakText } from '../../lib/audio';
import {
  ensureGlossaryLoaded,
  getGlossaryVersion,
  lookupLocalGlossary,
  rememberGlossaryEntry,
  segmentInteractiveText,
  subscribeGlossary,
} from '../../lib/vocabGlossary';
import type { LanguageCode, VocabGlossaryItem } from '../../types';

interface InteractiveChineseTextProps {
  text: string;
  enabled: boolean;
  lang?: LanguageCode;
  canUseAi?: boolean;
  contextSentence?: string;
  /**
   * Giữ nguyên hành vi click của phần tử cha (vd nút chọn từ ở Sắp xếp câu hoặc nút đáp án A/B/C/D):
   * hover vẫn bung thẻ Wikipedia; bấm "Chi tiết" trong thẻ mới mở tra cứu đầy đủ.
   */
  preserveClick?: boolean;
  /** Nếu truyền true, coi toàn bộ `text` là 1 từ nguyên vẹn (không tách nhỏ thêm, phù hợp cho mảnh token). */
  treatAsSingleWord?: boolean;
  onOpenDetail?: (word: string) => void;
  className?: string;
  wordClassName?: string;
}

interface PopoverState {
  word: string;
  rect: { left: number; top: number; bottom: number; width: number };
  loading: boolean;
  entry: VocabGlossaryItem | null;
  notFound: boolean;
}

const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 180;
const POPOVER_WIDTH = 280;

interface ParsedSense {
  label: string | null;
  text: string;
}

function splitTopLevel(input: string, separators: string[]): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(' || ch === '（') {
      depth++;
      buf += ch;
    } else if (ch === ')' || ch === '）') {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (depth === 0 && separators.includes(ch)) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseEntrySenses(wordType: string | null | undefined, meaning: string): {
  senses: ParsedSense[];
  hasLabeledLines: boolean;
} {
  const cleanMeaning = (meaning || '').trim();
  const cleanType = (wordType || '').trim();
  if (!cleanMeaning) return { senses: [], hasLabeledLines: false };

  // 1) Trường hợp chuỗi nghĩa đã tách sẵn dạng "Danh từ: ...; Động từ: ..."
  const explicitLines = splitTopLevel(cleanMeaning, [';', '\n']);
  const explicitParsed = explicitLines
    .map((line) => {
      const m = line.match(
        /^(Danh từ|Động từ|Tính từ|Phó từ|Giới từ|Liên từ|Đại từ|Trợ từ|Lượng từ|Số từ|Thán từ|Cụm từ)\s*:\s*(.+)$/i
      );
      return m ? { label: m[1].trim(), text: m[2].trim() } : null;
    })
    .filter((x): x is { label: string; text: string } => Boolean(x));

  if (explicitParsed.length >= 2 && explicitParsed.length === explicitLines.length) {
    return { senses: explicitParsed, hasLabeledLines: true };
  }

  // 2) Tách nhiều từ loại (bỏ qua nhãn gộp "Cụm từ / Tên riêng")
  const types =
    cleanType && !/^Cụm từ\s*\/\s*Tên riêng$/i.test(cleanType)
      ? cleanType
          .split('/')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  // Ưu tiên tách bằng ';' hoặc '/' ở cấp ngoài ngoặc
  const majorParts = splitTopLevel(cleanMeaning, [';', '/']);
  if (majorParts.length >= 2) {
    if (types.length === majorParts.length) {
      return {
        senses: majorParts.map((text, idx) => ({ label: types[idx], text })),
        hasLabeledLines: true,
      };
    }
    return {
      senses: majorParts.map((text) => ({ label: null, text })),
      hasLabeledLines: false,
    };
  }

  // 3) Nếu có từ 2 từ loại trở lên (vd "Danh từ / Động từ") và nghĩa tách bằng dấu phẩy ngoài ngoặc
  if (types.length >= 2) {
    const commaParts = splitTopLevel(cleanMeaning, [',']);
    if (commaParts.length === types.length) {
      return {
        senses: commaParts.map((text, idx) => ({ label: types[idx], text })),
        hasLabeledLines: true,
      };
    }
    if (commaParts.length > types.length) {
      // Gom nhóm đồng nghĩa đầu tiên cho từ loại 1, phần còn lại ghép 1-1 với các từ loại sau
      // Vd: "Tính từ / Danh từ" + "khỏe mạnh, tráng kiện, sức khỏe" -> Tính từ: khỏe mạnh, tráng kiện | Danh từ: sức khỏe
      const firstGroupCount = commaParts.length - types.length + 1;
      const senses: ParsedSense[] = [
        { label: types[0], text: commaParts.slice(0, firstGroupCount).join(', ') },
      ];
      for (let i = 1; i < types.length; i++) {
        senses.push({ label: types[i], text: commaParts[firstGroupCount + i - 1] });
      }
      return { senses, hasLabeledLines: true };
    }
  }

  return {
    senses: [{ label: null, text: cleanMeaning }],
    hasLabeledLines: false,
  };
}

export const InteractiveChineseText: React.FC<InteractiveChineseTextProps> = ({
  text,
  enabled,
  lang = 'zh',
  canUseAi = false,
  contextSentence,
  preserveClick = false,
  treatAsSingleWord = false,
  onOpenDetail,
  className,
  wordClassName,
}) => {
  const [glossaryVer, setGlossaryVer] = useState(getGlossaryVersion);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lookupSeqRef = useRef(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeGlossary(() => setGlossaryVer(getGlossaryVersion())), []);

  useEffect(() => {
    if (enabled) {
      void ensureGlossaryLoaded(lang);
    } else {
      clearTimersAndAbort();
      setPopover(null);
    }
  }, [enabled, lang]);

  useEffect(() => {
    return () => {
      clearTimersAndAbort();
    };
  }, []);

  // Đóng popup khi người dùng bấm ra ngoài (hữu ích cho mobile / touch)
  useEffect(() => {
    if (!popover) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (popoverRef.current && target && popoverRef.current.contains(target)) return;
      clearTimersAndAbort();
      setPopover(null);
    };
    const handleScrollOrResize = () => {
      clearTimersAndAbort();
      setPopover(null);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [popover]);

  const clearTimersAndAbort = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    lookupSeqRef.current += 1;
  };

  const cancelCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    cancelCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      lookupSeqRef.current += 1;
      setPopover(null);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const openLookupForWord = async (word: string, el: HTMLElement) => {
    cancelCloseTimer();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const r = el.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, bottom: r.bottom, width: r.width };

    // Tầng 1: Tra tức thì trong Glossary RAM (DB + Read-through cache) -> 0ms
    const localHit = lookupLocalGlossary(word, lang);
    if (localHit) {
      setPopover({ word, rect, loading: false, entry: localHit, notFound: false });
      return;
    }

    if (!canUseAi) {
      setPopover({ word, rect, loading: false, entry: null, notFound: true });
      return;
    }

    // Tầng 2 & 3: Gọi quick-lookup (DB exact -> translation_cache -> AI siêu gọn)
    const seq = ++lookupSeqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    setPopover({ word, rect, loading: true, entry: null, notFound: false });

    try {
      const res = await api.aiQuickLookup(
        {
          word,
          context: (contextSentence || text).slice(0, 220),
          lang,
        },
        controller.signal
      );
      if (seq !== lookupSeqRef.current) return;

      if (res.entry) {
        rememberGlossaryEntry(res.entry, lang);
        setPopover({ word, rect, loading: false, entry: res.entry, notFound: false });
      } else {
        setPopover({ word, rect, loading: false, entry: null, notFound: true });
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (seq !== lookupSeqRef.current) return;
      setPopover({ word, rect, loading: false, entry: null, notFound: true });
    }
  };

  const handleWordMouseEnter = (word: string, el: HTMLElement) => {
    cancelCloseTimer();
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    // Nếu đang mở đúng từ này rồi thì không cần debounce lại
    if (popover?.word === word) return;

    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      void openLookupForWord(word, el);
    }, HOVER_OPEN_DELAY_MS);
  };

  const segments = useMemo(() => {
    if (!enabled) return null;
    if (treatAsSingleWord) {
      const hasTarget = lang === 'en' ? /[A-Za-z]/.test(text) : /[\u4e00-\u9fff]/.test(text);
      return [{ text, isChinese: hasTarget }];
    }
    return segmentInteractiveText(text, lang);
  }, [text, enabled, lang, treatAsSingleWord, glossaryVer]);

  if (!enabled || !segments) {
    return <span className={className}>{text}</span>;
  }

  // Tính toạ độ Popover chống tràn mép màn hình (dùng bottom thay vì translateY(-100%) để không bị animation pop-in đè)
  const renderPopover = () => {
    if (!popover || typeof document === 'undefined') return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const centerX = popover.rect.left + popover.rect.width / 2;
    const clampedLeft = Math.max(
      12,
      Math.min(centerX - POPOVER_WIDTH / 2, vw - POPOVER_WIDTH - 12)
    );
    const arrowLeft = Math.max(18, Math.min(centerX - clampedLeft, POPOVER_WIDTH - 18));
    const placeBelow = popover.rect.top < 185;
    const gap = 10;

    return createPortal(
      <div
        ref={popoverRef}
        onMouseEnter={cancelCloseTimer}
        onMouseLeave={scheduleClose}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: `${clampedLeft}px`,
          ...(placeBelow
            ? { top: `${popover.rect.bottom + gap}px` }
            : { bottom: `${vh - popover.rect.top + gap}px` }),
          width: `${POPOVER_WIDTH}px`,
          zIndex: 70,
        }}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 shadow-2xl shadow-slate-900/15 dark:shadow-black/50 p-3.5 text-left pop-in"
      >
        <div
          style={{ left: `${arrowLeft}px` }}
          className={`pointer-events-none absolute -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-white dark:bg-slate-900 ${
            placeBelow
              ? '-top-1.5 border-l border-t border-stone-200 dark:border-slate-700'
              : '-bottom-1.5 border-r border-b border-stone-200 dark:border-slate-700'
          }`}
        />
        {popover.loading ? (
          <div className="flex items-center gap-2.5 py-1 text-xs text-gray-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-purple-600 shrink-0" />
            <span>
              Đang tra nghĩa <strong className="chinese-font text-gray-800 dark:text-slate-100">{popover.word}</strong>...
            </span>
          </div>
        ) : popover.entry ? (
          (() => {
            const { senses, hasLabeledLines } = parseEntrySenses(
              popover.entry.wordType,
              popover.entry.meaning
            );
            return (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-lg font-bold chinese-font text-gray-900 dark:text-white leading-none">
                        {popover.entry.hanzi}
                      </span>
                      {popover.entry.pinyin && (
                        <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                          {popover.entry.pinyin}
                        </span>
                      )}
                    </div>
                    {(popover.entry.sinoVietnamese || (!hasLabeledLines && popover.entry.wordType)) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                        {popover.entry.sinoVietnamese && (
                          <span className="font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            [{popover.entry.sinoVietnamese}]
                          </span>
                        )}
                        {!hasLabeledLines && popover.entry.wordType && (
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-[10px]">
                            {popover.entry.wordType}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      speakText(popover.entry!.hanzi, lang);
                    }}
                    aria-label="Nghe phát âm"
                    title="Nghe phát âm"
                    className="p-1.5 rounded-xl bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60 transition shrink-0"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {senses.length > 1 ? (
                  <ul className="space-y-1.5 pt-0.5">
                    {senses.map((sense, sIdx) => (
                      <li
                        key={sIdx}
                        className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-slate-200 leading-relaxed font-normal"
                      >
                        {sense.label ? (
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 text-[10px] font-semibold shrink-0 mt-0.5">
                            {sense.label}
                          </span>
                        ) : (
                          <span className="text-purple-500 font-bold shrink-0">•</span>
                        )}
                        <span>{sense.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-700 dark:text-slate-200 leading-relaxed font-normal">
                    {senses[0]?.text || popover.entry.meaning}
                  </p>
                )}

                {onOpenDetail && (
                  <div className="pt-1.5 border-t border-stone-100 dark:border-slate-800 flex justify-end">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const targetWord = popover.entry!.hanzi;
                        clearTimersAndAbort();
                        setPopover(null);
                        onOpenDetail(targetWord);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition"
                    >
                      Xem chi tiết <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold chinese-font text-gray-900 dark:text-white">
                {popover.word}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  speakText(popover.word, lang);
                }}
                aria-label="Nghe phát âm"
                className="p-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:text-purple-600 transition"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 font-normal">
              Chưa có nghĩa sẵn trong kho từ vựng.
            </p>
            {onOpenDetail && (
              <div className="pt-1 border-t border-stone-100 dark:border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const targetWord = popover.word;
                    clearTimersAndAbort();
                    setPopover(null);
                    onOpenDetail(targetWord);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Tra chi tiết <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>,
      document.body
    );
  };

  return (
    <span className={className}>
      {segments.map((seg, idx) =>
        seg.isChinese ? (
          <span
            key={idx}
            onMouseEnter={(e) => handleWordMouseEnter(seg.text, e.currentTarget)}
            onMouseLeave={scheduleClose}
            onClick={(e) => {
              if (preserveClick) return;
              e.stopPropagation();
              if (onOpenDetail && popover?.word === seg.text) {
                clearTimersAndAbort();
                setPopover(null);
                onOpenDetail(seg.text);
              } else {
                void openLookupForWord(seg.text, e.currentTarget);
              }
            }}
            className={
              wordClassName ||
              `underline decoration-dotted underline-offset-4 decoration-purple-400/75 dark:decoration-purple-400/60 hover:bg-purple-100/80 dark:hover:bg-purple-900/40 rounded-[4px] transition-colors ${
                preserveClick ? '' : 'cursor-pointer'
              }`
            }
          >
            {seg.text}
          </span>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}
      {renderPopover()}
    </span>
  );
};
