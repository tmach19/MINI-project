/**
 * Áp dụng từ điển bộ thủ & chiết tự chuẩn (database/hanzi-radicals.mjs) vào:
 * 1) data.js (670 từ vựng + 104 câu hỏi trắc nghiệm bộ thủ trong expandedQuiz)
 * 2) Cập nhật database/seed.sql & db-migration/src/main/resources/db/migration/sql/seed_data.sql
 * 3) Sinh file changeset Liquibase UPDATE trong db-migration/src/main/resources/db/migration/05_seed_data/
 *
 * Chạy: node database/apply-radicals-fix.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  RADICALS,
  buildVocabRadicalData,
  getRadicalsInWord,
} from './hanzi-radicals.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataJsPath = path.join(rootDir, 'data.js');
const dbSeedSqlPath = path.join(__dirname, 'seed.sql');
const migrationSeedSqlPath = path.join(
  rootDir,
  'db-migration/src/main/resources/db/migration/sql/seed_data.sql'
);

function sqlStr(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlJson(val) {
  return `${sqlStr(JSON.stringify(val ?? []))}::jsonb`;
}

function loadDataJs() {
  const raw = fs.readFileSync(dataJsPath, 'utf8');
  const ctx = { globalThis: {} };
  vm.createContext(ctx);
  vm.runInContext(raw.replace('const DEFAULT_LESSONS', 'globalThis.DEFAULT_LESSONS'), ctx);
  const lessons = ctx.globalThis.DEFAULT_LESSONS;
  if (!Array.isArray(lessons)) throw new Error('Không đọc được DEFAULT_LESSONS từ data.js');
  return lessons;
}

const ALL_UNIQUE_RADICAL_VALUES = Array.from(new Set(Object.values(RADICALS)));

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const lessons = loadDataJs();
const vocabUpdates = [];
const quizUpdates = [];

lessons.forEach((lesson, lIdx) => {
  const lessonId = lesson.id || `lesson-${lIdx + 1}`;
  const vocabByHanzi = new Map();

  for (const v of lesson.vocabulary || []) {
    const updated = buildVocabRadicalData(v);
    if (updated) {
      v.radical = updated.radical;
      v.breakdown = updated.breakdown;
      v.mnemonic = updated.mnemonic;
      vocabUpdates.push({
        id: v.id,
        radical: v.radical,
        breakdown: v.breakdown,
        mnemonic: v.mnemonic,
      });
    }
    vocabByHanzi.set(v.hanzi, v);
  }

  (lesson.exercises?.expandedQuiz || []).forEach((q, qIdx) => {
    if (q.type !== 'radical') return;
    const m = String(q.question || '').match(/“([^”]+)”/);
    const targetWord = m ? m[1] : '';
    const matchedVocab = vocabByHanzi.get(targetWord);
    if (!matchedVocab || !matchedVocab.radical) return;

    const forbidden = new Set(getRadicalsInWord(matchedVocab.hanzi));
    forbidden.add(matchedVocab.radical);

    const pool = ALL_UNIQUE_RADICAL_VALUES.filter((r) => !forbidden.has(r));
    const seed = hashStr(`${lessonId}:${q.id}:${matchedVocab.hanzi}`);
    const distractors = [];
    for (let k = 0; k < 3; k++) {
      const idx = (seed + k * 37) % pool.length;
      const cand = pool[idx];
      if (!distractors.includes(cand)) {
        distractors.push(cand);
      } else {
        const fallback = pool.find((x) => !distractors.includes(x));
        if (fallback) distractors.push(fallback);
      }
    }

    const correctIdx = (seed + qIdx) % 4;
    const options = [...distractors];
    options.splice(correctIdx, 0, matchedVocab.radical);

    q.options = options;
    q.correctIndex = correctIdx;
    q.explanation = `Chữ “${matchedVocab.hanzi}” có bộ chính ${matchedVocab.radical}. Chiết tự: ${matchedVocab.breakdown}`;

    quizUpdates.push({
      id: q.id,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    });
  });
});

// 1. Ghi lại data.js
const header = `/**\r\n * Dữ liệu 26 bài học chuẩn giáo trình Tiếng Trung (HSK3 Hiệu Đính)\r\n * Phiên bản v7: Chuẩn hoá bộ thủ Kangxi, chiết tự thành phần và mẹo nhớ thực tế cho toàn bộ từ vựng\r\n */\r\n\r\n`;
const nextDataJs = `${header}const DEFAULT_LESSONS = ${JSON.stringify(lessons, null, 2)};\n`;
fs.writeFileSync(dataJsPath, nextDataJs, 'utf8');

// Kiểm tra không còn placeholder nào trong data.js
if (nextDataJs.includes('Bộ cấu tạo [') || nextDataJs.includes('Thành phần biểu ý/biểu âm')) {
  throw new Error('Vẫn còn placeholder bộ thủ trong data.js!');
}

// 2. Sinh lại database/seed.sql và đồng bộ sang db-migration
execFileSync('node', [path.join(__dirname, 'generate-seed.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});
fs.copyFileSync(dbSeedSqlPath, migrationSeedSqlPath);

// 3. Tạo Liquibase versioned changeset UPDATE trong 05_seed_data/
const migDir = path.join(rootDir, 'db-migration/src/main/resources/db/migration/05_seed_data');
const existingFix = fs
  .readdirSync(migDir)
  .find((f) => f.endsWith('_fix_vocab_radicals_and_quiz.yml'));

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const ts =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const id = existingFix
  ? existingFix.replace(/\.yml$/, '')
  : `${ts}_fix_vocab_radicals_and_quiz`;
const ymlPath = path.join(migDir, `${id}.yml`);

const sqlLines = [
  ...vocabUpdates.map(
    (u) =>
      `UPDATE vocabularies SET radical = ${sqlStr(u.radical)}, breakdown = ${sqlStr(u.breakdown)}, mnemonic = ${sqlStr(u.mnemonic)} WHERE id = ${sqlStr(u.id)};`
  ),
  ...quizUpdates.map(
    (q) =>
      `UPDATE quiz_questions SET options = ${sqlJson(q.options)}, correct_index = ${q.correctIndex}, explanation = ${sqlStr(q.explanation)} WHERE id = ${sqlStr(q.id)};`
  ),
];

const indentedSql = sqlLines.map((l) => `              ${l}`).join('\n');
const ymlContent = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: chinese-study
      comment: Cap nhat bo thu Kangxi, chiet tu va meo nho chuan cho 670 tu vung va 104 cau hoi bo thu
      changes:
        - sql:
            dbms: postgresql
            splitStatements: true
            stripComments: true
            sql: |-
${indentedSql}
      rollback:
        - sql:
            dbms: postgresql
            sql: |-
              -- Khong rollback nguoc ve du lieu bo thu placeholder loi
              SELECT 1;
`;
fs.writeFileSync(ymlPath, ymlContent, 'utf8');

console.log(
  `DONE: vocabUpdates=${vocabUpdates.length}, quizUpdates=${quizUpdates.length}, changeset=${ymlPath}`
);
