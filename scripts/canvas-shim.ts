/**
 * A minimal software Canvas2D, enough to run the real art pipeline in Node.
 *
 * This exists so terrain coherence can be inspected (and regenerated in CI or
 * a headless checkout) without launching a browser. It implements only the
 * operations `lib/art` actually uses: solid fills, image blits, a translate +
 * x-flip transform, and getImageData/putImageData for the outline pass.
 *
 * Not a general-purpose canvas. No paths, no gradients, no alpha compositing
 * beyond source-over of fully opaque or fully transparent pixels - which is
 * all pixel art needs.
 */

export class ShimCanvas {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel. */
  readonly data: Uint8ClampedArray;
  private context: ShimContext | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  getContext(kind: string): ShimContext | null {
    if (kind !== "2d") return null;
    if (!this.context) this.context = new ShimContext(this);
    return this.context;
  }
}

interface Transform {
  tx: number;
  ty: number;
  flipX: boolean;
  /**
   * Uniform scale.
   *
   * Added so `lib/game/render.ts` can be run headlessly: the game view is drawn
   * through one `setTransform` that both scales the 16px art up by `SCALE` and
   * offsets it by the camera, and without a scale factor here the only part of
   * the project that could be previewed without a browser was the atlas. Uniform
   * only - the renderer never asks for anything else, and a general 2x3 matrix
   * would need real sampling rather than integer pixel blocks.
   */
  k: number;
}

export class ShimContext {
  imageSmoothingEnabled = false;
  fillStyle = "#000000";

  private readonly target: ShimCanvas;
  private transform: Transform = { tx: 0, ty: 0, flipX: false, k: 1 };
  private readonly stack: Transform[] = [];

  constructor(target: ShimCanvas) {
    this.target = target;
  }

