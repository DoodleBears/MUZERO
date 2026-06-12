export type DjChatLocalIdType = "M" | "Q" | "R" | "S" | "T";

export interface DjChatLocalIdMeta {
  /** Optional context for diagnostics and future routing. */
  setId?: string;
  /** Only meaningful for result refs. */
  toolName?: string;
  /** Sanitized result summary for diagnostics. */
  resultSummary?: Record<string, unknown>;
}

export interface DjChatLocalIdSnapshotEntry {
  local: string;
  real: string;
  type: DjChatLocalIdType;
  meta?: DjChatLocalIdMeta;
}

export interface DjChatLocalIdResolution {
  real: string;
  type: DjChatLocalIdType | null;
  meta?: DjChatLocalIdMeta;
}

export interface DjChatLocalIdRegistry {
  fromLocal(arg: string): string;
  resolveLocal(arg: string): DjChatLocalIdResolution;
  snapshot(): DjChatLocalIdSnapshotEntry[];
  toLocal(realId: string, type: DjChatLocalIdType, meta?: DjChatLocalIdMeta): string;
}

export class UnknownDjChatLocalIdError extends Error {
  readonly localId: string;

  constructor(localId: string) {
    super(`Unknown DJ chat local id: ${localId}`);
    this.name = "UnknownDjChatLocalIdError";
    this.localId = localId;
  }
}

export class WrongDjChatLocalIdTypeError extends Error {
  readonly actual: DjChatLocalIdType | null;
  readonly expected: DjChatLocalIdType;
  readonly localId: string;

  constructor(input: {
    actual: DjChatLocalIdType | null;
    expected: DjChatLocalIdType;
    localId: string;
  }) {
    super(
      input.actual
        ? `${input.localId} is a ${input.actual} ref, but this tool needs ${input.expected}.`
        : `${input.localId} is not a local ${input.expected} ref.`,
    );
    this.name = "WrongDjChatLocalIdTypeError";
    this.actual = input.actual;
    this.expected = input.expected;
    this.localId = input.localId;
  }
}

const LOCAL_ID_PATTERN = /^#([A-Z]+)(\d+)$/;
const LOCAL_ID_TYPES = ["M", "Q", "R", "S", "T"] as const satisfies readonly DjChatLocalIdType[];
const KNOWN_TYPES = new Set<DjChatLocalIdType>(LOCAL_ID_TYPES);

interface LocalEntry {
  meta?: DjChatLocalIdMeta;
  real: string;
  type: DjChatLocalIdType;
}

export function createDjChatLocalIdRegistry(
  initialEntries?: readonly DjChatLocalIdSnapshotEntry[],
): DjChatLocalIdRegistry {
  const realToLocal = new Map<string, string>();
  const localToReal = new Map<string, LocalEntry>();
  const counters: Record<DjChatLocalIdType, number> = { M: 0, Q: 0, R: 0, S: 0, T: 0 };

  for (const entry of initialEntries ?? []) {
    if (!isValidSnapshotEntry(entry)) continue;
    const match = LOCAL_ID_PATTERN.exec(entry.local);
    if (!match) continue;
    const index = Number.parseInt(match[2] ?? "0", 10);
    realToLocal.set(entry.real, entry.local);
    localToReal.set(entry.local, {
      real: entry.real,
      type: entry.type,
      ...(entry.meta && { meta: { ...entry.meta } }),
    });
    counters[entry.type] = Math.max(counters[entry.type], index);
  }

  return {
    fromLocal(arg) {
      return resolve(arg).real;
    },
    resolveLocal: resolve,
    snapshot() {
      return [...localToReal.entries()].map(([local, entry]) => ({
        local,
        real: entry.real,
        type: entry.type,
        ...(entry.meta && { meta: { ...entry.meta } }),
      }));
    },
    toLocal(realId, type, meta) {
      const existing = realToLocal.get(realId);
      if (existing) {
        const entry = localToReal.get(existing);
        if (entry) mergeMeta(entry, meta);
        return existing;
      }

      counters[type] += 1;
      const local = `#${type}${counters[type]}`;
      const entry: LocalEntry = { real: realId, type };
      mergeMeta(entry, meta);
      realToLocal.set(realId, local);
      localToReal.set(local, entry);
      return local;
    },
  };

  function resolve(arg: string): DjChatLocalIdResolution {
    const match = LOCAL_ID_PATTERN.exec(arg);
    if (!match) return { real: arg, type: null };
    const type = match[1] as DjChatLocalIdType;
    if (!KNOWN_TYPES.has(type)) return { real: arg, type: null };
    const hit = localToReal.get(arg);
    if (!hit) throw new UnknownDjChatLocalIdError(arg);
    return {
      real: hit.real,
      type: hit.type,
      ...(hit.meta && { meta: { ...hit.meta } }),
    };
  }
}

