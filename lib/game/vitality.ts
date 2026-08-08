/**
 * Hit points, and the one thing that spends them: walking.
 *
 * There is no combat in this game and there is not going to be. The ending is a
 * summit and a long view, not a boss, and a health bar that only moves when
 * something bites you would need something to do the biting. So hit points here
 * measure *weariness*: they fall with distance covered, and they come back at a
 * bed or out of a bottle.
 *
 * That choice does a specific job. Before it, the island was free to cross -
 * every tile cost the same nothing, so the only reason to go back the way you
 * came was curiosity. Weariness makes distance a resource, which is what turns a
 * town into somewhere you are glad to see rather than scenery with a door.
 *
 * Nothing here knows about towns, shops or the renderer. It is arithmetic over
 * `GameState`, which is what lets `vitality.test.ts` walk a player a known
 * distance under node and assert the exact number that comes out.
 */

import { TILE_SIZE, type GameState } from "./state";

/**
 * Full health, in points.
 *
 * Twenty rather than a hundred: it is drawn as a row of pips, and twenty pips is
 * the most that reads as a countable quantity at a glance instead of as a bar.
 */
export const MAX_HP = 20;

/**
 * Tiles walked per point of weariness.
 *
 * The island is 224 tiles across, and a full twenty points buys 360 tiles of
 * walking - comfortably more than a region, comfortably less than the map. The
 * intent is that a long expedition into a far region is a thing you plan for and
 * come home from, not that a stroll along the shore is a countdown.
 */
export const TILES_PER_HP = 18;

/** Below this fraction of full health the walk slows. */
export const WEARY_FRACTION = 0.25;

/** How fast a weary player walks, as a fraction of the usual pace. */
export const WEARY_SPEED = 0.62;

/** Whether the player is tired enough to have slowed down. */
export function isWeary(state: GameState): boolean {
  return state.hp <= state.maxHp * WEARY_FRACTION;
}

/** Walking speed multiplier for the state's current health. */
export function paceFor(state: GameState): number {
  return isWeary(state) ? WEARY_SPEED : 1;
}

/**
 * Charge a distance walked, in world pixels, against the player's health.
 *
 * The remainder is carried in `state.walkedSincePoint` rather than rounded away,
 * because the loop calls this sixty times a second with a fraction of a pixel
 * each time. Rounding per call would charge either nothing or everything, and
 * the result would depend on the frame rate - which is exactly what the fixed
 * timestep exists to prevent.
 *
 * Returns whether a point was actually lost, so the loop knows whether React
 * needs to hear about it.
 */
export function applyWeariness(state: GameState, distance: number): boolean {
  if (distance <= 0 || state.hp <= 0) return false;

  state.walkedSincePoint += distance;
  const perPoint = TILES_PER_HP * TILE_SIZE;
  if (state.walkedSincePoint < perPoint) return false;

  const points = Math.floor(state.walkedSincePoint / perPoint);
  state.walkedSincePoint -= points * perPoint;
  state.hp = Math.max(0, state.hp - points);
  return true;
}

/**
 * Restore health, clamped to full. Returns the points actually recovered, which
 * is what lets the inn refuse to charge for a night a rested player does not
 * need.
 */
export function heal(state: GameState, amount: number): number {
  if (amount <= 0) return 0;
  const before = state.hp;
  state.hp = Math.min(state.maxHp, state.hp + amount);
  // A rest also clears the part-walked remainder: waking up should not leave you
  // seventeen tiles into the next point.
  if (state.hp > before) state.walkedSincePoint = 0;
  return state.hp - before;
}
