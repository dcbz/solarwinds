import re, sys, json
path='re/decomp/SOLAR1.c'
lines=open(path, encoding='utf-8', errors='replace').read().split('\n')
hdr=re.compile(r'^// ==== (\S+) @ (0x[0-9a-f]+)')
starts=[]
for i,l in enumerate(lines):
    m=hdr.match(l)
    if m: starts.append((i+1,m.group(1),int(m.group(2),16)))
def func_of(line):
    best=None
    for s in starts:
        if s[0]<=line: best=s
        else: break
    return best
if __name__=='__main__':
    pat=sys.argv[1]
    ctx=int(sys.argv[2]) if len(sys.argv)>2 else 0
    for i,l in enumerate(lines):
        if re.search(pat,l):
            f=func_of(i+1)
            print(f"--- line {i+1} in {f[1]} @ {hex(f[2]) if f else '?'}")
            for j in range(max(0,i-ctx), min(len(lines), i+ctx+1)):
                print(f"  {j+1}: {lines[j]}")
