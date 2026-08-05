/**
 * `generateWorld(seed)` - the single pure entry point.
 *
 * Same seed in, byte-identical world out. Everything downstream leans on that:
 * `?seed=` links are shareable, saves store a seed plus a handful of flags
 * instead of a map, and the test suite can assert properties over hundreds of
 * worlds without fixtures.
 *
 * Order matters here and is not arbitrary:
 *
 *   terrain → mainland → regions → gates → landmarks → artifacts → NPCs
 *
 * Landmarks precede artifacts so an artifact can be anchored beside one, which
 * makes the most specific hint true by construction. Artifacts precede NPCs so
 * each speaker can describe a location that already exists.
 */

import { fnv1a, hash2D, makeRng, type Rng } from "../rand";
import { PROP_VARIANTS, PROP_KINDS, SOLID_PROPS, type PropKind } from "../art/sprites";
import { specById, type TileKind } from "../art/palette";
import { generateTerrain, WORLD_HEIGHT, WORLD_WIDTH, type TerrainFields } from "./biome";
import { buildRegions, MIN_MAINLAND_TILES, findMainland, type Region, type RegionMap } from "./regions";
import {
  buildGates,
  placeArtifacts,
  reachableRegions,
  type Artifact,
  type BarrierKind,
  type GateLayout,
  type WalkContext,
} from "./gates";
import { placeLandmarks, type Landmark } from "./landmarks";
import { planHints, type Hint, type Npc } from "../hints/generate";

/** Generator version. Bumping it invalidates saved games, as in Market Jack's ModelVersion. */
export const WORLD_VERSION = 1;

/** How many derived seeds to try before accepting a small island. */
const MAX_SEED_ATTEMPTS = 8;

export interface Prop {
  kind: PropKind;
  variant: number;
  tile: number;
  solid: boolean;
}

export interface World {
  seed: string;
  /** Which derived attempt produced an acceptable island. */
  attempt: number;
  version: number;
  width: number;
  height: number;
  /** Terrain with barrier borders painted in. */
  tiles: Uint8Array;
  /** 0 = passable terrain, otherwise BARRIER_ORDER index + 1. */
  barrierOf: Uint8Array;
  regionOf: Int16Array;
  regions: Region[];
  startRegionId: number;
  adjacency: number[][];
  landmarks: Landmark[];
  artifacts: Artifact[];
  npcs: Npc[];
  hints: Hint[];
  props: Prop[];
  /** Tile the player wakes on. */
  startTile: number;
  /** Region holding the ending summit. */
  endingRegionId: number;
  /** The landmark that ends the game. */
  endingLandmarkId: string;
  /** Content identity, for debugging and save invalidation. */
  hash: string;
}

/** Props by terrain. Trees only grow where trees would grow. */
const PROPS_BY_KIND: Partial<Record<TileKind, ReadonlyArray<{ kind: PropKind; chance: number }>>> = {
  woodland: [
    { kind: "tree", chance: 0.17 },
    { kind: "pine", chance: 0.08 },
    { kind: "bush", chance: 0.05 },
    { kind: "stump", chance: 0.02 },
  ],
  meadow: [
    { kind: "tree", chance: 0.02 },
    { kind: "bush", chance: 0.035 },
  ],
  moor: [
    { kind: "bush", chance: 0.03 },
    { kind: "boulder", chance: 0.015 },
  ],
  highland: [
    { kind: "boulder", chance: 0.05 },
    { kind: "pine", chance: 0.015 },
  ],
  snow: [{ kind: "pine", chance: 0.02 }],
  shore: [{ kind: "boulder", chance: 0.01 }],
};

function placeProps(terrain: TerrainFields, layout: GateLayout, regionMap: RegionMap): Prop[] {
  const props: Prop[] = [];
  const total = terrain.width * terrain.height;

  for (let tile = 0; tile < total; tile += 1) {
    if (regionMap.regionOf[tile] < 0) continue;
    // Never on a barrier: props there would be unreachable clutter, and a solid
    // one could make a border impassable even with the right artifact.
    if (layout.barrierOf[tile] !== 0) continue;

    const kind = specById(layout.tiles[tile]).kind;
    const table = PROPS_BY_KIND[kind];
    if (!table) continue;

    const x = tile % terrain.width;
    const y = (tile - x) / terrain.width;

    let cumulative = 0;
    const sample = hash2D(x, y, 4242);
    for (const entry of table) {
      cumulative += entry.chance;
      if (sample >= cumulative) continue;

      // A solid prop in a one-tile isthmus could wall off part of the island
      // permanently, which no artifact would fix. Only place blocking props on
      // tiles with open ground on at least three sides.
      const solid = SOLID_PROPS.has(entry.kind);
      if (solid && openNeighbours(terrain, layout, regionMap, tile) < 3) break;

      props.push({
        kind: entry.kind,
        variant: Math.floor(hash2D(x, y, 777) * PROP_VARIANTS) % PROP_VARIANTS,
        tile,
        solid,
      });
      break;
    }
  }

  return props;
}

