import crypto from 'node:crypto';
import { getDbMode, getPool } from '../db/pool.js';
import { memoryStore } from '../db/fallbackStore.js';
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
  vocabList: VocabularyItem[]
): {
  exercises: LessonDetail['exercises'];
  comprehensiveTest: ComprehensiveQuestion[];
} {
  const ts = Date.now();
  const meaningPool = Array.from(
    new Set([...vocabList.map((v) => v.meaning), ...FALLBACK_MEANING_POOL])
  );
  const hanziPool = Array.from(
    new Set([...vocabList.map((v) => v.hanzi), '学校', '老师', '同学', '你好'])
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

    return [
      {
        id: `ct_zh_${lessonId}_${ts}_${i}`,
        category: 'translate_zh_vi',
        question: `Chọn nghĩa đúng cho từ/câu: “${v.hanzi}”`,
        options: optMeaning,
        correctIndex: optMeaning.indexOf(v.meaning),
        explanation: `${v.hanzi} (${v.pinyin}) → ${v.meaning}`,
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
      .filter((l) => l.isSystem || (userId && l.ownerId === userId))
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
       (SELECT COUNT(*) FROM vocabularies v WHERE v.lesson_id = l.id) AS vocab_count,
       (SELECT COUNT(*) FROM grammars g WHERE g.lesson_id = l.id) AS grammar_count,
       (SELECT COUNT(*) FROM texts t WHERE t.lesson_id = l.id) AS text_count,
       (SELECT COUNT(*) FROM quiz_questions q WHERE q.lesson_id = l.id AND q.scope = 'comprehensive_test') AS test_count
     FROM lessons l
     WHERE l.is_system = TRUE OR ($1::uuid IS NOT NULL AND l.owner_id = $1::uuid)
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
    const found = memoryStore.lessons.find((l) => l.id === lessonId);
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
     WHERE id = $1 AND (is_system = TRUE OR ($2::uuid IS NOT NULL AND owner_id = $2::uuid))`,
    [lessonId, userId || null]
  );

  const l = lessonRes.rows[0];
  if (!l) return null;

  const [vocabRes, grammarRes, textsRes, sentencesRes, scramblesRes, transRes, quizRes] =
    await Promise.all([
      pool.query(
        `SELECT id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, example_pinyin, example_meaning
         FROM vocabularies WHERE lesson_id = $1 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, title, formula, explanation, notes, examples
         FROM grammars WHERE lesson_id = $1 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, title, description FROM texts WHERE lesson_id = $1 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT ts.id, ts.text_id, ts.speaker, ts.hanzi, ts.display_hanzi, ts.pinyin, ts.meaning
         FROM text_sentences ts
         JOIN texts t ON t.id = ts.text_id
         WHERE t.lesson_id = $1
         ORDER BY t.sort_order ASC, ts.sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, target_hanzi, target_meaning, pinyin, tokens, unlearned_hint
         FROM sentence_scrambles WHERE lesson_id = $1 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation
         FROM translation_exercises WHERE lesson_id = $1 ORDER BY sort_order ASC`,
        [lessonId]
      ),
      pool.query(
        `SELECT id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation
         FROM quiz_questions WHERE lesson_id = $1 ORDER BY sort_order ASC`,
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

export async function createCustomLesson(
  userId: string,
  input: CreateLessonInput
): Promise<LessonDetail> {
  const lessonId = `custom_${crypto.randomUUID().slice(0, 8)}`;
  const dateAdded = new Date().toISOString().split('T')[0];

  const vocabulary: VocabularyItem[] = input.vocabulary
    .filter((v) => v.hanzi?.trim() && v.meaning?.trim())
    .map((v, idx) => ({
      id: `vc_${lessonId}_${idx + 1}`,
      hanzi: v.hanzi.trim(),
      pinyin: (v.pinyin || v.hanzi).trim(),
      sinoVietnamese: v.sinoVietnamese?.trim() || null,
      meaning: v.meaning.trim(),
      type: v.type?.trim() || 'Từ vựng',
      radical: v.radical?.trim() || null,
      breakdown: v.breakdown?.trim() || null,
      mnemonic: v.mnemonic?.trim() || null,
      example: v.example?.trim() || null,
      examplePinyin: v.examplePinyin?.trim() || null,
      exampleMeaning: v.exampleMeaning?.trim() || null,
    }));

  const grammar: GrammarItem[] = input.grammar
    .filter((g) => g.title?.trim())
    .map((g, idx) => ({
      id: `gc_${lessonId}_${idx + 1}`,
      title: g.title.trim(),
      formula: g.formula?.trim() || '',
      explanation: g.explanation?.trim() || null,
      notes: g.notes?.trim() || null,
      examples: g.examples || [],
    }));

  const { exercises, comprehensiveTest } = buildAutoExercises(lessonId, vocabulary);

  const newLesson: LessonDetail = {
    id: lessonId,
    title: input.title.trim(),
    hskLevel: input.hskLevel || 'HSK 1',
    unit: input.unit?.trim() || 'Bài học tự tạo',
    description: input.description?.trim() || null,
    dateAdded,
    isSystem: false,
    ownerId: userId,
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
    await client.query(
      `INSERT INTO lessons (id, title, hsk_level, unit, description, date_added, sort_order, is_system, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, 1000, FALSE, $7::uuid)`,
      [lessonId, newLesson.title, newLesson.hskLevel, newLesson.unit, newLesson.description, dateAdded, userId]
    );

    for (let i = 0; i < vocabulary.length; i++) {
      const v = vocabulary[i];
      await client.query(
        `INSERT INTO vocabularies (id, lesson_id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, example_pinyin, example_meaning, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          v.id, lessonId, v.hanzi, v.pinyin, v.sinoVietnamese, v.meaning, v.type,
          v.radical, v.breakdown, v.mnemonic, v.example, v.examplePinyin, v.exampleMeaning, i + 1,
        ]
      );
    }

    for (let i = 0; i < grammar.length; i++) {
      const g = grammar[i];
      await client.query(
        `INSERT INTO grammars (id, lesson_id, title, formula, explanation, notes, examples, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [g.id, lessonId, g.title, g.formula, g.explanation, g.notes, JSON.stringify(g.examples), i + 1]
      );
    }

    for (let i = 0; i < exercises.sentenceScramble.length; i++) {
      const sc = exercises.sentenceScramble[i];
      await client.query(
        `INSERT INTO sentence_scrambles (id, lesson_id, target_hanzi, target_meaning, pinyin, tokens, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [sc.id, lessonId, sc.targetHanzi, sc.targetMeaning, sc.pinyin, JSON.stringify(sc.tokens), i + 1]
      );
    }

    for (let i = 0; i < exercises.translationExercises.length; i++) {
      const tr = exercises.translationExercises[i];
      await client.query(
        `INSERT INTO translation_exercises (id, lesson_id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
        [
          tr.id, lessonId, tr.direction, tr.promptText, tr.chineseAudioText, tr.pinyin,
          tr.expectedChinese, tr.expectedMeaning, tr.acceptedPinyin,
          JSON.stringify(tr.acceptedKeywords || []), tr.hint, tr.explanation, i + 1,
        ]
      );
    }

    for (let i = 0; i < exercises.expandedQuiz.length; i++) {
      const eq = exercises.expandedQuiz[i];
      await client.query(
        `INSERT INTO quiz_questions (id, lesson_id, scope, category, question, options, correct_index, explanation, sort_order)
         VALUES ($1,$2,'expanded_quiz',$3,$4,$5::jsonb,$6,$7,$8)`,
        [eq.id, lessonId, eq.type || 'vocabulary', eq.question, JSON.stringify(eq.options), eq.correctIndex, eq.explanation, i + 1]
      );
    }

    for (let i = 0; i < comprehensiveTest.length; i++) {
      const ct = comprehensiveTest[i];
      await client.query(
        `INSERT INTO quiz_questions (id, lesson_id, scope, category, question, options, correct_index, explanation, sort_order)
         VALUES ($1,$2,'comprehensive_test',$3,$4,$5::jsonb,$6,$7,$8)`,
        [ct.id, lessonId, ct.category || 'general', ct.question, JSON.stringify(ct.options), ct.correctIndex, ct.explanation, i + 1]
      );
    }

    await client.query('COMMIT');
    return newLesson;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCustomLesson(
  lessonId: string,
  userId: string,
  input: CreateLessonInput
): Promise<LessonDetail | null> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const idx = memoryStore.lessons.findIndex((l) => l.id === lessonId);
    if (idx === -1) return null;
    const existing = memoryStore.lessons[idx];
    if (existing.isSystem || existing.ownerId !== userId) return null;

    const updatedVocab: VocabularyItem[] = input.vocabulary
      .filter((v) => v.hanzi?.trim() && v.meaning?.trim())
      .map((v, i) => ({
        id: v.id || `vc_${lessonId}_${Date.now()}_${i}`,
        hanzi: v.hanzi.trim(),
        pinyin: (v.pinyin || v.hanzi).trim(),
        sinoVietnamese: v.sinoVietnamese?.trim() || null,
        meaning: v.meaning.trim(),
        type: v.type?.trim() || 'Từ vựng',
        radical: v.radical?.trim() || null,
        breakdown: v.breakdown?.trim() || null,
        mnemonic: v.mnemonic?.trim() || null,
        example: v.example?.trim() || null,
      }));
    const updatedGrammar: GrammarItem[] = input.grammar
      .filter((g) => g.title?.trim())
      .map((g, i) => ({
        id: g.id || `gc_${lessonId}_${Date.now()}_${i}`,
        title: g.title.trim(),
        formula: g.formula?.trim() || '',
        explanation: g.explanation?.trim() || null,
        examples: g.examples || [],
      }));

    const { exercises, comprehensiveTest } = buildAutoExercises(lessonId, updatedVocab);
    memoryStore.lessons[idx] = {
      ...existing,
      title: input.title.trim(),
      hskLevel: input.hskLevel || existing.hskLevel,
      unit: input.unit?.trim() || existing.unit,
      description: input.description?.trim() || null,
      vocabulary: updatedVocab,
      grammar: updatedGrammar,
      exercises,
      comprehensiveTest,
    };
    return memoryStore.lessons[idx];
  }

  const pool = getPool()!;
  const check = await pool.query<{ is_system: boolean; owner_id: string | null }>(
    'SELECT is_system, owner_id FROM lessons WHERE id = $1',
    [lessonId]
  );
  const row = check.rows[0];
  if (!row || row.is_system || row.owner_id !== userId) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE lessons SET title = $1, hsk_level = $2, unit = $3, description = $4, updated_at = NOW()
       WHERE id = $5`,
      [input.title.trim(), input.hskLevel || 'HSK 1', input.unit?.trim() || 'Bài học tự tạo', input.description?.trim() || null, lessonId]
    );

    await client.query('DELETE FROM vocabularies WHERE lesson_id = $1', [lessonId]);
    await client.query('DELETE FROM grammars WHERE lesson_id = $1', [lessonId]);
    await client.query('DELETE FROM sentence_scrambles WHERE lesson_id = $1', [lessonId]);
    await client.query('DELETE FROM translation_exercises WHERE lesson_id = $1', [lessonId]);
    await client.query(`DELETE FROM quiz_questions WHERE lesson_id = $1 AND scope IN ('expanded_quiz', 'comprehensive_test')`, [lessonId]);

    const vocabulary: VocabularyItem[] = input.vocabulary
      .filter((v) => v.hanzi?.trim() && v.meaning?.trim())
      .map((v, idx) => ({
        id: `vc_${lessonId}_${Date.now()}_${idx + 1}`,
        hanzi: v.hanzi.trim(),
        pinyin: (v.pinyin || v.hanzi).trim(),
        sinoVietnamese: v.sinoVietnamese?.trim() || null,
        meaning: v.meaning.trim(),
        type: v.type?.trim() || 'Từ vựng',
        radical: v.radical?.trim() || null,
        breakdown: v.breakdown?.trim() || null,
        mnemonic: v.mnemonic?.trim() || null,
        example: v.example?.trim() || null,
      }));

    for (let i = 0; i < vocabulary.length; i++) {
      const v = vocabulary[i];
      await client.query(
        `INSERT INTO vocabularies (id, lesson_id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [v.id, lessonId, v.hanzi, v.pinyin, v.sinoVietnamese, v.meaning, v.type, v.radical, v.breakdown, v.mnemonic, v.example, i + 1]
      );
    }

    const grammar = input.grammar.filter((g) => g.title?.trim());
    for (let i = 0; i < grammar.length; i++) {
      const g = grammar[i];
      await client.query(
        `INSERT INTO grammars (id, lesson_id, title, formula, explanation, examples, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [`gc_${lessonId}_${Date.now()}_${i + 1}`, lessonId, g.title.trim(), g.formula?.trim() || '', g.explanation?.trim() || null, JSON.stringify(g.examples || []), i + 1]
      );
    }

    const { exercises, comprehensiveTest } = buildAutoExercises(lessonId, vocabulary);
    for (let i = 0; i < exercises.sentenceScramble.length; i++) {
      const sc = exercises.sentenceScramble[i];
      await client.query(
        `INSERT INTO sentence_scrambles (id, lesson_id, target_hanzi, target_meaning, pinyin, tokens, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [sc.id, lessonId, sc.targetHanzi, sc.targetMeaning, sc.pinyin, JSON.stringify(sc.tokens), i + 1]
      );
    }
    for (let i = 0; i < exercises.translationExercises.length; i++) {
      const tr = exercises.translationExercises[i];
      await client.query(
        `INSERT INTO translation_exercises (id, lesson_id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
        [tr.id, lessonId, tr.direction, tr.promptText, tr.chineseAudioText, tr.pinyin, tr.expectedChinese, tr.expectedMeaning, tr.acceptedPinyin, JSON.stringify(tr.acceptedKeywords || []), tr.hint, tr.explanation, i + 1]
      );
    }
    for (let i = 0; i < exercises.expandedQuiz.length; i++) {
      const eq = exercises.expandedQuiz[i];
      await client.query(
        `INSERT INTO quiz_questions (id, lesson_id, scope, category, question, options, correct_index, explanation, sort_order)
         VALUES ($1,$2,'expanded_quiz',$3,$4,$5::jsonb,$6,$7,$8)`,
        [eq.id, lessonId, eq.type || 'vocabulary', eq.question, JSON.stringify(eq.options), eq.correctIndex, eq.explanation, i + 1]
      );
    }
    for (let i = 0; i < comprehensiveTest.length; i++) {
      const ct = comprehensiveTest[i];
      await client.query(
        `INSERT INTO quiz_questions (id, lesson_id, scope, category, question, options, correct_index, explanation, sort_order)
         VALUES ($1,$2,'comprehensive_test',$3,$4,$5::jsonb,$6,$7,$8)`,
        [ct.id, lessonId, ct.category || 'general', ct.question, JSON.stringify(ct.options), ct.correctIndex, ct.explanation, i + 1]
      );
    }

    await client.query('COMMIT');
    return getLessonById(lessonId, userId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCustomLesson(lessonId: string, userId: string): Promise<boolean> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const idx = memoryStore.lessons.findIndex((l) => l.id === lessonId);
    if (idx === -1) return false;
    const target = memoryStore.lessons[idx];
    if (target.isSystem || target.ownerId !== userId) return false;
    memoryStore.lessons.splice(idx, 1);
    return true;
  }

  const pool = getPool()!;
  const res = await pool.query(
    `DELETE FROM lessons WHERE id = $1 AND is_system = FALSE AND owner_id = $2::uuid`,
    [lessonId, userId]
  );
  return (res.rowCount || 0) > 0;
}

export interface GlobalVocabSearchHit extends VocabularyItem {
  lessonId: string;
  lessonTitle: string;
  hskLevel: string;
}

export async function searchAllVocabulary(query: string, userId?: string): Promise<GlobalVocabSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const hits: GlobalVocabSearchHit[] = [];
    for (const l of memoryStore.lessons) {
      if (!l.isSystem && l.ownerId !== userId) continue;
      for (const v of l.vocabulary) {
        const hay = [v.hanzi, v.pinyin, v.meaning, v.sinoVietnamese, v.radical]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            ...v,
            lessonId: l.id,
            lessonTitle: l.title,
            hskLevel: l.hskLevel,
          });
        }
        if (hits.length >= 60) return hits;
      }
    }
    return hits;
  }

  const pool = getPool()!;
  const like = `%${q}%`;
  const res = await pool.query(
    `SELECT
       v.id, v.hanzi, v.pinyin, v.sino_vietnamese, v.meaning, v.word_type,
       v.radical, v.breakdown, v.mnemonic, v.example_hanzi, v.example_pinyin, v.example_meaning,
       l.id AS lesson_id, l.title AS lesson_title, l.hsk_level
     FROM vocabularies v
     JOIN lessons l ON l.id = v.lesson_id
     WHERE (l.is_system = TRUE OR ($2::uuid IS NOT NULL AND l.owner_id = $2::uuid))
       AND (
         LOWER(v.hanzi) LIKE $1 OR
         LOWER(v.pinyin) LIKE $1 OR
         LOWER(v.meaning) LIKE $1 OR
         LOWER(COALESCE(v.sino_vietnamese, '')) LIKE $1 OR
         LOWER(COALESCE(v.radical, '')) LIKE $1
       )
     ORDER BY l.sort_order ASC, v.sort_order ASC
     LIMIT 60`,
    [like, userId || null]
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
