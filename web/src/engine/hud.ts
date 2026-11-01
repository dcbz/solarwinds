// Solar Winds — FUN_231e_8de4 @0x2bfc4, the mode-1 (flight/cockpit) heads-up display.
//
// The pump calls this every fifth pass (@0x23e6b `inc byte [0x54c4]` / @0x23e6f `cmp ,5` / je, see
// clock.ts's `by5`), and the first thing it does is gate on the mode: `cmp byte [0x3c91],1` /
// `je 0x2bfd0` / otherwise straight to the tail (@0x2bfc6..@0x2bfcd). So this is the FLIGHT screen's
// overlay only — the panels never reach it.
//
// Each numeric field is the same four-step idiom, and it only runs when the value differs from a
// mirror word, which is why the HUD does not flicker:
//
//   mov  bx,[field]        ; the value
//   cmp  bx,[mirror] / je  ; unchanged -> skip
//   lcall 0x131e,0x8d2b    ; format BX as decimal into the 19-byte buffer at DS:0x6ca5, '$'-terminated
//   lea  bx,[0x6ca5]       ; bx = the string
//   mov  di,<destination>  ; ES:DI in A000
//   mov  al,<width>        ; the field's pixel width
//   lcall 0x131e,0x3079    ; clear `width` x 8 rows of 0xde — starting at di+0x140, one row BELOW di
//   lcall 0x131e,0x31f1    ; draw the glyphs AT di
//   mov  [mirror],value    ; adopt
//
// The clear-at-di+320 is not a mistake: @0x2626e does `add di,0x140` before its row loop while
// FUN_231e_31f1 draws from di itself. Transcribed as-is.
//
// The fields, and the two gates that decide which of them exist:
//
//   [0x3c5c] credits   di 0x587e (254,70) — or 0xbb57 (279,149) when [0x3ade]==1   mirror [0x5c16]
//   [0x3c9a]            di 0xed3a (250,189) width 0x11                            mirror [0x5c14]
//   [0x3c5a]            di 0xed5d (285,189) width 0x11                            mirror [0x5c00]
//   [0x3c70] AP pool    di 0xbb2f (239,149) width 0x1e   only when [0x3ade]==1     mirror [0x5c18]
//
// @0x2c002 `cmp byte [0x3ade],1 / je 0x2c064`: the 0x3c9a and 0x3c5a fields live on the `!= 1` side and
// additionally need the cheat latch [0x3be6] == 1 (@0x2c009, and `jne 0x2c064` skips both). So in an
// ordinary run the flight screen shows exactly one number — the credits — plus the crew-stat bars that
// FUN_231e_8043 draws at 0xd934/0xaeaf (see bars.ts) and the sector readout from FUN_231e_81e8.
//
// When [0x3ade] == 1 the whole bottom strip appears instead: AP at (239,149), the missile-bank icon at
// (266,176), the pulse-bank icon at (250,176) with its power lamps, the missile ammo pips, and the crew
// icon at (282,176). DS:0x3ade is NOT a sound preference: @0x23e9e..@0x23f07 in the pump sets it to 1 on
// the pass where the DS:0x3c16 countdown starts at 500 and clears it when the countdown reaches 0,
// running FUN_231e_3708 (the BH_PAL + BH_MW2A/MW2B load) on both edges. The `n` key's
// `xor byte [0x3ade],1` @0x2e75f flips the same byte.
//
// The icons are BH_SML records addressed by selector, not fixed glyphs (@0x2c0b5, @0x2c0e7, @0x2c109):
//   missile bank n -> record n + 0x12, pulse bank n -> record n + 8, crew member n -> record n + 1
// and a selector of 0 blits record 0x1e at the same cell instead, which is the blank-plate that clears
// it. Each is gated on its own mirror byte ([0x5bc0] missile, [0x5bbf] pulse, [0x5bc1] crew).

import type { Framebuffer } from '../framebuffer.ts';
import { drawText } from './text.ts';
import type { TextFont } from './text.ts';
import type { State } from './state.ts';
import { fun_231e_9466, fun_231e_9127, blitSml } from './panels.ts';

