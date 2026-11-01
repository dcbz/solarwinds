# engine-video — screen output path (lane 3)

Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`
Provider: Ghidra 12.1.4 via REA 6.7.0. Corpus `re/decomp/SOLAR1.c`, local helpers `re/work/x86.py`,
`re/work/bytesearch.py` (from the 0xb68c lane). Output of this pass: `re/work/video/`.

**Epistemic caveat (applies to every row below):** this is static analysis of a real-mode DOS .COM/.EXE.
Nothing here was executed. DOSBox was not run and no int/port was traced at runtime. Port-immediate
findings are *code observations*, not runtime observations.

## Question contract (narrowed)

- (a) Which real-mode address holds the 320x200 framebuffer — is the ES-based destination in
  `0x24ff4` + its `+0x620` second stage `A000:0000`, or a RAM scratch page later copied to video?
- (b) Of the 11 `INT 10h` sites: which set a mode, which set palette (AX=1012h) / block / cursor.
  Address + AX value each.
- (c) Palette programming: direct `OUT` to 0x3c8/0x3c9 (imm search + OUT ops), and where the five
  768-byte palette files (BH_PAL, BH_EPAL, BH_MP1..3) get pushed to the DAC.

Deliverable: implementable spec for a JS renderer (framebuffer coords, mode, palette-swap sequence,
flip/vsync wait).

## Known facts inherited from FINDINGS.md / loader_map.md (before this lane's work)

| fact | status |
|---|---|
| 320x200x8bpp; INT 33h ranges 0..638 x 0..200 from `0x24ff4` | O (`ev_c1259400cf6f6c98…`) |
| `0x24ff4` (`FUN_231e_1e14`) is picture/anim loader + script interp; RLE dest is ES-based | O |
| Second stage of that loader: 15 (or 9 if `0x70e1==1`) skips, dest segment `+0x620` | O |
| INT census: INT 10h x11, INT 33h x108, INT 16h x48, INT 1Ah x1 | D (corpus grep) |
| Palettes are raw 256x3 8-bit = 768 B (BH_PAL, BH_EPAL, BH_MP1..3) | O |
| Per-zone palettes: MP1/MP2/MP3 each loaded with BH_PAL by `0x29f90`/`0x2a362`/`0x2a786` | O |
| RLE rule: literal; `FF n v` -> n copies of v; `FF 00 xx` -> literal 0xFF | D |
| Decoded picture streams run 64.2k-70.9k B, i.e. >= one 64000 B frame | D |

## Working plan

1. Locate every `INT 10h` (`cd 21 cd 10`) in the image with `bytesearch.py`; dump ±20 B window;
   disassemble with `x86.py`; recover the AX value by backward constant trace.
2. Locate `0x3c8` / `0x3c9` / `0x3c6` / `0x3ce` / `0x3b8`/`0x3d4` (CRTC) immediates; find OUT ops.
3. Determine the framebuffer: back-trace the ES segment base used by `0x24ff4`'s destination;
   check for `A000` (0xa0000) anywhere as an immediate or segment load; check for a `0x620`-word
   (=6272 B?) / `+0x620` segment arithmetic.
4. Write the renderer spec section.
5. Last 5 min: enumerate Unknowns.

## Findings

(pending — filled in below as each grep/disassembly lands)

## Unknowns

(tracked live)
