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
import { BUILDING_LABELS } from "../art/sprites";
import { buildingDoor, type TownBuilding } from "../world/town";
import { atTownEdge, enterTown, exitTown } from "./town-transition";
import { makeRng } from "../rand";
import { readMovement, type GameCommand, type InputState } from "./input";
import { WOOD_PER_TREE, buy, drinkPotion, restAtInn, sell, sellWood, type ShopResult } from "./shop";
import type { EmitEvent } from "./events";
import { ROBOT_ID, ROBOT_NAME, ROBOT_RECHARGE, ROBOT_ROLE, robotSpeech } from "../world/robot";
import { TILE_SIZE, canRobotStand, canStand, playerTile, tileAt, walkContextFor, type GameState } from "./state";
import { applyWeariness, heal, paceFor } from "./vitality";

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
/**
 * How close you must be to a town's tile to walk into it.
 *
 * Wider than `TALK_RANGE`, because a town is drawn as a huddle of buildings
 * spread over several tiles rather than as one object standing on one. The gate
 * should be wherever the buildings are.
 */
const TOWN_RANGE = 34;
/** How close you must stand to a tree to swing at it. */
const FELL_RANGE = 22;

/** Radius in tiles revealed around the player. */
const SIGHT = 9;

/**
 * The robot's walk.
 *
 * Slower than the player on purpose: whatever it is doing, you can always
 * catch up with it.
 */
const ROBOT_SPEED = 2.0 * TILE_SIZE;
/** How far it will set off for at once, in tiles. */
const ROBOT_WANDER_TILES = 6;
/** Close enough to count as arrived, in world pixels. */
const ROBOT_ARRIVE = 2;
const ROBOT_PAUSE_MIN = 0.5;
const ROBOT_PAUSE_MAX = 2;
/** Rolls before it gives up on finding anywhere to go this time. */
const ROBOT_TARGET_ATTEMPTS = 12;

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
      } else if (state.shop) {
        state.shop = null;
        changed = true;
      } else if (state.journalOpen || state.dialog) {
        state.journalOpen = false;
        state.dialog = null;
        changed = true;
      }
    } else if (action === "interact" && !state.optionsOpen && !state.shop) {
      // A counter is not a conversation and has no "next line" to advance to.
      // Without this guard, pressing space at an open store would run `interact`
      // against the door the player is still standing at and re-open the panel,
      // resetting the note that just told them what the shop said.
      changed = interact(state, emit) || changed;
    }
  }

  while (input.commands.length > 0) {
    const command = input.commands.shift();
    if (command) changed = runCommand(state, command, emit) || changed;
  }

  // Dialogue, the journal and a shop counter hold the world still, as in the
  // games this borrows from - reading should never mean being nudged off a
  // cliff.
  const paused =
    state.dialog !== null || state.journalOpen || state.optionsOpen || state.shop !== null;
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
    const speed = SPEED * paceFor(state);
    moveAxis(state, dx * speed * STEP, 0);
    moveAxis(state, 0, dy * speed * STEP);

    // Weariness is charged on ground actually covered, not on the key being
    // held. Walking into a cliff is not a journey, and charging for it would
    // make a corner you are stuck on quietly expensive.
    changed = applyWeariness(state, Math.hypot(state.x - wasX, state.y - wasY)) || changed;

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

  // The robot walks the island and only the island. Stepping it while the
  // player is indoors would run `canRobotStand` against the town's `regionOf`,
  // where its region id does not exist and every tile is therefore refused.
  if (state.townId === null) stepRobot(state);

  changed = checkTownEdge(state, emit) || changed;
  changed = checkCollapse(state, emit) || changed;
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
  return boxFreeFor(state, cx, cy, canStand);
}

/**
 * The same test, parameterised by who is asking.
 *
 * The player's answer depends on what they are carrying; the robot's does not.
 * Sharing the box arithmetic rather than the predicate is what keeps the two
 * from drifting - a corner that is forgiving for the player is forgiving for
 * the machine.
 */
