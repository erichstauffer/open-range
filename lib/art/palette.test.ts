import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  CLOAK_COLORS,
  LIGHTNESS_CURVE,
  PALETTE_CONSTRAINTS,
  RAMPS,
  SPRITE_PALETTE,
  TILE_SPECS,
  UI,
  hexToHsl,
  hslToHex,
  resolveStop,
} from "./palette";

/**
 * These are the tests that put the original blocker under CI. The project was
 * abandoned because terrain art would not hold a consistent look across
 * biomes; here that consistency is a build-breaking assertion.
 */

// 8-bit rounding in hslToHex costs a little precision on the way back out.
const HUE_TOLERANCE = 2.5;
const SAT_TOLERANCE = 0.02;

/** Below this saturation, hue carries no visual meaning and is unstable. */
const HUE_MEANINGFUL_ABOVE = 0.05;

function everyColour(): Array<{ label: string; hex: string }> {
  const out: Array<{ label: string; hex: string }> = [];

  for (const [kind, ramp] of Object.entries(RAMPS)) {
    ramp.forEach((hex, i) => out.push({ label: `RAMPS.${kind}[${i}]`, hex }));
  }
  for (const [kind, accent] of Object.entries(ACCENTS)) {
    accent.forEach((hex, i) => out.push({ label: `ACCENTS.${kind}[${i}]`, hex }));
  }
  for (const [name, hex] of Object.entries(UI)) {
    out.push({ label: `UI.${name}`, hex });
  }
  for (const [name, hex] of Object.entries(SPRITE_PALETTE)) {
    out.push({ label: `SPRITE_PALETTE.${name}`, hex });
  }
  CLOAK_COLORS.forEach((hex, i) => out.push({ label: `CLOAK_COLORS[${i}]`, hex }));

  return out;
}

describe("palette constraint box", () => {
  it("covers every colour the game is able to draw", () => {
    // Guards against a future palette export escaping the sweep below.
    const expected =
      TILE_SPECS.length * 5 +
      TILE_SPECS.length * 2 +
      Object.keys(UI).length +
      Object.keys(SPRITE_PALETTE).length +
      CLOAK_COLORS.length;
    expect(everyColour()).toHaveLength(expected);
  });

  it.each(everyColour())("$label sits inside the box", ({ hex }) => {
    const { h, s, l } = hexToHsl(hex);

    expect(s).toBeLessThanOrEqual(PALETTE_CONSTRAINTS.satMax + SAT_TOLERANCE);
    expect(l).toBeGreaterThanOrEqual(PALETTE_CONSTRAINTS.lightMin - 0.01);
    expect(l).toBeLessThanOrEqual(PALETTE_CONSTRAINTS.lightMax + 0.01);

    if (s > HUE_MEANINGFUL_ABOVE) {
      expect(h).toBeGreaterThanOrEqual(PALETTE_CONSTRAINTS.hueMin - HUE_TOLERANCE);
      expect(h).toBeLessThanOrEqual(PALETTE_CONSTRAINTS.hueMax + HUE_TOLERANCE);
    }
  });

  it("admits no fully saturated colour anywhere", () => {
    // The single most important line for tone: this is what keeps the world
    // Lord-of-the-Rings muted instead of Zelda bright.
    for (const { label, hex } of everyColour()) {
      const { s } = hexToHsl(hex);
      expect(s, label).toBeLessThan(0.45);
    }
  });
});

describe("shared lightness curve", () => {
  it("gives every biome a monotonically lightening ramp", () => {
    for (const spec of TILE_SPECS) {
      const lightness = RAMPS[spec.kind].map((hex) => hexToHsl(hex).l);
      for (let i = 1; i < lightness.length; i += 1) {
        expect(lightness[i], `${spec.kind} stop ${i}`).toBeGreaterThan(lightness[i - 1]);
      }
    }
  });

  it("gives every biome the same contrast shape", () => {
    // Biomes contribute a hue, a saturation and a lightness OFFSET - never
    // their own curve. Two biomes therefore have identical internal contrast,
    // which is why a snowfield and a meadow read as the same illustration.
    const shapeOf = (kind: (typeof TILE_SPECS)[number]["kind"]) => {
      const l = RAMPS[kind].map((hex) => hexToHsl(hex).l);
      return l.slice(1).map((v, i) => v - l[i]);
    };

    const unclamped = TILE_SPECS.filter((spec) =>
      LIGHTNESS_CURVE.every((base) => {
        const shifted = base + spec.lightShift;
        return shifted > PALETTE_CONSTRAINTS.lightMin && shifted < PALETTE_CONSTRAINTS.lightMax;
      }),
    );
    expect(unclamped.length).toBeGreaterThan(4);

    const reference = shapeOf(unclamped[0].kind);
    for (const spec of unclamped.slice(1)) {
      shapeOf(spec.kind).forEach((step, i) => {
        expect(step, `${spec.kind} step ${i}`).toBeCloseTo(reference[i], 1);
      });
    }
  });
});

describe("atmosphere tint", () => {
  it("pulls every biome hue toward the same atmosphere hue", () => {
    // Coherence comes from shared drift, not from per-biome tuning.
    for (const spec of TILE_SPECS) {
      const raw = spec.hue;
      const tinted = resolveStop(spec.hue, spec.sat, spec.lightShift, 4).h;
      if (Math.abs(raw - 44) < 1) continue;
      const movedToward = Math.abs(tinted - 44) < Math.abs(raw - 44);
      expect(movedToward, `${spec.kind} hue ${raw} -> ${tinted}`).toBe(true);
    }
  });

  it("tints highlights more strongly than shadows", () => {
    const shadow = resolveStop(214, 0.3, 0, 0).h;
    const highlight = resolveStop(214, 0.3, 0, 4).h;
    expect(Math.abs(highlight - 44)).toBeLessThan(Math.abs(shadow - 44));
  });
});

describe("hsl round trip", () => {
  it("survives conversion within 8-bit rounding", () => {
    for (const l of [0.15, 0.4, 0.6, 0.8]) {
      for (const h of [40, 120, 200, 280]) {
        const back = hexToHsl(hslToHex(h, 0.25, l));
        expect(back.l).toBeCloseTo(l, 1);
        // Hue precision degrades as chroma shrinks: at low lightness and
        // capped saturation the three channels sit only a few 8-bit steps
        // apart, so quantisation can shift the recovered hue a couple of
        // degrees. Well inside the width of the hue band, so it does not
        // threaten the constraint assertions above.
        expect(Math.abs(back.h - h)).toBeLessThan(3);
      }
    }
  });
});
