import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  createChatSession,
  loadChatLocalIdRegistry,
  saveChatLocalIdRegistry,
} from "./dj-chat-sessions";

let db: MuzeroDB;

afterEach(async () => {
  if (db) {
    await db.delete();
    db.close();
  }
});

describe("chat local id registry persistence", () => {
  it("round-trips the registry snapshot through ChatSession.localIdRegistryJson", async () => {
    db = new MuzeroDB("chat-local-id-session-test");
    const session = await createChatSession({ title: "Local ids" }, db);
    const registry = await loadChatLocalIdRegistry(session.id, db);

    expect(registry.toLocal("trk_a", "T")).toBe("#T1");
    expect(registry.toLocal("ses_a", "S")).toBe("#S1");
    await saveChatLocalIdRegistry(session.id, registry.snapshot(), db);

    const reloaded = await loadChatLocalIdRegistry(session.id, db);
    expect(reloaded.toLocal("trk_a", "T")).toBe("#T1");
    expect(reloaded.toLocal("trk_b", "T")).toBe("#T2");
    expect((await db.chatSessions.get(session.id))?.localIdRegistryJson).toContain("#T1");
  });

  it("tolerates corrupt stored JSON by returning an empty registry", async () => {
    db = new MuzeroDB("chat-local-id-corrupt-test");
    const session = await createChatSession({ title: "Bad ids" }, db);
    await db.chatSessions.update(session.id, { localIdRegistryJson: "not-json" });

    const registry = await loadChatLocalIdRegistry(session.id, db);

    expect(registry.toLocal("trk_a", "T")).toBe("#T1");
  });
});
