import type { Ctx2D } from "./tiles";

export interface Surface {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: Ctx2D;
}

/**
 * Prefer OffscreenCanvas for atlas baking - it avoids attaching throwaway
 * elements to the document - but fall back to a detached <canvas> so the art
 * pipeline keeps working in older Safari.
 */
/**
 * `readback` opts into `willReadFrequently`, which the sprite scratch surface
 * needs: `outlineOpaque` calls getImageData once per sprite, a few hundred times
 * during a bake. Without the hint the browser keeps the surface GPU-backed and
 * every readback stalls the pipeline.
 */
export function createSurface(width: number, height: number, readback = false): Surface {
  const options: CanvasRenderingContext2DSettings = readback ? { willReadFrequently: true } : {};

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", options);
    if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", options);
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/**
 * Trace a 1px outline around every opaque cluster, writing into the
 * transparent pixels just outside it.
 *
 * Doing this as a post-pass rather than by hand means the player, every NPC,
 * every artifact and every landmark get an identical outline weight - one more
 * thing that cannot drift between assets. Sprite art must stay 1px inside its
 * surface bounds to leave room.
 */
export function outlineOpaque(ctx: Ctx2D, width: number, height: number, color: string): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return data[(y * width + x) * 4 + 3];
  };

  const targets: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(x, y) !== 0) continue;
      if (alphaAt(x - 1, y) || alphaAt(x + 1, y) || alphaAt(x, y - 1) || alphaAt(x, y + 1)) {
        targets.push((y * width + x) * 4);
      }
    }
  }

  const [r, g, b] = hexToRgb(color);
  for (const i of targets) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
