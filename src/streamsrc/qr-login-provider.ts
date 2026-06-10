/**
 * QR-login driver: a source-agnostic poll state machine over a per-source QR API.
 * `generate()` yields the QR content to render; `qrPollLoop()` polls until the phone
 * scan completes (success → read the freshly-set cookie), the QR expires, the caller
 * aborts, or a timeout. The clock + http are injected so the loop is deterministic
 * under test.
 */

import type { StreamHttp } from "./http";
import { withQuery } from "./http";
import { eapiEncrypt } from "./netease/netease-crypto";
import {
  BILI_QR_GENERATE_URL,
  BILI_QR_POLL_URL,
  mapBiliQrStatus,
  mapNeteaseQrStatus,
  NETEASE_QR_CHECK_PATH,
  NETEASE_QR_UNIKEY_PATH,
  neteaseQrContent,
  parseBiliQrGenerate,
  parseNeteaseUnikey,
  type QrGenerateResult,
  type QrStatus,
} from "./qr-login";

export interface QrSourceApi {
  generate(): Promise<QrGenerateResult>;
  poll(qrKey: string): Promise<QrStatus>;
}

const NETEASE_QR_UNIKEY_URL = "https://interface.music.163.com/eapi/login/qrcode/unikey";
const NETEASE_QR_CHECK_URL = "https://interface.music.163.com/eapi/login/qrcode/client/login";
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

async function postJson(http: StreamHttp, url: string, params: string): Promise<unknown> {
  const res = await http({
    url,
    method: "POST",
    headers: FORM,
    body: `params=${encodeURIComponent(params)}`,
  });
  return JSON.parse(await res.text());
}

/** NetEase QR via eapi (unikey → client/login poll). */
export function createNeteaseQrApi(http: StreamHttp): QrSourceApi {
  return {
    async generate() {
      const json = await postJson(
        http,
        NETEASE_QR_UNIKEY_URL,
        eapiEncrypt(NETEASE_QR_UNIKEY_PATH, JSON.stringify({ type: 1 })).params,
      );
      const unikey = parseNeteaseUnikey(json);
      if (!unikey) throw new Error("netease QR: no unikey");
      return { qrKey: unikey, qrContent: neteaseQrContent(unikey) };
    },
    async poll(qrKey) {
      const json = (await postJson(
        http,
        NETEASE_QR_CHECK_URL,
        eapiEncrypt(NETEASE_QR_CHECK_PATH, JSON.stringify({ key: qrKey, type: 1 })).params,
      )) as { code?: number };
      return mapNeteaseQrStatus(typeof json.code === "number" ? json.code : -1);
    },
  };
}

/** Bilibili QR via the web passport endpoints (unsigned GET). */
export function createBiliQrApi(http: StreamHttp): QrSourceApi {
  return {
    async generate() {
      const res = await http({ url: BILI_QR_GENERATE_URL, method: "GET" });
      const parsed = parseBiliQrGenerate(JSON.parse(await res.text()));
      if (!parsed) throw new Error("bili QR: bad generate response");
      return parsed;
    },
    async poll(qrKey) {
      const res = await http({
        url: withQuery(BILI_QR_POLL_URL, { qrcode_key: qrKey }),
        method: "GET",
      });
      return mapBiliQrStatus(JSON.parse(await res.text()));
    },
  };
}

export type QrOutcome = "success" | "expired" | "timeout" | "cancelled";

export interface QrPollDeps {
  readCookie: () => Promise<string | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onStatus?: (status: QrStatus) => void;
  signal?: { aborted: boolean };
  intervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_INTERVAL = 1500;
const DEFAULT_TIMEOUT = 3 * 60 * 1000;

/** Poll `api` until the QR resolves; emit distinct status transitions via `onStatus`. */
export async function qrPollLoop(
  api: QrSourceApi,
  qrKey: string,
  deps: QrPollDeps,
): Promise<{ outcome: QrOutcome; cookie?: string }> {
  const interval = deps.intervalMs ?? DEFAULT_INTERVAL;
  const timeout = deps.timeoutMs ?? DEFAULT_TIMEOUT;
  const start = deps.now();
  let last: QrStatus | null = null;

  while (true) {
    if (deps.signal?.aborted) return { outcome: "cancelled" };
    if (deps.now() - start > timeout) return { outcome: "timeout" };

    const status = await api.poll(qrKey);
    if (status !== last) {
      deps.onStatus?.(status);
      last = status;
    }
    if (status === "success") {
      const cookie = await deps.readCookie();
      return { outcome: "success", cookie: cookie ?? undefined };
    }
    if (status === "expired") return { outcome: "expired" };

    await deps.sleep(interval);
  }
}
