import { describe, expect, it } from "vitest";
import { readJoystick, STICK_DEAD_ZONE, STICK_RADIUS } from "./joystick";

describe("virtual joystick", () => {
  it("ignores movement inside the dead zone", () => {
    const reading = readJoystick(STICK_RADIUS * STICK_DEAD_ZONE * 0.9, 0);
    expect(reading.movement).toEqual({ dx: 0, dy: 0 });
  });

  it("preserves diagonal direction at full strength", () => {
    const reading = readJoystick(100, 100);
    expect(Math.hypot(reading.movement.dx, reading.movement.dy)).toBeCloseTo(1);
    expect(reading.movement.dx).toBeCloseTo(Math.SQRT1_2);
    expect(reading.movement.dy).toBeCloseTo(Math.SQRT1_2);
  });

  it("clamps the visible knob to the control radius", () => {
    const reading = readJoystick(400, 0);
    expect(reading.knob).toEqual({ x: STICK_RADIUS, y: 0 });
  });
});
