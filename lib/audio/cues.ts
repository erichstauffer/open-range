/**
 * One-shot motifs for game events.
 *
 * Built out of `theory.ts` helpers rather than written as literal pitches, so a
 * cue is drawn from the same collection the music is and cannot clash with
 * whatever region theme happens to be playing underneath it. A cue takes the
 * active region's `home` index, so it lands in the local mode rather than
 * always cadencing on D.
 *
 * Times are in seconds from the moment the cue fires, not in steps. Cues are
 * feedback, so they play immediately rather than waiting for the next eighth -
 * a pickup chime that waits up to a third of a second reads as input lag. The
 * ending phrase is the one exception, and the engine bar-aligns that one
 * because it is music rather than feedback.
 */

import {
  VOICE_SPECS,
  clampVelocity,
  degreeToMidi,
  foldIntoRange,
  stepSeconds,
  type VoiceName,
} from "./theory";

export type CueName =
  | "pickup"
  | "dialogueOpen"
  | "dialogueClose"
  | "journalOpen"
  | "journalClose"
  | "blocked"
  | "win";

export interface CueNote {
  /** Seconds after the cue fires. */
  delay: number;
  /** Seconds the note is held, before its voice's release. */
  duration: number;
  midi: number;
  velocity: number;
  voice: VoiceName;
}

function note(voice: VoiceName, home: number, degree: number, delay: number, duration: number, velocity: number): CueNote {
  return {
    delay,
    duration,
    midi: foldIntoRange(degreeToMidi(home, degree), VOICE_SPECS[voice]),
    velocity: clampVelocity(velocity),
    voice,
  };
}

/**
 * The ending: eight notes climbing the collection to the tonic an octave up.
 *
 * Scaled to the world's tempo because this one is heard as music, and it is the
 * only cue allowed to run past a couple of seconds.
 */
function winPhrase(home: number, tempo: number): CueNote[] {
  const step = stepSeconds(tempo);
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    note("melody", home, i, i * step * 1.5, step * 1.4, 0.3 + i * 0.045),
  );
}

export function cueFor(name: CueName, home: number, tempo: number): CueNote[] {
  switch (name) {
    // Rising triad. The one unambiguously good-news sound in the game.
    case "pickup":
      return [
        note("pluck", home, 0, 0, 0.3, 0.7),
        note("pluck", home, 2, 0.09, 0.3, 0.68),
        note("pluck", home, 4, 0.18, 0.45, 0.66),
      ];
    case "dialogueOpen":
      return [note("pluck", home, 4, 0, 0.25, 0.4)];
    case "dialogueClose":
      return [note("pluck", home, 0, 0, 0.25, 0.3)];
    case "journalOpen":
      return [note("pluck", home, 0, 0, 0.22, 0.3)];
    case "journalClose":
      return [note("pluck", home, -3, 0, 0.22, 0.3)];
    // Deliberately not a buzzer. A barrier is a fact about the world, not a
    // scolding, and the player will hear this one a great many times.
    case "blocked":
      return [note("pad", home, 6, 0, 0.25, 0.35)];
    case "win":
      return winPhrase(home, tempo);
  }
}

export const CUE_NAMES: readonly CueName[] = [
  "pickup",
  "dialogueOpen",
  "dialogueClose",
  "journalOpen",
  "journalClose",
  "blocked",
  "win",
];

/** Wall-clock length of a cue, ignoring release tails. */
export function cueDuration(cue: readonly CueNote[]): number {
  return cue.reduce((longest, n) => Math.max(longest, n.delay + n.duration), 0);
}
