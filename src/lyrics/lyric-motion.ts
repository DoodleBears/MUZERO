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
    stiffness: 170,
    damping: 28,
    mass: 0.9,
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
    stiffness: 150,
    damping: 26,
    mass: 1,
  },
  row: {
    transition: "spring",
    neighborDelayMs: 26,
    residualYPx: 10,
    maxAffectedDistance: 3,
  },
};

function sanitizeLyricsMotionMode(mode: LyricsMotionMode | undefined): LyricsMotionMode {
  return LYRICS_MOTION_MODES.includes(mode as LyricsMotionMode)
    ? (mode as LyricsMotionMode)
    : "classic";
}

export function resolveLyricsMotionMode(
  mode: LyricsMotionMode | undefined,
  env: { reducedMotion: boolean },
): ResolvedLyricsMotion {
  if (env.reducedMotion) return CLASSIC_MOTION;
  switch (sanitizeLyricsMotionMode(mode)) {
    case "cascade":
      return CASCADE_MOTION;
    case "inertial":
      return INERTIAL_MOTION;
    case "classic":
      return CLASSIC_MOTION;
  }
}
