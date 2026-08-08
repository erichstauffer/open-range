/**
 * The musical constraint box.
 *
 * This is `lib/art/palette.ts` for sound, and it exists for the same reason.
 * Terrain art would not hold a consistent look across biomes until every colour
 * was forced to come out of one constrained space; music has exactly the same
 * failure mode, and a per-region theme written freehand would wander out of key
 * the moment two of them overlapped in a crossfade.
 *
 * So a region does not get to choose its notes. It gets:
 *
 *   - a ROTATION, which is only a choice of which note of one fixed collection
 *     it comes to rest on. Not a different scale - the same seven pitch classes
 *     heard from a different angle.
 *   - a register offset applied to ONE contour every region shares
 *   - a density multiplier applied to ONE bar rhythm every region shares
 *   - voice gains and a brightness offset
 *
 * Because the pitch collection is fixed world-wide, two region themes can be
 * crossfaded into each other without preparation and the result is still in
 * one key. That is the same argument the palette makes about its hue arc: both
 * endpoints are inside a contiguous set, so everything between them is too.
 *
 * Worth being exact about what that does and does not promise. It guarantees
 * the overlap is diatonic, never bitonal, and - because a pad may only rest on
 * a pitch some region could rotate to, see `padRootDegrees` in `score.ts` - the
 * two sustained voices are at worst a major second apart. It does not promise
 * that two transient melody notes never cross at a tritone during the two and
 * a half seconds of a fade. They can, and at these velocities under this much
 * reverb that is a colour rather than a clash. Within a single theme the
 * tritone is avoided outright.
 *
 * Nothing in this file knows what an `AudioContext` is. That is deliberate: it
 * keeps the composition layer testable under the `node` environment the rest of
 * the suite runs in, and keeps `lib/game/loop.ts` from ever pulling Web Audio
 * into the headless playthrough test.
 */

import { makeRng, randInt } from "../rand";
import type { TileKind } from "../art/palette";

/** D3. Low enough that the drone has weight, high enough to leave room above. */
export const TONIC_MIDI = 50;

/**
 * D Dorian, as semitone offsets from the tonic.
 *
 * Dorian rather than natural minor. The minor tonic with a raised sixth is the
 * English and Celtic folk sound; plain Aeolian is the default of every sad
 * videogame cue ever written. This is the pitch-domain equivalent of the
 * palette's "no pure reds, no magentas".
 */
export const PITCH_CLASSES = [0, 2, 3, 5, 7, 9, 10] as const;

/**
 * The tonal centres a region may rest on, as semitone offsets from the tonic:
 * D Dorian, G Mixolydian, A Aeolian, C Ionian.
 *
 * Every one is itself a member of `PITCH_CLASSES`, which is what keeps a
 * rotation from introducing a pitch the other regions do not have.
 *
 * Three of the seven are withheld, and that omission is the `hueMin`/`hueMax`
 * cut. E would be Phrygian, which reads Spanish rather than northern. B would
 * be Locrian, whose tonic carries a tritone against the F already in the set.
 * F would be Lydian, and it goes for a subtler reason worth writing down:
 * Lydian's characteristic note - the sharp fourth that makes it sound like
 * altitude - is B, which is exactly F's tritone partner. The one mode whose
 * whole appeal is the interval this collection has to avoid cannot be kept.
 */
export const ROTATIONS = [0, 5, 7, 10] as const;

/**
 * The pitches the sustained voices are allowed to hold: D, E, G, A, C.
 *
 * A pentatonic subset, and chosen for the property that makes pentatonic scales
 * what they are - it contains no minor second and no tritone, so *any* two of
 * these notes sound together without preparation. Dropping F and B drops both
 * halves of the collection's only tritone at once.
 *
 * This is what actually makes a crossfade safe. The melody is transient and can
 * be left free inside the full collection; the drone and pad are held for
 * seconds at a time, and during a fade two regions' worth of them overlap. Two
 * pads a minor second apart for the length of a fade is a mistake a listener
 * would notice immediately, and no amount of per-region care would prevent it -
 * only a shared restriction on what may be sustained does.
 */
export const PAD_PITCH_CLASSES = [0, 2, 5, 7, 10] as const;

/** The hard box. Nothing in the game may produce a note outside this. */
export const MUSIC_CONSTRAINTS = {
  midiMin: 36,
  midiMax: 84,
  /**
   * Nothing ever plays at full velocity. This is the `satMax` line: the single
   * most important constraint for tone, and the whole difference between
   * contemplative and chiptune.
   */
  velMin: 0.08,
  velMax: 0.85,
  tempoMin: 54,
  tempoMax: 72,
  /** Aesthetic ceiling, and simultaneously the hard bound on oscillator count. */
  maxSounding: 6,
} as const;

