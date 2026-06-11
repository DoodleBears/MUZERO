import type { DiagnosticContext, DiagnosticErrorKind, DiagnosticPhase } from "@/lib/diagnostics";
import { createDiagnosticLogger, log } from "@/lib/logger";

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
  /** Fired with the element's `MediaError` (or null) — the store localizes copy. */
  onError?: (error: unknown) => void;
}

/** How far the muted video may drift from the audio driver before we resync. */
const SYNC_DRIFT_SEC = 0.3;
const PLAY_PENDING_MS = 1500;
const MEDIA_TRACE_EVENTS = [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "pause",
  "waiting",
  "stalled",
  "suspend",
  "emptied",
  "abort",
  "error",
] as const;
const mediaLog = createDiagnosticLogger("player.media");
type MediaDiagnosticsContext = Pick<
  DiagnosticContext,
  "traceId" | "trackId" | "sessionId" | "sourceId"
>;

export class MediaEngine {
  private readonly audioEl: HTMLAudioElement;
  private readonly videoEl: HTMLVideoElement;
  /** Always-in-DOM home so the audio element is never removed/hidden. */
  private readonly host: HTMLElement | null = null;
  private hasVideo = false;
  private objectUrl: string | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private diagnosticsContext: MediaDiagnosticsContext | undefined;

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
    // Surface the raw MediaError; the store turns it into a localized
    // notification (it no longer lands in the dock as a status line).
    this.audioEl.addEventListener("error", () => this.callbacks.onError?.(this.audioEl.error));
    this.videoEl.addEventListener("error", () => this.callbacks.onError?.(this.videoEl.error));
    for (const event of MEDIA_TRACE_EVENTS) {
      this.audioEl.addEventListener(event, () =>
        this.traceMediaElementEvent("audio", event, this.audioEl),
      );
      this.videoEl.addEventListener(event, () =>
        this.traceMediaElementEvent("video", event, this.videoEl),
      );
    }

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

  setDiagnosticsContext(context: MediaDiagnosticsContext | undefined): void {
    this.diagnosticsContext = context;
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
    log.debug("media", "loadBlob", { kind, type: blob.type, size: blob.size });
    this.revoke();
    this.objectUrl = URL.createObjectURL(blob);
    this.loadSource(this.objectUrl, kind, null);
  }

  async loadUrl(
    url: string,
    kind: "audio" | "video" = "audio",
    opts?: { crossOrigin?: "anonymous" | null },
  ): Promise<void> {
    log.debug("media", "loadUrl", { kind, crossOrigin: opts?.crossOrigin });
    this.revoke();
    if (url.startsWith("blob:")) this.objectUrl = url;
    this.loadSource(url, kind, opts?.crossOrigin ?? null);
  }

  private loadSource(src: string, kind: "audio" | "video", crossOrigin: "anonymous" | null): void {
    // Cross-origin streams fed into the WebAudio graph (createMediaElementSource) are
    // tainted → silent unless the element opts into CORS and the response allows it.
    // Proxied stream URLs return ACAO:* so "anonymous" makes them audible; blobs/same-
    // origin use null (anonymous would needlessly force a CORS check).
    this.setMediaCrossOrigin(crossOrigin);
    // The audio element is always the driver (it plays a video file's audio too).
    this.audioEl.src = src;
    this.audioEl.load();
    this.traceMediaElementEvent("audio", "source.loaded", this.audioEl, {
      phase: "start",
      mediaKind: kind,
      sourceScheme: sourceScheme(src),
    });
    this.hasVideo = kind === "video";
    if (this.hasVideo) {
      this.videoEl.src = src;
      this.videoEl.load();
      this.traceMediaElementEvent("video", "source.loaded", this.videoEl, {
        phase: "start",
        mediaKind: kind,
        sourceScheme: sourceScheme(src),
      });
    } else {
      this.videoEl.removeAttribute("src");
      this.videoEl.load();
    }
  }

  /** Set (or clear) CORS mode on both media elements before a load — see loadSource. */
  private setMediaCrossOrigin(value: "anonymous" | null): void {
    if (this.audioEl instanceof HTMLMediaElement) this.audioEl.crossOrigin = value;
    if (this.videoEl instanceof HTMLMediaElement) this.videoEl.crossOrigin = value;
  }

