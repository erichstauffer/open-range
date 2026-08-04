/**
 * Procedural terrain tiles.
 *
 * Every tile is 16x16 and drawn from its biome's five-stop ramp - never from a
 * literal colour. A biome contributes only *where* marks go; the palette
 * decides what colour they are. That split is what keeps eleven terrain types
 * looking like one illustration.
 *
 * Two rules keep the world from reading as a grid of coloured squares:
 *
 *  1. Tile interiors are FLAT plus small clustered marks, never a gradient.
 *     A per-tile gradient cannot line up with its neighbour, and the seams
 *     become a visible lattice.
 *  2. All blending between biomes happens in `drawEdgeOverlay`, as a dithered
 *     band keyed to the *neighbour's* ramp. Grass creeps onto sand; sand does
 *     not creep onto grass. Precedence comes from `TileSpec.rank`.
 */

import { hash2D, makeRng, type Rng } from "../rand";
import { ACCENTS, RAMPS, type AccentPair, type Ramp, type TileKind } from "./palette";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const TILE = 16;

/** Distinct interior variants baked per biome. Chosen per world tile by hash. */
export const VARIANTS = 6;

/** Depth in pixels of a biome-to-biome transition band. */
const EDGE_DEPTH = 6;

/** Ordered dither matrix. Ordered rather than random: no frame-to-frame noise. */
const BAYER4: readonly number[][] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function bayer(x: number, y: number): number {
  return (BAYER4[y & 3][x & 3] + 0.5) / 16;
}

function px(ctx: Ctx2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function hline(ctx: Ctx2D, x: number, y: number, len: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, len, 1);
}

function vline(ctx: Ctx2D, x: number, y: number, len: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, len);
}

/**
 * Sparse grain. Adds texture without implying a light direction.
 *
 * `density` is a real probability: pass 0.08 and roughly 8% of the tile's
 * pixels are marked. An earlier version multiplied two uniform variables
 * together, which meant density 0.5 actually painted about 48% of the tile and
 * turned every biome into television static.
 */
function speckle(ctx: Ctx2D, ox: number, oy: number, color: string, density: number, salt: number): void {
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      if (hash2D(x, y, salt) < density) px(ctx, ox + x, oy + y, color);
    }
  }
}

type TilePainter = (
  ctx: Ctx2D,
  ox: number,
  oy: number,
  ramp: Ramp,
  accent: AccentPair,
  rng: Rng,
  variant: number,
) => void;

/** Scatter n single pixels. */
function scatter(ctx: Ctx2D, ox: number, oy: number, n: number, rng: Rng, color: string): void {
  for (let i = 0; i < n; i += 1) {
    px(ctx, ox + Math.floor(rng() * TILE), oy + Math.floor(rng() * TILE), color);
  }
}

/** Horizontal marks of a random length, used for water flow and forest litter. */
function dashes(ctx: Ctx2D, ox: number, oy: number, n: number, rng: Rng, color: string, min: number, max: number): void {
  for (let i = 0; i < n; i += 1) {
    const len = min + Math.floor(rng() * (max - min + 1));
    const x = Math.floor(rng() * (TILE - len));
    const y = Math.floor(rng() * TILE);
    hline(ctx, ox + x, oy + y, len, color);
  }
}

