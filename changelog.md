# Changelog

All notable changes to Open Range are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses semantic versioning.

## [Unreleased]

### Added

- Reissued the social card as the **Town & Country Edition**. The edition name
  sits above the title in the accent, with `Robots, swords, and towns.` beneath
  it, and the two small lines are merged into one so the band grows by exactly
  the one line it gained. The card is still a real frame of a real generated
  world drawn by the game's own atlas, and the landing hero — captured before the
  title band goes on — is unchanged. Adding it needed an `&`, which the in-code
  5×8 font did not have and now does.
- Added the **map**, in two sizes. A small one sits in the top-right corner and
  is a button; clicking it, pressing `M`, or using the new **Map** control opens
  the whole island. Both are painted from the same `visited` bytes the fog of war
  uses, so ground you have not walked is simply absent rather than dimmed — a map
  that told you what was over the next ridge would undo the thing the fog is for.
  Explored ground shows its terrain, its rivers and its scarps; a region prints
  its name at its centre once you have seen enough of it, and a town appears,
  named, once you have been close enough to see it. The robot is the one
  exception and is drawn wherever it is, including out in the dark: it is the
  only thing on the island that moves, and fog hides ground rather than company.
  Opening the map holds the world still, as the journal does. Nothing about it is
  saved — which panel was open is not worth a byte.
- Added **towns**, one in every region, placed at random on that region's open
  ground. Pressing `E` at the gate swaps the island for a small walled-off map
  you walk through, and stepping off any edge of it puts you back on the exact
  spot outside — there is no gate to find again. A town holds some subset of a
  **store**, an **inn**, a **church** and a **pub**, so "one or all or some" is a
  real roll rather than a promise, plus houses and townspeople with things to
  say. The music turns light-hearted inside and crossfades back on the way out,
  using the same collection and the same clock as everywhere else, so a town
  sounds cheerful without sounding like a different game. The buildings drawn in
  a huddle on the island are literally the same atlas cells the town map uses,
  so a spire on the horizon means there is a church to walk to.
  - The **store** sells a sword, a shield and healing potions, and buys back
    anything it sold along with any wood you bring it. The **inn** trades coins
    for a full night. The **church** has a priest with prayers, generated the way
    the passages at the ruins are and cycled so a second visit is a second
    prayer. The **pub** has drinkers to talk to, and nothing to eat or drink.
  - `WORLD_VERSION` moves to 3, which discards saves made before the island had
    settlements on it.
- Added **hit points**, spent by walking. There is still nothing in this world
  that can hurt you: what the meter measures is weariness, so distance is now a
  resource and a bed is worth walking back to. Below a quarter of full you slow
  down; at zero you sit down and wake at the last town you visited — or the shore
  you started on — rested, having lost the walk back and nothing else. Drawn in
  the HUD as countable pips rather than a bar, because a bar reads as a combat
  game's health.
- Added the **sword**, which fells a tree into a stump and leaves you the wood.
  It is the only renewable income in the game and the only thing that changes the
  island rather than your access to it. The sword and the **shield** both show on
  the player sprite once bought, in every facing — the player is baked four times
  over at boot, so buying one changes the sprite on the next frame.
- Added the **robot**, drawn from `assets/robot.png` as hand-authored pixel art
  so it gets four facings and a walk cycle the single illustration could not
  give. One per world, spawned on a seeded tile in any region, and the first
  thing in the game that moves on its own: it wanders its region at half the
  player's pace, never crosses a barrier, and holds still while you talk to it.
  Each conversation hands over a random handful of coins, after which it needs
  thirty seconds before it has more — so the new **coins** count in the HUD
  records where you have been rather than how long you were willing to hold down
  one key. Coins and the robot's position both survive a reload. `WORLD_VERSION`
  moves to 2, which discards saves made before the island had an inhabitant.
- Added a **Fog of war** setting. Ground you have not walked is now hidden
  completely by default rather than dimmed, so the shape of the island can only
  be learned by crossing it; the slider thins the veil for anyone who would
  rather see the coast ahead. The sight boundary stays feathered at every
  setting, because the feather is a fraction of the veil rather than a fixed
  step.
- Redesigned the title screen around a one-click Wake up action and a returning
  player's saved journey, with seed selection moved into an optional disclosure
  and an inline warning before a new world replaces the single existing save.
  A terrain-only hero generated from the social card's exact world frame now
  previews the game beneath a high-contrast title and action gradient, while
  compact parchment text panels and tested WCAG AA colour pairs keep every
  label and control legible.
