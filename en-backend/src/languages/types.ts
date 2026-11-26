export type LanguageCode = 'zh' | 'en';

export type AnyTranslationDirection = 'auto' | 'zh_vi' | 'vi_zh' | 'en_vi' | 'vi_en';
export type AnyGameGradeDirection = 'vi_to_zh' | 'zh_to_vi' | 'vi_to_en' | 'en_to_vi';

export interface LanguageMetaConfig {
  code: LanguageCode;
  name: string;
  nativeName: string;
  description: string;
  accentTheme: string;
  sortOrder: number;
  defaultLevel: string;
  examTitleAll: string;
  examLevelRange: string;
}

export interface DictionaryPromptInput {
  query: string;
  direction: AnyTranslationDirection;
}

export interface GameGradingPromptInput {
  mode: 'scramble' | 'translation';
  direction: AnyGameGradeDirection | null;
  promptText: string;
  expectedTarget: string;
  expectedPhonetic: string;
  expectedMeaning: string;
  userAnswer: string;
}

export interface QuickLookupPromptInput {
  word: string;
  context?: string;
}

export interface LanguageStrategy {
  readonly meta: LanguageMetaConfig;
  normalizeDirection(raw?: string): AnyTranslationDirection;
  normalizeGameDirection(raw?: string): AnyGameGradeDirection;
  detectInputLanguage(text: string): 'zh' | 'en' | 'vi';
  cleanQuickLookupWord(raw: string): string;
  normalizeAnswerForExactMatch(text: string, isTargetLang: boolean): string;
  buildDictionaryPrompts(input: DictionaryPromptInput): {
    systemInstruction: string;
    userPrompt: string;
  };
  buildQuickLookupPrompts(input: QuickLookupPromptInput): {
    systemInstruction: string;
    userPrompt: string;
  };
  buildGameGradingPrompts(input: GameGradingPromptInput): {
    systemInstruction: string;
    userPrompt: string;
  };
  buildTutorRoleInstruction(): string;
}
