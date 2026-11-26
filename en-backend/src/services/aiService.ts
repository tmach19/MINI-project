import { env, type AiProviderConfig } from '../config/env.js';
import { getLanguageStrategy, normalizeLanguageCode } from '../languages/registry.js';
import {
  buildGameGradingCacheKey,
  getCachedGameGrade,
  getCachedTranslation,
  saveCachedGameGrade,
  saveCachedTranslation,
} from '../repositories/aiCacheRepo.js';
import {
  getLessonById,
  searchAllVocabulary,
  type GlobalVocabSearchHit,
} from '../repositories/lessonRepo.js';
import type {
  AiDictionaryCompound,
  AiDictionaryEntry,
  AiDictionaryExample,
  AiPendingAction,
  AiToolExecutionSummary,
  GameGradeDirection,
  GameGradeMode,
  GameGradeResult,
  LanguageCode,
  QuickLookupResult,
  TranslationDirection,
  UserProfile,
  VocabGlossaryItem,
} from '../types/domain.js';
import {
  AI_TOOL_DECLARATIONS,
  executeAiTool,
  type AiToolExecutionContext,
} from './aiTools.js';

export interface AiChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface DictionaryLookupResponse {
  query: string;
  direction: TranslationDirection;
  localHits: GlobalVocabSearchHit[];
  aiResult: AiDictionaryEntry | null;
  source: 'local_exact' | 'cache' | 'ai' | 'local_only';
  model: string | null;
  aiConfigured: boolean;
  notice?: string;
}

export function isAiConfigured(): boolean {
  return env.ai.providers.length > 0;
}

export function getAiPublicStatus() {
  return {
    configured: isAiConfigured(),
    provider: env.ai.provider,
    model: env.ai.model,
    fallbackCount: Math.max(0, env.ai.providers.length - 1),
  };
}

const providerCooldownUntil = new Map<string, number>();

function markProviderCooldown(providerName: string, err: unknown): void {
  const msg = String((err as Error)?.message || '').toLowerCase();
  let durationMs = 30_000;
  if (
    msg.includes('(401)') ||
    msg.includes('(403)') ||
    msg.includes('suspended') ||
    msg.includes('disabled') ||
    msg.includes('deleted') ||
    msg.includes('invalid api key')
  ) {
    durationMs = 5 * 60_000;
  } else if (msg.includes('(429)') || msg.includes('quota') || msg.includes('rate')) {
    durationMs = 60_000;
  }
  providerCooldownUntil.set(providerName, Date.now() + durationMs);
}

function getOrderedActiveProviders(exclude?: Set<string>): AiProviderConfig[] {
  const now = Date.now();
  const candidates = env.ai.providers.filter((p) => !exclude?.has(p.name));
  const healthy = candidates.filter((p) => (providerCooldownUntil.get(p.name) || 0) <= now);
  const cooling = candidates.filter((p) => (providerCooldownUntil.get(p.name) || 0) > now);
  return [...healthy, ...cooling];
}

function normalizeDirection(dir?: string): TranslationDirection {
  if (dir === 'zh_vi' || dir === 'vi_zh') return dir;
  return 'auto';
}

function detectLanguageHeuristic(text: string): 'zh' | 'vi' {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'vi';
}

function parseJsonObject(rawText: string): Record<string, any> {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonSlice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonSlice) as Record<string, any>;
}

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-4-hydrogen',
];

function buildGeminiThinkingConfig(model: string): Record<string, unknown> | undefined {
  const lower = model.toLowerCase();
  if (lower.includes('flash-lite')) {
    return { thinkingLevel: 'minimal' };
  }
  if (lower.startsWith('gemini-3') || lower.startsWith('gemini-4')) {
    return { thinkingLevel: 'low' };
  }
  if (lower.startsWith('gemini-2.5') && lower.includes('flash')) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

class RetryableGeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableGeminiError';
  }
}

interface GeminiContentTurn {
  role: 'user' | 'model';
  parts: Array<Record<string, any>>;
}

interface GeminiFunctionCallPart {
  name: string;
  args: Record<string, any>;
}

interface GeminiTurnResult {
  rawParts: Array<Record<string, any>>;
  text: string;
  functionCalls: GeminiFunctionCallPart[];
}

