// Solar Winds' transient flight backdrop.
//
// This is separate from the persistent actor catalogue rendered by world.ts.  The DOS engine
// creates it in FUN_231e_8708 @0x2b8e8 after clearing the 216x186 flight viewport in
// FUN_231e_88f9 @0x2bad9, then FUN_231e_42e4 @0x274c4 moves and redraws it before the actor walk.
// Neither the positions nor their animation phase are present in BH_START.DAT: they live in the
// executable's transient DS area above the save boundary.

import { HEIGHT, WIDTH, type Framebuffer } from '../framebuffer.ts';
import { cameraPosition } from './flight.ts';
import { DS_FILE_DELTA, type State } from './state.ts';

export const BACKDROP_STAR_COUNT = 20;  // si=0..0x26 by two in @0x2b8ec/@0x2b91a
export const DRAWN_STAR_COUNT = 19;     // DS:0xb115 = 0x26; loop compares after `add si,2`
export const STAR_POINTERS = 0xaf99;    // 16 u16 shape pointers, indexed by shape id - 1
export const RANDOM_TABLE = 0xbc60;     // FUN_231e_8431: byte [DS:0xbc60 + ++DS:0x3e32]
export const RANDOM_SEED = 0x3e32;

// FUN_231e_88f9 starts at DS:[0x6bbd] = 0x0505 and clears 0x6c words for 0xba rows.
export const FLIGHT_VIEW = Object.freeze({ x: 5, y: 4, width: 216, height: 186 });

interface StarPixel { offset: number; colour: number }
interface StarShape { pixels: StarPixel[] }

export interface BackdropStar {
  x: number;
  y: number;
  /** One-based executable shape id. */
  shape: number;
  /** 0 or 8, xored on movement by @0x276d2. */
  phase: number;
}

export interface Starfield {
  readonly stars: readonly BackdropStar[];
  /** Apply the camera movement completed by the current pump pass. */
  update(): void;
  /** Draw over the clean PAGE cockpit. Returns the number of pixels accepted. */
  draw(fb: Framebuffer): number;
  /** Re-run FUN_231e_8708, as a new/load game does through FUN_231e_88f9. */
  reset(): void;
}

const word = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);
const signedWord = (v: number): number => (v << 16) >> 16;

function exeWord(exe: Uint8Array, ds: number): number {
  const at = ds + DS_FILE_DELTA;
  if (at < 0 || at + 1 >= exe.length) throw new RangeError(`EXE has no DS:0x${ds.toString(16)} word`);
  return word(exe, at);
}

/** Parse the exact sparse pixel shapes consumed at @0x276df..@0x27717. */
export function loadStarShapes(exe: Uint8Array): StarShape[] {
  const shapes: StarShape[] = [];
  for (let i = 0; i < 16; i++) {
    const ds = exeWord(exe, STAR_POINTERS + i * 2);
    let at = ds + DS_FILE_DELTA;
    const count = word(exe, at); at += 2;
    const pixels: StarPixel[] = [];
    for (let p = 0; p < count; p++, at += 4) {
      pixels.push({ offset: signedWord(word(exe, at)), colour: word(exe, at + 2) & 0xff });
    }
    shapes.push({ pixels });
  }
  return shapes;
}

