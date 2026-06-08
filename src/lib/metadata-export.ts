import type { MediaBlob, Track } from "@/db/types";

export type TrackExportMode = "original" | "withMetadata";

export class UnsupportedMetadataExportError extends Error {
  constructor(readonly mime: string) {
    super(`Metadata export is not supported for ${mime || "unknown media type"}`);
    this.name = "UnsupportedMetadataExportError";
  }
}

export async function createTrackExportBlob(input: {
  cover?: MediaBlob;
  media: MediaBlob;
  mode: TrackExportMode;
  track: Track;
}): Promise<Blob> {
  const { cover, media, mode, track } = input;
  if (mode === "original") return media.blob;
  const mediaBytes = new Uint8Array(await media.blob.arrayBuffer());
  const coverPayload = cover
    ? { bytes: new Uint8Array(await cover.blob.arrayBuffer()), mime: cover.mime }
    : undefined;
  if (isMp3Media(media, track)) {
    const audioBytes = stripLeadingId3Tag(mediaBytes);
    const tag = buildId3v23Tag(track, coverPayload);
    return new Blob([toArrayBuffer(tag), toArrayBuffer(audioBytes)], {
      type: media.mime || "audio/mpeg",
    });
  }
  if (isFlacMedia(media, track)) {
    return new Blob([toArrayBuffer(buildFlacWithMetadata(mediaBytes, track, coverPayload))], {
      type: media.mime || "audio/flac",
    });
  }
  if (isM4aMedia(media, track)) {
    return new Blob([toArrayBuffer(buildM4aWithMetadata(mediaBytes, track, coverPayload))], {
      type: media.mime || "audio/mp4",
    });
  }
  throw new UnsupportedMetadataExportError(media.mime);
}

function isMp3Media(media: MediaBlob, track: Track): boolean {
  return (
    media.mime === "audio/mpeg" ||
    media.mime === "audio/mp3" ||
    track.mediaMetadata?.originalExtension === "mp3"
  );
}

function isFlacMedia(media: MediaBlob, track: Track): boolean {
  return media.mime === "audio/flac" || track.mediaMetadata?.originalExtension === "flac";
}

function isM4aMedia(media: MediaBlob, track: Track): boolean {
  return (
    media.mime === "audio/mp4" ||
    media.mime === "audio/m4a" ||
    track.mediaMetadata?.originalExtension === "m4a" ||
    track.mediaMetadata?.originalExtension === "mp4"
  );
}

function buildId3v23Tag(track: Track, cover?: { bytes: Uint8Array; mime: string }): Uint8Array {
  const metadata = track.mediaMetadata;
  const frames = [
    textFrame("TIT2", metadata?.title || track.title),
    textFrame("TPE1", metadata?.artists?.join("; ")),
    textFrame("TALB", metadata?.album),
    textFrame("TCON", metadata?.genres?.join("; ") || track.tags.join("; ")),
    textFrame("TYER", metadata?.year ? String(metadata.year) : undefined),
    textFrame("TRCK", trackNumber(metadata?.trackNo, metadata?.trackOf)),
    commentFrame(track.brief?.caption || track.note),
    cover ? pictureFrame(cover.mime, cover.bytes) : undefined,
  ].filter((frame): frame is Uint8Array => !!frame);
  const payload = concatBytes(frames);
  return concatBytes([
    asciiBytes("ID3"),
    new Uint8Array([3, 0, 0]),
    synchsafe(payload.byteLength),
    payload,
  ]);
}

function stripLeadingId3Tag(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return bytes;
  }
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return bytes.slice(10 + size);
}

