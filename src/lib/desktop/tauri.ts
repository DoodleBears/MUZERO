import type { DirEntryLike } from "@/lib/folder-import";
import type { DesktopBridge, SaveFileInput } from "./bridge";

type FetchFn = typeof globalThis.fetch;

/**
 * Tauri 2 bridge. Kept fully working behind the abstraction while Electron is the
 * primary shell. Every `@tauri-apps/*` module is loaded via lazy `import()` inside
 * a method, so this file imports cleanly in a plain browser / test / worker and
 * never pulls a Tauri SDK until a capability is actually used.
 */
export function createTauriBridge(): DesktopBridge {
  let fsMod: typeof import("@tauri-apps/plugin-fs") | null = null;
  let pathMod: typeof import("@tauri-apps/api/path") | null = null;
  let realFetch: FetchFn | null = null;
  let coreMod: typeof import("@tauri-apps/api/core") | null = null;

  const loadCore = async () => {
    if (!coreMod) coreMod = await import("@tauri-apps/api/core");
    return coreMod;
  };

  const loadFs = async () => {
    if (!fsMod) fsMod = await import("@tauri-apps/plugin-fs");
    return fsMod;
  };
  const loadPath = async () => {
    if (!pathMod) pathMod = await import("@tauri-apps/api/path");
    return pathMod;
  };

  const fetchFn: FetchFn = async (...args) => {
    if (!realFetch) {
      try {
        realFetch = (await import("@tauri-apps/plugin-http")).fetch as unknown as FetchFn;
      } catch {
        realFetch = globalThis.fetch.bind(globalThis);
      }
    }
    return realFetch(...(args as Parameters<FetchFn>));
  };

  return {
    kind: "tauri",
    fetch: fetchFn,
    async pickFolder() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    },
    async readDir(path) {
      const { readDir } = await loadFs();
      return (await readDir(path)) as DirEntryLike[];
    },
    async readFile(path) {
      const { readFile } = await loadFs();
      return readFile(path);
    },
    async join(base, name) {
      const { join } = await loadPath();
      return join(base, name);
    },
    async grantFolderAccess(path) {
      const { invoke } = await loadCore();
      await invoke("allow_read_path", { path });
    },
    async saveFile({ fileName, mime, bytes }: SaveFileInput) {
      const [{ save }, { writeFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const path = await save({
        defaultPath: fileName,
        filters: [
          { name: mediaFilterName(mime), extensions: [fileName.split(".").pop() ?? "bin"] },
        ],
        title: "Download track",
      });
      if (!path) return false;
      await writeFile(path, bytes);
      return true;
    },
    async openExternal(url) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    },
    async startWindowDrag() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    },
  };
}

function mediaFilterName(mime: string): string {
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  return "Media";
}
