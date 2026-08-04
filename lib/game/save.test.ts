import { beforeEach, describe, expect, it } from "vitest";
import { generateWorld } from "../world/gen";
import { createGameState } from "./state";
import { applySave, clearSave, decodeVisited, encodeVisited, loadRecord, save, toSaveRecord } from "./save";

/**
 * Saves must survive a reload and must refuse to load against a world they were
 * not made for. The second half matters more than it looks: coordinates and
 * collected ids are meaningless against a different map, and silently accepting
 * them would teleport the player into the sea.
 */

const W = 96;
const H = 96;

/** Minimal localStorage stand-in, since these tests run in node. */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).localStorage = new MemoryStorage();
});

describe("visited run-length coding", () => {
  it("round-trips an arbitrary bitmap", () => {
    const source = new Uint8Array(1000);
    for (let i = 0; i < source.length; i += 1) source[i] = i % 37 < 11 ? 1 : 0;
    expect(Array.from(decodeVisited(encodeVisited(source), source.length))).toEqual(Array.from(source));
  });

  it("round-trips the all-unseen and all-seen extremes", () => {
    const empty = new Uint8Array(500);
    const full = new Uint8Array(500).fill(1);
    expect(Array.from(decodeVisited(encodeVisited(empty), 500))).toEqual(Array.from(empty));
    expect(Array.from(decodeVisited(encodeVisited(full), 500))).toEqual(Array.from(full));
  });

  it("compresses contiguous exploration heavily", () => {
    // Explored ground is contiguous in practice, which is the point of the RLE.
    const visited = new Uint8Array(50000);
    visited.fill(1, 12000, 30000);
    expect(encodeVisited(visited).length).toBeLessThan(10);
  });
});

describe("save round trip", () => {
  it("restores position, inventory, clues and explored ground", () => {
    const world = generateWorld("save-seed", W, H);
    const state = createGameState(world);

    state.x += 37.5;
    state.y += 12.25;
    state.facing = "left";
    state.visited.fill(1, 0, 400);
    state.elapsed = 91.5;
    if (world.artifacts[0]) {
      state.collected.add(world.artifacts[0].id);
      state.inventory.add(world.artifacts[0].opens);
    }
    state.knownHints = world.hints.slice(0, 2);
    state.talkedTo.add("npc-x");

    save(state);
    const record = loadRecord();
    expect(record).not.toBeNull();

    const reloaded = createGameState(generateWorld("save-seed", W, H));
    expect(record && applySave(reloaded, record)).toBe(true);

    expect(reloaded.x).toBeCloseTo(state.x, 5);
    expect(reloaded.y).toBeCloseTo(state.y, 5);
    expect(reloaded.facing).toBe("left");
    expect([...reloaded.collected]).toEqual([...state.collected]);
    expect([...reloaded.inventory]).toEqual([...state.inventory]);
    expect(reloaded.knownHints.map((h) => h.id)).toEqual(state.knownHints.map((h) => h.id));
    expect(reloaded.elapsed).toBeCloseTo(91.5, 5);
    expect(Array.from(reloaded.visited.slice(0, 400))).toEqual(Array.from(state.visited.slice(0, 400)));
  });

  it("refuses a save made against a different seed", () => {
    const state = createGameState(generateWorld("seed-a", W, H));
    save(state);
    const record = loadRecord();
    expect(record).not.toBeNull();

    const other = createGameState(generateWorld("seed-b", W, H));
    expect(record && applySave(other, record)).toBe(false);
  });

  it("refuses a save whose world hash no longer matches", () => {
    // Simulates a generator change: same seed, different content.
    const state = createGameState(generateWorld("drifted", W, H));
    save(state);
    const record = loadRecord();
    expect(record).not.toBeNull();
    if (!record) return;

    const tampered = { ...record, worldHash: "deadbeef" };
    localStorage.setItem("open-range:save", JSON.stringify(tampered));

    const fresh = createGameState(generateWorld("drifted", W, H));
    const loaded = loadRecord();
    expect(loaded && applySave(fresh, loaded)).toBe(false);
  });

  it("returns null for malformed storage rather than throwing", () => {
    localStorage.setItem("open-range:save", "{not json");
    expect(loadRecord()).toBeNull();
    localStorage.setItem("open-range:save", JSON.stringify({ version: 1 }));
    expect(loadRecord()).toBeNull();
  });

  it("stays small", () => {
    const world = generateWorld("size", W, H);
    const state = createGameState(world);
    state.visited.fill(1);
    const bytes = JSON.stringify(toSaveRecord(state)).length;
    // Everything else is re-derived from the seed, so a save is tiny.
    expect(bytes).toBeLessThan(4000);
  });

  it("clears cleanly", () => {
    const state = createGameState(generateWorld("clear", W, H));
    save(state);
    expect(loadRecord()).not.toBeNull();
    clearSave();
    expect(loadRecord()).toBeNull();
  });
});