const PAINTERS: Record<TileKind, TilePainter> = {
  deepWater(ctx, ox, oy, ramp, _accent, rng, variant) {
    ctx.fillStyle = ramp[1];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[0], 0.07, variant * 31 + 3);
    dashes(ctx, ox, oy, 2, rng, ramp[2], 3, 4);
  },

  shallowWater(ctx, ox, oy, ramp, _accent, rng, variant) {
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[1], 0.07, variant * 17 + 5);
    dashes(ctx, ox, oy, 3, rng, ramp[3], 3, 5);
    scatter(ctx, ox, oy, 1, rng, ramp[4]);
  },

  shore(ctx, ox, oy, ramp, accent, rng, variant) {
    ctx.fillStyle = ramp[3];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, accent[0], 0.08, variant * 23 + 7);
    scatter(ctx, ox, oy, 3, rng, ramp[2]);
    scatter(ctx, ox, oy, 2, rng, ramp[4]);
  },

  meadow(ctx, ox, oy, ramp, accent, rng, variant) {
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[1], 0.06, variant * 29 + 11);
    // Blades in two lightnesses give the field depth without a gradient.
    for (let i = 0; i < 6; i += 1) {
      const x = Math.floor(rng() * TILE);
      const y = Math.floor(rng() * (TILE - 2));
      vline(ctx, ox + x, oy + y, 2, rng() < 0.55 ? ramp[3] : ramp[1]);
    }
    scatter(ctx, ox, oy, 2, rng, accent[1]);
  },

  moor(ctx, ox, oy, ramp, accent, rng, variant) {
    // Olive-brown ground; the purple lives only in the heather.
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[1], 0.08, variant * 13 + 2);
    for (let i = 0; i < 4; i += 1) {
      const x = Math.floor(rng() * TILE);
      const y = Math.floor(rng() * (TILE - 2));
      vline(ctx, ox + x, oy + y, 2, ramp[1]);
    }
    // Paired dots read as tiny flowers at this scale.
    for (let i = 0; i < 5; i += 1) {
      const x = Math.floor(rng() * (TILE - 2));
      const y = Math.floor(rng() * (TILE - 1));
      px(ctx, ox + x, oy + y, accent[0]);
      px(ctx, ox + x + 1, oy + y + (rng() < 0.5 ? 0 : 1), accent[1]);
    }
  },

  woodland(ctx, ox, oy, ramp, accent, rng, variant) {
    // Forest FLOOR. Trees are props, so canopies never tile against each other.
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[1], 0.09, variant * 37 + 13);
    dashes(ctx, ox, oy, 4, rng, ramp[1], 2, 3);
    // Dappled light through the canopy.
    scatter(ctx, ox, oy, 2, rng, accent[1]);
  },

  highland(ctx, ox, oy, ramp, _accent, rng, variant) {
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[3], 0.07, variant * 41 + 17);
    // Fissures with a lit edge, rather than filled triangles - solid facets at
    // 16px read as scattered teepees, not as rock planes.
    for (let f = 0; f < 2; f += 1) {
      const x0 = 2 + Math.floor(rng() * (TILE - 6));
      const y0 = Math.floor(rng() * (TILE - 6));
      const len = 4 + Math.floor(rng() * 5);
      for (let d = 0; d < len; d += 1) {
        const x = x0 + (d % 2 === 0 ? 0 : 1);
        const y = y0 + d;
        if (y >= TILE) break;
        px(ctx, ox + x, oy + y, ramp[0]);
        if (x > 0) px(ctx, ox + x - 1, oy + y, ramp[3]);
      }
    }
  },

  snow(ctx, ox, oy, ramp, accent, rng, variant) {
    ctx.fillStyle = ramp[4];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[3], 0.05, variant * 43 + 19);
    // Wind drifts: shallow arcs, with a cold shadow on the lee side.
    for (let i = 0; i < 2; i += 1) {
      const y = 2 + Math.floor(rng() * (TILE - 5));
      const x = Math.floor(rng() * (TILE - 8));
      const len = 5 + Math.floor(rng() * 4);
      for (let d = 0; d < len; d += 1) {
        const dy = d < len / 2 ? 0 : 1;
        px(ctx, ox + x + d, oy + y + dy, ramp[3]);
        px(ctx, ox + x + d, oy + y + dy + 1, accent[0]);
      }
    }
    if (rng() < 0.4) {
      const x = Math.floor(rng() * (TILE - 3));
      const y = Math.floor(rng() * (TILE - 2));
      hline(ctx, ox + x, oy + y, 3, ramp[2]);
      hline(ctx, ox + x + 1, oy + y + 1, 2, ramp[1]);
    }
  },

  river(ctx, ox, oy, ramp, _accent, rng, variant) {
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[1], 0.06, variant * 47 + 23);
    // Longer flow lines than the shallows: a barrier must read as moving water.
    dashes(ctx, ox, oy, 4, rng, ramp[3], 5, 7);
    dashes(ctx, ox, oy, 2, rng, ramp[4], 2, 3);
  },

  cliff(ctx, ox, oy, ramp, _accent, rng, variant) {
    ctx.fillStyle = ramp[2];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[1], 0.08, variant * 53 + 29);
    // Irregular stacked ledges, drawn as lit top edges and shadowed bottom
    // edges of overlapping blocks. Evenly spaced vertical fissures - the
    // previous approach - tiled into a picket fence, which read as built
    // rather than geological.
    for (let i = 0; i < 4; i += 1) {
      const w = 4 + Math.floor(rng() * 6);
      const h = 3 + Math.floor(rng() * 5);
      const x = Math.floor(rng() * (TILE - w));
      const y = Math.floor(rng() * (TILE - h));
      hline(ctx, ox + x, oy + y, w, ramp[3]);
      hline(ctx, ox + x, oy + y + h, w, ramp[0]);
      // A short broken riser, never spanning the full tile height.
      if (rng() < 0.6) vline(ctx, ox + x, oy + y, h, ramp[1]);
    }
  },

  bramble(ctx, ox, oy, ramp, accent, rng, variant) {
    ctx.fillStyle = ramp[1];
    ctx.fillRect(ox, oy, TILE, TILE);
    speckle(ctx, ox, oy, ramp[0], 0.07, variant * 59 + 31);
    // Mixed slopes. Every stroke at 45 degrees produced a regular crosshatch
    // that looked like chain-link fencing instead of a thicket.
    const slopes: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [1, -1],
      [2, 1],
      [1, 2],
      [2, -1],
      [1, -2],
    ];
    for (let i = 0; i < 6; i += 1) {
      const [sx, sy] = slopes[Math.floor(rng() * slopes.length)];
      let x = Math.floor(rng() * TILE);
      let y = Math.floor(rng() * TILE);
      const steps = 3 + Math.floor(rng() * 5);
      const color = rng() < 0.5 ? ramp[2] : ramp[3];
      const thick = rng() < 0.45;
      for (let s = 0; s < steps; s += 1) {
        if (x < 0 || x >= TILE || y < 0 || y >= TILE) break;
        px(ctx, ox + x, oy + y, color);
        if (thick && y + 1 < TILE) px(ctx, ox + x, oy + y + 1, color);
        x += sx;
        y += sy;
      }
    }
    // Berries, so the thicket reads as something living.
    scatter(ctx, ox, oy, 3, rng, accent[0]);
    scatter(ctx, ox, oy, 1, rng, accent[1]);
  },
};

