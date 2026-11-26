import React from 'react';
import type { VocabularyItem } from '../../types';

export interface GroupedPosMeaning {
  pos: string;
  meaning: string;
}

const LEADING_POS_RE =
  /^(?:n|v|adj|adv|prep|conj|pron|num|det|int|interj|aux|modal|phr|art)\.\s*/i;

function normalizePosLabel(raw?: string | null): string {
  const cleaned = (raw || '').trim().toLowerCase();
  if (!cleaned) return '';
  return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
}

function stripLeadingPos(text: string): string {
  let out = text.trim();
  while (LEADING_POS_RE.test(out)) {
    out = out.replace(LEADING_POS_RE, '').trim();
  }
  return out;
}

function appendUniqueClauses(target: string[], seen: Set<string>, rawText: string): void {
  const parts = stripLeadingPos(rawText)
    .split(/\s*;\s*/)
    .map((p) => stripLeadingPos(p))
    .filter(Boolean);
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      target.push(part);
    }
  }
}

/**
 * Nhóm nghĩa tiếng Việt của từ tiếng Anh theo từng loại từ (n., v., adj., adv., ...),
 * bỏ tiền tố loại từ bị lặp trong text gốc và gộp khử trùng các nét nghĩa cùng loại từ.
 */
export function groupEnglishMeaningsByPos(vocab: VocabularyItem): GroupedPosMeaning[] {
  const senses = vocab.meta?.senses;
  if (Array.isArray(senses) && senses.length > 0) {
    const groups = new Map<string, { pos: string; clauses: string[]; seen: Set<string> }>();
    const order: string[] = [];

    for (const s of senses) {
      const vi = (s?.vi || '').trim();
      if (!vi) continue;
      const pos = normalizePosLabel(s.pos || vocab.type);
      const key = pos || '__other__';
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = { pos, clauses: [], seen: new Set<string>() };
        groups.set(key, bucket);
        order.push(key);
      }
      appendUniqueClauses(bucket.clauses, bucket.seen, vi);
    }

    const result = order
      .map((k) => {
        const b = groups.get(k)!;
        return { pos: b.pos, meaning: b.clauses.join('; ') };
      })
      .filter((x) => Boolean(x.meaning));

    if (result.length > 0) return result;
  }

  // Fallback khi từ tự tạo chưa có meta.senses: tách nếu chuỗi meaning có nhúng tiền tố "n. ...; adj. ..."
  const rawMeaning = (vocab.meaning || '').trim();
  if (!rawMeaning) return [];

  const chunks = rawMeaning
    .split(/\s*;\s*/)
    .map((c) => c.trim())
    .filter(Boolean);

  const groups = new Map<string, { pos: string; clauses: string[]; seen: Set<string> }>();
  const order: string[] = [];
  let currentPos = normalizePosLabel(vocab.type && vocab.type !== 'Từ vựng' ? vocab.type : '');

  for (const chunk of chunks) {
    const m = chunk.match(LEADING_POS_RE);
    if (m) {
      currentPos = normalizePosLabel(m[0]);
    }
    const key = currentPos || '__other__';
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { pos: currentPos, clauses: [], seen: new Set<string>() };
      groups.set(key, bucket);
      order.push(key);
    }
    appendUniqueClauses(bucket.clauses, bucket.seen, chunk);
  }

  return order
    .map((k) => {
      const b = groups.get(k)!;
      return { pos: b.pos, meaning: b.clauses.join('; ') };
    })
    .filter((x) => Boolean(x.meaning));
}

export function getPosBadgeClass(pos: string): string {
  switch (pos.toLowerCase()) {
    case 'n.':
      return 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-700/60';
    case 'v.':
      return 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-700/60';
    case 'adj.':
      return 'bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200/70 dark:border-purple-700/60';
    case 'adv.':
      return 'bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-700/60';
    case 'prep.':
    case 'conj.':
      return 'bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-200/70 dark:border-sky-700/60';
    default:
      return 'bg-stone-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-stone-200 dark:border-slate-700';
  }
}

export function cleanEnglishSenseVi(text?: string | null): string {
  return stripLeadingPos(text || '');
}

interface EnglishMeaningLinesProps {
  vocab: VocabularyItem;
  size?: 'xs' | 'sm' | 'lg';
  centered?: boolean;
  className?: string;
}

export const EnglishMeaningLines: React.FC<EnglishMeaningLinesProps> = ({
  vocab,
  size = 'xs',
  centered = false,
  className = '',
}) => {
  const rows = groupEnglishMeaningsByPos(vocab);
  if (rows.length === 0) {
    return <span>{vocab.meaning}</span>;
  }

  const textClass =
    size === 'lg'
      ? 'text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-snug'
      : size === 'sm'
        ? 'text-sm font-medium text-gray-800 dark:text-slate-200 leading-snug'
        : 'text-xs font-medium text-gray-800 dark:text-slate-200 leading-relaxed';

  const badgeClass =
    size === 'lg'
      ? 'text-[11px] px-2 py-0.5 min-w-[34px]'
      : 'text-[10px] px-1.5 py-0.5 min-w-[30px]';

  return (
    <div className={`space-y-1 ${className}`}>
      {rows.map((row, idx) => (
        <div
          key={`${row.pos || 'none'}_${idx}`}
          className={`flex items-baseline gap-2 ${centered ? 'justify-center text-left' : ''}`}
        >
          {row.pos && (
            <span
              className={`inline-flex items-center justify-center rounded border font-mono font-bold shrink-0 ${badgeClass} ${getPosBadgeClass(row.pos)}`}
            >
              {row.pos}
            </span>
          )}
          <span className={textClass}>{row.meaning}</span>
        </div>
      ))}
    </div>
  );
};
