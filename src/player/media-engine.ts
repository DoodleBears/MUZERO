import { log } from "@/lib/logger";

/**
 * Owns playback through a persistent `<audio>` element (the driver) plus a muted
 * `<video>` element (the visual layer for MV tracks). Both live in a hidden,
 * always-in-DOM host so the AUDIO element is never removed or hidden — the
 * browser pauses a `<video>` whenever it's not visible (removed / display:none /
 * occluded), but an `<audio>` element keeps playing. So music continues across
 * nav tabs; only the muted video visual pauses while off the Now-Playing stage.
 *
 * The audio element plays a video file's audio track too, so it drives BOTH audio
 * and video tracks. The now-playing stage adopts the video via `mount()` and
 * releases it via `unmount()`. Exposes a WebAudio analyser (tapped off the audio
 * element) for the visualizer.
 */
export interface MediaEngineCallbacks {
  onEnded?: () => void;
  onTimeUpdate?: (positionSec: number, durationSec: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
}

/** How far the muted video may drift from the audio driver before we resync. */
const SYNC_DRIFT_SEC = 0.3;

export class MediaEngine {
  private readonly audioEl: HTMLAudioElement;
  private readonly videoEl: HTMLVideoElement;
  /** Always-in-DOM home so the audio element is never removed/hidden. */
  private readonly host: HTMLElement | null = null;
  private hasVideo = false;
  private objectUrl: string | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(private callbacks: MediaEngineCallbacks = {}) {
    const canDom = typeof document !== "undefined";
    this.audioEl = (canDom ? document.createElement("audio") : {}) as HTMLAudioElement;
    this.videoEl = (canDom ? document.createElement("video") : {}) as HTMLVideoElement;
    if (!canDom) return; // non-DOM env (SSR/tests without document)

    this.audioEl.preload = "auto";
    // The video is the muted VISUAL only — sound comes from the audio element.
    this.videoEl.muted = true;
    this.videoEl.playsInline = true;
    this.videoEl.setAttribute("playsinline", "");
    this.videoEl.controls = false;

    // The AUDIO element is the playback driver — all callbacks come from it.
    this.audioEl.addEventListener("ended", () => this.callbacks.onEnded?.());
    this.audioEl.addEventListener("timeupdate", () => {
      this.callbacks.onTimeUpdate?.(this.audioEl.currentTime, this.audioEl.duration || 0);
      if (this.hasVideo && !this.videoEl.paused) {
        const drift = Math.abs(this.videoEl.currentTime - this.audioEl.currentTime);
        if (drift > SYNC_DRIFT_SEC) this.videoEl.currentTime = this.audioEl.currentTime;
      }
    });
    this.audioEl.addEventListener("play", () => {
      this.callbacks.onPlayStateChange?.(true);
      if (this.hasVideo) void this.videoEl.play().catch(() => {});
    });
    this.audioEl.addEventListener("pause", () => {
      this.callbacks.onPlayStateChange?.(false);
      if (this.hasVideo) this.videoEl.pause();
    });
    this.audioEl.addEventListener("error", () => this.callbacks.onError?.("Playback error"));
    this.videoEl.addEventListener("error", () => this.callbacks.onError?.("Playback error"));

    const host = document.createElement("div");
    host.dataset.muzeroMediaHost = "";
    host.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
    host.appendChild(this.audioEl);
    host.appendChild(this.videoEl);
    document.body.appendChild(host);
    this.host = host;
  }

  /** The VIDEO (visual) element — adopted into the stage; the analyser taps audio. */
  get element(): HTMLVideoElement {
    return this.videoEl;
  }

  setCallbacks(cb: MediaEngineCallbacks): void {
    this.callbacks = cb;
  }

  /** Adopt the muted video into the stage; resync to the audio driver if playing. */
  mount(container: HTMLElement): void {
    if (this.videoEl instanceof HTMLElement && this.videoEl.parentElement !== container) {
      container.appendChild(this.videoEl);
    }
    if (this.hasVideo && this.audioEl instanceof HTMLMediaElement && !this.audioEl.paused) {
      this.videoEl.currentTime = this.audioEl.currentTime;
      void this.videoEl.play().catch(() => {});
    }
  }

  /** Return the video to the host (it pauses while hidden — only the visual). */
  unmount(): void {
    if (
      this.videoEl instanceof HTMLElement &&
      this.host &&
      this.videoEl.parentElement !== this.host
    ) {
      this.host.appendChild(this.videoEl);
    }
  }

  async loadBlob(blob: Blob, kind: "audio" | "video" = "audio"): Promise<void> {
    this.revoke();
    this.objectUrl = URL.createObjectURL(blob);
    // The audio element is always the driver (it plays a video file's audio too).
    this.audioEl.src = this.objectUrl;
    this.audioEl.load();
    this.hasVideo = kind === "video";
    if (this.hasVideo) {
      this.videoEl.src = this.objectUrl;
      this.videoEl.load();
    } else {
      this.videoEl.removeAttribute("src");
      this.videoEl.load();
    }
  }

  async play(): Promise<void> {
    this.ensureGraph();
    try {
      await this.audioEl.play();
    } catch (err) {
      log.warn("media", "play() rejected", err);
    }
  }

  pause(): void {
    this.audioEl.pause();
  }

  seek(positionSec: number): void {
    if (!Number.isFinite(positionSec)) return;
    this.audioEl.currentTime = positionSec;
    if (this.hasVideo) this.videoEl.currentTime = positionSec;
  }

  setVolume(volume: number): void {
    this.audioEl.volume = Math.min(1, Math.max(0, volume));
  }

  stop(): void {
    this.audioEl.pause();
    this.videoEl.pause();
    this.audioEl.removeAttribute("src");
    this.videoEl.removeAttribute("src");
    this.audioEl.load();
    this.videoEl.load();
    this.hasVideo = false;
    this.revoke();
  }

  /** Lazily build the analyser graph on the AUDIO element on first play. */
  private ensureGraph(): void {
    if (this.analyser || !(this.audioEl instanceof HTMLMediaElement)) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaElementSource(this.audioEl);
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
