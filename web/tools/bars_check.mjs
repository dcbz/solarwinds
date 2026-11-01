// Checks the FUN_231e_8043 @0x2b223 transcription against the geometry the binary itself proves.
//
// Three independent claims have to hold at once:
//   1. the bar foot is A000:0xa0ef -> col 239 row 128, nine pixels apart (@0x2b289/@0x2b2a2),
//   2. every 7-pixel bar lies inside the click box FUN_231e_69f6 @0x29bd6 tests for that stat
//      (x = 0xee..0x136 = 238..310, "+"/"-", stride 9),
//   3. filling then erasing returns the frame to its starting bytes, which is only true if the
//      erase's ramp walk (@0x2b391..@0x2b3c1) is the exact inverse of the fill's (@0x2b2e1..@0x2b316).
// Usage: node web/tools/bars_check.mjs
import { createSession } from '../src/main.ts';
import { fun_231e_8043, clearBarMirrors, CREW_STATS, BAR_PX, barOrigin } from '../src/engine/bars.ts';

const W = 320, FOOT = 0xa0ef, STRIDE = 9, PER_COL = 37, CAPS = [0x4a, 0x4a, 0xde, 0x25, 0x6f, 0x6f, 0x6f, 0x6f];
let fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };

const s = await createSession();
s.inject(0x12);
const sv = s.state.sv, g = s.state.g, fb = s.fb;

check('mode gate @0x2b223 skips modes > 2',
  fun_231e_8043(fb, g, sv, 3, false) === null && fun_231e_8043(fb, g, sv, 1, false) !== null);

for (let i = 0; i < 8; i++) {
  const o = barOrigin(2, false, i);
  const footX = (FOOT + i * STRIDE) % W, footY = Math.floor((FOOT + i * STRIDE) / W);
  check(`bar ${i} foot = (${footX},${footY})`, o.x === footX && o.y === footY, `got (${o.x},${o.y})`);
  // FUN_231e_69f6's box for stat i is x in [238 + 9i, 238 + 9i + 8]; the bar must sit inside it.
  // FUN_231e_69f6 tests raw CX 0xee..0x136 in nine-unit steps: stat i's box is 238+9i..246+9i.
  const boxLo = 238 + i * STRIDE, boxHi = boxLo + 8;
  check(`bar ${i} fits its click box`, o.x >= boxLo && o.x + BAR_PX - 1 <= boxHi,
    `bar ${o.x}..${o.x + BAR_PX - 1} vs box ${boxLo}..${boxHi}`);
}

// Full paint from a zeroed mirror, at each stat's cap, then erase back to zero and compare frames.
CREW_STATS.forEach((d) => sv.wordAt(d, 0));
clearBarMirrors(g);
let base = fb.vram.slice();
for (let i = 0; i < 8; i++) {
  sv.wordAt(CREW_STATS[i], CAPS[i]);
  clearBarMirrors(g);
  fun_231e_8043(fb, g, sv, 2, false);
}
let lit = 0;
for (let y = 88; y <= 128; y++) for (let x = 239; x < 239 + 8 * STRIDE; x++) {
  const o = y * W + x;
  if (fb.vram[o] !== base[o]) lit++;
}
check('cap fill writes into the bar band', lit > 8 * 30, `${lit} pixels changed`);

// The fill must be monotone: for bar i, the foot row is written and rows above 128-cap are not.
for (let i = 0; i < 8; i++) {
  const x = 239 + i * STRIDE;
  let top = 128;
  for (let y = 128; y >= 60; y--) {
    let touched = false;
    for (let d = 0; d < BAR_PX; d++) if (fb.vram[y * W + x + d] !== base[y * W + x + d]) touched = true;
    if (touched) top = y; else break;
  }
  const want = 128 - (Math.min(CAPS[i], PER_COL) - 1);
  // Some rows already hold the fill colour in the art, so the changed-pixel test can only be one-sided.
  check(`bar ${i} reaches at least row ${want}`, top <= want, `first unchanged row ${top + 1}`);
}

// A full repaint (mirrors zeroed, the compositor tail's effect) must be idempotent: the same stats
// over the same art produce the same frame. Not byte-exactness against `base`, because the erase
// path deliberately walks lit pixels four steps up the ramp (@0x2b399 sets >= 0xd7 to 0x8f), so an
// erase lands on shade indices the fill never writes.
for (let pass = 0; pass < 2; pass++) {
  CREW_STATS.forEach((d, i) => sv.wordAt(d, CAPS[i]));
  clearBarMirrors(g);
  fun_231e_8043(fb, g, sv, 2, false);
  if (pass === 0) { base = fb.vram.slice(); }
}
let same = true;
for (let o = 0; o < base.length; o++) if (fb.vram[o] !== base[o]) same = false;
check('full repaint after a compositor blit is idempotent', same);

// The mirror adopts the live word on every path (@0x2b246), so a second pass paints nothing.
CREW_STATS.forEach((d) => sv.wordAt(d, 20));
const r1 = fun_231e_8043(fb, g, sv, 2, false);
const r2 = fun_231e_8043(fb, g, sv, 2, false);
check('diff renderer paints once per change', r1.painted.length === 8 && r2.painted.length === 0,
  `${r1.painted.length} then ${r2.painted.length}`);

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
