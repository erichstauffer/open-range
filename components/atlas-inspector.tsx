"use client";

/**
 * The coherence checkpoint.
 *
 * This page exists to answer the one question the whole project rests on: do
 * eleven procedurally drawn terrain types look like they belong in the same
 * illustration? Judge it here before judging any gameplay.
 *
 * The panel that matters most is "every biome against every biome" - if the
 * pairs hold together there, the world will hold together too.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { RAMPS, TILE_SPECS, UI, type TileKind } from "@/lib/art/palette";
import { TILE, VARIANTS } from "@/lib/art/tiles";
import { bakeAtlas, charKey, edgeKey, landmarkKey, propKey, tileKey, artifactKey } from "@/lib/art/atlas";
import { makeCharacterSpec, LANDMARK_KINDS, PROP_KINDS, PROP_VARIANTS, FACINGS } from "@/lib/art/sprites";
import { hash2D, makeRng } from "@/lib/rand";

const SCALE = 3;
const DEMO_CHARACTERS = ["player", "npc-a", "npc-b", "npc-c", "npc-d"];
const DEMO_ARTIFACTS = ["ford-stone", "climbing-hooks", "bramble-blade"];

type Atlas = ReturnType<typeof bakeAtlas>;

function useAtlas(): Atlas | null {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  useEffect(() => {
    // Baking touches OffscreenCanvas and getImageData, so it cannot run during
    // the server render, and the result is a live canvas rather than anything
    // serialisable. One-time client-side construction of an external resource is
    // what an effect is for; it runs once and cascades nothing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAtlas(
      bakeAtlas({
        characters: DEMO_CHARACTERS.map((key, i) => ({
          key,
          spec: makeCharacterSpec(makeRng(`demo-char`, key + i)),
        })),
        artifacts: DEMO_ARTIFACTS,
      }),
    );
  }, []);
  return atlas;
}

/** Draws once on mount via a callback given the 2d context. */
function Painter({
  width,
  height,
  scale = SCALE,
  paint,
  className,
}: {
  width: number;
  height: number;
  scale?: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    paint(ctx);
  }, [paint, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={className}
      style={{ width: width * scale, height: height * scale }}
    />
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="text-xl mb-1" style={{ color: UI.parchment }}>
        {title}
      </h2>
      {note ? (
        <p className="ui-sans text-sm mb-4 max-w-3xl leading-relaxed" style={{ color: UI.inkSoft }}>
          {note}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export default function AtlasInspector() {
  const atlas = useAtlas();

  const pairs = useMemo(() => {
    const list: Array<[TileKind, TileKind]> = [];
    for (const a of TILE_SPECS) {
      for (const b of TILE_SPECS) {
        if (a.rank < b.rank) list.push([a.kind, b.kind]);
      }
    }
    return list;
  }, []);

  if (!atlas) {
    return (
      <main className="p-10 ui-sans" style={{ color: UI.inkSoft }}>
        Baking atlas…
      </main>
    );
  }

  const blit = (ctx: CanvasRenderingContext2D, key: string, dx: number, dy: number) => {
    const cell = atlas.tryCell(key);
    if (!cell) return;
    ctx.drawImage(atlas.surface.canvas, cell.x, cell.y, cell.w, cell.h, dx, dy, cell.w, cell.h);
  };

  /** One tile plus every edge overlay it would receive from a higher-ranked neighbour. */
  const paintPatch = (kind: TileKind, w: number, h: number, neighbour?: TileKind) => (ctx: CanvasRenderingContext2D) => {
    for (let ty = 0; ty < h; ty += 1) {
      for (let tx = 0; tx < w; tx += 1) {
        const variant = Math.floor(hash2D(tx, ty, 99) * VARIANTS);
        blit(ctx, tileKey(kind, variant), tx * TILE, ty * TILE);
      }
    }
    if (neighbour) {
      // Bottom half is the neighbour; the seam row receives its edge band.
      const split = Math.floor(h / 2);
      for (let ty = split; ty < h; ty += 1) {
        for (let tx = 0; tx < w; tx += 1) {
          const variant = Math.floor(hash2D(tx, ty, 77) * VARIANTS);
          blit(ctx, tileKey(neighbour, variant), tx * TILE, ty * TILE);
        }
      }
      for (let tx = 0; tx < w; tx += 1) {
        blit(ctx, edgeKey(neighbour, 2), tx * TILE, (split - 1) * TILE);
      }
    }
  };

  return (
    <main className="p-8 md:p-12 max-w-6xl mx-auto">
      <header className="mb-12">
        <p className="ui-mono text-xs mb-2" style={{ color: UI.accent }}>
          debug · art pipeline
        </p>
        <h1 className="text-3xl mb-3" style={{ color: UI.parchment }}>
          Atlas inspector
        </h1>
        <p className="ui-sans text-sm max-w-3xl leading-relaxed" style={{ color: UI.inkSoft }}>
          Every drawable in the game, baked from one constrained palette in{" "}
          <span className="ui-mono" style={{ color: UI.accent }}>
            {atlas.bakeMs.toFixed(1)}ms
          </span>
          . No image files are shipped. The question this page answers: do these read as one illustration?
        </p>
      </header>

      <Section
        title="Terrain variants"
        note="Six interiors per biome, chosen per world tile by a stable coordinate hash so nothing shimmers as the camera moves. Interiors are flat plus small marks — never a gradient, which is what would turn the world into a visible lattice."
      >
        <div className="space-y-3">
          {TILE_SPECS.map((spec) => (
            <div key={spec.kind} className="flex items-center gap-4">
              <div className="w-36 shrink-0">
                <div className="ui-sans text-sm" style={{ color: UI.parchment }}>
                  {spec.label}
                </div>
                <div className="ui-mono text-[10px]" style={{ color: UI.inkSoft }}>
                  h{spec.hue} s{spec.sat.toFixed(2)} rank{spec.rank}
                </div>
              </div>
              <Painter
                width={TILE * VARIANTS}
                height={TILE}
                paint={(ctx) => {
                  for (let v = 0; v < VARIANTS; v += 1) blit(ctx, tileKey(spec.kind, v), v * TILE, 0);
                }}
              />
              <div className="flex">
                {RAMPS[spec.kind].map((hex) => (
                  <div key={hex} className="w-6 h-6" style={{ background: hex }} title={hex} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Seam check"
        note="Each biome tiled 8×6 with hash-selected variants. Look for a repeating lattice or an obvious gradient mismatch at tile borders — if the interiors were doing any shading of their own, you would see a grid here."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {TILE_SPECS.map((spec) => (
            <div key={spec.kind}>
              <div className="ui-sans text-xs mb-1" style={{ color: UI.inkSoft }}>
                {spec.label}
              </div>
              <Painter width={TILE * 8} height={TILE * 6} scale={2} paint={paintPatch(spec.kind, 8, 6)} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Every biome against every biome"
        note="All 55 ordered pairs, higher-ranked terrain dithering onto lower. This is the panel that decides the project: the original attempt died because hand-picked terrain art would not hold a consistent look across boundaries like these."
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {pairs.map(([lower, higher]) => (
            <div key={`${lower}-${higher}`}>
              <Painter width={TILE * 4} height={TILE * 4} scale={2} paint={paintPatch(lower, 4, 4, higher)} />
              <div className="ui-mono text-[10px] mt-1 leading-tight" style={{ color: UI.inkSoft }}>
                {lower}
                <br />↕ {higher}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Characters"
        note="A hand-written humanoid template with seeded variation in hair, cloak, hood and staff. Right-facing frames are mirrored from left-facing, so the two profiles cannot drift apart. The 1px outline is applied by a shared post-pass, not drawn by hand."
      >
        <div className="space-y-4">
          {DEMO_CHARACTERS.map((key) => (
            <div key={key} className="flex items-center gap-4">
              <div className="ui-mono text-xs w-20" style={{ color: UI.inkSoft }}>
                {key}
              </div>
              <Painter
                width={16 * 8}
                height={20}
                paint={(ctx) => {
                  let dx = 0;
                  for (const facing of FACINGS) {
                    for (const frame of [0, 1] as const) {
                      blit(ctx, charKey(key, facing, frame), dx, 0);
                      dx += 16;
                    }
                  }
                }}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Artifacts, landmarks, props"
        note="Artifacts use a mirrored random mask — treasure should look strange and unrepeatable. Landmarks are templates, because hint text names them out loud and you have to recognise one on sight."
      >
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <div className="ui-sans text-xs mb-2" style={{ color: UI.inkSoft }}>
              artifacts
            </div>
            <Painter
              width={16 * DEMO_ARTIFACTS.length}
              height={16}
              paint={(ctx) => DEMO_ARTIFACTS.forEach((id, i) => blit(ctx, artifactKey(id), i * 16, 0))}
            />
          </div>
          <div>
            <div className="ui-sans text-xs mb-2" style={{ color: UI.inkSoft }}>
              landmarks
            </div>
            <Painter
              width={32 * LANDMARK_KINDS.length}
              height={32}
              scale={2}
              paint={(ctx) => LANDMARK_KINDS.forEach((k, i) => blit(ctx, landmarkKey(k), i * 32, 0))}
            />
          </div>
          <div>
            <div className="ui-sans text-xs mb-2" style={{ color: UI.inkSoft }}>
              props
            </div>
            <Painter
              width={16 * PROP_KINDS.length * PROP_VARIANTS}
              height={24}
              scale={2}
              paint={(ctx) => {
                let dx = 0;
                for (const kind of PROP_KINDS) {
                  for (let v = 0; v < PROP_VARIANTS; v += 1) {
                    blit(ctx, propKey(kind, v), dx, 0);
                    dx += 16;
                  }
                }
              }}
            />
          </div>
        </div>
      </Section>

      <Section title="Raw atlas" note="One texture, 512×512. Everything above is a blit out of this.">
        <Painter
          width={atlas.width}
          height={atlas.height}
          scale={1}
          paint={(ctx) => ctx.drawImage(atlas.surface.canvas, 0, 0)}
          className="border"
        />
      </Section>
    </main>
  );
}
