# Open Range

A top-down 2D exploration game in the browser. Every tile, character, landmark
and place name is generated in code from one constrained palette. **The game
loads no image or font assets at all** — the entire texture atlas is drawn at
boot, in roughly 25ms in a browser. `/atlas` reports the figure for your machine.

You wake on a shore. Three artifacts are hidden on the island, each opening
ground the previous one could not reach. Nothing marks your map — but the people
you meet each know a piece of it, and most of them know who knows the rest.

**Play:** https://open-range-sigma.vercel.app

```bash
npm install
npm run dev
```

- `/` — title screen and seed entry
- `/play?seed=dunhollow` — the game; any seed grows the same island for everyone
- `/atlas` — the art pipeline, every drawable on one page, plus all 55 biome pairs

`/atlas` is the checkpoint the whole premise rests on. If the terrain there does not
read as one illustration, nothing downstream is worth building.

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

To be precise about "no assets": exactly two files in the repo are images, and
neither is used by the game. `app/icon.svg` is the favicon, hand-written markup;
`public/og.png` is the social card, itself generated. Both exist only for clients —
a browser tab, a link crawler — that cannot run the generator themselves.

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
npm test          # 177 tests, including a 500-seed solvability sweep
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

The social card (`public/og.png`, 1200×630) is itself generated: a real frame of a
real world, drawn by the game's own atlas, titled in a 5×8 pixel font defined in
`lib/art/font.ts`. The renderer scores every candidate window and crops the
best-composed one, so the card shows coast, grass, thicket, rock and snow rather
than whatever happened to sit at the origin.

> **The card does not regenerate itself.** It is a committed file. Change the
> palette or world generation and the card will keep showing the old art while the
> game shows the new — re-run `npm run og:image` and commit the result as part of
> that change.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / arrows | walk |
| `E` / `Space` | talk, advance dialogue, pick up |
| `J` / `Tab` | journal |
| `O` | options |
| `Esc` | close |

Desktop players can also use the persistent **Act** and **Journal** buttons in
the lower-right corner. Act highlights and names the speaker when someone is
close enough to talk.

On touch devices, drag the floating control on the lower left to walk. Use
**Act** to talk or interact and **Journal** to review clues. Dialogue and journal
panels provide their own buttons. Mobile instructions can be dismissed and
reopened with the **?** button. Both portrait and landscape layouts are supported.

Conversation read-aloud is available from the title screen, the in-game Options
menu, and each dialogue panel. It is off by default and remembered on the device.
When enabled, each new NPC line is spoken automatically and can be stopped or
replayed; names, roles, journal entries, and other game text remain silent. Speech
uses the browser and operating system voice, so dialogue is not sent to an AI
provider and no API key is required.

Progress autosaves to `localStorage` every five seconds. A save stores the seed
plus a few flags — everything else is re-derived, so it stays under 4KB.

## Deploying

The project is linked to Vercel with the GitHub integration active, so **pushing to
`main` is the whole deploy step.** Running `vercel --prod` as well just builds the
same commit twice.

Vercel answers on several auto-generated domains, all of which follow production on
their own:

| Domain | |
| --- | --- |
| `open-range-sigma.vercel.app` | the project production domain — **use this one** |
| `open-range-erichstauffer-erichstauffer.vercel.app` | auto-generated twin |
| `open-range-git-main-erichstauffer.vercel.app` | tracks the `main` branch |

Prefer the first. `metadataBase` resolves to it, so every domain emits the same
absolute `og:image` and `og:url` and previews collapse to one identity regardless of
which URL was shared.

Two things that had to be true for the card to work, both already set:

- **Deployment Protection off.** Vercel Authentication returns a `302` to an SSO
  login for every request, including from crawlers, so a protected deployment shows
  no preview anywhere. Check with `vercel project protection`; `ssoProtection` should
  be `null`.
- **An absolute `og:image`.** Crawlers do not resolve relative URLs, which is what
  `metadataBase` in `app/layout.tsx` is for.

Verify a deployment end to end with:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -A 'Twitterbot/1.0' https://open-range-sigma.vercel.app/og.png
```

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Zod, vitest. Canvas 2D
with a pre-baked atlas; no game engine, no art or font dependencies, and no runtime
image loading.
