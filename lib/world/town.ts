/**
 * Towns, and the small worlds inside them.
 *
 * The idea this file is built on: **a town interior is a `World`.**
 *
 * `lib/game/render.ts` and `lib/game/loop.ts` read only `state.world`,
 * `state.ctx` and `state.visited`. If a town produces something satisfying the
 * same `World` interface - smaller, single-region, no barriers, no artifacts -
 * then walking through a door is a swap of those three fields and nothing else.
 * The renderer, the collision box, the depth sort, the dialogue system and the
 * save format all carry over untouched. The alternative, a second set of
 * drawing and movement code that only runs indoors, is how a project like this
 * ends up with two engines that disagree about what a wall is.
 *
 * Everything here is a pure function of the world seed and the town's own id, on
 * an RNG stream of its own - so adding towns cannot shift the artifacts, the
 * landmarks or the clue chain for a seed somebody has already played, exactly as
 * the robot's stream is kept separate for the same reason.
 */

import { makeRng, pick, shuffle, type Rng } from "../rand";
import { makeCharacterSpec, VISITABLE_BUILDINGS, type BuildingKind } from "../art/sprites";
import { specById, tileId, type TileKind } from "../art/palette";
import { compoundName, inventedName } from "./names";
import {
  INNKEEPER_ROLE,
  PATRON_ROLES,
  PRIEST_ROLE,
  SHOPKEEPER_ROLE,
  TOWNSFOLK_ROLES,
  innkeeperGreeting,
  patronLines,
  priestPrayer,
  storekeeperGreeting,
  streetLines,
} from "./town-voices";
import type { Npc } from "../hints/generate";
import type { Region, RegionMap } from "./regions";
import type { GateLayout } from "./gates";
import type { TerrainFields } from "./biome";
import type { World } from "./gen";

/**
 * The interior, in tiles.
 *
 * Small on purpose. A town is a place you arrive at, do three things in and
 * leave; making it big enough to get lost in would turn the one part of the game
 * with a guaranteed payoff into more searching.
 */
export const TOWN_W = 24;
export const TOWN_H = 18;

/**
 * The width of the band around the edge that puts you back outside.
 *
 * The bound is the exit rather than a wall. "Bounded edges" could have been a
 * fence with a gate in it, but then leaving would need you to find the gate
 * again, and the one thing a player wants after finishing their business in a
 * town is to get on with the walk. Every direction out is out.
 */
export const TOWN_EXIT_MARGIN = 1;

/** Where the player stands on arriving, and where they are put back on leaving. */
const GATE_X = 11;
const GATE_Y = 15;

/** Rows of tiles that are street rather than ground. */
const STREET_ROWS: readonly number[] = [5, 6, 11, 12];
/** Columns of the one road running from the gate to the far end. */
const STREET_COLS: readonly number[] = [11, 12];

/**
 * Top-left tiles of the eight 2x2 plots a building may stand on.
 *
 * Two rows of four, both facing south onto a street, with the crossroads left
 * clear down the middle. Every building faces the same way because the sprite
 * only has one face - a plot on the north side of a street would show a shop its
 * own back, and at this size there is no drawing your way out of that.
 */
const PLOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 2, y: 3 },
  { x: 6, y: 3 },
  { x: 14, y: 3 },
  { x: 18, y: 3 },
  { x: 2, y: 9 },
  { x: 6, y: 9 },
  { x: 14, y: 9 },
  { x: 18, y: 9 },
];

/** How likely each of the four is to be in any given town. */
const BUILDING_CHANCE = 0.62;

/** Houses added after the four, to make the place look inhabited. */
const MIN_HOUSES = 2;
const MAX_HOUSES = 3;

const MIN_STREET_FOLK = 2;
const MAX_STREET_FOLK = 4;

const PUB_PATRONS = 3;
/** Prayers a priest has ready, cycled through on repeat visits. */
const PRAYERS = 3;

/** Somebody who can be spoken to at a building's door. */
export interface TownVoice {
  name: string;
  role: string;
  lines: string[];
}

export interface TownBuilding {
  kind: BuildingKind;
  /** Top-left tile of the 2x2 block it occupies, in interior coordinates. */
  tile: number;
  /**
   * Who is inside.
   *
   * Cycled through rather than picked at random, so a second prayer is a
   * different prayer and a third drinker is a third drinker. Empty for a house,
   * which is scenery.
   */
  voices: TownVoice[];
}

