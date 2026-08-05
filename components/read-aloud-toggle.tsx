export default function ReadAloudToggle({
  enabled,
  available = true,
  onChange,
}: {
  enabled: boolean;
  available?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="read-aloud-toggle ui-sans">
      <input
        type="checkbox"
        checked={enabled}
        disabled={!available}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        Read conversations aloud
        {!available ? <small>System speech is unavailable in this browser.</small> : null}
      </span>
    </label>
  );
}
