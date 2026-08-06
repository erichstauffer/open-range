"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { RAMPS, TILE_SPECS, UI } from "@/lib/art/palette";
import { compoundName, inventedName } from "@/lib/world/names";
import { makeRng } from "@/lib/rand";
import { loadRecord } from "@/lib/game/save";
import { getMusicEnabled, getReadAloudEnabled, setReadAloudEnabled } from "@/lib/game/preferences";
import { primeAudio } from "@/lib/audio/context";
import ReadAloudToggle from "./read-aloud-toggle";

/** A pronounceable default so a random world still has a memorable identity. */
function suggestSeed(salt: string): string {
  const rng = makeRng(salt, "suggest");
  return (rng() < 0.5 ? compoundName(rng) : inventedName(rng)).toLowerCase();
}

/** Event-time entropy kept outside the component's render scope. */
function randomSeed(): string {
  return suggestSeed(String(Date.now()));
}

const SUGGESTIONS = ["dunhollow", "amrath", "grey-fen", "enneth"] as const;

interface SavedSummary {
  seed: string;
  won: boolean;
}

interface PendingWorld {
  seed: string;
  source: "hero" | "seed";
}

export default function TitleScreen() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  // Undefined means local storage has not been checked yet. Server rendering
  // and the first client render agree on it, and the reserved action shell
  // prevents a returning player's Continue button from appearing late.
  const [saved, setSaved] = useState<SavedSummary | null>();
  const [pendingWorld, setPendingWorld] = useState<PendingWorld | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [narrationAvailable, setNarrationAvailable] = useState(true);
  const confirmationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const record = loadRecord();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(record ? { seed: record.seed, won: record.won } : null);
    setReadAloud(getReadAloudEnabled());
    setNarrationAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  }, []);

  useEffect(() => {
    if (pendingWorld !== null) confirmationRef.current?.focus();
  }, [pendingWorld]);

  const changeReadAloud = (enabled: boolean) => {
    setReadAloud(enabled);
    setReadAloudEnabled(enabled);
  };

  const start = (value: string) => {
    // Unlock audio inside the initiating click and before same-document
    // navigation, so the game arrives with a running AudioContext.
    if (getMusicEnabled()) primeAudio();
    const trimmed = value.trim() || randomSeed();
    router.push(`/play?seed=${encodeURIComponent(trimmed)}`);
  };

  const requestNewWorld = (value: string, source: PendingWorld["source"]) => {
    if (saved) {
      setPendingWorld({ seed: value, source });
      return;
    }
    start(value);
  };

  const overwriteConfirmation = (source: PendingWorld["source"]) => {
    if (!saved || !pendingWorld || pendingWorld.source !== source) return null;

    return (
      <div ref={confirmationRef} className="landing-confirmation" role="alert" tabIndex={-1}>
        <strong>Replace your saved journey?</strong>
        <p>
          Starting {pendingWorld.seed.trim() ? `the world “${pendingWorld.seed.trim()}”` : "a new world"} will
          replace your saved journey on {saved.seed} once the new game saves.
        </p>
        <div className="landing-confirmation-actions">
          <button type="button" className="landing-text-button" onClick={() => setPendingWorld(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="landing-button landing-button-danger"
            onClick={() => start(pendingWorld.seed)}
          >
            Start new anyway
          </button>
        </div>
      </div>
    );
  };

  const landingStyle = {
    "--landing-parchment": UI.parchment,
    "--landing-parchment-dim": UI.parchmentDim,
    "--landing-ink": UI.ink,
    "--landing-ink-soft": UI.inkSoft,
    "--landing-night": UI.night,
    "--landing-night-soft": UI.nightSoft,
    "--landing-accent": UI.accent,
  } as CSSProperties;

  return (
    <main className="landing-shell" style={landingStyle}>
      <div className="landing-layout">
        <header className="landing-hero" aria-labelledby="landing-title">
          <Image
            src="/hero.png"
            width={1200}
            height={630}
            priority
            sizes="(max-width: 960px) calc(100vw - 32px), 920px"
            className="landing-hero-image"
            alt="A generated Open Range island showing sea, shore, meadow, woodland, highland, snow, and the player."
          />
          <div className="landing-hero-overlay">
            <p className="landing-eyebrow">a procedurally drawn exploration game</p>
            <h1 id="landing-title">OPEN RANGE</h1>
            <p className="landing-intro">
              Wake on a shore, follow the clues, and uncover the island one artifact at a time.
            </p>

            {saved === undefined ? (
              <div className="landing-actions-loading" aria-hidden="true">
                <span />
                <span />
              </div>
            ) : saved ? (
              <div className="landing-returning">
                <section className="landing-returning-copy" aria-labelledby="continue-title">
                  <p className="landing-card-kicker">your journey</p>
                  <h2 id="continue-title">{saved.won ? `The summit of ${saved.seed}` : saved.seed}</h2>
                  <p>
                    {saved.won
                      ? "You reached the summit. The island is still there when you want to wander again."
                      : "Your last trail is waiting exactly where you left it."}
                  </p>
                </section>
                <div className="landing-hero-actions">
                  <Link
                    href={`/play?seed=${encodeURIComponent(saved.seed)}&resume=1`}
                    className="landing-button landing-button-primary"
                    onClick={() => {
                      if (getMusicEnabled()) primeAudio();
                    }}
                  >
                    {saved.won ? `Return to ${saved.seed}` : `Continue ${saved.seed}`}
                  </Link>
                  <button
                    type="button"
                    className="landing-button landing-button-ghost"
                    onClick={() => requestNewWorld("", "hero")}
                  >
                    Wake up somewhere new
                  </button>
                </div>
                {overwriteConfirmation("hero")}
              </div>
            ) : (
              <div className="landing-hero-actions">
                <button
                  type="button"
                  className="landing-button landing-button-primary"
                  onClick={() => requestNewWorld("", "hero")}
                >
                  Wake up
                </button>
              </div>
            )}
          </div>
          <div className="landing-palette-strip" aria-hidden="true">
            {TILE_SPECS.map((spec) => (
              <span key={spec.kind} style={{ background: RAMPS[spec.kind][3] }} />
            ))}
          </div>
        </header>

        <div className="landing-content">
          {saved !== undefined ? (
            <>
              <section className="landing-card landing-seed-panel">
                <details className="landing-seed-details">
                  <summary>Choose a specific world</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      requestNewWorld(seed, "seed");
                    }}
                  >
                    <label htmlFor="world-seed">World seed</label>
                    <p id="seed-help">The same word always grows the same island.</p>
                    <div className="landing-seed-row">
                      <input
                        id="world-seed"
                        value={seed}
                        onChange={(event) => setSeed(event.target.value)}
                        placeholder="any word — or leave it blank"
                        spellCheck={false}
                        autoComplete="off"
                        aria-describedby="seed-help"
                      />
                      <button type="submit" className="landing-button landing-button-secondary">
                        Wake up here
                      </button>
                    </div>
                    <div className="landing-suggestions" aria-label="Suggested world seeds">
                      <span>try:</span>
                      {SUGGESTIONS.map((value) => (
                        <button key={value} type="button" onClick={() => setSeed(value)}>
                          {value}
                        </button>
                      ))}
                    </div>
                  </form>
                </details>
                {overwriteConfirmation("seed")}
              </section>

              <section className="landing-card landing-accessibility-card" aria-labelledby="accessibility-title">
                <div>
                  <p className="landing-card-kicker">optional</p>
                  <h2 id="accessibility-title">Conversation audio</h2>
                </div>
                <ReadAloudToggle
                  enabled={readAloud}
                  available={narrationAvailable}
                  onChange={changeReadAloud}
                />
              </section>
            </>
          ) : null}

          <footer className="landing-footer">
            <p>
              The game itself draws every tile, character, landmark and name in code from one constrained
              palette. The preview above comes from that same renderer.
            </p>
            <Link href="/atlas">Learn more about the game</Link>
          </footer>
        </div>
      </div>
    </main>
  );
}
