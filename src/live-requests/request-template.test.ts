import { describe, expect, it } from "vitest";
import { applyTemplateString } from "./request-template";

const ctx = (payload: Record<string, unknown>) => ({ payload });

describe("request-template applyTemplateString", () => {
  it("returns a plain string unchanged when there are no template blocks", () => {
    expect(applyTemplateString("hello", ctx({}))).toBe("hello");
  });

  it("resolves a single payload path and preserves the raw value type", () => {
    expect(applyTemplateString("{{ payload.message }}", ctx({ message: "晴天" }))).toBe("晴天");
    expect(applyTemplateString("{{ payload }}", ctx({ a: 1 }))).toEqual({ a: 1 });
    expect(applyTemplateString("{{ payload.n }}", ctx({ n: 42 }))).toBe(42);
  });

  it("resolves nested paths", () => {
    expect(applyTemplateString("{{ payload.user.name }}", ctx({ user: { name: "Alice" } }))).toBe(
      "Alice",
    );
  });

  it("falls back across || candidates (first non-empty wins)", () => {
    expect(applyTemplateString("{{ payload.a || payload.b || 'x' }}", ctx({ b: "B" }))).toBe("B");
    expect(applyTemplateString("{{ payload.a || 'fallback' }}", ctx({}))).toBe("fallback");
  });

  it("evaluates ternary conditions", () => {
    expect(applyTemplateString("{{ payload.amt ? 'donation' : 'chat' }}", ctx({ amt: 5 }))).toBe(
      "donation",
    );
    expect(applyTemplateString("{{ payload.amt ? 'donation' : 'chat' }}", ctx({}))).toBe("chat");
  });

  it("supports map + join pipes over arrays", () => {
    const payload = {
      messages: [
        { user: "a", message: "hi" },
        { user: "b", message: "yo" },
      ],
    };
    // biome-ignore lint/suspicious/noTemplateCurlyInString: mapping-DSL placeholder, not a JS template literal
    const template = "{{ payload.messages | map '${item.user}: ${item.message}' | join '\\n' }}";
    expect(applyTemplateString(template, ctx(payload))).toBe("a: hi\nb: yo");
  });

  it("formats seconds with the time pipe", () => {
    expect(applyTemplateString("{{ payload.t | time }}", ctx({ t: 75 }))).toBe("01:15");
    expect(applyTemplateString("{{ payload.t | time }}", ctx({ t: 3725 }))).toBe("01:02:05");
  });

  it("interpolates multiple blocks and literal text (multi-field concat)", () => {
    expect(
      applyTemplateString("{{ payload.artist }} - {{ payload.title }}", {
        payload: { artist: "周杰伦", title: "晴天" },
      }),
    ).toBe("周杰伦 - 晴天");
    expect(
      applyTemplateString("[{{ payload.title }}] {{ payload.text }}", {
        payload: { title: "T", text: "hello" },
      }),
    ).toBe("[T] hello");
  });

  it("renders missing fields as empty string in interpolation", () => {
    expect(applyTemplateString("a={{ payload.missing }}", ctx({}))).toBe("a=");
  });

  it("blocks prototype-polluting path segments", () => {
    expect(applyTemplateString("{{ payload.__proto__ }}", ctx({}))).toBeUndefined();
    expect(applyTemplateString("{{ payload.constructor }}", ctx({}))).toBeUndefined();
    expect(applyTemplateString("x={{ payload.__proto__.polluted }}", ctx({}))).toBe("x=");
  });
});
