# TODO fan-out contract (2026-10-31)

92 textual TODO mentions in `web/src`, ~46 distinct questions. This page is the **lane
assignment**; it is the only shared file, and lanes never write it — I do.

## Hard rules for every lane

1. **Write only your own file**, `re/td/<lane>.md`, plus optional helpers
   `re/td/<lane>_*.mjs` and images `re/td/<lane>_*.png`. Touching `web/src/**`, `re/FINDINGS.md`,
   `re/HANDOFF.md` or another lane's file is forbidden — code edits happen centrally, from your
   evidence. (Two prior waves lost work to concurrent full-page rewrites.)
2. **Persist as you go.** Create your file within your first three tool calls containing the plan
   and everything already known, then append after each finding. A timed-out lane must still leave
   a useful document.
3. **Evidence order.** Grep `re/decomp/SOLAR1.c` (all 179 procedures, flat pseudocode) and the
   disassembly already on disk in `re/work/*.asm` before spending anything. `re/loader_map.md`,
   `re/game-loop-modes.md`, `re/state-format.md`, `re/event-codes.md`, `re/script-vm.md` are prior
   answers — read them first, do not redo them.
4. **Citable Evidence only via the pinned CLI** (the MCP tools are not registered in a child
   shell):
   `GHIDRA_INSTALL_DIR=/Users/unlink/tools/ghidra_12.1.4_PUBLIC JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="$JAVA_HOME/bin:$PATH" ~/.npm/_npx/a1722018f28f9df2/node_modules/.bin/rea <tool> ...`
   `/usr/bin/java` is a stub, so the env is mandatory. Use it for at most a few final citations —
   every call starts a 1–2 GB headless Ghidra, and other lanes are running.
5. **Label every line** `Observed:` (byte/disassembly/string you can point at), `Derived:` (arith
   from observed), `Inferred:` (behavioural guess), `Unknown:`. Never promote a guess to Observed.
6. **End your file with `## Answer summary`** — one row per TODO you were assigned: tag, verdict
   (`ANSWERED` / `PARTIAL` / `NOT ANSWERED`), the address or byte evidence, and the exact code
   change you recommend (file, symbol, one-line description) so it can be applied without re-work.
   If you cannot answer, say so in one sentence and name the blocker; do not pad.

## Lanes

| lane | file | TODO tags | core question |
|---|---|---|---|
| state-fields | `re/td/state-fields.md` | `TODO_FIELDS` (`KEY_FLAGS`, `JOY_AXIS_DELTA`, `MOTION_COUNTER`, `RESOURCE_TABLE`, `SCRIPT_RECORD_TABLE`, `CREW_ROSTER`, `SAVE_SLOT_LIST`), `TODO_PERSISTED@DS:0x4678/0x469c/0x54b5`, `TODO_MEANING@DS:0x3c92/0x3c93/0x3c95/0x455b` | what are these blob/global fields, who writes them, and do the three "persisted but undocumented" words actually reach `BH_START.DAT`? |
| globals | `re/td/globals.md` | every `TODO_GLOBAL@…` in `loop.ts` (`0x15c1a`, `0x13c92`, `0x15bbb`, `0x13c95`, `0x13c5c`, `0x1359b`, `0x135a1`, `0x13c93`, `0x14d5b`, `0x14d5d`, `0x13c60`), `TODO_TIMERS@0x23e9e` (`DS:0x13c16`/`0x13c18`) | producer/consumer of each: full xref sweep, and the two countdown decrement sites |
| arms-input | `re/td/arms-input.md` | `TODO_EVENT_CODE@{0x06, Tab, 0x23dd6, 0x28432}`, `TODO_INPUT@0x23dd6`, `TODO_CONSUMER@0x13224/0x13223`, `TODO_MODE_@0x23c1f`, `TODO_SINK_AL@0x29997`, `TODO_PAGER_TAIL@0x2ec44`, `TODO_STATE4_FALLTHROUGH@0x2eac4`, `TODO_SITE@0x2eb38-walk`, `TODO_MESSAGE@<fiveStr>`, `TODO_SCROLL_LEFT@0x24446` | which scancode reaches which arm, which arms are dead code, and what the untranscribed tails actually call |
| boot-gatherers | `re/td/boot-gatherers.md` | `TODO_BOOT@0x23c12`, `TODO_GATHERERS` (level 1 / 2+, `DS:0x13572`), `TODO_BUFFER@0x28429`, `TODO_TABLE_SOURCE@0x15a9d`, `TODO_ANCHOR_0x267f9` | the INIT_CALL pre-loop writes (incl. the dispatch key's boot value), the gatherer that fills the event queue, and the BIOS type-ahead buffer |
| actors | `re/td/actors.md` | `TODO_ACTOR_FIELDS@0x24544`, `TODO_ACTOR_CULL@0x245a9` | the 13-byte actor record layout (+8/+a/+b: which is sprite, which are x/y) and the nine `cmp ax,cx / je` screen-cull pairs |
| zones-pan | `re/td/zones-pan.md` | `TODO_CAPTION_GLYPHS@0x263d1`, `TODO_SCROLL@0x2b623`, `TODO_PASS_PATH@0x24038`, `TODO_INT16_HOP@0x2a0f0` | the VRAM pan `FUN_231e_8443` (shift by `DS:0x3c98`, 78-entry table at `DS:0xb117`), the caption glyph source, and the two untranscribed code paths |
| pages | `re/td/pages.md` | `TODO_FIELDWRITER@0x6bb3`, `TODO_PAGE_RECORD@0x2b079` | who writes `DS:0x6bb3` (indexed store?) and the true `BH_PAN` record↔page numbering incl. missing records |
| runtime-flow | `re/td/runtime-flow.md` | the unresolved input flow past the title, palette-cycling phase evidence, and whether the `TODO_MEMORY@…` guards ever fire in a browser session | drive the real game: `re/dosbox/rawshot.sh` captures raw 320x200 VRAM (F7). Establish what advances the post-title screen (mouse/INT 33h? which key?), and whether the title shimmer is a palette cycle by diffing consecutive grabs ~0.3 s apart |

`TODO_KEYUP`, `TODO_DRAWS@0x2e9e9/0x2eb8c/0x2ea8d`, `TODO_ARM_ORDER@0x2e7db`, `TODO_KEYMAP@0x2e76c`,
`TODO_ART_SOURCE@0x2b04d`, `TODO_LEVEL2PLUS@0x2e82e`, `TODO_SCROLL_LEFT@0x24446` and the
`TODO_TIMERS` frame-clock question are **already closed** in code comments or `re/`; lanes only
re-open them if their sweep contradicts the closure.
