/**
 * Barriers and gating.
 *
 * The transcript's progression rule was: "you can't get to this area until you
 * find this artifact in this area." This module implements it in the simplest
 * way that is *provably* correct rather than merely likely:
 *
 *   The ENTIRE border between two regions is painted with one barrier terrain.
 *
 * That makes region-graph reachability and actual walking reachability the same
 * thing. There is no chokepoint to place, no gap for noise to accidentally
 * leave open, and no need to verify that a wall has no hole in it - if you can
 * cross the border at all, you could cross it anywhere, and only the artifact
 * decides.
 *
 * Barrier kind is assigned by the border's depth from the start region, which
 * produces a natural three-stage progression: rivers first, then cliffs, then
 * bramble.
 */

import { hash2D, type Rng } from "../rand";
import { specById, tileId } from "../art/palette";
import { artifactName } from "./names";
import type { TerrainFields } from "./biome";
import type { Landmark } from "./landmarks";
import type { RegionMap } from "./regions";

export type BarrierKind = "river" | "cliff" | "bramble";

export const BARRIER_ORDER: readonly BarrierKind[] = ["river", "cliff", "bramble"];

/** Width in tiles of a painted border. Thick enough to read as a real feature. */
const BORDER_THICKNESS = 2;

export interface Artifact {
  /** Stable id, also used to seed the artifact's own sprite. */
  id: string;
  name: string;
  /** The barrier terrain this artifact lets you cross. */
  opens: BarrierKind;
  /** Tile index where it lies. */
  tile: number;
  /** Region the tile belongs to. */
  regionId: number;
  /** Progression tier, 0 upward. */
  tier: number;
  /**
   * The landmark this artifact was deliberately placed beside. The most
   * specific hint tier names it, so anchoring the artifact to a landmark up
   * front is what makes "beneath the split oak" true by construction rather
   * than something that has to be checked and repaired afterwards.
   */
  anchorLandmarkId: string;
}

/** How close an artifact is placed to its anchor landmark, in tiles. */
export const ARTIFACT_ANCHOR_RADIUS = 5;

export interface GateLayout {
  /** BarrierKind index + 1 per tile, 0 for no barrier. */
  barrierOf: Uint8Array;
  /** Terrain ids rewritten with barrier tiles painted in. */
  tiles: Uint8Array;
  /** Which barrier kind guards each region-to-region border. */
  borderKind: Map<string, BarrierKind>;
}

const NOUNS: Readonly<Record<BarrierKind, string>> = {
  river: "Ford Stone",
  cliff: "Climbing Hooks",
  bramble: "Bramble Blade",
};

/** Human-facing description of what a barrier is, for hint and HUD text. */
export const BARRIER_LABEL: Readonly<Record<BarrierKind, string>> = {
  river: "fast water",
  cliff: "sheer rock",
  bramble: "thorn thicket",
};

export function borderKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Split the regions into four progression batches: the start region, then
 * three roughly equal groups in breadth-first order outward from it.
 *
 * Batches are taken from BFS *order*, not BFS *depth*. Depth looked like the
 * natural choice but fails in practice: seven regions in a geodesic Voronoi
 * form a dense planar graph whose depth from any start is often only one or
 * two, which would silently collapse a three-artifact progression into one or
 * two. Order always yields three non-empty batches whenever there are at least
 * four regions.
 */
export function assignBatches(regionMap: RegionMap): Map<number, number> {
  const { startRegionId, adjacency, regions } = regionMap;

  const order: number[] = [startRegionId];
  const seen = new Set<number>([startRegionId]);
  for (let i = 0; i < order.length; i += 1) {
    for (const other of adjacency[order[i]]) {
      if (seen.has(other)) continue;
      seen.add(other);
      order.push(other);
    }
  }
  // Regions cut off from the start (should not occur on one landmass, but the
  // fill must not depend on that) go to the far end.
  for (const region of regions) if (!seen.has(region.id)) order.push(region.id);

  const batches = new Map<number, number>([[startRegionId, 0]]);
  const rest = order.slice(1);
  const perBatch = Math.ceil(rest.length / BARRIER_ORDER.length);
  rest.forEach((id, i) => {
    batches.set(id, Math.min(BARRIER_ORDER.length, Math.floor(i / perBatch) + 1));
  });

  return batches;
}

/**
 * Paint every region border with a barrier terrain, choosing the kind from how
 * deep into the island that border sits.
 */
