import { Router } from 'express';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const router = Router();

const MAX_CACHE_ITEMS = 500;
const MAX_TTS_TEXT_LENGTH = 1500;
const MAX_DIALOGUE_SEGMENTS = 16;

const EDGE_VOICES = {
  female: 'zh-CN-XiaoxiaoNeural',
  female1: 'zh-CN-XiaoxiaoNeural',
  female2: 'zh-CN-XiaoyiNeural',
  male: 'zh-CN-YunxiNeural',
  male1: 'zh-CN-YunxiNeural',
  male2: 'zh-CN-YunjianNeural',
  male3: 'zh-CN-YunyangNeural',
} as const;

type EdgeVoiceKey = keyof typeof EDGE_VOICES;

const FEMALE_SPEAKER_RE =
  /^(女|b|2|f|she|her|s2|lan|ngọc lan|范玉兰|兰兰|annie|安妮|tuyết|白茹雪|cô|cô bán|chị|bà|mẹ|em gái|nữ|售货员)/i;
const SENIOR_MALE_SPEAKER_RE =
  /^(thầy|thầy lưu|刘老师|老师|bác|ông|bố|cha|ba|doctor|bác sĩ|医生|chú)/i;
const MALE_SPEAKER_RE =
  /^(男|a|1|m|he|him|s1|minh|nhật minh|a minh|阮日明|mark|马克|phong|trương phong|张风|nam|anh)/i;

const MULTI_SPEAKER_FALLBACK_ORDER: EdgeVoiceKey[] = [
  'female1',
  'male1',
  'female2',
  'male2',
  'male3',
];

const audioCache = new Map<string, Buffer>();

function setCache(key: string, buf: Buffer): void {
  if (audioCache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey) audioCache.delete(oldestKey);
  }
  audioCache.set(key, buf);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pickVoiceForSpeaker(speaker: string, speakerVoiceMap: Map<string, string>): string {
  const clean = speaker.trim();
  const existing = speakerVoiceMap.get(clean);
  if (existing) return existing;

  const usedVoices = new Set(speakerVoiceMap.values());
  const pickFirstUnused = (candidates: EdgeVoiceKey[]): string | null => {
    for (const k of candidates) {
      const v = EDGE_VOICES[k];
      if (!usedVoices.has(v)) return v;
    }
    return null;
  };

  let chosen: string | null = null;
  if (FEMALE_SPEAKER_RE.test(clean)) {
    chosen =
      pickFirstUnused(['female1', 'female2']) ||
      EDGE_VOICES[speakerVoiceMap.size % 2 === 0 ? 'female1' : 'female2'];
  } else if (SENIOR_MALE_SPEAKER_RE.test(clean)) {
    chosen = pickFirstUnused(['male2', 'male3', 'male1']) || EDGE_VOICES.male2;
  } else if (MALE_SPEAKER_RE.test(clean)) {
    chosen =
      pickFirstUnused(['male1', 'male2', 'male3']) ||
      EDGE_VOICES[speakerVoiceMap.size % 2 === 0 ? 'male1' : 'male2'];
  } else {
    chosen =
      pickFirstUnused(MULTI_SPEAKER_FALLBACK_ORDER) ||
      EDGE_VOICES[MULTI_SPEAKER_FALLBACK_ORDER[speakerVoiceMap.size % MULTI_SPEAKER_FALLBACK_ORDER.length]];
  }

  speakerVoiceMap.set(clean, chosen);
  return chosen;
}

