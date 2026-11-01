// Renders the @0x2b04d compositor's output for pages 2/3/4 into real 320x200 frames with the port's
// own modules, so the "the arena is BH_PAN.DAT" hypothesis can be checked by eye as well as by the
// arithmetic in web/src/engine/pages.ts.
// Usage: node web/tools/panshot.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { createSession } from '../src/main.ts';
import { decodeFrame } from '../src/rle.ts';

const W = 320, H = 200;
const crc = (b) => zlib.crc32(b) >>> 0;   // node >= 22; the bit-by-bit version in render_check.mjs predates it
const png = (idx, lut) => {
  const raw = Buffer.alloc(H * (W + 1));
  for (let y = 0; y < H; y++) raw.set(idx.subarray(y * W, y * W + W), y * (W + 1) + 1);
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('PLTE', lut), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
};

await fs.promises.mkdir('web/tools/out', { recursive: true });
const read = async (n) => new Uint8Array(await fs.promises.readFile('web/data/' + n));
const pal = await read('BH_PAL.DAT');
const lut = Uint8Array.from({ length: 768 }, (_, i) => (pal[i] >> 2) << 2);

for (const [label, code] of [['page2_mode2', 0x12], ['page3_mode3', 0x1e], ['page4_mode4', 0x11]]) {
  const s = await createSession();
  s.inject(code);
  const idx = s.fb.vram;
  await fs.promises.writeFile(`web/tools/out/${label}.png`, png(idx, lut));
  console.log(`${label.padEnd(12)} sha ${createHash('sha1').update(Buffer.from(idx)).digest('hex').slice(0, 12)} ` +
    `drew: ${s.page?.drew.join(' + ')}`);
}
