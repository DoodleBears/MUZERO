// `muzfetch://` protocol handler. The renderer's bridge rewrites every BYOK/R2
// request to this privileged scheme with the real target URL in `x-muzero-target`;
// the main process performs it with `net.fetch` (Chromium's network stack), so no
// renderer CORS / mixed-content applies. Streaming is preserved both ways — DJ SSE
// and large R2 PUT bodies flow through unbuffered — and SigV4 headers pass verbatim.
const { net } = require("electron");
const https = require("node:https");
const { Readable } = require("node:stream");

const TARGET_HEADER = "x-muzero-target";

/**
 * Fetch via Node's OWN net stack (node:https), bypassing Electron's net.fetch /
 * patched global fetch (both Chromium-backed). googlevideo 403s the Chromium request
 * but serves an identical Node request a 206 — verified against the exact URL + IP.
 * Returns a web `Response` so the caller re-wraps it unchanged. Follows redirects.
 */
function nodeHttpsFetch(target, init, depth = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(target);
    } catch (err) {
      reject(err);
      return;
    }
    const headers = {};
    for (const [name, value] of init.headers) headers[name] = value;
    const req = https.request(url, { method: init.method || "GET", headers }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (location && status >= 300 && status < 400 && depth < 5) {
        res.resume(); // drain
        resolve(nodeHttpsFetch(new URL(location, url).href, init, depth + 1));
        return;
      }
      const outHeaders = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value != null) outHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      resolve(
        new Response(Readable.toWeb(res), {
          status,
          statusText: res.statusMessage,
          headers: outHeaders,
        }),
      );
    });
    req.on("error", reject);
    if (init.body) Readable.fromWeb(init.body).pipe(req);
    else req.end();
  });
}

async function handleMuzfetch(request) {
  const headers = new Headers(request.headers);
  headers.delete(TARGET_HEADER);

  // Two ways the real target arrives:
  //  (a) fetch() calls — the bridge puts it in the `x-muzero-target` header.
  //  (b) media <audio>/<video> src — the element can't set request headers, so the
  //      target + headers to inject ride in the `muzfetch://media/?__mzurl=…&
  //      __mzh_<name>=…` URL (see electronMediaProxyUrl). The element's own Range
  //      header is on `request` and is forwarded, so 206 seeking works.
  let target = request.headers.get(TARGET_HEADER);
  if (!target) {
    const reqUrl = new URL(request.url);
    if (reqUrl.searchParams.has("__mzurl")) {
      target = reqUrl.searchParams.get("__mzurl");
      // The <audio>/<img> element's own Referer/Origin (localhost) is wrong for the
      // target CDN (hdslb/bilivideo 403 a foreign Referer) — drop them and use only
      // the explicitly-injected __mzh_* headers (bili media injects its Referer; cover
      // images inject none, and the CDNs serve with no Referer).
      headers.delete("referer");
      headers.delete("origin");
      // The <audio crossOrigin> element's cors-intent + client-hint headers
      // (Sec-Fetch-*, Sec-Ch-Ua*) leak the browser context to the CDN. node/undici
      // never sends them and googlevideo 403s a cors-mode media GET — so strip them
      // so the proxied request looks like a plain media fetch (harmless for the
      // bili/netease CDNs, which ignore them).
      for (const name of [...headers.keys()]) {
        if (name.startsWith("sec-fetch-") || name.startsWith("sec-ch-ua")) headers.delete(name);
      }
      for (const [name, value] of reqUrl.searchParams) {
        if (name.startsWith("__mzh_")) headers.set(name.slice("__mzh_".length), value);
      }
    }
  }
  if (!target) return new Response("missing muzfetch target", { status: 400 });
  // `host` is managed by net.fetch from the target URL — and SigV4 signs the URL's
  // host, so they align without us forwarding a (forbidden) Host header.

  // Restore restricted headers the renderer's fetch can't set (Cookie / Referer /
  // User-Agent / Origin). The bridge sends them as `x-muzero-h-<name>`; net.fetch in
  // the main process isn't bound by the renderer's forbidden-header list, so the real
  // names go out to the target. Stream sources (NetEase needs a Referer, etc.) depend
  // on this; without it the alias headers reach the server as garbage and are ignored.
  const ALIAS_PREFIX = "x-muzero-h-";
  for (const [name, value] of [...headers]) {
    if (name.startsWith(ALIAS_PREFIX)) {
      headers.set(name.slice(ALIAS_PREFIX.length), value);
      headers.delete(name);
    }
  }

  // googlevideo 403s Chromium's net.fetch but serves an identical Node request a 206
  // (same URL, same IP, clean headers — verified). So route googlevideo through
  // node:https; everything else stays on net.fetch for cookies / session / privileged-
  // scheme CORS bypass. credentials:"include" sends the default session's cookies
  // cross-origin (MUSIC_U / SESSDATA after a source login unlock VIP); node:https has
  // no cookie jar (googlevideo wants none anyway).
  let isGoogleVideo = false;
  try {
    isGoogleVideo = /(^|\.)googlevideo\.com$/i.test(new URL(target).hostname);
  } catch {
    // non-absolute target — treat as a normal proxied request
  }
  const init = { method: request.method, headers, redirect: "follow", credentials: "include" };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  const res = isGoogleVideo
    ? await nodeHttpsFetch(target, init)
    : await net.fetch(target, init);
  // Re-emit with permissive CORS so the privileged-scheme renderer can read it,
  // keeping the body a live stream (no buffering).
  const outHeaders = new Headers(res.headers);
  outHeaders.set("access-control-allow-origin", "*");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

module.exports = { handleMuzfetch };
