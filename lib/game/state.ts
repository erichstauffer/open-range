/**
 * Mutable runtime state.
 *
 * Deliberately a plain object, not React state. The loop mutates this sixty
 * times a second; putting it in `useState` would drive a reconciliation per
 * frame. React only ever sees the small `PublicState` snapshot below, and only
 * when something a human could notice actually changes.
 */

import type { Facing } from "../art/sprites";
import { BARRIER_ORDER, isPassable, type BarrierKind, type WalkContext } from "../world/gates";
import type { World } from "../world/gen";
import type { Hint } from "../hints/generate";

export const TILE_SIZE = 16;

export interface DialogState {
  npcId: string;
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
  inventory: Set<BarrierKind>;
  collected: Set<string>;
  knownHints: Hint[];
  talkedTo: Set<string>;
  /** One byte per tile: 1 once seen, for the explored-map overlay. */
  visited: Uint8Array;
  /** Speaker currently close enough to talk to, maintained by the game loop. */
  nearbyNpcId: string | null;
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
  hints: Hint[];
  nearbyNpc: { id: string; name: string } | null;
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

  return {
    world,
    ctx,
    x: startX * TILE_SIZE + TILE_SIZE / 2,
    y: startY * TILE_SIZE + TILE_SIZE / 2,
    facing: "down",
    walkTime: 0,
    moving: false,
    inventory: new Set(),
    collected: new Set(),
    knownHints: [],
    talkedTo: new Set(),
    visited: new Uint8Array(world.width * world.height),
    nearbyNpcId: null,
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

export function barrierKindAt(state: GameState, tile: number): BarrierKind | null {
  if (tile < 0) return null;
  const barrier = state.world.barrierOf[tile];
  return barrier === 0 ? null : BARRIER_ORDER[barrier - 1];
}

export function snapshot(state: GameState): PublicState {
  const held = state.world.artifacts.filter((a) => state.collected.has(a.id));
  const nearbyNpc = state.nearbyNpcId ? state.world.npcs.find((npc) => npc.id === state.nearbyNpcId) : null;
  let seen = 0;
  for (let i = 0; i < state.visited.length; i += 1) seen += state.visited[i];
  const walkable = state.world.regions.reduce((sum, r) => sum + r.tiles.length, 0) || 1;

  return {
    regionName: currentRegionName(state),
    artifactsHeld: held.map((a) => ({ id: a.id, name: a.name, opens: a.opens })),
    artifactTotal: state.world.artifacts.length,
    hints: state.knownHints,
    nearbyNpc: nearbyNpc ? { id: nearbyNpc.id, name: nearbyNpc.name } : null,
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
    a.hints.length === b.hints.length &&
    a.nearbyNpc?.id === b.nearbyNpc?.id &&
    a.dialog?.npcId === b.dialog?.npcId &&
    a.dialog?.index === b.dialog?.index &&
    a.journalOpen === b.journalOpen &&
    a.optionsOpen === b.optionsOpen &&
    a.won === b.won &&
    a.toast === b.toast &&
    a.exploredPercent === b.exploredPercent
  );
}
