import { describe, expect, it } from "vitest";
import { createNoise2D, cyrb128, fbm2D, fnv1a, hash2D, makeRng, mulberry32, pick, shuffle } from "./rand";

describe("seeded generators", () => {
  it("produces identical streams for identical seeds", () => {
    const a = Array.from({ length: 64 }, makeRng("dunhollow"));
    const b = Array.from({ length: 64 }, makeRng("dunhollow"));
    expect(a).toEqual(b);
  });

  it("produces different streams for different seeds", () => {
    const a = Array.from({ length: 32 }, makeRng("dunhollow"));
    const b = Array.from({ length: 32 }, makeRng("dunhollo"));
    expect(a).not.toEqual(b);
  });

  it("decorrelates salted streams from the same seed", () => {
    const terrain = Array.from({ length: 32 }, makeRng("amrath", "terrain"));
    const names = Array.from({ length: 32 }, makeRng("amrath", "names"));
    expect(terrain).not.toEqual(names);
  });

  it("stays within [0, 1)", () => {
    const rng = makeRng("range-check");
    for (let i = 0; i < 20000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("has a roughly uniform distribution", () => {
    const rng = makeRng("uniformity");
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i += 1) buckets[Math.floor(rng() * 10)] += 1;
    for (const count of buckets) {
      expect(Math.abs(count - n / 10) / (n / 10)).toBeLessThan(0.05);
    }
  });

  it("hashes strings to four distinct words", () => {
    const words = cyrb128("open-range");
    expect(new Set(words).size).toBeGreaterThan(1);
    expect(words.every((w) => Number.isInteger(w) && w >= 0)).toBe(true);
  });

  it("keeps mulberry32 deterministic from a raw integer", () => {
    expect(Array.from({ length: 5 }, mulberry32(12345))).toEqual(Array.from({ length: 5 }, mulberry32(12345)));
  });
});

describe("helpers", () => {
  it("shuffles deterministically", () => {
    const source = () => [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(makeRng("s"), source())).toEqual(shuffle(makeRng("s"), source()));
  });

  it("throws rather than returning undefined from an empty pick", () => {
    expect(() => pick(makeRng("p"), [])).toThrow(/empty/);
  });
});

describe("hash2D", () => {
  it("is stable per coordinate", () => {
    // Tile variants and prop placement depend on this: if it were not stable,
    // terrain would shimmer as the camera moved.
    expect(hash2D(41, 97, 3)).toBe(hash2D(41, 97, 3));
    expect(hash2D(41, 97, 3)).not.toBe(hash2D(41, 98, 3));
    expect(hash2D(41, 97, 3)).not.toBe(hash2D(41, 97, 4));
  });

  it("spreads evenly across a grid", () => {
    const buckets = new Array(8).fill(0);
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) buckets[Math.floor(hash2D(x, y, 1) * 8)] += 1;
    }
    const expected = (128 * 128) / 8;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.08);
    }
  });
});

describe("gradient noise", () => {
  it("is deterministic for a seed", () => {
    const a = createNoise2D(makeRng("noise"));
    const b = createNoise2D(makeRng("noise"));
    for (let i = 0; i < 50; i += 1) {
      expect(a(i * 0.37, i * 0.71)).toBe(b(i * 0.37, i * 0.71));
    }
  });

  it("keeps fbm output inside [0, 1]", () => {
    const noise = createNoise2D(makeRng("fbm"));
    let min = 1;
    let max = 0;
    for (let y = 0; y < 200; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        const v = fbm2D(noise, x * 0.03, y * 0.03, { octaves: 5 });
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    // A field that never leaves the middle would produce a single-biome world.
    expect(max - min).toBeGreaterThan(0.3);
  });

  it("varies smoothly rather than jumping between neighbours", () => {
    const noise = createNoise2D(makeRng("smooth"));
    let worst = 0;
    for (let i = 0; i < 500; i += 1) {
      const x = i * 0.013;
      worst = Math.max(worst, Math.abs(noise(x, 0.5) - noise(x + 0.01, 0.5)));
    }
    expect(worst).toBeLessThan(0.1);
  });
});

describe("fnv1a", () => {
  it("gives a stable 8-character identity", () => {
    const hash = fnv1a(["seed", 42, new Uint8Array([1, 2, 3])]);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a(["seed", 42, new Uint8Array([1, 2, 3])])).toBe(hash);
  });

  it("changes when any input changes", () => {
    const base = fnv1a(["seed", 42, new Uint8Array([1, 2, 3])]);
    expect(fnv1a(["seed", 43, new Uint8Array([1, 2, 3])])).not.toBe(base);
    expect(fnv1a(["seed", 42, new Uint8Array([1, 2, 4])])).not.toBe(base);
  });
});
