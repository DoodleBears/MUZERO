import { generateObject } from "ai";
import { z } from "zod";
import { resolveDjModel } from "@/ai/model";
import type { AppSettings } from "@/db/types";
import { log } from "@/lib/logger";
import { type TrackBrief, trackBriefSchema } from "./dj-brief-schema";
import type { DjBrain } from "./dj-engine";
import { buildDjUserPrompt, DJ_SYSTEM_PROMPT, type DjContext } from "./dj-prompt";

const draftSchema = z.object({
  tracks: z.array(trackBriefSchema).min(1).max(8),
});

/**
 * The production DJ brain: an LLM (via the Vercel AI SDK) that emits validated
 * TrackBriefs through structured output. Construct it from settings; the engine
 * only sees the `DjBrain` interface.
 */
export function createAiDjBrain(settings: AppSettings): DjBrain {
  return {
    async draftBriefs(ctx: DjContext): Promise<TrackBrief[]> {
      const model = await resolveDjModel(settings);
      const { object } = await generateObject({
        model,
        schema: draftSchema,
        system: DJ_SYSTEM_PROMPT,
        prompt: buildDjUserPrompt(ctx),
        temperature: 0.9,
      });
      log.debug("dj-brain", `model drafted ${object.tracks.length} brief(s)`);
      return object.tracks;
    },
  };
}
