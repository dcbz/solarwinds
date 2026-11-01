// Checks the panel overlay primitives in engine/panels.ts against the bytes they came from.
// Usage: node web/tools/panels_check.mjs
import fs from 'node:fs';
import { createSession } from '../src/main.ts';
import {
  fun_231e_93f9, fun_231e_9466, fun_231e_9127, blitSml, LAMP_COLUMNS, LAMP_LIT, LAMP_DIM,
  PULSE_CELLS, MISSILE_CELLS, CREW_STATIONS, CREW_PRESENT, MISSILE_AMMO, MARK_LEFT, MARK_HERE,
  AMMO_STRIP, SML_RECORD_BYTES,
} from '../src/engine/panels.ts';

let fail = 0;
const check = (l, ok, d = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) fail++; };

const s = await createSession();
const sv = s.state.sv, fb = s.fb;
const sml = new Uint8Array(fs.readFileSync('web/data/BH_SML.DAT'));

// --- the cell tables are real u16 pointers, verified against both BH_START and the EXE image ---
const blob = new Uint8Array(fs.readFileSync('web/data/BH_START.DAT'));
const exe = new Uint8Array(fs.readFileSync('web/data/SOLAR1.EXE'));
const rd = (buf, o) => buf[o] | (buf[o + 1] << 8);
for (const [name, base, n, cols, rows] of [
  ['pulse', PULSE_CELLS, 10, [237, 252, 267, 282, 297], [98, 112]],
  ['missile', MISSILE_CELLS, 10, [237, 252, 267, 282, 297], [144, 158]],
]) {
  const cells = [...Array(n)].map((_, i) => rd(blob, base - 0xad + i * 2));
  const agree = cells.every((c, i) => c === rd(exe, base + 0xf90 + i * 2));
  const geom = cells.every((c, i) => c % 320 === cols[i % 5] && Math.floor(c / 320) === rows[Math.floor(i / 5)]);
  check(`${name} cells: blob == exe`, agree);
  check(`${name} cells land on cols ${cols}/rows ${rows}`, geom,
    cells.map((c) => `${c % 320},${Math.floor(c / 320)}`).slice(0, 3).join(' '));
}

// --- FUN_231e_93f9 lights exactly fifteen cells; FUN_231e_9466 dims the unselected columns ---
// Isolate the two banks the writers touch so the counts measure the routine, not the panel art.
const cell = rd(blob, PULSE_CELLS - 0xad);
const SENT = 0x40;
const clearBand = () => { for (let y = 60; y < 180; y++) for (let x = 228; x < 320; x++) fb.vram[y * 320 + x] = SENT; };
const snap = () => fb.vram.slice();
const touched = (a, b) => { let n = 0; for (let o = 60 * 320; o < 180 * 320; o++) if (a[o] !== b[o]) n++; return n; };

clearBand();
const pre93 = snap();
fun_231e_93f9(fb, cell);
const post93 = snap();
const offs = LAMP_COLUMNS.flatMap((c) => [...c.outer, c.centre]);
const allLit = offs.every((o) => fb.vram[cell + o] === LAMP_LIT);
check('93f9 writes 0x86 to exactly fifteen cells and nothing else',
  allLit && offs.length === 15 && touched(pre93, post93) === 15,
  `${offs.length} offsets, ${touched(pre93, post93)} cells changed`);

