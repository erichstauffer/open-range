/**
 * The shared space every voice sits in.
 *
 * A feedback delay network rather than a `ConvolverNode`. A convolver needs an
 * impulse response, which would have to be either a shipped audio file - which
 * this project does not do - or several seconds of noise generated at boot,
 * which costs milliseconds and a good deal of code for a result nobody can
 * inspect. The FDN is four delays and a filter, its character lives in five
 * legible numbers rather than in a buffer, and - the deciding reason - it is
 * simple enough to reimplement in `offline.ts`, so the headless preview hears
 * the same room the game does.
 */

/** Tap lengths in milliseconds, mutually prime-ish so echoes do not flutter. */
const TAPS_MS = [29.7, 37.1, 41.1, 43.7] as const;
const FEEDBACK = 0.62;
const DAMPING_HZ = 2400;

export interface Reverb {
  /** Send voices here. */
  input: GainNode;
  /** Already connected to nothing; the caller wires it into the master. */
  output: GainNode;
  dispose(): void;
}

export function createReverb(ctx: AudioContext): Reverb {
  const input = ctx.createGain();
  const output = ctx.createGain();
  output.gain.value = 0.45;

  const nodes: AudioNode[] = [input, output];

  for (const ms of TAPS_MS) {
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = ms / 1000;

    const feedback = ctx.createGain();
    feedback.gain.value = FEEDBACK;

    // Damping inside the loop, so late reflections lose their top end the way
    // a real space does instead of ringing on at full brightness.
    const damping = ctx.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = DAMPING_HZ;

    input.connect(delay);
    delay.connect(damping);
    damping.connect(feedback);
    feedback.connect(delay);
    delay.connect(output);

    nodes.push(delay, feedback, damping);
  }

  return {
    input,
    output,
    dispose() {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    },
  };
}
