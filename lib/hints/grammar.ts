/**
 * Hint sentences.
 *
 * Every template takes facts read out of the generated world, so a speaker
 * cannot be wrong. There are no invented place names here and no hedging
 * language that would let a false statement pass as flavour - `hints.test.ts`
 * checks each produced sentence against the world it came from.
 *
 * Three tiers of specificity, which is what makes chaining worthwhile:
 *   1. terrain  - narrows the island to a kind of ground
 *   2. region   - names the place and the direction
 *   3. landmark - names the thing it lies under
 */

import { pick, type Rng } from "../rand";

export interface TerrainFacts {
  terrain: string;
}

export interface RegionFacts {
  region: string;
  compass: string;
}

export interface LandmarkFacts {
  landmark: string;
}

export interface ReferralFacts {
  role: string;
  region: string;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function terrainHint(rng: Rng, facts: TerrainFacts): string {
  return pick(rng, [
    `Whatever you're after, it rests on ${facts.terrain}. That much I'm sure of.`,
    `I heard it lies where the ground turns to ${facts.terrain}.`,
    `Not here, at any rate. Look to the ${facts.terrain}.`,
    `My grandfather said it sits on ${facts.terrain}, and he was rarely wrong.`,
  ]);
}

export function regionHint(rng: Rng, facts: RegionFacts): string {
  const where = facts.compass === "close by" ? "close by" : `${facts.compass} of here`;
  return pick(rng, [
    `Others have asked me the same. They went to ${facts.region}, ${where}.`,
    `${capitalise(facts.region)} — that's your ground. ${where === "close by" ? "Close by, too." : `You'll walk ${facts.compass} a good while.`}`,
    `It's in ${facts.region}, ${where}. I'd start there.`,
  ]);
}

export function landmarkHint(rng: Rng, facts: LandmarkFacts): string {
  return pick(rng, [
    `Beneath the ${facts.landmark}. I've seen the place myself.`,
    `Look under the ${facts.landmark}. Nowhere else.`,
    `The ${facts.landmark} — that's where it lies. Go and see.`,
  ]);
}

export function referral(rng: Rng, facts: ReferralFacts): string {
  return pick(rng, [
    `The ${facts.role} in ${facts.region} knows more of it than I do.`,
    `Ask the ${facts.role} over in ${facts.region}. They keep track of such things.`,
    `I'd put the question to the ${facts.role} of ${facts.region}.`,
  ]);
}

/** Said when a speaker has nothing left to add. */
export function exhausted(rng: Rng): string {
  return pick(rng, [
    `I've told you what I know.`,
    `Nothing more from me.`,
    `That's the whole of it.`,
  ]);
}

/**
 * Ambient lines. Deliberately unhelpful - they establish the register the
 * transcript asked for ("we just wake up and we explore") without pretending to
 * carry information the player could act on.
 */
export function ambientLine(rng: Rng, facts: { region: string; terrain: string }): string {
  return pick(rng, [
    `I woke up here once and never got round to leaving.`,
    `Quiet season. The ${facts.terrain} keeps its own counsel.`,
    `You're a long way from anywhere. That's most of ${facts.region}, mind.`,
    `Folk pass through. Not many stop.`,
    `There's older things than me buried hereabouts.`,
    `Walk far enough and you come back to yourself. Or so they say.`,
  ]);
}
