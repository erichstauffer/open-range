/**
 * Keyboard and virtual-control input.
 *
 * Held keys live in a Set; discrete presses go into a small queue the update
 * step drains. Reading "was the interact key pressed this tick" from a queue
 * rather than from key state avoids both missed taps between frames and a
 * single press firing on several consecutive frames.
 */

import type { ShopItem } from "./shop";

export type Action = "interact" | "journal" | "options" | "cancel";

/**
 * A request from a panel, as opposed to a press of a key.
 *
 * Buying something has no keystroke and never will - it is a choice from a list,
 * which is a thing a pointer and a screen reader do well and a key does badly.
 * But the simulation still may not be reached into from React, so panels queue
 * commands here and the update step drains them alongside the actions. Same
 * one-way discipline as `pending`, one step wider.
 */
export type GameCommand =
  | { kind: "buy"; item: ShopItem }
  | { kind: "sell"; item: ShopItem }
  | { kind: "sellWood" }
  | { kind: "rest" }
  | { kind: "drink" }
  | { kind: "closeShop" };

const MOVE_KEYS: Readonly<Record<string, "up" | "down" | "left" | "right">> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

const ACTION_KEYS: Readonly<Record<string, Action>> = {
  Space: "interact",
  Enter: "interact",
  KeyE: "interact",
  KeyJ: "journal",
  Tab: "journal",
  KeyO: "options",
  Escape: "cancel",
};

export interface InputState {
  held: Set<string>;
  movementSources: Map<string, MoveVector>;
  pending: Action[];
  commands: GameCommand[];
  setMovement: (source: string, movement: MoveVector) => void;
  clearMovement: (source: string) => void;
  enqueue: (action: Action) => void;
  send: (command: GameCommand) => void;
  destroy: () => void;
}

/** A listener-free input state for tests and non-DOM control sources. */
export function createInputState(): InputState {
  const movementSources = new Map<string, MoveVector>();
  const pending: Action[] = [];
  const commands: GameCommand[] = [];

  return {
    held: new Set<string>(),
    movementSources,
    pending,
    commands,
    setMovement(source, movement) {
      movementSources.set(source, movement);
    },
    clearMovement(source) {
      movementSources.delete(source);
    },
    enqueue(action) {
      pending.push(action);
    },
    send(command) {
      commands.push(command);
    },
    destroy() {},
  };
}

function isFormControl(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function createInput(target: Window): InputState {
  const input = createInputState();
  const { held, pending } = input;

  const onKeyDown = (event: KeyboardEvent) => {
    // A focused control owns its own arrow keys, and `O` typed into one should
    // not close the panel that control lives in. Without this the settings
    // sliders cannot be driven from the keyboard at all.
    if (isFormControl(event.target)) return;

    const move = MOVE_KEYS[event.code];
    const action = ACTION_KEYS[event.code];
    if (!move && !action) return;

    // Stop the page scrolling out from under the game.
    event.preventDefault();

    if (move) held.add(move);
    // `repeat` guards against the OS auto-repeat advancing dialogue by itself.
    if (action && !event.repeat) pending.push(action);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const move = MOVE_KEYS[event.code];
    if (move) held.delete(move);
  };

  // Releasing a key while the tab is hidden never reaches us, which would leave
  // the player walking into a wall forever.
  const clearAllMovement = () => {
    held.clear();
    input.movementSources.clear();
  };
  const onVisibilityChange = () => {
    if (target.document?.visibilityState === "hidden") clearAllMovement();
  };

  target.addEventListener("keydown", onKeyDown, { passive: false });
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", clearAllMovement);
  target.document?.addEventListener("visibilitychange", onVisibilityChange);

  return Object.assign(input, {
    destroy() {
      clearAllMovement();
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", clearAllMovement);
      target.document?.removeEventListener("visibilitychange", onVisibilityChange);
    },
  });
}

export interface MoveVector {
  dx: number;
  dy: number;
}

export function readMovement(input: InputState): MoveVector {
  let dx = 0;
  let dy = 0;
  if (input.held.has("left")) dx -= 1;
  if (input.held.has("right")) dx += 1;
  if (input.held.has("up")) dy -= 1;
  if (input.held.has("down")) dy += 1;

  for (const movement of input.movementSources.values()) {
    dx += movement.dx;
    dy += movement.dy;
  }

  // Clamp to unit length so diagonals and multiple simultaneous sources cannot
  // move faster than a single full-strength direction. Sub-unit joystick input
  // remains proportional for fine steering.
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 1) {
    dx /= magnitude;
    dy /= magnitude;
  }
  return { dx, dy };
}
