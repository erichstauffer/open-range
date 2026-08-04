/**
 * Keyboard input.
 *
 * Held keys live in a Set; discrete presses go into a small queue the update
 * step drains. Reading "was the interact key pressed this tick" from a queue
 * rather than from key state avoids both missed taps between frames and a
 * single press firing on several consecutive frames.
 */

export type Action = "interact" | "journal" | "cancel";

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
  Escape: "cancel",
};

export interface InputState {
  held: Set<string>;
  pending: Action[];
  destroy: () => void;
}

export function createInput(target: Window): InputState {
  const held = new Set<string>();
  const pending: Action[] = [];

  const onKeyDown = (event: KeyboardEvent) => {
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
  const onBlur = () => held.clear();

  target.addEventListener("keydown", onKeyDown, { passive: false });
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    held,
    pending,
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
    },
  };
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

  // Normalise so diagonal movement is not faster than orthogonal.
  if (dx !== 0 && dy !== 0) {
    const inv = Math.SQRT1_2;
    dx *= inv;
    dy *= inv;
  }
  return { dx, dy };
}
