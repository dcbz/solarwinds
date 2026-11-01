// Render checkpoints from the real browser startup state machine for visual review.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { createSession } from '../src/main.ts';

const W = 320, H = 200;
function crc32(buf) {
  let crc = 0xffffffff;
  for (const value of buf) {
    let c = (crc ^ value) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(indices, palette) {
  const raw = Buffer.alloc(H * (W + 1));
  const src = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  for (let y = 0; y < H; y++) src.copy(raw, y * (W + 1) + 1, y * W, y * W + W);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(palette)),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('./out/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const session = await createSession({ playStartup: true });
async function shot(name) {
  await fs.writeFile(new URL(`${name}.png`, out), png(session.fb.vram, session.fb.lut));
  console.log(`${name}: ${session.startup?.phase ?? 'live'} stage=${session.startup?.titleStage ?? '-'} counter=${session.startup?.introCounter ?? '-'}`);
}

await shot('startup_epic');
session.keydown({ key: 'Enter' }); session.keyup({ key: 'Enter' });
await shot('startup_title_stage0');
while (session.startup?.phase === 'title' && session.startup.titleStage < 7) session.tick();
await shot('startup_title_final');
session.keydown({ key: 'Enter' }); session.keyup({ key: 'Enter' });
await shot('startup_intro');
session.keydown({ key: 'Enter' });
await shot('startup_live');

