/**
 * Named landmarks.
 *
 * These exist to serve the hint system. The most specific tier of clue names a
 * landmark out loud - "beneath the split oak" - so there has to be something in
 * the world that a player can recognise on sight and walk to. Every region gets
 * at least one, and the artifact-bearing regions get one close to the artifact.
 */

import { pick, shuffle, type Rng } from "../rand";
import { LANDMARK_KINDS, LANDMARK_LABELS, type LandmarkKind } from "../art/sprites";
import { inventedName } from "./names";
import type { GateLayout } from "./gates";
import type { RegionMap } from "./regions";
import type { TerrainFields } from "./biome";

export interface Landmark {
  id: string;
  kind: LandmarkKind;
  /** e.g. "split oak" - used verbatim inside hint sentences. */
  label: string;
  /** e.g. "the split oak of Enneth" - used when the landmark is named formally. */
  properName: string;
  tile: number;
  regionId: number;
}

/** Minimum separation so two landmarks never crowd each other. */
const MIN_SPACING = 14;

/** Landmarks that suit a given dominant terrain, so nothing looks out of place. */
const BY_TERRAIN: Readonly<Record<string, readonly LandmarkKind[]>> = {
  shore: ["standingStones", "cairn", "ruinedArch"],
  meadow: ["splitOak", "standingStones", "spring", "ruinedArch"],
  moor: ["cairn", "standingStones", "spring"],
  woodland: ["splitOak", "spring", "ruinedArch"],
  highland: ["cairn", "summit", "standingStones"],
  snow: ["cairn", "summit"],
};

function suitableKinds(dominantKind: string): readonly LandmarkKind[] {
  switch (dominantKind) {
    case "shore":
      return BY_TERRAIN.shore;
    case "meadow":
      return BY_TERRAIN.meadow;
    case "moor":
      return BY_TERRAIN.moor;
    case "woodland":
    case "bramble":
      return BY_TERRAIN.woodland;
    case "highland":
    case "cliff":
      return BY_TERRAIN.highland;
    case "snow":
      return BY_TERRAIN.snow;
    default:
      return LANDMARK_KINDS;
  }
}

export function placeLandmarks(
  rng: Rng,
  terrain: TerrainFields,
  regionMap: RegionMap,
  layout: GateLayout,
  perRegion = 2,
): Landmark[] {
  const { width } = terrain;
  const landmarks: Landmark[] = [];

  for (const region of regionMap.regions) {
    const open = region.tiles.filter((tile) => layout.barrierOf[tile] === 0);
    if (open.length === 0) continue;

    const shuffled = shuffle(rng, [...open]);
    const chosen: number[] = [];

    for (const tile of shuffled) {
      const x = tile % width;
      const y = (tile - x) / width;
      const clear = chosen.every((other) => {
        const ox = other % width;
        const oy = (other - ox) / width;
        return Math.hypot(x - ox, y - oy) >= MIN_SPACING;
      });
      if (!clear) continue;
      chosen.push(tile);
      if (chosen.length === perRegion) break;
    }

    // A cramped region still gets one landmark, so no region is unnameable.
    if (chosen.length === 0) chosen.push(shuffled[0]);

    const kinds = suitableKinds(region.dominantKind);
    chosen.forEach((tile, i) => {
      const kind = pick(rng, kinds);
      landmarks.push({
        id: `lm-${region.id}-${i}`,
        kind,
        label: LANDMARK_LABELS[kind],
        properName: `the ${LANDMARK_LABELS[kind]} of ${inventedName(rng)}`,
        tile,
        regionId: region.id,
      });
    });
  }

  return landmarks;
}

/** The landmark closest to a tile, which is what a specific hint should name. */
export function nearestLandmark(landmarks: readonly Landmark[], tile: number, width: number): Landmark | undefined {
  const x = tile % width;
  const y = (tile - x) / width;

  let best: Landmark | undefined;
  let bestDistance = Infinity;
  for (const landmark of landmarks) {
    const lx = landmark.tile % width;
    const ly = (landmark.tile - lx) / width;
    const distance = Math.hypot(x - lx, y - ly);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = landmark;
    }
  }
  return best;
}

export function distanceBetween(a: number, b: number, width: number): number {
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  return Math.hypot(ax - bx, ay - by);
}
