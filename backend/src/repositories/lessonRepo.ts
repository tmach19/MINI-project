import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDbMode, getPool } from '../db/pool.js';
import { memoryStore } from '../db/fallbackStore.js';
import { enrichVocabularyRadicals } from '../utils/hanziRadicals.js';
import type {
  ComprehensiveQuestion,
  ExpandedQuizQuestion,
  GrammarItem,
  LessonDetail,
  LessonSummary,
  ScrambleExercise,
  TextItem,
  TranslationExercise,
  VocabularyItem,
} from '../types/domain.js';

export interface CreateLessonInput {
  title: string;
  hskLevel: string;
  unit?: string;
  description?: string;
  vocabulary: Array<Partial<VocabularyItem> & { hanzi: string; meaning: string }>;
  grammar: Array<Partial<GrammarItem> & { title: string }>;
}

const FALLBACK_MEANING_POOL = [
  'Trường học',
  'Giáo viên',
  'Bạn học',
  'Sinh viên',
  'Xin chào',
  'Cảm ơn',
  'Tạm biệt',
  'Buổi sáng',
];

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Sinh bài tập & đề kiểm tra tự động với đáp án nhiễu thật (khắc phục bug "Khác 1/2/3").
 */
function buildAutoExercises(
  lessonId: string,
  vocabList: VocabularyItem[],
  poolSource: VocabularyItem[] = vocabList
): {
  exercises: LessonDetail['exercises'];
  comprehensiveTest: ComprehensiveQuestion[];
} {
  const ts = Date.now();
  const meaningPool = Array.from(
    new Set([...poolSource.map((v) => v.meaning), ...vocabList.map((v) => v.meaning), ...FALLBACK_MEANING_POOL])
  );
  const hanziPool = Array.from(
    new Set([...poolSource.map((v) => v.hanzi), ...vocabList.map((v) => v.hanzi), '学校', '老师', '同学', '你好'])
  );
  const pinyinPool = Array.from(
    new Set([...poolSource.map((v) => v.pinyin), ...vocabList.map((v) => v.pinyin), 'nǐ hǎo', 'lǎoshī', 'xuéxiào'])
  );

  const sentenceScramble: ScrambleExercise[] = vocabList
    .filter((v) => v.hanzi.length >= 2)
    .slice(0, 6)
    .map((v, i) => ({
      id: `ss_${lessonId}_${ts}_${i}`,
      targetHanzi: v.hanzi,
      targetMeaning: v.meaning,
      pinyin: v.pinyin,
      tokens: shuffleArray(v.hanzi.split('')),
    }));

  const translationExercises: TranslationExercise[] = vocabList.flatMap((v, i) => [
    {
      id: `tr_vi_${lessonId}_${ts}_${i}`,
      direction: 'vi_to_zh',
      promptText: v.meaning,
      expectedChinese: v.hanzi,
      acceptedPinyin: v.pinyin,
      hint: `Gợi ý Pinyin: ${v.pinyin}`,
      explanation: `${v.meaning} → ${v.hanzi} (${v.pinyin})`,
    },
    {
      id: `tr_zh_${lessonId}_${ts}_${i}`,
      direction: 'zh_to_vi',
      promptText: v.hanzi,
      chineseAudioText: v.hanzi,
      pinyin: v.pinyin,
      expectedMeaning: v.meaning,
      acceptedKeywords: v.meaning
        .toLowerCase()
        .split(/[\s,;()]+/)
        .filter((w) => w.length >= 2),
      hint: `Pinyin: ${v.pinyin}`,
      explanation: `${v.hanzi} (${v.pinyin}) nghĩa là: ${v.meaning}`,
    },
  ]);

  const expandedQuiz: ExpandedQuizQuestion[] = vocabList.map((v, i) => {
    const distractors = shuffleArray(meaningPool.filter((m) => m !== v.meaning)).slice(0, 3);
    const options = shuffleArray([v.meaning, ...distractors]);
    return {
      id: `eq_${lessonId}_${ts}_${i}`,
      type: 'vocabulary',
      question: `Từ Hán tự “${v.hanzi}” (${v.pinyin}) có nghĩa là gì?`,
      options,
      correctIndex: options.indexOf(v.meaning),
      explanation: `“${v.hanzi}” (${v.pinyin}) nghĩa là: ${v.meaning}`,
    };
  });

  const comprehensiveTest: ComprehensiveQuestion[] = vocabList.flatMap((v, i) => {
    const distractorsMeaning = shuffleArray(meaningPool.filter((m) => m !== v.meaning)).slice(0, 3);
    const optMeaning = shuffleArray([v.meaning, ...distractorsMeaning]);

    const distractorsHanzi = shuffleArray(hanziPool.filter((h) => h !== v.hanzi)).slice(0, 3);
    const optHanzi = shuffleArray([v.hanzi, ...distractorsHanzi]);

    const distractorsPinyin = shuffleArray(pinyinPool.filter((p) => p !== v.pinyin)).slice(0, 3);
    const optPinyin = shuffleArray([v.pinyin, ...distractorsPinyin]);

    const items: ComprehensiveQuestion[] = [
      {
        id: `ct_ls_${lessonId}_${ts}_${i}`,
        category: 'listening',
        audioText: v.example?.trim() || v.hanzi,
        question: v.example?.trim()
          ? 'Nghe câu ví dụ và chọn nghĩa phù hợp với từ trọng tâm trong câu:'
          : 'Nghe phát âm và chọn nghĩa tiếng Việt đúng:',
        options: optMeaning,
        correctIndex: optMeaning.indexOf(v.meaning),
        explanation: `${v.hanzi} (${v.pinyin}) → ${v.meaning}`,
      },
      {
        id: `ct_vb_${lessonId}_${ts}_${i}`,
        category: 'vocab',
        question: `Từ Hán tự “${v.hanzi}” (${v.meaning}) có phiên âm Pinyin đúng là gì?`,
        options: optPinyin,
        correctIndex: optPinyin.indexOf(v.pinyin),
        explanation: `${v.hanzi} đọc là “${v.pinyin}”, nghĩa là: ${v.meaning}.`,
      },
      {
        id: `ct_vi_${lessonId}_${ts}_${i}`,
        category: 'translate_vi_zh',
        question: `Chọn chữ Hán đúng cho nghĩa: “${v.meaning}”`,
        options: optHanzi,
        correctIndex: optHanzi.indexOf(v.hanzi),
        explanation: `${v.meaning} → ${v.hanzi} (${v.pinyin})`,
      },
    ];

    if (v.example && v.example.includes(v.hanzi)) {
      const masked = v.example.replace(v.hanzi, '____');
      items.push({
        id: `ct_fb_${lessonId}_${ts}_${i}`,
        category: 'fill_blank',
        question: `Chọn từ thích hợp điền vào chỗ trống:\n“${masked}”\n(Gợi ý: ${v.meaning})`,
        options: optHanzi,
        correctIndex: optHanzi.indexOf(v.hanzi),
        explanation: `Từ cần điền là “${v.hanzi}” (${v.pinyin}). Câu đầy đủ: ${v.example}`,
      });
    } else {
      items.push({
        id: `ct_zh_${lessonId}_${ts}_${i}`,
        category: 'translate_zh_vi',
        question: `Chọn nghĩa đúng cho từ/câu: “${v.hanzi}”`,
        options: optMeaning,
        correctIndex: optMeaning.indexOf(v.meaning),
        explanation: `${v.hanzi} (${v.pinyin}) → ${v.meaning}`,
      });
    }

    return items;
  });

  return {
    exercises: { sentenceScramble, translationExercises, expandedQuiz },
    comprehensiveTest,
  };
}

