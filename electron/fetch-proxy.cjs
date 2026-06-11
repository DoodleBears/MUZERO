// `muzfetch://` protocol handler. The renderer's bridge rewrites every BYOK/R2
// request to this privileged scheme with the real target URL in `x-muzero-target`;
// the main process performs it with `net.fetch` (Chromium's network stack), so no
// renderer CORS / mixed-content applies. Streaming is preserved both ways — DJ SSE
// and large R2 PUT bodies flow through unbuffered — and SigV4 headers pass verbatim.
const { net, session } = require("electron");
const { spawn } = require("node:child_process");
const { emitMainDiagnostic } = require("./diagnostics.cjs");

const TARGET_HEADER = "x-muzero-target";

const MEDIA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Resolve the proxy Chromium would use for `target` into a `curl -x` argument.
 * Critical for googlevideo: the renderer's youtubei `/player` call runs through
 * `net.fetch` (Chromium), which honors the OS/system proxy — so the media URL is
 * IP-locked to the *proxy's* exit. `curl` ignores the system proxy by default and
 * would egress the real ISP IP → mismatch → 403. Tunnelling curl through the same
 * proxy makes both egress the same IP. Returns null for DIRECT (no proxy).
 */
async function resolveProxyArg(target) {
  try {
    const rule = await session.defaultSession.resolveProxy(target);
    const first = (rule || "").split(/[;,]/)[0].trim(); // "PROXY h:p" | "SOCKS5 h:p" | "DIRECT"
    if (!first || /^DIRECT$/i.test(first)) return null;
    const [scheme, hostport] = first.split(/\s+/);
    if (!hostport) return null;
    const s = scheme.toUpperCase();
    if (s.startsWith("SOCKS")) return `socks5h://${hostport}`;
    if (s === "HTTPS") return `https://${hostport}`;
    return `http://${hostport}`; // PROXY / HTTP
  } catch {
    return null;
  }
}

/**
 * Fetch a googlevideo media URL through the system `curl`. Every request from the
 * Electron process — `net.fetch` AND `node:https`, both on Chromium's BoringSSL —
 * is fingerprinted by googlevideo and 403'd, while curl's own TLS gets a 206 (proven
 * against the exact URL + IP: same egress IP, same headers, opposite result). curl
 * ships on macOS, Windows 10+, and virtually all Linux. When a system proxy is in
 * play we tunnel curl through it (`-x`) so its egress IP matches the proxy-bound
 * `/player` URL. We stream curl's stdout as the Response body and parse the status +
 * headers from its `-i` header block; the `<audio>` element's Range rides along for
 * 206 seeking.
 */
