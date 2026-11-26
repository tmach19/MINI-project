import { api } from './api';
import type { LanguageCode, VocabGlossaryItem, VocabularyItem } from '../types';

export interface TextSegment {
  text: string;
  isChinese: boolean;
}

const glossaryMaps: Record<LanguageCode, Map<string, VocabGlossaryItem>> = {
  zh: new Map(),
  en: new Map(),
};
const loadPromises: Record<LanguageCode, Promise<void> | null> = {
  zh: null,
  en: null,
};
const loadedFromServer: Record<LanguageCode, boolean> = {
  zh: false,
  en: false,
};
const listeners = new Set<() => void>();
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

function extractHeadwords(rawHanzi: string, lang: LanguageCode): string[] {
  if (lang === 'en') {
    const clean = String(rawHanzi || '')
      .replace(/\([^)]*\)/g, '')
      .trim()
      .toLowerCase();
    return clean ? [clean] : [];
  }
  return String(rawHanzi || '')
    .replace(/\([^)]*\)|（[^）]*）/g, '')
    .split(/[/／、,，]/)
    .map((part) => part.replace(/[^\u4e00-\u9fff]/g, '').trim())
    .filter((w) => w.length >= 1 && w.length <= 6);
}

function normalizeLookupKey(word: string, lang: LanguageCode): string {
  if (lang === 'en') {
    return word
      .trim()
      .toLowerCase()
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  }
  return word.replace(/[^\u4e00-\u9fff]/g, '').trim();
}

export function seedLessonVocabIntoGlossary(
  vocabList: VocabularyItem[] | undefined,
  lang: LanguageCode = 'zh'
): void {
  if (!vocabList || vocabList.length === 0) return;
  const map = glossaryMaps[lang];
  let added = false;
  for (const v of vocabList) {
    const meaning = (v.meaning || '').trim();
    if (!meaning) continue;
    for (const head of extractHeadwords(v.hanzi, lang)) {
      if (!map.has(head)) {
        map.set(head, {
          hanzi: lang === 'en' ? v.hanzi.trim() : head,
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

export function ensureGlossaryLoaded(lang: LanguageCode = 'zh'): Promise<void> {
  if (loadedFromServer[lang]) return Promise.resolve();
  if (loadPromises[lang]) return loadPromises[lang]!;

  const map = glossaryMaps[lang];
  loadPromises[lang] = api
    .getVocabGlossary(lang)
    .then((res) => {
      loadedFromServer[lang] = true;
      let added = false;
      for (const item of res.items || []) {
        const key = normalizeLookupKey(item.hanzi || '', lang);
        if (!key || !item.meaning) continue;
        const existing = map.get(key);
        if (!existing || (existing.source !== 'db' && item.source === 'db')) {
          map.set(key, { ...item, hanzi: lang === 'en' ? item.hanzi.trim() : key });
          added = true;
        }
      }
      if (added) notifyListeners();
    })
    .catch(() => {
      loadPromises[lang] = null;
    });

  return loadPromises[lang]!;
}

export function lookupLocalGlossary(
  word: string,
  lang: LanguageCode = 'zh'
): VocabGlossaryItem | null {
  const clean = normalizeLookupKey(word, lang);
  if (!clean) return null;
  const map = glossaryMaps[lang];
  const exact = map.get(clean);
  if (exact) return exact;
  if (lang === 'en') {
    // Simple inflection fallback (plural/past/ing) for instant English lookup
    const candidates: string[] = [];
    if (clean.endsWith('ies') && clean.length > 4) candidates.push(`${clean.slice(0, -3)}y`);
    if (clean.endsWith('es') && clean.length > 3) candidates.push(clean.slice(0, -2));
    if (clean.endsWith('s') && clean.length > 2) candidates.push(clean.slice(0, -1));
    if (clean.endsWith('ed') && clean.length > 3) {
      candidates.push(clean.slice(0, -2), clean.slice(0, -1));
    }
    if (clean.endsWith('ing') && clean.length > 4) {
      candidates.push(clean.slice(0, -3), `${clean.slice(0, -3)}e`);
    }
    for (const c of candidates) {
      const hit = map.get(c);
      if (hit) return hit;
    }
  }
  return null;
}

export function rememberGlossaryEntry(
  entry: VocabGlossaryItem,
  lang: LanguageCode = 'zh'
): void {
  const clean = normalizeLookupKey(entry.hanzi || '', lang);
  if (!clean || !entry.meaning) return;
  const map = glossaryMaps[lang];
  const existing = map.get(clean);
  if (existing && existing.source === 'db') return;
  map.set(clean, { ...entry, hanzi: lang === 'en' ? entry.hanzi.trim() : clean });
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

function segmentChineseRun(run: string): string[] {
  const map = glossaryMaps.zh;
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
      if (map.has(sub)) {
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

export function segmentInteractiveText(
  text: string,
  lang: LanguageCode = 'zh'
): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];

  if (lang === 'en') {
    const re = /([A-Za-z]+(?:['’-][A-Za-z]+)*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: text.slice(lastIndex, match.index), isChinese: false });
      }
      segments.push({ text: match[1], isChinese: true });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), isChinese: false });
    }
    return segments;
  }

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
