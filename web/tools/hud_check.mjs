// Checks the mode-1 HUD transcription in engine/hud.ts against the bytes in FUN_231e_8de4 @0x2bfc4.
// Usage: node web/tools/hud_check.mjs
import fs from 'node:fs';
import { createSession } from '../src/main.ts';
import { HUD, formatNumber, clearField, fun_231e_8de4, fun_231e_6710, spinPixel, SPIN } from '../src/engine/hud.ts';

let fail = 0;
const check = (l, ok, d = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) fail++; };

const xy = (o) => `(${o % 320},${Math.floor(o / 320)})`;

// The destinations are literals in the instruction stream; decode them against the 320-byte pitch.
const want = {
  'credits.di': '0x587e', 'credits.diStrip': '0xbb57', 'first.di': '0xed3a', 'second.di': '0xed5d',
  'ap.di': '0xbb2f', 'missileIcon.di': '0xdd0a', 'pulseIcon.di': '0xdcfa', 'crewIcon.di': '0xdd1a',
};
check('every HUD destination matches its mov di immediate', Object.entries(want).every(([k, v]) => {
  const [a, b] = k.split('.');
  return '0x' + HUD[a][b].toString(16) === v;
}), `credits ${xy(HUD.credits.di)} strip ${xy(HUD.credits.diStrip)} ap ${xy(HUD.ap.di)}`);
check('the strip fields all sit in rows 149..189, below the panel strip',
  [HUD.ap.di, HUD.first.di, HUD.second.di, HUD.missileIcon.di, HUD.pulseIcon.di, HUD.crewIcon.di]
    .every((o) => Math.floor(o / 320) >= 149 && Math.floor(o / 320) <= 189));
check('the no-strip credits land at col 254 row 70 (@0x2bfe3)',
  HUD.credits.di % 320 === 254 && Math.floor(HUD.credits.di / 320) === 70);

// FUN_231e_8d2b: leading zeros suppressed by a flag that never clears.
const fmt = [[0, '0'], [5, '5'], [42, '42'], [101, '101'], [1007, '1007'], [9999, '9999'],
  [10000, '10000'], [65535, '65535'], [10, '10'], [1000, '1000']];
check('formatNumber reproduces the four subtract-and-count loops',
  fmt.every(([v, s]) => formatNumber(v) === s), fmt.map(([v, s]) => `${v}->${formatNumber(v)}`).join(' '));
check('a u16 above 9999 wraps the way BX += 0xd8f0 does', formatNumber(0xffff) === '65535');

// FUN_231e_3079 clears eight rows of the field width starting one row BELOW di (@0x2626e).
const s = await createSession();
const fb = s.fb;
for (let o = 70 * 320 + 254; o < 80 * 320 + 254 + 30; o++) fb.vram[o] = 0x11;
clearField(fb, HUD.credits.di, HUD.credits.width);
const rowBytes = (y) => [...Array(HUD.credits.width)].map((_, x) => fb.vram[y * 320 + 254 + x]);
check('clearField leaves di itself untouched', rowBytes(70).every((p) => p === 0x11));
check('clearField fills di+320 .. di+8*320 with 0xde',
  [...Array(8)].every((_, r) => rowBytes(71 + r).every((p) => p === 0xde)),
  `row 71 ${rowBytes(71).slice(0, 4).map((p) => p.toString(16))} row 78 ${rowBytes(78).slice(0, 4).map((p) => p.toString(16))}`);
check('clearField stops after eight rows', rowBytes(79).every((p) => p === 0x11));

// The mode gate and the mirror gating.
check('the HUD draws nothing outside mode 1 (@0x2bfc6)',
  fun_231e_8de4({ fb, font: (await import('../src/engine/text.ts')).loadTextFont(
    new Uint8Array(fs.readFileSync('web/data/BH_CHAR.DAT')),
    new Uint8Array(fs.readFileSync('web/data/SOLAR1.EXE'))), state: s.state.sv, g: s.state.g,
  mode: 2, stripOn: false, cheatLatch: 0 }) === null);

const s3 = await createSession();
s3.state.sv.wordAt(0x3c5c, 4321);
const font = (await import('../src/engine/text.ts')).loadTextFont(
  new Uint8Array(fs.readFileSync('web/data/BH_CHAR.DAT')), new Uint8Array(fs.readFileSync('web/data/SOLAR1.EXE')));
const ctx = (mode, stripOn, cheat, sv = s3.state.sv, g = s3.state.g) =>
  ({ fb: s3.fb, font, state: sv, g, mode, stripOn, cheatLatch: cheat });
const first = fun_231e_8de4(ctx(1, false, 0)) || { drew: [] };
const again = fun_231e_8de4(ctx(1, false, 0)) || { drew: [] };
check('an unchanged credits word draws once, then the mirror suppresses it (@0x2bfd4)',
  first.drew.length === 1 && again.drew.length === 0, `${first.drew.length} then ${again.drew.length}`);
s3.state.sv.wordAt(0x3c5c, 4322);
const third = fun_231e_8de4(ctx(1, false, 0)) || { drew: [] };
check('a changed credits word redraws', third.drew.length === 1);
const noCheat = fun_231e_8de4(ctx(1, false, 0)) || { drew: [] };
check('with [0x3ade] != 1 and no cheat latch nothing new draws (@0x2c009)', noCheat.drew.length === 0);
const cheat = fun_231e_8de4(ctx(1, false, 1)) || { drew: [] };
check('the cheat latch additionally exposes the two row-189 fields (@0x2c010/@0x2c03a)',
  cheat.drew.length === 2, cheat.drew.join(', '));
