/**
 * Resume math for chunked downloads — PURE. A queued job records `bytesDone`; on resume the
 * fetcher re-resolves the (possibly-expired) CDN URL and re-requests with a byte Range. These
 * functions decide whether the server actually honored the Range (continue appending) or
 * served the whole file again (start over). No IO; the runJob integration owns the fetch +
 * `.part` writes. Exhaustively unit-tested.
 */

/** The `Range` request value for a resume offset — omitted at 0 (a plain full download). */
export function rangeHeader(offset: number): string | undefined {
  return offset > 0 ? `bytes=${offset}-` : undefined;
}

/** Parse a `Content-Range: bytes <from>-<to>/<total|*>` response header. */
export function parseContentRange(
  header: string | null,
): { from: number; to: number; total?: number } | null {
  if (!header) return null;
  const m = header.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!m) return null;
  return {
    from: Number(m[1]),
    to: Number(m[2]),
    total: m[3] === "*" ? undefined : Number(m[3]),
  };
}

export interface ResumePlan {
  /** "append": keep the `.part` bytes and continue from `offset`. "replace": discard, start at 0. */
  mode: "append" | "replace";
  offset: number;
  total?: number;
}

/**
 * Given the requested resume offset and the response, decide how to proceed:
 * - offset 0 → a fresh full download (append from 0).
 * - 206 whose Content-Range starts exactly at `offset` → append (true resume).
 * - anything else (200 = Range ignored / fresh URL, or a 206 whose start ≠ offset) → replace.
 */
export function planResume(
  requestedOffset: number,
  status: number,
  contentRange: string | null,
): ResumePlan {
  if (requestedOffset <= 0) {
    return { mode: "append", offset: 0, total: parseContentRange(contentRange)?.total };
  }
  const range = parseContentRange(contentRange);
  if (status === 206 && range && range.from === requestedOffset) {
    return { mode: "append", offset: requestedOffset, total: range.total };
  }
  return { mode: "replace", offset: 0, total: range?.total };
}
