// Nearby hostile ship scheduler: FUN_231e_bdc8 @0x2efa8 and its state routines.
//
// An actor's +b/+c word is a 1-based index into the mutable 0x20-byte records at DS:0xe0f.
// Record +7 is the behaviour state, +0 the current 32-way heading/art selector, +8 velocity,
// +9 its 1/32-pixel accumulator, and +10 the trajectory-frame cursor.  FUN_231e_bf14 moves the
// actor through the executable's DS:0x6533 trajectory lists.  States 2 and 4 steer toward the
// camera; states 5 and 6 remain dormant until the player enters their original radius.

import type { State } from './state.ts';
import { bearing32, bearingRecords, turnHeadingOne } from './bearing.ts';
import {
  PROJECTILE_AGE,
  PROJECTILE_BASE,
  PROJECTILE_COUNT,
  PROJECTILE_EXPIRED,
  PROJECTILE_META,
  PROJECTILE_META_STRIDE,
  PROJECTILE_STRIDE,
} from './combat.ts';

const EXE_DS_FILE_BIAS = 0xf90;
export const ENEMY_OBJECTS = 0x0e0f;
export const ENEMY_OBJECT_STRIDE = 0x20;
export const ENEMY_TRAJECTORY_POINTERS = 0x6533;
export const ENEMY_REWARD_TABLE = 0x54aa;
export const ACTORS = 0x03d8;
export const ACTOR_STRIDE = 0x0d;
export const ACTOR_SENTINEL = 0x0e0d;
export const CAMERA = 0x03ce;

const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;
const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;
const exeWord = (exe: Uint8Array, ds: number): number => {
  const at = ds + EXE_DS_FILE_BIAS;
  return exe[at] | (exe[at + 1] << 8);
};

function addAxis(state: State, actor: number, axis: 0 | 1, amount: number): void {
  let carry = amount;
  for (let off = 8 + axis; off >= axis; off -= 2) {
    const next = state.byteAt(actor + off) + carry;
    state.byteAt(actor + off, next & 0xff);
    carry = next < 0 ? -1 : next > 0xff ? 1 : 0;
    if (carry === 0) break;
  }
}

function lowDelta(state: State, actor: number, axis: 0 | 1): number {
  const a = (state.byteAt(actor + 6 + axis) << 8) | state.byteAt(actor + 8 + axis);
  const c = (state.byteAt(CAMERA + 6 + axis) << 8) | state.byteAt(CAMERA + 8 + axis);
  return s16(a - c);
}

function target(state: State, actor: number): { heading: number; dx: number; dy: number; d2: number } {
  const aim = bearingRecords(state, actor, CAMERA);
  return { ...aim, d2: aim.dx * aim.dx + aim.dy * aim.dy };
}

/** FUN_231e_bf14 @0x2f0f4: convert velocity accumulation into trajectory-table movement. */
function move(state: State, exe: Uint8Array, actor: number, object: number): boolean {
  const velocity = s8(state.byteAt(object + 8));
  const sum = s8(state.byteAt(object + 9)) + velocity;
  if (sum >= -0x20 && sum < 0x21) {
    state.byteAt(object + 9, sum);
    return false;
  }
  let repeats: number, direction: number;
  if (sum < -0x20) {
    repeats = 1;
    direction = (state.byteAt(object) + 0x20) & 0x3f;
  } else {
    repeats = (sum & 0xff) >> 5;
    direction = state.byteAt(object) & 0x1f;
  }
  state.byteAt(object + 9, 0);
  const list = exeWord(exe, ENEMY_TRAJECTORY_POINTERS + direction * 2);
  let frame = state.byteAt(object + 10) & 0x7f;
  let pair = exeWord(exe, list + frame * 2);
  if (pair === 0x8888) { frame = 0; pair = exeWord(exe, list); }
  state.byteAt(object + 10, (frame + 1) & 0xff);
  while (repeats-- > 0) {
    addAxis(state, actor, 0, s8(pair));
    addAxis(state, actor, 1, s8(pair >> 8));
  }
  return true;
}

function timerReady(state: State, object: number): boolean {
  const next = (state.byteAt(object + 0x12) + 1) & 0xff;
  state.byteAt(object + 0x12, next);
  if (next <= state.byteAt(object + 0x13)) return false;
  state.byteAt(object + 0x12, 0);
  return true;
}

