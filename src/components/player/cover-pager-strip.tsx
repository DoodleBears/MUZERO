import { memo, type ReactNode, useLayoutEffect, useRef } from "react";
import { CanvasCover } from "./canvas-cover";
import { coverflowTransform, slotScreenXSteps } from "./cover-pager";
import { coverWindowOffset } from "./cover-window-store";

export interface StripSlotContent {
  trackId: string;
  coverUrl: string | null;
}

/** One persistent strip slot. `slotKey` is stable across recenters (recycling list,
 *  see {@link assignPagerSlots}) so React reuses the node; only `content` rotates. */
export interface StripSlot {
  slotKey: number;
  offsetSteps: number;
  content: StripSlotContent | null;
}

const SLOT_BASE =
  "pointer-events-none absolute inset-0 overflow-visible [backface-visibility:hidden] album-cover-radius";

/**
 * Persistent windowed coverflow strip (the foreground of the continuous-drag cover
 * pager). Renders one slot per `slotKey`; the slot nodes never unmount on a track
 * switch — only `content` (the cover for the rotated `queueIndex`) changes — which
 * is what kills the per-switch mount/GC churn the old portal coverflow paid.
 *
 * Each slot's on-screen position + 3D coverflow transform is derived imperatively
 * from the shared `coverWindowOffset` MotionValue (off the React render path), so a
 * continuous drag is pure compositor work. One step = one cover width; a slot at
 * `offsetSteps` sits at `(offsetSteps + offset) * width` and pivots around its own
 * centre (rotateY/scale/opacity from {@link coverflowTransform}). The centred slot
 * (offset≈0) is flat / full-scale / opaque — no settle/handoff state machine.
 */
export const CoverPagerStrip = memo(function CoverPagerStrip({
  slots,
  width,
  tilt,
  sideScale,
  renderFallback,
  renderIdentity,
}: {
  slots: StripSlot[];
  width: number;
  tilt: number;
  sideScale: number;
  /** Rendered inside a slot when its track has no resolvable cover (title fallback). */
  renderFallback?: (trackId: string) => ReactNode;
  /** Title + author block rendered BELOW each cover, so it travels with the slide. */
  renderIdentity?: (trackId: string) => ReactNode;
}) {
  return (
    <div
      data-testid="cover-pager-strip"
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-visible [perspective:1200px] [transform-style:preserve-3d]"
    >
      {slots.map((slot) => (
        <CoverflowSlot
          key={slot.slotKey}
          content={slot.content}
          offsetSteps={slot.offsetSteps}
          renderFallback={renderFallback}
          renderIdentity={renderIdentity}
          sideScale={sideScale}
          tilt={tilt}
          width={width}
        />
      ))}
    </div>
  );
});

function CoverflowSlot({
  content,
  offsetSteps,
  renderFallback,
  renderIdentity,
  sideScale,
  tilt,
  width,
}: {
  content: StripSlotContent | null;
  offsetSteps: number;
  renderFallback?: (trackId: string) => ReactNode;
  renderIdentity?: (trackId: string) => ReactNode;
  sideScale: number;
  tilt: number;
  width: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Drive the slot's position + 3D transform IMPERATIVELY off `coverWindowOffset`'s
  // synchronous "change" event (NOT a motion style binding, which writes on the next
  // rAF). That matters at a recenter: the stage resets the offset in a layout effect
  // the same tick it rotates this slot's content — a one-frame-late transform would
  // paint the new content at the OLD position = a per-crossing flicker. A synchronous
  // write keeps content + transform in the same painted frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (offset: number) => {
      const screenX = slotScreenXSteps(offsetSteps, offset);
      const { rotateY, scale, opacity } = coverflowTransform(screenX, { tilt, sideScale });
      el.style.transform = `translate3d(${screenX * width}px, 0, 0) rotateY(${rotateY}deg) scale(${scale})`;
      el.style.opacity = String(opacity);
    };
    apply(coverWindowOffset.get());
    return coverWindowOffset.on("change", apply);
  }, [offsetSteps, tilt, sideScale, width]);

  return (
    <div
      ref={ref}
      data-slot-offset={offsetSteps}
      className={SLOT_BASE}
      style={{
        // Centre cover on top; neighbours stack behind it by distance so a
        // mid-slide overlap never shows a far slot through the near one.
        zIndex: 100 - Math.abs(offsetSteps),
        transformOrigin: "center center",
        transformStyle: "preserve-3d",
      }}
    >
      {content ? (
        <>
          <div className="absolute inset-0 z-10 overflow-hidden bg-muted album-cover-radius">
            {content.coverUrl ? (
              <CanvasCover
                coverUrl={content.coverUrl}
                crossfadeSec={0}
                label={`pager:${offsetSteps}`}
              />
            ) : (
              renderFallback?.(content.trackId)
            )}
          </div>
          {/* Title + author travel with the cover (below it), so the slide carries
              the whole identity, not just the artwork. */}
          {renderIdentity ? (
            <div className="pointer-events-none absolute inset-x-0 top-full z-20 mt-2">
              {renderIdentity(content.trackId)}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
