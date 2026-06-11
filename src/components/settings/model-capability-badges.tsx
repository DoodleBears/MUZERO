import { AudioLines, Coins, Eye, Ruler, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import type { LlmModelPreset } from "@/ai/llm-providers";
import { formatContextLength, formatPricePerMillion } from "@/ai/model-catalog";
import { cn } from "@/lib/utils";

export interface ModelCapabilityLabels {
  vision: string;
  audio: string;
  tools: string;
  context: string;
  /** e.g. (inLabel, outLabel) => `Input ${inLabel} · Output ${outLabel} / 1M tokens` */
  price: (inLabel: string, outLabel: string) => string;
}

/**
 * Compact capability badges for an LLM model (ClipCombo parity): vision / audio
 * input, function-calling, context window, and input/output price — shown as
 * lucide glyphs with `title` tooltips. Renders nothing when the model carries no
 * metadata (e.g. a bare OpenAI `/models` entry).
 */
export function ModelCapabilityBadges({
  className,
  labels,
  model,
}: {
  className?: string;
  labels: ModelCapabilityLabels;
  model: LlmModelPreset;
}) {
  const hasPrice =
    model.inputCostPerMillionUsd !== undefined || model.outputCostPerMillionUsd !== undefined;
  const hasAny =
    model.supportsVision ||
    model.supportsAudio ||
    model.supportsTools ||
    model.contextLimit !== undefined ||
    hasPrice;
  if (!hasAny) return null;

  const priceTitle = hasPrice
    ? labels.price(
        formatPricePerMillion(model.inputCostPerMillionUsd ?? 0),
        formatPricePerMillion(model.outputCostPerMillionUsd ?? 0),
      )
    : "";

  return (
    <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5", className)}>
      {model.supportsVision && <IconBadge icon={Eye} title={labels.vision} />}
      {model.supportsAudio && <IconBadge icon={AudioLines} title={labels.audio} />}
      {model.supportsTools && <IconBadge icon={Wrench} title={labels.tools} />}
      {model.contextLimit !== undefined && (
        <IconBadge icon={Ruler} title={labels.context}>
          {formatContextLength(model.contextLimit)}
        </IconBadge>
      )}
      {hasPrice && (
        <IconBadge icon={Coins} title={priceTitle}>
          {formatPricePerMillion(model.inputCostPerMillionUsd ?? 0)}
          <span className="opacity-50">/</span>
          {formatPricePerMillion(model.outputCostPerMillionUsd ?? 0)}
        </IconBadge>
      )}
    </span>
  );
}

function IconBadge({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
      title={title}
    >
      <Icon className="size-3" />
      {children}
    </span>
  );
}
