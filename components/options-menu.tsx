"use client";

import { UI } from "@/lib/art/palette";
import ReadAloudToggle from "./read-aloud-toggle";
import MusicToggle from "./music-toggle";
import FogSlider from "./fog-slider";

/**
 * Every preference in the game, in one panel.
 *
 * It is called "Settings" on screen but `options` throughout the simulation -
 * the action, the state flag, the event and the `O` key all predate the rename,
 * and renaming them would touch the loop, the input layer and the audio engine
 * to change a word nobody sees.
 */
export default function OptionsMenu({
  readAloud,
  narrationAvailable,
  onReadAloudChange,
  music,
  musicAvailable,
  musicVolume,
  onMusicChange,
  onMusicVolumeChange,
  fogDarkness,
  onFogDarknessChange,
  onClose,
}: {
  readAloud: boolean;
  narrationAvailable: boolean;
  onReadAloudChange: (enabled: boolean) => void;
  music: boolean;
  musicAvailable: boolean;
  musicVolume: number;
  onMusicChange: (enabled: boolean) => void;
  onMusicVolumeChange: (volume: number) => void;
  fogDarkness: number;
  onFogDarknessChange: (darkness: number) => void;
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
            Settings
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

        <hr className="my-4" style={{ borderColor: UI.inkSoft, opacity: 0.4 }} />

        <MusicToggle
          enabled={music}
          available={musicAvailable}
          volume={musicVolume}
          onChange={onMusicChange}
          onVolumeChange={onMusicVolumeChange}
        />
        <p className="ui-sans text-xs leading-relaxed mt-3" style={{ color: UI.inkSoft }}>
          The score is generated from this world&apos;s seed, so the same island always sounds the same. Press{" "}
          <span className="ui-mono">M</span> at any time to silence it.
        </p>

        <hr className="my-4" style={{ borderColor: UI.inkSoft, opacity: 0.4 }} />

        <FogSlider darkness={fogDarkness} onChange={onFogDarknessChange} />
        <p className="ui-sans text-xs leading-relaxed mt-3" style={{ color: UI.inkSoft }}>
          Ground you have not walked is hidden completely. Lower this to let the shape of the coast show through
          the dark before you reach it.
        </p>
      </div>
    </div>
  );
}
