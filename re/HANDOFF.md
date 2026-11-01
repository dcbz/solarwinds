# Handoff — resume in a fresh session, then fan out

Read first: `re/FINDINGS.md` (ledger, Evidence IDs), `re/loader_map.md` (loader→file map),
`re/name_table.json`, `re/procedures.txt`. Corpus: `re/decomp/SOLAR1.c` = all 179 procedures'
Ghidra pseudocode (from `batch_decompile` `ev_9c2cc709bcdf5464…`) — grep this instead of re-calling
REA. Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.

## Harness facts (already solved, do not redo)
- REA MCP is registered durably: `~/.pi/agent/extensions/rea-mcp.js` + `<agent-dir>/mcp.json`, with
  `GHIDRA_INSTALL_DIR=/Users/unlink/tools/ghidra_12.1.4_PUBLIC`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21`,
  `REA_ANALYSIS_PROVIDER=ghidra`. 28 core tools are `direct`, the rest `deferred` (tool_search).
- `/usr/bin/java` is a broken stub — anything spawning Ghidra needs `JAVA_HOME`.
- DOSBox Staging 0.83.0 at `/Applications/DOSBox Staging.app`. REA has no DOSBox provider: runtime
  evidence = emulator captures (screenshots, `mixer record` WAVs, conf logs) fed back as
  `controlled-replay` authority.
- **Context discipline:** `search_bytes` and `procedure_assembly` return ~5-25k tokens each. Use the
  local corpus for orientation; call REA only for the claim you need to cite. One `batch_decompile`
  of many addresses costs one (truncated) reply and the full text lands in a temp file — that pattern
  worked well.

## Known-good facts to build on
320×200×8bpp (INT 33h ranges 0..638 × 0..200 from `0x24ff4`, `ev_c1259400cf6f6c98…`); RLE =
literal bytes, `FF n v` → n copies of v, `FF 00 xx` → literal 0xFF; palettes are raw 256×3 8-bit
(768 B); a savegame is a verbatim copy of the 17,831-byte `BH_START.DAT` state blob
(`HSAV01.DAT` byte-identical); `$`-delimited name table + `$`-delimited command scripts; three map
zones each with own palette; `BH_MU*` are `CTMF` containers; `CATALOG.EXE` is LZEXE 0.91.

## Fan-out lanes (independent — one writer per output file, no shared edits)
1. **Picture framing.** Q: how do MW*/SEQ*/TITLE/EPIC/ORD/WR/PAN/PEOP/OBJ/PLAN files frame one or
   more 64,000-byte RLE images? Decoded lengths run 64.2k–70.9k (see FINDINGS). Method:
   `procedure_assembly` on the loaders in `re/loader_map.md`, find each file's destination segment +
   length; confirm with `read_bytes`. Write `re/formats-pictures.md`. Done when a Python decoder
   emits a PNG that visually matches a DOSBox screenshot.
2. **CTMF container** (`BH_MU1..13`). Find its parser (grep corpus for `0x4654`/CTMF handling or the
   `MU` index arithmetic in `0x29f90`/`0x2a362`/`0x2a786`), document chunk layout, decode one to
   JSON. Write `re/formats-ctmf.md`.
3. **Video path.** Which port/segment writes the framebuffer, `INT 10h` modes used (11 sites),
   palette programming (`0x3c8/0x3c9` vs AX=1012h), `BH_SHD` shading-table role, screen-clear/flip.
   Write `re/engine-video.md`. Cross-check with lane 1's DOSBox screenshots.
4. **Audio.** Sound Blaster reset/DSP sequence, how `BH_MS`/`BH_VFD`/`BH_SML` are consumed, music
   timing, and what `/NOSB` disables. Write `re/engine-audio.md`. Validate by `mixer record`.
5. **Input + main loop + timing.** INT 16h (48 sites) / INT 33h (108) semantics, joystick port
   `0x201`, the frame-pacing source (INT 1Ah timer? PIT?), and the top-level state machine
   (start → map → encounter → conversation → war report). Write `re/engine-loop.md`.
6. **Game state.** Map the 17,831-byte blob: create several saves in DOSBox (or patch `HSAV01.DAT`),
   diff, and correlate with `CONFIG.DAT` (43 B, tag `CONFIG DATA`) and `SAVLST.DAT` (10×24 B).
   Write `re/state-format.md` + `re/tools/state_probe.py`.
7. **Script VM.** The `$`-delimited command records after images (`0x25240–0x2538f`): opcode set,
   the `<0x64` resource selectors, `0x01`/`0x02`/`0xFF` markers. Write `re/script-vm.md`.
8. **Runtime capture harness.** Own `re/dosbox/` only: a `solar.conf` (320x200, `captures=dir`,
   `[sdl] output=sdl2`, `autolock`, `mixer record`), a scripted run to the title and one map, and the
   resulting PNG/WAV set. Everything else cites it.

## Then: the port
`web/` TypeScript + Vite. Renderer first (it is fully specified already): `Uint8ClampedArray`
320×200 + palette LUT → Canvas2D `putImageData`, integer-scaled, `requestAnimationFrame` paced by the
lane-5 timing constant; WebAudio for SB digitized + music; gamepad/keyboard/pointer; content packs
from the lane 1-2 extractors; saves as the state blob in IndexedDB (keep the original layout so DOS
saves load). Lanes 3-7 feed `web/src/` modules 1:1.

## NEXT SESSION — port the engine INLINE (no background lanes)
Context is the binding constraint: 12 subagent lanes all timed out and produced zero files.
Do this in the main session, one file per turn, verifying each with `node --check`.

Target is open in REA: SOLAR1.EXE, dos-mz x86, sha256 7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df.

Order (each cites addresses; invent nothing — unconfirmed opcodes stay named TODOs):
1. web/src/engine/vm.js      <- re/script-vm.md (interpreter 0x25240-0x2538f; dispatch, opcode->handler)
2. web/src/engine/state.js   <- re/state-format.md (17,831B blob = BH_START.DAT; NOTE file = DS + 0xF90)
3. web/src/engine/screens.js <- re/loader_map.md + FINDINGS.md (dispatcher 0x2f6af; zones 0x29f90/0x2a362/0x2a786; WR 0x268e8; conv 0x2d44d)
4. web/src/engine/loop.js    <- re/game-loop.md (FUN_231e_361d @0x267f9, 151 callers = the state machine)
5. web/src/main.js wires them; screens must advance because DATA says so, not a timer.

Do not touch web/src/rle.js or framebuffer.js (verified byte-identical).
Do not copy PROTOTYPE-invented-not-porting.js (rejected invented mechanics).
Keep ?gallery=1 -> app.js working.
Local tooling: re/work/x86.py (capstone, linear = file offset + 0xf200), re/work/pfun.sh.

## Directive (30 Oct): target language is TypeScript
Port the engine to .ts under web/src/engine/ with a tsconfig; compiled JS must stay loadable by
index.html without a bundler (ES2022 modules, tsc only). Convert in this order:
rle/framebuffer (verified, keep byte-for-byte semantics), state.js, screens.js, loop.js, vm.js, main.js.
Do not change behavior during conversion. Current JS blocker to clear FIRST (verified 12:5x):
initialState() leaves mode null and st.g[0x13c91] undefined, so dispatch never runs and
keys a/w/e/F1/Escape all leave mode null. Fix = seed mode from BH_START.DAT via state.js,
then key->scancode binding per re/event-codes.md (0x1e=A,0x11=W,0x12=E,0x3b=F1,0x01=Esc).

## Milestone (30 Oct, 14:00): the port is TypeScript, building clean, behavior unchanged

`tsc --noEmit` reports **0 errors** under `strict: true`; `tsc` emits `web/dist/**.js` with
relative `.ts` specifiers rewritten to `.js` (`allowImportingTsExtensions` +
`rewriteRelativeImportExtensions`, TS 5.9). `web/index.html` now loads `./dist/main.js`.

Evidence, both suites:

```
$ node web/tools/integration_check.mjs   # runs web/src/*.ts through node type-stripping
21/21 checks passed
$ node web/tools/check_dist.mjs          # runs the EMITTED web/dist/*.js — same assertions
21/21 checks passed
$ node tools/domprobe.mjs                # main.ts's DOM branch under a canvas/fetch shim
putImageData calls: 1 · lit pixels: 22370 · errors: []
status: 320x200  BH_TITLE.DAT 62.5 KiB  64001 decoded | mode 1 = FUN_231e_b509 @0x2e6e9
        (DS:0x13c91, boot 1) | keep VRAM: blit @0x2b04d source page is unnamed (STATE1_DRAWS)
```

Key → mode table reproduced on `dist/`: `A`(0x1e)→3, `W`(0x11)→4, `E`(0x12)→2, `Esc`(0x01)→
stays 1 — all citing `0x2e6ef/0x2e705/0x2e722` and re/event-codes.md. No behavior was changed to
achieve this; only type annotations were added.

Layout: `web/src/{rle,framebuffer,main,app}.ts`, `web/src/engine/{loop,state,screens,vm}.ts`,
`web/tsconfig.json`, `web/package.json` (`"type":"module"`, `npm run build`, `npm run check`).
`src/PROTOTYPE-invented-not-porting.js` was renamed into the source tree by the conversion and has
been moved to `re/attic/` — it is excluded from the build.

## Process rule learned the hard way (30 Oct)

**Never run two lanes in the same directory, and never rename files while a lane is live.** A TS
lane (`mv src/**/*.js src/**/*.ts`) raced the inline edits it was meant to convert, and the
`loop.js` version that carried the §5 boot/layout/record draw rows lost: the surviving `loop.ts`
is the pre-§5 file. Consequence, stated plainly so nobody re-derives it:

- What is RECOVERED: mode global seeded from `BH_START.DAT`, INT 9 make/break handling, pump +
  epilogue + gatherer selection, the state-1 handler arms (`STATE1_ARMS`), and `setMode` mirrored
  to `g[0x13c91]` so both spellings of the mode agree. That is what makes A/W/E work.
- What is LOST and still open: the §5.1 boot resource rows, §5.2 `FUN_231e_4815`-style layout
  draws, and §5.3 record loaders. `STATE_VALUES[2|3|4].draws` therefore still carry
  `TODO_DRAWS@0x2e9e9 / @0x2ea8d / @0x2eb8c`, which matches re/game-loop-modes.md line 556 — the
  doc itself only inventories state 1 (§2, line 154). Re-deriving those rows needs the loader
  bodies (FUN_231e_6db0 / FUN_231e_75a6 / the `lcall 0x131e,0xb809` handler interiors), not a
  re-implementation of a deleted file.

Firefox `-headless --screenshot` captures at `load`, before a module's `await` chain resolves, so
it renders a black canvas for this page regardless of `--delay`. Use `tools/domprobe.mjs` for
automation and a real browser for eyes.

## Milestone (30 Oct, 15:10): states 2, 3 and 4 execute real arms; 27/27

The Appendix C handler inventories are implemented in `web/src/engine/loop.ts` (`STATE2_ARMS`,
`STATE3_ARMS`, `STATE4_ARMS`, built on a shared `sharedArms()` because the first three compares are
identical in all three handlers). Two new mechanisms were needed and are now in the executor:

- `rdWord(st, addr)` — a 16-bit read that picks the right store by address: inside
  DS:0x00AD..0x4653 it reads the attached `BH_START.DAT` image, above DS:0x4654 it reads the sparse
  global mirror. This distinction is evidence, not plumbing: `state.ts` proves the blob length from
  `lea cx,[0x4654]` @0x2cf62, and that is exactly why state 4's key tables (DS:0x5b90, DS:0x5ba4)
  read clear and the handler falls through at `0x2eb8b`.
- `matchArm()` — first-match-wins over an exact code, then the table arms, then the handler's
  documented else-row, mirroring how the cmp chains are actually built.

Three bugs the evidence caught during implementation, all fixed and now asserted:
1. `dispatch` ran state 1's pre-arm sink (`lcall 0x131e,0x67b7` @0x2e6fa) for every mode. It is
   mode-1-only; state 2 reaches the sink at its own tail @0x2ea87, states 3/4 never call it.
2. The pager rows carried the wrap stores (`mov word [0x3c8e],1` @0x2ebe5, `mov ax,[0x3c56]`
   @0x2ec09) as unconditional writes, so paging produced 1 -> 1 -> 1. They are inside `jbe`/`ja`
   branches and are now modelled as the wrap step of the inc/dec, note and all.
3. A `hex()` call inside `sharedArms()` was a TDZ reference at module init — it only surfaced in
   the emitted `dist/`, which is the reason `tools/check_dist.mjs` exists as a separate runner.

`A` -> mode 3 -> `=`/`-` page against DS:0x13c56 -> `Escape` -> mode 1 + blit is now a working
sequence, asserted end-to-end. Suite: 27/27 on `web/src/*.ts` and 27/27 on `web/dist/*.js`
(`node web/tools/check_dist.mjs`), 0 `tsc --noEmit` errors under `strict`.

Still open, in the order it now blocks things:
1. `TODO_ART_SOURCE@0x2b04d` — which file fills the DS:[0x6b9d] scratch page, per mode. Until then a
   mode change repaints nothing.
2. `TODO_TABLE_SOURCE@0x15b90` / `@0x15ba4` — the writers of state 4's match-key tables.
3. `re/game-loop-modes.md` §2 inventories for the *entering* draws of modes 2/3/4 (the arms that
   switch INTO them live in state 1 and blit; what each screen paints on entry is still unquoted).
4. Mouse button event code (`TODO_INPUT_MOUSE@0x27d15`) and audio (CTMF + SB DSP, undocumented).

## Milestone (30 Oct, 16:05): browser keys drive the state machine; 29/29

`web/src/main.ts` + `engine/loop.ts` now react to real DOM keydowns, verified in the page (a headless
driver fires the registered listeners and reads the status line):

```
after key "a"       mode 3 = FUN_231e_b9ac @0x2eb8c
after key "-"       (pages the cursor, wraps up to DS:0x13c56)
after key "Escape"  mode 1 = FUN_231e_b509 @0x2e6e9   <- written by state 3's own arm @0x2eb9e
after key "w"       mode 4 = FUN_231e_b8ad @0x2ea8d   <- written by state 1 @0x2e705
```

Three fixes got there:

1. **`INPUT_KEYS` lookup order.** `keyName()` upper-cases single characters (it was written for the
   ASCII-labelled arms), so the DOM's `a` folded to `A` and hit an ASCII row with no scancode: the
   mode never moved. `toRecord` now tries the DOM spelling, then the folded name, then the lowercase
   name, so a/w/e keep their scancode rows (`0x1e/0x11/0x12`) and `D` keeps its ASCII one.
2. **`rdWord` now picks its store by address** — blob inside `DS:0x00AD..0x4653`, sparse globals
   above it. That is what exposed state 4's dead end: its match-key tables sit at `DS:0x5b90` /
   `DS:0x5ba4`, above the save-image bound, and nothing in `re/` documents their writer, so the
   handler can only ever fall through to the `retf` @0x2eb8b. `TODO_TABLE_SOURCE@0x15b90`.
3. **Two conditional stores were being executed unconditionally** — the pager wrap stores
   `mov word [0x3c8e],1` @0x2ebe5 and `mov ax,[0x3c56]` @0x2ec09 live inside `jbe`/`ja` branches.
   Paging produced 1→1→1 before, 1→2→3→1 now.

`re/game-loop-modes.md` §C.7 records the consequence of the scancode finding: the letter arms and
state 3's pager arms (`-` = 0x0c, `=` = 0x0d, `t` = 0x14, `u` = 0x16) are consistent as make codes,
while `<`/`=`/`D` at 0x3c/0x3d/0x44 would be F2/F3/F10 and only make sense as ASCII. Rows carry the
reading that makes them a real key, cite their arm, and the two ambiguous sites are
`TODO_EVENT_CODE@0x2e778` / `@0x2ebe9`.

Suite: **29/29** on `web/src/*.ts` and **29/29** on `web/dist/*.js`, `tsc --noEmit` 0 errors, DOM probe
renders 22,370 lit pixels with zero uncaught errors. `web/README.md` is rewritten to match (the stale
"Phase 2: it's a game now" section describing the rejected fuel/economy prototype is gone).

Next, in the order that unblocks the most: (1) `TODO_ART_SOURCE@0x2b04d` — find which file fills the
scratch page per mode, since a mode change currently repaints nothing; (2) §5.1-style *entering* draw
inventories for modes 2/3/4; (3) the frame clock at `0x23e9e`; (4) `TODO_TABLE_SOURCE`; (5) mouse
event code and audio.


## Milestone 17:05 — input model settled (make codes), and FUN_231e_67b7 is a real mechanic

- Refuted this session's own int-16h/ASCII hypothesis: the pump's operand comes from
  `mov al, cs:[0x42]` @0x24372, and INT 9 writes that latch from the make codes it compares
  (0x39/0xb9, 0x3b/0xbb, 0x1d/0x9d) @0x23d48... So a/w/e switch modes, -/= page, F2/F3/F10 are
  arms, and the int 16h reader @0x28430 is a separate dialog poll. See event-codes.md Appendix D.
- Implemented the crew-stat allocator (16 arms, caps 0x4a/0x4a/0xde/0x25/0x6f, pool DS:0x3c70,
  budget DS:0x3c5c, mirrors = stat>>1, 7-pass re-derive @0x23f67). Reachable from states 1 and 2
  only; states 3/4 never call it. The port's rows can no longer skip a call behind a TODO
  (`runCalls` runs arm calls before any todo note).
- Browser: bare keys drive modes and move action points; the status line shows
  `AP pool/budget sys8,..`, 34/34 checks on src and dist, domprobe errors clean.
- Still open: TODO_ART_SOURCE@0x2b04d (nothing repaints on a mode change), entering-draw
  inventories for modes 2/3/4, the frame clock @0x23e9e, TODO_TABLE_SOURCE@0x15b90/@0x15ba4
  (state 4's key tables), mouse, audio.


## Milestone — @0x2b04d resolved: mode changes actually paint

- `FUN_231e_7e6d` is a two-mode **page compositor** keyed on the mode byte, sourcing BH_PAN.DAT
  records from the arena (record = mode-2, 91x135 at A000:0x5224, 0x8f border, then the 93x65 record 4
  overlay at A000:0xe3; page 1 restores a 94-column strip instead). Proof and byte list in
  `re/game-loop-modes.md` Appendix E; art render `re/work/pics/PAN_pages_2_3_4.png`.
- Port side: `web/src/engine/pages.ts` (verbatim transcription), `main.ts` preloads BH_PAN and keeps a
  `pageBuf` mirror of the last decoded frame for the strip path. Canvas hashes change per mode and
  restore byte-exactly on Escape (`tools/domprobe.mjs`).
- The three panels name the states: mode 2 ENGINEERING, mode 3 CARGO, mode 4 WEAPONS. Fixed the port's
  invented key hint string accordingly.
- `re/event-chain-state1.md` (new) dumps all of state 1's arm chain. Closes TODO_ART_SOURCE@0x2b04d,
  TODO_ARM_ORDER@0x2e7db, TODO_KEYMAP@0x2e76c, TODO_DRAWS@0x2e9e9/@0x2ea8d/@0x2eb8c,
  TODO_LEVEL2PLUS@0x2e82e. Corrects the input table: 0x31/0x32/0x35 are n/m//, digits are 0x02..0x0b
  and are cursor movers gated on DS:0x13ade == 1 (@0x2e885); Escape in state 1 opens the *menu*, not
  "back"; `=`/`-` are the cheat-gated scroller in state 1 and the pager in state 3.
- Suite: 62/62 on src and dist (`npm run check`, `npm run check:dist`), `tsc` clean.
- The modal VM @0x251e0..0x2539f is closed and implemented in `engine/vm.ts`: BH_CONV graph,
  DS:0x35e1 save slots, response effects, and all 16 BH_PEOP portrait records.
- Still open: `BH_CHAR`/`BH_SCRN`/`BH_VFD`
  formats (needed for text over the panels), TODO_TABLE_SOURCE@0x15b90/@0x15ba4, mouse, audio,
  TODO_GLOBAL@0x13c60 (role now known: it suppresses the @0x58b2 message past 0x11; writer still not).

---

## Session: the game's spine (script engine, zone cutscenes, frame clock) — 53/53

The fan-out experiment is over: all five lanes timed out at 2 h and produced only two partial files
(`zones.ts`, `clock.ts`). Everything below was done inline and is the reason the port is no longer
"boot art and a menu".

- **`TODO_TIMERS@0x23e9e` is closed, and the answer is not a timer.** There is no timer interrupt
  anywhere in the game: the whole interrupt census is int 21h/33h/16h/10h/0h/0Ah/0F9h and exactly one
  `int 1Ah` @0x23b7a used as an RNG seed. Every pass of the loop body **spin-waits on PIT counter 2**
  (`@0x23dd9 out 0x43,0x80` → two `in 0x42` → `cmp bx,0x7918` → `ja`) and then reloads it.
  0x7918 = 31000 counts = **25.981 ms → 38.49 passes per second**. Zone cutscenes reload `0x8ca0`
  (36000 = 30.17 ms). Ported in `web/src/engine/clock.ts`, driven by rAF in `main.ts`.
- **`c` and `s` are modal subroutines, not handlers** (`FUN_231e_a26d` @0x2d44d,
  `FUN_231e_a01c` @0x2d1fc), and they are the *only* callers of the three zone loaders.
  `FUN_231e_a26d` even re-installs INT 9 (@0x2d461, `int 21h ah=25 al=9`) so its keys bypass the
  pump's table. This is the spine the port was missing.
- **The object tables now have names.** Ships at DS:0x128f (stride 0x17, 1-based, byte +2 = BH_CONV
  script id): CLAW(1), ROC(2), BATROK(0)… Stars at DS:0x1e5b (stride 0x1c, 0-based): ENIGMA,
  INGMAR, GLOBAN, LUMA… The `cmp ax,0x500` selector means code < 0x500 → ship N, ≥ 0x500 → star
  N−0x500. Records are **variable length**: the walk is `rec + stride`, then scan to the next `$`,
  which is the *description's* terminator (`re/script-vm.md` had the geometry, not the semantics).
- **The actor array is sentinel-terminated, not counted**: @0x24604 `add bx,0xd` / @0x24609
  `cmp ax,0xffff`. BH_START holds 201 records, each carrying object code `0x500|index` — in a fresh
  game the visible objects *are* the star catalogue. So `s` printing 194 planet descriptions is
  correct, not noise (camera cull still TODO_ACTOR_CULL@0x245a9).
- **`BH_CONV.DAT` decoded — and two earlier claims about it retracted**: it is a **raw struct image**
  (0x7210 = 29200 bytes, `int 21h/3Fh` of 0xEA60 at @0x2d50b with no RLE call on the path), not a
  stone-RLE stream; and `lcall 0x131e,0x1de0` is not an interpreter but a 9-byte DS stub returning the
  arena selector 0xbf9 (@0x24fc0), so the monotone u16 run at +15 is not a script index (zero code
  sites read offset 0xf). The real layout: u16 node table at **+0x521** indexed by (script id - 1)
  (stops increasing at 34,012 bytes decoded) → **15 scripts**, first at 111, last at 1273, bodies
  `node = {u16 n, u16 textPtr, u16 head}` + `"text$"` + `"label$" <u16 reply>` choices, all ported in
  `script.ts:convNode`, plus the quest switch as `CONV_EFFECTS`. `c` now plays real dialogue.
  Remaining gap in this area: the 64-byte-per-script **control stream** base (`[0x70ab]` = CX at
  @0x25010) is not pinned by any shipped static — see re/script-vm.md §3.
- **The zone loaders are full-screen cutscene players.** Refuted for good: the "multi-record files
  walked by INT 21h/42h seek" theory — a byte scan finds only two lseeks in the EXE (0x250b9,
  0x2515f), both in the picture loader; what looked like a seek is the *next file's OPEN*. Framing is
  `<u8 w><u8 h><w*h>`, step `2+w*h` (@0x2a312). `node web/tools/zoneshot.mjs` renders them: zone 1
  is the corridor/vault with the "SOMEWHERE IN THE SOLARSYSTEM…" caption and a tear effect (band
  rows 57..141, seam cols 172/173 @0x2a06f), zone 2 swaps MW2A→MW2B full-screen, zone 3 animates
  110x93…116x88 planet records to A000:0x3eb2.
- **Regression that mattered**: keys had been routed through a per-key pump, and when the clock
  landed I gated `step()` on "a key is pending", which silently made the canvas repaint-on-boot-only
  in any host without rAF, and `startEngine` *threw* `requestAnimationFrame is not defined`. Both
  fixed: the pump runs unconditionally on the clock, keys also kick one pass for latency, and the
  scheduler falls back to a 16 ms timer. Proof is the engine's own counter, not the probe's shim:
  paints 1→2→3→4→5 across a/Esc/w/Esc, and `c` leaves an active zone running.
- Suite: **53/53** (`node web/tools/integration_check.mjs`), `tsc` clean, `check_dist` green,
  `domprobe.mjs` now exits. Docs: `re/script-engine.md` (new) carries all of the above with cites.
- Still open, in priority order: (1) text/glyphs (BH_CHAR, `FUN_231e_8bdc` @0x2b892, @0x263d1, @0x25f4d,
  @0x2a1c0) — the scan's planet text is a status line, not drawn; (3) the menu/new-game path @0x2cba2
  and modes 0/5; (4) `TODO_ACTOR_CULL@0x245a9`, `TODO_TABLE_SOURCE@0x15b90`, mouse, audio.

## Session 8 close-out

Ported: BH_CONV conversation graph (`script.ts:convNode`) + quest switch (`CONV_EFFECTS`), wired into
`loop.ts:runConverseArm`. `c` now plays real dialogue. 58/58 src + 39/39 dist checks, tsc clean.

Two theories retracted with evidence (see re/script-engine.md "session 8" and re/script-vm.md §3):
BH_CONV is a raw image, not RLE; `lcall 0x131e,0x1de0` is a DS stub, not an interpreter.

**Next gap, unchanged: text/glyph rendering.** `state.scriptLog` entries carry the dialogue `text` and
a `choices` array, but nothing draws them — the canvas only shows the composited BH_PAN page. Port
`FUN_231e_8bdc` @0x2b892 (message centre) / `FUN_231e_31f1` @0x263d1 (caption) and decode BH_CHAR.DAT
(14232 B, glyph candidate) so `main.ts` can blit the conversation into the framebuffer. Until then the
`c` arm's output is visible only through `trace`/`scriptLog`, not on screen.

Also open: the 64-byte-per-script control-stream base `[0x70ab]` (re/script-vm.md §3 item 2); no
shipped static record carries CONV ids 4/0xb/0xe, so the zone cutscenes need a runtime-assigned id.

## Session 9 — live PAGE world, text, conversation presentation, disk menu — 66/66

This supersedes the “next gap is text” close-out immediately above.

- `FUN_231e_31f1 @0x263d1` is ported in `web/src/engine/text.ts`: BH_CHAR is raw indexed 8x8 data,
  glyph stride 0x40, row stride 8, transparent zeroes, proportional width table at DS:0xb300
  (EXE file 0xc290). `FUN_231e_8bdc` contributes 0xc4-pixel wrapping and ten-pixel lines.
- `web/src/engine/conversation.ts` now draws the modal VM: the exact 216x186 shade rectangle,
  two 93-line panes, x13/y7 50x50 portraits, 0x87 border, 56-pixel text indent and ~160 ms animation.
  Numeric choices mutate DS:0x35e1 slots, and caller-side quest effects run only on modal return.
- The game now boots `PAGE.DAT`, not BH_TITLE. Dispatcher evidence pins BH_PLAN to the sprite segment
  used by `FUN_231e_1364`: BH_PLAN decode at @0x2faff establishes DS:[0x6ba1], then PAGE load
  @0x30668 builds the `<w,h,pixels>` pointer table @0x30727. `engine/world.ts` renders the shipped
  actors and hands those same addresses to `s`/`c` as the frame-local visible table.
- Arrow navigation advances DS:0x3d4/0x3d5, the deepest pair compared by the SI=4 renderer branch.
  This is a deliberate playable bridge, capped to the twelve nearest actors because BH_START's
  coarse cells are pre-init 0x7f. The complete sector initializer and five-byte inertia/carry model
  in `SOLAR1.c:13552..13625` remain open and are not claimed as exact.
- `FUN_231e_99c2 @0x2cba2` is connected as the F1/Escape disk modal with its exact labels. Save/load
  round-trip the original 17,831-byte blob into browser slot 1; new game reloads BH_START.DAT.
- `npm run build`, source checks, and emitted-JavaScript checks are all green: **72/72** each.

Highest-value remaining work: the object/ship art drawer `0x248dc` (`TODO_OBJECT_ART@0x2499d` — needs
the DS:0xe0f table, the DS:0xba68 arena pointer array and the `DS:0x6b99` segment); combat/weapon
transients and encounters; panel-specific numeric labels; state-4 transient key tables; mouse; audio.
The flight model and the star-field renderer are done and pixel-verified — see
`re/game-loop-modes.md` for the actor-walk dispatch table and the empty-boot-frame proof.

## Session 10 — real startup presentation and player craft — 77/77

This corrects Session 9's claim that jumping directly to PAGE.DAT was an acceptable boot path.

- `web/src/engine/startup.ts` transcribes the presentation embedded in `FUN_231e_c4cf`: BH_EPIC
  holds on BH_EPAL, BH_TITLE is assembled through the literal source/destination ranges at
  `0x2fde4..0x2fe83`, BH_PIC's transparent rectangles and final title plane are composited, and the
  completed title waits for input as the original loop does.
- Input enters BH_SEQ, not PAGE. The 27 opening strings are read at runtime from SOLAR1.EXE
  DS:0x8a17..0x8d5d and drawn at the exact VRAM destinations/timed counter intervals from
  `0x301be..0x305a3`. The counter uses two 0x8ca0 PIT passes per increment and exits at 0x5dc;
  keyboard/pointer input takes the `0x3064b` skip path.
- `DS:0x4562` is word 0x0a00 (bytes 00 0a), an eight-scanline VRAM advance. The old scalar-10
  interpretation was corrected in the shared font renderer and the narration line destinations.
- `web/src/engine/player.ts` ports the missing player craft half of `FUN_231e_0458`: heading
  DS:0x3c92 selects one of 32 BH_MS records and EXE table DS:0x33b2 offsets it from viewport centre
  DS:[0x6bbb]. Fresh BH_START therefore draws heading 0x16 at A000:0x6bdf (365 opaque pixels).
- `web/tools/startupshot.mjs` renders EPIC, first/final title, intro and live checkpoints. Both source
  and emitted-JavaScript suites pass 77/77, including the full EPIC -> TITLE -> SEQ -> PAGE path.

## Session 11 — real galaxy ships and bidirectional combat — 89/89

- `engine/world.ts` now decodes and draws all seven BH_SHIP banks (types 0xc8..0xce), 32 headings
  each. The selector is the live byte zero of the 0x20-byte object row at DS:0xe0f, so AI steering
  rotates the actual hull. BH_MIS supplies the 32 projectile headings; BH_PLAN remains the shipped
  star/planet catalogue. The empty first actor cell is proven shipped state, not generated scenery.
- `engine/enemies.ts` ports the nearby-hostile dispatcher `FUN_231e_bdc8 @0x2efa8`, movement
  `FUN_231e_bf14 @0x2f0f4`, states 2/4/5/6, dormant activation, 32-way steering, velocity
  accumulation, the DS:0x6533 trajectory lists, hostile launcher following @0x2bcc2, and the
  state-3 explosion/removal sequence. State 10 still lacks its waypoint steering routine.
- `engine/combat.ts` ports Ctrl launch `FUN_231e_91ed @0x2c3cd`, all ten DS:0xd8b projectile slots,
  BH_MIS heading metadata, DS:0x6393 trajectories, ammo/cooldown/expiry, enemy shield+hull damage
  from `FUN_231e_420f @0x273ef`, and reciprocal directional player-shield damage from
  `FUN_231e_62b1 @0x29491`.
- Two explicit bounded adaptations remain: `FUN_231e_30c9` bearing is currently computed with
  `atan2` in the proven 0=east/8=north orientation, and player impact facing uses relative bearing
  because the DOS renderer's collision-colour map has no canvas equivalent. The shipped
  `FUN_231e_420f` contains a lone `*2` object-address instruction that aliases records 2+; the port
  uses the 0x20 stride proven by the renderer, AI, and the other damage routine.
- Integration checks now prove pursuit/movement, player launch and trajectory, all four hostile
  shield facings, hull explosion/removal, hostile projectile allocation, and player shield damage.
  `npm run build`, source checks and emitted-JavaScript checks pass 89/89.

## Session 12 — exact bearings, waypoint AI, homing and player destruction — 94/94

- Added `web/src/engine/bearing.ts`, a literal transcription of `FUN_231e_30c9 @0x262a9`:
  unsigned low-word quadrants, the paired right shifts below 0x80, `(dy<<8)/dx`, all eight
  thresholds (`0x1c..0x749`), reverse-octant branches and the original numeric-branch tie when two
  headings are exactly 0x10 apart. This replaces `atan2`; it also fixes the previous pursuit vector
  being opposite the DS:0x6533 trajectory direction in several quadrants.
- `engine/enemies.ts` now ports `FUN_231e_c1a7 @0x2f387` and the preceding state-10 transition in
  `FUN_231e_bdc8`. The per-session DS:0x53e2 waypoint snapshot is retained outside the persisted
  save image, exactly matching its transient DOS lifetime. Escaped ships return at speed 0x78 and
  restore the saved behaviour/speed pair in DS:0x458c.
- `engine/combat.ts` now ports weapon-4 homing at `0x280a8..0x281dc`: every sixth pass it scans the
  36 hostile records, preserves the shipped `add [0x5b7d],cx` asymmetry at @0x2813c, selects the
  nearest candidate, turns one heading step and resets the trajectory frame.
- Added `engine/death.ts` for `FUN_231e_7bcc @0x2adac`. Signed hull <= 0 repumps without normal
  gameplay, advances the six raw BH_EXPL frames every four passes, erases the player after pass 22,
  and raises DS:0x457b to phase 2 on pass 36. `main.ts` centers those frames at DS:[0x6bbb].
- Source and emitted-JavaScript suites now pass **94/94**. The remaining combat adaptation is the
  hostile-hit shield-facing selection: it uses projectile-relative bearing because the original
  decision consumes the DOS pixel collision-colour map, which the canvas renderer does not expose.

## Session 13 — status-message pool extracted and wired — 96/96

- Addressing settled with Evidence: `rea read-bytes SOLAR1.EXE 0x15a9d` = `ev_eb620c8844abf5e1a21f9bc3fe1996f86bcd9be57f59ecb0fb6846d5c2e52758`
  returns the same 64 bytes the local file holds at `0x689d`, so **`file = DS + 0xE00`, `linear = DS + 0x10000`**.
  Every earlier doc that used a bare `0xF200` delta for *data* was code-side only.
- New evidence file **`re/messages-pool.md`**: 29 `$`-delimited status strings with their DS addresses, plus the
  branch table for the two state-3 printers `FUN_231e_ba64 @0x2ec44` / `FUN_231e_bb5a @0x2ed3a`. Two of those
  branches gate on exact camera bytes (`[si+0x3ce..0x3cf] == 0x8d72 / 0x858f`) — hidden locations, unexamined.
- **Two invented strings removed.** The scan and communicate empty arms printed "NOTHING IN RANGE" and
  "UNABLE TO COMMUNICATE"; neither occurs in the image. Shipped text is "OBJECT MUST BE ON SCREEN TO SCAN"
  (DS:0x5949) and "OBJECT MUST VISIBLE TO COMMUNICATE" (DS:0x5926).
- `web/src/engine/messages.ts` (new) reads the pool out of the EXE at runtime; `loop.ts` arms now carry `msgDs`,
  which `main.ts` draws through the existing `FUN_231e_8bdc` text path. Checks: pool verbatim-ness, and `s` with
  nothing visible producing the shipped string. `tsc` clean, src and dist suites **96/96**.
- Still not implemented, in priority order: the state-3 printer branches (need the `AL` source and the
  camera-coordinate gates), `FUN_231e_32de @0x264be`'s own string walk (it explains why `lea` displacements land
  mid-entry), the transient tables at DS:0x5a9d/0x5b90 (`TODO_TABLE_SOURCE`), audio, mouse.
- Method note: no background lanes this session. Everything was one local `rea` CLI call plus shell analysis,
  and it beat three waves of delegated lanes on throughput.
- REA from a shell (when the MCP tools are absent): `GHIDRA_INSTALL_DIR=/Users/unlink/tools/ghidra_12.1.4_PUBLIC
  JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="$JAVA_HOME/bin:$PATH"
  ~/.npm/_npx/a1722018f28f9df2/node_modules/.bin/rea read-bytes SOLAR1.EXE 0x15a9d`. The env is mandatory —
  `/usr/bin/java` here is a stub that cannot run Ghidra.

## Session 14 — transient stars, sector navigation and reachable opening story — 100/100

- `web/src/engine/starfield.ts` ports the flight backdrop omitted by the persistent actor renderer.
  `FUN_231e_8708 @0x2b8e8` seeds 20 positions with the EXE permutation at DS:0xbc60 and selects one
  of 16 sparse shapes through DS:0xaf99; `FUN_231e_42e4 @0x274c4` moves and phase-cycles the first
  19 in palette range 0x90..0x9f. The exact viewport is the 216x186 clear at `(5,4)` performed by
  `FUN_231e_88f9 @0x2bad9`. New/load and gatherer changes rebuild this transient state.
- `web/src/engine/coordinates.ts` ports `FUN_231e_81e8 @0x2b3c8`. It subtracts 0x7f7f7f7f from the
  high four camera bytes, reverses the displayed Y sign as the assembly does, and prints at
  A000:04b4/04d4. Fresh state is sector `-28,7`; the opening EXE narration's actual objective is
  “meet in sector -31,1.”
- Fixed a traversal-breaking error in `flight.ts`: a negative low-byte movement had masked borrow
  `-1` to `0xff` before the next byte, so west/up flight could corrupt the 40-bit camera by hundreds
  of sectors even though local movement looked plausible. The carry chain now preserves signed
  borrow exactly like the five `sub/sbb` instructions at @0x241ef..@0x24202.
- The integration suite now flies from the untouched fresh camera using only normal arrow/Space
  input, reaches the CLAW actor near the narrated sector, and opens BH_CONV script 1 with `C`.
  Source and emitted-JavaScript suites pass **100/100**, `tsc --strict` is clean, and
  `tools/out/startup_live.png` shows the restored star backdrop and coordinate readout.
- Turning now mirrors the nested original call chain: the heading write calls `FUN_231e_0458`
  (`@0x2442a`/`@0x24463`), whose normal tail calls `FUN_231e_02dd @0x237f1`. The port had omitted
  that second-order velocity update, leaving the player moving on the old vector while its hull and
  projectiles used the new heading. `stepFlight` now recomputes velocity on each actual heading
  change, including at maximum speed; the suite proves hull, travel vector and projectile agree.

## Session 15 — ground truth against real VRAM, and the browser path proven to animate — 120/120

- `tsc --strict` clean (one real error fixed: `VoiceSample.samples` needed
  `Float32Array<ArrayBuffer>` for `copyToChannel`). `npm run check` and `npm run check:dist` both
  **120/120**. 25 modules under `web/src/engine/` plus `rle`/`framebuffer`/`main`/`app`.
- **First true fidelity measurement.** DOSBox **F7 rawshot** writes the emulator's actual 320x200
  framebuffer; `faithful_diff.mjs` says the port's title render is **89.98 % pixel-identical,
  100 % within 4/255, mean channel error 0.10** vs real VRAM — and a real-vs-real control (two
  frames 0.7 s apart: 5,888 px / 2.45 mean) proves the residue is the screen's own fade phase, not
  a decode/palette/geometry error. Method, numbers and dead ends in `FINDINGS.md` §GROUND TRUTH.
- **`npm run check:browser`** (`web/tools/browser_smoke.mjs`) stubs just enough DOM for `main.ts`
  to take its real browser route, drives the virtual PIT clock, and asserts **>= 20 unique
  presented frames** (observed 81 over 400 passes). Standing answer to "it's just a gallery": the
  suite fails if the engine stops animating.
- **What the running port does today:** boots EPIC -> STONE title -> live mode 1
  (`FUN_231e_b509 @0x2e6e9`), flies with arrows on the 38.49 Hz pass clock, sector readout moves
  (-28,7 -> -28,6), `s` scans with shipped text, `c` opens a real `BH_CONV` node (KAA, 4 choices)
  whose replies drive the quest switch and world flags.
- **Open runtime end (next lead):** after ENTER on the title, the real game sits on a 47-colour
  screen that ignores ENTER/F1/n/l/Space/Down/Up for 14 s (`captures/walk/`, `captures/probe/`).
  Suspect mouse-driven (INT 33h range is set in `0x24ff4`) or injection not reaching DOS. Resolve
  before trusting any *input-flow* claim past the title.
- **Broken tool, flagged in place:** `re/dosbox/ocr_shot.mjs` fails on known text — do not use its
  output; its glyph/width plumbing is reusable once the band detector is replaced.
- No background lanes this session either: local analysis + one emulator at a time.

## Session 16 — dialogue pagination + live panel primitives — 122/122

Two user-reported defects, both now closed against shipped Evidence:

- **Dialogue was truncated.** `drawConversationText` capped the speech block at `maxLines:6`, so
  every reply past ten wrapped rows lost text. The real engine has no cap: `FUN_231e_2cf5 @0x25ed5`
  counts rows into `[0x70a5]` and at `@0x25f5c cmp byte ptr [0x70a5],0xa` calls `@0x25623`
  (`INT 16h/00h` + `INT 33h` button poll) to wait, then resets the row counter and rewinds the cursor
  to `[0x70e3]` (`@0x25f6b/@0x25f71`). So it **pages** at ten rows. `web/src/engine/text.ts:paginate`
  and `conversation.ts:conversationPages` transcribe this; the page cursor lives on the modal
  (`state.conversation.page`) and `main.ts` routes any key/click to a page turn until the last page,
  after which the choice dispatch runs. `session.conversationPage` exposes `{page, pages}`; two new
  checks assert a reply exceeds one page and that turning it does not close the modal. Measured
  CLAW acceptance reply = 3 pages.
- **Menus were inert-looking.** They already mutated state, but showed nothing. Transcribed the live
  panel primitives into `web/src/engine/panels.ts`:
  - Engineering crew marker: `FUN_231e_7fc0 @0x2b1a0` blits BH_SML record `0x1e` (8×8, zero-
    transparent, @0x2b1c4 walk) at `[[memberSel]*2 + 0x35d3]` (@0x2ea6b). BH_SML.DAT is exactly
    32 records of 8×8+2 = 2112 B; record 30 is the marker glyph.
  - Weapon power lamps: `FUN_231e_93f9 @0x2c5d9` sets a bank's 15 cells to `0x86`; `FUN_231e_9466
    @0x2c646` overwrites levels above `[0x3c94]` with `0x34` and a `0x32` tick. Cell bases are the
    ten u16s at `DS:0x3587` (rows 98/112, cols 237..297) — verbatim pixel writes, no arithmetic guess.
  - Cargo/weapon/click hit boxes were already in `loop.ts handlePanelPointer`; confirmed against the
    disassembly (`x86.py 0x29bd6`, `0x2ee69`).
  The blob pointer tables `0x3587/0x35bf/0x35d3` are read straight from BH_START via `state.wordAt`.
- Still text-not-primitive: missile ammo pips (`FUN_231e_9127` stages to `0xa74f`, final blit site
  unquoted) and cargo **item-name** bitmaps (an arena `[0x6b89]:0x2000` table no shipped `.DAT` maps
  to; BH_SHIP/BH_SML/BH_OBJ all walk-out-empty at 0x2000). Both are named in README Known-open #1.
- Method note: `python3` resolves to a Homebrew build without capstone; use
  `/Library/Developer/CommandLineTools/usr/bin/python3 re/work/x86.py` for the local 16-bit dump.

## Session 17 — the campaign director + the last three in-world menus — 133/133

The engine had menus that opened but a world that never changed: no conversation ever gave you cargo,
ammo or crew, and `m`/`/`/`d` were documented arms that rendered nothing. Closed against shipped bytes.

- **`FUN_231e_a592 @0x2d772` (the campaign director) ported** → `web/src/engine/rewards.ts`, called
  from loop.ts `finishConversation` (its single caller is `FUN_231e_a26d @0x2d44d`, @0x2d772). It scans
  the script-slot bytes `DS:0x35e1..` (the vm.ts effect-cascade destination, stride 1 over the region,
  15 0xff stop-guard) and fires the first deferred trigger in `0x64..0xfe`, then clears it and returns
  (one reward per call). The 20 branches were extracted from the decompile, not guessed: 0x65 convert
  scanner 5→8; 0x66/67/69/6e/75 grant cargo 8/5/0xc/0xd/(2,0xd); 0x6a/6b/6f add missile ammo to
  DS:0x359b/0x35a1; 0x6d crew +200 (0x3c5c) + FUN_231e_3708; 0x6c/0x70/0x71/0x74 rebuild / move camera;
  0x72/0x95/0x96 set quest flags. Verified 6 ways incl. an end-to-end sweep that finds a shipped
  conversation choice which leaves a trigger.
- **`m` TASKS (`FUN_231e_3a81 @0x26c61`)** → textscreen.ts. Walks the quest-word array `DS:0x3ab5 + i*2`
  (0xffff sentinel), printing task string `i` from `DS:0x4a34` for each non-zero word. Same words the
  director sets — the through-line from `c` to the mission log.
- **`/` HELP (the `@0x2ddc0` selector)** → two-level modal: topic list at `DS:0x83ae` via
  `FUN_231e_5133 AL=7`; options 1..6 draw their page strings (`cmp al,N` @0x2dde4.., Control Panel
  page gated on `DS:0x3ade` @0x2de46), option 7/Escape exit.
- **`d` TRACK (@0x2e987)** → next visible actor (DS:0x3bf5 via world.ts) with record byte +0xb < 5
  into `DS:0x3ae1`; "NOTHING TO TRACK" (`DS:0x49a3`) otherwise.
- **String-region law, re-checked:** these menu strings are initialized data-segment bytes at
  `file = DS + 0xF90` (dataString), NOT the transient status pool's `DS + 0xE00` (messages.ts). A
  one-off `node` delta probe over each cited string confirmed it; the first draft used 0xE00 and printed
  the Sound Blaster init string for "NOTHING TO TRACK".
- `runCalls` now routes callees 0x26c61/0x2dd9f/0x2e987 to real handlers instead of `fired()`.
- 133/133 source + emitted-JS, tsc strict clean, browser_smoke 81 unique frames. Proof PNGs in
  `web/tools/out/menu_{tasks,help_story,engineering,cargo_item}.png` (the last shows a story-granted
  scanner in the cargo panel).

## Session 18 — the engineering bars were never ported — 133/133 + 25 bar checks

Reported symptom: "the writing for the buttons in the engineering screen doesn't line up with the
bars at the bottom, it's all up the top overlapping." Correct, and both halves were real: the port was
stacking a seven-line `drawText` readout at col 230 rows 3..59 (BH_PAN record 4's *top* box) and the
routine that actually paints the engineering values, `FUN_231e_8043 @0x2b223`, was missing entirely.

Done: `web/src/engine/bars.ts` (verbatim transcription, `ES=0xa000`, 8 bars at col 239+9i growing up
from row 128, 7 px wide, 37 units per column then a darker second column), the compositor tail now
runs the mirror zeroing at @0x2afe4 so a page blit invalidates them (`pages.ts` `PageArt.g`), and
`panels.ts` mode 2 draws no text. Geometry cross-checked against the `FUN_231e_69f6 @0x29bd6` click
boxes. Full detail and the byte-level citations are in `re/FINDINGS.md` (last section).

Two traps worth remembering:
- Ghidra's pseudocode renders `mov bl,7` + bottom `dec`/`test` as an 8-iteration do-while. Transcribing
  the pseudocode gives 8 writes per row, which drifts one column right per row and smears the band.
  Count from the bytes.
- The cell tables ARE initialized (`0x3587` pulse, `0x35bf` missile, `0x35d3` crew = 7 stations) and
  agree between BH_START.DAT and the EXE image; my first probe indexed the blob as if it were the file
  and mistook the result for ASCII. All three are `(selector - 1) * 2`, 1-based. Fixed in
  `panels.ts`, which had the crew index off by one station.
- Still open: the 3x3 pip pattern table at `DS:0x5e5e` (above DS_END, so neither blob nor file) and its
  producer — see `TODO_PATTERN_TABLE@0x5e5e` in `re/FINDINGS.md`.

Suite: `tsc` strict clean, 133/133 src and dist, `web/tools/bars_check.mjs` 25 checks.


## Session 19 — the flight-screen HUD + the panel overlay primitives, 197 checks

- `web/src/engine/hud.ts`: FUN_231e_8de4 @0x2bfc4 (mode-1 overlay, every 5th pump pass), with the two
  primitives it needs (FUN_231e_8d2b number formatter @0x2bf0b, FUN_231e_3079 field clearer @0x26259).
  Wired at the mode-1 render seam in `main.ts`.
- `web/src/engine/panels.ts` rewritten as transcriptions of FUN_231e_93f9/9466 (pulse lamps, incl. the
  column-3 centre 0x34 asymmetry), FUN_231e_9127 (ammo strip), FUN_231e_7fc0 (BH_SML blit), and the
  selector tables — all of which ARE initialized data, contrary to what session 18's closing note said.
- `web/src/engine/bars.ts`: FUN_231e_8043 @0x2b223, the engineering stat bars. Session 18's entry has
  the geometry; the one-byte trap (7 writes, not 8) is in `re/FINDINGS.md`.
- **DS:0x3ade is a countdown-driven HUD-layout flag, not the sound toggle** — `GLOBALS.soundEnable` in
  `loop.ts` is mislabelled (it is also xor'd by the `n` arm, hence the name). Renaming is deliberately
  not done yet: ~40 references. Do it with a test, not by hand.
- New tools: `bars_check.mjs`, `panels_check.mjs`, `hud_check.mjs`, `sml_dump.mjs`. `npm run build`
  (tsc strict) then `npm run check:dist` from `web/`; `python3 tools/mk_check_dist.py` regenerates the
  dist copy of the integration suite after editing it.
- Still open, in rough priority order: the `DS:0x5e5e` 3x3 pattern table's producer (ammo pips and the
  scan gatherer both read it); the `@0x2c125 jmp 0x2c304` tail that lands inside FUN_231e_9127's
  pushes; the other pump-side draw callees not yet examined (FUN_231e_5a22 @0x28c02, FUN_231e_4dc7,
  FUN_231e_4673, FUN_231e_aa7d, FUN_231e_6710, FUN_231e_bdc8 @0x2ed48); the cargo panel's message
  string at `lea bx,[0x5a25]` @0x2eca1; palette cycling.

## Session 20 — the flight-screen digit meters roll, 205 checks
- `hud.ts` gained FUN_231e_6710 @0x298f0 (5x44 strips at 0x7de7/0x7e37, /4 passes, mode 1 + 0x3ade) and
  the `SpinState` shadow that makes an in-place A000 animation survive the port's per-pass re-composite.
  `resetSpin` is called where page 1 restores the strip.
- The general lesson for every remaining in-place animator: transcribe the mutation, then decide where
  its accumulation lives, because the port re-composites. Verify with a multi-pass sample, not one frame.
- Next: FUN_231e_4673 @0x27853 (tracking-actor pick + draw at 0x4b0), then 0x5e5e's pattern producer.
