/**
 * Script xoá toàn bộ phần gợi ý (Pinyin trong ngoặc, Gợi ý nghĩa / Nghĩa tiếng Việt)
 * trong các câu hỏi bài Kiểm tra (comprehensiveTest / scope = 'comprehensive_test'):
 * 1) fill_blank:
 *    - Xoá `(pinyin)` sau `____` và đổi tiêu đề về "Chọn từ thích hợp điền vào chỗ trống:"
 *    - Xoá dòng `(Nghĩa: ...)` và `(Gợi ý nghĩa: ...)`
 * 2) vocab:
 *    - Xoá nghĩa tiếng Việt gợi ý trong ngoặc ở câu hỏi Pinyin: `Từ Hán tự “中午” (buổi trưa)` -> `Từ Hán tự “中午”`
 * 3) translate_vi_zh (sắp xếp từ thành câu):
 *    - Bỏ chữ "gợi ý" ("Sắp xếp các từ sau thành câu tiếng Trung đúng ngữ pháp:") và xoá dòng `(Nghĩa: ...)`
 *
 * Cách chạy:
 *   node database/cleanup-test-hints.mjs [path-to-liquibase-yml]
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataJsPath = path.join(rootDir, 'data.js');

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

function cleanExamQuestion(category, rawQuestion) {
  if (typeof rawQuestion !== 'string') return rawQuestion;
  let q = rawQuestion;

  if (category === 'fill_blank') {
    // 1. Đổi tiêu đề câu hỏi Pinyin sang câu điền từ chuẩn không có gợi ý Pinyin
    q = q.replace(
      /^Chọn chữ Hán tương ứng với phiên âm Pinyin để hoàn thành câu:/i,
      'Chọn từ thích hợp điền vào chỗ trống:'
    );
    // 2. Xoá phiên âm Pinyin trong ngoặc ngay sau chỗ trống ____
    q = q.replace(/____\s*\([^)]+\)/g, '____');
    // 3. Xoá dòng (Nghĩa: ...) hoặc (Gợi ý nghĩa: ...)
    q = q.replace(/\n?\s*\((?:Gợi ý nghĩa|Nghĩa)\s*:[\s\S]*?\)\s*$/i, '');
  } else if (category === 'vocab') {
    // Xoá gợi ý nghĩa tiếng Việt trong ngoặc ở dạng câu: Từ Hán tự “...” (...) có phiên âm Pinyin đúng là gì?
    q = q.replace(
      /(Từ Hán tự\s*[“"][^”"]+[”"])\s*\([^)]+\)(\s+có phiên âm Pinyin)/i,
      '$1$2'
    );
  } else if (category === 'translate_vi_zh') {
    q = q.replace(
      /^Sắp xếp các từ gợi ý sau thành câu tiếng Trung đúng ngữ pháp:/i,
      'Sắp xếp các từ sau thành câu tiếng Trung đúng ngữ pháp:'
    );
    q = q.replace(/\nTừ gợi ý:\s*/i, '\n');
    q = q.replace(/\n?\s*\((?:Gợi ý nghĩa|Nghĩa)\s*:[\s\S]*?\)\s*$/i, '');
  } else {
    // Phòng trường hợp câu hỏi khác có gắn dòng (Gợi ý nghĩa: ...) ở cuối
    q = q.replace(/\n?\s*\(Gợi ý(?:\s+nghĩa)?\s*:[\s\S]*?\)\s*$/i, '');
  }

  return q.trim();
}

const rawContent = fs.readFileSync(dataJsPath, 'utf8');
const declIdx = rawContent.indexOf('const DEFAULT_LESSONS');
if (declIdx === -1) throw new Error('Không tìm thấy const DEFAULT_LESSONS trong data.js');
const header = rawContent.slice(0, declIdx);

const ctx = { window: {} };
vm.runInNewContext(rawContent + '\nwindow.DEFAULT_LESSONS = DEFAULT_LESSONS;', ctx);
const lessons = ctx.window.DEFAULT_LESSONS;

const sqlUpdates = [];
const stats = {
  fill_blank: 0,
  vocab: 0,
  translate_vi_zh: 0,
  other: 0,
};
const samples = [];

for (const lesson of lessons) {
  for (const ct of lesson.comprehensiveTest || []) {
    const nextQ = cleanExamQuestion(ct.category, ct.question);
    if (nextQ !== ct.question) {
      if (samples.length < 6) {
        samples.push({ id: ct.id, cat: ct.category, before: ct.question, after: nextQ });
      }
      ct.question = nextQ;
      if (ct.category === 'fill_blank') stats.fill_blank++;
      else if (ct.category === 'vocab') stats.vocab++;
      else if (ct.category === 'translate_vi_zh') stats.translate_vi_zh++;
      else stats.other++;

      sqlUpdates.push(
        `UPDATE quiz_questions SET question = ${sqlStr(nextQ)} WHERE id = ${sqlStr(ct.id)} AND scope = 'comprehensive_test';`
      );
    }
  }
}

const outDataJs = `${header}const DEFAULT_LESSONS = ${JSON.stringify(lessons, null, 2)};\n`;
fs.writeFileSync(dataJsPath, outDataJs, 'utf8');

console.log('Cleaned comprehensiveTest hints in data.js!');
console.log('Stats:', JSON.stringify(stats, null, 2));
console.log('Total SQL UPDATE statements:', sqlUpdates.length);
console.log('Samples:', JSON.stringify(samples, null, 2));

const targetYmlPath = process.argv[2];
if (targetYmlPath) {
  const absYml = path.resolve(rootDir, targetYmlPath);
  const id = path.basename(absYml, '.yml');
  const indentedSql = sqlUpdates.map((line) => `              ${line}`).join('\n');
  const yml = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: chinese-study
      comment: Bo toan bo goi y Pinyin va goi y nghia trong cac cau hoi bai kiem tra (comprehensive_test)
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
              SELECT 1;
`;
  fs.writeFileSync(absYml, yml, 'utf8');
  console.log('Wrote Liquibase changeset:', absYml);
}
