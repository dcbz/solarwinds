// Solar Winds — the three map-zone loaders (lane B).
//
//   FUN_231e_6db0 @0x29f90  zone 1  BH_MP1 palette + BH_MW1A frame + BH_MW1B frame + tear effect
//   FUN_231e_7182 @0x2a362  zone 2  BH_MP2 palette + BH_MW2A frame + BH_MW2B frame + BH_MW2P strips
//   FUN_231e_75a6 @0x2a786  zone 3  BH_MP3 palette + BH_MW3A/MW3B animation records over a cleared screen
//
// They are **not** map *view*s. Each one is a self-contained, modal, timed sequence — a cutscene
// player with its own frame loop, its own PIT-paced clock, its own palette fade and its own caption
// calls — entered once from the script engine and left by `retf`:
//
//   lcall 0x131e,0x6db0 @0x2d6d3   opcode 4, first time  (inc [0xbaf4]; cmp [0xbaf4],1)
//   lcall 0x131e,0x7182 @0x2d6ee   opcode 0xb, 2nd time  (inc [0xbaf5]; cmp [0xbaf5],2)
//   lcall 0x131e,0x75a6 @0x2d5fb   opcode 0xe            (bx == 0xe; the arm then reaches int 21h/4Ch)
//
// Everything below is a transcription of those three bodies plus the two blit helpers they call
// (0x2a2a5, 0x2a2e2) and the two DAC-ramp helpers (0x2aef0, 0x2af72). Addresses are linear byte
// coordinates (file offset + 0xf200); DS globals are given as `DS:0x…` with the port's flat form
// (DS + 0x10000) in FIELDS. Evidence: re/zones.md.
//
// THE SEEK QUESTION, ANSWERED. `re/formats-modes.md`/`re/FINDINGS.md` once claimed MW2P/MW3A/MW3B
// are "multi-record containers walked by INT 21h/42h seek". There is no seek in any of the three
// loaders: a byte scan for `b4 42` finds exactly two lseek sites in the whole EXE, 0x250b9 and
// 0x2515f, both inside the picture loader 0x24ff4. What was mistaken for a seek is the *next file's
// OPEN* (`0x2a4ee` = BH_MW2P, `0x2a84c` = BH_MW3B). The framing is in the DECODED buffer and the
// blits state it explicitly: a record is `<u8 width><u8 height><width*height indices>` and the walk
// step is `2 + w*h` —
//   @0x2a312  mov al,[si] / mov cl,[si+1] / mul cx / add ax,2 / add si,ax   (skip one record)
//   @0x2a328  mov cl,[si] / mov bl,[si+1] / add si,2 / rep movsb / add di,0x140 / sub di,dx (paint)
//   @0x2a2bb  mul 0x7eb / add si,0x1772                                    (MW2P: 8 x (2+45*45))
// which is why those three files decode *short* of 64,000: they are record lists, not planes. The
// variant also differs — records use the stone rule (`cmp ch,0xff` @0x2a54d/@0x2a83a/@0x2a8ab),
// frames use the wind rule (`cmp ch,0` @0x2a03e/@0x2a161/@0x2a410/@0x2a4dc). Under stone each of the
// three streams walks to exactly `decoded - 1` bytes, the last byte being the engine's over-read.

import { decodeRLE, decodeFrame, FRAME_BYTES, type Variant } from '../rle.ts';
import { WIDTH, HEIGHT } from '../framebuffer.ts';

// --- frame clock ---------------------------------------------------------------
// Every loop tail is the same five instructions: latch PIT counter 2 (`out 0x43,0x80`), spin until
// its down-count has passed below zero and reads back above 0x8ca0, reprogram it (mode 0, 36000),
// and silence the speaker (`out 0x61,1`). One pass = 36000 / 1.1931816 MHz.
export const PIT_CH2 = 0x8ca0; // @0x2a0d4 / @0x2a451 / @0x2a704 / @0x2a9f8 `cmp bx,0x8ca0`
export const FRAME_MS = (36000 / 1193181.6666) * 1000; // 30.17 ms -> 33.14 passes per second
export const FRAME_HZ = 1193181.6666 / 36000;

// --- the descriptor block and the scratch arena -------------------------------
// The arena segments are a chain off DS:0x6b8b built by the boot dispatcher @0x2f6f5..@0x2f716:
//   [0x6b93] = [0x6b8f] = [0x6b9d] = [0x6ba1] = [0x6b9f] = base
//   [0x6b99] = base + 0x1000        (@0x2f707 add ax,0x1000)
//   [0x6b97] = base + 0x1ea6        (@0x2f70d add ax,0xea6)
//   [0x6ba3] = base + 0x24cd        (@0x2f713 add ax,0x627)
// so the frame scratch (0x6b9f) and MW3B's plane (0x6ba1) are the *same* 64 KB page, and MW3A lives
// one page above it. Zone 3 therefore destroys the last loaded frame on purpose.
export const ARENA = {
  base: 0x16b8b, // DS:0x6b8b — set by FUN_231e_0677 @0x2385e from the allocator
  frame: 0x16b9f, // DS:0x6b9f — 320x200 scratch page, the `rep movsw` source
  page2: 0x16b99, // DS:0x6b99 — zone 3 MW3A's decoded plane
  compressed: 0x16b97, // DS:0x6b97 — zone 3's raw read buffer (cx = 0xffff)
  strips: 0x16ba3, // DS:0x6ba3 — zone 1/2 raw read buffer AND MW2P's in-place decode
};

