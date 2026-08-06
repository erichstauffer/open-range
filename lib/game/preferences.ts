const CONTROLS_HELP_KEY = "open-range:controls-help-dismissed";
const READ_ALOUD_KEY = "open-range:read-aloud";
const MUSIC_KEY = "open-range:music";
const MUSIC_VOLUME_KEY = "open-range:music-volume";
const FOG_DARKNESS_KEY = "open-range:fog-darkness";

const DEFAULT_MUSIC_VOLUME = 0.7;

/**
 * Full darkness: ground nobody has walked is hidden, not merely dimmed.
 *
 * This is the top of the slider's range rather than a point inside it, which
 * is deliberate. The setting exists so someone who wants to see the shape of
 * the coast can have it back; there is nothing to gain from hiding more than
 * everything.
 */
const DEFAULT_FOG_DARKNESS = 1;

export function controlsHelpDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(CONTROLS_HELP_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissControlsHelp(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CONTROLS_HELP_KEY, "1");
  } catch {
    // A denied or full storage area should not make the controls unusable.
  }
}

/** Conversation narration is opt-in and deliberately separate from a world save. */
export function getReadAloudEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(READ_ALOUD_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReadAloudEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(READ_ALOUD_KEY, enabled ? "1" : "0");
  } catch {
    // A denied or full storage area should not make conversations unusable.
  }
}

/**
 * Music is on unless turned off - note the opposite default to read-aloud
 * above.
 *
 * Synthesised speech arriving unasked is a surprise, so narration is opt-in.
 * The score is part of the work, and nothing can sound before the first click
 * anyway, so it does not need to be opted into.
 */
export function getMusicEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(MUSIC_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setMusicEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MUSIC_KEY, enabled ? "1" : "0");
  } catch {
    // A denied or full storage area should not make the game silent.
  }
}

export function getMusicVolume(): number {
  if (typeof localStorage === "undefined") return DEFAULT_MUSIC_VOLUME;
  try {
    const raw = localStorage.getItem(MUSIC_VOLUME_KEY);
    if (raw === null || raw.trim() === "") return DEFAULT_MUSIC_VOLUME;

    const stored = Number(raw);
    // A hand-edited value could be non-numeric or outside the slider's range.
    if (!Number.isFinite(stored)) return DEFAULT_MUSIC_VOLUME;
    return Math.max(0, Math.min(1, stored));
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}

export function setMusicVolume(volume: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MUSIC_VOLUME_KEY, String(Math.max(0, Math.min(1, volume))));
  } catch {
    // As above.
  }
}

/**
 * How opaque the veil over unexplored ground is, 0 to 1.
 *
 * Stored as the abstract setting rather than as an alpha, so `render.ts` owns
 * the mapping onto actual paint and can change it without invalidating what
 * every existing player has already chosen.
 */
export function getFogDarkness(): number {
  if (typeof localStorage === "undefined") return DEFAULT_FOG_DARKNESS;
  try {
    const raw = localStorage.getItem(FOG_DARKNESS_KEY);
    if (raw === null || raw.trim() === "") return DEFAULT_FOG_DARKNESS;

    const stored = Number(raw);
    if (!Number.isFinite(stored)) return DEFAULT_FOG_DARKNESS;
    return Math.max(0, Math.min(1, stored));
  } catch {
    return DEFAULT_FOG_DARKNESS;
  }
}

export function setFogDarkness(darkness: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FOG_DARKNESS_KEY, String(Math.max(0, Math.min(1, darkness))));
  } catch {
    // As above.
  }
}