  async play(): Promise<void> {
    log.debug("media", "play requested", {
      readyState: this.audioEl.readyState,
      networkState: this.audioEl.networkState,
      src: !!this.audioEl.src,
      currentSrc: !!this.audioEl.currentSrc,
    });
    this.ensureGraph();
    this.traceMediaElementEvent("audio", "play.requested", this.audioEl, { phase: "start" });
    let settled = false;
    try {
      const playPromise = this.audioEl.play();
      playPromise
        .then(() => {
          settled = true;
          log.debug("media", "play resolved", describeMediaElement(this.audioEl));
          this.traceMediaElementEvent("audio", "play.resolved", this.audioEl, {
            phase: "success",
          });
        })
        .catch((err: unknown) => {
          settled = true;
          log.warn("media", "play() rejected", err, describeMediaElement(this.audioEl));
          this.traceMediaElementEvent("audio", "play.rejected", this.audioEl, {
            phase: "fail",
            errorKind: "unsupported_source",
          });
        });
      await Promise.race([
        playPromise.then(() => undefined).catch(() => undefined),
        delay(PLAY_PENDING_MS).then(() => {
          if (!settled) {
            log.warn("media", "play() still pending", describeMediaElement(this.audioEl));
            this.traceMediaElementEvent("audio", "play.pending", this.audioEl, {
              phase: "retry",
            });
          }
        }),
      ]);
    } catch (err) {
      log.warn("media", "play() threw synchronously", err, describeMediaElement(this.audioEl));
      this.traceMediaElementEvent("audio", "play.threw", this.audioEl, {
        phase: "fail",
        errorKind: "unknown",
      });
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

  getCurrentTime(): number {
    return this.audioEl.currentTime || 0;
  }

  getDuration(): number {
    return this.audioEl.duration || 0;
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

  private traceMediaElementEvent(
    elementKind: "audio" | "video",
    event: string,
    el: HTMLMediaElement,
    extra: Partial<DiagnosticContext> = {},
  ): void {
    if (!this.diagnosticsContext?.traceId) return;
    const described = describeMediaElement(el);
    const isError = event === "error" || described.error;
    mediaLog[isError ? "error" : "debug"](event, {
      message: `${elementKind} ${event}`,
      ...this.diagnosticsContext,
      ...extra,
      category: "media",
      phase: extra.phase ?? mediaEventPhase(event),
      errorKind: extra.errorKind ?? mediaErrorKind(event, described.error),
      mediaElement: elementKind,
      mediaReadyState: described.readyState,
      mediaNetworkState: described.networkState,
      mediaErrorCode: described.error?.code,
      mediaErrorMessage: described.error?.message,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function describeMediaElement(el: HTMLMediaElement) {
  return {
    src: !!el.src,
    currentSrc: !!el.currentSrc,
    readyState: el.readyState,
    networkState: el.networkState,
    paused: el.paused,
    ended: el.ended,
    currentTime: finiteOrNull(el.currentTime),
    duration: finiteOrNull(el.duration),
    error: describeMediaError(el.error),
  };
}

function describeMediaError(error: MediaError | null) {
  if (!error) return null;
  return {
    code: error.code,
    message: error.message,
  };
}

function mediaEventPhase(event: string): DiagnosticPhase {
  if (event === "error" || event === "abort") return "fail";
  if (event === "waiting" || event === "stalled" || event === "suspend") return "retry";
  if (event === "loadedmetadata" || event === "loadeddata" || event === "canplay") return "success";
  return "state";
}

function mediaErrorKind(
  event: string,
  error: ReturnType<typeof describeMediaError>,
): DiagnosticErrorKind | undefined {
  if (event === "error" || error) return "media_decode";
  return undefined;
}

function sourceScheme(src: string): string {
  if (src.startsWith("blob:")) return "blob";
  if (src.startsWith("muzfetch:")) return "muzfetch";
  try {
    return new URL(src).protocol.replace(/:$/, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