function buildFlacWithMetadata(
  bytes: Uint8Array,
  track: Track,
  cover?: { bytes: Uint8Array; mime: string },
): Uint8Array {
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43
  ) {
    throw new UnsupportedMetadataExportError("audio/flac");
  }
  const preserved: { payload: Uint8Array; type: number }[] = [];
  let offset = 4;
  while (offset + 4 <= bytes.byteLength) {
    const header = bytes[offset];
    const type = header & 0x7f;
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const payloadStart = offset + 4;
    const payloadEnd = payloadStart + length;
    if (payloadEnd > bytes.byteLength) throw new UnsupportedMetadataExportError("audio/flac");
    if (type !== 4 && type !== 6)
      preserved.push({ payload: bytes.slice(payloadStart, payloadEnd), type });
    offset = payloadEnd;
    if (header & 0x80) break;
  }

  const metadataBlocks = [
    ...preserved.map((block) => flacMetadataBlock(block.type, block.payload)),
    flacMetadataBlock(4, flacVorbisCommentBlock(track), !cover),
    cover ? flacMetadataBlock(6, flacPictureBlock(cover.mime, cover.bytes), true) : undefined,
  ].filter((block): block is Uint8Array => !!block);
  return concatBytes([asciiBytes("fLaC"), ...metadataBlocks, bytes.slice(offset)]);
}

function flacVorbisCommentBlock(track: Track): Uint8Array {
  const metadata = track.mediaMetadata;
  const comments = [
    ["TITLE", metadata?.title || track.title],
    ["ARTIST", metadata?.artists?.join("; ")],
    ["ALBUM", metadata?.album],
    ["GENRE", metadata?.genres?.join("; ") || track.tags.join("; ")],
    ["DATE", metadata?.year ? String(metadata.year) : metadata?.date],
    ["TRACKNUMBER", metadata?.trackNo ? String(metadata.trackNo) : undefined],
  ].filter((comment): comment is [string, string] => !!comment[1]);
  const vendor = asciiBytes("MUZERO");
  return concatBytes([
    uint32le(vendor.byteLength),
    vendor,
    uint32le(comments.length),
    ...comments.map(([key, value]) => {
      const comment = asciiBytes(`${key}=${value}`);
      return concatBytes([uint32le(comment.byteLength), comment]);
    }),
  ]);
}

function flacPictureBlock(mime: string, data: Uint8Array): Uint8Array {
  const mimeBytes = asciiBytes(mime || "image/jpeg");
  return concatBytes([
    uint32be(3),
    uint32be(mimeBytes.byteLength),
    mimeBytes,
    uint32be(0),
    uint32be(1),
    uint32be(1),
    uint32be(24),
    uint32be(0),
    uint32be(data.byteLength),
    data,
  ]);
}

function flacMetadataBlock(type: number, payload: Uint8Array, isLast = false): Uint8Array {
  return concatBytes([
    new Uint8Array([(isLast ? 0x80 : 0) | type]),
    new Uint8Array([
      (payload.byteLength >>> 16) & 0xff,
      (payload.byteLength >>> 8) & 0xff,
      payload.byteLength & 0xff,
    ]),
    payload,
  ]);
}

function buildM4aWithMetadata(
  bytes: Uint8Array,
  track: Track,
  cover?: { bytes: Uint8Array; mime: string },
): Uint8Array {
  const atoms = parseMp4Atoms(bytes);
  const moovIndex = atoms.findIndex((atom) => atom.type === "moov");
  if (moovIndex < 0) throw new UnsupportedMetadataExportError("audio/mp4");
  if (atoms.some((atom, index) => index > moovIndex && atom.type === "mdat")) {
    throw new UnsupportedMetadataExportError("audio/mp4");
  }

  const moov = atoms[moovIndex];
  const moovChildren = parseMp4Atoms(moov.payload).filter((atom) => atom.type !== "udta");
  const rebuiltMoov = mp4Atom(
    "moov",
    concatBytes([...moovChildren.map((atom) => atom.raw), m4aMetadataUdta(track, cover)]),
  );
  return concatBytes(atoms.map((atom, index) => (index === moovIndex ? rebuiltMoov : atom.raw)));
}

