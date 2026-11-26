// Web Audio API Sound Effects & Multi-language TTS (MP3 CDN / Backend MP3 proxy + Web Speech fallback)
import type { LanguageCode, TextItem } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');
const EN_API_BASE = (import.meta.env.VITE_EN_API_BASE || '/api-en').replace(/\/+$/, '');

export type TtsVoiceKey =
  | 'female'
  | 'male'
  | 'female1'
  | 'female2'
  | 'male1'
  | 'male2'
  | 'male3';

const FEMALE_SPEAKER_RE =
  /^(女|b|2|f|she|her|s2|lan|ngọc lan|范玉兰|兰兰|annie|安妮|tuyết|白茹雪|cô|cô bán|chị|bà|mẹ|em gái|nữ|售货员)/i;
const SENIOR_MALE_SPEAKER_RE =
  /^(thầy|thầy lưu|刘老师|老师|bác|ông|bố|cha|ba|doctor|bác sĩ|医生|chú)/i;
const MALE_SPEAKER_RE =
  /^(男|a|1|m|he|him|s1|minh|nhật minh|a minh|阮日明|mark|马克|phong|trương phong|张风|nam|anh)/i;
const MULTI_SPEAKER_ORDER: TtsVoiceKey[] = ['female1', 'male1', 'female2', 'male2', 'male3'];

export function buildSpeakerVoiceMap(speakers: string[]): Record<string, TtsVoiceKey> {
  const result: Record<string, TtsVoiceKey> = {};
  const used = new Set<TtsVoiceKey>();

  const pickFirstUnused = (candidates: TtsVoiceKey[]): TtsVoiceKey | null => {
    for (const c of candidates) {
      if (!used.has(c)) return c;
    }
    return null;
  };

  for (const raw of speakers) {
    const speaker = raw.trim();
    if (!speaker || result[speaker]) continue;

    const assignedCount = Object.keys(result).length;
    let voice: TtsVoiceKey;
    if (FEMALE_SPEAKER_RE.test(speaker)) {
      voice =
        pickFirstUnused(['female1', 'female2']) ||
        (assignedCount % 2 === 0 ? 'female1' : 'female2');
    } else if (SENIOR_MALE_SPEAKER_RE.test(speaker)) {
      voice = pickFirstUnused(['male2', 'male3', 'male1']) || 'male2';
    } else if (MALE_SPEAKER_RE.test(speaker)) {
      voice =
        pickFirstUnused(['male1', 'male2', 'male3']) ||
        (assignedCount % 2 === 0 ? 'male1' : 'male2');
    } else {
      voice =
        pickFirstUnused(MULTI_SPEAKER_ORDER) ||
        MULTI_SPEAKER_ORDER[assignedCount % MULTI_SPEAKER_ORDER.length];
    }
    result[speaker] = voice;
    used.add(voice);
  }

  return result;
}

/**
 * Khớp đoạn audioText với các câu thoại trong bài khoá để gắn nhãn người nói (hỗ trợ 2, 3, 4+ giọng đọc).
 */
export function resolveDialogueTtsText(audioText: string, texts?: TextItem[]): string {
  const raw = audioText.trim();
  if (!raw || !texts || texts.length === 0) return raw;

  // Nếu đã có nhãn "Speaker: ..." nhiều dòng thì giữ nguyên
  const rawLines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const speakerLineRe = /^\s*([^:：，。！？,.!?]{1,24})\s*[:：]\s*(.+)$/;
  if (rawLines.length >= 2 && rawLines.filter((l) => speakerLineRe.test(l)).length >= 2) {
    return raw;
  }

  const turns =
    rawLines.length >= 2
      ? rawLines
      : raw.split(/(?<=[。！？!?])\s+/).map((t) => t.trim()).filter(Boolean);

  if (turns.length < 2) return raw;

  const sentenceSpeakerMap = new Map<string, string>();
  for (const t of texts) {
    for (const s of t.sentences || []) {
      const sp = (s.speaker || '').trim();
      const hz = (s.hanzi || '').replace(/\s+/g, '');
      if (sp && hz && !sentenceSpeakerMap.has(hz)) {
        sentenceSpeakerMap.set(hz, sp);
      }
    }
  }

  let matchCount = 0;
  const tagged = turns.map((turn, idx) => {
    const norm = turn.replace(/\s+/g, '');
    const sp = sentenceSpeakerMap.get(norm);
    if (sp) {
      matchCount += 1;
      return `${sp}: ${turn}`;
    }
    return `${idx % 2 === 0 ? 'Người A' : 'Người B'}: ${turn}`;
  });

  return matchCount > 0 ? tagged.join('\n') : raw;
}

class SoundEffects {
  private ctx: AudioContext | null = null;

  private ensureContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playCorrect(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.09);
      osc.frequency.setValueAtTime(783.99, now + 0.18);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc.start(now);
      osc.stop(now + 0.38);
    } catch {
      // ignore
    }
  }

  playWrong(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(140, now + 0.25);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      // ignore
    }
  }

  playFlip(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.07);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // ignore
    }
  }

  playVictory(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const now = ctx.currentTime + idx * 0.11;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      });
    } catch {
      // ignore
    }
  }
}