  save(): void {
    this.stack.push({ ...this.transform });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous) this.transform = previous;
  }

  translate(x: number, y: number): void {
    // Under an active x-flip, incoming translations are mirrored too.
    const { flipX, k } = this.transform;
    this.transform.tx += (flipX ? -x : x) * k;
    this.transform.ty += y * k;
  }

  scale(x: number, y: number): void {
    if (x < 0) this.transform.flipX = !this.transform.flipX;
    if (y < 0) throw new Error("Shim does not implement vertical flip");
    if (Math.abs(x) !== Math.abs(y)) throw new Error("Shim only implements uniform scale");
    this.transform.k *= Math.abs(x);
  }

  /** `setTransform(a, b, c, d, e, f)`, restricted to uniform scale plus offset. */
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (b !== 0 || c !== 0) throw new Error("Shim does not implement rotation or skew");
    if (Math.abs(a) !== Math.abs(d)) throw new Error("Shim only implements uniform scale");
    if (d < 0) throw new Error("Shim does not implement vertical flip");
    this.transform = { tx: e, ty: f, flipX: a < 0, k: Math.abs(a) };
  }

  private mapX(x: number): number {
    const { flipX, tx, k } = this.transform;
    return flipX ? tx - x * k : tx + x * k;
  }

  private mapY(y: number): number {
    return this.transform.ty + y * this.transform.k;
  }

  /**
   * Source-over composite. Fully opaque writes replace; partial alpha blends
   * against what is already there.
   *
   * Blending matters beyond the OG card: `game/render.ts` draws the fog of war
   * with `rgba(...)` fills, so without this the shim could not reproduce what
   * the browser actually shows.
   */
  private setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.target.width || y >= this.target.height) return;
    if (a <= 0) return;

    const i = (y * this.target.width + x) * 4;
    const data = this.target.data;

    if (a >= 255) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      return;
    }

    const srcA = a / 255;
    const dstA = data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      return;
    }

    data[i] = Math.round((r * srcA + data[i] * dstA * (1 - srcA)) / outA);
    data[i + 1] = Math.round((g * srcA + data[i + 1] * dstA * (1 - srcA)) / outA);
    data[i + 2] = Math.round((b * srcA + data[i + 2] * dstA * (1 - srcA)) / outA);
    data[i + 3] = Math.round(outA * 255);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const k = this.transform.k;
    // Walked in DEVICE pixels rather than in user units times a scale, so a
    // fractional rectangle under a scale still fills a contiguous block instead
    // of leaving seams between the rounded corners of adjacent ones.
    const x0 = Math.round(this.mapX(x));
    const y0 = Math.round(this.mapY(y));
    const x1 = Math.round(this.mapX(x + w));
    const y1 = Math.round(this.mapY(y + h));
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);

    for (let py = Math.min(y0, y1); py < Math.max(y0, y1); py += 1) {
      for (let px = left; px < right; px += 1) {
        this.setPixel(this.transform.flipX && k === 1 ? px - 1 : px, py, r, g, b, a);
      }
    }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const px = this.mapX(x + dx);
        const py = this.transform.ty + y + dy;
        if (px < 0 || py < 0 || px >= this.target.width || py >= this.target.height) continue;
        const i = (py * this.target.width + px) * 4;
        this.target.data[i] = 0;
        this.target.data[i + 1] = 0;
        this.target.data[i + 2] = 0;
        this.target.data[i + 3] = 0;
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= this.target.width || sy >= this.target.height) continue;
        const si = (sy * this.target.width + sx) * 4;
        const di = (dy * w + dx) * 4;
        out[di] = this.target.data[si];
        out[di + 1] = this.target.data[si + 1];
        out[di + 2] = this.target.data[si + 2];
        out[di + 3] = this.target.data[si + 3];
      }
    }
    return { data: out, width: w, height: h };
  }

  putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void {
    for (let dy = 0; dy < image.height; dy += 1) {
      for (let dx = 0; dx < image.width; dx += 1) {
        const si = (dy * image.width + dx) * 4;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.target.width || ty >= this.target.height) continue;
        const ti = (ty * this.target.width + tx) * 4;
        // Authoritative overwrite: putImageData replaces, it does not blend.
        this.target.data[ti] = image.data[si];
        this.target.data[ti + 1] = image.data[si + 1];
        this.target.data[ti + 2] = image.data[si + 2];
        this.target.data[ti + 3] = image.data[si + 3];
      }
    }
  }

  drawImage(source: ShimCanvas, ...args: number[]): void {
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    let dx: number;
    let dy: number;

    if (args.length === 2) {
      [dx, dy] = args;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy] = args;
      const [, , , , , , dw, dh] = args;
      if (dw !== sw || dh !== sh) throw new Error("Shim only implements 1:1 blits");
    } else {
      throw new Error(`Unsupported drawImage arity: ${args.length}`);
    }

    const k = this.transform.k;
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const si = ((sy + y) * source.width + (sx + x)) * 4;
        const alpha = source.data[si + 3];
        if (alpha === 0) continue;

        // One source pixel becomes a k-by-k block. Nearest-neighbour by
        // construction, which is exactly what `imageSmoothingEnabled = false`
        // asks the browser for.
        const baseX = this.transform.flipX ? this.mapX(dx + x) - (k === 1 ? 1 : k) : this.mapX(dx + x);
        const baseY = this.mapY(dy + y);
        for (let by = 0; by < k; by += 1) {
          for (let bx = 0; bx < k; bx += 1) {
            this.setPixel(
              Math.round(baseX) + bx,
              Math.round(baseY) + by,
              source.data[si],
              source.data[si + 1],
              source.data[si + 2],
              alpha,
            );
          }
        }
      }
    }
  }
}

/** Accepts `#rrggbb`, `#rgb`, `rgb(...)` and `rgba(...)`. Returns RGBA 0-255. */
function parseColor(style: string): [number, number, number, number] {
  const value = style.trim();

  const functional = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (functional) {
    const parts = functional[1].split(/[,/\s]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map((part) => Math.round(parseFloat(part)));
    const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
    return [r, g, b, Math.round(Math.max(0, Math.min(1, alpha)) * 255)];
  }

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b, 255];
    }
    const int = parseInt(hex, 16);
    return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff, 255];
  }

  throw new Error(`Shim cannot parse colour: ${style}`);
}

/**
 * Install the shim as the global `OffscreenCanvas` so `lib/art/canvas.ts`
 * picks it up on its normal code path. Call before importing anything from
 * `lib/art`.
 */
export function installCanvasShim(): void {
  (globalThis as Record<string, unknown>).OffscreenCanvas = ShimCanvas;
}
