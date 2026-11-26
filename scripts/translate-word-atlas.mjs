#!/usr/bin/env node
/**
 * Script dịch bộ dữ liệu Word Atlas (word-atlas/data/word-atlas.json) sang Tiếng Việt
 * theo chuẩn từ điển Anh-Việt học thuật (English-First, Chinese-Cross-Check).
 *
 * Tính năng:
 * - Structured JSON Output (responseSchema, temperature=0) qua Gemini API (đọc config từ backend/.env)
 * - Auto-Validator lớp 1: khớp 100% số lượng senses/ex/col, chặn sót Hán tự, chặn bỏ trống/copy nguyên tiếng Anh
 * - Checkpoint JSONL tự động resume an toàn khi ngắt giữa chừng
 * - Retry 2 lớp: mini-batch 5 từ song song trước, sau đó mới retry đơn lẻ các từ còn sót
 *
 * Cách dùng:
 *   node scripts/translate-word-atlas.mjs --cefr=A1
 *   node scripts/translate-word-atlas.mjs --cefr=A1 --batch-size=8 --concurrency=4
 *   node scripts/translate-word-atlas.mjs --validate-only --out=database/en/word-atlas-vi.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Parse CLI args & load backend/.env
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    cefr: ['A1'],
    all: false,
    batchSize: 8,
    concurrency: 4,
    limit: 0,
    model: '',
    source: path.join(REPO_ROOT, 'word-atlas/data/word-atlas.json'),
    indexFile: path.join(REPO_ROOT, 'word-atlas/public/atlas/index.json'),
    checkpoint: path.join(REPO_ROOT, 'scripts/.cache/word-atlas-vi.jsonl'),
    out: path.join(REPO_ROOT, 'database/en/word-atlas-vi.json'),
    validateOnly: false,
    delayMs: 200,
  };

  for (const raw of argv) {
    if (raw === '--all') {
      args.all = true;
    } else if (raw === '--validate-only') {
      args.validateOnly = true;
    } else if (raw.startsWith('--cefr=')) {
      args.cefr = raw
        .slice('--cefr='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (raw.startsWith('--batch-size=')) {
      args.batchSize = Math.max(1, Math.min(20, Number(raw.slice('--batch-size='.length)) || 8));
    } else if (raw.startsWith('--concurrency=')) {
      args.concurrency = Math.max(1, Math.min(8, Number(raw.slice('--concurrency='.length)) || 4));
    } else if (raw.startsWith('--limit=')) {
      args.limit = Math.max(0, Number(raw.slice('--limit='.length)) || 0);
    } else if (raw.startsWith('--model=')) {
      args.model = raw.slice('--model='.length).trim();
    } else if (raw.startsWith('--out=')) {
      args.out = path.resolve(REPO_ROOT, raw.slice('--out='.length));
    } else if (raw.startsWith('--checkpoint=')) {
      args.checkpoint = path.resolve(REPO_ROOT, raw.slice('--checkpoint='.length));
    } else if (raw.startsWith('--delay-ms=')) {
      args.delayMs = Math.max(0, Number(raw.slice('--delay-ms='.length)) || 0);
    }
  }
  return args;
}

function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const envVars = {
  ...loadEnvFile(path.join(REPO_ROOT, 'backend/.env')),
  ...loadEnvFile(path.join(REPO_ROOT, 'en-backend/.env')),
  ...process.env,
};

const API_KEY = (envVars.GEMINI_API_KEY || envVars.AI_API_KEY || '').trim();
const BASE_URL = (envVars.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(
  /\/+$/,
  ''
);
const PRIMARY_MODEL = (args.model || envVars.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
const FALLBACK_MODELS = Array.from(
  new Set([PRIMARY_MODEL, 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-hydrogen'])
);

// ---------------------------------------------------------------------------
// 2. Helpers: Collocation parsing, CJK detection, Auto-Validator
// ---------------------------------------------------------------------------
// Chặn sót Hán tự, tiếng Nhật (Kana), tiếng Hàn (Hangul) và Cyrillic
const CJK_REGEX = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\u0400-\u04ff]/;

function splitCollocation(raw) {
  const s = String(raw || '').trim();
  const idx = s.includes('｜') ? s.indexOf('｜') : s.indexOf('|');
  if (idx === -1) return { en: s, zh: '' };
  return {
    en: s.slice(0, idx).trim(),
    zh: s.slice(idx + 1).trim(),
  };
}

function cleanViText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function validateTranslatedEntry(orig, tr) {
  const errors = [];
  if (!tr || typeof tr !== 'object') {
    return ['Thiếu object kết quả dịch'];
  }
  if (tr.id !== orig.id) {
    errors.push(`Sai id: nhận "${tr.id}", cần "${orig.id}"`);
  }

  const senses = Array.isArray(orig.senses) ? orig.senses : [];
  const ex = Array.isArray(orig.ex) ? orig.ex : [];
  const col = Array.isArray(orig.col) ? orig.col : [];

  if (!Array.isArray(tr.sensesVi) || tr.sensesVi.length !== senses.length) {
    errors.push(`sensesVi.length=${tr.sensesVi?.length ?? 'null'} != ${senses.length}`);
  } else {
    tr.sensesVi.forEach((v, i) => {
      const s = cleanViText(v);
      if (!s) errors.push(`sensesVi[${i}] rỗng`);
      if (CJK_REGEX.test(s)) errors.push(`sensesVi[${i}] còn sót Hán tự: "${s}"`);
      if (senses[i]?.en && senses[i].en.length >= 20 && s.toLowerCase() === senses[i].en.trim().toLowerCase()) {
        errors.push(`sensesVi[${i}] copy nguyên định nghĩa tiếng Anh`);
      }
    });
  }

  if (!Array.isArray(tr.exVi) || tr.exVi.length !== ex.length) {
    errors.push(`exVi.length=${tr.exVi?.length ?? 'null'} != ${ex.length}`);
  } else {
    tr.exVi.forEach((v, i) => {
      const s = cleanViText(v);
      if (!s) errors.push(`exVi[${i}] rỗng`);
      if (CJK_REGEX.test(s)) errors.push(`exVi[${i}] còn sót Hán tự: "${s}"`);
      if (ex[i]?.en && s.toLowerCase() === ex[i].en.trim().toLowerCase()) {
        errors.push(`exVi[${i}] chưa dịch sang tiếng Việt`);
      }
    });
  }

  if (!Array.isArray(tr.colVi) || tr.colVi.length !== col.length) {
    errors.push(`colVi.length=${tr.colVi?.length ?? 'null'} != ${col.length}`);
  } else {
    tr.colVi.forEach((v, i) => {
      const s = cleanViText(v);
      if (!s) errors.push(`colVi[${i}] rỗng`);
      if (CJK_REGEX.test(s)) errors.push(`colVi[${i}] còn sót Hán tự: "${s}"`);
    });
  }

  const origTip = String(orig.tip || '').trim();
  const tipVi = cleanViText(tr.tipVi);
  if (origTip) {
    if (!tipVi) errors.push('tipVi rỗng trong khi bản gốc có tip');
    if (CJK_REGEX.test(tipVi)) errors.push(`tipVi còn sót Hán tự: "${tipVi}"`);
  }

  const origNote = String(orig.note || '').trim();
  const noteVi = cleanViText(tr.noteVi);
  if (origNote) {
    if (!noteVi) errors.push('noteVi rỗng trong khi bản gốc có note');
    if (CJK_REGEX.test(noteVi)) errors.push(`noteVi còn sót Hán tự: "${noteVi}"`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 3. Gemini API Caller (Structured JSON Schema + Retry + Model Fallback)
// ---------------------------------------------------------------------------
const SYSTEM_INSTRUCTION = `Bạn là biên tập viên từ điển Anh–Việt học thuật cao cấp (theo chuẩn từ điển Oxford/Cambridge Anh–Việt cho người Việt học CEFR/IELTS).

NHIỆM VỤ: Dịch chính xác danh sách mục từ vựng tiếng Anh sang tiếng Việt tự nhiên, súc tích, đúng ngữ cảnh.

QUY TẮC BẮT BUỘC (English-First, Chinese-Cross-Check):
1. Luôn lấy định nghĩa tiếng Anh (en), từ loại (pos), chủ đề (topic) và câu ví dụ tiếng Anh (ex.en) làm NGUỒN GỐC CHÍNH. Chỉ dùng trường tiếng Trung (zhRef) để đối chiếu phạm vi nghĩa cho đúng nét nghĩa mà mục từ đang nhắm tới.
2. Tuyệt đối KHÔNG để sót bất kỳ chữ Hán (tiếng Trung) nào trong toàn bộ kết quả tiếng Việt, và KHÔNG dịch word-by-word gượng ép theo tiếng Trung.
3. sensesVi[i]: dịch nghĩa tiếng Việt ngắn gọn, tự nhiên, đúng từ loại (pos):
   - n.: danh từ gọn rõ (vd: "thư viện; phòng đọc")
   - v.: động từ hành động tự nhiên (vd: "mượn; vay")
   - adj.: tính từ tự nhiên (vd: "công cộng; chung")
   - adv./prep./conj.: dùng cách diễn đạt tự nhiên trong từ điển Anh-Việt (vd: "đúng ... giờ (giờ chẵn)").
   - Nếu 1 sense có 2-3 sắc thái gần nhau, ngăn cách bằng "; ". Không viết dài dòng như câu văn giải thích.
4. exVi[i]: dịch trọn câu ví dụ tự nhiên chuẩn tiếng Việt.
   - Câu đầu tiên thường là giao tiếp đời thường → dịch tự nhiên, gần gũi.
   - Câu thứ hai thường là văn phong IELTS/học thuật → dịch mạch lạc, trang trọng, chính xác thuật ngữ.
5. colVi[i]: dịch cụm từ cố định (collocation) tự nhiên như cách người Việt dùng (vd: "library card" -> "thẻ thư viện", "early spring" -> "đầu xuân").
6. tipVi: dịch mẹo phân biệt/cách dùng sang tiếng Việt dễ hiểu. GIỮ NGUYÊN các từ/cụm tiếng Anh được trích dẫn trong mẹo (vd: "library", "bookshop", "in", "o'clock"). Nếu tip gốc rỗng thì trả "".
7. noteVi: dịch lưu ý cách dùng/chính tả sang tiếng Việt tự nhiên. Nếu note gốc rỗng thì trả "".
8. BẮT BUỘC trả về ĐẦY ĐỦ tất cả các mục đầu vào, giữ nguyên chính xác id và số phần tử sensesVi, exVi, colVi tương ứng 1-1.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          sensesVi: { type: 'ARRAY', items: { type: 'STRING' } },
          exVi: { type: 'ARRAY', items: { type: 'STRING' } },
          colVi: { type: 'ARRAY', items: { type: 'STRING' } },
          tipVi: { type: 'STRING' },
          noteVi: { type: 'STRING' },
        },
        required: ['id', 'sensesVi', 'exVi', 'colVi', 'tipVi', 'noteVi'],
      },
    },
  },
  required: ['items'],
};

function buildThinkingConfig(model) {
  const lower = model.toLowerCase();
  if (lower.includes('flash-lite')) return { thinkingLevel: 'minimal' };
  if (lower.startsWith('gemini-3') || lower.startsWith('gemini-4')) return { thinkingLevel: 'low' };
  if (lower.startsWith('gemini-2.5') && lower.includes('flash')) return { thinkingBudget: 0 };
  return undefined;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiBatch(entries, modelList = FALLBACK_MODELS) {
  const payloadItems = entries.map((e) => ({
    id: e.id,
    word: e.w,
    cefr: e.cefr,
    topic: e.topic,
    senses: (e.senses || []).map((s) => ({ pos: s.pos, en: s.en, zhRef: s.zh })),
    ex: (e.ex || []).map((x) => ({ en: x.en, zhRef: x.zh })),
    col: (e.col || []).map((c) => {
      const parsed = splitCollocation(c);
      return { en: parsed.en, zhRef: parsed.zh };
    }),
    tipZhRef: e.tip || '',
    noteZhRef: e.note || '',
  }));

  const userPrompt = `Hãy dịch chính xác ${payloadItems.length} mục từ tiếng Anh sau sang tiếng Việt theo đúng JSON schema (trả đủ ${payloadItems.length} phần tử trong items):\n${JSON.stringify(payloadItems)}`;

  let lastErr = null;
  for (let mIdx = 0; mIdx < modelList.length; mIdx++) {
    const model = modelList[mIdx];
    const url = `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
    const thinkingConfig = buildThinkingConfig(model);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
              ...(thinkingConfig ? { thinkingConfig } : {}),
            },
          }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.error?.message || `HTTP ${res.status}`;
          if (res.status === 401 || res.status === 403) {
            throw new Error(`FATAL_AUTH: ${msg}`);
          }
          if (res.status === 429 || res.status === 503 || res.status === 500) {
            lastErr = new Error(`[${model}] HTTP ${res.status}: ${msg}`);
            await sleep(1500 * attempt * attempt);
            continue;
          }
          lastErr = new Error(`[${model}] HTTP ${res.status}: ${msg}`);
          break;
        }

        const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
          ? data.candidates[0].content.parts
          : [];
        const text = parts
          .filter((p) => !p?.thought && typeof p?.text === 'string')
          .map((p) => p.text)
          .join('')
          .trim();

        if (!text) {
          lastErr = new Error(`[${model}] Empty response`);
          await sleep(1000 * attempt);
          continue;
        }

        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed?.items)) {
          lastErr = new Error(`[${model}] Missing items array`);
          await sleep(1000 * attempt);
          continue;
        }

        return { items: parsed.items, usedModel: model };
      } catch (err) {
        if (String(err?.message || '').startsWith('FATAL_AUTH:')) throw err;
        lastErr = err;
        await sleep(1200 * attempt);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  throw lastErr || new Error('Không gọi được Gemini API');
}

// ---------------------------------------------------------------------------
// 4. Checkpoint & Output Compilation
// ---------------------------------------------------------------------------
function loadCheckpointMap(checkpointPath) {
  const map = new Map();
  if (!fs.existsSync(checkpointPath)) return map;
  const lines = fs.readFileSync(checkpointPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.id) map.set(obj.id, obj);
    } catch {
      // Bỏ qua dòng hỏng nếu bị ngắt đột ngột giữa dòng
    }
  }
  return map;
}

function appendCheckpointItems(checkpointPath, items) {
  if (items.length === 0) return;
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const chunk = items.map((x) => JSON.stringify(x)).join('\n') + '\n';
  fs.appendFileSync(checkpointPath, chunk, 'utf8');
}

function loadMediaFlagMap(indexPath) {
  const map = new Map();
  if (!fs.existsSync(indexPath)) return map;
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const rows = Array.isArray(idx?.words) ? idx.words : [];
  for (const row of rows) {
    if (Array.isArray(row) && row.length >= 7) {
      const id = String(row[0]);
      const bits = Number(row[6]) || 0;
      map.set(id, {
        img: Boolean(bits & 1),
        uk: Boolean(bits & 2),
        us: Boolean(bits & 4),
        ex: Boolean(bits & 8),
        ex2: Boolean(bits & 16),
      });
    }
  }
  return map;
}

function mergeFinalEntry(orig, tr, mediaMap) {
  const senses = (orig.senses || []).map((s, i) => ({
    pos: s.pos,
    en: s.en,
    vi: cleanViText(tr.sensesVi[i]),
  }));
  const ex = (orig.ex || []).map((x, i) => ({
    en: x.en,
    vi: cleanViText(tr.exVi[i]),
  }));
  const col = (orig.col || []).map((c, i) => {
    const parsed = splitCollocation(c);
    return {
      en: parsed.en,
      vi: cleanViText(tr.colVi[i]),
    };
  });

  const media = mediaMap.get(orig.id) || {
    img: true,
    uk: true,
    us: true,
    ex: true,
    ex2: false,
  };

  return {
    id: orig.id,
    w: orig.w,
    uk: orig.uk || '',
    us: orig.us || '',
    cefr: orig.cefr,
    topic: orig.topic,
    senses,
    ex,
    col,
    fam: Array.isArray(orig.fam) ? orig.fam : [],
    syn: Array.isArray(orig.syn) ? orig.syn : [],
    ant: Array.isArray(orig.ant) ? orig.ant : [],
    tipVi: cleanViText(tr.tipVi),
    noteVi: cleanViText(tr.noteVi),
    media,
  };
}

// ---------------------------------------------------------------------------
// 5. Validation-only audit
// ---------------------------------------------------------------------------
function runValidateOnly() {
  if (!fs.existsSync(args.out)) {
    console.error(`Không tìm thấy file output: ${args.out}`);
    process.exit(1);
  }
  const sourceAll = JSON.parse(fs.readFileSync(args.source, 'utf8'));
  const sourceById = new Map(sourceAll.map((x) => [x.id, x]));
  const compiled = JSON.parse(fs.readFileSync(args.out, 'utf8'));
  const entries = Array.isArray(compiled) ? compiled : compiled.words || [];

  let badCount = 0;
  let cjkCount = 0;
  for (const item of entries) {
    const orig = sourceById.get(item.id);
    if (!orig) {
      badCount++;
      console.error(`Không khớp nguồn: ${item.id}`);
      continue;
    }
    const rawTr = {
      id: item.id,
      sensesVi: (item.senses || []).map((s) => s.vi),
      exVi: (item.ex || []).map((x) => x.vi),
      colVi: (item.col || []).map((c) => c.vi),
      tipVi: item.tipVi || '',
      noteVi: item.noteVi || '',
    };
    const errs = validateTranslatedEntry(orig, rawTr);
    if (errs.length > 0) {
      badCount++;
      if (errs.some((e) => e.includes('Hán tự'))) cjkCount++;
      if (badCount <= 20) console.error(`[LỖI] ${item.id} (${item.w}): ${errs.join('; ')}`);
    }
  }

  console.log(
    `[AUDIT] Tổng: ${entries.length} từ | Lỗi cấu trúc/dịch: ${badCount} | Sót Hán tự: ${cjkCount}`
  );
  if (badCount > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// 6. Main pipeline
// ---------------------------------------------------------------------------
async function main() {
  if (args.validateOnly) {
    runValidateOnly();
    return;
  }

  if (!API_KEY) {
    console.error('Thiếu GEMINI_API_KEY trong backend/.env hoặc biến môi trường.');
    process.exit(1);
  }
  if (!fs.existsSync(args.source)) {
    console.error(`Không tìm thấy file nguồn: ${args.source}`);
    process.exit(1);
  }

  const allSource = JSON.parse(fs.readFileSync(args.source, 'utf8'));
  let targetEntries = args.all
    ? allSource
    : allSource.filter((item) => args.cefr.includes(String(item.cefr || '').toUpperCase()));

  if (args.limit > 0) {
    targetEntries = targetEntries.slice(0, args.limit);
  }

  const checkpointMap = loadCheckpointMap(args.checkpoint);

  const validDoneMap = new Map();
  for (const orig of targetEntries) {
    const cached = checkpointMap.get(orig.id);
    if (cached && validateTranslatedEntry(orig, cached).length === 0) {
      validDoneMap.set(orig.id, cached);
    }
  }

  const pending = targetEntries.filter((e) => !validDoneMap.has(e.id));

  console.log(
    `[Word Atlas -> VI] Target: ${targetEntries.length} từ (${args.all ? 'ALL' : args.cefr.join(',')}) | Đã dịch hợp lệ: ${validDoneMap.size} | Còn lại: ${pending.length} | Model ưu tiên: ${PRIMARY_MODEL}`
  );

  const batches = [];
  for (let i = 0; i < pending.length; i += args.batchSize) {
    batches.push(pending.slice(i, i + args.batchSize));
  }

  let nextBatchIdx = 0;
  let completedCount = validDoneMap.size;
  const failedSingleQueue = [];
  const startedAt = Date.now();

  async function processBatch(batch, batchNum) {
    try {
      const { items, usedModel } = await callGeminiBatch(batch);
      const byId = new Map(items.map((x) => [String(x.id || '').trim().toLowerCase(), x]));
      const newlyValid = [];
      let batchBad = 0;
      let sampleErr = '';

      for (const orig of batch) {
        const tr = byId.get(orig.id.toLowerCase());
        const normalizedTr = tr ? { ...tr, id: orig.id } : tr;
        const errs = validateTranslatedEntry(orig, normalizedTr);
        if (errs.length === 0) {
          const normalized = {
            id: orig.id,
            sensesVi: normalizedTr.sensesVi.map(cleanViText),
            exVi: normalizedTr.exVi.map(cleanViText),
            colVi: normalizedTr.colVi.map(cleanViText),
            tipVi: cleanViText(normalizedTr.tipVi),
            noteVi: cleanViText(normalizedTr.noteVi),
          };
          validDoneMap.set(orig.id, normalized);
          newlyValid.push(normalized);
        } else {
          batchBad++;
          if (!sampleErr) sampleErr = `${orig.id}: ${errs[0]}`;
          failedSingleQueue.push({ orig, reason: errs.join('; ') });
        }
      }

      appendCheckpointItems(args.checkpoint, newlyValid);
      completedCount += newlyValid.length;
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      const errNote = sampleErr ? ` | vd lỗi: ${sampleErr}` : '';
      console.log(
        `  [Batch ${batchNum}/${batches.length}] +${newlyValid.length}/${batch.length} OK (${batchBad} cần retry) | Tiến độ: ${completedCount}/${targetEntries.length} | ${usedModel} | ${elapsedSec}s${errNote}`
      );
    } catch (err) {
      if (String(err?.message || '').startsWith('FATAL_AUTH:')) throw err;
      console.warn(`  [Batch ${batchNum}/${batches.length}] Lỗi API (${err.message}) -> đẩy vào hàng đợi retry`);
      for (const orig of batch) {
        failedSingleQueue.push({ orig, reason: err.message });
      }
    }
  }

  async function worker() {
    while (true) {
      const idx = nextBatchIdx++;
      if (idx >= batches.length) break;
      await processBatch(batches[idx], idx + 1);
      if (args.delayMs > 0) await sleep(args.delayMs);
    }
  }

  if (batches.length > 0) {
    const workers = Array.from({ length: Math.min(args.concurrency, batches.length) }, () => worker());
    await Promise.all(workers);
  }

  // Retry 2 lớp: Pass 1 mini-batch 5 từ song song -> Pass 2 đơn lẻ
  if (failedSingleQueue.length > 0) {
    const uniqueFailed = Array.from(
      new Map(
        failedSingleQueue
          .filter((x) => !validDoneMap.has(x.orig.id))
          .map((x) => [x.orig.id, x])
      ).values()
    );

    if (uniqueFailed.length > 0) {
      console.log(`\n[RETRY PASS 1] Xử lý song song ${uniqueFailed.length} từ theo mini-batch 5 từ...`);
      const miniBatches = [];
      for (let i = 0; i < uniqueFailed.length; i += 5) {
        miniBatches.push(uniqueFailed.slice(i, i + 5).map((x) => x.orig));
      }

      const retryModels = Array.from(new Set([PRIMARY_MODEL, 'gemini-3.8-flash', 'gemini-4-hydrogen']));
      let nextMiniIdx = 0;
      const singleFallback = [];

      async function miniWorker() {
        while (true) {
          const idx = nextMiniIdx++;
          if (idx >= miniBatches.length) break;
          const mb = miniBatches[idx];
          try {
            const { items, usedModel } = await callGeminiBatch(mb, retryModels);
            const byId = new Map(items.map((x) => [String(x.id || '').trim().toLowerCase(), x]));
            const newlyValid = [];
            for (const orig of mb) {
              const tr = byId.get(orig.id.toLowerCase());
              const normalizedTr = tr ? { ...tr, id: orig.id } : tr;
              const errs = validateTranslatedEntry(orig, normalizedTr);
              if (errs.length === 0) {
                const normalized = {
                  id: orig.id,
                  sensesVi: normalizedTr.sensesVi.map(cleanViText),
                  exVi: normalizedTr.exVi.map(cleanViText),
                  colVi: normalizedTr.colVi.map(cleanViText),
                  tipVi: cleanViText(normalizedTr.tipVi),
                  noteVi: cleanViText(normalizedTr.noteVi),
                };
                validDoneMap.set(orig.id, normalized);
                newlyValid.push(normalized);
              } else {
                singleFallback.push({ orig, reason: errs.join('; ') });
              }
            }
            appendCheckpointItems(args.checkpoint, newlyValid);
            completedCount += newlyValid.length;
            console.log(
              `  [MiniBatch ${idx + 1}/${miniBatches.length}] +${newlyValid.length}/${mb.length} OK | Tiến độ: ${completedCount}/${targetEntries.length} | ${usedModel}`
            );
          } catch (err) {
            for (const orig of mb) {
              singleFallback.push({ orig, reason: err.message });
            }
          }
          if (args.delayMs > 0) await sleep(args.delayMs);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(args.concurrency, miniBatches.length) }, () => miniWorker())
      );

      const stillFailed = [];
      if (singleFallback.length > 0) {
        console.log(`\n[RETRY PASS 2] Xử lý từng từ cho ${singleFallback.length} từ còn sót...`);
        const strongModels = Array.from(new Set(['gemini-3.8-flash', 'gemini-4-hydrogen', ...FALLBACK_MODELS]));
        for (const item of singleFallback) {
          if (validDoneMap.has(item.orig.id)) continue;
          let fixed = false;
          for (let round = 1; round <= 2; round++) {
            try {
              const { items } = await callGeminiBatch([item.orig], strongModels);
              const tr =
                items.find((x) => String(x.id || '').toLowerCase() === item.orig.id.toLowerCase()) ||
                items[0];
              const normalizedTr = tr ? { ...tr, id: item.orig.id } : tr;
              const errs = validateTranslatedEntry(item.orig, normalizedTr);
              if (errs.length === 0) {
                const normalized = {
                  id: item.orig.id,
                  sensesVi: normalizedTr.sensesVi.map(cleanViText),
                  exVi: normalizedTr.exVi.map(cleanViText),
                  colVi: normalizedTr.colVi.map(cleanViText),
                  tipVi: cleanViText(normalizedTr.tipVi),
                  noteVi: cleanViText(normalizedTr.noteVi),
                };
                validDoneMap.set(item.orig.id, normalized);
                appendCheckpointItems(args.checkpoint, [normalized]);
                completedCount++;
                fixed = true;
                console.log(`  [RETRY OK] ${item.orig.id} (${item.orig.w})`);
                break;
              } else {
                item.reason = errs.join('; ');
              }
            } catch (err) {
              item.reason = err.message;
            }
          }
          if (!fixed) stillFailed.push(item);
        }
      }

      if (stillFailed.length > 0) {
        console.error(`\n[CẢNH BÁO] Còn ${stillFailed.length} từ chưa dịch đạt chuẩn:`);
        for (const f of stillFailed.slice(0, 20)) {
          console.error(`  - ${f.orig.id} (${f.orig.w}): ${f.reason}`);
        }
      }
    }
  }

  // Tổng hợp file JSON hoàn chỉnh theo đúng thứ tự lộ trình gốc của Word Atlas
  const mediaMap = loadMediaFlagMap(args.indexFile);
  const compiledWords = [];
  for (const orig of targetEntries) {
    const tr = validDoneMap.get(orig.id);
    if (tr) {
      compiledWords.push(mergeFinalEntry(orig, tr, mediaMap));
    }
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const outputPayload = {
    meta: {
      source: 'Word Atlas (CC BY 4.0 — Word Atlas contributors)',
      language: 'en',
      targetTranslation: 'vi',
      cefrLevels: Array.from(new Set(compiledWords.map((w) => w.cefr))),
      totalWords: compiledWords.length,
      generatedAt: new Date().toISOString(),
    },
    words: compiledWords,
  };
  fs.writeFileSync(args.out, JSON.stringify(outputPayload, null, 2), 'utf8');

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n[DONE] Đã xuất ${compiledWords.length}/${targetEntries.length} từ đạt chuẩn -> ${args.out} (${totalSec}s)`
  );

  if (compiledWords.length < targetEntries.length) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});

