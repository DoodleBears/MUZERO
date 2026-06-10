import { describe, expect, it } from "vitest";
import {
  applySigOperations,
  extractSignatureTimestamp,
  extractSigOperations,
  findSignatureFunctionName,
  type SigOp,
  solveSignature,
} from "./youtube-sig";

// A synthetic player.js shaped like the real one: a helper object with
// reverse/splice/swap methods + a descramble function calling them in order.
const PLAYER_JS = `
var Mn={
  rT:function(a){a.reverse()},
  rN:function(a,b){a.splice(0,b)},
  rE:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c}
};
var Dz=function(a){
  a=a.split("");
  Mn.rE(a,32);
  Mn.rT(a);
  Mn.rN(a,2);
  Mn.rE(a,28);
  return a.join("")
};
(function(){"use strict";})();
var sts={signatureTimestamp:19834};
`;

/** Reference: apply the same ops by hand to cross-check applySigOperations. */
function reference(sig: string): string {
  const a = sig.split("");
  // rE(32) swap
  let i = 32 % a.length;
  [a[0], a[i]] = [a[i], a[0]];
  a.reverse(); // rT
  a.splice(0, 2); // rN(2)
  i = 28 % a.length;
  [a[0], a[i]] = [a[i], a[0]]; // rE(28)
  return a.join("");
}

describe("findSignatureFunctionName", () => {
  it("locates the descramble function name", () => {
    expect(findSignatureFunctionName(PLAYER_JS)).toBe("Dz");
    expect(findSignatureFunctionName("var x=1;")).toBeNull();
  });
});

describe("extractSigOperations", () => {
  it("extracts the ordered op sequence, resolving helper methods to op kinds", () => {
    expect(extractSigOperations(PLAYER_JS)).toEqual<SigOp[]>([
      { op: "swap", arg: 32 },
      { op: "reverse" },
      { op: "splice", arg: 2 },
      { op: "swap", arg: 28 },
    ]);
  });

  it("returns null when player.js has no recognizable descrambler", () => {
    expect(extractSigOperations("function f(){return 1}")).toBeNull();
  });
});

describe("applySigOperations / solveSignature", () => {
  const SIG = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";

  it("applies ops identically to a hand-written reference", () => {
    const ops = extractSigOperations(PLAYER_JS) as SigOp[];
    expect(applySigOperations(SIG, ops)).toBe(reference(SIG));
  });

  it("solveSignature parses + applies in one call", () => {
    expect(solveSignature(PLAYER_JS, SIG)).toBe(reference(SIG));
    expect(solveSignature("nope", SIG)).toBeNull();
  });

  it("reverse / splice / swap each behave correctly in isolation", () => {
    expect(applySigOperations("abcd", [{ op: "reverse" }])).toBe("dcba");
    expect(applySigOperations("abcd", [{ op: "splice", arg: 2 }])).toBe("cd");
    expect(applySigOperations("abcd", [{ op: "swap", arg: 2 }])).toBe("cbad");
  });
});

describe("extractSignatureTimestamp", () => {
  it("reads the sts out of player.js", () => {
    expect(extractSignatureTimestamp(PLAYER_JS)).toBe(19834);
    expect(extractSignatureTimestamp("no sts here")).toBeNull();
  });
});
