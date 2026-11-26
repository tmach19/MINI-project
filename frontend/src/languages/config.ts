import type { LanguageCode, VocabMeta } from '../types';

export type AppView =
  | 'dashboard'
  | 'saved_vocab'
  | 'history'
  | 'study'
  | 'profile'
  | 'exam'
  | 'admin';

export interface LanguagePackConfig {
  code: LanguageCode;
  brandTitle: string;
  brandSubtitle: string;
  dashboardBrandSubtitle: string;
  brandGlyph: string;
  brandGlyphClass: string;
  defaultLessonId: string;
  lessonStorageKey: string;
  defaultLevel: string;
  examLevelRange: string;
  examTitleAll: string;
  hasStrokeWriter: boolean;
  hasSinoVietnamese: boolean;
  hasDualAccentAudio: boolean;
  hasIllustration: boolean;
  headwordLabel: string;
  phoneticLabel: string;
  secondaryColumnLabel: string;
  vocabTabLabel: string;
  textsTabLabel: string;
  aiDirectionLabel: string;
  aiModalTitle: string;
  aiModalSubtitle: string;
  attribution?: string;
}

export const LANGUAGE_PACKS: Record<LanguageCode, LanguagePackConfig> = {
  zh: {
    code: 'zh',
    brandTitle: '汉语学堂',
    brandSubtitle: 'Học tiếng Trung',
    dashboardBrandSubtitle: 'Học tiếng Trung HSK',
    brandGlyph: '汉',
    brandGlyphClass: 'chinese-serif text-lg sm:text-xl font-black',
    defaultLessonId: 'lesson-1',
    lessonStorageKey: 'cs_current_lesson',
    defaultLevel: 'HSK 1',
    examLevelRange: 'HSK 1 - HSK 3',
    examTitleAll: 'Kiểm tra tổng hợp (26 bài)',
    hasStrokeWriter: true,
    hasSinoVietnamese: true,
    hasDualAccentAudio: false,
    hasIllustration: false,
    headwordLabel: 'Hán tự',
    phoneticLabel: 'Pinyin',
    secondaryColumnLabel: 'Hán Việt',
    vocabTabLabel: '1. Từ vựng & Viết',
    textsTabLabel: '2. Bài khoá & Nghe',
    aiDirectionLabel: 'Trung ⇄ Việt',
    aiModalTitle: 'Từ điển & Trợ lý AI Tiếng Trung',
    aiModalSubtitle:
      'Tra từ vựng Trung ⇄ Việt, dịch câu, luyện hội thoại & giải thích ngữ pháp HSK.',
  },
  en: {
    code: 'en',
    brandTitle: 'English Studio',
    brandSubtitle: 'Học tiếng Anh CEFR',
    dashboardBrandSubtitle: 'Tiếng Anh CEFR A1',
    brandGlyph: 'EN',
    brandGlyphClass: 'font-black tracking-tight text-sm sm:text-base',
    defaultLessonId: 'en-a1-1',
    lessonStorageKey: 'cs_current_lesson_en',
    defaultLevel: 'CEFR A1',
    examLevelRange: 'CEFR A1',
    examTitleAll: 'Kiểm tra tổng hợp (CEFR A1)',
    hasStrokeWriter: false,
    hasSinoVietnamese: false,
    hasDualAccentAudio: true,
    hasIllustration: true,
    headwordLabel: 'Từ tiếng Anh',
    phoneticLabel: 'Phiên âm IPA',
    secondaryColumnLabel: 'CEFR',
    vocabTabLabel: '1. Từ vựng & Phát âm',
    textsTabLabel: '2. Bài đọc & Nghe',
    aiDirectionLabel: 'Anh ⇄ Việt',
    aiModalTitle: 'Từ điển & Trợ lý AI Tiếng Anh',
    aiModalSubtitle:
      'Tra từ vựng Anh ⇄ Việt, dịch câu, collocations, phát âm UK/US & giải thích ngữ pháp.',
    attribution: 'Dữ liệu minh họa & phát âm chuẩn từ Word Atlas contributors (CC BY 4.0)',
  },
};