export function buildGates(terrain: TerrainFields, regionMap: RegionMap): GateLayout {
  const { width, height } = terrain;
  const total = width * height;
  const { regionOf, regions } = regionMap;

  const tiles = Uint8Array.from(terrain.tiles);
  const barrierOf = new Uint8Array(total);
  const borderKind = new Map<string, BarrierKind>();

  const BARRIER_IDS: Record<BarrierKind, number> = {
    river: tileId("river"),
    cliff: tileId("cliff"),
    bramble: tileId("bramble"),
  };

  const batchOf = assignBatches(regionMap);

  // Decide a kind per border pair first, so both sides agree.
  //
  // The kind comes from the DEEPER of the two batches, so entering a batch-k
  // region always costs artifact k regardless of which neighbour you approach
  // from. Taking the shallower side instead would leave a back door: a border
  // between batch 0 and batch 3 would be guarded by the first artifact.
  for (const region of regions) {
    for (const other of regionMap.adjacency[region.id]) {
      const key = borderKey(region.id, other);
      if (borderKind.has(key)) continue;
      const deeper = Math.max(batchOf.get(region.id) ?? 0, batchOf.get(other) ?? 0);
      const index = Math.min(Math.max(deeper - 1, 0), BARRIER_ORDER.length - 1);
      borderKind.set(key, BARRIER_ORDER[index]);
    }
  }

  // Collect border tiles: a mainland tile adjacent to a different region.
  const frontier: Array<{ tile: number; kind: BarrierKind }> = [];
  for (let i = 0; i < total; i += 1) {
    const id = regionOf[i];
    if (id < 0) continue;
    const x = i % width;
    const y = (i - x) / width;

    for (let dir = 0; dir < 4; dir += 1) {
      const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = regionOf[ny * width + nx];
      if (other < 0 || other === id) continue;
      const kind = borderKind.get(borderKey(id, other));
      if (kind) frontier.push({ tile: i, kind });
      break;
    }
  }

  // Thicken inward from the seam so the barrier reads as a landscape feature
  // rather than a one-pixel line.
  //
  // Layers past the first are applied unevenly, keyed to a stable coordinate
  // hash. A uniform two-tile band traced the Voronoi boundary exactly and read
  // as a surveyed canal; ragged edges read as a river or a ridge. The FIRST
  // layer is always solid, which is what preserves the gating guarantee - the
  // seam itself is never left with a gap.
  let layer = frontier;
  const painted = new Set<number>();
  for (let step = 0; step < BORDER_THICKNESS; step += 1) {
    const next: Array<{ tile: number; kind: BarrierKind }> = [];
    for (const { tile, kind } of layer) {
      if (painted.has(tile)) continue;

      const jx = tile % width;
      const jy = (tile - jx) / width;
      if (step > 0 && hash2D(jx, jy, 0x8a71) > 0.62) continue;

      painted.add(tile);
      tiles[tile] = BARRIER_IDS[kind];
      barrierOf[tile] = BARRIER_ORDER.indexOf(kind) + 1;

      const x = tile % width;
      const y = (tile - x) / width;
      for (let dir = 0; dir < 4; dir += 1) {
        const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (regionOf[neighbour] < 0 || painted.has(neighbour)) continue;
        next.push({ tile: neighbour, kind });
      }
    }
    layer = next;
  }

  return { barrierOf, tiles, borderKind };
}

/**
 * Everything needed to walk the map the way the player does.
 *
 * Reachability is computed on TILES, not on the region graph. The region graph
 * looked equivalent - borders are painted in full, so crossing between regions
 * always means crossing a barrier - but it is not: painting a border two tiles
 * deep on both sides can cut a narrow region's passable interior into
 * disconnected pockets. The graph still calls that region "reached", while a
 * player standing in one pocket cannot walk to the other. Placing a key in the
 * wrong pocket produced genuinely unsolvable worlds.
 */
export interface WalkContext {
  width: number;
  height: number;
  tiles: Uint8Array;
  barrierOf: Uint8Array;
  /** Tiles occupied by movement-blocking props. */
  solid: ReadonlySet<number>;
  startTile: number;
}

export function isPassable(ctx: WalkContext, tile: number, carrying: ReadonlySet<BarrierKind>): boolean {
  if (!specById(ctx.tiles[tile]).walkable) return false;
  if (ctx.solid.has(tile)) return false;
  const barrier = ctx.barrierOf[tile];
  if (barrier === 0) return true;
  return carrying.has(BARRIER_ORDER[barrier - 1]);
}

