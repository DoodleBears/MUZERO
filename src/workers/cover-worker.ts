/// <reference lib="webworker" />

import { type CoverMetadataTarget, extractCoverMetadataInline } from "./cover-derivative-core";

type CoverMetadataWorkerRequest = {
  bytes: ArrayBuffer;
  crop?: Parameters<typeof extractCoverMetadataInline>[0]["crop"];
  mime?: string;
  reqId: number;
  sourceKey?: string;
  targets?: CoverMetadataTarget[];
  type: "cover-metadata";
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<CoverMetadataWorkerRequest>) => {
  const msg = event.data;
  if (msg?.type !== "cover-metadata") return;
  try {
    const blob = new Blob([msg.bytes], { type: msg.mime || "application/octet-stream" });
    const result = await extractCoverMetadataInline({
      blob,
      crop: msg.crop,
      mime: msg.mime,
      sourceKey: msg.sourceKey,
      targets: msg.targets,
    });
    ctx.postMessage({ reqId: msg.reqId, result, type: "cover-metadata-result" });
  } catch (error) {
    ctx.postMessage({
      error: error instanceof Error ? error.message : String(error),
      reqId: msg.reqId,
      type: "cover-metadata-error",
    });
  }
};
