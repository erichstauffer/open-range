/**
 * Saving.
 *
 * Only the things that cannot be re-derived are stored: the seed, what has been
 * collected, what has been heard, where the player stands, and which tiles have
 * been seen. Everything else comes back out of `generateWorld`, which is why a
 * save is a couple of kilobytes rather than a serialised map.
 *
 * The record is Zod-validated and version-stamped. A generator change bumps
 * `WORLD_VERSION` and old saves are discarded rather than silently loaded
 * against a world that no longer matches them - the same instinct as Market
 * Jack's immutable ModelVersion.
 */

import { z } from "zod";
import { WORLD_VERSION } from "../world/gen";
import { BARRIER_ORDER, type BarrierKind } from "../world/gates";
import type { GameState } from "./state";

const STORAGE_KEY = "open-range:save";

const SaveSchema = z.object({
  version: z.number().int(),
  seed: z.string().min(1),
  /** Content hash of the world this save was made against. */
  worldHash: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  facing: z.enum(["down", "left", "right", "up"]),
  collected: z.array(z.string()),
  inventory: z.array(z.enum(["river", "cliff", "bramble"])),
  hintIds: z.array(z.string()),
  talkedTo: z.array(z.string()),
  won: z.boolean(),
  elapsed: z.number().finite(),
  /** Run-length encoded visited bitmap: alternating counts of unseen/seen. */
  visitedRle: z.array(z.number().int().nonnegative()),
});

export type SaveRecord = z.infer<typeof SaveSchema>;

/**
 * Run-length encode the visited bitmap. Explored ground is highly contiguous,
 * so this turns ~50k bytes into a few hundred numbers.
 */
export function encodeVisited(visited: Uint8Array): number[] {
  const out: number[] = [];
  let current = 0;
  let run = 0;
  for (let i = 0; i < visited.length; i += 1) {
    const value = visited[i] ? 1 : 0;
    if (value === current) {
      run += 1;
    } else {
      out.push(run);
      current = value;
      run = 1;
    }
  }
  out.push(run);
  return out;
}

export function decodeVisited(rle: readonly number[], length: number): Uint8Array {
  const visited = new Uint8Array(length);
  let index = 0;
  let value = 0;
  for (const run of rle) {
    const end = Math.min(length, index + run);
    if (value === 1) visited.fill(1, index, end);
    index = end;
    value = value === 0 ? 1 : 0;
    if (index >= length) break;
  }
  return visited;
}

export function toSaveRecord(state: GameState): SaveRecord {
  return {
    version: WORLD_VERSION,
    seed: state.world.seed,
    worldHash: state.world.hash,
    x: state.x,
    y: state.y,
    facing: state.facing,
    collected: [...state.collected],
    inventory: [...state.inventory],
    hintIds: state.knownHints.map((h) => h.id),
    talkedTo: [...state.talkedTo],
    won: state.won,
    elapsed: state.elapsed,
    visitedRle: encodeVisited(state.visited),
  };
}

export function save(state: GameState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSaveRecord(state)));
  } catch {
    // A full or blocked storage quota must not interrupt play.
  }
}

export function loadRecord(): SaveRecord | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = SaveSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.version !== WORLD_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Apply a save onto a freshly generated state. The world hash must match, or
 * the coordinates and collected ids refer to a map that no longer exists.
 */
export function applySave(state: GameState, record: SaveRecord): boolean {
  if (record.seed !== state.world.seed) return false;
  if (record.worldHash !== state.world.hash) return false;

  state.x = record.x;
  state.y = record.y;
  state.facing = record.facing;
  state.collected = new Set(record.collected);
  state.inventory = new Set(record.inventory.filter((k): k is BarrierKind => BARRIER_ORDER.includes(k)));
  state.talkedTo = new Set(record.talkedTo);
  state.won = record.won;
  state.elapsed = record.elapsed;
  state.visited = decodeVisited(record.visitedRle, state.world.width * state.world.height);

  const known = new Set(record.hintIds);
  state.knownHints = state.world.hints.filter((h) => known.has(h.id));

  return true;
}
