import { Router } from 'express';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const router = Router();

const MAX_CACHE_ITEMS = 500;
const EDGE_FEMALE_VOICE = 'zh-CN-XiaoxiaoNeural';
const EDGE_MALE_VOICE = 'zh-CN-YunxiNeural';
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

function parseDialogueSegments(
  text: string,
  defaultVoice: string
): Array<{ voice: string; content: string }> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const speakerRegex = /^\s*([A-Za-z0-9\u4e00-\u9fff]{1,10})\s*[:：]\s*(.+)$/;
  const parsed = lines.map((line) => {
    const match = line.match(speakerRegex);
    return match ? { speaker: match[1].trim(), content: match[2].trim() } : null;
  });

  if (lines.length >= 2 && parsed.filter(Boolean).length >= 2) {
    const speakerVoiceMap = new Map<string, string>();
    const segments: Array<{ voice: string; content: string }> = [];

    for (let i = 0; i < lines.length && segments.length < 8; i++) {
      const item = parsed[i];
      if (!item) {
        segments.push({ voice: defaultVoice, content: lines[i] });
        continue;
      }

      let voice = speakerVoiceMap.get(item.speaker);
      if (!voice) {
        if (/^(女|b|2|f|she|her|s2)$/i.test(item.speaker)) {
          voice = EDGE_FEMALE_VOICE;
        } else if (/^(男|a|1|m|he|him|s1)$/i.test(item.speaker)) {
          voice = EDGE_MALE_VOICE;
        } else {
          voice = speakerVoiceMap.size % 2 === 0 ? EDGE_MALE_VOICE : EDGE_FEMALE_VOICE;
        }
        speakerVoiceMap.set(item.speaker, voice);
      }
      if (item.content) {
        segments.push({ voice, content: item.content });
      }
    }

    if (segments.length > 0) return segments;
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

  const voiceParam = req.query.voice === 'male' ? 'male' : 'female';
  const defaultVoice = voiceParam === 'male' ? EDGE_MALE_VOICE : EDGE_FEMALE_VOICE;
  const text = rawText.slice(0, 800);
  const cacheKey = `${voiceParam}:${text}`;
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
    const fallbackText = text.slice(0, 220);
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