export function encodeTrackRef(
  id: string,
  localIds: DjChatLocalIdRegistry,
  meta?: DjChatLocalIdMeta,
): string {
  return localIds.toLocal(id, "T", meta);
}

export function encodeSetRef(id: string, localIds: DjChatLocalIdRegistry): string {
  return localIds.toLocal(id, "S");
}

export function encodeMemoryRef(id: string, localIds: DjChatLocalIdRegistry): string {
  return localIds.toLocal(id, "M");
}

export function encodeQueueEntryRef(id: string, localIds: DjChatLocalIdRegistry): string {
  return localIds.toLocal(id, "Q");
}

export function encodeResultRef(
  realId: string,
  localIds: DjChatLocalIdRegistry,
  meta?: DjChatLocalIdMeta,
): string {
  return localIds.toLocal(realId, "R", meta);
}

export function resolveTrackRef(ref: string, localIds: DjChatLocalIdRegistry): string {
  return resolveTypedRef(ref, "T", localIds);
}

export function resolveSetRef(ref: string, localIds: DjChatLocalIdRegistry): string {
  return resolveTypedRef(ref, "S", localIds);
}

export function resolveMemoryRef(ref: string, localIds: DjChatLocalIdRegistry): string {
  return resolveTypedRef(ref, "M", localIds);
}

export function resolveQueueEntryRef(ref: string, localIds: DjChatLocalIdRegistry): string {
  return resolveTypedRef(ref, "Q", localIds);
}

export function resolveResultRef(
  ref: string,
  localIds: DjChatLocalIdRegistry,
): DjChatLocalIdResolution {
  const resolved = localIds.resolveLocal(ref);
  if (resolved.type === null) return resolved;
  if (resolved.type !== "R") {
    throw new WrongDjChatLocalIdTypeError({ actual: resolved.type, expected: "R", localId: ref });
  }
  return resolved;
}

function resolveTypedRef(
  ref: string,
  expected: Exclude<DjChatLocalIdType, "R">,
  localIds: DjChatLocalIdRegistry,
): string {
  const resolved = localIds.resolveLocal(ref);
  if (resolved.type === null) return resolved.real;
  if (resolved.type !== expected) {
    throw new WrongDjChatLocalIdTypeError({
      actual: resolved.type,
      expected,
      localId: ref,
    });
  }
  return resolved.real;
}

function isValidSnapshotEntry(entry: DjChatLocalIdSnapshotEntry): boolean {
  if (!entry.real) return false;
  if (!KNOWN_TYPES.has(entry.type)) return false;
  const match = LOCAL_ID_PATTERN.exec(entry.local);
  return Boolean(match && match[1] === entry.type);
}

function mergeMeta(entry: LocalEntry, incoming: DjChatLocalIdMeta | undefined): void {
  if (!incoming) return;
  entry.meta ??= {};
  for (const [key, value] of Object.entries(incoming) as Array<
    [keyof DjChatLocalIdMeta, DjChatLocalIdMeta[keyof DjChatLocalIdMeta]]
  >) {
    if (value === undefined || entry.meta[key] !== undefined) continue;
    entry.meta[key] = value as never;
  }
}
