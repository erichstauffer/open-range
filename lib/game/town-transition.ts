/**
 * Going in and coming out.
 *
 * The whole of the "town view" is here, and it is three field assignments. A
 * town interior is a `World` (see `lib/world/town.ts` for why), so entering one
 * means pointing `state.world`, `state.ctx` and `state.visited` at it, and
 * leaving means pointing them back. The renderer, the collision box, the depth
 * sort, the dialogue system and the camera do not find out that anything
 * happened.
 *
 * Two things are deliberately NOT swapped. Everything the player is - health,
 * coins, wood, what they carry, what they have been told - lives directly on
 * `GameState` and simply carries across, because it belongs to the person rather
 * than to the map. And `state.robot` stays where it was: the machine walks the
 * island, and the loop stops stepping it while you are indoors rather than
 * having it mill about a street it cannot be in.
 */

import { isTownExit, TOWN_H, TOWN_W, townGateTile, type Town } from "../world/town";
import { TILE_SIZE, walkContextFor, type GameState } from "./state";

/** Nudge inward from the gate tile, so arriving does not immediately re-trigger the exit. */
const ARRIVE_OFFSET = TILE_SIZE / 2;

/**
 * Walk into a town.
 *
 * Returns false if the id names no town, which is the case a save restored
 * against a regenerated world has to survive.
 */
export function enterTown(state: GameState, town: Town): void {
  if (state.townId !== null) return;

  state.outdoor = {
    world: state.world,
    ctx: state.ctx,
    visited: state.visited,
    x: state.x,
    y: state.y,
    facing: state.facing,
  };

  const interior = town.interior;
  state.world = interior;
  state.ctx = walkContextFor(interior);
  // A town has no fog. Every roof in it is visible from the gate, and veiling
  // the far end of one street would be pretending at a discovery that is not
  // there. Marking it wholly seen also keeps the fog pass a no-op indoors
  // instead of needing a branch.
  state.visited = new Uint8Array(TOWN_W * TOWN_H).fill(1);
  state.townId = town.id;
  state.lastTownId = town.id;
  // Reset to the sentinel `regionOf` can never hold, so stepping back outside
  // always reports a region crossing and the island's theme comes back.
  state.regionId = -2;

  const gate = townGateTile();
  const gx = gate % TOWN_W;
  const gy = (gate - gx) / TOWN_W;
  state.x = gx * TILE_SIZE + ARRIVE_OFFSET;
  state.y = gy * TILE_SIZE + ARRIVE_OFFSET;
  // Facing up: you have come in off the road and the town is in front of you.
  state.facing = "up";
  state.moving = false;
  state.nearbyInteraction = null;
  state.dialog = null;
}

/**
 * Leave, landing exactly where you were standing when you went in.
 *
 * Exactly, not approximately. The town's gate is one tile on the island, and
 * putting the player back on that tile rather than on the spot they left from
 * would shunt them a few pixels every visit - which over a dozen visits walks
 * them somewhere they never chose to be.
 */
export function exitTown(state: GameState): void {
  const outdoor = state.outdoor;
  if (!outdoor) return;

  state.world = outdoor.world;
  state.ctx = outdoor.ctx;
  state.visited = outdoor.visited;
  state.x = outdoor.x;
  state.y = outdoor.y;
  state.facing = outdoor.facing;
  state.townId = null;
  state.outdoor = null;
  state.moving = false;
  state.nearbyInteraction = null;
  state.dialog = null;
}

/**
 * Whether the player has walked off the edge of the town they are in.
 *
 * The bound is the exit rather than a wall, so there is nothing to collide with
 * and nothing to find: any direction far enough is out. Measured on the tile
 * under the feet, which is the same thing every other "where am I" test in the
 * loop uses.
 */
export function atTownEdge(state: GameState): boolean {
  if (state.townId === null) return false;
  const tx = Math.floor(state.x / TILE_SIZE);
  const ty = Math.floor(state.y / TILE_SIZE);
  return isTownExit(tx, ty);
}

/** The town the player is inside, if any. */
export function currentTown(state: GameState): Town | null {
  if (state.townId === null || !state.outdoor) return null;
  return state.outdoor.world.towns.find((town) => town.id === state.townId) ?? null;
}
