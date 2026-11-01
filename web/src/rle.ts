// Solar Winds RLE — both variants, byte-exact from SOLAR1.EXE.
//
// The streams are sequences of either a literal pixel index, or the token
// FF <n> <value>. Two exit tests, one byte apart in the original code:
//
//   "stone"  (cmp ch,0xff @0x25119, @0x2a83a)  emits n copies,   FF 00 v = 0 copies
//   "wind"   (cmp ch,0x00  @0x2a03e, @0x2a161) emits n-1 copies, FF 00 v = 255 copies (8-bit wrap)
//
// Real files decoded with the matching rule come out at exactly 64001 bytes:
// 64000 (320*200) plus the engine's own one-byte over-read, which its 64000-byte
// `rep movsw` discards. We drop that byte here.
// Reference: re/FINDINGS.md "PICTURE FORMAT SETTLED", re/formats-maps.md F4.

export const FRAME_BYTES = 320 * 200;
export const FRAME_STREAM_BYTES = FRAME_BYTES + 1;

export type Variant = 'stone' | 'wind';

export function decodeRLE(src: Uint8Array, variant: Variant = 'stone', maxBytes = Infinity): Uint8Array {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const b = src[i++];
    if (b === 0xff && i + 2 <= n) {
      const count = src[i++];
      const value = src[i++];
      const run = variant === 'wind' ? (count - 1) & 0xff : count;
      for (let k = 0; k < run; k++) out.push(value);
    } else {
      out.push(b);
    }
    if (out.length > maxBytes + 65536) break; // runaway guard
  }
  return Uint8Array.from(out);
}

// Whole-file single stream: zones 1-2 art and the dispatcher's screens.
export interface FrameDecode { pixels: Uint8Array; decoded: number; extra: number; }

export function decodeFrame(src: Uint8Array, variant: Variant = 'stone'): FrameDecode {
  const all = decodeRLE(src, variant);
  return { pixels: all.subarray(0, FRAME_BYTES), decoded: all.length, extra: all.length - FRAME_BYTES };
}

// Seek-walked multi-record container: zone 3 art, MW2P, and the 0x24ff4 path.
// Records are <u16 length> followed by that many compressed bytes; the original
// walks them with INT 21h/42h al=2. Returns the list plus one composited frame.
export interface Record_ { offset: number; len: number; pixels: Uint8Array; }

export function decodeRecords(src: Uint8Array, variant: Variant = 'stone'): Record_[] {
  const records: Record_[] = [];
  let off = 0;
  while (off + 2 <= src.length && records.length < 64) {
    const len = src[off] | (src[off + 1] << 8);
    off += 2;
    if (len === 0 || off + len > src.length) break;
    const pixels = decodeRLE(src.subarray(off, off + len), variant).subarray(0, FRAME_BYTES);
    records.push({ offset: off, len, pixels });
    off += len;
  }
  return records;
}
