// Solar Winds player projectiles, transcribed from the live pump and projectile scheduler.
//
// FUN_231e_91ed @0x2c3cd launches into ten 13-byte actor records at DS:0xd8b.  The records use
// the same interleaved 40-bit X/Y position as world actors and retain type 0xff plus a 1-based slot
// id at +0xc.  Per-slot state is split into eight-byte-stride arrays rooted at DS:0x1d9b:
// heading +0, weapon +1, trajectory index +3, age DS:0x1dfe, and expiry DS:0x1dfd.
// FUN_231e_4dc7 @0x27fa7 advances each record from the executable's DS:0x6393 pointer table.

import type { State } from './state.ts';
import { bearingRecords, turnHeadingOne } from './bearing.ts';

const EXE_DS_FILE_BIAS = 0xf90;
export const PROJECTILE_BASE = 0x0d8b;
export const PROJECTILE_STRIDE = 0x0d;
export const PROJECTILE_COUNT = 10;
export const PROJECTILE_META = 0x1d9b;
export const PROJECTILE_META_STRIDE = 8;
export const PROJECTILE_AGE = 0x1dfe;
export const PROJECTILE_EXPIRED = 0x1dfd;
export const PROJECTILE_SHADE = 0x1da2;
export const PROJECTILE_HOMING_TICK = 0x1dfb;
export const WEAPON_SELECTED = 0x3c4c;
export const WEAPON_COOLDOWN = 0x3c54;
export const WEAPON_AMMO = 0x359b;
export const CAMERA_BASE = 0x3ce;
export const HEADING = 0x3c92;
export const SPEED = 0x3c98;
export const SPAWN_X_TABLE = 0x6125;
export const SPAWN_Y_TABLE = 0x6145;
export const TRAJECTORY_POINTERS = 0x6393;
export const HOSTILE_ACTOR_BASE = 0x0bb7;
export const HOSTILE_ACTOR_END = 0x0d8b;
export const HOSTILE_OBJECT_BASE = 0x0e0f;
export const HOSTILE_OBJECT_STRIDE = 0x20;

const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;
const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;
const word = (state: State, at: number): number => state.byteAt(at) | (state.byteAt(at + 1) << 8);
const setWord = (state: State, at: number, value: number): void => {
  state.byteAt(at, value & 0xff);
  state.byteAt(at + 1, (value >> 8) & 0xff);
};
const exeWord = (exe: Uint8Array, ds: number): number => {
  const at = ds + EXE_DS_FILE_BIAS;
  return exe[at] | (exe[at + 1] << 8);
};

/** Add one signed byte to an interleaved 40-bit axis, carrying from +8 toward +0. */
function addAxis(state: State, record: number, axis: 0 | 1, amount: number): void {
  let carry = amount;
  for (let off = 8 + axis; off >= axis; off -= 2) {
    const next = state.byteAt(record + off) + carry;
    state.byteAt(record + off, next & 0xff);
    carry = next < 0 ? -1 : next > 0xff ? 1 : 0;
    if (carry === 0) break;
  }
}

/** @0x2408f..@0x24096: the fire delay loses one on every pump pass. */
export function tickWeaponCooldown(state: State): number {
  const before = state.byteAt(WEAPON_COOLDOWN);
  if (before !== 0) state.byteAt(WEAPON_COOLDOWN, before - 1);
  return state.byteAt(WEAPON_COOLDOWN);
}

export interface LaunchResult {
  fired: boolean;
  reason?: 'latch' | 'cooldown' | 'unarmed' | 'speed' | 'slots';
  slot?: number;
  weapon?: number;
  heading?: number;
  ammo?: number;
}

