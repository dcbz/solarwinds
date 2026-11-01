// Solar Winds — web port, phase 1: the renderer.
//
// This is the *gallery* entry point (`?gallery=1` in index.html). It exists to
// prove the decode/palette/blend path against the shipped files; it is NOT the
// game — the ported state machine lives in src/main.ts + src/engine/loop.ts.
//
// Every entry in SCREENS is derived from the shipped files and the loaders that
// read them; `variant` and `palette` are the two per-file choices established by
// static analysis (re/FINDINGS.md) and confirmed against DOSBox mode-13h output.
//
// NB: the dispatcher files decode to exactly 64001 bytes under the n-1 ("wind")
// rule even though the loader at 0x24ff4 carries the n ("stone") loop — the
// variant column records which rule actually decodes that file, per
// re/FINDINGS.md.

import { decodeFrame, decodeRecords, FRAME_BYTES, type FrameDecode } from './rle.ts';
import { Framebuffer, WIDTH, HEIGHT } from './framebuffer.ts';

const BASE = 'data/';

interface ScreenSpec {
  file: string;
  palette: string;
  variant: 'stone' | 'wind';
  alt?: string;
  partial?: boolean;
  records?: boolean;
}

const SCREENS: Record<string, ScreenSpec> = {
  // dispatcher FUN_231e_c4cf loads these as whole-file streams
  epic: { file: 'BH_EPIC.DAT', palette: 'BH_EPAL.DAT', variant: 'wind' },
  title: { file: 'BH_TITLE.DAT', palette: 'BH_PAL.DAT', variant: 'wind' },
  ord: { file: 'BH_ORD.DAT', palette: 'BH_PAL.DAT', variant: 'wind' },
  wr: { file: 'BH_WR.DAT', palette: 'BH_PAL.DAT', variant: 'wind' },
  seq: { file: 'BH_SEQ.DAT', palette: 'BH_PAL.DAT', variant: 'wind' },
  // zone 1 / zone 2 full-plane maps, alternated for the shimmer effect
  zone1a: { file: 'BH_MW1A.DAT', palette: 'BH_MP1.DAT', variant: 'wind', alt: 'zone1b' },
  zone1b: { file: 'BH_MW1B.DAT', palette: 'BH_MP1.DAT', variant: 'wind', alt: 'zone1a' },
  zone2a: { file: 'BH_MW2A.DAT', palette: 'BH_MP2.DAT', variant: 'wind', alt: 'zone2b' },
  zone2b: { file: 'BH_MW2B.DAT', palette: 'BH_MP2.DAT', variant: 'wind', alt: 'zone2a' },
  // partial-plane maps: seek-walked records composited over a base
  zone3a: { file: 'BH_MW3A.DAT', palette: 'BH_MP3.DAT', variant: 'stone', partial: true },
  zone3b: { file: 'BH_MW3B.DAT', palette: 'BH_MP3.DAT', variant: 'stone', partial: true },
  mw2p: { file: 'BH_MW2P.DAT', palette: 'BH_MP2.DAT', variant: 'stone', records: true },
};

const ORDER = Object.keys(SCREENS);

const cache = new Map<string, Uint8Array>();
const fb = new Framebuffer();
const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
const ctx = (canvas ? canvas.getContext('2d') : null) as CanvasRenderingContext2D | null;
const status = document.getElementById('status') as HTMLElement | null;
let current = 'epic';
let shimmer = false;
let lastSwap = 0;

async function fetchBin(name: string): Promise<Uint8Array> {
  if (!cache.has(name)) {
    const r = await fetch(BASE + name);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    cache.set(name, new Uint8Array(await r.arrayBuffer()));
  }
  return cache.get(name) as Uint8Array;
}

async function show(key: string, quiet = false): Promise<void> {
  const spec = SCREENS[key];
  if (!spec || !canvas || !ctx) return;
  const [dat, pal] = await Promise.all([fetchBin(spec.file), fetchBin(spec.palette)]);
  fb.loadPalette(pal);

  let note: string;
  if (spec.records) {
    const recs = decodeRecords(dat, spec.variant);
    fb.clear(0);
    for (const r of recs) fb.composite(r.pixels, 0);
    note = `${recs.length} records, ${recs.map((r) => r.len).join('/')} px`;
  } else {
    const { pixels, decoded, extra }: FrameDecode = decodeFrame(dat, spec.variant);
    if (spec.partial) {
      fb.clear(1);
      fb.composite(pixels, 0);
    } else {
      fb.blt(pixels, 0);
    }
    note = `${decoded} decoded (${extra > 0 ? '+' + extra : extra} over frame)`;
  }

  fb.present(ctx);
  if (!quiet && status) {
    const kb = (dat.length / 1024).toFixed(1);
    status.textContent = `${key}  ${WIDTH}x${HEIGHT}  ${spec.file} ${kb} KiB  ` +
      `palette ${spec.palette}  variant ${spec.variant}  ${note}  ` +
      `[${shimmer ? 'shimmer on' : 'shimmer off'}]`;
  }
  current = key;
}

function tick(now: number): void {
  const spec = SCREENS[current];
  if (shimmer && spec && spec.alt && now - lastSwap > 500) {
    lastSwap = now;
    void show(spec.alt, true);
  }
  requestAnimationFrame(tick);
}

addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key >= '1' && e.key <= '9') {
    const key = ORDER[Number(e.key) - 1];
    if (key) void show(key);
  } else if (e.key === 'r' || e.key === 'R') {
    shimmer = !shimmer;
    lastSwap = 0;
    void show(current);
  }
});

// The original wrote A000:0000 and let the CRTC scale it; nearest-neighbour keeps that.
if (ctx) ctx.imageSmoothingEnabled = false;
void show('epic').catch((err: Error) => {
  if (status) {
    status.textContent = `load failed: ${err.message} — serve the repo over HTTP (python3 -m http.server 8000)`;
  }
});
requestAnimationFrame(tick);
