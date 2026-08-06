import { UI } from "@/lib/art/palette";

/**
 * How much of the unwalked island stays hidden.
 *
 * Shaped like the volume slider in `music-toggle.tsx`, but with no checkbox
 * above it - there is no "fog off", only fog you can see through. The readout
 * is a percentage rather than an alpha, because the number someone is adjusting
 * is "how hidden", not "what the renderer multiplies by".
 */
export default function FogSlider({
  darkness,
  onChange,
}: {
  darkness: number;
  onChange: (darkness: number) => void;
}) {
  return (
    <label className="fog-darkness ui-sans">
      <span>Fog of war</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(darkness * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        aria-label="Fog of war darkness"
      />
      <span className="ui-mono" style={{ color: UI.inkSoft }}>
        {Math.round(darkness * 100)}
      </span>
    </label>
  );
}