function boxFreeFor(
  state: GameState,
  cx: number,
  cy: number,
  allow: (state: GameState, tile: number) => boolean,
): boolean {
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
      if (!allow(state, ty * state.world.width + tx)) return false;
    }
  }
  return true;
}

/**
 * Walk the robot.
 *
 * A deliberately small brain: pick somewhere nearby, walk to it, stand for a
 * moment, pick somewhere else. It has no interest in the player and does not
 * flee, follow or path-find - it is a machine going about its own business,
 * which is what makes coming across it feel like finding something rather than
 * being met by a quest marker.
 *
 * It never needs a "stop while talking" guard: `stepWorld` is not called at all
 * while a dialogue, the journal or the settings panel is open.
 */
function stepRobot(state: GameState): void {
  const robot = state.robot;
  if (state.elapsed < robot.pauseUntil) {
    robot.moving = false;
    return;
  }

  const dx = robot.targetX - robot.x;
  const dy = robot.targetY - robot.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= ROBOT_ARRIVE) {
    robot.moving = false;
    restRobot(state);
    return;
  }

  // Facing follows the dominant axis, exactly as the player's does.
  if (Math.abs(dx) > Math.abs(dy)) robot.facing = dx < 0 ? "left" : "right";
  else robot.facing = dy < 0 ? "up" : "down";

  const stride = Math.min(ROBOT_SPEED * STEP, distance);
  const nextX = robot.x + (dx / distance) * stride;
  const nextY = robot.y + (dy / distance) * stride;

  let moved = false;
  if (boxFreeFor(state, nextX, robot.y, canRobotStand)) {
    robot.x = nextX;
    moved = true;
  }
  if (boxFreeFor(state, robot.x, nextY, canRobotStand)) {
    robot.y = nextY;
    moved = true;
  }

  robot.moving = moved;
  if (moved) robot.walkTime += STEP;
  // Walked into something. Standing still and retrying the same target every
  // frame would leave it grinding against a boulder forever.
  else restRobot(state);
}

/** Stand for a beat, then set off somewhere new. */
function restRobot(state: GameState): void {
  const robot = state.robot;
  robot.pauseUntil = state.elapsed + ROBOT_PAUSE_MIN + robot.wander() * (ROBOT_PAUSE_MAX - ROBOT_PAUSE_MIN);

  for (let attempt = 0; attempt < ROBOT_TARGET_ATTEMPTS; attempt += 1) {
    const angle = robot.wander() * Math.PI * 2;
    const reach = (1 + robot.wander() * (ROBOT_WANDER_TILES - 1)) * TILE_SIZE;
    const x = robot.x + Math.cos(angle) * reach;
    const y = robot.y + Math.sin(angle) * reach;
    if (!boxFreeFor(state, x, y, canRobotStand)) continue;
    robot.targetX = x;
    robot.targetY = y;
    return;
  }

  // Boxed in on every roll: stay put and try again after the pause.
  robot.targetX = robot.x;
  robot.targetY = robot.y;
}

/** Walking off the edge of a town puts you back on the island where you left it. */
function checkTownEdge(state: GameState, emit?: EmitEvent): boolean {
  if (!atTownEdge(state)) return false;
  exitTown(state);
  emit?.({ kind: "town", townId: null });
  return true;
}

/**
 * Running out of health.
 *
 * Deliberately not death. Nothing in this world can kill you, and a game-over
 * screen would be a punishment for the single activity the game is entirely
 * about. You sit down where you are and wake up somewhere sheltered, rested,
 * having lost the walk back and nothing else - no coins, no artifacts, no
 * clues. The cost of weariness is distance, which is the only currency the map
 * actually charges in.
 */
