import { describe, expect, it } from "vitest";
import { specById } from "../art/palette";
import { VISITABLE_BUILDINGS } from "../art/sprites";
import { generateWorld } from "./gen";
import {
  TOWN_H,
  TOWN_W,
  buildingDoor,
  buildingTiles,
  isTownExit,
  townGateTile,
  type Town,
} from "./town";

const W = 128;
const H = 128;

const SEEDS = Array.from({ length: 40 }, (_, i) => `town-${i}`);

/**
 * Generated once and shared.
 *
 * `generateWorld` is a pure function of the seed, so the five sweeps below were
 * each rebuilding the same forty islands from scratch - two hundred generations
 * to check forty worlds.
 */
const worlds = new Map<string, ReturnType<typeof generateWorld>>();
function worldFor(seed: string) {
  const existing = worlds.get(seed);
  if (existing) return existing;
  const built = generateWorld(seed, W, H);
  worlds.set(seed, built);
  return built;
}

/** Tiles reachable on foot from the gate, given the interior's solid set. */
function reachableFromGate(town: Town): Set<number> {
  const solid = new Set(town.interior.solidTiles);
  const seen = new Set<number>([townGateTile()]);
  const queue = [townGateTile()];

  while (queue.length > 0) {
    const current = queue.shift() as number;
    const x = current % TOWN_W;
    const y = (current - x) / TOWN_W;
    for (let dir = 0; dir < 4; dir += 1) {
      const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= TOWN_W || ny >= TOWN_H) continue;
      const next = ny * TOWN_W + nx;
      if (seen.has(next) || solid.has(next)) continue;
      if (!specById(town.interior.tiles[next]).walkable) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe("town placement", () => {
  it("puts exactly one town in every region", () => {
    for (const seed of SEEDS) {
      const world = worldFor(seed);
      expect(world.towns.length, seed).toBe(world.regions.length);

      const regionIds = world.towns.map((t) => t.regionId).sort((a, b) => a - b);
      expect(regionIds, seed).toEqual(world.regions.map((r) => r.id).sort((a, b) => a - b));

      for (const town of world.towns) {
        expect(world.regionOf[town.tile], `${seed}: ${town.id} outside its region`).toBe(town.regionId);
      }
    }
  });

  it("stands each town on open, walkable, unclaimed ground", () => {
    for (const seed of SEEDS) {
      const world = worldFor(seed);
      const claimed = new Set<number>([
        ...world.landmarks.map((l) => l.tile),
        ...world.artifacts.map((a) => a.tile),
        ...world.npcs.map((n) => n.tile),
        ...world.props.filter((p) => p.solid).map((p) => p.tile),
        world.startTile,
        world.robotTile,
      ]);

      for (const town of world.towns) {
        expect(specById(world.tiles[town.tile]).walkable, `${seed}: ${town.id}`).toBe(true);
        expect(world.barrierOf[town.tile], `${seed}: ${town.id} on a barrier`).toBe(0);
        expect(claimed.has(town.tile), `${seed}: ${town.id} on something else`).toBe(false);
      }
    }
  });

  it("gives every town at least one of the four, and varies which", () => {
    const seen = new Set<string>();

    for (const seed of SEEDS) {
      for (const town of worldFor(seed).towns) {
        const visitable = town.buildings.filter((b) => VISITABLE_BUILDINGS.includes(b.kind));
        expect(visitable.length, `${seed}: ${town.id} has nothing to visit`).toBeGreaterThan(0);
        seen.add(
          visitable
            .map((b) => b.kind)
            .sort()
            .join("+"),
        );
      }
    }

    // The brief asked for "one or all or some". A generator that always produced
    // the same four would satisfy every other assertion here.
    expect(seen.size).toBeGreaterThan(6);
    expect(seen.has("church+inn+pub+store")).toBe(true);
  });

  it("is a pure function of the seed", () => {
    const a = generateWorld("repeatable", W, H).towns;
    const b = generateWorld("repeatable", W, H).towns;
    expect(a.map((t) => `${t.id}@${t.tile}:${t.name}`)).toEqual(b.map((t) => `${t.id}@${t.tile}:${t.name}`));
    expect(a[0].interior.npcs.map((n) => n.lines.join("|"))).toEqual(b[0].interior.npcs.map((n) => n.lines.join("|")));
  });
});

describe("town interiors", () => {
  it("keeps buildings off each other and out of the exit band", () => {
    for (const seed of SEEDS) {
      for (const town of worldFor(seed).towns) {
        const occupied = new Set<number>();
        for (const building of town.buildings) {
          for (const tile of buildingTiles(building)) {
            expect(occupied.has(tile), `${seed}: ${town.id} buildings overlap`).toBe(false);
            occupied.add(tile);

            const x = tile % TOWN_W;
            const y = (tile - x) / TOWN_W;
            expect(isTownExit(x, y), `${seed}: ${town.id} builds on the way out`).toBe(false);
          }
        }
      }
    }
  });

  it("lets a walker reach every door and every townsperson from the gate", () => {
    for (const seed of SEEDS) {
      for (const town of worldFor(seed).towns) {
        const reachable = reachableFromGate(town);

        for (const building of town.buildings) {
          // The door is a point on the boundary between two tiles; the tile you
          // stand in to use it is the one directly below the block.
          const door = buildingDoor(building, 16);
          const tile = Math.floor(door.y / 16) * TOWN_W + Math.floor(door.x / 16);
          expect(reachable.has(tile), `${seed}: ${town.id} ${building.kind} door unreachable`).toBe(true);
        }

        for (const npc of town.interior.npcs) {
          expect(reachable.has(npc.tile), `${seed}: ${town.id} ${npc.id} unreachable`).toBe(true);
        }
      }
    }
  });

  it("can be left in every direction", () => {
    for (const town of worldFor("exits").towns) {
      const reachable = reachableFromGate(town);
      const edges = [...reachable].filter((tile) => isTownExit(tile % TOWN_W, (tile - (tile % TOWN_W)) / TOWN_W));
      const xs = edges.map((t) => t % TOWN_W);
      const ys = edges.map((t) => (t - (t % TOWN_W)) / TOWN_W);

      expect(Math.min(...xs)).toBe(0);
      expect(Math.max(...xs)).toBe(TOWN_W - 1);
      expect(Math.min(...ys)).toBe(0);
      expect(Math.max(...ys)).toBe(TOWN_H - 1);
    }
  });

  it("holds no towns of its own, and no artifacts or barriers", () => {
    for (const town of worldFor("leaves").towns) {
      expect(town.interior.towns).toEqual([]);
      expect(town.interior.artifacts).toEqual([]);
      expect(town.interior.landmarks).toEqual([]);
      expect([...town.interior.barrierOf].every((b) => b === 0)).toBe(true);
    }
  });
});