export async function listLessons(userId?: string): Promise<LessonSummary[]> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return memoryStore.lessons
      .filter((l) => l.isDeleted !== 1 && (l.isSystem || (userId && l.ownerId === userId)))
      .map((l) => ({
        id: l.id,
        title: l.title,
        hskLevel: l.hskLevel,
        unit: l.unit || null,
        description: l.description || null,
        dateAdded: l.dateAdded || null,
        isSystem: l.isSystem,
        ownerId: l.ownerId || null,
        vocabCount: l.vocabulary.length,
        grammarCount: l.grammar.length,
        textCount: l.texts.length,
        testCount: l.comprehensiveTest.length,
      }));
  }

  const pool = getPool()!;
  const res = await pool.query<{
    id: string;
    title: string;
    hsk_level: string;
    unit: string | null;
    description: string | null;
    date_added: string | null;
    is_system: boolean;
    owner_id: string | null;
    vocab_count: string;
    grammar_count: string;
    text_count: string;
    test_count: string;
  }>(
    `SELECT
       l.id,
       l.title,
       l.hsk_level,
       l.unit,
       l.description,
       l.date_added::text,
       l.is_system,
       l.owner_id,
       (SELECT COUNT(*) FROM vocabularies v WHERE v.lesson_id = l.id AND v.is_deleted = 0) AS vocab_count,
       (SELECT COUNT(*) FROM grammars g WHERE g.lesson_id = l.id AND g.is_deleted = 0) AS grammar_count,
       (SELECT COUNT(*) FROM texts t WHERE t.lesson_id = l.id AND t.is_deleted = 0) AS text_count,
       (SELECT COUNT(*) FROM quiz_questions q WHERE q.lesson_id = l.id AND q.scope = 'comprehensive_test' AND q.is_deleted = 0) AS test_count
     FROM lessons l
     WHERE l.is_deleted = 0
       AND (l.is_system = TRUE OR ($1::uuid IS NOT NULL AND l.owner_id = $1::uuid))
     ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC`,
    [userId || null]
  );

  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    hskLevel: r.hsk_level,
    unit: r.unit,
    description: r.description,
    dateAdded: r.date_added,
    isSystem: r.is_system,
    ownerId: r.owner_id,
    vocabCount: Number(r.vocab_count),
    grammarCount: Number(r.grammar_count),
    textCount: Number(r.text_count),
    testCount: Number(r.test_count),
  }));
}

export async function getLessonById(lessonId: string, userId?: string): Promise<LessonDetail | null> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const found = memoryStore.lessons.find((l) => l.id === lessonId && l.isDeleted !== 1);
    if (!found) return null;
    if (!found.isSystem && found.ownerId !== userId) return null;
    return found;
  }

  const pool = getPool()!;
  const lessonRes = await pool.query<{
    id: string;
    title: string;
    hsk_level: string;
    unit: string | null;
    description: string | null;
    date_added: string | null;
    is_system: boolean;
    owner_id: string | null;
  }>(
    `SELECT id, title, hsk_level, unit, description, date_added::text, is_system, owner_id
     FROM lessons
     WHERE id = $1
       AND is_deleted = 0
       AND (is_system = TRUE OR ($2::uuid IS NOT NULL AND owner_id = $2::uuid))`,
    [lessonId, userId || null]
  );

  const l = lessonRes.rows[0];
  if (!l) return null;

  const [vocabRes, grammarRes, textsRes, sentencesRes, scramblesRes, transRes, quizRes] =
    await Promise.all([
      pool.query(
        `SELECT id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, example_pinyin, example_meaning
         FROM vocabularies WHERE lesson_id = $1 AND is_deleted = 0 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, title, formula, explanation, notes, examples
         FROM grammars WHERE lesson_id = $1 AND is_deleted = 0 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, title, description FROM texts WHERE lesson_id = $1 AND is_deleted = 0 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT ts.id, ts.text_id, ts.speaker, ts.hanzi, ts.display_hanzi, ts.pinyin, ts.meaning
         FROM text_sentences ts
         JOIN texts t ON t.id = ts.text_id
         WHERE t.lesson_id = $1 AND t.is_deleted = 0 AND ts.is_deleted = 0
         ORDER BY t.sort_order ASC, ts.sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, target_hanzi, target_meaning, pinyin, tokens, unlearned_hint
         FROM sentence_scrambles WHERE lesson_id = $1 AND is_deleted = 0 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation
         FROM translation_exercises WHERE lesson_id = $1 AND is_deleted = 0 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation
         FROM quiz_questions WHERE lesson_id = $1 AND is_deleted = 0 ORDER BY sort_order ASC`,
        [lessonId]
      ),
    ]);

  const texts: TextItem[] = textsRes.rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    sentences: sentencesRes.rows
      .filter((s) => s.text_id === t.id)
      .map((s) => ({
        id: s.id,
        speaker: s.speaker,
        hanzi: s.hanzi,
        displayHanzi: s.display_hanzi,
        pinyin: s.pinyin,
        meaning: s.meaning,
      })),
    listeningQuestions: quizRes.rows
      .filter((q) => q.scope === 'listening' && q.text_id === t.id)
      .map((q) => ({
        id: q.id,
        audioText: q.audio_text,
        question: q.question,
        options: q.options || [],
        correctIndex: q.correct_index,
        explanation: q.explanation,
      })),
  }));

  return {
    id: l.id,
    title: l.title,
    hskLevel: l.hsk_level,
    unit: l.unit,
    description: l.description,
    dateAdded: l.date_added,
    isSystem: l.is_system,
    ownerId: l.owner_id,
    vocabulary: vocabRes.rows.map((v) => ({
      id: v.id,
      hanzi: v.hanzi,
      pinyin: v.pinyin,
      sinoVietnamese: v.sino_vietnamese,
      meaning: v.meaning,
      type: v.word_type,
      radical: v.radical,
      breakdown: v.breakdown,
      mnemonic: v.mnemonic,
      example: v.example_hanzi,
      examplePinyin: v.example_pinyin,
      exampleMeaning: v.example_meaning,
    })),
    grammar: grammarRes.rows.map((g) => ({
      id: g.id,
      title: g.title,
      formula: g.formula || '',
      explanation: g.explanation,
      notes: g.notes,
      examples: g.examples || [],
    })),
    texts,
    exercises: {
      sentenceScramble: scramblesRes.rows.map((sc) => ({
        id: sc.id,
        targetHanzi: sc.target_hanzi,
        targetMeaning: sc.target_meaning,
        pinyin: sc.pinyin,
        tokens: sc.tokens || [],
        unlearnedHint: sc.unlearned_hint,
      })),
      translationExercises: transRes.rows.map((tr) => ({
        id: tr.id,
        direction: tr.direction,
        promptText: tr.prompt_text,
        chineseAudioText: tr.audio_text,
        pinyin: tr.pinyin,
        expectedChinese: tr.expected_chinese,
        expectedMeaning: tr.expected_meaning,
        acceptedPinyin: tr.accepted_pinyin,
        acceptedKeywords: tr.accepted_keywords || [],
        hint: tr.hint,
        explanation: tr.explanation,
      })),
      expandedQuiz: quizRes.rows
        .filter((q) => q.scope === 'expanded_quiz')
        .map((q) => ({
          id: q.id,
          type: q.category,
          question: q.question,
          options: q.options || [],
          correctIndex: q.correct_index,
          explanation: q.explanation,
        })),
    },
    comprehensiveTest: quizRes.rows
      .filter((q) => q.scope === 'comprehensive_test')
      .map((q) => ({
        id: q.id,
        category: q.category,
        audioText: q.audio_text,
        passage: q.passage,
        question: q.question,
        options: q.options || [],
        correctIndex: q.correct_index,
        explanation: q.explanation,
      })),
  };
}

