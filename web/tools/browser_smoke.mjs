// Browser-path proof without a browser. Installs just enough DOM for web/src/main.ts to take its
// real `if (DOM)` route (startEngine + requestAnimationFrame + getContext('2d') + putImageData),
// then drives the virtual PIT clock and feeds key events. It counts *distinct frames presented*,
// which is the numeric difference between an animation and the gallery this port kept being called.
//
// Usage: node web/tools/browser_smoke.mjs [frames] [presses...]
//   node web/tools/browser_smoke.mjs 400 Enter Enter Space Space s c 1

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const frameCount = Number(process.argv[2] ?? 400);
const pressSpec = process.argv.slice(3).map((t) => ({
  Enter: 'Enter', Space: ' ', Escape: 'Escape', s: 's', c: 'c', a: 'a', w: 'w', e: 'e',
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  D1: '1', D2: '2', D3: '3', F1: 'F1',
}[t] ?? t));

const ROOT = new URL('../', import.meta.url);
const DATA = new URL('data/', ROOT);
const REPO = new URL('../../', import.meta.url);   // PAGE.DAT and SOLAR1.EXE intentionally ship here

// ── fetch → filesystem (same bytes the HTTP server would return) ──────────────────
globalThis.fetch = async (url) => {
  const name = String(url).replace(/^data\//, '').replace(/^\.\.\//, '');
  for (const base of [DATA, ROOT, REPO]) {
    try {
      const buf = await readFile(new URL(name, base));
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    } catch { /* try next base */ }
  }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
};

// ── canvas ────────────────────────────────────────────────────────────────────────
const W = 320, H = 200;
let presented = null;          // last putImageData RGBA
const presents = [];           // one RGBA copy per presented frame
let presentedAt = [];
function makeCanvas() {
  const ctx = {
    imageSmoothingEnabled: true,
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }),
    putImageData: (img) => { presented = img.data; presents.push(img.data.slice()); presentedAt.push(virtualNow); },
  };
  return {
    width: W, height: H,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
}
const canvas = makeCanvas();
const statusEl = { textContent: '' };
const listeners = {};
globalThis.document = { getElementById: (id) => (id === 'screen' ? canvas : id === 'status' ? statusEl : null) };
globalThis.location = { search: '' };
globalThis.addEventListener = (type, fn) => { listeners[type] = fn; };
globalThis.window = globalThis;

// ── virtual clock + rAF, driven by this script ─────────────────────────────────────
let virtualNow = 0;
globalThis.performance = { now: () => virtualNow };
let rafCb = null;
globalThis.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };

// ── boot the real page script ──────────────────────────────────────────────────────
await import('../src/main.ts');
if (!rafCb) throw new Error('main.ts did not schedule a frame — the browser route did not start');

const stepFrame = () => {
  const cb = rafCb; rafCb = null;
  virtualNow += 26;                       // one PIT reload of 0x7918 counts = 25.98 ms
  cb(virtualNow);
};
const press = (key) => {
  listeners.keydown?.({ key, preventDefault() {}, ctrlKey: false, shiftKey: false });
  listeners.keyup?.({ key, preventDefault() {}, ctrlKey: false, shiftKey: false });
};

const hashes = [];
const timeline = [];
let lastHash = null;
for (let i = 0; i < frameCount; i++) {
  if (i === Math.floor(frameCount * 0.15)) press('Enter');
  if (i === Math.floor(frameCount * 0.3)) press('s');
  if (i === Math.floor(frameCount * 0.5)) press(pressSpec[0] ?? 'ArrowUp');
  if (i === Math.floor(frameCount * 0.65)) press(pressSpec[1] ?? ' ');
  if (i === Math.floor(frameCount * 0.8)) press(pressSpec[2] ?? 'c');
  stepFrame();
  if (presented) {
    const h = createHash('sha1').update(presented).digest('hex').slice(0, 12);
    if (h !== lastHash) { hashes.push(h); timeline.push({ i, h }); lastHash = h; }
  }
}

// ── metrics ────────────────────────────────────────────────────────────────────────
const unique = new Set(hashes).size;
const lit = (rgba) => {
  let n = 0, colors = new Set();
  for (let p = 0; p < rgba.length; p += 4) if (rgba[p] || rgba[p + 1] || rgba[p + 2]) n++;
  for (let p = 0; p < rgba.length; p += 4) colors.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
  return { lit: n, colors: colors.size };
};
if (!presented) throw new Error('no frame was ever presented to the canvas');
const f = lit(presented);
// vertical occupancy, to catch the "top band + black" gallery artifact
const bands = [];
for (let y0 = 0; y0 < H; y0 += 20) {
  let n = 0;
  for (let y = y0; y < y0 + 20; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    if (presented[p] || presented[p + 1] || presented[p + 2]) n++;
  }
  bands.push(`${Math.round(100 * n / (20 * W))}%`);
}

const CRC_TABLE = (() => {
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t;
})();
const png = (() => {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    Buffer.from(presented.buffer, presented.byteOffset, presented.length)
      .copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable = CRC_TABLE;
    let c = 0xffffffff; for (const b of body) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
})();
await writeFile(new URL('out/browser_live.png', import.meta.url), png);

console.log(`frames driven   : ${frameCount} (26 ms virtual PIT period)`);
console.log(`presents        : ${presents.length}`);
console.log(`unique frames   : ${unique}  <- animation, not a gallery, iff > a few`);
console.log(`final pixels    : ${f.lit}/${W * H} lit, ${f.colors} colours`);
console.log(`row bands (20px): ${bands.join(' ')}`);
console.log(`status line     : ${statusEl.textContent}`);
console.log('timeline        : ' + timeline.slice(-8).map((t) => `#${t.i}:${t.h}`).join(' '));

// The assertion this tool exists for: a gallery presents one frame. Anything that animates the
// original's own screen logic produces tens of distinct frames over ~10 simulated seconds.
const MIN_UNIQUE = Number(process.env.MIN_UNIQUE ?? 20);
if (unique < MIN_UNIQUE) {
  console.error(`FAIL: only ${unique} unique frames presented (>= ${MIN_UNIQUE} required) — this is a gallery, not a running engine`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${unique} unique frames (>= ${MIN_UNIQUE})`);
}
if (/boot failed/.test(statusEl.textContent)) { console.error('FAIL: page script reported a boot failure'); process.exitCode = 1; }
