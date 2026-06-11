import { describe, expect, it, vi } from "vitest";
import { releaseGlState } from "./reactive-scene";

function fakeGl(lost = false) {
  return {
    isContextLost: () => lost,
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
  };
}

const program = { program: true } as unknown as WebGLProgram;
const posBuffer = { pos: true } as unknown as WebGLBuffer;
const indexBuffer = { idx: true } as unknown as WebGLBuffer;

describe("releaseGlState (PRD F-5)", () => {
  it("deletes the program, every attrib buffer, and the index buffer", () => {
    const gl = fakeGl();
    releaseGlState({
      gl,
      programInfo: { program },
      bufferInfo: {
        attribs: { position: { buffer: posBuffer, numComponents: 2 } },
        indices: indexBuffer,
      },
    });
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteBuffer).toHaveBeenCalledWith(posBuffer);
    expect(gl.deleteBuffer).toHaveBeenCalledWith(indexBuffer);
  });

  it("skips deletion entirely on a lost context (resources already gone)", () => {
    const gl = fakeGl(true);
    releaseGlState({
      gl,
      programInfo: { program },
      bufferInfo: { attribs: { position: { buffer: posBuffer, numComponents: 2 } } },
    });
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
  });

  it("tolerates null state and missing attribs/indices", () => {
    expect(() => releaseGlState(null)).not.toThrow();
    const gl = fakeGl();
    expect(() => releaseGlState({ gl, programInfo: { program }, bufferInfo: {} })).not.toThrow();
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
  });
});