export function parseDialogueSegments(
  text: string,
  defaultVoice: string
): Array<{ voice: string; content: string }> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Hỗ trợ tên người nói có dấu tiếng Việt, khoảng trắng hoặc chữ Hán (vd: "Thầy Lưu:", "Bác sĩ:", "刘老师:")
  const speakerRegex = /^\s*([^:：，。！？,.!?]{1,24})\s*[:：]\s*(.+)$/;
  const parsed = lines.map((line) => {
    const match = line.match(speakerRegex);
    return match ? { speaker: match[1].trim(), content: match[2].trim() } : null;
  });

  // 1. Hội thoại nhiều dòng có nhãn người nói rõ ràng -> gán giọng riêng cho 2, 3, 4, 5+ người tham gia
  if (lines.length >= 2 && parsed.filter(Boolean).length >= 2) {
    const speakerVoiceMap = new Map<string, string>();
    const segments: Array<{ voice: string; content: string }> = [];

    for (let i = 0; i < lines.length && segments.length < MAX_DIALOGUE_SEGMENTS; i++) {
      const item = parsed[i];
      if (!item) {
        segments.push({ voice: defaultVoice, content: lines[i] });
        continue;
      }

      const voice = pickVoiceForSpeaker(item.speaker, speakerVoiceMap);
      if (item.content) {
        segments.push({ voice, content: item.content });
      }
    }

    if (segments.length > 0) return segments;
  }

  // 2. Hội thoại nhiều dòng không ghi tên người nói (vd đề luyện nghe HSK phân tách bằng xuống dòng) -> luân phiên 2 giọng
  if (lines.length >= 2) {
    return lines.slice(0, MAX_DIALOGUE_SEGMENTS).map((line, idx) => ({
      voice: idx % 2 === 0 ? EDGE_VOICES.female1 : EDGE_VOICES.male1,
      content: line,
    }));
  }

  // 3. Một dòng nhưng các lượt thoại ngăn bằng dấu kết câu + khoảng trắng (vd: "...吗？ 早上好！... 。 是，...")
  const spaceTurns = text
    .split(/(?<=[。！？!?])\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (
    spaceTurns.length >= 2 &&
    spaceTurns.filter((t) => /[\u4e00-\u9fff]/.test(t)).length >= 2
  ) {
    return spaceTurns.slice(0, MAX_DIALOGUE_SEGMENTS).map((turn, idx) => ({
      voice: idx % 2 === 0 ? EDGE_VOICES.female1 : EDGE_VOICES.male1,
      content: turn,
    }));
  }

  return [{ voice: defaultVoice, content: text }];
}

async function synthesizeEdgeSegment(content: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({
    connectionTimeoutMs: 6000,
    synthesisTimeoutMs: 10000,
  });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(content));
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}

async function synthesizeWithEdgeTts(
  text: string,
  defaultVoice: string
): Promise<Buffer | null> {
  try {
    const segments = parseDialogueSegments(text, defaultVoice);
    const buffers = await Promise.all(
      segments.map((seg) => synthesizeEdgeSegment(seg.content, seg.voice))
    );
    const combined = Buffer.concat(buffers);
    return combined.length >= 200 ? combined : null;
  } catch (err) {
    console.warn('[TTS] Edge Neural TTS failed, falling back:', (err as Error).message);
    return null;
  }
}

async function fetchAudioBuffer(url: string, referer?: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'audio/mpeg, audio/*, */*',
        ...(referer ? { Referer: referer } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) return null;

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.length < 200) return null;
    return buf;
  } catch {
    return null;
  }
}

router.get('/tts', async (req, res) => {
  const rawText = String(req.query.text || '').trim();
  if (!rawText) {
    res.status(400).json({ error: 'Thiếu tham số text.' });
    return;
  }

  const rawVoice = String(req.query.voice || '').trim().toLowerCase();
  const voiceKey: EdgeVoiceKey =
    rawVoice in EDGE_VOICES ? (rawVoice as EdgeVoiceKey) : 'female1';
  const defaultVoice = EDGE_VOICES[voiceKey];
  const text = rawText.slice(0, MAX_TTS_TEXT_LENGTH);
  const cacheKey = `${voiceKey}:${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(cached);
    return;
  }

  // 1. Primary: Microsoft Edge Neural TTS (XiaoxiaoNeural / YunxiNeural)
  let audioBuf: Buffer | null = await synthesizeWithEdgeTts(text, defaultVoice);

  // 2. Fallback: HTTP TTS providers if Edge WebSocket fails
  if (!audioBuf) {
    const cleanSpeech = parseDialogueSegments(text, defaultVoice)
      .map((s) => s.content)
      .join(' ');
    const fallbackText = cleanSpeech.slice(0, 220);
    const encoded = encodeURIComponent(fallbackText);
    const providers: Array<{ url: string; referer?: string }> = [
      {
        url: `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=zh-CN&q=${encoded}`,
        referer: 'https://translate.google.com/',
      },
      {
        url: `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${encoded}`,
        referer: 'https://translate.google.com/',
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encoded}&spd=4&source=web`,
        referer: 'https://fanyi.baidu.com/',
      },
      {
        url: `https://dict.youdao.com/dictvoice?audio=${encoded}&le=zh`,
        referer: 'https://dict.youdao.com/',
      },
    ];

    for (const p of providers) {
      audioBuf = await fetchAudioBuffer(p.url, p.referer);
      if (audioBuf) break;
    }
  }

  if (!audioBuf) {
    res.status(502).json({ error: 'Không tải được audio TTS từ dịch vụ bên ngoài.' });
    return;
  }

  setCache(cacheKey, audioBuf);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(audioBuf);
});

export default router;