// --- The shared clock -------------------------------------------------------

/** 6/8. Compound duple is the folk lilt; 4/4 would read as march or as pop. */
export const STEPS_PER_BAR = 6;
export const PHRASE_BARS = 8;
/** Four phrases - A A' B A'' - before anything repeats literally. */
export const PERIOD_BARS = 32;

export const PHRASE_STEPS = PHRASE_BARS * STEPS_PER_BAR;
export const PERIOD_STEPS = PERIOD_BARS * STEPS_PER_BAR;

/** Seconds per eighth note. `tempo` is dotted-quarter BPM, two to the bar. */
export function stepSeconds(tempo: number): number {
  return 60 / (tempo * 3);
}

/**
 * Tempo belongs to the WORLD, not to the region.
 *
 * Every region theme therefore rides one bar clock, which is what makes a
 * crossfade a non-event: there are never two tempos or two downbeats to
 * reconcile, and the incoming theme can enter on the step index the outgoing
 * one is already on. This is the palette's shared-lightness-curve decision
 * applied to time.
 */
export function tempoFor(seed: string): number {
  return randInt(makeRng(seed, "music:tempo"), MUSIC_CONSTRAINTS.tempoMin, MUSIC_CONSTRAINTS.tempoMax);
}

// --- The shared curves ------------------------------------------------------

/**
 * One value per bar of a phrase: where the melody sits in its range, as a
 * fraction. Rises to a peak in the fifth bar and settles back - the shape of a
 * sung line rather than of a loop.
 *
 * Every region follows this. A region contributes an OFFSET, never its own
 * curve, which is exactly what `lightShift` does to the lightness ramp and
 * exactly why a snowfield theme and a meadow theme read as one piece of music.
 */
export const PHRASE_CONTOUR = [0, 0.25, 0.5, 0.35, 0.7, 0.55, 0.3, 0.05] as const;

/** Scale degrees from the trough of the contour to its peak. */
export const CONTOUR_SPAN = 7;

/**
 * Where the melody sits before the contour moves it, as a scale degree.
 *
 * Subtracting `home` is what keeps the register the same whichever rotation a
 * region uses: without it, a theme rotated to C would sit most of an octave
 * above one rotated to D purely as an artefact of counting degrees from the
 * tonic, and the higher regions would read as a different instrument rather
 * than as the same one in a different mode.
 */
export function melodyBaseDegree(home: number): number {
  return 8 - home;
}

/**
 * How likely each eighth of a bar is to carry an onset. Downbeat strongest, the
 * fourth eighth - the second dotted-quarter pulse - next. Shared by every
 * region and every voice, so the whole world agrees about where the beat is.
 */
export const STEP_WEIGHT = [1.0, 0.25, 0.45, 0.8, 0.3, 0.5] as const;

// --- The atmosphere ---------------------------------------------------------

/**
 * The unifying tint, and the audio counterpart of `ATMOSPHERE`.
 *
 * An unbroken tonic-and-fifth pedal under every region, always. A region may
 * lean on it - see `droneCutoffShift` - but may not silence it and may not move
 * its pitch. The drone rather than the reverb is what actually unifies: it is
 * the reason A Aeolian in one region and C Ionian in the next are heard as two
 * views of one landscape instead of as two different songs.
 */
export const DRONE = {
  midi: [38, 45] as const,
  gain: 0.22,
  cutoffHz: 380,
  reverbSend: 0.3,
} as const;

/** Every voice sends at least this much to the shared space. */
export const REVERB_SEND_FLOOR = 0.18;

export type VoiceName = "drone" | "pad" | "melody" | "pluck";

export interface VoiceSpec {
  readonly name: VoiceName;
  /** Oscillator types summed for one note. Two is the most any voice uses. */
  readonly waves: readonly OscillatorType[];
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  /** Lowpass on the voice BUS, not per note - four filters exist in total. */
  readonly cutoffHz: number;
  readonly q: number;
  /** Inclusive MIDI range this voice is allowed to occupy. */
  readonly midiMin: number;
  readonly midiMax: number;
  readonly reverbSend: number;
}

