/**
 * The island map, as data.
 *
 * Everything a map screen needs and nothing a map screen draws: this module
 * turns game state into a flat pixel buffer and a handful of marker positions,
 * and the component that owns a canvas decides how big to paint them. Keeping
 * it that way is what lets the map be tested at all - `vitest` runs headless in
 * node, where there is no canvas and no `document`.
 *
 * One rule runs through the whole file: the map is always the ISLAND. A town
 * interior is a `World` like any other and the player may be standing in one,
 * but nobody opens a map to be shown the twenty-four tiles of street they are
 * already looking at.
 */

import { RAMPS, specById, UI, type TileKind } from "../art/palette";
import type { World } from "../world/gen";
import { TILE_SIZE, type GameState } from "./state";

/**
 * How much of a region must have been seen before its name is printed.
 *
 * Low, because the point of the label is orientation rather than reward - but
 * not zero, or a coastline glimpsed across a bay would name a region the player
 * has never set foot in, and the name would then be the only thing they know
 * about it.
 */
export const REGION_LABEL_FRACTION = 0.12;

export interface MapPoint {
  /** Tile coordinates, fractional for things that stand between tiles. */
  x: number;
  y: number;
}

export interface MapView {
  world: World;
  visited: Uint8Array;
  /** The player, in world pixels on the island - the gate they came in by, when indoors. */
  playerX: number;
  playerY: number;
  /** True while the player is somewhere the map cannot show them standing. */
  indoors: boolean;
}

/**
 * The island, whether or not the player is currently standing on it.
 *
 * The same `state.outdoor ?? state` that `snapshot()` reads exploration from.
 * Indoors, the player's position comes off the anchor, which is where they were
 * when they walked through the gate - so the marker sits on the town they are
 * inside, which is the truthful answer to "where am I".
 */
export function mapView(state: GameState): MapView {
  const island = state.outdoor ?? state;
  return {
    world: island.world,
    visited: island.visited,
    playerX: island.x,
    playerY: island.y,
    indoors: state.outdoor !== null,
  };
}

/** `#rrggbb` to a packed [r, g, b], once per colour rather than once per tile. */
function toRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * One colour per biome, and a second for the same biome behind a barrier.
 *
 * Stop 2 is the mid of each ramp, which is the closest single swatch to what a
 * whole tile of that terrain looks like on screen; stop 3 lifts barrier tiles
 * enough that a river or a scarp reads as a line across the map rather than
 * dissolving into the ground it cuts through. The headless world preview in
 * `scripts/render-world-preview.ts` picks its colours the same way.
 */
const GROUND: Record<TileKind, readonly [number, number, number]> = {} as Record<
  TileKind,
  readonly [number, number, number]
>;
const BARRIER: Record<TileKind, readonly [number, number, number]> = {} as Record<
  TileKind,
  readonly [number, number, number]
>;
for (const kind of Object.keys(RAMPS) as TileKind[]) {
  GROUND[kind] = toRgb(RAMPS[kind][2]);
  BARRIER[kind] = toRgb(RAMPS[kind][3]);
}

const NIGHT = toRgb(UI.night);

/**
 * The map as RGBA, one pixel per tile, row-major.
 *
 * Unexplored ground is painted the panel's own background rather than a veil
 * over the terrain. Fog in the world is a dimming, because you can still make
 * out a coastline to steer by; on a map it has to be absence, or the map would
 * quietly tell you what is over the next ridge.
 */
export function paintMap(view: MapView): Uint8ClampedArray<ArrayBuffer> {
  const { world, visited } = view;
  const total = world.width * world.height;
  // Explicitly over an `ArrayBuffer` rather than the default `ArrayBufferLike`,
  // so the result can be handed straight to `ImageData`, which will not accept
  // a buffer that might be shared.
  const pixels = new Uint8ClampedArray(new ArrayBuffer(total * 4));

  for (let i = 0; i < total; i += 1) {
    const at = i * 4;
    const rgb = visited[i] === 0 ? NIGHT : colourAt(world, i);
    pixels[at] = rgb[0];
    pixels[at + 1] = rgb[1];
    pixels[at + 2] = rgb[2];
    pixels[at + 3] = 255;
  }

  return pixels;
}

function colourAt(world: World, tile: number): readonly [number, number, number] {
  const kind = specById(world.tiles[tile]).kind;
  return world.barrierOf[tile] === 0 ? GROUND[kind] : BARRIER[kind];
}

export interface TownMarker extends MapPoint {
  id: string;
  name: string;
}

export interface RegionMarker extends MapPoint {
  id: number;
  name: string;
}

export interface MapMarkers {
  player: MapPoint;
  /**
   * The robot, drawn wherever it is - including over ground the player has
   * never walked.
   *
   * The one thing on the map exempt from fog, and deliberately: Rivet is the
   * only inhabitant that moves, and a machine you have met but cannot find
   * again is worse than one you never met. Fog hides ground, not company.
   */
  robot: MapPoint;
  /** Settlements whose tile has been revealed. */
  towns: TownMarker[];
  /** Region names, for the expanded map only. Empty unless asked for. */
  regions: RegionMarker[];
}

function tilePoint(world: World, tile: number): MapPoint {
  const x = tile % world.width;
  return { x: x + 0.5, y: (tile - x) / world.width + 0.5 };
}

export function mapMarkers(state: GameState, options: { regions?: boolean } = {}): MapMarkers {
  const view = mapView(state);
  const { world, visited } = view;

  // The robot walks the island, so its coordinates only mean anything against
  // the island's own world. While indoors they are still the last island
  // position it held, which is exactly what should be drawn.
  const robot: MapPoint = { x: state.robot.x / TILE_SIZE, y: state.robot.y / TILE_SIZE };

  const towns = world.towns
    .filter((town) => visited[town.tile] === 1)
    .map((town) => ({ id: town.id, name: town.name, ...tilePoint(world, town.tile) }));

  const regions = options.regions ? namedRegions(view) : [];

  return {
    player: { x: view.playerX / TILE_SIZE, y: view.playerY / TILE_SIZE },
    robot,
    towns,
    regions,
  };
}

/** Regions explored enough to be worth naming, placed at their centroids. */
function namedRegions(view: MapView): RegionMarker[] {
  const out: RegionMarker[] = [];
  for (const region of view.world.regions) {
    if (region.tiles.length === 0) continue;
    let seen = 0;
    for (const tile of region.tiles) seen += view.visited[tile];
    if (seen / region.tiles.length < REGION_LABEL_FRACTION) continue;
    out.push({ id: region.id, name: region.name, x: region.centroid.x, y: region.centroid.y });
  }
  return out;
}

/** The town the player is currently inside, for the map's "you are indoors" line. */
export function currentTownName(state: GameState): string | null {
  if (state.townId === null) return null;
  const island = state.outdoor?.world ?? state.world;
  return island.towns.find((town) => town.id === state.townId)?.name ?? null;
}
