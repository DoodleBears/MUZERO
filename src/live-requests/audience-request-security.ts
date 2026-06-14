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
