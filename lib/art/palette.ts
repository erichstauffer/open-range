/**
 * The coherence engine.
 *
 * This project exists because hand-picked terrain art would not hold a
 * consistent look across biomes. The fix is to stop choosing colours per
 * biome and instead derive every colour in the game from one constrained
 * space:
 *
 *   - hue is confined to an earthy arc (no pure reds, no magentas)
 *   - saturation is capped low, which is the whole difference between
 *     Zelda-bright and Lord-of-the-Rings-muted
 *   - lightness follows ONE curve shared by every biome, so contrast is
 *     identical everywhere
 *   - a single atmosphere hue is mixed into all of it, more strongly at the
 *     light end, the way distance and sunlight tint a real landscape
 *
 * Because a biome supplies only a hue, a saturation and a lightness offset,
 * an off-style tile is not a mistake you can make. `palette.test.ts` asserts
 * every generated colour lands inside the box, so the guarantee is enforced
 * in CI rather than by eye.
 */

/** The five lightness stops every biome ramp shares. Dark to light. */
export const LIGHTNESS_CURVE = [0.14, 0.28, 0.43, 0.59, 0.77] as const;

/** The hard box. Nothing in the game may produce a colour outside this. */
export const PALETTE_CONSTRAINTS = {
  hueMin: 30,
  hueMax: 285,
  satMin: 0.03,
  satMax: 0.38,
  lightMin: 0.05,
  lightMax: 0.95,
} as const;

/**
 * The single unifying tint. `pull` is interpolated linearly *within* the hue
 * band, which is why the result can never leave it: both endpoints are inside
 * a contiguous arc, so every point between them is too.
 */
export const ATMOSPHERE = {
  hue: 44,
  // 0.10 rather than 0.14: at the higher value the pull dragged water's blue
  // all the way to teal, which read tropical instead of northern. This is
  // still a shared tint strong enough to unify, without recolouring anything.
  pull: 0.1,
} as const;

export type Ramp = readonly [string, string, string, string, string];

export type TileKind =
  | "deepWater"
  | "shallowWater"
  | "shore"
  | "meadow"
  | "moor"
  | "woodland"
  | "highland"
  | "snow"
  | "river"
  | "cliff"
  | "bramble";

export interface TileSpec {
  readonly kind: TileKind;
  /** Human-facing terrain word, used verbatim in generated hint text. */
  readonly label: string;
  readonly hue: number;
  readonly sat: number;
  /** Offset applied to the shared lightness curve. Shape is preserved. */
  readonly lightShift: number;
  /** Edge precedence. A tile receives edge overlays from higher-ranked neighbours. */
  readonly rank: number;
  /** Whether terrain permits movement at all, before gating is considered. */
  readonly walkable: boolean;
  /** Barrier tiles are walkable only while carrying the matching artifact. */
  readonly barrier: boolean;
  /**
   * Optional second hue for small details - heather on a moor, wildflowers in
   * grass, blue shadow on snow. Resolved through the same constraint box as the
   * main ramp, so an accent cannot escape the palette either.
   *
   * This is what lets a moor be olive-brown GROUND with purple FLECKS, rather
   * than purple ground, which is what it looked like when heather was the base
   * hue: alien, and the one biome that clashed with every other.
   */
  readonly accent?: { readonly hue: number; readonly sat: number };
}

export const TILE_SPECS: readonly TileSpec[] = [
  { kind: "deepWater", label: "deep water", hue: 224, sat: 0.26, lightShift: -0.17, rank: 0, walkable: false, barrier: false },
  { kind: "shallowWater", label: "shallows", hue: 208, sat: 0.26, lightShift: -0.03, rank: 1, walkable: false, barrier: false },
  { kind: "shore", label: "sand", hue: 46, sat: 0.2, lightShift: 0.12, rank: 2, walkable: true, barrier: false, accent: { hue: 30, sat: 0.16 } },
  { kind: "meadow", label: "open grass", hue: 88, sat: 0.21, lightShift: 0.02, rank: 3, walkable: true, barrier: false, accent: { hue: 46, sat: 0.3 } },
  { kind: "moor", label: "heather moor", hue: 62, sat: 0.14, lightShift: -0.04, rank: 4, walkable: true, barrier: false, accent: { hue: 283, sat: 0.24 } },
  { kind: "woodland", label: "woodland", hue: 130, sat: 0.2, lightShift: -0.07, rank: 5, walkable: true, barrier: false, accent: { hue: 44, sat: 0.26 } },
  { kind: "highland", label: "bare highland", hue: 34, sat: 0.1, lightShift: 0, rank: 6, walkable: true, barrier: false },
  { kind: "snow", label: "snowfield", hue: 210, sat: 0.07, lightShift: 0.08, rank: 7, walkable: true, barrier: false, accent: { hue: 215, sat: 0.14 } },
  { kind: "river", label: "river", hue: 214, sat: 0.26, lightShift: -0.06, rank: 8, walkable: true, barrier: true },
  { kind: "cliff", label: "cliff", hue: 33, sat: 0.09, lightShift: -0.1, rank: 9, walkable: true, barrier: true },
  { kind: "bramble", label: "bramble", hue: 100, sat: 0.16, lightShift: -0.12, rank: 10, walkable: true, barrier: true, accent: { hue: 32, sat: 0.26 } },
];

