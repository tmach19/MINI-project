import { api } from './api';
import type { VocabGlossaryItem, VocabularyItem } from '../types';

export interface TextSegment {
  text: string;
  isChinese: boolean;
}

const glossaryMap = new Map<string, VocabGlossaryItem>();
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;
let loadedFromServer = false;
let glossaryVersion = 0;

type WordSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

let cachedZhSegmenter: WordSegmenter | null | undefined;

function getZhSegmenter(): WordSegmenter | null {
  if (cachedZhSegmenter !== undefined) return cachedZhSegmenter;
  try {
    const IntlAny = Intl as unknown as {
      Segmenter?: new (
        locale: string,
        options: { granularity: 'word' }
      ) => WordSegmenter;
    };
    cachedZhSegmenter = IntlAny.Segmenter
      ? new IntlAny.Segmenter('zh', { granularity: 'word' })
      : null;
  } catch {
    cachedZhSegmenter = null;
  }
  return cachedZhSegmenter;
}

function notifyListeners() {
  glossaryVersion += 1;
  for (const fn of listeners) fn();
}

export function getGlossaryVersion(): number {
  return glossaryVersion;
}

export function subscribeGlossary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function extractHeadwords(rawHanzi: string): string[] {
  return String(rawHanzi || '')
    .replace(/\([^)]*\)|（[^）]*）/g, '')
    .split(/[/／、,，]/)
    .map((part) => part.replace(/[^\u4e00-\u9fff]/g, '').trim())
    .filter((w) => w.length >= 1 && w.length <= 6);
}

export function seedLessonVocabIntoGlossary(vocabList: VocabularyItem[] | undefined): void {
  if (!vocabList || vocabList.length === 0) return;
  let added = false;
  for (const v of vocabList) {
    const meaning = (v.meaning || '').trim();
    if (!meaning) continue;
    for (const head of extractHeadwords(v.hanzi)) {
      if (!glossaryMap.has(head)) {
        glossaryMap.set(head, {
          hanzi: head,
          pinyin: (v.pinyin || '').trim(),
          sinoVietnamese: v.sinoVietnamese ? v.sinoVietnamese.trim() : null,
          meaning,
          wordType: v.type ? v.type.trim() : null,
          source: 'db',
        });
        added = true;
      }
    }
  }
  if (added) notifyListeners();
}

export function ensureGlossaryLoaded(): Promise<void> {
  if (loadedFromServer) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = api
    .getVocabGlossary()
    .then((res) => {
      loadedFromServer = true;
      let added = false;
      for (const item of res.items || []) {
        const key = (item.hanzi || '').replace(/[^\u4e00-\u9fff]/g, '').trim();
        if (!key || !item.meaning) continue;
        // DB ưu tiên hơn cache nếu trùng từ
        const existing = glossaryMap.get(key);
        if (!existing || (existing.source !== 'db' && item.source === 'db')) {
          glossaryMap.set(key, { ...item, hanzi: key });
          added = true;
        }
      }
      if (added) notifyListeners();
    })
    .catch(() => {
      // Cho phép thử lại lần sau nếu mạng tạm lỗi
      loadPromise = null;
    });

  return loadPromise;
}

export function lookupLocalGlossary(word: string): VocabGlossaryItem | null {
  const clean = word.replace(/[^\u4e00-\u9fff]/g, '').trim();
  if (!clean) return null;
  return glossaryMap.get(clean) || null;
}

export function rememberGlossaryEntry(entry: VocabGlossaryItem): void {
  const clean = (entry.hanzi || '').replace(/[^\u4e00-\u9fff]/g, '').trim();
  if (!clean || !entry.meaning) return;
  const existing = glossaryMap.get(clean);
  if (existing && existing.source === 'db') return;
  glossaryMap.set(clean, { ...entry, hanzi: clean });
  notifyListeners();
}

function segmentFallbackSpan(span: string): string[] {
  if (!span) return [];
  const segmenter = getZhSegmenter();
  if (segmenter) {
    const out: string[] = [];
    for (const part of segmenter.segment(span)) {
      if (part.segment) out.push(part.segment);
    }
    if (out.length > 0) return out;
  }
  return Array.from(span);
}

/**
 * Tách từ tiếng Trung 2 lớp:
 * 1) Khớp từ ghép dài nhất (6 -> 2 chữ) ưu tiên từ kho từ vựng HSK + cache của hệ thống.
 * 2) Phần chữ ngoài danh sách DB được tách bằng Intl.Segmenter('zh') của trình duyệt (0 KB).
 */
function segmentChineseRun(run: string): string[] {
  const result: string[] = [];
  let unmatchedBuf = '';
  let i = 0;

  const flushUnmatched = () => {
    if (!unmatchedBuf) return;
    result.push(...segmentFallbackSpan(unmatchedBuf));
    unmatchedBuf = '';
  };

  while (i < run.length) {
    let matched = '';
    const maxLen = Math.min(6, run.length - i);
    for (let len = maxLen; len >= 2; len--) {
      const sub = run.slice(i, i + len);
      if (glossaryMap.has(sub)) {
        matched = sub;
        break;
      }
    }

    if (matched) {
      flushUnmatched();
      result.push(matched);
      i += matched.length;
    } else {
      unmatchedBuf += run[i];
      i += 1;
    }
  }

  flushUnmatched();
  return result;
}

export function segmentInteractiveText(text: string): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];
  const re = /([\u4e00-\u9fff]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isChinese: false });
    }
    const words = segmentChineseRun(match[1]);
    for (const w of words) {
      segments.push({ text: w, isChinese: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isChinese: false });
  }

  return segments;
}

export function hasChineseChars(text: string | null | undefined): boolean {
  return Boolean(text && /[\u4e00-\u9fff]/.test(text));
}
