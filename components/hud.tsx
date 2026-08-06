"use client";

import { UI } from "@/lib/art/palette";
import { BARRIER_LABEL } from "@/lib/world/gates";
import type { PublicState } from "@/lib/game/state";

/**
 * Deliberately sparse. The brief was "wake up and explore", and a screen full
 * of meters works against that - there is no health bar, no minimap and no
 * quest marker. Where you are, what you carry, and how much you have seen.
 */
export default function Hud({ state, seed }: { state: PublicState; seed: string }) {
  return (
    <>
      <div className="hud-left pointer-events-none absolute left-0 top-0 p-4 md:p-5">
        <div
          className="inline-block rounded px-3 py-2"
          style={{ background: "rgba(14,16,22,0.55)", border: `1px solid ${UI.nightSoft}` }}
        >
          <div className="text-lg leading-tight" style={{ color: UI.parchment }}>
            {state.regionName || "…"}
          </div>
          <div className="ui-mono text-[10px] mt-0.5" style={{ color: UI.inkSoft }}>
            {seed} · explored {state.exploredPercent}%
          </div>
        </div>

        {state.artifactsHeld.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {state.artifactsHeld.map((artifact) => (
              <li
                key={artifact.id}
                className="ui-sans text-xs rounded px-2 py-1 inline-block"
                style={{ background: "rgba(14,16,22,0.55)", color: UI.parchmentDim, border: `1px solid ${UI.nightSoft}` }}
                title={`Lets you cross ${BARRIER_LABEL[artifact.opens]}`}
              >
                <span style={{ color: UI.accent }}>◆</span> {artifact.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="hud-right pointer-events-none absolute right-0 top-0 p-4 md:p-5 text-right">
        <div
          className="ui-mono text-[10px] rounded px-3 py-2 inline-block"
          style={{ background: "rgba(14,16,22,0.55)", color: UI.inkSoft, border: `1px solid ${UI.nightSoft}` }}
        >
          <div>
            artifacts {state.artifactsHeld.length}/{state.artifactTotal}
          </div>
          <div>clues {state.hints.length}</div>
        </div>
      </div>

      <div className="hud-message pointer-events-none absolute inset-x-0 bottom-0 p-4 md:p-5 flex justify-center">
        {state.toast ? (
          <div
            className="ui-sans text-sm rounded px-4 py-2 max-w-lg text-center"
            style={{ background: "rgba(14,16,22,0.85)", color: UI.parchment, border: `1px solid ${UI.accent}` }}
          >
            {state.toast}
          </div>
        ) : state.hints.length === 0 ? (
          <div className="ui-mono text-[10px] desktop-only" style={{ color: UI.inkSoft }}>
            move: WASD / arrows · act: E or space · journal: J
          </div>
        ) : null}
      </div>
    </>
  );
}
