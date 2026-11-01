# Loader → data-file map (pass 1)

Method: every `INT 21h` AH=3Dh open site in `SOLAR1.EXE` (53 sites, located by `search_bytes`
`ev_4df88e589d300f97…`, enclosing procedures attributed by REA) was disassembled locally with
capstone 5.0.7 (CS_MODE_16) over `re/procedures.txt` ranges, and the immediates in the data-segment
window were resolved against the `$`-delimited name table (anchors: REA observed `$BH_EPAL.DAT` at
`0x169ac`, `$BH_MS.DAT` at `0x169c5` ⇒ file→linear delta `0xf200`, verified on `BH_MS` → `0x169c6`).
**Table contents and delta are REA Evidence; the per-function immediate scan is a shell-tool
observation and still needs one `procedure_assembly` confirmation per row before it is cited.**

| loader | file(s) referenced | reading |
|---|---|---|
| 0x23857 `FUN_231e_0677` | BH_CHAR, BH_PAL (+ post-table ref) | boot/character screen; also parses `/NOSB` from the PSP tail |
| 0x26d63 `FUN_231e_3b83` | CONFIG.DAT region | config read |
| 0x268e8 `FUN_231e_3708` | BH_WR, BH_PAL | war report + its palette |
| 0x27167 `FUN_231e_3f87` | BH_PEOP | people/NPC records |
| 0x27c02 `FUN_231e_4a22` | BH_HYPE | hype/advertisement stream |
| 0x28b30 `FUN_231e_5950` | BH_INT11 (index-derived) | intermission loader |
| 0x29655 `FUN_231e_6475` | BH_SHD, BH_IMP | shading table + empire/IMPerium records |
| 0x2983d `FUN_231e_665d` | BH_INT1 (base, stride 14 ⇒ INT1..INT11) | intermission base |
| 0x29f90 `FUN_231e_6db0` | BH_MP1 + BH_PAL + BH_MW1A | zone 1: palette + world art |
| 0x2a362 `FUN_231e_7182` | BH_MP2 + BH_PAL + BH_MW2A + BH_MW2B + BH_MW2P | zone 2 |
| 0x2a786 `FUN_231e_75a6` | BH_MP3 + BH_PAL + BH_MW3A + BH_MW3B | zone 3 |
| 0x2d44d `FUN_231e_a26d` | BH_CONV | conversation tree |
| 0x2f6af `FUN_231e_c4cf` | 20 open sites, many strings | generic/resource-manager open path |
| 0x24ff4 `FUN_231e_1e14` | no direct table ref | picture+script loader, see `FINDINGS.md` |

**Consequence for the port:** the `MPn`+`MWA/MWB` pairing means each of the three map zones has its
own 256-color palette — the engine swaps palettes per zone, so the JS renderer must support
per-zone palette switching, not one global palette. Confirmed consistent with the five 768-byte
palette files (`PAL`, `EPAL`, `MP1..MP3`) observed in the inventory pass.

Name table (linear → file), 62 entries: `re/name_table.json`. Note `BH_MU1..MU13` and `BH_INT1..11`
are index-derived (`0x16b8b` base, 14-byte stride), and `A:\BH_SHIP.DAT` is the only drive-qualified
entry (door/CD path).

## Computed loader map (2026-10-29, local pointer-value search — replaces the guessed table)

Method: for every name-table entry at linear `L`, search the code segments for the word
`L - 0x10190`; a hit is the instruction that passes that filename to `INT 21h/3Dh`.
Full output: `re/work/name_refs.txt`. No REA calls; addresses linear (file + 0xf200).

| loader | linear | files |
|---|---|---|
| `FUN_231e_c4cf` | `0x2f6af` | **central resource dispatcher**: EPAL, EPIC, EXPL, IMP, MIS, MS, OBJ, PAL, PAN, PIC, PLAN, SEQ, SEQ2, SHD, SML, TITLE, VFD |
| `FUN_231e_6db0` | `0x29f90` | zone 1: MP1, MW1A, MW1B, PAL (restore) |
| `FUN_231e_7182` | `0x2a362` | zone 2: MP2, MW2B, MW2P, PAL |
| `FUN_231e_75a6` | `0x2a786` | zone 3: MP3, MW3A, MW3B, PAL |
| `FUN_231e_0677` | `0x23857` | init: CHAR, PAL (also parses command tail) |
| `FUN_231e_99c2` | `0x2c92?` | ORD, SCRN, START |
| `FUN_231e_a26d` | `0x2d44d` | CONV |
| `FUN_231e_3f87` | — | PEOP |
| `FUN_231e_3708` | `0x268e8` | WR |
| `FUN_231e_665d` | — | INT1 (**only literal INT reference**) |
| `FUN_231e_6475` | `0x29655` | SHD, IMP |

