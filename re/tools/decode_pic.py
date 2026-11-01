#!/usr/bin/env python3
"""Solar Winds RLE picture decoder (SOLAR1.EXE, sha256 7e7484a4...).
Two token rules observed in the game's own decompress loops (byte streams of
literals and FF <count> <value> runs):
  variant A (0x2a023, map-zone loaders): run length = (count - 1) & 0xff   -> FF 00 v emits 255
  variant B (0x250fe, screen loaders):   run length = count                -> FF 00 v emits 0
Output for a full screen is 64000 bytes (320x200x8bpp) + 1 trailing byte.
Framebuffer destination is A000:0000 (mode 13h), staged through a RAM scratch
page whose segment is stored in the global at data offset 0x6b9f.
"""
import sys, os, struct, zlib

W, H = 320, 200

def decode(data, variant):
    out = bytearray(); i = 0; n = len(data)
    while i < n:
        b = data[i]; i += 1
        if b == 0xFF and i + 2 <= n:
            c, v = data[i], data[i+1]; i += 2
            k = c if variant == 'B' else (c - 1) & 0xFF
            if k: out += bytes([v]) * k
        else:
            out.append(b)
        if len(out) > 4_000_000:
            raise SystemExit("runaway decode (not an RLE picture?)")
    return bytes(out)

def load_palette(path):
    raw = open(path, 'rb').read()[:768]
    pal = []
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i+1], raw[i+2]
        pal += [r*4 if max(raw) <= 63 else r, g*4 if max(raw) <= 63 else g, b*4 if max(raw) <= 63 else b, 255]
    while len(pal) < 1024: pal += [0,0,0,255]
    return bytes(pal[:1024])

def png(idx, pal, path):
    raw = b''.join(b'\x00' + idx[y*W:(y+1)*W] for y in range(H))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', W, H, 8, 3, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
        + chunk(b'PLTE', pal[:768]) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

PALSEL = {'MW1': 'BH_MP1.DAT', 'MW2': 'BH_MP2.DAT', 'MW3': 'BH_MP3.DAT'}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    variant = 'B' if '--B' in sys.argv else 'A'
    outdir = 're/work/pics'
    os.makedirs(outdir, exist_ok=True)
    for f in args:
        d = open(f, 'rb').read()
        img = decode(d, variant)
        key = os.path.basename(f)[3:6].upper()
        pal = load_palette(PALSEL.get(key, 'BH_PAL.DAT'))
        frames = len(img) // 64000
        print(f"{os.path.basename(f)}: {len(d)} -> {len(img)} bytes, variant {variant}, "
              f"{frames} full frame(s), tail {len(img) % 64000}")
        for k in range(max(1, frames)):
            px = img[k*64000:(k+1)*64000].ljust(64000, b'\0')
            p = f"{outdir}/{os.path.basename(f)[:-4]}_{variant}_{k:02d}.png"
            png(px, pal, p); print("   ", p)
main()
