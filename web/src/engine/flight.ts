// FUN_231e_0bf6 flight block + FUN_231e_02dd @0x234bd — the inertial flight model, transcribed.
//
// Address law: linear = DS + 0x10190, file = DS + 0xF90.
//
// STATE (all in the BH_START save image, so a savegame carries the ship's motion)
//   DS:0x3c92  u8    heading, index into a 32-step circle (11.25 deg per step)
//   DS:0x3c93  i8    turn rate counter, shared by both turn directions
//   DS:0x3c98  i16   forward speed along the heading (negative = reverse)
//   DS:0x3c9a  u16   peak speed seen so far (max tracker at @0x24190)
//   DS:0x3e39  i16   per-pass X delta, sub-pixel (128 units = 1 pixel)
//   DS:0x3e37  i16   per-pass Y delta, sub-pixel
//   DS:0x3ec5  i16   X accumulator; DS:0x3ec7 = Y accumulator
//   DS:0x3ce..0x3d7  camera, five bytes per axis, MSB at 0x3ce/0x3cf, LSB at 0x3d6/0x3d7
//   DS:0x3ae8  18 words  parallax layer offsets; DS:0x3b10  their enable/scale partners
//   DS:0x3ade  u8    zoom flag - halves the layer step (@0x241c7) and the blit
//   DS:0x3c55  u8    gate for the parallax update (@0x241be)
//
// TRIG TABLES — shipped inside the save image, 32 entries of int16 at amplitude 256:
//   DS:0x3e3f  cos(h) = 256,251,237,213,181,142,98,50,0,-50,...  (read as [bx+0x3e3f], bx=h*2)
//   DS:0x3e7f  sin(h) = 0,50,98,142,181,213,237,251,256,251,...  (read as [bx+0x3e7f])
//   Note Ghidra renders the second as `+15999` (0x3e9f); the shipped bytes at @0x234e8 say 0x3e7f.
//
// FUN_231e_02dd @0x234bd..@0x23502 — delta from heading and speed, called after every speed or
// heading change (lcall 0x131e,0x2dd at @0x243c7/@0x243e3/@0x243f6/@0x2448c/@0x244af):
//   bx = heading * 2
//   [0x3e39] = (int16(0x3e3f[bx]) * [0x3c98]) >> 4      imul then shr dx,1/rcr ax,1 four times
//   [0x3e37] = (int16(0x3e7f[bx]) * [0x3c98]) >> 4
// So one unit of speed contributes 256/16 = 16 sub-pixel units = 1/8 of a pixel per pass, i.e.
// ~4.8 px/s per speed unit at the 38.49 Hz clock. At the max thrust of 33 the ship crosses a
// 256-pixel cell in about 6.5 seconds.
//
// CONTROLS — the block at @0x243b0..@0x244b7, executed on every pump pass (AL holds the event code;
// `cmp al,0x39 / jne 0x243fe` at @0x243b0 routes everything except Space into the control tests):
//   Space 0x39   @0x243b0..@0x243db  brake toward zero: speed -= 4 while > 4 (then clamp to 0x27),
//                                    0 when <= 4; the mirrored path at @0x243dc handles negative
//                                    speed (+= 4 while < -4, else 0). Recompute deltas, end pass.
//   Left  0x4b   @0x243fe..@0x24438  cs:[0x41]==1 (INT 9 held byte, set at @0x23cb0's sibling) or
//                                    word DS:0x4d5f==1 -> if the rate byte [0x3c93] >= 1: heading =
//                                    (heading >= 0x1f ? 0xff : heading) + 1, [0x3c93] = 0xff, chirp;
//                                    otherwise just [0x3c93] += 1. A real turn calls FUN_231e_0458
//                                    @0x2442a, whose tail calls FUN_231e_02dd @0x237f1 and therefore
//                                    rotates the current velocity to the new heading immediately.
//   Right 0x4d   @0x2443b..@0x24470  cs:[0x40]==1 (set at @0x23d00) or DS:0x4d61==1 -> symmetric:
//                                    heading = (heading == 0 ? 0x20 : heading) - 1, [0x3c93] = 1;
//                                    its FUN_231e_0458 call likewise recomputes velocity @0x237f1.
//   Up    0x48   @0x24471..@0x24493  cs:[0x3c]==1 or DS:0x4d5b==1 -> if speed < 0x22: speed += 3.
//   Down  0x50   @0x24494..@0x244b6  cs:[0x3d]==1 (set at @0x23d26) or DS:0x4d5d==1 -> speed -= 3
//                                    while speed > -0x22.
//   There is NO friction anywhere: releasing Up keeps the heading and speed forever. Solar Winds is
//   Newtonian, which is exactly what the earlier port's instant-stop movement got wrong.
//
// POSITION INTEGRATION — @0x24199..@0x24264 (X) and @0x24265..@0x2433f (Y). `mov si,8` then
// `[si+0x3ce]` addresses DS:0x3d6, and the carry chain walks DOWNWARD (adc/sbb [si+0x3cc] ->
// DS:0x3d4, then 0x3d2, 0x3d0, 0x3ce), which proves the camera is little-endian-from-0x3ce =
// MSB-first-from-0x3ce with the LSB at 0x3d6 - the same five bytes the renderer reads. The Y block
// re-enters with `mov si,9`, giving DS:0x3d7 down to DS:0x3cf.
//   acc = [0x3ec5] + [0x3e39]; [0x3ec5] = acc
//   if acc > 0x7f -> n = (acc << 1) >> 8; add n to the camera; acc = 0
//   if acc <= -0x7f -> n = ((-acc) << 1) >> 8; subtract n; acc = 0
// The X branch adds the raw pixel step to the parallax offsets; the Y branch multiplies by 0x140
// first (@0x2429f), i.e. it moves those layers by whole VRAM rows.

