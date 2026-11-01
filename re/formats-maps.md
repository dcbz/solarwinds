# Map-zone art files (BH_MW1A/1B/2A/2B/2P/3A/3B) — framing

Question: destination segment:offset, image size, and whether a header/trailer explains why
whole-file RLE decode overshoots 64,000 bytes.
Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`
(dos-mz, x86 real mode, load seg 0x1000, DS segment 0x1019, file→linear delta `0xf200`).

## Status legend
O observed (disassembly/bytes on disk) · D derived (arithmetic from O) · I inferred · ? unknown

## Plan (in order)
1. Reuse `re/work/f_29f90.asm` + `f_2a2a5/f_2aef0/f_2af72/f_2566f/f_268e8/f_2d44d.asm` — do NOT
   re-dump. Read the three loaders `0x29f90` / `0x2a362` / `0x2a786` for open/read/decode/copy.
2. Resolve the filename pointers (`lea dx,[0x68xx/0x69xx]`) against the name table bytes
   (`re/work/x86.py` + direct byte read) → which file each `INT 21h` open actually names.
3. Decode each MW* file with the settled RLE rule, **stopping the destination counter at 64,000**,
   and record the source offset where 64,000 is reached → that is the image/trailer boundary.
   Hexdump what follows.
4. Edit this doc after every 2–3 findings. Last 5 minutes reserved for the Unknown section.

## Already known (from re/, before this pass)
- RLE rule (settled, `0x250fe–0x25122`, also present verbatim at `0x2a023` and `0x2a146`):
  literal byte copied; `FF n v` → n copies of v; `n==0` ⇒ zero copies ⇒ `FF 00 xx` = literal `0xFF`. **O**
- Screen is 320×200×8bpp (INT 33h ranges 0..638 / 0..200, `0x24ff4`, `ev_c1259400cf6f6c98…`) ⇒
  one frame = 64,000 bytes. **O**
- Whole-file RLE decode lengths (local tool, not REA): MW2A 64,744 · MW2B 68,783 · MW1A 70,851 —
  all >64,000. **D**
- Loader→file map (`re/loader_map.md`): `0x29f90` = zone 1 (BH_MP1 + BH_PAL + BH_MW1A),
  `0x2a362` = zone 2 (BH_MP2 + PAL + MW2A + MW2B + MW2P), `0x2a786` = zone 3 (BH_MP3 + PAL + MW3A + MW3B). **D**

## Findings this pass

### F1 — O  decompress destination is a far scratch segment, then a hard 64,000-byte copy to `A000:0`
`re/work/f_29f90.asm`:
- `0x29ff0` `mov ah,0x3f / mov cx,0xc350 / push ds / mov dx,[0x6ba3] / mov ds,dx / mov dx,0 / int 0x21`
  → compressed file is read **raw from offset 0**, up to **50,000 bytes**, into `seg[0x6ba3]:0000`.
  `0x2a002 mov [0x4577],ax` keeps the actual byte count.
- `0x2a00e–0x2a047` RLE decode: source `ds = [0x6ba3]:0`, dest `es = [0x6b9f]:0`, both offsets 0,
  loop bounded by the *compressed* length (`cmp di,dx; ja`) — no header, no per-record length.
- `0x2a04d` `mov ax,0xa000 / mov es,ax` … `0x2a05b mov cx,0xfa00 / 0x2a05e rep movsw`
  → **the image is 64,000 bytes copied from `[0x6b9f]:0` to the VGA mode-13h framebuffer `A000:0000`.**
- Same triple appears again for the second MW file at `0x2a113` (read) / `0x2a131` (decode) /
  `0x2a175` `mov ax,0xa000` / `0x2a183 mov cx,0xfa00` `rep movsw`.
- The decoder does **not** stop at 64,000: it keeps writing past the frame into the scratch buffer.
  Only the `rep movsw` (capped at `0xfa00`) limits what reaches video. **D**

### F2 — O  the four open sites in `0x29f90` resolve to BH_MP1, BH_PAL, BH_MW1A, BH_MW1B
Name pointers are direct references into the `$`-delimited/NUL-terminated name table in the data
segment (verified by reading the EXE bytes at `linear = 0x10190 + ds_offset`, file offset
`linear - 0xf200`):

| site | `lea dx,[imm]` | linear | file off | string |
|---|---|---|---|---|
| `0x29fac` | `[0x6841]` | 0x169d1 | 0x77d1 | `BH_MP1.DAT` |
| `0x29fe3` | `[0x6955]` | 0x16ae5 | 0x78e5 | `BH_MW1A.DAT` |
| `0x2a106` | `[0x6962]` | 0x16af2 | 0x78f2 | `BH_MW1B.DAT` |
| `0x2a24c` | `[0x693f]` | 0x16acf | 0x78cf | `BH_PAL.DAT` |

So zone 1 loads **both** MW1A and MW1B (`re/loader_map.md` row for `0x29f90` is incomplete), and
restores `BH_PAL.DAT` on exit. The palette reads (`BH_MP1` @`0x29fa8`, `BH_PAL` @`0x2a243`) go to
the BSS buffer `DS:0xb380` and are then `shr 1` ×2 over `di = 0..0x2ff` → raw 768 B of 8-bit RGB
converted to 6-bit DAC values. **O** (no header on palette files either.)

### F3 — D  one image = **64,000 bytes = 320×200×8bpp, dest `A000:0000` (linear 0xA0000)**
`rep movsw` with `cx = 0xfa00` (64,000 B) from `seg[0x6b9f]:0` to `es = 0xa000`, `di = 0`
at `0x2a04d–0x2a05e` (MW1A) and `0x2a175–0x2a186` (MW1B). Both MW files are **full frames** to the
same address, one after the other (frame 1 = MW1A, frame 2 = MW1B, alternated by the timed loop at
`0x2a06f`/`0x2a18e` which also XOR-swaps pixel pairs in VRAM for the shimmer effect).

### F4 — O  THE OVERSHOOT IS AN OFF-BY-ONE IN THE RUN TOKEN, NOT A HEADER OR TRAILER
The map-zone decoder (`0x2a035–0x2a047`, identical `dec si / dec ch` prologue as `0x25110`) tests
**`cmp ch, 0`** (`80 fd 00`), whereas the picture decoder at `0x25110–0x25122` tests
**`cmp ch, 0xff`** (`80 fd ff`). With `dec ch` executed first this means:

| decoder | exit test | `FF n v` emits | `FF 00 v` emits |
|---|---|---|---|
| `0x250fe` (`0x24ff4` picture loader) | `ch == 0xFF` | n copies | 0 copies (no-op) |
| `0x2a023`/`0x2a146` (map-zone loaders) | `ch == 0` | **n − 1 copies** | 255 copies (wrap) |

Decoding every art file with the **n − 1** rule (run length = `n − 1`, so `FF 01 v` is a 3-byte
no-op) consumes the *entire* file and yields **exactly 64,001 bytes** for MW1A, MW1B, MW2A, MW2B,
TITLE, EPIC, SEQ, ORD, WR. The 64,001st byte is the engine's own tail-effect: the loop test is
`inc di` then `cmp di, dx / ja end`, so it also processes `src[dx]` — one byte *past* the buffer —
and writes one extra byte that the 64,000-byte `rep movsw` discards. **D** (local byte arithmetic
over the shipped streams; the disassembly cells above are O).

Token census, all art files: **zero `FF 00` sequences** (`grep` of every `.DAT`) ⇒ the `FF 00`
case is never exercised, so both decoders agree on the *encoding* and differ only by one emitted
byte per token. That is exactly the ~0.2 k–6.9 k overshoot recorded in `re/FINDINGS.md`.

| file | compressed | tokens | n−1 decode | bytes to reach 64,000 under n-rule |
|---|---|---|---|---|
| BH_MW1A | 42,868 | 6,850 | **64,001** | 41,175 (1,693 B left) |
| BH_MW1B | 9,886 | 1,551 | **64,001** | 9,694 (192 B left) |
| BH_MW2A | 2,800 | 743 | **64,001** | 2,791 (9 B left) |
| BH_MW2B | 36,890 | 4,782 | **64,001** | 35,347 (1,543 B left) |
| BH_MW2P | 5,883 | 604 | 15,613 | never (not a frame) |
| BH_MW3A | 30,387 | 2,924 | 38,979 | never |
| BH_MW3B | 25,298 | 2,645 | 38,967 | never |

**Verdict on the header/trailer question: neither.** There is no header (the read starts at file
offset 0 with `mov dx,0` and the decode starts at `si=di=0`) and no trailer — the whole file is one
RLE stream. The ~64.2 k–70.9 k figures were produced by applying the wrong (n copies) rule.
MW2P / MW3A / MW3B decode to far less than 64,000 and are therefore *not* full frames — see F5.

## Unknown / to confirm
- Exact identity of the four `lea dx,[0x6841] [0x693f] [0x6955] [0x6962]` name pointers in `0x29f90`.
- Whether `[0x6b9f]`/`[0x6ba3]` are fixed segments or allocated (find their initializers).
- Nature of the trailer after the 64,000th decoded byte.
- Whether the 50,000-byte read cap truncates any MW file (file sizes?).
