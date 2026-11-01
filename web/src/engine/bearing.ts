// Solar Winds' integer 32-way bearing quantizer.
//
// FUN_231e_30c9 @0x262a9 takes DI as the moving record and SI as its destination.
// It only reads the low 16 bits of each interleaved 40-bit axis, scales both deltas below 0x80,
// divides (dy << 8) by dx, and compares that quotient with eight hard-coded thresholds.  Keeping
// this routine integer-only matters at every sector boundary: enemy steering and weapon-4 homing
// both consume its exact five-bit result.

import type { State } from './state.ts';

const THRESHOLDS = [0x1c, 0x52, 0x8c, 0xd5, 0x133, 0x1c2, 0x2dd, 0x749] as const;

export interface Bearing32 {
  heading: number;
  dx: number;
  dy: number;
}

/** Exact @0x262c2..@0x263cf quantizer for two unsigned low-word coordinates. */
export function bearing32(fromX: number, fromY: number, toX: number, toY: number): Bearing32 {
  fromX &= 0xffff;
  fromY &= 0xffff;
  toX &= 0xffff;
  toY &= 0xffff;

  let dx: number, dy: number, base: number;
  if (fromX <= toX) {
    dx = toX - fromX;
    if (fromY <= toY) { dy = toY - fromY; base = 0x18; }
    else { dy = fromY - toY; base = 0; }
  } else {
    dx = fromX - toX;
    if (fromY <= toY) { dy = toY - fromY; base = 0x10; }
    else { dy = fromY - toY; base = 8; }
  }

  const originalDx = dx, originalDy = dy;
  while (dx >= 0x80) { dx >>>= 1; dy >>>= 1; }
  while (dy >= 0x80) { dx >>>= 1; dy >>>= 1; }
  if (dy === 0) dy = 1;
  if (dx === 0) dx = 1;
  const ratio = Math.floor((dy << 8) / dx);

  let octant = 0;
  if (base === 0x18 || base === 8) {
    for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
      if (ratio >= THRESHOLDS[i]) break;
      octant++;
    }
  } else {
    for (const threshold of THRESHOLDS) {
      if (ratio <= threshold) break;
      octant++;
    }
  }
  const heading = (base + octant) === 0x20 ? 0 : base + octant;
  return { heading, dx: originalDx, dy: originalDy };
}

/** Read the low coordinate words exactly as @0x262aa..@0x262bf does. */
export function bearingRecords(state: State, from: number, to: number): Bearing32 {
  const fromX = (state.byteAt(from + 6) << 8) | state.byteAt(from + 8);
  const fromY = (state.byteAt(from + 7) << 8) | state.byteAt(from + 9);
  const toX = (state.byteAt(to + 6) << 8) | state.byteAt(to + 8);
  const toY = (state.byteAt(to + 7) << 8) | state.byteAt(to + 9);
  return bearing32(fromX, fromY, toX, toY);
}

/** The branch-exact one-step turn shared by @0x2818e, @0x2f32f and @0x2f525. */
export function turnHeadingOne(current: number, wanted: number): number {
  current &= 0x1f;
  wanted &= 0x1f;
  if (current === wanted) return current;
  if (current > wanted) return (current + (current - wanted < 0x10 ? -1 : 1) + 0x20) & 0x1f;
  return (current + (wanted - current < 0x10 ? 1 : -1) + 0x20) & 0x1f;
}
