import { describe, expect, it } from "vitest";
import { TILE_KINDS, type TileKind } from "../art/palette";
import { generateWorld } from "../world/gen";
import {
  MUSIC_CONSTRAINTS,
  PAD_PITCH_CLASSES,
  PERIOD_STEPS,
  PHRASE_BARS,
  PHRASE_STEPS,
  STEPS_PER_BAR,
  STEP_WEIGHT,
  VOICE_SPECS,
  DRONE,
  tempoFor,
} from "./theory";
import { composeRegion, composeWorldScores, peakPolyphony, soundingByStep, type Score } from "./score";
import { inCollection, pitchClassOf } from "./theory.test";

/**
 * Property assertions over the composer, in the spirit of `palette.test.ts`:
 * the guarantee is that off-style music is unreachable, and it is checked by
 * sweeping seeds rather than by listening to one.
 */

const SEEDS = Array.from({ length: 120 }, (_, i) => `music-seed-${i}`);

function scoresFor(kind: TileKind, depth = 0, seeds: readonly string[] = SEEDS): Score[] {
  return seeds.map((seed) => composeRegion(seed, { id: 0, dominantKind: kind, depth }));
}

describe("every note the composer can write", () => {
  it.each(TILE_KINDS)("%s stays inside the box", (kind) => {
    for (const score of scoresFor(kind, 0, SEEDS.slice(0, 40))) {
      expect(score.notes.length).toBeGreaterThan(0);
      for (const note of score.notes) {
        expect(inCollection(note.midi), `${kind} ${note.voice} ${note.midi}`).toBe(true);
        expect(note.midi).toBeGreaterThanOrEqual(MUSIC_CONSTRAINTS.midiMin);
        expect(note.midi).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.midiMax);
        expect(note.velocity).toBeGreaterThanOrEqual(MUSIC_CONSTRAINTS.velMin);
        expect(note.velocity).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.velMax);
        expect(note.steps).toBeGreaterThanOrEqual(1);
        expect(note.step).toBeGreaterThanOrEqual(0);
        expect(note.step + note.steps).toBeLessThanOrEqual(PERIOD_STEPS);
      }
    }
  });

  it("admits nothing at full velocity anywhere", () => {
    // The line that keeps this contemplative rather than chiptune, and the
    // direct counterpart of the palette's saturation cap.
    for (const kind of TILE_KINDS) {
      for (const score of scoresFor(kind, 0, SEEDS.slice(0, 20))) {
        for (const note of score.notes) expect(note.velocity, kind).toBeLessThan(0.9);
      }
    }
  });

  it("keeps each note inside its own voice's register", () => {
    for (const kind of TILE_KINDS) {
      for (const score of scoresFor(kind, 0, SEEDS.slice(0, 20))) {
        for (const note of score.notes) {
          const spec = VOICE_SPECS[note.voice];
          expect(note.midi, `${kind} ${note.voice}`).toBeGreaterThanOrEqual(spec.midiMin);
          expect(note.midi, `${kind} ${note.voice}`).toBeLessThanOrEqual(spec.midiMax);
        }
      }
    }
  });
});

describe("harmony", () => {
  it("never sounds the one tritone in the collection", () => {
    // F against B is reachable inside a diatonic set, and it is the interval
    // that would break the claim that any two region themes can be crossfaded
    // without preparation. The composer nudges around it; this proves it.
    for (const kind of TILE_KINDS) {
      for (const score of scoresFor(kind, 0, SEEDS.slice(0, 25))) {
        for (const sounding of soundingByStep(score)) {
          for (let i = 0; i < sounding.length; i += 1) {
            for (let j = i + 1; j < sounding.length; j += 1) {
              const interval = Math.abs(sounding[i].midi - sounding[j].midi) % 12;
              expect(interval, `${kind}: ${sounding[i].midi} vs ${sounding[j].midi}`).not.toBe(6);
            }
          }
        }
      }
    }
  });

  it("stays under the polyphony ceiling", () => {
    // Aesthetic constraint and CPU bound at once: this is the hard bound on how
    // many oscillators the engine can ever have running.
    for (const kind of TILE_KINDS) {
      for (const score of scoresFor(kind, 0, SEEDS.slice(0, 30))) {
        expect(peakPolyphony(score), kind).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.maxSounding);
      }
    }
  });
});

