import sys
from capstone import *
DATA=open('/Users/unlink/code/solarwinds/SOLAR1.EXE','rb').read()
DELTA=0xf200   # linear = file + DELTA (verified against name table strings)
def disasm(start, end):
    md=Cs(CS_ARCH_X86, CS_MODE_16)
    code=DATA[start-DELTA:end-DELTA]
    return [f"{ins.address:06x}  {ins.bytes.hex(' '):<20} {ins.mnemonic} {ins.op_str}".rstrip()
            for ins in md.disasm(code, start)]
start=int(sys.argv[1],16)
a2=sys.argv[2] if len(sys.argv)>2 else None
if a2 is None: end=start+0x200
elif a2.startswith('+'): end=start+int(a2[1:],16)
else: end=int(a2,16)
print('\n'.join(disasm(start,end)))
