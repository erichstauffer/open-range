"use client";

import { UI } from "@/lib/art/palette";
import { BARRIER_LABEL } from "@/lib/world/gates";
import { WEARY_FRACTION } from "@/lib/game/vitality";
import type { PublicState } from "@/lib/game/state";

/**
 * Deliberately sparse. The brief was "wake up and explore", and a screen full
 * of meters works against that - there is no minimap and no quest marker. Where
 * you are, what you carry, and how much you have seen.
 *
 * There is now exactly one meter, and it earned the exception. Weariness is
 * spent by walking, which is the only thing the player does continuously, so it
 * is the one quantity they cannot infer from anything already on screen - and
 * the decision it informs, whether to turn back toward a bed, has to be
 * makeable before it is forced. It is drawn as countable pips rather than a bar
 * for the same reason the rest of this file is text: a bar reads as a combat
 * game's health, and there is nothing here to fight.
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
          <Vitality hp={state.hp} maxHp={state.maxHp} />
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
          <div>
            <span style={{ color: UI.accent }}>●</span> coins {state.coins}
          </div>
          {/* Only while carrying: an armful of wood is a thing you are on your
              way to sell, not a permanent statistic. */}
          {state.wood > 0 ? (
            <div>
              <span style={{ color: UI.moss }}>❙</span> wood {state.wood}
            </div>
          ) : null}
          {state.potions > 0 ? <div>potions {state.potions}</div> : null}
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

/**
 * The weariness row.
 *
 * Spent pips are drawn rather than removed, so the row never changes width and
 * the eye reads "four left of twenty" instead of having to measure a shrinking
 * bar against nothing.
 */
function Vitality({ hp, maxHp }: { hp: number; maxHp: number }) {
  const weary = hp <= maxHp * WEARY_FRACTION;
  return (
    <div
      className="mt-1.5 flex gap-[2px]"
      role="img"
      aria-label={`${hp} of ${maxHp} vigour remaining${weary ? ", weary" : ""}`}
      title={weary ? "Weary — you are walking slowly. Rest at an inn." : "Vigour"}
    >
      {Array.from({ length: maxHp }, (_, i) => (
        <span
          key={i}
          className="inline-block h-[7px] w-[3px] rounded-[1px]"
          style={{ background: i < hp ? (weary ? UI.accent : UI.moss) : UI.nightSoft }}
        />
      ))}
    </div>
  );
}
