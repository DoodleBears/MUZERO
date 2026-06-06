import { log } from "@/lib/logger";

/**
 * Thin wrapper over a single HTMLAudioElement. Owns object-URL lifecycle
 * (revoke-before-replace, so we never leak Blob URLs) and surfaces the handful
 * of events the store cares about. One instance per app.
 */
export interface AudioEngineCallbacks {
  onEnded?: () => void;
  onTimeUpdate?: (positionSec: number, durationSec: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
}

export class AudioEngine {
  private readonly el: HTMLAudioElement;
  private objectUrl: string | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(private callbacks: AudioEngineCallbacks = {}) {
    this.el = typeof Audio !== "undefined" ? new Audio() : ({} as HTMLAudioElement);
    if (!(this.el instanceof HTMLAudioElement)) return; // non-DOM env (SSR/tests)
    this.el.preload = "auto";
    this.el.addEventListener("ended", () => this.callbacks.onEnded?.());
    this.el.addEventListener("timeupdate", () =>
      this.callbacks.onTimeUpdate?.(this.el.currentTime, this.el.duration || 0),
    );
    this.el.addEventListener("play", () => this.callbacks.onPlayStateChange?.(true));
    this.el.addEventListener("pause", () => this.callbacks.onPlayStateChange?.(false));
    this.el.addEventListener("error", () => this.callbacks.onError?.("Audio playback error"));
  }

  /** The underlying element — used by the visualizer to tap the audio graph. */
  get element(): HTMLAudioElement {
    return this.el;
  }

  setCallbacks(cb: AudioEngineCallbacks): void {
    this.callbacks = cb;
  }

  async loadBlob(blob: Blob): Promise<void> {
    this.revoke();
    this.objectUrl = URL.createObjectURL(blob);
    this.el.src = this.objectUrl;
    this.el.load();
  }

  async play(): Promise<void> {
    this.ensureGraph();
    try {
      await this.el.play();
    } catch (err) {
      log.warn("audio", "play() rejected", err);
    }
  }

  /**
   * Lazily build the WebAudio graph (element → analyser → output) on first play,
   * once we have a user gesture. The analyser feeds the Aura visualizer.
   */
  private ensureGraph(): void {
    if (this.analyser || !(this.el instanceof HTMLAudioElement)) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaElementSource(this.el);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch (err) {
      log.warn("audio", "could not build analyser graph", err);
    }
    void this.audioCtx?.resume();
  }

  /** Frequency-domain analyser for visualizers; null until first play. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  pause(): void {
    this.el.pause();
  }

  seek(positionSec: number): void {
    if (Number.isFinite(positionSec)) this.el.currentTime = positionSec;
  }

  setVolume(volume: number): void {
    this.el.volume = Math.min(1, Math.max(0, volume));
  }

  stop(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.revoke();
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
