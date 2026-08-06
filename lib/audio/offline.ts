/**
 * A software renderer for a `Score`, so the music can be heard without a
 * browser.
 *
 * The instinct here is to reach for the trick `scripts/canvas-shim.ts` plays -
 * reimplement enough of the platform API that the real code runs headlessly.
 * That shim earns its keep because the art pipeline is thousands of Canvas2D
 * calls, so faking the surface reuses an enormous amount of code. The audio
 * graph is about a hundred and fifty lines. A faithful `OfflineAudioContext`
 * would need `AudioParam` automation, biquad topology and delay lines, which is
 * more code than the thing it shims, and any divergence in ramp semantics would
 * make the preview quietly lie about what the game sounds like.
 *
 * So this renders from the same `VOICE_SPECS` the browser engine will use. The
 * two share the specification - which is where the aesthetic actually lives -
 * and differ only in filter topology. That is the honest split.
 *
 * Naive oscillators, so a sawtooth aliases above the bus cutoff. Audible only
 * as a faint sheen at this register, and not worth a band-limited oscillator in
 * a tool whose job is judging notes and balance.
 */

import {
  DRONE,
  REVERB_SEND_FLOOR,
  VOICE_NAMES,
  VOICE_SPECS,
  stepSeconds,
  type VoiceName,
  type VoiceSpec,
} from "./theory";
import type { NoteEvent, Score } from "./score";

export const SAMPLE_RATE = 44100;

/** Feedback delay network taps, in milliseconds. Mutually prime-ish, so the
 *  echoes do not line up into a flutter. */
const REVERB_TAPS_MS = [29.7, 37.1, 41.1, 43.7] as const;
const REVERB_FEEDBACK = 0.62;
const REVERB_DAMPING_HZ = 2400;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** One cycle of a waveform at phase p in [0, 1). */
function wave(type: OscillatorType, p: number): number {
  switch (type) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "triangle":
      return 4 * Math.abs(p - Math.floor(p + 0.5)) - 1;
    case "sawtooth":
      return 2 * (p - Math.floor(p + 0.5));
    case "square":
      return p < 0.5 ? 1 : -1;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

/** Attack, decay to sustain, hold, release. Matches the browser envelope shape. */
function envelope(spec: VoiceSpec, t: number, held: number): number {
  if (t < 0) return 0;
  if (t < spec.attack) return t / spec.attack;
  const afterAttack = t - spec.attack;
  const level =
    spec.decay > 0 && afterAttack < spec.decay
      ? 1 - (1 - spec.sustain) * (afterAttack / spec.decay)
      : spec.sustain;
  if (t < held) return level;
  const releasing = t - held;
  if (releasing >= spec.release) return 0;
  return level * (1 - releasing / spec.release);
}

/** One-pole lowpass. Cheaper than a biquad and close enough for a preview. */
function lowpass(buffer: Float32Array, cutoffHz: number): void {
  const dt = 1 / SAMPLE_RATE;
  const rc = 1 / (2 * Math.PI * Math.max(20, cutoffHz));
  const alpha = dt / (rc + dt);
  let last = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    last += alpha * (buffer[i] - last);
    buffer[i] = last;
  }
}

/** One-pole highpass, used only to keep the drone off small speakers. */
function highpass(buffer: Float32Array, cutoffHz: number): void {
  const dt = 1 / SAMPLE_RATE;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + dt);
  let previousIn = buffer[0] ?? 0;
  let previousOut = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const input = buffer[i];
    previousOut = alpha * (previousOut + input - previousIn);
    previousIn = input;
    buffer[i] = previousOut;
  }
}

/** Render one note into a bus buffer at an absolute offset in seconds. */
function renderNote(bus: Float32Array, note: NoteEvent, offsetSec: number, stepSec: number, gain: number): void {
  const spec = VOICE_SPECS[note.voice];
  const held = note.steps * stepSec;
  const total = held + spec.release;
  const start = Math.floor((offsetSec + note.step * stepSec) * SAMPLE_RATE);
  const length = Math.ceil(total * SAMPLE_RATE);
  const hz = midiToHz(note.midi);
  const amplitude = (note.velocity * gain) / spec.waves.length;

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index < 0) continue;
    if (index >= bus.length) break;
    const t = i / SAMPLE_RATE;
    const env = envelope(spec, t, held);
    if (env <= 0) continue;
    let sample = 0;
    for (const type of spec.waves) sample += wave(type, (hz * t) % 1);
    bus[index] += sample * env * amplitude;
  }
}

/** Feedback delay network. No impulse response, so no buffer to ship or build. */
function reverb(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  const delays = REVERB_TAPS_MS.map((ms) => Math.round((ms / 1000) * SAMPLE_RATE));
  const lines = delays.map((n) => new Float32Array(n));
  const cursors = new Array(delays.length).fill(0);
  const dampAlpha = (2 * Math.PI * REVERB_DAMPING_HZ) / SAMPLE_RATE;
  const damped = new Array(delays.length).fill(0);

  for (let i = 0; i < input.length; i += 1) {
    let sum = 0;
    for (let d = 0; d < lines.length; d += 1) {
      const line = lines[d];
      const cursor = cursors[d];
      const delayed = line[cursor];
      sum += delayed;
      // Damp inside the loop, so late reflections lose their top end the way a
      // real space does rather than ringing forever at full brightness.
      damped[d] += dampAlpha * (delayed - damped[d]);
      line[cursor] = input[i] + damped[d] * REVERB_FEEDBACK;
      cursors[d] = (cursor + 1) % line.length;
    }
    out[i] = sum / lines.length;
  }

  return out;
}