function curlMediaFetch(target, range, proxy) {
  return new Promise((resolve, reject) => {
    const args = ["-sS", "-i", "--connect-timeout", "15", "-A", MEDIA_UA];
    if (proxy) args.push("-x", proxy);
    if (range) args.push("-H", `Range: ${range}`);
    args.push(target);

    let child;
    try {
      child = spawn("curl", args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let headerBuf = Buffer.alloc(0);
    let parsed = false;
    let controller;
    let closed = false;
    // The consumer (an <audio> seek / track switch) can cancel mid-stream, and stdout
    // `end` + child `close` can both fire — guard so we never enqueue/close twice.
    const safeEnqueue = (chunk) => {
      if (closed) return;
      try {
        controller.enqueue(chunk);
      } catch {
        closed = true;
        child.kill();
      }
    };
    const safeClose = () => {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // already closed
      }
    };
    const body = new ReadableStream({
      start(c) {
        controller = c;
      },
      cancel() {
        closed = true;
        child.kill();
      },
    });

    child.stdout.on("data", (chunk) => {
      if (parsed) {
        safeEnqueue(chunk);
        return;
      }
      headerBuf = Buffer.concat([headerBuf, chunk]);
      // The header/body boundary is a blank line — CRLF over HTTP/1.1, but curl's
      // HTTP/2 `-i` output can use LF. Accept either.
      let sep = headerBuf.indexOf("\r\n\r\n");
      let sepLen = 4;
      if (sep === -1) {
        sep = headerBuf.indexOf("\n\n");
        sepLen = 2;
      }
      if (sep === -1) return;
      const lines = headerBuf.subarray(0, sep).toString("latin1").split(/\r?\n/);
      const rest = headerBuf.subarray(sep + sepLen);
      const status = Number.parseInt((lines[0] || "").split(/\s+/)[1], 10) || 200;
      const respHeaders = new Headers();
      for (const line of lines.slice(1)) {
        const i = line.indexOf(":");
        if (i <= 0) continue;
        try {
          respHeaders.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
        } catch {
          // skip a header value the Headers ctor rejects (e.g. duplicates curl folds)
        }
      }
      emitMainDiagnostic(
        status >= 400 ? "error" : "debug",
        "stream.proxy",
        status >= 400 ? "request.failed" : "response.received",
        "curl googlevideo response",
        {
          category: "network",
          phase: status >= 400 ? "fail" : "success",
          errorKind: status >= 400 ? "http_status" : undefined,
          source: "electron-main",
          httpStatus: status,
          contentType: respHeaders.get("content-type") || undefined,
          range: range || null,
          acceptRanges: respHeaders.get("accept-ranges") || null,
          contentRange: respHeaders.get("content-range") || null,
          contentLength: respHeaders.get("content-length") || null,
          requestHost: hostForTarget(target),
          proxyMode: proxy ? "system-proxy" : "direct",
        },
      );
      parsed = true;
      resolve(new Response(body, { status, headers: respHeaders }));
      if (rest.length) safeEnqueue(rest);
    });
    child.stdout.on("end", () => {
      if (parsed) safeClose();
    });

    let errText = "";
    child.stderr.on("data", (c) => {
      errText += c;
    });
    child.on("error", (err) => {
      emitMainDiagnostic("error", "stream.proxy", "request.failed", "curl spawn error", {
        category: "network",
        phase: "fail",
        errorKind: "network_error",
        source: "electron-main",
        requestHost: hostForTarget(target),
        errorName: err.name,
        errorMessage: err.message,
      });
      reject(err);
    });
    child.on("close", (code) => {
      if (!parsed) {
        emitMainDiagnostic("error", "stream.proxy", "request.failed", "curl no response", {
          category: "network",
          phase: "fail",
          errorKind: "network_error",
          source: "electron-main",
          requestHost: hostForTarget(target),
          exitCode: code,
          stderrPreview: errText.slice(0, 160),
        });
        reject(new Error(`curl exited ${code}`));
      }
    });
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
  let isMediaRequest = false;
  if (!target) {
    const reqUrl = new URL(request.url);
    if (reqUrl.searchParams.has("__mzurl")) {
      isMediaRequest = true;
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

  // googlevideo blocks Electron's BoringSSL net stack — route it through curl instead
  // (see curlMediaFetch). Everything else stays on net.fetch for cookies / session /
  // privileged-scheme CORS bypass.
  let isGoogleVideo = false;
  try {
    isGoogleVideo = /(^|\.)googlevideo\.com$/i.test(new URL(target).hostname);
  } catch {
    // non-absolute target — treat as a normal proxied request
  }

  let res;
  if (isGoogleVideo) {
    try {
      const proxy = await resolveProxyArg(target);
      res = await curlMediaFetch(target, headers.get("range"), proxy);
    } catch (err) {
      return new Response(`youtube media fetch failed: ${err.message}`, { status: 502 });
    }
  } else {
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
    res = await net.fetch(target, init);
  }

  // Re-emit with permissive CORS so the privileged-scheme renderer can read it,
  // keeping the body a live stream (no buffering).
  const outHeaders = new Headers(res.headers);
  if (isMediaRequest) {
    emitMainDiagnostic(
      res.status >= 400 ? "error" : "debug",
      "stream.proxy",
      res.status >= 400 ? "request.failed" : "response.received",
      "media proxy response",
      {
        category: "network",
        phase: res.status >= 400 ? "fail" : "success",
        errorKind: res.status >= 400 ? "http_status" : undefined,
        source: "electron-main",
        httpStatus: res.status,
        contentType: outHeaders.get("content-type") || undefined,
        range: request.headers.get("range") || null,
        acceptRanges: outHeaders.get("accept-ranges") || null,
        contentRange: outHeaders.get("content-range") || null,
        contentLength: outHeaders.get("content-length") || null,
        requestHost: hostForTarget(target),
      },
    );
  }
  outHeaders.set("access-control-allow-origin", "*");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

function hostForTarget(target) {
  try {
    return new URL(target).hostname;
  } catch {
    return undefined;
  }
}

module.exports = { handleMuzfetch };
