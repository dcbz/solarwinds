// The mode-13h framebuffer. In the original this is real-mode A000:0000, written
// by `rep movsw` with cx=0xfa00 from a RAM scratch page (segment global [0x6b9f]).
// Here it is a flat Uint8Array of the same 64000 bytes, indexed identically:
// offset = y*320 + x. Keeping that mapping 1:1 makes the eventual port of the
// engine's drawing primitives a direct transcription.
// Reference: re/formats-maps.md F1/F3, re/README-dosbox.md (mode 13h at 70.086 Hz).

import { FRAME_BYTES } from './rle.ts';

export const WIDTH = 320;
export const HEIGHT = 200;

export class Framebuffer {
  /** A000:0000 — the flat 64000-byte indexed framebuffer. */
  vram: Uint8Array;
  /** 768-byte 8->6-bit DAC rounding table, from a palette file. */
  lut: Uint8Array;
  dirty: boolean;
  constructor() {
    this.vram = new Uint8Array(FRAME_BYTES);
    this.lut = new Uint8Array(768); // 256 * RGB
    this.dirty = true;
  }

  loadPalette(rgb: Uint8Array): void {
    // Palette files are 768 bytes of 8-bit RGB. The game halves each component twice
    // (`shr 1` x2 over di=0..0x2ff) to feed the 6-bit DAC, so the colour that reaches the
    // screen is (v >> 2) << 2. Verified against real VRAM: with this expansion, every pixel
    // of re/dosbox/captures/image0001-raw.png (DOSBox rawshot, 320x200) lands within 4/255
    // of the port's render; the bit-replicating variant (v6 << 2) | (v6 >> 4) is measurably
    // worse, so the emulator's raw dump is zero-filling like the BIOS register path is here.
    for (let i = 0; i < 768; i++) this.lut[i] = (rgb[i] >> 2) << 2;
    this.dirty = true;
  }

  clear(index = 0) {
    this.vram.fill(index);
    this.dirty = true;
  }

  blt(src: Uint8Array, dstOffset = 0): void {
    this.vram.set(src.subarray(0, Math.min(src.length, FRAME_BYTES - dstOffset)), dstOffset);
    this.dirty = true;
  }

  // Zone 3 / MW2P composite: partial planes drawn over a base, matching the
  // observed behaviour where a stream covers only the top rows of the frame.
  composite(src: Uint8Array, dstOffset = 0): void {
    const n = Math.min(src.length, FRAME_BYTES - dstOffset);
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (v !== 0) this.vram[dstOffset + i] = v; // index 0 = transparent background
    }
    this.dirty = true;
  }

  present(ctx: CanvasRenderingContext2D, canvas?: unknown): void {
    if (!this.dirty) return;
    const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const d = img.data;
    const v = this.vram, lut = this.lut;
    for (let p = 0, o = 0; p < FRAME_BYTES; p++, o += 4) {
      const c = v[p] * 3;
      d[o] = lut[c]; d[o + 1] = lut[c + 1]; d[o + 2] = lut[c + 2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.dirty = false;
  }
}
