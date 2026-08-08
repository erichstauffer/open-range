"use client";

/**
 * The map, in two sizes.
 *
 * Both read the live `GameState` out of a ref rather than taking a
 * `PublicState`. `visited` is fifty thousand bytes and `sameSnapshot` compares
 * by value, so putting the map's data through the snapshot would either cost a
 * full array scan per frame or be silently wrong. The loop already owns the
 * state; the map just looks at it.
 *
 * Terrain goes on a canvas, one pixel per tile, scaled up with smoothing off -
 * it is a pixel game and the map should look like one. Labels are DOM on top,
 * so the region names use the game's own type at full device resolution
 * instead of being drawn as blurry `fillText` into an upscaled bitmap.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { UI } from "@/lib/art/palette";
import { ROBOT_NAME } from "@/lib/world/robot";
import { currentTownName, mapMarkers, mapView, paintMap, type MapMarkers } from "@/lib/game/map";
import type { GameState } from "@/lib/game/state";

/** Redraws per second. The robot is the only thing that moves, and it ambles. */
const REDRAW_HZ = 8;

/** How wide the corner map is on screen, in CSS pixels. */
const MINIMAP_PX = 132;

/** Upscale for the expanded map's backing store: 224 tiles becomes 672px. */
const OVERLAY_SCALE = 3;

type StateRef = RefObject<GameState | null>;

/**
 * Paint terrain into a canvas of any size.
 *
 * The tile buffer goes through a scratch canvas at its natural one-pixel-per-tile
 * size first, because `putImageData` ignores the transform - the only way to
 * scale a buffer is to draw it as an image.
 */
function paintTerrain(canvas: HTMLCanvasElement, state: GameState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const view = mapView(state);
  const { width, height } = view.world;

  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) return;
  scratchCtx.putImageData(new ImageData(paintMap(view), width, height), 0, 0);

  // Crisp when the map is being blown up, smoothed when it is being shrunk. A
  // nearest-neighbour downscale of one-pixel-per-tile terrain simply throws away
  // every other row, which turns a coastline into a dotted line.
  ctx.imageSmoothingEnabled = canvas.width < width;
  ctx.fillStyle = UI.night;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
}

/** A filled square centred on a tile, with a dark rim so it reads over any biome. */
function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  perTile: number,
  size: number,
  colour: string,
): void {
  const cx = Math.round(x * perTile);
  const cy = Math.round(y * perTile);
  ctx.fillStyle = "rgba(12,14,10,0.75)";
  ctx.fillRect(cx - size - 1, cy - size - 1, size * 2 + 3, size * 2 + 3);
  ctx.fillStyle = colour;
  ctx.fillRect(cx - size, cy - size, size * 2 + 1, size * 2 + 1);
}

/**
 * A repaint loop that runs at a fraction of the frame rate.
 *
 * Eight times a second is enough to see the robot move and enough that the fog
 * opens up as you walk, and it keeps a whole-island repaint well clear of the
 * frame budget the game itself is spending.
 */
function useRepaint(paint: () => void): void {
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = 1000 / REDRAW_HZ;

    const tick = (now: number) => {
      if (now - last >= interval) {
        last = now;
        paint();
      }
      raf = requestAnimationFrame(tick);
    };

    paint();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paint]);
}

/**
 * The corner map.
 *
 * Deliberately unlabelled: at this size a name would be unreadable and a legend
 * would be a second HUD. It says where you are, where the machine is, and how
 * much of the island is still dark - and it is a button, because the answer to
 * wanting more detail should be one tap away rather than a key nobody found.
 */
export function Minimap({
  stateRef,
  exploredPercent,
  onOpen,
}: {
  stateRef: StateRef;
  exploredPercent: number;
  onOpen: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state) return;

    const view = mapView(state);
    // Sized in device pixels, like the game canvas: the markers are two or three
    // pixels across and would be lost to a browser's own upscale of a small
    // backing store.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Square, because the island is: `WORLD_WIDTH` and `WORLD_HEIGHT` are the
    // same number and the generator has no notion of an oblong world.
    const wanted = Math.max(64, Math.round(MINIMAP_PX * dpr));
    if (canvas.width !== wanted) {
      canvas.width = wanted;
      canvas.height = wanted;
    }

    paintTerrain(canvas, state);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const perTile = canvas.width / view.world.width;
    const markers = mapMarkers(state);
    for (const town of markers.towns) dot(ctx, town.x, town.y, perTile, 1, UI.parchmentDim);
    dot(ctx, markers.robot.x, markers.robot.y, perTile, 1, UI.accent);
    dot(ctx, markers.player.x, markers.player.y, perTile, 2, UI.parchment);
  }, [stateRef]);

  useRepaint(paint);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="minimap-button pointer-events-auto mt-2 block rounded p-1"
      style={{
        background: "rgba(14,16,22,0.55)",
        border: `1px solid ${UI.nightSoft}`,
        width: MINIMAP_PX,
        height: MINIMAP_PX,
      }}
      aria-label={`Island map, ${exploredPercent}% explored. Open the full map.`}
      title="Open the map (M)"
    >
      <canvas ref={canvasRef} className="block h-full w-full rounded-[2px]" />
    </button>
  );
}

interface Labels {
  width: number;
  height: number;
  markers: MapMarkers;
  indoorsAt: string | null;
}

