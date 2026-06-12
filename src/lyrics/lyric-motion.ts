export const LYRICS_MOTION_MODES = ["classic", "inertial", "cascade"] as const;

export type LyricsMotionMode = (typeof LYRICS_MOTION_MODES)[number];

export interface ResolvedLyricsMotion {
  mode: LyricsMotionMode;
  follow: {
    kind: "lerp" | "spring";
    anchorRatio: number;
    lerp?: number;
    stiffness?: number;
    damping?: number;
    mass?: number;
  };
  row: {
    transition: "tween" | "spring";
    neighborDelayMs: number;
    residualYPx: number;
    maxAffectedDistance: number;
  };
}

export interface LyricFollowTargetInput {
  scrollTop: number;
  viewportTop: number;
  viewportHeight: number;
  lineTop: number;
  lineHeight: number;
  anchorRatio: number;
}

const CLASSIC_MOTION: ResolvedLyricsMotion = {
  mode: "classic",
  follow: {
    kind: "lerp",
    anchorRatio: 0.38,
    lerp: 0.16,
  },
  row: {
    transition: "tween",
    neighborDelayMs: 0,
    residualYPx: 0,
    maxAffectedDistance: 0,
  },
};

const INERTIAL_MOTION: ResolvedLyricsMotion = {
  mode: "inertial",
  follow: {
    kind: "spring",
    anchorRatio: 0.38,
    stiffness: 120,
    damping: 20,
    mass: 1.15,
  },
  row: {
    transition: "spring",
    neighborDelayMs: 0,
    residualYPx: 0,
    maxAffectedDistance: 0,
  },
};

const CASCADE_MOTION: ResolvedLyricsMotion = {
  mode: "cascade",
  follow: {
    kind: "spring",
    anchorRatio: 0.38,
    stiffness: 105,
    damping: 18,
    mass: 1.3,
  },
  row: {
    transition: "tween",
    neighborDelayMs: 0,
    residualYPx: 0,
    maxAffectedDistance: 0,
  },
};

function sanitizeLyricsMotionMode(mode: LyricsMotionMode | undefined): LyricsMotionMode {
  return LYRICS_MOTION_MODES.includes(mode as LyricsMotionMode)
    ? (mode as LyricsMotionMode)
    : "classic";
}

export function resolveLyricsMotionMode(
  mode: LyricsMotionMode | undefined,
  env?: { reducedMotion: boolean },
): ResolvedLyricsMotion {
  void env;
  switch (sanitizeLyricsMotionMode(mode)) {
    case "cascade":
      return CASCADE_MOTION;
    case "inertial":
      return INERTIAL_MOTION;
    case "classic":
      return CLASSIC_MOTION;
  }
}

export function lyricFollowTargetScrollTop(input: LyricFollowTargetInput): number {
  const lineCenterFromTop = input.lineTop + input.lineHeight / 2 - input.viewportTop;
  return Math.max(
    0,
    input.scrollTop + lineCenterFromTop - input.viewportHeight * input.anchorRatio,
  );
}
