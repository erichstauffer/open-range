"use client";

/**
 * The one place the game loop touches React.
 *
 * The rule this file exists to enforce: game state lives in a ref and is
 * mutated in place; React is handed a small immutable snapshot only when
 * something a person could notice has changed. If the loop wrote to `useState`,
 * every frame would trigger a reconciliation and the frame budget would go to
 * React instead of the game.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { bakeAtlas, type Atlas } from "@/lib/art/atlas";
import { makeCharacterSpec } from "@/lib/art/sprites";
import { makeRng } from "@/lib/rand";
import { generateWorld } from "@/lib/world/gen";
import { createInput, type Action, type InputState, type MoveVector } from "@/lib/game/input";
import { STEP, update } from "@/lib/game/loop";
import { render, resizeCanvas } from "@/lib/game/render";
import { createGameState, sameSnapshot, snapshot, type GameState, type PublicState } from "@/lib/game/state";
import { applySave, loadRecord, save } from "@/lib/game/save";
import Hud from "./hud";
import DialogBox from "./dialog-box";
import Journal from "./journal";
import { UI } from "@/lib/art/palette";
import GameControls from "./game-controls";

/** Autosave cadence, in seconds of game time. */
const SAVE_INTERVAL = 5;

export default function GameCanvas({ seed, resume }: { seed: string; resume: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const inputRef = useRef<InputState | null>(null);
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Failure paths set state once and then bail out, so there is no cascade
      // to worry about - and neither condition can be detected before mount,
      // since both depend on a real canvas element.
      setError("This browser cannot provide a 2D canvas.");
      return;
    }

    let atlas: Atlas;
    let state: GameState;
    try {
      const world = generateWorld(seed);
      state = createGameState(world);
      atlas = bakeAtlas({
        characters: [
          { key: "player", spec: makeCharacterSpec(makeRng(seed, "player")) },
          ...world.npcs.map((npc) => ({ key: npc.id, spec: npc.spec })),
        ],
        artifacts: world.artifacts.map((a) => a.id),
      });
    } catch (cause) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(cause instanceof Error ? cause.message : "Could not build this world.");
      return;
    }

    if (resume) {
      const record = loadRecord();
      if (record) applySave(state, record);
    }

    stateRef.current = state;
    const input = createInput(window);
    inputRef.current = input;

    // Published from inside the first animation frame rather than here, so the
    // effect body never calls setState synchronously and no cascading render
    // happens on mount. After that, only genuine changes are published.
    let lastPublished = snapshot(state);
    let hasPublished = false;
    const publish = () => {
      const next = snapshot(state);
      if (hasPublished && sameSnapshot(next, lastPublished)) return;
      hasPublished = true;
      lastPublished = next;
      setPublicState(next);
    };

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let sinceSave = 0;
    let running = true;

    const frame = (now: number) => {
      if (!running) return;
      // Clamped: returning to a backgrounded tab must not simulate the gap.
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      accumulator += delta;

      let steps = 0;
      while (accumulator >= STEP && steps < 5) {
        update(state, input, { onChange: publish });
        accumulator -= STEP;
        steps += 1;
      }
      // Discard any leftover backlog rather than letting it grow without bound.
      if (accumulator > STEP) accumulator = 0;

      sinceSave += delta;
      if (sinceSave >= SAVE_INTERVAL) {
        sinceSave = 0;
        save(state);
      }

      resizeCanvas(canvas);
      render(canvas, ctx, state, atlas);
      // First frame carries the initial HUD state up to React.
      if (!hasPublished) publish();
      raf = requestAnimationFrame(frame);
    };

    resizeCanvas(canvas);
    raf = requestAnimationFrame(frame);

    const onHide = () => save(state);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      save(state);
      input.destroy();
      if (inputRef.current === input) inputRef.current = null;
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [seed, resume]);

  const enqueue = useCallback((action: Action) => inputRef.current?.enqueue(action), []);
  const moveFromTouch = useCallback((movement: MoveVector | null) => {
    const input = inputRef.current;
    if (!input) return;
    if (movement) input.setMovement("touch-joystick", movement);
    else input.clearMovement("touch-joystick");
  }, []);

  if (error) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl mb-3" style={{ color: UI.parchment }}>
            This world would not open
          </h1>
          <p className="ui-sans text-sm" style={{ color: UI.inkSoft }}>
            {error}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="game-shell relative w-screen overflow-hidden" style={{ background: UI.night }}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Open Range game view" />

      {publicState ? (
        <>
          <Hud state={publicState} seed={seed} />
          {publicState.journalOpen ? <Journal state={publicState} onClose={() => enqueue("cancel")} /> : null}
          {publicState.dialog ? <DialogBox dialog={publicState.dialog} onAdvance={() => enqueue("interact")} /> : null}
          {publicState.won && !publicState.journalOpen ? <Ending onJournal={() => enqueue("journal")} /> : null}
          {!publicState.dialog && !publicState.journalOpen && !publicState.won ? (
            <GameControls
              nearbyNpc={publicState.nearbyNpc}
              onMove={moveFromTouch}
              onInteract={() => enqueue("interact")}
              onJournal={() => enqueue("journal")}
            />
          ) : null}
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center ui-sans text-sm" style={{ color: UI.inkSoft }}>
          Generating the island…
        </div>
      )}
    </main>
  );
}

/** The quiet ending. No boss, per the brief - a summit and a long view. */
function Ending({ onJournal }: { onJournal: () => void }) {
  return (
    <div className="overlay-layer absolute inset-0 grid place-items-center" style={{ background: "rgba(14,16,22,0.82)" }}>
      <div className="max-w-lg text-center px-8">
        <p className="ui-mono text-xs mb-4" style={{ color: UI.accent }}>
          the summit
        </p>
        <h2 className="text-3xl mb-4" style={{ color: UI.parchment }}>
          You reach the top, and there is nothing here.
        </h2>
        <p className="ui-sans text-sm leading-relaxed mb-6" style={{ color: UI.parchmentDim }}>
          Only the whole island below you, and the sea past that, and the way you came — every ford, every
          scarp, every thicket you talked your way through.
        </p>
        <p className="ui-sans text-xs desktop-only" style={{ color: UI.inkSoft }}>
          Press <span className="ui-mono">J</span> to read back what you were told.
        </p>
        <button type="button" className="overlay-action mt-2 mx-auto" onClick={onJournal}>
          Open journal
        </button>
      </div>
    </div>
  );
}
