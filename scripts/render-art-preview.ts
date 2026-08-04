/**
 * Renders the art-coherence checkpoint to a PNG, headlessly.
 *
 *   npm run art:preview -- [outfile]
 *
 * Same code path the game uses at runtime - the only substitution is a
 * software canvas. If this image reads as one illustration, the premise of the
 * project holds.
 */

import { writeFileSync } from "node:fs";
import { installCanvasShim, ShimCanvas } from "./canvas-shim";
import { encodePng } from "./png";

const CHARACTERS = ["player", "npc-a", "npc-b", "npc-c", "npc-d", "npc-e"];
const ARTIFACTS = ["ford-stone", "climbing-hooks", "bramble-blade"];

async function main(): Promise<void> {
  // Must happen before lib/art is loaded: that module picks its surface
  // implementation from the presence of a global OffscreenCanvas.
  installCanvasShim();

  const { TILE_SPECS, RAMPS } = await import("../lib/art/palette");
  const { TILE, VARIANTS } = await import("../lib/art/tiles");
  const { hash2D, makeRng } = await import("../lib/rand");
  const { bakeAtlas, tileKey, edgeKey, charKey, artifactKey, landmarkKey, propKey } = await import("../lib/art/atlas");
  const { makeCharacterSpec, LANDMARK_KINDS, PROP_KINDS, PROP_VARIANTS, FACINGS } = await import("../lib/art/sprites");

  const atlas = bakeAtlas({
    characters: CHARACTERS.map((key) => ({ key, spec: makeCharacterSpec(makeRng("preview-char", key)) })),
    artifacts: ARTIFACTS,
  });

  const PAD = 6;
  const PATCH_W = 8;
  const PATCH_H = 6;
  const PAIR = 4;
  const PAIR_COLS = 11;
  const patchCols = 4;

  const pairs: Array<[string, string]> = [];
  for (const a of TILE_SPECS) {
    for (const b of TILE_SPECS) {
      if (a.rank < b.rank) pairs.push([a.kind, b.kind]);
    }
  }

  const pairRows = Math.ceil(pairs.length / PAIR_COLS);
  const patchRows = Math.ceil(TILE_SPECS.length / patchCols);

  const width = Math.max(
    VARIANTS * TILE + PAD * 2 + 90,
    patchCols * (PATCH_W * TILE + PAD) + PAD,
    PAIR_COLS * (PAIR * TILE + PAD) + PAD,
  );

  const variantsBlockH = TILE_SPECS.length * (TILE + 2) + PAD;
  const patchBlockH = patchRows * (PATCH_H * TILE + PAD) + PAD;
  const pairBlockH = pairRows * (PAIR * TILE + PAD) + PAD;
  const spriteBlockH = 20 + PAD + 34 + PAD + 24 + PAD * 2;
  const height = PAD + variantsBlockH + patchBlockH + pairBlockH + spriteBlockH + PAD;

  const page = new ShimCanvas(width, height);
  const ctx = page.getContext("2d");
  if (!ctx) throw new Error("shim context unavailable");

  const blit = (key: string, dx: number, dy: number) => {
    const cell = atlas.tryCell(key);
    if (!cell) return;
    ctx.drawImage(atlas.surface.canvas as unknown as ShimCanvas, cell.x, cell.y, cell.w, cell.h, dx, dy, cell.w, cell.h);
  };

  let cursorY = PAD;

  // 1. Every variant of every biome, one row each, with its ramp alongside.
  for (const spec of TILE_SPECS) {
    for (let v = 0; v < VARIANTS; v += 1) blit(tileKey(spec.kind, v), PAD, cursorY);
    for (let v = 0; v < VARIANTS; v += 1) blit(tileKey(spec.kind, v), PAD + v * TILE, cursorY);
    RAMPS[spec.kind].forEach((hex, i) => {
      ctx.fillStyle = hex;
      ctx.fillRect(PAD + VARIANTS * TILE + 8 + i * TILE, cursorY, TILE, TILE);
    });
    cursorY += TILE + 2;
  }
  cursorY += PAD;

  // 2. Seam check: each biome tiled, looking for a lattice.
  {
    let col = 0;
    let rowY = cursorY;
    for (const spec of TILE_SPECS) {
      const ox = PAD + col * (PATCH_W * TILE + PAD);
      for (let ty = 0; ty < PATCH_H; ty += 1) {
        for (let tx = 0; tx < PATCH_W; tx += 1) {
          blit(tileKey(spec.kind, Math.floor(hash2D(tx, ty, 99) * VARIANTS)), ox + tx * TILE, rowY + ty * TILE);
        }
      }
      col += 1;
      if (col === patchCols) {
        col = 0;
        rowY += PATCH_H * TILE + PAD;
      }
    }
    cursorY += patchBlockH;
  }

  // 3. Every ordered biome pair, higher rank dithering onto lower.
  {
    pairs.forEach(([lower, higher], i) => {
      const col = i % PAIR_COLS;
      const row = Math.floor(i / PAIR_COLS);
      const ox = PAD + col * (PAIR * TILE + PAD);
      const oy = cursorY + row * (PAIR * TILE + PAD);
      const split = PAIR / 2;
      for (let ty = 0; ty < PAIR; ty += 1) {
        for (let tx = 0; tx < PAIR; tx += 1) {
          const kind = ty < split ? lower : higher;
          const salt = ty < split ? 99 : 77;
          blit(tileKey(kind, Math.floor(hash2D(tx, ty, salt) * VARIANTS)), ox + tx * TILE, oy + ty * TILE);
        }
      }
      for (let tx = 0; tx < PAIR; tx += 1) {
        blit(edgeKey(higher, 2), ox + tx * TILE, oy + (split - 1) * TILE);
      }
    });
    cursorY += pairBlockH;
  }

  // 4. Sprites.
  {
    let dx = PAD;
    for (const key of CHARACTERS) {
      for (const facing of FACINGS) {
        for (const frame of [0, 1] as const) {
          blit(charKey(key, facing, frame), dx, cursorY);
          dx += 16;
        }
      }
      dx += 4;
    }
    cursorY += 20 + PAD;

    dx = PAD;
    for (const kind of LANDMARK_KINDS) {
      blit(landmarkKey(kind), dx, cursorY);
      dx += 34;
    }
    for (const id of ARTIFACTS) {
      blit(artifactKey(id), dx, cursorY + 16);
      dx += 18;
    }
    cursorY += 34 + PAD;

    dx = PAD;
    for (const kind of PROP_KINDS) {
      for (let v = 0; v < PROP_VARIANTS; v += 1) {
        blit(propKey(kind, v), dx, cursorY);
        dx += 16;
      }
      dx += 4;
    }
  }

  const outfile = process.argv[2] ?? "art-preview.png";
  writeFileSync(outfile, encodePng(page.data, width, height, 3));
  console.log(`bake ${atlas.bakeMs.toFixed(1)}ms · wrote ${outfile} (${width}x${height} @3x)`);

  // A second, heavily magnified sheet: 16px characters cannot be judged at 3x.
  const zoomOut = process.argv[3];
  if (!zoomOut) return;

  const zw = Math.max(
    CHARACTERS.length * (17 * 4 + 6),
    LANDMARK_KINDS.length * 36,
    PROP_KINDS.length * (PROP_VARIANTS * 17 + 4) + ARTIFACTS.length * 18 + 8,
  );
  const zh = 26 + 36 + 28 + 20;
  const zoom = new ShimCanvas(zw, zh);
  const zctx = zoom.getContext("2d");
  if (!zctx) throw new Error("shim context unavailable");

  const zblit = (key: string, dx: number, dy: number) => {
    const cell = atlas.tryCell(key);
    if (!cell) return;
    zctx.drawImage(
      atlas.surface.canvas as unknown as ShimCanvas,
      cell.x,
      cell.y,
      cell.w,
      cell.h,
      dx,
      dy,
      cell.w,
      cell.h,
    );
  };

  // Row 1: every character, all four facings, frame 0.
  let zx = 2;
  for (const key of CHARACTERS) {
    for (const facing of FACINGS) {
      zblit(charKey(key, facing, 0), zx, 2);
      zx += 17;
    }
    zx += 6;
  }

  // Row 2: landmarks. Row 3: props and artifacts.
  zx = 2;
  for (const kind of LANDMARK_KINDS) {
    zblit(landmarkKey(kind), zx, 26);
    zx += 36;
  }
  zx = 2;
  for (const kind of PROP_KINDS) {
    for (let v = 0; v < PROP_VARIANTS; v += 1) {
      zblit(propKey(kind, v), zx, 62);
      zx += 17;
    }
    zx += 4;
  }
  for (const id of ARTIFACTS) {
    zblit(artifactKey(id), zx, 70);
    zx += 18;
  }

  writeFileSync(zoomOut, encodePng(zoom.data, zw, zh, 8));
  console.log(`wrote ${zoomOut} (${zw}x${zh} @8x)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
