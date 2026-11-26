#!/usr/bin/env node
/**
 * Script upload media (WebP images + MP3 UK/US/Example audio) của bộ Word Atlas
 * lên Supabase Storage qua REST API (hỗ trợ cả Secret key sb_secret_... lẫn service_role JWT).
 *
 * Cách dùng:
 *   node scripts/upload-en-media-supabase.mjs --limit=2                # Test trước 2 từ (12 file)
 *   node scripts/upload-en-media-supabase.mjs                          # Upload toàn bộ 785 từ A1 (4.710 file ~98.4 MB)
 *   node scripts/upload-en-media-supabase.mjs --skip-ex2               # Bỏ audio/ex2 để giảm còn ~57.6 MB
 *   node scripts/upload-en-media-supabase.mjs --prefix=en-atlas        # Thư mục gốc trong bucket (mặc định: en-atlas)
 *   node scripts/upload-en-media-supabase.mjs --concurrency=12         # Số luồng song song (mặc định: 10)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    wordsFile: path.join(REPO_ROOT, 'database/en/word-atlas-vi.json'),
    atlasDir: path.join(REPO_ROOT, 'word-atlas/public/atlas'),
    checkpoint: path.join(REPO_ROOT, 'scripts/.cache/supabase-en-media-uploaded.txt'),
    prefix: 'en-atlas',
    bucket: '',
    concurrency: 10,
    limit: 0,
    skipEx2: false,
    dryRun: false,
    force: false,
  };

  for (const raw of argv) {
    if (raw === '--skip-ex2') args.skipEx2 = true;
    else if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--force') args.force = true;
    else if (raw.startsWith('--words=')) args.wordsFile = path.resolve(REPO_ROOT, raw.slice('--words='.length));
    else if (raw.startsWith('--prefix=')) args.prefix = raw.slice('--prefix='.length).replace(/^\/+|\/+$/g, '');
    else if (raw.startsWith('--bucket=')) args.bucket = raw.slice('--bucket='.length).trim();
    else if (raw.startsWith('--concurrency=')) {
      args.concurrency = Math.max(1, Math.min(20, Number(raw.slice('--concurrency='.length)) || 10));
    } else if (raw.startsWith('--limit=')) {
      args.limit = Math.max(0, Number(raw.slice('--limit='.length)) || 0);
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
      val = val.slice(1, -1).trim();
    }
    if (val.startsWith('<') && val.endsWith('>')) {
      val = val.slice(1, -1).trim();
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

const SUPABASE_URL = (envVars.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = (
  envVars.SUPABASE_SECRET_KEY ||
  envVars.SUPABASE_SERVICE_ROLE_KEY ||
  ''
)
  .replace(/^<|>$/g, '')
  .trim();
const BUCKET = (args.bucket || envVars.SUPABASE_EN_MEDIA_BUCKET || 'tmach').trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getContentType(relPath) {
  if (relPath.endsWith('.webp')) return 'image/webp';
  if (relPath.endsWith('.mp3')) return 'audio/mpeg';
  if (relPath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function buildObjectKey(relPath) {
  return args.prefix ? `${args.prefix}/${relPath}` : relPath;
}

function loadUploadedSet(checkpointPath) {
  const set = new Set();
  if (!fs.existsSync(checkpointPath)) return set;
  for (const line of fs.readFileSync(checkpointPath, 'utf8').split(/\r?\n/)) {
    const k = line.trim();
    if (k) set.add(k);
  }
  return set;
}

async function uploadSingleFile(localPath, objectKey) {
  const encodedPath = objectKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodedPath}`;
  const contentType = getContentType(objectKey);
  const body = fs.readFileSync(localPath);

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': contentType,
    'cache-control': '31536000',
    'x-upsert': 'true',
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (res.ok) return;

      const errText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error(`FATAL_AUTH (${res.status}): ${errText}`);
      }
      if (res.status === 404 && errText.toLowerCase().includes('bucket')) {
        throw new Error(`FATAL_BUCKET (${res.status}): ${errText}`);
      }
      lastErr = new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      await sleep(800 * attempt * attempt);
    } catch (err) {
      if (String(err?.message || '').startsWith('FATAL_')) throw err;
      lastErr = err;
      await sleep(800 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error(`Upload failed: ${objectKey}`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (Secret key) trong backend/.env.'
    );
    process.exit(1);
  }
  if (!fs.existsSync(args.wordsFile)) {
    console.error(`Không tìm thấy file từ vựng: ${args.wordsFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(args.wordsFile, 'utf8'));
  let words = Array.isArray(data) ? data : data.words || [];
  if (args.limit > 0) words = words.slice(0, args.limit);

  const candidates = [];
  let totalBytes = 0;

  for (const w of words) {
    const rels = [
      `img/${w.id}.webp`,
      `thumb/${w.id}.webp`,
      `audio/uk/${w.id}.mp3`,
      `audio/us/${w.id}.mp3`,
      `audio/ex/${w.id}.mp3`,
    ];
    if (!args.skipEx2) {
      rels.push(`audio/ex2/${w.id}.mp3`);
    }
    for (const rel of rels) {
      const localPath = path.join(args.atlasDir, rel);
      if (fs.existsSync(localPath)) {
        const size = fs.statSync(localPath).size;
        totalBytes += size;
        candidates.push({
          localPath,
          rel,
          objectKey: buildObjectKey(rel),
          size,
        });
      }
    }
  }

  const uploadedSet = args.force ? new Set() : loadUploadedSet(args.checkpoint);
  const checkpointKeyPrefix = `${BUCKET}::`;
  const pending = candidates.filter((c) => !uploadedSet.has(checkpointKeyPrefix + c.objectKey));

  const publicBase = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}${args.prefix ? '/' + args.prefix : ''}`;
  console.log(
    `[Supabase Upload] Bucket: ${BUCKET} | Prefix: "${args.prefix || '(root)'}" | Words: ${words.length} | Tổng file: ${candidates.length} (${(totalBytes / 1048576).toFixed(1)} MB)`
  );
  console.log(
    `[Supabase Upload] Đã up trước đó: ${candidates.length - pending.length} | Cần upload: ${pending.length} | Concurrency: ${args.concurrency}`
  );
  console.log(`[Supabase Upload] Public Base URL: ${publicBase}`);

  if (args.dryRun) {
    console.log('[DRY RUN] Không thực hiện upload.');
    return;
  }

  if (pending.length === 0) {
    console.log('[DONE] Toàn bộ file đã được upload trước đó.');
    return;
  }

  fs.mkdirSync(path.dirname(args.checkpoint), { recursive: true });

  let nextIdx = 0;
  let uploadedCount = 0;
  let uploadedBytes = 0;
  const failed = [];
  const startedAt = Date.now();
  let checkpointBuffer = [];

  function flushCheckpoint() {
    if (checkpointBuffer.length === 0) return;
    fs.appendFileSync(args.checkpoint, checkpointBuffer.join('\n') + '\n', 'utf8');
    checkpointBuffer = [];
  }

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= pending.length) break;
      const item = pending[idx];
      try {
        await uploadSingleFile(item.localPath, item.objectKey);
        uploadedCount++;
        uploadedBytes += item.size;
        checkpointBuffer.push(checkpointKeyPrefix + item.objectKey);

        if (checkpointBuffer.length >= 25) flushCheckpoint();

        if (uploadedCount % 100 === 0 || uploadedCount === pending.length) {
          const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
          const pct = ((uploadedCount / pending.length) * 100).toFixed(1);
          console.log(
            `  [${pct}%] ${uploadedCount}/${pending.length} files (${(uploadedBytes / 1048576).toFixed(1)} MB) | lỗi: ${failed.length} | ${sec}s`
          );
        }
      } catch (err) {
        if (String(err?.message || '').startsWith('FATAL_')) throw err;
        failed.push({ objectKey: item.objectKey, error: err.message });
      }
    }
  }

  try {
    const workers = Array.from({ length: Math.min(args.concurrency, pending.length) }, () => worker());
    await Promise.all(workers);
  } finally {
    flushCheckpoint();
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n[DONE] Upload thành công ${uploadedCount}/${pending.length} file (${(uploadedBytes / 1048576).toFixed(1)} MB) trong ${totalSec}s.`
  );
  if (failed.length > 0) {
    console.error(`[CẢNH BÁO] Có ${failed.length} file lỗi (chạy lại lệnh để tự retry):`);
    for (const f of failed.slice(0, 10)) {
      console.error(`  - ${f.objectKey}: ${f.error}`);
    }
    process.exitCode = 1;
  } else if (words[0]) {
    console.log(`[TEST URL] Ảnh mẫu: ${publicBase}/img/${words[0].id}.webp`);
    console.log(`[TEST URL] Audio UK: ${publicBase}/audio/uk/${words[0].id}.mp3`);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err.message || err);
  process.exit(1);
});
