# Lane briefs — "make the engine actually run"

Shared conventions for every lane in this round. Read your own §, plus §0.

## §0 — Ground rules (all lanes)

**Target.** `/Users/unlink/code/solarwinds/SOLAR1.EXE`, sha256
`7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.
Addresses are **linear**: `file_offset = linear - 0xf200`. Far calls `lcall 0x131e,OFF` →
`linear = 0x231e0 + OFF`. Data segment: `linear = 0x10000 + DSoffset`, and the save blob images
`DS:0x00AD..0x4653` (`blob_offset = DSoffset - 0x00AD`) from `web/data/BH_START.DAT`.

**Evidence, in the order that actually works here.**
1. `re/decomp/SOLAR1.c` — Ghidra pseudocode for all 179 procedures, one proc per
   `// ==== FUN_x @ 0xLINEAR (n chars)` header. `grep -n` it. This is the fastest path.
2. Local disassembly of the shipped bytes (capstone 5.0.7 is installed):
   ```python
   import capstone
   data = open('/Users/unlink/code/solarwinds/SOLAR1.EXE','rb').read()
   BASE = 0xf200            # linear = file + BASE
   md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16)
   md.detail = True
   for i in md.disasm(data[lo-BASE:hi-BASE], lo):
       print(f'@0x{i.address:x}  {i.bytes.hex():<20} {i.mnemonic} {i.op_str}')
   ```
   Use this for every branch decision — pseudocode alone has flattened too much of the 16-bit code.
3. `mcp__rea__*` (Ghidra 12.1.4) if reachable: `open_binary` then
   `procedure_pseudo_code`/`procedure_references`/`trace_native_values`. **Optional.** If it errors
   or is slow, do not fight it — §0.1/§0.2 are sufficient. `search_bytes`/`procedure_assembly`
   return 5-25k tokens; avoid them.
4. `re/*.md` — read the relevant doc before writing so you extend rather than repeat.

**The one rule that matters: no invented mechanics.** Every line ofported behaviour must carry an
address comment. Where the game is genuinely unknown, write
`TODO_<SHORT_NAME>@<addr>: <what is unknown and what you would try next>` in the code and add a
bullet in your notes file. A TODO that names the exact unknown is worth more than a plausible guess.
Do not add fallback behaviour "so it works" — that is how this port got derailed once already.

**Timebox.** ~35 minutes of wall clock, then ship what you have. If a sub-question stalls for more
than ~5 minutes, leave a precise TODO and move to the next piece of your lane. Coverage with honest
TODOs beats a polished stub.

**File ownership — hard.** You may create/edit ONLY the files your § names.
Do **not** touch `web/src/engine/loop.ts`, `web/src/main.ts`, `web/src/engine/screens.ts`,
`web/README.md`, `re/HANDOFF.md`, `re/game-loop-modes.md`, `re/event-codes.md`,
`re/LANE-BRIEFS.md`, or another lane's files. Integration into the shared engine is my job, and I
am the only writer for those files. If your port needs a change in a shared file, put the exact
required change in your notes file under `## Wiring needed` instead of making it.

**Code style.** Mirror `web/src/engine/pages.ts`: a header comment carrying the disassembly you
relied on, an exported constants table where every field cites its address, and pure functions that
take explicit state. ES2022 modules, `import ... from './x.ts'` (the `.ts` extension is required —
`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`), strict TypeScript, no bundler, no
new dependencies, no `any` unless the alternative is a lie about a 16-bit segment.

**Verify before you finish.**
```
cd /Users/unlink/code/solarwinds/web && ./node_modules/.bin/tsc --noEmit   # must be clean
node /Users/unlink/code/solarwinds/web/tools/integration_check.mjs | tail -1  # must stay 41/41
```
If you add a tool, make it print `ok`/`FAIL` lines like `web/tools/panshot.mjs` does, and prove your
claim with a real artefact (a PNG, a byte comparison, a hash) rather than prose.

**Return.** A ≤40-line summary: what you ported with addresses, what the new evidence says the game
does, every `TODO_*` you opened, and the `## Wiring needed` list verbatim.

---

## §A — The script engine: the `c` and `s` modal loops

**Why this lane matters most.** The user's complaint is "it's still just boot art and a menu". The
reason is structural: `c` (make 0x2e → `FUN_231e_a26d` @0x2d44d) and `s` (make 0x1f →
`FUN_231e_a01c` @0x2d1fc) are **modal subroutines with their own event loops** — they read keys
themselves (`int 16h` is reachable at @0x2d60b and @0x2ddba) and they drive the map loaders
(`FUN_231e_6db0` @0x29f90, `FUN_231e_7182` @0x2a362, `FUN_231e_75a6` @0x2a786 are called from inside
`FUN_231e_a26d`, gated on an event code 4 / 0xb / counter `DS:0xbaf4`/`DS:0xbaf5`). The game's spine
is in those two functions. Nothing else you can port this round unlocks as much.