export interface Town {
  id: string;
  name: string;
  /** Region on the island this town belongs to. */
  regionId: number;
  /** Tile on the island where the town stands. */
  tile: number;
  buildings: TownBuilding[];
  /** The interior. A `World`, and walked with exactly the same code. */
  interior: World;
}

/** Interior tile index from interior coordinates. */
export function townTile(x: number, y: number): number {
  return y * TOWN_W + x;
}

/** Where a walker arrives, and is put back when they leave. */
export function townGateTile(): number {
  return townTile(GATE_X, GATE_Y);
}

/** Whether an interior position is out in the exit band. */
export function isTownExit(x: number, y: number): boolean {
  return x < TOWN_EXIT_MARGIN || y < TOWN_EXIT_MARGIN || x >= TOWN_W - TOWN_EXIT_MARGIN || y >= TOWN_H - TOWN_EXIT_MARGIN;
}

/**
 * The point a building is spoken to from: the middle of its frontage, at ground
 * level, one step out into the street.
 *
 * Measured at the door rather than at the plot's centre because the plot's
 * centre is inside a solid block, and a talk range measured from somewhere you
 * cannot stand is a range you have to guess at.
 */
export function buildingDoor(building: TownBuilding, tileSize: number): { x: number; y: number } {
  const bx = building.tile % TOWN_W;
  const by = (building.tile - bx) / TOWN_W;
  return { x: (bx + 1) * tileSize, y: (by + 2) * tileSize };
}

/** Every tile a building's block covers. Solid, all four of them. */
export function buildingTiles(building: TownBuilding): number[] {
  const bx = building.tile % TOWN_W;
  const by = (building.tile - bx) / TOWN_W;
  return [townTile(bx, by), townTile(bx + 1, by), townTile(bx, by + 1), townTile(bx + 1, by + 1)];
}

/** Which of the four a town has. Always at least one, or it is not a town. */
function chooseBuildings(rng: Rng): BuildingKind[] {
  const chosen = VISITABLE_BUILDINGS.filter(() => rng() < BUILDING_CHANCE);
  if (chosen.length > 0) return [...chosen];
  return [pick(rng, VISITABLE_BUILDINGS)];
}

function makeVoices(rng: Rng, kind: BuildingKind, context: { townName: string; regionName: string }): TownVoice[] {
  switch (kind) {
    case "store":
      return [{ name: inventedName(rng), role: SHOPKEEPER_ROLE, lines: [storekeeperGreeting(rng)] }];
    case "inn":
      return [{ name: inventedName(rng), role: INNKEEPER_ROLE, lines: [innkeeperGreeting(rng)] }];
    case "church": {
      // One priest, several prayers. The name is rolled once so it is the same
      // person every time you come back, which is the whole difference between a
      // priest and a prayer dispenser.
      const name = inventedName(rng);
      return Array.from({ length: PRAYERS }, () => ({ name, role: PRIEST_ROLE, lines: priestPrayer(rng, context) }));
    }
    case "pub":
      return Array.from({ length: PUB_PATRONS }, () => ({
        name: inventedName(rng),
        role: pick(rng, PATRON_ROLES),
        lines: patronLines(rng),
      }));
    case "house":
      return [];
  }
}

/**
 * Build one town's interior.
 *
 * The ground is the region's own terrain, so a town in the snow is a town in the
 * snow, and the streets are laid in sand - the one walkable kind light enough to
 * read as a road against every other.
 */
