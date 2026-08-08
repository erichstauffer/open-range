/**
 * The audio engine: buses, the scheduler, and the map from game events to sound.
 *
 * Two theme slots exist rather than one. A crossfade needs both the outgoing
 * and incoming region audible at once, each with its own filter settings, and
 * the cheapest honest way to do that is two complete sets of voice buses whose
 * output gains are ramped against each other. Eight filters total, which is
 * nothing, and it means a fade is two gain ramps rather than a re-plumbing of
 * the graph mid-phrase.
 *
 * The scheduler never runs from `requestAnimationFrame` - see `clock.ts` for
 * why - and the game loop never calls into it. The loop's only contribution is
 * to push `GameEvent`s, which is what keeps `lib/game` free of Web Audio.
 */

import type { GameEvent } from "../game/events";
import type { Region } from "../world/regions";
import { SCHEDULE_AHEAD_SEC, SCHEDULE_INTERVAL_MS, anchorAt, stepsDue, type ClockCursor } from "./clock";
import { selectPlaybackAudioSession } from "./context";
import { cueFor, type CueName } from "./cues";
import { createReverb, type Reverb } from "./reverb";
import { composeWorldScores, type Score } from "./score";
import { SILENT, createVoiceBus, playNote, type VoiceBus } from "./synth";
import {
  DRONE,
  REVERB_SEND_FLOOR,
  VOICE_NAMES,
  VOICE_SPECS,
  rotationIndex,
  stepSeconds,
  tempoFor,
  type VoiceName,
} from "./theory";

/** Seconds of equal-power crossfade when the player changes region. */
const CROSSFADE_SEC = 2.5;

/**
 * A region change is ignored for this long after the last one.
 *
 * Standing on a boundary tile at a ford jitters between two regions several
 * times a second, and without this the crossfade would thrash.
 */
const SETTLE_SEC = 1.2;

/** How far the melody drops while someone is talking. */
const DUCK_GAIN = 0.5;

interface ThemeSlot {
  score: Score | null;
  output: GainNode;
  buses: Record<VoiceName, VoiceBus>;
}

export interface AudioEngine {
  handle(event: GameEvent): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  /** True once the context is actually running and the scheduler has started. */
  running(): boolean;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  dispose(): void;
}

export interface EngineOptions {
  ctx: AudioContext;
  seed: string;
  regions: readonly Region[];
  muted?: boolean;
  volume?: number;
}

function makeSlot(ctx: AudioContext, destination: AudioNode, reverb: Reverb): ThemeSlot {
  const output = ctx.createGain();
  output.gain.value = SILENT;
  output.connect(destination);

  const buses = {} as Record<VoiceName, VoiceBus>;
  for (const name of VOICE_NAMES) {
    const spec = VOICE_SPECS[name];
    const bus = createVoiceBus(ctx, spec, spec.cutoffHz);
    bus.gain.connect(output);

    // Every voice sends to the one shared space, more so the higher it sits -
    // the aerial-perspective idea the palette applies to colour, applied to
    // distance in a mix.
    const send = ctx.createGain();
    send.gain.value = Math.max(REVERB_SEND_FLOOR, spec.reverbSend);
    bus.gain.connect(send);
    send.connect(reverb.input);

    buses[name] = bus;
  }

  return { score: null, output, buses };
}

