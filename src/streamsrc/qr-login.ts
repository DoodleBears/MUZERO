/**
 * In-app QR login — pure response parsing + status mapping for NetEase + Bilibili.
 * The provider (qr-login-provider) drives `generate → poll(waiting→scanned→success)`
 * over an injected HTTP client; these functions own the source-specific shapes so the
 * state machine stays source-agnostic. On `success` the platform sets the session
 * cookie (net.fetch stores it), which the desktop bridge then reads out.
 */

export type QrStatus = "waiting" | "scanned" | "success" | "expired";

export interface QrGenerateResult {
  /** Opaque key passed to the poll endpoint (netease unikey / bili qrcode_key). */
  qrKey: string;
  /** The URL to encode in the QR image (what the phone app scans). */
  qrContent: string;
}

// --- NetEase (eapi) ----------------------------------------------------------
export const NETEASE_QR_UNIKEY_PATH = "/api/login/qrcode/unikey";
export const NETEASE_QR_CHECK_PATH = "/api/login/qrcode/client/login";

export function parseNeteaseUnikey(json: unknown): string | null {
  const unikey = (json as { unikey?: unknown } | null)?.unikey;
  return typeof unikey === "string" && unikey.length > 0 ? unikey : null;
}

export function neteaseQrContent(unikey: string): string {
  return `https://music.163.com/login?codekey=${unikey}`;
}

/** 801 waiting · 802 scanned · 803 success · 800 expired (unknown → keep waiting). */
export function mapNeteaseQrStatus(code: number): QrStatus {
  switch (code) {
    case 803:
      return "success";
    case 802:
      return "scanned";
    case 800:
      return "expired";
    default:
      return "waiting";
  }
}

// --- Bilibili (web passport) -------------------------------------------------
export const BILI_QR_GENERATE_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
export const BILI_QR_POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";

export function parseBiliQrGenerate(json: unknown): QrGenerateResult | null {
  const data = (json as { data?: { url?: unknown; qrcode_key?: unknown } } | null)?.data;
  const url = data?.url;
  const key = data?.qrcode_key;
  if (typeof url !== "string" || typeof key !== "string" || !url || !key) return null;
  return { qrKey: key, qrContent: url };
}

/** poll status rides in `data.code`: 0 success · 86101 waiting · 86090 scanned · 86038 expired. */
export function mapBiliQrStatus(json: unknown): QrStatus {
  const code = (json as { data?: { code?: unknown } } | null)?.data?.code;
  switch (code) {
    case 0:
      return "success";
    case 86090:
      return "scanned";
    case 86038:
      return "expired";
    default:
      return "waiting";
  }
}
