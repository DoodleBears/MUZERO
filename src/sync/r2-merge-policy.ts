export type R2MergeFieldClass = "cache-metadata" | "user-authored";

export interface R2CacheMetadataRef {
  updatedAt?: string;
  etag?: string;
  sha256?: string;
}

export function canUseUpdatedAtWinner(fieldClass: R2MergeFieldClass): boolean {
  return fieldClass === "cache-metadata";
}

export function cacheMetadataVersion(ref: string | R2CacheMetadataRef): string | undefined {
  if (typeof ref === "string") return undefined;
  return (
    ref.sha256 ?? ref.etag ?? (canUseUpdatedAtWinner("cache-metadata") ? ref.updatedAt : undefined)
  );
}
