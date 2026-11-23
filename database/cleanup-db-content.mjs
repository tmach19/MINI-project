/**
 * Script dọn dẹp dữ liệu hệ thống trong data.js và sinh câu UPDATE cho Liquibase:
 * 1) Xoá chú thích ngoặc inline `(pinyin: nghĩa)` bị chèn thừa trong displayHanzi, listening options, expandedQuiz...
 * 2) Xoá tiền tố `[Mở rộng]`, `[Đọc hiểu mở rộng]`, `[Nghe hiểu tình huống mới]`, `[Ôn tập Bài N]`, `[Bài N]`.
 * 3) Xoá `unlearnedHint` và phần `| Từ chưa học: ...` bị gắn nhầm từ script sinh đề cũ.
 *
 * Cách chạy:
 *   node database/cleanup-db-content.mjs [path-to-liquibase-yml]
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataJsPath = path.join(rootDir, 'data.js');

const PINYIN_PREFIX_RE =
  /^[A-Za-zĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s'’\-/]+$/;

const BRACKET_PREFIX_RE =
  /^(\[(?:Mở rộng|Đọc hiểu mở rộng|Nghe hiểu tình huống mới|Ôn tập Bài\s*\d+|Bài\s*\d+)\]\s*)+/gi;

function stripInlineGlosses(str) {
  if (typeof str !== 'string') return str;
  let out = '';
  let removedAny = false;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (/[\u4e00-\u9fff]/.test(ch)) {
      out += ch;
      i++;
      let j = i;
      while (j < str.length && str[j] === ' ') j++;
      if (str[j] === '(') {
        let depth = 0;
        let k = j;
        for (; k < str.length; k++) {
          if (str[k] === '(') depth++;
          else if (str[k] === ')') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (depth === 0 && k < str.length) {
          const inner = str.slice(j + 1, k);
          const colonIdx = inner.indexOf(':');
          if (colonIdx > 0) {
            const beforeColon = inner.slice(0, colonIdx).trim();
            if (
              beforeColon.length <= 45 &&
              !/^(Nghĩa|Ví dụ|Gợi ý|Chú ý|Lưu ý)$/i.test(beforeColon) &&
              PINYIN_PREFIX_RE.test(beforeColon)
            ) {
              removedAny = true;
              i = k + 1;
              continue;
            }
          }
        }
      }
    } else {
      out += ch;
      i++;
    }
  }
  if (!removedAny) return str;
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .trim();
}

function stripBracketPrefix(str) {
  if (typeof str !== 'string') return str;
  return str.replace(BRACKET_PREFIX_RE, '').trim();
}

function stripUnlearnedFromHint(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\s*\|\s*Từ chưa học:.*$/i, '').trim();
}

function sqlStr(val) {
  if (val === null || val === undefined) return 'NULL';
  const s = String(val);
  if (s.includes('\n') || s.includes('\r')) {
    return `E'${s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''")
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n')}'`;
  }
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlJson(val) {
  return `${sqlStr(JSON.stringify(val ?? []))}::jsonb`;
}

const rawContent = fs.readFileSync(dataJsPath, 'utf8');
const declIdx = rawContent.indexOf('const DEFAULT_LESSONS');
if (declIdx === -1) {
  throw new Error('Không tìm thấy const DEFAULT_LESSONS trong data.js');
}
const header = rawContent.slice(0, declIdx);

const ctx = { window: {} };
vm.runInNewContext(rawContent + '\nwindow.DEFAULT_LESSONS = DEFAULT_LESSONS;', ctx);
const lessons = ctx.window.DEFAULT_LESSONS;

if (!Array.isArray(lessons) || lessons.length === 0) {
  throw new Error('Không đọc được danh sách bài học từ data.js');
}

const sqlUpdates = [];
const stats = {
  textSentencesUpdated: 0,
  listeningQuestionsUpdated: 0,
  scramblesUpdated: 0,
  translationsUpdated: 0,
  expandedQuizUpdated: 0,
  compTestUpdated: 0,
};

lessons.forEach((lesson, lessonIdx) => {
  // 1. Texts -> sentences & listeningQuestions
  (lesson.texts || []).forEach((t, tIdx) => {
    (t.sentences || []).forEach((s, sIdx) => {
      const sentId = `ts_${lessonIdx + 1}_${tIdx + 1}_${sIdx + 1}`;
      const cleanedDisplay =
        typeof s.hanzi === 'string' && s.hanzi.trim()
          ? s.hanzi.trim()
          : stripInlineGlosses(s.displayHanzi);
      if (s.displayHanzi !== cleanedDisplay) {
        s.displayHanzi = cleanedDisplay;
        stats.textSentencesUpdated++;
        sqlUpdates.push(
          `UPDATE text_sentences SET display_hanzi = ${sqlStr(cleanedDisplay)} WHERE id = ${sqlStr(sentId)};`
        );
      }
    });

    (t.listeningQuestions || []).forEach((lq, qIdx) => {
      const qId = `lq_${lessonIdx + 1}_${tIdx + 1}_${qIdx + 1}`;
      const nextQ = stripInlineGlosses(stripBracketPrefix(lq.question));
      const nextOpts = (lq.options || []).map((o) => stripInlineGlosses(o));
      const qChanged = nextQ !== lq.question;
      const optsChanged = JSON.stringify(nextOpts) !== JSON.stringify(lq.options || []);
      if (qChanged || optsChanged) {
        lq.question = nextQ;
        lq.options = nextOpts;
        stats.listeningQuestionsUpdated++;
        sqlUpdates.push(
          `UPDATE quiz_questions SET question = ${sqlStr(nextQ)}, options = ${sqlJson(nextOpts)} WHERE id = ${sqlStr(qId)};`
        );
      }
    });
  });

  // 2. Sentence Scrambles
  (lesson.exercises?.sentenceScramble || []).forEach((sc) => {
    const nextMeaning = stripBracketPrefix(sc.targetMeaning);
    const hadUnlearned = Boolean(sc.unlearnedHint);
    if (nextMeaning !== sc.targetMeaning || hadUnlearned) {
      sc.targetMeaning = nextMeaning;
      delete sc.unlearnedHint;
      stats.scramblesUpdated++;
      sqlUpdates.push(
        `UPDATE sentence_scrambles SET target_meaning = ${sqlStr(nextMeaning)}, unlearned_hint = NULL WHERE id = ${sqlStr(sc.id)};`
      );
    }
  });

  // 3. Translation Exercises
  (lesson.exercises?.translationExercises || []).forEach((tr) => {
    const nextPrompt = stripInlineGlosses(stripBracketPrefix(tr.promptText));
    const nextHint = tr.hint ? stripUnlearnedFromHint(tr.hint) : tr.hint;
    if (nextPrompt !== tr.promptText || nextHint !== tr.hint) {
      tr.promptText = nextPrompt;
      tr.hint = nextHint;
      stats.translationsUpdated++;
      sqlUpdates.push(
        `UPDATE translation_exercises SET prompt_text = ${sqlStr(nextPrompt)}, hint = ${sqlStr(nextHint || null)} WHERE id = ${sqlStr(tr.id)};`
      );
    }
  });

  // 4. Expanded Quiz
  (lesson.exercises?.expandedQuiz || []).forEach((eq) => {
    const nextQ = stripInlineGlosses(stripBracketPrefix(eq.question));
    const nextOpts = (eq.options || []).map((o) => stripInlineGlosses(o));
    const qChanged = nextQ !== eq.question;
    const optsChanged = JSON.stringify(nextOpts) !== JSON.stringify(eq.options || []);
    if (qChanged || optsChanged) {
      eq.question = nextQ;
      eq.options = nextOpts;
      stats.expandedQuizUpdated++;
      sqlUpdates.push(
        `UPDATE quiz_questions SET question = ${sqlStr(nextQ)}, options = ${sqlJson(nextOpts)} WHERE id = ${sqlStr(eq.id)};`
      );
    }
  });

  // 5. Comprehensive Test
  (lesson.comprehensiveTest || []).forEach((ct) => {
    const nextQ = stripInlineGlosses(stripBracketPrefix(ct.question));
    const nextPassage = ct.passage ? stripInlineGlosses(stripBracketPrefix(ct.passage)) : ct.passage;
    const nextOpts = (ct.options || []).map((o) => stripInlineGlosses(o));
    const changed =
      nextQ !== ct.question ||
      nextPassage !== ct.passage ||
      JSON.stringify(nextOpts) !== JSON.stringify(ct.options || []);
    if (changed) {
      ct.question = nextQ;
      ct.passage = nextPassage;
      ct.options = nextOpts;
      stats.compTestUpdated++;
      sqlUpdates.push(
        `UPDATE quiz_questions SET question = ${sqlStr(nextQ)}, passage = ${sqlStr(nextPassage || null)}, options = ${sqlJson(nextOpts)} WHERE id = ${sqlStr(ct.id)};`
      );
    }
  });
});

// Ghi lại data.js
const outDataJs = `${header}const DEFAULT_LESSONS = ${JSON.stringify(lessons, null, 2)};\n`;
fs.writeFileSync(dataJsPath, outDataJs, 'utf8');

console.log('Cleaned data.js successfully!');
console.log('Stats:', JSON.stringify(stats, null, 2));
console.log('Total SQL UPDATE statements:', sqlUpdates.length);

// Nếu có truyền đường dẫn changeset Liquibase YAML thì ghi luôn file migration
const targetYmlPath = process.argv[2];
if (targetYmlPath) {
  const absYml = path.resolve(rootDir, targetYmlPath);
  const id = path.basename(absYml, '.yml');
  const indentedSql = sqlUpdates.map((line) => `              ${line}`).join('\n');
  const yml = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: chinese-study
      comment: Don sach chu thich ngoac inline thua, goi y tu chua hoc bi gan nham va tien to [Mo rong] / [On tap Bai] / [Doc hieu mo rong]
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
              -- Seed cleanup migration (khong rollback du lieu loi cu)
              SELECT 1;
`;
  fs.writeFileSync(absYml, yml, 'utf8');
  console.log('Wrote Liquibase changeset:', absYml);
}
