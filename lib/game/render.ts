/**
 * Rendering.
 *
 * Nothing here draws procedurally - every pixel is a blit out of the atlas
 * baked once at boot. The loop's job is to decide *which* cells and *where*.
 *
 * Two things keep it cheap: only the visible tile range is considered, and the
 * camera is snapped to whole pixels so the pixel grid never lands on a
 * half-pixel and turns to mush.
 */

import { specById, UI } from "../art/palette";
import { TILE, variantFor } from "../art/tiles";
import { CHAR_ANCHOR, LANDMARK_ANCHOR, PROP_ANCHOR, ROBOT_ID } from "../art/sprites";
import { artifactKey, charKey, edgeKey, landmarkKey, propKey, tileKey, type Atlas } from "../art/atlas";
import type { EdgeDir } from "../art/tiles";
import { TILE_SIZE, type GameState } from "./state";

/** Integer upscale of the 16px art. */
export const SCALE = 3;

/** Seconds per walk frame. */
const STEP_PERIOD = 0.16;

/**
 * The veil over unexplored ground, as a 0-1 setting rather than a constant.
 *
 * The floor is roughly the old veil, which let a coastline show through well
 * enough to steer by; the ceiling is solid night. The feather is a *fraction*
 * of the base rather than a fixed step, so the sight boundary stays soft at
 * every setting instead of only at the default.
 */
const FOG_MIN_ALPHA = 0.4;
const FOG_MAX_ALPHA = 1;
const FOG_FEATHER = 0.205;

/** Mirrors `DEFAULT_FOG_DARKNESS` in `preferences.ts`, for callers with no stored setting. */
const DEFAULT_FOG_DARKNESS = 1;

export interface Camera {
  x: number;
  y: number;
}

const EDGE_DIRS: ReadonlyArray<readonly [number, number, EdgeDir]> = [
  [0, -1, 0],
  [1, 0, 1],
  [0, 1, 2],
  [-1, 0, 3],
];

/** Camera in world pixels, centred on the player and clamped to the map. */
export function computeCamera(state: GameState, viewWidth: number, viewHeight: number): Camera {
  const worldW = state.world.width * TILE_SIZE;
  const worldH = state.world.height * TILE_SIZE;
  const halfW = viewWidth / (2 * SCALE);
  const halfH = viewHeight / (2 * SCALE);

  // Snapped to integers: a fractional camera makes every blit land off-grid.
  return {
    x: Math.round(Math.max(0, Math.min(worldW - halfW * 2, state.x - halfW))),
    y: Math.round(Math.max(0, Math.min(worldH - halfH * 2, state.y - halfH))),
  };
}

interface Drawable {
  /** Sort key: feet position, so nearer things overlap farther ones. */
  sortY: number;
  key: string;
  dx: number;
  dy: number;
  /** Characters get a contact shadow; scenery does not. */
  shadow?: boolean;
}

/**
 * Two stacked bars at the feet, in the shape a pixel artist would draw.
 *
 * Without it a 16px character sitting on textured grass is genuinely hard to
 * locate - the shadow is what plants the sprite on the ground and separates it
 * from the terrain grain behind it.
 */
function contactShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = "rgba(12, 14, 10, 0.26)";
  ctx.fillRect(cx - 4, cy - 2, 8, 1);
  ctx.fillRect(cx - 3, cy - 1, 6, 1);
}

