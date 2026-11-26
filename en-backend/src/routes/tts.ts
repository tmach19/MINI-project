import { Router } from 'express';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const router = Router();

const MAX_CACHE_ITEMS = 500;
const MAX_TTS_TEXT_LENGTH = 1500;
const MAX_DIALOGUE_SEGMENTS = 16;

type Accent = 'us' | 'uk';

const EDGE_VOICES_BY_ACCENT = {
  us: {
    female: 'en-US-JennyNeural',
    female1: 'en-US-JennyNeural',
    female2: 'en-US-AriaNeural',
    male: 'en-US-GuyNeural',
    male1: 'en-US-GuyNeural',
    male2: 'en-US-ChristopherNeural',
    male3: 'en-US-AndrewNeural',
  },
  uk: {
    female: 'en-GB-SoniaNeural',
    female1: 'en-GB-SoniaNeural',
    female2: 'en-GB-LibbyNeural',
    male: 'en-GB-RyanNeural',
    male1: 'en-GB-RyanNeural',
    male2: 'en-GB-ThomasNeural',
    male3: 'en-GB-RyanNeural',
  },
} as const;

type EdgeVoiceKey = keyof (typeof EDGE_VOICES_BY_ACCENT)['us'];

const FEMALE_SPEAKER_RE =
  /^(b|2|f|she|her|s2|woman|girl|female|mother|mom|mum|sister|aunt|grandma|ms|mrs|miss|waitress|nurse|receptionist|anna|amy|alice|chloe|claire|emily|emma|grace|hannah|jenny|julia|kate|laura|lily|lisa|lucy|maria|mary|mia|olivia|rachel|sarah|sophia|susan|cô|chị|bà|mẹ|em gái|nữ)/i;
const SENIOR_MALE_SPEAKER_RE =
  /^(professor|prof|teacher|doctor|dr|boss|manager|officer|grandpa|grandfather|uncle|father|dad|thầy|bác|ông|bố|cha|bác sĩ|chú)/i;
const MALE_SPEAKER_RE =
  /^(a|1|m|he|him|s1|man|boy|male|brother|mr|waiter|alex|ben|chris|dan|daniel|david|eric|george|henry|jack|james|john|kevin|liam|luke|mark|matt|michael|mike|nick|paul|peter|ryan|sam|tom|nam|anh)/i;

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

function pickVoiceForSpeaker(
  speaker: string,
  accent: Accent,
  speakerVoiceMap: Map<string, string>
): string {
  const clean = speaker.trim();
  const existing = speakerVoiceMap.get(clean);
  if (existing) return existing;

  const voices = EDGE_VOICES_BY_ACCENT[accent];
  const usedVoices = new Set(speakerVoiceMap.values());
  const pickFirstUnused = (candidates: EdgeVoiceKey[]): string | null => {
    for (const k of candidates) {
      const v = voices[k];
      if (!usedVoices.has(v)) return v;
    }
    return null;
  };

  let chosen: string | null = null;
  if (FEMALE_SPEAKER_RE.test(clean)) {
    chosen =
      pickFirstUnused(['female1', 'female2']) ||
      voices[speakerVoiceMap.size % 2 === 0 ? 'female1' : 'female2'];
  } else if (SENIOR_MALE_SPEAKER_RE.test(clean)) {
    chosen = pickFirstUnused(['male2', 'male3', 'male1']) || voices.male2;
  } else if (MALE_SPEAKER_RE.test(clean)) {
    chosen =
      pickFirstUnused(['male1', 'male2', 'male3']) ||
      voices[speakerVoiceMap.size % 2 === 0 ? 'male1' : 'male2'];
  } else {
    chosen =
      pickFirstUnused(MULTI_SPEAKER_FALLBACK_ORDER) ||
      voices[
        MULTI_SPEAKER_FALLBACK_ORDER[speakerVoiceMap.size % MULTI_SPEAKER_FALLBACK_ORDER.length]
      ];
  }

  speakerVoiceMap.set(clean, chosen);
  return chosen;
}