function normalizeVocabularyInput(
  lessonId: string,
  items: CreateLessonInput['vocabulary'],
  suffix = ''
): VocabularyItem[] {
  return items
    .filter((v) => v.hanzi?.trim() && v.meaning?.trim())
    .map((v, idx) => {
      const hanzi = v.hanzi.trim();
      const pinyin = (v.pinyin || v.hanzi).trim();
      const meaning = v.meaning.trim();
      const enriched = enrichVocabularyRadicals({
        hanzi,
        pinyin,
        meaning,
        radical: v.radical,
        breakdown: v.breakdown,
        mnemonic: v.mnemonic,
      });

      return {
        id: v.id?.trim() || `vc_${lessonId}_${suffix}${idx + 1}`,
        hanzi,
        pinyin,
        sinoVietnamese: v.sinoVietnamese?.trim() || null,
        meaning,
        type: v.type?.trim() || 'Từ vựng',
        radical: enriched.radical,
        breakdown: enriched.breakdown,
        mnemonic: enriched.mnemonic,
        example: v.example?.trim() || null,
        examplePinyin: v.examplePinyin?.trim() || null,
        exampleMeaning: v.exampleMeaning?.trim() || null,
      };
    });
}

function normalizeGrammarInput(
  lessonId: string,
  items: CreateLessonInput['grammar'],
  suffix = ''
): GrammarItem[] {
  return items
    .filter((g) => g.title?.trim())
    .map((g, idx) => ({
      id: g.id?.trim() || `gc_${lessonId}_${suffix}${idx + 1}`,
      title: g.title.trim(),
      formula: g.formula?.trim() || '',
      explanation: g.explanation?.trim() || null,
      notes: g.notes?.trim() || null,
      examples: g.examples || [],
    }));
}

