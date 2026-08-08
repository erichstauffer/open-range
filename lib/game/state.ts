/**
 * Mutable runtime state.
 *
 * Deliberately a plain object, not React state. The loop mutates this sixty
 * times a second; putting it in `useState` would drive a reconciliation per
 * frame. React only ever sees the small `PublicState` snapshot below, and only
 * when something a human could notice actually changes.
 */

import type { Facing } from "../art/sprites";
import { makeRng, type Rng } from "../rand";
import { BARRIER_ORDER, isPassable, type BarrierKind, type WalkContext } from "../world/gates";
import type { World } from "../world/gen";
import type { Hint } from "../hints/generate";

export const TILE_SIZE = 16;

export type NearbyInteraction =
  | { kind: "robot"; id: string; label: string }
  | { kind: "npc"; id: string; label: string }
  | { kind: "landmark"; id: string; label: string };

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
  /** Coins the robot has handed over. Spends on nothing; it is a record of meeting it. */
  coins: number;
  inventory: Set<BarrierKind>;
  collected: Set<string>;
  knownHints: Hint[];
  talkedTo: Set<string>;
  /** One byte per tile: 1 once seen, for the explored-map overlay. */
  visited: Uint8Array;
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
  hints: Hint[];
  nearbyInteraction: NearbyInteraction | null;
  dialog: DialogState | null;
  journalOpen: boolean;
  optionsOpen: boolean;
  won: boolean;
  toast: string | null;
  exploredPercent: number;
}

export function createGameState(world: World): GameState {
  const solid = new Set(world.props.filter((p) => p.solid).map((p) => p.tile));
  const ctx: WalkContext = {
    width: world.width,
    height: world.height,
    tiles: world.tiles,
    barrierOf: world.barrierOf,
    solid,
    startTile: world.startTile,
  };

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
    inventory: new Set(),
    collected: new Set(),
    knownHints: [],
    talkedTo: new Set(),
    visited: new Uint8Array(world.width * world.height),
    nearbyInteraction: null,
    regionId: -2,
    lastBumpAt: 0,
    dialog: null,
    journalOpen: false,
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
  const held = state.world.artifacts.filter((a) => state.collected.has(a.id));
  let seen = 0;
  for (let i = 0; i < state.visited.length; i += 1) seen += state.visited[i];
  const walkable = state.world.regions.reduce((sum, r) => sum + r.tiles.length, 0) || 1;

  return {
    regionName: currentRegionName(state),
    artifactsHeld: held.map((a) => ({ id: a.id, name: a.name, opens: a.opens })),
    artifactTotal: state.world.artifacts.length,
    coins: state.coins,
    hints: state.knownHints,
    nearbyInteraction: state.nearbyInteraction,
    dialog: state.dialog,
    journalOpen: state.journalOpen,
    optionsOpen: state.optionsOpen,
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
    a.hints.length === b.hints.length &&
    a.nearbyInteraction?.kind === b.nearbyInteraction?.kind &&
    a.nearbyInteraction?.id === b.nearbyInteraction?.id &&
    a.dialog?.sourceId === b.dialog?.sourceId &&
    a.dialog?.index === b.dialog?.index &&
    a.journalOpen === b.journalOpen &&
    a.optionsOpen === b.optionsOpen &&
    a.won === b.won &&
    a.toast === b.toast &&
    a.exploredPercent === b.exploredPercent
  );
}
