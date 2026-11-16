/**
 * Script chuyển đổi dữ liệu từ ../data.js (DEFAULT_LESSONS) sang file database/seed.sql
 * Chạy bằng: node database/generate-seed.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataJsPath = path.join(rootDir, 'data.js');
const outputSqlPath = path.join(__dirname, 'seed.sql');

function sqlStr(val) {
  if (val === null || val === undefined) return 'NULL';
  const s = String(val);
  // Dùng PostgreSQL standard escaping: nhân đôi dấu nháy đơn
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlJson(val) {
  const json = JSON.stringify(val ?? []);
  return `${sqlStr(json)}::jsonb`;
}

function sqlInt(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(fallback);
}

function sqlDate(val) {
  if (!val) return 'NULL';
  return `${sqlStr(val)}::date`;
}

function loadDefaultLessons() {
  const raw = fs.readFileSync(dataJsPath, 'utf8');
  const patched = raw.replace('const DEFAULT_LESSONS', 'globalThis.DEFAULT_LESSONS');
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(patched, context);
  if (!Array.isArray(context.globalThis.DEFAULT_LESSONS)) {
    throw new Error('Không đọc được DEFAULT_LESSONS từ data.js');
  }
  return context.globalThis.DEFAULT_LESSONS;
}

function buildSeedSql(lessons) {
  const lines = [];
  const counts = {
    lessons: 0,
    vocabularies: 0,
    grammars: 0,
    texts: 0,
    text_sentences: 0,
    sentence_scrambles: 0,
    translation_exercises: 0,
    quiz_questions: 0,
  };

  lines.push('-- ============================================================================');
  lines.push('-- Seed dữ liệu 26 bài học chuẩn HSK từ data.js');
  lines.push('-- Sinh tự động bởi database/generate-seed.mjs (an toàn khi chạy lại nhiều lần)');
  lines.push('-- ============================================================================');
  lines.push('BEGIN;');
  lines.push('');

  lessons.forEach((lesson, lessonIdx) => {
    const lessonId = lesson.id || `lesson-${lessonIdx + 1}`;
    counts.lessons++;

    lines.push(
      `INSERT INTO lessons (id, title, hsk_level, unit, description, date_added, sort_order, is_system, owner_id) VALUES (` +
        `${sqlStr(lessonId)}, ${sqlStr(lesson.title)}, ${sqlStr(lesson.hskLevel || 'HSK 1')}, ` +
        `${sqlStr(lesson.unit || null)}, ${sqlStr(lesson.description || null)}, ` +
        `${sqlDate(lesson.dateAdded)}, ${sqlInt(lessonIdx + 1)}, TRUE, NULL) ` +
        `ON CONFLICT (id) DO UPDATE SET ` +
        `title = EXCLUDED.title, hsk_level = EXCLUDED.hsk_level, unit = EXCLUDED.unit, ` +
        `description = EXCLUDED.description, date_added = EXCLUDED.date_added, ` +
        `sort_order = EXCLUDED.sort_order, is_system = TRUE, updated_at = NOW();`
    );

    // 1. Vocabularies
    (lesson.vocabulary || []).forEach((v, vIdx) => {
      counts.vocabularies++;
      lines.push(
        `INSERT INTO vocabularies (id, lesson_id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, example_pinyin, example_meaning, sort_order) VALUES (` +
          `${sqlStr(v.id)}, ${sqlStr(lessonId)}, ${sqlStr(v.hanzi)}, ${sqlStr(v.pinyin || '')}, ` +
          `${sqlStr(v.sinoVietnamese || null)}, ${sqlStr(v.meaning || '')}, ${sqlStr(v.type || null)}, ` +
          `${sqlStr(v.radical || null)}, ${sqlStr(v.breakdown || null)}, ${sqlStr(v.mnemonic || null)}, ` +
          `${sqlStr(v.example || null)}, ${sqlStr(v.examplePinyin || null)}, ${sqlStr(v.exampleMeaning || null)}, ` +
          `${sqlInt(vIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, hanzi = EXCLUDED.hanzi, pinyin = EXCLUDED.pinyin, ` +
          `sino_vietnamese = EXCLUDED.sino_vietnamese, meaning = EXCLUDED.meaning, word_type = EXCLUDED.word_type, ` +
          `radical = EXCLUDED.radical, breakdown = EXCLUDED.breakdown, mnemonic = EXCLUDED.mnemonic, ` +
          `example_hanzi = EXCLUDED.example_hanzi, example_pinyin = EXCLUDED.example_pinyin, ` +
          `example_meaning = EXCLUDED.example_meaning, sort_order = EXCLUDED.sort_order;`
      );
    });

    // 2. Grammars (chuẩn hoá structure / formula -> formula)
    (lesson.grammar || []).forEach((g, gIdx) => {
      counts.grammars++;
      const formula = g.formula ?? g.structure ?? null;
      lines.push(
        `INSERT INTO grammars (id, lesson_id, title, formula, explanation, notes, examples, sort_order) VALUES (` +
          `${sqlStr(g.id)}, ${sqlStr(lessonId)}, ${sqlStr(g.title)}, ${sqlStr(formula)}, ` +
          `${sqlStr(g.explanation || null)}, ${sqlStr(g.notes || null)}, ` +
          `${sqlJson(g.examples || [])}, ${sqlInt(gIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, title = EXCLUDED.title, formula = EXCLUDED.formula, ` +
          `explanation = EXCLUDED.explanation, notes = EXCLUDED.notes, examples = EXCLUDED.examples, ` +
          `sort_order = EXCLUDED.sort_order;`
      );
    });

    // 3. Texts, Sentences & Listening Questions
    (lesson.texts || []).forEach((t, tIdx) => {
      const textId = t.id || `txt_${lessonIdx + 1}_${tIdx + 1}`;
      counts.texts++;
      lines.push(
        `INSERT INTO texts (id, lesson_id, title, description, sort_order) VALUES (` +
          `${sqlStr(textId)}, ${sqlStr(lessonId)}, ${sqlStr(t.title)}, ${sqlStr(t.description || null)}, ${sqlInt(tIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, title = EXCLUDED.title, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;`
      );

      (t.sentences || []).forEach((s, sIdx) => {
        const sentId = `ts_${lessonIdx + 1}_${tIdx + 1}_${sIdx + 1}`;
        counts.text_sentences++;
        lines.push(
          `INSERT INTO text_sentences (id, text_id, speaker, hanzi, display_hanzi, pinyin, meaning, sort_order) VALUES (` +
            `${sqlStr(sentId)}, ${sqlStr(textId)}, ${sqlStr(s.speaker || null)}, ${sqlStr(s.hanzi)}, ` +
            `${sqlStr(s.displayHanzi || null)}, ${sqlStr(s.pinyin || null)}, ${sqlStr(s.meaning || null)}, ${sqlInt(sIdx + 1)}) ` +
            `ON CONFLICT (id) DO UPDATE SET ` +
            `text_id = EXCLUDED.text_id, speaker = EXCLUDED.speaker, hanzi = EXCLUDED.hanzi, ` +
            `display_hanzi = EXCLUDED.display_hanzi, pinyin = EXCLUDED.pinyin, meaning = EXCLUDED.meaning, sort_order = EXCLUDED.sort_order;`
        );
      });

      (t.listeningQuestions || []).forEach((lq, qIdx) => {
        const qId = `lq_${lessonIdx + 1}_${tIdx + 1}_${qIdx + 1}`;
        counts.quiz_questions++;
        lines.push(
          `INSERT INTO quiz_questions (id, lesson_id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order) VALUES (` +
            `${sqlStr(qId)}, ${sqlStr(lessonId)}, ${sqlStr(textId)}, 'listening', 'listening', ` +
            `${sqlStr(lq.audioText || null)}, NULL, ${sqlStr(lq.question)}, ${sqlJson(lq.options || [])}, ` +
            `${sqlInt(lq.correctIndex, 0)}, ${sqlStr(lq.explanation || null)}, ${sqlInt(qIdx + 1)}) ` +
            `ON CONFLICT (id) DO UPDATE SET ` +
            `lesson_id = EXCLUDED.lesson_id, text_id = EXCLUDED.text_id, audio_text = EXCLUDED.audio_text, ` +
            `question = EXCLUDED.question, options = EXCLUDED.options, correct_index = EXCLUDED.correct_index, ` +
            `explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order;`
        );
      });
    });

    // 4. Sentence Scrambles
    const ex = lesson.exercises || {};
    (ex.sentenceScramble || []).forEach((sc, scIdx) => {
      counts.sentence_scrambles++;
      lines.push(
        `INSERT INTO sentence_scrambles (id, lesson_id, target_hanzi, target_meaning, pinyin, tokens, unlearned_hint, sort_order) VALUES (` +
          `${sqlStr(sc.id)}, ${sqlStr(lessonId)}, ${sqlStr(sc.targetHanzi)}, ${sqlStr(sc.targetMeaning)}, ` +
          `${sqlStr(sc.pinyin || null)}, ${sqlJson(sc.tokens || [])}, ${sqlStr(sc.unlearnedHint || null)}, ${sqlInt(scIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, target_hanzi = EXCLUDED.target_hanzi, target_meaning = EXCLUDED.target_meaning, ` +
          `pinyin = EXCLUDED.pinyin, tokens = EXCLUDED.tokens, unlearned_hint = EXCLUDED.unlearned_hint, sort_order = EXCLUDED.sort_order;`
      );
    });

    // 5. Translation Exercises
    (ex.translationExercises || []).forEach((tr, trIdx) => {
      counts.translation_exercises++;
      const keywords = tr.acceptedKeywords || tr.acceptableKeywords || [];
      lines.push(
        `INSERT INTO translation_exercises (id, lesson_id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation, sort_order) VALUES (` +
          `${sqlStr(tr.id)}, ${sqlStr(lessonId)}, ${sqlStr(tr.direction)}, ${sqlStr(tr.promptText)}, ` +
          `${sqlStr(tr.chineseAudioText || null)}, ${sqlStr(tr.pinyin || null)}, ${sqlStr(tr.expectedChinese || null)}, ` +
          `${sqlStr(tr.expectedMeaning || null)}, ${sqlStr(tr.acceptedPinyin || null)}, ${sqlJson(keywords)}, ` +
          `${sqlStr(tr.hint || null)}, ${sqlStr(tr.explanation || null)}, ${sqlInt(trIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, direction = EXCLUDED.direction, prompt_text = EXCLUDED.prompt_text, ` +
          `audio_text = EXCLUDED.audio_text, pinyin = EXCLUDED.pinyin, expected_chinese = EXCLUDED.expected_chinese, ` +
          `expected_meaning = EXCLUDED.expected_meaning, accepted_pinyin = EXCLUDED.accepted_pinyin, ` +
          `accepted_keywords = EXCLUDED.accepted_keywords, hint = EXCLUDED.hint, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order;`
      );
    });

    // 6. Expanded Quiz
    (ex.expandedQuiz || []).forEach((eq, eqIdx) => {
      counts.quiz_questions++;
      lines.push(
        `INSERT INTO quiz_questions (id, lesson_id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order) VALUES (` +
          `${sqlStr(eq.id)}, ${sqlStr(lessonId)}, NULL, 'expanded_quiz', ${sqlStr(eq.type || 'vocabulary')}, ` +
          `NULL, NULL, ${sqlStr(eq.question)}, ${sqlJson(eq.options || [])}, ` +
          `${sqlInt(eq.correctIndex, 0)}, ${sqlStr(eq.explanation || null)}, ${sqlInt(eqIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, category = EXCLUDED.category, question = EXCLUDED.question, ` +
          `options = EXCLUDED.options, correct_index = EXCLUDED.correct_index, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order;`
      );
    });

    // 7. Comprehensive Test
    (lesson.comprehensiveTest || []).forEach((ct, ctIdx) => {
      counts.quiz_questions++;
      lines.push(
        `INSERT INTO quiz_questions (id, lesson_id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order) VALUES (` +
          `${sqlStr(ct.id)}, ${sqlStr(lessonId)}, NULL, 'comprehensive_test', ${sqlStr(ct.category || 'general')}, ` +
          `${sqlStr(ct.audioText || null)}, ${sqlStr(ct.passage || null)}, ${sqlStr(ct.question)}, ${sqlJson(ct.options || [])}, ` +
          `${sqlInt(ct.correctIndex, 0)}, ${sqlStr(ct.explanation || null)}, ${sqlInt(ctIdx + 1)}) ` +
          `ON CONFLICT (id) DO UPDATE SET ` +
          `lesson_id = EXCLUDED.lesson_id, category = EXCLUDED.category, audio_text = EXCLUDED.audio_text, ` +
          `passage = EXCLUDED.passage, question = EXCLUDED.question, options = EXCLUDED.options, ` +
          `correct_index = EXCLUDED.correct_index, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order;`
      );
    });

    lines.push('');
  });

  lines.push('COMMIT;');
  lines.push('');
  return { sql: lines.join('\n'), counts };
}

const lessons = loadDefaultLessons();
const { sql, counts } = buildSeedSql(lessons);
fs.writeFileSync(outputSqlPath, sql, 'utf8');
console.log('Generated:', outputSqlPath);
console.log('Row counts:', counts);
