import { describe, expect, it } from "vitest";
import { extractFunctionSource, extractNFunctionSource, findNFunctionName } from "./youtube-nsig";

// player.js where the n-function is referenced directly.
const DIRECT = `
something.get("n"))&&(b=nTransform(a);
var nTransform=function(a){
  var b=a.split("");
  b={x:function(){return {y:1}}};  // nested braces to exercise the balancer
  return a.toUpperCase()
};
`;

// player.js where the n-function is referenced via an array index.
const INDEXED = `
xyz.get("n"))&&(b=Wm[3](a);
var Wm=[foo,bar,baz,realN,qux];
realN=function(a){return a+"!"};
`;

describe("findNFunctionName", () => {
  it("reads a direct n-function reference", () => {
    expect(findNFunctionName(DIRECT)).toBe("nTransform");
  });

  it("resolves an array-indexed reference to the member name", () => {
    expect(findNFunctionName(INDEXED)).toBe("realN");
  });

  it("returns null when there's no n reference", () => {
    expect(findNFunctionName("var x=1")).toBeNull();
  });
});

describe("extractFunctionSource", () => {
  it("slices a brace-balanced function body (handles nested braces)", () => {
    const src = extractFunctionSource(DIRECT, "nTransform");
    expect(src).not.toBeNull();
    expect(src?.startsWith("function(a){")).toBe(true);
    expect(src?.trimEnd().endsWith("}")).toBe(true);
    // The whole body came through — the nested object + return are present.
    expect(src).toContain("toUpperCase");
    // It's runnable as an anonymous expression.
    // biome-ignore lint/security/noGlobalEval: test-only, evaluating our extracted fixture
    const fn = eval(`(${src})`) as (a: string) => string;
    expect(fn("hello")).toBe("HELLO");
  });

  it("returns null for an unknown name", () => {
    expect(extractFunctionSource(DIRECT, "missing")).toBeNull();
  });
});

describe("extractNFunctionSource", () => {
  it("extracts a runnable n-transform (array-indexed reference)", () => {
    const src = extractNFunctionSource(INDEXED);
    expect(src).not.toBeNull();
    // biome-ignore lint/security/noGlobalEval: test-only
    const fn = eval(`(${src})`) as (a: string) => string;
    expect(fn("abc")).toBe("abc!");
  });

  it("returns null when player.js has no n function", () => {
    expect(extractNFunctionSource("var x=1")).toBeNull();
  });
});
