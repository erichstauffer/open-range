/**
 * Mutable runtime state.
 *
 * Deliberately a plain object, not React state. The loop mutates this sixty
 * times a second; putting it in `useState` would drive a reconciliation per
 * frame. React only ever sees the small `PublicState` snapshot below, and only
 * when something a human could notice actually changes.
 */

import type { BuildingKind, Facing } from "../art/sprites";
import { makeRng, type Rng } from "../rand";
import { BARRIER_ORDER, isPassable, type BarrierKind, type WalkContext } from "../world/gates";
import type { World } from "../world/gen";
import type { Hint } from "../hints/generate";
import { MAX_HP } from "./vitality";
import type { ShopItem } from "./shop";

export const TILE_SIZE = 16;

export type NearbyInteraction =
  | { kind: "robot"; id: string; label: string }
  | { kind: "npc"; id: string; label: string }
  | { kind: "town"; id: string; label: string }
  | { kind: "building"; id: string; label: string; building: BuildingKind }
  | { kind: "landmark"; id: string; label: string };

/**
 * The island, parked while the player is indoors.
 *
 * A town interior is a `World` like any other, so entering one is a swap of the
 * three fields the loop and the renderer actually read. This is what has to be
 * put back afterwards - and it is the whole of it, which is the point: if
 * leaving a town needed more than this to restore, the interior would not really
 * be a world and something in the engine would be treating it as a special case.
 */
export interface OutdoorAnchor {
  world: World;
  ctx: WalkContext;
  visited: Uint8Array;
  x: number;
  y: number;
  facing: Facing;
}

/**
 * The robot, which is the only thing in the world that walks.
 *
 * Everything else is a tile index: NPCs, landmarks and props never move, so
 * they need no position of their own beyond the one the world generator gave
 * them. The robot has continuous coordinates for the same reason the player
 * does - it is between tiles most of the time.
 */
export interface RobotState {
  /** Position in world pixels, at its feet, exactly like the player's. */
  x: number;
  y: number;
  facing: Facing;
  walkTime: number;
  moving: boolean;
  /** The region it woke in. It never crosses a barrier, so it never leaves. */
  regionId: number;
  /** Where it is currently walking, in world pixels. */
  targetX: number;
  targetY: number;
  /** Elapsed-clock time it will start walking again. */
  pauseUntil: number;
  /** Elapsed-clock time it will have coins again. */
  rechargeAt: number;
  /** How many handfuls it has given, which seeds the next one. */
  giftCount: number;
  /**
   * The wander's own generator, seeded from the world.
   *
   * A live function on an otherwise plain data object, deliberately: it keeps
   * `Math.random` out of the simulation, so a headless test replays the same
   * walk every time, and it is per-state rather than global so two worlds open
   * at once cannot pull from each other's stream. Not saved - where the robot
   * is going next is not worth a byte.
   */
  wander: Rng;
}

/**
 * A counter panel, open in front of a keeper.
 *
 * The store and the inn are the two things in a town that are transactions
 * rather than conversations, and a transaction needs a list you can look at
 * while deciding. Everything else - a prayer, a drinker, a person in the street
 * - goes through `DialogState` instead.
 */
export interface ShopState {
  kind: "store" | "inn";
  /** Whose counter it is, for the panel's heading. */
  name: string;
  role: string;
  /** The result of the last thing tried at this counter. */
  note: string | null;
}

export interface DialogState {
  sourceId: string;
  name: string;
  role: string;
  lines: string[];
  index: number;
}

