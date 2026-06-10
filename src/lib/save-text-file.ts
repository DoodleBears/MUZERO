import { resolveDesktopBridge } from "@/lib/desktop/bridge";

/**
 * Save a small text payload to disk — the native save-as dialog on desktop
 * (Electron / Tauri via the bridge), a browser download on web. Mirrors the
 * pattern in {@link downloadTrackMedia}; kept generic for JSON exports etc.
 */
export async function saveTextFile(fileName: string, mime: string, text: string): Promise<void> {
  const blob = new Blob([text], { type: mime });
  const bridge = resolveDesktopBridge();
  if (bridge.saveFile) {
    await bridge.saveFile({ fileName, mime, bytes: new Uint8Array(await blob.arrayBuffer()) });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