**Deliverables**
- `web/src/engine/script.ts` — the script-table walk, the two `$`-delimited record tables, the
  `0x500` selector, and the opcode dispatch, expressed against a small `ScriptHooks` interface
  (`loadZone(n)`, `showText(...)`, `readKey()`, `spawnEntity(...)`, …) that `loop.ts` can implement
  later. Include the modal event loop's exit conditions.
- `re/script-engine.md` — the disassembly you based it on, per address.

**Questions to answer with evidence**
1. `DS:0x3bf3` = script-entry count, `DS:0x3bf5` = table of entry pointers. Who writes them, and
   which resource file? (Candidates: `BH_CONV.DAT` — @0x2d44d is the only reference to it per
   `re/loader_map.md` — and `BH_OBJ`, `BH_SCRN`, `BH_VFD`.) Confirm the writer's address.
2. Entry fields: `[bx+0xb]`/`[bx+0xc]` are read as one 16-bit value and compared with `0x500`, which
   selects between a `0x17`-stride record table at `0x128f` and a `0x1c`-stride table at `0x1e5b`,
   both walking with `while (*p != '$') p++` to find record *n*. What are those two tables —
   where in the loaded image do `0x128f` and `0x1e5b` live (segment? file?), and what is a record?
   Dump their bytes.
3. What is the `uVar8` opcode set (0x1, 0x4, 0x9, 0xa, 0xb, 0xf, 0x10 are visible in the pseudocode)
   and what does each do? Which of them is the one that actually paints a map?
4. `in_stack_00000000 != 0xd` — the far-return argument at @0x2d44d takes a parameter from the
   caller. Trace what `lcall 0x131e,0xa26d` pushes.
5. `FUN_231e_a01c` (the `s` arm): same treatment, even if it turns out to be a thin variant.

---

## §B — Zone loaders and the star map

`FUN_231e_6db0` @0x29f90 (zone 1: `BH_MP1` palette + `BH_MW1A` + `BH_MW1B`),
`FUN_231e_7182` @0x2a362 (zone 2: `BH_MP2` + `MW2A` + `MW2B` + `MW2P`),
`FUN_231e_75a6` @0x2a786 (zone 3: `BH_MP3` + `MW3A` + `MW3B`).

**Known already** (`re/formats-maps.md`, `re/FINDINGS.md`): MW1A/MW1B/MW2A/MW2B/TITLE/EPIC/SEQ/ORD/WR
each decode to **exactly 64,001** bytes with the `n-1` rule and are full 320×200 frames; MW1A and
MW1B are **two frames of one animation** written to the same address in sequence; MW2P (15,613),
MW3A (41,903 / 38,979) and MW3B do NOT reach a frame under either rule and are walked by **seek** as
multi-record containers. Per-zone palettes ⇒ the renderer must swap palettes per zone.

**Deliverables**
- `web/src/engine/zones.ts` — port the three loaders: which file goes where, the palette swap, the
  two-frame alternation, and whatever entity/star overlay they draw (there is an `0x80 fd 00` marker
  and `ch==0` test at @0x2a023/@0x2a146 — explain what it selects).
- `web/tools/zoneshot.mjs` — render zone 1 frame 1 and frame 2 (and zone 2/3 if you get there) to
  `web/tools/out/ZONE*_*.png` and assert the two frames differ where the animation says they should.
- `re/zones.md` — evidence, plus the solved framing for MW2P/MW3A/MW3B.

**Questions**
1. Crack the seek-walk record framing for MW3A/MW3B/MW2P for real. `0x2a84c` proves records exist;
   find the actual seek arithmetic (`lseek` ah=42h calls, the base/origin argument, the length
   fields) and reproduce a full decode. This closes Known-open item 3 in `web/README.md`.
2. Do the zones draw **the player's position / stars / ships** over the art, or is that elsewhere?
   Name the buffer and its writer.
3. Which mode byte is active while a zone map is on screen, and how do you get back?

---

## §C — The frame clock

Every animated thing in this game waits on the pump, and the port currently advances exactly one
frame per keypress. Cite-driven target: the main loop @0x23c1f and its timing tail, the tick routine
around @0x23e9e (`DS:0x13c16` / `DS:0x13c18` countdowns, the `mode == 1` sound re-init @0x23eb9,
the PIT/`int 1ch` or `int 8`/timer-tick source), the speaker gate, and the `0x2a04d`/`0x2a175`
frame-alternation loop that flips MW1A↔MW1B.

