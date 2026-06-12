import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Tiny icon micro-interactions are direct control feedback. Keep them aligned
 * with MUZERO's always-on player motion policy.
 */
export function IconMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="never">{children}</MotionConfig>;
}