export function getLanguagePack(lang?: LanguageCode | null): LanguagePackConfig {
  return lang === 'en' ? LANGUAGE_PACKS.en : LANGUAGE_PACKS.zh;
}

/**
 * Phân tích URL hiện tại thành { lang, view }.
 * - Mọi đường dẫn bắt đầu bằng `/en` (vd: `/en`, `/en/study`, `/en/exam`, `/en/saved-vocab`, `/en/history`) -> `lang = 'en'`
 * - Mọi đường dẫn khác (`/`, `/study`, `/exam`, ...) -> `lang = 'zh'` (giữ nguyên 100% hành vi hiện tại)
 */
export function parseLocationRoute(pathname?: string): { lang: LanguageCode; view: AppView } {
  const raw =
    typeof pathname === 'string'
      ? pathname
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '/';
  const cleaned = raw.replace(/\/+$/, '') || '/';

  let lang: LanguageCode = 'zh';
  let subPath = cleaned;

  if (cleaned === '/en' || cleaned.startsWith('/en/')) {
    lang = 'en';
    subPath = cleaned.slice(3) || '/';
  }

  let view: AppView = 'dashboard';
  if (subPath === '/study') view = 'study';
  else if (subPath === '/saved-vocab') view = 'saved_vocab';
  else if (subPath === '/history') view = 'history';
  else if (subPath === '/profile') view = 'profile';
  else if (subPath === '/exam') view = 'exam';
  else if (subPath === '/admin') view = 'admin';
  else if (subPath === '/dashboard') view = 'dashboard';

  return { lang, view };
}

export function buildRoutePath(lang: LanguageCode, view: AppView): string {
  const suffix =
    view === 'study'
      ? '/study'
      : view === 'saved_vocab'
        ? '/saved-vocab'
        : view === 'history'
          ? '/history'
          : view === 'profile'
            ? '/profile'
            : view === 'exam'
              ? '/exam'
              : view === 'admin'
                ? '/admin'
                : '/';

  if (lang === 'en') {
    return suffix === '/' ? '/en' : `/en${suffix}`;
  }
  return suffix;
}

// =====================================================================
// English Media CDN Base URL (Supabase Storage Public Bucket)
// =====================================================================
const DEFAULT_EN_MEDIA_BASE_URL = (
  import.meta.env.VITE_EN_MEDIA_BASE_URL ||
  'https://jxzxxmybmlwnfjalcykv.supabase.co/storage/v1/object/public/tmach/en-atlas'
).replace(/\/+$/, '');

let runtimeEnMediaBaseUrl = DEFAULT_EN_MEDIA_BASE_URL;

export function setEnMediaBaseUrl(url?: string | null): void {
  const trimmed = (url || '').trim().replace(/\/+$/, '');
  if (trimmed) {
    runtimeEnMediaBaseUrl = trimmed;
  }
}

export function getEnMediaBaseUrl(): string {
  return runtimeEnMediaBaseUrl;
}

export function getEnImageUrl(
  meta?: VocabMeta | null,
  variant: 'thumb' | 'full' = 'full'
): string | null {
  const wordId = meta?.wordId?.trim();
  if (!wordId) return null;
  if (meta?.media && meta.media.img === false) return null;
  const folder = variant === 'thumb' ? 'thumb' : 'img';
  return `${runtimeEnMediaBaseUrl}/${folder}/${encodeURIComponent(wordId)}.webp`;
}

export function getEnAudioUrl(
  meta?: VocabMeta | null,
  kind: 'uk' | 'us' | 'ex' | 'ex2' = 'us'
): string | null {
  const wordId = meta?.wordId?.trim();
  if (!wordId) return null;
  if (meta?.media && meta.media[kind] === false) return null;
  return `${runtimeEnMediaBaseUrl}/audio/${kind}/${encodeURIComponent(wordId)}.mp3`;
}
