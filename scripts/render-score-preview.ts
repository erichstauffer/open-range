/**
 * Prints a generated world's music as a piano roll, headlessly.
 *
 *   npm run music:preview -- <seed> [regionIndex]
 *   npm run music:preview -- <seed> --wav out.wav
 *
 * The property tests in `lib/audio` prove the music cannot leave the constraint
 * box. They cannot tell you whether it is any good, and they cannot tell you
 * the thing this project actually needs to know - whether seven regions of one
 * island read as one piece of music or as seven unrelated loops. That is the
 * same question `render-art-preview.ts` exists to answer for the tiles, and it
 * is answered the same way: render the real output and look at it.
 *
 * Walking an island in a browser for five minutes per parameter change is not a
 * workable loop for tuning numbers. This is.
 *
 * The `.wav` is for listening to and is never committed. `public/og.png` is the
 * repository's only binary because crawlers cannot run the generator; nothing
 * has that excuse here.
 */

import { writeFileSync } from "node:fs";
import { SAMPLE_RATE, renderTour } from "../lib/audio/offline";
import { encodeWav } from "./wav";

import {
  PERIOD_STEPS,
  PHRASE_STEPS,
  PITCH_CLASSES,
  STEPS_PER_BAR,
  TONIC_MIDI,
  stepSeconds,
} from "../lib/audio/theory";
import { composeWorldScores, type Score } from "../lib/audio/score";
import type { NoteEvent } from "../lib/audio/score";
import { generateWorld } from "../lib/world/gen";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Bar ruler, so phrase boundaries are visible at a glance. */
function ruler(steps: number): string {
  let out = "";
  for (let step = 0; step < steps; step += 1) {
    if (step % PHRASE_STEPS === 0) out += "|";
    else if (step % STEPS_PER_BAR === 0) out += ":";
    else out += " ";
  }
  return out;
}

function rollFor(notes: readonly NoteEvent[], steps: number): string[] {
  if (notes.length === 0) return ["  (silent)"];

  const pitches = [...new Set(notes.map((n) => n.midi))].sort((a, b) => b - a);
  return pitches.map((midi) => {
    const row = new Array<string>(steps).fill("·");
    for (const note of notes) {
      if (note.midi !== midi) continue;
      for (let i = 0; i < note.steps && note.step + i < steps; i += 1) {
        row[note.step + i] = i === 0 ? "●" : "─";
      }
    }
    return `${noteName(midi).padStart(4)} ${row.join("")}`;
  });
}

function printScore(score: Score, name: string, kind: string, depth: number, steps: number): void {
  const k = score.knobs;
  const tonic = NOTE_NAMES[(TONIC_MIDI + k.rotation) % 12];

  console.log("");
  console.log(`── region ${score.regionId}: ${name} ── ${kind}, depth ${depth}`);
  console.log(
    `   centre ${tonic} (rotation ${k.rotation})  register ${k.registerShift >= 0 ? "+" : ""}${k.registerShift}  ` +
      `density ${k.density.toFixed(2)}  brightness ${k.brightness >= 0 ? "+" : ""}${k.brightness.toFixed(2)}`,
  );
  console.log(
    `   gains  melody ${k.melodyGain.toFixed(2)}  pluck ${k.pluckGain.toFixed(2)}  pad ${k.padGain.toFixed(2)}`,
  );
  console.log(`     ${ruler(steps)}`);

  for (const voice of ["melody", "pluck", "pad", "drone"] as const) {
    const notes = score.notes.filter((n) => n.voice === voice);
    console.log(`   ${voice}:`);
    for (const line of rollFor(notes, steps)) console.log(`  ${line}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const wavIndex = args.indexOf("--wav");
  const wavFile = wavIndex >= 0 ? (args[wavIndex + 1] ?? "music-preview.wav") : null;
  // Guard the -1 case: without it, `indexOf` returning -1 makes `wavIndex + 1`
  // zero and the filter silently eats the seed argument.
  const positional = wavIndex < 0 ? args : args.filter((_, i) => i !== wavIndex && i !== wavIndex + 1);

  const seed = positional[0] ?? "dunhollow";
  const only = positional[1] !== undefined ? Number(positional[1]) : null;
  // One phrase is enough to read the shape; the period is four of them and does
  // not fit a terminal.
  const steps = Math.min(PHRASE_STEPS, PERIOD_STEPS);

  const world = generateWorld(seed);
  const scores = composeWorldScores(seed, world.regions);
  const tempo = [...scores.values()][0]?.tempo ?? 0;

  console.log(`seed "${seed}" — ${world.regions.length} regions`);
  console.log(
    `tempo ${tempo} — eighth ${(stepSeconds(tempo) * 1000).toFixed(0)}ms, ` +
      `bar ${(stepSeconds(tempo) * STEPS_PER_BAR).toFixed(2)}s, ` +
      `phrase ${(stepSeconds(tempo) * PHRASE_STEPS).toFixed(1)}s, ` +
      `period ${(stepSeconds(tempo) * PERIOD_STEPS).toFixed(0)}s`,
  );
  console.log(`collection ${PITCH_CLASSES.map((pc) => NOTE_NAMES[(TONIC_MIDI + pc) % 12]).join(" ")}`);
  console.log(`showing the first phrase of ${PERIOD_STEPS / PHRASE_STEPS}  ( | phrase   : bar )`);

  for (const region of world.regions) {
    if (only !== null && region.id !== only) continue;
    const score = scores.get(region.id);
    if (!score) continue;
    printScore(score, region.name, region.dominantKind, region.depth, steps);
  }

  // The summary that answers the question the roll cannot: are these seven
  // variations on one idea, or seven different pieces?
  console.log("");
  console.log("── coherence ──");
  const centres = new Map<string, string[]>();
  for (const region of world.regions) {
    const score = scores.get(region.id);
    if (!score) continue;
    const tonic = NOTE_NAMES[(TONIC_MIDI + score.knobs.rotation) % 12];
    centres.set(tonic, [...(centres.get(tonic) ?? []), region.name]);
  }
  for (const [tonic, names] of [...centres].sort()) {
    console.log(`   ${tonic.padEnd(3)} ${names.join(", ")}`);
  }
  const allPitches = new Set<number>();
  for (const score of scores.values()) for (const n of score.notes) allPitches.add((((n.midi - TONIC_MIDI) % 12) + 12) % 12);
  console.log(
    `   every region drawn from: ${[...allPitches].sort((a, b) => a - b).map((pc) => NOTE_NAMES[(TONIC_MIDI + pc) % 12]).join(" ")}`,
  );

  if (!wavFile) return;

  // Every region in turn, with the real crossfades, so the tour answers the
  // only question that matters: one piece of music, or seven?
  const ordered = world.regions
    .map((region) => scores.get(region.id))
    .filter((score): score is NonNullable<typeof score> => score !== undefined);
  const samples = renderTour(ordered);
  writeFileSync(wavFile, encodeWav(samples, SAMPLE_RATE));

  console.log("");
  console.log(
    `wrote ${wavFile} — ${(samples.length / SAMPLE_RATE).toFixed(1)}s, ` +
      `${ordered.length} regions with 2.5s crossfades`,
  );
}

main();