/** DS:0x6ca5, the 19-byte numeric string buffer (`lea bx,[0x6ca5]` @0x2bfd9 and 8d2b's fill). */
export const NUM_BUFFER_DS = 0x6ca5;
export const NUM_BUFFER_BYTES = 0x13; // @0x2bf0f..@0x2bf1b blanks 19 bytes, then '$'

/**
 * FUN_231e_8d2b @0x2bf0b. u16 -> decimal ASCII, left-aligned, leading zeros suppressed by a `printed`
 * flag that is set once and never cleared — so the first non-zero position and everything right of it
 * appears, and 0 alone renders as "0". `BX += 0xd8f0` is the 16-bit way of subtracting 10000.
 */
export function formatNumber(value: number): string {
  let v = value & 0xffff;
  let out = '';
  let printed = false; // bVar1
  for (const divisor of [10000, 1000, 100, 10]) {
    let digit = 0; // cVar3
    while (v > divisor - 1) {
      printed = true;
      digit = (digit + 1) & 0xff;
      v = (v + (0x10000 - divisor)) & 0xffff;
    }
    if (printed || digit !== 0) out += String(digit); // @0x2bf3d/@0x2bf58/...
  }
  return out + String(v); // the units digit is unconditional
}

/**
 * FUN_231e_3079 @0x26259. Clears `width` columns by 8 rows of 0xde, beginning one row BELOW `di`
 * (@0x2626e `add di,0x140`, then `mov al,7` rows with `add di,0x140` @0x2628b between them).
 */
export function clearField(fb: Framebuffer, di: number, width: number): void {
  let p = (di + 0x140) & 0xffff;
  for (let row = 0; row < 8; row++) {
    for (let x = 0; x < width; x++) {
      if (p < fb.vram.length) fb.vram[p] = 0xde; // @0x2627b mov ah,0xde / @0x2627f mov es:[di],ah
      p++;
    }
    p = di + (row + 2) * 320; // @0x2628b, net one row from the row's start
  }
}

export const HUD = Object.freeze({
  credits: { src: 0x3c5c, mirror: 0x15c16, di: 0x587e, diStrip: 0xbb57, width: 0x1e },
  first: { src: 0x3c9a, mirror: 0x15c14, di: 0xed3a, width: 0x11 },
  second: { src: 0x3c5a, mirror: 0x15c00, di: 0xed5d, width: 0x11 },
  ap: { src: 0x3c70, mirror: 0x15c18, di: 0xbb2f, width: 0x1e },
  missileIcon: { sel: 0x3c4c, mirror: 0x15bc0, di: 0xdd0a, recordBase: 0x12 },
  pulseIcon: { sel: 0x3c4b, mirror: 0x15bbf, di: 0xdcfa, recordBase: 8 },
  crewIcon: { sel: 0x3c4a, mirror: 0x15bc1, di: 0xdd1a, recordBase: 1 },
  plate: 0x1e, // @0x2c0a5/@0x2c0d7: the blank that clears an icon cell
});

export interface HudContext {
  fb: Framebuffer;
  font: TextFont;
  state: State;
  g: Record<number, number | undefined>;
  sml?: Uint8Array;
  mode: number;
  /** DS:0x3ade as the pump last set it, and the DS:0x3be6 cheat latch. */
  stripOn: boolean;
  cheatLatch: number;
}

export interface HudResult { drew: string[] }

const word = (c: HudContext, ds: number) => c.state.wordAt(ds);

/**
 * Transcribes FUN_231e_8de4. Returns nothing drawn when the mode gate at @0x2bfc6 rejects the pass.
 */
