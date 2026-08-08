"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { UI } from "@/lib/art/palette";
import type { MoveVector } from "@/lib/game/input";
import type { NearbyInteraction } from "@/lib/game/state";
import { readJoystick } from "@/lib/game/joystick";
import { controlsHelpDismissed, dismissControlsHelp } from "@/lib/game/preferences";

export default function GameControls({
  nearbyInteraction,
  onMove,
  onInteract,
  onJournal,
  onMap,
  onSettings,
}: {
  nearbyInteraction: NearbyInteraction | null;
  onMove: (movement: MoveVector | null) => void;
  onInteract: () => void;
  onJournal: () => void;
  onMap: () => void;
  onSettings: () => void;
}) {
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [activeCentre, setActiveCentre] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [helpOpen, setHelpOpen] = useState<boolean | null>(null);

  useEffect(() => {
    // This preference is deliberately separate from the world save and can
    // only be read after mount, when browser storage exists.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHelpOpen(!controlsHelpDismissed());
  }, []);

  useEffect(() => () => onMove(null), [onMove]);

  const release = () => {
    pointerId.current = null;
    setActiveCentre(null);
    setKnob({ x: 0, y: 0 });
    onMove(null);
  };

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const centre = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointerId.current = event.pointerId;
    origin.current = { x: event.clientX, y: event.clientY };
    setActiveCentre(centre);
    setKnob({ x: 0, y: 0 });
    onMove({ dx: 0, dy: 0 });
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerId.current) return;
    event.preventDefault();
    const reading = readJoystick(event.clientX - origin.current.x, event.clientY - origin.current.y);
    setKnob(reading.knob);
    onMove(reading.movement);
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerId.current) return;
    release();
  };

  const closeHelp = () => {
    setHelpOpen(false);
    dismissControlsHelp();
  };

  return (
    <div className="game-controls" aria-label="Game controls">
      <div
        className="coarse-only joystick-zone"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        aria-label="Drag to move"
      >
        <div
          className={`joystick-base${activeCentre ? " is-active" : ""}`}
          style={activeCentre ? { left: activeCentre.x, top: activeCentre.y } : undefined}
        >
          <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
          <span>move</span>
        </div>
      </div>

      {helpOpen ? (
        <div className="coarse-only controls-help ui-sans">
          <button type="button" onClick={closeHelp} aria-label="Hide control instructions">
            ×
          </button>
          <div>Drag the left control to move.</div>
          <div>Act lights up near someone to talk to or a landmark to read.</div>
        </div>
      ) : null}

      <div className="control-action-cluster">
        {nearbyInteraction ? <div className="talk-prompt ui-sans">{actionLabel(nearbyInteraction)}</div> : null}
        <div className="control-button-row">
          {helpOpen === false ? (
            <button
              type="button"
              className="coarse-only game-button help-button"
              onClick={() => setHelpOpen(true)}
              aria-label="Show control instructions"
            >
              ?
            </button>
          ) : null}
          {/*
            Every preference lives behind this one button - music, narration and
            the fog. It is shown unconditionally, because the panel is still
            worth opening on a device with no audio at all.
          */}
          <button
            type="button"
            className="game-button settings-button"
            onClick={onSettings}
            aria-label="Open settings"
            title="Settings (O)"
          >
            <span aria-hidden="true">⚙</span>
            <kbd className="desktop-only">O</kbd>
          </button>
          <button type="button" className="game-button" onClick={onMap} title="Open the map (M)">
            Map <kbd className="desktop-only">M</kbd>
          </button>
          <button type="button" className="game-button" onClick={onJournal}>
            Journal <kbd className="desktop-only">J</kbd>
          </button>
          <button
            type="button"
            className="game-button game-button-primary"
            onClick={onInteract}
            disabled={!nearbyInteraction}
            aria-label={
              nearbyInteraction ? actionLabel(nearbyInteraction) : "Nothing is close enough to interact with"
            }
            title={nearbyInteraction ? actionLabel(nearbyInteraction) : "Move closer to a person, a town or a landmark"}
            style={nearbyInteraction ? { borderColor: UI.accent } : undefined}
          >
            Act <kbd className="desktop-only">E</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What the Act button says it will do.
 *
 * One function rather than a ternary at each of the three places that needed it,
 * because the three had already drifted once - the prompt, the accessible name
 * and the tooltip all read "Read" for a robot that is plainly a person you talk
 * to. The verb has to match what `interact` actually does, so this list and the
 * priority order in `updateNearbyInteraction` are the same list twice.
 */
function actionLabel(interaction: NearbyInteraction): string {
  switch (interaction.kind) {
    case "robot":
    case "npc":
      return `Talk to ${interaction.label}`;
    case "town":
      return `Enter ${interaction.label}`;
    case "building":
      switch (interaction.building) {
        case "store":
          return "Trade at the store";
        case "inn":
          return "Rest at the inn";
        case "church":
          return "Hear a prayer";
        case "pub":
          return "Join the pub";
        case "house":
          return `Visit the ${interaction.label}`;
      }
      break;
    case "landmark":
      return `Read ${interaction.label}`;
  }
}