function state2(state: State, actor: number, object: number): void {
  if (state.byteAt(0x3add) !== 0 || !timerReady(state, object)) return;
  const aim = target(state, actor);
  let speed = s8(state.byteAt(object + 8));
  const maximum = s8(state.byteAt(object + 0x14));
  if (aim.dx < 0xb5 && aim.dy < 0xb5 && speed < maximum) {
    if (speed >= 0 && speed * 2 < maximum) speed += 6;
    speed += 3;
    state.byteAt(object + 8, speed);
  }
  let wanted = aim.heading;
  if (aim.dx < 0xb5 && aim.dy < 0xb5) {
    if (aim.d2 <= 16000) {
      if (aim.d2 > 2999 && state.byteAt(object + 0x17) === 0) {
        // direct pursuit
      } else {
        state.byteAt(object + 0x17, 1);
        const count = (state.byteAt(object + 0x16) + 1) & 0xff;
        state.byteAt(object + 0x16, count);
        if (count <= 0x46) wanted = (aim.heading + 0x10) & 0x1f;
      }
    } else {
      state.byteAt(object + 0x16, 0);
      state.byteAt(object + 0x17, 0);
    }
  }
  const current = state.byteAt(object) & 0x1f;
  // @0x2f64a: state 2 raises +0x15 only while its weapon axis is exactly on target.
  state.byteAt(object + 0x15, current === wanted ? 1 : 0);
  const next = turnHeadingOne(current, wanted);
  if (next !== state.byteAt(object)) {
    state.byteAt(object, next);
    state.byteAt(object + 10, 0);
  }
}

function state4(state: State, actor: number, object: number): void {
  if (state.byteAt(0x3add) === 1 || !timerReady(state, object)) return;
  const aim = target(state, actor);
  let speed = s8(state.byteAt(object + 8));
  if (aim.dx < 0xb5 && aim.dy < 0xb5) {
    if (aim.d2 < 0x0af0) speed = Math.max(-0x24, speed - 2);
    else if (aim.d2 < 0x1965) { if (speed > 0) speed--; }
    else if (speed < s8(state.byteAt(object + 0x14))) speed++;
    state.byteAt(object + 8, speed);
  }
  const next = turnHeadingOne(state.byteAt(object) & 0x1f, aim.heading);
  if (next !== state.byteAt(object)) {
    state.byteAt(object, next);
    state.byteAt(object + 10, 0);
  }
}

export interface EnemyStep {
  considered: number;
  moved: number;
  activated: number;
  steered: number;
  exploding: number;
  removed: number;
  fired: number;
}

// FUN_231e_0677 @0x23bed snapshots actor +6/+7 into transient DS:0x53e2 before the pump starts.
// That address lies beyond the save image, so preserve the same per-session lifetime externally.
const waypointTables = new WeakMap<State, Uint8Array>();

function waypointTable(state: State): Uint8Array {
  let table = waypointTables.get(state);
  if (table) return table;
  table = new Uint8Array(36 * 2);
  for (let i = 0, actor = 0x0bb7; i < 36; i++, actor += ACTOR_STRIDE) {
    table[i * 2] = state.byteAt(actor + 6);
    table[i * 2 + 1] = state.byteAt(actor + 7);
  }
  waypointTables.set(state, table);
  return table;
}

/** FUN_231e_c1a7 @0x2f387: return an actor to its startup cell, then resume saved AI. */
function state10(state: State, actor: number, object: number, index: number, waypoints: Uint8Array): void {
  const timer = (state.byteAt(object + 0x12) + 1) & 0xff;
  state.byteAt(object + 0x12, timer);
  if (timer < state.byteAt(object + 0x13)) return;
  state.byteAt(object + 0x12, 0);

  // The original deliberately discards the actor's Y low byte and synthesizes the destination
  // lows from 0x7f and the object's 0x20-stride offset (BL survives `mov bh,[si]`).
  const fromX = (state.byteAt(actor + 6) << 8) | state.byteAt(actor + 8);
  const fromY = (state.byteAt(actor + 7) << 8) | 0x7f;
  const toX = (waypoints[index * 2] << 8) | ((index * ENEMY_OBJECT_STRIDE) & 0xff);
  const toY = (waypoints[index * 2 + 1] << 8) | 0x7f;
  const aim = bearing32(fromX, fromY, toX, toY);
  const d2 = (aim.dx * aim.dx + aim.dy * aim.dy) & 0xffff;
  if (aim.dx <= 0xb4 && aim.dy <= 0xb4 && d2 <= 0x4e20) {
    state.byteAt(object + 7, state.byteAt(0x458c + index * 2));
    state.byteAt(object + 8, state.byteAt(0x458d + index * 2));
    return;
  }
  state.byteAt(object + 8, 0x78);
  const next = turnHeadingOne(state.byteAt(object), aim.heading);
  if (next !== state.byteAt(object)) {
    state.byteAt(object, next);
    state.byteAt(object + 10, 0);
  }
}

