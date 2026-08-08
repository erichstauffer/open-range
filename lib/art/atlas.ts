/**
 * Bakes every drawable in the game into one texture at boot.
 *
 * After this runs, the render loop does nothing but `drawImage` blits from a
 * single surface - no per-frame procedural drawing, no per-frame allocation.
 * Generation cost is paid once, in about the time it takes to parse the page.
 */

import { makeRng } from "../rand";
import { RAMPS, TILE_SPECS, SPRITE_PALETTE } from "./palette";
import { createSurface, type Surface } from "./canvas";
import { TILE, VARIANTS, drawEdgeOverlay, drawTile, type EdgeDir } from "./tiles";
import {
  ARTIFACT_SIZE,
  CHAR_H,
  CHAR_W,
  FACINGS,
  LANDMARK_H,
  LANDMARK_KINDS,
  LANDMARK_W,
  PROP_H,
  PROP_KINDS,
  PROP_VARIANTS,
  PROP_W,
  ROBOT_ID,
  drawArtifact,
  drawCharacter,
  drawLandmark,
  drawProp,
  drawRobot,
  type CharacterSpec,
  type Facing,
} from "./sprites";

const ATLAS_WIDTH = 512;
const ATLAS_HEIGHT = 512;
const SCRATCH = 64;

export interface AtlasCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasRequest {
  /** One entry per distinct character appearance: the player and every NPC. */
  characters: ReadonlyArray<{ key: string; spec: CharacterSpec }>;
  /** Artifact ids; each id seeds its own mirrored mask. */
  artifacts: readonly string[];
  /**
   * The robot, under the reserved character id `robot`. It takes no
   * `CharacterSpec`: there is one machine on the island and it looks like
   * itself, so nothing about it is randomised.
   */
  robot?: boolean;
}

export interface Atlas {
  surface: Surface;
  width: number;
  height: number;
  cell(key: string): AtlasCell;
  tryCell(key: string): AtlasCell | undefined;
  /** Milliseconds spent baking, surfaced on the debug page. */
  bakeMs: number;
}

export function tileKey(kind: string, variant: number): string {
  return `tile:${kind}:${variant}`;
}

export function edgeKey(kind: string, dir: EdgeDir): string {
  return `edge:${kind}:${dir}`;
}

export function charKey(id: string, facing: Facing, frame: 0 | 1): string {
  return `char:${id}:${facing}:${frame}`;
}

export function artifactKey(id: string): string {
  return `artifact:${id}`;
}

export function landmarkKey(kind: string): string {
  return `landmark:${kind}`;
}

export function propKey(kind: string, variant: number): string {
  return `prop:${kind}:${variant}`;
}

export function bakeAtlas(request: AtlasRequest): Atlas {
  const started = typeof performance !== "undefined" ? performance.now() : 0;

  const surface = createSurface(ATLAS_WIDTH, ATLAS_HEIGHT);
  const { ctx } = surface;
  const scratch = createSurface(SCRATCH, SCRATCH, true);

  const cells = new Map<string, AtlasCell>();

  // Shelf packer. Cells are small and uniform enough that anything cleverer
  // would only save memory we are not short of.
  let penX = 0;
  let penY = 0;
  let shelfHeight = 0;

  const alloc = (w: number, h: number): AtlasCell => {
    if (penX + w > ATLAS_WIDTH) {
      penX = 0;
      penY += shelfHeight;
      shelfHeight = 0;
    }
    if (penY + h > ATLAS_HEIGHT) {
      throw new Error(`Atlas overflow: ran out of room allocating ${w}x${h}`);
    }
    const cell = { x: penX, y: penY, w, h };
    penX += w;
    shelfHeight = Math.max(shelfHeight, h);
    return cell;
  };

  /** Sprites are drawn into scratch so `outlineOpaque` can read a clean region. */
  const placeSprite = (key: string, w: number, h: number, draw: () => void, mirror = false): void => {
    scratch.ctx.clearRect(0, 0, SCRATCH, SCRATCH);
    draw();
    const cell = alloc(w, h);
    if (mirror) {
      ctx.save();
      ctx.translate(cell.x + w, cell.y);
      ctx.scale(-1, 1);
      ctx.drawImage(scratch.canvas, 0, 0, w, h, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(scratch.canvas, 0, 0, w, h, cell.x, cell.y, w, h);
    }
    cells.set(key, cell);
  };

  // Terrain interiors.
  for (const spec of TILE_SPECS) {
    for (let v = 0; v < VARIANTS; v += 1) {
      const cell = alloc(TILE, TILE);
      drawTile(ctx, cell.x, cell.y, spec.kind, v, RAMPS[spec.kind]);
      cells.set(tileKey(spec.kind, v), cell);
    }
  }

  // Transition bands, drawn in each biome's own ramp so a neighbour can borrow them.
  for (const spec of TILE_SPECS) {
    for (const dir of [0, 1, 2, 3] as EdgeDir[]) {
      const cell = alloc(TILE, TILE);
      drawEdgeOverlay(ctx, cell.x, cell.y, dir, RAMPS[spec.kind]);
      cells.set(edgeKey(spec.kind, dir), cell);
    }
  }

  // Characters. `right` is a mirror of `left`, so the profiles cannot diverge.
  for (const { key, spec } of request.characters) {
    for (const facing of FACINGS) {
      for (const frame of [0, 1] as const) {
        const drawn = facing === "right" ? "left" : facing;
        placeSprite(
          charKey(key, facing, frame),
          CHAR_W,
          CHAR_H,
          () => drawCharacter(scratch.ctx, spec, drawn, frame),
          facing === "right",
        );
      }
    }
  }

  // The robot walks and turns like a character, so it is baked exactly like
  // one: every facing, both frames, `right` mirrored from `left`.
  if (request.robot) {
    for (const facing of FACINGS) {
      for (const frame of [0, 1] as const) {
        const drawn = facing === "right" ? "left" : facing;
        placeSprite(
          charKey(ROBOT_ID, facing, frame),
          CHAR_W,
          CHAR_H,
          () => drawRobot(scratch.ctx, drawn, frame),
          facing === "right",
        );
      }
    }
  }

  for (const id of request.artifacts) {
    placeSprite(artifactKey(id), ARTIFACT_SIZE, ARTIFACT_SIZE, () =>
      drawArtifact(scratch.ctx, makeRng(`artifact:${id}`)),
    );
  }

  for (const kind of LANDMARK_KINDS) {
    placeSprite(landmarkKey(kind), LANDMARK_W, LANDMARK_H, () =>
      drawLandmark(scratch.ctx, kind, makeRng(`landmark:${kind}`)),
    );
  }

  for (const kind of PROP_KINDS) {
    for (let v = 0; v < PROP_VARIANTS; v += 1) {
      placeSprite(propKey(kind, v), PROP_W, PROP_H, () =>
        drawProp(scratch.ctx, kind, makeRng(`prop:${kind}`, `v${v}`)),
      );
    }
  }

  const bakeMs = (typeof performance !== "undefined" ? performance.now() : 0) - started;

  return {
    surface,
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    bakeMs,
    cell(key: string): AtlasCell {
      const cell = cells.get(key);
      if (!cell) throw new Error(`Atlas has no cell for "${key}"`);
      return cell;
    },
    tryCell(key: string): AtlasCell | undefined {
      return cells.get(key);
    },
  };
}

/** Neutral fallback so a missing cell shows as a flat block rather than crashing. */
export const MISSING_COLOR = SPRITE_PALETTE.shadow;
