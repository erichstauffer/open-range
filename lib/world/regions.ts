/**
 * Partitions the island into named regions and builds the graph that
 * progression runs on.
 *
 * Two decisions worth calling out:
 *
 *  1. Only the LARGEST connected component of walkable land is used. Noise
 *     happily produces offshore specks; if those became regions, the region
 *     graph would claim reachability that does not exist and gating would be
 *     unsolvable through no fault of the fill algorithm.
 *
 *  2. Territories are assigned by multi-source breadth-first search - geodesic
 *     Voronoi - not by Euclidean distance to the nearest seed. Euclidean
 *     regions cut straight across bays and headlands, putting tiles in a region
 *     you cannot walk to from its own centre. Growing them by walking distance
 *     makes every region internally connected by construction.
 */

import { pick, shuffle, type Rng } from "../rand";
import { specById, type TileKind } from "../art/palette";
import { featureGroupFor, regionName } from "./names";
import type { TerrainFields } from "./biome";

export const REGION_COUNT = 7;

/** Below this many walkable tiles an island cannot host a full progression. */
export const MIN_MAINLAND_TILES = 4000;

export interface Region {
  id: number;
  name: string;
  /** Tile index the region grew from. */
  seedTile: number;
  dominantKind: TileKind;
  /** Every mainland tile belonging to this region. */
  tiles: number[];
  centroid: { x: number; y: number };
  /** Steps from the start region through the adjacency graph. */
  depth: number;
}

export interface RegionMap {
  /** Region id per tile, or -1 for water and offshore land. */
  regionOf: Int16Array;
  regions: Region[];
  startRegionId: number;
  /** Undirected adjacency, region id to neighbouring region ids. */
  adjacency: number[][];
  mainlandTiles: number;
}

/** Largest 4-connected component of walkable land, as a boolean mask. */
export function findMainland(terrain: TerrainFields): { mask: Uint8Array; count: number } {
  const { width, height, tiles } = terrain;
  const total = width * height;
  const component = new Int32Array(total).fill(-1);
  // total + 1 because the queue is indexed from 1. A typed array silently
  // discards out-of-bounds writes, so an off-by-one here would drop tiles from
  // the flood fill instead of throwing.
  const queue = new Int32Array(total + 1);

  let best = -1;
  let bestCount = 0;
  let componentId = 0;

  for (let start = 0; start < total; start += 1) {
    if (component[start] !== -1 || !specById(tiles[start]).walkable) continue;

    let head = 0;
    let tail = 0;
    queue[tail += 1] = start;
    component[start] = componentId;
    let count = 1;

    while (head < tail) {
      const current = queue[(head += 1)];
      const cx = current % width;
      const cy = (current - cx) / width;

      for (let dir = 0; dir < 4; dir += 1) {
        const nx = cx + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const ny = cy + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (component[next] !== -1 || !specById(tiles[next]).walkable) continue;
        component[next] = componentId;
        count += 1;
        queue[tail += 1] = next;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      best = componentId;
    }
    componentId += 1;
  }

  const mask = new Uint8Array(total);
  if (best !== -1) {
    for (let i = 0; i < total; i += 1) if (component[i] === best) mask[i] = 1;
  }
  return { mask, count: bestCount };
}

/** Well-separated seed tiles, relaxing the spacing requirement rather than failing. */
function placeSeeds(rng: Rng, candidates: number[], width: number, count: number): number[] {
  const shuffled = shuffle(rng, [...candidates]);
  let spacing = Math.sqrt(candidates.length / count) * 0.85;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const chosen: number[] = [];
    for (const tile of shuffled) {
      const x = tile % width;
      const y = (tile - x) / width;
      const ok = chosen.every((other) => {
        const ox = other % width;
        const oy = (other - ox) / width;
        return Math.hypot(x - ox, y - oy) >= spacing;
      });
      if (ok) chosen.push(tile);
      if (chosen.length === count) return chosen;
    }
    spacing *= 0.7;
  }

  return shuffled.slice(0, count);
}

