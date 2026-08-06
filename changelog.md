# Changelog

All notable changes to Open Range are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses semantic versioning.

## [Unreleased]

### Added

- Redesigned the title screen around a one-click Wake up action and a returning
  player's saved journey, with seed selection moved into an optional disclosure
  and an inline warning before a new world replaces the single existing save.
  A terrain-only hero generated from the social card's exact world frame now
  previews the game, while parchment action panels and tested WCAG AA colour
  pairs keep every label and control legible.
- Added generated music: a per-region theme that crossfades as you cross a
  border, over a tonic-and-fifth drone that never stops, plus in-key cues for
  artifact pickups, conversations, the journal, blocked barriers and the ending.
  Every note is a pure function of the world seed, so a shared `?seed=` link
  reproduces the same music as the same island. No audio files, no dependencies:
  notes are composed as data in `lib/audio` and synthesised with Web Audio. Music
  is on by default with a `♪` button, an Options entry and the `M` key, and
  `npm run music:preview` prints a piano roll or renders a `.wav` headlessly.

### Changed

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
  per line, stop/replay controls, a persistent device preference, and controls on
  the title screen, dialogue panel, and a new in-game Options menu. System speech
  keeps dialogue local and requires no provider or API key.
- Added a paused Options modal that preserves an underlying conversation and can
  be opened with the HUD button or `O`.

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
