/**
 * Fixed-timestep update.
 *
 * Movement runs at a constant 60Hz regardless of display refresh rate, so
 * walking speed is identical on a 60Hz laptop and a 144Hz monitor. Rendering
 * still happens once per animation frame; only simulation is quantised.
 */

import { distanceBetween } from "../world/landmarks";
import { BARRIER_LABEL } from "../world/gates";
import { readMovement, type InputState } from "./input";
import { TILE_SIZE, canStand, playerTile, tileAt, type GameState } from "./state";

/**
 * Simulation step, in seconds. Movement is quantised to this so walking speed is
 * identical on a 60Hz laptop and a 144Hz monitor. The per-frame catch-up cap
 * lives with the frame loop in `components/game-canvas.tsx`.
 */
export const STEP = 1 / 60;

/** Tiles per second. Brisk enough that crossing a region is not a chore. */
const SPEED_TILES = 4.6;
const SPEED = SPEED_TILES * TILE_SIZE;

/** The player's collision box, in world pixels. Narrower than a tile so
 *  corners are forgiving, and short so it reads as feet rather than a body. */
const BOX_W = 9;
const BOX_H = 7;

/** How close you must be to pick something up or start a conversation. */
const PICKUP_RANGE = 12;
const TALK_RANGE = 20;

/** Radius in tiles revealed around the player. */
const SIGHT = 9;

export interface LoopCallbacks {
  onChange: () => void;
}

export function update(state: GameState, input: InputState, callbacks: LoopCallbacks): void {
  state.elapsed += STEP;

  let changed = false;
  while (input.pending.length > 0) {
    const action = input.pending.shift();
    if (action === "options") {
      state.optionsOpen = !state.optionsOpen;
      changed = true;
    } else if (action === "journal" && !state.optionsOpen) {
      state.journalOpen = !state.journalOpen;
      state.dialog = null;
      changed = true;
    } else if (action === "cancel") {
      if (state.optionsOpen) {
        state.optionsOpen = false;
        changed = true;
      } else if (state.journalOpen || state.dialog) {
        state.journalOpen = false;
        state.dialog = null;
        changed = true;
      }
    } else if (action === "interact" && !state.optionsOpen) {
      changed = interact(state) || changed;
    }
  }

  // Dialogue and the journal hold the world still, as in the games this borrows
  // from - reading should never mean being nudged off a cliff.
  const paused = state.dialog !== null || state.journalOpen || state.optionsOpen;
  if (!paused) {
    changed = stepWorld(state, input) || changed;
  } else {
    state.moving = false;
  }

  if (changed) callbacks.onChange();
}

/** Advance the world by one step. Returns whether React needs to hear about it. */
export function stepWorld(state: GameState, input: InputState): boolean {
  const { dx, dy } = readMovement(input);
  let changed = false;

  state.moving = dx !== 0 || dy !== 0;
  if (state.moving) {
    // Facing follows the dominant axis, so diagonal walking still picks a sprite.
    if (Math.abs(dx) > Math.abs(dy)) state.facing = dx < 0 ? "left" : "right";
    else state.facing = dy < 0 ? "up" : "down";

    state.walkTime += STEP;
    moveAxis(state, dx * SPEED * STEP, 0);
    moveAxis(state, 0, dy * SPEED * STEP);
  }

  changed = reveal(state) || changed;
  changed = tryPickup(state) || changed;
  changed = updateNearbyNpc(state) || changed;
  changed = checkEnding(state) || changed;

  if (state.toast && state.toast.until <= state.elapsed) {
    state.toast = null;
    changed = true;
  }

  return changed;
}

/**
 * Resolve one axis at a time.
 *
 * Moving both axes together and rejecting the whole step on collision makes a
 * player stick to walls while walking diagonally along them; resolving
 * separately lets them slide, which is what every game in this genre does.
 */
function moveAxis(state: GameState, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;

  const nextX = state.x + dx;
  const nextY = state.y + dy;

  if (boxFree(state, nextX, nextY)) {
    state.x = nextX;
    state.y = nextY;
  }
}

