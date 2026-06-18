import { BlobSource, Input } from "mediabunny";
import { inferMediabunnyMime, MEDIABUNNY_INPUT_FORMATS } from "@/lib/media-mediabunny-formats";

const MEDIABUNNY_SOURCE_CACHE_BYTES = 8 * 2 ** 20;

export type MediabunnyProbeResult = {
  durationSec: number;
  mime?: string;
  width?: number;
  height?: number;
};

export async function probeMediaFileViaMediabunny(
  file: File,
): Promise<MediabunnyProbeResult | null> {
  let input: Input | null = null;
  try {
    const source = new BlobSource(file, { maxCacheSize: MEDIABUNNY_SOURCE_CACHE_BYTES });
    input = new Input({ formats: MEDIABUNNY_INPUT_FORMATS, source });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;

    const durationSec = await input.computeDuration([track]).catch(() => track.computeDuration());
    return {
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
      height: await track.getDisplayHeight().catch(() => undefined),
      mime: file.type || inferMediabunnyMime(file.name),
      width: await track.getDisplayWidth().catch(() => undefined),
    };
  } catch {
    return null;
  } finally {
    try {
      await input?.dispose?.();
    } catch {
      // best-effort
    }
  }
}
