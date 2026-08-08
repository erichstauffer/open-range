/**
 * Procedural characters, artifacts, landmarks and props.
 *
 * Two different generators, chosen deliberately:
 *
 *  - Characters and landmarks use a hand-written TEMPLATE with seeded
 *    variation. Purely random masks look like noise, and a top-down game needs
 *    a silhouette you can read instantly.
 *  - Artifacts use a MIRRORED RANDOM MASK. Treasure should look strange and
 *    unrepeatable, and symmetry alone is enough to make it read as made rather
 *    than grown.
 *
 * Every colour comes from `SPRITE_PALETTE` / `CLOAK_COLORS`, which are built in
 * the same constrained space as the terrain, so characters sit in the
 * landscape instead of on top of it.
 */

import { pick, type Rng } from "../rand";
import { CLOAK_COLORS, SPRITE_PALETTE } from "./palette";
import { outlineOpaque } from "./canvas";
import type { Ctx2D } from "./tiles";

export const CHAR_W = 16;
export const CHAR_H = 20;
/** Feet centre, in sprite-local pixels. Entities are positioned by this point. */
export const CHAR_ANCHOR = { x: 8, y: 19 } as const;

export const PROP_W = 16;
export const PROP_H = 24;
export const PROP_ANCHOR = { x: 8, y: 23 } as const;

export const LANDMARK_W = 32;
export const LANDMARK_H = 32;
export const LANDMARK_ANCHOR = { x: 16, y: 31 } as const;

export const ARTIFACT_SIZE = 16;

export type Facing = "down" | "left" | "right" | "up";
export const FACINGS: readonly Facing[] = ["down", "left", "right", "up"];

