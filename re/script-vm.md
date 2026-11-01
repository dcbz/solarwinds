# Solar Winds — SCRIPT VM / interpreter (transcription lane)

Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`
Method: `re/work/x86.py` (capstone CS_MODE_16, **linear = file offset + 0xf200**) and
`re/work/pfun.sh` over `re/decomp/SOLAR1.c`. REA only where an Evidence ID is quoted.
Transcription only — every row below is copied from disassembly, no inferred opcodes.

Status marks: **O** observed in bytes · **D** derived · **I** inferred · **?** unknown.

## 0. Scope / starting coordinates (from `re/FINDINGS.md`, `re/HANDOFF.md`)

- Interpreter region: `0x25240–0x2538f`, inside `FUN_231e_1e14` @ `0x24ff4` (picture loader + script interpreter).
- Conversation loader: `FUN_231e_a26d` @ `0x2d44d` → `BH_CONV.DAT`.
- Screen/resource dispatcher: `FUN_231e_c4cf` @ `0x2f6af`.
- `BH_CONV.DAT` = magic `SOLAR WINDS\x1a\x1a` then a 2-byte offset table.
- `BH_START.DAT` (17831 B) is byte-identical to `HSAV01.DAT` ⇒ a savegame *is* the state blob.

## 1. Dispatch mechanism

**There is no opcode jump table.** Verified two ways: (i) byte-scan of the whole image for the only
686 opcode forms that give an indirect `jmp` through memory (`ff 24` = `jmp w-[si]`,
`ff a4`/`ff a6`/`ff 8x` = `jmp w-[reg+disp]`) returns **0 hits in the code segments**; (ii) the
interpreter body at `0x25240–0x2539f` contains no `jmp`/`call` with a memory or register operand —
every branch is an immediate `jcc` off a `cmp` chain (`re/work/x86.py 0x251e0 0x253a0`, O).

Dispatch is a **dual-stream cursor interpreter**, all inside `FUN_231e_1e14` @ `0x24ff4`:

```
0x25071   mov  cx, 0x40            ; script-slot stride = 64 bytes
0x25074   mul  cx                  ; AX = (BXarg - 1) * 64
0x25076   mov  [0x7066], ax         ; script-slot byte offset          O
0x2507b   mov  ax, [bx + 0x521]     ; word table at DS:0x521 -> script record
0x25083   mov  [0x7064], ax         ; record[+0] = frame/image index
0x25086   mov  [0x704f], bx         ; record pointer
...                                ; (RLE image load 0x250fe / 0x251aa, then key wait 0x251d1)
0x251f0   mov  si, [0x70ab]         ; byte-stream buffer offset
0x251f4   add  si, [0x7066]         ; + slot offset  -> cursor SI
0x251f8   mov  ah, es:[si]          ; FETCH one control byte  (ES = [0x7234])   O
```

* **Operand fetch** = `mov al, byte ptr es:[si]` with `es = [0x7234]`,
  `si = [0x70ab] + [0x7066] (+k)` — i.e. a byte stream living in a 64-byte-slot table, one slot per
  script number (`[0x7066] = (n-1)*0x40`). The cursor advances **one byte per text record**
  (`inc si` at `0x25267`/`0x252eb`), never by a variable width.
* **Text stream** = `di = [[0x704f]+4]` (`0x25220–0x25229`), a run of `$`-terminated records, each
  immediately followed by a **2-byte little-endian link field**; `add di,3` (`0x252da`) jumps to the
  next record. So the record framing is `TEXT '$' LO HI`.
* **Terminator of the whole stream** = `$` whose next byte is also `$` (`mov al,[di+1]; cmp al,0x24`,
  `0x2525d–0x25262`, exit to `0x2539f`). O
* **Selector test** on the fetched byte: `cmp al,0 / je` then `cmp al,0x64 / jae` (`0x25243–0x25249`,
  `0x252c0–0x252c6`, and the `dec al` variants at `0x251fb`, `0x252f7`) ⇒ *only* byte values
  `0x01..0x63` (1..99) count as selectors; `0x00` and `>=0x64` are inert/no-op positions. O
* **Branch (goto) dispatch** = the record's 2-byte link → a **child block of `0xFF`-separated
  sub-records**; the sub-record chosen is `(selector - 1)`-th `0xFF` skip
  (`inc bx; while([bx]!=0xff) inc bx; inc bx` loop, `0x25301–0x2530a`). O
* **Return/effect dispatch** = a cascade at `0x25349–0x2538d` on the payload bytes after the record's
  `$`: `0x01` → conditional (see OP-01), `0x02` → write `1`, `0x00` → skip byte, other → copy byte
  into the state stream at `es:[0x70ab+0x7066]+1`. Payload ends at `0xFF`. O
* **Key dispatch** (the "menu" half): `call 0x2586b` (mouse-hotspot hit test, `INT 33h/04h` +
  `INT 16h/01h`), `cmp al,0x1b` → ESC aborts to exit `0x2539f`, else `inc al` and compare against the
  counted selector total `[0x7058]` (`0x25286–0x2529b`). Option index = key `1..n` (`0x2528f`) or
  click on hotspot #n. O

## 1a. Helper calls made from the interpreter loop

| linear | name in corpus | role (transcribed) |
|---|---|---|
| `0x25ed5` | `FUN_231e_2cf5` | draw `$`-terminated string at `bx`; recognises `0x24` end and `0x01` inline escape; glyph widths summed from table `[0x70e9+ch]`; sets `[0x70af]` = 0x8c/0xc4 by comparing `[0x70a8]` vs `[0x70e3]+0xcd00`. O |
| `0x25e10` | `FUN_231e_2c30` | same shape, second text page (`[0x70a6]` vs `[0x70e3]+0x4600`). O |
| `0x2566f` | `FUN_231e_248f` | `AL` = 0/1/2 selects the **active page**: 0→seg `[0x7060]`, index `[0x705a]`; 1→`si=15`, 2→`si=9` (or 15/9 from `[0x70e1]`) then seg `[0x7062]`; sets flags `[0x709e]=1`, `[0x70b1]`, `[0x704e]` (1 when AL==2). O |
| `0x25d1f` | `FUN_231e_2b3f` | if `[0x70a3]==1` restore a 0x9c(156)-byte row band from seg `[0x705e]` to `A000:` (dirty-rect undo of the click-marker). O |
| `0x25c9f` | `FUN_231e_2abf` | same band restore keyed on `[0x25a2]`. O |
| `0x25623` | `FUN_231e_2443` | wait-for-key `INT 16h/01h`+`00h` with mouse-button poll `INT 33h/03h` (treats a button press as a key). O |
| `0x2586b` | `FUN_231e_268b` | hit-test: `DIV 0x140`, `INT 33h/04h` set cursor, hotspot row/col maths into `[0x709a..0x709c]`. O |
| `0x2b3f`(=0x25d1f) etc. | — | see above |
| `0x25b92` | — | INT-21h error handler reached via `jae` on every file call (`0x2509e` etc.). I |

## 2. Opcode table

The earlier “opcode” framing was misleading. The bytes at `DS:0x35e1 + (id-1)*0x40` are persistent
choice controls, and the bytes after a response's `$` are a fixed-width effect vector applied to
successive choice controls. The complete cmp chain is:

| byte | site | observed effect | status |
|---|---|---|---|
| control `0x00` | `0x25243` / `0x252c0` | choice hidden; effect byte leaves the destination unchanged | O |
| control `0x01..0x63` | `0x25247` / `0x252c4` | choice visible; value selects the 1-based `0xFF` response branch | O |
| control `>=0x64` | `0x25247` / `0x252c4` | inert/hidden | O |
| effect `0x00` | `0x2537f` | preserve destination control byte | O |
| effect `0x01` | `0x2534b` | clear destination control byte | O |
| effect `0x01 0xFF` | `0x2534f..0x25370` | increment slot byte 0, set completion latch, return after a key | O |
| effect `0x02` | `0x25373` | write `1` to destination control byte | O |
| other effect | `0x2537f..0x25383` | copy literal byte to destination control byte | O |
| `0xFF` | `0x25388..0x2538d` | end effect vector / separate response branches | O |

`web/src/engine/vm.ts` transcribes this chain. `web/tools/integration_check.mjs` exercises script 1
from the shipped files: choice 1 follows link `0x0783`, displays the reply, and changes the first
seven slot bytes from `1,1,1,1,1,0,0` to `1,0,0,1,1,1,1`.

## 3. Script storage in BH_START.DAT / BH_CONV.DAT

- The caller passes `CX=0x35e1` at `0x2d53b`; FUN_231e_1e14 stores it at `[0x70ab]` (`0x25010`).
  Therefore script slot `n` is exactly `DS:0x35e1 + (n-1)*0x40` inside the save blob. This closes
  the former “backing buffer” unknown.
- `BH_CONV.DAT` is read raw at `0x2d50b`. Script id indexes its node table at `+0x521`; each node is
  `{u16 portraitRecord, u16 promptHead, u16 choiceHead}`.
- The file opened through the VM-local name at `DS:0x7089` is `BH_PEOP.DAT` (duplicate name at
  linear `0x23019`). It contains 16 `<u16 compressedLength, stone-RLE payload>` records. Each
  decoded record is a stream of `[u8 width=50,u8 height=50,2500 pixels]` portrait frames.
- The second portrait record is fixed at 15, or 9 when caller `DI == 1` (`0x2512b..0x25135`).

## 4. Tools

- `re/tools/dump_conv.py` — walks the `BH_CONV.DAT` offset table, dumps each unit as readable records.

## 9. Unknown

- Exact framebuffer placement/animation cadence for the decoded 50×50 portrait frames still
  depends on the drawing helpers around `0x253ab`; the VM data flow itself is complete.

## 3a. Earlier session-8 analysis, with closure corrections

`BH_CONV.DAT` is a raw image (no RLE on this path) and the interpreter's inputs are three separate
things, which is why earlier notes about "opcode streams in BH_CONV" were confounded:

1. **The node graph**, in the CONV image itself: `+0x521` u16 table indexed by `(script id - 1)`
   (@0x25079/@0x2507b) -> node `{u16 n, u16 textPtr, u16 head}`, text at `node+6`, then the choice
   block of `TEXT '$' LO HI` records (@0x251e2 `mov di,[0x704f]` / `add di,2` / `mov bx,[di]` loads
   exactly that `head`). See `re/script-engine.md` for the reply-pairing evidence.
2. **A per-script 64-byte control stream**, `es = [0x7234]` (the caller's DS) at
   `si = [0x70ab] + [0x7066]`, where `[0x7066] = (id - 1) * 0x40` (@0x25071..@0x25076, @0x251f0,
   @0x251f4). One byte per choice record, cursor advanced by `inc si` only (@0x25267, @0x252eb) —
   never by a variable width. The scan at @0x251f8..@0x2520c reads `ah = es:[si]`, `dec ah`,
   `cmp ah,0 / je` and otherwise skips the choice's text to the next record, so **control == 1 is the
   stop condition of the per-choice walk**, matching §1's `0x01..0x63` selector window.
   **CLOSED:** raw caller assembly at `0x2d53b` is `lea cx,[0x35e1]`; the buffer is the save-backed
   control table described above.
3. **Two records from one data file, loaded by record index.** @0x25092 opens the name at
   `[0x7089]`, reads a 2-byte length, then `dec si / cmp si,0` around an `int 21h/42h al=1` loop
   (@0x250b3..@0x250cb) skips `node[+0] - 1` records of that size and reads the next one into
   `[0x705e]:0` (@0x250d3..@0x250dd). A second load at @0x25138 repeats it with a skip count of
   `0xf`, or `9` when `[0x70e1] == 1` (@0x2512e..@0x25135). Both loads then run an RLE pass whose only
   escape is `0xFF <count> <value>` with the `cmp ch,0xff` exit (@0x25109..@0x25122 and
   @0x251b5..@0x251ce) — the already named `stone` variant. The file is `BH_PEOP.DAT`.

So these are the two `int 21h/42h` seeks in the whole EXE that an earlier note attributed to "the
picture loader only" — they are the *script art* loader, reached from `c`, and the framing is
record-index based.
