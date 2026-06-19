/**
 * Stable id generation. `crypto.randomUUID` is available in the Tauri WebView and
 * in jsdom (Node 22). The fallback keeps tests deterministic-friendly without it.
 */
export function newId(prefix = ""): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

function randomBase36Seed(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const parts = new Uint32Array(2);
    crypto.getRandomValues(parts);
    return `${parts[0]?.toString(36) ?? "0"}${parts[1]?.toString(36) ?? "0"}`;
  }
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
}

/**
 * Generate many stable ids with one random seed. Bulk imports can create
 * thousands of rows at once; avoiding one `crypto.randomUUID()` call and a long
 * UUID string per row trims both CPU work and IndexedDB payload size while
 * preserving the codename prefix contract (`trk_`, `blb_`, ...).
 */
export function newIds(prefix: string, count: number): string[] {
  if (count <= 0) return [];
  const stamp = Date.now().toString(36);
  const seed = randomBase36Seed();
  return Array.from(
    { length: count },
    (_, index) => `${prefix}_${stamp}${seed}${index.toString(36)}`,
  );
}
