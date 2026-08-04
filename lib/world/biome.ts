/**
 * Terrain fields.
 *
 * Three independent noise fields - elevation, moisture, temperature - are
 * combined through a Whittaker-style lookup into a biome per tile. Using
 * separate fields rather than one means biomes correlate the way real ones do:
 * high ground is cold, dry mid-altitude becomes heath, wet mid-altitude
 * becomes woodland.
 *
 * The whole map is shaped into an island by a radial falloff. That is a design
 * decision, not decoration: an island gives the world natural edges, so the
 * player is never stopped by an invisible wall, and the coastline supplies the
 * strongest biome boundary in the game for free.
 */

import { createNoise2D, fbm2D, makeRng } from "../rand";
import { tileId, type TileId } from "../art/palette";

export const WORLD_WIDTH = 224;
export const WORLD_HEIGHT = 224;

/** Tiles of guaranteed deep water at the border, so the island never touches the edge. */
const BORDER_MARGIN = 4;

export interface TerrainFields {
  width: number;
  height: number;
  /** TileId per tile, row-major. */
  tiles: Uint8Array;
  elevation: Float32Array;
  moisture: Float32Array;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function generateTerrain(seed: string, width = WORLD_WIDTH, height = WORLD_HEIGHT): TerrainFields {
  const elevationNoise = createNoise2D(makeRng(seed, "elevation"));
  const moistureNoise = createNoise2D(makeRng(seed, "moisture"));
  const temperatureNoise = createNoise2D(makeRng(seed, "temperature"));
  const coastNoise = createNoise2D(makeRng(seed, "coast"));

  const tiles = new Uint8Array(width * height);
  const elevation = new Float32Array(width * height);
  const moisture = new Float32Array(width * height);

  const ID = {
    deepWater: tileId("deepWater"),
    shallowWater: tileId("shallowWater"),
    shore: tileId("shore"),
    meadow: tileId("meadow"),
    moor: tileId("moor"),
    woodland: tileId("woodland"),
    highland: tileId("highland"),
    snow: tileId("snow"),
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;

      const raw = fbm2D(elevationNoise, x * 0.011, y * 0.011, { octaves: 5, gain: 0.5 });

      // Radial island shaping, measured in normalised coordinates. The radius
      // itself is warped by low-frequency noise, which is what turns an
      // obviously circular disc into a coast with bays and headlands.
      const nx = (x / width) * 2 - 1;
      const ny = (y / height) * 2 - 1;
      const warp = fbm2D(coastNoise, x * 0.009 - 12.5, y * 0.009 + 31.1, { octaves: 3 });
      const d = Math.hypot(nx, ny) * (0.82 + 0.36 * warp);
      const falloff = 1 - smoothstep(0.42, 1.02, d);

      // TWO shaped elevations from one noise field, for two different jobs.
      //
      // `coast` uses a strong falloff and decides land against sea.
      // `relief` uses a gentle one and decides how high the land is.
      //
      // Using a single strongly-shaped value for both was wrong: multiplying by
      // the falloff compressed elevation so far that the highland threshold
      // almost never fired and snow never appeared at all, leaving five of seven
      // regions as meadow.
      let coast = raw * (0.35 + 0.65 * falloff);
      const relief = raw * (0.62 + 0.38 * falloff);

      if (x < BORDER_MARGIN || y < BORDER_MARGIN || x >= width - BORDER_MARGIN || y >= height - BORDER_MARGIN) {
        coast = 0;
      }

      const wet = fbm2D(moistureNoise, x * 0.016 + 91.3, y * 0.016 - 44.7, { octaves: 4 });
      // Cold in the north (low y), warm in the south, with noise so the snowline
      // is a ragged edge rather than a straight band. An earlier version had
      // this gradient inverted, which put the snows in the south and, combined
      // with too high a threshold, meant snow covered 1% of land.
      const temperature = 0.3 + (y / height) * 0.7 + (fbm2D(temperatureNoise, x * 0.02, y * 0.02, { octaves: 3 }) - 0.5) * 0.5;

      elevation[i] = relief;
      moisture[i] = wet;

      // Thresholds are set from the measured distribution of `relief` over land
      // (p50 0.48, p75 0.53, p90 0.58, p97 0.63), not guessed.
      let id: TileId;
      if (coast < 0.3) id = ID.deepWater;
      else if (coast < 0.355) id = ID.shallowWater;
      else if (coast < 0.395) id = ID.shore;
      // Altitude decides snow; latitude only lowers the snowline. Gating snow
      // behind BOTH high relief and a northern position kept it under 2% of
      // land, because relief peaks in the centre of the island and the northern
      // strip is mostly sea - the two conditions barely intersect.
      else if (relief > 0.596 || (relief > 0.555 && temperature < 0.45)) id = ID.snow;
      else if (relief > 0.532) id = ID.highland;
      else if (wet > 0.56) id = ID.woodland;
      else if (wet < 0.46) id = ID.moor;
      else id = ID.meadow;

      tiles[i] = id;
    }
  }

  return { width, height, tiles, elevation, moisture };
}
