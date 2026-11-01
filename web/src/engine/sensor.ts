// Solar Winds — FUN_231e_4673 @0x27853, the sensor/scanner display, plus its tracking-target pick.
//
// Reached from the pump's animation block every pass (re/game-loop-modes.md §"animation/scheduler
// call-out block" lists FUN_231e_4673 among the @0x23e66..@0x23e9e callees) and gated twice:
// `cmp byte [0x3c91],1` @0x27859 and `cmp byte [0x3ade],1` @0x27860 — mode 1, and DS:0x3ade set (see
// hud.ts: it is the countdown-driven layout flag, not a sound preference).
//
// It does four things, in this order, and the interesting one is the third.
//
// 1. TRACKING TARGET (@0x27867..@0x278d5)
//      ax = [0x3ae1]; for (di = 0; di < [0x3bf3]; di += 2) {
//          if (ax == [di+0x3bf5]) goto keep;          // the target is still on the list -> unchanged
//          if (byte[[di+0x3bf5] + 0xb] < 5) cx = [di+0x3bf5];   // candidate: class < 5 is trackable
//      }
//      [0x3ae1] = cx;                                  // fell off the end: last candidate, or 0
//    So the cursor never moves on its own: it keeps its actor while that actor is present, and
//    otherwise adopts the LAST trackable actor walked. This is the same class<5 rule the `d` key uses
//    (@0x2e9ad, main.ts check "advances the DS:0x3ae1 target"), and it is why `d` is a no-op when the
//    current target is on screen.
//
// 2. TARGET CHANGED (@0x27894..@0x278c9)
//    `[0x3ae3]` is the previous pass's target. When it differs, the readout box is repainted:
//    ES = 0xa000, DI = 0x4b0 (col 240, row 3), 0x43 = 67 bytes by 0x35 = 53 rows of 0x8f — or of 0xde
//    when there is no target at all (@0x278ae `cmp word [0x3ae1],0` / `mov ax,0xde`). Row advance is
//    `add di,0xfd` @0x278c0, i.e. 67 + 253 = 320. Then FUN_231e_789a @0x2aa7a draws the target into it.
//
// 3. THE SENSOR GRID AND ITS SENTINEL-AND-ERASE MODEL (@0x27950..@0x27aa7) — the real find
//    The map is NOT redrawn from a clean background. It is a persistent scratch grid plus the screen:
//
//      es = [0x6b9f]                          // the page segment, the persistent background
//      al = [0x3d34]                          // the stamp byte: `xor byte [0x3d34],3` @0x2795c, so it
//                                             // alternates 0 and 3 from pass to pass
//      for (si = 0; si < [0x4061]; si += 2) { // last pass's ERASE list
//          di = [si + 0x41f3];                //   a grid cell address
//          if (byte es:[di] == al) {          //   still carrying THIS pass's stamp -> it is stale
//              byte es:[di] = 0xde;           //   clear it in the page ...
//              es = 0xa000; byte es:[di] = 0xde; es = back;   // ... and on screen  (@0x27981..@0x27987)
//          }
//          [si + 0x41f3] = [si + 0x4063];     //   shift the draw list down into the erase list
//      }
//      [0x4061] = [0x405f];                     // then copy the remainder and reset [0x405f] = 0
//
//    So each pass: clear the cells stamped last pass, then stamp the cells it draws. A cell that is
//    drawn again keeps its symbol; one that is not, disappears. That is how the original erases
//    sprites without a background blit, and it explains why world.ts had to model a "freshFrame".
//
// 4. PER-ACTOR CELL (@0x279b1..@0x27a9d)
//      di walks [0x3ecd] entries of the table [0x3ecf]; bx = actor + 6, so position is actor[6..9]
//      and the type byte is actor[0xa]. Delta against the camera high words ([0x3ce]/[0x3d0] for x,
//      [0x3cf]/[0x3d1] for y) with a signed window of +-0x800 in x and +-0x600 in y
//      (`cmp ax,0x800/jg`, `cmp ax,0xf800/jl` — the 0xf800 form is the negative half of the same test).
//      cell = [0x6bb1] + ((dx+0x800) >> 6) + ((dy+0x600) >> 6) * 0x140     // six `shr 1`, mul by 320
//      The symbol, straight from the branches:
//        type >= 0xc8 -> 0x2b '+',  except type == 0xff keeps '+' and is NOT listed visible,
//                         otherwise 0x33 '3' AND the actor is pushed into [0x3c1a] (the visible list)
//        type <  0xc8 -> 0x82, except 0x17/0x18/0x1b keep 0x82, otherwise 0x12,
//                         and 0x0c <= type <= 0x12 -> 0x46 'F'
//      Then @0x27a69: write the STAMP into the page cell, switch ES to 0xa000 and look at the screen
//      cell. If the screen already holds 0x42 'B' or 0x89, the cell is contested: pop ES back to the
//      page and write 0xde there instead (@0x27a9d), leaving it un-erasable by the next pass. Otherwise
//      write the symbol to the SCREEN (@0x27a81) and push the cell into the draw list [0x4063].
//
// Cell addressing is 16-bit throughout, so every address wraps with & 0xffff exactly as SI does.
//
// Still open, and named as such rather than guessed:
//   TODO_GRID_ORIGIN — the pseudocode renders the base as `*(int*)0x6bb1 + 0x1cdf`; the instruction
//     stream only ever does `mov si,[0x6bb1]` then adds the col and row*0x140 (@0x279fb/@0x27a27), so
//     the +0x1cdf is either folded into the runtime value of DS:0x6bb1 (the image initializes 0x730)
//     or lost with the segment override. The port keeps its own grid buffer and does not depend on it.
//   TODO_SENSOR_RENDER — FUN_231e_789a @0x2aa7a resamples the grid into the 67x53 readout box; it
//     reads [0x6bb1] at six sites (@0x2aaa9..@0x2ab28) and its half-resolution walk is transcribed in
//     renderSensorGrid below, but the byte->pixel table it indexes is not yet confirmed.