export const soundFx = new SoundEffects();

let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;
let currentAbort: AbortController | null = null;
let playSeq = 0;

function getChineseVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  return voices.filter((v) => v.lang === 'zh-CN' || v.lang === 'cmn-Hans-CN' || v.lang?.startsWith('zh'));
}

export function getChineseVoice(): SpeechSynthesisVoice | null {
  const zhVoices = getChineseVoices();
  return zhVoices[0] || null;
}

function getPitchForVoice(voice?: TtsVoiceKey): number {
  switch (voice) {
    case 'male':
    case 'male1':
      return 0.88;
    case 'male2':
      return 0.78;
    case 'male3':
      return 0.92;
    case 'female2':
      return 1.12;
    default:
      return 1.02;
  }
}

function stripSpeakerLabelsForSpeech(raw: string): Array<{ text: string; voiceHint?: TtsVoiceKey }> {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const speakerRe = /^\s*([^:：，。！？,.!?]{1,24})\s*[:：]\s*(.+)$/;
  const parsed = lines.map((l) => l.match(speakerRe));

  if (lines.length >= 2 && parsed.filter(Boolean).length >= 2) {
    const speakers = parsed.map((m) => (m ? m[1].trim() : ''));
    const voiceMap = buildSpeakerVoiceMap(speakers.filter(Boolean));
    return lines.map((l, idx) => {
      const m = parsed[idx];
      if (!m) return { text: l };
      return { text: m[2].trim(), voiceHint: voiceMap[m[1].trim()] };
    });
  }

  if (lines.length >= 2) {
    return lines.map((l, idx) => ({
      text: l,
      voiceHint: idx % 2 === 0 ? 'female1' : 'male1',
    }));
  }

  return [{ text: raw }];
}

function fallbackSpeechSynthesis(
  text: string,
  rate: number,
  onEnd?: () => void,
  voiceKey?: TtsVoiceKey
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const zhVoices = getChineseVoices();
  const segments = stripSpeakerLabelsForSpeech(text);
  const seq = playSeq;

  const speakNext = (idx: number) => {
    if (seq !== playSeq) return;
    if (idx >= segments.length) {
      onEnd?.();
      return;
    }
    const seg = segments[idx];
    const effectiveVoiceKey = seg.voiceHint || voiceKey;
    const utterance = new SpeechSynthesisUtterance(seg.text);
    utterance.lang = 'zh-CN';
    utterance.rate = rate;
    utterance.pitch = getPitchForVoice(effectiveVoiceKey);
    if (zhVoices.length > 0) {
      const vIdx =
        effectiveVoiceKey === 'male' || effectiveVoiceKey === 'male1' || effectiveVoiceKey === 'male2'
          ? Math.min(1, zhVoices.length - 1)
          : 0;
      utterance.voice = zhVoices[vIdx];
    }
    utterance.onend = () => speakNext(idx + 1);
    utterance.onerror = () => speakNext(idx + 1);
    window.speechSynthesis.speak(utterance);
  };

  speakNext(0);
}

export function stopChineseSpeech(): void {
  playSeq += 1;
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function fetchAndPlayTts(
  url: string,
  rate: number,
  onEnd: (() => void) | undefined,
  onFallback: () => void
): void {
  stopChineseSpeech();
  const seq = playSeq;
  const controller = new AbortController();
  currentAbort = controller;

  fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error('TTS endpoint returned HTML');
      }
      const blob = await res.blob();
      if (seq !== playSeq) return;

      const blobUrl = URL.createObjectURL(blob);
      currentBlobUrl = blobUrl;

      const audio = new Audio(blobUrl);
      audio.playbackRate = Math.min(2, Math.max(0.5, rate));
      currentAudio = audio;

      const cleanup = () => {
        if (currentBlobUrl === blobUrl) {
          URL.revokeObjectURL(blobUrl);
          currentBlobUrl = null;
        }
        if (currentAudio === audio) {
          currentAudio = null;
        }
      };

      audio.onended = () => {
        cleanup();
        if (seq === playSeq) onEnd?.();
      };

      audio.onerror = () => {
        cleanup();
        if (seq === playSeq) {
          console.warn('[TTS] Audio element failed, falling back to speechSynthesis');
          onFallback();
        }
      };

      await audio.play();
    })
    .catch((err) => {
      if (seq !== playSeq || (err as Error).name === 'AbortError') return;
      console.warn('[TTS] /api/tts failed, falling back to speechSynthesis:', err);
      onFallback();
    });
}

export function speakChinese(
  text: string,
  rate = 1,
  onEnd?: () => void,
  voice?: TtsVoiceKey
): void {
  const clean = text.trim();
  if (!clean) {
    onEnd?.();
    return;
  }

  const voiceQuery = voice ? `&voice=${encodeURIComponent(voice)}` : '';
  const url = `${API_BASE}/tts?text=${encodeURIComponent(clean)}${voiceQuery}`;
  fetchAndPlayTts(url, rate, onEnd, () => fallbackSpeechSynthesis(clean, rate, onEnd, voice));
}

