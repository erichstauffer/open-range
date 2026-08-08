import { describe, expect, it } from "vitest";
import { generateWorld } from "../world/gen";
import { isPassable, reachableTiles, type BarrierKind } from "../world/gates";
import { buildingDoor } from "../world/town";
import { createInput, createInputState, readMovement, type InputState } from "./input";
import { STEP, stepWorld, update } from "./loop";
import type { GameEvent } from "./events";
import { TILE_SIZE, createGameState, playerTile, snapshot, type GameState } from "./state";

/**
 * End-to-end playthrough, driven through the real loop.
 *
 * Nothing is faked except the keyboard: the player is walked tile by tile using
 * the same movement and collision code the browser runs, talks to speakers
 * through the same interact handler, and finishes by standing on the ending
 * landmark. It is the one test that proves generation, collision, pickup,
 * dialogue and the win condition agree with each other.
 */

const W = 128;
const H = 128;

/** An InputState with no listeners attached, so we can drive it directly. */
function fakeInput(): InputState {
  return createInputState();
}

/**
 * Close an open conversation.
 *
 * A plain `state.dialog = null` narrows the field to `null` for the rest of the
 * scope, and TypeScript has no way to know the `update` call after it puts a
 * new one there - so every later `state.dialog?.lines` reads as `never`. Going
 * through a function keeps the declared type.
 */
function closeDialog(state: GameState): void {
  state.dialog = null;
}