/** FUN_231e_91ed @0x2c3cd: consume the Ctrl latch and launch the selected weapon. */
export function launchPlayerProjectile(state: State, exe: Uint8Array, ctrlLatch: boolean): LaunchResult {
  if (!ctrlLatch) return { fired: false, reason: 'latch' };
  if (state.byteAt(WEAPON_COOLDOWN) !== 0) return { fired: false, reason: 'cooldown' };
  const weapon = state.byteAt(WEAPON_SELECTED);
  if (weapon === 0) return { fired: false, reason: 'unarmed' };
  if (Math.abs(s16(word(state, SPEED))) > 0x26) return { fired: false, reason: 'speed' };

  let slot = -1;
  for (let i = 0; i < PROJECTILE_COUNT; i++) {
    if (state.byteAt(PROJECTILE_BASE + i * PROJECTILE_STRIDE) === 0) { slot = i; break; }
  }
  if (slot < 0) return { fired: false, reason: 'slots' };

  const actor = PROJECTILE_BASE + slot * PROJECTILE_STRIDE;
  const meta = PROJECTILE_META + slot * PROJECTILE_META_STRIDE;
  const heading = state.byteAt(HEADING) & 0x1f;
  for (let i = 0; i < 10; i++) state.byteAt(actor + i, state.byteAt(CAMERA_BASE + i));
  addAxis(state, actor, 0, s8(exe[EXE_DS_FILE_BIAS + SPAWN_X_TABLE + heading]));
  addAxis(state, actor, 1, s8(exe[EXE_DS_FILE_BIAS + SPAWN_Y_TABLE + heading]));

  state.byteAt(meta, heading);
  state.byteAt(meta + 1, weapon);
  state.byteAt(meta + 2, 0);
  state.byteAt(meta + 3, 0);
  state.byteAt(PROJECTILE_EXPIRED + slot * PROJECTILE_META_STRIDE, 0);
  setWord(state, PROJECTILE_AGE + slot * PROJECTILE_META_STRIDE, 0);
  state.byteAt(0x1e00 + slot * PROJECTILE_META_STRIDE, 0);
  state.byteAt(WEAPON_COOLDOWN, 0x32);

  const ammoAt = WEAPON_AMMO + (weapon - 1) * 2;
  const ammo = (word(state, ammoAt) - 1) & 0xffff;
  setWord(state, ammoAt, ammo);
  if (ammo === 0) {
    let next = 0;
    for (let i = 0; i < 10; i++) {
      if (word(state, WEAPON_AMMO + i * 2) !== 0) { next = i + 1; break; }
    }
    state.byteAt(WEAPON_SELECTED, next);
  }
  return { fired: true, slot, weapon, heading, ammo };
}

export interface ProjectileHit { slot: number; actor: number; objectCode: number; hullDamage: number }
export interface PlayerHit { slot: number; shield: number; shieldDamage: number; hullDamage: number }
export interface ProjectileStep {
  active: number;
  moved: number;
  expired: number;
  hits: ProjectileHit[];
  playerHits: PlayerHit[];
}

/** @0x280a8..@0x281dc: every sixth pass, weapon 4 turns one step toward its nearest hostile. */
function homeWeapon4(state: State, slot: number): boolean {
  const aux = slot * PROJECTILE_META_STRIDE;
  const tickAt = PROJECTILE_HOMING_TICK + aux;
  const tick = (state.byteAt(tickAt) + 1) & 0xff;
  state.byteAt(tickAt, tick);
  if (tick <= 5) return false;
  state.byteAt(tickAt, 0);

  const projectile = PROJECTILE_BASE + slot * PROJECTILE_STRIDE;
  let nearest = 0;
  let nearestD2 = 0xffff;
  for (let hostile = HOSTILE_ACTOR_BASE; hostile < HOSTILE_ACTOR_END; hostile += PROJECTILE_STRIDE) {
    let sameSector = true;
    for (let i = 0; i < 6; i += 2) {
      if (word(state, hostile + i) !== word(state, projectile + i)) { sameSector = false; break; }
    }
    if (!sameSector) continue;
    const hostileX = (state.byteAt(hostile + 6) << 8) | state.byteAt(hostile + 8);
    const shotX = (state.byteAt(projectile + 6) << 8) | state.byteAt(projectile + 8);
    const hostileY = (state.byteAt(hostile + 7) << 8) | state.byteAt(hostile + 9);
    const shotY = (state.byteAt(projectile + 7) << 8) | state.byteAt(projectile + 9);
    const dx = Math.abs(hostileX - shotX);
    const dy = Math.abs(hostileY - shotY);
    if (dx > 0x320 || dy > 0x320) continue;
    const sx = dx >>> 3, sy = dy >>> 3;
    // Preserve the shipped instruction at @0x2813c: one Y ordering adds CX (sy), not AX (sy²).
    const d2 = (sx * sx + (hostileY >= shotY ? sy : sy * sy)) & 0xffff;
    if (d2 <= nearestD2) { nearestD2 = d2; nearest = hostile; }
  }
  if (nearest === 0) return false;
  const meta = PROJECTILE_META + aux;
  const wanted = bearingRecords(state, projectile, nearest).heading;
  const next = turnHeadingOne(state.byteAt(meta), wanted);
  if (next === state.byteAt(meta)) return false;
  state.byteAt(meta, next);
  state.byteAt(meta + 3, 0);
  return true;
}

