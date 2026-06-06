import { log } from "@/lib/logger";

/**
 * Owns a single persistent <video> element that plays both audio and video. The
 * element is created once and lives for the app's lifetime; the now-playing
 * stage adopts it via `mount()` and releases it via `unmount()` when you switch
 * tabs — playback keeps going either way (a detached-but-playing media element
 * doesn't stop). Also exposes a WebAudio analyser for the visualizer.
 */
export interface MediaEngineCallbacks {
  onEnded?: () => void;
  onTimeUpdate?: (positionSec: number, durationSec: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
}

export class MediaEngine {
  private readonly el: HTMLVideoElement;
  private objectUrl: string | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(private callbacks: MediaEngineCallbacks = {}) {
    const el = typeof document !== "undefined" ? document.createElement("video") : null;
    this.el = (el ?? {}) as HTMLVideoElement;
    if (!el) return; // non-DOM env (SSR/tests)
    el.preload = "auto";
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.controls = false;
    el.addEventListener("ended", () => this.callbacks.onEnded?.());
    el.addEventListener("timeupdate", () =>
      this.callbacks.onTimeUpdate?.(el.currentTime, el.duration || 0),
    );
    el.addEventListener("play", () => this.callbacks.onPlayStateChange?.(true));
    el.addEventListener("pause", () => this.callbacks.onPlayStateChange?.(false));
    el.addEventListener("error", () => this.callbacks.onError?.("Playback error"));
  }

  /** The media element — adopted into the stage and tapped by the visualizer. */
  get element(): HTMLVideoElement {
    return this.el;
  }

  setCallbacks(cb: MediaEngineCallbacks): void {
    this.callbacks = cb;
  }

  /** Adopt the element into a stage container (idempotent). */
  mount(container: HTMLElement): void {
    if (this.el instanceof HTMLElement && this.el.parentElement !== container) {
      container.appendChild(this.el);
    }
  }

  /** Detach from the DOM without destroying the element (playback continues). */
  unmount(): void {
    if (this.el instanceof HTMLElement) this.el.remove();
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
      log.warn("media", "play() rejected", err);
    }
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

  /** Lazily build the analyser graph on first play (after a user gesture). */
  private ensureGraph(): void {
    if (this.analyser || !(this.el instanceof HTMLMediaElement)) return;
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
      log.warn("media", "could not build analyser graph", err);
    }
    void this.audioCtx?.resume();
  }

  /** Frequency-domain analyser for visualizers; null until first play. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
