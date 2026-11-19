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
  examTitle?: string | null;
  score: number;
  totalQuestions: number;
  correctCount: number;
  durationSeconds: number;
  submittedAt: string;
}

export interface TestLeaderboardEntry {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: 'user' | 'admin';
  lessonId: string | null;
  examTitle?: string | null;
  lessonTitle?: string | null;
  score: number;
  totalQuestions: number;
  correctCount: number;
  durationSeconds: number;
  submittedAt: string;
}

export type GameMode = 'tri_match' | 'scramble' | 'translation' | 'expanded_quiz';

export interface GameLeaderboardEntry {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: 'user' | 'admin';
  lessonId: string;
  lessonTitle?: string | null;
  gameMode: GameMode;
  score: number;
  maxScore?: number | null;
  durationSeconds: number;
  playedAt: string;
}

export interface DashboardActivityDay {
  date: string;
  count: number;
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface DashboardSkillItem {
  id: 'vocab' | 'grammar' | 'listening' | 'reading';
  label: string;
  score: number | null;
  correctCount: number;
  totalCount: number;
  passed: boolean;
  detail: string;
  targetTab: TabId;
  targetLessonId: string;
}

export interface DashboardSummary {
  streakDays: number;
  bestStreakDays: number;
  studiedToday: boolean;
  today: {
    minutesStudied: number;
    dailyGoalMinutes: number;
    testsCompleted: number;
    gamesCompleted: number;
    vocabMarkedToday: number;
  };
  vocabReview: {
    totalVocab: number;
    dueCount: number;
    newCount: number;
    learningCount: number;
    masteredCount: number;
  };
  skills: DashboardSkillItem[];
  activityLast28Days: DashboardActivityDay[];
  continueLesson: {
    lessonId: string;
    title: string;
    hskLevel: string;
    unit: string | null;
    progressPercent: number;
    passed: boolean;
    passThreshold: number;
    vocabCount: number;
    grammarCount: number;
    textCount: number;
    estimatedMinutesLeft: number;
    bestScore: number | null;
    attemptCount: number;
  } | null;
  overallProgress: {
    completedLessons: number;
    totalLessons: number;
    averageTestScore: number | null;
    totalTests: number;
    totalGames: number;
  };
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  avatarUrl?: string | null;
  coverUrl?: string | null;
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

export type TranslationDirection = 'auto' | 'zh_vi' | 'vi_zh';

export interface AiStatusResponse {
  configured: boolean;
  provider: string;
  model: string;
}

export interface AiDictionaryExample {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

export interface AiDictionaryEntry {
  query: string;
  direction: TranslationDirection;
  detectedLanguage: 'zh' | 'vi' | 'mixed';
  isSentence: boolean;
  hanzi: string;
  pinyin: string;
  sinoVietnamese: string | null;
  wordType: string | null;
  meaning: string;
  meanings: string[];
  radical: string | null;
  breakdown: string | null;
  mnemonic: string | null;
  grammarNote: string | null;
  examples: AiDictionaryExample[];
}

export interface AiDictionaryResponse {
  query: string;
  direction: TranslationDirection;
  localHits: GlobalVocabHit[];
  aiResult: AiDictionaryEntry | null;
  source: 'local_exact' | 'cache' | 'ai' | 'local_only';
  model: string | null;
  aiConfigured: boolean;
  notice?: string;
}

export interface AiToolExecutionSummary {
  name: string;
  summary: string;
}

export interface AiLessonDraftVocab {
  hanzi: string;
  pinyin: string;
  sinoVietnamese?: string | null;
  meaning: string;
  radical?: string | null;
  breakdown?: string | null;
  example?: string | null;
}

export interface AiLessonDraftGrammar {
  title: string;
  formula: string;
  explanation?: string | null;
}

export type AiPendingAction =
  | {
      id: string;
      type: 'create_lesson';
      title: string;
      hskLevel: string;
      unit?: string;
      description?: string;
      isSystem: boolean;
      vocabulary: AiLessonDraftVocab[];
      grammar: AiLessonDraftGrammar[];
    }
  | {
      id: string;
      type: 'update_lesson';
      lessonId: string;
      title: string;
      hskLevel: string;
      unit?: string;
      description?: string;
      isSystem: boolean;
      vocabulary: AiLessonDraftVocab[];
      grammar: AiLessonDraftGrammar[];
    }
  | {
      id: string;
      type: 'navigate';
      label: string;
      view: 'dashboard' | 'study' | 'profile' | 'exam' | 'saved_vocab' | 'history';
      lessonId?: string;
      tab?: TabId;
    }
  | {
      id: string;
      type: 'start_review_exam';
      title: string;
      description: string;
      lessonIds: string[];
      questions: ComprehensiveQuestion[];
    };

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolExecutions?: AiToolExecutionSummary[];
  pendingActions?: AiPendingAction[];
}