export function render(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  state: GameState,
  atlas: Atlas,
  fogDarkness: number = DEFAULT_FOG_DARKNESS,
): void {
  const viewWidth = canvas.width;
  const viewHeight = canvas.height;
  const camera = computeCamera(state, viewWidth, viewHeight);

  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = UI.night;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  ctx.setTransform(SCALE, 0, 0, SCALE, -camera.x * SCALE, -camera.y * SCALE);

  const tilesAcross = Math.ceil(viewWidth / (SCALE * TILE)) + 1;
  const tilesDown = Math.ceil(viewHeight / (SCALE * TILE)) + 1;
  const originX = Math.floor(camera.x / TILE);
  const originY = Math.floor(camera.y / TILE);

  const blit = (key: string, dx: number, dy: number) => {
    const cell = atlas.tryCell(key);
    if (!cell) return;
    ctx.drawImage(atlas.surface.canvas, cell.x, cell.y, cell.w, cell.h, dx, dy, cell.w, cell.h);
  };

  const { world } = state;

  // --- Terrain, with transition bands borrowed from higher-ranked neighbours ---
  for (let ty = originY; ty < originY + tilesDown; ty += 1) {
    if (ty < 0 || ty >= world.height) continue;
    for (let tx = originX; tx < originX + tilesAcross; tx += 1) {
      if (tx < 0 || tx >= world.width) continue;

      const tile = ty * world.width + tx;
      const spec = specById(world.tiles[tile]);
      const px = tx * TILE;
      const py = ty * TILE;

      blit(tileKey(spec.kind, variantFor(tx, ty)), px, py);

      for (const [dx, dy, dir] of EDGE_DIRS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const other = specById(world.tiles[ny * world.width + nx]);
        if (other.rank > spec.rank) blit(edgeKey(other.kind, dir), px, py);
      }
    }
  }

  // --- Entities, depth-sorted by their feet ---
  const drawables: Drawable[] = [];
  const inView = (tile: number): boolean => {
    const x = tile % world.width;
    const y = (tile - x) / world.width;
    return x >= originX - 2 && x < originX + tilesAcross + 2 && y >= originY - 3 && y < originY + tilesDown + 3;
  };
  const centreOf = (tile: number) => {
    const x = tile % world.width;
    const y = (tile - x) / world.width;
    return { cx: x * TILE + TILE / 2, cy: y * TILE + TILE };
  };

  for (const prop of world.props) {
    if (!inView(prop.tile)) continue;
    const { cx, cy } = centreOf(prop.tile);
    drawables.push({
      sortY: cy,
      key: propKey(prop.kind, prop.variant),
      dx: cx - PROP_ANCHOR.x,
      dy: cy - PROP_ANCHOR.y,
    });
  }

  for (const landmark of world.landmarks) {
    if (!inView(landmark.tile)) continue;
    const { cx, cy } = centreOf(landmark.tile);
    drawables.push({
      sortY: cy,
      key: landmarkKey(landmark.kind),
      dx: cx - LANDMARK_ANCHOR.x,
      dy: cy - LANDMARK_ANCHOR.y,
    });
  }

  for (const artifact of world.artifacts) {
    if (state.collected.has(artifact.id) || !inView(artifact.tile)) continue;
    const { cx, cy } = centreOf(artifact.tile);
    // A slow bob, so treasure catches the eye without an animation system.
    const bob = Math.round(Math.sin(state.elapsed * 2.2) * 1.5);
    drawables.push({ sortY: cy, key: artifactKey(artifact.id), dx: cx - 8, dy: cy - 18 + bob });
  }

  for (const npc of world.npcs) {
    if (!inView(npc.tile)) continue;
    const { cx, cy } = centreOf(npc.tile);
    drawables.push({
      sortY: cy,
      key: charKey(npc.id, "down", 0),
      dx: cx - CHAR_ANCHOR.x,
      dy: cy - CHAR_ANCHOR.y,
      shadow: true,
    });
  }

  // The robot, on its own walk cycle: it is moving when the player is not.
  const robotFrame: 0 | 1 =
    state.robot.moving && Math.floor(state.robot.walkTime / STEP_PERIOD) % 2 === 1 ? 1 : 0;
  drawables.push({
    sortY: state.robot.y,
    key: charKey(ROBOT_ID, state.robot.facing, robotFrame),
    dx: Math.round(state.robot.x) - CHAR_ANCHOR.x,
    dy: Math.round(state.robot.y) - CHAR_ANCHOR.y,
    shadow: true,
  });

  const frame: 0 | 1 = state.moving && Math.floor(state.walkTime / STEP_PERIOD) % 2 === 1 ? 1 : 0;
  drawables.push({
    sortY: state.y,
    key: charKey("player", state.facing, frame),
    dx: Math.round(state.x) - CHAR_ANCHOR.x,
    dy: Math.round(state.y) - CHAR_ANCHOR.y,
    shadow: true,
  });

  drawables.sort((a, b) => a.sortY - b.sortY);
  for (const item of drawables) {
    if (item.shadow) contactShadow(ctx, item.dx + CHAR_ANCHOR.x, item.dy + CHAR_ANCHOR.y);
    blit(item.key, item.dx, item.dy);
  }

  // --- Unexplored ground sits under a veil, opaque by default so that the only
  // --- way to learn the shape of the island is to walk it. Lowering the fog
  // --- setting thins the veil until the coast shows through again.
  //
  // The veil is feathered by counting each unseen tile's seen neighbours. Drawn
  // at a single alpha it produced hard 16px rectangles along the sight boundary,
  // which read as a rendering fault rather than as darkness.
  const setting = Math.max(0, Math.min(1, fogDarkness));
  const veil = FOG_MIN_ALPHA + setting * (FOG_MAX_ALPHA - FOG_MIN_ALPHA);
  const feather = veil * FOG_FEATHER;

  for (let ty = originY; ty < originY + tilesDown; ty += 1) {
    if (ty < 0 || ty >= world.height) continue;
    for (let tx = originX; tx < originX + tilesAcross; tx += 1) {
      if (tx < 0 || tx >= world.width) continue;
      const tile = ty * world.width + tx;
      if (state.visited[tile] !== 0) continue;

      let seenNeighbours = 0;
      for (const [dx, dy] of EDGE_DIRS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        if (state.visited[ny * world.width + nx] !== 0) seenNeighbours += 1;
      }

      const alpha = veil - seenNeighbours * feather;
      ctx.fillStyle = `rgba(14, 16, 22, ${alpha.toFixed(3)})`;
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Size the backing store to the element's CSS box times the device pixel ratio,
 * so the art is crisp on a retina display instead of upscaled twice.
 */
export function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(320, Math.floor(rect.width * dpr));
  const height = Math.max(240, Math.floor(rect.height * dpr));

  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
