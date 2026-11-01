import sys, re, os
DATA=open('/Users/unlink/code/solarwinds/SOLAR1.EXE','rb').read()
DELTA=0xf200
# function ranges from procedures.txt (start addresses, sorted); end = next start
starts=[]
for line in open('/Users/unlink/code/solarwinds/re/procedures.txt'):
    m=re.match(r'0x([0-9a-f]+)\s+(\S+)', line)
    if m: starts.append((int(m.group(1),16), m.group(2)))
starts.sort()
def owner(lin):
    best=None
    for s,n in starts:
        if s<=lin: best=(s,n)
        else: break
    return best
pat=sys.argv[1]
regex=bytes.fromhex(pat.replace(' ','').replace('??','')) if '??' not in pat else None
raw=sys.argv[1]
# support hex pattern with ?? wildcards
tokens=raw.split()
if all(re.fullmatch(r'([0-9a-f]{2}|\?\?)',t) for t in tokens):
    for m in re.finditer(re.escape(b''), b''): pass
    for m in re.finditer(b''.join(b'.' if t=='??' else re.escape(bytes.fromhex(t)) for t in tokens), DATA):
        lin=m.start()+DELTA
        o=owner(lin)
        print(f"file {m.start():08x} linear {lin:08x} bytes {m.group().hex(' ')} in {o[1] if o else '?'} @ {hex(o[0]) if o else '?'}")
else:
    print('pattern must be hex bytes', file=sys.stderr)
