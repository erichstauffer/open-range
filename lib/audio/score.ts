/**
 * The painter, to `theory.ts`'s constraint box.
 *
 * `composeRegion` turns a region into a loop of note events. It is a pure
 * function of the world seed and the region's dominant terrain and depth, so a
 * shared `?seed=` link reproduces the same music as the same island, and the
 * whole layer can be auditioned headlessly by `scripts/render-score-preview.ts`
 * without a browser.
 *
 * The shape is fixed for every region: thirty-two bars, four eight-bar phrases
 * as A A' B A''. Only the ornament is re-rolled between A and its variants -
 * the skeleton comes from the shared contour - which is what makes a phrase
 * sound like a return rather than like a new idea.
 */

import { makeRng, type Rng } from "../rand";
import type { Region } from "../world/regions";
import {
  CONTOUR_SPAN,
  MUSIC_CONSTRAINTS,
  PERIOD_STEPS,
  PHRASE_BARS,
  PAD_PITCH_CLASSES,
  PHRASE_CONTOUR,
  PHRASE_STEPS,
  PITCH_CLASSES,
  ROTATIONS,
  STEPS_PER_BAR,
  STEP_WEIGHT,
  VOICE_SPECS,
  clampVelocity,
  degreeToMidi,
  DRONE,
  foldIntoRange,
  knobsFor,
  melodyBaseDegree,
  rotationIndex,
  tempoFor,
  type RegionKnobs,
  type VoiceName,
} from "./theory";

export interface NoteEvent {
  /** Eighth-note index from the start of the period. */
  step: number;
  /** Duration in eighths. Always at least 1. */
  steps: number;
  midi: number;
  velocity: number;
  voice: VoiceName;
}

export interface Score {
  regionId: number;
  lengthSteps: number;
  notes: readonly NoteEvent[];
  knobs: RegionKnobs;
  tempo: number;
}

/** How far each phrase is lifted off the skeleton. B is the one that departs. */
const PHRASE_LIFT = [0, 0, 2, 0] as const;

/** Bars per pad chord. */
const CHORD_BARS = 2;

/**
 * Degrees a pad chord may rest on, for a given home index.
 *
 * The rule: **a pad may only rest on a pitch some region could rotate to, and
 * only if its fifth is one the sustained voices are allowed to hold.**
 *
 * That is a single filter doing three jobs. It admits only perfect fifths, so
 * the diminished one the collection also contains can never be voiced. It keeps
 * every pad note inside `PAD_PITCH_CLASSES`, so no two regions' sustained
 * voices can ever be a minor second or a tritone apart, whichever pair happen
 * to border each other. And because `ROTATIONS` is a subset of that pentatonic,
 * a region's own home is always available - so every theme can still cadence
 * where it means to.
 */
function padRootDegrees(home: number): number[] {
  const degrees: number[] = [];
  const sustained = PAD_PITCH_CLASSES as readonly number[];
  for (let degree = 0; degree < PITCH_CLASSES.length; degree += 1) {
    const root = PITCH_CLASSES[(home + degree) % PITCH_CLASSES.length];
    const fifth = PITCH_CLASSES[(home + degree + 4) % PITCH_CLASSES.length];
    if (!(ROTATIONS as readonly number[]).includes(root)) continue;
    if (!sustained.includes(fifth)) continue;
    degrees.push(degree);
  }
  return degrees;
}

/**
 * Whether a note would sound a tritone against anything already placed.
 *
 * The collection contains exactly one tritone - F against B - so this is not a
 * theoretical concern: a melody on B over a pad rooted on F is reachable, and
 * it is the one interval that would break the claim that any two region themes
 * can be crossfaded blind. Callers nudge the offending note by a scale degree
 * rather than dropping it, so the rhythm survives the correction.
 */
function tritoneAgainst(placed: readonly NoteEvent[], step: number, steps: number, midi: number): boolean {
  const end = step + steps;
  for (const note of placed) {
    if (note.step >= end || note.step + note.steps <= step) continue;
    if (Math.abs(note.midi - midi) % 12 === 6) return true;
  }
  return false;
}

/** The drone: a tonic-and-fifth pedal, re-attacked once per phrase so it breathes. */
function layDrone(out: NoteEvent[]): void {
  for (let start = 0; start < PERIOD_STEPS; start += PHRASE_STEPS) {
    for (const midi of DRONE.midi) {
      out.push({
        step: start,
        steps: PHRASE_STEPS,
        midi,
        velocity: clampVelocity(DRONE.gain * 2.4),
        voice: "drone",
      });
    }
  }
}

/**
 * The pad: root and fifth, one chord every two bars.
 *
 * A four-chord progression fixed per region, always beginning on home so the
 * region has an audible tonal centre rather than merely a statistical one.
 */
function layPad(out: NoteEvent[], rng: Rng, knobs: RegionKnobs, home: number): void {
  const spec = VOICE_SPECS.pad;
  const candidates = padRootDegrees(home);
  const progression: number[] = [0];
  while (progression.length < 4) {
    progression.push(candidates[Math.floor(rng() * candidates.length)]);
  }

  const chordSteps = CHORD_BARS * STEPS_PER_BAR;
  let index = 0;
  for (let start = 0; start < PERIOD_STEPS; start += chordSteps) {
    const degree = progression[index % progression.length];
    index += 1;
    const root = foldIntoRange(degreeToMidi(home, degree), spec);
    const fifth = foldIntoRange(degreeToMidi(home, degree + 4), spec);
    const velocity = clampVelocity(0.3 * knobs.padGain + 0.08);
    out.push({ step: start, steps: chordSteps, midi: root, velocity, voice: "pad" });
    out.push({ step: start, steps: chordSteps, midi: fifth, velocity, voice: "pad" });
  }
}

