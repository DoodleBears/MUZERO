/**
 * QQ Music quality tiers — PLAINTEXT ONLY. Each tier is a type-code prefix + ext;
 * the GetVkey `filename` is `${prefix}${mediaMid}${mediaMid}${ext}` (the mid
 * duplicated, per luren-dc). We deliberately list ONLY plaintext SongFileType
 * variants — never the encrypted ones (F0M0.mflac / O8M0.mgg …): decrypting those
 * is the DMCA §1201 red line (PRD §7/§8). Tiers QQ serves only as encrypted
 * containers (master / atmos / much lossless) are therefore "not playable" here,
 * and quality is capped at whatever plaintext the CDN actually returns.
 */

export type QqQuality = "flac" | "320" | "m4a" | "128";

export interface QqQualityTier {
  key: QqQuality;
  /** Filename type-code prefix. */
  prefix: string;
  /** Filename extension, with the leading dot. */
  ext: string;
  mime: string;
}

/** Best → worst, PLAINTEXT only. Encrypted-only tiers are intentionally absent. */
export const QQ_QUALITY_TIERS: readonly QqQualityTier[] = [
  { key: "flac", prefix: "F000", ext: ".flac", mime: "audio/flac" },
  { key: "320", prefix: "M800", ext: ".mp3", mime: "audio/mpeg" },
  { key: "m4a", prefix: "C400", ext: ".m4a", mime: "audio/mp4" },
  { key: "128", prefix: "M500", ext: ".mp3", mime: "audio/mpeg" },
];

/**
 * Ordered candidate tiers for a preferred quality: the preferred tier first, then
 * every lower plaintext tier, so resolve can pick the best the song actually
 * offers. Unknown / undefined / "flac" preference → the full best→worst list.
 */
export function qqQualityCandidates(preferred?: string): QqQualityTier[] {
  const idx = QQ_QUALITY_TIERS.findIndex((t) => t.key === preferred);
  return idx > 0 ? QQ_QUALITY_TIERS.slice(idx) : QQ_QUALITY_TIERS.slice();
}

/** GetVkey filename for a tier + media mid (the mid is duplicated, per luren-dc). */
export function qqFilename(tier: QqQualityTier, mediaMid: string): string {
  return `${tier.prefix}${mediaMid}${mediaMid}${tier.ext}`;
}
