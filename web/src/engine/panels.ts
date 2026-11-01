// Live values drawn over the panel art. The static compositor (@0x2b04d) only blits the BH_PAN
// records; every marker, lamp and pip on top of them comes from the routines transcribed here (and
// the stat bars, which live in bars.ts). Each block below is a verbatim transcription; the
// disassembly is `/usr/bin/python3 re/work/x86.py <from> <to>`:
//
//   FUN_231e_7fc0 @0x2b1a0  BH_SML record AL blitted at ES:DI, zero-transparent, w*h pixels
//                           (all 32 shipped records are 8x8, so the walk is 66 B per record)
//   FUN_231e_93f9 @0x2c5d9  one pulse bank's 15 lamp cells <- 0x86
//   FUN_231e_9466 @0x2c646  the same bank's columns whose power level is not selected <- 0x34/0x32
//   FUN_231e_9127 @0x2c307  the missile ammo strip: 40x3 of 0xde, then up to ten 3x3 pips
//
// The cursor convention, from both call sites (@0x2ea65..@0x2ea7f for the crew stations and
// @0x2eae6..@0x2eaf7 for the pulse banks): record 0x1e is blitted at the cell the selection just
// LEFT and record 0x1d at the cell it just MOVED TO. So 0x1d is the live marker and 0x1e the mark
// left behind. Both are 8x8 "<" arrowheads (0x1d spans cols 0..5, 0x1e cols 0..6) — see
// web/tools/sml_dump.mjs. Earlier drafts of this file had them reversed.
//
// The cell addresses are u16 tables in the save blob, initialized identically in SOLAR1.EXE at
// file = DS + 0xF90 (checked to agree at 0x3587: 0x7b6d both ways):
//   DS:0x3587..0x359a  ten pulse-bank cells  -> (237|252|267|282|297, 98) and the same at row 112
//   DS:0x35bf..0x35d2  ten missile-bank cells -> the same five columns at rows 144 and 158
//   DS:0x35d3..0x35e0  seven crew stations    -> (234,158) (250,164) (266,164) (282,164) (298,158)
//                                                (259,177) (274,177); entry 8 is 0x0101, never used
//   DS:0x3573/0x359b/0x35af  ten availability/ammo words, then eight crew-presence words at 0x35af
// All three indexed sites use `(selector - 1) * 2`, i.e. the selector globals DS:0x3c4a/0x3c4b/0x3c4c
// are 1-based and 0 means "nothing selected".

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';

export const PULSE_CELLS = 0x3587; // ten u16 lamp bases
export const MISSILE_CELLS = 0x35bf; // ten u16 cells
export const CREW_STATIONS = 0x35d3; // u16 per station, (memberSel - 1) * 2
export const CREW_PRESENT = 0x35af; // eight u16 gates: 0 = no such station
export const PULSE_PRESENT = 0x3573; // ten u16 gates
export const MISSILE_AMMO = 0x359b; // ten u16 ammo counts, also the missile-bank gate
export const MARK_LEFT = 0x1e; // blitted where the selection was
export const MARK_HERE = 0x1d; // blitted where the selection is
export const SML_RECORD_BYTES = 2 + 64; // <u8 w><u8 h> + 8x8, uniform across all 32 records

// The fifteen lamp cells of one bank, as the two writers address them off ES:DI. Grouped by the
// three power columns; `outer` gets 0x86 from @0x2c5d9, `centre` likewise, and the unselected column
// is overwritten by @0x2c646 with 0x34 outer / 0x32 centre — except column 3, whose centre also takes
// 0x34 (@0x2c6bd `mov al,0x34` where columns 1 and 2 use `mov al,0x32`).
export const LAMP_COLUMNS: ReadonlyArray<{ gate: number; outer: number[]; centre: number; centreOff: number }> =
  Object.freeze([
    { gate: 1, outer: [0xa03, 0xb42, 0xb44, 0xc83], centre: 0xb43, centreOff: 0x32 }, // @0x2c658
    { gate: 2, outer: [0xa07, 0xb46, 0xb48, 0xc87], centre: 0xb47, centreOff: 0x32 }, // @0x2c67c
    { gate: 1, outer: [0xa0b, 0xb4a, 0xb4c, 0xc8b], centre: 0xb4b, centreOff: 0x34 }, // @0x2c6a0
  ]);
export const LAMP_LIT = 0x86; // @0x2c5eb mov al,0x86
export const LAMP_DIM = 0x34; // @0x2c65f mov al,0x34

