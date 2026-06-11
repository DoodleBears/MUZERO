import type { CSSProperties } from "react";
import type { CloudSourceAttribution } from "@/db/types";
import { cn } from "@/lib/utils";

export function SourceAttributionChip({
  source,
  fallback,
  compact = false,
  className,
}: {
  source: CloudSourceAttribution;
  fallback: string;
  compact?: boolean;
  className?: string;
}) {
  const label = source.displayName || source.devicePublicId || source.driveLabel || fallback;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-secondary/70 px-1.5 py-0.5 text-muted-foreground text-xs",
        compact && "px-1",
        className,
      )}
      title={label}
      data-cloud-source-chip
    >
      <SourceAvatar source={source} label={label} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function SourceAvatar({ source, label }: { source: CloudSourceAttribution; label: string }) {
  if (source.avatarUrl) {
    return (
      <img
        src={source.avatarUrl}
        alt=""
        className="size-4 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  const seed = source.avatarSeed || source.devicePublicId || source.driveId || label;
  return (
    <span
      aria-hidden="true"
      className="grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-medium text-white"
      data-avatar-seed={seed}
      style={avatarStyle(seed)}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function avatarStyle(seed: string): CSSProperties {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 64% 48%), hsl(${(hue + 42) % 360} 58% 38%))`,
  };
}
