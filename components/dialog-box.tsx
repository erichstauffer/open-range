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
export default function DialogBox({
  dialog,
  readAloud,
  narrationAvailable,
  speaking,
  onSettings,
  onReplay,
  onStop,
  onAdvance,
}: {
  dialog: DialogState;
  readAloud: boolean;
  narrationAvailable: boolean;
  speaking: boolean;
  onSettings: () => void;
  onReplay: () => void;
  onStop: () => void;
  onAdvance: () => void;
}) {
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
        <div className="dialog-actions mt-4">
          {/*
            Narration is a setting, so it lives in the settings panel with the
            rest of them; the panel layers over this box and returns you to the
            same line. Replay is not a setting - it acts on the line in front of
            you - so it stays here.
          */}
          <button
            type="button"
            className="overlay-action dialog-settings"
            onClick={onSettings}
            aria-label="Open settings"
            title="Settings (O)"
          >
            <span aria-hidden="true">⚙</span>
          </button>
          {readAloud && narrationAvailable ? (
            <button type="button" className="overlay-action" onClick={speaking ? onStop : onReplay}>
              {speaking ? "Stop" : "Replay"}
            </button>
          ) : null}
          <button type="button" className="overlay-action" onClick={onAdvance}>
            {remaining > 0 ? "Next" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