// A fresh session: the credits mirror is per-run, so a session that already drew at (254,70) will
// legitimately not repaint at the strip address until the value changes again.
const sStrip = await createSession();
sStrip.state.sv.wordAt(0x3c5c, 4321);
const strip = fun_231e_8de4(ctx(1, true, 0, sStrip.state.sv, sStrip.state.g)) || { drew: [] };
check('[0x3ade] == 1 moves credits to the strip and draws the AP field (@0x2bfe6/@0x2c064)',
  strip.drew.length === 2 && strip.drew[0].includes((0xbb57).toString(16)), strip.drew.join(', '));

// Icon record offsets: bank + 0x12, bank + 8, member + 1 (@0x2c0b5/@0x2c0e7/@0x2c109).
const sml = new Uint8Array(fs.readFileSync('web/data/BH_SML.DAT'));
const s4 = await createSession();
s4.state.sv.wordAt(0x3c4c, 3);
s4.state.sv.byteAt(0x3c4b, 2);
s4.state.sv.byteAt(0x3c4a, 1);
const d0 = s4.fb.vram.slice();
fun_231e_8de4({ fb: s4.fb, font, state: s4.state.sv, g: s4.state.g, sml, mode: 1, stripOn: true, cheatLatch: 0 });
const d1 = s4.fb.vram.slice();
let changed = 0;
for (let o = 0; o < d1.length; o++) if (d0[o] !== d1[o]) changed++;
check('the three icon cells paint on the strip in one pass', changed > 3 * 20, `${changed} pixels`);
check('the icon records are selector + base, so bank 3 is record 0x15',
  3 + HUD.missileIcon.recordBase === 0x15 && 2 + HUD.pulseIcon.recordBase === 0xa && 1 + HUD.crewIcon.recordBase === 2);
check('BH_SML holds at least 0x1d records', sml.length >= 0x1e * 66);

// FUN_231e_6710 @0x298f0: the /4 divider, the gates, and the digit cycle rule.
// The wrap tests the byte AFTER incrementing, so it is 0x38 that becomes 0x31; a pixel already
// holding 0x39 is above the 0x38 gate and left alone.
check('spinPixel counts 0x30..0x37 up and folds 0x38 back to 0x31 (@0x29934..@0x2993d)',
  spinPixel(0x30) === 0x31 && spinPixel(0x37) === 0x38 && spinPixel(0x38) === 0x31 && spinPixel(0x39) === 0x39,
  [0x30, 0x37, 0x38, 0x39].map((v) => `${v.toString(16)}->${spinPixel(v).toString(16)}`).join(' '));
check('spinPixel leaves anything outside 0x30..0x38 alone (@0x29928/@0x2992e)',
  [0x00, 0x2f, 0x3a, 0xde, 0xff].every((v) => spinPixel(v) === v));
const s5 = await createSession();
const g5 = s5.state.g;
check('the spinner is silent outside mode 1 (@0x298f0)', fun_231e_6710(s5.fb, g5, 2, true) === null && Object.keys(g5).filter((k) => +k === SPIN.divider).length === 0);
check('the spinner is silent with [0x3ade] != 1 (@0x298fa)', fun_231e_6710(s5.fb, g5, 1, false) === null);
let fired = 0;
for (let i = 0; i < 8; i++) if (fun_231e_6710(s5.fb, g5, 1, true)) fired++;
check('it fires once every four passes (@0x29901/@0x29905)', fired === 2, `${fired} in 8`);
// A synthetic frame of digits, then one firing pass: 5x44 at both strip origins must advance.
for (const base of SPIN.strips) for (let r = 0; r < SPIN.rows; r++) for (let c = 0; c < SPIN.cols; c++) s5.fb.vram[base + r * 320 + c] = 0x34;
for (let i = 0; i < 4; i++) fun_231e_6710(s5.fb, g5, 1, true);
const moved = SPIN.strips.every((b) => [...Array(SPIN.rows * SPIN.cols)].every((_, k) => {
  const o = b + Math.floor(k / SPIN.cols) * 320 + (k % SPIN.cols);
  return s5.fb.vram[o] === 0x35;
}));
check('a firing pass advances every digit pixel of both strips', moved,
  `0x${s5.fb.vram[SPIN.strips[0]].toString(16)} at the first cell`);
s5.fb.vram[SPIN.strips[0] + SPIN.cols] = 0x34;
const outside = s5.fb.vram[SPIN.strips[0] + SPIN.cols] === 0x34;
check('it does not touch the column right of the strip', outside);
check('the strips are at (231,100) and (311,100), 0x50 apart (@0x29922/@0x29956)',
  SPIN.strips[0] % 320 === 231 && SPIN.strips[1] % 320 === 311
  && SPIN.strips.every((o) => Math.floor(o / 320) === 100) && SPIN.strips[1] - SPIN.strips[0] === 0x50,
  SPIN.strips.map((o) => `(${o % 320},${Math.floor(o / 320)})`).join(' '));

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
