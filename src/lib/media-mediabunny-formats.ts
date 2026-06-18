import {
  ADTS,
  FLAC,
  type InputFormat,
  MATROSKA,
  MP3,
  MP4,
  MPEG_TS,
  OGG,
  QTFF,
  WAVE,
  WEBM,
} from "mediabunny";

export {
  inferMediabunnyContainerKind,
  inferMediabunnyMime,
  isMediabunnySupportedContentType,
  type MediabunnyContainerKind,
} from "@/lib/media-container-format";

export const MEDIABUNNY_INPUT_FORMATS: InputFormat[] = [
  MP4,
  QTFF,
  MATROSKA,
  WEBM,
  MP3,
  WAVE,
  FLAC,
  OGG,
  ADTS,
  MPEG_TS,
];

export const MEDIABUNNY_UNSUPPORTED_ERROR_NAME = "UnsupportedInputFormatError";
