# README-dosbox — runtime harness status (live document, updated as I go)

Task: does `SOLAR1.EXE` boot and run standalone under **DOSBox Staging**, with artifacts?

Newest section first. This file is append-as-you-go per the 30-minute cap rule.

## VERDICT (as of the last run) — YES, it boots and runs standalone

Runtime evidence from `re/dosbox/logs/run-20261029-211717.log`, a 20 s unattended run:

```
DISPLAY: VGA 720x400 16-colour text mode 03h ...      <- DOS banner
DISPLAY: VGA 320x200 256-colour graphics mode 13h at 70.086 Hz   <- +0.5 s after boot
DISPLAY: VGA 320x200 256-colour graphics mode 13h ...            <- keeps presenting
[gtimeout] 20s limit reached; terminated child 42019             <- game still alive/running
```

* The executable was launched with **no command-line parameters at all** (`-c SOLAR1.EXE`).
* It switched the video mode from text 3h to **graphics 13h (320x200x8bpp) on its own within
  ~0.5 s** and was still running when the wall-clock budget killed it — so no BBS-door
  parameters, and no `/NOSB`, are required to start. (Independent of the static evidence:
  `HELPME.DOC` "HOW TO START: just type SOLAR1 from the DOS prompt", and `0x23857` only
  *optionally* scans the command tail for `/NOSB` and a BBS `I` switch.)
* Window title as seen by the macOS accessibility API: `SOLAR1.EXE - 3000 cycles/ms`.

Outstanding item: a PNG in `re/dosbox/captures/` (see "Screenshot triggering" below).

## Environment facts established

- Real executable: `/Applications/DOSBox Staging.app/Contents/MacOS/dosbox` (single Mach-O,
  55,837,632 B; sibling `lib/` holds bundled dylibs). The file is literally named `dosbox`.
- `dosbox -version` → `dosbox-staging, version 0.83.0 (7b400)`.
- **It launches fine from a non-interactive bash shell** — no `open`, no login session tricks.
  It creates a real Cocoa window ("SDL: cocoa video initialised", "DISPLAY: Using 960x600
  window size in windowed mode on display-0"), and `osascript`/System Events can see and raise
  that window. So neither the emulator nor the host GUI session is a blocker.
- No `timeout`/`gtimeout` on this host → wrote `re/dosbox/gtimeout.pl`; every command in this
  lane is wrapped in it.
- `re/dosbox/run.sh` is the one-shot re-run wrapper (bounded by `-t`).
- Prior lane's assets kept and reused: `solar.conf`, `solar.map`, full distribution copy in
  `re/dosbox/run/`. `re/dosbox/captures/` was empty when I started.

## Two harness bugs found in the prior lane's setup (both fixed/being fixed here)

1. `--conf re/dosbox/solar.conf` combined with `--working-dir re/dosbox` silently failed:
   `CONFIG: Can't open custom config file 're/dosbox/solar.conf'` — DOSBox resolves relative
   `--conf` paths *after* chdir'ing to the working dir. Fix: pass **absolute** paths (run.sh does).
2. `--set dosbox.automount=off` is wrong syntax: `--set` takes a bare property name
   (`CONFIG: No config section or setting exists with the name 'dosbox.automount'`). Fix:
   `--set automount=off`.
3. Under a *correctly loaded* solar.conf the log shows `RENDER: Using shader 'interpolation/bilinear'`
   even though the conf asks for `shader = none`: `shader=none` is not what disables the CRT
   look here — `crt-auto`/`shader_preset` interaction. Only matters for `rendered` captures;
   `raw` captures are the unmodified framebuffer, which is what the RE lanes need.

## Screenshot triggering (in progress)

- `CTRL+F6` is the Staging default for the `hand_scrshot` mapper action.
- First attempt: run.sh ran the game and injected `Ctrl+F6` via
  `osascript -e 'tell application "System Events" to key code 97 using control down'`
  (macOS virtual keycode 97 == F6) after raising the window. **No file appeared in
  `re/dosbox/captures/` and the host log contains no `CAPTURE:` line for it.**
  Suspected cause: `solar.map` contains only 2 binding lines and DOSBox logged
  `MAPPER: Loaded 2 key bindings from '.../solar.map'` *without* the usual
  `MAPPER: Loaded default key bindings` — i.e. a custom mapper file may suppress the
  defaults, so Ctrl+F6 was unbound in that run.
- Next experiment (same run, three hypotheses): bind `hand_scrshot` to `key 63 mod1`
  (Ctrl+F6, explicit), `hand_scrshot_raw` to a plain F8, and use `mod2` = Alt variants, then
  inject all of them and see which lands. Modifier encoding decoded from the bundled
  `Resources/mapperfiles/xbox/*.map`: `mod1`=Ctrl, `mod2`=Alt, `mod3`=Shift
  (`hand_fullscr "key 40 mod2"` = Alt+Enter, `hand_mapper "key 58 mod1"` = Ctrl+F1).

## What I tried (append-only log)

1. `dosbox -version`, `-help`, `--printconf` — CLI works under timeout guard; no `--headless` flag.
2. Smoke run (`logs/smoke1.log`): DOS boots, `MOUNT` + stdout redirection verified by writing
   `run/TESTDIR.TXT` from the guest and reading it on the host (3864 B, `dir` listing of the
   distribution). This proves guest→host file I/O works, so a `> CONOUT.TXT` capture of the
   game's DOS-level output is a valid channel for the "refusal text" question.
3. Game run `logs/run-20261029-211717.log` — verdict evidence above.

## Re-run command

```sh
perl re/dosbox/gtimeout.pl 30 re/dosbox/run.sh -t 25 -s 8 -n 1
```
