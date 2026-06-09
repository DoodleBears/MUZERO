import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./stepper";

const steps = [
  { id: "connect", label: "Connect" },
  { id: "name", label: "Name" },
];

describe("Stepper", () => {
  it("renders every step label", () => {
    render(<Stepper steps={steps} current={0} />);
    expect(screen.getByText("Connect")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
  });

  it("marks the current step with aria-current", () => {
    render(<Stepper steps={steps} current={1} />);
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Name");
  });
});