function getEnglishVoices(accent: 'us' | 'uk' = 'us'): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  const preferredLang = accent === 'uk' ? 'en-GB' : 'en-US';
  const exact = voices.filter((v) => v.lang?.toLowerCase() === preferredLang.toLowerCase());
  const anyEn = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  return exact.length > 0 ? [...exact, ...anyEn.filter((v) => !exact.includes(v))] : anyEn;
}

function fallbackEnglishSpeechSynthesis(
  text: string,
  accent: 'us' | 'uk' = 'us',
  rate = 1,
  onEnd?: () => void,
  voiceKey?: TtsVoiceKey
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const enVoices = getEnglishVoices(accent);
  const segments = stripSpeakerLabelsForSpeech(text);
  const seq = playSeq;

  const speakNext = (idx: number) => {
    if (seq !== playSeq) return;
    if (idx >= segments.length) {
      onEnd?.();
      return;
    }
    const seg = segments[idx];
    const effectiveVoiceKey = seg.voiceHint || voiceKey;
    const utterance = new SpeechSynthesisUtterance(seg.text);
    utterance.lang = accent === 'uk' ? 'en-GB' : 'en-US';
    utterance.rate = Math.min(2, Math.max(0.5, rate));
    utterance.pitch = getPitchForVoice(effectiveVoiceKey);
    if (enVoices.length > 0) {
      const vIdx =
        effectiveVoiceKey === 'male' || effectiveVoiceKey === 'male1' || effectiveVoiceKey === 'male2'
          ? Math.min(1, enVoices.length - 1)
          : 0;
      utterance.voice = enVoices[vIdx];
    }
    utterance.onend = () => speakNext(idx + 1);
    utterance.onerror = () => speakNext(idx + 1);
    window.speechSynthesis.speak(utterance);
  };

  speakNext(0);
}

/**
 * Phát trực tiếp file MP3 từ CDN (vd: Supabase Storage public URL).
 * Nếu lỗi mạng/404/autoplay, tự động gọi onFallback (Web Speech API).
 */
export function playAudioUrl(
  url: string,
  rate = 1,
  onEnd?: () => void,
  onFallback?: () => void
): void {
  const cleanUrl = (url || '').trim();
  if (!cleanUrl) {
    if (onFallback) onFallback();
    else onEnd?.();
    return;
  }

  stopChineseSpeech();
  const seq = playSeq;
  const audio = new Audio(cleanUrl);
  audio.playbackRate = Math.min(2, Math.max(0.5, rate));
  currentAudio = audio;

  const cleanup = () => {
    if (currentAudio === audio) {
      currentAudio = null;
    }
  };

  let handledError = false;
  const handleFail = () => {
    if (handledError) return;
    handledError = true;
    cleanup();
    if (seq === playSeq) {
      if (onFallback) onFallback();
      else onEnd?.();
    }
  };

  audio.onended = () => {
    cleanup();
    if (seq === playSeq) onEnd?.();
  };

  audio.onerror = handleFail;

  audio.play().catch(handleFail);
}

function speakEnglishViaEdgeTts(
  text: string,
  accent: 'us' | 'uk',
  rate: number,
  onEnd?: () => void,
  voice?: TtsVoiceKey
): void {
  const clean = text.trim();
  if (!clean) {
    onEnd?.();
    return;
  }

  const voiceQuery = voice ? `&voice=${encodeURIComponent(voice)}` : '';
  const url = `${EN_API_BASE}/tts?text=${encodeURIComponent(clean)}&accent=${encodeURIComponent(accent)}${voiceQuery}`;
  fetchAndPlayTts(url, rate, onEnd, () =>
    fallbackEnglishSpeechSynthesis(clean, accent, rate, onEnd, voice)
  );
}

export function speakEnglish(
  text: string,
  options?: {
    accent?: 'us' | 'uk';
    rate?: number;
    audioUrl?: string | null;
    onEnd?: () => void;
    voice?: TtsVoiceKey;
  }
): void {
  const clean = (text || '').trim();
  const accent = options?.accent || 'us';
  const rate = options?.rate ?? 1;
  const onEnd = options?.onEnd;
  const voice = options?.voice;
  const audioUrl = options?.audioUrl?.trim() || null;

  if (!clean && !audioUrl) {
    onEnd?.();
    return;
  }

  if (audioUrl) {
    playAudioUrl(audioUrl, rate, onEnd, () => {
      if (clean) speakEnglishViaEdgeTts(clean, accent, rate, onEnd, voice);
      else onEnd?.();
    });
    return;
  }

  speakEnglishViaEdgeTts(clean, accent, rate, onEnd, voice);
}

export function speakText(
  text: string,
  lang: LanguageCode = 'zh',
  options?: {
    accent?: 'us' | 'uk';
    rate?: number;
    audioUrl?: string | null;
    onEnd?: () => void;
    voice?: TtsVoiceKey;
  }
): void {
  if (lang === 'en') {
    speakEnglish(text, options);
    return;
  }
  speakChinese(text, options?.rate ?? 1, options?.onEnd, options?.voice);
}

export const stopSpeech = stopChineseSpeech;
