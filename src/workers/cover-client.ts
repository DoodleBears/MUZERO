import { createDiagnosticLogger } from "@/lib/logger";
import {
  type CoverMetadataInput,
  type CoverMetadataResult,
  extractCoverMetadataInline,
  normalizeCoverMetadataResult,
} from "./cover-derivative-core";

type Pending = {
  reject: (error: Error) => void;
  resolve: (result: CoverMetadataResult) => void;
  sourceKey?: string;
  startedAt: number;
  targets: string[];
};

type WorkerFactory = () => Worker | null;

export interface CoverMetadataClientOptions {
  inlineExtract?: (input: CoverMetadataInput) => Promise<CoverMetadataResult>;
  workerFactory?: WorkerFactory;
}

export interface CoverMetadataClient {
  extract(input: CoverMetadataInput): Promise<CoverMetadataResult>;
  reset(): void;
}

const coverWorkerLog = createDiagnosticLogger("cover.worker");

export function createCoverMetadataClient(
  options: CoverMetadataClientOptions = {},
): CoverMetadataClient {
  const inlineExtract = options.inlineExtract ?? extractCoverMetadataInline;
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  let worker: Worker | null = null;
  let workerUnavailable = false;
  let nextReqId = 1;
  const pending = new Map<number, Pending>();
  const inFlight = new Map<string, Promise<CoverMetadataResult>>();

  const getWorker = (): Worker | null => {
    if (worker) return worker;
    if (workerUnavailable) return null;
    try {
      worker = workerFactory();
      if (!worker) {
        workerUnavailable = true;
        return null;
      }
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.type === "cover-metadata-result") {
          const item = pending.get(msg.reqId);
          if (!item) return;
          pending.delete(msg.reqId);
          const result = normalizeCoverMetadataResult(msg.result);
          coverWorkerLog.debug("success", {
            category: "performance",
            durationMs: Math.round(performance.now() - item.startedAt),
            phase: "success",
            sourceId: item.sourceKey,
            targets: item.targets,
            ...result.timings,
          });
          item.resolve(result);
          return;
        }
        if (msg?.type === "cover-metadata-error") {
          const item = pending.get(msg.reqId);
          if (!item) return;
          pending.delete(msg.reqId);
          const error = new Error(String(msg.error || "cover metadata worker failed"));
          coverWorkerLog.warn("failed", {
            category: "performance",
            errorKind: "media_decode",
            message: error.message,
            phase: "fail",
            sourceId: item.sourceKey,
            targets: item.targets,
          });
          item.reject(error);
        }
      };
      worker.onerror = () => {
        workerUnavailable = true;
        for (const item of pending.values())
          item.reject(new Error("cover metadata worker crashed"));
        pending.clear();
        worker = null;
      };
      return worker;
    } catch {
      workerUnavailable = true;
      return null;
    }
  };

  const extract = (input: CoverMetadataInput): Promise<CoverMetadataResult> => {
    const key = inFlightKey(input);
    if (key) {
      const existing = inFlight.get(key);
      if (existing) {
        coverWorkerLog.debug("cache-hit", {
          category: "performance",
          phase: "skip",
          sourceId: input.sourceKey,
          targets: normalizedTargets(input),
        });
        return existing;
      }
    }
    const run = extractFresh(input);
    if (!key) return run;
    inFlight.set(key, run);
    void run.finally(() => inFlight.delete(key));
    return run;
  };

  const extractFresh = async (input: CoverMetadataInput): Promise<CoverMetadataResult> => {
    const targets = normalizedTargets(input);
    coverWorkerLog.debug("enqueue", {
      bytes: input.blob.size,
      category: "performance",
      mime: input.mime ?? input.blob.type,
      phase: "start",
      sourceId: input.sourceKey,
      targets,
    });
    const w = getWorker();
    if (!w) {
      coverWorkerLog.debug("unavailable", {
        category: "performance",
        phase: "skip",
        sourceId: input.sourceKey,
        targets,
      });
      return normalizeCoverMetadataResult(await inlineExtract(input));
    }

    const reqId = nextReqId;
    nextReqId += 1;
    const startedAt = performance.now();
    const bytes = await input.blob.arrayBuffer();
    const promise = new Promise<CoverMetadataResult>((resolve, reject) => {
      pending.set(reqId, {
        reject,
        resolve,
        sourceKey: input.sourceKey,
        startedAt,
        targets,
      });
      try {
        w.postMessage(
          {
            bytes,
            crop: input.crop,
            mime: input.mime ?? input.blob.type,
            reqId,
            sourceKey: input.sourceKey,
            targets,
            type: "cover-metadata",
          },
          [bytes],
        );
        coverWorkerLog.debug("start", {
          bytes: input.blob.size,
          category: "performance",
          phase: "start",
          sourceId: input.sourceKey,
          targets,
        });
      } catch (error) {
        pending.delete(reqId);
        workerUnavailable = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return promise.catch(async (error: unknown) => {
      coverWorkerLog.warn("fallback", {
        category: "performance",
        errorKind: "unknown",
        message: error instanceof Error ? error.message : String(error),
        phase: "retry",
        sourceId: input.sourceKey,
        targets,
      });
      return normalizeCoverMetadataResult(await inlineExtract(input));
    });
  };

  return {
    extract,
    reset() {
      worker?.terminate();
      worker = null;
      workerUnavailable = false;
      pending.clear();
      inFlight.clear();
    },
  };
}

const defaultClient = createCoverMetadataClient();

export function extractCoverMetadataViaWorker(
  input: CoverMetadataInput,
): Promise<CoverMetadataResult> {
  return defaultClient.extract(input);
}

export function __resetCoverMetadataClientForTests(): void {
  defaultClient.reset();
}

function defaultWorkerFactory(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./cover-worker.ts", import.meta.url), { type: "module" });
}

function normalizedTargets(input: CoverMetadataInput): string[] {
  return [...(input.targets?.length ? input.targets : ["palette", "thumbhash"])].sort();
}

function inFlightKey(input: CoverMetadataInput): string | null {
  if (!input.sourceKey) return null;
  const crop = input.crop
    ? `${input.crop.x}:${input.crop.y}:${input.crop.width}:${input.crop.height}`
    : "full";
  return `${input.sourceKey}|${crop}|${normalizedTargets(input).join(",")}`;
}
