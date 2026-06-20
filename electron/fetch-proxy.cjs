// `muzfetch://` protocol handler. The renderer's bridge rewrites every BYOK/R2
// request to this privileged scheme with the real target URL in `x-muzero-target`;
// the main process performs it with `net.fetch` (Chromium's network stack), so no
// renderer CORS / mixed-content applies. Streaming is preserved both ways — DJ SSE
// and large R2 PUT bodies flow through unbuffered — and SigV4 headers pass verbatim.
const fs = require("node:fs");
const { Readable } = require("node:stream");
const { net } = require("electron");
const { emitMainDiagnostic } = require("./diagnostics.cjs");
const { resolveLocalMediaToken } = require("./local-media.cjs");

const TARGET_HEADER = "x-muzero-target";

async function handleMuzfetch(request) {
  const reqUrl = new URL(request.url);
  if (reqUrl.hostname === "local-media") return handleLocalMedia(request, reqUrl);

  const headers = new Headers(request.headers);
  headers.delete(TARGET_HEADER);

  // Two ways the real target arrives:
  //  (a) fetch() calls — the bridge puts it in the `x-muzero-target` header.
  //  (b) media <audio>/<video> src — the element can't set request headers, so the
  //      target + headers to inject ride in the `muzfetch://media/?__mzurl=…&
  //      __mzh_<name>=…` URL (see electronMediaProxyUrl). The element's own Range
  //      header is on `request` and is forwarded, so 206 seeking works.
  let target = request.headers.get(TARGET_HEADER);
  let isMediaRequest = false;
  let mediaTraceContext = {};
  if (!target) {
    if (reqUrl.searchParams.has("__mzurl")) {
      isMediaRequest = true;
      mediaTraceContext = {
        traceId: reqUrl.searchParams.get("__mztrace") || undefined,
        trackId: reqUrl.searchParams.get("__mztrack") || undefined,
        sessionId: reqUrl.searchParams.get("__mzsession") || undefined,
        sourceId: reqUrl.searchParams.get("__mzsource") || undefined,
        videoId: reqUrl.searchParams.get("__mzvideo") || undefined,
      };
      target = reqUrl.searchParams.get("__mzurl");
      // The <audio>/<img> element's own Referer/Origin (localhost) is wrong for the
      // target CDN (hdslb/bilivideo 403 a foreign Referer) — drop them and use only
      // the explicitly-injected __mzh_* headers (bili media injects its Referer; cover
      // images inject none, and the CDNs serve with no Referer).
      headers.delete("referer");
      headers.delete("origin");
      for (const [name, value] of reqUrl.searchParams) {
        if (name.startsWith("__mzh_")) headers.set(name.slice("__mzh_".length), value);
      }
    }
  }
  if (!target) return new Response("missing muzfetch target", { status: 400 });

  // `host` is managed by net.fetch from the target URL — and SigV4 signs the URL's
  // host, so they align without us forwarding a (forbidden) Host header.
  //
  // Restore restricted headers the renderer's fetch can't set (Cookie / Referer /
  // User-Agent / Origin). The bridge sends them as `x-muzero-h-<name>`; net.fetch in
  // the main process isn't bound by the renderer's forbidden-header list, so the real
  // names go out to the target. Stream sources (NetEase needs a Referer) depend on it.
  const ALIAS_PREFIX = "x-muzero-h-";
  for (const [name, value] of [...headers]) {
    if (name.startsWith(ALIAS_PREFIX)) {
      headers.set(name.slice(ALIAS_PREFIX.length), value);
      headers.delete(name);
    }
  }
  // credentials:"include" so net.fetch sends the default session's cookies even cross-
  // origin (default "same-origin" would drop them). After a source login, MUSIC_U /
  // SESSDATA live in the default session — this unlocks VIP / higher quality.
  const init = { method: request.method, headers, redirect: "follow", credentials: "include" };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  const mediaRequestContext = isMediaRequest
    ? createMediaRequestContext(target, request, headers, mediaTraceContext)
    : null;
  if (mediaRequestContext) {
    emitMainDiagnostic("debug", "stream.proxy", "request.start", "media proxy request started", {
      ...mediaRequestContext,
      phase: "start",
    });
  }

  let res;
  try {
    res = await net.fetch(target, init);
  } catch (error) {
    if (mediaRequestContext) {
      emitMainDiagnostic("error", "stream.proxy", "request.failed", "media proxy request failed", {
        ...mediaRequestContext,
        phase: "fail",
        errorKind: "network_error",
        errorName: error?.name,
        errorMessage: error?.message ?? String(error),
      });
    }
    // Don't re-throw: a thrown protocol.handle handler makes Electron surface a raw
    // `net::ERR_FAILED` on the console. These are transient (expired CDN URL, dropped
    // connection) or expected (the renderer aborted a superseded download/playback).
    // Hand back a readable error Response so the renderer's fetch sees `!ok` and the
    // download queue retries / playback fails cleanly — no console spew.
    const aborted = error?.name === "AbortError";
    return new Response(error?.message ?? "muzfetch upstream error", {
      status: aborted ? 499 : 502,
      headers: corsHeaders({ "content-type": "text/plain", "x-muzero-proxy-error": "1" }),
    });
  }

  // Resolve mode (share/short-link expansion): the renderer can't reliably read a
  // custom response header off the cross-origin muzfetch scheme, so when asked we
  // return the post-redirect URL as the *body* (always readable). net.fetch followed
  // the redirects, so res.url is the final target.
  if (request.headers.get("x-muzero-resolve")) {
    return new Response(res.url || target, {
      status: 200,
      headers: corsHeaders({ "content-type": "text/plain" }),
    });
  }

  // Re-emit with permissive CORS so the privileged-scheme renderer can read it,
  // keeping the body a live stream (no buffering).
  const outHeaders = new Headers(res.headers);
  if (isMediaRequest) {
    // protocol.handle streams can surface as net::ERR_UNEXPECTED when Chromium
    // validates an upstream Content-Length/encoding against the transformed stream.
    // Media demuxers do not need Content-Length as long as Content-Range/Type survive.
    // BUT a programmatic download reader wants the total for a progress bar — so echo
    // the upstream length in a custom (exposed) header before deleting the real one.
    const upstreamLength = outHeaders.get("content-length");
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");
    if (upstreamLength) outHeaders.set("x-muzero-content-length", upstreamLength);
    emitMainDiagnostic(
      res.status >= 400 ? "error" : "debug",
      "stream.proxy",
      res.status >= 400 ? "request.failed" : "response.received",
      "media proxy response",
      {
        ...mediaRequestContext,
        category: "network",
        phase: res.status >= 400 ? "fail" : "success",
        errorKind: res.status >= 400 ? "http_status" : undefined,
        source: "electron-main",
        httpStatus: res.status,
        contentType: outHeaders.get("content-type") || undefined,
        range: request.headers.get("range") || null,
        acceptRanges: outHeaders.get("accept-ranges") || null,
        contentRange: outHeaders.get("content-range") || null,
      },
    );
  }
  outHeaders.set("access-control-allow-origin", "*");
  // Echo the post-redirect URL so the renderer can expand share/short links
  // (net.fetch followed the redirect; res.url is the final target). Custom response
  // headers must be explicitly exposed or the renderer's CORS layer strips them.
  const exposed = [];
  if (res.url) {
    outHeaders.set("x-muzero-final-url", res.url);
    exposed.push("x-muzero-final-url");
  }
  if (outHeaders.has("x-muzero-content-length")) exposed.push("x-muzero-content-length");
  if (exposed.length) outHeaders.set("access-control-expose-headers", exposed.join(", "));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

async function handleLocalMedia(request, reqUrl) {
  const token = reqUrl.searchParams.get("__mztoken");
  const entry = token ? resolveLocalMediaToken(token) : null;
  if (!entry) return new Response("missing local media token", { status: 404 });

  let stat;
  try {
    stat = await fs.promises.stat(entry.filePath);
  } catch {
    return new Response("local media not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("local media is not a file", { status: 404 });

  const size = stat.size;
  const mime =
    entry.mime || reqUrl.searchParams.get("__mzmime") || "application/octet-stream";
  const range = parseRange(request.headers.get("range"), size);
  if (range?.invalid) {
    return new Response(null, {
      status: 416,
      headers: corsHeaders({
        "accept-ranges": "bytes",
        "content-range": `bytes */${size}`,
      }),
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, size - 1);
  const contentLength = size === 0 ? 0 : end - start + 1;
  const status = range ? 206 : 200;
  const headers = corsHeaders({
    "accept-ranges": "bytes",
    "content-length": String(contentLength),
    "content-type": mime,
    ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  });
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const body =
    size === 0
      ? null
      : Readable.toWeb(fs.createReadStream(entry.filePath, { start, end }));
  return new Response(body, { status, headers });
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { invalid: true };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { invalid: true };
  let start;
  let end;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = Math.max(0, size - 1);
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : Math.max(0, size - 1);
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, Math.max(0, size - 1)) };
}

function corsHeaders(values) {
  const headers = new Headers(values);
  headers.set("access-control-allow-origin", "*");
  return headers;
}

function createMediaRequestContext(target, request, headers, traceContext) {
  const targetUrl = safeUrl(target);
  const params = targetUrl?.searchParams;
  return {
    ...traceContext,
    category: "network",
    source: "electron-main",
    requestHost: targetUrl?.hostname,
    requestPathHash: stableHash(targetUrl?.pathname ?? target),
    safeQuery: safeMediaQuery(params),
    redactions: redactedMediaParams(params),
    hasPot: params?.has("pot") ?? false,
    hasSig:
      (params?.has("sig") || params?.has("lsig") || params?.has("signature")) ?? false,
    hasNParam: params?.has("n") ?? false,
    range: request.headers.get("range") || null,
    injectedHeaderNames: [...headers.keys()]
      .map((name) => name.toLowerCase())
      .filter((name) => !name.startsWith("x-muzero-"))
      .sort(),
  };
}

function safeUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function safeMediaQuery(params) {
  if (!params) return {};
  const safe = {};
  for (const key of ["itag", "mime", "dur", "clen", "source", "expire"]) {
    if (params.has(key)) safe[key] = params.get(key);
  }
  return safe;
}

function redactedMediaParams(params) {
  if (!params) return ["url.invalid"];
  const signed = new Set([
    "pot",
    "sig",
    "lsig",
    "signature",
    "spc",
    "bui",
    "id",
    "n",
    "cpn",
    "key",
    "token",
    "access_token",
    "auth",
    "authorization",
    "cookie",
  ]);
  const redactions = [];
  for (const key of params.keys()) {
    if (signed.has(key.toLowerCase())) redactions.push(`url.query.${key}`);
  }
  return redactions.sort();
}

function stableHash(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

module.exports = { handleMuzfetch };
