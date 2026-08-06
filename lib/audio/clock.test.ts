import { describe, expect, it } from "vitest";
import { REANCHOR_BEHIND_SEC, SCHEDULE_AHEAD_SEC, anchorAt, stepsDue } from "./clock";

/**
 * The scheduler is the one piece of the audio layer whose failures are silent
 * rather than audible-and-obvious: a dropped step is a hole in the music, a
 * double-scheduled step is a flam, and neither shows up in a screenshot. So it
 * is a pure function driven here by a fake clock that stalls and jumps the way
 * a real tab does.
 */

const STEP = 1 / 3; // an eighth at 60bpm

/** Drive the clock through a list of wake-up times and collect what it emits. */
function run(times: readonly number[], stepSec = STEP) {
  let cursor = anchorAt(0, 0, 0);
  const emitted: Array<{ step: number; time: number }> = [];
  let reanchors = 0;

  for (const now of times) {
    const result = stepsDue(cursor, now, stepSec);
    emitted.push(...result.due);
    cursor = result.cursor;
    if (result.reanchored) reanchors += 1;
  }

  return { emitted, cursor, reanchors };
}

describe("steady running", () => {
  it("emits each step exactly once, in order", () => {
    const ticks = Array.from({ length: 400 }, (_, i) => i * 0.025);
    const { emitted } = run(ticks);

    expect(emitted.length).toBeGreaterThan(20);
    emitted.forEach((step, i) => {
      expect(step.step).toBe(i);
      if (i > 0) expect(step.time).toBeGreaterThan(emitted[i - 1].time);
    });
  });

  it("keeps steps exactly one interval apart, however jittery the timer", () => {
    // The whole point of scheduling ahead: the wake-up times are irregular and
    // the note times are not.
    const ticks = [0, 0.007, 0.04, 0.041, 0.09, 0.13, 0.2, 0.31, 0.33, 0.5, 0.72, 0.9];
    const { emitted } = run(ticks);
    for (let i = 1; i < emitted.length; i += 1) {
      expect(emitted[i].time - emitted[i - 1].time).toBeCloseTo(STEP, 10);
    }
  });

  it("schedules ahead of the clock, never behind it", () => {
    let cursor = anchorAt(0, 0, 0);
    for (let now = 0; now < 5; now += 0.025) {
      const result = stepsDue(cursor, now, STEP);
      for (const due of result.due) {
        expect(due.time).toBeLessThan(now + SCHEDULE_AHEAD_SEC);
      }
      cursor = result.cursor;
    }
  });

  it("emits nothing when called again immediately", () => {
    const cursor = anchorAt(0, 0, 0);
    const first = stepsDue(cursor, 0, STEP);
    expect(first.due.length).toBeGreaterThan(0);
    const second = stepsDue(first.cursor, 0, STEP);
    expect(second.due).toHaveLength(0);
  });
});

describe("recovering from a stall", () => {
  it("catches up a short stall rather than dropping it", () => {
    // A 400ms garbage-collection pause: every step still gets played.
    const { emitted } = run([0, 0.025, 0.05, 0.45, 0.475, 0.5]);
    emitted.forEach((step, i) => expect(step.step).toBe(i));
    for (let i = 1; i < emitted.length; i += 1) {
      expect(emitted[i].time - emitted[i - 1].time).toBeCloseTo(STEP, 10);
    }
  });

  it("skips the gap after a long suspension instead of dumping a burst", () => {
    // A hidden tab freezes currentTime; on resume the backlog is minutes of
    // music nobody heard, and playing it all at once would be a noise.
    const { emitted, reanchors, cursor } = run([0, 0.025, 90]);
    expect(reanchors).toBe(1);
    expect(emitted.length).toBeLessThan(10);
    expect(cursor.time).toBeGreaterThanOrEqual(90);
  });

  it("keeps counting steps across the gap, so the bar line survives", () => {
    // The step index is what the engine uses to know where in the loop it is.
    // Re-anchoring must advance it by the number of steps actually missed, or
    // the theme would come back on the wrong beat.
    const before = anchorAt(0, 0, 0);
    const gap = 12;
    const result = stepsDue(before, gap, STEP);
    expect(result.reanchored).toBe(true);
    expect(result.cursor.step).toBe(Math.ceil(gap / STEP));
  });

  it("does not re-anchor for a lag inside the tolerance", () => {
    const cursor = anchorAt(0, 0, 0);
    const result = stepsDue(cursor, REANCHOR_BEHIND_SEC * 0.9, STEP);
    expect(result.reanchored).toBe(false);
    expect(result.due.length).toBeGreaterThan(0);
  });
});

describe("guards", () => {
  it("caps how many steps one wake-up may schedule", () => {
    const result = stepsDue(anchorAt(0, 0, 0), 0, STEP, 100, 8);
    expect(result.due).toHaveLength(8);
  });

  it("refuses a non-positive step length", () => {
    // Would otherwise spin forever building an infinite due list.
    expect(() => stepsDue(anchorAt(0, 0, 0), 0, 0)).toThrow();
    expect(() => stepsDue(anchorAt(0, 0, 0), 0, -1)).toThrow();
  });

  it("does not mutate the cursor it was given", () => {
    const cursor = anchorAt(0, 0, 0);
    stepsDue(cursor, 1, STEP);
    expect(cursor).toEqual({ step: 0, time: 0 });
  });
});