/** Every tile the collision box overlaps must be standable. */
function boxFree(state: GameState, cx: number, cy: number): boolean {
  const left = cx - BOX_W / 2;
  const right = cx + BOX_W / 2 - 0.001;
  const top = cy - BOX_H / 2;
  const bottom = cy + BOX_H / 2 - 0.001;

  const x0 = Math.floor(left / TILE_SIZE);
  const x1 = Math.floor(right / TILE_SIZE);
  const y0 = Math.floor(top / TILE_SIZE);
  const y1 = Math.floor(bottom / TILE_SIZE);

  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return false;
      if (!canStand(state, ty * state.world.width + tx)) return false;
    }
  }
  return true;
}

/** Mark tiles around the player as seen, for the explored overlay. */
function reveal(state: GameState): boolean {
  const tile = playerTile(state);
  if (tile < 0) return false;
  const px = tile % state.world.width;
  const py = (tile - px) / state.world.width;

  let revealed = 0;
  for (let y = Math.max(0, py - SIGHT); y <= Math.min(state.world.height - 1, py + SIGHT); y += 1) {
    for (let x = Math.max(0, px - SIGHT); x <= Math.min(state.world.width - 1, px + SIGHT); x += 1) {
      if ((x - px) * (x - px) + (y - py) * (y - py) > SIGHT * SIGHT) continue;
      const index = y * state.world.width + x;
      if (state.visited[index] === 0) {
        state.visited[index] = 1;
        revealed += 1;
      }
    }
  }
  // Only worth telling React when the explored percentage could have moved.
  return revealed > 24;
}

function tryPickup(state: GameState): boolean {
  for (const artifact of state.world.artifacts) {
    if (state.collected.has(artifact.id)) continue;
    const ax = (artifact.tile % state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const ay = Math.floor(artifact.tile / state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    if (Math.hypot(state.x - ax, state.y - ay) > PICKUP_RANGE) continue;

    state.collected.add(artifact.id);
    state.inventory.add(artifact.opens);
    state.toast = {
      text: `${artifact.name} — you can now cross ${BARRIER_LABEL[artifact.opens]}.`,
      until: state.elapsed + 6,
    };
    return true;
  }
  return false;
}

function nearestNpcInRange(state: GameState): (typeof state.world.npcs)[number] | null {
  let nearest: (typeof state.world.npcs)[number] | null = null;
  let nearestDistance = Infinity;
  for (const npc of state.world.npcs) {
    const nx = (npc.tile % state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const ny = Math.floor(npc.tile / state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const distance = Math.hypot(state.x - nx, state.y - ny);
    if (distance < nearestDistance && distance <= TALK_RANGE) {
      nearestDistance = distance;
      nearest = npc;
    }
  }
  return nearest;
}

/** Publish only when the player crosses a conversation-range boundary. */
function updateNearbyNpc(state: GameState): boolean {
  const next = nearestNpcInRange(state)?.id ?? null;
  if (next === state.nearbyNpcId) return false;
  state.nearbyNpcId = next;
  return true;
}

/** Talk to the nearest speaker in range, or advance an open conversation. */
function interact(state: GameState): boolean {
  if (state.journalOpen) {
    state.journalOpen = false;
    return true;
  }

  if (state.dialog) {
    state.dialog.index += 1;
    if (state.dialog.index >= state.dialog.lines.length) state.dialog = null;
    return true;
  }

  const nearest = nearestNpcInRange(state);
  if (!nearest) return false;

  state.dialog = {
    npcId: nearest.id,
    name: nearest.name,
    role: nearest.role,
    lines: nearest.lines,
    index: 0,
  };
  state.talkedTo.add(nearest.id);

  // Record the clue in the journal the first time it is heard.
  if (nearest.hint && !state.knownHints.some((h) => h.id === nearest.hint?.id)) {
    state.knownHints = [...state.knownHints, nearest.hint];
  }

  return true;
}

/** Reaching the ending landmark with everything in hand finishes the game. */
function checkEnding(state: GameState): boolean {
  if (state.won) return false;
  if (state.collected.size < state.world.artifacts.length) return false;

  const ending = state.world.landmarks.find((l) => l.id === state.world.endingLandmarkId);
  if (!ending) return false;

  const tile = playerTile(state);
  if (tile < 0) return false;
  if (distanceBetween(tile, ending.tile, state.world.width) > 2.5) return false;

  state.won = true;
  return true;
}

export { tileAt };
