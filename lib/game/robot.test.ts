import { describe, expect, it } from "vitest";
import { generateWorld } from "../world/gen";
import { isPassable } from "../world/gates";
import { MAX_GIFT, MIN_GIFT, ROBOT_ID, ROBOT_RECHARGE, rollGift, robotSpeech } from "../world/robot";
import { createInputState, type InputState } from "./input";
import { STEP, update } from "./loop";
import { narrationTargetForInteraction } from "./narration";
import type { GameEvent } from "./events";
import { TILE_SIZE, createGameState, snapshot, type GameState } from "./state";

/**
 * The robot: the one thing in the world that walks on its own.
 *
 * The invariants worth protecting are that it cannot escape the region it woke
 * in (it carries no artifacts, so anywhere else would be ground it could never
 * legally have crossed), that it cannot be farmed for coins, and that
 * read-aloud says the same words the screen shows - the last of which is only
 * true while `robotSpeech` stays pure.
 */

const W = 96;
const H = 96;

function fakeInput(): InputState {
  return createInputState();
}

/**
 * Run the world forward with no input, which is enough to move the robot.
 *
 * Through `update` rather than `stepWorld`, because `update` owns the elapsed
 * clock - and the robot's pauses and its recharge are both measured against it.
 */
function idle(state: GameState, seconds: number): void {
  const input = fakeInput();
  const silent = { onChange: () => undefined };
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) update(state, input, silent);
}

/** Put the player next to the robot and press the act key. */
function talkToRobot(state: GameState, events: GameEvent[] = []): void {
  state.x = state.robot.x;
  state.y = state.robot.y;
  const input = fakeInput();
  input.pending.push("interact");
  update(state, input, { onChange: () => undefined, onEvent: (event) => events.push(event) });
}

function closeDialog(state: GameState): void {
  state.dialog = null;
}

describe("where the robot is", () => {
  it("wakes on walkable ground inside a region", () => {
    for (const seed of ["robot-a", "robot-b", "robot-c"]) {
      const world = generateWorld(seed, W, H);
      expect(world.regionOf[world.robotTile]).toBeGreaterThanOrEqual(0);
      expect(world.barrierOf[world.robotTile]).toBe(0);
    }
  });

  it("is part of the world's identity, so a seed puts it in the same place twice", () => {
    const a = generateWorld("robot-hash", W, H);
    const b = generateWorld("robot-hash", W, H);
    expect(a.robotTile).toBe(b.robotTile);
    expect(a.hash).toBe(b.hash);
  });
});

describe("how the robot walks", () => {
  it("moves, and never leaves its own region or stands on a barrier", () => {
    const world = generateWorld("robot-walk-test", W, H);
    const state = createGameState(world);
    const startX = state.robot.x;
    const startY = state.robot.y;
    const region = state.robot.regionId;

    // Long enough for many wander targets, pauses and blocked retries.
    const input = fakeInput();
    for (let i = 0; i < 3000; i += 1) {
      update(state, input, { onChange: () => undefined });

      const tile =
        Math.floor(state.robot.y / TILE_SIZE) * world.width + Math.floor(state.robot.x / TILE_SIZE);
      expect(world.regionOf[tile]).toBe(region);
      // Carrying nothing: an empty inventory is the whole point of the test.
      expect(isPassable(state.ctx, tile, new Set())).toBe(true);
    }

    expect(Math.hypot(state.robot.x - startX, state.robot.y - startY)).toBeGreaterThan(TILE_SIZE);
  });

  it("replays the same walk for the same seed", () => {
    const world = generateWorld("robot-replay", W, H);
    const a = createGameState(world);
    const b = createGameState(world);
    idle(a, 20);
    idle(b, 20);
    expect(a.robot.x).toBe(b.robot.x);
    expect(a.robot.y).toBe(b.robot.y);
  });

  it("holds still while a conversation is open", () => {
    const world = generateWorld("robot-still", W, H);
    const state = createGameState(world);
    talkToRobot(state);
    const { x, y } = state.robot;

    const input = fakeInput();
    for (let i = 0; i < 600; i += 1) update(state, input, { onChange: () => undefined });
    expect(state.robot.x).toBe(x);
    expect(state.robot.y).toBe(y);
  });
});

describe("coins", () => {
  it("rolls a handful inside the advertised range, fixed by the seed and the count", () => {
    for (let count = 0; count < 40; count += 1) {
      const gift = rollGift("robot-gift-test", count);
      expect(gift).toBeGreaterThanOrEqual(MIN_GIFT);
      expect(gift).toBeLessThanOrEqual(MAX_GIFT);
      expect(rollGift("robot-gift-test", count)).toBe(gift);
    }
  });

  it("pays out on the first conversation and reports it", () => {
    const world = generateWorld("robot-pay", W, H);
    const state = createGameState(world);
    const events: GameEvent[] = [];
    talkToRobot(state, events);

    const expected = rollGift(world.seed, 0);
    expect(state.coins).toBe(expected);
    expect(state.dialog?.sourceId).toBe(ROBOT_ID);
    expect(events).toContainEqual({ kind: "coins", amount: expected });
    expect(snapshot(state).coins).toBe(expected);
    expect(snapshot(state).toast).toContain("coin");
  });

  it("gives nothing again until it has recharged", () => {
    const world = generateWorld("robot-recharge", W, H);
    const state = createGameState(world);

    talkToRobot(state);
    const afterFirst = state.coins;
    closeDialog(state);

    // Immediately again: the compartment is empty and nothing is added.
    talkToRobot(state);
    expect(state.coins).toBe(afterFirst);
    expect(state.dialog?.lines.length).toBe(2);
    closeDialog(state);

    // The world still has to be stepped for the clock to move.
    idle(state, ROBOT_RECHARGE + 1);
    talkToRobot(state);
    expect(state.coins).toBe(afterFirst + rollGift(world.seed, 1));
  });
});

describe("read-aloud says what the screen says", () => {
  it("previews exactly the line the conversation opens with", () => {
    const world = generateWorld("robot-narration", W, H);
    const state = createGameState(world);

    // Stand next to it and let the loop notice, without acting yet.
    state.x = state.robot.x;
    state.y = state.robot.y;
    update(state, fakeInput(), { onChange: () => undefined });
    expect(state.nearbyInteraction?.kind).toBe("robot");

    const preview = narrationTargetForInteraction(state);
    const coinsBefore = state.coins;
    const giftsBefore = state.robot.giftCount;
    expect(preview).not.toBeNull();
    // Previewing must not hand out coins as a side effect.
    expect(state.coins).toBe(coinsBefore);
    expect(state.robot.giftCount).toBe(giftsBefore);

    talkToRobot(state);
    expect(state.dialog?.lines[0]).toBe(preview?.text);
  });

  it("previews the empty-handed line once the coins are gone", () => {
    const world = generateWorld("robot-narration-empty", W, H);
    const state = createGameState(world);
    talkToRobot(state);
    closeDialog(state);
    update(state, fakeInput(), { onChange: () => undefined });

    const preview = narrationTargetForInteraction(state);
    expect(preview?.text).toBe(robotSpeech(world.seed, state.robot.giftCount, false).lines[0]);
  });
});
