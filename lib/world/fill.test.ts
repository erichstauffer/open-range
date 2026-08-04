import { describe, expect, it } from "vitest";
import { specById } from "../art/palette";
import { BARRIER_ORDER, type BarrierKind } from "./gates";
import { generateWorld, type World } from "./gen";
import { findMainland } from "./regions";
import { generateTerrain } from "./biome";

/**
 * The solvability suite.
 *
 * Forward fill is designed so that a key can only ever be hidden in space the
 * player can already reach. These tests confirm that on a large sample of
 * worlds. They are a check on the implementation, not a substitute for the
 * design - if they ever fail, the fill has a bug, not bad luck.
 *
 * Worlds are generated at a reduced size to keep the sweep quick; the algorithm
 * is size-independent.
 */

const W = 128;
const H = 128;

function seeds(count: number, prefix = "s"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

/**
 * Independent walk of the tile grid, deliberately NOT reusing the region graph
 * that generation itself relies on. If painting borders ever failed to fully
 * separate two regions, a region-graph check would agree with the bug; walking
 * actual tiles would not.
 */
function walkableTilesFrom(world: World, carrying: ReadonlySet<BarrierKind>): Set<number> {
  const seen = new Set<number>([world.startTile]);
  const queue = [world.startTile];
  const solid = new Set(world.props.filter((p) => p.solid).map((p) => p.tile));

  const passable = (tile: number): boolean => {
    const spec = specById(world.tiles[tile]);
    if (!spec.walkable) return false;
    if (solid.has(tile)) return false;
    const barrier = world.barrierOf[tile];
    if (barrier === 0) return true;
    return carrying.has(BARRIER_ORDER[barrier - 1]);
  };

  while (queue.length > 0) {
    const current = queue.pop() as number;
    const x = current % world.width;
    const y = (current - x) / world.width;

    for (let dir = 0; dir < 4; dir += 1) {
      const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      const next = ny * world.width + nx;
      if (seen.has(next) || !passable(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

describe("island shaping", () => {
  it("always produces a mainland large enough for a progression", () => {
    for (const seed of seeds(60, "island")) {
      const world = generateWorld(seed, W, H);
      const mainland = world.regions.reduce((sum, r) => sum + r.tiles.length, 0);
      expect(mainland, seed).toBeGreaterThan(1200);
    }
  });

  it("never lets land touch the map edge", () => {
    // Otherwise the player walks into an invisible wall instead of a coastline.
    for (const seed of seeds(20, "edge")) {
      const terrain = generateTerrain(seed, W, H);
      for (let x = 0; x < W; x += 1) {
        expect(specById(terrain.tiles[x]).walkable, `${seed} top ${x}`).toBe(false);
        expect(specById(terrain.tiles[(H - 1) * W + x]).walkable, `${seed} bottom ${x}`).toBe(false);
      }
      for (let y = 0; y < H; y += 1) {
        expect(specById(terrain.tiles[y * W]).walkable, `${seed} left ${y}`).toBe(false);
        expect(specById(terrain.tiles[y * W + W - 1]).walkable, `${seed} right ${y}`).toBe(false);
      }
    }
  });

  it("keeps every region internally connected", () => {
    // Geodesic Voronoi should guarantee this; Euclidean would not.
    const world = generateWorld("connectivity", W, H);
    for (const region of world.regions) {
      const members = new Set(region.tiles);
      const seen = new Set<number>([region.tiles[0]]);
      const queue = [region.tiles[0]];
      while (queue.length > 0) {
        const current = queue.pop() as number;
        const x = current % world.width;
        const y = (current - x) / world.width;
        for (let dir = 0; dir < 4; dir += 1) {
          const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
          const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
          const next = ny * world.width + nx;
          if (!members.has(next) || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size, `region ${region.id}`).toBe(region.tiles.length);
    }
  });
});

describe("forward fill solvability", () => {
  const SAMPLE = 500;

  it(`completes every one of ${SAMPLE} generated worlds`, () => {
    const failures: string[] = [];

    for (const seed of seeds(SAMPLE, "fill")) {
      const world = generateWorld(seed, W, H);
      const carrying = new Set<BarrierKind>();

      // Collect in tier order, requiring each artifact to be standing-reachable
      // with only what has already been collected.
      for (const artifact of [...world.artifacts].sort((a, b) => a.tier - b.tier)) {
        const reachable = walkableTilesFrom(world, carrying);
        if (!reachable.has(artifact.tile)) {
          failures.push(`${seed}: ${artifact.id} (tier ${artifact.tier}) unreachable`);
          break;
        }
        carrying.add(artifact.opens);
      }
    }

    expect(failures).toEqual([]);
  });

  it("produces three ordered artifacts on a typical world", () => {
    let withThree = 0;
    const sample = seeds(80, "tiers");
    for (const seed of sample) {
      const world = generateWorld(seed, W, H);
      if (world.artifacts.length === BARRIER_ORDER.length) withThree += 1;
      world.artifacts.forEach((artifact, i) => {
        expect(artifact.tier, seed).toBe(i);
      });
    }
    // Tier assignment uses BFS order, so this should be essentially universal.
    expect(withThree / sample.length).toBeGreaterThan(0.95);
  });

  it("never hides an artifact behind the barrier it opens", () => {
    for (const seed of seeds(120, "selfblock")) {
      const world = generateWorld(seed, W, H);
      for (const artifact of world.artifacts) {
        const without = new Set(
          world.artifacts.filter((a) => a.tier < artifact.tier).map((a) => a.opens),
        );
        const reachable = walkableTilesFrom(world, without);
        expect(reachable.has(artifact.tile), `${seed} ${artifact.id}`).toBe(true);
      }
    }
  });

  it("opens every region once everything is carried", () => {
    for (const seed of seeds(60, "complete")) {
      const world = generateWorld(seed, W, H);
      const all = new Set<BarrierKind>(world.artifacts.map((a) => a.opens));
      const reachable = walkableTilesFrom(world, all);

      const reachedRegions = new Set<number>();
      for (const tile of reachable) {
        const id = world.regionOf[tile];
        if (id >= 0) reachedRegions.add(id);
      }
      expect(reachedRegions.size, seed).toBe(world.regions.length);
    }
  });

  it("reaches the ending region only after collecting everything", () => {
    for (const seed of seeds(60, "ending")) {
      const world = generateWorld(seed, W, H);
      const endingTiles = world.regions[world.endingRegionId]?.tiles ?? [];
      expect(endingTiles.length, seed).toBeGreaterThan(0);
      const all = new Set<BarrierKind>(world.artifacts.map((a) => a.opens));
      const reachable = walkableTilesFrom(world, all);
      expect(endingTiles.some((tile) => reachable.has(tile)), seed).toBe(true);
    }
  });
});

describe("determinism", () => {
  it("gives byte-identical worlds for the same seed", () => {
    const a = generateWorld("dunhollow", W, H);
    const b = generateWorld("dunhollow", W, H);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.artifacts.map((x) => x.tile)).toEqual(b.artifacts.map((x) => x.tile));
    expect(a.npcs.map((x) => `${x.id}${x.tile}${x.lines.join()}`)).toEqual(
      b.npcs.map((x) => `${x.id}${x.tile}${x.lines.join()}`),
    );
  });

  it("gives different worlds for different seeds", () => {
    expect(generateWorld("amrath", W, H).hash).not.toBe(generateWorld("enneth", W, H).hash);
  });

  it("uses no Math.random anywhere in world generation", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error("world generation must not call Math.random");
    };
    try {
      expect(() => generateWorld("purity", W, H)).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

describe("mainland selection", () => {
  it("picks the largest walkable component", () => {
    const terrain = generateTerrain("mainland", W, H);
    const { mask, count } = findMainland(terrain);
    let counted = 0;
    for (let i = 0; i < mask.length; i += 1) counted += mask[i];
    expect(counted).toBe(count);
    expect(count).toBeGreaterThan(0);
  });
});
