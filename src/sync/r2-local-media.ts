import type { Track } from "@/db/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { basename, mimeFromExtension } from "@/lib/folder-import";
import type { R2LocalMediaResolver } from "./r2-export-plan";
import type { R2PublishLocalMediaOptions } from "./r2-publish";

export interface DesktopR2LocalMedia {
  resolver: R2LocalMediaResolver;
  publisher: R2PublishLocalMediaOptions;
}

/**
 * Upload-on-demand support for Electron/Tauri referenced local files.
 *
 * Import stays fast because plaintext folder imports only store `Track.sourcePath`.
 * R2 publish is the moment we read bytes: first to compute the content-addressed
 * sha256 key, then to hand the file body to the signed PUT.
 */
export function createDesktopR2LocalMedia(): DesktopR2LocalMedia | undefined {
  const bridge = resolveDesktopBridge();
  if (!bridge.readFile) return undefined;

  const readFile = bridge.readFile;
  const localMediaUrl = bridge.localMediaUrl;

  return {
    resolver: {
      async resolve(track: Track) {
        if (!track.sourcePath) return undefined;
        const bytes = await readFile(track.sourcePath);
        const mime = mediaMime(track);
        const sha256 = await sha256Hex(bytes);
        return {
          body: {
            kind: "local-file",
            path: track.sourcePath,
            bytes: bytes.byteLength,
            mime,
            sha256,
          },
          bytes: bytes.byteLength,
          mime,
          sha256,
        };
      },
    },
    publisher: {
      open: async (body) => {
        if (!localMediaUrl) return readFile(body.path);
        const url = await localMediaUrl({ path: body.path, mime: body.mime });
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to open referenced local media: HTTP ${response.status}`);
        }
        return response.body ?? new Uint8Array(await response.arrayBuffer());
      },
    },
  };
}

function mediaMime(track: Track): string {
  if (track.mediaMetadata?.originalMime) return track.mediaMetadata.originalMime;
  return mimeFromExtension(
    track.mediaMetadata?.originalFileName ?? basename(track.sourcePath ?? track.title),
    track.kind,
  );
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