export interface RenderOptions {
  /** Seconds of score to render. Defaults to one full period. */
  seconds?: number;
  /** Where in the score to begin, in seconds. */
  offsetSec?: number;
  /** Overall level, before the master stage. */
  gain?: number;
}

/**
 * Render a score to mono samples.
 *
 * Voices are summed into four buses so the lowpass runs once per bus rather
 * than once per note - the same arrangement the browser engine uses, and the
 * reason the whole thing stays cheap.
 */
export function renderScore(score: Score, options: RenderOptions = {}): Float32Array {
  const stepSec = stepSeconds(score.tempo);
  const seconds = options.seconds ?? score.lengthSteps * stepSec;
  const offsetSec = options.offsetSec ?? 0;
  const gain = options.gain ?? 1;
  const length = Math.ceil(seconds * SAMPLE_RATE);

  const dry = new Float32Array(length);
  const send = new Float32Array(length);

  for (const name of VOICE_NAMES) {
    const spec = VOICE_SPECS[name];
    const bus = new Float32Array(length);
    const voiceGain = voiceGainFor(score, name);
    if (voiceGain <= 0) continue;

    // The score is a loop, so a window that runs past the period - or starts
    // partway through one - has to be filled from the next repeat rather than
    // trailing off into silence.
    const periodSec = score.lengthSteps * stepSec;
    const firstRepeat = Math.floor(offsetSec / periodSec);
    const lastRepeat = Math.ceil((offsetSec + seconds) / periodSec);
    for (let repeat = firstRepeat; repeat <= lastRepeat; repeat += 1) {
      const shift = repeat * periodSec - offsetSec;
      for (const note of score.notes) {
        if (note.voice !== name) continue;
        renderNote(bus, note, shift, stepSec, voiceGain * gain);
      }
    }

    const cutoff =
      name === "drone"
        ? spec.cutoffHz + score.knobs.droneCutoffShift
        : spec.cutoffHz * Math.pow(2, score.knobs.brightness);
    lowpass(bus, cutoff);

    const sendLevel = Math.max(REVERB_SEND_FLOOR, spec.reverbSend);
    for (let i = 0; i < length; i += 1) {
      dry[i] += bus[i];
      send[i] += bus[i] * sendLevel;
    }
  }

  const wet = reverb(send);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = dry[i] + wet[i] * 0.45;
  return out;
}

function voiceGainFor(score: Score, voice: VoiceName): number {
  switch (voice) {
    case "drone":
      return DRONE.gain;
    case "pad":
      return 0.22 * score.knobs.padGain;
    case "melody":
      return 0.2 * score.knobs.melodyGain;
    case "pluck":
      return 0.22 * score.knobs.pluckGain;
  }
}

/**
 * Master stage: keep the drone off small speakers, then soft-clip.
 *
 * A 49Hz pedal is mostly cone excursion on a laptop, and a cue landing on top
 * of a pad swell is exactly the moment a peak arrives. `tanh` stands in for the
 * browser's `DynamicsCompressorNode` - not the same curve, but the same job of
 * making the loud moments safe rather than crunchy.
 */
export function master(samples: Float32Array, level = 0.9): Float32Array {
  highpass(samples, 28);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = Math.tanh(samples[i] * 1.4) * level;
  return out;
}

/**
 * Render several region themes back to back with equal-power crossfades.
 *
 * This is the one output that answers the question the property tests cannot:
 * whether an island's regions are variations on one idea or a playlist. It is
 * the audio counterpart of `render-art-preview.ts` putting every terrain in a
 * single frame to see whether it reads as one illustration.
 */
export function renderTour(scores: readonly Score[], barsEach = 4, fadeSec = 2.5): Float32Array {
  if (scores.length === 0) return new Float32Array(0);

  const stepSec = stepSeconds(scores[0].tempo);
  const segmentSec = barsEach * 6 * stepSec;
  const total = Math.ceil((segmentSec * scores.length + fadeSec) * SAMPLE_RATE);
  const mix = new Float32Array(total);
  const fade = Math.ceil(fadeSec * SAMPLE_RATE);

  scores.forEach((score, index) => {
    // Each theme is rendered from the position on the shared bar clock it would
    // actually be at, not from its own bar one - which is the whole point of a
    // world-wide tempo, and the reason a fade never lands on a double downbeat.
    const offsetSec = index * segmentSec;
    const rendered = renderScore(score, { seconds: segmentSec + fadeSec, offsetSec });
    const start = Math.floor(offsetSec * SAMPLE_RATE);

    for (let i = 0; i < rendered.length; i += 1) {
      const at = start + i;
      if (at >= total) break;
      // Equal power in and out, so the sum holds a constant level through the
      // overlap instead of dipping in the middle the way a linear fade does.
      let gain = 1;
      if (index > 0 && i < fade) gain = Math.sin((i / fade) * (Math.PI / 2));
      const fromEnd = rendered.length - i;
      if (index < scores.length - 1 && fromEnd < fade) gain *= Math.sin((fromEnd / fade) * (Math.PI / 2));
      mix[at] += rendered[i] * gain;
    }
  });

  return master(mix);
}
