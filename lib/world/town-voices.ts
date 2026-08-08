/**
 * What a town says.
 *
 * The same shape as `landmark-passages.ts`, and for the same reason: curated
 * lines, drawn with a seeded generator, assembled at generation time and baked
 * into the world. A speaker's words are a property of the seed, so two people
 * given the same `?seed=` link hear the same town, and a save can store an id
 * instead of a paragraph.
 *
 * The registers are kept apart on purpose. Out on the island every voice is
 * either elegiac (the landmarks) or cryptic (the hint-bearers). A town has to
 * sound like neither, or arriving in one would feel like more of the same
 * weather. So townsfolk talk about work, the priest talks upward, and the
 * drinkers talk about each other.
 */

import { pick, shuffle, type Rng } from "../rand";

/** Trades a town can plausibly support. Named for work, never for adventure. */
export const TOWNSFOLK_ROLES: readonly string[] = [
  "baker",
  "cooper",
  "thatcher",
  "carter",
  "weaver",
  "ostler",
  "tanner",
  "candle-maker",
  "wheelwright",
  "midwife",
  "rope-maker",
  "sexton",
];

export const SHOPKEEPER_ROLE = "storekeeper";
export const INNKEEPER_ROLE = "innkeeper";
export const PRIEST_ROLE = "priest";
export const PATRON_ROLES: readonly string[] = [
  "drover",
  "off-duty ostler",
  "retired ferryman",
  "peat-cutter",
  "stonemason",
  "widow of the parish",
];

/**
 * Things a person in the street says.
 *
 * Written to be true of any town on any island, because they are: the generator
 * cannot know which one it is placing when it picks these, and a line that
 * assumed a harbour would be a lie half the time.
 */
const STREET_LINES: readonly string[] = [
  "We are a small place. Everything here has been mended at least twice.",
  "You have the look of someone who has been walking. There is a bed for that.",
  "Nobody builds this far out unless the ground gives them a reason.",
  "The road out is the road in. That is most of what I know about it.",
  "Mind your feet on the stones after rain. Half the parish has been down on them.",
  "We hear things from travellers and repeat them wrong. That is the trade here.",
  "You will want the store before dark. He shuts when he feels like it.",
  "There were more of us once. Not fewer than now, though, which is something.",
  "If you are going up-country, go rested. The hills do not care how far you came.",
  "A stranger is a week of conversation in a town this size. Do not take it personally.",
];

/** Second lines, tied to where the town actually is. */
const PLACE_LINES: readonly string[] = [
  "We are the last roof before {region}, and we know it.",
  "Everything you can see from the end of the street is {region}.",
  "People from {region} come down for the market and go back up the same day.",
  "{region} keeps its own hours. We keep ours.",
];

export interface TownVoiceContext {
  townName: string;
  regionName: string;
}

function fill(line: string, context: TownVoiceContext): string {
  return line.replace("{region}", context.regionName).replace("{town}", context.townName);
}

/** Two lines for a person standing in the street: a remark and a placement. */
export function streetLines(rng: Rng, context: TownVoiceContext): string[] {
  return [pick(rng, STREET_LINES), fill(pick(rng, PLACE_LINES), context)];
}

// --- The church -------------------------------------------------------------

/**
 * The priest's prayers.
 *
 * The counterpart to `landmarkPassage`: out at the ruins the land speaks about
 * itself, and here a person speaks on its behalf. Built as invocation, petition,
 * blessing - three lines, one from each pool - so a prayer has the shape of one
 * even when the words are new.
 */
const INVOCATIONS: readonly string[] = [
  "For the ones who went up and did not come down again.",
  "For everything that was here before the road was.",
  "For the light, which is borrowed, and the dark, which is not.",
  "For the ground, which keeps what it is given.",
  "For travellers, who are always somebody's.",
  "For the small hours, when the parish is honest.",
];

const PETITIONS: readonly string[] = [
  "Let the weather be ordinary. Let nothing be asked of us that we cannot carry.",
  "Let the far fields be walked by somebody, so they are not forgotten fields.",
  "Let what is lost stay lost gently, and what is found be worth the finding.",
  "Let the ones out in {region} come to a door tonight, whosever it is.",
  "Let us be no worse than we were, and let that be enough for one year.",
  "Let the bell be heard from the top of the pass, where it matters most.",
];

const BLESSINGS: readonly string[] = [
  "Go on, then. You are as blessed as anyone I have said that to.",
  "That is all of it. It does not get longer for strangers.",
  "The door does not lock. It has not locked in my lifetime.",
  "Rest when you can. That is doctrine here, whatever they say elsewhere.",
  "Take the road slowly. Nothing at the end of it is going anywhere.",
];

export function priestPrayer(rng: Rng, context: TownVoiceContext): string[] {
  return [fill(pick(rng, INVOCATIONS), context), fill(pick(rng, PETITIONS), context), fill(pick(rng, BLESSINGS), context)];
}

// --- The pub ----------------------------------------------------------------

/**
 * The drinkers.
 *
 * Nobody eats or drinks on screen - the brief was explicit, and a game with no
 * hunger has no business with a tankard. What the pub is for is that it is the
 * one room in the game where people are talking to each other rather than to
 * you, and you are joining in.
 */
const PATRON_LINES: readonly string[] = [
  "Sit if you like. Nobody here is going to ask you what you do.",
  "He will tell you he walked the whole ridge in a day. He walked half of it, in two.",
  "There is an argument in this room that is older than the room.",
  "We had a machine come through once. Walking, mind. Nobody has topped that story since.",
  "The priest comes in on a Thursday and pretends it is pastoral work.",
  "You will hear four versions of the same road out of here. Take the dullest one.",
  "Everyone in this parish is somebody's cousin. Choose your words with that in mind.",
  "Whatever you paid at the store, you paid too much. That is not an accusation, it is arithmetic.",
  "If you are going up, tell someone. Not for rescue. For the story, if it goes badly.",
  "Quiet in here tonight. It is quiet in here every night. I say it anyway.",
];

export function patronLines(rng: Rng): string[] {
  const [first, second] = shuffle(rng, [...PATRON_LINES]);
  return [first, second];
}

// --- The trades -------------------------------------------------------------

const STOREKEEPER_LINES: readonly string[] = [
  "Everything on the shelf is for sale, and I will take back anything I sold you.",
  "Steel, boards, and something for the ache in your legs. That is the whole stock.",
  "I buy wood by the armful. Bring it cut and I will not haggle.",
];

const INNKEEPER_LINES: readonly string[] = [
  "A bed and a fire. You will be a different person in the morning.",
  "You look like you have been walking since the shore. Sit down before you fall down.",
  "The room is the same price whoever you are. It is the only room.",
];

export function storekeeperGreeting(rng: Rng): string {
  return pick(rng, STOREKEEPER_LINES);
}

export function innkeeperGreeting(rng: Rng): string {
  return pick(rng, INNKEEPER_LINES);
}
