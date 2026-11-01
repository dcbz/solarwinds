// Solar Winds — resource loader layer.
//
// Transcribes the open / read / decode sites of the six loading routines in
// SOLAR1.EXE, so the rest of the port asks for a resource by name instead of
// hard-coding filenames. Everything here is data + the two RLE variants from
// ../rle.js; nothing touches the DOM or a canvas, so the module is importable
// from a node script with an injected reader (see `read` below).
//
//   FUN_231e_c4cf  @0x2f6af   boot resource bundle, 20 sequential open sites
//   FUN_231e_6db0  @0x29f90   zone 1  MP1 palette + MW1A/MW1B frames
//   FUN_231e_7182  @0x2a362   zone 2  MP2 palette + MW2A/MW2B frames + MW2P strips
//   FUN_231e_75a6  @0x2a786   zone 3  MP3 palette + MW3A/MW3B record planes
//   FUN_231e_3708  @0x268e8   war report frame (BH_WR.DAT; PAGE.DAT on the other branch)
//   FUN_231e_a26d  @0x2d44d   conversation table (BH_CONV, read raw — no RLE)
//
// Evidence: re/loader_map.md, re/FINDINGS.md ("PICTURE FORMAT SETTLED", per-loader
// variant table), re/formats-maps.md F1-F4. Addresses are linear byte coordinates
// (file offset + 0xf200).

import { decodeRLE, decodeFrame, FRAME_BYTES, type Variant } from '../rle.ts';

// The engine decodes the whole file and stops one byte past its buffer, so a
// single-frame stream measures 64,001 bytes; its 64,000-byte `rep movsw` drops
// the extra one. Every full-frame resource below must hit this number.
export const FRAME_STREAM_BYTES = FRAME_BYTES + 1;

// Palette files are 768 B of 8-bit RGB. The loaders halve each component twice
// (`shr 1` x2 over di = 0..0x2ff) before feeding the 6-bit VGA DAC, so the
// colour that reaches the screen is (v >> 2) << 2. Framebuffer.loadPalette
// applies the same rounding to the raw bytes; use dacPalette when you need the
// converted table without a framebuffer.
export function dacPalette(rgb: Uint8Array) {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 768; i++) lut[i] = (rgb[i] >> 2) << 2;
  return lut;
}

// Browser default reader; the loaders take `read` as their last argument so a
// node check can inject an fs-based one.
const DATA_BASE = 'data/';