/** Count of 4-neighbours that are open, non-barrier mainland. */
function openNeighbours(terrain: TerrainFields, layout: GateLayout, regionMap: RegionMap, tile: number): number {
  const x = tile % terrain.width;
  const y = (tile - x) / terrain.width;
  let open = 0;

  for (let dir = 0; dir < 4; dir += 1) {
    const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
    const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= terrain.width || ny >= terrain.height) continue;
    const neighbour = ny * terrain.width + nx;
    if (regionMap.regionOf[neighbour] < 0) continue;
    if (layout.barrierOf[neighbour] !== 0) continue;
    if (!specById(layout.tiles[neighbour]).walkable) continue;
    open += 1;
  }

  return open;
}

/** A shore tile in the start region, kept clear of props and barriers. */
function chooseStartTile(
  rng: Rng,
  regionMap: RegionMap,
  layout: GateLayout,
  solidTiles: ReadonlySet<number>,
): number {
  const region = regionMap.regions[regionMap.startRegionId];
  if (!region) return 0;

  const open = region.tiles.filter((tile) => layout.barrierOf[tile] === 0 && !solidTiles.has(tile));
  const shore = open.filter((tile) => specById(layout.tiles[tile]).kind === "shore");
  const pool = shore.length > 0 ? shore : open;
  if (pool.length === 0) return region.tiles[0] ?? 0;
  return pool[Math.floor(rng() * pool.length)];
}

export function generateWorld(seed: string, width = WORLD_WIDTH, height = WORLD_HEIGHT): World {
  // Retry with derived seeds until the island is big enough to host a full
  // progression. Still a pure function of the original seed.
  let terrain = generateTerrain(seed, width, height);
  let attempt = 0;
  while (attempt < MAX_SEED_ATTEMPTS - 1 && findMainland(terrain).count < MIN_MAINLAND_TILES) {
    attempt += 1;
    terrain = generateTerrain(`${seed}#${attempt}`, width, height);
  }

  const rng = makeRng(seed, "layout");
  const regionMap = buildRegions(terrain, seed, rng);
  const layout = buildGates(terrain, regionMap);

  // Props and the start tile come before artifacts, because both affect what is
  // actually walkable and therefore where a key may legally be hidden.
  const props = placeProps(terrain, layout, regionMap);
  const solid = new Set(props.filter((p) => p.solid).map((p) => p.tile));
  const startTile = chooseStartTile(rng, regionMap, layout, solid);

  const ctx: WalkContext = {
    width: terrain.width,
    height: terrain.height,
    tiles: layout.tiles,
    barrierOf: layout.barrierOf,
    solid,
    startTile,
  };

  const landmarks = placeLandmarks(rng, seed, terrain, regionMap, layout);
  const artifacts = placeArtifacts(rng, ctx, regionMap, landmarks);
  const { npcs, hints } = planHints(rng, ctx, regionMap, landmarks, artifacts);

  // The ending sits in the last region the progression opens: the deepest
  // region reachable only once everything is carried.
  const allBarriers = new Set<BarrierKind>(artifacts.map((a) => a.opens));
  const finalReach = reachableRegions(ctx, regionMap, allBarriers).regions;
  const endingRegion =
    [...finalReach]
      .map((id) => regionMap.regions[id])
      .filter((region): region is Region => Boolean(region))
      .sort((a, b) => b.depth - a.depth || b.id - a.id)[0] ?? regionMap.regions[regionMap.startRegionId];

  const endingLandmark =
    landmarks.find((l) => l.regionId === endingRegion.id && l.kind === "summit") ??
    landmarks.find((l) => l.regionId === endingRegion.id) ??
    landmarks[0];

  const world: World = {
    seed,
    attempt,
    version: WORLD_VERSION,
    width,
    height,
    tiles: layout.tiles,
    barrierOf: layout.barrierOf,
    regionOf: regionMap.regionOf,
    regions: regionMap.regions,
    startRegionId: regionMap.startRegionId,
    adjacency: regionMap.adjacency,
    landmarks,
    artifacts,
    npcs,
    hints,
    props,
    startTile,
    endingRegionId: endingRegion.id,
    endingLandmarkId: endingLandmark?.id ?? "",
    hash: "",
  };

  world.hash = fnv1a([
    seed,
    WORLD_VERSION,
    attempt,
    layout.tiles,
    layout.barrierOf,
    startTile,
    artifacts.map((a) => `${a.id}@${a.tile}`).join(","),
    npcs.map((n) => `${n.id}@${n.tile}`).join(","),
  ]);

  return world;
}

/** Convenience for callers that only need the terrain kind at a tile. */
export function kindAt(world: World, tile: number): TileKind {
  return specById(world.tiles[tile]).kind;
}

export { PROP_KINDS };
