/**
 * One note's worth of Web Audio nodes.
 *
 * Nodes are created per note and left to the garbage collector after `stop()`.
 * A pool would be the reflex, but the polyphony ceiling asserted in
 * `score.test.ts` is six, so at most a couple of dozen nodes are ever live and
 * pooling would cost more in bookkeeping than it saves.
 *
 * Every envelope segment goes through `setTargetAtTime` or a linear ramp and
 * never through a bare assignment, and the oscillator is stopped well after its
 * gain has reached the floor rather than at the moment of release. Stopping
 * into a non-zero gain is the single commonest source of clicks in Web Audio,
 * and it sounds like a fault in the game rather than in the music.
 */

import type { VoiceSpec } from "./theory";

/**
 * Gain never reaches zero.
 *
 * `exponentialRampToValueAtTime` throws on a target of zero, and
 * `setTargetAtTime` approaches its target asymptotically anyway, so the floor
 * is a value low enough to be inaudible.
 */
const SILENT = 0.0001;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface NoteRequest {
  midi: number;
  /** Absolute time on the audio clock. */
  when: number;
  /** Seconds to hold before the release begins. */
  held: number;
  velocity: number;
}

/**
 * Schedule one note into a destination node.
 *
 * Returns a function that cuts the note short - used only on teardown, so a
 * component unmounting mid-phrase does not leave a drone running for its full
 * four-second release.
 */
export function playNote(
  ctx: AudioContext,
  destination: AudioNode,
  spec: VoiceSpec,
  request: NoteRequest,
): () => void {
  const { when, held, velocity } = request;
  const hz = midiToHz(request.midi);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, when);
  gain.connect(destination);

  const peak = Math.max(SILENT, velocity / spec.waves.length);
  const sustain = Math.max(SILENT, peak * spec.sustain);

  // Attack, then decay to the sustain level, then hold. Linear on the way up
  // reads as a cleaner transient than exponential for a soft attack.
  gain.gain.linearRampToValueAtTime(peak, when + spec.attack);
  if (spec.decay > 0) {
    gain.gain.exponentialRampToValueAtTime(sustain, when + spec.attack + spec.decay);
  }

  const releaseAt = when + Math.max(held, spec.attack);
  gain.gain.setTargetAtTime(SILENT, releaseAt, Math.max(0.01, spec.release / 3));

  // setTargetAtTime is asymptotic: at three time constants it is at 5% and at
  // four it is inaudible. Stopping earlier would truncate the tail audibly.
  const stopAt = releaseAt + spec.release * 1.4 + 0.05;

  const oscillators = spec.waves.map((type) => {
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, when);
    oscillator.connect(gain);
    oscillator.start(when);
    oscillator.stop(stopAt);
    return oscillator;
  });

  const cleanup = () => {
    try {
      gain.disconnect();
    } catch {
      // Already torn down.
    }
  };
  oscillators[oscillators.length - 1]?.addEventListener("ended", cleanup, { once: true });

  return () => {
    const now = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(SILENT, now, 0.02);
      for (const oscillator of oscillators) oscillator.stop(now + 0.12);
    } catch {
      // A node already stopped throws; nothing to do about it.
    }
  };
}

/** A lowpassed bus with its own level, shared by every note of one voice. */
export interface VoiceBus {
  input: BiquadFilterNode;
  gain: GainNode;
}

export function createVoiceBus(ctx: AudioContext, spec: VoiceSpec, cutoffHz: number): VoiceBus {
  const input = ctx.createBiquadFilter();
  input.type = "lowpass";
  input.frequency.value = Math.max(60, cutoffHz);
  input.Q.value = spec.q;

  const gain = ctx.createGain();
  gain.gain.value = 1;
  input.connect(gain);

  return { input, gain };
}

export { SILENT };