function m4aMetadataUdta(track: Track, cover?: { bytes: Uint8Array; mime: string }): Uint8Array {
  return mp4Atom(
    "udta",
    mp4Atom(
      "meta",
      concatBytes([
        new Uint8Array([0, 0, 0, 0]),
        m4aHandlerAtom(),
        mp4Atom(
          "ilst",
          concatBytes(
            [
              m4aTextAtom(
                new Uint8Array([0xa9, 0x6e, 0x61, 0x6d]),
                track.mediaMetadata?.title || track.title,
              ),
              m4aTextAtom(
                new Uint8Array([0xa9, 0x41, 0x52, 0x54]),
                track.mediaMetadata?.artists?.join("; "),
              ),
              m4aTextAtom(new Uint8Array([0xa9, 0x61, 0x6c, 0x62]), track.mediaMetadata?.album),
              m4aTextAtom(
                new Uint8Array([0xa9, 0x67, 0x65, 0x6e]),
                track.mediaMetadata?.genres?.join("; ") || track.tags.join("; "),
              ),
              m4aTextAtom(
                new Uint8Array([0xa9, 0x64, 0x61, 0x79]),
                track.mediaMetadata?.year
                  ? String(track.mediaMetadata.year)
                  : track.mediaMetadata?.date,
              ),
              cover ? m4aCoverAtom(cover.mime, cover.bytes) : undefined,
            ].filter((atom): atom is Uint8Array => !!atom),
          ),
        ),
      ]),
    ),
  );
}

function m4aHandlerAtom(): Uint8Array {
  return mp4Atom(
    "hdlr",
    concatBytes([
      new Uint8Array([0, 0, 0, 0]),
      uint32be(0),
      asciiBytes("mdir"),
      asciiBytes("appl"),
      uint32be(0),
      uint32be(0),
      new Uint8Array([0]),
    ]),
  );
}

function m4aTextAtom(type: Uint8Array, value: string | undefined): Uint8Array | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return mp4AtomBytes(
    type,
    mp4Atom("data", concatBytes([uint32be(1), uint32be(0), asciiBytes(clean)])),
  );
}

function m4aCoverAtom(mime: string, data: Uint8Array): Uint8Array | undefined {
  if (data.byteLength === 0) return undefined;
  const dataType = mime === "image/png" ? 14 : 13;
  return mp4Atom("covr", mp4Atom("data", concatBytes([uint32be(dataType), uint32be(0), data])));
}

function parseMp4Atoms(bytes: Uint8Array): {
  payload: Uint8Array;
  raw: Uint8Array;
  type: string;
}[] {
  const atoms: { payload: Uint8Array; raw: Uint8Array; type: string }[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    if (size < 8 || offset + size > bytes.byteLength) {
      throw new UnsupportedMetadataExportError("audio/mp4");
    }
    atoms.push({
      payload: bytes.slice(offset + 8, offset + size),
      raw: bytes.slice(offset, offset + size),
      type: new TextDecoder("latin1").decode(bytes.slice(offset + 4, offset + 8)),
    });
    offset += size;
  }
  if (offset !== bytes.byteLength) throw new UnsupportedMetadataExportError("audio/mp4");
  return atoms;
}

function mp4Atom(type: string, payload: Uint8Array): Uint8Array {
  return mp4AtomBytes(asciiBytes(type), payload);
}

function mp4AtomBytes(type: Uint8Array, payload: Uint8Array): Uint8Array {
  return concatBytes([uint32be(payload.byteLength + 8), type, payload]);
}

function textFrame(id: string, value: string | undefined): Uint8Array | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return frame(id, concatBytes([new Uint8Array([1]), utf16leWithBom(clean)]));
}

function commentFrame(value: string | undefined): Uint8Array | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return frame(
    "COMM",
    concatBytes([
      new Uint8Array([1]),
      asciiBytes("eng"),
      utf16leWithBom(""),
      utf16leWithBom(clean),
    ]),
  );
}

function pictureFrame(mime: string, data: Uint8Array): Uint8Array | undefined {
  if (data.byteLength === 0) return undefined;
  return frame(
    "APIC",
    concatBytes([
      new Uint8Array([0]),
      asciiBytes(mime || "image/jpeg"),
      new Uint8Array([0, 3, 0]),
      data,
    ]),
  );
}

function frame(id: string, payload: Uint8Array): Uint8Array {
  return concatBytes([
    asciiBytes(id),
    uint32be(payload.byteLength),
    new Uint8Array([0, 0]),
    payload,
  ]);
}

function trackNumber(no: number | undefined, of: number | undefined): string | undefined {
  if (!no) return undefined;
  return of ? `${no}/${of}` : String(no);
}

function asciiBytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

function utf16leWithBom(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[3 + i * 2] = (code >>> 8) & 0xff;
  }
  return bytes;
}

function uint32be(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function uint32le(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function synchsafe(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