function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function px(ctx: Ctx2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// --- Characters -------------------------------------------------------------

export interface CharacterSpec {
  hair: string;
  cloak: string;
  cloakShade: string;
  trouser: string;
  accent: string;
  hood: boolean;
  staff: boolean;
}

/**
 * Hair is either clearly dark or clearly light, never mid-tone. Mid-tone hair
 * against a mid-tone cloak erased the head as a separate shape.
 */
const HAIR_COLORS: readonly string[] = [
  SPRITE_PALETTE.outline,
  SPRITE_PALETTE.wood,
  SPRITE_PALETTE.gold,
  SPRITE_PALETTE.stone,
];

export function makeCharacterSpec(rng: Rng): CharacterSpec {
  const cloakIndex = Math.floor(rng() * CLOAK_COLORS.length);
  return {
    hair: pick(rng, HAIR_COLORS),
    cloak: CLOAK_COLORS[cloakIndex],
    cloakShade: SPRITE_PALETTE.shadow,
    trouser: SPRITE_PALETTE.trouser,
    accent: rng() < 0.4 ? SPRITE_PALETTE.gold : SPRITE_PALETTE.metal,
    hood: rng() < 0.45,
    staff: rng() < 0.3,
  };
}

/**
 * Draw one character cell into a 16x20 surface, feet at the bottom.
 *
 * Only `down`, `left` and `up` are drawn; `right` is produced by mirroring
 * `left` at bake time, which guarantees the two profiles match exactly.
 */
export function drawCharacter(
  ctx: Ctx2D,
  spec: CharacterSpec,
  facing: Exclude<Facing, "right">,
  frame: 0 | 1,
): void {
  const profile = facing === "left";

  // Legs first so the cloak overlaps them.
  const legLift = frame === 1 ? 1 : 0;
  const legColor = spec.trouser;
  if (profile) {
    rect(ctx, 6, 15 + legLift, 2, 4 - legLift, legColor);
    rect(ctx, 9, 15, 2, 4 - legLift, legColor);
  } else {
    rect(ctx, 5, 15 + legLift, 2, 4 - legLift, legColor);
    rect(ctx, 9, 15, 2, 4 - legLift, legColor);
  }

  // Arms behind the torso block.
  if (profile) {
    rect(ctx, 5, 10, 2, 4, spec.cloakShade);
  } else {
    rect(ctx, 3, 10, 2, 4, spec.cloakShade);
    rect(ctx, 11, 10, 2, 4, spec.cloakShade);
  }

  // Torso.
  if (profile) {
    rect(ctx, 5, 9, 6, 6, spec.cloak);
  } else {
    rect(ctx, 4, 9, 8, 6, spec.cloak);
    // A vertical seam gives the cloak a centre without a gradient.
    rect(ctx, 7, 9, 1, 5, spec.cloakShade);
  }
  rect(ctx, profile ? 5 : 5, 14, 6, 1, SPRITE_PALETTE.wood);

  // Head.
  if (facing === "up") {
    rect(ctx, 5, 2, 6, 7, spec.hair);
  } else if (profile) {
    rect(ctx, 5, 5, 5, 4, SPRITE_PALETTE.skin);
    rect(ctx, 5, 2, 6, 3, spec.hair);
    rect(ctx, 5, 5, 1, 2, spec.hair);
    px(ctx, 7, 6, SPRITE_PALETTE.outline);
    rect(ctx, 5, 8, 5, 1, SPRITE_PALETTE.skinShade);
  } else {
    rect(ctx, 5, 5, 6, 4, SPRITE_PALETTE.skin);
    rect(ctx, 5, 2, 6, 3, spec.hair);
    px(ctx, 6, 6, SPRITE_PALETTE.outline);
    px(ctx, 9, 6, SPRITE_PALETTE.outline);
    rect(ctx, 5, 8, 6, 1, SPRITE_PALETTE.skinShade);
  }

  if (spec.hood) {
    // A hood is drawn as a shoulder mantle, which also unifies the silhouette.
    if (profile) rect(ctx, 4, 8, 7, 2, spec.cloakShade);
    else rect(ctx, 3, 8, 10, 2, spec.cloakShade);
    if (facing === "up") rect(ctx, 5, 2, 6, 4, spec.cloakShade);
  }

  if (spec.staff && facing !== "up") {
    rect(ctx, profile ? 3 : 13, 6, 1, 12, SPRITE_PALETTE.wood);
    px(ctx, profile ? 3 : 13, 5, spec.accent);
  }

  outlineOpaque(ctx, CHAR_W, CHAR_H, SPRITE_PALETTE.outline);
}

// --- The robot --------------------------------------------------------------

/**
 * The one machine on the island, drawn from `assets/robot.png`.
 *
 * Hand-authored rather than downscaled from the artwork. The reference is a
 * hatched three-quarter line drawing on a glow; at sixteen pixels the hatching
 * collapses into a smudge, and a single illustration has no side view, no back
 * and no walk cycle. What survives the translation is the *identity* - antenna,
 * boxy head, two lit slots for eyes, the panelled chest with its dial and
 * buttons, and the heavy square feet - so the sprite reads as the same
 * character while behaving like every other thing in the world.
 *
 * Shares `drawCharacter`'s geometry exactly: a 16x20 cell, feet at
 * `CHAR_ANCHOR`, `left` mirrored into `right` at bake time, and one pixel of
 * clearance on every side for `outlineOpaque`.
 */
/**
 * Reserved character id. The robot shares the character key space with the
 * player and the NPCs, so this must not collide with a generated npc id.
 */
export const ROBOT_ID = "robot";

export function drawRobot(ctx: Ctx2D, facing: Exclude<Facing, "right">, frame: 0 | 1): void {
  const plate = SPRITE_PALETTE.robotPlate;
  const blue = SPRITE_PALETTE.robotBlue;
  const shade = SPRITE_PALETTE.robotBlueShade;
  const profile = facing === "left";

  // Legs first, so the body overlaps them - the same order and the same
  // one-pixel lift as the walk cycle every other character uses.
  const legLift = frame === 1 ? 1 : 0;
  if (profile) {
    rect(ctx, 6, 15 + legLift, 2, 3 - legLift, shade);
    rect(ctx, 9, 15, 2, 3 - legLift, plate);
    rect(ctx, 5, 18 - legLift, 4, 1, shade);
    rect(ctx, 8, 18, 4, 1, plate);
  } else {
    rect(ctx, 5, 15 + legLift, 2, 3 - legLift, shade);
    rect(ctx, 9, 15, 2, 3 - legLift, shade);
    // Square feet, wider than the legs: what makes the silhouette read as
    // machined rather than as a person in a costume.
    rect(ctx, 4, 18 - legLift, 3, 1, plate);
    rect(ctx, 9, 18, 3, 1, plate);
  }

  // Arms, behind the torso block.
  if (profile) {
    rect(ctx, 4, 10, 2, 4, plate);
    px(ctx, 4, 13, shade);
  } else {
    rect(ctx, 2, 10, 2, 4, plate);
    rect(ctx, 12, 10, 2, 4, plate);
    px(ctx, 2, 13, shade);
    px(ctx, 13, 13, shade);
  }

  // Torso.
  if (profile) {
    rect(ctx, 5, 9, 6, 6, plate);
    rect(ctx, 6, 10, 3, 4, blue);
    px(ctx, 7, 11, SPRITE_PALETTE.glow);
  } else if (facing === "up") {
    rect(ctx, 4, 9, 8, 6, plate);
    // Seen from behind: a vent panel instead of the face of the machine.
    rect(ctx, 6, 10, 4, 4, shade);
    rect(ctx, 6, 11, 4, 1, plate);
  } else {
    rect(ctx, 4, 9, 8, 6, plate);
    rect(ctx, 5, 10, 6, 4, blue);
    // Display bar, dial and three buttons, as on the chest in the reference.
    rect(ctx, 6, 11, 4, 1, plate);
    px(ctx, 6, 12, SPRITE_PALETTE.glow);
    px(ctx, 8, 12, plate);
    px(ctx, 9, 12, plate);
  }
  rect(ctx, profile ? 5 : 4, 14, profile ? 6 : 8, 1, shade);

  // Head, with the antenna above it.
  rect(ctx, 8, 1, 1, 2, plate);
  px(ctx, 8, 1, SPRITE_PALETTE.glow);

  if (facing === "up") {
    rect(ctx, 5, 3, 6, 5, plate);
    rect(ctx, 5, 6, 6, 1, shade);
  } else if (profile) {
    rect(ctx, 5, 3, 5, 5, plate);
    rect(ctx, 5, 5, 4, 2, shade);
    px(ctx, 5, 5, SPRITE_PALETTE.glow);
  } else {
    rect(ctx, 5, 3, 6, 5, plate);
    // The visor: a dark band with two lit slots, which is the whole face.
    rect(ctx, 5, 5, 6, 2, shade);
    px(ctx, 6, 5, SPRITE_PALETTE.glow);
    px(ctx, 9, 5, SPRITE_PALETTE.glow);
  }
  rect(ctx, 7, 8, 2, 1, shade);

  outlineOpaque(ctx, CHAR_W, CHAR_H, SPRITE_PALETTE.outline);
}

// --- Artifacts --------------------------------------------------------------

/**
 * Mirrored random mask. `rng` should be derived from the artifact's own id, so
 * the same artifact looks the same in every session and across machines.
 */
export function drawArtifact(ctx: Ctx2D, rng: Rng): void {
  const size = ARTIFACT_SIZE;
  const half = size / 2;
  const mask = new Uint8Array(size * size);

  for (let y = 2; y < size - 2; y += 1) {
    for (let x = 2; x < half; x += 1) {
      // Denser toward the mirror line and the vertical middle: produces a
      // solid core with ragged extremities rather than scattered dust.
      const centreBias = x / half;
      const heightBias = 1 - Math.abs(y - size / 2) / (size / 2);
      const chance = 0.18 + 0.62 * centreBias * heightBias;
      if (rng() < chance) {
        const value = rng() < 0.25 ? 2 : 1;
        mask[y * size + x] = value;
        mask[y * size + (size - 1 - x)] = value;
      }
    }
  }

  // Guarantee a readable core even on an unlucky roll.
  for (let y = 5; y < size - 4; y += 1) {
    mask[y * size + (half - 1)] = 1;
    mask[y * size + half] = 1;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = mask[y * size + x];
      if (value === 0) continue;
      px(ctx, x, y, value === 2 ? SPRITE_PALETTE.glow : SPRITE_PALETTE.gold);
    }
  }

  outlineOpaque(ctx, size, size, SPRITE_PALETTE.outline);
}