async function insertLessonChildren(
  client: PoolClient,
  lessonId: string,
  vocabulary: VocabularyItem[],
  grammar: GrammarItem[],
  exercises: ReturnType<typeof buildAutoExercises>['exercises'],
  comprehensiveTest: ReturnType<typeof buildAutoExercises>['comprehensiveTest'],
  offsets: { tr?: number; eq?: number; ct?: number } = {}
): Promise<void> {
  for (let i = 0; i < vocabulary.length; i++) {
    const v = vocabulary[i];
    await client.query(
      `INSERT INTO vocabularies (id, lesson_id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, example_pinyin, example_meaning, sort_order, is_deleted, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,NULL)
       ON CONFLICT (id) DO UPDATE SET
         hanzi = EXCLUDED.hanzi,
         pinyin = EXCLUDED.pinyin,
         sino_vietnamese = EXCLUDED.sino_vietnamese,
         meaning = EXCLUDED.meaning,
         word_type = EXCLUDED.word_type,
         radical = EXCLUDED.radical,
         breakdown = EXCLUDED.breakdown,
         mnemonic = EXCLUDED.mnemonic,
         example_hanzi = EXCLUDED.example_hanzi,
         example_pinyin = EXCLUDED.example_pinyin,
         example_meaning = EXCLUDED.example_meaning,
         sort_order = EXCLUDED.sort_order,
         is_deleted = 0,
         deleted_at = NULL`,
      [
        v.id, lessonId, v.hanzi, v.pinyin, v.sinoVietnamese, v.meaning, v.type,
        v.radical, v.breakdown, v.mnemonic, v.example, v.examplePinyin, v.exampleMeaning, i + 1,
      ]
    );
  }

  for (let i = 0; i < grammar.length; i++) {
    const g = grammar[i];
    await client.query(
      `INSERT INTO grammars (id, lesson_id, title, formula, explanation, notes, examples, sort_order, is_deleted, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,0,NULL)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         formula = EXCLUDED.formula,
         explanation = EXCLUDED.explanation,
         notes = EXCLUDED.notes,
         examples = EXCLUDED.examples,
         sort_order = EXCLUDED.sort_order,
         is_deleted = 0,
         deleted_at = NULL`,
      [g.id, lessonId, g.title, g.formula, g.explanation, g.notes, JSON.stringify(g.examples), i + 1]
    );
  }

  for (let i = 0; i < exercises.sentenceScramble.length; i++) {
    const sc = exercises.sentenceScramble[i];
    await client.query(
      `INSERT INTO sentence_scrambles (id, lesson_id, target_hanzi, target_meaning, pinyin, tokens, sort_order, is_deleted, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,0,NULL)
       ON CONFLICT (id) DO UPDATE SET
         target_hanzi = EXCLUDED.target_hanzi,
         target_meaning = EXCLUDED.target_meaning,
         pinyin = EXCLUDED.pinyin,
         tokens = EXCLUDED.tokens,
         sort_order = EXCLUDED.sort_order,
         is_deleted = 0,
         deleted_at = NULL`,
      [sc.id, lessonId, sc.targetHanzi, sc.targetMeaning, sc.pinyin, JSON.stringify(sc.tokens), i + 1]
    );
  }

  for (let i = 0; i < exercises.translationExercises.length; i++) {
    const tr = exercises.translationExercises[i];
    await client.query(
      `INSERT INTO translation_exercises (id, lesson_id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation, sort_order, is_deleted, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,0,NULL)
       ON CONFLICT (id) DO UPDATE SET
         direction = EXCLUDED.direction,
         prompt_text = EXCLUDED.prompt_text,
         audio_text = EXCLUDED.audio_text,
         pinyin = EXCLUDED.pinyin,
         expected_chinese = EXCLUDED.expected_chinese,
         expected_meaning = EXCLUDED.expected_meaning,
         accepted_pinyin = EXCLUDED.accepted_pinyin,
         accepted_keywords = EXCLUDED.accepted_keywords,
         hint = EXCLUDED.hint,
         explanation = EXCLUDED.explanation,
         sort_order = EXCLUDED.sort_order,
         is_deleted = 0,
         deleted_at = NULL`,
      [
        tr.id, lessonId, tr.direction, tr.promptText, tr.chineseAudioText, tr.pinyin,
        tr.expectedChinese, tr.expectedMeaning, tr.acceptedPinyin,
        JSON.stringify(tr.acceptedKeywords || []), tr.hint, tr.explanation, (offsets.tr ?? 0) + i + 1,
      ]
    );
  }

  for (let i = 0; i < exercises.expandedQuiz.length; i++) {
    const eq = exercises.expandedQuiz[i];
    await client.query(
      `INSERT INTO quiz_questions (id, lesson_id, scope, category, question, options, correct_index, explanation, sort_order, is_deleted, deleted_at)
       VALUES ($1,$2,'expanded_quiz',$3,$4,$5::jsonb,$6,$7,$8,0,NULL)
       ON CONFLICT (id) DO UPDATE SET
         category = EXCLUDED.category,
         question = EXCLUDED.question,
         options = EXCLUDED.options,
         correct_index = EXCLUDED.correct_index,
         explanation = EXCLUDED.explanation,
         sort_order = EXCLUDED.sort_order,
         is_deleted = 0,
         deleted_at = NULL`,
      [eq.id, lessonId, eq.type || 'vocabulary', eq.question, JSON.stringify(eq.options), eq.correctIndex, eq.explanation, (offsets.eq ?? 0) + i + 1]
    );
  }

  for (let i = 0; i < comprehensiveTest.length; i++) {
    const ct = comprehensiveTest[i];
    await client.query(
      `INSERT INTO quiz_questions (id, lesson_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order, is_deleted, deleted_at)
       VALUES ($1,$2,'comprehensive_test',$3,$4,$5,$6,$7::jsonb,$8,$9,$10,0,NULL)
       ON CONFLICT (id) DO UPDATE SET
         category = EXCLUDED.category,
         audio_text = EXCLUDED.audio_text,
         passage = EXCLUDED.passage,
         question = EXCLUDED.question,
         options = EXCLUDED.options,
         correct_index = EXCLUDED.correct_index,
         explanation = EXCLUDED.explanation,
         sort_order = EXCLUDED.sort_order,
         is_deleted = 0,
         deleted_at = NULL`,
      [
        ct.id,
        lessonId,
        ct.category || 'general',
        ct.audioText || null,
        ct.passage || null,
        ct.question,
        JSON.stringify(ct.options),
        ct.correctIndex,
        ct.explanation,
        (offsets.ct ?? 0) + i + 1,
      ]
    );
  }
}