async function callGeminiSingleModel(
  model: string,
  options: {
    systemInstruction: string;
    contents: GeminiContentTurn[];
    jsonMode?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    tools?: Array<Record<string, any>>;
  },
  providerCfg?: AiProviderConfig
): Promise<GeminiTurnResult> {
  const cfg = providerCfg || env.ai.providers.find((p) => p.name === 'gemini');
  const apiKey = cfg?.apiKey || env.ai.apiKey;
  const baseUrl =
    (cfg?.baseUrl || env.ai.baseUrl).replace(/\/+$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

  const thinkingConfig = buildGeminiThinkingConfig(model);
  const body: Record<string, any> = {
    systemInstruction: {
      parts: [{ text: options.systemInstruction }],
    },
    contents: options.contents,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens ?? 1600,
      ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const apiMsg = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Gemini API Key không hợp lệ hoặc chưa được cấp quyền (${apiMsg}).`);
      }
      if (res.status === 404 || res.status === 429 || res.status === 503) {
        throw new RetryableGeminiError(`Lỗi Gemini API (${res.status}): ${apiMsg}`);
      }
      throw new Error(`Lỗi Gemini API: ${apiMsg}`);
    }

    const parts = data?.candidates?.[0]?.content?.parts;
    const rawParts: Array<Record<string, any>> = Array.isArray(parts) ? parts : [];
    const functionCalls: GeminiFunctionCallPart[] = rawParts
      .filter((p) => p?.functionCall && typeof p.functionCall.name === 'string')
      .map((p) => ({
        name: String(p.functionCall.name),
        args:
          p.functionCall.args && typeof p.functionCall.args === 'object'
            ? p.functionCall.args
            : {},
      }));

    const text = rawParts
      .filter((p: any) => !p?.thought && typeof p?.text === 'string')
      .map((p: any) => p.text)
      .join('')
      .trim();

    if (!text && functionCalls.length === 0) {
      throw new Error('AI không trả về nội dung hợp lệ.');
    }
    return { rawParts, text, functionCalls };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new RetryableGeminiError('Kết nối tới Gemini API quá thời gian chờ. Vui lòng thử lại.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiTurn(
  options: {
    systemInstruction: string;
    contents: GeminiContentTurn[];
    jsonMode?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    tools?: Array<Record<string, any>>;
  },
  providerCfg?: AiProviderConfig
): Promise<GeminiTurnResult & { usedModel: string }> {
  const primary = providerCfg?.model || env.ai.model || 'gemini-3.5-flash-lite';
  const candidates = Array.from(new Set([primary, ...GEMINI_FALLBACK_MODELS]));

  let lastErr: Error | null = null;
  for (const model of candidates) {
    try {
      const turn = await callGeminiSingleModel(model, options, providerCfg);
      return { ...turn, usedModel: model };
    } catch (err) {
      if (err instanceof RetryableGeminiError) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Không thể kết nối tới Gemini API lúc này.');
}

async function callGemini(
  options: {
    systemInstruction: string;
    contents: GeminiContentTurn[];
    jsonMode?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
  },
  providerCfg?: AiProviderConfig
): Promise<{ text: string; usedModel: string }> {
  const res = await callGeminiTurn(options, providerCfg);
  return { text: res.text, usedModel: res.usedModel };
}

async function callOpenAiCompatible(
  options: {
    systemInstruction: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    jsonMode?: boolean;
    temperature?: number;
    maxTokens?: number;
  },
  providerCfg: AiProviderConfig
): Promise<string> {
  const baseUrl = providerCfg.baseUrl.replace(/\/+$/, '') || 'https://api.openai.com/v1';
  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, any> = {
    model: providerCfg.model,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1400,
    messages: [{ role: 'system', content: options.systemInstruction }, ...options.messages],
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerCfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const apiMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Lỗi ${providerCfg.name.toUpperCase()} API (${res.status}): ${apiMsg}`);
    }
    const rawText = data?.choices?.[0]?.message?.content;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new Error('AI API không trả về nội dung hợp lệ.');
    }
    const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!cleaned) {
      throw new Error('AI API không trả về nội dung hợp lệ.');
    }
    return cleaned;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Kết nối tới ${providerCfg.name.toUpperCase()} API quá thời gian chờ.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function generateAiResponse(options: {
  systemInstruction: string;
  history?: AiChatHistoryItem[];
  userPrompt: string;
  jsonMode?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  excludeProviders?: Set<string>;
}): Promise<{ text: string; usedModel: string }> {
  if (!isAiConfigured()) {
    console.warn('[AI] Chưa cấu hình API key AI nào trong en-backend/.env.');
    throw new Error('Dịch vụ trợ lý AI hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.');
  }

  const cleanHistory = (options.history || []).slice(-10);
  const providers = getOrderedActiveProviders(options.excludeProviders);
  let lastErr: Error | null = null;

  for (let i = 0; i < providers.length; i++) {
    const providerCfg = providers[i];
    try {
      if (providerCfg.name === 'gemini') {
        const contents = [
          ...cleanHistory.map((m) => ({
            role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
            parts: [{ text: m.content }],
          })),
          { role: 'user' as const, parts: [{ text: options.userPrompt }] },
        ];
        const res = await callGemini(
          {
            systemInstruction: options.systemInstruction,
            contents,
            jsonMode: options.jsonMode,
            temperature: options.temperature,
            maxOutputTokens: options.maxOutputTokens,
          },
          providerCfg
        );
        providerCooldownUntil.delete(providerCfg.name);
        return res;
      }

      const text = await callOpenAiCompatible(
        {
          systemInstruction: options.systemInstruction,
          messages: [...cleanHistory, { role: 'user', content: options.userPrompt }],
          jsonMode: options.jsonMode,
          temperature: options.temperature,
          maxTokens: options.maxOutputTokens,
        },
        providerCfg
      );
      providerCooldownUntil.delete(providerCfg.name);
      return { text, usedModel: `${providerCfg.name}:${providerCfg.model}` };
    } catch (err) {
      lastErr = err as Error;
      markProviderCooldown(providerCfg.name, err);
      if (i < providers.length - 1) {
        console.warn(
          `[AI Failover] ${providerCfg.name} lỗi (${lastErr.message}) -> tự chuyển sang ${providers[i + 1].name}`
        );
      }
    }
  }

  throw lastErr || new Error('Dịch vụ trợ lý AI hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.');
}

function normalizeExamples(raw: unknown): AiDictionaryExample[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .slice(0, 3)
    .map((item: any) => ({
      hanzi: String(item.hanzi || '').trim(),
      pinyin: String(item.pinyin || '').trim(),
      meaning: String(item.meaning || '').trim(),
    }))
    .filter((ex) => ex.hanzi && ex.meaning);
}

function normalizeCompounds(raw: unknown, selfHanzi: string): AiDictionaryCompound[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>([selfHanzi.trim()]);
  const out: AiDictionaryCompound[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const hanzi = String((item as any).hanzi || '').trim();
    const pinyin = String((item as any).pinyin || '').trim();
    const meaning = String((item as any).meaning || '').trim();
    if (!hanzi || !meaning || seen.has(hanzi)) continue;
    seen.add(hanzi);
    out.push({ hanzi, pinyin, meaning });
    if (out.length >= 6) break;
  }
  return out;
}

