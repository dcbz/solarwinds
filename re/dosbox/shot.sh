#!/bin/bash
# Ground-truth capture: DOSBox window forced to 320x200 points (=> 640x400 px on this Retina
# display), grabbed by screen region from the host. No DOSBox capture keybindings involved.
# usage: shot.sh <tag> <budget> <key-injection times...>
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DOSBOX="/Applications/DOSBox Staging.app/Contents/MacOS/dosbox"
TAG=$1; BUDGET=$2; shift 2
OUT="$HERE/captures/$TAG"; mkdir -p "$OUT"
FIRST=1
"$HERE/gtimeout.pl" "$BUDGET" "$DOSBOX" --working-dir "$HERE" --noprimaryconf \
  --conf "$HERE/solar.conf" --set "mapperfile=$HERE/solar.map" --set "automount=off" \
  --set "window_size=320x200" --set "startup_verbosity=quiet" --exit \
  -c "MOUNT C $HERE/run" -c "C:" -c "SOLAR1.EXE" > "$OUT/../$TAG.log" 2>&1 &
BG=$!
t=0
for dt in "$@"; do
  sleep "$(( dt - t ))"; t=$dt
  if [ "$FIRST" = 0 ]; then
    osascript -e 'tell application "System Events"
        try
          set p to first process whose name is "dosbox"
          set frontmost of p to true
          repeat with k in {"return", "return"}
            keystroke k
            delay 0.2
          end repeat
        end try
      end tell' >/dev/null 2>&1
  fi
  FIRST=0
  RECT=$(osascript -e 'tell application "System Events"
      try
        set p to first process whose name is "dosbox"
        set frontmost of p to true
        perform action "AXRaise" of (window 1 of p)
        set pos to position of window 1 of p
        set sz to size of window 1 of p
        return (item 1 of pos as string) & "," & (item 2 of pos as string) & "," & (item 1 of sz as string) & "," & (item 2 of sz as string)
      end try
      return ""' 2>/dev/null | tr -d '[:space:]')
  if [ -n "${RECT:-}" ]; then
    screencapture -x -o -R"$RECT" "$OUT/raw_$t.png" && echo "t=$t rect=$RECT -> raw_$t.png"
  else
    echo "t=$t no dosbox window"
  fi
done
wait $BG 2>/dev/null