// --- Landmarks --------------------------------------------------------------

export type LandmarkKind = "splitOak" | "standingStones" | "cairn" | "ruinedArch" | "spring" | "summit";

export const LANDMARK_KINDS: readonly LandmarkKind[] = [
  "splitOak",
  "standingStones",
  "cairn",
  "ruinedArch",
  "spring",
  "summit",
];

/** Prose used verbatim by the hint grammar, so a clue always names what you see. */
export const LANDMARK_LABELS: Readonly<Record<LandmarkKind, string>> = {
  splitOak: "split oak",
  standingStones: "standing stones",
  cairn: "grey cairn",
  ruinedArch: "ruined arch",
  spring: "cold spring",
  summit: "summit stone",
};

function blob(ctx: Ctx2D, cx: number, cy: number, r: number, color: string): void {
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y <= r * r) px(ctx, cx + x, cy + y, color);
    }
  }
}

export function drawLandmark(ctx: Ctx2D, kind: LandmarkKind, rng: Rng): void {
  const stone = SPRITE_PALETTE.stone;
  const stoneShade = SPRITE_PALETTE.stoneShade;
  const bark = SPRITE_PALETTE.wood;

  switch (kind) {
    case "splitOak": {
      rect(ctx, 14, 20, 4, 11, bark);
      // The split: two trunks leaning apart above the fork.
      rect(ctx, 11, 12, 3, 9, bark);
      rect(ctx, 18, 12, 3, 9, bark);
      blob(ctx, 10, 10, 6, CLOAK_COLORS[0]);
      blob(ctx, 22, 11, 6, CLOAK_COLORS[4]);
      blob(ctx, 16, 6, 6, CLOAK_COLORS[0]);
      for (let i = 0; i < 10; i += 1) {
        px(ctx, 4 + Math.floor(rng() * 24), 3 + Math.floor(rng() * 12), SPRITE_PALETTE.glow);
      }
      break;
    }
    case "standingStones": {
      const heights = [16, 22, 13];
      heights.forEach((h, i) => {
        const x = 5 + i * 9;
        rect(ctx, x, 31 - h, 5, h, stone);
        rect(ctx, x + 3, 31 - h, 2, h, stoneShade);
        rect(ctx, x, 31 - h, 5, 1, SPRITE_PALETTE.glow);
      });
      break;
    }
    case "cairn": {
      const rows = [
        { w: 14, h: 4 },
        { w: 11, h: 4 },
        { w: 8, h: 4 },
        { w: 5, h: 3 },
      ];
      let y = 31;
      for (const row of rows) {
        y -= row.h;
        rect(ctx, 16 - Math.floor(row.w / 2), y, row.w, row.h, stone);
        rect(ctx, 16 - Math.floor(row.w / 2), y + row.h - 1, row.w, 1, stoneShade);
      }
      break;
    }
    case "ruinedArch": {
      rect(ctx, 5, 8, 6, 23, stone);
      rect(ctx, 21, 11, 6, 20, stone);
      rect(ctx, 8, 8, 3, 23, stoneShade);
      rect(ctx, 24, 11, 3, 20, stoneShade);
      // Broken lintel: present on one side only.
      rect(ctx, 5, 6, 13, 3, stone);
      rect(ctx, 5, 6, 13, 1, SPRITE_PALETTE.glow);
      break;
    }
    case "spring": {
      // A ring of kerb stones first, so the pool reads as sunk into a hollow
      // rather than sitting on the ground like a gem.
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        const sx = 16 + Math.round(Math.cos(a) * 11);
        const sy = 23 + Math.round(Math.sin(a) * 7);
        rect(ctx, sx - 1, sy - 1, 3, 3, i % 2 === 0 ? stone : stoneShade);
      }
      for (let y = 0; y < 11; y += 1) {
        const w = 15 - Math.abs(y - 5);
        rect(ctx, 16 - Math.floor(w / 2), 18 + y, w, 1, y < 3 ? CLOAK_COLORS[1] : SPRITE_PALETTE.metalShade);
      }
      // Surface glints.
      for (let i = 0; i < 4; i += 1) {
        px(ctx, 11 + Math.floor(rng() * 11), 20 + Math.floor(rng() * 7), SPRITE_PALETTE.glow);
      }
      break;
    }
    case "summit": {
      // The quiet ending: a peak and a marker, no monster.
      // Widest row at the BASE. Building it the other way up produced a
      // downward-pointing wedge - a funnel, not a mountain.
      for (let y = 0; y < 20; y += 1) {
        const w = 2 + y;
        const row = 12 + y;
        rect(ctx, 16 - Math.floor(w / 2), row, w, 1, y < 5 ? SPRITE_PALETTE.stone : stoneShade);
      }
      // Snow cap catching the light on the upper left.
      for (let y = 0; y < 5; y += 1) {
        rect(ctx, 16 - Math.floor((2 + y) / 2), 12 + y, Math.max(1, Math.ceil((2 + y) / 2)), 1, SPRITE_PALETTE.glow);
      }
      rect(ctx, 15, 3, 2, 10, bark);
      rect(ctx, 12, 3, 8, 3, SPRITE_PALETTE.glow);
      break;
    }
  }

  outlineOpaque(ctx, LANDMARK_W, LANDMARK_H, SPRITE_PALETTE.outline);
}

