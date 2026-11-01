#!/bin/bash
# rawshot.sh — drive the real game under DOSBox Staging and capture its actual VRAM.
#
# Screenshot path: F7 is bound to hand_rawshot in solar.map, which writes a *raw* 320x200 PNG of
# the emulated framebuffer (no window scaling, no CRT shader) into captures/. That is the exact
# artifact to diff web/ against — the earlier Ctrl+F6/scrshot route only ever produced upscaled
# window grabs, and the host-region grab in winshot.sh clipped against the screen edge.
#
# usage: rawshot.sh <tag> <budget> ["<seconds>:<keys>"] ...
#   keys is a space-separated list passed to send_keys: ENTER, N, UP, DOWN, LEFT, RIGHT, SP, ESC, F1,
#   or any literal character to type. Each entry is followed by a 0.4 s settle; <seconds> is the
#   absolute time in the run at which the shot fires (after those keys are sent).
#
# Example: rawshot.sh flight 30 5: 12:ENTER 18:N 24:UP SP UP
#
# Writes captures/<tag>/shotNN-raw.png and renames each to <tag>_<offset>.png on success.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DOSBOX="/Applications/DOSBox Staging.app/Contents/MacOS/dosbox"
TAG=$1; BUDGET=$2; shift 2
OUT="$HERE/captures/$TAG"; mkdir -p "$OUT" "$HERE/logs"
LOG="$HERE/logs/$TAG-$(date +%H%M%S).log"
BEFORE=$(ls "$HERE"/captures/image*-raw.png 2>/dev/null | wc -l | tr -d ' ')

"$HERE/gtimeout.pl" "$BUDGET" "$DOSBOX" --working-dir "$HERE" --noprimaryconf \
  --conf "$HERE/solar.conf" --set "mapperfile=$HERE/solar.map" --set "automount=off" \
  --exit -c "MOUNT C $HERE/run" -c "C:" -c "SOLAR1.EXE" > "$LOG" 2>&1 &
BG=$!

focus() {
  osascript -e 'tell application "System Events"
    try
      set p to first process whose name is "dosbox"
      set frontmost of p to true
      delay 0.25
    end try
  end tell' >/dev/null 2>&1
}
send_keys() {
  local spec="$1"
  for k in $spec; do
    case "$k" in
      ENTER) osascript -e 'tell application "System Events" to key code 36' >/dev/null 2>&1 ;;
      SP)    osascript -e 'tell application "System Events" to key code 49' >/dev/null 2>&1 ;;
      ESC)   osascript -e 'tell application "System Events" to key code 53' >/dev/null 2>&1 ;;
      LEFT)  osascript -e 'tell application "System Events" to key code 123' >/dev/null 2>&1 ;;
      RIGHT) osascript -e 'tell application "System Events" to key code 124' >/dev/null 2>&1 ;;
      DOWN)  osascript -e 'tell application "System Events" to key code 125' >/dev/null 2>&1 ;;
      UP)    osascript -e 'tell application "System Events" to key code 126' >/dev/null 2>&1 ;;
      F1)    osascript -e 'tell application "System Events" to key code 122' >/dev/null 2>&1 ;;
      *)     osascript -e "tell application \"System Events\" to keystroke \"$k\"" >/dev/null 2>&1 ;;
    esac
    sleep 0.4
  done
}

t=0; n=0
for step in "$@"; do
  at=${step%%:*}; keys=${step#*:}; [ "$keys" = "$step" ] && keys=""
  sleep $(( at - t )); t=$at
  focus
  send_keys "$keys"
  before_i=$(ls "$HERE"/captures/image*-raw.png 2>/dev/null | wc -l | tr -d ' ')
  osascript -e 'tell application "System Events" to key code 98' >/dev/null 2>&1   # F7 -> rawshot
  sleep 1.2
  newest=$(ls -t "$HERE"/captures/image*-raw.png 2>/dev/null | head -1)
  n=$((n + 1))
  if [ -n "$newest" ] && [ ! -f "$OUT/$(printf '%02d' $n)_${at}s.png" ]; then
    cp "$newest" "$OUT/$(printf '%02d' $n)_${at}s.png"
    echo "shot $n @${t}s -> $(basename "$OUT")/$(printf '%02d' $n)_${t}s.png"
  else
    echo "shot $n @${t}s FAILED (no new rawshot)"
  fi
done
wait $BG 2>/dev/null
echo "log: $LOG"