async function generateDictionaryEntryWithAi(
  query: string,
  direction: TranslationDirection,
  lang: LanguageCode = 'en'
): Promise<{ entry: AiDictionaryEntry; usedModel: string }> {
  const strategy = getLanguageStrategy(lang);
  const { systemInstruction, userPrompt } = strategy.buildDictionaryPrompts({
    query,
    direction,
  });

  const { text: raw, usedModel } = await generateAiResponse({
    systemInstruction,
    userPrompt,
    jsonMode: true,
    temperature: 0.2,
  });

  const parsed = parseJsonObject(raw);
  const meaningsArr = Array.isArray(parsed.meanings)
    ? parsed.meanings.map((m: unknown) => String(m || '').trim()).filter(Boolean)
    : [];
  const hanzi = String(parsed.hanzi || query).trim();
  const isSentence = Boolean(parsed.isSentence);

  const validDetected =
    parsed.detectedLanguage === 'zh' ||
    parsed.detectedLanguage === 'en' ||
    parsed.detectedLanguage === 'vi' ||
    parsed.detectedLanguage === 'mixed'
      ? parsed.detectedLanguage
      : strategy.detectInputLanguage(query);

  return {
    usedModel,
    entry: {
      query: query.trim(),
      direction,
      detectedLanguage: validDetected,
      isSentence,
      hanzi,
      pinyin: String(parsed.pinyin || '').trim(),
      sinoVietnamese: parsed.sinoVietnamese ? String(parsed.sinoVietnamese).trim() : null,
      wordType: parsed.wordType ? String(parsed.wordType).trim() : null,
      meaning: String(parsed.meaning || meaningsArr[0] || '').trim(),
      meanings: meaningsArr,
      radical: parsed.radical ? String(parsed.radical).trim() : null,
      breakdown: parsed.breakdown ? String(parsed.breakdown).trim() : null,
      mnemonic: parsed.mnemonic ? String(parsed.mnemonic).trim() : null,
      grammarNote: parsed.grammarNote ? String(parsed.grammarNote).trim() : null,
      compounds: isSentence ? [] : normalizeCompounds(parsed.compounds, hanzi),
      examples: normalizeExamples(parsed.examples),
    },
  };
}

export async function lookupDictionary(options: {
  query: string;
  direction?: string;
  lang?: LanguageCode;
  userId?: string;
  forceAi?: boolean;
}): Promise<DictionaryLookupResponse> {
  const safeLang = normalizeLanguageCode(options.lang);
  const strategy = getLanguageStrategy(safeLang);
  const query = options.query.trim();
  const direction = strategy.normalizeDirection(options.direction);
  const aiConfigured = isAiConfigured();

  const localHits = await searchAllVocabulary(query, options.userId, safeLang);
  const cached = await getCachedTranslation(direction, query, safeLang);

  const needsCompoundsRefresh =
    Boolean(cached) &&
    aiConfigured &&
    !cached!.payload.isSentence &&
    cached!.payload.compounds === undefined;

  const EN_MEANING_POS_RE =
    /^(?:(?:n|v|adj|adv|prep|conj|pron|num|det|int|interj|aux|modal\s*v|phr\.?\s*v|art)\.|idiom\b|(?:danh từ|động từ|tính từ|trạng từ|giới từ|liên từ|đại từ|thán từ|cụm động từ|thành ngữ))/i;

  const needsPosMeaningsRefresh =
    Boolean(cached) &&
    aiConfigured &&
    safeLang === 'en' &&
    !cached!.payload.isSentence &&
    Array.isArray(cached!.payload.meanings) &&
    cached!.payload.meanings.length > 0 &&
    !cached!.payload.meanings.some((m) => EN_MEANING_POS_RE.test(m.trim()));

  if (cached && !options.forceAi && !needsCompoundsRefresh && !needsPosMeaningsRefresh) {
    return {
      query,
      direction,
      localHits,
      aiResult: cached.payload,
      source: 'cache',
      model: cached.model,
      aiConfigured,
    };
  }

  if (!aiConfigured) {
    console.warn(`[AI] Chưa cấu hình AI key -> chỉ trả về kết quả từ giáo trình (${safeLang}).`);
    return {
      query,
      direction,
      localHits,
      aiResult: null,
      source: 'local_only',
      model: null,
      aiConfigured: false,
    };
  }

  try {
    const { entry: aiResult, usedModel } = await generateDictionaryEntryWithAi(
      query,
      direction,
      safeLang
    );
    await saveCachedTranslation(direction, query, usedModel, aiResult, safeLang);

    return {
      query,
      direction,
      localHits,
      aiResult,
      source: 'ai',
      model: usedModel,
      aiConfigured: true,
    };
  } catch (err) {
    if (localHits.length > 0) {
      console.warn('[AI Dictionary] Lỗi gọi AI, fallback kết quả giáo trình:', err);
      return {
        query,
        direction,
        localHits,
        aiResult: cached?.payload || null,
        source: cached ? 'cache' : 'local_only',
        model: cached?.model || null,
        aiConfigured: true,
      };
    }
    throw err;
  }
}

const MAX_ATTACHED_LESSONS = 50;
const MAX_TOOL_ROUNDS = 4;

const INTERNAL_TOOL_PATTERN =
  'propose_create_lesson|propose_update_lesson|get_study_progress_summary|search_curriculum_vocab|bookmark_vocab_items|generate_review_exam|open_study_target|list_lessons|get_lesson_detail';

const TOOL_VIETNAMESE_LABELS: Record<string, string> = {
  get_study_progress_summary: 'thống kê tiến độ & lịch sử làm bài',
  list_lessons: 'danh sách buổi học',
  get_lesson_detail: 'chi tiết buổi học',
  search_curriculum_vocab: 'tìm kiếm từ vựng giáo trình',
  bookmark_vocab_items: 'đánh dấu từ vựng ôn tập',
  propose_create_lesson: 'tạo buổi học mới',
  propose_update_lesson: 'chỉnh sửa buổi học',
  open_study_target: 'mở màn hình học tập',
  generate_review_exam: 'tạo đề kiểm tra ôn tập',
};

