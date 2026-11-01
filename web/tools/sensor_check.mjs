// Checks FUN_231e_4673 @0x27853 — the sensor grid, its sentinel-and-erase model, and the tracking pick.
// Usage: node web/tools/sensor_check.mjs
import { createSession } from '../src/main.ts';
import { SENSOR, sensorSymbol, createSensor, fun_231e_4673, GRID_COLS, GRID_ROWS, gridCell } from '../src/engine/sensor.ts';

let fail = 0;
const check = (l, ok, d = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) fail++; };

// --- the symbol table, from the mov ah / cmp al chain at @0x27a2c..@0x27a67 -----------------------
check("type >= 0xc8 is '3' (0x33) and joins the visible list", [0xc8, 0xd0, 0xfe].every((t) => {
  const r = sensorSymbol(t); return r.symbol === 0x33 && r.listed;
}));
check("type 0xff keeps '+' (0x2b) and is NOT listed (@0x27a32/@0x27a34)",
  sensorSymbol(0xff).symbol === 0x2b && sensorSymbol(0xff).listed === false);
check("types 0x17/0x18/0x1b keep 0x82 (@0x27a51..@0x27a5b)",
  [0x17, 0x18, 0x1b].every((t) => sensorSymbol(t).symbol === 0x82));
check("0x0c..0x12 are 'F' (0x46), anything else under 0xc8 is 0x12 (@0x27a5d..@0x27a67)",
  [0x0c, 0x0f, 0x12].every((t) => sensorSymbol(t).symbol === 0x46)
  && [0x00, 0x0b, 0x13, 0x16, 0x19, 0x1a, 0x1c, 0xc7].every((t) => sensorSymbol(t).symbol === 0x12));

// --- geometry -------------------------------------------------------------------------------
check('the grid spans the +-0x800 / +-0x600 window in 64-pixel cells (@0x279ec/@0x27a13)',
  GRID_COLS === 65 && GRID_ROWS === 49, `${GRID_COLS}x${GRID_ROWS}`);
check('the readout box is 67x53 at A000:0x4b0 = col 240 row 3 (@0x278a5)',
  SENSOR.box.dest === 0x4b0 && SENSOR.box.dest % 320 === 240 && Math.floor(SENSOR.box.dest / 320) === 3
  && SENSOR.box.w + 0xfd === 320);

// --- the routine's gates --------------------------------------------------------------------
const mk = (mode, ade, objs, cam) => {
  const s = createSession();
  return s.then((sess) => {
    sess.state.sv.byteAt(0x3c91, mode);
    sess.state.sv.byteAt(0x3ade, ade);
    return { sess, objs, cam };
  });
};
// The port's real page buffer is main.ts's; a harness-local one is the same 320x200 image and keeps
// the sweep's state under the test's control.
const pages = new WeakMap();
const ctx = (sess, objs, cam, st = createSensor()) => {
  if (!pages.has(sess.fb)) pages.set(sess.fb, new Uint8Array(64000).fill(0xde));
  return { fb: sess.fb, state: sess.state.sv, g: sess.state.g, objects: objs, camera: cam, st,
    page: pages.get(sess.fb) };
};

const s0 = await createSession();
s0.state.sv.byteAt(0x3c91, 2); s0.state.sv.byteAt(0x3ade, 1);
check('silent outside mode 1 (@0x27859)', fun_231e_4673(ctx(s0, [], { x: 0, y: 0 })) === null);
s0.state.sv.byteAt(0x3c91, 1); s0.state.sv.byteAt(0x3ade, 0);
check('silent with DS:0x3ade != 1 (@0x27860)', fun_231e_4673(ctx(s0, [], { x: 0, y: 0 })) === null);

// --- the sentinel-and-erase cycle: the claim that matters ------------------------------------
const st = createSensor();
const sess = await createSession();
sess.state.sv.byteAt(0x3c91, 1); sess.state.sv.byteAt(0x3ade, 1);
const A = { addr: 0x4000, x: 0x100, y: 0x200, type: 0xc8, cls: 6 };
const cellOf = (o) => gridCell((o.x + SENSOR.windowX) >> 6, (o.y + SENSOR.windowY) >> 6);
const cell = cellOf(A);

const t1 = fun_231e_4673(ctx(sess, [A], { x: 0, y: 0 }, st));
const screenAfter1 = sess.fb.vram[cell];
check('pass 1 stamps the cell with the glyph on screen', screenAfter1 === 0x33,
  `0x${screenAfter1.toString(16)} @cell ${cell}`);
check('pass 1 records exactly one draw cell', st.draw.length === 1, JSON.stringify(st.draw));

const t2 = fun_231e_4673(ctx(sess, [A], { x: 0, y: 0 }, st));
check('a cell drawn again keeps its glyph (stamped, so the erase skips it)',
  sess.fb.vram[cell] === 0x33 && t2[0].includes('cleared 0'), t2[0]);

// What IS established is the shape of the sweep, not when it fires; the timing is TODO_SWEEP_PHASE.
const before = st.draw.slice();
fun_231e_4673(ctx(sess, [], { x: 0, y: 0 }, st));
check('the lists rotate the byte way: erase := the list the last pass built, draw is reset (@0x2798c/@0x279b1)',
  st.draw.length === 0 && JSON.stringify(st.erase) === JSON.stringify(before),
  `erase ${JSON.stringify(st.erase)} from ${JSON.stringify(before)}; when a stale cell is recognised is TODO_SWEEP_PHASE`);
