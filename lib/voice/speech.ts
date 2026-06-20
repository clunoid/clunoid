"use client";

type Alignment = { chars: string[] | null; times: number[] | null };

/**
 * Plays Isaac's speech (ElevenLabs base64 + character timestamps). Exposes:
 *  - live amplitude (0..1) for the orb,
 *  - synced progress (how many characters have been spoken) for caption highlight.
 * Call stop() to interrupt instantly (barge-in).
 */
export class SpeechPlayer {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private onAmplitude?: (v: number) => void;
  private onProgress?: (charIndex: number, total: number) => void;
  private times: number[] | null = null;
  private ptr = 0;

  constructor(onAmplitude?: (v: number) => void) {
    this.onAmplitude = onAmplitude;
  }

  async play(text: string, onProgress?: (charIndex: number, total: number) => void): Promise<void> {
    this.stop();
    if (!text.trim()) return;
    this.onProgress = onProgress;

    let payload: { audio: string } & Alignment;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || res.status === 204) return; // no key / no audio — caption still shows
      payload = await res.json();
    } catch {
      return;
    }
    if (!payload?.audio) return;

    this.times = payload.times ?? null;
    this.ptr = 0;
    const total = payload.times?.length ?? text.length;

    const blob = b64ToBlob(payload.audio, "audio/mpeg");
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.audio = audio;
    this.setupAnalyser(audio);

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        this.onProgress?.(total, total); // reveal all at the end
        URL.revokeObjectURL(url);
        this.teardownAnalyser();
        resolve();
      };
      // Safety net: never let Isaac get stuck "speaking" if audio stalls.
      const guard = setTimeout(done, Math.min(60000, text.length * 130 + 6000));
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
      this.loop(total);
    });
  }

  private setupAnalyser(audio: HTMLAudioElement) {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaElementSource(audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    } catch {
      /* amplitude is optional */
    }
  }

  private loop = (total: number) => {
    // amplitude
    if (this.analyser) {
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v;
      this.onAmplitude?.(Math.min(1, (sum / data.length / 255) * 1.8));
    }
    // synced caption progress
    if (this.times && this.audio && this.onProgress) {
      const t = this.audio.currentTime;
      while (this.ptr < this.times.length && this.times[this.ptr] <= t) this.ptr++;
      this.onProgress(this.ptr, total);
    }
    this.raf = requestAnimationFrame(() => this.loop(total));
  };

  private teardownAnalyser() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onAmplitude?.(0);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio = null;
    }
    this.teardownAnalyser();
  }
}

function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
