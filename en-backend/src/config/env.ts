import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(backendRoot, '.env') });

interface RawAppConfig {
  server?: {
    port?: number | string;
    corsOrigin?: string;
  };
  database?: {
    url?: string;
    ssl?: string | boolean;
    connectionTimeoutMs?: number | string;
    maxPoolSize?: number | string;
    allowMemoryFallback?: boolean | string;
  };
  security?: {
    jwtSecret?: string;
    jwtExpiresIn?: string;
  };
  legacy?: {
    dataPath?: string;
    enDataPath?: string;
  };
  media?: {
    enBaseUrl?: string;
    enLocalDir?: string;
    supabaseUrl?: string;
    supabaseEnBucket?: string;
    supabaseEnPrefix?: string;
  };
  ai?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number | string;
  };
  retention?: {
    softDeleteDays?: number | string;
    purgeIntervalHours?: number | string;
  };
}

function resolvePlaceholders(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z0-9_]+)(?::([^}]*))?\}/g, (_m, varName, fallback = '') => {
      const envVal = process.env[varName];
      return envVal !== undefined && envVal !== '' ? envVal : fallback;
    });
  }
  if (Array.isArray(value)) {
    return value.map(resolvePlaceholders);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolvePlaceholders(v);
    }
    return out;
  }
  return value;
}

function deepMerge<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const result: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && result[k] && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k], v);
    } else if (v !== undefined) {
      result[k] = v;
    }
  }
  return result as T;
}

function loadYamlFile(filePath: string): RawAppConfig {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return (yaml.load(raw) as RawAppConfig) || {};
}

function toBool(val: unknown, defaultValue: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return defaultValue;
}

const baseCfg = loadYamlFile(path.join(backendRoot, 'application.yml'));
const profile = process.env.NODE_ENV === 'production' ? 'prod' : process.env.APP_PROFILE || '';
const profileCfg = profile
  ? loadYamlFile(path.join(backendRoot, `application-${profile}.yml`))
  : {};

const merged = resolvePlaceholders(deepMerge(baseCfg, profileCfg)) as RawAppConfig;

const sslRaw = String(merged.database?.ssl ?? 'auto').toLowerCase();
const databaseSsl: 'auto' | boolean =
  sslRaw === 'true' ? true : sslRaw === 'false' ? false : 'auto';

const rawEnBaseUrl = String(merged.media?.enBaseUrl || process.env.EN_MEDIA_BASE_URL || '').trim().replace(/\/+$/, '');
const rawSupabaseUrl = String(merged.media?.supabaseUrl || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const rawSupabaseBucket = String(merged.media?.supabaseEnBucket || process.env.SUPABASE_EN_MEDIA_BUCKET || 'tmach').trim();
const rawSupabasePrefix = String(merged.media?.supabaseEnPrefix || process.env.SUPABASE_EN_MEDIA_PREFIX || 'en-atlas').trim().replace(/^\/+|\/+$/g, '');
const resolvedEnMediaBaseUrl =
  rawEnBaseUrl ||
  (rawSupabaseUrl
    ? `${rawSupabaseUrl}/storage/v1/object/public/${rawSupabaseBucket}${rawSupabasePrefix ? `/${rawSupabasePrefix}` : ''}`
    : '');

export const env = {
  port: Number(merged.server?.port || 4001),
  corsOrigin: String(merged.server?.corsOrigin || 'http://localhost:5173'),
  databaseUrl: String(merged.database?.url || ''),
  databaseSsl,
  connectionTimeoutMs: Number(merged.database?.connectionTimeoutMs || 4000),
  maxPoolSize: Number(merged.database?.maxPoolSize || 10),
  allowMemoryFallback: toBool(merged.database?.allowMemoryFallback, true),
  jwtSecret: String(merged.security?.jwtSecret || 'dev-chinese-study-jwt-secret-key'),
  jwtExpiresIn: String(merged.security?.jwtExpiresIn || '7d'),
  enLessonsDataPath: path.resolve(backendRoot, merged.legacy?.enDataPath || '../database/en/lessons-a1.json'),
  media: {
    enBaseUrl: resolvedEnMediaBaseUrl,
    enLocalDir: path.resolve(backendRoot, merged.media?.enLocalDir || '../word-atlas/public/atlas'),
  },
  ai: {
    provider: String(merged.ai?.provider || 'gemini').trim().toLowerCase(),
    apiKey: String(merged.ai?.apiKey || process.env.AI_API_KEY || '').trim(),
    model: String(merged.ai?.model || process.env.AI_MODEL || 'gemini-3.5-flash-lite').trim(),
    baseUrl: String(merged.ai?.baseUrl || '').trim(),
    timeoutMs: Number(merged.ai?.timeoutMs || 45000),
  },
  retention: {
    softDeleteDays: Math.max(1, Number(merged.retention?.softDeleteDays || 30)),
    purgeIntervalHours: Math.max(1, Number(merged.retention?.purgeIntervalHours || 24)),
  },
};
