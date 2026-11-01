# Solar Winds (Epic/STONE Interactive, 1993) — reverse-engineering ledger

Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`
Provider: Ghidra 12.1.4 via REA 6.7.0 MCP. `x86:LE:16:Real Mode`, MzLoader, load seg 0x1000.
**All addresses below are linear byte coordinates** (Evidence limitation: they are not unique
segment:offset aliases). Local corpus: `re/decomp/SOLAR1.c` (all 179 procedures,
`ev_9c2cc709bcdf5464…`), `re/procedures.txt`.

Status legend: **O** observed (REA Evidence) · **D** derived · **I** inferred · **?** unknown.

## Artifact inventory

| file | kind | status |
|---|---|---|
| SOLAR1.EXE | uncompressed MZ, the engine | O |
| CATALOG.EXE | LZEXE v0.91 packed (`LZ91` at 0x1e) | O — needs unpacking for code analysis |
| BH_PAL / EPAL / MP1 / MP2 / MP3 .DAT | exactly 768 bytes = 256×3 8-bit RGB palette | O |
| BH_CONV.DAT | magic `SOLAR WINDS\x1a\x1a` + 2-byte offset table | O |
| BH_MU1..MU13.DAT | magic `CTMF` `01 01 28 00` + record area | O (layout ?) |
| BH_START.DAT ≡ HSAV01.DAT | byte-identical, 17831 bytes | O — a savegame **is** the state blob; fresh game = BH_START copied to HSAVnn |
| SAVLST.DAT | 240 B = 10 slots × 24 B (name + `$`) | O |
| BH_TITLE / SEQ / SEQ2 / MW1A..MW3B / EPIC / ORD / WR / MS / PAN / PEOP / OBJ / PLAN / VFD / SHD / HYPE | RLE-compressed byte streams (high 0xFF density) | O compressed / ? per-file layout |
| BH_CHAR / EXPL / IMP / PIC / SML / MIS / IORD | no 0xFF runs, struct/array-like | O |

## Established code facts (Evidence-cited)

- `entry` @ 0x231e0: a few INT 21h calls, stores result to `DAT_1019_6b89`, calls 0x23857. (`ev_…` in corpus)
- **0x23857** parses the PSP command tail at `0x81` for `/NOSB` (disable Sound Blaster) and scans
  argv for `I` after `0x6ca5..0x6ca8 = 0x24` — i.e. **BBS-door command-line parameters**. O
- **0x24ff4 (FUN_231e_1e14)** — picture/animation loader + script interpreter. `ev_c1259400cf6f6c98…`
  - Mouse setup: `INT 33h` AX=07 range 0..0x27e(638), AX=08 range 0..0xc8(200), AX=02 hide cursor
    → 2:1 horizontal mouse mapping ⇒ **320×200 screen**. O
  - Table record = 3 words: `[BX+0]`→frame index `0x7064`, `[BX+2]`→`$`-script pointer,
    `[BX+4]`→`0x7058` count. O
  - `INT 21h` AX=3D02 open (DSX=`0x7089` filename buffer), read 2 bytes→`0x7055`, then per
    extra frame `INT 21h` AX=4201 seek(+len); read `CX=len` into `0x705e`; AX=3E close. O
  - Second stage repeats with 15 (or 9 when `0x70e1==1`) skips and dest segment `+0x620`. O
- **Exact RLE rule** (from `0x250fe–0x25122`): literal byte copied; `0xFF n v` → write `n` copies
  of `v` (loop `DEC CH; CMP CH,0xFF`), with the destination index decremented first so the
  tentative 0xFF literal is overwritten; `n==0` ⇒ zero copies ⇒ **`FF 00 xx` encodes a literal 0xFF**.
  Decodes to ≈64000 bytes for the screen-like files, but *not exactly* — so the per-file framing
  (header/length/planar layout) is still **?**. D
- Resource-name table `0x169xx–0x16d00`: `$`-delimited, NUL-terminated filename entries; walked by
  `CMP AL,0x24` scans in 0x24ff4 and 0x23857. Values listed in `search_strings`
  `ev_5e78a1289cd78b75…`; raw bytes `ev_53bed304bdbe032e…`. O
- The `$`-delimited **conversation graph** is interpreted after portrait display. Choice controls
  `1..99` are visible/select a 1-based `0xFF` response branch; `0` and `>=100` are hidden. Response
  effect vectors use `0`=preserve, `1`=clear, `2`=write 1, literal=copy, and terminal `01 FF`
  increments the stage and returns. The 64-byte slots begin at caller-supplied `DS:0x35e1`.
  O (`0x2d53b`, `0x251e2..0x2539f`; xref Evidence `ev_d7bc42f451554d50…`)
- The VM-local filename at linear `0x23019` is `BH_PEOP.DAT`: 16 length-prefixed stone-RLE records,
  each decoding into 1–10 frames of 50×50 pixels. O/D
- INT usage census over the decompiled corpus: INT 21h ×243, **INT 33h (mouse) ×108**,
  INT 16h (keyboard) ×48, INT 10h (video) ×11, INT 1Ah ×1. D
- Shareware content gaps: `BH_INT1..INT11.DAT`, `BH_WIN.DAT`, `BH_IORD.DAT` are referenced but absent.
  End-of-game string says registered buyers get the sequel *Solar Winds: Universe*. O

## Open questions (next passes)

1. ~~Per-file framing of the RLE picture files~~ **RESOLVED** — see "PICTURE FORMAT" below.
   1a. OPEN: why BH_MW2P (15,613), BH_MW3A (38,979), BH_MW3B (38,967) decode to far under 64,000
       under both run rules. Not full frames; masks/sprite sheets/partial blits? (lane 1 F5)
2. `CTMF` container layout in BH_MU*; which of MW/MU/MP/MS/WR/VFD/SHD/PIC/CHAR/SML feeds which loader.
3. The VGA write path: ~~which segment:offset is the framebuffer~~ **RESOLVED: `A000:0000`, mode 13h**,
   staged through a RAM scratch page (`[0x6b9f]`) and copied with `rep movsw`, `cx = 0xfa00`.
   Palette programming (`INT 10h AX=1012h` vs ports) and `BH_SHD` role still open — see `re/engine-video.md`.
4. Sound Blaster: DSP/reset port sequence, `BH_VFD`/`BH_SML` (digitized SFX?) and `BH_MS` (music?) formats.
5. Whether an overlay is appended after the load module (0x32bdc vs file size 145884 — file offsets
   past the image need `address_to_file_offset` checks).
6. Full game-state map of the 17831-byte blob: diff several savegames to name fields.
7. BBS-door vs standalone I/O paths (the `/NOSB`+`A:\BH_SHIP.DAT` evidence implies both).

## RLE decode-length scan (rule: `FF n v` = n copies, `FF 00 xx` = literal 0xFF)

Screen-like files decode to 64.2k-70.9k bytes, i.e. **slightly over one 320×200 frame** and never
exactly 64000 (derived from `re/decomp/SOLAR1.c` rule + local byte streams; not REA Evidence):
MW2A 64744 · EPIC 65164 · MW1B 65552 · ORD 66029 · WR 66462 · SEQ 66586 · TITLE 68329 ·
MW2B 68783 · MW1A 70851 · SEQ2 38513 · PEOP 215220 · SHIP 218407.
Reading: either each file is several variable-size images back-to-back (no terminator visible in
0x250fe-0x25122), or the tail beyond 64000 is a mask/palette block. **0x24ff4 is one loader among
several** — its 2-byte-length-then-seek record walk does not fit these files (offset 0 would be
length 0xFAFF), so the picture-per-file framing is still unresolved. **[SUPERSEDED — see next section; the rule
applied there was the wrong one of two variants.]**

## PICTURE FORMAT — SETTLED (2026-10-29, two independent sources + rendered proof)

There are **two RLE variants**, distinguished by one byte in the run loop's exit test:

| decoder | exit test | `FF n v` emits | `FF 00 v` emits |
|---|---|---|---|
| `0x250fe`/`0x25110` (picture loader `0x24ff4`) | `cmp ch,0xff` (`80 fd ff`) | n copies | 0 (no-op) |
| `0x2a023`, `0x2a146` (map-zone loaders) | `cmp ch,0` (`80 fd 00`) | **n − 1 copies** | 255 (8-bit wrap) |

Applying the **n − 1** rule to a whole file yields **exactly 64,001 bytes** for BH_MW1A, BH_MW1B,
BH_MW2A, BH_MW2B, BH_TITLE, BH_EPIC, BH_SEQ, BH_ORD, BH_WR. The 64,001st byte is an artifact of the
engine's own loop bound (`inc di` then `cmp di,dx / ja`, so it processes `src[dx]` one past the
buffer) and is discarded by the 64,000-byte `rep movsw` to video. No header, no trailer, no
per-record length, no planes: **one file = one raw RLE stream = one 320x200 8bpp frame at
`A000:0000`** (linear 0xA0000), staged via scratch segment `[0x6b9f]`. Reads are capped at
`cx = 0xc350` = **50,000 compressed bytes** — files larger than that (BH_PEOP 77,529) cannot be
loaded whole by this path. Palette files are 768 B of 8-bit RGB, converted to 6-bit DAC values by
`shr 1` twice over `di = 0..0x2ff`.

Rendered proof (my own decode, this session, via `re/tools/decode_pic.py`, variant A):
- `re/work/pics/BH_MW1A_A_00.png` — the Solar System map: "SOMEWHERE IN THE SOLARSYSTEM..." banner,
  planet plate, dithered perspective floor, cockpit. Fully coherent.
- `re/work/pics/BH_TITLE_A_00.png` + `_epal` variant — four stacked STONE Interactive logos.
  Glyph edges crisp, interiors speckled: the index plane is right, so the speckle is the game's
  **own dither/palette-cycling art** (consistent with the XOR pixel-pair swap "shimmer" loop at
  `0x2a06f`), not a decoder bug. Re-rendering with BH_EPAL changed nothing, confirming this.
  Still worth pinning down: which palette table is live per screen, and the cycle step per frame.
- Corroborating doc: `re/formats-maps.md` F1-F4 (independent arrival at the same rule).

## RUNTIME CONFIRMED (DOSBox Staging, controlled replay, 2026-10-29 21:17)

Per `re/README-dosbox.md`: `SOLAR1.EXE` launched with **no parameters at all** boots, and DOSBox
logs `VGA 720x400 16-colour text mode 03h` → `VGA 320x200 256-colour graphics mode 13h at 70.086 Hz`
~0.5 s later, still alive at a 20 s timeout. So: (a) mode 13h is set at runtime, independently
confirming the static `A000:0000` / 320x200x8bpp conclusion; (b) no BBS-door parameters and no
`/NOSB` are required to start — the shareware runs standalone. Missing artifact: a captured PNG
(`re/dosbox/captures/` is empty) — screenshot triggering from a headless shell is unresolved.

## FAN-OUT METHOD NOTE (for the next session)

Two waves of `worker` lanes (6 children) **all hit the 30-minute child cap** and returned nothing
as a report, but their write-as-you-go docs survived (`re/formats-maps.md`, `re/engine-video.md`,
`re/formats-tables.md`, `re/README-dosbox.md`) and were genuinely useful. The productive mode here
is **local computation**: the lanes' `re/work/x86.py` (capstone, linear = file + 0xf200) plus
pointer-value search over the EXE answer more per minute than REA calls, which cost 5–25k tokens
each. Reserve REA for claims that need citable Evidence.

## Per-loader RLE variant assignment (local disassembly, `re/work/x86.py`)

| loader | loop | exit test | rule | files that yield exactly 64,001 |
|---|---|---|---|---|
| `0x24ff4` screen | `0x250fe` | `80 fd ff` (`ch==0xff`) | n copies | — (its files are multi-record) |
| `0x29f90` zone 1 | `0x2a023`, `0x2a146` | `80 fd 00` (`ch==0`) | **n − 1** | MW1A, MW1B |
| `0x2a362` zone 2 | (same shape) | `80 fd 00` | n − 1 | MW2A, MW2B |
| `0x2a786` zone 3 | `0x2a81f` | `80 fd ff` | n copies | none |

Zone 3 reads with `cx = 0xffff` (not `0xc350`) and after decoding does
`mov ax,[0x6b97] / mov [0x4552],ax / mov ah,0x3d / mov al,2` — an **INT 21h/3Dh seek**. So the short
decodes (MW3A 38,979 / 41,903; MW3B 38,967; MW2P 15,613, never reaching 64,000 under *either* rule)
are not framing bugs: those files are **multi-record containers** walked by seek, while MW1x/MW2x
are single whole-file RLE streams. This is the answer to open question 1's remainder, and the port
must implement both shapes: whole-file stream (zones 1–2, and screens via the dispatcher) and
seek-walked records (zone 3, MW2P, and the `0x24ff4` picture loader's path).

## Corrections (screens.js evidence, 39/39 checks pass)
- Zone 3 has NO INT 21h/42h seek. Only lseeks are 0x250b9/0x2515f inside 0x24ff4. The record walk is
  `<u8 w><u8 h><w*h>` in the DECODED buffer and walks to decoded-1 on all 7 stream files. MW3A 41,903 / MW3B 41,612 = stone, cx=0xffff, 4 records each.
- Conversation loader 0x2d44d does NO RLE: one raw read cx=0xea60; the VM indexes its actual node
  table at `+0x521`. The monotone u16 values near the header are not the script table.
- Dispatcher 0x2f6af = 20 slots in straight-line open-site order (not a switch). Details in re/loader_map.md.

## GROUND TRUTH — real VRAM vs the port (2026-10-31, first measurement of its kind)

**Method that finally works:** DOSBox Staging's **rawshot** action, bound to **F7** in
`re/dosbox/solar.map` (`hand_rawshot "key 64"` = SDL scancode 64 = F7). It writes a **raw 320x200
PNG of the emulated framebuffer** — no window scaling, no CRT shader — into `re/dosbox/captures/`.
Driven by `re/dosbox/rawshot.sh <tag> <budget> "<s>:<keys>"...`, with host key injection via
`osascript ... key code 98` (macOS F7). The earlier attempts failed for a specific reason: the
lane bound screenshots to Ctrl+F6 (`scrshot`), which only writes *upscaled window* grabs, and the
host-region grab in `winshot.sh` clipped against the screen bottom (the SDL window sits at y=519
with height 508 on a display whose usable height is ~956, so 71 pt were offscreen).

**Measured, not asserted:** `web/tools/faithful_diff.mjs re/dosbox/captures/image0001-raw.png
web/tools/out/startup_title_stage0.png`
- **89.98 % of pixels identical**, **100.00 % within 4/255**, **mean channel error 0.10**.
- Both sides use exactly **56 distinct colours**; the 6,415 mismatched pixels are a uniform
  **−2/−3/−4 on all three channels** (deltas `-3,-3,-3` ×3516, `-2,-2,-2` ×1721, `-4,-4,-4` ×516).
- **Control experiment that explains the residue:** two *real* frames 0.7 s apart
  (`image0001` vs `image0002`) differ by **5,888 px / mean 2.45** — the same magnitude and same
  signature as real-vs-port. So the residual is the title screen's own fade/dither phase, **not** a
  decode, palette or geometry error. That is as close to "the port renders the original's screen
  correctly" as this project has had evidence for.

**Palette expansion, tested and reverted:** the bit-replicating DAC model
`(v6 << 2) | (v6 >> 4)` is **worse** against the raw capture (99.08 % within 4, mean 0.13) than the
zero-filling `(v >> 2) << 2` already in `web/src/framebuffer.ts` (100.00 % within 4, mean 0.10).
Keep the existing form; the comment there now cites the capture.

**Browser-path proof** (`web/tools/browser_smoke.mjs`, `npm run check:browser`): stubs enough DOM
for `main.ts` to take its real `if (DOM)` route (startEngine → requestAnimationFrame →
`getContext('2d')` → `putImageData`) and drives the virtual PIT clock at 26 ms/pass. Over 400
passes it presents 410 frames of which **81 are distinct** — the assertion that separates the
engine from the gallery this port kept being mistaken for. Final frame: 30,836/64,000 px lit, 156
colours, row profile 65/63/64/61/59/57 % then 36/33/32/37 % then HUD row 97 %.

**Tool inventory added this pass:** `web/tools/pngstats.mjs` (dependency-free PNG decode + coverage
/row-profile metrics — this is the substitute for a model that cannot see images),
`web/tools/faithful_diff.mjs` (real-vs-port pixel diff with per-cell worst regions),
`re/dosbox/rawshot.sh` (scripted real-game capture), `re/dosbox/winshot.sh` +
`re/dosbox/normalize.mjs` (host-region grab path, superseded by rawshot).

**Known-broken tool, do not trust output:** `re/dosbox/ocr_shot.mjs` — reads screen text via the
port's own BH_CHAR font. Verified to *fail* on a screen whose text is known (`browser_live.png`,
"KAA! The rumors are to be believed."), returning punctuation noise. Cause: `bandInk()` assumes the
modal colour of an 8-row band is background (false over art) and the 0.12 mismatch threshold admits
spurious single-glyph hits. A correct version must locate text bands from the draw calls
(message origin `DS:[0x6bb5]`, `@0x2be49`), not from image statistics.

**Open end from the runtime walk:** after the STONE title, one ENTER advances to a 47-colour
screen (`walk/03_16s.png` .. `06_30s.png`, rows 58–124, stable) that **ignores ENTER, F1, n, l,
Space, Down and Up** over 14 s. Either it needs the mouse (INT 33h range is set in this very code
path, `0x24ff4`) or the injected keys are not reaching the DOS side. Unresolved; the shareware's
own end-of-game text implies a key press is expected, so this is the next runtime question.


## Engineering readout: FUN_231e_8043 @0x2b223 is a VRAM bar painter, not text (2026-11-01)

User-visible symptom in the port: the ENGINEERING panel showed a stack of labels crammed into the top
box, overlapping, nowhere near the bars at the bottom of the panel. Cause: `panels.ts` invented a
`drawText` list at col 230 rows 3..59. The shipped engine draws **no text there** — the labels are
baked into BH_PAN record 0 and the eight live subsystem values are painted as vertical bars straight
into `A000`.

Recovered from `/usr/bin/python3 re/work/x86.py 0x2b223 0x2b3c8` (capstone, local — no REA call):

| fact | evidence |
|---|---|
| gated to modes 0-2 | `cmp byte [0x3c91],2` / `ja` @0x2b223/@0x2b228 |
| `ES = 0xa000`, writes are `ES:si` | `mov di,0xa000` / `mov es,di` @0x2b22f/@0x2b232 |
| 8 stats `DS:0x3c5e+2i` diffed against mirrors `DS:0x5c02+2i` | @0x2b237/@0x2b23b/@0x2b246 |
| bar foot **col 239 row 128**, 9 px per stat, 7 px wide | `mov si,0xa0ef` @0x2b289, `mov ax,9` @0x2b2a2, `mov bl,7` @0x2b2df (dec-before-test = 7) |
| mode 1 bases: `0xd934` (col 244 row 173) / `0xaeaf` (col 239 row 139) if `[0x3ade]` | @0x2b293 / @0x2b29d |
| grows up one row per unit: `sub si,0x140` then `-0x147` after the 7 px | @0x2b2b4/@0x2b2f9 |
| 37 units per column, then foot + 4 darker steps | `div bx` bx=0x25 @0x2b2be, `add si,0x2e40` @0x2b2c8, `sub byte [0x455d],4` |
| fill skips art pixels in 0xa6..0xbd | `cmp ah,0xa6`/`cmp ah,0xbe` @0x2b2e4/@0x2b2e9 |
| erase walks **down** and nudges lit pixels +4 up the ramp, `>=0xd7 -> 0x8f` | `add si,0x140` @0x2b385, `add si,0x139` @0x2b3ad, @0x2b394..@0x2b3a3 |
| ramp byte `DS:0x455d` resets to 0xd7 only on the first changed stat of a pass | @0x2b27f..@0x2b286 inside `if [0x5bbc] != 1` |

`0x2e40 == 37*320` and stat 3's cap is `0x25` = 37 (@0x299ad..@0x29a6e), so **one 37-row column is
exactly one full subsystem** and cap-0x4a = 74 fills a second, darker column. Cross-checked against
the click boxes in FUN_231e_69f6 @0x29bd6: raw CX 0xee..0x136 in nines = screen x 238..310, "+" rows
83..108, "-" rows 113..138 — every bar (239+9i .. +6) sits inside its box.

Why the bars survive a repaint: the compositor's tail calls FUN_231e_7e04 @0x2afe4 @0x2b18f, which
zeroes `0x5c02..0x5c10` (@0x2afe8). That mirror clear is the invalidation — `blitPage` now does it
(`pages.ts` PageArt.g), so the next pass repaints all eight bars over the fresh art.

Port: `web/src/engine/bars.ts` (transcription), `web/tools/bars_check.mjs` (25 checks: foot
geometry, click-box containment, cap fill, idempotent full repaint, diff-paints-once). Integration
suite updated in two places that had assumed the text stack: the mode-2 liveness check now hashes
the bar band, and the mode-1 strip check now excludes the band, because the pump legitimately paints
`0xd934` bars on the flight screen. `tsc` clean, 133/133 on both src and dist.

Two corrections: (a) the 8-pixel bar width that `re/game-loop-modes.md` implies from Ghidra's
pseudocode is wrong — Ghidra emits a do-while that runs 8 times, the bytes run 7 (`mov bl,7` with
`dec`/`test` at the bottom); an 8-write transcription drifts one column right per row and smears the
whole band. (b) A first probe of `0x3587` looked like ASCII and was filed as "runtime-built tables";
that was an indexing error in the probe, not a property of the game — the tables **are** initialized
in both BH_START.DAT and the EXE image and agree byte-for-byte. See the next section.


## Panel overlay primitives: lamps, markers, ammo pips (2026-11-01, later same day)

The cell tables are real, initialized, and identical in `BH_START.DAT` and `SOLAR1.EXE` at
`file = DS + 0xF90` (verified to agree at 0x3587 = 0x7b6d both ways):

| table | DS | contents |
|---|---|---|
| pulse-bank lamp cells | `0x3587..0x359c` | 10 words -> cols 237/252/267/282/297 at rows 98 and 112 |
| missile-bank cells | `0x35bf..0x35d2` | 10 words -> the same five cols at rows 144 and 158 |
| crew stations | `0x35d3..0x35e0` | **7** words -> (234,158) (250,164) (266,164) (282,164) (298,158) (259,177) (274,177) |
| pulse availability | `0x3573..0x3586` | 10 words, starting state `[1,1,0..]` |
| missile ammo | `0x359b..0x35ae` | 10 words, starting state `[5,0,0,2,0..]` — also the bank's `!= 0` gate |
| crew presence | `0x35af..0x35be` | 8 words, starting state `[1,1,0..]` (the missile table begins at +0x10, so the two are adjacent) |

Every indexed site uses `(selector - 1) * 2` with the selector 1-based and 0 meaning nothing selected
(`mov bl,[0x3c4b] / dec bx / shl bx,1 / mov di,[bx+0x3587]` @0x2eadd..@0x2eae6; likewise 0x3c4a and
0x3c4c). `panels.ts` had the crew index as `[sel]` instead of `[sel-1]` — off by one station.

**FUN_231e_93f9 @0x2c5d9** — `mov ax,0xa000 / mov es,ax / mov al,0x86` then fifteen `mov byte
es:[di+off],al`. The offsets are three columns of five: `0xa03,0xb42,0xb43,0xb44,0xc83` /
`0xa07,0xb46,0xb47,0xb48,0xc87` / `0xa0b,0xb4a,0xb4b,0xb4c,0xc8b`. For bank 1 (`di = 0x7b6d`) those
land on cols 239..241, rows 106..112 — a 3x5 lamp. `0x2e40`-style row arithmetic: 0xb42-0xa03 = 319,
0xc83-0xb43 = 320, so the columns step one row down per pair.

**FUN_231e_9466 @0x2c646** — the power selector's mask, `DS:0x3c94` gates each of the three columns:
`cmp byte [0x3c94],1 / je` skips column 1 (@0x2c658), `cmp ,2 / je` skips column 2 (@0x2c67c), and
`cmp ,1 / je` skips column 3 (@0x2c6a0). So power 1 lights columns 1 and 3, power 2 lights column 2,
power 3 darkens everything. The dark values are 0x34 on the four outer cells and **0x32** on the
centre for columns 1-2 (@0x2c675/@0x2c699) but **0x34** on column 3's centre (@0x2c6bd) — an asymmetry
in the original that the earlier `level > power` guess in `panels.ts` missed entirely.

**FUN_231e_9127 @0x2c307**, the missile ammo strip, is fully specified except one input:
- destination is a literal `0xa74f` = col 271 row 133, or `0xf4bc` = col 252 row 195 when
  `[0x3ade] != 0 && mode == 1` (@0x2c328..@0x2c336) — so the flight screen has its own strip.
- clears 40x3 to 0xde (@0x2c339..@0x2c354), then draws up to ten 3x3 pips, `add di,4` apart
  (@0x2c3b8), row advance `add di,0x13d` (@0x2c3a1).
- the pip bytes come from `[bx + 0x5e5e]` with `bx` running continuously across pips (set to 0 once at
  @0x2c37c, not reset per pip), minus `dl`, where `dl = 6` only when `dh == 9 && ammo > 1`
  (@0x2c384..@0x2c38d) — the tenth pip darkens when a second bank also carries missiles.

**Open: `TODO_PATTERN_TABLE@0x5e5e`.** `DS:0x5e5e` is above `DS_END` (0x4654), so it is not in the save
blob and not in the EXE's file image; `0x5e23/0x5e3c/0x5e55/0x5e5e/0x5e74` are a family of runtime
3x3/5x5/3x7 pattern tables that the scan gatherer `FUN_231e_535c @0x2853c` also selects between by
ship-system level `DS:0x3c64` (SOLAR1.c:18652..18711). No site writes them with a literal address, so
the producer uses indexed addressing. The port fills the pattern with the strip's own background index
rather than guess a dither — `AMMO_PATTERN`/`setAmmoPattern` in `panels.ts`.

**Markers.** BH_SML is 32 records, all 8x8, so `FUN_231e_7fc0 @0x2b1a0`'s walk (`si += w*h + 2`,
repeated AL-1 times, from `es:[0x2000]`) is a flat 66-byte stride. Record **0x1d is blitted at the cell
the selection moved to and 0x1e at the cell it left** — both call sites agree (@0x2ea65 then @0x2ea7f
for the crew stations; @0x2eae6 then @0x2eaf7 for the pulse banks). They are two left-pointing
arrowheads of different widths (0x1d spans 6 cols, 0x1e spans 7), not a mark/erase pair; an earlier
draft had 0x1e as the live marker. `web/tools/sml_dump.mjs` prints them.

Port: `web/src/engine/panels.ts` rewritten to these four routines,
`web/tools/panels_check.mjs` (19 checks incl. blob-vs-EXE agreement and the 0x34/0x32 centre
asymmetry). One real bug surfaced while writing it: the ammo strip's row advance was `di0 + row * 320`
instead of `+ (row + 1) * 320`, so it painted two rows over one and left the third untouched.
`tsc` strict clean, 133/133 src and dist.

**Test-harness note:** anything that pokes `fb.vram` directly and then re-reads it must snapshot with
`.slice()` — a dirty flag makes the host re-composite into the same buffer on the next access, which
silently overwrites isolated test writes (it reported 38400 changed cells for a 15-cell writer).

## The flight-screen HUD: FUN_231e_8de4 @0x2bfc4, and DS:0x3ade is not a sound flag (2026-11-01)

Found while looking for what mode 1 draws beyond the bars. Every fifth pump pass (@0x23e6b `inc byte
[0x54c4]` / @0x23e6f `cmp ,5`) calls `FUN_231e_8de4`, whose first instruction is
`cmp byte ptr [0x3c91],1 / je` (@0x2bfc6) — so it is the FLIGHT screen's overlay only.

Each numeric field is: value → `cmp` against a mirror word → `lcall 0x131e,0x8d2b` (format) →
`lea bx,[0x6ca5]` + `mov di,<dest>` + `mov al,<width>` → `lcall 0x131e,0x3079` (clear) →
`lcall 0x131e,0x31f1` (draw) → adopt the mirror.

| field | DS source | mirror | destination | width | when |
|---|---|---|---|---|---|
| credits | `0x3c5c` | `0x5c16` | `0x587e` = (254,70) | 0x1e | always in mode 1 |
| credits | " | " | `0xbb57` = (279,149) | 0x1e | when `DS:0x3ade == 1` (@0x2bfe6) |
| — | `0x3c9a` | `0x5c14` | `0xed3a` = (250,189) | 0x11 | `0x3ade != 1` **and** cheat latch `0x3be6 == 1` (@0x2c009) |
| hull | `0x3c5a` | `0x5c00` | `0xed5d` = (285,189) | 0x11 | same path |
| AP pool | `0x3c70` | `0x5c18` | `0xbb2f` = (239,149) | 0x1e | only when `0x3ade == 1` (@0x2c064) |

Then, still gated on `0x3ade == 1`, three BH_SML icon cells and the ammo/lamp writers:
missile bank at `0xdd0a` = (266,176) with **record = bank + 0x12** (@0x2c0b5) then `call 0x2c307`;
pulse bank at `0xdcfa` = (250,176) with **record = bank + 8** (@0x2c0e7) then `call 0x2c646`;
crew member at `0xdd1a` = (282,176) with **record = member + 1** (@0x2c109), and that last one also
runs `lcall 0x131e,0x458` + `mov byte [0x5c1a],0xff` + `lcall 0x131e,0x45`. A selector of 0 blits
record **0x1e** at the same cell instead (@0x2c0a5/@0x2c0d7), i.e. 0x1e is the blank plate that clears
a cell — which is what the 0x1e/0x1d pairing in the panel handlers has been all along.
Mirrors: `0x5bc0` missile, `0x5bbf` pulse, `0x5bc1` crew.

Two primitives fell out of it:
- **FUN_231e_8d2b @0x2bf0b** formats a u16 into the 19-byte buffer at `DS:0x6ca5` with four
  subtract-and-count loops (10000/1000/100/10) and a `printed` flag that is set once and never cleared,
  then the units digit unconditionally, `$`-terminated. `BX += 0xd8f0` is subtraction of 10000 in 16 bits.
- **FUN_231e_3079 @0x26259** clears an `AL`-wide by 8-row block of 0xde, but at `di + 0x140` — one row
  *below* the destination that FUN_231e_31f1 draws into (@0x2626e `add di,0x140` before the row loop).
  Reproduced literally; it is why the field's top row is never erased by the clear.

**Correction to `loop.ts`'s GLOBALS and to earlier notes: `DS:0x3ade` is not the user's sound
toggle.** The pump (@0x23e9e..@0x23f07, SOLAR1.c:13396..13414) sets it to 1 on the pass where the
`DS:0x3c16` countdown *starts at 500* and back to 0 when the countdown *reaches 0*, running
FUN_231e_3708 (the BH_PAL + BH_MW2A/MW2B load) on both edges. The `n` key's `xor byte [0x3ade],1`
@0x2e75f flips the same byte, which is why it was labelled soundEnable. What it actually selects in
@0x2bfc4 is the **HUD layout**: with it clear the flight screen shows one number (credits at
(254,70)); with it set the credits move into a full bottom strip with AP, the three bank/member icons,
the power lamps and the ammo pips. It reads 0 in both BH_START.DAT and the EXE image, so a fresh game
starts in the compact layout. This also re-labels the `DS:0x13c16`/`0x13c18` pair clock.ts calls
"countdown": `0x3c18` is the previous pass's value of `0x3c16`, used to detect the 500 edge.

Port: `web/src/engine/hud.ts`, wired at the mode-1 render seam in `main.ts` (it re-runs every pass
because the port re-composites the world; the mirror words make unchanged fields no-ops, which is the
same visible result as the /5 cadence). `web/tools/hud_check.mjs` — 17 checks: every destination
decoded from its `mov di` immediate, the formatter over 12 values, the clear-one-row-below rule, the
mode gate, mirror suppression, the two gate paths, and the three record offsets.

Still open: `@0x2c125 jmp 0x2c304` lands **three bytes before** FUN_231e_9127 @0x2c307, inside its
push sequence, so the HUD's tail enters the ammo routine mid-frame. Either capstone's function
boundary is off by the `push di` at 0x2c307 or the original really does skip the first push; the port
calls it normally. Also still open: the `DS:0x5e5e` pattern table's producer (see above).

Suite: tsc strict clean, 133 + 28 + 19 + 17 = 197 checks, src and emitted dist.

## FUN_231e_6710 @0x298f0, the rolling digit meters (2026-11-01)

Found while sweeping the remaining pump-side draw callees. Gated `mode == 1 && DS:0x3ade == 1`
(@0x298f0/@0x298fa), divided by four on `DS:0x46a4` (@0x29901), then it walks two 5-column × 44-row
rectangles of A000 — `0x7de7` = (231,100) and `0x7e37` = (311,100) — applying to each byte:

    if (v < 0x30 || v > 0x38) keep; else { v++; if (v == 0x39) v = 0x31 }

i.e. it is not drawing a value, it is cycling the numeral glyph that is already there, so the two
meters roll through 0x31..0x38 (0x39 is unreachable because the fold happens after the increment).
Row advance `add di,0x13b` (@0x2994b), 44 rows (`cmp ch,0x2c` @0x29951), INT 33h AX=2/1 around the
walk, `retf` @0x29996.

**Integration caveat that took a test to find:** in DOS the walk mutates A000 *in place*, so the steps
accumulate and only a page-1 compositor call resets them. The port re-composites the world every
render, so a literal transcription produced a two-frame flicker instead of an animation. `hud.ts`
therefore keeps the accumulation in a `SpinState` shadow seeded from the composited frame, blitted
back over it, and `main.ts` calls `resetSpin` where page 1 restores the strip (@0x2b11c). Verified: an
in-range cell now runs `31 32 33 34 35 36 37 38` over 80 passes, and an out-of-range one never changes.

Also examined, not yet ported: `FUN_231e_4673 @0x27853` (mode 1 + `0x3ade`, picks the nearest
trackable actor into `DS:0x3ae1`/`0x3ae3` and draws at `0x4b0`), `FUN_231e_5a22 @0x28c02` (calls the
message blit `0x32de` and the rebuild `0x458`), `FUN_231e_4dc7 @0x27fa7`, `FUN_231e_aa7d @0x2dc5d`,
`FUN_231e_bdc8 @0x2efa8`. Disassembly of all six is on disk in `re/work/FUN_231e_*.asm`.

Suite now 205 checks: 133 integration + 28 bars + 19 panels + 25 hud, tsc strict clean, src and dist.
