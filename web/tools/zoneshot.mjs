// Renders the three zone cutscene loaders (FUN_231e_6db0 @0x29f90, FUN_231e_7182 @0x2a362,
// FUN_231e_75a6 @0x2a786) through web/src/engine/zones.ts and writes real 320x200 PNGs, so the
// claim "the zone loaders are full-screen sequences, not map views" can be checked by eye.
// Usage: node web/tools/zoneshot.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadZoneAssets, createZonePlayer, dacToRgb } from '../src/engine/zones.ts';

const W = 320, H = 200;
const crc = (b) => zlib.crc32(b) >>> 0;
const png = (idx, lut) => {                       // truecolour: some viewers reject the indexed form
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3, c = idx[y * W + x] * 3;
      raw[o] = lut[c]; raw[o + 1] = lut[c + 1]; raw[o + 2] = lut[c + 2];
    }
  }
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
};

const read = async (n) => new Uint8Array(await fs.promises.readFile(new URL('../data/' + n, import.meta.url)));
await fs.promises.mkdir(new URL('./out', import.meta.url), { recursive: true });
const out = (name) => new URL(`./out/${name}`, import.meta.url).pathname;

for (const zone of [1, 2, 3]) {
  const assets = await loadZoneAssets(zone, read);
  const vram = new Uint8Array(W * H);
  const player = createZonePlayer(assets, vram);
  let rgb = dacToRgb(assets.paletteDac);
  const shots = [];
  let prev = '';
  for (let pass = 0; pass < 200; pass++) {
    const ops = player.step();
    for (const op of ops) {
      const h = createHash('sha256').update(vram).digest('hex').slice(0, 12);
      if (h !== prev) {
        const file = `ZONE${zone}_p${String(pass).padStart(3, '0')}_${op.op}.png`;
        fs.writeFileSync(out(file), png(vram, rgb));
        shots.push(`${file}  ${op.op} @0x${op.addr.toString(16)}  ${op.detail.slice(0, 58)}`);
        prev = h;
      }
    }
    if (player.done) break;
  }
  console.log(`\n=== zone ${zone}: palette ${assets.paletteFile}, ${assets.frames.length} frame(s), ${assets.records.length} record stream(s) (${assets.records.map(r => r.list.length + ' recs').join(', ')})`);
  for (const s of shots.slice(0, 10)) console.log('   ', s);
  if (shots.length > 10) console.log(`    … ${shots.length - 10} more distinct frames`);
  const nonBlank = vram.reduce((a, b) => a + (b ? 1 : 0), 0);
  console.log(`    final vram: ${nonBlank}/64000 non-zero indices · passes run ${shots.length ? 'yes' : 'NO OUTPUT'}`);
}