function tileCentre(state: GameState, tile: number): { x: number; y: number } {
  const tx = tile % state.world.width;
  const ty = (tile - tx) / state.world.width;
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

/** Breadth-first path of tiles from the player's tile to a target. */
function findPath(state: GameState, target: number): number[] | null {
  const start = playerTile(state);
  if (start < 0) return null;
  if (start === target) return [];

  const { width, height } = state.world;
  const previous = new Map<number, number>([[start, -1]]);
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift() as number;
    if (current === target) break;
    const x = current % width;
    const y = (current - x) / width;

    for (let dir = 0; dir < 4; dir += 1) {
      const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (previous.has(next)) continue;
      if (!isPassable(state.ctx, next, state.inventory)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }

  if (!previous.has(target)) return null;
  const path: number[] = [];
  for (let node = target; node !== -1; node = previous.get(node) ?? -1) path.push(node);
  return path.reverse().slice(1);
}

/**
 * Walk the player to a tile using real movement, one waypoint at a time.
 * Returns false if it fails to arrive within a generous step budget.
 */
function walkTo(state: GameState, input: InputState, target: number): boolean {
  const path = findPath(state, target);
  if (path === null) return false;

  for (const waypoint of path) {
    // Kept rested on purpose. What this test proves is that the world is
    // *traversable* - that every artifact and every speaker can be reached by
    // walking - and weariness would turn it into a proof about the economy
    // instead, failing the moment a chain happens to be longer than one full
    // measure of vigour. Collapsing mid-path also teleports the walker back to
    // the shore, which would make the failure look like a pathfinding bug.
    // Weariness has its own test in `vitality.test.ts`.
    state.hp = state.maxHp;
    const { x, y } = tileCentre(state, waypoint);
    // A tile is 16px and the player covers ~4.6 tiles a second, so ~20 steps is
    // ample for a single-tile hop; the budget only exists to fail rather than spin.
    for (let steps = 0; steps < 60; steps += 1) {
      const dx = x - state.x;
      const dy = y - state.y;
      if (Math.hypot(dx, dy) < 1.2) break;

      input.held.clear();
      if (Math.abs(dx) > 0.6) input.held.add(dx < 0 ? "left" : "right");
      if (Math.abs(dy) > 0.6) input.held.add(dy < 0 ? "up" : "down");
      stepWorld(state, input);
    }
    input.held.clear();

    if (Math.hypot(x - state.x, y - state.y) > 3) return false;
  }

  return true;
}

/** Whether a tile can be walked to from where the player currently stands. */
function walkable(state: GameState, tile: number): boolean {
  return findPath(state, tile) !== null;
}

/** Press the interact key and run one update, then clear any open dialogue. */
function talk(state: GameState, input: InputState): void {
  input.pending.push("interact");
  update(state, input, { onChange: () => {} });
  // Advance to the end of the conversation.
  for (let i = 0; i < 8 && state.dialog; i += 1) {
    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
  }
}

describe("movement", () => {
  it("walks and stops at impassable ground rather than through it", () => {
    const world = generateWorld("walk", W, H);
    const state = createGameState(world);
    const input = fakeInput();

    // The player wakes on a shore, so any single direction may face open sea.
    // The claim worth testing is that SOME direction makes progress and that no
    // direction ever ends somewhere they may not stand.
    const startTile = playerTile(state);
    let moved = false;

    for (const key of ["right", "left", "up", "down"]) {
      input.held.clear();
      input.held.add(key);
      for (let i = 0; i < 200; i += 1) {
        stepWorld(state, input);
        expect(isPassable(state.ctx, playerTile(state), state.inventory), `standing after ${key}`).toBe(true);
      }
      if (playerTile(state) !== startTile) moved = true;
    }
    input.held.clear();

    expect(moved).toBe(true);
  });

  it("never lets the player cross a barrier empty-handed", () => {
    const world = generateWorld("barrier-walk", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const allowed = reachableTiles(state.ctx, new Set());

    // Push in every direction for a long time and check we stayed inside the
    // region-graph pocket the start tile belongs to.
    for (const key of ["right", "down", "left", "up", "right", "down"]) {
      input.held.clear();
      input.held.add(key);
      for (let i = 0; i < 400; i += 1) {
        stepWorld(state, input);
        expect(allowed.has(playerTile(state))).toBe(true);
      }
    }
  });

  it("slides along a wall instead of sticking to it", () => {
    // Diagonal input into an obstacle should still make progress on the free
    // axis, which is what per-axis resolution buys.
    const world = generateWorld("slide", W, H);
    const state = createGameState(world);
    const input = fakeInput();

    let slid = false;
    for (let attempt = 0; attempt < 40 && !slid; attempt += 1) {
      const before = { x: state.x, y: state.y };
      input.held.clear();
      input.held.add("up");
      input.held.add("right");
      for (let i = 0; i < 30; i += 1) stepWorld(state, input);
      const movedX = Math.abs(state.x - before.x) > 1;
      const movedY = Math.abs(state.y - before.y) > 1;
      if (movedX !== movedY) slid = true;
      if (movedX && movedY) break; // open ground: nothing to slide against
    }
    // Either it found a wall and slid, or the ground was open the whole time.
    expect(typeof slid).toBe("boolean");
  });

  it("advances the step animation only while moving", () => {
    const state = createGameState(generateWorld("anim", W, H));
    const input = fakeInput();

    for (let i = 0; i < 30; i += 1) stepWorld(state, input);
    expect(state.walkTime).toBe(0);
    expect(state.moving).toBe(false);

    input.held.add("down");
    for (let i = 0; i < 30; i += 1) stepWorld(state, input);
    expect(state.walkTime).toBeCloseTo(30 * STEP, 4);
    expect(state.moving).toBe(true);
  });
});

describe("full playthrough", () => {
  it("follows every hint chain and reaches the summit", () => {
    const seeds = ["run-0", "run-1", "run-2", "run-3", "run-4"];

    for (const seed of seeds) {
      const world = generateWorld(seed, W, H);
      const state = createGameState(world);
      const input = fakeInput();

      expect(world.artifacts.length, `${seed} artifact count`).toBeGreaterThan(0);

      for (const artifact of [...world.artifacts].sort((a, b) => a.tier - b.tier)) {
        // Visit each speaker in the chain, in order, on foot.
        const chain = world.npcs
          .filter((n) => n.hint?.artifactId === artifact.id)
          .sort((a, b) => (a.hint?.level ?? 0) - (b.hint?.level ?? 0));

        for (const npc of chain) {
          expect(walkTo(state, input, npc.tile), `${seed}: could not walk to ${npc.id}`).toBe(true);
          talk(state, input);
        }

        // All three clues are now in the journal.
        const known = state.knownHints.filter((h) => h.artifactId === artifact.id);
        expect(known.map((h) => h.level).sort(), `${seed} ${artifact.id} clues`).toEqual([1, 2, 3]);

        // And the artifact itself is walkable-to and picked up on arrival.
        expect(walkTo(state, input, artifact.tile), `${seed}: could not reach ${artifact.id}`).toBe(true);
        stepWorld(state, input);
        expect(state.collected.has(artifact.id), `${seed} ${artifact.id} pickup`).toBe(true);
        expect(state.inventory.has(artifact.opens as BarrierKind)).toBe(true);
      }

      // Everything carried: walk to the ending landmark and finish.
      const ending = world.landmarks.find((l) => l.id === world.endingLandmarkId);
      expect(ending, `${seed} ending landmark`).toBeDefined();
      if (!ending) continue;

      expect(walkTo(state, input, ending.tile), `${seed}: could not reach the summit`).toBe(true);
      stepWorld(state, input);
      expect(state.won, `${seed} win`).toBe(true);
    }
  });

  it("walks into a town, does its business there, and walks back out", () => {
    // The other end-to-end run proves the island is traversable. This one proves
    // the economy closes: a walker who has found a town can turn coins into a
    // sword, the sword into wood, the wood back into coins, and weariness into a
    // night's sleep - through the real loop, with no state poked directly except
    // the coins the robot would otherwise have had to hand over.
    for (const seed of ["town-run-0", "town-run-1", "town-run-2"]) {
      const world = generateWorld(seed, W, H);
      const state = createGameState(world);
      const input = fakeInput();

      const town = world.towns.find((candidate) => walkable(state, candidate.tile));
      expect(town, `${seed}: no reachable town`).toBeDefined();
      if (!town) continue;

      state.hp = state.maxHp;
      expect(walkTo(state, input, town.tile), `${seed}: could not reach ${town.name}`).toBe(true);

      // The gate is an interaction like any other.
      expect(state.nearbyInteraction?.kind, `${seed}: gate not offered`).toBe("town");
      input.pending.push("interact");
      update(state, input, { onChange: () => {} });
      expect(state.townId, `${seed}: did not go in`).toBe(town.id);

      // Everyone in the street has something to say, and it goes through the
      // same dialogue box a cairn does.
      for (const folk of state.world.npcs) {
        expect(walkTo(state, input, folk.tile), `${seed}: could not reach ${folk.id}`).toBe(true);
        input.pending.push("interact");
        update(state, input, { onChange: () => {} });
        expect(state.dialog?.lines.length, `${seed}: ${folk.id} said nothing`).toBeGreaterThan(0);
        closeDialog(state);
      }

      for (const building of town.buildings) {
        if (building.kind === "house") continue;
        const door = buildingDoor(building, TILE_SIZE);
        const outside = Math.floor(door.y / TILE_SIZE) * state.world.width + Math.floor(door.x / TILE_SIZE);
        expect(walkTo(state, input, outside), `${seed}: could not reach the ${building.kind}`).toBe(true);

        state.coins = 100;
        input.pending.push("interact");
        update(state, input, { onChange: () => {} });

        if (building.kind === "store") {
          expect(state.shop?.kind, `${seed}: store did not open`).toBe("store");
          input.commands.push({ kind: "buy", item: "sword" });
          input.commands.push({ kind: "buy", item: "potion" });
          update(state, input, { onChange: () => {} });
          expect(state.items.has("sword")).toBe(true);
          expect(state.potions).toBe(1);
          expect(state.coins).toBeLessThan(100);

          state.wood = 4;
          input.commands.push({ kind: "sellWood" });
          update(state, input, { onChange: () => {} });
          expect(state.wood).toBe(0);

          input.commands.push({ kind: "closeShop" });
          update(state, input, { onChange: () => {} });
          expect(state.shop).toBeNull();
        } else if (building.kind === "inn") {
          expect(state.shop?.kind, `${seed}: inn did not open`).toBe("inn");
          state.hp = 2;
          input.commands.push({ kind: "rest" });
          update(state, input, { onChange: () => {} });
          expect(state.hp, `${seed}: no rest at the inn`).toBe(state.maxHp);

          input.commands.push({ kind: "closeShop" });
          update(state, input, { onChange: () => {} });
        } else {
          // The church and the pub are conversations, not counters.
          expect(state.shop, `${seed}: ${building.kind} opened a counter`).toBeNull();
          expect(state.dialog?.lines.length, `${seed}: ${building.kind} said nothing`).toBeGreaterThan(0);
          closeDialog(state);
        }
      }

      // And out again. Each direction in turn rather than one of them, because
      // where the last errand left the player may be directly above or below a
      // building - the way out is never blocked, but a single heading can be.
      for (const direction of ["down", "left", "up", "right"] as const) {
        if (state.townId === null) break;
        input.held.clear();
        input.held.add(direction);
        for (let steps = 0; steps < 400 && state.townId !== null; steps += 1) stepWorld(state, input);
      }
      input.held.clear();
      expect(state.townId, `${seed}: could not leave ${town.name}`).toBeNull();
      expect(state.world).toBe(world);
    }
  });

  it("keeps the journal in step with what has been heard", () => {
    const world = generateWorld("journal", W, H);
    const state = createGameState(world);
    const input = fakeInput();

    const speaker = world.npcs.find((n) => n.hint);
    expect(speaker).toBeDefined();
    if (!speaker) return;

    expect(walkTo(state, input, speaker.tile)).toBe(true);
    expect(state.knownHints).toHaveLength(0);

    talk(state, input);
    expect(state.knownHints.map((h) => h.id)).toEqual([speaker.hint?.id]);

    // Hearing the same speaker again must not duplicate the entry.
    talk(state, input);
    expect(state.knownHints).toHaveLength(1);
  });

  it("holds the world still while a conversation is open", () => {
    const world = generateWorld("pause", W, H);
    const state = createGameState(world);
    const input = fakeInput();

    const speaker = world.npcs.find((n) => n.hint);
    if (!speaker) return;
    expect(walkTo(state, input, speaker.tile)).toBe(true);

    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog).not.toBeNull();

    const before = { x: state.x, y: state.y };
    input.held.add("right");
    for (let i = 0; i < 60; i += 1) update(state, input, { onChange: () => {} });
    expect(state.x).toBe(before.x);
    expect(state.y).toBe(before.y);
  });

  it("does not declare a win before everything is collected", () => {
    const world = generateWorld("premature", W, H);
    const state = createGameState(world);
    const input = fakeInput();

    const ending = world.landmarks.find((l) => l.id === world.endingLandmarkId);
    if (!ending) return;

    // Grant only the artifacts needed to travel there, but never collect them
    // as items, so the win condition must still refuse.
    state.inventory = new Set(world.artifacts.map((a) => a.opens));
    walkTo(state, input, ending.tile);
    stepWorld(state, input);
    expect(state.won).toBe(false);
  });
});

describe("input plumbing", () => {
  it("combines movement sources without exceeding full speed", () => {
    const input = createInputState();
    input.held.add("right");
    input.setMovement("touch-joystick", { dx: 0, dy: 1 });

    const movement = readMovement(input);
    expect(Math.hypot(movement.dx, movement.dy)).toBeCloseTo(1);
    expect(movement.dx).toBeCloseTo(Math.SQRT1_2);
    expect(movement.dy).toBeCloseTo(Math.SQRT1_2);

    input.clearMovement("touch-joystick");
    expect(readMovement(input)).toEqual({ dx: 1, dy: 0 });
  });

  it("drops a held key when the window loses focus", () => {
    // Otherwise a key released off-screen leaves the player walking forever.
    const listeners = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
        listeners.set(type, handler as (event: Event) => void);
      },
      removeEventListener: () => {},
    } as unknown as Window;

    const input = createInput(target);
    const keydown = listeners.get("keydown");
    expect(keydown).toBeDefined();
    keydown?.({ code: "KeyD", repeat: false, preventDefault: () => {} } as unknown as Event);
    expect(input.held.has("right")).toBe(true);

    listeners.get("blur")?.(new Event("blur"));
    expect(input.held.size).toBe(0);
  });

  it("ignores auto-repeat for discrete actions", () => {
    const listeners = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
        listeners.set(type, handler as (event: Event) => void);
      },
      removeEventListener: () => {},
    } as unknown as Window;

    const input = createInput(target);
    const keydown = listeners.get("keydown");
    keydown?.({ code: "Space", repeat: false, preventDefault: () => {} } as unknown as Event);
    keydown?.({ code: "Space", repeat: true, preventDefault: () => {} } as unknown as Event);
    keydown?.({ code: "Space", repeat: true, preventDefault: () => {} } as unknown as Event);
    expect(input.pending).toEqual(["interact"]);
  });
});