export function sanitizeUserFacingReply(rawText: string): string {
  let text = String(rawText || '');
  text = text.replace(
    new RegExp(
      `\\s*\\(\\s*\`?(?:${INTERNAL_TOOL_PATTERN})\`?(?:\\s*(?:,|\\/|hoặc|và)\\s*\`?(?:${INTERNAL_TOOL_PATTERN})\`?)*\\s*\\)`,
      'gi'
    ),
    ''
  );
  text = text.replace(
    new RegExp(
      `\\s+(?:qua|bằng|nhờ|với)\\s+\`?(?:${INTERNAL_TOOL_PATTERN})\`?(?=[\\s.,;:!?)]|$)`,
      'gi'
    ),
    ''
  );
  text = text.replace(
    new RegExp(`\`?(${INTERNAL_TOOL_PATTERN})\`?`, 'gi'),
    (_, fn: string) => TOOL_VIETNAMESE_LABELS[fn.toLowerCase()] || 'công cụ hỗ trợ'
  );
  text = text.replace(/`?bestScore\s*>\s*70%`?/gi, 'điểm cao nhất > 70%');
  text = text.replace(/`?bestScore`?/g, 'điểm cao nhất');
  text = text.replace(/\s+\(\s*`?passed`?\s*\)/gi, '');
  text = text.replace(/`(?:lessonIds?|vocabIds?)`/g, 'danh sách bài/từ liên quan');
  text = text.replace(/ +([.,;:!?])/g, '$1');
  return text.trim();
}

export interface AiTutorChatResponse {
  reply: string;
  model: string;
  lessonTitle: string | null;
  lessonTitles: string[];
  toolExecutions: AiToolExecutionSummary[];
  pendingActions: AiPendingAction[];
  effects: {
    progressUpdated: boolean;
    lessonsUpdated: boolean;
  };
}

