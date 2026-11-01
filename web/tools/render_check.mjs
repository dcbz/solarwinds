// Proves web/src/rle.js + the palette path produce correct frames, headlessly.
// Usage: node web/tools/render_check.mjs [BH_xxx.DAT ...]
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { decodeFrame } from '../src/rle.ts';

const W = 320, H = 200;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(idx, lut) {
  const raw = Buffer.alloc(H * (W + 1));
  const b = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
  for (let y = 0; y < H; y++) b.copy(raw, y * (W + 1) + 1, y * W, y * W + W);
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('PLTE', lut),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PAL = { MW1: 'BH_MP1.DAT', MW2: 'BH_MP2.DAT', MW3: 'BH_MP3.DAT' };
const args = process.argv.slice(2);
await fs.mkdir('web/tools/out', { recursive: true });

for (const f of args.length ? args : ['BH_MW1A.DAT']) {
  const src = new Uint8Array(await fs.readFile('web/data/' + f));
  const key = f.slice(3, 6).toUpperCase();
  const pal = new Uint8Array(await fs.readFile('web/data/' + (PAL[key] || 'BH_PAL.DAT')));
  const lut = Uint8Array.from({ length: 768 }, (_, i) => (pal[i] >> 2) << 2);
  const variant = key.startsWith('MW3') ? 'stone' : 'wind';
  const { pixels, decoded } = decodeFrame(src, variant);
  const frame = new Uint8Array(64000);
  frame.set(pixels.subarray(0, 64000));
  const out = `web/tools/out/${f.slice(3, 7)}_js.png`;
  await fs.writeFile(out, png(frame, lut));
  console.log(`${f.padEnd(14)} variant ${variant.padEnd(6)} decoded ${String(decoded).padStart(6)} -> ${out}`);
}