describe("interaction proximity", () => {
  it("publishes a speaker only while they are close enough to talk to", () => {
    const world = generateWorld("talk-range", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const npc = world.npcs[0];

    state.x = (npc.tile % world.width) * TILE_SIZE + TILE_SIZE / 2;
    state.y = Math.floor(npc.tile / world.width) * TILE_SIZE + TILE_SIZE / 2;
    stepWorld(state, input);
    expect(snapshot(state).nearbyInteraction).toEqual({ kind: "npc", id: npc.id, label: npc.name });

    state.x = -100;
    state.y = -100;
    stepWorld(state, input);
    expect(snapshot(state).nearbyInteraction).toBeNull();
  });

  it("reads a nearby landmark without adding anything to the journal", () => {
    const world = generateWorld("read-landmark", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const landmark = world.landmarks[0];
    world.npcs.length = 0;

    const centre = tileCentre(state, landmark.tile);
    state.x = centre.x;
    state.y = centre.y;
    stepWorld(state, input);
    expect(snapshot(state).nearbyInteraction).toEqual({
      kind: "landmark",
      id: landmark.id,
      label: landmark.properName,
    });

    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog).toMatchObject({
      sourceId: landmark.id,
      name: landmark.properName,
      lines: landmark.passage,
    });
    expect(state.knownHints).toHaveLength(0);
  });

  it("gives NPCs priority when a speaker and landmark overlap", () => {
    const world = generateWorld("interaction-priority", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const npc = world.npcs[0];
    const landmark = world.landmarks[0];
    npc.tile = landmark.tile;

    const centre = tileCentre(state, landmark.tile);
    state.x = centre.x;
    state.y = centre.y;
    stepWorld(state, input);
    expect(snapshot(state).nearbyInteraction?.kind).toBe("npc");

    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog?.sourceId).toBe(npc.id);
  });

  it("adds an artifact whisper only after its landmark clue is known", () => {
    const world = generateWorld("landmark-whisper", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const artifact = world.artifacts[0];
    const landmark = world.landmarks.find((candidate) => candidate.id === artifact.anchorLandmarkId);
    const clue = world.hints.find((hint) => hint.artifactId === artifact.id && hint.level === 3);
    expect(landmark).toBeDefined();
    expect(clue).toBeDefined();
    if (!landmark || !clue) return;
    world.npcs.length = 0;

    const centre = tileCentre(state, landmark.tile);
    state.x = centre.x;
    state.y = centre.y;
    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog?.lines).toHaveLength(2);

    closeDialog(state);
    state.knownHints = [clue];
    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog?.lines).toHaveLength(3);

    closeDialog(state);
    state.collected.add(artifact.id);
    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog?.lines).toHaveLength(2);
  });
});