- Added generated music: a per-region theme that crossfades as you cross a
  border, over a tonic-and-fifth drone that never stops, plus in-key cues for
  artifact pickups, conversations, the journal, blocked barriers and the ending.
  Every note is a pure function of the world seed, so a shared `?seed=` link
  reproduces the same music as the same island. No audio files, no dependencies:
  notes are composed as data in `lib/audio` and synthesised with Web Audio. Music
  is on by default, with a Settings entry and the `M` key, and
  `npm run music:preview` prints a piano roll or renders a `.wav` headlessly. The
  landing CTA primes one shared `AudioContext` inside its click gesture so music
  survives navigation into play; direct game links retry on the first key, touch
  or pointer gesture and visibly explain when browser autoplay is still blocking
  sound.

### Changed

- Music lost its `M` shortcut to the map, which is where that key belongs in this
  genre and is the only screen with no other way in. Muting was never a feature
  of the world, and it still sits in **Settings** behind `O` and the `⚙` button,
  reachable from anywhere including mid-conversation.
- Conversation read-aloud is now on by default, matching music. The voices are
  how the people out here land, so meeting one now sounds like meeting someone;
  anyone who would rather read in quiet can uncheck it on the title screen or in
  Settings, and that choice is remembered on the device. Players who already
  turned it off keep it off.
- Fixed mobile audio on iPhone: Web Audio now selects the playback session so
  Silent Mode does not mute enabled music, and Act/Next taps start character
  narration inside the gesture rather than waiting for a React effect that iOS
  refuses to speak automatically. Replay and desktop narration keep their
  existing behavior.
- Collected every preference into one **Settings** panel, reached from a single
  `⚙` button. It replaces the `♪` button in the lower-right cluster, the
  `Options` button in the top-right HUD, and the `Read aloud` checkbox that used
  to sit in every conversation — the dialogue panel now carries the same `⚙`,
  which layers settings over the line you are reading and returns you to it.
  `Replay`/`Stop` stays in the dialogue panel, since it acts on the current line
  rather than being a setting.
- The three lower-right buttons now share one height, so their top and bottom
  edges line up; `Act` is emphasised by its accent border rather than by
  standing taller. Their keycaps are drawn at full contrast instead of at 66%
  opacity, which at 9px read as unfinished rather than as secondary.
- Raised the touch joystick clear of the browser's bottom toolbar, and lifted
  the drag zone off the bottom edge so a drag that starts there is not claimed
  by an iOS Safari edge gesture. The game shell now sizes to `svh` on touch
  devices, so it never extends underneath the toolbar in the first place.
- A focused form control keeps its own keys: the input layer no longer swallows
  arrow keys and `O` while a slider or text field has focus, which is what let
  the settings sliders be driven from the keyboard.
- The game loop now reports discrete `GameEvent`s — pickups, overlays opening and
  closing, region crossings, refused moves, the ending — through an optional
  `onEvent` callback. They are named for what happened in the world rather than
  for what should be heard, and `lib/game` still imports nothing from `lib/audio`,
  which is what keeps Web Audio out of the headless test suite.
- A refused move is now detected by comparing position rather than per axis, so
  walking straight into a barrier reports it while sliding along one stays silent.
- World generation moved out of the frame effect into a memo keyed on the seed, so
  the audio layer can read the region list and a generation failure becomes a
  render-time value instead of a `setState` from inside an effect.

- Added opt-in, on-device read-aloud for NPC dialogue, with automatic narration
  per line, stop/replay controls in the dialogue panel, a persistent device
  preference, and the setting itself offered on the title screen and in Settings.
  System speech keeps dialogue local and requires no provider or API key.
- Added a paused Settings modal that preserves an underlying conversation and can
  be opened with the `⚙` button or `O`.

- Added a generated social sharing card (`public/og.png`, 1200×630) plus Open Graph
  and Twitter metadata with an absolute `metadataBase`. The card is a real frame of
  a real generated world drawn by the game's own atlas, not a mockup, so it tracks
  any change to the palette. Its renderer scores every candidate window for biome
  balance and for clutter behind the type, because simply counting distinct terrains
  selected a frame that was 40% sand with a cliff band straight through the title.
- Added a 5×8 pixel font defined in code (`lib/art/font.ts`), so the card can be
  titled without introducing a font file or a rasteriser to a project that ships no
  binary assets.
- Added alpha blending and `rgb()`/`rgba()` parsing to the software canvas shim,
  which the card's scrim needs and which also lets the shim reproduce the game's
  fog of war.

- Added a constrained palette (`lib/art/palette.ts`) that confines every colour in
  the game to one hue arc, one saturation ceiling and one shared lightness curve,
  with a single atmosphere hue mixed into all of it. Biomes contribute a hue, a
  saturation and a lightness offset only, which makes an off-style tile impossible
  to produce rather than merely unlikely.
- Added optional per-biome accent hues, so a moor is olive-brown ground with
  purple heather flecks instead of purple ground.
- Added procedural terrain painters for eleven tile kinds, with flat interiors,
  sparse marks, six hash-selected variants each, and dithered directional edge
  bands drawn in the neighbouring biome's ramp.
