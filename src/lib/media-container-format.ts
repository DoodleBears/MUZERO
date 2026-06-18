export type MediabunnyContainerKind =
  | "adts"
  | "flac"
  | "matroska"
  | "mp3"
  | "mp4"
  | "mpeg-ts"
  | "ogg"
  | "quicktime"
  | "wave"
  | "webm";

type ContainerRule = {
  kind: MediabunnyContainerKind;
  extensions: readonly string[];
  mimes: readonly string[];
  preferredMime: string;
};

const CONTAINER_RULES: readonly ContainerRule[] = [
  {
    extensions: ["mp4", "m4a", "m4v"],
    kind: "mp4",
    mimes: ["video/mp4", "audio/mp4", "application/mp4"],
    preferredMime: "video/mp4",
  },
  {
    extensions: ["mov", "qt"],
    kind: "quicktime",
    mimes: ["video/quicktime", "video/x-quicktime"],
    preferredMime: "video/quicktime",
  },
  {
    extensions: ["mkv", "mka", "mks"],
    kind: "matroska",
    mimes: ["video/x-matroska", "audio/x-matroska", "application/x-matroska"],
    preferredMime: "video/x-matroska",
  },
  {
    extensions: ["webm"],
    kind: "webm",
    mimes: ["video/webm", "audio/webm"],
    preferredMime: "video/webm",
  },
  {
    extensions: ["mp3"],
    kind: "mp3",
    mimes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
    preferredMime: "audio/mpeg",
  },
  {
    extensions: ["wav", "wave"],
    kind: "wave",
    mimes: ["audio/wav", "audio/wave", "audio/x-wav"],
    preferredMime: "audio/wav",
  },
  {
    extensions: ["flac"],
    kind: "flac",
    mimes: ["audio/flac", "audio/x-flac"],
    preferredMime: "audio/flac",
  },
  {
    extensions: ["ogg", "oga", "opus", "ogv"],
    kind: "ogg",
    mimes: ["audio/ogg", "video/ogg", "application/ogg", "audio/opus"],
    preferredMime: "audio/ogg",
  },
  {
    extensions: ["aac", "adts"],
    kind: "adts",
    mimes: ["audio/aac", "audio/aacp", "audio/x-aac"],
    preferredMime: "audio/aac",
  },
  {
    extensions: ["ts", "m2ts", "mts"],
    kind: "mpeg-ts",
    mimes: ["video/mp2t", "video/mpeg"],
    preferredMime: "video/mp2t",
  },
];

const MIMELESS_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function isMediabunnySupportedContentType(contentType: string | undefined, filename = "") {
  return inferMediabunnyContainerKind(contentType, filename) !== null;
}

export function inferMediabunnyContainerKind(
  contentType: string | undefined,
  filename = "",
): MediabunnyContainerKind | null {
  const mime = normalizeMime(contentType);
  if (!MIMELESS_TYPES.has(mime)) {
    const byMime = CONTAINER_RULES.find((rule) =>
      rule.mimes.some((candidate) => mime.includes(candidate)),
    );
    if (byMime) return byMime.kind;
  }

  const extension = extensionFromName(filename);
  if (!extension) return null;
  return CONTAINER_RULES.find((rule) => rule.extensions.includes(extension))?.kind ?? null;
}

export function inferMediabunnyMime(filename = ""): string | undefined {
  const extension = extensionFromName(filename);
  if (!extension) return undefined;
  return CONTAINER_RULES.find((rule) => rule.extensions.includes(extension))?.preferredMime;
}

function normalizeMime(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function extensionFromName(filename: string): string | undefined {
  return /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase();
}