async function fetchRead(name: string) {
  const r = await fetch(DATA_BASE + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// INT 21h/3Fh is called with an explicit cx cap (0xc350 or 0xffff). Anything
// past the cap is never in the engine's buffer, so the port truncates the same way.
async function readCapped(read: (name: string) => Promise<Uint8Array>, file: string, cap: number) {
  const buf = await read(file);
  return buf.length > cap ? buf.subarray(0, cap) : buf;
}

// Record framing of the decoded non-frame streams: <u8 width><u8 height>
// followed by width*height pixel indices, repeated. Verified on the shipped
// files: BH_MS (32x 35*35), BH_PLAN (32x), BH_SEQ2 (41x), MW3A/MW3B (4x ~115*94),
// MW2P (8x 45*45) all walk to `decoded - 1` bytes, the last byte being the
// engine's over-read artifact. Blit 0x2a2e2 consumes zone 3 records this way
// (row stride 0x140, first VRAM offset 0x3eb2); 0x2a2a5 indexes MW2P's 8 strips
// at stride 0x7eb.
export function walkRecords(stream: Uint8Array) {
  const records = [];
  let off = 0;
  while (off + 2 <= stream.length) {
    const width = stream[off];
    const height = stream[off + 1];
    if (width === 0 || height === 0) break;
    const end = off + 2 + width * height;
    if (end > stream.length) break;
    records.push({ width, height, offset: off + 2, pixels: stream.subarray(off + 2, end) });
    off = end;
  }
  return records;
}

// ---------------------------------------------------------------------------
// (1) dispatcher table — FUN_231e_c4cf @0x2f6af
//
// The routine is straight-line code, not a switch: 20 `mov ah,0x3d / mov al,2 /
// lea dx,[name] / int 0x21` sites in a fixed order, each followed by a capped
// read, a close, and segment arithmetic that chains the next block. The
// resource id in the port is therefore the *slot* — the site's position in that
// sequence — and `openAt` is the address that proves it.
//
// kind: 'frame'   whole-file RLE stream, one 320x200 plane (64,001 bytes)
//       'stream'  whole-file RLE stream of [w,h,pixels] records
//       'palette' 768 B RGB, DAC-converted
//       'table'   raw struct/array, never RLE-decoded
// Only the eight sites with a decoder loop get a variant; the decoder-loop
// addresses are in `decodeAt`. `paletteSlot` names the bundle entry whose palette
// the engine has loaded when this frame is on screen. PAGE.DAT is opened by the
// engine but is not part of the web/data/ corpus yet.
// ---------------------------------------------------------------------------

export const DISPATCH: DispatchEntry[] = [
  { slot: 0, id: 'savlst', openAt: 0x2f6d0, file: 'SAVLST.DAT', readBytes: 0x00f0, kind: 'table' },
  { slot: 1, id: 'ms', openAt: 0x2f71f, file: 'BH_MS.DAT', readBytes: 0xffff, kind: 'stream', variant: 'stone', decodeAt: 0x2f7a9 },
  { slot: 2, id: 'expl', openAt: 0x2f7eb, file: 'BH_EXPL.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 3, id: 'shd', openAt: 0x2f843, file: 'BH_SHD.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 4, id: 'imp', openAt: 0x2f87c, file: 'BH_IMP.DAT', readBytes: 0x0050, kind: 'table' },
  { slot: 5, id: 'mis', openAt: 0x2f8b1, file: 'BH_MIS.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 6, id: 'sml', openAt: 0x2f92d, file: 'BH_SML.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 7, id: 'obj', openAt: 0x2f99a, file: 'BH_OBJ.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 8, id: 'pan', openAt: 0x2fa22, file: 'BH_PAN.DAT', readBytes: 0xffff, kind: 'stream', variant: 'stone', decodeAt: 0x2fac3 },
  { slot: 9, id: 'plan', openAt: 0x2faff, file: 'BH_PLAN.DAT', readBytes: 0xffff, kind: 'stream', variant: 'stone', decodeAt: 0x2fb8c },
  { slot: 10, id: 'vfd', openAt: 0x2fbc8, file: 'BH_VFD.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 11, id: 'iord', openAt: 0x2fc26, file: 'BH_IORD.DAT', readBytes: 0xffff, kind: 'table' },
  { slot: 12, id: 'epal', openAt: 0x2fc67, file: 'BH_EPAL.DAT', readBytes: 0xc350, kind: 'palette' },
  { slot: 13, id: 'epic', openAt: 0x2fca1, file: 'BH_EPIC.DAT', readBytes: 0xc350, kind: 'frame', variant: 'wind', decodeAt: 0x2fd00, paletteSlot: 'epal' },
  { slot: 14, id: 'pal', openAt: 0x2fd1e, file: 'BH_PAL.DAT', readBytes: 0xc350, kind: 'palette' },
  { slot: 15, id: 'title', openAt: 0x2fd6b, file: 'BH_TITLE.DAT', readBytes: 0xc350, kind: 'frame', variant: 'wind', decodeAt: 0x2fdd8, paletteSlot: 'pal' },
  { slot: 16, id: 'pic', openAt: 0x2fe95, file: 'BH_PIC.DAT', readBytes: 0xc350, kind: 'table' },
  { slot: 17, id: 'seq', openAt: 0x3008c, file: 'BH_SEQ.DAT', readBytes: 0xc350, kind: 'frame', variant: 'wind', decodeAt: 0x300f9, paletteSlot: 'pal' },
  { slot: 18, id: 'seq2', openAt: 0x3013f, file: 'BH_SEQ2.DAT', readBytes: 0xffff, kind: 'stream', variant: 'stone', decodeAt: 0x301a8, paletteSlot: 'pal' },
  { slot: 19, id: 'page', openAt: 0x30668, file: 'PAGE.DAT', readBytes: 0xc350, kind: 'frame', variant: 'wind', decodeAt: 0x306d5, paletteSlot: 'pal' },
];

export interface DispatchEntry {
  slot: number; id: string; openAt: number; file: string; readBytes: number;
  kind: 'frame' | 'stream' | 'palette' | 'conv' | string;
  variant?: Variant; decodeAt?: number; paletteSlot?: string; [k: string]: any;
}

const BY_ID = new Map<string, DispatchEntry>(DISPATCH.map((e: DispatchEntry) => [e.id, e]));
const BY_SLOT = new Map<number, DispatchEntry>(DISPATCH.map((e: DispatchEntry) => [e.slot, e]));

export function resource(id: string | number) {
  const entry = typeof id === 'number' ? BY_SLOT.get(id) : BY_ID.get(id as string);
  if (!entry) throw new Error(`screens: unknown resource id ${id}`);
  return entry;
}

// resource id -> filename, the table the dispatcher encodes as `lea dx,[name]`.
export function filenameFor(id: string | number) {
  return resource(id).file;
}

async function decodeAs(entry: any, buf: Uint8Array) {
  if (entry.kind === 'palette') {
    return { ...entry, kind: 'palette', rgb: buf, dac: dacPalette(buf) };
  }
  if (entry.kind === 'table') {
    return { ...entry, kind: 'table', bytes: buf };
  }
  if (entry.kind === 'frame') {
    const frame = decodeFrame(buf, entry.variant);
    return { ...entry, kind: 'frame', decoded: frame.decoded, pixels: frame.pixels, extra: frame.extra };
  }
  const stream = decodeRLE(buf, entry.variant);
  return { ...entry, kind: 'stream', decoded: stream.length, records: walkRecords(stream) };
}

// One slot of the boot bundle. `read` defaults to fetch against data/.
export async function loadDispatcherResource(id: any, read: (name: string) => Promise<Uint8Array> = fetchRead) {
  const entry = resource(id);
  const buf = await readCapped(read, entry.file, entry.readBytes);
  return decodeAs(entry, buf);
}

// FUN_231e_6475 @0x29655 dynamically loads one BH_SHIP bank when an actor type
// >= 0xc8 reaches FUN_231e_16fc. The outer file is seven
//   <u16 packedLength><stone-RLE payload>
// records (types 0xc8..0xce). Each decoded payload is itself exactly 32
// <u8 width><u8 height><pixels> directional records; @0x2979f..0x297cb builds
// the 32-entry pointer table that @0x2493b indexes.
export interface ShipBank {
  type: number;
  fileOffset: number;
  packedLength: number;
  decoded: number;
  records: ReturnType<typeof walkRecords>;
}

export function decodeShipBanks(bytes: Uint8Array): ShipBank[] {
  const banks: ShipBank[] = [];
  let off = 0;
  while (off + 2 <= bytes.length) {
    const packedLength = bytes[off] | (bytes[off + 1] << 8);
    const payload = off + 2;
    const end = payload + packedLength;
    if (packedLength === 0 || end > bytes.length) {
      throw new RangeError(`BH_SHIP bank ${banks.length}: packed range ${payload}..${end} exceeds ${bytes.length}`);
    }
    const stream = decodeRLE(bytes.subarray(payload, end), 'stone');
    const records = walkRecords(stream);
    if (records.length !== 32) {
      throw new RangeError(`BH_SHIP bank ${banks.length}: expected 32 directional records, got ${records.length}`);
    }
    banks.push({
      type: 0xc8 + banks.length,
      fileOffset: off,
      packedLength,
      decoded: stream.length,
      records,
    });
    off = end;
  }
  if (off !== bytes.length || banks.length !== 7) {
    throw new RangeError(`BH_SHIP: expected 7 banks consuming ${bytes.length} bytes, got ${banks.length} ending at ${off}`);
  }
  return banks;
}

export async function loadShipBanks(read: (name: string) => Promise<Uint8Array> = fetchRead): Promise<ShipBank[]> {
  return decodeShipBanks(await read('BH_SHIP.DAT'));
}

// What the routine actually does: walk all 20 sites in slot order. A missing
// file (PAGE.DAT is opened by slot 19 but is not in web/data/) is recorded as
// { id, slot, file, missing } and does not stop the bundle, matching the
// engine's own behaviour of setting a per-resource failure flag
// ([0x4564]..[0x456c]) and continuing.
export async function loadResourceBundle(read: (name: string) => Promise<Uint8Array> = fetchRead) {
  const loaded = [];
  for (const entry of DISPATCH) {
    try {
      loaded.push(await loadDispatcherResource(entry.slot, read));
    } catch (err) {
      loaded.push({ id: entry.id, slot: entry.slot, file: entry.file, missing: String(err) });
    }
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// (2) the three map-zone loaders + war report + conversation
//
// Each zone owns a 768 B palette (MPn) that it swaps in on entry and restores
// BH_PAL.DAT over on exit — the renderer must therefore support per-zone
// palettes, not one global table (re/loader_map.md "Consequence for the port").
// ---------------------------------------------------------------------------

export const ZONES: Record<number, any> = {
  1: {
    loader: 0x29f90,
    paletteFile: 'BH_MP1.DAT',
    frames: [
      { file: 'BH_MW1A.DAT', variant: 'wind', readBytes: 0xc350, decodeAt: 0x2a03b, dest: 'vram' },
      { file: 'BH_MW1B.DAT', variant: 'wind', readBytes: 0xc350, decodeAt: 0x2a15e, dest: 'vram' },
    ],
    restoreFile: 'BH_PAL.DAT',
  },
  2: {
    loader: 0x2a362,
    paletteFile: 'BH_MP2.DAT',
    frames: [
      { file: 'BH_MW2A.DAT', variant: 'wind', readBytes: 0xc350, decodeAt: 0x2a40d, dest: 'vram' },
      { file: 'BH_MW2B.DAT', variant: 'wind', readBytes: 0xc350, decodeAt: 0x2a4d9, dest: 'vram' },
    ],
    // MW2P is not a frame: it decodes (stone) into the scratch buffer at offset
    // 0x1770 = 6000 and holds 8 45x45 strips that blit 0x2a2a5 indexes with
    // stride 0x7eb.
    planes: [
      { file: 'BH_MW2P.DAT', variant: 'stone', readBytes: 0xffff, decodeAt: 0x2a54d, destOffset: 0x1770 },
    ],
    restoreFile: 'BH_PAL.DAT',
  },
  3: {
    loader: 0x2a786,
    paletteFile: 'BH_MP3.DAT',
    frames: [],
    // Zone 3 art is read with cx=0xffff (not 0xc350) and decoded with the stone
    // variant into two separate scratch buffers; each stream is four ~115x94
    // records that blit 0x2a2e2 draws over a zeroed screen at 0x3eb2 with row
    // stride 0x140. MW3A supplies records 0..3, MW3B records 4..7.
    // There is no INT 21h/42h seek in this routine: the only lseek sites in the
    // EXE are 0x250b9 and 0x2515f inside the picture loader 0x24ff4. What earlier
    // notes read as "a seek at 0x2a84c" is `mov ah,0x3d / mov al,2` — the second
    // OPEN, and the record walk happens in the decoded buffer, not by file seek.
    planes: [
      { file: 'BH_MW3A.DAT', variant: 'stone', readBytes: 0xffff, decodeAt: 0x2a837, plane: 0 },
      { file: 'BH_MW3B.DAT', variant: 'stone', readBytes: 0xffff, decodeAt: 0x2a8ab, plane: 1 },
    ],
    blit: { vramOffset: 0x3eb2, rowStride: 0x140, recordsPerPlane: 4 },
    restoreFile: 'BH_PAL.DAT',
  },
};

// Zone n: palette + full frames + partial planes.
export async function loadZone(n: number, read: (name: string) => Promise<Uint8Array> = fetchRead) {
  const zone = ZONES[n];
  if (!zone) throw new Error(`screens: no zone ${n} (1..3)`);

  const rgb = await readCapped(read, zone.paletteFile, 0xc350);
  const frames = [];
  for (const spec of zone.frames) {
    const buf = await readCapped(read, spec.file, spec.readBytes);
    const frame = decodeFrame(buf, spec.variant as Variant);
    frames.push({ ...spec, decoded: frame.decoded, pixels: frame.pixels, extra: frame.extra });
  }
  const planes = [];
  for (const spec of zone.planes || []) {
    const buf = await readCapped(read, spec.file, spec.readBytes);
    const stream = decodeRLE(buf, spec.variant);
    planes.push({ ...spec, decoded: stream.length, records: walkRecords(stream), pixels: stream });
  }
  return {
    kind: 'zone',
    zone: n,
    loader: zone.loader,
    paletteFile: zone.paletteFile,
    palette: rgb,
    dac: dacPalette(rgb),
    frames,
    planes,
    blit: zone.blit || null,
    restoreFile: zone.restoreFile,
  };
}

// War report — FUN_231e_3708 @0x268e8. Reads cx=0xc350, decodes with the wind
// variant into the scratch frame, then `rep movsw` cx=0xfa00 to A000:0. The open
// site itself picks the file at run time (0x268fc): BH_WR.DAT when the byte at
// [0x3ade] is 1, PAGE.DAT otherwise. BH_WR is what web/data/ ships, so `altFile`
// is recorded here rather than loaded.
export async function loadWarReport(read: (name: string) => Promise<Uint8Array> = fetchRead) {
  const spec = { file: 'BH_WR.DAT', altFile: 'PAGE.DAT', variant: 'wind', readBytes: 0xc350, decodeAt: 0x2695f, kind: 'frame' };
  const [buf, rgb] = await Promise.all([
    readCapped(read, spec.file, spec.readBytes),
    readCapped(read, 'BH_PAL.DAT', 0xc350),
  ]);
  const frame = decodeFrame(buf, spec.variant as Variant);
  return {
    ...spec,
    decoded: frame.decoded,
    pixels: frame.pixels,
    extra: frame.extra,
    paletteFile: 'BH_PAL.DAT',
    palette: rgb,
    dac: dacPalette(rgb),
  };
}

// Conversation — FUN_231e_a26d @0x2d44d. This one performs **no RLE decode**:
// a single INT 21h/3Fh with cx=0xea60 into a segment returned by the allocator
// (lcall 0x131e,0x1de0) loads the whole blob raw. Layout, observed on disk:
// 13-byte magic "SOLAR WINDS\x1a\x1a" then an array of u16 record offsets whose
// length is implied by the first entry (offsets[0] - 13) / 2 = 16 for BH_CONV.
// Pictures a conversation node selects are decoded by the picture loader
// 0x24ff4 (stone variant, seek-walked records), not here.
export async function loadConversation(read: (name: string) => Promise<Uint8Array> = fetchRead) {
  const spec = { file: 'BH_CONV.DAT', readBytes: 0xea60, decodeAt: null, variant: null };
  const blob = await readCapped(read, spec.file, spec.readBytes);
  const magic = 'SOLAR WINDS\x1a\x1a';
  const tableStart = magic.length;
  const first = blob[tableStart] | (blob[tableStart + 1] << 8);
  const count = (first - tableStart) / 2;
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(blob[tableStart + i * 2] | (blob[tableStart + i * 2 + 1] << 8));
  let ascending = true;
  for (let i = 1; i < offsets.length; i++) if (offsets[i] <= offsets[i - 1]) ascending = false;
  return {
    kind: 'conversation',
    ...spec,
    blob,
    magicOk: String.fromCharCode(...blob.subarray(0, tableStart)) === magic,
    offsets,
    tableValid: Number.isInteger(count) && count > 0 && ascending && first <= blob.length,
  };
}