export function fun_231e_8de4(c: HudContext): HudResult | null {
  if (c.mode !== 1) return null; // @0x2bfc6
  const drew: string[] = [];

  const numeric = (f: { src: number; mirror: number; di: number; width: number; diStrip?: number }) => {
    const value = word(c, f.src);
    const prev = c.g[f.mirror];
    if (prev === value) return; // @0x2bfd4/@0x2c014/@0x2c03e/@0x2c072
    const di = f.diStrip !== undefined && c.stripOn ? f.diStrip : f.di; // @0x2bfe6..@0x2bfed
    clearField(c.fb, di, f.width); // @0x2c307 -> 0x3079
    drawText(c.fb, c.font, di, formatNumber(value)); // @0x2c30b -> 0x31f1
    c.g[f.mirror] = value; // @0x2bfff/@0x2c036/@0x2c060/@0x2c093
    drew.push(`${f.src.toString(16)}=${value} @0x${di.toString(16)}`);
  };

  numeric(HUD.credits); // @0x2bfd0, unconditional inside the mode gate

  if (c.stripOn) {
    numeric(HUD.ap); // @0x2c06e, reached only when [0x3ade] == 1 (@0x2c064)
  } else if (c.cheatLatch === 1) {
    numeric(HUD.first); // @0x2c010, needs [0x3be6] == 1 (@0x2c009)
    numeric(HUD.second); // @0x2c03a
  }

  if (!c.stripOn) return { drew }; // @0x2c069 `je`/jmp 0x2c125 — the strip's icons are 0x3ade-gated too

  // The three icon cells. A selector of 0 blits the blank plate; otherwise the record is
  // selector + base, and the blit is skipped entirely when the selector has not changed.
  const icon = (f: { sel: number; mirror: number; di: number; recordBase: number }, after?: () => void) => {
    const sel = c.state.byteAt(f.sel);
    if (c.g[f.mirror] === sel) return; // @0x2c099/@0x2c0cb/@0x2c0fd
    if (sel === 0) {
      if (c.sml) blitSml(c.fb, c.sml, HUD.plate, f.di); // @0x2c0a5/@0x2c0d7
      drew.push(`cell @0x${f.di.toString(16)} cleared`);
    } else if (c.sml) {
      blitSml(c.fb, c.sml, sel + f.recordBase, f.di); // @0x2c0b5 `add al,0x12` / @0x2c0e7 `add al,8`
      drew.push(`cell @0x${f.di.toString(16)} <- SML record ${sel + f.recordBase} (sel ${sel})`);
      after?.();
    }
    c.g[f.mirror] = sel; // @0x2c0c5/@0x2c0f7/@0x2c122
  };

  icon({ ...HUD.missileIcon }, () => {
    // @0x2c0bf `call 0x2c307`: the ammo strip for the bank now shown. It runs unconditionally after
    // the icon blit, so a selector of 0 clears the strip rather than leaving stale pips.
    const sel = c.state.byteAt(HUD.missileIcon.sel);
    drew.push(...fun_231e_9127(c.fb, sel ? c.state.wordAt(0x359b + (sel - 1) * 2) : 0, 1, c.stripOn));
  });
  icon({ ...HUD.pulseIcon }, () => {
    fun_231e_9466(c.fb, HUD.pulseIcon.di, c.state.byteAt(0x3c94)); // @0x2c0f1 `call 0x2c646`, DI still 0xdcfa
  });
  icon({ ...HUD.crewIcon });

  if (drew.length) c.fb.dirty = true;
  return { drew };
}

