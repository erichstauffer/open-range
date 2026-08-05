/**
 * Short, deterministic readings for named landmarks.
 *
 * The lines are deliberately assembled from two curated halves rather than a
 * free-form grammar: one remembers the structure, the other tells the truth
 * about the ground it stands on. A separate closing whisper is added by the
 * game loop only after the corresponding landmark clue has been heard.
 */

import type { LandmarkKind } from "../art/sprites";
import { pick, type Rng } from "../rand";

const STRUCTURE_LINES: Readonly<Record<LandmarkKind, readonly string[]>> = {
  splitOak: [
    "Two boughs parted here, though the roots below never did.",
    "The oak keeps one life in two weathered crowns.",
    "Lightning opened the heartwood; the tree answered by growing on.",
  ],
  standingStones: [
    "These stones were raised to measure shadows longer than a lifetime.",
    "Three stones stand, though no living hand remembers raising them.",
    "The builders left no names, only a place for the wind to count the years.",
  ],
  cairn: [
    "Each traveller brought one stone, and carried one silence onward.",
    "The oldest stones lie lowest, where rain can no longer reach them.",
    "This heap marks a road that the grass has long since taken back.",
  ],
  ruinedArch: [
    "The road is gone, but its doorway has forgotten to fall.",
    "Once this arch promised shelter; now it frames only weather.",
    "No wall remains to say what stood here, and still the threshold waits.",
  ],
  spring: [
    "Water remembers the dark before it finds the sky.",
    "The spring speaks softly because stone has taught it patience.",
    "Hands shaped this basin, but the water chose the place.",
  ],
  summit: [
    "The marker keeps watch where every road becomes a view.",
    "Nothing was built above this stone; there was nowhere higher to begin.",
    "Those who raised the marker left the horizon unfinished.",
  ],
};

const TERRAIN_LINES: Readonly<Record<string, readonly string[]>> = {
  shore: [
    "On this shore, the tide edits every mark but the deepest.",
    "Salt and sand make brief histories; by morning, most are gone.",
    "The shore belongs by turns to the land and to the water.",
  ],
  meadow: [
    "Open grass keeps no secrets from the wind, only from hurried eyes.",
    "The meadow grows richest where old paths have finally been forgotten.",
    "In open grass, distance looks shorter than the walking proves.",
  ],
  moor: [
    "Heather holds yesterday's rain long after the clouds have passed.",
    "The moor hides its water low and carries its weather high.",
    "Across the heather, the wind is a surer traveller than any road.",
  ],
  woodland: [
    "The woodland measures time in shade, not hours.",
    "Under these trees, fallen things become the ground for what follows.",
    "A wood closes behind the patient walker and opens before them again.",
  ],
  highland: [
    "Bare highland keeps the old stone close to the surface.",
    "Up here, soil is thin and every season shows its hand.",
    "The high ground sheds water quickly and memory slowly.",
  ],
  snow: [
    "Snow makes one country of every path until the thaw names them again.",
    "The snowfield looks empty because it keeps its signs beneath the white.",
    "Cold preserves the smallest trace, then hides it from sight.",
  ],
};

export function landmarkPassage(
  rng: Rng,
  facts: { kind: LandmarkKind; terrainKind: string; regionName: string },
): string[] {
  const terrain = TERRAIN_LINES[facts.terrainKind] ?? [
    `The ground of ${facts.regionName} has outlasted every name but its own.`,
    `Here in ${facts.regionName}, the earth keeps a counsel older than roads.`,
  ];
  return [pick(rng, STRUCTURE_LINES[facts.kind]), pick(rng, terrain)];
}

export function artifactWhisper(rng: Rng): string {
  return pick(rng, [
    "The earth close by is holding something that does not belong to it.",
    "A small weight troubles the ground within a short walk of here.",
    "What was entrusted to this place has not travelled far.",
  ]);
}
