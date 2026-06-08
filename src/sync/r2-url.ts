function assertHttpUrl(url: URL, label: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must be an HTTP(S) URL`);
  }
}

function manifestBaseDirectory(url: URL): string {
  if (url.pathname.endsWith("/")) return url.pathname;
  if (url.pathname.endsWith(".json")) {
    const lastSlash = url.pathname.lastIndexOf("/");
    return url.pathname.slice(0, lastSlash + 1);
  }
  return `${url.pathname}/`;
}

export function normalizeManifestUrl(input: string): string {
  const trimmed = input.trim();
  const url = new URL(trimmed);
  assertHttpUrl(url, "Manifest URL");
  url.hash = "";

  if (url.pathname.endsWith(".json")) return url.href;

  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${pathname}manifest.json`;
  return url.href;
}

export function resolveRemoteObjectUrl(baseUrl: string, ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error("Remote object ref is empty");

  const absoluteRef = new URL(trimmed, baseUrl);
  assertHttpUrl(absoluteRef, "Remote object URL");
  absoluteRef.hash = "";

  const isRelativeRef = !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (isRelativeRef) {
    const base = new URL(baseUrl);
    assertHttpUrl(base, "Base URL");
    const basePath = manifestBaseDirectory(base);
    if (absoluteRef.origin !== base.origin || !absoluteRef.pathname.startsWith(basePath)) {
      throw new Error("Remote object ref resolves outside the manifest base");
    }
  }

  return absoluteRef.href;
}