export const VOICE_SPECS: Readonly<Record<VoiceName, VoiceSpec>> = {
  drone: {
    name: "drone",
    waves: ["sine", "triangle"],
    attack: 3.0,
    decay: 0,
    sustain: 1.0,
    release: 4.0,
    cutoffHz: DRONE.cutoffHz,
    q: 0.7,
    midiMin: 36,
    midiMax: 50,
    reverbSend: DRONE.reverbSend,
  },
  pad: {
    name: "pad",
    waves: ["triangle"],
    attack: 1.2,
    decay: 0.8,
    sustain: 0.6,
    release: 2.5,
    cutoffHz: 900,
    q: 0.8,
    midiMin: 50,
    midiMax: 69,
    reverbSend: 0.34,
  },
  melody: {
    name: "melody",
    waves: ["sawtooth"],
    attack: 0.02,
    decay: 0.25,
    sustain: 0.5,
    release: 0.4,
    cutoffHz: 1600,
    q: 1.4,
    // Wide enough that the shared contour plus a region's register offset fits
    // without octave-folding. Folding preserves pitch class but destroys the
    // contour, which is the one thing every region is supposed to have in
    // common - so the range is sized to make folding the rare safety net it is
    // meant to be rather than a routine occurrence.
    midiMin: 55,
    midiMax: 84,
    reverbSend: 0.26,
  },
  pluck: {
    name: "pluck",
    waves: ["triangle"],
    attack: 0.004,
    decay: 0.6,
    sustain: 0.0,
    release: 0.15,
    cutoffHz: 2200,
    q: 1.0,
    // A diatonic third below the melody, and sized to match it for the same
    // reason.
    midiMin: 50,
    midiMax: 79,
    reverbSend: 0.22,
  },
} as const;

export const VOICE_NAMES: readonly VoiceName[] = ["drone", "pad", "melody", "pluck"];

// --- Pitch ------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Index into `PITCH_CLASSES` for a rotation.
 *
 * Throws rather than falling back, because a rotation outside the collection is
 * the one bug in this file that would be inaudible in testing and wrong in
 * every crossfade.
 */
export function rotationIndex(rotation: number): number {
  const index = PITCH_CLASSES.indexOf(rotation as (typeof PITCH_CLASSES)[number]);
  if (index < 0) throw new Error(`Rotation ${rotation} is not in the pitch collection`);
  return index;
}

/**
 * Resolve a scale degree to a MIDI note.
 *
 * `degree` is counted in steps of the collection, not semitones, and may be
 * negative or run past an octave; it wraps through `PITCH_CLASSES` and carries
 * the octave with it. Because the wrap is the only way a pitch is ever
 * produced, the result's pitch class is a member of the collection by
 * construction - which is the property `theory.test.ts` pins down.
 */
export function degreeToMidi(homeIndex: number, degree: number): number {
  const absolute = homeIndex + degree;
  const octave = Math.floor(absolute / PITCH_CLASSES.length);
  const index = absolute - octave * PITCH_CLASSES.length;
  return TONIC_MIDI + PITCH_CLASSES[index] + 12 * octave;
}

/** Fold a note into a voice's register by octaves, so its pitch class survives. */
export function foldIntoRange(midi: number, spec: VoiceSpec): number {
  let folded = midi;
  while (folded < spec.midiMin) folded += 12;
  while (folded > spec.midiMax) folded -= 12;
  // A range narrower than an octave could oscillate; clamping by octave keeps
  // the pitch class, which matters more here than the exact register.
  while (folded < spec.midiMin) folded += 12;
  return clamp(folded, MUSIC_CONSTRAINTS.midiMin, MUSIC_CONSTRAINTS.midiMax);
}

export function clampVelocity(velocity: number): number {
  return clamp(velocity, MUSIC_CONSTRAINTS.velMin, MUSIC_CONSTRAINTS.velMax);
}

// --- What a region is allowed to choose -------------------------------------

export interface RegionKnobs {
  /** Semitone offset of the tonal centre. Always a member of `ROTATIONS`. */
  rotation: number;
  /**
   * Scale degrees added to the shared contour.
   *
   * Kept inside roughly half an octave on purpose. A wider spread would be more
   * characterful per region and would push the extremes out of the melody's
   * register, where octave-folding would wrap them and flatten the very contour
   * the regions are supposed to share.
   */
  registerShift: number;
  /** 0..1, multiplies `STEP_WEIGHT`. */
  density: number;
  melodyGain: number;
  pluckGain: number;
  padGain: number;
  /** Octaves added to every bus cutoff. The `lightShift` analog. */
  brightness: number;
  /** Hz added to the drone's own filter. Bounded, so the pedal never vanishes. */
  droneCutoffShift: number;
}

/**
 * The `TILE_SPECS` analog: one row per terrain, and a region takes the row of
 * its dominant terrain. Eleven kinds over five rotations means reuse, which is
 * correct - biomes reuse hue neighbourhoods for the same reason.
 */