import type { State } from './state.ts';

export const HEADING = 0x3c92;
export const TURN_RATE = 0x3c93;
export const SPEED = 0x3c98;
export const SPEED_PEAK = 0x3c9a;
export const VEL_X = 0x3e39;
export const VEL_Y = 0x3e37;
export const ACC_X = 0x3ec5;
export const ACC_Y = 0x3ec7;
export const CAM_X_LSB = 0x3d6;          // carries down to 0x3ce
export const CAM_Y_LSB = 0x3d7;          // carries down to 0x3cf
export const COS_TABLE = 0x3e3f;
export const SIN_TABLE = 0x3e7f;
export const STEPS = 32;                  // 11.25 degrees
export const LAYER_TABLE = 0x3ae8;
export const LAYER_GATE = 0x3b10;
export const LAYER_COUNT = 0x24 / 2;      // @0x241d3 mov ax,0x24 with di stepping 2
export const PARALLAX_GATE = 0x3c55;
export const ZOOM_FLAG = 0x3ade;
export const BRAKE_KEY = 0x39;            // @0x243b0
export const MAX_THRUST = 0x22;           // @0x24480
export const MAX_REVERSE = -0x22;         // @0x244a3
export const BRAKE_CAP = 0x27;            // @0x243ce

const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;
const s16 = (v: number): number => (((v & 0xffff) << 16) >> 16);
const word = (state: State, at: number): number =>
  state.byteAt(at) | (state.byteAt(at + 1) << 8);
const tableWord = (state: State, at: number): number => s16(word(state, at));

/** FUN_231e_02dd @0x234bd: turn heading+speed into the two sub-pixel per-pass deltas. */
export function computeVelocity(state: State): void {
  const bx = (state.byteAt(HEADING) % STEPS) * 2;                        // @0x234c3..@0x234c9
  const speed = tableWord(state, SPEED);                                  // @0x234cf
  const vx = (tableWord(state, COS_TABLE + bx) * speed) >> 4;             // @0x234cb..@0x234e5
  const vy = (tableWord(state, SIN_TABLE + bx) * speed) >> 4;             // @0x234e8..@0x23502
  setWord(state, VEL_X, vx);
  setWord(state, VEL_Y, vy);
}

function setWord(state: State, at: number, value: number): void {
  state.byteAt(at, value & 0xff);
  state.byteAt(at + 1, (value >> 8) & 0xff);
}

