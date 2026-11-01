// Player destruction, FUN_231e_7bcc @0x2adac.
//
// The pump calls this once per pass whenever hull DS:0x3c46 is signed <= 0. BH_EXPL contains six
// raw <width,height,pixels> frames; the routine advances one frame every four passes, removes the
// ship after pass 22, and raises DS:0x457b through 1 to 2 on pass 36.

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';

export const PLAYER_HULL = 0x3c46;
export const DEATH_PHASE = 0x457b;
export const DEATH_COUNTER = 0x457c;
export const DEATH_CENTER = 0x7d71;

const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;

export interface DeathView {
  active: true;
  counter: number;
  frame: number | null;
  phase: number;
  done: boolean;
}

/** @0x23fd4 -> @0x2adac; undefined is the original signed `jg 0x23fe6` path. */
export function stepPlayerDeath(state: State): DeathView | undefined {
  if (s8(state.byteAt(PLAYER_HULL)) > 0) return undefined;
  const counter = (state.wordAt(DEATH_COUNTER) + 1) & 0xffff;
  state.wordAt(DEATH_COUNTER, counter);
  if (counter === 1) state.byteAt(0x3c4a, 1);

  let phase = state.byteAt(DEATH_PHASE);
  if (counter > 0x16) {
    if (phase === 0) {
      phase = 1;
      state.byteAt(DEATH_PHASE, phase);
    } else if (counter === 0x24) {
      phase = 2;
      state.byteAt(DEATH_PHASE, phase);
    }
  }
  return {
    active: true,
    counter,
    frame: counter <= 0x16 ? counter >>> 2 : null,
    phase,
    done: phase === 2,
  };
}

export interface ExplosionFrame { width: number; height: number; pixels: Uint8Array }

/** Transparent centered blit performed by @0x2ae2e..@0x2ae99. */
export function drawPlayerExplosion(fb: Framebuffer, frame: ExplosionFrame): number {
  const left = (DEATH_CENTER % WIDTH) - (frame.width >>> 1);
  const top = Math.floor(DEATH_CENTER / WIDTH) - (frame.height >>> 1);
  let painted = 0;
  for (let y = 0; y < frame.height; y++) {
    const row = (top + y) * WIDTH + left;
    for (let x = 0; x < frame.width; x++) {
      const pixel = frame.pixels[y * frame.width + x];
      const at = row + x;
      if (pixel !== 0 && at >= 0 && at < fb.vram.length) {
        fb.vram[at] = pixel;
        painted++;
      }
    }
  }
  if (painted) fb.dirty = true;
  return painted;
}