export const REGION_KNOBS: Readonly<Record<TileKind, RegionKnobs>> = {
  // Almost nothing but the pedal. You are not meant to be out here.
  deepWater: { rotation: 0, registerShift: -4, density: 0.2, melodyGain: 0.25, pluckGain: 0.0, padGain: 1.0, brightness: -0.55, droneCutoffShift: -120 },
  shallowWater: { rotation: 0, registerShift: -2, density: 0.32, melodyGain: 0.4, pluckGain: 0.2, padGain: 0.9, brightness: -0.25, droneCutoffShift: -60 },
  // Where you wake up, so it has to be the most legible statement of the theme.
  shore: { rotation: 7, registerShift: 0, density: 0.5, melodyGain: 0.75, pluckGain: 0.45, padGain: 0.7, brightness: 0.2, droneCutoffShift: 40 },
  // Ionian is the brightest thing the collection can reach. Reserved for grass.
  meadow: { rotation: 10, registerShift: 1, density: 0.62, melodyGain: 0.9, pluckGain: 0.55, padGain: 0.6, brightness: 0.45, droneCutoffShift: 90 },
  // Mixolydian's flat seventh is the heather.
  moor: { rotation: 5, registerShift: -1, density: 0.42, melodyGain: 0.7, pluckGain: 0.25, padGain: 0.85, brightness: -0.1, droneCutoffShift: -20 },
  woodland: { rotation: 5, registerShift: 0, density: 0.55, melodyGain: 0.65, pluckGain: 0.7, padGain: 0.75, brightness: 0.0, droneCutoffShift: 0 },
  // Altitude and air, taken from register and sparseness rather than from
  // Lydian, which this collection cannot safely offer.
  highland: { rotation: 10, registerShift: 2, density: 0.36, melodyGain: 0.8, pluckGain: 0.15, padGain: 0.8, brightness: 0.3, droneCutoffShift: 60 },
  snow: { rotation: 0, registerShift: 3, density: 0.22, melodyGain: 0.35, pluckGain: 0.3, padGain: 1.0, brightness: 0.1, droneCutoffShift: 30 },
  river: { rotation: 7, registerShift: -1, density: 0.58, melodyGain: 0.55, pluckGain: 0.8, padGain: 0.65, brightness: 0.05, droneCutoffShift: 10 },
  cliff: { rotation: 0, registerShift: -3, density: 0.28, melodyGain: 0.45, pluckGain: 0.1, padGain: 1.0, brightness: -0.45, droneCutoffShift: -100 },
  bramble: { rotation: 7, registerShift: -2, density: 0.66, melodyGain: 0.35, pluckGain: 0.75, padGain: 0.9, brightness: -0.35, droneCutoffShift: -80 },
};

/**
 * The town, which is the one place in the world that is not weather.
 *
 * Light-hearted, and light-hearted from INSIDE the constraint box rather than by
 * escaping it - which is the whole argument this file makes. Nothing here is a
 * pitch the island does not already have:
 *
 *  - `rotation: 10` is C Ionian, the brightest rotation the collection can
 *    reach. It is the same major sound already reserved for meadow, so a town
 *    and the grass around it are related rather than contrasting.
 *  - the density is the highest in the game and the pluck is at full gain,
 *    because busyness rather than key is what actually reads as cheerful. A
 *    street has more happening in it than a moor does.
 *  - the pad drops back. Sustained chords are what make the island sound vast,
 *    and a room should not sound vast.
 *  - the drone stays, at a brighter cutoff. It may not be silenced - the pedal
 *    under every region is the reason a town sounds like somewhere on this
 *    island rather than like a different game.
 *
 * Not in `REGION_KNOBS`, because a town is not a terrain and never gets picked
 * by dominant kind. It is chosen by walking through a door.
 */
export const TOWN_KNOBS: RegionKnobs = {
  rotation: 10,
  registerShift: 2,
  density: 0.78,
  melodyGain: 0.95,
  pluckGain: 0.9,
  padGain: 0.45,
  brightness: 0.6,
  droneCutoffShift: 120,
};

/** Distance from the start region stops mattering past here. */
const DEPTH_CEILING = 5;

/**
 * Resolve the knobs for a region.
 *
 * Depth folds in monotonically, so the island darkens and quietens the further
 * you get from the shore you woke on. It is a small effect per step and a
 * noticeable one across a whole map, which is the same way `lightShift` works.
 */
export function knobsFor(kind: TileKind, depth: number): RegionKnobs {
  const base = REGION_KNOBS[kind];
  const d = clamp(depth, 0, DEPTH_CEILING);
  return {
    ...base,
    brightness: base.brightness - 0.06 * d,
    density: Math.max(0.12, base.density - 0.02 * d),
  };
}
