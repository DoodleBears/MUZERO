export interface DuplicateAudienceRequestInput {
  externalId?: string;
  now: number;
  seenExternalIds: ReadonlyMap<string, number>;
  dedupeWindowMs: number;
}

export function isDuplicateAudienceRequest(input: DuplicateAudienceRequestInput): boolean {
  if (!input.externalId) return false;
  const seenAt = input.seenExternalIds.get(input.externalId);
  return seenAt !== undefined && input.now - seenAt <= input.dedupeWindowMs;
}

export interface RequesterCooldownInput {
  requesterKey?: string;
  now: number;
  lastAcceptedByRequester: ReadonlyMap<string, number>;
  cooldownMs: number;
}

export function isRequesterCoolingDown(input: RequesterCooldownInput): boolean {
  if (!input.requesterKey) return false;
  const acceptedAt = input.lastAcceptedByRequester.get(input.requesterKey);
  return acceptedAt !== undefined && input.now - acceptedAt < input.cooldownMs;
}

/**
 * Drop timestamps that have aged past the decision window. The dedupe/cooldown
 * checks above only ever look `windowMs` back, so expired keys can never affect
 * a decision — but without this sweep the maps retain every message id /
 * requester ever accepted, growing unbounded over a multi-day live stream
 * (memory-leak PRD 20260705 L-2).
 */
export function pruneExpiredTimestamps(
  map: Map<string, number>,
  now: number,
  windowMs: number,
): void {
  for (const [key, at] of map) {
    if (now - at > windowMs) map.delete(key);
  }
}
