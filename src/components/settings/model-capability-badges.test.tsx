import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModelCapabilityBadges } from "./model-capability-badges";

const labels = {
  vision: "Vision",
  audio: "Audio input",
  tools: "Function calling",
  context: "Context",
  price: (i: string, o: string) => `Input ${i} · output ${o}`,
};

describe("ModelCapabilityBadges", () => {
  it("renders only the supported capabilities + context + price with titles", () => {
    const { container, queryByTitle } = render(
      <ModelCapabilityBadges
        labels={labels}
        model={{
          id: "x",
          label: "x",
          supportsVision: true,
          supportsTools: true,
          contextLimit: 128000,
          inputCostPerMillionUsd: 3,
          outputCostPerMillionUsd: 15,
        }}
      />,
    );
    expect(queryByTitle("Vision")).toBeTruthy();
    expect(queryByTitle("Function calling")).toBeTruthy();
    expect(queryByTitle("Audio input")).toBeNull(); // not supported
    expect(container.textContent).toContain("128K");
    expect(container.textContent).toContain("$3");
    expect(container.textContent).toContain("$15");
    expect(queryByTitle("Input $3 · output $15")).toBeTruthy();
  });

  it("renders nothing when the model has no capability metadata", () => {
    const { container } = render(
      <ModelCapabilityBadges labels={labels} model={{ id: "y", label: "y" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