export const FIELDS = {
  frameCounter: 0x14d64, // DS:0x4d64 — the per-loader tick counter every timed op is compared to
  bytesRead: 0x14577, // DS:0x4577 — INT 21h/3Fh return count, the decode loop's bound dx
  segTemp: 0x14552, // DS:0x4552 — segment hop used by the cx=0xffff reads
  recordIndex: 0x1baf6, // DS:0xbaf6 — zone 3's record cursor, inc'd by the blit @0x2a356
  mouseFlag: 0x10000, // DS:0x0000 — INT 33h presence; gates the cursor hide/show @0x29f97/@0x2a291
  stateByte: 0x13c91, // DS:0x3c91 — written 1 by all three loaders on the way out
  paletteBuf: 0x1b380, // DS:0xb380 — 768 B of 8-bit RGB, halved twice in place
  dacTable: 0x1b68c, // DS:0xb68c — 768 B of 6-bit DAC values, the ramp's target
};

export const PALETTE_READ = 0xc350; // @0x29fb9 / @0x2a38b / @0x2a7b1 `mov cx,0xc350`
export const FRAME_READ = 0xc350; // @0x29ff2 zone 1, @0x2a3c4/@0x2a490 zone 2, @0x2a73c restore
export const RECORD_READ = 0xffff; // @0x2a501 (MW2P), @0x2a7ee (MW3A), @0x2a85f (MW3B)
export const COPY_WORDS = 0xfa00; // @0x2a05b / @0x2a183 / @0x2a42d / @0x2a56f `mov cx,0xfa00`

// The name pointers, resolved against the data-segment name table (re/name_table.json).
export const NAMES: Record<string, { ds: number; linear: number }> = {
  'BH_MP1.DAT': { ds: 0x6841, linear: 0x169d1 }, // @0x29fac
  'BH_MP2.DAT': { ds: 0x684d, linear: 0x169dd }, // @0x2a37e
  'BH_MP3.DAT': { ds: 0x6859, linear: 0x169e9 }, // @0x2a7a2
  'BH_MW1A.DAT': { ds: 0x6955, linear: 0x16ae5 }, // @0x29fe3
  'BH_MW1B.DAT': { ds: 0x6962, linear: 0x16af2 }, // @0x2a106
  'BH_MW2A.DAT': { ds: 0x696f, linear: 0x16aff }, // @0x2a3b5
  'BH_MW2B.DAT': { ds: 0x697c, linear: 0x16b0c }, // @0x2a481
  'BH_MW3A.DAT': { ds: 0x6989, linear: 0x16b19 }, // @0x2a7df
  'BH_MW3B.DAT': { ds: 0x6996, linear: 0x16b26 }, // @0x2a850
  'BH_MW2P.DAT': { ds: 0x69a3, linear: 0x16b33 }, // @0x2a4f2
  'BH_PAL.DAT': { ds: 0x693f, linear: 0x16acf }, // @0x2a24c / @0x2a72d / @0x2aa21 (restore)
};

// --- palette ------------------------------------------------------------------
// The loaders do not call INT 10h/1012h. Two helpers ramp the DAC **through ports 0x3c8/0x3c9**, one
// palette entry at a time, 64 vsync-synchronised passes:
//   FUN_231e_7d92 @0x2af72  fade OUT  — @0x2af9c `cmp bl,[es:di] / je dec` drops every DAC byte that
//                                     currently equals the pass threshold (64 down to 1) by one.
//   FUN_231e_7d10 @0x2aef0  fade IN   — INT 10h/1017 snapshots the hardware palette to DS:0xb68c,
//                                     762 of those bytes are zeroed (@0x2af1b), then @0x2af29
//                                     `cmp bl,[si] / jns / inc byte es:[di]` bumps every byte whose
//                                     DS:0xb380 value exceeds the threshold. Ends at (v>>2) - 1.
// Both then push 254 entries out of DS:0xb68c after waiting for vsync (0x3DA bit 3, @0x2af3f), so a
// full fade is 64 passes of the ramp loop, not 64 frame ticks.
export const FADE_PASSES = 0x40; // @0x2af1f / @0x2af93 `mov cx,0x40`
export const RAMP_BYTES = 0x2fa; // @0x2af12 / @0x2af90 `mov ax,0x2fa` — 762 of 768 bytes walked
export const DAC_ENTRIES = 0xfe; // @0x2af38 / @0x2afa8 `mov cx,0xfe` — colours 0..253 reach the port