/**
 * FUN_231e_420f @0x273ef: collide a projectile with the 36 hostile actor records.
 *
 * The shipped routine requires the upper three interleaved words to match exactly and accepts a
 * low-coordinate delta strictly inside -13..13 on both axes. A hit removes two points from each
 * of the four shield facings at object +0xb..+0xe; depleted facings pass two points through to the
 * hull at +0x10. The assembly only multiplies the object code by two at @0x27489, although every
 * renderer/AI/damage consumer addresses these same records with a 0x20 stride. We use that proven
 * record stride here, avoiding the original instruction's overlapping-record alias for codes 2+.
 */
export function collidePlayerProjectile(state: State, slot: number): ProjectileHit | undefined {
  const actor = PROJECTILE_BASE + slot * PROJECTILE_STRIDE;
  const aux = slot * PROJECTILE_META_STRIDE;
  if (state.byteAt(0x1e00 + aux) === 1 || state.byteAt(actor + 11) !== 0) return undefined;

  for (let hostile = HOSTILE_ACTOR_BASE; hostile < HOSTILE_ACTOR_END; hostile += PROJECTILE_STRIDE) {
    if (state.byteAt(hostile) === 0 && state.byteAt(hostile + 1) === 0) continue;
    let sameSector = true;
    for (let i = 0; i < 6; i += 2) {
      if (word(state, hostile + i) !== word(state, actor + i)) { sameSector = false; break; }
    }
    if (!sameSector) continue;
    const hostileX = (state.byteAt(hostile + 6) << 8) | state.byteAt(hostile + 8);
    const shotX = (state.byteAt(actor + 6) << 8) | state.byteAt(actor + 8);
    const hostileY = (state.byteAt(hostile + 7) << 8) | state.byteAt(hostile + 9);
    const shotY = (state.byteAt(actor + 7) << 8) | state.byteAt(actor + 9);
    const dx = s16(hostileX - shotX), dy = s16(hostileY - shotY);
    if (dx <= -13 || dx >= 13 || dy <= -13 || dy >= 13) continue;

    const objectCode = (state.byteAt(hostile + 11) << 8) | state.byteAt(hostile + 12);
    if (objectCode < 1 || objectCode > 36) continue;
    const object = HOSTILE_OBJECT_BASE + (objectCode - 1) * HOSTILE_OBJECT_STRIDE;
    let hullDamage = 0;
    for (let side = 0x0b; side < 0x0f; side++) {
      const shield = state.byteAt(object + side);
      if (shield < 2) {
        state.byteAt(object + side, 0);
        hullDamage += 2;
      } else state.byteAt(object + side, shield - 2);
    }
    state.byteAt(object + 0x10, state.byteAt(object + 0x10) - hullDamage);
    state.byteAt(PROJECTILE_EXPIRED + aux, 1);
    setWord(state, PROJECTILE_AGE + aux, 0xf0f0);
    return { slot, actor: hostile, objectCode, hullDamage };
  }
  return undefined;
}

