import { describe, expect, it } from "vitest";
import { generateWorld } from "../world/gen";
import { TOWN_W, townGateTile } from "../world/town";
import { createInputState } from "./input";
import { stepWorld, update } from "./loop";
import { TILE_SIZE, createGameState, playerTile, snapshot } from "./state";
import { enterTown, exitTown } from "./town-transition";

const W = 128;
const H = 128;

function stateAtTown(seed = "towns") {
  const world = generateWorld(seed, W, H);
  const state = createGameState(world);
  const town = world.towns[0];

  // Stand on the town's gate tile, as a walker who has found it would be.
  const tx = town.tile % world.width;
  const ty = (town.tile - tx) / world.width;
  state.x = tx * TILE_SIZE + TILE_SIZE / 2;
  state.y = ty * TILE_SIZE + TILE_SIZE / 2;

  return { world, state, town };
}

describe("entering a town", () => {
  it("swaps the map under the player and puts them at the gate", () => {
    const { world, state, town } = stateAtTown();
    enterTown(state, town);

    expect(state.townId).toBe(town.id);
    expect(state.world).toBe(town.interior);
    expect(state.world.width).toBe(TOWN_W);
    expect(playerTile(state)).toBe(townGateTile());
    // The island is parked, not discarded.
    expect(state.outdoor?.world).toBe(world);
  });

  it("carries the person across and leaves the island alone", () => {
    const { state, town } = stateAtTown();
    state.coins = 12;
    state.hp = 9;
    state.collected.add("ford-stone");
    state.inventory.add("river");

    enterTown(state, town);

    expect(state.coins).toBe(12);
    expect(state.hp).toBe(9);
    expect(state.collected.has("ford-stone")).toBe(true);
    expect(state.inventory.has("river")).toBe(true);
  });

  it("keeps the HUD reporting the island rather than the street", () => {
    const { state, town } = stateAtTown();
    // Walk a little so there is a non-zero figure to preserve.
    stepWorld(state, createInputState());
    const outside = snapshot(state);

    enterTown(state, town);
    const inside = snapshot(state);

    expect(inside.exploredPercent).toBe(outside.exploredPercent);
    expect(inside.artifactTotal).toBe(outside.artifactTotal);
    expect(inside.inTown).toBe(true);
  });

  it("shows no fog: a town is visible from its own gate", () => {
    const { state, town } = stateAtTown();
    enterTown(state, town);
    expect([...state.visited].every((seen) => seen === 1)).toBe(true);
  });
});

describe("leaving a town", () => {
  it("puts the walker back on the exact spot they left from", () => {
    const { world, state, town } = stateAtTown();
    const before = { x: state.x, y: state.y, facing: state.facing };

    enterTown(state, town);
    exitTown(state);

    expect(state.townId).toBeNull();
    expect(state.outdoor).toBeNull();
    expect(state.world).toBe(world);
    expect(state.x).toBe(before.x);
    expect(state.y).toBe(before.y);
    expect(state.facing).toBe(before.facing);
  });

  it("happens by walking off any edge, without finding a gate", () => {
    const input = createInputState();

    for (const direction of ["up", "down", "left", "right"] as const) {
      const { state, town } = stateAtTown();
      enterTown(state, town);
      expect(state.townId).toBe(town.id);

      input.held.clear();
      input.held.add(direction);
      // Generous: the far corner of a 24x18 town at four and a half tiles a
      // second is well under this.
      for (let steps = 0; steps < 600 && state.townId !== null; steps += 1) {
        stepWorld(state, input);
      }
      input.held.clear();

      expect(state.townId, `walking ${direction} did not leave the town`).toBeNull();
    }
  });

  it("reports the crossing so the music can change back", () => {
    const { state, town } = stateAtTown();
    const input = createInputState();
    const events: Array<string | null> = [];

    input.pending.push("interact");
    update(state, input, {
      onChange: () => {},
      onEvent: (event) => {
        if (event.kind === "town") events.push(event.townId);
      },
    });
    expect(events).toEqual([town.id]);

    input.held.add("down");
    for (let steps = 0; steps < 600 && state.townId !== null; steps += 1) {
      stepWorld(state, input, (event) => {
        if (event.kind === "town") events.push(event.townId);
      });
    }

    expect(events).toEqual([town.id, null]);
  });
});

describe("the robot", () => {
  it("stays on the island while the player is indoors", () => {
    const { state, town } = stateAtTown();
    const input = createInputState();
    enterTown(state, town);

    const where = { x: state.robot.x, y: state.robot.y };
    for (let steps = 0; steps < 300; steps += 1) stepWorld(state, input);

    expect(state.robot.x).toBe(where.x);
    expect(state.robot.y).toBe(where.y);
  });
});