/** Add a signed pixel step to one 40-bit camera axis, carrying LSB -> MSB (@0x241ef/@0x24247). */
function carryAxis(state: State, lsb: number, step: number): void {
  let value = step;
  for (let off = lsb; off >= lsb - 8; off -= 2) {                        // 5 bytes, stride 2
    const next = state.byteAt(off) + value;
    state.byteAt(off, next & 0xff);
    // Preserve a negative borrow as -1. Masking it to 0xff here would add 255 to the next byte,
    // creating a carry back into the byte above that and teleporting west/up travel by 256 cells.
    // `floor` is exactly the ADC/SBB propagation for both signs: 0x00-1 -> -1, 0x63-1 -> 0.
    value = Math.floor(next / 0x100);                                     // CF/borrow of byte add
    if (value === 0) break;                                              // sbb/adc 0 chain settles
  }
}

/**
 * One pump pass of the flight model. `event` is the raw make code the pump is carrying in AL (0
 * when no key moved); `held` is the INT 9 held-byte state, mirrored into the port's flags.
 */
/** The port's equivalent of the four `cs:[0x3c..0x41]` INT 9 held bytes plus their DS:0x4d5x twins. */
export interface HeldFlags { up?: number; down?: number; left?: number; right?: number }

/**
 * @0x243b0..@0x244b6, run every pump pass after the position integration. `event` is the raw make
 * code in AL (0 when no key moved). Turns do not end the pass (@0x24438 jumps to the thrust tests);
 * every arm that changes speed does, via `lcall 0x131e,0x2dd / jmp 0x23dd9`.
 */
export function stepFlight(state: State, event: number, held: HeldFlags): 'ended' | 'continue' {
  if (event === BRAKE_KEY) {                                             // @0x243b0 cmp al,0x39
    let speed = tableWord(state, SPEED);
    if (speed > 0) {
      if (speed <= 4) speed = 0;                                         // @0x243bb -> 0x243f0
      else {
        speed -= 4;                                                      // @0x243c2
        if (speed > BRAKE_CAP) speed = BRAKE_CAP;                        // @0x243c7..@0x243ce
      }
    } else if (speed < -4) speed += 4;                                   // @0x243e3
    else speed = 0;                                                      // @0x243f0
    setWord(state, SPEED, speed);
    computeVelocity(state);
    return 'ended';                                                      // @0x243d9/@0x243e8/@0x243f6
  }

  // @0x243fe: left takes priority; its guard is the DS:0x4d5f word or cs:[0x41] (@0x24402/@0x24409).
  if (mirror(state, 0x4d5f) === 1 || held.left === 1) {
    if (rate(state) >= 1) {                                              // @0x24411 jb
      let h = state.byteAt(HEADING);
      if (h >= 0x1f) h = 0xff;                                           // @0x2441d
      state.byteAt(HEADING, (h + 1) & 0xff);                             // @0x24424/@0x24426
      state.byteAt(TURN_RATE, 0xff);                                     // @0x24418
      computeVelocity(state);                                            // FUN_0458 @0x2442a -> FUN_02dd @0x237f1
    }
    state.byteAt(TURN_RATE, (rate(state) + 1) & 0xff);                   // @0x24434 (both paths)
  } else if (mirror(state, 0x4d61) === 1 || held.right === 1) {       // @0x2443b/@0x24442
    if (!(rate(state) > -1)) {                                           // @0x2444a jg -> skip turn
      let h = state.byteAt(HEADING);
      if (h === 0) h = 0x20;                                             // @0x24456
      state.byteAt(HEADING, (h - 1) & 0xff);                             // @0x2445d/@0x2445f
      state.byteAt(TURN_RATE, 1);                                        // @0x24451
      computeVelocity(state);                                            // FUN_0458 @0x24463 -> FUN_02dd @0x237f1
    }
    state.byteAt(TURN_RATE, (rate(state) - 1) & 0xff);                   // @0x2446d
  }

  // @0x24471: thrust. `cmp word[0x3c98],0x22 / jge 0x244b7` means the pass continues at the cap.
  if (mirror(state, 0x4d5b) === 1 || held.up === 1) {
    const speed = tableWord(state, SPEED);
    if (speed < MAX_THRUST) { setWord(state, SPEED, speed + 3); computeVelocity(state); return 'ended' }
  } else if (mirror(state, 0x4d5d) === 1 || held.down === 1) {         // @0x24494/@0x2449b
    const speed = tableWord(state, SPEED);
    if (speed > MAX_REVERSE) { setWord(state, SPEED, speed - 3); computeVelocity(state); return 'ended' }
  }
  return 'continue';
}