/** The settled fade-in end state: each component is (v >> 2) - 1, floored at 0. */
export function dacOf(rgb: Uint8Array): Uint8Array {
  const dac = new Uint8Array(768);
  for (let i = 0; i < 768; i++) {
    const v = rgb[i] >> 2; // the two `shr byte,1` at @0x29fd0/@0x29fd4
    dac[i] = v > 0 ? v - 1 : 0;
  }
  return dac;
}

/** The 64 DAC tables the fade-in ramp puts on the screen, in order (step 0 = black). */
export function dacRampIn(rgb: Uint8Array): Uint8Array[] {
  const pal = new Uint8Array(RAMP_BYTES);
  for (let i = 0; i < RAMP_BYTES; i++) pal[i] = rgb[i] >> 2;
  return rampCore(pal, 'in');
}

/** The 64 DAC tables of a fade-out from an arbitrary starting palette. */
export function dacRampOut(start: Uint8Array): Uint8Array[] {
  const dac0 = start.length === 768 && Math.max(...start) <= 63 ? start : dacOf(start);
  return rampCore(dac0, 'out');
}

function rampCore(source: Uint8Array, mode: 'in' | 'out'): Uint8Array[] {
  const dac = new Uint8Array(768); // @0x2af1b zeroed (fade-in) or the snapshot (fade-out)
  if (mode === 'out') dac.set(source.subarray(0, 768));
  const steps: Uint8Array[] = [];
  for (let pass = 0; pass < FADE_PASSES; pass++) {
    const bl = FADE_PASSES - pass; // `mov bl,cl` with cl counting 64..1
    for (let k = 0; k < RAMP_BYTES; k++) {
      if (mode === 'in') {
        if (source[k] > bl) dac[k] = Math.min(63, dac[k] + 1); // @0x2af2d
      } else if (dac[k] === bl) {
        dac[k] = Math.max(0, dac[k] - 1); // @0x2afa1
      }
    }
    steps.push(dac.slice()); // 254 of these bytes go out to 0x3c8/0x3c9 @0x2af4e
  }
  return steps;
}

/** 6-bit DAC table -> 768 B of 8-bit RGB for the port's `Framebuffer.lut` convention. */
export function dacToRgb(dac: Uint8Array): Uint8Array {
  const rgb = new Uint8Array(768);
  for (let i = 0; i < 768; i++) rgb[i] = (dac[i] & 0x3f) << 2;
  return rgb;
}

// --- record framing (the non-frame streams) ------------------------------------
export interface ZoneRecord {
  width: number;
  height: number;
  offset: number; // byte offset of the pixel data inside the decoded stream
  pixels: Uint8Array;
}

/**
 * The walk the blits perform: `<u8 w><u8 h>` then w*h indices, step 2 + w*h (@0x2a312). `start` is
 * where record 0's header sits — MW2P decodes *in place* at 0x1770 into its own read buffer, so its
 * records are addressed from there (@0x2a2bb `add si,0x1772` == header 0x1770 + 2).
 */
export function walkZoneRecords(stream: Uint8Array, start = 0): ZoneRecord[] {
  const records: ZoneRecord[] = [];
  let off = start;
  while (off + 2 <= stream.length) {
    const width = stream[off]; // @0x2a312 mov al,[si]
    const height = stream[off + 1]; // @0x2a32b mov bl,[si+1]
    if (width === 0 || height === 0) break;
    const end = off + 2 + width * height;
    if (end > stream.length) break;
    records.push({ width, height, offset: off + 2, pixels: stream.subarray(off + 2, end) });
    off = end;
  }
  return records;
}

/** A record painted at a VRAM byte offset, `rep movsb` + `add di,0x140 / sub di,dx` (@0x2a344). */
export function blitRecord(vram: Uint8Array, rec: ZoneRecord, dest: number): void {
  for (let row = 0; row < rec.height; row++) {
    const src = row * rec.width;
    vram.set(rec.pixels.subarray(src, src + rec.width), dest + row * WIDTH); // row stride 0x140
  }
}

// --- zone 1's "tear" (@0x2a06f..@0x2a0c2) --------------------------------------
// Not an XOR swap. Per row it zeroes two centre pixels and then walks two cursors apart, each step
// copying the neighbour one column further out, so the artwork on either side of a black seam slides
// outward by one pixel per pass and the seam grows 2 px per frame. 51 steps over 85 rows.
export const TEAR = {
  from: 101, // @0x2a06f `cmp [0x4d64],0x64 / jbe` — inactive at and below 100
  to: 251, // @0x2a076 `cmp [0x4d64],0xfb / ja`
  left0: 0x47eb, // @0x2a07f — row 57, col 171
  right0: 0x47ee, // @0x2a082 — row 57, col 174 (so the zeroed seam is cols 172/173)
  steps: 0x33, // @0x2a0ae `cmp dl,0x33` — 51 swaps per row
  rows: 0x56, // @0x2a0bf `cmp dh,0x56` — 85 rows, 57..141
  rowAdvance: 0x140, // @0x2a0b3 `add di,0x173` / @0x2a0b7 `add si,0x10d`, both == +320 net
};

