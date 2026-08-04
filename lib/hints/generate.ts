/**
 * NPCs and hint chains - the Dragon Warrior loop.
 *
 * From the transcript: "you go and talk to this person, and they get a little
 * bit of information, then you go talk to the next person and ultimately
 * complete the project." That is the whole progression mechanic here. There are
 * no quest markers and no map pins; you find an artifact by assembling
 * fragments, and the journal is your working document.
 *
 * For every artifact, three speakers form a chain:
 *
 *   speaker 1  →  terrain clue  + "ask the ferryman in the Grey Fen"
 *   speaker 2  →  region clue   + "ask the miner in Dunhollow"
 *   speaker 3  →  landmark clue
 *
 * The invariant that makes this playable: all three speakers stand in regions
 * reachable BEFORE that artifact is needed. Otherwise a clue would be locked
 * behind the door it describes. `hints.test.ts` checks it on every seed it
 * generates.
 */

import { shuffle, type Rng } from "../rand";
import { specById } from "../art/palette";
import { makeCharacterSpec, type CharacterSpec } from "../art/sprites";
import { reachableTiles, type Artifact, type BarrierKind, type WalkContext } from "../world/gates";
import type { Landmark } from "../world/landmarks";
import { compassBetween, type RegionMap } from "../world/regions";
import { personName } from "../world/names";
import { ambientLine, landmarkHint, referral, regionHint, terrainHint } from "./grammar";

export interface Hint {
  id: string;
  artifactId: string;
  /** 1 = terrain, 2 = region and direction, 3 = landmark. */
  level: 1 | 2 | 3;
  text: string;
  /** Speaker, for attribution in the journal. */
  npcId: string;
}

export interface Npc {
  id: string;
  name: string;
  role: string;
  regionId: number;
  tile: number;
  spec: CharacterSpec;
  /** Spoken in order when talked to. */
  lines: string[];
  hint?: Hint;
  /** Id of the speaker this one points at, if any. */
  referralTo?: string;
}

export interface HintPlan {
  npcs: Npc[];
  hints: Hint[];
}

const AMBIENT_NPCS = 5;
/** Keep speakers apart so a chain is a journey rather than three steps. */
const MIN_NPC_SPACING = 10;

interface Slot {
  tile: number;
  regionId: number;
}

/**
 * Speaker positions drawn from a set of REACHABLE tiles.
 *
 * Keyed to tile reachability rather than to whole regions, for the same reason
 * artifact placement is: a painted border can cut a region's interior into
 * pockets, and a speaker in an unreachable pocket is a clue the player can
 * never collect.
 */
function openSlots(
  rng: Rng,
  ctx: WalkContext,
  regionMap: RegionMap,
  reachable: ReadonlySet<number>,
  taken: ReadonlyArray<Slot>,
  count: number,
): Slot[] {
  const { width } = ctx;
  const pool: Slot[] = [];
  for (const tile of reachable) {
    if (ctx.barrierOf[tile] !== 0) continue;
    const regionId = regionMap.regionOf[tile];
    if (regionId < 0) continue;
    pool.push({ tile, regionId });
  }

  const shuffled = shuffle(rng, pool);
  const chosen: Slot[] = [];
  const all = [...taken];

  for (const slot of shuffled) {
    const x = slot.tile % width;
    const y = (slot.tile - x) / width;
    const clear = all.every((other) => {
      const ox = other.tile % width;
      const oy = (other.tile - ox) / width;
      return Math.hypot(x - ox, y - oy) >= MIN_NPC_SPACING;
    });
    if (!clear) continue;
    chosen.push(slot);
    all.push(slot);
    if (chosen.length === count) break;
  }

  // A crowded reachable area still has to yield speakers, or the chain breaks.
  if (chosen.length < count) {
    for (const slot of shuffled) {
      if (chosen.length === count) break;
      if (chosen.some((c) => c.tile === slot.tile)) continue;
      chosen.push(slot);
    }
  }

  return chosen;
}

export function planHints(
  rng: Rng,
  ctx: WalkContext,
  regionMap: RegionMap,
  landmarks: readonly Landmark[],
  artifacts: readonly Artifact[],
): HintPlan {
  const npcs: Npc[] = [];
  const hints: Hint[] = [];
  const placed: Slot[] = [];
  const landmarkById = new Map(landmarks.map((l) => [l.id, l]));

  const carrying = new Set<BarrierKind>();

  for (const artifact of artifacts) {
    // Reachability BEFORE this artifact is owned: exactly where its clues may live.
    const reachable = reachableTiles(ctx, carrying);
    const slots = openSlots(rng, ctx, regionMap, reachable, placed, 3);
    if (slots.length === 0) {
      carrying.add(artifact.opens);
      continue;
    }
    placed.push(...slots);

    const artifactRegion = regionMap.regions[artifact.regionId];
    const anchor = landmarkById.get(artifact.anchorLandmarkId);
    const terrainLabel = specById(ctx.tiles[artifact.tile]).label;

    // Build the speakers first so each can name the next one truthfully.
    const chain: Npc[] = slots.slice(0, 3).map((slot, index) => {
      const { name, role } = personName(rng);
      return {
        id: `npc-${artifact.id}-${index}`,
        name,
        role,
        regionId: slot.regionId,
        tile: slot.tile,
        spec: makeCharacterSpec(rng),
        lines: [],
      };
    });

    chain.forEach((npc, index) => {
      const level = (index + 1) as 1 | 2 | 3;
      const speakerRegion = regionMap.regions[npc.regionId];

      let text: string;
      if (level === 1) {
        text = terrainHint(rng, { terrain: terrainLabel });
      } else if (level === 2) {
        text = regionHint(rng, {
          region: artifactRegion?.name ?? "these parts",
          compass: speakerRegion && artifactRegion ? compassBetween(speakerRegion, artifactRegion) : "close by",
        });
      } else {
        text = landmarkHint(rng, { landmark: anchor?.label ?? "old stones" });
      }

      const hint: Hint = { id: `${artifact.id}-l${level}`, artifactId: artifact.id, level, text, npcId: npc.id };
      npc.hint = hint;
      npc.lines = [text];
      hints.push(hint);

      // Referral to the next link, naming where they actually stand.
      const next = chain[index + 1];
      if (next) {
        const nextRegion = regionMap.regions[next.regionId];
        npc.referralTo = next.id;
        npc.lines.push(referral(rng, { role: next.role, region: nextRegion?.name ?? "these parts" }));
      }
    });

    npcs.push(...chain);
    carrying.add(artifact.opens);
  }

  // Ambient speakers, spread over everywhere the finished game can reach.
  const everywhere = reachableTiles(ctx, new Set(artifacts.map((a) => a.opens)));
  const ambientSlots = openSlots(rng, ctx, regionMap, everywhere, placed, AMBIENT_NPCS);
  ambientSlots.forEach((slot, index) => {
    const { name, role } = personName(rng);
    const region = regionMap.regions[slot.regionId];
    npcs.push({
      id: `npc-ambient-${index}`,
      name,
      role,
      regionId: slot.regionId,
      tile: slot.tile,
      spec: makeCharacterSpec(rng),
      lines: [
        ambientLine(rng, {
          region: region?.name ?? "these parts",
          terrain: specById(ctx.tiles[slot.tile]).label,
        }),
      ],
    });
  });

  return { npcs, hints };
}
