"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { UI } from "@/lib/art/palette";
import type { MoveVector } from "@/lib/game/input";
import { readJoystick } from "@/lib/game/joystick";

export default function MobileControls({
  onMove,
  onInteract,
  onJournal,
}: {
  onMove: (movement: MoveVector | null) => void;
  onInteract: () => void;
  onJournal: () => void;
}) {
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [activeCentre, setActiveCentre] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const release = () => {
    pointerId.current = null;
    setActiveCentre(null);
    setKnob({ x: 0, y: 0 });
    onMove(null);
  };

  useEffect(() => () => onMove(null), [onMove]);

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

  return (
    <div className="touch-controls" aria-label="Touch game controls">
      <div
        className="joystick-zone"
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

      <div className="touch-action-cluster">
        <button
          type="button"
          className="touch-button touch-button-secondary"
          onClick={onJournal}
          aria-label="Open journal"
        >
          Journal
        </button>
        <button
          type="button"
          className="touch-button touch-button-primary"
          onClick={onInteract}
          aria-label="Talk or interact"
          style={{ borderColor: UI.accent }}
        >
          Act
        </button>
      </div>
    </div>
  );
}
