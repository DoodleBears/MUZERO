/**
 * Read a fetch `Response` body to a Blob while reporting byte progress. Used by
 * download-before-play (so the Dock cover + notification toast show real % for the
 * multi-second streamed download). Mirrors the streaming reader in
 * `streamsrc/download-action.ts`.
 *
 * Falls back to a one-shot `resp.blob()` when progress can't be tracked (no
 * `onProgress`, no Content-Length, or no readable body) — the proxy strips
 * Content-Length for Chromium stream validation but echoes `x-muzero-content-length`.
 */
export async function streamResponseToBlob(
  resp: Response,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const total =
    Number(resp.headers.get("content-length") || resp.headers.get("x-muzero-content-length")) || 0;
  if (!onProgress || !total || !resp.body) return resp.blob();

  const reader = resp.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  return new Blob(chunks, { type: resp.headers.get("content-type") ?? "" });
}