export const TILE_KINDS: readonly TileKind[] = TILE_SPECS.map((s) => s.kind);

/** Numeric id used by the packed tile grid. Index into TILE_SPECS. */
export type TileId = number;

const SPEC_BY_KIND = new Map<TileKind, TileSpec>(TILE_SPECS.map((s) => [s.kind, s]));
const ID_BY_KIND = new Map<TileKind, number>(TILE_SPECS.map((s, i) => [s.kind, i]));

export function specOf(kind: TileKind): TileSpec {
  const spec = SPEC_BY_KIND.get(kind);
  if (!spec) throw new Error(`Unknown tile kind: ${kind}`);
  return spec;
}

export function tileId(kind: TileKind): TileId {
  const id = ID_BY_KIND.get(kind);
  if (id === undefined) throw new Error(`Unknown tile kind: ${kind}`);
  return id;
}

export function specById(id: TileId): TileSpec {
  const spec = TILE_SPECS[id];
  if (!spec) throw new Error(`Unknown tile id: ${id}`);
  return spec;
}

// --- Colour construction ----------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = l - c / 2;
  const to255 = (v: number) =>
    Math.round(clamp(v + m, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/**
 * Inverse of `hslToHex`. The test suite uses this to verify the colours that
 * actually reach the canvas, rather than the intermediate maths that produced
 * them - 8-bit rounding happens in between, so only the hex is authoritative.
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  return { h: ((h * 60) % 360 + 360) % 360, s, l };
}

/** The resolved HSL of one ramp stop, before hex conversion. Exposed for tests. */
export interface ResolvedStop {
  h: number;
  s: number;
  l: number;
}

export function resolveStop(hue: number, sat: number, lightShift: number, stopIndex: number): ResolvedStop {
  const base = LIGHTNESS_CURVE[stopIndex];
  const l = clamp(base + lightShift, PALETTE_CONSTRAINTS.lightMin, PALETTE_CONSTRAINTS.lightMax);

  // Aerial perspective: highlights take more of the atmosphere than shadows do.
  const pull = ATMOSPHERE.pull * (0.6 + 0.9 * base);
  const h = hue + (ATMOSPHERE.hue - hue) * pull;

  // Saturation tapers toward both ends of the ramp so shadows do not go inky
  // and highlights do not go neon. Tied to the shared curve, not to lightShift,
  // so all biomes taper identically.
  const taper = 1 - Math.abs(base - 0.43) * 0.55;
  const s = clamp(sat * taper, PALETTE_CONSTRAINTS.satMin, PALETTE_CONSTRAINTS.satMax);

  return { h, s, l };
}

export function buildRamp(hue: number, sat: number, lightShift: number): Ramp {
  const stops = LIGHTNESS_CURVE.map((_, i) => {
    const { h, s, l } = resolveStop(hue, sat, lightShift, i);
    return hslToHex(h, s, l);
  });
  return stops as unknown as Ramp;
}

export type RampTable = Readonly<Record<TileKind, Ramp>>;

/** Every terrain ramp in the game. Built once; there is nothing seed-dependent here. */
export function buildRampTable(): RampTable {
  const table = {} as Record<TileKind, Ramp>;
  for (const spec of TILE_SPECS) {
    table[spec.kind] = buildRamp(spec.hue, spec.sat, spec.lightShift);
  }
  return table;
}

export const RAMPS: RampTable = buildRampTable();

/**
 * Two-stop detail ramp per biome: [mid, light]. Biomes with no declared accent
 * fall back to their own upper ramp stops, so a painter can always reach for an
 * accent without checking whether one exists.
 */
export type AccentPair = readonly [string, string];
export type AccentTable = Readonly<Record<TileKind, AccentPair>>;

export function buildAccentTable(): AccentTable {
  const table = {} as Record<TileKind, AccentPair>;
  for (const spec of TILE_SPECS) {
    if (!spec.accent) {
      table[spec.kind] = [RAMPS[spec.kind][3], RAMPS[spec.kind][4]];
      continue;
    }
    const mid = resolveStop(spec.accent.hue, spec.accent.sat, spec.lightShift, 2);
    const light = resolveStop(spec.accent.hue, spec.accent.sat, spec.lightShift, 3);
    table[spec.kind] = [hslToHex(mid.h, mid.s, mid.l), hslToHex(light.h, light.s, light.l)];
  }
  return table;
}

export const ACCENTS: AccentTable = buildAccentTable();

/**
 * Chrome colours, drawn from the same space so the interface never fights the
 * world it frames. Parchment and ink rather than a neutral grey UI.
 */
export const UI = {
  parchment: hslToHex(...stopArgs(42, 0.22, 0.86)),
  parchmentDim: hslToHex(...stopArgs(42, 0.18, 0.74)),
  ink: hslToHex(...stopArgs(36, 0.24, 0.13)),
  inkSoft: hslToHex(...stopArgs(36, 0.16, 0.34)),
  night: hslToHex(...stopArgs(220, 0.22, 0.09)),
  nightSoft: hslToHex(...stopArgs(220, 0.16, 0.17)),
  accent: hslToHex(...stopArgs(48, 0.36, 0.56)),
  moss: hslToHex(...stopArgs(112, 0.2, 0.36)),
} as const;

/** Applies the same atmosphere pull and saturation cap the terrain gets. */
function stopArgs(hue: number, sat: number, light: number): [number, number, number] {
  const pull = ATMOSPHERE.pull * (0.6 + 0.9 * light);
  const h = hue + (ATMOSPHERE.hue - hue) * pull;
  const s = clamp(sat, PALETTE_CONSTRAINTS.satMin, PALETTE_CONSTRAINTS.satMax);
  return [h, s, clamp(light, PALETTE_CONSTRAINTS.lightMin, PALETTE_CONSTRAINTS.lightMax)];
}

/** Shared sprite roles, so characters and props sit in the terrain palette too. */
export const SPRITE_PALETTE = {
  outline: hslToHex(...stopArgs(28, 0.26, 0.11)),
  shadow: hslToHex(...stopArgs(28, 0.2, 0.2)),
  skin: hslToHex(...stopArgs(34, 0.3, 0.62)),
  skinShade: hslToHex(...stopArgs(34, 0.3, 0.48)),
  /**
   * Warm grey. Landmarks previously borrowed `metal`, whose blue cast made
   * cairns and standing stones read as marble or steel rather than weathered
   * rock.
   */
  stone: hslToHex(...stopArgs(40, 0.07, 0.58)),
  stoneShade: hslToHex(...stopArgs(40, 0.09, 0.38)),
  metal: hslToHex(...stopArgs(210, 0.08, 0.66)),
  metalShade: hslToHex(...stopArgs(210, 0.1, 0.44)),
  gold: hslToHex(...stopArgs(46, 0.36, 0.6)),
  wood: hslToHex(...stopArgs(32, 0.24, 0.32)),
  /**
   * Deliberately darker than every cloak. Cloaks all sit near l=0.34 by
   * construction, so a fixed dark leg tone guarantees the legs separate from
   * the torso on every character instead of merging into one brown mass.
   */
  trouser: hslToHex(...stopArgs(30, 0.22, 0.2)),
  glow: hslToHex(...stopArgs(50, 0.34, 0.72)),
} as const;

/** Cloak colours for characters, spread across the band at one lightness. */
export const CLOAK_COLORS: readonly string[] = [
  hslToHex(...stopArgs(96, 0.2, 0.34)),
  hslToHex(...stopArgs(210, 0.22, 0.36)),
  hslToHex(...stopArgs(275, 0.16, 0.34)),
  hslToHex(...stopArgs(40, 0.24, 0.38)),
  hslToHex(...stopArgs(150, 0.18, 0.32)),
  hslToHex(...stopArgs(12 + 30, 0.26, 0.3)),
];
