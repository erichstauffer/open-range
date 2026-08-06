/**
 * Fixed-timestep update.
 *
 * Movement runs at a constant 60Hz regardless of display refresh rate, so
 * walking speed is identical on a 60Hz laptop and a 144Hz monitor. Rendering
 * still happens once per animation frame; only simulation is quantised.
 */

import { distanceBetween } from "../world/landmarks";
import { artifactWhisper } from "../world/landmark-passages";
import { BARRIER_LABEL } from "../world/gates";
import { makeRng } from "../rand";
import { readMovement, type InputState } from "./input";
import type { EmitEvent } from "./events";
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

/** Seconds between blocked-move reports, so a held key is not a machine gun. */
const BUMP_COOLDOWN = 0.6;

export interface LoopCallbacks {
  onChange: () => void;
  /**
   * Discrete things that happened this step. Optional, so the headless tests
   * and any caller that does not care can keep passing `{ onChange }` alone.
   */
  onEvent?: EmitEvent;
}

export function update(state: GameState, input: InputState, callbacks: LoopCallbacks): void {
  state.elapsed += STEP;

  const emit = callbacks.onEvent;
  // Overlay transitions are read as edges by comparing before and after rather
  // than by emitting at each site that can change them. Dialogue alone ends in
  // three different places - advancing past the last line, cancelling, and
  // opening the journal - and an emit at each is three chances to miss one.
  const hadDialog = state.dialog !== null;
  const hadJournal = state.journalOpen;
  const hadOptions = state.optionsOpen;

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
    changed = stepWorld(state, input, emit) || changed;
  } else {
    state.moving = false;
  }

  if (emit) {
    if ((state.dialog !== null) !== hadDialog) emit({ kind: "dialogue", open: state.dialog !== null });
    if (state.journalOpen !== hadJournal) emit({ kind: "journal", open: state.journalOpen });
    if (state.optionsOpen !== hadOptions) emit({ kind: "options", open: state.optionsOpen });
  }

  if (changed) callbacks.onChange();
}

/** Advance the world by one step. Returns whether React needs to hear about it. */
export function stepWorld(state: GameState, input: InputState, emit?: EmitEvent): boolean {
  const { dx, dy } = readMovement(input);
  let changed = false;

  state.moving = dx !== 0 || dy !== 0;
  if (state.moving) {
    // Facing follows the dominant axis, so diagonal walking still picks a sprite.
    if (Math.abs(dx) > Math.abs(dy)) state.facing = dx < 0 ? "left" : "right";
    else state.facing = dy < 0 ? "up" : "down";

    state.walkTime += STEP;
    const wasX = state.x;
    const wasY = state.y;
    moveAxis(state, dx * SPEED * STEP, 0);
    moveAxis(state, 0, dy * SPEED * STEP);

    // Blocked means the player asked to move and did not, at all. Testing the
    // resulting position rather than each axis is what makes that true for
    // walking straight into a cliff as well as diagonally into a corner - and
    // it keeps sliding silent, since a slide still moves you. Sliding is not
    // refusal, and a cue for it would fire the whole way along a scarp.
    if (state.x === wasX && state.y === wasY && state.elapsed - state.lastBumpAt > BUMP_COOLDOWN) {
      state.lastBumpAt = state.elapsed;
      emit?.({ kind: "blocked" });
    }
  }

  changed = reveal(state) || changed;
  changed = tryPickup(state, emit) || changed;
  changed = updateNearbyInteraction(state) || changed;
  changed = updateRegion(state, emit) || changed;
  changed = checkEnding(state, emit) || changed;

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

function tryPickup(state: GameState, emit?: EmitEvent): boolean {
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
    emit?.({ kind: "pickup", artifactId: artifact.id });
    return true;
  }
  return false;
}

/**
 * Which region the player stands in, edge-tracked exactly like
 * `nearbyInteraction` above.
 *
 * The HUD already re-derived this per snapshot, but a snapshot cannot say
 * *when* the boundary was crossed, and adaptive music needs the crossing rather
 * than the current value.
 */
function updateRegion(state: GameState, emit?: EmitEvent): boolean {
  const tile = playerTile(state);
  const next = tile < 0 ? -1 : state.world.regionOf[tile];
  if (next === state.regionId) return false;
  state.regionId = next;
  emit?.({ kind: "region", regionId: next });
  return true;
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

function nearestLandmarkInRange(state: GameState): (typeof state.world.landmarks)[number] | null {
  let nearest: (typeof state.world.landmarks)[number] | null = null;
  let nearestDistance = Infinity;
  for (const landmark of state.world.landmarks) {
    const lx = (landmark.tile % state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const ly = Math.floor(landmark.tile / state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const distance = Math.hypot(state.x - lx, state.y - ly);
    if (distance < nearestDistance && distance <= TALK_RANGE) {
      nearestDistance = distance;
      nearest = landmark;
    }
  }
  return nearest;
}

/** Publish only when the player crosses an interaction-range boundary. */
function updateNearbyInteraction(state: GameState): boolean {
  const npc = nearestNpcInRange(state);
  const landmark = npc ? null : nearestLandmarkInRange(state);
  const next = npc
    ? ({ kind: "npc", id: npc.id, label: npc.name } as const)
    : landmark
      ? ({ kind: "landmark", id: landmark.id, label: landmark.properName } as const)
      : null;
  if (next?.kind === state.nearbyInteraction?.kind && next?.id === state.nearbyInteraction?.id) return false;
  state.nearbyInteraction = next;
  return true;
}

/** Talk, read a landmark, or advance an open passage. */
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

  const npc = nearestNpcInRange(state);
  if (npc) {
    state.dialog = {
      sourceId: npc.id,
      name: npc.name,
      role: npc.role,
      lines: npc.lines,
      index: 0,
    };
    state.talkedTo.add(npc.id);

    // Record the clue in the journal the first time it is heard.
    if (npc.hint && !state.knownHints.some((h) => h.id === npc.hint?.id)) {
      state.knownHints = [...state.knownHints, npc.hint];
    }
    return true;
  }

  const landmark = nearestLandmarkInRange(state);
  if (!landmark) return false;

  const anchored = state.world.artifacts.find(
    (artifact) =>
      artifact.anchorLandmarkId === landmark.id &&
      !state.collected.has(artifact.id) &&
      state.knownHints.some((hint) => hint.artifactId === artifact.id && hint.level === 3),
  );
  const lines = [...landmark.passage];
  if (anchored) {
    lines.push(artifactWhisper(makeRng(state.world.seed, `landmark-whisper:${landmark.id}:${anchored.id}`)));
  }

  state.dialog = {
    sourceId: landmark.id,
    name: landmark.properName,
    role: state.world.regions[landmark.regionId]?.name ?? "old landmark",
    lines,
    index: 0,
  };
  return true;
}

/** Reaching the ending landmark with everything in hand finishes the game. */
function checkEnding(state: GameState, emit?: EmitEvent): boolean {
  if (state.won) return false;
  if (state.collected.size < state.world.artifacts.length) return false;

  const ending = state.world.landmarks.find((l) => l.id === state.world.endingLandmarkId);
  if (!ending) return false;

  const tile = playerTile(state);
  if (tile < 0) return false;
  if (distanceBetween(tile, ending.tile, state.world.width) > 2.5) return false;

  state.won = true;
  emit?.({ kind: "win" });
  return true;
}

export { tileAt };
