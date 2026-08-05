"use client";

import { UI } from "@/lib/art/palette";
import ReadAloudToggle from "./read-aloud-toggle";

export default function OptionsMenu({
  readAloud,
  narrationAvailable,
  onReadAloudChange,
  onClose,
}: {
  readAloud: boolean;
  narrationAvailable: boolean;
  onReadAloudChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="overlay-layer absolute inset-0 grid place-items-center p-4"
      style={{ background: "rgba(14,16,22,0.86)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="options-title"
    >
      <div
        className="w-full max-w-md rounded-md px-6 py-5"
        style={{ background: "rgba(22,21,15,0.97)", border: `1px solid ${UI.inkSoft}` }}
      >
        <div className="flex items-baseline justify-between gap-4 mb-5">
          <h2 id="options-title" className="text-xl" style={{ color: UI.parchment }}>
            Options
          </h2>
          <button type="button" className="overlay-action" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <ReadAloudToggle
          enabled={readAloud}
          available={narrationAvailable}
          onChange={onReadAloudChange}
        />
        <p className="ui-sans text-xs leading-relaxed mt-3" style={{ color: UI.inkSoft }}>
          When enabled, each person&apos;s dialogue is spoken by this device. Names, roles, clues, and other game
          text are not read aloud.
        </p>
      </div>
    </div>
  );
}
