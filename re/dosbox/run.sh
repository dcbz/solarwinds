#!/bin/bash
# run.sh — bounded, non-interactive DOSBox Staging run of the Solar Winds
# distribution in re/dosbox/run/, with optional automatic screenshot + WAV capture.
#
#   usage: re/dosbox/run.sh [options]
#     -t <secs>   wall-clock budget for the whole emulator run (default 30)
#     -s <secs>   seconds after boot at which to fire the screenshot (default 12)
#     -n <count>  number of screenshots, spaced 3 s apart (default 1)
#     -a          also start/stop a WAV recording around the screenshots
#     -x <args>   command-line tail handed to SOLAR1.EXE (e.g. "/NOSB")
#     -e <exe>    executable to run instead of SOLAR1.EXE
#     -r <file>   redirect the program's DOS stdout/stderr into <file> (in C:)
#     -k          do NOT attempt host key injection (log-only run)
#     -q          quiet: don't tee the host log to stdout
#
# Every DOSBox invocation is wrapped in gtimeout.pl, so this script can never
# hang: -t is a hard SIGTERM/SIGKILL deadline.
#
# Writes only under re/dosbox/ (logs/, captures/, run/).

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DOSBOX="/Applications/DOSBox Staging.app/Contents/MacOS/dosbox"
GT="$HERE/gtimeout.pl"
RUNDIR="$HERE/run"
CAPDIR="$HERE/captures"
LOGDIR="$HERE/logs"
STAMP="$(date +%Y%m%d-%H%M%S)"

BUDGET=30
SHOT_AT=12
SHOTS=1
WAV=0
EXE=SOLAR1.EXE
TAIL=""
REDIR=""
KEYINJ=1
QUIET=0

while getopts "t:s:n:ax:e:r:kq" o; do
    case "$o" in
        t) BUDGET=$OPTARG ;;
        s) SHOT_AT=$OPTARG ;;
        n) SHOTS=$OPTARG ;;
        a) WAV=1 ;;
        x) TAIL=$OPTARG ;;
        e) EXE=$OPTARG ;;
        r) REDIR=$OPTARG ;;
        k) KEYINJ=0 ;;
        q) QUIET=1 ;;
        *) exit 2 ;;
    esac
done

raise_dosbox() {
    # Bring the emulator window to the front so injected keystrokes land on it.
    osascript -e 'tell application "System Events"
        repeat with p in (every process whose name contains "dosbox")
            try
                set frontmost of p to true
                perform action "AXRaise" of (window 1 of p)
            end try
        end repeat
    end tell'
}

mkdir -p "$CAPDIR" "$LOGDIR"
BEFORE=$(ls "$CAPDIR" 2>/dev/null | wc -l | tr -d ' ')

LOG="$LOGDIR/run-$STAMP.log"
CMD=("$DOSBOX"
     --working-dir "$HERE"
     --noprimaryconf
     --conf "$HERE/solar.conf"
     --set "mapperfile=$HERE/solar.map"
     --set "automount=off"
     --exit
     -c "MOUNT C $RUNDIR"
     -c "C:"
     -c "$EXE${TAIL:+ $TAIL}${REDIR:+ > $REDIR}")

# Keep the emulator in the foreground of the host so injected keystrokes land on it.
{
    echo "=== run.sh $STAMP ==="
    printf 'cmd: %s\n' "${CMD[*]}"
    echo "budget=${BUDGET}s shot_at=${SHOT_AT}s shots=${SHOTS} wav=${WAV} exe=${EXE} tail=${TAIL} redir=${REDIR}"
} >> "$LOG"

"$GT" "$BUDGET" "${CMD[@]}" >> "$LOG" 2>&1 &
DOSBOX_BG=$!

if [ "$KEYINJ" = 1 ]; then
    sleep "$SHOT_AT"
    raise_dosbox >> "$LOG" 2>&1
    for i in $(seq 1 "$SHOTS"); do
        osascript -e 'tell application "System Events" to key code 97 using control down' >> "$LOG" 2>&1  # Ctrl+F6 (macOS keycode 97 = F6)
        sleep 3
    done
    if [ "$WAV" = 1 ]; then
        osascript -e 'tell application "System Events" to key code 111' >> "$LOG" 2>&1  # F12 = recwave
    fi
fi

wait "$DOSBOX_BG"
RC=$?

AFTER=$(ls "$CAPDIR" 2>/dev/null | wc -l | tr -d ' ')
{
    echo "=== exit ==="
    echo "dosbox rc=$RC"
    echo "captures: $BEFORE -> $AFTER files"
    ls -la "$CAPDIR"
} >> "$LOG"

if [ "$QUIET" = 0 ]; then
    sed -n '1,200p' "$LOG"
fi
echo "log: $LOG"
exit $RC