// --- Props ------------------------------------------------------------------

export type PropKind = "tree" | "pine" | "boulder" | "bush" | "stump";
export const PROP_KINDS: readonly PropKind[] = ["tree", "pine", "boulder", "bush", "stump"];

/** Props that block movement. Bushes and stumps are scenery you can walk past. */
export const SOLID_PROPS: ReadonlySet<PropKind> = new Set<PropKind>(["tree", "pine", "boulder"]);

export const PROP_VARIANTS = 3;

export function drawProp(ctx: Ctx2D, kind: PropKind, rng: Rng): void {
  const bark = SPRITE_PALETTE.wood;

  switch (kind) {
    case "tree": {
      rect(ctx, 7, 14, 3, 9, bark);
      const leaf = rng() < 0.5 ? CLOAK_COLORS[0] : CLOAK_COLORS[4];
      blob(ctx, 8, 9, 6, leaf);
      blob(ctx, 5, 12, 4, leaf);
      blob(ctx, 11, 12, 4, leaf);
      for (let i = 0; i < 6; i += 1) {
        px(ctx, 3 + Math.floor(rng() * 11), 4 + Math.floor(rng() * 8), SPRITE_PALETTE.glow);
      }
      break;
    }
    case "pine": {
      rect(ctx, 7, 18, 2, 5, bark);
      const needle = CLOAK_COLORS[4];
      for (let tier = 0; tier < 4; tier += 1) {
        const y = 4 + tier * 4;
        const w = 4 + tier * 3;
        rect(ctx, 8 - Math.floor(w / 2), y, w, 4, needle);
      }
      px(ctx, 8, 3, SPRITE_PALETTE.glow);
      break;
    }
    case "boulder": {
      for (let y = 0; y < 9; y += 1) {
        const w = 12 - Math.abs(y - 5);
        rect(ctx, 8 - Math.floor(w / 2), 14 + y, w, 1, y < 3 ? SPRITE_PALETTE.stone : SPRITE_PALETTE.stoneShade);
      }
      rect(ctx, 5, 15, 3, 2, SPRITE_PALETTE.stone);
      break;
    }
    case "bush": {
      const leaf = CLOAK_COLORS[0];
      blob(ctx, 8, 19, 4, leaf);
      blob(ctx, 5, 21, 3, leaf);
      blob(ctx, 11, 21, 3, leaf);
      for (let i = 0; i < 3; i += 1) {
        px(ctx, 4 + Math.floor(rng() * 9), 16 + Math.floor(rng() * 6), SPRITE_PALETTE.gold);
      }
      break;
    }
    case "stump": {
      // Taller, with a visible cut face and growth rings. At five pixels high
      // this was an unreadable brown smudge.
      rect(ctx, 4, 15, 9, 8, bark);
      rect(ctx, 4, 15, 9, 3, SPRITE_PALETTE.skinShade);
      rect(ctx, 7, 16, 3, 1, bark);
      px(ctx, 8, 16, SPRITE_PALETTE.skinShade);
      // A couple of roots so it sits in the ground.
      px(ctx, 3, 22, bark);
      px(ctx, 13, 22, bark);
      break;
    }
  }

  outlineOpaque(ctx, PROP_W, PROP_H, SPRITE_PALETTE.outline);
}
