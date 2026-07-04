import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Memory } from "@/db/types";
import { MemoryStripCard } from "./lyrics-memory-strip";

const mem = (over: Partial<Memory> = {}): Memory => ({
  id: "m1",
  trackId: "t1",
  note: "副歌绝了",
  createdAt: 1,
  ...over,
});

describe("MemoryStripCard", () => {
  it("renders the memory note", () => {
    const { getByText } = render(<MemoryStripCard memory={mem()} />);
    expect(getByText("副歌绝了")).toBeTruthy();
  });

  it("shows a tappable seek chip for an anchored memory and calls onSeek with the second", () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(<MemoryStripCard memory={mem({ atSec: 60 })} onSeek={onSeek} />);
    getByTestId("lyrics-memory-seek").click();
    expect(onSeek).toHaveBeenCalledWith(60);
  });

  it("shows no seek chip for a floating memory", () => {
    const { queryByTestId } = render(<MemoryStripCard memory={mem()} onSeek={() => {}} />);
    expect(queryByTestId("lyrics-memory-seek")).toBeNull();
  });

  it("attributes the memory to its author when present", () => {
    const { getByText } = render(
      <MemoryStripCard
        memory={mem({ author: { devicePublicId: "audience:x", displayName: "阿强" } })}
      />,
    );
    expect(getByText("—— 阿强")).toBeTruthy();
  });
});
