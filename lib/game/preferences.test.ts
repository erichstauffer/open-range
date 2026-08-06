import { beforeEach, describe, expect, it } from "vitest";
import {
  controlsHelpDismissed,
  dismissControlsHelp,
  getFogDarkness,
  getMusicEnabled,
  getMusicVolume,
  getReadAloudEnabled,
  setFogDarkness,
  setMusicEnabled,
  setMusicVolume,
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

describe("music preference", () => {
  it("starts enabled at the default volume", () => {
    expect(getMusicEnabled()).toBe(true);
    expect(getMusicVolume()).toBe(0.7);
  });

  it("persists the enabled state and volume, including intentional silence", () => {
    setMusicEnabled(false);
    setMusicVolume(0);
    expect(getMusicEnabled()).toBe(false);
    expect(getMusicVolume()).toBe(0);

    setMusicEnabled(true);
    setMusicVolume(0.35);
    expect(getMusicEnabled()).toBe(true);
    expect(getMusicVolume()).toBe(0.35);
  });

  it("rejects invalid stored volumes and clamps values to the slider range", () => {
    localStorage.setItem("open-range:music-volume", "");
    expect(getMusicVolume()).toBe(0.7);
    localStorage.setItem("open-range:music-volume", "not-a-number");
    expect(getMusicVolume()).toBe(0.7);

    localStorage.setItem("open-range:music-volume", "-1");
    expect(getMusicVolume()).toBe(0);
    localStorage.setItem("open-range:music-volume", "2");
    expect(getMusicVolume()).toBe(1);
  });

  it("falls back safely when storage is blocked", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(getMusicEnabled()).toBe(true);
    expect(getMusicVolume()).toBe(0.7);
    expect(() => setMusicEnabled(false)).not.toThrow();
    expect(() => setMusicVolume(0.4)).not.toThrow();
  });
});

describe("fog darkness preference", () => {
  it("starts fully opaque, so an unwalked island is hidden", () => {
    expect(getFogDarkness()).toBe(1);
  });

  it("persists a lighter veil, including a fully transparent one", () => {
    setFogDarkness(0.45);
    expect(getFogDarkness()).toBe(0.45);

    setFogDarkness(0);
    expect(getFogDarkness()).toBe(0);
  });

  it("rejects invalid stored values and clamps to the slider range", () => {
    localStorage.setItem("open-range:fog-darkness", "");
    expect(getFogDarkness()).toBe(1);
    localStorage.setItem("open-range:fog-darkness", "not-a-number");
    expect(getFogDarkness()).toBe(1);

    localStorage.setItem("open-range:fog-darkness", "-1");
    expect(getFogDarkness()).toBe(0);
    localStorage.setItem("open-range:fog-darkness", "2");
    expect(getFogDarkness()).toBe(1);
  });

  it("falls back safely when storage is blocked", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(getFogDarkness()).toBe(1);
    expect(() => setFogDarkness(0.5)).not.toThrow();
  });
});
