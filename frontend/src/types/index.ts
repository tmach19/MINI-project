export type TabId = 'vocab' | 'texts' | 'grammar' | 'games' | 'test';

export interface VocabularyItem {
  id: string;
  hanzi: string;
  pinyin: string;
  sinoVietnamese?: string | null;
  meaning: string;
  type?: string | null;
  radical?: string | null;
  breakdown?: string | null;
  mnemonic?: string | null;
  example?: string | null;
  examplePinyin?: string | null;
  exampleMeaning?: string | null;
}

export interface GrammarExample {
  hanzi: string;
  pinyin?: string;
  meaning: string;
}

export interface GrammarItem {
  id: string;
  title: string;
  formula: string;
  explanation?: string | null;
  notes?: string | null;
  examples: GrammarExample[];
}

export interface TextSentence {
  id?: string;
  speaker?: string | null;
  hanzi: string;
  displayHanzi?: string | null;
  pinyin?: string | null;
  meaning?: string | null;
}

export interface ListeningQuestion {
  id?: string;
  audioText?: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
}

export interface TextItem {
  id?: string;
  title: string;
  description?: string | null;
  sentences: TextSentence[];
  listeningQuestions: ListeningQuestion[];
}

export interface ScrambleExercise {
  id: string;
  targetHanzi: string;
  targetMeaning: string;
  pinyin?: string | null;
  tokens: string[];
  unlearnedHint?: string | null;
}

export interface TranslationExercise {
  id: string;
  direction: 'vi_to_zh' | 'zh_to_vi';
  promptText: string;
  chineseAudioText?: string | null;
  pinyin?: string | null;
  expectedChinese?: string | null;
  expectedMeaning?: string | null;
  acceptedPinyin?: string | null;
  acceptedKeywords?: string[];
  hint?: string | null;
  explanation?: string | null;
}

export interface ExpandedQuizQuestion {
  id: string;
  type?: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
}

export interface ComprehensiveQuestion {
  id: string;
  lessonId?: string | null;
  lessonTitle?: string | null;
  category?: string | null;
  audioText?: string | null;
  passage?: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
}

export interface ComprehensiveExamResponse {
  id: string;
  title: string;
  hskLevel: string;
  description: string;
  questions: ComprehensiveQuestion[];
}

export interface LessonSummary {
  id: string;
  title: string;
  hskLevel: string;
  unit?: string | null;
  description?: string | null;
  dateAdded?: string | null;
  isSystem: boolean;
  ownerId?: string | null;
  vocabCount: number;
  grammarCount: number;
  textCount: number;
  testCount: number;
}

export interface LessonDetail {
  id: string;
  title: string;
  hskLevel: string;
  unit?: string | null;
  description?: string | null;
  dateAdded?: string | null;
  isSystem: boolean;
  ownerId?: string | null;
  vocabulary: VocabularyItem[];
  grammar: GrammarItem[];
  texts: TextItem[];
  exercises: {
    sentenceScramble: ScrambleExercise[];
    translationExercises: TranslationExercise[];
    expandedQuiz: ExpandedQuizQuestion[];
  };
  comprehensiveTest: ComprehensiveQuestion[];
}

export interface GlobalVocabHit extends VocabularyItem {
  lessonId: string;
  lessonTitle: string;
  hskLevel: string;
}

export interface MarkedVocabRecord {
  vocabId: string;
  note?: string | null;
  markedAt: string;
}

export interface MarkedVocabCard extends VocabularyItem {
  lessonId: string;
  lessonTitle: string;
  markedAt: string;
  note?: string | null;
}

export interface TestAttemptRecord {
  id: string;
  lessonId: string | null;
  lessonTitle?: string;
  examTitle?: string | null;
  score: number;
  totalQuestions: number;
  correctCount: number;
  durationSeconds: number;
  answers: Record<string, number>;
  submittedAt: string;
}

export interface LessonTestSummaryRecord {
  lessonId: string;
  lessonTitle: string;
  attemptCount: number;
  avgScore: number | null;
  scoreSum: number;
  bestScore: number | null;
  avgCorrect: number | null;
  totalQuestions: number | null;
  avgDurationSeconds: number | null;
  lastSubmittedAt: string | null;
  status: 'passed' | 'failed' | 'unattempted';
}

export interface LessonAttemptDetailRecord {
  id: string;
  lessonId: string | null;
  score: number;
  totalQuestions: number;
  correctCount: number;
  durationSeconds: number;
  submittedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  isSuperAdmin?: boolean;
  permissions?: string[];
  createdAt: string;
}

export interface PermissionCatalogItem {
  id: string;
  code: string;
  name: string;
  type: 'MENU' | 'ACTION';
  parentCode: string | null;
  description: string;
  sortOrder: number;
  activeFlg: boolean;
}

export interface RoleWithPermissions {
  id: 'admin' | 'user';
  code: 'admin' | 'user';
  name: string;
  description: string;
  isSystem: boolean;
  activeFlg: boolean;
  permissionIds: string[];
}

export interface AdminUserRbacRow {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  isSuperAdmin: boolean;
  createdAt: string;
  rolePermissions: string[];
  addedPermissions: string[];
  excludedPermissions: string[];
  effectivePermissions: string[];
}