/**
 * Whether two label sets would draw the same thing.
 *
 * Positions are compared at whole tiles, which is the finest difference the
 * labels can express anyway - the robot crossing half a tile does not move a
 * marker the eye can see, and re-rendering for it would be a render per tick.
 */
function sameLabels(a: Labels | null, b: Labels): boolean {
  if (!a) return false;
  const near = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.round(p.x) === Math.round(q.x) && Math.round(p.y) === Math.round(q.y);
  return (
    a.indoorsAt === b.indoorsAt &&
    a.markers.towns.length === b.markers.towns.length &&
    a.markers.regions.length === b.markers.regions.length &&
    near(a.markers.player, b.markers.player) &&
    near(a.markers.robot, b.markers.robot)
  );
}

/**
 * The full map.
 *
 * Same modal shell as the journal, and for the same reason: these are the two
 * things you stop walking to read, and they should feel like the same drawer of
 * the same desk.
 */
export function MapOverlay({
  stateRef,
  seed,
  exploredPercent,
  onClose,
}: {
  stateRef: StateRef;
  seed: string;
  exploredPercent: number;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The labels, lifted out of the ref and into React.
   *
   * The terrain can be painted straight from `stateRef` because that happens
   * inside an animation frame, but the labels are DOM and DOM comes from a
   * render - and a render may not read a ref. So the repaint tick, which is
   * already the thing looking at the live state, publishes what the labels need.
   */
  const [labels, setLabels] = useState<Labels | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state) return;

    const view = mapView(state);
    const wanted = view.world.width * OVERLAY_SCALE;
    if (canvas.width !== wanted) {
      canvas.width = wanted;
      canvas.height = view.world.height * OVERLAY_SCALE;
    }
    paintTerrain(canvas, state);

    const next: Labels = {
      width: view.world.width,
      height: view.world.height,
      markers: mapMarkers(state, { regions: true }),
      indoorsAt: currentTownName(state),
    };
    // Only when something moved or was found: the world is paused behind this
    // panel, so most ticks have nothing new to say and a setState per tick would
    // be eight renders a second to draw the same words in the same places.
    setLabels((previous) => (sameLabels(previous, next) ? previous : next));
  }, [stateRef]);

  useRepaint(paint);

  const markers: MapMarkers | null = labels?.markers ?? null;
  const indoorsAt = labels?.indoorsAt ?? null;

  // Percentages, so the label layer tracks the canvas at any size the viewport
  // gives it. A pixel offset would only be right at one window width.
  const place = (x: number, y: number) =>
    labels ? { left: `${(x / labels.width) * 100}%`, top: `${(y / labels.height) * 100}%` } : {};

  return (
    <div
      className="overlay-layer absolute inset-0 grid place-items-center p-4"
      style={{ background: "rgba(14,16,22,0.86)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Island map"
    >
      <div
        className="w-full max-w-3xl rounded-md px-4 py-4 md:px-6 md:py-5"
        style={{ background: "rgba(22,21,15,0.97)", border: `1px solid ${UI.inkSoft}` }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl" style={{ color: UI.parchment }}>
            The island
          </h2>
          <span className="ui-mono text-[10px] desktop-only" style={{ color: UI.inkSoft }}>
            M or esc to close
          </span>
          <button type="button" className="overlay-action" onClick={onClose} autoFocus>
            Close
          </button>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-[70vh]">
          <canvas ref={canvasRef} className="block h-full w-full rounded-[2px]" />

          <div className="pointer-events-none absolute inset-0">
            {markers?.regions.map((region) => (
              <span
                key={region.id}
                className="ui-sans absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] md:text-xs"
                style={{
                  ...place(region.x, region.y),
                  color: UI.parchmentDim,
                  textShadow: "0 1px 2px rgba(10,12,16,0.95)",
                }}
              >
                {region.name}
              </span>
            ))}

            {markers?.towns.map((town) => (
              <span
                key={town.id}
                className="ui-mono absolute -translate-y-1/2 whitespace-nowrap text-[10px]"
                style={{ ...place(town.x, town.y), color: UI.parchment, textShadow: "0 1px 2px rgba(10,12,16,0.95)" }}
              >
                <span style={{ color: UI.accent }}>◆</span> {town.name}
              </span>
            ))}

            {markers ? (
              <span
                className="absolute -translate-x-1/2 -translate-y-1/2 text-xs leading-none"
                style={{ ...place(markers.robot.x, markers.robot.y), color: UI.accent, textShadow: "0 1px 2px rgba(10,12,16,0.95)" }}
                title={ROBOT_NAME}
              >
                ◆
              </span>
            ) : null}

            {markers ? (
              <span
                className="absolute -translate-x-1/2 -translate-y-1/2 text-sm leading-none"
                style={{ ...place(markers.player.x, markers.player.y), color: UI.parchment, textShadow: "0 1px 2px rgba(10,12,16,0.95)" }}
                title="You"
              >
                ◉
              </span>
            ) : null}
          </div>
        </div>

        <div className="ui-mono mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10px]" style={{ color: UI.inkSoft }}>
          <span>
            {seed} · explored {exploredPercent}%
          </span>
          <span>
            <span style={{ color: UI.parchment }}>◉</span> you ·{" "}
            <span style={{ color: UI.accent }}>◆</span> {ROBOT_NAME}
            {indoorsAt ? ` · you are indoors, at ${indoorsAt}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