/** FUN_231e_62b1 @0x29491: hostile projectile damage against the player craft. */
export function collideEnemyProjectile(state: State, slot: number): PlayerHit | undefined {
  const actor = PROJECTILE_BASE + slot * PROJECTILE_STRIDE;
  const aux = slot * PROJECTILE_META_STRIDE;
  if (state.byteAt(0x1e00 + aux) !== 1) return undefined;
  for (let i = 0; i < 6; i += 2) {
    if (word(state, actor + i) !== word(state, CAMERA_BASE + i)) return undefined;
  }
  const shotX = (state.byteAt(actor + 6) << 8) | state.byteAt(actor + 8);
  const cameraX = (state.byteAt(CAMERA_BASE + 6) << 8) | state.byteAt(CAMERA_BASE + 8);
  const shotY = (state.byteAt(actor + 7) << 8) | state.byteAt(actor + 9);
  const cameraY = (state.byteAt(CAMERA_BASE + 7) << 8) | state.byteAt(CAMERA_BASE + 9);
  if (Math.abs(s16(shotX - cameraX)) >= 13 || Math.abs(s16(shotY - cameraY)) >= 13) return undefined;

  // @0x29604 selects one of the four shield-system words 3c64/66/68/6a/6c from the exact
  // collision pixel's angle. The canvas renderer has no DOS collision colour map, so select the
  // same four persisted shield pools from the projectile's relative 32-way bearing.
  const incoming = state.byteAt(PROJECTILE_META + aux) & 0x1f;
  const relativeQuarter = (((incoming - (state.byteAt(HEADING) & 0x1f) + 4) & 0x1f) >> 3) & 3;
  const shieldIndices = [5, 7, 4, 6] as const;
  const shield = shieldIndices[relativeQuarter];
  const shieldAt = 0x3c5e + shield * 2;
  const strength = word(state, shieldAt);
  const shieldDamage = Math.min(8, strength);
  const hullDamage = 8 - shieldDamage;
  setWord(state, shieldAt, strength - shieldDamage);
  if (hullDamage) state.byteAt(0x3c46, state.byteAt(0x3c46) - hullDamage);
  state.byteAt(PROJECTILE_EXPIRED + aux, 1);
  setWord(state, PROJECTILE_AGE + aux, 0xf0f0);
  return { slot, shield, shieldDamage, hullDamage };
}

/** FUN_231e_4dc7 @0x27fa7, through the trajectory update shared by all weapon types. */
export function updateProjectiles(state: State, exe: Uint8Array): ProjectileStep {
  let active = 0, moved = 0, expired = 0;
  const hits: ProjectileHit[] = [];
  const playerHits: PlayerHit[] = [];
  for (let slot = 0; slot < PROJECTILE_COUNT; slot++) {
    const actor = PROJECTILE_BASE + slot * PROJECTILE_STRIDE;
    if (state.byteAt(actor) === 0) continue;
    active++;
    const aux = slot * PROJECTILE_META_STRIDE;
    const ageAt = PROJECTILE_AGE + aux;
    const age = word(state, ageAt);
    if (age > 0x2ff) {
      const flagAt = PROJECTILE_EXPIRED + aux;
      if (state.byteAt(flagAt) !== 1) state.byteAt(flagAt, 1);
      else { state.byteAt(actor, 0); expired++; active--; }
      continue;
    }
    setWord(state, ageAt, age + 1);

    const meta = PROJECTILE_META + aux;
    const heading = state.byteAt(meta) & 0x1f;
    const list = exeWord(exe, TRAJECTORY_POINTERS + heading * 2);
    let frame = state.byteAt(meta + 3);
    let pair = exeWord(exe, list + frame * 2);
    if (pair === 0x8888) { frame = 0; pair = exeWord(exe, list); }
    state.byteAt(meta + 3, (frame + 1) & 0xff);
    addAxis(state, actor, 0, s8(pair));
    addAxis(state, actor, 1, s8(pair >> 8));
    moved++;
    if (state.byteAt(0x1e00 + aux) === 1) {
      const hit = collideEnemyProjectile(state, slot);
      if (hit) playerHits.push(hit);
    } else {
      const hit = collidePlayerProjectile(state, slot);
      if (hit) hits.push(hit);
    }
    if (state.byteAt(meta + 1) === 4) homeWeapon4(state, slot);
  }
  return { active, moved, expired, hits, playerHits };
}

