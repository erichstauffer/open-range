/**
 * Deterministic randomness for Open Range.
 *
 * Nothing in `lib/world`, `lib/hints`, or `lib/art` may call `Math.random`.
 * Every world is a pure function of its seed string, which is what makes
 * `?seed=` links shareable, saves tiny, and the test suite meaningful.
 */

export type Rng = () => number;

/** Hash a string into four 32-bit values. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < str.length; i += 1) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** Small, fast, well-distributed 32-bit PRNG. Returns values in [0, 1). */
export function mulberry32(a: number): Rng {
  let state = a >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a generator from a seed string. `salt` lets one seed drive many
 * independent streams (terrain, regions, names, art) without them correlating.
 */
export function makeRng(seed: string, salt = ""): Rng {
  const [a, b, c, d] = cyrb128(`${seed}::${salt}`);
  // Multiply before mixing. cyrb128 returns [h1^h2^h3^h4, h2^h1, h3^h1, h4^h1],
  // in which every word appears an even number of times overall - so a plain
  // `a ^ b ^ c ^ d` is identically zero for ALL inputs and would hand every
  // seed the same world. The odd multipliers break that symmetry.
  const mixed = (a ^ Math.imul(b, 0x9e3779b1) ^ Math.imul(c, 0x85ebca6b) ^ Math.imul(d, 0xc2b2ae35)) >>> 0;
  return mulberry32(mixed);
}

/** Integer in [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Uniform pick. Throws on an empty list rather than returning undefined. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() called with an empty list");
  return items[Math.floor(rng() * items.length)];
}

/** In-place Fisher-Yates using the supplied generator. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Stable per-coordinate hash in [0, 1). Used to choose tile variants and prop
 * placement: because it depends only on (x, y, salt), the same tile always
 * looks the same and nothing shimmers as the camera moves.
 */
export function hash2D(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- Gradient noise ---------------------------------------------------------

const GRADIENTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type Noise2D = (x: number, y: number) => number;

/**
 * Seeded Perlin-style gradient noise. Output is roughly [-1, 1].
 *
 * Gradient noise rather than value noise because terrain generated from value
 * noise has visible axis-aligned banding, which reads as "computer-made" -
 * exactly the impression this project is trying to avoid.
 */
export function createNoise2D(rng: Rng): Noise2D {
  const perm = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = source[i];
    source[i] = source[j];
    source[j] = tmp;
  }
  for (let i = 0; i < 512; i += 1) perm[i] = source[i & 255];

  function grad(hashValue: number, x: number, y: number): number {
    const [gx, gy] = GRADIENTS[hashValue & 7];
    return gx * x + gy * y;
  }

  return function noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];

    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  frequency?: number;
}

/**
 * Fractal Brownian motion over a noise function, normalised to [0, 1].
 * Normalising here (rather than at each call site) keeps every field in the
 * same range so the biome lookup thresholds stay readable.
 */
export function fbm2D(noise: Noise2D, x: number, y: number, options: FbmOptions = {}): number {
  const { octaves = 5, lacunarity = 2, gain = 0.5, frequency = 1 } = options;

  let amplitude = 1;
  let freq = frequency;
  let sum = 0;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    sum += noise(x * freq, y * freq) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }

  return (sum / totalAmplitude + 1) / 2;
}

/** Cheap synchronous content hash. Used for world identity, not for security. */
export function fnv1a(parts: Array<string | number | ArrayLike<number>>): string {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };

  for (const part of parts) {
    if (typeof part === "string") {
      for (let i = 0; i < part.length; i += 1) mix(part.charCodeAt(i));
    } else if (typeof part === "number") {
      const n = part | 0;
      mix(n);
      mix(n >>> 8);
      mix(n >>> 16);
      mix(n >>> 24);
    } else {
      // Stride large arrays: identity, not integrity - full scans of a 65k
      // tile grid on every generate are not worth the milliseconds.
      const stride = part.length > 4096 ? 7 : 1;
      for (let i = 0; i < part.length; i += stride) mix(part[i]);
    }
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}
