"use client";

/**
 * Owns the audio engine for one mounted game.
 *
 * A hook rather than code inside `game-canvas.tsx`, which already carries the
 * frame loop and the React boundary and does not need eighty more lines. The
 * contract is small: hand it a seed and the regions, get back an `onEvent` to
 * pass to the loop.
 *
 * The loop must never be able to die of an audio bug, so every call into the
 * engine from the frame path is wrapped. A silent game is a disappointment; a
 * frozen one is a broken game.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEvent } from "@/lib/game/events";
import type { Region } from "@/lib/world/regions";
import { audioSupported, getAudioContext } from "@/lib/audio/context";
import { createAudioEngine, type AudioEngine } from "@/lib/audio/engine";
import { getMusicEnabled, getMusicVolume, setMusicEnabled, setMusicVolume } from "@/lib/game/preferences";

/** How long to wait before admitting the browser will not start audio unasked. */
const PROMPT_AFTER_MS = 1500;

export interface GameAudio {
  onEvent: (event: GameEvent) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  volume: number;
  changeVolume: (volume: number) => void;
  available: boolean;
  /** True when audio is wanted but the browser is still waiting for a gesture. */
  needsGesture: boolean;
}

export function useGameAudio(seed: string, regions: readonly Region[] | null): GameAudio {
  const engineRef = useRef<AudioEngine | null>(null);
  const [available, setAvailable] = useState(true);
  const [enabled, setEnabledState] = useState(true);
  const [volume, setVolumeState] = useState(0.7);
  const [needsGesture, setNeedsGesture] = useState(false);

  // Browser capability and stored preferences both read as their defaults on
  // the server, so they are corrected after mount rather than in an
  // initialiser - the same treatment `narrationAvailable` gets in
  // `game-canvas.tsx`, and for the same reason: an initialiser that disagreed
  // between server and client would be a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailable(audioSupported());
    setEnabledState(getMusicEnabled());
    setVolumeState(getMusicVolume());
  }, []);

  useEffect(() => {
    if (!available || !regions || regions.length === 0) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    const engine = createAudioEngine({
      ctx,
      seed,
      regions,
      muted: !getMusicEnabled(),
      volume: getMusicVolume(),
    });
    engineRef.current = engine;

    let cancelled = false;
    void engine.resume().then(() => {
      if (cancelled) return;
      // If the context is still not running, no gesture has reached this page -
      // someone opened a shared ?seed= link directly. Say so, rather than
      // letting them conclude the game has no music.
      setNeedsGesture(!engine.running() && getMusicEnabled());
    });

    /**
     * The unlock path for a page loaded without a gesture.
     *
     * `pointerdown` covers the touch joystick without `game-controls.tsx`
     * needing to know audio exists, `keydown` covers the first WASD press, and
     * `touchend` is the iOS belt-and-braces.
     */
    const unlock = () => {
      void engine.resume().then(() => setNeedsGesture(false));
    };
    const unlockEvents = ["keydown", "pointerdown", "touchend"] as const;
    for (const name of unlockEvents) {
      window.addEventListener(name, unlock, { capture: true, passive: true });
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void engine.suspend();
      else void engine.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // iOS drops a context into "interrupted" for a call or for Siri, and it
    // does not come back on its own.
    const onStateChange = () => {
      if (ctx.state !== "running" && document.visibilityState === "visible") void engine.resume();
    };
    ctx.addEventListener("statechange", onStateChange);

    const prompt = setTimeout(() => {
      if (!cancelled) setNeedsGesture(!engine.running() && getMusicEnabled());
    }, PROMPT_AFTER_MS);

    return () => {
      cancelled = true;
      clearTimeout(prompt);
      for (const name of unlockEvents) {
        window.removeEventListener(name, unlock, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibility);
      ctx.removeEventListener("statechange", onStateChange);
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [seed, regions, available]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    setMusicEnabled(next);
    engineRef.current?.setMuted(!next);
    if (next) {
      void engineRef.current?.resume().then(() => {
        setNeedsGesture(engineRef.current !== null && !engineRef.current.running());
      });
    } else {
      setNeedsGesture(false);
    }
  }, []);

  const changeVolume = useCallback((next: number) => {
    setVolumeState(next);
    setMusicVolume(next);
    engineRef.current?.setVolume(next);
  }, []);

  /**
   * M toggles sound from anywhere.
   *
   * Handled here rather than as an `Action` in `input.ts` because
   * `game-canvas.tsx` unmounts `GameControls` during dialogue, the journal, the
   * options panel and the ending - exactly the moments someone might reach for
   * the mute button. Muting is presentation, not simulation, so it has no
   * business in the loop.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyM" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      setEnabled(!getMusicEnabled());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setEnabled]);

  const onEvent = useCallback((event: GameEvent) => {
    try {
      engineRef.current?.handle(event);
    } catch {
      // An audio failure must never take the frame loop with it.
    }
  }, []);

  return { onEvent, enabled, setEnabled, volume, changeVolume, available, needsGesture };
}