export function createStarfield(state: State, exe: Uint8Array): Starfield {
  const shapes = loadStarShapes(exe);
  const stars: BackdropStar[] = [];
  let previousCamera = cameraPosition(state);
  let firstFrame = true; // DS:0x5bbb = 1 in FUN_231e_88f9, cleared at @0x2783a

  const randomByte = (): number => {
    const seed = (state.byteAt(RANDOM_SEED) + 1) & 0xff;
    state.byteAt(RANDOM_SEED, seed);
    return exe[RANDOM_TABLE + DS_FILE_DELTA + seed];
  };

  const shapeMask = (): number => state.inputGatherer === 0 ? 0x0f : state.inputGatherer === 1 ? 7 : 3;
  const randomShape = (): number => (randomByte() & shapeMask()) + 1;

  const seedPosition = (): { x: number; y: number } => {
    // @0x2b8ec..@0x2b911.  The odd-looking reductions are the original's way of keeping the
    // stars away from the cockpit frame while still using its 256-byte random permutation.
    let y = randomByte();
    if (y >= 0xaa) y -= 0x6e;
    y = (y + 10) & 0xff;
    let x = randomByte();
    if (x >= 0xc8) x -= 0x87;
    x = (x + 10) & 0xff;
    return { x, y };
  };

  const reset = (): void => {
    stars.length = 0;
    // The routine has two loops: all positions first, then all shape ids. Preserve that RNG order.
    for (let i = 0; i < BACKDROP_STAR_COUNT; i++) {
      const position = seedPosition();
      stars.push({ ...position, shape: 1, phase: 0 });
    }
    for (const star of stars) star.shape = randomShape();
    previousCamera = cameraPosition(state);
    firstFrame = true;
  };

  const rerollAtEdge = (star: BackdropStar, dx: number, dy: number): void => {
    const left = FLIGHT_VIEW.x + 2;
    const right = FLIGHT_VIEW.x + FLIGHT_VIEW.width - 3;
    const top = FLIGHT_VIEW.y + 2;
    const bottom = FLIGHT_VIEW.y + FLIGHT_VIEW.height - 3;

    // @0x277a4..@0x27835 brings an escaped star in from the opposite edge and chooses a new
    // executable shape. The source has asymmetric cockpit exclusions; these bounds are the exact
    // cleared viewport, inset by the largest common shape arm so no star writes over its frame.
    if (star.x < left) star.x = right;
    else if (star.x > right) star.x = left;
    if (star.y < top) star.y = bottom;
    else if (star.y > bottom) star.y = top;
    if (dx !== 0 || dy !== 0) star.shape = randomShape();
  };

  const update = (): void => {
    const camera = cameraPosition(state);
    const dx = camera.x - previousCamera.x;
    const dy = camera.y - previousCamera.y;
    previousCamera = camera;

    // Test harnesses and save installs may replace all five camera bytes atomically. That is not a
    // flight step and feeding a multi-sector teleport into a 16-bit screen offset would not match
    // the DOS routine; accept it as a new origin instead.
    if (Math.abs(dx) > 0x100 || Math.abs(dy) > 0x100) return;
    if (!firstFrame && dx === 0 && dy === 0) return;

    for (let i = 0; i < DRAWN_STAR_COUNT; i++) {
      const star = stars[i];
      // The backdrop moves opposite the camera. cameraPosition's least-significant byte is the
      // same screen-pixel unit consumed by the original's velocity accumulators DS:3e33/3e35.
      star.x -= dx;
      star.y -= dy;
      star.phase ^= 8;
      rerollAtEdge(star, dx, dy);
    }
    firstFrame = false;
  };

  const draw = (fb: Framebuffer): number => {
    const minX = FLIGHT_VIEW.x, maxX = minX + FLIGHT_VIEW.width;
    const minY = FLIGHT_VIEW.y, maxY = minY + FLIGHT_VIEW.height;
    let painted = 0;
    for (let i = 0; i < DRAWN_STAR_COUNT; i++) {
      const star = stars[i];
      const shape = shapes[star.shape - 1];
      const base = star.y * WIDTH + star.x;
      for (const pixel of shape.pixels) {
        const at = base + pixel.offset;
        const x = at % WIDTH, y = Math.floor(at / WIDTH);
        if (at < 0 || at >= WIDTH * HEIGHT || x < minX || x >= maxX || y < minY || y >= maxY) continue;
        const under = fb.vram[at];
        // @0x276fb..@0x2770d: stars may replace black or their own 0x90..0x9f family, never art.
        if (under === 0 || (under >= 0x90 && under <= 0x9f)) {
          fb.vram[at] = (pixel.colour + star.phase) & 0xff;
          painted += 1;
        }
      }
    }
    if (painted) fb.dirty = true;
    return painted;
  };

  reset();
  return { stars, update, draw, reset };
}