/**
 * Paint one 16x16 interior at (ox, oy). Deterministic in (kind, variant), so
 * the atlas is byte-identical on every machine and nothing shimmers.
 */
export function drawTile(
  ctx: Ctx2D,
  ox: number,
  oy: number,
  kind: TileKind,
  variant: number,
  ramp: Ramp = RAMPS[kind],
  accent: AccentPair = ACCENTS[kind],
): void {
  const rng: Rng = makeRng(`tile:${kind}`, `v${variant}`);
  PAINTERS[kind](ctx, ox, oy, ramp, accent, rng, variant);
}

export type EdgeDir = 0 | 1 | 2 | 3;

/**
 * Paint a transparent 16x16 cell holding one dithered transition band, drawn
 * in the NEIGHBOUR's ramp, entering from `dir` (0=N, 1=E, 2=S, 3=W).
 *
 * Four masks per biome rather than sixteen per biome *pair*: the bands compose
 * additively, so a corner tile bordered on two sides simply gets two overlays.
 */
export function drawEdgeOverlay(ctx: Ctx2D, ox: number, oy: number, dir: EdgeDir, neighbour: Ramp): void {
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      let depth: number;
      if (dir === 0) depth = y;
      else if (dir === 1) depth = TILE - 1 - x;
      else if (dir === 2) depth = TILE - 1 - y;
      else depth = x;

      if (depth >= EDGE_DEPTH) continue;

      // 1 at the shared border, falling to 0 at EDGE_DEPTH.
      const strength = 1 - depth / EDGE_DEPTH;
      if (strength > bayer(x, y)) {
        px(ctx, ox + x, oy + y, depth === 0 ? neighbour[3] : neighbour[2]);
      }
    }
  }
}

/** Stable per-world-tile variant choice. */
export function variantFor(x: number, y: number): number {
  return Math.floor(hash2D(x, y, 0x5eed) * VARIANTS) % VARIANTS;
}