export function parseDialogueSegments(
  text: string,
  accent: Accent,
  defaultVoice: string
): Array<{ voice: string; content: string }> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const speakerRegex = /^\s*([^:：，。！？,.!?]{1,24})\s*[:：]\s*(.+)$/;
  const parsed = lines.map((line) => {
    const match = line.match(speakerRegex);
    return match ? { speaker: match[1].trim(), content: match[2].trim() } : null;
  });

  // 1. Multi-line dialogue with explicit speaker labels ("Emma: ...", "Tom: ...")
  if (lines.length >= 2 && parsed.filter(Boolean).length >= 2) {
    const speakerVoiceMap = new Map<string, string>();
    const segments: Array<{ voice: string; content: string }> = [];

    for (let i = 0; i < lines.length && segments.length < MAX_DIALOGUE_SEGMENTS; i++) {
      const item = parsed[i];
      if (!item) {
        segments.push({ voice: defaultVoice, content: lines[i] });
        continue;
      }

      const voice = pickVoiceForSpeaker(item.speaker, accent, speakerVoiceMap);
      if (item.content) {
        segments.push({ voice, content: item.content });
      }
    }

    if (segments.length > 0) return segments;
  }

  // 2. Multi-line dialogue without speaker labels -> alternate female1 / male1
  if (lines.length >= 2) {
    const voices = EDGE_VOICES_BY_ACCENT[accent];
    return lines.slice(0, MAX_DIALOGUE_SEGMENTS).map((line, idx) => ({
      voice: idx % 2 === 0 ? voices.female1 : voices.male1,
      content: line,
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
  accent: Accent,
  defaultVoice: string
): Promise<Buffer | null> {
  try {
    const segments = parseDialogueSegments(text, accent, defaultVoice);
    const buffers = await Promise.all(
      segments.map((seg) => synthesizeEdgeSegment(seg.content, seg.voice))
    );
    const combined = Buffer.concat(buffers);
    return combined.length >= 200 ? combined : null;
  } catch (err) {
    console.warn('[EN-TTS] Edge Neural TTS failed, falling back:', (err as Error).message);
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

  const rawAccent = String(req.query.accent || '').trim().toLowerCase();
  const accent: Accent = rawAccent === 'uk' || rawAccent === 'gb' || rawAccent === 'en-gb' ? 'uk' : 'us';

  const voices = EDGE_VOICES_BY_ACCENT[accent];
  const rawVoice = String(req.query.voice || '').trim().toLowerCase();
  const voiceKey: EdgeVoiceKey = rawVoice in voices ? (rawVoice as EdgeVoiceKey) : 'female1';
  const defaultVoice = voices[voiceKey];

  const text = rawText.slice(0, MAX_TTS_TEXT_LENGTH);
  const cacheKey = `${accent}:${voiceKey}:${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(cached);
    return;
  }

  // 1. Primary: Microsoft Edge Neural TTS (US: Jenny/Guy, UK: Sonia/Ryan)
  let audioBuf: Buffer | null = await synthesizeWithEdgeTts(text, accent, defaultVoice);

  // 2. Fallback: HTTP TTS providers if Edge WebSocket fails
  if (!audioBuf) {
    const cleanSpeech = parseDialogueSegments(text, accent, defaultVoice)
      .map((s) => s.content)
      .join(' ');
    const fallbackText = cleanSpeech.slice(0, 220);
    const encoded = encodeURIComponent(fallbackText);
    const googleLang = accent === 'uk' ? 'en-GB' : 'en-US';
    const youdaoType = accent === 'uk' ? 1 : 2;
    const providers: Array<{ url: string; referer?: string }> = [
      {
        url: `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${googleLang}&q=${encoded}`,
        referer: 'https://translate.google.com/',
      },
      {
        url: `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${googleLang}&q=${encoded}`,
        referer: 'https://translate.google.com/',
      },
      {
        url: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=${youdaoType}`,
        referer: 'https://dict.youdao.com/',
      },
    ];

    for (const p of providers) {
      audioBuf = await fetchAudioBuffer(p.url, p.referer);
      if (audioBuf) break;
    }
  }

  if (!audioBuf) {
    res.status(502).json({ error: 'Không tải được audio TTS tiếng Anh từ dịch vụ bên ngoài.' });
    return;
  }

  setCache(cacheKey, audioBuf);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(audioBuf);
});

export default router;
