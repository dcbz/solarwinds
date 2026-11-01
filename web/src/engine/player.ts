// FUN_231e_0458 @0x23638 — the player's own ship sprite.
//
// BH_MS is a 32-record set, indexed by heading DS:0x3c92. The executable table
// at DS:0x33b2 stores the top-left displacement from DS:[0x6bbb] (0x7d71, the
// centre of the flight viewport). This art is independent of BH_PLAN's world
// actors; omitting it is why an otherwise correct empty starting sector looked
// like there was no player ship.

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';

const EXE_DS_FILE_BIAS = 0xf90;
export const SHIP_OFFSET_TABLE_DS = 0x33b2;
export const SHIP_HEADING_DS = 0x3c92;
export const SHIP_VIEW_CENTRE = 0x7d71;

export interface PlayerSprite { width: number; height: number; pixels: Uint8Array }

function wordAt(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

export function playerShipDestination(exe: Uint8Array, heading: number): number {
  const table = SHIP_OFFSET_TABLE_DS + EXE_DS_FILE_BIAS;
  return SHIP_VIEW_CENTRE - wordAt(exe, table + (heading & 0x1f) * 2);
}

export function drawPlayerShip(
  fb: Framebuffer, state: State, sprites: PlayerSprite[], exe: Uint8Array,
): { heading: number; dest: number; painted: number } | null {
  const heading = state.byteAt(SHIP_HEADING_DS) & 0x1f;
  const sprite = sprites[heading];
  if (!sprite) return null;
  const dest = playerShipDestination(exe, heading);
  let painted = 0;
  for (let y = 0; y < sprite.height; y++) {
    const row = dest + y * WIDTH;
    for (let x = 0; x < sprite.width; x++) {
      const pixel = sprite.pixels[y * sprite.width + x];
      const at = row + x;
      if (pixel !== 0 && at >= 0 && at < fb.vram.length) {
        fb.vram[at] = pixel;
        painted++;
      }
    }
  }
  if (painted) fb.dirty = true;
  return { heading, dest, painted };
}