**Deliverables**
- `web/src/engine/clock.ts` — a faithful `tick()` with the real cadence (find the reload constant
  and say where it comes from: 18.2 Hz BIOS tick? PIT ch0? a counted loop?), the timer decrements,
  and what each timer's expiry triggers, with addresses.
- `re/frame-clock.md` — how the original paces itself, per address, and the exact mapping to
  `requestAnimationFrame` for the port (what runs per rAF, what per tick, what per N ticks).
- Close `TODO_TIMERS@0x23e9e` as far as the bytes allow.

**Questions**
1. Where does the tick counter come from — `int 1ch` handler installed by the game, or a polled
  BIOS timer at `0040:006C`? Cite it.
2. What is actually gated by `DS:0x13c16`/`DS:0x13c18`? Anything visible?
3. Is the loop's "one pass" bounded by the keyboard (`int 16h ah=1` poll) or by a wait-for-tick?

---

## §D — Menu, new game, and modes 0 and 5

The port reaches a state where the only way to see art is a mode number typed by a key handler.
In the real game the player starts from a menu. `Escape`/`F1` in state 1 go to `lcall
0x131e,0x99c2` → @0x2cba2, which per `re/loader_map.md` touches `BH_ORD`, `BH_SCRN`, `BH_START`, and
`main.ts`'s own note says `@0x2cbae` writes mode 1. Separately `re/game-loop-modes.md` mentions
"modes 0 and 5 where no handler runs" — the dispatch chain's full form is worth closing.

**Deliverables**
- `web/src/engine/menu.ts` — the menu: items, how a selection is read, what "new game" / "load" /
  "quit" actually do (which loaders, which mode byte, which `int 21h`), and how it draws.
- `re/menu-start.md` — evidence, including a definitive list of every mode value the dispatch chain
  can take and which handler owns each (states 0..5), with addresses.

**Questions**
1. What is mode 0 and mode 5? Both are named in the docs but never characterised. If a handler
   exists, port its arm table; if not, say what makes them different (the sound gate? a splash?).
2. Trace `BH_START.DAT`'s actual write path (the docs say the blob round-trips as an image of DS —
   prove which routine reads/writes it and when, i.e. is `BH_START` the *new game* state or a
   *saved game*?).
3. How does the title screen hand control to state 1 — which code decides, and on what input?
4. Does `BH_IORD.DAT` / `BH_ORD.DAT` (orders/briefing) play at startup? The intro sequence is the
   first thing a player sees; describe the real boot → play sequence.

---

## §E — Text, glyphs and the display

The panels composite now but carry **no lettering**, and the whole UI is text. Start here:
`BH_CHAR.DAT` is 14,232 bytes and is loaded by `FUN_231e_0677` @0x23857 together with `BH_PAL` (per
`re/loader_map.md`, "boot/character screen"). `BH_VFD.DAT` is 15,257 bytes and is dispatcher slot 10
with `readBytes: 0xffff, kind: 'table'` in `web/src/engine/screens.ts`. `BH_SCRN.DAT` is exactly
4,000 bytes. `re/FINDINGS.md` already noticed that the game XOR-swaps pixel pairs at @0x2a06f.
The VM opcodes at `0x251e0..0x2539f` are undecoded and are the likely text path.

**Deliverables**
- `web/src/engine/text.ts` — glyph decode + a `drawText(fb, x, y, str)` that writes real pixels into
  the 320×200 indexed framebuffer, with the cell size, stride and table base each cited.
- `web/tools/charshot.mjs` — render the whole glyph table to `web/tools/out/CHAR_atlas.png` and, if
  you can locate a string in the data (an `$`-delimited or ASCIIZ run in BH_CONV / BH_VFD / the EXE's
  own resources), render a sentence with `drawText` to `web/tools/out/CHAR_text.png`. A readable
  atlas is the proof this lane needs.
- `re/text-display.md` — evidence for the format, plus whatever BH_VFD and BH_SCRN turn out to be.

**Questions**
1. `14232 = ?` — factor it against plausible glyph geometries (8×8, 8×14, 8×16, 9×16, plane-4
   interleaved). Then **test** the hypothesis by rendering; do not settle for arithmetic.
2. Are glyphs 1-bit, 2-bit, or pre-tinted indexed bytes? Is there a foreground/background colour
   register, and which global holds it?
3. BH_VFD: 15,257 bytes read as a table. Is it the status display's text/labels, or 8×8 art?
   Same for BH_SCRN (4,000 = 250 × 16?).
4. Which opcode draws text into VRAM, and does it route through the `0x2b04d` compositor or write
   `A000:` directly?
