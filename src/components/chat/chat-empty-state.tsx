import { Music2, Sparkles, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChatEmptyStateLabels {
  body: ReactNode;
  presets: ReactNode;
  startWithVibe: string;
  title: ReactNode;
  uploadLibrary: string;
}

export interface ChatPromptPreset {
  id: string;
  label: string;
  prompt: string;
}

interface ChatEmptyStateProps {
  className?: string;
  labels: ChatEmptyStateLabels;
  onInsertPrompt?: (prompt: string) => void;
  onStartWithVibe?: () => void;
  onUploadLibrary?: () => void;
  presets: ChatPromptPreset[];
}

export function ChatEmptyState({
  className,
  labels,
  onInsertPrompt,
  onStartWithVibe,
  onUploadLibrary,
  presets,
}: ChatEmptyStateProps) {
  return (
    <section
      aria-labelledby="chat-empty-state-title"
      className={cn("flex min-h-0 flex-1 flex-col justify-center gap-5 p-4", className)}
    >
      <div className="space-y-2">
        <div className="flex size-10 items-center justify-center rounded-lg border bg-muted/30 text-primary">
          <Music2 className="size-5" />
        </div>
        <h2 className="font-medium text-base" id="chat-empty-state-title">
          {labels.title}
        </h2>
        <p className="max-w-sm text-muted-foreground text-sm">{labels.body}</p>
      </div>

      {presets.length > 0 && (
        <div className="space-y-2">
          <div className="font-medium text-muted-foreground text-xs">{labels.presets}</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.id}
                onClick={() => onInsertPrompt?.(preset.prompt)}
                size="sm"
                variant="outline"
              >
                <Sparkles />
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onUploadLibrary} size="sm" variant="secondary">
          <Upload />
          {labels.uploadLibrary}
        </Button>
        <Button onClick={onStartWithVibe} size="sm" variant="outline">
          <Sparkles />
          {labels.startWithVibe}
        </Button>
      </div>
    </section>
  );
}
