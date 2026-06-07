export type MemoryShortcut = "create-memory";

export interface MemoryShortcutKeyEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function resolveMemoryShortcut(event: MemoryShortcutKeyEvent): MemoryShortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "t" || key === "n") return "create-memory";
  return null;
}
