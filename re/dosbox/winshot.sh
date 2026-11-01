#!/bin/bash
# Ground-truth screenshots without keyboard injection: grab the DOSBox Cocoa window by
# CGWindowID from the host, at timed offsets. usage: winshot.sh <budget> <t1> [t2 ...]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DOSBOX="/Applications/DOSBox Staging.app/Contents/MacOS/dosbox"
CAPDIR="$HERE/captures"; mkdir -p "$CAPDIR" "$HERE/logs"
BUDGET=$1; shift
"$HERE/gtimeout.pl" "$BUDGET" "$DOSBOX" --working-dir "$HERE" --noprimaryconf \
  --conf "$HERE/solar.conf" --set "mapperfile=$HERE/solar.map" --set "automount=off" --exit \
  -c "MOUNT C $HERE/run" -c "C:" -c "SOLAR1.EXE" > "$CAPDIR/../logs/winshot-$(date +%H%M%S).log" 2>&1 &
BG=$!
for t in "$@"; do
  sleep "$t"
  WID=$(osascript -e 'tell application "System Events"
      repeat with p in (every process whose name contains "dosbox")
          try
              set frontmost of p to true
              perform action "AXRaise" of (window 1 of p)
              return id of window 1 of p
          end try
      end repeat
      return ""' 2>/dev/null | tr -d '[:space:]')
  if [ -n "${WID:-}" ]; then
    screencapture -x -o -l"$WID" "$CAPDIR/host_$t.png" 2>/dev/null && echo "shot @$t win=$WID"
  else
    echo "shot @$t no-window"
  fi
done
wait $BG 2>/dev/null
ls -la "$CAPDIR"/host_*.png 2>/dev/null
