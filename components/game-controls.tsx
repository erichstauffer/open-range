"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { UI } from "@/lib/art/palette";
import type { MoveVector } from "@/lib/game/input";
import { readJoystick } from "@/lib/game/joystick";
import { controlsHelpDismissed, dismissControlsHelp } from "@/lib/game/preferences";

export default function GameControls({
  nearbyNpc,
  onMove,
  onInteract,
  onJournal,
}: {
  nearbyNpc: { id: string; name: string } | null;
  onMove: (movement: MoveVector | null) => void;
  onInteract: () => void;
  onJournal: () => void;
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
          <div>Act lights up when someone is close enough to talk.</div>
        </div>
      ) : null}

      <div className="control-action-cluster">
        {nearbyNpc ? <div className="talk-prompt ui-sans">Talk to {nearbyNpc.name}</div> : null}
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
          <button type="button" className="game-button game-button-secondary" onClick={onJournal}>
            Journal <kbd className="desktop-only">J</kbd>
          </button>
          <button
            type="button"
            className="game-button game-button-primary"
            onClick={onInteract}
            disabled={!nearbyNpc}
            aria-label={nearbyNpc ? `Talk to ${nearbyNpc.name}` : "No one is close enough to talk to"}
            title={nearbyNpc ? `Talk to ${nearbyNpc.name}` : "Move closer to someone to talk"}
            style={nearbyNpc ? { borderColor: UI.accent } : undefined}
          >
            Act <kbd className="desktop-only">E</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
