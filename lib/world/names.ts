/**
 * Seeded name generation.
 *
 * This is the cheapest tonal lever in the project. The transcript asked for
 * Zelda mechanics with "a Lord of the Rings feel"; almost all of that feeling
 * arrives through language rather than pixels. A region called "the Grey Fen"
 * and an artifact called "the Ford Stone of Enneth" carry the register without
 * a single change to the art.
 *
 * Two registers are mixed on purpose:
 *  - invented words from a syllable grammar (Amrath, Dunhollow)
 *  - plain English compounds (the Grey Fen, the Split Marches)
 * Using only the first reads as fantasy soup; only the second reads as generic.
 */

import { pick, type Rng } from "../rand";

const ONSETS: readonly string[] = [
  "b", "br", "d", "dr", "g", "gr", "th", "m", "n", "r", "s", "t", "v", "l", "h", "f", "k", "kh", "mel", "an", "en", "gl",
];

const NUCLEI: readonly string[] = ["a", "e", "i", "o", "u", "ae", "ei", "ui", "a", "o", "e", "ia"];

const CODAS: readonly string[] = [
  "n", "r", "th", "l", "d", "st", "ndil", "rath", "moth", "wen", "loth", "gorn", "dor", "mir", "", "", "",
];

/** Invented word, one or two syllables. */
export function inventedName(rng: Rng): string {
  const syllables = rng() < 0.55 ? 1 : 2;
  let word = "";
  for (let i = 0; i < syllables; i += 1) {
    word += pick(rng, ONSETS) + pick(rng, NUCLEI);
    if (i === syllables - 1) word += pick(rng, CODAS);
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const ADJECTIVES: readonly string[] = [
  "Grey", "Long", "Cold", "Still", "Low", "Hollow", "Far", "Old", "Quiet", "Broken", "Pale", "Deep", "Wind-worn",
  "Sunken", "Last",
];

/** Landform words, grouped so a name can match the terrain it labels. */
const FEATURES: Readonly<Record<string, readonly string[]>> = {
  water: ["Reach", "Sound", "Narrows", "Shallows"],
  shore: ["Strand", "Shingle", "Sands", "Shore"],
  meadow: ["Meadows", "Green", "Lea", "Downs", "Fields"],
  moor: ["Moor", "Heath", "Fen", "Waste", "Marches"],
  woodland: ["Wood", "Thicket", "Holt", "Weald", "Grove"],
  highland: ["Fells", "Scarp", "Tors", "Crags", "Heights"],
  snow: ["Whites", "Rime", "Cap", "Frost", "Cirque"],
};

const PREFIXES: readonly string[] = ["Dun", "Bree", "Har", "Mor", "Ath", "Car", "Erl", "Fen", "Nor", "Wold"];
const SUFFIXES: readonly string[] = ["hollow", "march", "fold", "combe", "ridge", "mere", "gard", "bury", "stead"];

/** Single-word settlement-style name, e.g. "Dunhollow". */
export function compoundName(rng: Rng): string {
  return pick(rng, PREFIXES) + pick(rng, SUFFIXES);
}

/**
 * Name a region. `featureGroup` should be a key of FEATURES matching the
 * region's dominant terrain, so a name never contradicts what you are standing
 * on - "the Grey Fen" must not turn out to be a snowfield.
 */
export function regionName(rng: Rng, featureGroup: string): string {
  const features = FEATURES[featureGroup] ?? FEATURES.meadow;
  const roll = rng();
  if (roll < 0.45) return `the ${pick(rng, ADJECTIVES)} ${pick(rng, features)}`;
  if (roll < 0.72) return compoundName(rng);
  return `${inventedName(rng)} ${pick(rng, features)}`;
}

const PERSON_ROLES: readonly string[] = [
  "ferryman", "shepherd", "miner", "hermit", "fowler", "reed-cutter", "cairn-keeper", "beekeeper", "charcoal-burner",
  "wandering scribe", "goat-herd", "well-digger", "salt-carrier", "bell-ringer",
];

export interface PersonName {
  name: string;
  role: string;
}

export function personName(rng: Rng): PersonName {
  return { name: inventedName(rng), role: pick(rng, PERSON_ROLES) };
}

/**
 * Artifact names. The noun is fixed per barrier kind so the object's *purpose*
 * stays legible - a player who reads "Ford Stone" should be able to guess it
 * concerns water - while the epithet is generated for flavour.
 */
export function artifactName(rng: Rng, noun: string): string {
  const roll = rng();
  if (roll < 0.4) return `the ${noun} of ${inventedName(rng)}`;
  if (roll < 0.7) return `the ${pick(rng, ADJECTIVES)} ${noun}`;
  return `${inventedName(rng)}'s ${noun}`;
}

/** Maps a tile kind to the feature-word group used when naming a region. */
export function featureGroupFor(kind: string): string {
  switch (kind) {
    case "deepWater":
    case "shallowWater":
    case "river":
      return "water";
    case "shore":
      return "shore";
    case "meadow":
      return "meadow";
    case "moor":
      return "moor";
    case "woodland":
    case "bramble":
      return "woodland";
    case "highland":
    case "cliff":
      return "highland";
    case "snow":
      return "snow";
    default:
      return "meadow";
  }
}
