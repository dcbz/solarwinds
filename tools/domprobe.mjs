// Drives web/dist/main.js through the *browser* code path with a minimal DOM
// shim, so a black canvas can be told apart from a slow screenshot.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..', 'web', 'data');
let putCalls = 0;
let lastImage = null;

const mkCtx = () => ({
  imageSmoothingEnabled: true,
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: (img) => { putCalls += 1; lastImage = img; },
});

const mkCanvas = () => ({
  width: 320, height: 200, _ctx: mkCtx(),
  getContext() { return this._ctx; },
  addEventListener(type, fn) { (globalThis.__lis ||= []).push([type, fn]); },
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; },
});

const statusEl = { textContent: 'booting…' };
const els = { screen: mkCanvas(), status: statusEl };

globalThis.document = { getElementById: (id) => els[id] ?? null };
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.addEventListener = (type, fn) => { (globalThis.__lis ||= []).push([type, fn]); };
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  // Same fallback main.ts uses: PAGE.DAT and SOLAR1.EXE live at the repository root.
  const p = [path.join(ROOT, name), path.resolve(import.meta.dirname, '..', name)]
    .find((candidate) => fs.existsSync(candidate));
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  return { ok: true, status: 200, arrayBuffer: async () => (await fs.promises.readFile(p)).buffer };
};

const errs = [];
process.on('uncaughtException', (e) => errs.push(e));

await import('../web/dist/main.js');
await new Promise((r) => setTimeout(r, 400));

console.log('putImageData calls:', putCalls);
console.log('status:', statusEl.textContent);
const vram = els.screen._ctx && lastImage ? null : null;
let nonzero = 0;
if (lastImage) for (let i = 3; i < lastImage.data.length; i += 4) if (lastImage.data[i - 3] || lastImage.data[i - 2] || lastImage.data[i - 1]) nonzero++;
console.log('lit pixels in last putImageData:', nonzero);
const fire = (type, ev) => { for (const [t, fn] of (globalThis.__lis || [])) if (t === type) fn(ev); };
// Each mode key is preceded by Escape: a/w/e are arms of the *state-1* handler FUN_231e_b509
// (@0x2e6e9/@0x2e6ff/@0x2e71c). Once the mode byte is 2..4 the pump dispatches to that state's own
// handler instead, which compares none of them, so pressing them inside a panel page correctly does
// nothing (@0x2eb8b is a bare retf). '-' and '=' appear twice for the same reason: cheat-gated
// scroller in state 1 (@0x2e82e, @0x2e85b), record pager in state 3 (@0x2ebc3, @0x2ebe9).
const KEYS = [{ key: 'a' },
  { key: 'Escape' }, { key: 'w' },
  { key: 'Escape' }, { key: 'e' },
  { key: 'Escape' }, { key: 'F2' }, { key: 'F9' }, { key: '-' }, { key: '=' },
  { key: 'a' }, { key: '-' }, { key: '=' }, { key: 't' }, { key: 'u' },
  { key: 'Escape' }, { key: 'n' }, { key: '1' }, { key: '2' }, { key: '4' }, { key: 'z' }];
// Pixels in the columns the compositor owns (226..319): the panel's footprint on the canvas.
const panelLit = (img) => {
  let n = 0;
  for (let y = 0; y < 200; y++) for (let x = 226; x < 320; x++) {
    const o = (y * 320 + x) * 4;
    if (img.data[o] || img.data[o + 1] || img.data[o + 2]) n++;
  }
  return n;
};
const hash = (img) => createHash('sha1').update(Buffer.from(img.data.buffer)).digest('hex').slice(0, 12);
console.log('boot'.padEnd(18), '|', hash(lastImage), 'panel', String(panelLit(lastImage)).padStart(5));
for (const key of KEYS) {
  fire('keydown', { ...key, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 30));
  const parts = statusEl.textContent.split('|').map((x) => x.trim());
  console.log(('key ' + key.key).padEnd(18), (parts[1] || '').slice(0, 46).padEnd(46),
    hash(lastImage), 'panel', String(panelLit(lastImage)).padStart(5));
  if (key === KEYS[KEYS.length - 1]) console.log('  art:', parts[2]);
}
console.log('errors:', errs.map((e) => `${e.name}: ${e.message}`).slice(0, 3));
// The frame clock is an endless rAF/timer loop by design (that is the point of re/frame-clock), so
// the probe would otherwise never let node drain its event loop.
process.exit(0);
