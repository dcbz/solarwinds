// Renders the mode-1 star field (FUN_231e_1364 @0x24544) over the PAGE.DAT cockpit and writes a
// truecolor PNG, so the compositor + sprite walk can be eyeballed without a browser. The camera is
// parked on an actor by copying its ten interleaved coordinate bytes to DS:0x3ce..0x3d7, which is
// exactly what flying there does (flight.ts integrate @0x24199 walks the same bytes).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createSession } from '../src/main.ts';

const dac = (v) => ((v >> 2) << 2) & 0xff;                                     // 8->6-bit DAC @0x23xx

function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTab = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTab[n] = c >>> 0; }
    let c = 0xffffffff; for (const b of td) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8);
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(import.meta.dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const session = await createSession();
const b = session.state.sv;

// Park on actor #i and paint. Types below 0xc8 index BH_PLAN directly (@0x24720); at or above it the
// record takes the DS:0xe0f/0xba68 object path, whose art table is TODO_OBJECT_ART@0x2499d.
function shot(name, i, keys = []) {
  for (const k of keys) session.inject(k);
  const a = 0x3d8 + i * 0xd;
  for (let k = 0; k < 10; k++) b.byteAt(0x3ce + k, b.byteAt(a + k));
  session.tick();
  // framebuffer.loadPalette() already stores the (v>>2)<<2 DAC rounding in fb.lut (@0x23f2x); index 0
  // of the palette is the border colour, so black-on-black is a real pixel value, not a miss.
  const lut = session.fb.lut;
  const rgb = Buffer.alloc(320 * 200 * 3);
  for (let p = 0; p < 64000; p++) {
    const i = session.fb.vram[p] * 3;
    rgb[p * 3] = lut[i]; rgb[p * 3 + 1] = lut[i + 1]; rgb[p * 3 + 2] = lut[i + 2];
  }
  const file = path.join(out, `${name}.png`);
  fs.writeFileSync(file, png(rgb, 320, 200));
  // A 2x-downsampled copy fits the inline image budget when the full frame is being eyeballed.
  const small = Buffer.alloc(160 * 100 * 3);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 160; x++) {
    const si = ((y * 2) * 320 + x * 2) * 3, di = (y * 160 + x) * 3;
    small[di] = rgb[si]; small[di + 1] = rgb[si + 1]; small[di + 2] = rgb[si + 2];
  }
  fs.writeFileSync(path.join(out, `${name}_small.png`), png(small, 160, 100));
  const painted = session.fb.vram.reduce((n, v, k) => n + (v !== session.pageBuf[k] ? 1 : 0), 0);
  console.log(`${name}: actor #${i} type 0x${b.byteAt(a + 0xa).toString(16)} · ` +
    `${session.visibleActors.length} listed · ${painted} pixels over the page · BH_PLAN record ${session.visibleSprite}`);
}

shot('world_star0', 0);
shot('world_star40', 40);
shot('world_claw', 155);
