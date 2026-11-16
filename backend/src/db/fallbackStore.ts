import fs from 'node:fs';
import vm from 'node:vm';
import { env } from '../config/env.js';
import type {
  LessonDetail,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
} from '../types/domain.js';

interface RawLesson {
  id?: string;
  title: string;
  hskLevel?: string;
  unit?: string;
  description?: string;
  dateAdded?: string;
  vocabulary?: any[];
  grammar?: any[];
  texts?: any[];
  exercises?: {
    sentenceScramble?: any[];
    translationExercises?: any[];
    expandedQuiz?: any[];
  };
  comprehensiveTest?: any[];
}

export interface MemoryUser extends UserProfile {
  passwordHash: string;
}

class FallbackMemoryStore {
  private initialized = false;
  lessons: LessonDetail[] = [];
  users: MemoryUser[] = [];
  // userId -> Map<vocabId, MarkedVocabRecord>
  markedByUser = new Map<string, Map<string, MarkedVocabRecord>>();
  attemptsByUser = new Map<string, TestAttemptRecord[]>();

  ensureLoaded(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (!fs.existsSync(env.legacyDataPath)) {
      console.warn(`[FallbackStore] Không tìm thấy ${env.legacyDataPath}`);
      return;
    }

    const raw = fs.readFileSync(env.legacyDataPath, 'utf8');
    const patched = raw.replace('const DEFAULT_LESSONS', 'globalThis.DEFAULT_LESSONS');
    const context: { globalThis: { DEFAULT_LESSONS?: RawLesson[] } } = { globalThis: {} };
    vm.createContext(context);
    vm.runInContext(patched, context);

    const list = context.globalThis.DEFAULT_LESSONS || [];
    this.lessons = list.map((l, idx) => ({
      id: l.id || `lesson-${idx + 1}`,
      title: l.title,
      hskLevel: l.hskLevel || 'HSK 1',
      unit: l.unit || null,
      description: l.description || null,
      dateAdded: l.dateAdded || null,
      isSystem: true,
      ownerId: null,
      vocabulary: (l.vocabulary || []).map((v) => ({
        id: v.id,
        hanzi: v.hanzi,
        pinyin: v.pinyin || '',
        sinoVietnamese: v.sinoVietnamese || null,
        meaning: v.meaning || '',
        type: v.type || null,
        radical: v.radical || null,
        breakdown: v.breakdown || null,
        mnemonic: v.mnemonic || null,
        example: v.example || null,
        examplePinyin: v.examplePinyin || null,
        exampleMeaning: v.exampleMeaning || null,
      })),
      grammar: (l.grammar || []).map((g) => ({
        id: g.id,
        title: g.title,
        formula: g.formula ?? g.structure ?? '',
        explanation: g.explanation || null,
        notes: g.notes || null,
        examples: g.examples || [],
      })),
      texts: (l.texts || []).map((t, tIdx) => ({
        id: t.id || `txt_${idx + 1}_${tIdx + 1}`,
        title: t.title,
        description: t.description || null,
        sentences: (t.sentences || []).map((s: any, sIdx: number) => ({
          id: `ts_${idx + 1}_${tIdx + 1}_${sIdx + 1}`,
          speaker: s.speaker || null,
          hanzi: s.hanzi,
          displayHanzi: s.displayHanzi || null,
          pinyin: s.pinyin || null,
          meaning: s.meaning || null,
        })),
        listeningQuestions: (t.listeningQuestions || []).map((lq: any, qIdx: number) => ({
          id: `lq_${idx + 1}_${tIdx + 1}_${qIdx + 1}`,
          audioText: lq.audioText || null,
          question: lq.question,
          options: lq.options || [],
          correctIndex: lq.correctIndex ?? 0,
          explanation: lq.explanation || null,
        })),
      })),
      exercises: {
        sentenceScramble: (l.exercises?.sentenceScramble || []).map((sc) => ({
          id: sc.id,
          targetHanzi: sc.targetHanzi,
          targetMeaning: sc.targetMeaning,
          pinyin: sc.pinyin || null,
          tokens: sc.tokens || [],
          unlearnedHint: sc.unlearnedHint || null,
        })),
        translationExercises: (l.exercises?.translationExercises || []).map((tr) => ({
          id: tr.id,
          direction: tr.direction,
          promptText: tr.promptText,
          chineseAudioText: tr.chineseAudioText || null,
          pinyin: tr.pinyin || null,
          expectedChinese: tr.expectedChinese || null,
          expectedMeaning: tr.expectedMeaning || null,
          acceptedPinyin: tr.acceptedPinyin || null,
          acceptedKeywords: tr.acceptedKeywords || tr.acceptableKeywords || [],
          hint: tr.hint || null,
          explanation: tr.explanation || null,
        })),
        expandedQuiz: (l.exercises?.expandedQuiz || []).map((eq) => ({
          id: eq.id,
          type: eq.type || 'vocabulary',
          question: eq.question,
          options: eq.options || [],
          correctIndex: eq.correctIndex ?? 0,
          explanation: eq.explanation || null,
        })),
      },
      comprehensiveTest: (l.comprehensiveTest || []).map((ct) => ({
        id: ct.id,
        category: ct.category || 'general',
        audioText: ct.audioText || null,
        passage: ct.passage || null,
        question: ct.question,
        options: ct.options || [],
        correctIndex: ct.correctIndex ?? 0,
        explanation: ct.explanation || null,
      })),
    }));
  }
}

export const memoryStore = new FallbackMemoryStore();
