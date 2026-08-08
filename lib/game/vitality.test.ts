import { describe, expect, it } from "vitest";
import { generateWorld } from "../world/gen";
import { createInputState } from "./input";
import { stepWorld } from "./loop";
import { TILE_SIZE, createGameState, playerTile } from "./state";
import { MAX_HP, TILES_PER_HP, WEARY_FRACTION, WEARY_SPEED, applyWeariness, heal, isWeary, paceFor } from "./vitality";

const W = 96;
const H = 96;

// Weariness is arithmetic over the player, not over the island, so one world
// serves every case here.
const WORLD = generateWorld("weary", W, H);

function freshState() {
  return createGameState(WORLD);
}

describe("weariness", () => {
  it("starts at full health", () => {
    const state = freshState();
    expect(state.hp).toBe(MAX_HP);
    expect(state.maxHp).toBe(MAX_HP);
    expect(isWeary(state)).toBe(false);
  });

  it("charges exactly one point per TILES_PER_HP tiles walked", () => {
    const state = freshState();
    const perPoint = TILES_PER_HP * TILE_SIZE;

    // One tile short of a point costs nothing.
    expect(applyWeariness(state, perPoint - TILE_SIZE)).toBe(false);
    expect(state.hp).toBe(MAX_HP);

    // Crossing the line costs exactly one.
    expect(applyWeariness(state, TILE_SIZE)).toBe(true);
    expect(state.hp).toBe(MAX_HP - 1);
  });

  it("carries the remainder rather than rounding it away", () => {
    const state = freshState();
    const perPoint = TILES_PER_HP * TILE_SIZE;

    // A thousand sub-pixel calls must cost the same as one call of the total.
    // This is the property that makes weariness independent of the frame rate.
    const stepDistance = perPoint / 1000;
    for (let i = 0; i < 3000; i += 1) applyWeariness(state, stepDistance);

    expect(state.hp).toBe(MAX_HP - 3);
    expect(state.walkedSincePoint).toBeCloseTo(0, 6);
  });

  it("charges several points at once for a single long stride", () => {
    const state = freshState();
    applyWeariness(state, TILES_PER_HP * TILE_SIZE * 4.5);
    expect(state.hp).toBe(MAX_HP - 4);
  });

  it("never falls below zero", () => {
    const state = freshState();
    applyWeariness(state, TILES_PER_HP * TILE_SIZE * (MAX_HP + 10));
    expect(state.hp).toBe(0);
  });

  it("slows the walk once weary and not before", () => {
    const state = freshState();
    expect(paceFor(state)).toBe(1);

    state.hp = Math.floor(MAX_HP * WEARY_FRACTION) + 1;
    expect(paceFor(state)).toBe(1);

    state.hp = Math.floor(MAX_HP * WEARY_FRACTION);
    expect(isWeary(state)).toBe(true);
    expect(paceFor(state)).toBe(WEARY_SPEED);
  });
});

describe("healing", () => {
  it("restores points and clamps at full", () => {
    const state = freshState();
    state.hp = 4;
    expect(heal(state, 5)).toBe(5);
    expect(state.hp).toBe(9);

    // Returns what was actually recovered, so an inn can refuse to charge a
    // rested walker.
    expect(heal(state, 100)).toBe(MAX_HP - 9);
    expect(state.hp).toBe(MAX_HP);
    expect(heal(state, 5)).toBe(0);
  });

  it("clears the part-walked remainder, so a rest is a real rest", () => {
    const state = freshState();
    applyWeariness(state, TILES_PER_HP * TILE_SIZE * 0.9);
    expect(state.walkedSincePoint).toBeGreaterThan(0);

    state.hp = 4;
    heal(state, 1);
    expect(state.walkedSincePoint).toBe(0);
  });
});

describe("collapse", () => {
  it("wakes the walker at the shore, rested, having lost nothing else", () => {
    const state = freshState();
    const input = createInputState();

    state.coins = 7;
    state.collected.add("whatever");
    state.hp = 0;
    // Walk one step somewhere far from the start so the relocation is visible.
    state.x += TILE_SIZE * 3;

    const events: string[] = [];
    stepWorld(state, input, (event) => events.push(event.kind));

    expect(state.hp).toBe(MAX_HP);
    expect(playerTile(state)).toBe(state.world.startTile);
    expect(events).toContain("collapse");
    // Nothing is taken from you but the walk back.
    expect(state.coins).toBe(7);
    expect(state.collected.has("whatever")).toBe(true);
  });
});
