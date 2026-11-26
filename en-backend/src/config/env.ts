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

export type AiProviderName = 'gemini' | 'groq' | 'openrouter' | 'openai-compatible';

export interface AiProviderConfig {
  name: AiProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
}

function buildAiProviders(): AiProviderConfig[] {
  const preferred = String(process.env.AI_PROVIDER || merged.ai?.provider || 'gemini')
    .trim()
    .toLowerCase();
  const normalizedPreferred: AiProviderName =
    preferred === 'groq' || preferred === 'openrouter' || preferred === 'gemini'
      ? preferred
      : preferred === 'openai' || preferred === 'openai-compatible'
        ? 'openai-compatible'
        : 'gemini';

  const byName = new Map<AiProviderName, AiProviderConfig>();

  const geminiKey = String(process.env.GEMINI_API_KEY || merged.ai?.apiKey || '').trim();
  if (geminiKey) {
    byName.set('gemini', {
      name: 'gemini',
      apiKey: geminiKey,
      model: String(process.env.GEMINI_MODEL || merged.ai?.model || 'gemini-3.5-flash-lite').trim(),
      baseUrl: String(
        process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
      ).trim(),
    });
  }

  const groqKey = String(
    process.env.GROQ_API_KEY || (normalizedPreferred === 'groq' ? process.env.AI_API_KEY : '') || ''
  ).trim();
  if (groqKey) {
    byName.set('groq', {
      name: 'groq',
      apiKey: groqKey,
      model: String(
        process.env.GROQ_MODEL ||
          (normalizedPreferred === 'groq' ? process.env.AI_MODEL : '') ||
          'qwen/qwen3-32b'
      ).trim(),
      baseUrl: String(process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').trim(),
    });
  }

  const openRouterKey = String(
    process.env.OPENROUTER_API_KEY ||
      (normalizedPreferred === 'openrouter' ? process.env.AI_API_KEY : '') ||
      ''
  ).trim();
  if (openRouterKey) {
    byName.set('openrouter', {
      name: 'openrouter',
      apiKey: openRouterKey,
      model: String(
        process.env.OPENROUTER_MODEL ||
          (normalizedPreferred === 'openrouter' ? process.env.AI_MODEL : '') ||
          'qwen/qwen3-235b-a22b:free'
      ).trim(),
      baseUrl: String(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim(),
    });
  }

  const customKey = String(
    normalizedPreferred === 'openai-compatible' ? process.env.AI_API_KEY || '' : ''
  ).trim();
  const customBaseUrl = String(process.env.AI_BASE_URL || merged.ai?.baseUrl || '').trim();
  if (customKey) {
    byName.set('openai-compatible', {
      name: 'openai-compatible',
      apiKey: customKey,
      model: String(process.env.AI_MODEL || merged.ai?.model || 'gpt-4o-mini').trim(),
      baseUrl: customBaseUrl || 'https://api.openai.com/v1',
    });
  }

  const order: AiProviderName[] = Array.from(
    new Set<AiProviderName>([normalizedPreferred, 'gemini', 'groq', 'openrouter', 'openai-compatible'])
  );
  return order.map((n) => byName.get(n)).filter((x): x is AiProviderConfig => Boolean(x));
}

const aiProviders = buildAiProviders();
const primaryAi = aiProviders[0];

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
    provider: primaryAi?.name || 'gemini',
    apiKey: primaryAi?.apiKey || '',
    model: primaryAi?.model || 'gemini-3.5-flash-lite',
    baseUrl: primaryAi?.baseUrl || '',
    providers: aiProviders,
    timeoutMs: Number(merged.ai?.timeoutMs || 45000),
  },
  retention: {
    softDeleteDays: Math.max(1, Number(merged.retention?.softDeleteDays || 30)),
    purgeIntervalHours: Math.max(1, Number(merged.retention?.purgeIntervalHours || 24)),
  },
};
