// Fidelity diff: real DOSBox raw VRAM capture vs the port's render of the same screen.
// Reports per-pixel agreement, mean channel error, and where the mismatch concentrates, so a
// "looks right" claim can be defended with a number instead of an opinion.
//
// Usage: node web/tools/faithful_diff.mjs real.png ours.png
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

function decode(path) {
  const buf = readFileSync(path);
  let at = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0, plte = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const bpp = colorType === 3 ? 1 : colorType === 6 ? 4 : colorType === 4 ? 2 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp, out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * bpp, o = (y * width + x) * 4;
    if (colorType === 3) { const j = out[i] * 3; rgba[o] = plte[j]; rgba[o + 1] = plte[j + 1]; rgba[o + 2] = plte[j + 2]; }
    else if (bpp >= 3) { rgba[o] = out[i]; rgba[o + 1] = out[i + 1]; rgba[o + 2] = out[i + 2]; }
    else { rgba[o] = rgba[o + 1] = rgba[o + 2] = out[i]; }
    rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let c = 0xffffffff; for (const b of body) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function encode(path, w, h, rgba) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const [realPath, oursPath, diffPath] = process.argv.slice(2);
if (!realPath || !oursPath) throw new Error('usage: faithful_diff.mjs real.png ours.png [diff.png]');
const real = decode(realPath), ours = decode(oursPath);
if (real.width !== ours.width || real.height !== ours.height) {
  throw new Error(`size mismatch: ${real.width}x${real.height} vs ${ours.width}x${ours.height}`);
}
const W = real.width, H = real.height;
let exact = 0, near = 0, sum = 0, worst = [];
const dmap = Buffer.alloc(W * H * 4);
const cell = 20, cells = new Map();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 4;
  const dr = Math.abs(real.rgba[o] - ours.rgba[o]);
  const dg = Math.abs(real.rgba[o + 1] - ours.rgba[o + 1]);
  const db = Math.abs(real.rgba[o + 2] - ours.rgba[o + 2]);
  const d = Math.max(dr, dg, db);
  sum += d;
  if (d === 0) exact++;
  if (d <= 4) near++;
  const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  cells.set(key, (cells.get(key) || 0) + d);
  if (diffPath) { const v = Math.min(255, d * 8); dmap[o] = v; dmap[o + 1] = v; dmap[o + 2] = v; dmap[o + 3] = 255; }
}
const total = W * H;
if (diffPath) encode(diffPath, W, H, dmap);
const topCells = [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  .map(([k, v]) => `${k}*20px=${Math.round(v / (cell * cell * 3))}`).join(' ');
console.log(`${realPath.split('/').pop()} vs ${oursPath.split('/').pop()}`);
console.log(`  exact ${total - exact} mismatched px of ${total}  (${(100 * exact / total).toFixed(2)}% identical)`);
console.log(`  within 4/255: ${(100 * near / total).toFixed(2)}%   mean channel error: ${(sum / (total * 3)).toFixed(2)}`);
console.log(`  worst 20px cells: ${topCells}`);
