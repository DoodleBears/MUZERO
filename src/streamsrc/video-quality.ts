/**
 * Cross-source video-quality helpers — keep the download picker's labels and ordering
 * consistent whether the tier came from Bilibili (qn/height) or YouTube (qualityLabel).
 * Pure; consumed by each source's `listVideoQualities`. See video-download PRD §4.1.
 */

import type { VideoQualityOption } from "./provider";

/** Human label for a video tier: `1080P` / `1080P60` / `4K` / `4K60 HDR` / `8K`. */
export function videoQualityLabel(height: number, fps?: number, hdr?: boolean): string {
  const base = height >= 4320 ? "8K" : height >= 2160 ? "4K" : `${height}P`;
  const fpsSuffix = fps && fps > 30 ? String(fps) : "";
  const hdrSuffix = hdr ? " HDR" : "";
  return `${base}${fpsSuffix}${hdrSuffix}`;
}

/** Order quality options high→low (height, then fps, then HDR). Pure (copies input). */
export function sortVideoQualitiesDesc(opts: VideoQualityOption[]): VideoQualityOption[] {
  return [...opts].sort(
    (a, b) =>
      b.height - a.height ||
      (b.fps ?? 0) - (a.fps ?? 0) ||
      Number(Boolean(b.hdr)) - Number(Boolean(a.hdr)),
  );
}
