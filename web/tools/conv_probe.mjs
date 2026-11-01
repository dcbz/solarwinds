// Probe: does the `c` arm now produce real dialogue?
import { createSession } from '../src/main.ts';

const s = await createSession();
const c = s.state.conv;
console.log('conv attached:', !!c, 'len', c && c.length);
if (c) console.log('head bytes:', [...c.slice(0, 14)].join(' '));

const r = s.keydown({ key: 'c' });
const log = r.scriptLog || [];
console.log('scriptLog entries:', log.length);
for (const L of log.slice(0, 3)) {
  console.log(`  site 0x${(L.site ?? 0).toString(16)} :: ${(L.text || '').split('\n')[0].slice(0, 140)}`);
  for (const ch of (L.choices || []).slice(0, 5)) console.log(`     [${ch.label}] -> 0x${ch.target.toString(16)}`);
}
for (const t of (r.trace || []).filter((x) => /CONV id|quest effect|cutscene|node/.test(x)).slice(0, 8)) {
  console.log('  *', t.slice(0, 160));
}