- Added procedural characters, artifacts, landmarks and props, with a shared 1px
  outline post-pass so every sprite carries identical line weight.
- Added a single baked atlas (`lib/art/atlas.ts`); after boot the render loop does
  nothing but blit.
- Added seeded world generation: three noise fields into a Whittaker biome lookup,
  a noise-warped radial island, largest-component mainland selection, geodesic
  Voronoi regions, landmarks, props, and a syllable-grammar name generator for
  regions, artifacts and people.
- Added full-border barrier painting with three barrier terrains, batch-ordered
  gating, and forward-fill artifact placement that is solvable by construction.
- Added three-link NPC hint chains generated from world state — terrain, then
  region and direction, then landmark — with referrals naming the next speaker's
  real role and real region.
- Added the game runtime: fixed 60Hz simulation, per-axis tile collision, camera
  clamping and culling, y-sorted entity drawing, feathered fog of war, and contact
  shadows under characters.
- Added the React chrome — HUD, one-line-at-a-time dialogue, and a journal that
  groups clues by artifact and orders them vague to specific.
- Added Zod-validated versioned `localStorage` saves with a run-length-encoded
  visited bitmap, kept under 4KB by re-deriving everything else from the seed.
- Added a title screen with seed entry and resume, and `?seed=` sharing.
- Added `/atlas`, a debug route showing every drawable and all 55 biome pairs — the
  coherence checkpoint the project's premise rests on.
- Added headless preview renderers (`npm run art:preview`, `npm run world:preview`)
  backed by a small software Canvas2D, so both generators can be inspected without
  a browser.
- Added 170 tests: palette-constraint enforcement, a 500-seed solvability sweep
  driven by an independent tile walk, hint truthfulness and reachability, save
  round-tripping, and a full on-foot playthrough of five worlds through the real
  loop.

### Fixed

- Fixed a type error in `playthrough.test.ts` where assigning `state.dialog = null`
  narrowed the field for the rest of the scope, so every later read of it resolved
  to `never`. `npm test` and `npm run lint` both passed; only `tsc --noEmit` saw it.
- Fixed `makeRng` reducing cyrb128's four words with `a ^ b ^ c ^ d`. Those words
  are constructed so that expression is identically zero for every input, so every
  seed produced the same world. The "same seed is reproducible" test passed
  precisely because everything was identical.
- Fixed artifact placement using region-graph reachability, which overstated what
  the player could walk to: painting a border two tiles deep on both sides can cut
  a narrow region's interior into disconnected pockets, and a key placed in the
  wrong pocket made a world unsolvable. All placement now uses tile-level flood
  fill.
- Fixed progression tiers assigned from breadth-first depth, which collapsed to one
  or two tiers because seven regions form a dense planar graph. Tiers now come from
  breadth-first order, which always yields three.
- Fixed barrier kinds taken from the shallower of two regions, which left a back
  door into deep regions guarded by the first artifact.
- Fixed the `speckle` helper thresholding the product of two uniform variables, so
  a requested density of 0.5 painted roughly 48% of a tile and turned every biome
  into television static.
- Fixed the temperature gradient running warm-to-cold southward while the snow
  threshold sat above the 97th percentile of relief, which together left snow on
  1% of land. Snow now follows altitude with latitude lowering the snowline.
- Fixed elevation being shaped by the island falloff before the biome lookup, which
  compressed it so far that highland barely appeared and five of seven regions came
  out as meadow. Land-versus-sea and land height now use separately shaped values.
- Fixed the summit landmark being built widest-row-first from the top, producing a
  downward wedge instead of a mountain.
- Fixed cliff tiles reading as wooden planks (full-width horizontal highlights) and
  then as a picket fence (evenly spaced vertical fissures); they are now irregular
  stacked ledges.
- Fixed bramble reading as chain-link fencing, by mixing stroke slopes instead of
  drawing every stroke at 45°.
- Fixed landmarks borrowing a blue-cast `metal` colour, which made cairns and
  standing stones look like marble rather than weathered rock.
- Fixed characters whose trousers, hair and cloak were all mid-tone browns, leaving
  no silhouette inside the outline.
- Fixed fog of war drawn at a single alpha per tile, which produced hard 16px
  rectangles along the sight boundary; it is now feathered by seen-neighbour count.
- Fixed the sprite scratch surface not setting `willReadFrequently`, stalling the
  pipeline on several hundred `getImageData` calls per bake.
- Fixed `eslint.config.mjs` routing eslint-config-next 16 through `FlatCompat`,
  which threw a circular-JSON error; it ships flat config directly.
- Fixed the initial HUD snapshot being published synchronously from an effect body,
  causing a cascading render on mount. It is now published from the first
  animation frame.