function checkCollapse(state: GameState, emit?: EmitEvent): boolean {
  if (state.hp > 0) return false;

  // Out of the town first, if that is where it happened. Waking up indoors
  // would leave the island parked in `outdoor` with nothing to put it back.
  if (state.townId !== null) {
    exitTown(state);
    emit?.({ kind: "town", townId: null });
  }

  const shelter = shelterTile(state);
  const sx = shelter % state.world.width;
  const sy = (shelter - sx) / state.world.width;
  state.x = sx * TILE_SIZE + TILE_SIZE / 2;
  state.y = sy * TILE_SIZE + TILE_SIZE / 2;
  state.facing = "down";
  state.moving = false;

  heal(state, state.maxHp);
  state.toast = {
    text: "Your legs give out. You wake later, rested, a long way back the way you came.",
    until: state.elapsed + 8,
  };
  emit?.({ kind: "collapse" });
  return true;
}

/**
 * Where a collapsed walker wakes up: the last town they set foot in, or the
 * shore they woke on at the start if they have not found one yet.
 */
function shelterTile(state: GameState): number {
  const town = state.world.towns.find((candidate) => candidate.id === state.lastTownId);
  return town ? town.tile : state.world.startTile;
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
  // A town interior is one region numbered zero, which is also a real island
  // region id. Reporting it would put the island's region-zero theme on while
  // the player is standing in a street. The town has its own theme, announced by
  // the `town` event when the door is used.
  if (state.townId !== null) return false;

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

/**
 * Whether the robot is close enough to talk to.
 *
 * Measured against its live position rather than a tile centre, because unlike
 * every other speaker in the game it is usually between tiles.
 */
function robotInRange(state: GameState): boolean {
  return Math.hypot(state.x - state.robot.x, state.y - state.robot.y) <= TALK_RANGE;
}

/**
 * The town whose gate the player is standing at, out on the island.
 *
 * Range is measured to the town's tile, which is the middle of the huddle of
 * buildings drawn around it, and is generous for the same reason a landmark's
 * is: a settlement is a large thing and having to find one pixel of it would be
 * a worse game than walking up to it and pressing a key.
 */
function nearestTownInRange(state: GameState): (typeof state.world.towns)[number] | null {
  let nearest: (typeof state.world.towns)[number] | null = null;
  let nearestDistance = Infinity;
  for (const town of state.world.towns) {
    const tx = (town.tile % state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const ty = Math.floor(town.tile / state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const distance = Math.hypot(state.x - tx, state.y - ty);
    if (distance < nearestDistance && distance <= TOWN_RANGE) {
      nearestDistance = distance;
      nearest = town;
    }
  }
  return nearest;
}

/** The building whose door the player is standing at, inside a town. */
function nearestBuildingInRange(state: GameState): (typeof state.world.buildings)[number] | null {
  let nearest: (typeof state.world.buildings)[number] | null = null;
  let nearestDistance = Infinity;
  for (const building of state.world.buildings) {
    if (building.kind === "house") continue;
    const door = buildingDoor(building, TILE_SIZE);
    const distance = Math.hypot(state.x - door.x, state.y - door.y);
    if (distance < nearestDistance && distance <= TALK_RANGE) {
      nearestDistance = distance;
      nearest = building;
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

/**
 * Publish only when the player crosses an interaction-range boundary.
 *
 * The order is the priority order, and it is the same order `interact` tries
 * things in - they have to agree, or the Act button offers one thing and does
 * another. The robot wins any tie because it is the only target that can walk
 * away; a person outranks a building because a person standing in a doorway
 * should be talked to rather than walked past into the shop; and a landmark is
 * last because it is the one thing that will still be there tomorrow.
 */
function updateNearbyInteraction(state: GameState): boolean {
  const robot = state.townId === null && robotInRange(state);
  const npc = robot ? null : nearestNpcInRange(state);
  const building = robot || npc ? null : nearestBuildingInRange(state);
  const town = robot || npc || building ? null : nearestTownInRange(state);
  const landmark = robot || npc || building || town ? null : nearestLandmarkInRange(state);

  const next = robot
    ? ({ kind: "robot", id: ROBOT_ID, label: ROBOT_NAME } as const)
    : npc
      ? ({ kind: "npc", id: npc.id, label: npc.name } as const)
      : building
        ? ({
            kind: "building",
            id: `${state.townId}:${building.kind}`,
            label: BUILDING_LABELS[building.kind],
            building: building.kind,
          } as const)
        : town
          ? ({ kind: "town", id: town.id, label: town.name } as const)
          : landmark
            ? ({ kind: "landmark", id: landmark.id, label: landmark.properName } as const)
            : null;

  if (next?.kind === state.nearbyInteraction?.kind && next?.id === state.nearbyInteraction?.id) return false;
  state.nearbyInteraction = next;
  return true;
}

/** Talk, read a landmark, or advance an open passage. */
function interact(state: GameState, emit?: EmitEvent): boolean {
  if (state.journalOpen) {
    state.journalOpen = false;
    return true;
  }

  if (state.dialog) {
    state.dialog.index += 1;
    if (state.dialog.index >= state.dialog.lines.length) state.dialog = null;
    return true;
  }

  if (robotInRange(state)) {
    const robot = state.robot;
    const charged = state.elapsed >= robot.rechargeAt;
    // Pure, and computed the same way `narrationTargetForInteraction` computes
    // it a frame earlier - so read-aloud cannot announce a different number
    // from the one the screen shows.
    const { lines, gift } = robotSpeech(state.world.seed, robot.giftCount, charged);

    state.dialog = { sourceId: ROBOT_ID, name: ROBOT_NAME, role: ROBOT_ROLE, lines, index: 0 };
    state.talkedTo.add(ROBOT_ID);

    if (gift > 0) {
      state.coins += gift;
      robot.giftCount += 1;
      robot.rechargeAt = state.elapsed + ROBOT_RECHARGE;
      state.toast = {
        text: `${gift === 1 ? "One coin" : `${gift} coins`} from ${ROBOT_NAME}.`,
        until: state.elapsed + 6,
      };
      emit?.({ kind: "coins", amount: gift });
    }
    return true;
  }

  const npc = nearestNpcInRange(state);
  if (!npc) {
    const building = nearestBuildingInRange(state);
    if (building) return enterBuilding(state, building);

    const town = nearestTownInRange(state);
    if (town) {
      enterTown(state, town);
      emit?.({ kind: "town", townId: town.id });
      return true;
    }
  }

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
  if (!landmark) return fellTree(state, emit);

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

/**
 * Doing whatever a building is for.
 *
 * The church and the pub are conversations, and they go through exactly the
 * `DialogState` every other speaker in the game uses - which is how they get
 * read-aloud, the music duck and the dialogue box without a line of new
 * presentation code. A priest reciting into the same box a cairn spoke out of is
 * also the right reading: it is one world, and the town is part of it.
 *
 * Each visit takes the next voice rather than a random one, so a second prayer
 * is a second prayer and the third drinker is somebody new.
 */
function enterBuilding(state: GameState, building: TownBuilding): boolean {
  const sourceId = `${state.townId}:${building.kind}`;
  if (building.voices.length === 0) return false;

  const turn = state.voiceTurns.get(sourceId) ?? 0;
  state.voiceTurns.set(sourceId, turn + 1);
  const voice = building.voices[turn % building.voices.length];

  // The two that trade open a counter instead of a conversation. The keeper's
  // greeting becomes the panel's opening note, so the words are not lost.
  if (building.kind === "store" || building.kind === "inn") {
    state.shop = { kind: building.kind, name: voice.name, role: voice.role, note: voice.lines[0] ?? null };
    state.talkedTo.add(sourceId);
    return true;
  }

  state.dialog = {
    sourceId,
    name: voice.name,
    role: `${voice.role}, ${BUILDING_LABELS[building.kind]}`,
    lines: [...voice.lines],
    index: 0,
  };
  state.talkedTo.add(sourceId);
  return true;
}

/**
 * Cut down a tree.
 *
 * The one thing in the game that changes the island rather than the player's
 * access to it, and the only renewable income there is: the robot's coins run on
 * a clock, but a wood is a wood. It is tried last of everything `interact` can
 * do, so a sword can never talk over a speaker or a landmark - a passage is
 * content that exists once, and a tree is not.
 *
 * The stump left behind is walkable, which means felling also quietly opens up
 * ground. That is a feature and not an accident, but it is why `placeProps`
 * refuses to put a solid prop anywhere that could seal the map: nothing here can
 * make the island *less* connected.
 */
function fellTree(state: GameState, emit?: EmitEvent): boolean {
  if (!state.items.has("sword")) return false;

  let nearest: (typeof state.world.props)[number] | null = null;
  let nearestDistance = Infinity;
  for (const prop of state.world.props) {
    if (prop.kind !== "tree" && prop.kind !== "pine") continue;
    if (state.felled.has(prop.tile)) continue;
    const px = (prop.tile % state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const py = Math.floor(prop.tile / state.world.width) * TILE_SIZE + TILE_SIZE / 2;
    const distance = Math.hypot(state.x - px, state.y - py);
    if (distance < nearestDistance && distance <= FELL_RANGE) {
      nearestDistance = distance;
      nearest = prop;
    }
  }
  if (!nearest) return false;

  state.felled.add(nearest.tile);
  // Rebuilt rather than edited in place: `WalkContext.solid` is a `ReadonlySet`
  // by declaration, and that is worth keeping - it is the one structure the
  // collision test reads on every axis of every step, and nothing should be able
  // to reach into it from anywhere. Rebuilding costs a pass over the prop list,
  // once, when a tree comes down.
  state.ctx = walkContextFor(state.world, state.felled);
  state.wood += WOOD_PER_TREE;
  state.toast = {
    text: `The tree comes down. ${WOOD_PER_TREE} wood — the store buys it by the armful.`,
    until: state.elapsed + 5,
  };
  emit?.({ kind: "fell" });
  return true;
}

/**
 * Do what a panel asked for.
 *
 * The panel decides nothing: it sends what the player clicked and reads back the
 * note the economy wrote. Refusals - too poor, already carrying one, not tired
 * enough for a bed - come back as a note rather than as a thrown error or a
 * silently ignored click, because the interesting half of a shop is the times it
 * says no and why.
 */
function runCommand(state: GameState, command: GameCommand, emit?: EmitEvent): boolean {
  if (command.kind === "closeShop") {
    if (!state.shop) return false;
    state.shop = null;
    return true;
  }

  // Drinking is the one command that works away from a counter - the whole point
  // of a bottle is that you carry it out of the town.
  if (command.kind === "drink") {
    const result = drinkPotion(state);
    if (result.ok) emit?.({ kind: "heal" });
    state.toast = { text: result.message, until: state.elapsed + 5 };
    if (state.shop) state.shop = { ...state.shop, note: result.message };
    return true;
  }

  const shop = state.shop;
  if (!shop) return false;

  let result: ShopResult;
  switch (command.kind) {
    case "buy":
      result = shop.kind === "store" ? buy(state, command.item) : { ok: false, message: "Not here." };
      break;
    case "sell":
      result = shop.kind === "store" ? sell(state, command.item) : { ok: false, message: "Not here." };
      break;
    case "sellWood":
      result = shop.kind === "store" ? sellWood(state) : { ok: false, message: "Not here." };
      break;
    case "rest":
      result = shop.kind === "inn" ? restAtInn(state) : { ok: false, message: "There is no bed here." };
      break;
  }

  if (result.ok) emit?.({ kind: command.kind === "rest" ? "heal" : "purchase" });
  state.shop = { ...shop, note: result.message };
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
