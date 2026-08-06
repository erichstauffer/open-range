import { UI } from "@/lib/art/palette";

/**
 * The music setting, as a sibling of `read-aloud-toggle.tsx`.
 *
 * Same shape and the same disabled-with-an-explanation treatment, so the two
 * settings read as one list rather than as two features that arrived
 * separately. The volume slider is hidden while music is off, because a
 * disabled slider invites the reader to work out why it does nothing.
 */
export default function MusicToggle({
  enabled,
  available = true,
  volume,
  onChange,
  onVolumeChange,
}: {
  enabled: boolean;
  available?: boolean;
  volume: number;
  onChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
}) {
  return (
    <div>
      <label className="read-aloud-toggle ui-sans">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!available}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          Music
          {!available ? <small>Audio is unavailable in this browser.</small> : null}
        </span>
      </label>

      {available && enabled ? (
        <label className="music-volume ui-sans">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            aria-label="Music volume"
          />
          <span className="ui-mono" style={{ color: UI.inkSoft }}>
            {Math.round(volume * 100)}
          </span>
        </label>
      ) : null}
    </div>
  );
}
