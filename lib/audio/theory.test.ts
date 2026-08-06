import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TILE_KINDS, TILE_SPECS } from "../art/palette";
import {
  MUSIC_CONSTRAINTS,
  PAD_PITCH_CLASSES,
  PITCH_CLASSES,
  REGION_KNOBS,
  ROTATIONS,
  TONIC_MIDI,
  VOICE_NAMES,
  VOICE_SPECS,
  degreeToMidi,
  knobsFor,
  melodyBaseDegree,
  rotationIndex,
  stepSeconds,
  tempoFor,
} from "./theory";
import { CUE_NAMES, cueDuration, cueFor } from "./cues";

/**
 * The audio counterpart of `art/palette.test.ts`. The palette suite exists
 * because the project was abandoned once over art that would not stay coherent
 * across biomes; these exist so the same thing cannot happen to the music, and
 * so "it sounds fine to me" never has to be the evidence.
 */

export function pitchClassOf(midi: number): number {
  return (((midi - TONIC_MIDI) % 12) + 12) % 12;
}

export function inCollection(midi: number): boolean {
  return (PITCH_CLASSES as readonly number[]).includes(pitchClassOf(midi));
}

describe("the pitch collection", () => {
  it("offers every rotation from inside itself", () => {
    // A rotation outside the collection would introduce a pitch the other
    // regions do not have, and the crossfade guarantee would be gone.
    for (const rotation of ROTATIONS) {
      expect(PITCH_CLASSES).toContain(rotation);
    }
  });

  it("withholds the three modes that fall outside the register", () => {
    // Phrygian reads Spanish rather than northern; Locrian's tonic carries a
    // tritone against the F in the set; Lydian's characteristic sharp fourth
    // IS that tritone.
    expect(ROTATIONS).not.toContain(2);
    expect(ROTATIONS).not.toContain(9);
    expect(ROTATIONS).not.toContain(3);
  });

  it("keeps the sustained voices pentatonic", () => {
    // No minor second and no tritone anywhere inside the set, which is the
    // property that makes any two regions safe to crossfade.
    for (const pitchClass of PAD_PITCH_CLASSES) {
      expect(PITCH_CLASSES).toContain(pitchClass);
    }
    for (const a of PAD_PITCH_CLASSES) {
      for (const b of PAD_PITCH_CLASSES) {
        if (a === b) continue;
        const semitones = Math.abs(a - b) % 12;
        const intervalClass = Math.min(semitones, 12 - semitones);
        expect(intervalClass, `${a} vs ${b}`).not.toBe(1);
        expect(intervalClass, `${a} vs ${b}`).not.toBe(6);
      }
    }
  });

  it("lets every rotation cadence on its own home", () => {
    // ROTATIONS must stay a subset of what the pads may hold, or a region
    // would be unable to rest on the note it is named for.
    for (const rotation of ROTATIONS) {
      expect(PAD_PITCH_CLASSES, `rotation ${rotation}`).toContain(rotation);
    }
  });

  it("resolves every degree, however far out, back into the collection", () => {
    for (let home = 0; home < PITCH_CLASSES.length; home += 1) {
      for (let degree = -40; degree <= 40; degree += 1) {
        const midi = degreeToMidi(home, degree);
        expect(inCollection(midi), `home ${home} degree ${degree} -> ${midi}`).toBe(true);
      }
    }
  });

  it("keeps degrees monotonic, so a rising line rises", () => {
    for (let home = 0; home < PITCH_CLASSES.length; home += 1) {
      for (let degree = -20; degree < 20; degree += 1) {
        expect(degreeToMidi(home, degree + 1)).toBeGreaterThan(degreeToMidi(home, degree));
      }
    }
  });

  it("rejects a rotation that is not a member", () => {
    expect(() => rotationIndex(1)).toThrow();
    expect(() => rotationIndex(6)).toThrow();
  });
});

describe("region knobs", () => {
  it("covers every terrain the game is able to generate", () => {
    // The guard that stops a twelfth tile kind arriving without music.
    expect(Object.keys(REGION_KNOBS)).toHaveLength(TILE_SPECS.length);
    for (const kind of TILE_KINDS) {
      expect(REGION_KNOBS[kind], kind).toBeDefined();
    }
  });

  it("only ever rotates to a sanctioned centre", () => {
    for (const kind of TILE_KINDS) {
      expect(ROTATIONS, kind).toContain(REGION_KNOBS[kind].rotation);
    }
  });

  it("darkens and thins monotonically with distance from the shore", () => {
    for (const kind of TILE_KINDS) {
      for (let depth = 1; depth <= 8; depth += 1) {
        const previous = knobsFor(kind, depth - 1);
        const current = knobsFor(kind, depth);
        expect(current.brightness, `${kind} depth ${depth}`).toBeLessThanOrEqual(previous.brightness);
        expect(current.density, `${kind} depth ${depth}`).toBeLessThanOrEqual(previous.density);
      }
    }
  });

  it("never thins a region into silence", () => {
    for (const kind of TILE_KINDS) {
      expect(knobsFor(kind, 99).density, kind).toBeGreaterThan(0.1);
    }
  });

  it("leaves the drone audible in every region", () => {
    // A region may lean on the pedal. It may not remove it - that is what makes
    // two regions in different modes read as one landscape.
    for (const kind of TILE_KINDS) {
      const shifted = VOICE_SPECS.drone.cutoffHz + REGION_KNOBS[kind].droneCutoffShift;
      expect(shifted, kind).toBeGreaterThan(150);
    }
  });
});

