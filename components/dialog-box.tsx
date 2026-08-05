"use client";

import { UI } from "@/lib/art/palette";
import type { DialogState } from "@/lib/game/state";

/**
 * One line at a time, advanced manually.
 *
 * A speaker's second line is usually the referral - "ask the ferryman in the
 * Grey Fen" - so pacing the lines separately matters: the clue and the pointer
 * to the next clue should land as two distinct beats, not one paragraph.
 */
export default function DialogBox({ dialog, onAdvance }: { dialog: DialogState; onAdvance: () => void }) {
  const line = dialog.lines[dialog.index] ?? "";
  const remaining = dialog.lines.length - dialog.index - 1;

  return (
    <div className="dialog-layer pointer-events-none absolute inset-x-0 bottom-0 p-4 md:p-8 flex justify-center">
      <div
        className="w-full max-w-2xl rounded-md px-5 py-4"
        style={{ background: "rgba(18,17,12,0.94)", border: `1px solid ${UI.inkSoft}` }}
      >
        <div className="flex items-baseline justify-between mb-2 gap-4">
          <div>
            <span className="text-base" style={{ color: UI.accent }}>
              {dialog.name}
            </span>
            <span className="ui-sans text-xs ml-2" style={{ color: UI.inkSoft }}>
              {dialog.role}
            </span>
          </div>
          <span className="ui-mono text-[10px] shrink-0 desktop-only" style={{ color: UI.inkSoft }}>
            {remaining > 0 ? "space ▸" : "space to close"}
          </span>
        </div>
        <p className="ui-sans text-[15px] leading-relaxed" style={{ color: UI.parchment }}>
          {line}
        </p>
        <button type="button" className="touch-only overlay-action mt-4 ml-auto" onClick={onAdvance}>
          {remaining > 0 ? "Next" : "Close"}
        </button>
      </div>
    </div>
  );
}
