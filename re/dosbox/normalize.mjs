// Normalize a host screenshot of the DOSBox window into the 320x200 indexed-equivalent the port
// renders, so the two can be compared numerically. Crops the letterbox by finding the widest and
// tallest contiguous run of "busy" rows/columns (the DOS image has colour variance, the border is
// solid), then box-downscales to the VGA resolution.
//
// Usage: node re/dosbox/normalize.mjs in.png out.png
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
  if (depth !== 8 || interlace !== 0) throw new Error(`${path}: depth ${depth} interlace ${interlace} unsupported`);
  const bpp = colorType === 3 ? 1 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 3;
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
  const rgba = Buffer.alloc(height * width * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * bpp, o = (y * width + x) * 4;
    if (colorType === 3) { const j = out[i] * 3; rgba[o] = plte[j]; rgba[o + 1] = plte[j + 1]; rgba[o + 2] = plte[j + 2]; rgba[o + 3] = 255; }
    else if (bpp === 4) { rgba[o] = out[i]; rgba[o + 1] = out[i + 1]; rgba[o + 2] = out[i + 2]; rgba[o + 3] = out[i + 3]; }
    else if (bpp === 3) { rgba[o] = out[i]; rgba[o + 1] = out[i + 1]; rgba[o + 2] = out[i + 2]; rgba[o + 3] = 255; }
    else { rgba[o] = out[i]; rgba[o + 1] = out[i]; rgba[o + 2] = out[i]; rgba[o + 3] = 255; }
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
function encodePng(path, width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const [, , src, dst, targetW = '320', targetH = '200'] = process.argv;
const TW = Number(targetW), TH = Number(targetH);
const img = decode(src);
const distinct = (line) => new Set(line).size;
const colKeys = (x) => { const s = []; for (let y = 0; y < img.height; y += 4) { const o = (y * img.width + x) * 4; s.push((img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2]); } return distinct(s); };
const rowKeys = (y) => { const s = []; for (let x = 0; x < img.width; x += 4) { const o = (y * img.width + x) * 4; s.push((img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2]); } return distinct(s); };
// Content is "busy": a border or title bar is nearly uniform, the DOS image is not.
const busyCol = (x) => colKeys(x) >= 10, busyRow = (y) => rowKeys(y) >= 10;
const longestRun = (n, ok) => {
  let best = [0, 0], cur = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && ok(i)) { if (cur < 0) cur = i; }
    else if (cur >= 0) { if (i - cur > best[1] - best[0]) best = [cur, i]; cur = -1; }
  }
  return best;
};
let [x0, x1] = longestRun(img.width, busyCol);
let [y0, y1] = longestRun(img.height, busyRow);
const cropW = x1 - x0, cropH = y1 - y0;
const out = Buffer.alloc(TW * TH * 4);
for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
  const sx = x0 + Math.floor((tx + 0.5) * cropW / TW), sy = y0 + Math.floor((ty + 0.5) * cropH / TH);
  const i = (sy * img.width + sx) * 4, o = (ty * TW + tx) * 4;
  out[o] = img.rgba[i]; out[o + 1] = img.rgba[i + 1]; out[o + 2] = img.rgba[i + 2]; out[o + 3] = 255;
}
encodePng(dst, TW, TH, out);
console.log(`${src} ${img.width}x${img.height} crop=${cropW}x${cropH}@${x0},${y0} -> ${dst} ${TW}x${TH}`);
