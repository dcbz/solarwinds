# Solar Winds — web port

**TypeScript.** Build once, then serve:

```sh
cd web && npm install && npm run build     # tsc -> web/dist/  (0 errors, strict)
python3 -m http.server 8000                # from the repo root
# http://localhost:8000/web/               -> the ported state machine (src/main.ts)
# http://localhost:8000/web/?gallery=1     -> the phase-1 asset browser (src/app.ts)
npm run check                              # 100 assertions, node type-strips web/src/*.ts
npm run check:dist                         # the same 100 against emitted web/dist/*.js
```

`tsc` runs with `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so sources import
`./x.ts` and the emitted ES modules import `./x.js` — no bundler, still loads straight from disk.

Before that it was: Phase 1: the renderer. Runs with **no build step and no dependencies** — the browser
decodes the original 1993 `.DAT` files in place.

```bash
cd /Users/unlink/code/solarwinds
python3 -m http.server 8000      # or any static server
# open http://localhost:8000/web/
```

Keys: `←/→` cycle screens · `1`–`9`/`0` jump · `A` toggles the zone frame-alternate shimmer.

## Layout

| file | role |
|---|---|
| `src/rle.ts` | both RLE variants + whole-file and seek-walked record shapes |
| `src/framebuffer.ts` | the `A000:0000` model: 64000-byte `Uint8Array`, 256-entry palette LUT, blt/composite |
| `src/main.ts` | the browser entry point: canvas, palette upload, DOM input -> event codes, one `advance()` per input |
| `src/engine/loop.ts` | the ported state machine: INT 9 handler, event pump, epilogue, dispatch, the four mode handlers' arm tables |
| `src/engine/state.ts` | the 17,831-byte `BH_START.DAT` image, round-trip exact, with the fields `re/` names |
| `src/engine/screens.ts` | resource loaders: name table, picture records, `BH_CONV` script data |
| `src/engine/vm.ts` | the modal conversation VM: CONV graph, 64-byte save slots, effects, and PEOP portraits |
| `src/engine/text.ts` | raw BH_CHAR 8x8 indexed glyph renderer and EXE proportional-width table |
| `src/engine/conversation.ts` | exact shaded two-pane modal geometry and animated portraits |
| `src/engine/startup.ts` | exact EPIC/title copy stages and the timed BH_SEQ opening story |
| `src/engine/player.ts` | BH_MS player craft, heading and executable-defined viewport anchor |
| `src/engine/world.ts` | PAGE cockpit, sector-culled BH_PLAN/BH_SHIP/BH_MIS sprites and visible-object table |
| `src/engine/starfield.ts` | transient 20-star flight backdrop, EXE RNG/shape tables and camera-relative movement |
| `src/engine/coordinates.ts` | exact signed cockpit sector readout used by the opening rendezvous |
| `src/engine/combat.ts` | player/hostile projectile slots, trajectory tables, shield/hull collision and expiry |
| `src/engine/bearing.ts` | exact integer 32-way bearing thresholds and branch-exact one-step turns |
| `src/engine/enemies.ts` | hostile AI dispatch, pursuit, waypoint recovery, movement, firing and destruction |
| `src/engine/death.ts` | six-frame BH_EXPL player destruction sequence and phase state |
| `src/engine/menu.ts` | F1/Escape disk menu; exact raw state-blob save/load |
| `src/app.ts` | the phase-1 asset browser, reachable at `?gallery=1` |
| `tools/render_check.mjs` | headless proof of the decode+palette path; writes PNGs to `tools/out/` |
| `tools/integration_check.mjs` | 100 assertions against `src/*.ts`; `tools/check_dist.mjs` repeats them against `dist/*.js` |
| `tools/startupshot.mjs` | visual checkpoints for EPIC, staged title, ship/story intro and live cockpit |
| `data/` | copies of the shipped `BH_*.DAT` (never edit the repo-root originals) |

## Why it looks like this (all reverse-engineered, see `../re/`)

- **320x200x8bpp, framebuffer at `A000:0000`** — static: `mov ax,0xa000` + `rep movsw` with
  `cx=0xfa00`; runtime: DOSBox logs `graphics mode 13h at 70.086 Hz` 0.5 s after boot.
  Offset math is kept identical (`y*320 + x`) so engine primitives can be transcribed directly.
- **Two RLE variants**, one byte apart in the exit test. `stone` (`80 fd ff`) emits `n` copies;
  `wind` (`80 fd 00`) emits `n-1`, with `FF 00 v` wrapping to 255. Correct pairing yields exactly
  **64,001** bytes per frame file — 64,000 plus the engine's own one-byte over-read, which its
  64,000-byte copy discards. `decodeFrame` drops it.
- **Palettes** are 768 B of 8-bit RGB, and the game halves each component twice to feed the 6-bit
  DAC, so `framebuffer.loadPalette` reproduces that `(v>>2)<<2` rounding.
- **Per-zone palette switching is mandatory**: zone art is authored against `BH_MP1/2/3`, not
  `BH_PAL`. Using the wrong table produces legible-but-noise output — that was the single biggest
  visual red herring in the RE phase.
- **The dispatch key is a byte in the save file.** `DS:0x13c91` is read from `BH_START.DAT`
  (`initialState()` seeds it to 1, the state-1 handler `0x2e6e9`) and four `cmp ax,imm16` chains
  select `0x2e6e9 / 0x2e9e9 / 0x2ea8d / 0x2eb8c`. Nothing about the mode is guessed.
- **The value a handler compares is a raw set-1 scancode**, `mov al,cs:[0x42]` @0x24372, latched by
  the ISR's `in al,0x60` @0x23c9c — not INT 16h ASCII. `re/game-loop-modes.md` §C.7 works out which
  arms still only make sense as ASCII, and those rows are labelled rather than invented.
- Because of that, the keys are bare: `a` map-view, `w` ships, `e` crew, `Escape` back out of a
  sub-screen, `-`/`=` page the record list, `t`/`u` the two record pagers, the top row
  `r t y u i o p [` spend one action point into a subsystem and the home row
  `f g h j k l ; '` free one back (FUN_231e_67b7 @0x29997), `z` steps the level counter, and
  `F2` then `F9` opens the cheat gate that `F10` then writes through. No modifier combination is a
  binding in this game.

## Verified

- `node web/tools/render_check.mjs BH_MW1A.DAT` → its JS decoder is **byte-identical** to the Python
  reference across all 64,000 pixels. `MW1A/MW1B`, `MW2A/MW2B`, `TITLE`, `EPIC`, `ORD`, `WR`, `SEQ`
  render correctly; `BH_MW1A_A_00.png` in `../re/work/pics/` is the Solar System room.
- `node web/tools/integration_check.mjs` → **133/133**, with the same count against emitted
  JavaScript through `check_dist.mjs`. `tsc` under `strict` → 0 errors.
- **The campaign director `FUN_231e_a592 @0x2d772` is transcribed** (`web/src/engine/rewards.ts`).
  After every conversation it scans the control-slot region `DS:0x35e1` for a deferred trigger
  (a byte in `0x64..0xfe` the VM's effect cascade stored, invisible as a choice), applies the first
  one, clears it, and returns — exactly the EXE's one-reward-per-call shape. The 20 branches grant
  cargo (`*(0x3c56 + 0x3c7a)` type codes 1/2/3/5/6/8/0xc/0xd), refill missile banks
  (`word[0x359b]/[0x35a1] += n`), grow the crew/AP budget (`word[0x3c5c] += 200`), move the camera
  (`DS:0x3d2..0x3d7`), and set the quest words `DS:0x3ab5..0x3acf` that `m` reads. Six checks prove
  each, including an end-to-end one: a real shipped conversation choice leaves a trigger that then
  mutates the world.
- **The task list, help menu and target cursor are live** (`web/src/engine/textscreen.ts`,
  wired from `loop.ts runCalls`): `m` prints active tasks from the same quest-word array, `/`
  is the two-level MAIN HELP MENU (topics at `DS:0x83ae`, pages gated on `DS:0x3ade`), `d` walks the
  visible table to the next class<5 actor and stores it in `DS:0x3ae1`.
- **Against the real game's own video memory.** `node web/tools/faithful_diff.mjs
  ../re/dosbox/captures/image0001-raw.png tools/out/startup_title_stage0.png` → **89.98 % of pixels
  identical, 100 % within 4/255, mean channel error 0.10**. The control that makes that number
  meaningful: two *real* frames 0.7 s apart differ by 5,888 px / mean 2.45, so the residue is the
  title screen's own fade phase rather than a decode, palette or geometry error. Captures come from
  `../re/dosbox/rawshot.sh` (DOSBox F7 = raw framebuffer PNG, no scaling or shader).
- **`npm run check:browser`** boots `main.ts` under a stubbed DOM exactly as the page does, drives
  the virtual PIT clock, and fails unless the engine presents **≥ 20 distinct frames** (81 observed
  in 400 passes). This is the regression guard against the port silently decaying back into a
  gallery.
- `BH_START.DAT` round-trips byte-identical through `engine/state.ts`.
- **The page compositor @0x2b04d is ported and pixel-verified.** `engine/pages.ts` transcribes it and
  the art is `BH_PAN.DAT`: the record the walk lands on is `mode - 2`, so mode 2 paints the
  ENGINEERING panel, mode 3 CARGO and mode 4 WEAPONS, each 91×135 at column 228 row 65 plus the
  93×65 record-4 overlay at `A000:0xe3`, with the 0x8f border down column 227. `Escape` runs page 1,
  which restores the 94-column strip from the page buffer and erases the panel. Proof: five checks in
  section 9, `tools/panshot.mjs`, and canvas hashes in `tools/domprobe.mjs`
  (boot `323eeaa29d02` → mode 3 `da31c05b9f1d` → Escape `323eeaa29d02`, byte-exact).
- In the browser: boot shows the EPIC logo, staged STONE/SOLAR WINDS title, and the BH_SEQ ship/story
  intro before PAGE.DAT; `e`/`a`/`w` move the mode global to 2/3/4 *and repaint the canvas*; inside
  mode 3, `-`/`=` page the record cursor with the real wrap; `Escape`
  writes mode 1 back from the handler that owns it. `n` (make 0x31) is what opens the four digit
  arms, which are presence-table cursor movers (@0x2e885..@0x2e977).

## Play it

- The title waits for a key before starting the opening story. A key during the story skips to the
  cockpit, matching the executable's INT 16h branches.
- Arrow keys navigate the actor field.
- The opening transmission says to meet at sector **-31,1**. The two yellow numbers at the top of
  the cockpit are the original `FUN_231e_81e8` sector readout (fresh start: **-28,7**). The ship
  starts facing toward the rendezvous; brake with Space, steer, and press `C` when CLAW appears.
- Ctrl fires the selected weapon. Hostile ships activate, steer, pursue, return fire, lose their
  four shield facings and hull, and run the original explosion/removal sequence. Weapon 4 homes
  with the original six-pass cadence. Player hull depletion plays the real BH_EXPL destruction.
- `S` scans the objects currently rendered in the viewport; `C` communicates with the nearest
  scripted ship. Conversation choices use `1`–`9`; Escape selects END COMMUNICATION. A reply longer
  than one ten-row pane **pages** rather than truncating (`FUN_231e_2cf5` @0x25f5c
  `cmp byte ptr [0x70a5],0xa`, then the @0x25f64 key/mouse wait): any key or click turns the page and
  the choices only appear on the last one.
- `A`, `W`, and `E` open cargo, weapons, and engineering panels.
- Engineering is live: `R/T/Y/U/I/O/P/[` assign available AP to systems 1–8 and
  `F/G/H/J/K/L/;/'` return points to the pool. The upper/lower panel rows are clickable too
  (`FUN_231e_69f6` @0x29bd6 decodes the INT 33h coordinate pair to a stat +/− box). Selecting a crew
  member blits the BH_SML 8×8 station marker (`FUN_231e_7fc0` @0x2b1a0, dest from `DS:0x35d3`).
- Weapons are live: `1–5` and `R–I` select an owned pulse bank; selecting it again cycles power.
  `F–K`, `V/B/N/M/,` select missile banks with ammunition. Ctrl fires the selected missile. The
  power-lamp grid is transcribed from `FUN_231e_93f9`/`9466` (@0x2c5d9/@0x2c646) at the `DS:0x3587`
  pulse cells: lit levels stay `0x86`, unlit go `0x34` with a `0x32` centre tick.
- Cargo is live when story state supplies items: `-`/`=` change the selected row, `T` uses it and
  `U` transports/installs it. The arrow and action areas use the original mouse hit boxes.
- F1 or Escape opens DISK OPTIONS. Save and load use the original exact 17,831-byte state image,
  persisted as browser local storage slot 1.
- `m` opens **TASKS TO COMPLETE** (`FUN_231e_3a81 @0x26c61`): it walks the quest-word array
  `DS:0x3ab5 + i*2` and prints the parallel task string from the `DS:0x4a34` table for each non-zero
  word, ending on the `0xffff` sentinel. The same words the campaign director writes, so a
  conversation that grants a mission immediately shows it here.
- `/` opens **MAIN HELP MENU** (@0x2ddc0): the seven topic labels at `DS:0x83ae` are a selector
  (`FUN_231e_5133`, AL=7); picking 1–6 shows that topic's page string (`cmp al,N` chain @0x2dde4…),
  and a key returns to the list; option 7 or Escape leaves. The Control-Panel page is chosen by the
  `DS:0x3ade` gate (@0x2de46).
- `d` advances the tracking cursor `DS:0x3ae1` to the next visible actor whose record byte +0xb is
  below 5 (@0x2e9ad); with nothing trackable it prints "NOTHING TO TRACK" (`DS:0x49a3`).

## Known-open (do not trust these yet)

1. **Some panel-specific art writers remain approximate.** The engineering readout is now the real
   primitive — `engine/bars.ts` transcribes `FUN_231e_8043` @0x2b223, which paints the eight
   subsystem bars into `A000` directly (foot at col 239 row 128, seven pixels wide, nine apart, up to
   37 units per column then a darker second column; see `tools/bars_check.mjs`). It replaced a
   seven-line text stack at col 230 row 3 that sat in the *top* box, 90 rows above the art it
   described. Cargo page state and weapon selection/power/ammo are still shown as text, and the
   crew/weapon-bank markers and the power-lamp grid come from `FUN_231e_7fc0` and
   `FUN_231e_93f9`/`9466`. What is still text rather than the original primitive: the missile
   **ammo pips** (`FUN_231e_9127` @0x2c307 stages into `0xa74f` — its final blit site is not quoted)
   and the **cargo list** item names (the `0x35d3` nameWrite rows decode to bitmaps only for the crew
   stations; per-item name bitmaps live in an arena table no shipped `.DAT` maps to yet).
   Side note on the same routine: `DS:[0x6bb3]` is treated as a constant. The compositor reads its
   destination from there (@0x2b0a2, @0x2b0c1) and the value 0x5224 sits in the EXE's data segment,
   but no writer is quoted, so an indexed store into that word cannot be excluded:
   `TODO_FIELDWRITER@0x6bb3`.
2. **Zone 3 / `MW2P` are composited wrong.** Multi-record or partial-plane files (41,903 / 38,979 /
   15,613 bytes decoded, never a full frame). The `<u16 len>` record framing in `decodeRecords` is a
   **guess** — `0x2a84c` tells us records exist, not how they are headed.
3. **Variant/loader discrepancy for the screens.** `TITLE`/`EPIC`/`SEQ`/`ORD`/`WR` are opened by
   `FUN_231e_c4cf`, yet they only reach 64,001 under `wind`, while the `0x24ff4` picture loader
   carries the `stone` loop. Either the dispatcher has its own loop or `0x24ff4` serves a different
   file class. Config uses what *works*; the code path is unconfirmed.
4. **Palette cycling.** The dithered/noisy regions in `TITLE` are probably an animated palette (the
   game XOR-swaps pixel pairs at `0x2a06f` for shimmer). Static tables are used here. Now with
   runtime support: consecutive real VRAM grabs (`image0001` vs `image0002`, 0.7 s apart) differ on
   9.2 % of pixels by a uniform −2/−3/−4 — a fade/dither stepping through palette entries, which is
   what the port is missing on exactly those pixels.
5. **Combat has one bounded adaptation.** `FUN_231e_30c9` is now a literal integer transcription,
   including its threshold boundaries and asymmetric opposite-heading tie; state-10 waypoint
   recovery and weapon-4 homing are also ported. Hostile impacts still choose the same four
   persisted shield pools by relative bearing because the DOS pixel-collision colour map is not
   available to the canvas renderer.
6. The `,` key raises `DS:0x13572` to 1 which silences the pump (`TODO_GATHERERS`), and audio
   (`BH_MU*.DAT` CTMF containers + Sound Blaster DSP) is entirely undocumented.

## Extending it

Add a screen = one line in `SCREENS` in `src/app.ts`. Everything else is data-driven off the
original files, which is deliberate: the shareware build is missing episodes (`BH_INT2..11`,
`BH_WIN`), so new content should be authored as `.DAT`-shaped data, not baked into code.

New *behaviour* has one rule: cite an address, or write a `TODO_*`. `loop.ts` is a table of arms
keyed by `@0x...` sites and the checks assert both the action and its provenance — an arm with no
site is rejected the same way an invented mechanic was.

## Handler evidence in the engine (Appendix C of `re/game-loop-modes.md`)

States 2, 3 and 4 are no longer stubs. Their arms came from a capstone pass over the handler
interiors (`python3 re/work/x86.py 0x2e9e9 0x2ea8d` etc.), and `loop.ts` executes them:

| mode | handler | what a key does there |
|---|---|---|
| 1 | `0x2e6e9` | `A`/`W`/`E` -> modes 3/4/2 (`0x2e6ef`, `0x2e705`, `0x2e722`), number keys, `,` steps the gatherer |
| 2 | `0x2e9e9` | `1`..`8` pick a crew member out of the presence table DS:0x135af (`0x2ea2a`), write DS:0x13c4a (`0x2ea4a`), then the rebuild pair + the two `0x2a1c0` name writes; anything else hits the sink at `0x2ea87` |
| 3 | `0x2eb8c` | `=` pages forward and `-` pages back through DS:0x13c8e, wrapped against the record count DS:0x13c56 (`0x2ebd5`/`0x2ebe5`, `0x2ebfd`/`0x2ec09`); `t`/`u` call the pagers at `0x2ec35`/`0x2ed2b` |
| 4 | `0x2ea8d` | two 10-entry table walks (`0x2eac9`, `0x2eb3d`). DS:0x5b90 is initialized EXE data containing `02 03 04 05 06 13 14 15 16 17` (`1–5`, `R–I`); DS:0x5ba4 contains `21 22 23 24 25 2f 30 31 32 33` (`F–K`, `V/B/N/M/,`). Presence/ammo words gate each entry; the selected bytes and pulse-power cycle are persisted in DS:0x3c4b/0x3c4c/0x3c94. |

In all three, `Escape` writes mode 1 and blits the scratch page through `0x2b04d` — the same callee
state 1's mode writes use. That page turned out to be **BH_PAN.DAT**, and `src/engine/pages.ts` now
composites it: mode N paints pan[N−2] at col 228 row 65 plus the 93x65 record-4 box, and stamps the
0x8f border down col 227 (`@0x2b0ae`, dest from `DS:[0x6bb3]`).

On top of that, `a`/`w`/`e` are only the panels. **`c` and `s` are the game**: modal subroutines with
their own INT 9 handler, and the only callers of the three zone cutscene loaders. `src/engine/script.ts`
reads the ship table (DS:0x128f — CLAW, ROC, BATROK…) and star table (DS:0x1e5b — ENIGMA, INGMAR,
GLOBAN…) straight out of the EXE's data segment, resolves the `0x500` selector, indexes BH_CONV.DAT's
15 scripts, and `src/engine/zones.ts` plays the cutscenes: full-screen BH_MW1A/MW1B with a tear
effect, MW2A→MW2B, and MW3A/MW3B planet records. `node web/tools/zoneshot.mjs` writes the frames as
PNGs. The loop is clocked by PIT counter 2 spinning 0x7918 counts — 25.98 ms a pass, 38.49 Hz — not
by a timer interrupt (`src/engine/clock.ts`, `re/script-engine.md` §5).

What is still missing to call it a game: text —
the planet descriptions `s` resolves are shown in the status line rather than drawn, because
`BH_CHAR.DAT`'s glyphs and `FUN_231e_8bdc` @0x2b892 are not ported yet.

## Tools

* `node web/tools/integration_check.mjs` — the full source suite (120 checks, run from the repo root).
* `node web/tools/check_dist.mjs` — the same suite against the compiled `web/dist` output.
* `npm run check:browser` — boots `main.ts` through its real browser route under a stub DOM and
  asserts the canvas receives many distinct frames (`tools/browser_smoke.mjs`).
* `node web/tools/faithful_diff.mjs real.png ours.png [diff.png]` — pixel diff of a real VRAM grab
  against a port render; `node web/tools/pngstats.mjs *.png` — dependency-free coverage and
  row-profile metrics (used because the agent driving this has no image input).
* `../re/dosbox/rawshot.sh walk 34 6: 12:ENTER 18:n` — script the real game and capture its raw
  320x200 framebuffer at chosen moments (F7 = `hand_rawshot`).
* `node web/tools/worldshot.mjs` — parks the camera on an actor and proves the sprite walk paints.
  BH_PLAN planets, all seven 32-heading BH_SHIP banks, BH_MS and BH_MIS are live.
* `node web/tools/zoneshot.mjs`, `render_check.mjs` — zone cutscenes and the RLE decoders.
