// `muzfetch://` protocol handler. The renderer's bridge rewrites every BYOK/R2
// request to this privileged scheme with the real target URL in `x-muzero-target`;
// the main process performs it with `net.fetch` (Chromium's network stack), so no
// renderer CORS / mixed-content applies. Streaming is preserved both ways — DJ SSE
// and large R2 PUT bodies flow through unbuffered — and SigV4 headers pass verbatim.
const { net } = require("electron");

const TARGET_HEADER = "x-muzero-target";

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

  // credentials:"include" so net.fetch sends the default session's cookies even cross-
  // origin (default "same-origin" would drop them). After a source login, MUSIC_U /
  // SESSDATA live in the default session — this unlocks VIP / higher quality.
  // Exception: googlevideo issues *guest* playback URLs (signed by ip + expire) and
  // 403s a GET that arrives carrying YouTube account/visitor cookies — so omit them
  // for googlevideo media only (NetEase/Bilibili CDN GETs are unaffected).
  let credentials = "include";
  try {
    if (/(^|\.)googlevideo\.com$/i.test(new URL(target).hostname)) credentials = "omit";
  } catch {
    // non-absolute target — leave credentials as-is
  }
  const init = { method: request.method, headers, redirect: "follow", credentials };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  const res = await net.fetch(target, init);
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