/** The DS:0x4d5x words are the non-keyboard input mirrors, above the save image (@0x4653). They are
 * read here so the arms stay faithful, but the port has no source that writes them; treat a read
 * fault as the shipped zero. The keyboard path is the cs:[0x3c..0x41] held bytes. */
function mirror(state: State, at: number): number {
  try { return word(state, at) } catch { return 0 }
}

function rate(state: State): number { return s8(state.byteAt(TURN_RATE)) }

/** The two accumulator/threshold blocks at @0x24199..@0x2433f. */
export function integrate(state: State): void {
  const zoom = state.byteAt(ZOOM_FLAG) === 1;
  const parallax = state.byteAt(PARALLAX_GATE) !== 0;

  let acc = tableWord(state, ACC_X);                                     // @0x2419c
  acc = s16(acc + tableWord(state, VEL_X));
  setWord(state, ACC_X, acc);
  if (acc > 0x7f) {                                                      // @0x241ab
    const step = ((acc << 1) >> 8) & 0xff;                              // @0x24210..@0x24214
    shiftLayers(state, step, false, zoom, parallax);
    carryAxis(state, CAM_X_LSB, step);
    setWord(state, ACC_X, 0);                                            // @0x2425f
  } else if (acc <= -0x7f) {                                             // @0x241a6
    const step = (((-acc & 0xffff) << 1) >> 8) & 0xff;                   // @0x241b6..@0x241bc
    shiftLayers(state, -step, false, zoom, parallax);
    carryAxis(state, CAM_X_LSB, -step);
    setWord(state, ACC_X, 0);                                            // @0x24207
  }

  acc = tableWord(state, ACC_Y);                                         // @0x24268
  acc = s16(acc + tableWord(state, VEL_Y));
  setWord(state, ACC_Y, acc);
  if (acc > 0x7f) {                                                      // @0x24277
    const step = ((acc << 1) >> 8) & 0xff;                              // @0x242e3..@0x242e7
    shiftLayers(state, step * 0x140, true, zoom, parallax);              // @0x242fe mul 0x140
    carryAxis(state, CAM_Y_LSB, step);
    setWord(state, ACC_Y, 0);                                            // @0x2433c
  } else if (acc <= -0x80) {                                             // @0x24272
    const step = (((-acc & 0xffff) << 1) >> 8) & 0xff;                   // @0x24282..@0x24288
    shiftLayers(state, -step * 0x140, true, zoom, parallax);
    carryAxis(state, CAM_Y_LSB, -step);
    setWord(state, ACC_Y, 0);                                            // @0x242dd
  }
}

/** @0x241d0..@0x241ed: move every parallax entry whose gate word is non-zero. */
function shiftLayers(state: State, delta: number, _rows: boolean, zoom: boolean, enabled: boolean): void {
  if (!enabled) return;
  const step = zoom ? delta >> 1 : delta;                                // @0x241c7..@0x241ce
  for (let i = 0; i < LAYER_COUNT; i++) {
    const at = LAYER_TABLE + i * 2, gate = LAYER_GATE + i * 2;
    if (tableWord(state, at) !== 0 && tableWord(state, gate) !== 0) {     // @0x241d6/@0x241dd
      setWord(state, at, tableWord(state, at) + step);                    // @0x241e4/@0x24231
    }
  }
}

/** The camera as a JS number pair, for diagnostics and the port's `app.camera` accessor. */
export function cameraPosition(state: State): { x: number; y: number } {
  const read = (lsb: number): number => {
    let v = 0;
    for (let off = lsb - 8; off <= lsb; off += 2) v = v * 256 + state.byteAt(off);
    return v;
  };
  return { x: read(CAM_X_LSB), y: read(CAM_Y_LSB) };
}

/** Absolute cell/pixel position of one axis of an actor or the camera, for the sector maths. */
export function axisBytes(state: State, address: number, off: number): number[] {
  return [0, 2, 4, 6, 8].map((k) => state.byteAt(address + off + k));
}
