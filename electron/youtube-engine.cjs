"use strict";

/**
 * YouTube `n`-throttling solver (main process). The renderer's tested TS extracts the
 * `n` function SOURCE from player.js (`youtube-nsig`); this evaluates it on a value in
 * a Node `vm` sandbox — a fresh context with only built-ins (the function is pure
 * string/array math, no DOM), a hard timeout, and no access to app/Node globals. The
 * renderer never evals YouTube code in its own realm. See PRD §20 (Y5).
 */

const vm = require("node:vm");
const { ipcMain } = require("electron");

const EVAL_TIMEOUT_MS = 1500;

/** Run `(<functionSource>)(<n>)` in an isolated context; returns the transformed n. */
function evalYoutubeN(functionSource, n) {
  if (typeof functionSource !== "string" || typeof n !== "string") return n;
  try {
    const code = `(${functionSource})(${JSON.stringify(n)})`;
    const out = vm.runInNewContext(code, Object.create(null), {
      timeout: EVAL_TIMEOUT_MS,
      displayErrors: false,
    });
    return typeof out === "string" ? out : n;
  } catch {
    // A throttle-solve failure shouldn't break playback — fall back to the raw n
    // (CDN serves throttled rather than 403). The renderer logs the degraded state.
    return n;
  }
}

function registerYoutubeEngine() {
  ipcMain.handle("muzero:evalYoutubeN", (_event, functionSource, n) =>
    evalYoutubeN(functionSource, n),
  );
}

module.exports = { registerYoutubeEngine, evalYoutubeN };
