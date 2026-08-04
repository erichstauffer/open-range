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
}

export class ShimContext {
  imageSmoothingEnabled = false;
  fillStyle = "#000000";

  private readonly target: ShimCanvas;
  private transform: Transform = { tx: 0, ty: 0, flipX: false };
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
    this.transform.tx += this.transform.flipX ? -x : x;
    this.transform.ty += y;
  }

  scale(x: number, y: number): void {
    if (x < 0) this.transform.flipX = !this.transform.flipX;
    if (y < 0) throw new Error("Shim does not implement vertical flip");
  }

  private mapX(x: number): number {
    return this.transform.flipX ? this.transform.tx - x : this.transform.tx + x;
  }

  private setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.target.width || y >= this.target.height) return;
    const i = (y * this.target.width + x) * 4;
    if (a === 0) return;
    this.target.data[i] = r;
    this.target.data[i + 1] = g;
    this.target.data[i + 2] = b;
    this.target.data[i + 3] = a;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b] = parseHex(this.fillStyle);
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const px = this.transform.flipX ? this.mapX(x + dx) - 1 : this.mapX(x + dx);
        this.setPixel(px, this.transform.ty + y + dy, r, g, b, 255);
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

    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const si = ((sy + y) * source.width + (sx + x)) * 4;
        const alpha = source.data[si + 3];
        if (alpha === 0) continue;
        const px = this.transform.flipX ? this.mapX(dx + x) - 1 : this.mapX(dx + x);
        this.setPixel(px, this.transform.ty + dy + y, source.data[si], source.data[si + 1], source.data[si + 2], alpha);
      }
    }
  }
}

function parseHex(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/**
 * Install the shim as the global `OffscreenCanvas` so `lib/art/canvas.ts`
 * picks it up on its normal code path. Call before importing anything from
 * `lib/art`.
 */
export function installCanvasShim(): void {
  (globalThis as Record<string, unknown>).OffscreenCanvas = ShimCanvas;
}
