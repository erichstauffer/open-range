/**
 * The robot: who it is and what it says.
 *
 * Everything here is a pure function of the seed and of how many times it has
 * already paid out. That is not decoration - `narrationTargetForInteraction`
 * has to speak the robot's next line one frame *before* the interaction
 * happens, without touching game state, so the same call has to be able to
 * produce the same words twice. Rolling a gift with `Math.random` at the moment
 * of the conversation would make read-aloud say one number and the screen show
 * another.
 *
 * Motion lives in `lib/game/loop.ts`; this file has no idea where the machine
 * is standing.
 */

import { makeRng, pick } from "../rand";
import { ROBOT_ID } from "../art/sprites";

export { ROBOT_ID };

export const ROBOT_NAME = "Rivet";
export const ROBOT_ROLE = "walking machine";

/** Coins in a single handful. Small enough that the count still means something. */
export const MIN_GIFT = 1;
export const MAX_GIFT = 10;

/**
 * Seconds before it has coins again.
 *
 * The point of the wait is that the counter should record where you have been
 * rather than how long you were willing to stand still and press one key.
 */
export const ROBOT_RECHARGE = 30;

const GREETINGS: readonly string[] = [
  "Its head swivels, and the two lit slots in the visor settle on you.",
  "The machine stops walking. Somewhere inside it, something winds down and holds.",
  "It raises one square hand in what is unmistakably a wave.",
  "The antenna trembles. It has been walking this ground a long time.",
];

const GIFT_LINES: readonly string[] = [
  "A hatch clicks open in the panelled chest and coins spill into your hand.",
  "It counts them out against its palm, deliberately, as though the number matters.",
  "Coins, still warm from wherever it keeps them.",
  "The dial on its chest turns one notch, and it pays you without being asked.",
];

const EMPTY_LINES: readonly string[] = [
  "The hatch opens on an empty compartment. The machine seems embarrassed by this.",
  "It pats the panel twice. Nothing. It will have more before long.",
  "Something inside it is still winding. Come back in a little while.",
];

export interface RobotSpeech {
  lines: string[];
  /** Coins handed over, or 0 when the compartment is empty. */
  gift: number;
}

/** A handful of coins, `MIN_GIFT`..`MAX_GIFT`, fixed by the seed and the count. */
export function rollGift(seed: string, giftCount: number): number {
  const rng = makeRng(seed, `robot-gift:${giftCount}`);
  return MIN_GIFT + Math.floor(rng() * (MAX_GIFT - MIN_GIFT + 1));
}

/**
 * What the robot says on the next conversation.
 *
 * Pure: given the same arguments it returns the same words and the same amount,
 * which is what lets narration read the line before the game state moves.
 */
export function robotSpeech(seed: string, giftCount: number, charged: boolean): RobotSpeech {
  const rng = makeRng(seed, `robot-talk:${giftCount}:${charged ? "full" : "empty"}`);
  const greeting = pick(rng, GREETINGS);

  if (!charged) {
    return { lines: [greeting, pick(rng, EMPTY_LINES)], gift: 0 };
  }

  const gift = rollGift(seed, giftCount);
  const coins = gift === 1 ? "one coin" : `${gift} coins`;
  return {
    lines: [greeting, pick(rng, GIFT_LINES), `You are given ${coins}.`],
    gift,
  };
}
