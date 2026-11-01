import { readFile } from 'node:fs/promises';
import { decodeRLE } from '../dist/rle.ts';
for (const f of ['BH_PAN','BH_SEQ2','BH_MS','BH_PLAN','BH_SML','BH_MW3A','BH_MW3B','BH_MW2P','BH_CHAR','BH_SCRN','BH_SHIP','BH_PEOP','BH_OBJ','BH_VFD','BH_ORD','BH_IORD','BH_EXPL','BH_SHD','BH_IMP','BH_MIS']) {
  let buf; try { buf = await readFile(new URL(`../data/${f}.DAT`, import.meta.url)); } catch { continue; }
  for (const v of ['stone','wind']) {
    try {
      const s = decodeRLE(buf, v);
      const recs = []; let off = 0;
      while (off + 2 <= s.length) { const w = s[off], h = s[off+1]; if (!w || !h) break; const e = off+2+w*h; if (e > s.length) break; recs.push(`${w}x${h}`); off = e; }
      const t = s.length - off;
      console.log(`${f} ${v}: ${s.length}B ${recs.length} recs [${recs.slice(0,5).join(' ')}${recs.length>5?' …':''}] tail=${t}` + (t>2?` next=${s[off]}x${s[off+1]}`:''));
    } catch (e) { console.log(`${f} ${v}: ERR ${e.message.slice(0,50)}`); }
  }
}