function buildInterior(
  seed: string,
  version: number,
  town: Omit<Town, "interior">,
  ground: TileKind,
  regionName: string,
): World {
  const rng = makeRng(seed, `town-interior:${town.id}`);
  const total = TOWN_W * TOWN_H;

  const groundId = tileId(ground);
  const roadId = tileId("shore");

  const tiles = new Uint8Array(total).fill(groundId);
  for (const y of STREET_ROWS) {
    for (let x = TOWN_EXIT_MARGIN; x < TOWN_W - TOWN_EXIT_MARGIN; x += 1) tiles[townTile(x, y)] = roadId;
  }
  for (const x of STREET_COLS) {
    for (let y = TOWN_EXIT_MARGIN; y < TOWN_H - TOWN_EXIT_MARGIN; y += 1) tiles[townTile(x, y)] = roadId;
  }

  const solidTiles: number[] = [];
  for (const building of town.buildings) solidTiles.push(...buildingTiles(building));
  const solid = new Set(solidTiles);

  // Somewhere a person may stand: on the street, clear of the buildings, clear
  // of the exit band, and not on the tile the player materialises on.
  const gate = townGateTile();
  const standing: number[] = [];
  for (let y = TOWN_EXIT_MARGIN + 1; y < TOWN_H - TOWN_EXIT_MARGIN - 1; y += 1) {
    for (let x = TOWN_EXIT_MARGIN + 1; x < TOWN_W - TOWN_EXIT_MARGIN - 1; x += 1) {
      const tile = townTile(x, y);
      if (solid.has(tile) || tile === gate) continue;
      if (!STREET_ROWS.includes(y) && !STREET_COLS.includes(x)) continue;
      standing.push(tile);
    }
  }

  const folkCount = MIN_STREET_FOLK + Math.floor(rng() * (MAX_STREET_FOLK - MIN_STREET_FOLK + 1));
  const spots = shuffle(rng, standing).slice(0, folkCount);
  const npcs: Npc[] = spots.map((tile, i) => ({
    id: `${town.id}-folk-${i}`,
    name: inventedName(rng),
    role: pick(rng, TOWNSFOLK_ROLES),
    regionId: 0,
    tile,
    spec: makeCharacterSpec(rng),
    lines: streetLines(rng, { townName: town.name, regionName }),
  }));

  const region: Region = {
    id: 0,
    name: town.name,
    seedTile: gate,
    dominantKind: ground,
    tiles: Array.from({ length: total }, (_, i) => i),
    centroid: { x: Math.floor(TOWN_W / 2), y: Math.floor(TOWN_H / 2) },
    depth: 0,
  };

  return {
    seed: `${seed}:${town.id}`,
    attempt: 0,
    version,
    width: TOWN_W,
    height: TOWN_H,
    tiles,
    barrierOf: new Uint8Array(total),
    regionOf: new Int16Array(total),
    regions: [region],
    startRegionId: 0,
    adjacency: [[]],
    landmarks: [],
    artifacts: [],
    npcs,
    hints: [],
    props: [],
    startTile: gate,
    robotTile: gate,
    endingRegionId: 0,
    endingLandmarkId: "",
    // Towns are leaves: an interior holds no towns of its own, which is what
    // keeps `World` from being a recursive structure nothing could hash.
    towns: [],
    buildings: town.buildings,
    solidTiles,
    hash: "",
  };
}

/**
 * One town per region, placed at random inside it.
 *
 * Per region rather than per terrain kind, because a region is what the game
 * actually names and what the player experiences as a place - "the Grey Fen" has
 * a town in it, and a second fen somewhere else is a different fen with its own.
 * It also guarantees the property that matters: wherever you are, there is a bed
 * within one region of you.
 */
export function placeTowns(
  seed: string,
  version: number,
  terrain: TerrainFields,
  regionMap: RegionMap,
  layout: GateLayout,
  isRoomy: (tile: number) => boolean,
  taken: ReadonlySet<number>,
): Town[] {
  const towns: Town[] = [];

  for (const region of regionMap.regions) {
    const rng = makeRng(seed, `town:${region.id}`);

    const open = region.tiles.filter(
      (tile) => layout.barrierOf[tile] === 0 && !taken.has(tile) && specById(layout.tiles[tile]).walkable,
    );
    const roomy = open.filter(isRoomy);
    const pool = roomy.length > 0 ? roomy : open;
    if (pool.length === 0) continue;

    const tile = pool[Math.floor(rng() * pool.length)];
    const id = `town-${region.id}`;
    const name = compoundName(rng);

    const kinds = chooseBuildings(rng);
    const houses = MIN_HOUSES + Math.floor(rng() * (MAX_HOUSES - MIN_HOUSES + 1));
    const wanted: BuildingKind[] = [...kinds, ...Array.from({ length: houses }, (): BuildingKind => "house")];

    const plots = shuffle(rng, [...PLOTS]);
    const buildings: TownBuilding[] = wanted.slice(0, plots.length).map((kind, i) => ({
      kind,
      tile: townTile(plots[i].x, plots[i].y),
      voices: makeVoices(rng, kind, { townName: name, regionName: region.name }),
    }));

    const shell: Omit<Town, "interior"> = { id, name, regionId: region.id, tile, buildings };
    const ground = specById(terrain.tiles[tile]).kind;
    towns.push({ ...shell, interior: buildInterior(seed, version, shell, ground, region.name) });
  }

  return towns;
}

/**
 * Which building a town has, if any.
 *
 * A town with no store is a real possibility - the brief asked for "one or all
 * or some" - so every caller has to cope with the answer being nothing.
 */
export function buildingOf(town: Town, kind: BuildingKind): TownBuilding | undefined {
  return town.buildings.find((building) => building.kind === kind);
}
