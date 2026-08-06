/**
 * The lookahead scheduler's decision function.
 *
 * Web Audio is scheduled ahead of time on `AudioContext.currentTime`, a clock
 * that has nothing to do with `requestAnimationFrame`. Driving note starts from
 * the frame loop would be wrong four times over: rAF *stops* in a hidden tab
 * rather than merely slowing; `performance.now()` and `currentTime` are separate
 * hardware clocks with real relative drift; attacks quantised to 16.7ms flam
 * audibly when three voices are meant to enter together; and this game's loop
 * deliberately throws time away after a stall (`game-canvas.tsx` discards its
 * accumulator backlog), which is exactly the wrong behaviour for music.
 *
 * So a coarse timer wakes up every `SCHEDULE_INTERVAL_MS` and asks this
 * function which steps fall inside the next `SCHEDULE_AHEAD_SEC`. Everything it
 * returns is scheduled at an absolute time on the audio clock, and the timer's
 * own jitter stops mattering.
 *
 * Pure, so the awkward cases - a garbage-collection stall, a resumed context -
 * are tested against a fake clock rather than by listening for a dropout.
 */

/** How often the timer wakes. Short enough that a missed tick is recoverable. */
export const SCHEDULE_INTERVAL_MS = 25;

/**
 * How far ahead to schedule. Five times the wake interval, so a tick delayed
 * 100ms by garbage collection still misses nothing.
 */
export const SCHEDULE_AHEAD_SEC = 0.12;

/**
 * Beyond this far behind the audio clock, catching up step by step would mean
 * dumping a burst of notes that were meant to play while the tab was hidden.
 * The caller re-anchors instead.
 */
export const REANCHOR_BEHIND_SEC = 0.5;

export interface ClockCursor {
  /** Index of the next step to schedule, counted from when the clock started. */
  step: number;
  /** Absolute `currentTime` at which that step should sound. */
  time: number;
}

export interface DueResult {
  due: ClockCursor[];
  cursor: ClockCursor;
  /**
   * True when the cursor had fallen so far behind that the backlog was skipped.
   * The engine uses this to fade back in rather than to start mid-burst.
   */
  reanchored: boolean;
}

/**
 * Steps that should be scheduled now.
 *
 * Returns a new cursor rather than mutating, so a caller cannot half-advance
 * the clock by throwing partway through scheduling.
 */
export function stepsDue(
  cursor: ClockCursor,
  currentTime: number,
  stepSec: number,
  lookahead: number = SCHEDULE_AHEAD_SEC,
  maxSteps = 64,
): DueResult {
  if (stepSec <= 0) throw new Error("stepSec must be positive");

  // A suspended context freezes `currentTime`; on resume the cursor can be many
  // seconds in the past. Jump the cursor forward to the next whole step rather
  // than scheduling the gap.
  if (cursor.time < currentTime - REANCHOR_BEHIND_SEC) {
    const missed = Math.ceil((currentTime - cursor.time) / stepSec);
    return {
      due: [],
      cursor: { step: cursor.step + missed, time: cursor.time + missed * stepSec },
      reanchored: true,
    };
  }

  const horizon = currentTime + lookahead;
  const due: ClockCursor[] = [];
  let { step, time } = cursor;

  while (time < horizon && due.length < maxSteps) {
    due.push({ step, time });
    step += 1;
    time += stepSec;
  }

  return { due, cursor: { step, time }, reanchored: false };
}

/** Where the clock should restart after a resume, with a little lead. */
export function anchorAt(currentTime: number, step = 0, lead = 0.05): ClockCursor {
  return { step, time: currentTime + lead };
}
