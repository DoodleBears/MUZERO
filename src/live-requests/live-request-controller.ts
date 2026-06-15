import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import { DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS, type Track } from "@/db/types";
import { type DesktopLiveRequestIntakeControls, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";
import {
  type AudienceRequestRuntime,
  createAudienceRequestRuntime,
} from "./audience-request-runtime";
import {
  type NormalizedAudienceRequest,
  normalizeAudienceRequest,
} from "./audience-request-schema";

/**
 * The missing "last mile": subscribes the desktop/web intake transport's
 * `onMessage` and drives each received body through normalize → runtime, so a
 * live chat request actually searches the library and plays. A module-scope
 * singleton (hard rule #6 — non-reactive engine state stays out of the store).
 *
 * The transport server lifecycle (which port, when listening) is still owned by
 * the Settings panel; `onMessage` supports multiple subscribers, so the panel's
 * debug inbox and this pipeline coexist. Phase 2 layers per-source mapping and
 * the testing/active gate on top of this.
 */

export interface LiveRequestControllerDeps {
  db?: MuzeroDB;
  runtime?: AudienceRequestRuntime;
  playNow?: (track: Track) => Promise<void>;
  /** Inject the intake controls (tests); otherwise resolved from the desktop bridge. */
  controls?: DesktopLiveRequestIntakeControls;
}

export interface LiveRequestController {
  start(): void;
  stop(): void;
  handlePayload(payload: { body: string }): Promise<void>;
}

export function createLiveRequestController(
  deps: LiveRequestControllerDeps = {},
): LiveRequestController {
  const db = deps.db ?? defaultDb;
  const runtime = deps.runtime ?? createAudienceRequestRuntime({ db, playNow: deps.playNow });
  let unsubscribe: (() => void) | null = null;

  async function handlePayload(payload: { body: string }): Promise<void> {
    const settings = await getSettings(db);
    const intake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
    if (!intake.enabled) return;

    let raw: unknown;
    try {
      raw = JSON.parse(payload.body);
    } catch {
      return; // non-JSON body — ignore
    }
    if (!raw || typeof raw !== "object") return;

    let request: NormalizedAudienceRequest;
    try {
      request = normalizeAudienceRequest(raw, { commandPrefixes: intake.commandPrefixes });
    } catch {
      return; // payload had no usable message field
    }

    try {
      await runtime.handle(request);
    } catch (error) {
      log.error("liveRequests", "failed to handle audience request", error);
    }
  }

  function start(): void {
    if (unsubscribe) return; // idempotent
    const controls = deps.controls ?? resolveDesktopBridge().liveRequestIntake;
    if (!controls) return; // shell without an intake transport
    unsubscribe = controls.onMessage((payload) => {
      void handlePayload(payload);
    });
  }

  function stop(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  return { start, stop, handlePayload };
}

let singleton: LiveRequestController | null = null;

/**
 * Mount the intake pipeline once at app start. Idempotent. `playNow` is wired to
 * the player store lazily so this module stays free of player-store imports.
 */
export function startLiveRequestIntake(): void {
  singleton ??= createLiveRequestController({
    playNow: async (track) => {
      const { usePlayerStore } = await import("@/stores/player-store");
      await usePlayerStore.getState().playTrack(track);
    },
  });
  singleton.start();
}

export function stopLiveRequestIntake(): void {
  singleton?.stop();
}
