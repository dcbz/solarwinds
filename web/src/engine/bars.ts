// Solar Winds — FUN_231e_8043 @0x2b223, the crew-stat bar renderer.
//
// This is the routine that draws the engineering readout. Nothing in the panel is text: the eight
// subsystem levels DS:0x3c5e/60/62/64/66/68/6a/6c are painted as vertical bars directly into VRAM,
// and the labels/frames around them are baked into BH_PAN record 0 (see pages.ts). The renderer is
// incremental — it diffs each stat against a mirror array and only touches the pixels that changed —
// which is why the compositor calls FUN_231e_7e04 @0x2afe4 at its tail (@0x2b18f) to zero the
// mirrors so the next pump pass repaints the whole set. `clearBarMirrors` below is that half of
// 0x2afe4; the rest of it clears sprite/cursor slots that draw nothing.
//
// Verbatim source, `/usr/bin/python3 re/work/x86.py 0x2b223 0x2b3c8`:
//
//   02b223  cmp byte ptr [0x3c91], 2   ; 02b228 ja 0x2b269      -> only modes 0,1,2
//   02b22f  mov di,0xa000 / 02b232 mov es,di                    -> writes are ES:si, i.e. A000:0000
//   02b234  mov di,0  .. 02b24e add di,2 / 02b251 cmp di,0x10   -> eight stats
//   02b237  mov ax,[di+0x5c02] / 02b23b cmp ax,[di+0x3c5e]      -> mirror vs live
//   02b241  jb 0x2b26c (increase)      02b243 jmp 0x2b2318 (decrease)
//   02b246  mov [di+0x5c02],[di+0x3c5e]                        -> mirror adopts live on every path
//   02b289  mov si,0xa0ef   (mode != 1)  02b293 mov si,0xd934 (mode 1)
//   02b29d  mov si,0xaeaf              (mode 1 and DS:0x3ade sound on)
//   02b2a0  shr di,1 / mov ax,9 / mul di / add si,ax           -> one bar per stat, 9 px apart
//
// Decoding the three bases against the 320-byte pitch gives the geometry the mouse boxes agree with:
//   0xa0ef = col 239 row 128 (mode 2, ENGINEERING panel)   0xaeaf = col 239 row 139 (mode 1, sound)
//   0xd934 = col 244 row 173 (mode 1, map strip)
// FUN_231e_69f6 @0x29bd6 hit-tests the same eight columns at x = 0xee..0x136 (238..310, stride 9)
// with "+" on rows 0x53..0x6c (83..108) and "-" on rows 0x71..0x8a (113..138) — one row inside the
// bar band, which is the cross-check that the bases are right.
//
// The bar walks UP one row per unit (`sub si,0x140`) and every 37 units (`0x2e40` = 37*320) drops
// back to the column foot with the colour ramp four steps darker (`sub byte [0x455d],4`). 37 is not
// arbitrary: stat 3's cap is 0x25 = 37 (@0x299ad..@0x29a6e), so one column is exactly one full stat
// and a value of 74 (stat 0/1's cap 0x4a) fills a second column in the darker shade. The erase path
// runs DOWNWARD (`add si,0x140`) and nudges existing pixels four steps up the ramp instead of
// painting background, which is what keeps a partially-lit column shaded rather than blank.

import { Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';

/** DS:0x3c5e..0x3c6c, the eight crew subsystem levels. Same table loop.ts's FUN_231e_67b7 writes;
 *  declared here so this module keeps no import edge back into the pump. */
export const CREW_STATS: readonly number[] = Object.freeze([0x3c5e, 0x3c60, 0x3c62, 0x3c64, 0x3c66, 0x3c68, 0x3c6a, 0x3c6c]);

/** DS:0x5c02..0x5c10 — the eight mirror words. Above DS_END (0x4654), so transient: it lives in
 *  loop.ts's sparse global mirror under the linear keys DS + 0x10000. */
export const BAR_MIRROR = 0x15c02;
/** DS:0x455d — the colour ramp byte. Inside the save blob, so persisted. */
export const COLOR_BYTE = 0x455d;

const ROW = 0x140; // one 320-byte VGA row
const COLUMN = 9; // @0x2b2a2 mov ax,9 — pixels between adjacent bars
const PER_COL = 0x25; // 37 units per column: the `div bx` with bx = 0x25 @0x2b2be/@0x2b303/@0x2b365
const COL_RESET = 0x2e40; // 37 * 320 @0x2b2c8 — back to the foot of the column
const COLOR_INIT = 0xd7; // @0x2b284 mov al,0xd7
const COLOR_STEP = 4; // @0x2b2cc / @0x2b311 sub byte [0x455d],4
export const BAR_PX = 7; // @0x2b2df mov bl,7 / @0x2b38f mov al,7, dec-before-test -> seven pixels across

export const BAR_BASE = {
  panel: 0xa0ef, // mode 2 (and 0): the ENGINEERING panel column
  map: 0xd934, // mode 1 with sound off
  mapSound: 0xaeaf, // mode 1 with DS:0x3ade set
};

export interface BarResult {
  /** Per-stat diagnostics, address-cited by the caller's trace. */
  painted: string[];
  /** INT 33h AX=2 / AX=1 calls the routine makes around a repaint (cursor hide/show). */
  cursorOps: number[];
}

const wordAt = (g: Record<number, number | undefined>, lin: number): number => {
  const v = g[lin];
  return v === undefined ? 0 : v & 0xffff;
};

/** FUN_231e_7e04 @0x2afe4, the bar half: zeroes the eight mirrors so FUN_231e_8043 repaints in
 *  full. Called from the tail of the compositor (`lcall 0x131e,0x7e04` reached @0x2b18f). */
export function clearBarMirrors(g: Record<number, number | undefined>): void {
  for (let i = 0; i < 8; i++) g[BAR_MIRROR + i * 2] = 0; // 0x2afe8..0x2aff1: mov word [di+0x5c02],0
}

/**
 * Transcribes FUN_231e_8043. Returns null when the mode gate at 0x2b223 rejects the pass.
 * `g` is loop.ts's sparse global mirror, `sv` the state blob; `mode`/`soundOn` are DS:0x3c91 and
 * DS:0x3ade as the pump sees them.
 */
export function fun_231e_8043(
  fb: Framebuffer,
  g: Record<number, number | undefined>,
  sv: State,
  mode: number,
  soundOn: boolean,
): BarResult | null {
  const painted: string[] = [];
  const cursorOps: number[] = [];
  if (mode > 2) return null; // @0x2b223 cmp byte [0x3c91],2 / ja 0x2b269

  const vram = fb.vram;
  const px = (off: number, value?: number): number => {
    const o = off & 0xffff; // si is a 16-bit register: the walk wraps, exactly as on DOS
    if (o >= vram.length) return 0xff; // past the 64000-byte frame: reads as set, writes dropped
    if (value === undefined) return vram[o];
    vram[o] = value;
    return value;
  };
  const mod37 = (n: number) => (n & 0xffff) % PER_COL;
  const mirrorOf = (i: number) => wordAt(g, BAR_MIRROR + i * 2);
  const setMirror = (i: number, v: number) => { g[BAR_MIRROR + i * 2] = v & 0xffff; };

  // @0x2b22a: the "touched a pixel" flag, which turns the per-bar cursor calls into one pair.
  let dirty = 0;
  let color = sv.byteAt(COLOR_BYTE);

  for (let di = 0; di < 0x10; di += 2) { // @0x2b234 / @0x2b24e / @0x2b251
    const i = di >> 1;
    const mirror = mirrorOf(i);
    const live = sv.wordAt(CREW_STATS[i]);

    if (mirror === live) { // @0x2b23f je 0x2b246
      setMirror(i, live);
      continue;
    }

    if (dirty === 0) { // @0x2b26c / @0x2b318: first changed stat of the pass
      cursorOps.push(2); // int 33h ax=2, hide
      dirty = 1;
      if (mirror < live) { // @0x2b241 jb 0x2b26c — the increase path resets the ramp, the erase does not
        color = COLOR_INIT; // @0x2b284
        sv.byteAt(COLOR_BYTE, color);
      }
    }

    // @0x2b289 / @0x2b330: base is mode-dependent, then offset nine pixels per stat.
    let si = mode === 1 ? (soundOn ? BAR_BASE.mapSound : BAR_BASE.map) : BAR_BASE.panel;
    si = (si + i * COLUMN) & 0xffff; // @0x2b2a0..@0x2b2a9

    let cx = 0;
    if (mirror < live) {
      // @0x2b2ae: walk up to the row the bar currently ends at.
      for (;;) {
        if (cx === mirror) break;
        si = (si - ROW) & 0xffff;
        cx++;
        if (mod37(cx) === 0) {
          si = (si + COL_RESET) & 0xffff;
          color = (color - COLOR_STEP) & 0xff; // @0x2b2cc
          sv.byteAt(COLOR_BYTE, color);
        }
      }
      const foot = si; // the row the fill starts from, for the trace
      // @0x2b2d6: paint upward from there to the new value.
      for (;;) {
        if (cx === live) break;
        color = sv.byteAt(COLOR_BYTE); // @0x2b2dc reloads, so the ramp stays honest across stats
        for (let bl = 7; ; ) {
          const v = px(si); // @0x2b2e1 mov ah,es:[si]
          if (v < 0xa6 || v >= 0xbe) px(si, color); // @0x2b2e4/@0x2b2e9: leave the art's own range
          si = (si + 1) & 0xffff; // @0x2b2f1
          if (--bl === 0) break; // @0x2b2f2 dec bl / @0x2b2f4 cmp bl,0 -> stops AT zero: SEVEN pixels
        }
        si = (si - 0x147) & 0xffff; // @0x2b2f9: 7 forward - 327 = up exactly one row
        cx++;
        if (mod37(cx) === 0) {
          si = (si + COL_RESET) & 0xffff;
          color = (color - COLOR_STEP) & 0xff; // @0x2b311
          sv.byteAt(COLOR_BYTE, color);
        }
      }
      painted.push(`stat ${i}: ${mirror}->${live} fill up from ${Math.floor(foot / 320)},${foot % 320}`);
    } else {
      // @0x2b355: walk up to the current top. A column wrap that lands exactly on the mirror undoes
      // itself (0x2b36f..0x2b379) and both exits fall through to the single `add si,0x140` @0x2b385.
      for (;;) {
        if (cx === mirror) break;
        si = (si - ROW) & 0xffff;
        cx++;
        if (mod37(cx) !== 0) continue;
        si = (si + COL_RESET) & 0xffff;
        if (cx !== mirror) continue;
        si = (si - COL_RESET) & 0xffff;
        break;
      }
      si = (si + ROW) & 0xffff; // @0x2b385 — once, on entry to the erase loop
      // @0x2b389: erase downward, nudging each lit pixel four steps up the ramp.
      for (;;) {
        if (cx === live) break;
        for (let al = 7; ; ) {
          let v = px(si); // @0x2b391
          if (v >= 0xbe) { // @0x2b394 jb skip: below 0xbe is plain background, leave it
            if (v >= 0xd7) v = 0x8b; // @0x2b399/@0x2b39e: top of the ramp restarts at the base shade
            px(si, (v + COLOR_STEP) & 0xff); // @0x2b3a0/@0x2b3a3
          }
          si = (si + 1) & 0xffff; // @0x2b3a6
          if (--al === 0) break; // @0x2b3a7 dec al / @0x2b3a9 cmp al,0 -> SEVEN pixels
        }
        si = (si + 0x139) & 0xffff; // @0x2b3ad: 7 forward + 313 = down exactly one row
        cx--;
        if (mod37(cx) === 0) si = (si - COL_RESET) & 0xffff; // @0x2b3c1
      }
      painted.push(`stat ${i}: ${mirror}->${live} erase down`);
    }

    setMirror(i, live); // @0x2b246 on every path back
  }

  if (dirty === 1) cursorOps.push(1); // @0x2b256..@0x2b267: int 33h ax=1, show
  if (painted.length) fb.dirty = true;
  return { painted, cursorOps };
}

/** Where bar `i`'s column foot sits, for tests and the click-box cross-check. */
export function barOrigin(mode: number, soundOn: boolean, i: number): { x: number; y: number } {
  const base = mode === 1 ? (soundOn ? BAR_BASE.mapSound : BAR_BASE.map) : BAR_BASE.panel;
  const off = (base + i * COLUMN) & 0xffff;
  return { x: off % 320, y: Math.floor(off / 320) };
}