export function tearPass(vram: Uint8Array): void {
  for (let row = 0; row < TEAR.rows - 1; row++) {
    let di = TEAR.left0 + row * TEAR.rowAdvance;
    let si = TEAR.right0 + row * TEAR.rowAdvance;
    // @0x2a088..@0x2a095: the two seam pixels are read out and zeroed before the walk starts.
    const left = vram[di + 1];
    const right = vram[si - 1];
    vram[di + 1] = 0;
    vram[si - 1] = 0;
    let al = left;
    let ah = right;
    for (let k = 0; k < TEAR.steps; k++) {
      // @0x2a09a..@0x2a0a9: cl/ch read the *current* neighbour, then the carried pixels are written.
      const cl = vram[di];
      const ch = vram[si];
      vram[di] = al;
      vram[si] = ah;
      al = cl;
      ah = ch;
      di--; // @0x2a0aa dec di — the left cursor walks down (toward col 121)
      si++; // @0x2a0ab inc si — the right cursor walks up   (toward col 224)
    }
  }
}

// --- the loader bodies, as data -----------------------------------------------
export type ZoneOpKind =
  | 'fadeout' | 'fadein' | 'frame' | 'clear' | 'tear' | 'strip' | 'record'
  | 'caption' | 'erase' | 'scroll' | 'sound' | 'exit';

export interface ZoneOp {
  at: number; // the value of DS:0x4d64 that fires it (`cmp word [0x4d64],N`)
  op: ZoneOpKind;
  addr: number; // the instruction that performs it
  phase?: number; // zone 2 resets the counter mid-sequence (@0x2a57a): 0 or 1
  frame?: number; // index into the zone's frames[]
  record?: number; // strip/animation record index
  dest?: number; // VRAM byte offset
  text?: string; // DS address of the `$`-delimited caption record
  n?: number; // scroll steps added per frame from here on
}

export interface ZoneSpec {
  zone: number;
  loader: number;
  enteredAt: number; // the lcall site in FUN_231e_a26d that reaches this loader
  paletteFile: string;
  paletteOpenAt: number;
  frames: { file: string; variant: Variant; readBytes: number; openAt: number; decodeAt: number; copyAt: number }[];
  records: { file: string; variant: Variant; readBytes: number; openAt: number; decodeAt: number; start: number; plane: 'strips' | 'page2' | 'frame' }[];
  blit: number; // the helper that paints the records
  ops: ZoneOp[];
  restoreOpenAt: number;
  totalFrames: number;
  exitAddr: number;
  tailAddr: number; // `mov byte [0x3c91],1` — the state byte the loader hands back
}