export async function askTutorChat(options: {
  message: string;
  history?: AiChatHistoryItem[];
  lessonIds?: string[];
  lessonId?: string;
  lang?: LanguageCode;
  userId?: string;
  user?: UserProfile;
}): Promise<AiTutorChatResponse> {
  const safeLang = normalizeLanguageCode(options.lang);
  const strategy = getLanguageStrategy(safeLang);
  const requestedIds = Array.from(
    new Set(
      [
        ...(Array.isArray(options.lessonIds) ? options.lessonIds : []),
        ...(options.lessonId ? [options.lessonId] : []),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_ATTACHED_LESSONS);

  let lessonContextBlock = '';
  const lessonTitles: string[] = [];

  if (requestedIds.length > 0) {
    const loadedLessons = (
      await Promise.all(requestedIds.map((id) => getLessonById(id, options.userId)))
    ).filter((l): l is NonNullable<typeof l> => Boolean(l));

    if (loadedLessons.length > 0) {
      const vocabPerLesson =
        loadedLessons.length <= 2 ? 30 : loadedLessons.length <= 8 ? 15 : 10;
      const grammarPerLesson =
        loadedLessons.length <= 2 ? 12 : loadedLessons.length <= 8 ? 6 : 4;

      const sections = loadedLessons.map((lesson) => {
        lessonTitles.push(lesson.title);
        const vocabLines =
          loadedLessons.length > 8
            ? lesson.vocabulary
                .slice(0, vocabPerLesson)
                .map((v) => `${v.hanzi}(${v.pinyin}:${v.meaning})`)
                .join('; ')
            : lesson.vocabulary
                .slice(0, vocabPerLesson)
                .map(
                  (v) =>
                    `- ${v.hanzi} (${v.pinyin})${v.sinoVietnamese ? ` [${v.sinoVietnamese}]` : ''}: ${v.meaning}`
                )
                .join('\n');
        const grammarLines = lesson.grammar
          .slice(0, grammarPerLesson)
          .map((g) => `- ${g.title}: ${g.formula}`)
          .join('\n');

        return `### ${lesson.title} (${lesson.hskLevel})
${vocabLines ? (loadedLessons.length > 8 ? `Từ vựng: ${vocabLines}` : `Từ vựng:\n${vocabLines}`) : ''}
${grammarLines ? `Ngữ pháp:\n${grammarLines}` : ''}`.trim();
      });

      lessonContextBlock = `\n\nNGỮ CẢNH CÁC BUỔI HỌC ĐƯỢC ĐÍNH KÈM (${loadedLessons.length} bài):\n${sections.join('\n\n')}`;
    }
  }

  const systemInstruction =
    safeLang === 'en'
      ? `${strategy.buildTutorRoleInstruction()}

PHẠM VI KHẢ NĂNG HỖ TRỢ (PHÂN HỆ TIẾNG ANH CEFR / IELTS):
- Học Tiếng Anh: giải thích từ vựng, phiên âm IPA UK/US, Collocations, Word Family, ngữ pháp tiếng Anh, phân biệt từ gần nghĩa, sửa câu, luyện hội thoại, dịch Anh–Việt.
- Quản lý buổi học, tiến độ Dashboard & đánh dấu từ vựng trong ứng dụng.

Quy tắc trình bày:
1. Giải thích bằng tiếng Việt tự nhiên, súc tích, thân thiện, trình bày Markdown chuẩn.
2. TUYỆT ĐỐI KHÔNG nhắc tên hàm nội bộ hay tên tool kỹ thuật trong câu trả lời.
3. Khi đưa từ tiếng Anh trọng tâm, kèm phiên âm IPA ngắn gọn và nghĩa tiếng Việt rõ ràng.${lessonContextBlock}`
      : `Bạn là Trợ lý AI & Gia sư tiếng Trung HSK (汉语学堂) chuyên biệt cho ứng dụng học tiếng Trung này.

PHẠM VI KHẢ NĂNG HỖ TRỢ (CHỈ LÀM TRONG CÁC NHÓM SAU):
- Học tiếng Trung HSK: giải thích từ vựng, chữ Hán, Pinyin, Âm Hán Việt, bộ thủ, ngữ pháp, sửa câu, luyện hội thoại, dịch Trung–Việt.
- Quản lý buổi học trong app: xem danh sách/chi tiết buổi học, đề xuất tạo hoặc chỉnh sửa buổi học qua tool \`propose_create_lesson\` / \`propose_update_lesson\` (theo đúng quyền RBAC).
- Tiến độ Dashboard, thống kê điểm đạt & lịch sử kiểm tra: xem số bài đạt theo chuẩn Dashboard (điểm cao nhất > 70%), điểm 4 kỹ năng (Từ vựng, Ngữ pháp, Nghe, Đọc hiểu), chuỗi ngày học (streak), lịch sử làm bài kiểm tra theo bài & tổng hợp, từ đánh dấu qua \`get_study_progress_summary\` (truyền \`lessonId\` nếu người dùng hỏi về một buổi học cụ thể); tìm và đánh dấu/bỏ đánh dấu từ vựng qua \`search_curriculum_vocab\` / \`bookmark_vocab_items\`.
- Tạo đề kiểm tra ôn tập & điều hướng: bốc đề kiểm tra ngẫu nhiên cho 1, nhiều hoặc tất cả buổi học qua \`generate_review_exam\`, hoặc tạo nút mở màn hình Tổng quan (\`dashboard\`), Từ đã đánh dấu (\`saved_vocab\`), Lịch sử làm bài (\`history\`), Học chi tiết (\`study\`), Kiểm tra tổng hợp (\`exam\`), Hồ sơ (\`profile\`) qua \`open_study_target\`.

QUY TẮC TỪ CHỐI YÊU CẦU NGOÀI KHẢ NĂNG (RẤT QUAN TRỌNG):
- Nếu người dùng hỏi hoặc nhờ làm việc NGOÀI phạm vi trên (ví dụ: viết code lập trình, giải toán/lý/hoá, tư vấn y tế/pháp lý/tài chính, hỏi thời tiết/tin tức/chính trị, trò chuyện giải trí không liên quan tiếng Trung, HOẶC yêu cầu chức năng app mà bạn không có tool như: xoá vĩnh viễn bài học, đổi mật khẩu/email, phân quyền admin cho tài khoản, xuất file Excel, truy cập dữ liệu của người dùng khác):
  -> KHÔNG cố trả lời lan man hay tự bịa tính năng không tồn tại.
  -> Hãy thông báo lịch sự, rõ ràng với người dùng đúng ý: **"Yêu cầu của bạn hiện không nằm trong khả năng hỗ trợ của AI trong ứng dụng."** (kèm 1 câu ngắn nêu rõ AI chỉ hỗ trợ học tiếng Trung HSK, quản lý buổi học, theo dõi tiến độ/đánh dấu từ vựng và tạo đề kiểm tra ôn tập).

Quy tắc trình bày & gọi tool khi trong phạm vi:
1. Giải thích bằng tiếng Việt tự nhiên, súc tích, thân thiện. Trình bày đẹp bằng Markdown chuẩn (tiêu đề \`###\`, danh sách gạch đầu dòng ngắn gọn, bảng Markdown khi so sánh hoặc thống kê điểm thi; hạn chế emoji dư thừa).
2. TUYỆT ĐỐI KHÔNG nhắc tên hàm nội bộ, tên tool hay tên biến kỹ thuật (ví dụ: không viết \`get_study_progress_summary\`, \`propose_create_lesson\`, \`propose_update_lesson\`, \`search_curriculum_vocab\`, \`bookmark_vocab_items\`, \`generate_review_exam\`, \`open_study_target\`, \`list_lessons\`, \`get_lesson_detail\`, \`lessonId\`, \`vocabId\`, \`bestScore\`, \`passed\`) trong nội dung trả lời cho người dùng; kể cả khi giới thiệu tính năng, hãy mô tả hoàn toàn bằng ngôn ngữ tiếng Việt dễ hiểu (VD: "xem thống kê Dashboard & 4 kỹ năng", "đề xuất tạo buổi học mới").
3. Mọi chữ Hán đưa ra phải kèm Pinyin có thanh điệu trong ngoặc đơn (ví dụ: 学习 (xuéxí) — học tập).
4. Khi người học hỏi về điểm số, điều kiện để đạt, bài yếu, kỹ năng yếu, chuỗi streak hoặc tổng hợp lịch sử làm bài kiểm tra: BẮT BUỘC gọi \`get_study_progress_summary\` trước để đọc đúng số liệu từ Dashboard (chuẩn đạt của Dashboard là \`bestScore > 70%\` và 4 kỹ năng: Từ vựng, Ngữ pháp, Nghe, Đọc hiểu). Nếu người học nhắc đích danh một buổi học (ví dụ "Bài 1"), hãy truyền \`lessonId\` tương ứng vào \`get_study_progress_summary\` (sau khi xác định từ \`list_lessons\` nếu chưa rõ ID) để tư vấn chính xác kỹ năng đang yếu của bài đó.
5. Nếu người học nhờ phân biệt từ gần nghĩa hoặc sửa câu sai, hãy nêu rõ: (a) Câu đúng / Khác biệt cốt lõi, (b) Lý do, (c) 2 ví dụ ngắn.
6. Nếu người học muốn tạo đề ôn tập từ các bài đã chọn hoặc các bài điểm yếu, hãy chủ động gọi \`generate_review_exam\` với đúng \`lessonIds\` (không cần gọi thêm \`open_study_target\` vì thẻ kết quả đã có nút vào làm bài ngay).
7. Muốn đánh dấu từ vựng thì PHẢI tìm đúng \`vocabId\` thật qua \`search_curriculum_vocab\` hoặc \`get_lesson_detail\` trước, tuyệt đối không tự bịa \`vocabId\`.${lessonContextBlock}`;

  const orderedNow = getOrderedActiveProviders();
  const topProvider = orderedNow[0];
  const hasNonGeminiFallback = orderedNow.some((p) => p.name !== 'gemini');

  if (!topProvider || topProvider.name !== 'gemini' || !options.user) {
    const { text: reply, usedModel } = await generateAiResponse({
      systemInstruction,
      history: options.history,
      userPrompt: options.message.trim(),
      jsonMode: false,
      temperature: 0.45,
    });

    return {
      reply: sanitizeUserFacingReply(reply),
      model: usedModel,
      lessonTitle: lessonTitles[0] || null,
      lessonTitles,
      toolExecutions: [],
      pendingActions: [],
      effects: { progressUpdated: false, lessonsUpdated: false },
    };
  }

  if (!isAiConfigured()) {
    console.warn('[AI] Chưa cấu hình API key AI nào trong en-backend/.env.');
    throw new Error('Dịch vụ trợ lý AI hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.');
  }

  const cleanHistory = (options.history || []).slice(-10);
  const contents: GeminiContentTurn[] = [
    ...cleanHistory.map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: options.message.trim() }] },
  ];

  const toolCtx: AiToolExecutionContext = {
    user: options.user,
    executions: [],
    pendingActions: [],
    effects: { progressUpdated: false, lessonsUpdated: false },
  };

  const toolsPayload = [{ functionDeclarations: AI_TOOL_DECLARATIONS }];
  let finalReply = '';
  let finalModel = topProvider.model;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const turn = await callGeminiTurn(
        {
          systemInstruction,
          contents,
          jsonMode: false,
          temperature: 0.4,
          tools: toolsPayload,
        },
        topProvider
      );
      finalModel = turn.usedModel;

      if (turn.functionCalls.length === 0) {
        finalReply = turn.text;
        break;
      }

      // Bắt buộc giữ nguyên rawParts (gồm cả thoughtSignature) cho Gemini 3/4
      contents.push({ role: 'model', parts: turn.rawParts });

      const responseParts: Array<Record<string, any>> = [];
      for (const fc of turn.functionCalls) {
        const result = await executeAiTool(fc.name, fc.args, toolCtx);
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: result,
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    if (!finalReply) {
      const fallbackTurn = await callGeminiTurn(
        {
          systemInstruction,
          contents,
          jsonMode: false,
          temperature: 0.4,
        },
        topProvider
      );
      finalModel = fallbackTurn.usedModel;
      finalReply = fallbackTurn.text;
    }
    providerCooldownUntil.delete('gemini');
  } catch (err) {
    markProviderCooldown('gemini', err);
    if (!hasNonGeminiFallback) throw err;
    console.warn(
      `[AI Failover] Gemini chat lỗi (${(err as Error).message}) -> tự chuyển sang provider dự phòng`
    );
    const { text: reply, usedModel } = await generateAiResponse({
      systemInstruction,
      history: options.history,
      userPrompt: options.message.trim(),
      jsonMode: false,
      temperature: 0.45,
      excludeProviders: new Set(['gemini']),
    });
    return {
      reply: sanitizeUserFacingReply(reply),
      model: usedModel,
      lessonTitle: lessonTitles[0] || null,
      lessonTitles,
      toolExecutions: toolCtx.executions,
      pendingActions: toolCtx.pendingActions,
      effects: toolCtx.effects,
    };
  }

  return {
    reply: sanitizeUserFacingReply(finalReply),
    model: finalModel,
    lessonTitle: lessonTitles[0] || null,
    lessonTitles,
    toolExecutions: toolCtx.executions,
    pendingActions: toolCtx.pendingActions,
    effects: toolCtx.effects,
  };
}