describe("the drone", () => {
  it("is unconditional, in every region and at every depth", () => {
    for (const kind of TILE_KINDS) {
      for (const depth of [0, 3, 6]) {
        const score = composeRegion("dunhollow", { id: 0, dominantKind: kind, depth });
        const covered = new Set<number>();
        for (const note of score.notes) {
          if (note.voice !== "drone") continue;
          for (let step = note.step; step < note.step + note.steps; step += 1) covered.add(step);
        }
        expect(covered.size / PERIOD_STEPS, `${kind} depth ${depth}`).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it("holds the tonic and its fifth, and nothing else", () => {
    const allowed = new Set(DRONE.midi.map(pitchClassOf));
    expect([...allowed].sort((a, b) => a - b)).toEqual([0, 7]);
    for (const kind of TILE_KINDS) {
      for (const score of scoresFor(kind, 0, SEEDS.slice(0, 10))) {
        for (const note of score.notes) {
          if (note.voice !== "drone") continue;
          expect(allowed.has(pitchClassOf(note.midi)), kind).toBe(true);
        }
      }
    }
  });
});

describe("one shared rhythm", () => {
  it("puts every region's accents in the same places", () => {
    // Regions supply a density multiplier, never their own accent pattern.
    // Aggregated across seeds so a sparse region is not judged on noise.
    for (const kind of TILE_KINDS) {
      const histogram = new Array<number>(STEPS_PER_BAR).fill(0);
      for (const score of scoresFor(kind)) {
        for (const note of score.notes) {
          if (note.voice !== "melody") continue;
          histogram[note.step % STEPS_PER_BAR] += 1;
        }
      }

      const strongest = histogram.indexOf(Math.max(...histogram));
      expect(strongest, `${kind}: ${histogram.join(",")}`).toBe(0);

      // The ordering of the rest should follow the shared weights too.
      const weakest = histogram.indexOf(Math.min(...histogram));
      expect(STEP_WEIGHT[weakest], `${kind}: ${histogram.join(",")}`).toBe(Math.min(...STEP_WEIGHT));
    }
  });
});

describe("one shared contour", () => {
  /** Mean melody pitch per bar of the opening phrase, aggregated over seeds. */
  function contourShape(kind: TileKind): number[] {
    const sums = new Array<number>(PHRASE_BARS).fill(0);
    const counts = new Array<number>(PHRASE_BARS).fill(0);
    for (const score of scoresFor(kind)) {
      for (const note of score.notes) {
        if (note.voice !== "melody" || note.step >= PHRASE_STEPS) continue;
        const bar = Math.floor(note.step / STEPS_PER_BAR);
        sums[bar] += note.midi;
        counts[bar] += 1;
      }
    }
    const mean = sums.reduce((a, b) => a + b, 0) / Math.max(1, counts.reduce((a, b) => a + b, 0));
    return sums.map((sum, i) => (counts[i] ? sum / counts[i] - mean : Number.NaN));
  }

  it("gives every unclamped region the same melodic shape", () => {
    // The direct analog of the palette suite's "same contrast shape for every
    // biome". Regions contribute a register OFFSET, never their own curve, so
    // subtracting each region's own mean should leave one shared arc. Regions
    // whose extremes octave-fold are excluded for the same reason the palette
    // suite excludes biomes whose ramps clamp.
    const shapes = new Map(TILE_KINDS.map((kind) => [kind, contourShape(kind)]));
    const unclamped = TILE_KINDS.filter((kind) => shapes.get(kind)!.every((v) => Number.isFinite(v)));
    expect(unclamped.length).toBeGreaterThan(4);

    const reference = shapes.get(unclamped[0])!;
    for (const kind of unclamped.slice(1)) {
      shapes.get(kind)!.forEach((value, bar) => {
        // Within a scale degree of the reference arc. Regions differ in how
        // densely they fill a bar, so the per-bar means are sampled unevenly;
        // a degree of slack absorbs that without admitting a different shape.
        expect(Math.abs(value - reference[bar]), `${kind} bar ${bar}`).toBeLessThan(2);
      });
    }
  });

  it("actually rises to a peak rather than sitting flat", () => {
    // Guards against the arc collapsing to noise, which would make the
    // assertion above pass for the wrong reason.
    const shape = contourShape("woodland");
    expect(Math.max(...shape) - Math.min(...shape)).toBeGreaterThan(2);
    expect(shape.indexOf(Math.max(...shape))).toBeGreaterThan(2);
  });
});

describe("determinism", () => {
  it("gives one seed the same music every time", () => {
    const once = composeRegion("dunhollow", { id: 3, dominantKind: "moor", depth: 2 });
    const twice = composeRegion("dunhollow", { id: 3, dominantKind: "moor", depth: 2 });
    expect(once).toEqual(twice);
  });

  it("gives different seeds different music", () => {
    let identical = 0;
    for (let i = 0; i < 200; i += 1) {
      const a = composeRegion(`pair-a-${i}`, { id: 0, dominantKind: "woodland", depth: 1 });
      const b = composeRegion(`pair-b-${i}`, { id: 0, dominantKind: "woodland", depth: 1 });
      if (JSON.stringify(a.notes) === JSON.stringify(b.notes)) identical += 1;
    }
    expect(identical / 200).toBeLessThan(0.05);
  });

  it("gives sibling regions of one world different music", () => {
    // Regions are separate streams, so neighbours must not come out in unison.
    const a = composeRegion("dunhollow", { id: 0, dominantKind: "woodland", depth: 1 });
    const b = composeRegion("dunhollow", { id: 1, dominantKind: "woodland", depth: 1 });
    expect(JSON.stringify(a.notes)).not.toBe(JSON.stringify(b.notes));
  });

  it("gives every region of one world the same tempo", () => {
    const world = generateWorld("dunhollow");
    const scores = composeWorldScores("dunhollow", world.regions);
    for (const score of scores.values()) expect(score.tempo).toBe(tempoFor("dunhollow"));
  });
});

describe("crossfade compatibility", () => {
  it("lets any two regions of a real world overlap without preparation", () => {
    // Thirty generated worlds, so the assertion runs against region shapes the
    // generator actually produces rather than ones invented for the test.
    for (let i = 0; i < 30; i += 1) {
      const seed = `crossfade-${i}`;
      const world = generateWorld(seed);
      const scores = [...composeWorldScores(seed, world.regions).values()];
      expect(scores.length).toBeGreaterThan(1);

      for (const score of scores) {
        for (const note of score.notes) expect(inCollection(note.midi), seed).toBe(true);
      }

      // The sustained voices are what define the harmony during a fade, and
      // they are the ones that must not clash: a transient melody note crossing
      // another at a tritone for a moment is a colour, but two pads holding a
      // minor second for two and a half seconds is a mistake.
      //
      // Compared as pitch-class SETS rather than step by step, because a fade
      // can begin on any step: every note either region can sustain has to be
      // safe against every note the other can, at any alignment, not merely at
      // the alignments this particular pair of loops happens to produce.
      const sustainedOf = (score: Score) =>
        new Set(
          score.notes
            .filter((note) => note.voice === "pad" || note.voice === "drone")
            .map((note) => pitchClassOf(note.midi)),
        );

      const sustained = scores.map(sustainedOf);
      for (const set of sustained) {
        for (const pitchClass of set) {
          expect(PAD_PITCH_CLASSES, `${seed} sustains ${pitchClass}`).toContain(pitchClass);
        }
      }

      for (let a = 0; a < sustained.length; a += 1) {
        for (let b = a + 1; b < sustained.length; b += 1) {
          for (const l of sustained[a]) {
            for (const r of sustained[b]) {
              const semitones = Math.abs(l - r) % 12;
              const intervalClass = Math.min(semitones, 12 - semitones);
              expect(intervalClass, `${seed}: ${l} vs ${r}`).not.toBe(1);
              expect(intervalClass, `${seed}: ${l} vs ${r}`).not.toBe(6);
            }
          }
        }
      }
    }
  });
});