/**
 * Per-bar target degrees for a phrase: the shared contour, shifted.
 *
 * This is the skeleton every region has in common. The region supplies only
 * `registerShift`, exactly as a biome supplies only `lightShift`.
 */
function skeleton(knobs: RegionKnobs, home: number, lift: number): number[] {
  const base = melodyBaseDegree(home);
  return PHRASE_CONTOUR.map((value) => base + Math.round(value * CONTOUR_SPAN) + knobs.registerShift + lift);
}

/**
 * The melody, and the pluck that answers it a third below.
 *
 * Onsets come from the shared bar rhythm scaled by the region's density, so no
 * region invents its own accent pattern. Note lengths are trimmed to the gap
 * before the next onset, which is what keeps the voice monophonic and the
 * polyphony ceiling reachable by counting rather than by hoping.
 */
function layMelody(out: NoteEvent[], rng: Rng, knobs: RegionKnobs, home: number): void {
  const melodySpec = VOICE_SPECS.melody;
  const pluckSpec = VOICE_SPECS.pluck;

  for (let phrase = 0; phrase < PERIOD_STEPS / PHRASE_STEPS; phrase += 1) {
    const bars = skeleton(knobs, home, PHRASE_LIFT[phrase % PHRASE_LIFT.length]);
    const onsets: Array<{ step: number; degree: number; weight: number }> = [];

    for (let bar = 0; bar < PHRASE_BARS; bar += 1) {
      for (let s = 0; s < STEPS_PER_BAR; s += 1) {
        const weight = STEP_WEIGHT[s] * knobs.density;
        if (rng() > weight) continue;
        // Wander around the bar's target rather than landing on it every time.
        const wander = Math.floor(rng() * 3) - 1;
        onsets.push({
          step: phrase * PHRASE_STEPS + bar * STEPS_PER_BAR + s,
          degree: bars[bar] + wander,
          weight: STEP_WEIGHT[s],
        });
      }
    }

    onsets.forEach((onset, i) => {
      const next = onsets[i + 1];
      const limit = next ? next.step - onset.step : phrase * PHRASE_STEPS + PHRASE_STEPS - onset.step;
      const steps = Math.max(1, Math.min(limit, 1 + Math.floor(rng() * 3)));

      // Nudge upward a degree at a time until the one tritone in the collection
      // is out of the way. Three tries is always enough - the collection has
      // seven degrees and only one tritone partner for any pitch.
      let degree = onset.degree;
      let midi = foldIntoRange(degreeToMidi(home, degree), melodySpec);
      for (let attempt = 0; attempt < 3 && tritoneAgainst(out, onset.step, steps, midi); attempt += 1) {
        degree += 1;
        midi = foldIntoRange(degreeToMidi(home, degree), melodySpec);
      }
      if (tritoneAgainst(out, onset.step, steps, midi)) return;

      out.push({
        step: onset.step,
        steps,
        midi,
        velocity: clampVelocity(0.28 + onset.weight * 0.4 * knobs.melodyGain),
        voice: "melody",
      });

      // The pluck answers sparsely, a diatonic third below, never on the same
      // step as its own previous note.
      if (rng() > knobs.pluckGain * knobs.density * 0.8) return;
      const echoStep = onset.step + steps;
      if (echoStep >= phrase * PHRASE_STEPS + PHRASE_STEPS) return;
      let echoMidi = foldIntoRange(degreeToMidi(home, degree - 2), pluckSpec);
      if (tritoneAgainst(out, echoStep, 1, echoMidi)) {
        echoMidi = foldIntoRange(degreeToMidi(home, degree - 3), pluckSpec);
        if (tritoneAgainst(out, echoStep, 1, echoMidi)) return;
      }
      out.push({
        step: echoStep,
        steps: 1,
        midi: echoMidi,
        velocity: clampVelocity(0.22 + onset.weight * 0.25 * knobs.pluckGain),
        voice: "pluck",
      });
    });
  }
}

export function composeRegion(
  seed: string,
  region: Pick<Region, "id" | "dominantKind" | "depth">,
): Score {
  const knobs = knobsFor(region.dominantKind, region.depth);
  const home = rotationIndex(knobs.rotation);
  const rng = makeRng(seed, `music:${region.id}`);

  const notes: NoteEvent[] = [];
  layDrone(notes);
  layPad(notes, rng, knobs, home);
  layMelody(notes, rng, knobs, home);
  notes.sort((a, b) => a.step - b.step || a.midi - b.midi);

  return {
    regionId: region.id,
    lengthSteps: PERIOD_STEPS,
    notes,
    knobs,
    tempo: tempoFor(seed),
  };
}

export function composeWorldScores(seed: string, regions: readonly Region[]): Map<number, Score> {
  return new Map(regions.map((region) => [region.id, composeRegion(seed, region)]));
}

/** Notes sounding at each step. The basis of the polyphony and tritone checks. */
export function soundingByStep(score: Score): NoteEvent[][] {
  const byStep: NoteEvent[][] = Array.from({ length: score.lengthSteps }, () => []);
  for (const note of score.notes) {
    const end = Math.min(score.lengthSteps, note.step + note.steps);
    for (let step = Math.max(0, note.step); step < end; step += 1) byStep[step].push(note);
  }
  return byStep;
}

/** Highest number of notes sounding at once. Used by the polyphony assertion. */
export function peakPolyphony(score: Score): number {
  let peak = 0;
  for (const sounding of soundingByStep(score)) {
    if (sounding.length > peak) peak = sounding.length;
  }
  return peak;
}

export { MUSIC_CONSTRAINTS };