/** FUN_231e_93f9 @0x2c5d9: light all fifteen cells of the bank whose cell offset is `di`. */
export function fun_231e_93f9(fb: Framebuffer, di: number): void {
  for (const col of LAMP_COLUMNS) {
    for (const off of col.outer) fb.vram[di + off] = LAMP_LIT; // @0x2c5ed..@0x2c633
    fb.vram[di + col.centre] = LAMP_LIT;
  }
}

/** FUN_231e_9466 @0x2c646: dim the columns of the bank at `di` that the power level does not select. */
export function fun_231e_9466(fb: Framebuffer, di: number, power: number): void {
  for (const col of LAMP_COLUMNS) {
    if (power === col.gate) continue; // @0x2c658/@0x2c67c/@0x2c6a0 `cmp byte [0x3c94],n / je`
    for (const off of col.outer) fb.vram[di + off] = LAMP_DIM; // @0x2c661..@0x2c670
    fb.vram[di + col.centre] = col.centreOff; // @0x2c677/@0x2c69b/@0x2c6bf
  }
}

// FUN_231e_9127 @0x2c307, the missile ammo strip. ES = 0xa000 and the destination is a literal:
// 0xa74f = col 271 row 133, or 0xf4bc = col 252 row 195 when DS:0x3ade (sound) is set and mode == 1
// (@0x2c328..@0x2c336). It clears 40x3 to 0xde, then for `ammo` pips draws 3x3 blocks four pixels
// apart from a pattern table at DS:0x5e5e, nine bytes per pip, up to ten pips (@0x2c3b3). The tenth
// pip's pattern is shifted down six ramp steps when a second bank also has ammo (@0x2c384: `cmp dh,9`
// / `cmp al,1` / `mov dl,6`).
export const AMMO_STRIP = { panel: 0xa74f, flight: 0xf4bc, w: 40, h: 3, clear: 0xde, pip: 3, step: 4, max: 10 };

/**
 * DS:0x5e5e is a runtime-generated table of 3x3 dither patterns — the same table the scan gatherer
 * FUN_231e_535c @0x2853c selects between at 0x5e23/0x5e3c/0x5e55/0x5e74 by ship system level
 * DS:0x3c64. Nothing in the image writes it with a literal address, so its producer is still open:
 * TODO_PATTERN_TABLE@0x5e5e. Until that is closed the strip is filled with its own background index
 * (0xde), which leaves the pips invisible rather than painting a guessed pattern.
 */
export let AMMO_PATTERN: Uint8Array = new Uint8Array(AMMO_STRIP.max * 9).fill(AMMO_STRIP.clear);
export function setAmmoPattern(p: Uint8Array): void { AMMO_PATTERN = p; }

/** FUN_231e_9127 @0x2c307. Returns the cells it touched, for the trace. */
export function fun_231e_9127(fb: Framebuffer, ammo: number, mode: number, soundOn: boolean): string[] {
  const di0 = soundOn && mode === 1 ? AMMO_STRIP.flight : AMMO_STRIP.panel; // @0x2c325/@0x2c336
  let di = di0;
  for (let row = 0; row < AMMO_STRIP.h; row++) { // @0x2c33b..@0x2c354: 0x28 x 3 of 0xde
    for (let x = 0; x < AMMO_STRIP.w; x++) fb.vram[di++] = AMMO_STRIP.clear;
    di = di0 + (row + 1) * WIDTH; // @0x2c349 `add di,0x118` on top of the row's 40 incs = one row
  }
  const out: string[] = [];
  if (!ammo) return [`ammo strip cleared @0x${di0.toString(16)}`]; // @0x2c356/@0x2c35b
  let bx = 0;
  let remaining = ammo; // @0x2c35d reads the word, @0x2c378 tests it
  for (let pip = 0; pip < AMMO_STRIP.max && remaining > 0; pip++, remaining--) { // @0x2c3af/@0x2c3b3
    let p = di0 + pip * AMMO_STRIP.step; // @0x2c3b8 `add di,4`, restored from the saved di @0x2c3ae
    for (let row = 0; row < AMMO_STRIP.pip; row++) {
      for (let col = 0; col < AMMO_STRIP.pip; col++) {
        const shift = pip === 9 && ammo > 1 ? 6 : 0; // @0x2c384..@0x2c38d
        fb.vram[p++] = (AMMO_PATTERN[bx++] - shift) & 0xff; // @0x2c38f..@0x2c397
      }
      p += WIDTH - AMMO_STRIP.pip; // @0x2c3a1 `add di,0x13d` after the three incs
    }
  }
  out.push(`ammo pips ${ammo} @0x${di0.toString(16)}`);
  return out;
}

