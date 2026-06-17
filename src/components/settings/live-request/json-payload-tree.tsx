import { cn } from "@/lib/utils";

/**
 * Read-only, clickable view of a captured sample payload. Clicking a leaf calls
 * `onSelect` with the template expression for that path (e.g.
 * `{{ payload.user.name }}`) so the mapping dialog can drop it into the focused
 * target field — the "see the real JSON, build the mapping from it" flow.
 */
export function JsonPayloadTree({
  data,
  onSelect,
}: {
  data: unknown;
  onSelect: (expression: string) => void;
}) {
  return (
    <div className="p-2 font-mono text-xs leading-relaxed">
      <JsonNode value={data} path="payload" depth={0} onSelect={onSelect} />
    </div>
  );
}

function leafText(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

function JsonNode({
  value,
  path,
  depth,
  onSelect,
}: {
  value: unknown;
  path: string;
  depth: number;
  onSelect: (expression: string) => void;
}) {
  if (Array.isArray(value)) {
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        {value.map((child, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: read-only static tree; the path index is the stable identity
          <div key={`${path}.${index}`}>
            <span className="text-muted-foreground">[{index}]</span>{" "}
            <JsonNode
              value={child}
              path={`${path}.${index}`}
              depth={depth + 1}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    );
  }

  if (value && typeof value === "object") {
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
          <div key={`${path}.${key}`} className="flex flex-wrap items-start gap-1">
            <span className="text-primary">{key}:</span>
            <JsonNode value={child} path={`${path}.${key}`} depth={depth + 1} onSelect={onSelect} />
          </div>
        ))}
      </div>
    );
  }

  // Leaf — clickable to insert the template expression for this path.
  return (
    <button
      type="button"
      onClick={() => onSelect(`{{ ${path} }}`)}
      className={cn(
        "max-w-full truncate rounded px-1 text-left hover:bg-accent hover:text-accent-foreground",
        typeof value === "string" ? "text-foreground" : "text-amber-600 dark:text-amber-400",
      )}
      title={`Insert {{ ${path} }}`}
    >
      {leafText(value)}
    </button>
  );
}
