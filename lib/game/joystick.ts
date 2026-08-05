import type { MoveVector } from "./input";

export const STICK_RADIUS = 38;
export const STICK_DEAD_ZONE = 0.18;

export interface JoystickReading {
  movement: MoveVector;
  knob: { x: number; y: number };
}

/** Convert a pointer offset into a clamped, dead-zone-adjusted movement vector. */
export function readJoystick(dx: number, dy: number): JoystickReading {
  const distance = Math.hypot(dx, dy);
  const clampedDistance = Math.min(STICK_RADIUS, distance);
  const scale = distance > 0 ? clampedDistance / distance : 0;
  const knob = { x: dx * scale, y: dy * scale };
  const rawStrength = clampedDistance / STICK_RADIUS;

  if (rawStrength <= STICK_DEAD_ZONE || distance === 0) {
    return { movement: { dx: 0, dy: 0 }, knob };
  }

  const strength = (rawStrength - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
  return {
    movement: { dx: (dx / distance) * strength, dy: (dy / distance) * strength },
    knob,
  };
}
