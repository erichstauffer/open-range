"use client";

import { UI } from "@/lib/art/palette";
import type { PublicState } from "@/lib/game/state";

/**
 * The working document.
 *
 * This is the piece the transcript's Dragon Warrior aside actually asks for -
 * "you go and talk to this person, and they get a little bit of information,
 * then you go talk to the next person". Fragments accumulate here and the player
 * draws the conclusion. There is no map pin and no "objective" line, because
 * assembling the fragments IS the gameplay.
 *
 * Clues are grouped by what they concern and ordered from vague to specific, so
 * a partial chain reads as a partial answer rather than a list of quotes.
 */

const LEVEL_LABEL: Record<number, string> = {
  1: "the ground",
  2: "the place",
  3: "the spot",
};

export default function Journal({
  state,
  onDrink,
  onClose,
}: {
  state: PublicState;
  onDrink: () => void;
  onClose: () => void;
}) {
  const groups = new Map<string, PublicState["hints"]>();
  for (const hint of state.hints) {
    const list = groups.get(hint.artifactId) ?? [];
    list.push(hint);
    groups.set(hint.artifactId, list);
  }

  const held = new Set(state.artifactsHeld.map((a) => a.id));

  return (
    <div className="overlay-layer absolute inset-0 grid place-items-center p-4" style={{ background: "rgba(14,16,22,0.86)" }}>
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-md px-6 py-5"
        style={{ background: "rgba(22,21,15,0.97)", border: `1px solid ${UI.inkSoft}` }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl" style={{ color: UI.parchment }}>
            What you have been told
          </h2>
          <span className="ui-mono text-[10px] desktop-only" style={{ color: UI.inkSoft }}>
            J or esc to close
          </span>
          <button type="button" className="overlay-action" onClick={onClose}>
            Close
          </button>
        </div>

        {/*
          What you are carrying, above what you have been told.

          The journal is the only screen that pauses the world and lists things,
          which makes it the only sane place to open a bottle from - a potion has
          to be usable out on the moor, hours from the counter that sold it, and
          binding that to a key would put it one mistaken keystroke away from
          being wasted.
        */}
        {state.items.length > 0 || state.potions > 0 || state.wood > 0 ? (
          <section className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {state.items.map((item) => (
              <span key={item} className="ui-sans text-xs" style={{ color: UI.parchmentDim }}>
                <span style={{ color: UI.accent }}>◆</span> {item}
              </span>
            ))}
            {state.wood > 0 ? (
              <span className="ui-sans text-xs" style={{ color: UI.parchmentDim }}>
                <span style={{ color: UI.moss }}>❙</span> wood ×{state.wood}
              </span>
            ) : null}
            {state.potions > 0 ? (
              <button
                type="button"
                className="overlay-action"
                onClick={onDrink}
                disabled={state.hp >= state.maxHp}
                title={state.hp >= state.maxHp ? "You are not tired enough to waste it." : undefined}
              >
                Drink a potion ({state.potions})
              </button>
            ) : null}
          </section>
        ) : null}

        {groups.size === 0 ? (
          <p className="ui-sans text-sm leading-relaxed" style={{ color: UI.inkSoft }}>
            Nothing yet. Find someone and ask. One person rarely knows the whole of it — but they usually know
            who does.
          </p>
        ) : (
          <div className="space-y-6">
            {[...groups.entries()].map(([artifactId, hints]) => {
              const sorted = [...hints].sort((a, b) => a.level - b.level);
              const done = held.has(artifactId);
              return (
                <section key={artifactId}>
                  <h3 className="ui-mono text-[11px] mb-2" style={{ color: done ? UI.moss : UI.accent }}>
                    {done ? "◆ found" : "◇ sought"} · {artifactId.replace("-key", "").replace(/-/g, " ")}
                  </h3>
                  <ul className="space-y-2">
                    {sorted.map((hint) => (
                      <li key={hint.id} className="flex gap-3">
                        <span
                          className="ui-mono text-[10px] shrink-0 pt-1 w-16 text-right"
                          style={{ color: UI.inkSoft }}
                        >
                          {LEVEL_LABEL[hint.level]}
                        </span>
                        <span
                          className="ui-sans text-sm leading-relaxed"
                          style={{ color: done ? UI.inkSoft : UI.parchmentDim }}
                        >
                          “{hint.text}”
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!done && sorted.length < 3 ? (
                    <p className="ui-sans text-xs mt-2 pl-[76px]" style={{ color: UI.inkSoft }}>
                      Someone else knows more.
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