export interface GameState {
  world: World;
  ctx: WalkContext;
  /** Position in world pixels, at the player's feet. */
  x: number;
  y: number;
  facing: Facing;
  /** Seconds of accumulated walking, for the two-frame step cycle. */
  walkTime: number;
  moving: boolean;
  robot: RobotState;
  /** Coins in hand. The robot gives them; the store takes them. */
  coins: number;
  /**
   * Weariness, in points. Falls with distance walked, recovers at an inn or out
   * of a bottle. See `vitality.ts` for why walking is the only thing that spends
   * it.
   */
  hp: number;
  maxHp: number;
  /** World pixels walked since the last point of weariness was charged. */
  walkedSincePoint: number;
  /** The sword and the shield, each of which you may own exactly one of. */
  items: Set<ShopItem>;
  /** Bottles in the pack. Unlike the keepsakes, these stack and are spent. */
  potions: number;
  /** Armfuls cut from felled trees, and the only thing the store buys. */
  wood: number;
  /**
   * Tiles whose tree has been cut down.
   *
   * Held here rather than written back into `world.props`, because the world is
   * the memoised output of `generateWorld` and is shared by every state built
   * from this seed. Felling is the only thing in the game that changes the
   * island, and this is what keeps that change the player's rather than the
   * world's - the renderer draws a stump where the set says so, and `ctx.solid`
   * (which is per-state) forgets the tile.
   */
  felled: Set<number>;
  /**
   * The open store or inn panel.
   *
   * Held on the state rather than in React so that the loop, which is the thing
   * that pauses the world, is also the thing that knows a panel is open. React
   * finds out through the snapshot like it does about everything else.
   */
  shop: ShopState | null;
  inventory: Set<BarrierKind>;
  collected: Set<string>;
  knownHints: Hint[];
  talkedTo: Set<string>;
  /** One byte per tile: 1 once seen, for the explored-map overlay. */
  visited: Uint8Array;
  /** Id of the town currently being walked through, or null when outdoors. */
  townId: string | null;
  /**
   * The last town entered, which is where a collapse wakes you up.
   *
   * Waking on the start shore is correct only until you have found somewhere
   * better; after that it is a punishment out of all proportion, since the shore
   * may be most of the island away from wherever you fell over.
   */
  lastTownId: string | null;
  /** The island, held while `world` is a town interior. Null when outdoors. */
  outdoor: OutdoorAnchor | null;
  /**
   * How many times each building has been spoken to.
   *
   * A church has several prayers and a pub several drinkers, and cycling rather
   * than re-rolling is what makes coming back a second time worth doing. Not
   * saved: which verse you are up to is not worth a byte, the same call the
   * robot's wander makes about where it was going next.
   */
  voiceTurns: Map<string, number>;
  /** Preferred target currently close enough to act on. */
  nearbyInteraction: NearbyInteraction | null;
  /**
   * Region the player stands in, edge-tracked by the loop. `-1` is the open
   * sea, matching `regionOf`; it starts at `-2`, which is not a value
   * `regionOf` can hold, so the first step always reports a crossing - including
   * after a save drops the player somewhere else entirely.
   */
  regionId: number;
  /** When a blocked move was last reported, so walking into a cliff is not a
   *  continuous noise. */
  lastBumpAt: number;
  dialog: DialogState | null;
  journalOpen: boolean;
  /**
   * The map screen. Never saved: which panel was open is not worth a byte, the
   * same call `voiceTurns` makes about which verse you were up to.
   */
  mapOpen: boolean;
  optionsOpen: boolean;
  won: boolean;
  /** Transient banner, e.g. on picking something up. */
  toast: { text: string; until: number } | null;
  elapsed: number;
}

/** The narrow view React renders from. Compared by value to avoid churn. */
export interface PublicState {
  regionName: string;
  artifactsHeld: Array<{ id: string; name: string; opens: BarrierKind }>;
  artifactTotal: number;
  coins: number;
  hp: number;
  maxHp: number;
  items: ShopItem[];
  potions: number;
  wood: number;
  shop: ShopState | null;
  hints: Hint[];
  nearbyInteraction: NearbyInteraction | null;
  dialog: DialogState | null;
  journalOpen: boolean;
  mapOpen: boolean;
  optionsOpen: boolean;
  /** True while the player is inside a town, which changes what the controls say. */
  inTown: boolean;
  won: boolean;
  toast: string | null;
  exploredPercent: number;
}

/**
 * What may be walked on in a world.
 *
 * Shared by the island and by every town interior, because the swap that puts a
 * player indoors has to produce a context built the same way - a town's walls
 * are closed for the same reason a boulder is, and the collision code should
 * never learn the difference.
 */
export function walkContextFor(world: World, felled?: ReadonlySet<number>): WalkContext {
  const solid = new Set(
    world.props.filter((p) => p.solid && !felled?.has(p.tile)).map((p) => p.tile),
  );
  // Buildings are solid because they are buildings, with no prop standing on
  // them to say so.
  for (const tile of world.solidTiles) solid.add(tile);

  return {
    width: world.width,
    height: world.height,
    tiles: world.tiles,
    barrierOf: world.barrierOf,
    solid,
    startTile: world.startTile,
  };
}

export function createGameState(world: World): GameState {
  const ctx = walkContextFor(world);

  const startX = world.startTile % world.width;
  const startY = (world.startTile - startX) / world.width;

  const robotX = world.robotTile % world.width;
  const robotY = (world.robotTile - robotX) / world.width;
  const robotPixelX = robotX * TILE_SIZE + TILE_SIZE / 2;
  const robotPixelY = robotY * TILE_SIZE + TILE_SIZE / 2;

  return {
    world,
    ctx,
    x: startX * TILE_SIZE + TILE_SIZE / 2,
    y: startY * TILE_SIZE + TILE_SIZE / 2,
    facing: "down",
    walkTime: 0,
    moving: false,
    robot: {
      x: robotPixelX,
      y: robotPixelY,
      facing: "down",
      walkTime: 0,
      moving: false,
      regionId: world.regionOf[world.robotTile],
      targetX: robotPixelX,
      targetY: robotPixelY,
      pauseUntil: 0,
      // It starts charged: the first person to find it is not asked to wait.
      rechargeAt: 0,
      giftCount: 0,
      wander: makeRng(world.seed, "robot-walk"),
    },
    coins: 0,
    hp: MAX_HP,
    maxHp: MAX_HP,
    walkedSincePoint: 0,
    items: new Set(),
    potions: 0,
    wood: 0,
    felled: new Set(),
    shop: null,
    inventory: new Set(),
    collected: new Set(),
    knownHints: [],
    talkedTo: new Set(),
    visited: new Uint8Array(world.width * world.height),
    townId: null,
    lastTownId: null,
    outdoor: null,
    voiceTurns: new Map(),
    nearbyInteraction: null,
    regionId: -2,
    lastBumpAt: 0,
    dialog: null,
    journalOpen: false,
    mapOpen: false,
    optionsOpen: false,
    won: false,
    toast: null,
    elapsed: 0,
  };
}