### Key structural findings
1. **One dispatcher, not 20 loaders.** `0x2f6af` holds ~17 open sites selected by a resource-ID
   switch. The port needs one `loadResource(id)` and an id→filename table, not 17 routines.
2. **`BH_INT2..INT11` have zero literal name references.** Only `BH_INT1` appears as a pointer.
   Strong evidence the intro modules are loaded via a *constructed* name (`BH_INT` + decimal), i.e.
   `INT 1..N` are a numbered sequence, and the shareware ships only #1. Consistent with `lcall
   0x131e,0x2f1f` (overlay segment) in `0x24ff4`. → still needs the string-builder site confirmed.
3. **`BH_MU1..13` names sit in a contiguous pointer block at `0x16c35–0x16c63`** — an indexed
   music-track table, so track selection is `table[n]`, not per-track code.
4. `BH_WIN.DAT` unreferenced in this build (file also absent) → registered/door-only path.

## screens.js coverage (2026-10-30, porting pass for `web/src/engine/screens.js`)

Method: local capstone 5.0.7 pass over the six loader bodies (`re/work/x86.py` addressing, linear =
file + 0xf200) to enumerate every `mov ah,0x3d / mov al,2 / lea dx,[name] / int 0x21` site, resolve
each `lea` against `re/name_table.json`, read the read-cap immediate (`b9`), and locate the run
loop's exit-test byte (`80 fd 00` = wind, `80 fd ff` = stone) that follows each open. Then each
wired file was decoded with the shipped `web/src/rle.js` over the real `web/data/*.DAT` in a
throwaway node script (`/tmp/sw/check_screens.mjs`, not committed): 39 checks, 0 failing.
No REA calls; every address below is reproducible from the corpus.

### 1. `FUN_231e_c4cf @0x2f6af` is straight-line, not a switch — 20 open sites in fixed order

Finding 1 of the "Computed loader map" section said "one `loadResource(id)` and an id→filename
table, not 17 routines". Confirmed in spirit, corrected in shape: there is **no dispatch on a
resource id** in this routine. The 20 sites execute top to bottom, each opening one file, reading
it with an explicit `cx` cap, closing, and then advancing the scratch-segment chain. The id the
port uses is therefore the **slot** (position in this order), which is what `openAt` proves:

| slot | openAt | file | cx | shape | decoder |
|---|---|---|---|---|---|
| 0 | 0x2f6d0 | SAVLST.DAT | 0xf0 | raw (240 B = 10 slots × 24 B) | — |
| 1 | 0x2f71f | BH_MS.DAT | 0xffff | RLE stream → 32 records 35×35 | 0x2f7a9 stone |
| 2 | 0x2f7eb | BH_EXPL.DAT | 0xffff | raw | — |
| 3 | 0x2f843 | BH_SHD.DAT | 0xffff | raw | — |
| 4 | 0x2f87c | BH_IMP.DAT | **0x50** | raw, **header only** (80 of 95,960 B) | — |
| 5 | 0x2f8b1 | BH_MIS.DAT | 0xffff | raw | — |
| 6 | 0x2f92d | BH_SML.DAT | 0xffff | raw | — |
| 7 | 0x2f99a | BH_OBJ.DAT | 0xffff | raw | — |
| 8 | 0x2fa22 | BH_PAN.DAT | 0xffff | RLE stream → 5 records (91×135 ×3 …) | 0x2fac3 stone (paragraph-crossing) |
| 9 | 0x2faff | BH_PLAN.DAT | 0xffff | RLE stream → 32 records | 0x2fb8c stone |
| 10 | 0x2fbc8 | BH_VFD.DAT | 0xffff | raw (digitised) | — |
| 11 | 0x2fc26 | BH_IORD.DAT | 0xffff | raw + drive-letter fixup loop @0x2fc4f | — |
| 12 | 0x2fc67 | BH_EPAL.DAT | 0xc350 | palette 768 B | — |
| 13 | 0x2fca1 | BH_EPIC.DAT | 0xc350 | **frame**, decodes straight to `A000:0` | 0x2fd00 wind |
| 14 | 0x2fd1e | BH_PAL.DAT | 0xc350 | palette 768 B, then VRAM clear | — |
| 15 | 0x2fd6b | BH_TITLE.DAT | 0xc350 | **frame** | 0x2fdd8 wind |
| 16 | 0x2fe95 | BH_PIC.DAT | 0xc350 | raw, zero-skipping copy to DS:0x70ac | — |
| 17 | 0x3008c | BH_SEQ.DAT | 0xc350 | **frame** | 0x300f9 wind |
| 18 | 0x3013f | BH_SEQ2.DAT | 0xffff | RLE stream → 41 records | 0x301a8 stone |
| 19 | 0x30668 | PAGE.DAT | 0xc350 | **frame** | 0x306d5 wind |

So the "dispatcher uses wind for the screens" reading in `re/FINDINGS.md` holds for
EPIC/TITLE/SEQ/PAGE but **not** for SEQ2, MS, PAN, PLAN — those four carry the stone loop and are
record containers, not frames. That resolves open item 2 of "Run loop variants": the same routine
hosts both loops, one per site.

### 2. There is no INT 21h/42h seek in the zone loaders — the record walk is in the DECODED buffer

`re/FINDINGS.md` ("Per-loader RLE variant assignment") described zone 3 as reading with `cx=0xffff`
"and after decoding does … `mov ah,0x3d / mov al,2` — an INT 21h/3Dh seek". `0x3d` is OPEN, not
LSEEK. A scan for `b4 42` across the EXE finds **exactly two** lseek sites, `0x250b9` and `0x2515f`,
both inside the picture loader `0x24ff4`. Zone 1/2/3 and the dispatcher contain none; what looks
like a seek is the *next file's open* (`0x2a84c` = MW3B, `0x2a4e8` = MW2P).

The framing that the seek was invented to explain is in the decoded stream, and it is now
measured: **`<u8 width> <u8 height> <width*height pixel indices>`**, repeated. Every non-frame
RLE file wired here walks to exactly `decoded − 1` bytes (the −1 being the engine's own over-read
tail byte), which is the strongest available confirmation that the variant assignment is right:

| file | variant | decoded | records | bytes consumed |
|---|---|---|---|---|
| BH_MS.DAT | stone | 39,265 | 32 × 35×35 | 39,264 |
| BH_PAN.DAT | stone | 45,071 | 5 (91×135, 91×135, 91×135, 90×24, 93×65) | 45,070 |
| BH_PLAN.DAT | stone | 39,023 | 32 | 39,022 |
| BH_SEQ2.DAT | stone | 38,513 | 41 | 38,512 |
| BH_MW2P.DAT | stone | 16,217 | 8 × 45×45 | 16,216 |
| BH_MW3A.DAT | stone | 41,903 | 4 (108×93, 110×93, 115×94, 115×94) | 41,902 |
| BH_MW3B.DAT | stone | 41,612 | 4 (115×94, 115×92, 116×88, 115×87) | 41,611 |

Under **wind** the same walk dies after record 0 (MW3A 38,979 → stops at 10,048), so zone 3 and
MW2P are stone, definitively — this supersedes the "MW3A 38,979 / MW3B 38,967" figures in
`re/formats-maps.md` F4, which are wind-length numbers for stone-encoded files.

Corroborating code: blit `0x2a2e2` (zone 3) walks exactly this header pair and `rep movsb`s
`width` bytes per row for `height` rows at VRAM offset `0x3eb2`, row stride `0x140`, selecting
plane 0 (MW3A) for records 0..3 and plane 1 (MW3B) for 4..7 via the `[0xbaf6]` counter; blit
`0x2a2a5` (zone 2) indexes MW2P's decoded plane at `[0x6ba3]:0x1770 + al*0x7eb`, i.e. record 0
header at 6000 and 8 strips of stride 2027 = 45*45 + 2. Both match the table above byte for byte.
**`decodeRecords`' `<u16 len>` framing in `web/src/rle.js` is therefore wrong** — rle.js was left
untouched per instructions and `screens.js` implements the `<u8><u8>` walk in `walkRecords()`.

### 3. Coverage of `web/src/engine/screens.js`

Exports: `DISPATCH` / `resource(id)` / `filenameFor(id)` (the slot→filename table),
`loadDispatcherResource(id, read)`, `loadResourceBundle(read)`, `ZONES` / `loadZone(n, read)`,
`loadWarReport(read)`, `loadConversation(read)`, `walkRecords`, `dacPalette`,
`FRAME_STREAM_BYTES = 64001`. Every loader takes an injectable `read(name)`; the default is
`fetch('data/' + name)`, so the module also imports cleanly under node for verification.

Full frames (all decode to **exactly 64,001** bytes, `pixels.length == 64,000`), wind variant:
BH_MW1A · BH_MW1B · BH_MW2A · BH_MW2B · BH_TITLE · BH_EPIC · BH_SEQ · BH_WR · PAGE.DAT (9/9).
Zone 2 also loads BH_MW2A/MW2B as frames and BH_MW2P as the strip plane; zone 1 MW1A/MW1B;
zone 3 MW3A/MW3B are record planes (handled separately, never asserted against 64,001).
Palettes BH_MP1/MP2/MP3 + BH_PAL/BH_EPAL: 768/768 bytes each, DAC `(v>>2)<<2`.
Not wired as frames, read raw per their site: SAVLST, EXPL, SHD, IMP (80 B), MIS, SML, OBJ, VFD,
IORD, PIC.

The conversation loader `0x2d44d` **performs no RLE decode at all** — one `int 0x21/3fh` with
`cx = 0xea60` (60,000) into a segment from the allocator `lcall 0x131e,0x1de0`. On disk
BH_CONV.DAT is the 13-byte magic `SOLAR WINDS\x1a\x1a` followed by **16** u16 record offsets whose
count is implied by the first entry ((45 − 13)/2 = 16, verified ascending); pictures a node
selects are decoded later by `0x24ff4` (stone, and that is the one path that really does seek).
`loadConversation` returns the raw blob plus the parsed offset table, and asserts nothing about
64,001.

The war-report loader picks its file at run time (`0x268fc`): BH_WR.DAT when `[0x3ade] == 1`,
PAGE.DAT otherwise — same slot-19 file, same wind decoder at `0x2695f`. `0x2697c` also has a
conditional 24-row × 45-word copy from `[0x6b9d]:0x8fff` into the frame at `0xdce5` (a mask
overlay, not decoded here), and `0x269ce`/`0x269e1` write `0xb4` from `A000:FA00` with a wrapping
`di` (an engine over-write into the next 64 KiB; harmless on a real VGA segment, omitted in the port).

### 4. Open / not covered

- **PAGE.DAT is not in `web/data/`** (it is in the archive root, 14,404 B, and decodes to 64,001
  wind when read from there). Slot 19 and the WR `altFile` will 404 until the file is copied.
- Struct layouts for the raw slots: OBJ (15,072), PIC (26,086), EXPL, MIS, SML, SHD, VFD, IORD.
  `0x2fe95`'s zero-skipping copy and `0x2fc4f`'s drive-letter fixup are the only shape hints.
- Why BH_IMP is opened but read only 80 bytes here (`0x2f894`) — the rest must come from
  `FUN_231e_6475 @0x29655`, which also opens it.
- Record *placement*: MW2P's `0x2a2a5` blits take their `di` from data-segment constants
  (`0x3da1`, `0x4cf7`, `0xbc24`, `0x8eef`) selected by the `[0x4d64]` timer — those hotspots are
  script/level data, not loader data, and are out of scope for `screens.js`.
- `BH_MU*` (`CTMF`), `BH_INT*` (overlay path `lcall 0x131e,0x2f1f`) and `BH_PEOP` (77,529 B, over
  any read cap) remain unwired.

