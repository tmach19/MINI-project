import { enStrategy } from './en/strategy.js';
import type { LanguageCode, LanguageMetaConfig, LanguageStrategy } from './types.js';

export const SUPPORTED_LANGUAGES: readonly LanguageMetaConfig[] = [enStrategy.meta];

export function normalizeLanguageCode(_raw?: unknown): LanguageCode {
  return 'en';
}

export function getLanguageStrategy(_raw?: unknown): LanguageStrategy {
  return enStrategy;
}
