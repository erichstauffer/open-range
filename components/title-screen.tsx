"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UI } from "@/lib/art/palette";
import { compoundName, inventedName } from "@/lib/world/names";
import { makeRng } from "@/lib/rand";
import { loadRecord } from "@/lib/game/save";
import { getMusicEnabled, getReadAloudEnabled, setReadAloudEnabled } from "@/lib/game/preferences";
import { primeAudio } from "@/lib/audio/context";
import ReadAloudToggle from "./read-aloud-toggle";

/** A pronounceable default so the seed box is never empty or intimidating. */
function suggestSeed(salt: string): string {
  const rng = makeRng(salt, "suggest");
  return (rng() < 0.5 ? compoundName(rng) : inventedName(rng)).toLowerCase();
}

export default function TitleScreen() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [saved, setSaved] = useState<{ seed: string; won: boolean } | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [narrationAvailable, setNarrationAvailable] = useState(true);

  const suggestions = useMemo(() => ["dunhollow", "amrath", "grey-fen", "enneth"], []);

  useEffect(() => {
    // Reading a saved game means reading localStorage, which does not exist
    // until after mount - the "subscribe to an external system" case effects are
    // for. It runs once and cascades nothing.
    const record = loadRecord();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (record) setSaved({ seed: record.seed, won: record.won });
    setReadAloud(getReadAloudEnabled());
    setNarrationAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  }, []);

  const changeReadAloud = (enabled: boolean) => {
    setReadAloud(enabled);
    setReadAloudEnabled(enabled);
  };

  /**
   * An empty box is fine: submitting blank invents a seed. Pre-filling one from
   * a mount effect meant the server sent different markup than the client, and
   * cost a cascading render to correct.
   */
  const start = (value: string) => {
    // Unlock audio here, inside the click, and before navigating. This is
    // same-document navigation, so the context and its user activation both
    // survive into /play - which means the common path reaches the game with
    // music already running and never has to ask for a keypress.
    if (getMusicEnabled()) primeAudio();
    const trimmed = value.trim() || suggestSeed(String(Date.now()));
    router.push(`/play?seed=${encodeURIComponent(trimmed)}`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <p className="ui-mono text-[11px] mb-3" style={{ color: UI.accent }}>
          a procedurally drawn exploration game
        </p>
        <h1 className="text-5xl md:text-6xl mb-4 leading-none" style={{ color: UI.parchment }}>
          Open Range
        </h1>
        <p className="ui-sans text-sm leading-relaxed mb-8" style={{ color: UI.parchmentDim }}>
          You wake on a shore. Three artifacts are hidden on the island, each one opening ground the last could
          not reach. Nobody will mark your map — but everybody knows a piece of it, and most of them know who
          knows the rest.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            start(seed);
          }}
          className="mb-4"
        >
          <label className="ui-mono text-[11px] block mb-2" style={{ color: UI.inkSoft }}>
            seed — the same word always grows the same island
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="any word — or leave it blank"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded px-3 py-2 ui-mono text-sm outline-none"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${UI.inkSoft}`,
                color: UI.parchment,
              }}
              aria-label="World seed"
            />
            <button
              type="submit"
              className="rounded px-5 py-2 text-sm transition-opacity hover:opacity-90"
              style={{ background: UI.accent, color: "#1a1710" }}
            >
              Wake up
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2 mb-8">
          <span className="ui-mono text-[10px]" style={{ color: UI.inkSoft }}>
            try:
          </span>
          {suggestions.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeed(value)}
              className="ui-mono text-[10px] rounded px-2 py-1 hover:opacity-80"
              style={{ border: `1px solid ${UI.nightSoft}`, color: UI.parchmentDim }}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="mb-8 rounded px-4 py-3" style={{ border: `1px solid ${UI.nightSoft}` }}>
          <ReadAloudToggle
            enabled={readAloud}
            available={narrationAvailable}
            onChange={changeReadAloud}
          />
        </div>

        {saved ? (
          <div className="mb-8 rounded px-4 py-3" style={{ border: `1px solid ${UI.nightSoft}` }}>
            <div className="ui-sans text-sm mb-2" style={{ color: UI.parchmentDim }}>
              You left an island unfinished:{" "}
              <span className="ui-mono" style={{ color: UI.accent }}>
                {saved.seed}
              </span>
              {saved.won ? " — already reached the summit." : ""}
            </div>
            <Link
              href={`/play?seed=${encodeURIComponent(saved.seed)}&resume=1`}
              className="ui-sans text-sm underline"
              style={{ color: UI.parchment }}
              onClick={() => {
                if (getMusicEnabled()) primeAudio();
              }}
            >
              Go back to it
            </Link>
          </div>
        ) : null}

        <div className="ui-sans text-xs leading-relaxed" style={{ color: UI.inkSoft }}>
          <p className="mb-2">
            Every tile, character, landmark and name in this game is drawn in code from one constrained
            palette. No image files are shipped.
          </p>
          <Link href="/atlas" className="underline">
            See the whole art pipeline
          </Link>
        </div>
      </div>
    </main>
  );
}