/** Flood fill of every tile the player can stand on with the given artifacts. */
export function reachableTiles(ctx: WalkContext, carrying: ReadonlySet<BarrierKind>): Set<number> {
  const seen = new Set<number>();
  if (!isPassable(ctx, ctx.startTile, carrying)) return seen;

  seen.add(ctx.startTile);
  const queue: number[] = [ctx.startTile];

  while (queue.length > 0) {
    const current = queue.pop() as number;
    const x = current % ctx.width;
    const y = (current - x) / ctx.width;

    for (let dir = 0; dir < 4; dir += 1) {
      const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
      const next = ny * ctx.width + nx;
      if (seen.has(next) || !isPassable(ctx, next, carrying)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

/** Barrier kinds standing directly between reachable tiles and unexplored ground. */
export function blockingKinds(
  ctx: WalkContext,
  reachable: ReadonlySet<number>,
  carrying: ReadonlySet<BarrierKind>,
): Set<BarrierKind> {
  const blocking = new Set<BarrierKind>();

  for (const tile of reachable) {
    const x = tile % ctx.width;
    const y = (tile - x) / ctx.width;
    for (let dir = 0; dir < 4; dir += 1) {
      const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
      const next = ny * ctx.width + nx;
      const barrier = ctx.barrierOf[next];
      if (barrier === 0) continue;
      const kind = BARRIER_ORDER[barrier - 1];
      if (!carrying.has(kind)) blocking.add(kind);
    }
  }

  return blocking;
}

export interface ReachabilityResult {
  /** Region ids reachable while carrying the given barrier kinds. */
  regions: Set<number>;
}

/**
 * Region-level view of reachability, derived from the tile walk so it cannot
 * disagree with it. Used for naming and for the ending region, never for
 * deciding where a key may be hidden.
 */
export function reachableRegions(
  ctx: WalkContext,
  regionMap: RegionMap,
  carrying: ReadonlySet<BarrierKind>,
): ReachabilityResult {
  const regions = new Set<number>();
  for (const tile of reachableTiles(ctx, carrying)) {
    const id = regionMap.regionOf[tile];
    if (id >= 0) regions.add(id);
  }
  return { regions };
}

/**
 * Forward fill.
 *
 * Walk outward from the start, and whenever a barrier kind blocks the frontier,
 * place its artifact somewhere already reachable. Because a key is only ever
 * hidden in space the player can already stand in, every world is completable
 * by construction - `fill.test.ts` verifies it over hundreds of seeds, but the
 * verification confirms the design rather than propping it up.
 */
export function placeArtifacts(
  rng: Rng,
  ctx: WalkContext,
  regionMap: RegionMap,
  landmarks: readonly Landmark[],
): Artifact[] {
  const artifacts: Artifact[] = [];
  const carrying = new Set<BarrierKind>();
  const usedLandmarks = new Set<string>();

  for (let tier = 0; tier < BARRIER_ORDER.length; tier += 1) {
    // The exact set of tiles the player can stand on right now.
    const reachable = reachableTiles(ctx, carrying);
    if (reachable.size === 0) break;

    const blocking = blockingKinds(ctx, reachable, carrying);
    if (blocking.size === 0) break;

    // Canonical order, so a seed always yields river then cliff then bramble.
    const kind = BARRIER_ORDER.find((k) => blocking.has(k));
    if (!kind) break;

    // Anchor to a landmark the player can actually walk to. This is the step
    // that makes a world solvable: the search space is exactly the ground
    // already underfoot, so a key is never behind the door it opens.
    const local = landmarks.filter((l) => reachable.has(l.tile));
    const fresh = local.filter((l) => !usedLandmarks.has(l.id));
    const pool = fresh.length > 0 ? fresh : local;

    let anchor: Landmark | undefined = pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : undefined;
    let tile: number;

    if (anchor) {
      const nearby = openTilesNear(ctx, reachable, anchor.tile, ARTIFACT_ANCHOR_RADIUS);
      tile = nearby.length > 0 ? nearby[Math.floor(rng() * nearby.length)] : anchor.tile;
    } else {
      // No landmark inside the pocket we are standing in. Fall back to open
      // reachable ground and re-anchor the hint to the nearest landmark, so the
      // world stays solvable even though the clue is looser.
      const open = [...reachable];
      tile = open[Math.floor(rng() * open.length)];
      anchor = nearestTo(landmarks, tile, ctx.width);
    }

    if (anchor) usedLandmarks.add(anchor.id);
    artifacts.push({
      id: `${kind}-key`,
      name: artifactName(rng, NOUNS[kind]),
      opens: kind,
      tile,
      regionId: regionMap.regionOf[tile],
      tier,
      anchorLandmarkId: anchor?.id ?? "",
    });
    carrying.add(kind);
  }

  return artifacts;
}

function nearestTo(landmarks: readonly Landmark[], tile: number, width: number): Landmark | undefined {
  const x = tile % width;
  const y = (tile - x) / width;
  let best: Landmark | undefined;
  let bestDistance = Infinity;
  for (const landmark of landmarks) {
    const lx = landmark.tile % width;
    const ly = (landmark.tile - lx) / width;
    const distance = Math.hypot(x - lx, y - ly);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = landmark;
    }
  }
  return best;
}

/** Reachable, non-barrier tiles within `radius` of a centre tile. */
export function openTilesNear(
  ctx: WalkContext,
  reachable: ReadonlySet<number>,
  centre: number,
  radius: number,
): number[] {
  const cx = centre % ctx.width;
  const cy = (centre - cx) / ctx.width;
  const out: number[] = [];

  for (let y = Math.max(0, cy - radius); y <= Math.min(ctx.height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(ctx.width - 1, cx + radius); x += 1) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const tile = y * ctx.width + x;
      if (!reachable.has(tile)) continue;
      if (ctx.barrierOf[tile] !== 0) continue;
      out.push(tile);
    }
  }
  return out;
}

/** Open, non-barrier tiles among a reachable set - somewhere an item can lie. */
export function candidateTiles(ctx: WalkContext, reachable: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (const tile of reachable) {
    if (ctx.barrierOf[tile] === 0) out.push(tile);
  }
  return out;
}
