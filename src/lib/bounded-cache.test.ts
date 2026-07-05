import { describe, expect, it, vi } from "vitest";
import { createBoundedMap, createBoundedSet } from "./bounded-cache";

describe("createBoundedMap", () => {
  it("evicts the least-recently-used entry past maxEntries", () => {
    const map = createBoundedMap<string, number>({ maxEntries: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.set("d", 4);
    expect(map.size).toBe(3);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
  });

  it("get refreshes recency so a hit survives the next eviction", () => {
    const map = createBoundedMap<string, number>({ maxEntries: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(map.get("a")).toBe(1); // a is now the newest
    map.set("d", 4); // evicts b, not a
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
  });

  it("peek does not refresh recency", () => {
    const map = createBoundedMap<string, number>({ maxEntries: 2 });
    map.set("a", 1);
    map.set("b", 2);
    expect(map.peek("a")).toBe(1);
    map.set("c", 3); // a is still oldest → evicted
    expect(map.has("a")).toBe(false);
  });

  it("enforces the byte budget via bytesOf", () => {
    const map = createBoundedMap<string, { bytes: number }>({
      maxEntries: 100,
      maxBytes: 10,
      bytesOf: (v) => v.bytes,
    });
    map.set("a", { bytes: 4 });
    map.set("b", { bytes: 4 });
    map.set("c", { bytes: 4 }); // 12 > 10 → evict a
    expect(map.has("a")).toBe(false);
    expect(map.bytes).toBe(8);
  });

  it("keeps a single oversized entry instead of thrash-evicting it", () => {
    const map = createBoundedMap<string, { bytes: number }>({
      maxEntries: 10,
      maxBytes: 5,
      bytesOf: (v) => v.bytes,
    });
    map.set("big", { bytes: 50 });
    expect(map.has("big")).toBe(true);
    map.set("small", { bytes: 1 }); // big is oldest and over budget → evicted now
    expect(map.has("big")).toBe(false);
    expect(map.bytes).toBe(1);
  });

  it("overwriting a key adjusts bytes and fires onEvict for the old value", () => {
    const onEvict = vi.fn();
    const map = createBoundedMap<string, { bytes: number }>({
      maxEntries: 10,
      bytesOf: (v) => v.bytes,
      onEvict,
    });
    map.set("a", { bytes: 4 });
    map.set("a", { bytes: 2 });
    expect(map.bytes).toBe(2);
    expect(map.size).toBe(1);
    expect(onEvict).toHaveBeenCalledWith("a", { bytes: 4 });
  });

  it("fires onEvict on LRU eviction, delete, and clear", () => {
    const onEvict = vi.fn();
    const map = createBoundedMap<string, number>({ maxEntries: 2, onEvict });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3); // evicts a
    expect(onEvict).toHaveBeenCalledWith("a", 1);
    map.delete("b");
    expect(onEvict).toHaveBeenCalledWith("b", 2);
    map.clear();
    expect(onEvict).toHaveBeenCalledWith("c", 3);
    expect(map.size).toBe(0);
    expect(map.bytes).toBe(0);
  });

  it("delete returns whether the key existed", () => {
    const map = createBoundedMap<string, number>({ maxEntries: 2 });
    map.set("a", 1);
    expect(map.delete("a")).toBe(true);
    expect(map.delete("a")).toBe(false);
  });
});

describe("createBoundedSet", () => {
  it("evicts the oldest marker past maxEntries", () => {
    const set = createBoundedSet<string>(2);
    set.add("a");
    set.add("b");
    set.add("c");
    expect(set.size).toBe(2);
    expect(set.has("a")).toBe(false);
    expect(set.has("c")).toBe(true);
  });

  it("re-adding refreshes recency", () => {
    const set = createBoundedSet<string>(2);
    set.add("a");
    set.add("b");
    set.add("a"); // a becomes newest
    set.add("c"); // evicts b
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("supports delete and clear", () => {
    const set = createBoundedSet<string>(4);
    set.add("a");
    expect(set.delete("a")).toBe(true);
    set.add("b");
    set.clear();
    expect(set.size).toBe(0);
  });
});
