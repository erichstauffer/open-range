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
import { MAX_HP } from "./vitality";
import { enterTown } from "./town-transition";
import { walkContextFor, type GameState } from "./state";
import type { ShopItem } from "./shop";

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
  coins: z.number().int().nonnegative().default(0),
  /**
   * Weariness, and the part-charged remainder of the next point.
   *
   * The remainder is stored for the same reason the robot's recharge clock is:
   * without it, a reload seventeen tiles into a point would silently refund
   * those tiles, and reloading would be a way to walk for free.
   */
  hp: z.number().finite().default(MAX_HP),
  walked: z.number().finite().nonnegative().default(0),
  /** What is in the pack. Bought once, and carried until sold. */
  items: z.array(z.enum(["sword", "shield", "potion"])).default([]),
  potions: z.number().int().nonnegative().default(0),
  wood: z.number().int().nonnegative().default(0),
  /**
   * Tiles whose tree has been cut down.
   *
   * The one piece of the *island* a save has to carry. Everything else about the
   * world comes back out of `generateWorld`, but a felled tree is a change the
   * player made to it, and a reload that grew them all back would undo the only
   * lasting mark they can leave.
   */
  felled: z.array(z.number().int().nonnegative()).default([]),
  /**
   * The town they were standing in, if any.
   *
   * Stored with the position inside it, so closing the tab at a shop counter
   * reopens at the shop counter rather than dumping the player back on the road
   * outside with no explanation.
   */
  town: z
    .object({ id: z.string(), x: z.number().finite(), y: z.number().finite() })
    .nullable()
    .default(null),
  /** The last town entered, which is where a collapse wakes you up. */
  lastTownId: z.string().nullable().default(null),
  /**
   * Where the robot had walked to, and how far through its recharge it was.
   *
   * Optional so a record written before it existed still parses. Without this
   * the machine would teleport back to its spawn tile on every reload and hand
   * out a free payout, which would turn refreshing the page into the fastest
   * way to earn coins.
   */
  robot: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      facing: z.enum(["down", "left", "right", "up"]),
      rechargeAt: z.number().finite(),
      giftCount: z.number().int().nonnegative(),
    })
    .optional(),
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
  // Everything about the WORLD is read off the island, never off whatever map is
  // under the player's feet. Saving inside a town would otherwise stamp the
  // record with the town's seed and hash, and with a position twenty tiles into
  // a 24x18 street - which on reload would be validated against the island and
  // rejected, or worse, accepted.
  const island = state.outdoor ?? state;

  return {
    version: WORLD_VERSION,
    seed: island.world.seed,
    worldHash: island.world.hash,
    x: island.x,
    y: island.y,
    facing: island.facing,
    collected: [...state.collected],
    inventory: [...state.inventory],
    hintIds: state.knownHints.map((h) => h.id),
    talkedTo: [...state.talkedTo],
    coins: state.coins,
    hp: state.hp,
    walked: state.walkedSincePoint,
    items: [...state.items],
    potions: state.potions,
    wood: state.wood,
    felled: [...state.felled],
    town: state.townId === null ? null : { id: state.townId, x: state.x, y: state.y },
    lastTownId: state.lastTownId,
    robot: {
      x: state.robot.x,
      y: state.robot.y,
      facing: state.robot.facing,
      rechargeAt: state.robot.rechargeAt,
      giftCount: state.robot.giftCount,
    },
    won: state.won,
    elapsed: state.elapsed,
    visitedRle: encodeVisited(island.visited),
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
  state.coins = record.coins;
  // Clamped rather than trusted: `maxHp` is a constant a later version may raise,
  // and a stored value above it would leave the pip row overflowing its box.
  state.hp = Math.max(0, Math.min(state.maxHp, record.hp));
  state.walkedSincePoint = record.walked;

  state.items = new Set(record.items.filter((item): item is Exclude<ShopItem, "potion"> => item !== "potion"));
  state.potions = record.potions;
  state.wood = record.wood;
  state.lastTownId = record.lastTownId;

  // Felled trees are replayed into the walk context rather than trusted to a
  // set on its own: the context was built at `createGameState` time, when every
  // tree was still standing.
  state.felled = new Set(record.felled);
  state.ctx = walkContextFor(state.world, state.felled);
  if (record.robot) {
    state.robot.x = record.robot.x;
    state.robot.y = record.robot.y;
    state.robot.facing = record.robot.facing;
    state.robot.rechargeAt = record.robot.rechargeAt;
    state.robot.giftCount = record.robot.giftCount;
    // It carries on from where it stood rather than from where it woke.
    state.robot.targetX = record.robot.x;
    state.robot.targetY = record.robot.y;
  }
  state.won = record.won;
  state.elapsed = record.elapsed;
  state.visited = decodeVisited(record.visitedRle, state.world.width * state.world.height);

  const known = new Set(record.hintIds);
  state.knownHints = state.world.hints.filter((h) => known.has(h.id));

  // Last, and after the island is fully restored: `enterTown` parks whatever is
  // on `state` at the moment it runs, so it has to see the loaded island rather
  // than the freshly generated one.
  if (record.town) {
    const town = state.world.towns.find((candidate) => candidate.id === record.town?.id);
    // A missing town is not a corrupt save - it is a save made against a world
    // whose towns have since moved, which the hash check should already have
    // caught. Standing outside where it used to be is the safe answer.
    if (town) {
      enterTown(state, town);
      state.x = record.town.x;
      state.y = record.town.y;
    }
  }

  return true;
}
