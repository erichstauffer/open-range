/**
 * Minimal 16-bit PCM WAV encoder.
 *
 * The direct sibling of `scripts/png.ts`, and it exists for the same reason:
 * the project ships no binary assets and takes no dependency it can write in
 * forty lines. A RIFF header and interleaved samples is all a preview needs.
 *
 * Output is for auditioning only and is never committed - see the note in
 * `render-score-preview.ts`.
 */

const HEADER_BYTES = 44;

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(HEADER_BYTES + samples.length * 2);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8, "ascii");

  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(1, 22); // channels: mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples.length * 2, 40);

  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: a sample past unity would wrap to full-scale noise
    // of the opposite sign rather than merely clipping.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), HEADER_BYTES + i * 2);
  }

  return buffer;
}
