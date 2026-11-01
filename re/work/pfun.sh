#!/bin/bash
# Extract a function body from the decompiled corpus by name or address.
# usage: pfun.sh FUN_231e_1e14   |   pfun.sh 0x24ff4
C=/Users/unlink/code/solarwinds/re/decomp/SOLAR1.c
Q="$1"
if [[ "$Q" == 0x* ]]; then
  line=$(grep -n "^// ==== .* @ $Q " "$C" | head -1 | cut -d: -f1)
else
  line=$(grep -n "^// ==== $Q " "$C" | head -1 | cut -d: -f1)
fi
if [ -z "$line" ]; then echo "NOT FOUND: $Q"; exit 1; fi
start=$((line+1))
next=$(awk -v s="$start" 'NR>s && /^\/\/ ==== /{print NR; exit}' "$C")
if [ -z "$next" ]; then next=$(wc -l < "$C"); fi
end=$((next-1))
sed -n "${start},${end}p" "$C"
