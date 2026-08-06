/**
 * The one `AudioContext` in the application.
 *
 * A module singleton rather than a ref, because the context has to be created
 * during a user gesture on the title screen and then survive the client-side
 * navigation into `/play`. Nothing is constructed at import time: on the server
 * there is no `window`, and in a browser an unprompted context would start
 * suspended and count against the per-page limit for nothing.
 *
 * Degradation follows `createBrowserNarrator` in `lib/game/narration.ts`: if
 * the platform cannot do this, every entry point returns null or does nothing
 * and the game is unaffected.
 */

type AudioContextConstructor = new () => AudioContext;

interface LegacyWindow {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

interface AudioSessionNavigator extends Navigator {
  audioSession?: {
    type: string;
  };
}

let context: AudioContext | null = null;
let unsupported = false;

function constructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const legacy = window as unknown as LegacyWindow;
  return legacy.AudioContext ?? legacy.webkitAudioContext ?? null;
}

export function audioSupported(): boolean {
  return constructor() !== null;
}

/**
 * Tell iOS that this page is playing media rather than an ambient UI sound.
 *
 * WebKit otherwise routes Web Audio through the ambient session, which the
 * iPhone Ring/Silent switch mutes even though the AudioContext reports itself
 * as running. The Audio Session API is currently platform-specific, so feature
 * detection keeps every other browser on its existing path.
 */
export function selectPlaybackAudioSession(): void {
  if (typeof navigator === "undefined") return;
  const audioSession = (navigator as AudioSessionNavigator).audioSession;
  if (!audioSession) return;

  try {
    audioSession.type = "playback";
  } catch {
    // An experimental API refusing a session type must not prevent playback.
  }
}

/**
 * The context, creating it on first call.
 *
 * Returns null on a platform without Web Audio, and after any failure to
 * construct one - Safari refuses past a small number of live contexts, and a
 * refusal must leave the game playable rather than throwing into the frame loop.
 */
export function getAudioContext(): AudioContext | null {
  selectPlaybackAudioSession();
  if (context) return context;
  if (unsupported) return null;

  const Ctor = constructor();
  if (!Ctor) {
    unsupported = true;
    return null;
  }

  try {
    context = new Ctor();
  } catch {
    unsupported = true;
    return null;
  }
  return context;
}

/**
 * Unlock audio. **Must be called synchronously inside a user-gesture handler.**
 *
 * Playing one silent sample is the long-standing iOS idiom: the platform grants
 * a context permission to make sound only if something is actually started
 * during the gesture, and doing it in a promise continuation is too late
 * because the activation has already been consumed.
 *
 * Called from the title screen before `router.push`, which is same-document
 * navigation - so by the time the canvas mounts the context is already running
 * and the common path needs no prompt at all.
 */
export function primeAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // An unlock that fails is not fatal; the resume listeners will retry.
  }

  if (ctx.state !== "running") void ctx.resume().catch(() => {});
}
