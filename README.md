# Open Range

A top-down 2D exploration game in the browser. Every tile, character, landmark
and place name is generated in code from one constrained palette. **No image
files are shipped.**

You wake on a shore. Three artifacts are hidden on the island, each opening
ground the previous one could not reach. Nothing marks your map — but the people
you meet each know a piece of it, and most of them know who knows the rest.

**Play:** https://open-range-erichstauffer.vercel.app

```bash
npm install
npm run dev
```

- `/` — title screen and seed entry
- `/play?seed=dunhollow` — the game; any seed grows the same island for everyone
- `/atlas` — the art pipeline, every drawable on one page

## Where this came from

The design comes from a recorded conversation (`game-transcript.txt`): a 2D
Zelda-like with a Lord of the Rings register, no storyline, open world, and
progression by artifact gating — "you can't get to this area until you find this
artifact in this area."

The project it describes had been abandoned, for one clearly stated reason:

> "finding artwork that's all, like, in the same kind of look and feel
> throughout, like different terrains" … "I'm in too deep" … "so I just jumped
> ship."

The blocker was **art coherence across terrain types**, not design and not code.
Everything below follows from that.

## Why procedural, and not generated-then-shipped

Asking an image model for two hundred tiles reproduces the original failure with
a faster feedback loop — style drift across terrains is that pipeline's known
weakness, and drift is exactly what killed the first attempt.

Drawing every tile in code from **one shared palette and one shared set of
primitives** makes an off-style tile *impossible to produce*. Coherence stops
being a curation problem and becomes a structural property of the generator.

Concretely, `lib/art/palette.ts` confines the entire game to one box:

| Constraint | Value | Why |
| --- | --- | --- |
| Hue | 30°–285° | No pure reds, no magentas |
| Saturation | ≤ 0.38 | The whole difference between Zelda-bright and LOTR-muted |
| Lightness | one shared 5-stop curve | Every biome has identical internal contrast |
| Atmosphere | one hue mixed into everything, more at the light end | Aerial perspective, applied globally |

A biome contributes only a hue, a saturation and a lightness *offset*. It never
brings its own curve. That is why a snowfield and a heather moor generated four
hundred tiles apart read as the same illustration.

`lib/art/palette.test.ts` asserts every colour the game can draw sits inside that
box. The thing the original attempt gave up on is a build-breaking assertion here.

## The Dragon Warrior loop

The transcript contains a second, less obvious idea. One speaker credits Dragon
Warrior with teaching him to be a business analyst:

> "you go and talk to this person, and they get a little bit of information, then
> you go talk to the next person and ultimately complete the project."

That is the progression mechanic. For each artifact, three speakers form a chain:

```
speaker 1  →  "it rests on heather moor"            + "ask the ferryman in the Grey Fen"
speaker 2  →  "they went to Woldgard, north of here" + "ask the miner in Dunhollow"
speaker 3  →  "beneath the split oak"
```

Clues are generated *from world state*, so a speaker cannot be wrong, and the
**journal** (`J`) accumulates what you've been told. There are no quest markers
and no map pins: assembling the fragments is the gameplay.

## Correctness properties

Three things are guaranteed by construction and then verified over hundreds of
generated worlds:

1. **Every world is completable.** Forward fill only ever hides a key in ground
   the player can already stand on.
2. **Every clue is true** of the world that produced it.
3. **Every clue is reachable** before the artifact it describes is needed.

```bash
npm test          # 170 tests, including a 500-seed solvability sweep
                  # and a full on-foot playthrough of 5 worlds
npm run lint
npm run build
```

Reachability is computed on **tiles**, never on the region graph. See
`architecture.md` for why that distinction produced real unsolvable worlds.

## Headless previews

The art and world generators run in Node against a small software canvas
(`scripts/canvas-shim.ts`), so you can inspect either without a browser:

```bash
npm run art:preview   -- out.png [sprites.png]   # coherence checkpoint
npm run world:preview -- dunhollow world.png     # island map + close-up
npm run og:image      -- amrath public/og.png    # the social sharing card
```

The social card (`public/og.png`, 1200×630) is itself generated: a real frame of
a real world, drawn by the game's own atlas, titled in a 5×8 pixel font defined
in `lib/art/font.ts`. The renderer scores every candidate window and picks the
best-composed one, so the card shows coast, grass, thicket, rock and snow rather
than whatever happened to be at the origin. Change the palette and the card
changes with it.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / arrows | walk |
| `E` / `Space` | talk, advance dialogue, pick up |
| `J` / `Tab` | journal |
| `Esc` | close |

Progress autosaves to `localStorage` every five seconds. A save stores the seed
plus a few flags — everything else is re-derived, so it stays under 4KB.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Zod, vitest. Canvas 2D
with a pre-baked atlas; no game engine and no runtime art dependencies.
