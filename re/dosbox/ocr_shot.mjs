// Read the real game's screens: OCR a DOSBox rawshot PNG back to text using the engine's own
// proportional bitmap font (BH_CHAR.DAT glyphs + the EXE's width table at DS:0xb300).
//
// STATUS: NOT WORKING — DO NOT TRUST ITS OUTPUT. Verified to fail on a screen whose text is known
// (web/tools/out/browser_live.png, which the port itself drew with "KAA! The rumors are to be
// believed."), where it returns punctuation noise. Two causes are known: bandInk() assumes the
// most common colour in an 8-row band is the background, which is false over starfield/art rows,
// and the greedy 0.12 mismatch threshold accepts spurious single-glyph hits. A correct version
// needs the text bands located by their own drawing calls (the message origin in DS:[0x6bb5] and
// the FONT_DRAW path @0x2be49), not by image statistics. Kept because the glyph/width plumbing
// below is reusable once the band detector is replaced.
//
// Usage: node re/dosbox/ocr_shot.mjs re/dosbox/captures/probe/03_13s.png
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { loadTextFont, glyphWidth, GLYPH_STRIDE, GLYPH_ROW_STRIDE } from '../../web/src/engine/text.ts';

const W = 320, H = 200;
const [, , path] = process.argv;
if (!path) throw new Error('usage: ocr_shot.mjs shot.png');

const buf = readFileSync(path);
let at = 8, width = 0, height = 0, colorType = 0, plte = null; const idat = [];
while (at < buf.length) {
  const len = buf.readUInt32BE(at), type = buf.toString('ascii', at + 4, at + 8);
  const data = buf.subarray(at + 8, at + 8 + len);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
  else if (type === 'IDAT') idat.push(data);
  else if (type === 'PLTE') plte = data;
  else if (type === 'IEND') break;
  at += 12 + len;
}
if (width !== W || height !== H) throw new Error(`${path}: expected ${W}x${H}, got ${width}x${height}`);
if (colorType !== 6 && colorType !== 2 && colorType !== 3) throw new Error(`unsupported colour type ${colorType}`);
const bpp = colorType === 3 ? 1 : colorType === 2 ? 3 : 4;
const raw = inflateSync(Buffer.concat(idat));
const stride = width * bpp, px = Buffer.alloc(height * stride);
let prev = Buffer.alloc(stride);
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  const cur = px.subarray(y * stride, (y + 1) * stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
    let v = line[x];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    cur[x] = v & 0xff;
  }
  prev = cur;
}
// Quantise to a small colour key so background/ink is decided on the rendered RGB, not an index.
const key = new Int32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const o = i * bpp;
  const r = colorType === 3 ? plte[px[i] * 3] : px[o];
  const g = colorType === 3 ? plte[px[i] * 3 + 1] : px[o + 1];
  const b = colorType === 3 ? plte[px[i] * 3 + 2] : px[o + 2];
  key[i] = (r << 16) | (g << 8) | b;
}

const exe = readFileSync(new URL('../../SOLAR1.EXE', import.meta.url));
const glyphs = readFileSync(new URL('../../web/data/BH_CHAR.DAT', import.meta.url));
const font = loadTextFont(new Uint8Array(glyphs.buffer, glyphs.byteOffset, glyphs.byteLength), new Uint8Array(exe.buffer, exe.byteOffset, exe.byteLength));
const inkPattern = (ch) => {
  const w = glyphWidth(font, ch), src = ch * GLYPH_STRIDE, rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    for (let c = 0; c < w; c++) row += font.glyphs[src + r * GLYPH_ROW_STRIDE + c] !== 0 ? '#' : '.';
    rows.push(row);
  }
  return rows;
};
const patterns = new Map();
for (let ch = 0x1e; ch <= 0x85; ch++) if (glyphWidth(font, ch) > 0) patterns.set(ch, inkPattern(ch));

// A row band is "text" where the second-most-common colour forms thin vertical strokes.
const bandInk = (y0) => {
  const counts = new Map();
  for (let y = y0; y < y0 + 8 && y < H; y++) for (let x = 0; x < W; x++) {
    const k = key[y * W + x]; counts.set(k, (counts.get(k) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) return null;
  const bg = sorted[0][0];
  let inkCount = 0;
  for (let y = y0; y < y0 + 8 && y < H; y++) for (let x = 0; x < W; x++) if (key[y * W + x] !== bg) inkCount++;
  if (inkCount < 12 || inkCount > 1400) return null;
  return { bg, ink: (x, y) => key[y * W + x] !== bg };
};

const lines = [];
for (let y0 = 0; y0 < H - 8; y0++) {
  const band = bandInk(y0);
  if (!band) continue;
  let x = 0, text = '', any = 0;
  while (x < W - 2) {
    let best = null;
    for (const [ch, pat] of patterns) {
      const w = pat[0].length;
      if (x + w > W) continue;
      let miss = 0, cells = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < w; c++) {
        const want = pat[r][c] === '#';
        const got = band.ink(x + c, y0 + r);
        cells++; if (want !== got) miss++;
      }
      const rate = miss / cells;
      if (best === null || rate < best.rate) best = { ch, w, rate };
      if (best.rate === 0) break;
    }
    if (best && best.rate < 0.12) { text += String.fromCharCode(best.ch); x += best.w; any++; }
    else { x += 1; if (best) text += ' '; }
  }
  if (any > 2) lines.push({ y: y0, text: text.replace(/\s+$/, '') });
}
// collapse duplicate vertical offsets (a glyph is found at several y within its own height)
const kept = [];
for (const l of lines) {
  const near = kept.find((k) => Math.abs(k.y - l.y) < 7 && (k.text.length > l.text.length ? k.text.startsWith(l.text.slice(0, 5)) : true));
  if (near) { if (l.text.length > near.text.length) { near.text = l.text; near.y = l.y; } }
  else kept.push({ ...l });
}
console.log(`# ${path}`);
for (const k of kept.sort((a, b) => a.y - b.y)) console.log(`y=${String(k.y).padStart(3)}  ${k.text}`);
