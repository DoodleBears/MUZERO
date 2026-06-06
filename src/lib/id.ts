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
