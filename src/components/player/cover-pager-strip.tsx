import { memo } from "react";
import { type PagerSlot, slotRestOffsetPx } from "./cover-pager";

export interface PagerSlotContent {
  trackId: string;
  coverUrl: string | null;
}

/**
 * Presentational persistent cover strip (gc-closure PRD Phase 2-C).
 *
 * Renders one DOM slot per `PagerSlot.slotKey`. Because the slotKeys are stable
 * across center moves (see `assignPagerSlots`), React keeps each slot's DOM node
 * mounted on a track switch — only the inner `<img src>` rotates. That is the
 * whole point: no per-switch mount/unmount of cards (the ~35MB/switch overlay
 * churn that triggered the GC pause). The strip itself translates by a single
 * `translateX`; each slot sits at its static rest offset, so a drag is one
 * compositor transform write, never a React re-render per frame.
 *
 * Dumb by design: it takes already-resolved slot content via `contentForIndex`
 * and the drag translate as props, so it holds no data/animation state.
 */
export const CoverPagerStrip = memo(function CoverPagerStrip({
  slots,
  width,
  translateX,
  contentForIndex,
}: {
  slots: PagerSlot[];
  width: number;
  translateX: number;
  contentForIndex: (queueIndex: number) => PagerSlotContent | null;
}) {
  return (
    <div
      data-testid="cover-pager-strip"
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ transform: `translate3d(${translateX}px, 0, 0)`, willChange: "transform" }}
    >
      {slots.map((slot) => {
        const content = slot.queueIndex == null ? null : contentForIndex(slot.queueIndex);
        return (
          <div
            key={slot.slotKey}
            data-slot-key={slot.slotKey}
            className="absolute inset-0"
            style={{
              transform: `translate3d(${slotRestOffsetPx(slot.offsetSteps, width)}px, 0, 0)`,
            }}
          >
            {content?.coverUrl ? (
              <img
                src={content.coverUrl}
                alt=""
                aria-hidden
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                className="absolute inset-0 size-full object-cover album-cover-radius"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