// --- FUN_231e_6710 @0x298f0: the two animated digit strips on the flight screen -------------------
//
// Gated `mode == 1 && [0x3ade] == 1` (@0x298f0/@0x298fa), then divided by four on the byte at
// DS:0x46a4 (@0x29901 `inc byte [0x46a4]` / @0x29905 `cmp ,4` / jne out). On a firing pass it walks
// two 5-column by 44-row rectangles in A000 — 0x7de7 = (231,100) and 0x7e37 = (311,100) — and bumps
// any byte in `'0'..'8'` one step, wrapping 0x39 back to 0x31:
//
//   029928  cmp byte ptr es:[di], 0x30 / jb   skip
//   02992e  cmp byte ptr es:[di], 0x38 / ja   skip
//   029934  inc byte ptr es:[di]
//   029937  cmp byte ptr es:[di], 0x39 / jne  next
//   02993d  mov byte ptr es:[di], 0x31
//   029941  inc cl / inc di / cmp cl,5 / jne  -> five columns, then `add di,0x13b` = one row down
//   029951  cmp ch,0x2c                       -> 44 rows
//
// So it is not drawing a value: it is cycling the numeral glyph already sitting in those pixels, which
// makes the two meters roll. INT 33h AX=2/AX=1 bracket the walk (@0x2990c/@0x2998a) and the tail is
// `retf` @0x29996.
export const SPIN = Object.freeze({
  divider: 0x146a4, // DS:0x46a4, above DS_END so it lives in the sparse mirror
  every: 4,
  cols: 5, // @0x29944 cmp cl,5
  rows: 0x2c, // @0x29951 cmp ch,0x2c
  rowAdvance: 0x13b, // @0x2994b add di,0x13b — 320 net of the five incs
  low: 0x30, high: 0x38, wrapTo: 0x31, // @0x29928..@0x2993d
  strips: [0x7de7, 0x7e37],
});

/** One pixel of the spinner's walk, exactly as the five instructions at @0x29928 decide it. */
export function spinPixel(v: number): number {
  if (v < SPIN.low || v > SPIN.high) return v; // jb/ja leave the byte alone
  const next = (v + 1) & 0xff;
  return next === 0x39 ? SPIN.wrapTo : next; // @0x29937/@0x2993d
}

/**
 * Transcribes the body of FUN_231e_6710 @0x298f0. Returns null on a pass the gates or the /4 divider
 * reject — the caller must not compensate, because the divider byte is the state.
 */
/**
 * The spinner's own persistent state. In DOS the walk mutates A000 in place, so the digits accumulate:
 * after m firing passes each pixel has advanced m steps, and only a page-1 compositor call puts the
 * base art back. The port re-composites the world every render, so the accumulation is held here
 * instead — a shadow of the strip cells, seeded from the composited frame and blitted over it.
 * `resetSpin` is the port's stand-in for that page-1 call.
 */
export interface SpinState { seeded: boolean; cells: Uint8Array[] }
export function createSpin(): SpinState { return { seeded: false, cells: SPIN.strips.map(() => new Uint8Array(SPIN.cols * SPIN.rows)) }; }
export function resetSpin(st: SpinState): void { st.seeded = false; }

/**
 * Transcribes the body of FUN_231e_6710 @0x298f0. Returns null on a pass the gates or the /4 divider
 * reject — the caller must not compensate, because the divider byte is the state.
 */
export function fun_231e_6710(
  fb: Framebuffer,
  g: Record<number, number | undefined>,
  mode: number,
  stripOn: boolean,
  st: SpinState = createSpin(),
): string[] | null {
  if (mode !== 1 || !stripOn) return null; // @0x298f0/@0x298fa
  const d = ((g[SPIN.divider] ?? 0) + 1) & 0xff; // @0x29901
  g[SPIN.divider] = d;
  if (d !== SPIN.every) return null; // @0x29905/@0x2990a
  g[SPIN.divider] = 0; // @0x29918
  if (!st.seeded) {
    SPIN.strips.forEach((base, k) => {
      for (let r = 0; r < SPIN.rows; r++) for (let c = 0; c < SPIN.cols; c++) st.cells[k][r * SPIN.cols + c] = fb.vram[base + r * 320 + c];
    });
    st.seeded = true;
  }
  const out: string[] = [];
  SPIN.strips.forEach((base, k) => {
    const cell = st.cells[k];
    for (let i = 0; i < cell.length; i++) cell[i] = spinPixel(cell[i]); // @0x29928..@0x2993d
    for (let r = 0; r < SPIN.rows; r++) for (let c = 0; c < SPIN.cols; c++) fb.vram[base + r * 320 + c] = cell[r * SPIN.cols + c];
    out.push(`0x${base.toString(16)} ${SPIN.cols}x${SPIN.rows}`);
  });
  fb.dirty = true;
  return out;
}
