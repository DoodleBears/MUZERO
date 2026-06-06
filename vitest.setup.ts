import "@testing-library/jest-dom/vitest";
// Polyfill IndexedDB in jsdom so Dexie repositories can be exercised in unit
// tests without a real browser. Each test file that touches the DB should call
// `indexedDB.deleteDatabase(...)` (or use a fresh DB name) for isolation.
import "fake-indexeddb/auto";
