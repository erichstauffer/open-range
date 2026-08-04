import { deflateSync } from "node:zlib";

/** Minimal PNG encoder for RGBA buffers. Used by the preview renderer. */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Encode RGBA (4 bytes/px) to a PNG buffer, nearest-neighbour upscaled by `scale`. */
export function encodePng(rgba: Uint8ClampedArray, width: number, height: number, scale = 1): Buffer {
  const outW = width * scale;
  const outH = height * scale;

  // One filter byte (0 = none) per scanline, then RGBA pixels.
  const stride = outW * 4 + 1;
  const raw = Buffer.alloc(stride * outH);

  for (let y = 0; y < outH; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    const sy = Math.floor(y / scale);
    for (let x = 0; x < outW; x += 1) {
      const sx = Math.floor(x / scale);
      const si = (sy * width + sx) * 4;
      const di = rowStart + 1 + x * 4;
      // Flatten onto a dark backdrop so transparent regions stay legible.
      const alpha = rgba[si + 3] / 255;
      raw[di] = Math.round(rgba[si] * alpha + 22 * (1 - alpha));
      raw[di + 1] = Math.round(rgba[si + 1] * alpha + 21 * (1 - alpha));
      raw[di + 2] = Math.round(rgba[si + 2] * alpha + 15 * (1 - alpha));
      raw[di + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outW, 0);
  ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
