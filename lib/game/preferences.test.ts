import { beforeEach, describe, expect, it } from "vitest";
import {
  controlsHelpDismissed,
  dismissControlsHelp,
  getReadAloudEnabled,
  setReadAloudEnabled,
} from "./preferences";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).localStorage = new MemoryStorage();
});

describe("control help preference", () => {
  it("starts visible and remembers dismissal", () => {
    expect(controlsHelpDismissed()).toBe(false);
    dismissControlsHelp();
    expect(controlsHelpDismissed()).toBe(true);
  });

  it("falls back safely when storage is blocked", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(controlsHelpDismissed()).toBe(false);
    expect(() => dismissControlsHelp()).not.toThrow();
  });
});

describe("read-aloud preference", () => {
  it("starts off and persists either choice independently", () => {
    expect(getReadAloudEnabled()).toBe(false);
    setReadAloudEnabled(true);
    expect(getReadAloudEnabled()).toBe(true);
    setReadAloudEnabled(false);
    expect(getReadAloudEnabled()).toBe(false);
  });

  it("falls back to off when storage is blocked", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(getReadAloudEnabled()).toBe(false);
    expect(() => setReadAloudEnabled(true)).not.toThrow();
  });
});