export function createAudioEngine({ ctx, seed, regions, muted = false, volume = 0.7 }: EngineOptions): AudioEngine {
  const tempo = tempoFor(seed);
  const stepSec = stepSeconds(tempo);
  const scores = composeWorldScores(seed, regions);

  // --- Master chain ---------------------------------------------------------
  const master = ctx.createGain();
  master.gain.value = SILENT;

  // A 49Hz pedal is mostly cone excursion on a laptop, and the compressor keeps
  // a cue landing on top of a pad swell from clipping.
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 28;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 6;
  compressor.ratio.value = 3;

  master.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(ctx.destination);

  const reverb = createReverb(ctx);
  reverb.output.connect(master);

  const slots: [ThemeSlot, ThemeSlot] = [makeSlot(ctx, master, reverb), makeSlot(ctx, master, reverb)];
  // Cues play through their own bus, so ducking the melody during a
  // conversation does not also duck the sound the conversation makes.
  const cueBus = createVoiceBus(ctx, VOICE_SPECS.pluck, VOICE_SPECS.pluck.cutoffHz);
  cueBus.gain.connect(master);
  const cueSend = ctx.createGain();
  cueSend.gain.value = REVERB_SEND_FLOOR;
  cueBus.gain.connect(cueSend);
  cueSend.connect(reverb.input);

  let active = 0;
  let currentRegionId: number | null = null;
  let lastRegionChangeAt = -Infinity;
  let cursor: ClockCursor = anchorAt(ctx.currentTime);
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let isMuted = muted;
  let level = volume;
  let ducked = false;
  const live = new Set<() => void>();

  const targetGain = () => (isMuted ? SILENT : Math.max(SILENT, level));

  function rampMaster(to: number, seconds: number): void {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(SILENT, master.gain.value), now);
    master.gain.setTargetAtTime(Math.max(SILENT, to), now, Math.max(0.01, seconds / 3));
  }

  function schedule(slot: ThemeSlot, step: number, when: number): void {
    const score = slot.score;
    if (!score) return;
    const index = ((step % score.lengthSteps) + score.lengthSteps) % score.lengthSteps;

    for (const note of score.notes) {
      if (note.step !== index) continue;
      const stop = playNote(ctx, slot.buses[note.voice].input, VOICE_SPECS[note.voice], {
        midi: note.midi,
        when,
        held: note.steps * stepSec,
        velocity: note.velocity,
      });
      live.add(stop);
      // Bounded: the ceiling is six sounding at once, so this never grows.
      setTimeout(() => live.delete(stop), (note.steps * stepSec + 6) * 1000);
    }
  }

  function tick(): void {
    if (disposed || ctx.state !== "running") return;

    const result = stepsDue(cursor, ctx.currentTime, stepSec, SCHEDULE_AHEAD_SEC);
    cursor = result.cursor;
    if (result.reanchored) return;

    for (const due of result.due) {
      for (const slot of slots) schedule(slot, due.step, due.time);
    }
  }

  function startTimer(): void {
    if (timer !== null || disposed) return;
    timer = setInterval(tick, SCHEDULE_INTERVAL_MS);
  }

  function stopTimer(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  /** Point a slot's filters at a score's brightness. */
  function tuneSlot(slot: ThemeSlot, score: Score): void {
    const now = ctx.currentTime;
    for (const name of VOICE_NAMES) {
      const spec = VOICE_SPECS[name];
      const cutoff =
        name === "drone"
          ? spec.cutoffHz + score.knobs.droneCutoffShift
          : spec.cutoffHz * Math.pow(2, score.knobs.brightness);
      slot.buses[name].input.frequency.setTargetAtTime(Math.max(60, cutoff), now, 0.2);
    }
    slot.buses.drone.gain.gain.setTargetAtTime(DRONE.gain, now, 0.2);
    slot.buses.pad.gain.gain.setTargetAtTime(0.22 * score.knobs.padGain, now, 0.2);
    slot.buses.melody.gain.gain.setTargetAtTime(0.2 * score.knobs.melodyGain * (ducked ? DUCK_GAIN : 1), now, 0.2);
    slot.buses.pluck.gain.gain.setTargetAtTime(0.22 * score.knobs.pluckGain, now, 0.2);
  }

  function setRegion(regionId: number): void {
    if (regionId === currentRegionId) return;

    const now = ctx.currentTime;
    if (now - lastRegionChangeAt < SETTLE_SEC) return;
    lastRegionChangeAt = now;
    currentRegionId = regionId;

    const score = scores.get(regionId) ?? null;
    const incoming = slots[active === 0 ? 1 : 0];
    const outgoing = slots[active];

    // The open sea is a real state, not an error: the theme thins out and the
    // drone carries on, so walking to the water's edge quietens the island.
    if (!score) {
      outgoing.output.gain.setTargetAtTime(SILENT, now, CROSSFADE_SEC / 3);
      return;
    }

    incoming.score = score;
    tuneSlot(incoming, score);

    // Equal power: sine in against cosine out holds the level through the
    // overlap, where a linear pair would dip in the middle.
    incoming.output.gain.cancelScheduledValues(now);
    incoming.output.gain.setValueAtTime(Math.max(SILENT, incoming.output.gain.value), now);
    incoming.output.gain.setTargetAtTime(1, now, CROSSFADE_SEC / 3);

    outgoing.output.gain.cancelScheduledValues(now);
    outgoing.output.gain.setValueAtTime(Math.max(SILENT, outgoing.output.gain.value), now);
    outgoing.output.gain.setTargetAtTime(SILENT, now, CROSSFADE_SEC / 3);

    active = active === 0 ? 1 : 0;
  }

  /** The rotation currently sounding, so a cue lands in the local mode. */
  function activeHome(): number {
    const score = slots[active].score;
    return rotationIndex(score ? score.knobs.rotation : 0);
  }

  function playCue(name: CueName): void {
    if (isMuted) return;
    const home = activeHome();
    // Not bar-quantised. A pickup chime that waits up to a third of a second
    // for the next eighth reads as input lag rather than as music.
    const base = ctx.currentTime + 0.02;
    for (const note of cueFor(name, home, tempo)) {
      const stop = playNote(ctx, cueBus.input, VOICE_SPECS[note.voice], {
        midi: note.midi,
        when: base + note.delay,
        held: note.duration,
        velocity: note.velocity,
      });
      live.add(stop);
      setTimeout(() => live.delete(stop), (note.delay + note.duration + 6) * 1000);
    }
  }

  function setDucked(next: boolean): void {
    if (next === ducked) return;
    ducked = next;
    const now = ctx.currentTime;
    for (const slot of slots) {
      const score = slot.score;
      if (!score) continue;
      const to = 0.2 * score.knobs.melodyGain * (ducked ? DUCK_GAIN : 1);
      slot.buses.melody.gain.gain.setTargetAtTime(to, now, ducked ? 0.15 : 0.3);
    }
  }

  return {
    handle(event) {
      switch (event.kind) {
        case "region":
          setRegion(event.regionId);
          break;
        case "pickup":
          playCue("pickup");
          break;
        case "coins":
          playCue("coins");
          break;
        case "dialogue":
          setDucked(event.open);
          playCue(event.open ? "dialogueOpen" : "dialogueClose");
          break;
        case "journal":
          playCue(event.open ? "journalOpen" : "journalClose");
          break;
        case "blocked":
          playCue("blocked");
          break;
        case "win":
          playCue("win");
          break;
        case "options":
          // Deliberately silent. Opening a settings panel is not an event in
          // the world.
          break;
      }
    },

    setMuted(next) {
      isMuted = next;
      rampMaster(targetGain(), 0.25);
    },

    setVolume(next) {
      level = Math.max(0, Math.min(1, next));
      // Ramped, never assigned: a jump on the master gain is an audible click.
      rampMaster(targetGain(), 0.08);
    },

    running() {
      return !disposed && timer !== null && ctx.state === "running";
    },

    async resume() {
      if (disposed) return;
      selectPlaybackAudioSession();
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          return;
        }
      }
      if (disposed) return;
      // Re-anchor: a suspended context freezes `currentTime`, so the cursor is
      // stale and would otherwise try to schedule the whole silent gap.
      cursor = anchorAt(ctx.currentTime, cursor.step);
      startTimer();
      rampMaster(targetGain(), 0.6);
    },

    async suspend() {
      if (disposed) return;
      rampMaster(SILENT, 0.35);
      stopTimer();
      // Let the fade finish before the clock stops, or it cuts off mid-ramp.
      await new Promise((resolve) => setTimeout(resolve, 380));
      if (disposed || ctx.state !== "running") return;
      try {
        await ctx.suspend();
      } catch {
        // A context that will not suspend is merely wasteful, not broken.
      }
    },

    dispose() {
      disposed = true;
      stopTimer();
      for (const stop of live) stop();
      live.clear();
      for (const slot of slots) {
        for (const name of VOICE_NAMES) {
          slot.buses[name].input.disconnect();
          slot.buses[name].gain.disconnect();
        }
        slot.output.disconnect();
      }
      cueBus.input.disconnect();
      cueBus.gain.disconnect();
      reverb.dispose();
      master.disconnect();
      highpass.disconnect();
      compressor.disconnect();
      // Suspend, never close. Closing is irreversible, and the context is a
      // module singleton the title screen primed - a remount, a seed change or
      // StrictMode's development double-mount would land on a dead one.
      if (ctx.state === "running") void ctx.suspend().catch(() => {});
    },
  };
}
