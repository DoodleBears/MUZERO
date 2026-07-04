/**
 * Shared lucide icon set for DJ tool calls, keyed by the `dj-tool-display`
 * icon-name strings (`toolIconName`). Both the dock activity card and the
 * in-chat tool-call rows resolve icons through this one map so a tool always
 * looks the same wherever it surfaces.
 */

import {
  Disc3,
  Download,
  FolderTree,
  Globe,
  ListMusic,
  ListOrdered,
  ListPlus,
  ListX,
  type LucideIcon,
  Pencil,
  Play,
  Repeat,
  Search,
  Sparkles,
  StickyNote,
  Tags,
  Wand2,
} from "lucide-react";

/** Lucide component per {@link import("@/chat/dj-tool-display").toolIconName} key. */
export const TOOL_ICON_COMPONENT: Record<string, LucideIcon> = {
  search: Search,
  "folder-tree": FolderTree,
  tags: Tags,
  "disc-3": Disc3,
  "list-music": ListMusic,
  "list-plus": ListPlus,
  pencil: Pencil,
  "list-ordered": ListOrdered,
  repeat: Repeat,
  "list-x": ListX,
  play: Play,
  "sticky-note": StickyNote,
  sparkles: Sparkles,
  globe: Globe,
  download: Download,
  "wand-2": Wand2,
};

/** Render a tool's icon by icon key, falling back to sparkles for unknown keys. */
export function ToolStepIcon({ iconKey, className }: { iconKey?: string; className?: string }) {
  const Icon = (iconKey ? TOOL_ICON_COMPONENT[iconKey] : undefined) ?? Sparkles;
  return <Icon aria-hidden className={className} />;
}