// A cell drawn on two passes of the same phase is recognised, which is the one case the bytes decide.
const ps = createSensor();
for (let i = 0; i < 2; i++) fun_231e_4673(ctx(sess, [A], { x: 0, y: 0 }, ps));
const stamped = sess.state.g[SENSOR.stamp];
const pg = pages.get(sess.fb);
check('the stamp alternates each pass so the sweep can tell its own writes from an older pass',
  ps.draw.length === 1 && pg[cellOf(A)] === stamped, `page 0x${pg[cellOf(A)].toString(16)} stamp ${stamped}`);

const stampSeq = [];
for (let i = 0; i < 4; i++) { fun_231e_4673(ctx(sess, [], { x: 0, y: 0 }, st)); stampSeq.push(sess.state.g[SENSOR.stamp]); }
check('the stamp alternates 0/3, so a stale cell is identifiable by value (@0x2795c)',
  stampSeq.every((v, i) => v === (i % 2 === 0 ? 3 : 0)) || stampSeq.every((v, i) => v === (i % 2 === 0 ? 0 : 3)),
  stampSeq.join(','));

// --- the window test ----------------------------------------------------------------------
const ws = createSensor();
fun_231e_4673(ctx(sess, [{ ...A, x: 0x801 }], { x: 0, y: 0 }, ws));
check('dx beyond +0x800 is culled (@0x279da)', ws.draw.length === 0);
fun_231e_4673(ctx(sess, [{ ...A, x: -0x801 }], { x: 0, y: 0 }, ws));
check('dx beyond -0x800 is culled, via the 0xf800 form (@0x279df)', ws.draw.length === 0);
fun_231e_4673(ctx(sess, [{ ...A, y: 0x601 }], { x: 0, y: 0 }, ws));
check('dy beyond +0x600 is culled (@0x27a0c)', ws.draw.length === 0);
fun_231e_4673(ctx(sess, [{ ...A, x: 0x800, y: 0x600 }], { x: 0, y: 0 }, ws));
check('the window edges are inclusive (@0x279dd/@0x27a0c jg, not jae)', ws.draw.length === 1);

// --- the contested-cell path --------------------------------------------------------------
const cs = createSensor();
const cx = cellOf(A);
sess.fb.vram[cx] = 0x42;                    // a 'B' already on screen at that cell
fun_231e_4673(ctx(sess, [A], { x: 0, y: 0 }, cs));
check('a cell already holding 0x42 or 0x89 keeps it and is not added to the draw list (@0x27a75/@0x27a9d)',
  sess.fb.vram[cx] === 0x42 && cs.draw.length === 0);

// --- the tracking pick --------------------------------------------------------------------
sess.state.sv.wordAt(SENSOR.target, 0);
const objs = [{ addr: 0x1111, x: 0, y: 0, type: 1, cls: 9 }, { addr: 0x2222, x: 0, y: 0, type: 1, cls: 1 },
  { addr: 0x3333, x: 0, y: 0, type: 1, cls: 4 }];
fun_231e_4673(ctx(sess, objs, { x: 0, y: 0 }, createSensor()));
check('with no current target it adopts the LAST class<5 actor (@0x27880/@0x27886)',
  sess.state.sv.wordAt(SENSOR.target) === 0x3333, '0x' + sess.state.sv.wordAt(SENSOR.target).toString(16));
sess.state.sv.wordAt(SENSOR.target, 0x1111);
fun_231e_4673(ctx(sess, objs, { x: 0, y: 0 }, createSensor()));
check('a target still on the list is kept even though it is not trackable (@0x27876 je @0x27894)',
  sess.state.sv.wordAt(SENSOR.target) === 0x1111);
sess.state.sv.wordAt(SENSOR.target, 0x9999);
fun_231e_4673(ctx(sess, objs, { x: 0, y: 0 }, createSensor()));
check('a target that left the list is replaced (@0x27890)', sess.state.sv.wordAt(SENSOR.target) === 0x3333);

// --- the readout box ----------------------------------------------------------------------
const bs = createSession().then ? await createSession() : null;
bs.state.sv.byteAt(0x3c91, 1); bs.state.sv.byteAt(0x3ade, 1);
bs.fb.vram.fill(0x11, 0, bs.fb.vram.length);
bs.state.sv.wordAt(SENSOR.target, 0); bs.state.sv.wordAt(SENSOR.targetPrev, 0xffff);
fun_231e_4673(ctx(bs, [], { x: 0, y: 0 }, createSensor()));
check('no target clears the box to 0xde (@0x278ae/@0x278b5)',
  bs.fb.vram[SENSOR.box.dest] === 0xde && bs.fb.vram[SENSOR.box.dest + 32 * 320 + 66] === 0xde);
bs.state.sv.wordAt(SENSOR.target, 0); bs.state.sv.wordAt(SENSOR.targetPrev, 0xffff);
bs.fb.vram.fill(0x11, 0, bs.fb.vram.length);
bs.state.sv.wordAt(SENSOR.target, 0x1234);
fun_231e_4673(ctx(bs, [{ addr: 0x1234, x: 0, y: 0, type: 1, cls: 1 }], { x: 0, y: 0 }, createSensor()));
check('a target paints the box with 0x8f and flags the render TODO (@0x278ab)',
  bs.fb.vram[SENSOR.box.dest] === 0x8f && bs.fb.vram[SENSOR.box.dest + 67] === 0x11
  && bs.fb.vram[SENSOR.box.dest + 320] === 0x8f);

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