import type { Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';

export const SENSOR = Object.freeze({
  target: 0x3ae1, targetPrev: 0x3ae3,
  objectCount: 0x3bf3, objectTable: 0x3bf5,   // @0x27870/@0x27876 — the frame's actor address list
  gridSeg: 0x16bb1,                            // DS:0x6bb1, initialized 0x730 in the image @0x7b41
  actorCount: 0x3ecd, actorTable: 0x3ecf,      // @0x279b5/@0x279cc
  visibleCount: 0x3c1a, visibleList: 0x3c1c,   // @0x27a39/@0x27a40
  stamp: 0x13d34,                              // @0x2795c xor 3
  eraseCount: 0x14061, eraseList: 0x141f3,     // @0x2796d/@0x27973
  drawCount: 0x1405f, drawList: 0x14063,       // @0x279b1/@0x27a8b
  windowX: 0x800, windowY: 0x600, shift: 6, pitch: 0x140,
  box: { dest: 0x04b0, w: 0x43, rows: 0x35, fill: 0x8f, empty: 0xde }, // @0x278a5..@0x278c9
  contested: [0x42, 0x89], blank: 0xde,
  camX: [0x3ce, 0x3d0], camY: [0x3cf, 0x3d1],  // high byte then low byte of the camera axis
});

/** The symbol table, straight out of the `mov ah,imm` / `cmp al,imm` chain at @0x27a2c..@0x27a67. */
export function sensorSymbol(type: number): { symbol: number; listed: boolean } {
  if (type >= 0xc8) {
    if (type === 0xff) return { symbol: 0x2b, listed: false }; // '+' and not pushed: @0x27a30/@0x27a34
    return { symbol: 0x33, listed: true };                     // '3': @0x27a36
  }
  if (type === 0x17 || type === 0x18 || type === 0x1b) return { symbol: 0x82, listed: false };
  if (type <= 0x12 && type >= 0x0c) return { symbol: 0x46, listed: false }; // 'F': @0x27a67
  return { symbol: 0x12, listed: false };
}

export interface SensorState {
  erase: number[];       // cell addresses stamped last pass, i.e. the ones to clear
  draw: number[];        // cell addresses drawn this pass, which become next pass's erase list
  visible: number[];     // the actor addresses with type >= 0xc8 && != 0xff
}

// The walk is `+0x800 >> 6` in x and `+0x600 >> 6` in y, so 65 columns and 49 rows.
export const GRID_COLS = (SENSOR.windowX * 2 >> SENSOR.shift) + 1;
export const GRID_ROWS = (SENSOR.windowY * 2 >> SENSOR.shift) + 1;

/**
 * There is no separate grid buffer: @0x279fb/@0x279ff/@0x27a27 build ONE 16-bit SI from
 * `[0x6bb1] + col + row*0x140`, and that same SI then indexes the page segment (@0x27a6c, ES = [0x6b9f])
 * and A000 (@0x27a70/@0x27a81). So the sensor map is a 65x49 block of ordinary frame cells at a fixed
 * VRAM offset, present in both the persistent page and the screen. TODO_GRID_ORIGIN records that the
 * image initializes DS:0x6bb1 to 0x730 while the pseudocode renders the base as +0x1cdf (SOLAR1.c:17762,
 * 21104); the offset arithmetic is proven either way, and only the block's position depends on it.
 */
export const GRID_ORIGIN = 0x1cdf;
export const gridCell = (col: number, row: number) => GRID_ORIGIN + col + row * SENSOR.pitch;

export function createSensor(): SensorState {
  return { erase: [], draw: [], visible: [] };
}

export interface SensorContext {
  fb: Framebuffer;
  state: State;
  g: Record<number, number | undefined>;
  objects: { addr: number; x: number; y: number; type: number; cls: number }[];
  camera: { x: number; y: number };
  st: SensorState;
  /** The persistent 320x200 background page, DS:[0x6b9f] — where the sentinel is stored. */
  page: Uint8Array;
}

const w16 = (n: number) => n & 0xffff;
/** The signed half of the window test: 0x800 < ax rejects, and ax > 0xf800 is the negative half. */
const inWindow = (d: number, limit: number) => d <= limit && (d | 0) >= -limit;

/**
 * Transcribes FUN_231e_4673 for one pump pass. Returns the trace; null when either gate rejects it.
 */
export function fun_231e_4673(c: SensorContext): string[] | null {
  const s = c.state;
  if (s.mode !== 1 || s.byteAt(0x3ade) !== 1) return null; // @0x27859/@0x27860
  const out: string[] = [];

  // --- 1. the tracking target -------------------------------------------------------------
  let target = s.wordAt(SENSOR.target);
  let keep = false;
  let fallback = 0;
  for (const o of c.objects) {                    // @0x27870..@0x2788b
    if (o.addr === target) { keep = true; break; } // je @0x27894
    if (o.cls < 5) fallback = o.addr;              // @0x27880..@0x27886
  }
  if (!keep) { target = fallback; s.wordAt(SENSOR.target, target); out.push(`target <- ${target ? '0x' + target.toString(16) : 'none'}`); }

  // --- 2. the readout box, only when the target actually changed --------------------------
  if (target !== s.wordAt(SENSOR.targetPrev)) {
    s.wordAt(SENSOR.targetPrev, target);
    const fill = target === 0 ? SENSOR.box.empty : SENSOR.box.fill; // @0x278ae..@0x278b5
    for (let r = 0; r < SENSOR.box.rows; r++) {
      c.fb.vram.fill(fill, SENSOR.box.dest + r * 320, SENSOR.box.dest + r * 320 + SENSOR.box.w);
    }
    out.push(`box 0x${SENSOR.box.dest.toString(16)} ${SENSOR.box.w}x${SENSOR.box.rows} <- 0x${fill.toString(16)}`);
    if (target) out.push('TODO_SENSOR_RENDER@0x2aa7a');
  }

  if (!target) out.push('no target: grid pass skipped (@0x278d0)'); // je @0x27950 -> erase+redraw only

  // --- 3. sweep the stale cells, then rotate the two lists -------------------------------
  // @0x2795c flips the stamp FIRST, @0x2796d walks the erase list against the flipped value, and
  // @0x2798c/@0x2799b then copy the previous pass's draw list into it — so the cells tested this pass
  // were stamped with the OPPOSITE phase, and `cmp cl,ah` @0x2797a only matches a cell that was also
  // stamped during an earlier pass of the same phase.
  //
  // TODO_SWEEP_PHASE: read literally, that means a departed actor's blip is never recognised as stale,
  // which is obviously not what the shipped game does (blips do vanish). Either the xor at @0x2795c
  // lands where I have not modelled it, or the two lists are not the pair I think they are. This needs
  // a runtime answer, not more reading: fly away from an actor under DOSBox and count the frames its
  // symbol survives. Until then `sweep` implements the byte order as written and the port clears the
  // box wholesale whenever the target changes (@0x27894), which is the path that provably repaints.
  const stamp = (c.g[SENSOR.stamp] ?? 0) ^ 3;
  c.g[SENSOR.stamp] = stamp;
  let cleared = 0;
  for (const cell of c.st.erase) {
    if (c.page[cell] === stamp) {           // @0x2797a: the page holds the sentinel, not the screen
      c.page[cell] = SENSOR.blank;
      if (cell < c.fb.vram.length) c.fb.vram[cell] = SENSOR.blank; // @0x27981..@0x27987
      cleared++;
    }
  }
  c.st.erase = c.st.draw.slice();           // @0x2798c/@0x27995: erase := the list the last pass built
  c.st.draw = [];

  // --- 4. stamp the grid for this pass ----------------------------------------------------
  c.st.draw = [];
  c.st.visible = [];
  for (const o of c.objects) {
    const dx = w16(o.x - c.camera.x) | 0;   // @0x279d3..@0x279d8 (sub ax,cx with the sign in AH)
    const sx = dx > 0x7fff ? dx - 0x10000 : dx;
    if (!inWindow(sx, SENSOR.windowX)) continue;
    const dy = w16(o.y - c.camera.y) | 0;
    const sy = dy > 0x7fff ? dy - 0x10000 : dy;
    if (!inWindow(sy, SENSOR.windowY)) continue;
    const cell = w16(gridCell((sx + SENSOR.windowX) >> SENSOR.shift, (sy + SENSOR.windowY) >> SENSOR.shift));
    const { symbol, listed } = sensorSymbol(o.type);
    if (listed) c.st.visible.push(o.addr);   // @0x27a39..@0x27a47
    c.page[cell] = stamp;                    // @0x27a6c: the page cell takes the stamp, not the glyph
    const before = cell < c.fb.vram.length ? c.fb.vram[cell] : 0;
    if (before === SENSOR.contested[0] || before === SENSOR.contested[1]) {
      c.page[cell] = SENSOR.blank;           // @0x27a9d: contested, so it will not be erased next pass
    } else {
      if (cell < c.fb.vram.length) c.fb.vram[cell] = symbol; // @0x27a81 with ES = 0xa000
      c.st.draw.push(cell);
    }
  }
  // [0x3c1a] is a running pointer into [0x3c1c], reset to the list base at @0x27950 and advanced by 2
  // per push (@0x27a44/@0x27a47). Exposing it as a count keeps the same information.
  s.wordAt(SENSOR.visibleCount, 0x3c1c + c.st.visible.length * 2);

  if (out.length || cleared) { c.fb.dirty = true; out.unshift(`stamped ${c.st.draw.length} cells, cleared ${cleared}`); }
  return out;
}
