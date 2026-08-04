/**
 * Renders the social sharing card, headlessly.
 *
 *   npm run og:image -- [seed] [outfile]
 *
 * The card is a real frame of a real generated world, drawn by the same atlas
 * the game renders from, with the title set in the in-code pixel font. Nothing
 * here is a mockup: if the palette changes, the card changes with it.
 *
 * Output is 1200x630 (the size every major crawler expects), composed at
 * 600x315 and scaled 2x on encode so the pixel grid stays exact.
 */

import { writeFileSync } from "node:fs";
import { installCanvasShim, ShimCanvas } from "./canvas-shim";
import { encodePng } from "./png";

/** Composition size; doubled on encode. */
const BASE_W = 600;
const BASE_H = 315;
const OUT_SCALE = 2;

async function main(): Promise<void> {
  installCanvasShim();

  const { specById, UI, SPRITE_PALETTE, TILE_SPECS, RAMPS } = await import("../lib/art/palette");
  const { TILE, variantFor } = await import("../lib/art/tiles");
  const { bakeAtlas, tileKey, edgeKey, charKey, artifactKey, landmarkKey, propKey } = await import("../lib/art/atlas");
  const { PROP_ANCHOR, CHAR_ANCHOR, LANDMARK_ANCHOR, makeCharacterSpec } = await import("../lib/art/sprites");
  const { drawText, drawTextShadowed, measureText } = await import("../lib/art/font");
  const { makeRng } = await import("../lib/rand");
  const { generateWorld } = await import("../lib/world/gen");

  const seed = process.argv[2] ?? "amrath";
  const outfile = process.argv[3] ?? "public/og.png";

  const world = generateWorld(seed);
  const atlas = bakeAtlas({
    characters: [
      { key: "player", spec: makeCharacterSpec(makeRng(seed, "player")) },
      ...world.npcs.map((npc) => ({ key: npc.id, spec: npc.spec })),
    ],
    artifacts: world.artifacts.map((a) => a.id),
  });

  const page = new ShimCanvas(BASE_W, BASE_H);
  const ctx = page.getContext("2d");
  if (!ctx) throw new Error("shim context unavailable");

  const tilesAcross = Math.ceil(BASE_W / TILE);
  const tilesDown = Math.ceil(BASE_H / TILE);
  const at = (x: number, y: number) => y * world.width + x;

  /**
   * Find the best-composed window.
   *
   * Counting distinct terrain types was not enough on its own: it happily
   * selected a frame that was forty percent sand with a cliff band straight
   * across the text. So each terrain contributes only up to a share of the
   * frame, which rewards balance instead of mere presence, and the region the
   * type sits in is scored separately - a busy lower third fights the words.
   */
  const landmarkTiles = new Set(world.landmarks.map((l) => l.tile));
  const npcTiles = new Set(world.npcs.map((n) => n.tile));
  const artifactTiles = new Set(world.artifacts.map((a) => a.tile));
  const propTiles = new Set(world.props.map((p) => p.tile));

  let best = { x: 0, y: 0, score: -Infinity };

  for (let oy = 0; oy <= world.height - tilesDown; oy += 2) {
    for (let ox = 0; ox <= world.width - tilesAcross; ox += 2) {
      const counts = new Map<string, number>();
      let samples = 0;
      let barriers = 0;
      let interest = 0;
      let lowerThirdClutter = 0;

      const typeBandStart = oy + Math.floor(tilesDown * 0.68);

      for (let ty = oy; ty < oy + tilesDown; ty += 2) {
        for (let tx = ox; tx < ox + tilesAcross; tx += 2) {
          const tile = at(tx, ty);
          const kind = specById(world.tiles[tile]).kind;
          counts.set(kind, (counts.get(kind) ?? 0) + 1);
          samples += 1;

          const isBarrier = world.barrierOf[tile] !== 0;
          if (isBarrier) barriers += 1;
          if (landmarkTiles.has(tile)) interest += 14;
          if (artifactTiles.has(tile)) interest += 10;
          if (npcTiles.has(tile)) interest += 6;
          if (propTiles.has(tile)) interest += 1;

          // Barriers and dense props behind the title cost legibility.
          if (ty >= typeBandStart && (isBarrier || propTiles.has(tile))) lowerThirdClutter += 1;
        }
      }

      // Each terrain earns at most an 18% share, so a balanced frame beats a
      // frame that is mostly one thing.
      const cap = Math.max(1, Math.floor(samples * 0.18));
      let balance = 0;
      for (const [kind, count] of counts) {
        // Open sea is the least interesting thing to look at.
        const weight = kind === "deepWater" ? 0.35 : 1;
        balance += Math.min(count, cap) * weight;
      }

      const score = balance * 3 + interest + Math.min(barriers, 24) * 2 - lowerThirdClutter * 4;
      if (score > best.score) best = { x: ox, y: oy, score };
    }
  }

  const ox = best.x;
  const oy = best.y;

  const blit = (key: string, dx: number, dy: number) => {
    const cell = atlas.tryCell(key);
    if (!cell) return;
    ctx.drawImage(atlas.surface.canvas as unknown as ShimCanvas, cell.x, cell.y, cell.w, cell.h, dx, dy, cell.w, cell.h);
  };

  // --- Terrain plus transition bands, exactly as the game draws them ---
  for (let ty = 0; ty < tilesDown; ty += 1) {
    for (let tx = 0; tx < tilesAcross; tx += 1) {
      const wx = ox + tx;
      const wy = oy + ty;
      const tile = at(wx, wy);
      const spec = specById(world.tiles[tile]);
      blit(tileKey(spec.kind, variantFor(wx, wy)), tx * TILE, ty * TILE);

      const dirs: Array<[number, number, 0 | 1 | 2 | 3]> = [
        [0, -1, 0],
        [1, 0, 1],
        [0, 1, 2],
        [-1, 0, 3],
      ];
      for (const [dx, dy, dir] of dirs) {
        const nx = wx + dx;
        const ny = wy + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const other = specById(world.tiles[at(nx, ny)]);
        if (other.rank > spec.rank) blit(edgeKey(other.kind, dir), tx * TILE, ty * TILE);
      }
    }
  }

  const inView = (tile: number): { x: number; y: number } | null => {
    const x = tile % world.width;
    const y = (tile - x) / world.width;
    if (x < ox || y < oy || x >= ox + tilesAcross || y >= oy + tilesDown) return null;
    return { x: (x - ox) * TILE + TILE / 2, y: (y - oy) * TILE + TILE };
  };

  // --- Entities, back to front ---
  for (const prop of world.props) {
    const p = inView(prop.tile);
    if (p) blit(propKey(prop.kind, prop.variant), p.x - PROP_ANCHOR.x, p.y - PROP_ANCHOR.y);
  }
  for (const landmark of world.landmarks) {
    const p = inView(landmark.tile);
    if (p) blit(landmarkKey(landmark.kind), p.x - LANDMARK_ANCHOR.x, p.y - LANDMARK_ANCHOR.y);
  }
  for (const artifact of world.artifacts) {
    const p = inView(artifact.tile);
    if (p) blit(artifactKey(artifact.id), p.x - 8, p.y - 18);
  }
  for (const npc of world.npcs) {
    const p = inView(npc.tile);
    if (p) {
      contactShadow(p.x, p.y);
      blit(charKey(npc.id, "down", 0), p.x - CHAR_ANCHOR.x, p.y - CHAR_ANCHOR.y);
    }
  }

  function contactShadow(cx: number, cy: number): void {
    ctx!.fillStyle = "rgba(12, 14, 10, 0.26)";
    ctx!.fillRect(cx - 4, cy - 2, 8, 1);
    ctx!.fillRect(cx - 3, cy - 1, 6, 1);
  }

  // Put the player somewhere legible: centre-left, on open ground if possible.
  {
    const targetX = ox + Math.floor(tilesAcross * 0.22);
    const targetY = oy + Math.floor(tilesDown * 0.62);
    let placed = { x: targetX, y: targetY };
    for (let radius = 0; radius < 8; radius += 1) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy += 1) {
        for (let dx = -radius; dx <= radius && !found; dx += 1) {
          const x = targetX + dx;
          const y = targetY + dy;
          if (x < ox || y < oy || x >= ox + tilesAcross || y >= oy + tilesDown) continue;
          const tile = at(x, y);
          if (!specById(world.tiles[tile]).walkable || world.barrierOf[tile] !== 0) continue;
          placed = { x, y };
          found = true;
        }
      }
      if (found) break;
    }
    const px = (placed.x - ox) * TILE + TILE / 2;
    const py = (placed.y - oy) * TILE + TILE;
    contactShadow(px, py);
    blit(charKey("player", "down", 0), px - CHAR_ANCHOR.x, py - CHAR_ANCHOR.y);
  }

  // --- Scrim ---
  //
  // A solid band under the type rather than a soft gradient alone: a gradient
  // over textured terrain left the small lines barely readable. The band
  // guarantees contrast, and a short fade above it keeps the seam from looking
  // pasted on.
  const BAND_H = 96;
  const FADE_H = 46;
  const bandTop = BASE_H - BAND_H;

  for (let y = bandTop - FADE_H; y < bandTop; y += 1) {
    if (y < 0) continue;
    const t = (y - (bandTop - FADE_H)) / FADE_H;
    ctx.fillStyle = `rgba(14, 16, 22, ${(t * t * 0.9).toFixed(3)})`;
    ctx.fillRect(0, y, BASE_W, 1);
  }
  ctx.fillStyle = "rgba(14, 16, 22, 0.93)";
  ctx.fillRect(0, bandTop, BASE_W, BAND_H);

  // A darkening at the very top balances the composition.
  for (let y = 0; y < 30; y += 1) {
    ctx.fillStyle = `rgba(14, 16, 22, ${(Math.max(0, 1 - y / 30) * 0.45).toFixed(3)})`;
    ctx.fillRect(0, y, BASE_W, 1);
  }

  ctx.fillStyle = UI.accent;
  ctx.fillRect(0, bandTop, BASE_W, 1);

  // --- Type ---
  const TITLE_SCALE = 5;
  const TITLE_TRACKING = 1;
  const title = "OPEN RANGE";
  const left = 28;
  const titleY = bandTop + 16;

  drawTextShadowed(ctx, title, left, titleY, UI.parchment, "#0d0f13", TITLE_SCALE, TITLE_TRACKING);

  drawText(
    ctx,
    "a procedurally drawn exploration game",
    left + 2,
    titleY + 8 * TITLE_SCALE + 8,
    UI.parchmentDim,
    2,
  );

  drawText(
    ctx,
    "every tile, sprite, landmark and name generated in code · no image files shipped",
    left + 2,
    titleY + 8 * TITLE_SCALE + 26,
    SPRITE_PALETTE.stone,
    1,
  );

  // Seed credit - the card is a real world you can go and open.
  const credit = `seed: ${seed}`;
  drawText(ctx, credit, BASE_W - measureText(credit, 1) - 28, bandTop + 10, SPRITE_PALETTE.stoneShade, 1);

  // Palette strip along the very bottom: the constraint box, made visible.
  const swatchWidth = BASE_W / TILE_SPECS.length;
  TILE_SPECS.forEach((spec, i) => {
    ctx.fillStyle = RAMPS[spec.kind][3];
    ctx.fillRect(Math.round(i * swatchWidth), BASE_H - 3, Math.ceil(swatchWidth), 3);
  });

  writeFileSync(outfile, encodePng(page.data, BASE_W, BASE_H, OUT_SCALE));
  console.log(
    `wrote ${outfile} (${BASE_W * OUT_SCALE}x${BASE_H * OUT_SCALE}) from seed "${seed}" ` +
      `window ${ox},${oy} score ${best.score}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