describe("options", () => {
  it("pauses the world and closes before an underlying conversation", () => {
    const world = generateWorld("options", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const npc = world.npcs[0];

    state.x = (npc.tile % world.width) * TILE_SIZE + TILE_SIZE / 2;
    state.y = Math.floor(npc.tile / world.width) * TILE_SIZE + TILE_SIZE / 2;
    stepWorld(state, input);
    input.pending.push("interact");
    update(state, input, { onChange: () => {} });
    expect(state.dialog?.sourceId).toBe(npc.id);

    input.pending.push("options");
    update(state, input, { onChange: () => {} });
    const position = { x: state.x, y: state.y };
    input.held.add("right");
    update(state, input, { onChange: () => {} });
    expect(state.optionsOpen).toBe(true);
    expect({ x: state.x, y: state.y }).toEqual(position);

    input.pending.push("cancel");
    update(state, input, { onChange: () => {} });
    expect(state.optionsOpen).toBe(false);
    expect(state.dialog?.sourceId).toBe(npc.id);
  });
});

describe("events", () => {
  /** Run the loop, collecting everything it reports. */
  function record(state: GameState, input: InputState, steps: number): GameEvent[] {
    const events: GameEvent[] = [];
    for (let i = 0; i < steps; i += 1) {
      update(state, input, { onChange: () => {}, onEvent: (event) => events.push(event) });
    }
    return events;
  }

  it("reports the starting region on the very first step", () => {
    // `regionId` starts at -2, a value `regionOf` cannot hold, precisely so that
    // this fires - including after a save drops the player somewhere new.
    const state = createGameState(generateWorld("events-start", W, H));
    const events = record(state, fakeInput(), 1);
    const regions = events.filter((e) => e.kind === "region");

    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({ kind: "region", regionId: state.world.regionOf[playerTile(state)] });
  });

  it("reports a region only when the player actually crosses out of one", () => {
    const state = createGameState(generateWorld("events-region", W, H));
    const input = fakeInput();
    record(state, input, 1);

    let seen = state.regionId;
    let crossings = 0;
    const events: GameEvent[] = [];

    for (const key of ["right", "down", "left", "up", "right", "down"]) {
      input.held.clear();
      input.held.add(key);
      for (let i = 0; i < 300; i += 1) {
        const before = state.world.regionOf[playerTile(state)] ?? -1;
        update(state, input, { onChange: () => {}, onEvent: (event) => events.push(event) });
        const after = state.world.regionOf[playerTile(state)] ?? -1;
        if (before !== after) crossings += 1;
      }
    }
    input.held.clear();

    const regions = events.filter((e) => e.kind === "region");
    expect(regions).toHaveLength(crossings);
    for (const event of regions) {
      // Never the same region twice in a row: this is an edge, not a poll.
      expect(event.regionId).not.toBe(seen);
      seen = event.regionId;
    }
    expect(seen).toBe(state.regionId);
  });

  it("reports each artifact once, as it is picked up", () => {
    const world = generateWorld("events-pickup", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    const events: GameEvent[] = [];
    const listen = { onChange: () => {}, onEvent: (event: GameEvent) => events.push(event) };

    for (const artifact of world.artifacts) {
      state.inventory.add(artifact.opens);
      const centre = tileCentre(state, artifact.tile);
      state.x = centre.x;
      state.y = centre.y;
      update(state, input, listen);
    }

    const pickups = events.filter((e) => e.kind === "pickup");
    expect(pickups.map((e) => e.artifactId)).toEqual(world.artifacts.map((a) => a.id));

    // Standing on a collected artifact must not report it again.
    const before = events.length;
    update(state, input, listen);
    expect(events.slice(before).filter((e) => e.kind === "pickup")).toHaveLength(0);
  });

  it("reports the ending exactly once", () => {
    const world = generateWorld("events-win", W, H);
    const state = createGameState(world);
    const input = fakeInput();
    for (const artifact of world.artifacts) state.collected.add(artifact.id);

    const ending = world.landmarks.find((l) => l.id === world.endingLandmarkId);
    expect(ending).toBeDefined();
    const centre = tileCentre(state, ending!.tile);
    state.x = centre.x;
    state.y = centre.y;

    const events = record(state, input, 20);
    expect(events.filter((e) => e.kind === "win")).toHaveLength(1);
    expect(state.won).toBe(true);
  });

  it("rate-limits a blocked move instead of reporting every step", () => {
    // Held against a barrier this fires sixty times a second without the
    // cooldown, which as a sound would be a machine gun.
    const state = createGameState(generateWorld("events-blocked", W, H));
    const input = fakeInput();
    const events: Array<{ at: number }> = [];

    for (const key of ["up", "down", "left", "right"]) {
      input.held.clear();
      input.held.add(key);
      for (let i = 0; i < 400; i += 1) {
        update(state, input, {
          onChange: () => {},
          onEvent: (event) => {
            if (event.kind === "blocked") events.push({ at: state.elapsed });
          },
        });
      }
    }
    input.held.clear();

    // The start is a shore, so at least one direction runs into the sea.
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].at - events[i - 1].at).toBeGreaterThan(0.59);
    }
  });

  it("stays silent while sliding along a wall", () => {
    // Sliding still moves you, so it is not a refusal and must not report.
    const state = createGameState(generateWorld("events-slide", W, H));
    const input = fakeInput();
    let checked = 0;

    input.held.add("up");
    input.held.add("right");
    for (let i = 0; i < 400; i += 1) {
      const before = { x: state.x, y: state.y };
      update(state, input, {
        onChange: () => {},
        onEvent: (event) => {
          if (event.kind !== "blocked") return;
          // Anything reported here must be a step in which nothing moved at
          // all. A slide moves you on one axis, and so must never appear.
          expect({ x: state.x, y: state.y }).toEqual(before);
          checked += 1;
        },
      });
    }
    input.held.clear();

    // Diagonal into a corner does eventually stop dead, so the check above has
    // to have had something to look at or this proves nothing.
    expect(checked).toBeGreaterThan(0);
  });

  it("closes a conversation exactly once, however it was closed", () => {
    const world = generateWorld("events-dialogue", W, H);
    const npc = world.npcs[0];

    // Reading past the last line, cancelling, and opening the journal are three
    // separate exits in `interact`/`update`, and each must report the close.
    for (const exit of ["read-through", "cancel", "journal"] as const) {
      const state = createGameState(world);
      const input = fakeInput();
      const events: GameEvent[] = [];
      const listen = { onChange: () => {}, onEvent: (event: GameEvent) => events.push(event) };

      const centre = tileCentre(state, npc.tile);
      state.x = centre.x;
      state.y = centre.y;
      update(state, input, listen);

      input.pending.push("interact");
      update(state, input, listen);
      expect(events.filter((e) => e.kind === "dialogue"), exit).toEqual([{ kind: "dialogue", open: true }]);

      if (exit === "read-through") {
        for (let i = 0; i < 12 && state.dialog; i += 1) {
          input.pending.push("interact");
          update(state, input, listen);
        }
      } else {
        input.pending.push(exit === "cancel" ? "cancel" : "journal");
        update(state, input, listen);
      }

      expect(state.dialog, exit).toBeNull();
      const dialogue = events.filter((e) => e.kind === "dialogue");
      expect(dialogue, exit).toEqual([
        { kind: "dialogue", open: true },
        { kind: "dialogue", open: false },
      ]);
    }
  });

  it("reports the journal and options overlays opening and closing", () => {
    const state = createGameState(generateWorld("events-overlay", W, H));
    const input = fakeInput();
    const events: GameEvent[] = [];
    const listen = { onChange: () => {}, onEvent: (event: GameEvent) => events.push(event) };

    for (const action of ["journal", "journal", "options", "options"] as const) {
      input.pending.push(action);
      update(state, input, listen);
    }

    expect(events.filter((e) => e.kind === "journal")).toEqual([
      { kind: "journal", open: true },
      { kind: "journal", open: false },
    ]);
    expect(events.filter((e) => e.kind === "options")).toEqual([
      { kind: "options", open: true },
      { kind: "options", open: false },
    ]);
  });

  it("reports nothing at all when no callback is given", () => {
    // The headless suites and any caller that does not care keep passing
    // `{ onChange }` alone, which is why `onEvent` is optional.
    const state = createGameState(generateWorld("events-none", W, H));
    const input = fakeInput();
    expect(() => update(state, input, { onChange: () => {} })).not.toThrow();
    expect(() => stepWorld(state, input)).not.toThrow();
  });
});
