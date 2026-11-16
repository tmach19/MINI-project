// Web Audio API Sound Effects & Chinese TTS (Backend MP3 proxy + Web Speech fallback)

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

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

export function getChineseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'zh-CN' || v.lang === 'cmn-Hans-CN') ||
    voices.find((v) => v.lang?.startsWith('zh')) ||
    null
  );
}

function fallbackSpeechSynthesis(text: string, rate: number, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = rate;
  const voice = getChineseVoice();
  if (voice) utterance.voice = voice;
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
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

export function speakChinese(text: string, rate = 0.9, onEnd?: () => void): void {
  const clean = text.trim();
  if (!clean) {
    onEnd?.();
    return;
  }

  stopChineseSpeech();
  const seq = playSeq;
  const controller = new AbortController();
  currentAbort = controller;

  const url = `${API_BASE}/tts?text=${encodeURIComponent(clean)}`;

  fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
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
          fallbackSpeechSynthesis(clean, rate, onEnd);
        }
      };

      await audio.play();
    })
    .catch((err) => {
      if (seq !== playSeq || (err as Error).name === 'AbortError') return;
      console.warn('[TTS] /api/tts failed, falling back to speechSynthesis:', err);
      fallbackSpeechSynthesis(clean, rate, onEnd);
    });
}
