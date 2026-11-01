/**
 * Checks that the shipped Solar Winds distribution in this repo is intact.
 *
 * LICENSE.DOC clause 1 permits distribution "as long as no files are altered or removed". That is a
 * statement about bytes, so it should be checked with bytes rather than asserted in prose. Three
 * copies exist: solar.zip (the pristine 1994 archive), the loose files at the repo root, and the
 * subset in web/data/ that the port actually fetches. This verifies zip == root for every entry and
 * root == web/data for every file the port loads.
 *
 *   node tools/verify_dist.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => fs.readFileSync(path.join(root, p));

// `unzip -Z1` prints one member name per line, which avoids parsing the size/date columns of -l.
const names = execFileSync('unzip', ['-Z1', path.join(root, 'solar.zip')], { encoding: 'latin1' })
  .split('\n').map((n) => n.replace(/\/+$/, '')).filter((n) => n && !n.includes('/'));

let bad = 0;
const fail = (m) => { console.log(`MISMATCH ${m}`); bad++; };

console.log(`solar.zip: ${names.length} files`);
const zipNames = new Set();
for (const name of names) {
  zipNames.add(name.toLowerCase());
  const want = execFileSync('unzip', ['-p', path.join(root, 'solar.zip'), name], { maxBuffer: 1 << 26 });
  const loose = path.join(root, name);
  if (!fs.existsSync(loose)) { fail(`${name} is in the archive but absent from the working tree (removed file)`); continue; }
  const have = read(name);
  if (have.length !== want.length) fail(`${name} length ${have.length} != archive ${want.length}`);
  else if (Buffer.compare(have, want) !== 0) fail(`${name} bytes differ from the archive`);
}
for (const f of fs.readdirSync(root)) {
  const p = path.join(root, f);
  if (!fs.statSync(p).isFile()) continue;
  if (!/\.(EXE|DAT|DOC|DIZ|ANS|zip)$/i.test(f)) continue;
  if (f === 'solar.zip') continue;
  if (!zipNames.has(f.toLowerCase())) fail(`${f} is in the working tree but not in the archive (added file)`);
}
console.log(`root vs archive: ${bad ? `${bad} mismatch(es)` : 'identical'}`);

const dir = path.join(root, 'web', 'data');
const copied = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f !== 'README.md') : [];
let sub = 0;
for (const f of copied) {
  const a = read(path.join('web', 'data', f));
  const b = read(f);
  if (sha(a) !== sha(b)) { fail(`web/data/${f} differs from the root copy the port should not be reading`); sub++; }
}
console.log(`web/data: ${copied.length} files, ${sub ? `${sub} differ` : 'all byte-identical to the root copies'}`);
console.log(bad ? `\nDISTRIBUTION IS MODIFIED — ${bad} problem(s); do not publish this tree` : '\ndistribution intact');
process.exit(bad ? 1 : 0);