export const ZONES: Record<number, ZoneSpec> = {
  1: {
    zone: 1,
    loader: 0x29f90,
    enteredAt: 0x2d6d3,
    paletteFile: 'BH_MP1.DAT',
    paletteOpenAt: 0x29fa8,
    frames: [
      { file: 'BH_MW1A.DAT', variant: 'wind', readBytes: FRAME_READ, openAt: 0x29fdf, decodeAt: 0x2a03e, copyAt: 0x2a04d },
      { file: 'BH_MW1B.DAT', variant: 'wind', readBytes: FRAME_READ, openAt: 0x2a102, decodeAt: 0x2a161, copyAt: 0x2a175 },
    ],
    records: [],
    blit: 0,
    ops: [
      { at: 0, op: 'fadeout', addr: 0x29fa3 },
      { at: 0, op: 'frame', frame: 0, addr: 0x2a04d },
      { at: 0, op: 'fadein', addr: 0x2a061 },
      { at: 50, op: 'caption', text: 'DS:0x570a', dest: 0xca3, addr: 0x2a19f },
      { at: TEAR.from, op: 'tear', addr: 0x2a06f, n: TEAR.to - TEAR.from + 1 },
      { at: 170, op: 'erase', dest: 0xca3, addr: 0x2a1b3 },
      { at: 180, op: 'caption', text: 'DS:0x5742', dest: 0xca3, addr: 0x2a1c6 },
      { at: 270, op: 'frame', frame: 1, addr: 0x2a175 }, // MW1B, no fade — straight replacement
      { at: 280, op: 'erase', dest: 0xca3, addr: 0x2a1da },
      { at: 290, op: 'caption', text: 'DS:0x5777', dest: 0xca3, addr: 0x2a1ed },
      { at: 370, op: 'erase', dest: 0xca3, addr: 0x2a201 },
      { at: 400, op: 'exit', addr: 0x2a243 },
    ],
    restoreOpenAt: 0x2a24c,
    totalFrames: 400, // @0x2a20c `cmp [0x4d64],0x190 / je 0x2a243`
    exitAddr: 0x2a243,
    tailAddr: 0x2a282,
  },
  2: {
    zone: 2,
    loader: 0x2a362,
    enteredAt: 0x2d6ee,
    paletteFile: 'BH_MP2.DAT',
    paletteOpenAt: 0x2a37a,
    frames: [
      { file: 'BH_MW2A.DAT', variant: 'wind', readBytes: FRAME_READ, openAt: 0x2a3b1, decodeAt: 0x2a410, copyAt: 0x2a41c },
      { file: 'BH_MW2B.DAT', variant: 'wind', readBytes: FRAME_READ, openAt: 0x2a47d, decodeAt: 0x2a4dc, copyAt: 0x2a55e },
    ],
    records: [
      // MW2P is read into the same segment it is decoded into (@0x2a505 ds = [0x4552] = [0x6ba3],
      // @0x2a523 es = [0x6ba3], @0x2a52f `mov si,0x1770`) — an in-place decode that is safe only
      // because the 5883 compressed bytes all sit below the 6000-byte write frontier.
      { file: 'BH_MW2P.DAT', variant: 'stone', readBytes: RECORD_READ, openAt: 0x2a4ee, decodeAt: 0x2a54d, start: 0x1770, plane: 'strips' },
    ],
    blit: 0x2a2a5,
    ops: [
      { at: 0, op: 'fadeout', addr: 0x2a375 },
      { at: 0, op: 'frame', frame: 0, addr: 0x2a41c },
      { at: 0, op: 'fadein', addr: 0x2a433 },
      { at: 80, op: 'frame', frame: 1, addr: 0x2a55e, phase: 0 }, // MW2B: decoded at 0x2a4ac, copied only now
      { at: 80, op: 'fadeout', addr: 0x2a559, phase: 0 },
      { at: 0, op: 'fadein', addr: 0x2a575, phase: 1 },
      { at: 50, op: 'strip', record: 0, dest: 0x3da1, addr: 0x2a58b, phase: 1 },
      { at: 60, op: 'strip', record: 1, dest: 0x3da1, addr: 0x2a5a2, phase: 1 },
      { at: 80, op: 'strip', record: 0, dest: 0x4cf7, addr: 0x2a5b9, phase: 1 },
      { at: 80, op: 'strip', record: 0, dest: 0xbc24, addr: 0x2a5c1, phase: 1 },
      { at: 95, op: 'strip', record: 1, dest: 0xbc24, addr: 0x2a5d8, phase: 1 },
      { at: 95, op: 'strip', record: 0, dest: 0x8eef, addr: 0x2a5e0, phase: 1 },
      { at: 100, op: 'strip', record: 2, dest: 0xbc24, addr: 0x2a5f7, phase: 1 },
      { at: 100, op: 'strip', record: 1, dest: 0x4cf7, addr: 0x2a601, phase: 1 },
      { at: 115, op: 'strip', record: 2, dest: 0x3da1, addr: 0x2a616, phase: 1 },
      { at: 120, op: 'strip', record: 3, dest: 0x3da1, addr: 0x2a62d, phase: 1 },
      { at: 120, op: 'strip', record: 2, dest: 0x4cf7, addr: 0x2a635, phase: 1 },
      { at: 120, op: 'strip', record: 1, dest: 0x8eef, addr: 0x2a63d, phase: 1 },
      { at: 132, op: 'strip', record: 4, dest: 0x3da1, addr: 0x2a655, phase: 1 },
      { at: 132, op: 'strip', record: 3, dest: 0x4cf7, addr: 0x2a65d, phase: 1 },
      { at: 144, op: 'strip', record: 3, dest: 0xbc24, addr: 0x2a675, phase: 1 },
      { at: 144, op: 'strip', record: 4, dest: 0x4cf7, addr: 0x2a67d, phase: 1 },
      { at: 152, op: 'strip', record: 5, dest: 0x3da1, addr: 0x2a695, phase: 1 },
      { at: 152, op: 'strip', record: 4, dest: 0xbc24, addr: 0x2a69d, phase: 1 },
      { at: 164, op: 'strip', record: 6, dest: 0x3da1, addr: 0x2a6b5, phase: 1 },
      { at: 164, op: 'strip', record: 5, dest: 0x4cf7, addr: 0x2a6bd, phase: 1 },
      { at: 171, op: 'strip', record: 7, dest: 0x3da1, addr: 0x2a6d5, phase: 1 },
      { at: 171, op: 'strip', record: 2, dest: 0x8eef, addr: 0x2a6dd, phase: 1 },
      { at: 230, op: 'exit', addr: 0x2a724, phase: 1 },
    ],
    restoreOpenAt: 0x2a72d,
    totalFrames: 310, // 80 in phase 0 (@0x2a474) + 230 in phase 1 (@0x2a6ed)
    exitAddr: 0x2a724,
    tailAddr: 0x2a763,
  },
  3: {
    zone: 3,
    loader: 0x2a786,
    enteredAt: 0x2d5fb,
    paletteFile: 'BH_MP3.DAT',
    paletteOpenAt: 0x2a79e,
    frames: [],
    records: [
      { file: 'BH_MW3A.DAT', variant: 'stone', readBytes: RECORD_READ, openAt: 0x2a7db, decodeAt: 0x2a83a, start: 0, plane: 'page2' },
      { file: 'BH_MW3B.DAT', variant: 'stone', readBytes: RECORD_READ, openAt: 0x2a84c, decodeAt: 0x2a8ab, start: 0, plane: 'frame' },
    ],
    blit: 0x2a2e2,
    ops: [
      { at: 0, op: 'fadeout', addr: 0x2a799 },
      { at: 0, op: 'clear', addr: 0x2a8bf }, // @0x2a8bf `mov ax,0 / mov word es:[di],ax`, di to 0xfa00
      { at: 0, op: 'record', record: 0, dest: 0x3eb2, addr: 0x2a8d0 },
      { at: 0, op: 'fadein', addr: 0x2a8d3 },
      { at: 1, op: 'scroll', n: 2, addr: 0x2a8e5 },
      { at: 1, op: 'caption', text: 'DS:0xbaf7', dest: 0x668, addr: 0x2a8ef },
      { at: 90, op: 'caption', text: 'DS:0xbb2a', dest: 0x1928, addr: 0x2a902 },
      { at: 90, op: 'caption', text: 'DS:0xbb63', dest: 0x2328, addr: 0x2a90e },
      { at: 120, op: 'record', record: 1, dest: 0x3eb2, addr: 0x2a925 },
      { at: 125, op: 'record', record: 2, dest: 0x3eb2, addr: 0x2a92f },
      { at: 130, op: 'record', record: 3, dest: 0x3eb2, addr: 0x2a93a },
      { at: 135, op: 'record', record: 4, dest: 0x3eb2, addr: 0x2a945 },
      { at: 140, op: 'record', record: 5, dest: 0x3eb2, addr: 0x2a950 },
      { at: 145, op: 'record', record: 6, dest: 0x3eb2, addr: 0x2a95b },
      { at: 150, op: 'record', record: 7, dest: 0x3eb2, addr: 0x2a966 },
      { at: 190, op: 'scroll', n: 1, addr: 0x2a97e }, // 0x2a976 `cmp [0x4d64],0xbe / jb`
      { at: 220, op: 'scroll', n: 1, addr: 0x2a971 }, // 0x2a969 `cmp [0x4d64],0xdc / jb`
      { at: 250, op: 'scroll', n: 1, addr: 0x2a98b },
      { at: 270, op: 'scroll', n: 1, addr: 0x2a998 },
      { at: 280, op: 'scroll', n: 2, addr: 0x2a9b7 },
      { at: 290, op: 'scroll', n: 2, addr: 0x2a9a5 },
      { at: 310, op: 'caption', text: 'DS:0xbb79', dest: 0x35e8, addr: 0x2a9c9 },
      { at: 310, op: 'caption', text: 'DS:0xbbb2', dest: 0x3fe8, addr: 0x2a9d5 },
      { at: 700, op: 'exit', addr: 0x2aa18 },
    ],
    restoreOpenAt: 0x2aa21,
    totalFrames: 700, // @0x2a9e1 `cmp [0x4d64],0x2bc`
    exitAddr: 0x2aa18,
    tailAddr: 0x2aa57,
  },
};