export async function getLessonOwnership(
  lessonId: string
): Promise<{ id: string; isSystem: boolean; ownerId: string | null } | null> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const found = memoryStore.lessons.find((l) => l.id === lessonId && l.isDeleted !== 1);
    if (!found) return null;
    return { id: found.id, isSystem: found.isSystem, ownerId: found.ownerId || null };
  }

  const pool = getPool()!;
  const res = await pool.query<{ id: string; is_system: boolean; owner_id: string | null }>(
    'SELECT id, is_system, owner_id FROM lessons WHERE id = $1 AND is_deleted = 0',
    [lessonId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return { id: r.id, isSystem: r.is_system, ownerId: r.owner_id };
}

export async function createLesson(
  userId: string,
  input: CreateLessonInput,
  isSystem = false
): Promise<LessonDetail> {
  const shortId = crypto.randomUUID().slice(0, 8);
  const lessonId = isSystem ? `sys_${shortId}` : `custom_${shortId}`;
  const dateAdded = new Date().toISOString().split('T')[0];

  const vocabulary = normalizeVocabularyInput(lessonId, input.vocabulary);
  const grammar = normalizeGrammarInput(lessonId, input.grammar);
  const { exercises, comprehensiveTest } = buildAutoExercises(lessonId, vocabulary);

  const newLesson: LessonDetail = {
    id: lessonId,
    title: input.title.trim(),
    hskLevel: input.hskLevel || 'HSK 1',
    unit: input.unit?.trim() || (isSystem ? 'Bài học hệ thống' : 'Bài học tự tạo'),
    description: input.description?.trim() || null,
    dateAdded,
    isSystem,
    ownerId: isSystem ? null : userId,
    vocabulary,
    grammar,
    texts: [],
    exercises,
    comprehensiveTest,
  };

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    memoryStore.lessons.push(newLesson);
    return newLesson;
  }

  const pool = getPool()!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sortOrder = 1000;
    if (isSystem) {
      const sortRes = await client.query<{ next_sort: number }>(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort FROM lessons WHERE is_system = TRUE'
      );
      sortOrder = Number(sortRes.rows[0]?.next_sort || 1);
    }

    await client.query(
      `INSERT INTO lessons (id, title, hsk_level, unit, description, date_added, sort_order, is_system, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9::uuid)`,
      [
        lessonId,
        newLesson.title,
        newLesson.hskLevel,
        newLesson.unit,
        newLesson.description,
        dateAdded,
        sortOrder,
        isSystem,
        isSystem ? null : userId,
      ]
    );

    await insertLessonChildren(client, lessonId, vocabulary, grammar, exercises, comprehensiveTest);
    await client.query('COMMIT');
    return newLesson;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function hasCuratedTestQuestions(
  isSystem: boolean,
  questions: Array<{ id: string; category?: string | null }>
): boolean {
  if (questions.length === 0) return false;
  if (isSystem) return true;
  return questions.some((q) => {
    const cat = (q.category || '').toLowerCase();
    const isAutoId =
      q.id.startsWith('ct_zh_') ||
      q.id.startsWith('ct_vi_') ||
      q.id.startsWith('ct_ls_') ||
      q.id.startsWith('ct_vb_') ||
      q.id.startsWith('ct_fb_');
    return !isAutoId || cat === 'reading' || cat === 'grammar';
  });
}

function hasCuratedScrambleExercises(
  isSystem: boolean,
  scrambles: Array<{ id: string }>
): boolean {
  if (scrambles.length === 0) return false;
  if (isSystem) return true;
  return scrambles.some((s) => !s.id.startsWith('ss_'));
}

function hasCuratedTranslationExercises(
  isSystem: boolean,
  items: Array<{ id: string }>
): boolean {
  if (items.length === 0) return false;
  if (isSystem) return true;
  return items.some((t) => !t.id.startsWith('tr_vi_') && !t.id.startsWith('tr_zh_'));
}

function hasCuratedExpandedQuiz(
  isSystem: boolean,
  items: Array<{ id: string }>
): boolean {
  if (items.length === 0) return false;
  if (isSystem) return true;
  return items.some((q) => !q.id.startsWith('eq_'));
}

export async function updateLessonById(
  lessonId: string,
  input: CreateLessonInput,
  actorId?: string
): Promise<LessonDetail | null> {
  const suffix = `${Date.now()}_`;

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const idx = memoryStore.lessons.findIndex((l) => l.id === lessonId && l.isDeleted !== 1);
    if (idx === -1) return null;
    const existing = memoryStore.lessons[idx];

    // Giữ nguyên ID từ vựng cũ theo id hoặc hanzi để không mất lịch sử đánh dấu
    const existingByHanzi = new Map<string, string>();
    for (const oldV of existing.vocabulary) {
      if (!existingByHanzi.has(oldV.hanzi)) existingByHanzi.set(oldV.hanzi, oldV.id);
    }
    const existingHanziSet = new Set(existing.vocabulary.map((v) => v.hanzi));

    const updatedVocab = normalizeVocabularyInput(lessonId, input.vocabulary, suffix).map((v) => {
      if (v.id.startsWith(`vc_${lessonId}_${suffix}`)) {
        const matchedId = existingByHanzi.get(v.hanzi);
        if (matchedId) return { ...v, id: matchedId };
      }
      return v;
    });
    const updatedGrammar = normalizeGrammarInput(lessonId, input.grammar, suffix);
    const remainingHanziSet = new Set(updatedVocab.map((v) => v.hanzi));
    const newlyAddedVocab = updatedVocab.filter((v) => !existingHanziSet.has(v.hanzi));

    const keepScramble = hasCuratedScrambleExercises(existing.isSystem, existing.exercises.sentenceScramble);
    const keepTrans = hasCuratedTranslationExercises(existing.isSystem, existing.exercises.translationExercises);
    const keepExpanded = hasCuratedExpandedQuiz(existing.isSystem, existing.exercises.expandedQuiz);
    const keepCompTest = hasCuratedTestQuestions(existing.isSystem, existing.comprehensiveTest);

    const retainedTrans = existing.exercises.translationExercises.filter((t) => {
      if (!t.id.startsWith('tr_vi_') && !t.id.startsWith('tr_zh_')) return true;
      const hanzi = t.direction === 'vi_to_zh' ? t.expectedChinese : t.promptText;
      return hanzi ? remainingHanziSet.has(hanzi) : true;
    });
    const retainedExpanded = existing.exercises.expandedQuiz.filter((q) => {
      if (!q.id.startsWith('eq_')) return true;
      const m = q.question.match(/“([^”]+)”/);
      return m ? remainingHanziSet.has(m[1]) : true;
    });

    const fullAuto = buildAutoExercises(lessonId, updatedVocab);
    const deltaAuto =
      newlyAddedVocab.length > 0 ? buildAutoExercises(lessonId, newlyAddedVocab, updatedVocab) : null;

    memoryStore.lessons[idx] = {
      ...existing,
      title: input.title.trim(),
      hskLevel: input.hskLevel || existing.hskLevel,
      unit: input.unit?.trim() || existing.unit,
      description: input.description?.trim() || null,
      vocabulary: updatedVocab,
      grammar: updatedGrammar,
      exercises: {
        sentenceScramble: keepScramble ? existing.exercises.sentenceScramble : fullAuto.exercises.sentenceScramble,
        translationExercises: keepTrans
          ? [...retainedTrans, ...(deltaAuto?.exercises.translationExercises || [])]
          : fullAuto.exercises.translationExercises,
        expandedQuiz: keepExpanded
          ? [...retainedExpanded, ...(deltaAuto?.exercises.expandedQuiz || [])]
          : fullAuto.exercises.expandedQuiz,
      },
      comprehensiveTest: keepCompTest ? existing.comprehensiveTest : fullAuto.comprehensiveTest,
    };
    return memoryStore.lessons[idx];
  }

  const pool = getPool()!;
  const existingRes = await pool.query<{ is_system: boolean; unit: string | null }>(
    'SELECT is_system, unit FROM lessons WHERE id = $1 AND is_deleted = 0',
    [lessonId]
  );
  const existingRow = existingRes.rows[0];
  if (!existingRow) return null;

  const defaultUnit = existingRow.is_system ? existingRow.unit || 'Bài học hệ thống' : 'Bài học tự tạo';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Đọc hiện trạng từ vựng + bài tập/đề kiểm tra trước khi cập nhật
    const [curVocabRes, curScrambleRes, curTransRes, curQuizRes] = await Promise.all([
      client.query<{ id: string; hanzi: string }>(
        'SELECT id, hanzi FROM vocabularies WHERE lesson_id = $1 AND is_deleted = 0',
        [lessonId]
      ),
      client.query<{ id: string }>(
        'SELECT id FROM sentence_scrambles WHERE lesson_id = $1 AND is_deleted = 0',
        [lessonId]
      ),
      client.query<{
        id: string;
        direction: 'vi_to_zh' | 'zh_to_vi';
        prompt_text: string;
        expected_chinese: string | null;
        sort_order: number;
      }>(
        'SELECT id, direction, prompt_text, expected_chinese, sort_order FROM translation_exercises WHERE lesson_id = $1 AND is_deleted = 0',
        [lessonId]
      ),
      client.query<{ id: string; scope: string; category: string | null; question: string; sort_order: number }>(
        `SELECT id, scope, category, question, sort_order FROM quiz_questions
         WHERE lesson_id = $1 AND scope IN ('expanded_quiz', 'comprehensive_test') AND is_deleted = 0`,
        [lessonId]
      ),
    ]);

    const existingVocabByHanzi = new Map<string, string>();
    for (const r of curVocabRes.rows) {
      if (!existingVocabByHanzi.has(r.hanzi)) existingVocabByHanzi.set(r.hanzi, r.id);
    }
    const existingHanziSet = new Set(curVocabRes.rows.map((r) => r.hanzi));

    const curExpanded = curQuizRes.rows.filter((q) => q.scope === 'expanded_quiz');
    const curCompTest = curQuizRes.rows.filter((q) => q.scope === 'comprehensive_test');

    const keepScramble = hasCuratedScrambleExercises(existingRow.is_system, curScrambleRes.rows);
    const keepTrans = hasCuratedTranslationExercises(existingRow.is_system, curTransRes.rows);
    const keepExpanded = hasCuratedExpandedQuiz(existingRow.is_system, curExpanded);
    const keepCompTest = hasCuratedTestQuestions(existingRow.is_system, curCompTest);

    await client.query(
      `UPDATE lessons SET title = $1, hsk_level = $2, unit = $3, description = $4, updated_at = NOW()
       WHERE id = $5 AND is_deleted = 0`,
      [input.title.trim(), input.hskLevel || 'HSK 1', input.unit?.trim() || defaultUnit, input.description?.trim() || null, lessonId]
    );

    await client.query(
      'UPDATE vocabularies SET is_deleted = 1, deleted_at = NOW() WHERE lesson_id = $1 AND is_deleted = 0',
      [lessonId]
    );
    await client.query(
      'UPDATE grammars SET is_deleted = 1, deleted_at = NOW() WHERE lesson_id = $1 AND is_deleted = 0',
      [lessonId]
    );
    if (!keepScramble) {
      await client.query(
        'UPDATE sentence_scrambles SET is_deleted = 1, deleted_at = NOW() WHERE lesson_id = $1 AND is_deleted = 0',
        [lessonId]
      );
    }
    if (!keepTrans) {
      await client.query(
        'UPDATE translation_exercises SET is_deleted = 1, deleted_at = NOW() WHERE lesson_id = $1 AND is_deleted = 0',
        [lessonId]
      );
    }
    if (!keepExpanded) {
      await client.query(
        `UPDATE quiz_questions SET is_deleted = 1, deleted_at = NOW()
         WHERE lesson_id = $1 AND scope = 'expanded_quiz' AND is_deleted = 0`,
        [lessonId]
      );
    }
    if (!keepCompTest) {
      await client.query(
        `UPDATE quiz_questions SET is_deleted = 1, deleted_at = NOW()
         WHERE lesson_id = $1 AND scope = 'comprehensive_test' AND is_deleted = 0`,
        [lessonId]
      );
    }

    const vocabulary = normalizeVocabularyInput(lessonId, input.vocabulary, suffix).map((v) => {
      if (v.id.startsWith(`vc_${lessonId}_${suffix}`)) {
        const matchedId = existingVocabByHanzi.get(v.hanzi);
        if (matchedId) return { ...v, id: matchedId };
      }
      return v;
    });
    const grammar = normalizeGrammarInput(lessonId, input.grammar, suffix);
    const remainingHanziSet = new Set(vocabulary.map((v) => v.hanzi));
    const newlyAddedVocab = vocabulary.filter((v) => !existingHanziSet.has(v.hanzi));

    // Nếu người dùng xoá bớt từ từng thêm sau này, dọn mềm bài tập tự sinh của từ bị xoá
    if (keepTrans) {
      const staleTrIds = curTransRes.rows
        .filter((t) => {
          if (!t.id.startsWith('tr_vi_') && !t.id.startsWith('tr_zh_')) return false;
          const hanzi = t.direction === 'vi_to_zh' ? t.expected_chinese : t.prompt_text;
          return Boolean(hanzi && !remainingHanziSet.has(hanzi));
        })
        .map((t) => t.id);
      if (staleTrIds.length > 0) {
        await client.query(
          `UPDATE translation_exercises SET is_deleted = 1, deleted_at = NOW()
           WHERE lesson_id = $1 AND id = ANY($2::text[]) AND is_deleted = 0`,
          [lessonId, staleTrIds]
        );
      }
    }
    if (keepExpanded) {
      const staleEqIds = curExpanded
        .filter((q) => {
          if (!q.id.startsWith('eq_')) return false;
          const m = q.question.match(/“([^”]+)”/);
          return Boolean(m && !remainingHanziSet.has(m[1]));
        })
        .map((q) => q.id);
      if (staleEqIds.length > 0) {
        await client.query(
          `UPDATE quiz_questions SET is_deleted = 1, deleted_at = NOW()
           WHERE lesson_id = $1 AND scope = 'expanded_quiz' AND id = ANY($2::text[]) AND is_deleted = 0`,
          [lessonId, staleEqIds]
        );
      }
    }

    const fullAuto = buildAutoExercises(lessonId, vocabulary);
    const deltaAuto =
      newlyAddedVocab.length > 0 ? buildAutoExercises(lessonId, newlyAddedVocab, vocabulary) : null;

    const maxTrOrder = curTransRes.rows.reduce((m, r) => Math.max(m, Number(r.sort_order || 0)), 0);
    const maxEqOrder = curExpanded.reduce((m, r) => Math.max(m, Number(r.sort_order || 0)), 0);

    await insertLessonChildren(
      client,
      lessonId,
      vocabulary,
      grammar,
      {
        sentenceScramble: keepScramble ? [] : fullAuto.exercises.sentenceScramble,
        translationExercises: keepTrans
          ? deltaAuto?.exercises.translationExercises || []
          : fullAuto.exercises.translationExercises,
        expandedQuiz: keepExpanded
          ? deltaAuto?.exercises.expandedQuiz || []
          : fullAuto.exercises.expandedQuiz,
      },
      keepCompTest ? [] : fullAuto.comprehensiveTest,
      {
        tr: keepTrans ? maxTrOrder : 0,
        eq: keepExpanded ? maxEqOrder : 0,
        ct: 0,
      }
    );
    await client.query('COMMIT');
    return getLessonById(lessonId, actorId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteLessonById(lessonId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const target = memoryStore.lessons.find((l) => l.id === lessonId && l.isDeleted !== 1);
    if (!target) return false;
    target.isDeleted = 1;
    target.deletedAt = nowIso;
    return true;
  }

  const pool = getPool()!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE lessons
       SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    if ((res.rowCount || 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `UPDATE vocabularies SET is_deleted = 1, deleted_at = NOW()
       WHERE lesson_id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE grammars SET is_deleted = 1, deleted_at = NOW()
       WHERE lesson_id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE texts SET is_deleted = 1, deleted_at = NOW()
       WHERE lesson_id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE text_sentences ts SET is_deleted = 1, deleted_at = NOW()
       FROM texts t
       WHERE ts.text_id = t.id AND t.lesson_id = $1 AND ts.is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE sentence_scrambles SET is_deleted = 1, deleted_at = NOW()
       WHERE lesson_id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE translation_exercises SET is_deleted = 1, deleted_at = NOW()
       WHERE lesson_id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE quiz_questions SET is_deleted = 1, deleted_at = NOW()
       WHERE lesson_id = $1 AND is_deleted = 0`,
      [lessonId]
    );
    await client.query(
      `UPDATE user_marked_vocab m SET is_deleted = 1, deleted_at = NOW()
       FROM vocabularies v
       WHERE m.vocab_id = v.id AND v.lesson_id = $1 AND m.is_deleted = 0`,
      [lessonId]
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface GlobalVocabSearchHit extends VocabularyItem {
  lessonId: string;
  lessonTitle: string;
  hskLevel: string;
}

const SEARCH_FROM_CHARS =
  'áàảãạăắằẳẵặâấầẩẫậāǎéèẻẽẹêếềểễệēěíìỉĩịīǐóòỏõọôốồổỗộơớờởỡợōǒúùủũụưứừửữựūǔǖǘǚǜüýỳỷỹỵđ';
const SEARCH_TO_CHARS =
  'aaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeiiiiiiiooooooooooooooooooouuuuuuuuuuuuuuuuuuyyyyyd';

const SEARCH_CHAR_MAP: Record<string, string> = Object.fromEntries(
  Array.from(SEARCH_FROM_CHARS).map((ch, idx) => [ch, SEARCH_TO_CHARS[idx]])
);

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/./g, (ch) => SEARCH_CHAR_MAP[ch] ?? ch);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreVocabMemoryMatch(
  v: VocabularyItem,
  qRaw: string,
  qNorm: string,
  isCjk: boolean,
  hasDiacritics: boolean,
  rxRaw: RegExp | null,
  rxNorm: RegExp | null
): number {
  const hanzi = v.hanzi.toLowerCase();
  const pinyin = (v.pinyin || '').toLowerCase();
  const sino = (v.sinoVietnamese || '').toLowerCase();
  const meaning = (v.meaning || '').toLowerCase();
  const radical = (v.radical || '').toLowerCase();

  if (isCjk) {
    if (hanzi === qRaw) return 100;
    if (hanzi.startsWith(qRaw)) return 85;
    if (hanzi.includes(qRaw)) return 70;
    if (radical.includes(qRaw)) return 10;
    return 0;
  }

  if (hanzi === qRaw || pinyin === qRaw || meaning === qRaw) return 100;
  if (sino === qRaw) return 92;
  if (rxRaw && (rxRaw.test(pinyin) || rxRaw.test(sino) || rxRaw.test(meaning))) return 85;

  if (!hasDiacritics) {
    const pinyinNorm = normalizeSearchText(pinyin);
    const sinoNorm = normalizeSearchText(sino);
    const meaningNorm = normalizeSearchText(meaning);
    if (pinyinNorm === qNorm || sinoNorm === qNorm || meaningNorm === qNorm) return 65;
    if (rxNorm && (rxNorm.test(pinyinNorm) || rxNorm.test(sinoNorm) || rxNorm.test(meaningNorm))) {
      return 50;
    }
  }

  if (rxRaw && rxRaw.test(radical)) return 20;
  if (!hasDiacritics && rxNorm && rxNorm.test(normalizeSearchText(radical))) return 15;
  return 0;
}

export async function searchAllVocabulary(query: string, userId?: string): Promise<GlobalVocabSearchHit[]> {
  const qRaw = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!qRaw) return [];

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const qNorm = normalizeSearchText(qRaw);
    const isCjk = /[\u4e00-\u9fff]/.test(qRaw);
    const hasDiacritics = qRaw !== qNorm;
    const rxRaw = isCjk
      ? null
      : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(qRaw).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
    const rxNorm = isCjk
      ? null
      : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(qNorm).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');

    const ranked: Array<{ hit: GlobalVocabSearchHit; rank: number; lessonIdx: number; vocabIdx: number }> = [];
    memoryStore.lessons.forEach((l, lessonIdx) => {
      if (l.isDeleted === 1) return;
      if (!l.isSystem && l.ownerId !== userId) return;
      l.vocabulary.forEach((v, vocabIdx) => {
        const rank = scoreVocabMemoryMatch(v, qRaw, qNorm, isCjk, hasDiacritics, rxRaw, rxNorm);
        if (rank > 0) {
          ranked.push({
            hit: {
              ...v,
              lessonId: l.id,
              lessonTitle: l.title,
              hskLevel: l.hskLevel,
            },
            rank,
            lessonIdx,
            vocabIdx,
          });
        }
      });
    });

    ranked.sort(
      (a, b) => b.rank - a.rank || a.lessonIdx - b.lessonIdx || a.vocabIdx - b.vocabIdx
    );
    return ranked.slice(0, 60).map((item) => item.hit);
  }

  const pool = getPool()!;
  const res = await pool.query(
    `SELECT * FROM fn_search_vocabulary($1, $2::uuid, 60)`,
    [qRaw, userId || null]
  );

  return res.rows.map((r) => ({
    id: r.id,
    hanzi: r.hanzi,
    pinyin: r.pinyin,
    sinoVietnamese: r.sino_vietnamese,
    meaning: r.meaning,
    type: r.word_type,
    radical: r.radical,
    breakdown: r.breakdown,
    mnemonic: r.mnemonic,
    example: r.example_hanzi,
    examplePinyin: r.example_pinyin,
    exampleMeaning: r.example_meaning,
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_title,
    hskLevel: r.hsk_level,
  }));
}

const COMPREHENSIVE_QUOTAS: ReadonlyArray<{ bucket: string; count: number; order: number }> = [
  { bucket: 'l_single', count: 7, order: 1 },
  { bucket: 'l_tf', count: 6, order: 2 },
  { bucket: 'l_short', count: 6, order: 3 },
  { bucket: 'l_long', count: 6, order: 4 },
  { bucket: 'r_match', count: 3, order: 5 },
  { bucket: 'translate_zh_vi', count: 3, order: 6 },
  { bucket: 'fb_cloze', count: 3, order: 7 },
  { bucket: 'vocab', count: 4, order: 8 },
  { bucket: 'r_pass', count: 6, order: 9 },
  { bucket: 'translate_vi_zh', count: 3, order: 10 },
  { bucket: 'fb_pinyin', count: 3, order: 11 },
];

function classifySubBucket(q: ComprehensiveQuestion): string {
  const cat = q.category || 'vocab';
  if (cat === 'listening') {
    if ((q.options || []).length === 2) return 'l_tf';
    const lines = (q.audioText || '').split('\n').filter(Boolean).length;
    if (lines === 2) return 'l_short';
    if (lines >= 3 || q.question.includes('đoạn hội thoại') || q.question.includes('tình huống')) {
      return 'l_long';
    }
    return 'l_single';
  }
  if (cat === 'reading') {
    return q.passage && q.passage.trim().length > 0 ? 'r_pass' : 'r_match';
  }
  if (cat === 'fill_blank') {
    return q.question.includes('Pinyin') ? 'fb_pinyin' : 'fb_cloze';
  }
  return cat;
}

export async function getComprehensiveExamQuestions(
  totalLimit = 50,
  lessonIds?: string[],
  userId?: string
): Promise<ComprehensiveQuestion[]> {
  const cleanLessonIds =
    Array.isArray(lessonIds) && lessonIds.length > 0
      ? Array.from(new Set(lessonIds.map((id) => id.trim()).filter(Boolean)))
      : null;

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const idSet = cleanLessonIds ? new Set(cleanLessonIds) : null;
    const targetLessons = memoryStore.lessons.filter((l) => {
      if (l.isDeleted === 1) return false;
      const accessible = l.isSystem || (userId && l.ownerId === userId);
      if (!accessible) return false;
      return idSet ? idSet.has(l.id) : l.isSystem;
    });

    if (targetLessons.length === 0) return [];
    const factor = Math.max(totalLimit, 1) / 50;

    const bucketMap = new Map<string, Array<{ q: ComprehensiveQuestion; lessonOrder: number }>>();
    const allItems: Array<{ q: ComprehensiveQuestion; lessonOrder: number }> = [];

    for (const lesson of targetLessons) {
      const perCatIndex = new Map<string, number>();
      const shuffledLessonQs = shuffleArray(lesson.comprehensiveTest || []);
      for (const q of shuffledLessonQs) {
        const sub = classifySubBucket(q);
        const catKey = q.category || 'vocab';
        const rank = (perCatIndex.get(catKey) || 0) + 1;
        perCatIndex.set(catKey, rank);
        const item = {
          q: { ...q, lessonId: lesson.id, lessonTitle: lesson.title },
          lessonOrder: rank,
        };
        allItems.push(item);
        const list = bucketMap.get(sub) || [];
        list.push(item);
        bucketMap.set(sub, list);
      }
    }

    const result: ComprehensiveQuestion[] = [];
    const pickedIds = new Set<string>();
    for (const spec of COMPREHENSIVE_QUOTAS) {
      const raw = bucketMap.get(spec.bucket) || [];
      const shuffled = shuffleArray(raw).sort((a, b) => a.lessonOrder - b.lessonOrder);
      const take = Math.round(spec.count * factor);
      for (const item of shuffled.slice(0, take)) {
        if (!pickedIds.has(item.q.id)) {
          pickedIds.add(item.q.id);
          result.push(item.q);
        }
      }
    }

    if (result.length < totalLimit) {
      const remaining = shuffleArray(allItems.filter((x) => !pickedIds.has(x.q.id))).sort(
        (a, b) => a.lessonOrder - b.lessonOrder
      );
      for (const item of remaining) {
        if (result.length >= totalLimit) break;
        pickedIds.add(item.q.id);
        result.push(item.q);
      }
    }

    return result.slice(0, totalLimit);
  }

  const pool = getPool()!;
  let allowedIds: string[] | null = null;
  if (cleanLessonIds) {
    const allowedRes = await pool.query<{ id: string }>(
      `SELECT id FROM lessons
       WHERE id = ANY($1::text[])
         AND is_deleted = 0
         AND (is_system = TRUE OR ($2::uuid IS NOT NULL AND owner_id = $2::uuid))`,
      [cleanLessonIds, userId || null]
    );
    allowedIds = allowedRes.rows.map((r) => r.id);
    if (allowedIds.length === 0) return [];
  }

  type ExamRow = {
    id: string;
    lesson_id: string;
    lesson_title: string;
    category: string | null;
    audio_text: string | null;
    passage: string | null;
    question: string;
    options: string[];
    correct_index: number;
    explanation: string | null;
  };

  let rows: ExamRow[];
  try {
    const res = await pool.query<ExamRow>(
      `SELECT id, lesson_id, lesson_title, category, audio_text, passage, question, options, correct_index, explanation
       FROM fn_get_random_comprehensive_exam($1, $2::text[])`,
      [totalLimit, allowedIds]
    );
    rows = res.rows;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== '42883') throw err;
    // Fallback an toàn nếu PostgreSQL chưa chạy Liquibase cập nhật fn_get_random_comprehensive_exam 2 tham số
    const res = await pool.query<ExamRow>(
      `WITH pool AS (
         SELECT q.id, q.lesson_id, l.title AS lesson_title, q.category, q.audio_text, q.passage,
                q.question, q.options, q.correct_index, q.explanation,
                ROW_NUMBER() OVER (PARTITION BY q.lesson_id, q.category ORDER BY random()) AS rn
         FROM quiz_questions q
         JOIN lessons l ON l.id = q.lesson_id
         WHERE q.scope = 'comprehensive_test'
           AND q.is_deleted = 0
           AND l.is_deleted = 0
           AND (
             ($2::text[] IS NULL AND l.is_system = TRUE)
             OR ($2::text[] IS NOT NULL AND q.lesson_id = ANY($2::text[]))
           )
       )
       SELECT id, lesson_id, lesson_title, category, audio_text, passage, question, options, correct_index, explanation
       FROM pool
       ORDER BY rn ASC, random()
       LIMIT $1`,
      [totalLimit, allowedIds]
    );
    rows = res.rows;
  }

  return rows.slice(0, totalLimit).map((q) => ({
    id: q.id,
    lessonId: q.lesson_id,
    lessonTitle: q.lesson_title,
    category: q.category,
    audioText: q.audio_text,
    passage: q.passage,
    question: q.question,
    options: q.options || [],
    correctIndex: q.correct_index,
    explanation: q.explanation,
  }));
}
