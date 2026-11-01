// Numeric eye for a model that cannot see images: decodes a PNG without dependencies and reports
// what is actually in it (colour count, coverage, per-row occupancy, vertical profile).
// Usage: node web/tools/pngstats.mjs web/tools/out/*.png
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decode(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  let at = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let plte = null;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`${path}: unsupported depth ${depth}/interlace ${interlace}`);
  const channels = colorType === 3 ? 3 : colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : -1;
  if (channels < 0) throw new Error(`${path}: unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${path}: bad filter ${filter} on row ${y}`);
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, channels, colorType, plte, pixels: out };
}

for (const path of process.argv.slice(2)) {
  try {
    const img = decode(path);
    const { width, height, channels, colorType, plte, pixels } = img;
  const indexed = colorType === 3;
  if (indexed && !plte) throw new Error(`${path}: indexed PNG without PLTE`);
  const rgb = (x, y) => {
    if (indexed) {
      const j = pixels[y * width + x] * 3;
      return [plte[j], plte[j + 1], plte[j + 2]];
    }
    const i = (y * width + x) * channels;
    return [pixels[i], pixels[i + (channels >= 3 ? 1 : 0)], pixels[i + (channels >= 3 ? 2 : 0)]];
  };
    const colors = new Set();
    let nonBlack = 0;
    const rowOccupancy = [];
    const band = 10;
    const bandRows = new Array(Math.ceil(height / band)).fill(0);
    for (let y = 0; y < height; y++) {
      let inRow = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        const [r, g, b] = rgb(x, y);
        colors.add(((r << 16) | (g << 8) | b) >>> 0);
        if (r || g || b) { inRow++; nonBlack++; }
      }
      rowOccupancy.push(inRow / width);
      bandRows[Math.floor(y / band)] += inRow;
    }
    const profile = bandRows.map((v, i) => `${i * band}-${Math.min(height, (i + 1) * band) - 1}:${Math.round(100 * v / (band * width))}%`).join(' ');
    const emptyTop = rowOccupancy.findIndex((v) => v > 0.02);
    const emptyBottomFrom = (() => {
      for (let y = height - 1; y >= 0; y--) if (rowOccupancy[y] > 0.02) return y + 1;
      return 0;
    })();
    console.log(`${path.split('/').pop()}: ${width}x${height} colors=${colors.size} coverage=${(100 * nonBlack / (width * height)).toFixed(1)}% firstContentRow=${emptyTop} lastContentRow=${emptyBottomFrom - 1}`);
    console.log(`  ${profile}`);
  } catch (err) {
    console.log(`${path}: ERROR ${err.message}`);
  }
}