// Blit helper addresses, for the record: zone 2's strip blit indexes MW2P as
// `[0x6ba3]:0x1772 + al*0x7eb` (@0x2a2ac `mov cx,0x7eb` / @0x2a2bb `add si,0x1772`) and copies
// 0x2d x 0x2d bytes with row stride 0x140 (@0x2a2c4..@0x2a2d7); zone 3's record blit selects plane
// [0x6b99] for DS:[0xbaf6] 0..3 and [0x6ba1] for 4..7 (@0x2a2f1..@0x2a302), walks that many records
// and paints at the fixed VRAM offset 0x3eb2 = row 50, col 50 (@0x2a336), then increments the cursor
// (@0x2a356). Both are transcribed by blitRecord() above.
export const STRIP_BLIT = 0x2a2a5;
export const RECORD_BLIT = 0x2a2e2;
export const ZONE2_DESTS = { hotspot0: 0x3da1, hotspot1: 0x4cf7, hotspot2: 0xbc24, hotspot3: 0x8eef };
export const ZONE3_VIEWPORT = 0x3eb2;

// --- loading ------------------------------------------------------------------
export interface ZoneAssets {
  zone: number;
  spec: ZoneSpec;
  paletteFile: string;
  paletteRgb: Uint8Array; // 768 B as read, before the two `shr 1` (@0x29fc2)
  paletteDac: Uint8Array; // settled 6-bit DAC after the fade-in (@0x2aef0)
  fadeIn: Uint8Array[]; // the 64 ramp steps
  frames: { file: string; pixels: Uint8Array; decoded: number }[];
  records: { file: string; stream: Uint8Array; list: ZoneRecord[]; start: number }[];
}

