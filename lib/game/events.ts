/**
 * Things that happen in the world, as facts rather than as effects.
 *
 * The loop emits these; something else decides they are worth a sound. That
 * separation is the point, and it is why this file lives in `lib/game` rather
 * than in `lib/audio`: nothing under `lib/game` may import the audio layer.
 * If it did, `loop.ts` would drag an `AudioContext` into `playthrough.test.ts`,
 * which runs headlessly in a node environment with no such thing.
 *
 * They are named for what occurred, not for what it should sound like, so a
 * later map screen or a haptics layer can listen to the same stream without
 * anything here having to change.
 */

export type GameEvent =
  | { kind: "pickup"; artifactId: string }
  | { kind: "dialogue"; open: boolean }
  | { kind: "journal"; open: boolean }
  | { kind: "options"; open: boolean }
  /** Region under the player. `-1` is the open sea, matching `regionOf`. */
  | { kind: "region"; regionId: number }
  /** A move refused outright - walking into a barrier you cannot yet cross. */
  | { kind: "blocked" }
  | { kind: "win" };

export type EmitEvent = (event: GameEvent) => void;