export function tileAt(state: GameState, x: number, y: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return -1;
  return ty * state.world.width + tx;
}

export function playerTile(state: GameState): number {
  return tileAt(state, state.x, state.y);
}

export function currentRegionName(state: GameState): string {
  const tile = playerTile(state);
  if (tile < 0) return "";
  const id = state.world.regionOf[tile];
  return id >= 0 ? (state.world.regions[id]?.name ?? "") : "the open sea";
}

/** Whether the player may stand on a tile right now, given what they carry. */
export function canStand(state: GameState, tile: number): boolean {
  if (tile < 0) return false;
  return isPassable(state.ctx, tile, state.inventory);
}

/**
 * Whether the robot may stand on a tile.
 *
 * Deliberately not `canStand`: that answers the question for the *player*, and
 * would let the machine walk through a river the moment the player picked up
 * the ford-stone. The robot carries nothing and stays in the region it woke in,
 * which is also what guarantees it can never strand itself somewhere the world
 * generator did not intend it to be.
 */
export function canRobotStand(state: GameState, tile: number): boolean {
  if (tile < 0) return false;
  if (state.world.regionOf[tile] !== state.robot.regionId) return false;
  return isPassable(state.ctx, tile, EMPTY_INVENTORY);
}

const EMPTY_INVENTORY: ReadonlySet<BarrierKind> = new Set();

export function barrierKindAt(state: GameState, tile: number): BarrierKind | null {
  if (tile < 0) return null;
  const barrier = state.world.barrierOf[tile];
  return barrier === 0 ? null : BARRIER_ORDER[barrier - 1];
}

export function snapshot(state: GameState): PublicState {
  // Artifacts and exploration are always read off the ISLAND, never off whatever
  // map is currently under the player's feet. A town interior has no artifacts
  // and every tile of it is visible on arrival, so reading them from `world`
  // while indoors would empty the inventory panel and report the island as
  // fully explored the moment somebody walked through a door.
  const island = state.outdoor ?? state;
  const held = island.world.artifacts.filter((a) => state.collected.has(a.id));
  let seen = 0;
  for (let i = 0; i < island.visited.length; i += 1) seen += island.visited[i];
  const walkable = island.world.regions.reduce((sum, r) => sum + r.tiles.length, 0) || 1;

  return {
    regionName: currentRegionName(state),
    artifactsHeld: held.map((a) => ({ id: a.id, name: a.name, opens: a.opens })),
    artifactTotal: island.world.artifacts.length,
    coins: state.coins,
    hp: state.hp,
    maxHp: state.maxHp,
    items: [...state.items],
    potions: state.potions,
    wood: state.wood,
    shop: state.shop,
    hints: state.knownHints,
    nearbyInteraction: state.nearbyInteraction,
    dialog: state.dialog,
    journalOpen: state.journalOpen,
    mapOpen: state.mapOpen,
    optionsOpen: state.optionsOpen,
    inTown: state.townId !== null,
    won: state.won,
    toast: state.toast && state.toast.until > state.elapsed ? state.toast.text : null,
    exploredPercent: Math.min(100, Math.round((seen / walkable) * 100)),
  };
}

/** Cheap structural comparison, so React re-renders only on real change. */
export function sameSnapshot(a: PublicState, b: PublicState): boolean {
  return (
    a.regionName === b.regionName &&
    a.artifactsHeld.length === b.artifactsHeld.length &&
    a.coins === b.coins &&
    a.hp === b.hp &&
    a.maxHp === b.maxHp &&
    a.items.length === b.items.length &&
    a.potions === b.potions &&
    a.wood === b.wood &&
    a.shop?.kind === b.shop?.kind &&
    a.shop?.note === b.shop?.note &&
    a.hints.length === b.hints.length &&
    a.nearbyInteraction?.kind === b.nearbyInteraction?.kind &&
    a.nearbyInteraction?.id === b.nearbyInteraction?.id &&
    a.dialog?.sourceId === b.dialog?.sourceId &&
    a.dialog?.index === b.dialog?.index &&
    a.journalOpen === b.journalOpen &&
    a.mapOpen === b.mapOpen &&
    a.optionsOpen === b.optionsOpen &&
    a.inTown === b.inTown &&
    a.won === b.won &&
    a.toast === b.toast &&
    a.exploredPercent === b.exploredPercent
  );
}