export type Reader = (name: string) => Promise<Uint8Array>;

async function readCapped(read: Reader, file: string, cap: number): Promise<Uint8Array> {
  const buf = await read(file);
  return buf.length > cap ? buf.subarray(0, cap) : buf; // INT 21h/3Fh only ever fills cx bytes
}

/** Replays the load/open/read/decode sites of one zone loader. Touches no DOM. */
export async function loadZoneAssets(n: number, read: Reader): Promise<ZoneAssets> {
  const spec = ZONES[n];
  if (!spec) throw new Error(`zones: no zone ${n} (1..3)`);
  const paletteRgb = await readCapped(read, spec.paletteFile, PALETTE_READ);
  const frames: ZoneAssets['frames'] = [];
  for (const f of spec.frames) {
    const px = decodeFrame(await readCapped(read, f.file, f.readBytes), f.variant);
    frames.push({ file: f.file, pixels: px.pixels, decoded: px.decoded });
  }
  const records: ZoneAssets['records'] = [];
  for (const r of spec.records) {
    const stream = decodeRLE(await readCapped(read, r.file, r.readBytes), r.variant);
    records.push({ file: r.file, stream, list: walkZoneRecords(stream, r.start), start: r.start });
  }
  return {
    zone: n,
    spec,
    paletteFile: spec.paletteFile,
    paletteRgb,
    paletteDac: dacOf(paletteRgb),
    fadeIn: dacRampIn(paletteRgb),
    frames,
    records,
  };
}

// --- the per-frame sequence ---------------------------------------------------
export interface ZoneHooks {
  caption?: (record: string, vramOffset: number, addr: number) => void; // FUN_231e_31f1 @0x263d1
  erase?: (vramOffset: number, addr: number) => void; // FUN_231e_4af9 @0x27cd9
  scroll?: (steps: number, addr: number) => void; // FUN_231e_8443 @0x2b623
  sound?: (id: number, addr: number) => void; // FUN_231e_2ec9 @0x260a9 (zone 2 plays id 4 per group)
}

export interface ZoneOpTrace {
  op: ZoneOpKind;
  addr: number;
  detail: string;
}

/**
 * A zone sequence as the original runs it: `step()` is one PIT-paced pass of the loader's own loop,
 * i.e. one unit of DS:0x4d64. Ops are applied in table order, exactly as the straight-line `cmp`
 * chain in the loader evaluates them.
 */
export function createZonePlayer(assets: ZoneAssets, vram: Uint8Array, hooks: ZoneHooks = {}) {
  const spec = assets.spec;
  let phase = 0;
  let counter = 0;
  let scrollPerFrame = 0;
  let done = false;
  const recordCursor = { value: 0 }; // DS:0xbaf6, inc'd by the blit itself (@0x2a356)

  const recordAt = (index: number): ZoneRecord | null => {
    if (spec.zone !== 3) return null;
    const plane = index < 4 ? assets.records[0] : assets.records[1];
    return plane.list[index < 4 ? index : index - 4] ?? null;
  };

  function step(): ZoneOpTrace[] {
    const trace: ZoneOpTrace[] = [];
    if (done) return trace;
    for (const op of spec.ops) {
      if ((op.phase ?? 0) !== phase) continue;
      if (op.at !== counter) continue;
      switch (op.op) {
        case 'frame': {
          const f = assets.frames[op.frame ?? 0];
          vram.set(f.pixels.subarray(0, FRAME_BYTES), 0); // `rep movsw` cx=0xfa00 @op.addr
          trace.push({ op: 'frame', addr: op.addr, detail: `${f.file} -> A000:0000` });
          break;
        }
        case 'clear': {
          vram.fill(0);
          trace.push({ op: 'clear', addr: op.addr, detail: 'A000:0000..0xFA00 = 0' });
          break;
        }
        case 'tear': {
          // The table stores the whole active range as one op; the original re-applies it every
          // pass between 101 and 251 inclusive, so this branch runs on each of those ticks.
          for (let i = op.at; i <= (op.n ?? 0) + op.at - 1 && i <= counter + 1; i++) {
            /* consumed by the range check below */
          }
          tearPass(vram);
          trace.push({ op: 'tear', addr: op.addr, detail: `band rows ${57}..${57 + TEAR.rows - 2}, seam cols 172/173` });
          break;
        }
        case 'strip': {
          const rec = assets.records[0].list[op.record ?? 0];
          if (rec) {
            blitRecord(vram, rec, op.dest ?? 0);
            trace.push({ op: 'strip', addr: op.addr, detail: `MW2P[${op.record}] 45x45 -> A000:0x${(op.dest ?? 0).toString(16)}` });
          }
          if (hooks.sound) hooks.sound(4, 0x2a596);
          break;
        }
        case 'record': {
          const rec = recordAt(op.record ?? 0);
          if (rec) {
            blitRecord(vram, rec, ZONE3_VIEWPORT);
            recordCursor.value++;
            trace.push({ op: 'record', addr: op.addr, detail: `MW3${op.record! < 4 ? 'A' : 'B'}[${op.record! & 3}] ${rec.width}x${rec.height} -> A000:0x3eb2` });
          }
          break;
        }
        case 'caption': {
          if (hooks.caption) hooks.caption(op.text ?? '', op.dest ?? 0, op.addr);
          trace.push({ op: 'caption', addr: op.addr, detail: `${op.text} @A000:0x${(op.dest ?? 0).toString(16)}` });
          break;
        }
        case 'erase': {
          if (hooks.erase) hooks.erase(op.dest ?? 0, op.addr);
          trace.push({ op: 'erase', addr: op.addr, detail: `clear text box @A000:0x${(op.dest ?? 0).toString(16)}` });
          break;
        }
        case 'scroll': {
          scrollPerFrame += op.n ?? 1;
          if (hooks.scroll) hooks.scroll(op.n ?? 1, op.addr);
          trace.push({ op: 'scroll', addr: op.addr, detail: `+${op.n} scroll step(s)/frame (@0x2b623)` });
          break;
        }
        case 'fadeout':
        case 'fadein': {
          trace.push({ op: op.op, addr: op.addr, detail: `${spec.paletteFile} DAC ramp, 64 vsync passes` });
          break;
        }
        case 'exit': {
          done = true;
          trace.push({ op: 'exit', addr: op.addr, detail: `restore BH_PAL.DAT, DS:0x3c91 = 1, lcall 0x268e8` });
          if (phase === 0 && spec.ops.some((o) => o.phase === 1)) {
            phase = 1;
            counter = 0;
            done = false;
          }
          break;
        }
      }
    }
    if (!done) counter++;
    return trace;
  }

  return {
    step,
    get counter() { return counter; },
    get phase() { return phase; },
    get done() { return done; },
    get recordCursor() { return recordCursor.value; },
    get scrollPerFrame() { return scrollPerFrame; },
  };
}