describe("voice registers", () => {
  it("sits inside the global note range", () => {
    for (const name of VOICE_NAMES) {
      const spec = VOICE_SPECS[name];
      expect(spec.midiMin, name).toBeGreaterThanOrEqual(MUSIC_CONSTRAINTS.midiMin);
      expect(spec.midiMax, name).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.midiMax);
      // Narrower than an octave and folding could not place a pitch class at all.
      expect(spec.midiMax - spec.midiMin, name).toBeGreaterThanOrEqual(12);
    }
  });

  it("gives the melody room for the contour at every rotation", () => {
    // If this fails the melody starts octave-folding, which preserves pitch
    // class but wrecks the shared contour - the failure this range exists to
    // prevent, and one that would be inaudible as "wrong notes".
    // The widest the composer can reach: the contour (0..5 degrees) plus the
    // most extreme register shift in REGION_KNOBS, the phrase-B lift, and the
    // one-degree wander, in both directions.
    const shifts = TILE_KINDS.map((kind) => REGION_KNOBS[kind].registerShift);
    const lowOffset = 0 + Math.min(...shifts) + 0 - 1;
    const highOffset = 5 + Math.max(...shifts) + 2 + 1;

    const melody = VOICE_SPECS.melody;
    const pluck = VOICE_SPECS.pluck;
    for (const rotation of ROTATIONS) {
      const home = rotationIndex(rotation);
      const base = melodyBaseDegree(home);
      expect(degreeToMidi(home, base + lowOffset), `rotation ${rotation} low`).toBeGreaterThanOrEqual(melody.midiMin);
      expect(degreeToMidi(home, base + highOffset), `rotation ${rotation} high`).toBeLessThanOrEqual(melody.midiMax);
      // The pluck answers a third below, and occasionally a fourth.
      expect(degreeToMidi(home, base + lowOffset - 3), `rotation ${rotation} pluck low`).toBeGreaterThanOrEqual(pluck.midiMin);
      expect(degreeToMidi(home, base + highOffset - 2), `rotation ${rotation} pluck high`).toBeLessThanOrEqual(pluck.midiMax);
    }
  });
});

describe("tempo", () => {
  it("stays inside the band over a thousand seeds", () => {
    for (let i = 0; i < 1000; i += 1) {
      const tempo = tempoFor(`seed-${i}`);
      expect(tempo).toBeGreaterThanOrEqual(MUSIC_CONSTRAINTS.tempoMin);
      expect(tempo).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.tempoMax);
      expect(Number.isInteger(tempo)).toBe(true);
    }
  });

  it("uses the whole band rather than clustering", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) seen.add(tempoFor(`seed-${i}`));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("is one draw per world, not per region", () => {
    expect(tempoFor("dunhollow")).toBe(tempoFor("dunhollow"));
  });
});

describe("cues", () => {
  const tempos = [MUSIC_CONSTRAINTS.tempoMin, 63, MUSIC_CONSTRAINTS.tempoMax];

  it("stays in the collection whatever the region rotation", () => {
    for (const rotation of ROTATIONS) {
      const home = rotationIndex(rotation);
      for (const name of CUE_NAMES) {
        for (const tempo of tempos) {
          for (const cue of cueFor(name, home, tempo)) {
            expect(inCollection(cue.midi), `${name} @ rotation ${rotation}`).toBe(true);
            expect(cue.midi).toBeGreaterThanOrEqual(MUSIC_CONSTRAINTS.midiMin);
            expect(cue.midi).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.midiMax);
            expect(cue.velocity).toBeGreaterThanOrEqual(MUSIC_CONSTRAINTS.velMin);
            expect(cue.velocity).toBeLessThanOrEqual(MUSIC_CONSTRAINTS.velMax);
          }
        }
      }
    }
  });

  it("keeps feedback short, and lets only the ending be music", () => {
    const home = rotationIndex(0);
    const slowest = MUSIC_CONSTRAINTS.tempoMin;
    for (const name of CUE_NAMES) {
      const length = cueDuration(cueFor(name, home, slowest));
      if (name === "win") expect(length).toBeGreaterThan(2.5);
      else expect(length, name).toBeLessThanOrEqual(2.5);
    }
  });
});

describe("the pure layer stays pure", () => {
  // The one test that catches the regression that would matter: if Web Audio
  // reached these files, `lib/game/loop.ts` would drag an AudioContext into the
  // headless playthrough suite and the whole node-environment test run with it.
  it.each(["theory.ts", "score.ts", "cues.ts", "clock.ts", "offline.ts"])("%s never touches Web Audio", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    // Comments in these files discuss Web Audio at length - explaining why the
    // scheduler works the way it does is most of why `clock.ts` is readable -
    // so the guard is against calling it, not against naming it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/AudioContext|createOscillator|webkitAudio|OfflineAudio/);
  });
});

describe("the shared clock", () => {
  it("puts six eighths in a bar at the stated tempo", () => {
    // Tempo is dotted-quarter BPM, two to the 6/8 bar.
    expect(stepSeconds(60) * 6).toBeCloseTo(2.0, 6);
    expect(stepSeconds(120) * 6).toBeCloseTo(1.0, 6);
  });
});
