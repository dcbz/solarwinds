// Cockpit sector readout, FUN_231e_81e8 @0x2b3c8.
//
// The opening sequence gives the first real objective as "meet in sector -31,1". The original
// makes that playable by printing the high four bytes of each camera axis at A000:04b4/04d4 on
// every pump pass. The low byte is the within-sector pixel coordinate and is deliberately omitted.

import type { Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';
import { drawText, type TextFont } from './text.ts';

export const COORD_X_DEST = 0x04b4; // @0x2b4c7: row 3, column 212
export const COORD_Y_DEST = 0x04d4; // @0x2b5c9: row 3, column 244
export const COORD_ORIGIN = 0x7f7f7f7f;

function highAxis(state: State, yAxis: boolean): number {
  let value = 0;
  const axis = yAxis ? 1 : 0;
  for (const ds of [0x3ce, 0x3d0, 0x3d2, 0x3d4]) value = value * 256 + state.byteAt(ds + axis);
  // The 8086 routine subtracts 0x7f a byte at a time with borrow, then tests the signed high word.
  return (value - COORD_ORIGIN) | 0;
}

/** The same signed pair shown in the cockpit. Solar Winds displays the Y axis with reversed sign. */
export function sectorCoordinates(state: State): { x: number; y: number } {
  return { x: highAxis(state, false), y: -highAxis(state, true) };
}

export function drawSectorCoordinates(fb: Framebuffer, font: TextFont, state: State): { x: number; y: number } {
  const coordinates = sectorCoordinates(state);
  drawText(fb, font, COORD_X_DEST, String(coordinates.x));
  drawText(fb, font, COORD_Y_DEST, String(coordinates.y));
  return coordinates;
}
