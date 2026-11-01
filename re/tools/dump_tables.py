#!/usr/bin/env python3
"""Solar Winds data-table inspector.

Structure claims in re/game-data.md are transcribed from SOLAR1.EXE; this tool only
renders the bytes those routines index, so a reader can check the transcription.

    ./dump_tables.py            # per-file size / RLE-decode length / stride census
    ./dump_tables.py mis        # decode BH_MIS.DAT message text
    ./dump_tables.py plan 3     # show BH_PLAN record 3 (stride from re/game-data.md)
"""
import sys, os, re, collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DELTA = 0xf200                      # linear = file offset + DELTA (re/FINDINGS.md)
EXE = os.path.join(ROOT, 'SOLAR1.EXE')

def path(name):
    p = name if name.endswith('.DAT') else 'BH_' + name.upper() + '.DAT'
    return p if os.path.isabs(p) else os.path.join(ROOT, p)

def load(name):
    with open(path(name), 'rb') as f:
        return f.read()

def dat(name):
    """Bytes of the .EXE image, addressed by LINEAR coordinate."""
    with open(EXE, 'rb') as f:
        return f.read()

def rle(buf, rule):
    """Engine RLE: literal byte, else FF n v emits runs.
    rule 'n'   -> n copies, FF 00 v emits 0   (cmp ch,0xff form, e.g. 0x2fb8a)
    rule 'n-1' -> n-1 copies                  (dec ch; cmp ch,0 form, e.g. 0x2978c)
    """
    out = bytearray()
    i = 0
    while i < len(buf):
        b = buf[i]
        if b != 0xFF:
            out.append(b); i += 1
            continue
        if i + 2 >= len(buf):
            break
        n, v = buf[i + 1], buf[i + 2]
        out.extend(bytes([v]) * (n if rule == 'n' else (n - 1) & 0xFF))
        i += 3
    return bytes(out)

def stats(name):
    d = load(name)
    c = collections.Counter(d)
    row = [f"{name:<9} {len(d):>6}"]
    row.append(f"ff={c.get(0xFF,0):>5}")
    row.append(f"zero={c.get(0,0):>5}")
    row.append(f"hi={sum(v for k,v in c.items() if k>=0x80):>5}")
    row.append("decN=" + str(len(rle(d, 'n'))))
    row.append("decN1=" + str(len(rle(d, 'n-1'))))
    divs = [k for k in (2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,40,44,48,50,54,56,60,64,72,80,90,96,100,120,128,144,150,160,180,192,200,216,240,250,256,300,320,360,400,500,512) if len(d) % k == 0]
    row.append("div=" + ",".join(map(str, divs[-6:])))
    return " ".join(row)

def ascii_runs(buf, minlen=4):
    for m in re.finditer(rb'[\t\n -~]{%d,}' % minlen, buf):
        yield m.start(), m.group()

if __name__ == '__main__':
    names = ['PLAN','OBJ','MIS','CHAR','IMP','SHD','SML','VFD','MS','EXPL','PAN','PIC','SEQ','SEQ2']
    if len(sys.argv) > 1 and sys.argv[1] in ('-h','--help'):
        print(__doc__); sys.exit(0)
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        d = load('BH_' + cmd.upper() + '.DAT') if not cmd.upper().endswith('DAT') else load(cmd)
        if cmd == 'mis':
            for off, s in ascii_runs(d, 3):
                print(f"{off:#06x} {s!r}")
        else:
            print(d[:256].hex(' '))
        sys.exit(0)
    for n in names:
        print(stats(n))