/** The hostile launcher immediately following FUN_231e_8a92 at @0x2bcc2. */
function launchEnemyProjectile(state: State, actor: number, object: number): boolean {
  const cooldown = state.byteAt(object + 0x1d);
  if (cooldown !== 0) {
    state.byteAt(object + 0x1d, cooldown - 1);
    return false;
  }
  if (state.byteAt(object + 0x15) === 0) return false;
  state.byteAt(object + 0x1d, state.byteAt(object + 0x1f));

  let slot = -1;
  for (let i = 0; i < PROJECTILE_COUNT; i++) {
    if (state.byteAt(PROJECTILE_BASE + i * PROJECTILE_STRIDE) === 0) { slot = i; break; }
  }
  if (slot < 0) return false;
  const shot = PROJECTILE_BASE + slot * PROJECTILE_STRIDE;
  const aux = slot * PROJECTILE_META_STRIDE;
  for (let i = 0; i < 10; i++) state.byteAt(shot + i, state.byteAt(actor + i));
  state.byteAt(PROJECTILE_META + aux, state.byteAt(object) & 0x1f);
  state.byteAt(PROJECTILE_META + aux + 1, state.byteAt(object + 0x1e));
  state.byteAt(PROJECTILE_META + aux + 2, 0);
  state.byteAt(PROJECTILE_META + aux + 3, 0);
  state.byteAt(PROJECTILE_EXPIRED + aux, 0);
  state.wordAt(PROJECTILE_AGE + aux, 0);
  state.byteAt(0x1e00 + aux, 1);
  return true;
}

/** FUN_231e_bdc8's nearby actor dispatch, including its transient state-10 return path. */
export function updateEnemies(state: State, exe: Uint8Array): EnemyStep {
  let considered = 0, moved = 0, activated = 0, steered = 0, exploding = 0, removed = 0, fired = 0;
  const waypoints = waypointTable(state);
  for (let actor = ACTORS; actor < ACTOR_SENTINEL; actor += ACTOR_STRIDE) {
    if (state.byteAt(actor) === 0xff && state.byteAt(actor + 1) === 0xff) break;
    const type = state.byteAt(actor + 10);
    if (type < 0xc8 || type === 0xff) continue;
    const dx = Math.abs(lowDelta(state, actor, 0)), dy = Math.abs(lowDelta(state, actor, 1));
    if (dx >= 0x801 || dy >= 0x601) continue;
    const code = (state.byteAt(actor + 11) << 8) | state.byteAt(actor + 12);
    if (code < 1 || code > 36) continue;
    considered++;
    const object = ENEMY_OBJECTS + (code - 1) * ENEMY_OBJECT_STRIDE;
    const index = code - 1;
    // @0x2efd1..@0x2f051: zero/negative hull enters state 3, advances the explosion frame, then
    // removes the actor after frame 0x16. 0xfe is the one-pass bridge to 0xff used by the drawer.
    if (s8(state.byteAt(object + 0x10)) <= 0) {
      state.byteAt(object + 0x10, 0);
      state.byteAt(object + 7, 3);
      const frame = (state.byteAt(object + 0x11) + 1) & 0xff;
      state.byteAt(object + 0x11, frame);
      exploding++;
      if (frame > 0x16) {
        if (frame !== 0xff) state.byteAt(object + 0x11, 0xfe);
        else {
          state.byteAt(actor, 0);
          state.byteAt(actor + 1, 0);
          if (state.byteAt(0x3ae5) === 1) {
            const reward = exe[EXE_DS_FILE_BIAS + ENEMY_REWARD_TABLE + type - 0xc8] ?? 0;
            state.wordAt(0x3c5c, state.wordAt(0x3c5c) + reward);
          }
          removed++;
        }
      }
      continue;
    }
    const beforeHeading = state.byteAt(object);
    let behaviour = state.byteAt(object + 7);
    if (behaviour !== 10) {
      const x = state.byteAt(actor + 6), y = state.byteAt(actor + 7);
      const wx = waypoints[index * 2], wy = waypoints[index * 2 + 1];
      if (x > ((wx + 4) & 0xff) || x < ((wx - 4) & 0xff) ||
          y > ((wy + 4) & 0xff) || y < ((wy - 4) & 0xff)) {
        state.byteAt(0x458c + index * 2, behaviour);
        state.byteAt(0x458d + index * 2, state.byteAt(object + 8));
        state.byteAt(object + 7, 10);
        behaviour = 10;
      }
    }
    if ((behaviour === 5 || behaviour === 6) && state.byteAt(0x3add) !== 1 && timerReady(state, object)) {
      const aim = target(state, actor);
      if (aim.dx < 0xb5 && aim.dy < 0xb5 && aim.d2 < 0x4e21) {
        behaviour = behaviour === 5 ? 4 : 2;
        state.byteAt(object + 7, behaviour);
        activated++;
      }
    } else if (behaviour === 2) state2(state, actor, object);
    else if (behaviour === 4) state4(state, actor, object);
    else if (behaviour === 10) state10(state, actor, object, index, waypoints);
    if (state.byteAt(object) !== beforeHeading) steered++;
    if ((behaviour === 2 || behaviour === 3 || behaviour === 4 || behaviour === 10) &&
        move(state, exe, actor, object)) moved++;
    if (launchEnemyProjectile(state, actor, object)) fired++;
  }
  return { considered, moved, activated, steered, exploding, removed, fired };
}