/** FUN_231e_7fc0: blit BH_SML record `index` at a VRAM offset, zero-transparent. */
export function blitSml(fb: Framebuffer, sml: Uint8Array, index: number, at: number): void {
  const base = index * SML_RECORD_BYTES; // the walk at @0x2b1bf skips (AL-1) records by w*h+2
  if (base + SML_RECORD_BYTES > sml.length || at < 0) return;
  const w = sml[base];
  const h = sml[base + 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = sml[base + 2 + y * w + x];
      const d = at + y * WIDTH + x;
      if (p !== 0 && d >= 0 && d < fb.vram.length) fb.vram[d] = p; // @0x2b1f1 `cmp cl,0 / je` skips zero
    }
  }
}

/**
 * The steady-state panel overlay. DOS paints these incrementally on a selection event; because the
 * port re-blits BH_PAN on every render pass, the same result is rebuilt from the selector globals:
 * the bank the selection left gets its lamps lit (@0x2c5d9) and the 0x1e mark (@0x2eae6), the bank it
 * is on gets the power dimming (@0x2c646) and the 0x1d mark (@0x2eafb).
 */
export function drawPanelStatus(fb: Framebuffer, state: State, mode: number, sml?: Uint8Array, prev?: Record<string, number>): string[] {
  const drew: string[] = [];
  const seen = prev ?? {};
  const cellAt = (base: number, sel: number) => (sel >= 1 ? state.wordAt(base + (sel - 1) * 2) : 0);

  if (mode === 2 && sml) {
    // @0x2ea65 marks the station the pick left, @0x2ea7b the one it moved to. The pick is gated on the
    // presence word, so station 8 (cell 0x0101) is never marked.
    const sel = state.byteAt(0x3c4a);
    if (seen.crew && seen.crew !== sel) blitSml(fb, sml, MARK_LEFT, cellAt(CREW_STATIONS, seen.crew));
    if (sel && state.wordAt(CREW_PRESENT + (sel - 1) * 2) !== 0) {
      blitSml(fb, sml, MARK_HERE, cellAt(CREW_STATIONS, sel));
      drew.push(`crew station ${sel} marked @${cellAt(CREW_STATIONS, sel).toString(16)}`);
    }
    seen.crew = sel;
  }

  if (mode === 4) {
    const sel = state.byteAt(0x3c4b);
    const power = state.byteAt(0x3c94); // cycles 1..3 by re-picking the same bank (@0x2eb0c..@0x2eb1f)
    if (seen.pulse && seen.pulse !== sel) {
      const old = cellAt(PULSE_CELLS, seen.pulse);
      if (old) { fun_231e_93f9(fb, old); if (sml) blitSml(fb, sml, MARK_LEFT, old); drew.push(`pulse bank ${seen.pulse} relit`); }
    }
    if (sel) {
      const cell = cellAt(PULSE_CELLS, sel);
      if (cell) {
        fun_231e_9466(fb, cell, power);
        if (sml) blitSml(fb, sml, MARK_HERE, cell);
        drew.push(`pulse bank ${sel} power ${power} @${cell.toString(16)}`);
      }
    }
    seen.pulse = sel;
    const ms = state.byteAt(0x3c4c);
    if (seen.missile && seen.missile !== ms) {
      const old = cellAt(MISSILE_CELLS, seen.missile);
      if (old && sml) blitSml(fb, sml, MARK_LEFT, old);
    }
    if (ms) {
      const cell = cellAt(MISSILE_CELLS, ms);
      if (cell && sml) { blitSml(fb, sml, MARK_HERE, cell); drew.push(`missile bank ${ms} marked @${cell.toString(16)}`); }
      drew.push(...fun_231e_9127(fb, state.wordAt(MISSILE_AMMO + (ms - 1) * 2), mode, state.byteAt(0x3ade) !== 0));
    } else {
      drew.push(...fun_231e_9127(fb, 0, mode, state.byteAt(0x3ade) !== 0));
    }
    seen.missile = ms;
  }
  if (drew.length) fb.dirty = true;
  return drew;
}