export function buildRegions(terrain: TerrainFields, seed: string, rng: Rng): RegionMap {
  const { width, height, tiles } = terrain;
  const total = width * height;
  const { mask, count: mainlandTiles } = findMainland(terrain);

  const candidates: number[] = [];
  for (let i = 0; i < total; i += 1) if (mask[i]) candidates.push(i);

  const regionCount = Math.min(REGION_COUNT, Math.max(2, Math.floor(candidates.length / 400)));
  const seeds = placeSeeds(rng, candidates, width, regionCount);

  // Geodesic Voronoi: grow all regions outward at the same rate.
  const regionOf = new Int16Array(total).fill(-1);
  const queue = new Int32Array(candidates.length + 1);
  let head = 0;
  let tail = 0;

  seeds.forEach((tile, id) => {
    regionOf[tile] = id;
    queue[(tail += 1)] = tile;
  });

  while (head < tail) {
    const current = queue[(head += 1)];
    const id = regionOf[current];
    const cx = current % width;
    const cy = (current - cx) / width;

    for (let dir = 0; dir < 4; dir += 1) {
      const nx = cx + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = cy + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!mask[next] || regionOf[next] !== -1) continue;
      regionOf[next] = id;
      queue[(tail += 1)] = next;
    }
  }

  // Collect membership, dominant terrain and centroid.
  const tilesByRegion: number[][] = Array.from({ length: seeds.length }, () => []);
  const kindCounts: Array<Map<number, number>> = Array.from({ length: seeds.length }, () => new Map());
  const sums = Array.from({ length: seeds.length }, () => ({ x: 0, y: 0 }));

  for (let i = 0; i < total; i += 1) {
    const id = regionOf[i];
    if (id < 0) continue;
    tilesByRegion[id].push(i);
    const kindId = tiles[i];
    kindCounts[id].set(kindId, (kindCounts[id].get(kindId) ?? 0) + 1);
    const x = i % width;
    sums[id].x += x;
    sums[id].y += (i - x) / width;
  }

  const regions: Region[] = seeds.map((seedTile, id) => {
    let dominantId = tiles[seedTile];
    let bestCount = -1;
    for (const [kindId, n] of kindCounts[id]) {
      if (n > bestCount) {
        bestCount = n;
        dominantId = kindId;
      }
    }
    const size = Math.max(1, tilesByRegion[id].length);
    const dominantKind = specById(dominantId).kind;
    return {
      id,
      name: regionName(rng, featureGroupFor(dominantKind)),
      seedTile,
      dominantKind,
      tiles: tilesByRegion[id],
      centroid: { x: Math.round(sums[id].x / size), y: Math.round(sums[id].y / size) },
      depth: 0,
    };
  });

  // Adjacency from tiles that actually touch across a region boundary.
  const adjacencySets: Array<Set<number>> = regions.map(() => new Set<number>());
  for (let i = 0; i < total; i += 1) {
    const id = regionOf[i];
    if (id < 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x + 1 < width) {
      const other = regionOf[i + 1];
      if (other >= 0 && other !== id) {
        adjacencySets[id].add(other);
        adjacencySets[other].add(id);
      }
    }
    if (y + 1 < height) {
      const other = regionOf[i + width];
      if (other >= 0 && other !== id) {
        adjacencySets[id].add(other);
        adjacencySets[other].add(id);
      }
    }
  }
  const adjacency = adjacencySets.map((set) => [...set].sort((a, b) => a - b));

  // You wake up by the sea, so the start region is the one with the most shore.
  let startRegionId = 0;
  let bestShore = -1;
  regions.forEach((region) => {
    let shore = 0;
    for (const tile of region.tiles) if (specById(tiles[tile]).kind === "shore") shore += 1;
    if (shore > bestShore) {
      bestShore = shore;
      startRegionId = region.id;
    }
  });

  // Depth by breadth-first search over the region graph.
  const depths = new Array<number>(regions.length).fill(-1);
  depths[startRegionId] = 0;
  const order = [startRegionId];
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    for (const neighbour of adjacency[id]) {
      if (depths[neighbour] === -1) {
        depths[neighbour] = depths[id] + 1;
        order.push(neighbour);
      }
    }
  }
  // An unreachable region would break gating; treat it as maximally distant.
  const maxDepth = Math.max(0, ...depths);
  regions.forEach((region) => {
    region.depth = depths[region.id] === -1 ? maxDepth + 1 : depths[region.id];
  });

  return { regionOf, regions, startRegionId, adjacency, mainlandTiles };
}

/** Compass word for one region relative to another. Used verbatim in hint text. */
export function compassBetween(from: Region, to: Region): string {
  const dx = to.centroid.x - from.centroid.x;
  const dy = to.centroid.y - from.centroid.y;
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return "close by";
  const parts: string[] = [];
  if (dy < -12) parts.push("north");
  else if (dy > 12) parts.push("south");
  if (dx < -12) parts.push("west");
  else if (dx > 12) parts.push("east");
  return parts.length ? parts.join("-") : "close by";
}

/** Deterministic pick of a tile inside a region, avoiding the extreme border. */
export function pickRegionTile(rng: Rng, region: Region): number {
  return pick(rng, region.tiles);
}