const PINYIN_TONE_STRIP_MAP: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'u', ǘ: 'u', ǚ: 'u', ǜ: 'u', ü: 'u',
};

function normalizeGameText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s,.;:!?'"“”‘’()（）！？。，、]/g, '')
    .trim();
}

function stripGamePinyinTones(str: string): string {
  return normalizeGameText(str).replace(
    /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g,
    (ch) => PINYIN_TONE_STRIP_MAP[ch] ?? ch
  );
}

function tokenizeGameWords(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[,.;:!?'"“”‘’()（）！？。，、/]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hasSameCharMultiset(a: string, b: string): boolean {
  const arrA = Array.from(normalizeGameText(a)).sort();
  const arrB = Array.from(normalizeGameText(b)).sort();
  if (arrA.length !== arrB.length) return false;
  for (let i = 0; i < arrA.length; i++) {
    if (arrA[i] !== arrB[i]) return false;
  }
  return true;
}

export interface GradeGameAnswerParams {
  mode: GameGradeMode;
  direction?: GameGradeDirection;
  lang?: LanguageCode;
  exerciseId: string;
  promptText: string;
  expectedChinese?: string | null;
  expectedPinyin?: string | null;
  expectedMeaning?: string | null;
  userAnswer: string;
  canConsumeAiQuota?: () => boolean;
}

export async function gradeGameAnswer(params: GradeGameAnswerParams): Promise<GameGradeResult> {
  const safeLang = normalizeLanguageCode(
    params.lang ||
      (params.direction === 'vi_to_en' || params.direction === 'en_to_vi' ? 'en' : 'zh')
  );
  const strategy = getLanguageStrategy(safeLang);
  const userAnswer = params.userAnswer.trim();
  const direction: GameGradeDirection | null =
    params.mode === 'translation' ? strategy.normalizeGameDirection(params.direction) : null;
  const cleanUser = normalizeGameText(userAnswer);

  if (!cleanUser) {
    return {
      isCorrect: false,
      feedback: 'Bạn chưa nhập đáp án.',
      suggestion: null,
      source: 'local',
      aiUsed: false,
    };
  }

  const expectedZh = (params.expectedChinese || '').trim();
  const expectedPy = (params.expectedPinyin || '').trim();
  const expectedMeaning = (params.expectedMeaning || '').trim();

  // --- Tier 1: Local exact check + Guardrails (0ms, 0 token) ---
  if (params.mode === 'scramble') {
    const isExactMatch =
      safeLang === 'en'
        ? strategy.normalizeAnswerForExactMatch(userAnswer, true) ===
          strategy.normalizeAnswerForExactMatch(expectedZh, true)
        : Boolean(normalizeGameText(expectedZh) && cleanUser === normalizeGameText(expectedZh));
    if (expectedZh && isExactMatch) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
    if (safeLang === 'zh' && normalizeGameText(expectedZh) && !hasSameCharMultiset(userAnswer, expectedZh)) {
      return {
        isCorrect: false,
        feedback: 'Câu ghép chưa khớp đủ tập từ của đề bài.',
        suggestion: expectedZh || null,
        source: 'local',
        aiUsed: false,
      };
    }
  } else if (direction === 'vi_to_en') {
    const normUserEn = strategy.normalizeAnswerForExactMatch(userAnswer, true);
    const normExpectedEn = strategy.normalizeAnswerForExactMatch(expectedZh, true);
    if (normExpectedEn && normUserEn === normExpectedEn) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
    const expWords = tokenizeGameWords(expectedZh);
    const usrWords = tokenizeGameWords(userAnswer);
    if (expWords.length >= 4 && usrWords.length < Math.max(2, Math.ceil(expWords.length * 0.35))) {
      return {
        isCorrect: false,
        feedback: 'Câu tiếng Anh còn quá ngắn hoặc thiếu ý chính của đề bài.',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
  } else if (direction === 'vi_to_zh') {
    const cleanZh = normalizeGameText(expectedZh);
    const cleanPy = normalizeGameText(expectedPy);
    const cleanUserNoTone = stripGamePinyinTones(userAnswer);
    const cleanPyNoTone = stripGamePinyinTones(expectedPy);

    if (
      (cleanZh && cleanUser === cleanZh) ||
      (cleanPy && (cleanUser === cleanPy || cleanUserNoTone === cleanPyNoTone))
    ) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }

    const userHasHanzi = /[\u4e00-\u9fff]/.test(userAnswer);
    if (userHasHanzi) {
      if (cleanZh.length >= 4 && cleanUser.length < Math.max(2, Math.floor(cleanZh.length * 0.45))) {
        return {
          isCorrect: false,
          feedback: 'Câu trả lời còn thiếu nội dung so với đề bài.',
          suggestion: null,
          source: 'local',
          aiUsed: false,
        };
      }
    } else if (
      cleanPyNoTone.length >= 8 &&
      cleanUserNoTone.length < Math.max(4, Math.floor(cleanPyNoTone.length * 0.45))
    ) {
      return {
        isCorrect: false,
        feedback: 'Phần Pinyin còn quá ngắn hoặc chưa dịch đủ hết câu.',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
  } else {
    const cleanExpectedMeaning = normalizeGameText(expectedMeaning);
    if (cleanExpectedMeaning && cleanUser === cleanExpectedMeaning) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
    const expectedWords = tokenizeGameWords(expectedMeaning);
    const userWords = tokenizeGameWords(userAnswer);
    if (
      cleanUser.length < 2 ||
      (expectedWords.length >= 4 &&
        userWords.length < Math.max(2, Math.ceil(expectedWords.length * 0.35)))
    ) {
      return {
        isCorrect: false,
        feedback: 'Bản dịch còn quá ngắn hoặc thiếu ý chính của câu.',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
  }

  // --- Tier 2: Persistent / RAM Cache Lookup (~10ms, 0 token) ---
  const normalizedCacheAnswer =
    params.mode === 'scramble'
      ? safeLang === 'en'
        ? strategy.normalizeAnswerForExactMatch(userAnswer, true)
        : cleanUser
      : direction === 'vi_to_zh'
        ? /[\u4e00-\u9fff]/.test(userAnswer)
          ? cleanUser
          : stripGamePinyinTones(userAnswer)
        : direction === 'vi_to_en'
          ? strategy.normalizeAnswerForExactMatch(userAnswer, true)
          : userAnswer.toLowerCase().replace(/\s+/g, ' ');

  const cacheKey = buildGameGradingCacheKey(
    params.mode,
    params.exerciseId || normalizeGameText(params.promptText).slice(0, 64),
    direction,
    normalizedCacheAnswer,
    safeLang
  );

  try {
    const cached = await getCachedGameGrade(cacheKey);
    if (cached) {
      return {
        isCorrect: cached.isCorrect,
        feedback: cached.feedback,
        suggestion: cached.suggestion,
        source: 'cache',
        aiUsed: true,
      };
    }
  } catch (err) {
    console.warn('[AI Game Grade] Không đọc được cache, tiếp tục xử lý:', err);
  }

  // --- Tier 3: AI Semantic Grader Fallback ---
  if (!isAiConfigured()) {
    console.warn('[AI Game Grade] AI chưa được cấu hình, fallback chấm local.');
    return {
      isCorrect: false,
      feedback: '',
      suggestion: null,
      source: 'local_fallback',
      aiUsed: false,
    };
  }

  if (params.canConsumeAiQuota && !params.canConsumeAiQuota()) {
    return {
      isCorrect: false,
      feedback: '',
      suggestion: null,
      source: 'local_fallback',
      aiUsed: false,
    };
  }

  const { systemInstruction, userPrompt } = strategy.buildGameGradingPrompts({
    mode: params.mode,
    direction,
    promptText: params.promptText,
    expectedTarget: expectedZh,
    expectedPhonetic: expectedPy,
    expectedMeaning,
    userAnswer,
  });

  try {
    const { text, usedModel } = await generateAiResponse({
      systemInstruction,
      userPrompt,
      jsonMode: true,
      temperature: 0,
      maxOutputTokens: 520,
    });

    const parsed = parseJsonObject(text);
    const isCorrect = Boolean(parsed.isCorrect);
    const rawFeedback =
      typeof parsed.feedback === 'string'
        ? parsed.feedback
            .trim()
            .replace(
              /^(?:chính xác|đúng rồi|rất tốt|tuyệt vời|chưa chính xác|chưa khớp|chưa đúng(?:\s+thứ\s+tự)?|sai rồi)\s*[!.,:\-–—]*\s*/iu,
              ''
            )
            .trim()
        : '';
    const normalizedFeedback = rawFeedback
      ? rawFeedback.charAt(0).toUpperCase() + rawFeedback.slice(1)
      : '';
    const feedback =
      normalizedFeedback.slice(0, 280) ||
      (isCorrect
        ? 'Cách diễn đạt này đúng ngữ pháp và sát nghĩa với đề bài.'
        : 'Câu trả lời chưa khớp nghĩa hoặc ngữ pháp với đề bài.');
    const suggestion =
      typeof parsed.suggestion === 'string' && parsed.suggestion.trim()
        ? parsed.suggestion.trim().slice(0, 280)
        : null;

    await saveCachedGameGrade({
      cacheKey,
      languageCode: safeLang,
      gameMode: params.mode,
      direction,
      exerciseId: params.exerciseId || 'unknown',
      userAnswer,
      isCorrect,
      feedback,
      suggestion,
      model: usedModel,
    }).catch((err) => {
      console.warn('[AI Game Grade] Không lưu được cache:', err);
    });

    return {
      isCorrect,
      feedback,
      suggestion,
      source: 'ai',
      aiUsed: true,
    };
  } catch (err) {
    console.warn('[AI Game Grade] Lỗi gọi AI, fallback local:', err);
    return {
      isCorrect: false,
      feedback: '',
      suggestion: null,
      source: 'local_fallback',
      aiUsed: false,
    };
  }
}

export interface QuickLookupWordParams {
  word: string;
  context?: string;
  lang?: LanguageCode;
  userId?: string;
  canConsumeAiQuota?: () => boolean;
}

export async function quickLookupChineseWord(
  params: QuickLookupWordParams
): Promise<QuickLookupResult> {
  const safeLang = normalizeLanguageCode(params.lang);
  const strategy = getLanguageStrategy(safeLang);
  const cleanWord = strategy.cleanQuickLookupWord(params.word);
  const maxLen = safeLang === 'en' ? 40 : 12;
  if (!cleanWord || cleanWord.length > maxLen) {
    return { entry: null, source: 'unavailable' };
  }

  const cacheDir: TranslationDirection = safeLang === 'en' ? 'en_vi' : 'zh_vi';

  // --- Tier 1: Tra trực tiếp kho từ vựng DB (< 5ms, 0 token) ---
  try {
    const hits = await searchAllVocabulary(cleanWord, params.userId, safeLang);
    const exact = hits.find((h) => {
      if (safeLang === 'en') {
        return h.hanzi.trim().toLowerCase() === cleanWord.toLowerCase();
      }
      const normalizedHead = h.hanzi
        .replace(/\([^)]*\)|（[^）]*）/g, '')
        .split(/[/／、,，]/)
        .map((p) => p.replace(/[^\u4e00-\u9fff]/g, '').trim());
      return normalizedHead.includes(cleanWord);
    });
    if (exact) {
      return {
        entry: {
          hanzi: exact.hanzi,
          pinyin: exact.pinyin || '',
          sinoVietnamese: exact.sinoVietnamese || null,
          meaning: exact.meaning || '',
          wordType: exact.type || null,
          source: 'db',
        },
        source: 'db',
      };
    }
  } catch (err) {
    console.warn('[Quick Lookup] Lỗi tra DB, chuyển sang cache:', err);
  }

  // --- Tier 2: Tra translation_cache dùng chung (~10ms, 0 token) ---
  try {
    const cached =
      (await getCachedTranslation(cacheDir, cleanWord, safeLang)) ||
      (await getCachedTranslation(cacheDir, `quick::${cleanWord}`, safeLang));
    if (cached?.payload?.meaning) {
      return {
        entry: {
          hanzi: cached.payload.hanzi || cleanWord,
          pinyin: cached.payload.pinyin || '',
          sinoVietnamese: cached.payload.sinoVietnamese || null,
          meaning: cached.payload.meaning,
          wordType: cached.payload.wordType || null,
          source: 'cache',
        },
        source: 'cache',
      };
    }
  } catch (err) {
    console.warn('[Quick Lookup] Lỗi đọc translation_cache, chuyển sang AI:', err);
  }

  // --- Tier 3: Gọi AI siêu gọn (~120 token) & lưu vào translation_cache ---
  if (!isAiConfigured()) {
    console.warn('[Quick Lookup] AI chưa được cấu hình, bỏ qua tra nhanh AI.');
    return { entry: null, source: 'unavailable' };
  }
  if (params.canConsumeAiQuota && !params.canConsumeAiQuota()) {
    return { entry: null, source: 'unavailable' };
  }

  const { systemInstruction, userPrompt } = strategy.buildQuickLookupPrompts({
    word: cleanWord,
    context: params.context,
  });

  try {
    const { text, usedModel } = await generateAiResponse({
      systemInstruction,
      userPrompt,
      jsonMode: true,
      temperature: 0.1,
      maxOutputTokens: 220,
    });

    const parsed = parseJsonObject(text);
    const meaning = typeof parsed.meaning === 'string' ? parsed.meaning.trim().slice(0, 140) : '';
    if (!meaning) {
      return { entry: null, source: 'unavailable' };
    }

    const entry: VocabGlossaryItem = {
      hanzi:
        typeof parsed.hanzi === 'string' && parsed.hanzi.trim()
          ? parsed.hanzi.trim().slice(0, 60)
          : cleanWord,
      pinyin: typeof parsed.pinyin === 'string' ? parsed.pinyin.trim().slice(0, 80) : '',
      sinoVietnamese:
        typeof parsed.sinoVietnamese === 'string' && parsed.sinoVietnamese.trim()
          ? parsed.sinoVietnamese.trim().slice(0, 80)
          : null,
      meaning,
      wordType:
        typeof parsed.wordType === 'string' && parsed.wordType.trim()
          ? parsed.wordType.trim().slice(0, 40)
          : null,
      source: 'ai',
    };

    const cachePayload: AiDictionaryEntry = {
      query: cleanWord,
      direction: cacheDir,
      detectedLanguage: safeLang,
      isSentence: false,
      hanzi: entry.hanzi,
      pinyin: entry.pinyin,
      sinoVietnamese: entry.sinoVietnamese,
      wordType: entry.wordType,
      meaning: entry.meaning,
      meanings: [entry.meaning],
      radical: null,
      breakdown: null,
      mnemonic: null,
      grammarNote: null,
      examples: [],
    };
    await saveCachedTranslation(cacheDir, `quick::${cleanWord}`, usedModel, cachePayload, safeLang).catch(
      (err) => {
        console.warn('[Quick Lookup] Không lưu được cache:', err);
      }
    );

    return { entry, source: 'ai' };
  } catch (err) {
    console.warn('[Quick Lookup] Lỗi gọi AI:', err);
    return { entry: null, source: 'unavailable' };
  }
}
