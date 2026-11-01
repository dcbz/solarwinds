#!/bin/sh
# Regenerate the reverse-engineering evidence this repo's citations point into.
#
# re/*.md quote addresses in SOLAR1.EXE (sha256 7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df).
# Two kinds of artifact back those quotes; only the first is produced here.
#
# 1. Locally reproducible (this script): capstone disassembly of a byte range, linear = file + 0xF200.
#      python3 re/work/x86.py 0x2b223 0x2b3c8      # the bar renderer, quoted in re/FINDINGS.md
#      python3 re/work/x86.py 0x2c646 0x2c6d2       # FUN_231e_9466's power gates
#      python3 re/work/bytesearch.py "8a a7 5e 5e"  # every read of a DS address, owner-attributed
#    Needs pyenv-capable Python with capstone; /usr/bin/python3 on this host has it.
#
# 2. Ghidra, through the REA CLI (pinned at 6.7.0). Not run here because it needs a JDK and ~2 GB of
#    headless Ghidra; re/decomp/SOLAR1.c is the whole 179-procedure pseudocode corpus and re/procedures.txt
#    is its index. To rebuild it, open the binary once and batch-decompile every procedure into
#    re/decomp/SOLAR1.c with a `==== FUN_<name> @ <addr>` header per procedure, e.g.
#      open_binary  -> SOLAR1.EXE (dos-mz, x86 LE 16-bit Real Mode, MzLoader, load seg 0x1000)
#      binary_overview -> procedures
#      batch_decompile -> re/decomp/SOLAR1.c
#    with the environment re/work/rea.sh already sets:
export GHIDRA_INSTALL_DIR="${GHIDRA_INSTALL_DIR:-/Users/unlink/tools/ghidra_12.1.4_PUBLIC}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
mkdir -p re/decomp re/work
printf 'GHIDRA_INSTALL_DIR=%s\nJAVA_HOME=%s\n' "$GHIDRA_INSTALL_DIR" "$JAVA_HOME"
command -v java >/dev/null || echo 'note: /usr/bin/java may be a stub; Ghidra needs a full JDK'
if command -v python3 >/dev/null && python3 -c 'import capstone' 2>/dev/null; then
  for a in 0x24ff4 0x2566f 0x2581a 0x268e8 0x29f90 0x2a2a5 0x2aef0 0x2af72 0x2b223 0x2c307 0x2c5d9 0x2c646 0x2d44d; do
    python3 re/work/x86.py "$a" > "re/work/f_${a#0x}.asm" || exit 1
  done
  echo "wrote $(ls re/work/f_*.asm | wc -l | tr -d ' ') disassembly dumps into re/work/"
else
  echo 'skipping disassembly: python3 lacks capstone (try /usr/bin/python3)'
fi
