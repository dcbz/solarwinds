// Dumps BH_SML.DAT's 32 records as ASCII, to settle which glyph is the cursor.
// The walk is the one in FUN_231e_7fc0 @0x2b1bf: <u8 w><u8 h> then w*h, repeated AL-1 times.
// Usage: node web/tools/sml_dump.mjs [index ...]
import fs from 'node:fs';
import { walkRecords } from '../src/engine/screens.ts';

const b = new Uint8Array(fs.readFileSync('web/data/BH_SML.DAT'));
const recs = walkRecords(b, 'stone');
const want = process.argv.slice(2).map((a) => parseInt(a, 16));
const list = want.length ? want : [...Array(recs.length).keys()];
const sizes = new Map();
recs.forEach((r) => sizes.set(`${r.width}x${r.height}`, (sizes.get(`${r.width}x${r.height}`) || 0) + 1));
console.log(`${b.length} bytes, ${recs.length} records, sizes: ${[...sizes].map(([k, n]) => `${k}:${n}`).join(' ')}`);
for (const i of list) {
  const r = recs[i];
  if (!r) { console.log(`0x${i.toString(16)}: absent`); continue; }
  const nz = Array.from(r.pixels).filter((p) => p !== 0).length;
  console.log(`\n--- rec 0x${i.toString(16)}  ${r.width}x${r.height}  nonzero ${nz}/${r.pixels.length}`);
  for (let y = 0; y < r.height; y++) {
    console.log('   ' + Array.from(r.pixels.subarray(y * r.width, (y + 1) * r.width))
      .map((p) => (p ? '#' : '.')).join(''));
  }
}