for (const power of [1, 2, 3]) {
  clearBand();
  fun_231e_93f9(fb, cell);
  const from = snap();
  fun_231e_9466(fb, cell, power);
  const after = snap();
  const at = (o) => (after[cell + o] !== from[cell + o] || after[cell + o] !== SENT ? after[cell + o] : LAMP_LIT);
  const state_ = LAMP_COLUMNS.map((c) => {
    const dim = c.outer.every((o) => at(o) === LAMP_DIM);
    const lit = c.outer.every((o) => at(o) === LAMP_LIT);
    return { col: dim ? 'dim' : lit ? 'lit' : 'mixed', centre: fb.vram[cell + c.centre] };
  });
  // Gates straight from the bytes: col1 `cmp [0x3c94],1 / je`, col2 `cmp ,2 / je`, col3 `cmp ,1 / je`.
  const want = [power === 1 ? 'lit' : 'dim', power === 2 ? 'lit' : 'dim', power === 1 ? 'lit' : 'dim'];
  const centres = [LAMP_DIM, LAMP_DIM, 0x34]; // @0x2c677/@0x2c69b use 0x32, @0x2c6bd uses 0x34
  const okState = state_.every((c, i) => c.col === want[i]);
  const okCentre = state_.every((c, i) => (c.col === 'lit' ? c.centre === LAMP_LIT : c.centre === (i === 2 ? 0x34 : 0x32)));
  check(`9466 at power ${power}: ${want.join('/')}`, okState && okCentre,
    state_.map((c) => `${c.col}/${c.centre.toString(16)}`).join(' '));
}
// --- the ammo strip ---
for (let y = 128; y < 140; y++) for (let x = 260; x < 320; x++) fb.vram[y * 320 + x] = 0x40;
fun_231e_9127(fb, 0, 4, false);
const strip = [...Array(AMMO_STRIP.h)].map((_, r) => [...Array(AMMO_STRIP.w)].map((_, x) => fb.vram[(Math.floor(AMMO_STRIP.panel / 320) + r) * 320 + (AMMO_STRIP.panel % 320) + x]));
check('ammo strip is 40x3 of 0xde when nothing is selected', strip.every((row) => row.every((p) => p === AMMO_STRIP.clear)),
  strip.map((r) => r.slice(0, 4).map((p) => p.toString(16)).join(' ')).join(' | '));
check('flight-screen strip sits at col 252 row 195 (@0x2c336)', AMMO_STRIP.flight % 320 === 252 && Math.floor(AMMO_STRIP.flight / 320) === 195,
  `0x${AMMO_STRIP.flight.toString(16)} -> (${AMMO_STRIP.flight % 320},${Math.floor(AMMO_STRIP.flight / 320)})`);
check('panel strip sits at col 271 row 133 (@0x2c325)', AMMO_STRIP.panel % 320 === 271 && Math.floor(AMMO_STRIP.panel / 320) === 133);

// --- markers: 0x1d on the live selection, 0x1e where it was; the table is (sel-1)*2 ---
check('BH_SML is 32 uniform 8x8 records so the walk is a 66-byte stride', sml.length === 32 * SML_RECORD_BYTES,
  `${sml.length} vs ${32 * SML_RECORD_BYTES}`);
clearBand();
const at0 = rd(blob, CREW_STATIONS - 0xad);
const before = fb.vram.slice();
blitSml(fb, sml, MARK_HERE, at0);
let wrote = 0;
for (let o = 0; o < fb.vram.length; o++) if (fb.vram[o] !== before[o]) wrote++;
check('0x1d blits its 27 non-zero pixels, zero-transparent', wrote === 27, `${wrote} pixels`);
const here = [...Array(8)].map((_, y) => [...Array(8)].map((_, x) => (fb.vram[at0 + y * 320 + x] === before[at0 + y * 320 + x] ? '.' : '#')).join(''));
check('0x1d is the left-pointing arrowhead', here[0] === '.....##.' && here[6] === '##...###', here.join('/'));

for (const [name, sel, base] of [['crew 1', 1, CREW_STATIONS], ['crew 4', 4, CREW_STATIONS], ['pulse 6', 6, PULSE_CELLS]]) {
  const at = sv.wordAt(base + (sel - 1) * 2);
  check(`${name} cell is inside the panel (col>=228, row 65..199)`, at > 0 && at % 320 >= 228 && Math.floor(at / 320) >= 65 && Math.floor(at / 320) <= 199,
    `(${at % 320},${Math.floor(at / 320)})`);
}
check('the crew presence gate marks exactly the two stations BH_START populates',
  [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => sv.wordAt(CREW_PRESENT + (i - 1) * 2) !== 0).join(',') === '1,2',
  [1, 2, 3, 4, 5, 6, 7, 8].map((i) => sv.wordAt(CREW_PRESENT + (i - 1) * 2)).join(','));
check('missile bank 1 ammo is the [0x359b] word (5 in the starting state)', sv.wordAt(MISSILE_AMMO) === 5,
  String(sv.wordAt(MISSILE_AMMO)));

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
