/**
 * Renderer-side copy-remux: combine a video-only blob + audio-only blob (the two DASH
 * tracks) into ONE container, **copying encoded packets — no re-encode** (video PRD §4.2).
 * Uses mediabunny's low-level packet path (read packets from each Input, write them to one
 * Output), so it needs no encoder and stays lossless. Runs in a Worker in production
 * (rule 7); this module is the pure mediabunny call (verified via the dev harness E2E, not
 * vitest — jsdom has no WebCodecs).
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  type EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MkvOutputFormat,
  Mp4OutputFormat,
  Output,
  type OutputFormat,
  WebMOutputFormat,
} from "mediabunny";
import type { MuxContainer } from "./mux-strategy";

const INPUT_CACHE_BYTES = 16 * 2 ** 20;

const CONTAINER_MIME: Record<MuxContainer, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

function outputFormatFor(container: MuxContainer): OutputFormat {
  switch (container) {
    case "mp4":
      // Fast Start so the moov box is up front → the muxed file is seekable/streamable.
      return new Mp4OutputFormat({ fastStart: "in-memory" });
    case "webm":
      return new WebMOutputFormat();
    case "mkv":
      return new MkvOutputFormat();
  }
}

/** Copy every packet from a sink into a packet source; metadata (decoder config) on first. */
async function pumpPackets<M>(
  sink: EncodedPacketSink,
  add: (packet: EncodedPacket, meta?: M) => Promise<void>,
  firstMeta: M | undefined,
  onTimestamp?: (ts: number) => void,
): Promise<void> {
  let packet = await sink.getFirstPacket();
  let first = true;
  while (packet) {
    await add(packet, first ? firstMeta : undefined);
    first = false;
    onTimestamp?.(packet.timestamp);
    packet = await sink.getNextPacket(packet);
  }
}

/**
 * Copy-remux `videoBlob` (video-only) + `audioBlob` (audio-only) into one `container` blob,
 * without re-encoding. Throws if a track/codec can't be read. `onProgress` reports
 * 0..1 by video presentation time.
 */
export async function muxCopyTracks(
  videoBlob: Blob,
  audioBlob: Blob,
  container: MuxContainer,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const videoInput = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(videoBlob, { maxCacheSize: INPUT_CACHE_BYTES }),
  });
  const audioInput = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(audioBlob, { maxCacheSize: INPUT_CACHE_BYTES }),
  });
  try {
    const videoTrack = await videoInput.getPrimaryVideoTrack();
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    if (!videoTrack?.codec) throw new Error("downloaded video stream has no readable video track");
    if (!audioTrack?.codec) throw new Error("downloaded audio stream has no readable audio track");

    const videoConfig = await videoTrack.getDecoderConfig();
    const audioConfig = await audioTrack.getDecoderConfig();
    const totalDuration = await videoTrack.computeDuration().catch(() => 0);

    const output = new Output({ format: outputFormatFor(container), target: new BufferTarget() });
    const videoSource = new EncodedVideoPacketSource(videoTrack.codec);
    const audioSource = new EncodedAudioPacketSource(audioTrack.codec);
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
    await output.start();

    await pumpPackets(
      new EncodedPacketSink(videoTrack),
      (packet, meta) => videoSource.add(packet, meta),
      videoConfig ? { decoderConfig: videoConfig } : undefined,
      totalDuration > 0 && onProgress
        ? (ts) => onProgress(Math.max(0, Math.min(1, ts / totalDuration)))
        : undefined,
    );
    await pumpPackets(
      new EncodedPacketSink(audioTrack),
      (packet, meta) => audioSource.add(packet, meta),
      audioConfig ? { decoderConfig: audioConfig } : undefined,
    );

    await output.finalize();
    const { buffer } = output.target as BufferTarget;
    if (!buffer) throw new Error("mux produced no output buffer");
    return new Blob([buffer], { type: CONTAINER_MIME[container] });
  } finally {
    try {
      await videoInput.dispose?.();
    } catch {
      // best-effort cleanup
    }
    try {
      await audioInput.dispose?.();
    } catch {
      // best-effort cleanup
    }
  }
}
