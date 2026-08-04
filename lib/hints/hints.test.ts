import { describe, expect, it } from "vitest";
import { specById } from "../art/palette";
import { ARTIFACT_ANCHOR_RADIUS, BARRIER_ORDER, isPassable, reachableTiles, type BarrierKind, type WalkContext } from "../world/gates";
import { generateWorld, type World } from "../world/gen";
import { compassBetween } from "../world/regions";
import { distanceBetween } from "../world/landmarks";

/**
 * Hint integrity.
 *
 * Two properties matter, and neither is about wording:
 *
 *  1. TRUTHFULNESS - every clue's claim holds in the world that produced it.
 *     Speakers are generated from world state, so a false clue means the
 *     generator disagrees with itself.
 *  2. REACHABILITY - every clue for an artifact stands in ground the player can
 *     walk to before needing that artifact. A clue behind the door it describes
 *     is worse than no clue.
 */

const W = 128;
const H = 128;

function seeds(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

function contextOf(world: World): WalkContext {
  return {
    width: world.width,
    height: world.height,
    tiles: world.tiles,
    barrierOf: world.barrierOf,
    solid: new Set(world.props.filter((p) => p.solid).map((p) => p.tile)),
    startTile: world.startTile,
  };
}

describe("hint chains exist", () => {
  it("gives every artifact a three-link chain", () => {
    for (const seed of seeds(40, "chain")) {
      const world = generateWorld(seed, W, H);
      for (const artifact of world.artifacts) {
        const levels = world.hints.filter((h) => h.artifactId === artifact.id).map((h) => h.level).sort();
        expect(levels, `${seed} ${artifact.id}`).toEqual([1, 2, 3]);
      }
    }
  });

  it("links each speaker to the next by name and place", () => {
    for (const seed of seeds(25, "referral")) {
      const world = generateWorld(seed, W, H);
      const byId = new Map(world.npcs.map((n) => [n.id, n]));

      for (const npc of world.npcs) {
        if (!npc.referralTo) continue;
        const target = byId.get(npc.referralTo);
        expect(target, `${seed} ${npc.id} points at a missing speaker`).toBeDefined();
        if (!target) continue;

        const referralLine = npc.lines[1];
        expect(referralLine, `${seed} ${npc.id} has no referral line`).toBeDefined();
        // The referral must name the target's actual role and actual region.
        expect(referralLine).toContain(target.role);
        const region = world.regions[target.regionId];
        expect(region, `${seed} region ${target.regionId}`).toBeDefined();
        if (region) expect(referralLine).toContain(region.name);
      }
    }
  });

  it("ends each chain without a dangling referral", () => {
    for (const seed of seeds(20, "tail")) {
      const world = generateWorld(seed, W, H);
      for (const artifact of world.artifacts) {
        const chain = world.npcs.filter((n) => n.hint?.artifactId === artifact.id);
        const last = chain.find((n) => n.hint?.level === 3);
        expect(last, `${seed} ${artifact.id}`).toBeDefined();
        expect(last?.referralTo).toBeUndefined();
      }
    }
  });
});

describe("hints tell the truth", () => {
  it("names the terrain the artifact actually lies on", () => {
    for (const seed of seeds(40, "truth-terrain")) {
      const world = generateWorld(seed, W, H);
      for (const artifact of world.artifacts) {
        const hint = world.hints.find((h) => h.artifactId === artifact.id && h.level === 1);
        expect(hint, `${seed} ${artifact.id}`).toBeDefined();
        if (!hint) continue;
        const actual = specById(world.tiles[artifact.tile]).label;
        expect(hint.text, `${seed} ${artifact.id}: "${hint.text}"`).toContain(actual);
      }
    }
  });

  it("names the region the artifact is actually in, with the right compass word", () => {
    for (const seed of seeds(40, "truth-region")) {
      const world = generateWorld(seed, W, H);
      const byId = new Map(world.npcs.map((n) => [n.id, n]));

      for (const artifact of world.artifacts) {
        const hint = world.hints.find((h) => h.artifactId === artifact.id && h.level === 2);
        if (!hint) continue;

        const artifactRegion = world.regions[world.regionOf[artifact.tile]];
        expect(artifactRegion, `${seed} ${artifact.id}`).toBeDefined();
        if (!artifactRegion) continue;
        // Case-insensitive: a region name beginning "the ..." is legitimately
        // capitalised when a template puts it at the start of a sentence.
        expect(hint.text.toLowerCase(), `${seed} ${artifact.id}`).toContain(artifactRegion.name.toLowerCase());

        const speaker = byId.get(hint.npcId);
        const speakerRegion = speaker ? world.regions[speaker.regionId] : undefined;
        if (speakerRegion) {
          const compass = compassBetween(speakerRegion, artifactRegion);
          // Compared case-insensitively: a template may open a sentence with
          // the direction word, e.g. "Close by, too."
          const mentionsDirection = hint.text.toLowerCase().includes(compass.toLowerCase());
          expect(mentionsDirection, `${seed} ${artifact.id}: "${hint.text}" vs "${compass}"`).toBe(true);
        }
      }
    }
  });

  it("names a landmark that really is beside the artifact", () => {
    for (const seed of seeds(40, "truth-landmark")) {
      const world = generateWorld(seed, W, H);
      const byId = new Map(world.landmarks.map((l) => [l.id, l]));

      for (const artifact of world.artifacts) {
        const hint = world.hints.find((h) => h.artifactId === artifact.id && h.level === 3);
        if (!hint) continue;

        const anchor = byId.get(artifact.anchorLandmarkId);
        expect(anchor, `${seed} ${artifact.id} has no anchor landmark`).toBeDefined();
        if (!anchor) continue;

        expect(hint.text, `${seed}: "${hint.text}"`).toContain(anchor.label);

        // "Beneath the split oak" has to mean it. Allow a little slack over the
        // placement radius for the fallback path in placeArtifacts.
        const distance = distanceBetween(artifact.tile, anchor.tile, world.width);
        expect(distance, `${seed} ${artifact.id} is ${distance.toFixed(1)} tiles from its landmark`).toBeLessThanOrEqual(
          ARTIFACT_ANCHOR_RADIUS * 4,
        );
      }
    }
  });

  it("never places a speaker on impassable ground", () => {
    for (const seed of seeds(30, "standing")) {
      const world = generateWorld(seed, W, H);
      const ctx = contextOf(world);
      const everything = new Set<BarrierKind>(world.artifacts.map((a) => a.opens));
      for (const npc of world.npcs) {
        expect(isPassable(ctx, npc.tile, everything), `${seed} ${npc.id}`).toBe(true);
      }
    }
  });
});

describe("hints are reachable before they are needed", () => {
  it("keeps every clue inside the ground already open to the player", () => {
    const failures: string[] = [];

    for (const seed of seeds(150, "reach")) {
      const world = generateWorld(seed, W, H);
      const ctx = contextOf(world);
      const byId = new Map(world.npcs.map((n) => [n.id, n]));

      for (const artifact of world.artifacts) {
        // Only what earlier tiers granted.
        const carrying = new Set<BarrierKind>(
          world.artifacts.filter((a) => a.tier < artifact.tier).map((a) => a.opens),
        );
        const reachable = reachableTiles(ctx, carrying);

        for (const hint of world.hints.filter((h) => h.artifactId === artifact.id)) {
          const speaker = byId.get(hint.npcId);
          if (!speaker) {
            failures.push(`${seed}: ${hint.id} has no speaker`);
            continue;
          }
          if (!reachable.has(speaker.tile)) {
            failures.push(`${seed}: ${hint.id} speaker unreachable at tier ${artifact.tier}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the full chain walkable in order, clue to clue to artifact", () => {
    // The end-to-end claim: following the chain is a route, not a teleport.
    for (const seed of seeds(40, "route")) {
      const world = generateWorld(seed, W, H);
      const ctx = contextOf(world);

      for (const artifact of world.artifacts) {
        const carrying = new Set<BarrierKind>(
          world.artifacts.filter((a) => a.tier < artifact.tier).map((a) => a.opens),
        );
        const reachable = reachableTiles(ctx, carrying);
        const chain = world.npcs
          .filter((n) => n.hint?.artifactId === artifact.id)
          .sort((a, b) => (a.hint?.level ?? 0) - (b.hint?.level ?? 0));

        expect(chain.length, `${seed} ${artifact.id}`).toBe(3);
        for (const npc of chain) {
          expect(reachable.has(npc.tile), `${seed} ${npc.id}`).toBe(true);
        }
        expect(reachable.has(artifact.tile), `${seed} ${artifact.id}`).toBe(true);
      }
    }
  });

  it("puts the barrier terrain each artifact opens somewhere on the map", () => {
    for (const seed of seeds(30, "barriers")) {
      const world = generateWorld(seed, W, H);
      const present = new Set<BarrierKind>();
      for (let i = 0; i < world.barrierOf.length; i += 1) {
        const barrier = world.barrierOf[i];
        if (barrier !== 0) present.add(BARRIER_ORDER[barrier - 1]);
      }
      for (const artifact of world.artifacts) {
        expect(present.has(artifact.opens), `${seed} ${artifact.opens}`).toBe(true);
      }
    }
  });
});

describe("naming", () => {
  it("gives every region a non-empty name", () => {
    for (const seed of seeds(25, "names")) {
      const world = generateWorld(seed, W, H);
      for (const region of world.regions) {
        expect(region.name.length, `${seed} region ${region.id}`).toBeGreaterThan(2);
      }
    }
  });

  it("gives every artifact a name mentioning what it does", () => {
    const nouns: Record<BarrierKind, string> = {
      river: "Ford Stone",
      cliff: "Climbing Hooks",
      bramble: "Bramble Blade",
    };
    for (const seed of seeds(25, "artifact-names")) {
      const world = generateWorld(seed, W, H);
      for (const artifact of world.artifacts) {
        expect(artifact.name, `${seed} ${artifact.id}`).toContain(nouns[artifact.opens]);
      }
    }
  });

  it("never names a region after terrain it does not contain", () => {
    // A region called "the Grey Fen" must not turn out to be a snowfield.
    const groups: Record<string, readonly string[]> = {
      water: ["Reach", "Sound", "Narrows", "Shallows"],
      shore: ["Strand", "Shingle", "Sands", "Shore"],
      meadow: ["Meadows", "Green", "Lea", "Downs", "Fields"],
      moor: ["Moor", "Heath", "Fen", "Waste", "Marches"],
      woodland: ["Wood", "Thicket", "Holt", "Weald", "Grove"],
      highland: ["Fells", "Scarp", "Tors", "Crags", "Heights"],
      snow: ["Whites", "Rime", "Cap", "Frost", "Cirque"],
    };

    for (const seed of seeds(20, "name-match")) {
      const world = generateWorld(seed, W, H);
      for (const region of world.regions) {
        const expectedGroup = Object.entries(groups).find(([, words]) =>
          words.some((word) => region.name.endsWith(word)),
        );
        if (!expectedGroup) continue; // Invented or compound name, nothing to check.

        // The dominant terrain must belong to the same family as the name.
        const family: Record<string, string> = {
          deepWater: "water",
          shallowWater: "water",
          river: "water",
          shore: "shore",
          meadow: "meadow",
          moor: "moor",
          woodland: "woodland",
          bramble: "woodland",
          highland: "highland",
          cliff: "highland",
          snow: "snow",
        };
        expect(family[region.dominantKind], `${seed} "${region.name}" is ${region.dominantKind}`).toBe(
          expectedGroup[0],
        );
      }
    }
  });
});
