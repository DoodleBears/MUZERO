const crypto = require("node:crypto");

const localMediaTokens = new Map();
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

function registerLocalMedia(filePath, mime) {
  pruneLocalMediaTokens();
  const token = `lm_${crypto.randomUUID()}`;
  localMediaTokens.set(token, {
    filePath,
    mime,
    createdAt: Date.now(),
  });
  return token;
}

function resolveLocalMediaToken(token) {
  pruneLocalMediaTokens();
  return localMediaTokens.get(token);
}

function pruneLocalMediaTokens() {
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [token, entry] of localMediaTokens) {
    if (entry.createdAt < cutoff) localMediaTokens.delete(token);
  }
}

module.exports = { registerLocalMedia, resolveLocalMediaToken };