// --- caption records ----------------------------------------------------------
// The `$`-delimited strings the loaders hand to FUN_231e_31f1 @0x263d1 with DI = a VRAM offset. They
// are constants of the loaded image (linear = 0x10190 + DS offset), not part of any .DAT, so the
// port can carry them verbatim. Zone 1's records begin with a 0x60 byte, which @0x263e7 treats as a
// drawing opcode rather than a glyph.
export const CAPTIONS: Record<string, { linear: number; text: string }> = {
  'DS:0x570a': { linear: 0x1589a, text: 'Someone is starting to interfere with our activities.' },
  'DS:0x5742': { linear: 0x158d2, text: 'Make sure that this problem is taken care of soon.' },
  'DS:0x5777': { linear: 0x15907, text: 'That is all.  You may leave.' },
  'DS:0xbaf7': { linear: 0x1bc87, text: 'You are instantly transported to the strange ship.' },
  'DS:0xbb2a': { linear: 0x1bcba, text: 'The soft green walls of the ship now transform, becoming' },
  'DS:0xbb63': { linear: 0x1bbf3, text: 'very hard and smooth.' },
  'DS:0xbb79': { linear: 0x1bc09, text: 'You can actually feel the power in the ship as it begins' },
  'DS:0xbbb2': { linear: 0x1bc42, text: 'to move toward your unknown destination.' },
};

// Caption destinations decoded as VRAM byte offsets, i.e. the same convention the two blits use for
// DI: 0xca3 = row 10 col 35, 0x668 = row 5 col 40, 0x1928 = row 20 col 40, 0x2328 = row 28 col 40,
// 0x35e8 = row 43 col 40, 0x3fe8 = row 51 col 40. FUN_231e_4af9 @0x27cd9 erases 10 such rows
// (`add di,0x140`, AL passes) before the next caption is drawn.
export function vramPos(offset: number): { row: number; col: number } {
  return { row: Math.floor(offset / WIDTH), col: offset % WIDTH };
}

export const SCREEN_BYTES = FRAME_BYTES;
export const SCREEN_ROWS = HEIGHT;

// TODO_CAPTION_GLYPHS@0x263d1: the loaders only *call* the text renderer; the glyph source (DS:0xb300
// attribute table + the `*0x40` index arithmetic at @0x2641f) is lane E's. Wiring needs
// `hooks.caption(record, vramOffset)` to draw and `hooks.erase(vramOffset)` to clear 10x320 rows.
// TODO_SCROLL@0x2b623: FUN_231e_8443 pans VRAM by DS:0x3c98 with a 78-entry table at DS:0xb117
// (count written at @0x2b623 = 0x4e). Zone 3 calls it 0..8 times per frame to accelerate a pan.
// The port must not guess it: it is the main map scroller, shared with state 1, not zone art.
