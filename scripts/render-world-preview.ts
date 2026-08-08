/**
 * Renders a generated world to a PNG, headlessly.
 *
 *   npm run world:preview -- <seed> [outfile]
 *
 * Draws the real tile art at 1:1 for a window around the start, plus a
 * whole-island map with regions, barriers, artifacts, landmarks and speakers
 * marked. Useful for judging generation without playing, and for spotting
 * pathological islands quickly.
 */

import { writeFileSync } from "node:fs";
import { installCanvasShim, ShimCanvas } from "./canvas-shim";
import { encodePng } from "./png";

/** Mirrors `CLUSTER_OFFSETS` in `lib/game/render.ts`, so the preview lies about nothing. */
const CLUSTER = [
  { x: 0, y: 0 },
  { x: -22, y: -5 },
  { x: 22, y: -3 },
  { x: -11, y: 9 },
  { x: 14, y: 11 },
  { x: -30, y: 7 },
  { x: 33, y: 8 },
  { x: 4, y: -11 },
];

async function main(): Promise<void> {
  installCanvasShim();

  const { RAMPS, specById, UI } = await import("../lib/art/palette");
  const { TILE, variantFor } = await import("../lib/art/tiles");
  const { bakeAtlas, tileKey, edgeKey, charKey, artifactKey, landmarkKey, buildingKey, propKey } = await import("../lib/art/atlas");
  const { PROP_ANCHOR, CHAR_ANCHOR, LANDMARK_ANCHOR } = await import("../lib/art/sprites");
  const { generateWorld } = await import("../lib/world/gen");
  const { BARRIER_ORDER } = await import("../lib/world/gates");

  const seed = process.argv[2] ?? "dunhollow";
  const outfile = process.argv[3] ?? "world-preview.png";

  const world = generateWorld(seed);

  const atlas = bakeAtlas({
    characters: [
      { key: "player", spec: (await import("../lib/art/sprites")).makeCharacterSpec((await import("../lib/rand")).makeRng(seed, "player")) },
      ...world.npcs.map((npc) => ({ key: npc.id, spec: npc.spec })),
    ],
    artifacts: world.artifacts.map((a) => a.id),
  });

  // --- Close-up window around the start tile, drawn with the real tile art ---
  const VIEW_W = 46;
  const VIEW_H = 30;
  const startX = world.startTile % world.width;
  const startY = (world.startTile - startX) / world.width;
  const ox = Math.max(0, Math.min(world.width - VIEW_W, startX - Math.floor(VIEW_W / 2)));
  const oy = Math.max(0, Math.min(world.height - VIEW_H, startY - Math.floor(VIEW_H / 2)));

  const viewW = VIEW_W * TILE;
  const viewH = VIEW_H * TILE;

  // --- Island map, 2px per tile ---
  const MAP_SCALE = 2;
  const mapW = world.width * MAP_SCALE;
  const mapH = world.height * MAP_SCALE;

  const pageW = Math.max(viewW, mapW);
  const pageH = viewH + 8 + mapH;

  const page = new ShimCanvas(pageW, pageH);
  const ctx = page.getContext("2d");
  if (!ctx) throw new Error("shim context unavailable");

  const blit = (key: string, dx: number, dy: number) => {
    const cell = atlas.tryCell(key);
    if (!cell) return;
    ctx.drawImage(atlas.surface.canvas as unknown as ShimCanvas, cell.x, cell.y, cell.w, cell.h, dx, dy, cell.w, cell.h);
  };

  const at = (x: number, y: number): number => y * world.width + x;

  // Terrain and edge overlays.
  for (let ty = 0; ty < VIEW_H; ty += 1) {
    for (let tx = 0; tx < VIEW_W; tx += 1) {
      const wx = ox + tx;
      const wy = oy + ty;
      const tile = at(wx, wy);
      const spec = specById(world.tiles[tile]);
      blit(tileKey(spec.kind, variantFor(wx, wy)), tx * TILE, ty * TILE);

      // Higher-ranked neighbours dither onto this tile.
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
    if (x < ox || y < oy || x >= ox + VIEW_W || y >= oy + VIEW_H) return null;
    return { x: (x - ox) * TILE, y: (y - oy) * TILE };
  };

  // Entities, painted back to front.
  for (const prop of world.props) {
    const p = inView(prop.tile);
    if (p) blit(propKey(prop.kind, prop.variant), p.x + TILE / 2 - PROP_ANCHOR.x, p.y + TILE - PROP_ANCHOR.y);
  }
  for (const landmark of world.landmarks) {
    const p = inView(landmark.tile);
    if (p) blit(landmarkKey(landmark.kind), p.x + TILE / 2 - LANDMARK_ANCHOR.x, p.y + TILE - LANDMARK_ANCHOR.y);
  }
  // Towns, drawn the way the game draws them: a huddle of the town's own
  // building cells around its tile.
  for (const town of world.towns) {
    const p = inView(town.tile);
    if (!p) continue;
    town.buildings.forEach((building, i) => {
      const offset = CLUSTER[i % CLUSTER.length];
      blit(buildingKey(building.kind), p.x + TILE / 2 + offset.x - 16, p.y + TILE + offset.y - 31);
    });
  }
  for (const artifact of world.artifacts) {
    const p = inView(artifact.tile);
    if (p) blit(artifactKey(artifact.id), p.x, p.y);
  }
  for (const npc of world.npcs) {
    const p = inView(npc.tile);
    if (p) blit(charKey(npc.id, "down", 0), p.x + TILE / 2 - CHAR_ANCHOR.x, p.y + TILE - CHAR_ANCHOR.y);
  }
  {
    const p = inView(world.startTile);
    if (p) blit(charKey("player", "down", 0), p.x + TILE / 2 - CHAR_ANCHOR.x, p.y + TILE - CHAR_ANCHOR.y);
  }

  // --- Island map ---
  const mapTop = viewH + 8;
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const tile = at(x, y);
      const spec = specById(world.tiles[tile]);
      // Mid ramp stop reads as the terrain's "average" colour at map scale.
      ctx.fillStyle = RAMPS[spec.kind][spec.barrier ? 3 : 2];
      ctx.fillRect(x * MAP_SCALE, mapTop + y * MAP_SCALE, MAP_SCALE, MAP_SCALE);
    }
  }

  const marker = (tile: number, color: string, size: number) => {
    const x = tile % world.width;
    const y = (tile - x) / world.width;
    ctx.fillStyle = color;
    ctx.fillRect(x * MAP_SCALE - size, mapTop + y * MAP_SCALE - size, size * 2 + 1, size * 2 + 1);
  };

  for (const landmark of world.landmarks) marker(landmark.tile, UI.parchmentDim, 1);
  for (const npc of world.npcs) marker(npc.tile, UI.moss, 1);
  for (const artifact of world.artifacts) marker(artifact.tile, UI.accent, 2);
  for (const town of world.towns) marker(town.tile, UI.parchment, 2);
  marker(world.startTile, UI.parchment, 3);

  writeFileSync(outfile, encodePng(page.data, pageW, pageH, 2));

  const barrierCounts = new Map<string, number>();
  for (let i = 0; i < world.barrierOf.length; i += 1) {
    const b = world.barrierOf[i];
    if (b !== 0) barrierCounts.set(BARRIER_ORDER[b - 1], (barrierCounts.get(BARRIER_ORDER[b - 1]) ?? 0) + 1);
  }

  console.log(`seed "${seed}"  hash ${world.hash}  attempt ${world.attempt}`);
  console.log(`regions ${world.regions.length}  landmarks ${world.landmarks.length}  npcs ${world.npcs.length}  props ${world.props.length}  towns ${world.towns.length}`);
  for (const town of world.towns) {
    const has = town.buildings.filter((b) => b.kind !== "house").map((b) => b.kind);
    console.log(`  town ${town.name} in ${world.regions[town.regionId]?.name}: ${has.join(", ")}`);
  }
  console.log(`start region: ${world.regions[world.startRegionId]?.name}`);
  console.log(`ending region: ${world.regions[world.endingRegionId]?.name}`);
  console.log(`barriers: ${[...barrierCounts].map(([k, n]) => `${k}=${n}`).join(" ")}`);
  for (const region of world.regions) {
    console.log(`  region ${region.id}: ${region.name} (${region.dominantKind}, ${region.tiles.length} tiles, depth ${region.depth})`);
  }
  for (const artifact of world.artifacts) {
    console.log(`  artifact tier ${artifact.tier}: ${artifact.name} opens ${artifact.opens} in ${world.regions[artifact.regionId]?.name}`);
  }
  for (const hint of world.hints) {
    console.log(`  hint L${hint.level} [${hint.artifactId}]: ${hint.text}`);
  }
  console.log(`wrote ${outfile} (${pageW}x${pageH} @2x)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
