import { Router } from 'express';

const router = Router();

const MAX_CACHE_ITEMS = 500;
const audioCache = new Map<string, Buffer>();

function setCache(key: string, buf: Buffer): void {
  if (audioCache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey) audioCache.delete(oldestKey);
  }
  audioCache.set(key, buf);
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

  const text = rawText.slice(0, 300);
  const cached = audioCache.get(text);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(cached);
    return;
  }

  const encoded = encodeURIComponent(text);
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

  let audioBuf: Buffer | null = null;
  for (const p of providers) {
    audioBuf = await fetchAudioBuffer(p.url, p.referer);
    if (audioBuf) break;
  }

  if (!audioBuf) {
    res.status(502).json({ error: 'Không tải được audio TTS từ dịch vụ bên ngoài.' });
    return;
  }

  setCache(text, audioBuf);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(audioBuf);
});

export default router;
