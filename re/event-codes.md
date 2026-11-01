# event-codes — how a physical key becomes the AL event code

Narrow question: the state-1 dispatch arms at 0x2e6e9..0x2e7db compare AL against immediates
(0x1e, 0x11, 0x12, 0x3b, 0x01, ...). Where does that AL come from, and which physical key
produces it? Convention: addresses are linear, file offset = linear - 0xf200. Disassembly via
`python3 re/work/x86.py <linear> <len>`.

One finding = one append. Nothing above this block is ever rewritten.

## F1 — the pump loads AL from the INT 9 latch, not from INT 16h

Producer site, verbatim `python3 re/work/x86.py 0x24330 +0xd0` (key section of the pump
FUN_231e_0bf6 @0x23dd6):

```
02436d  c6 06 bd 5b 00       mov byte ptr [0x5bbd], 0
024372  2e a0 42 00          mov al, byte ptr cs:[0x42]      <-- AL = event code, HERE
024376  80 3e 61 46 01       cmp byte ptr [0x4661], 1
02437b  74 08                je 0x24385
02437d  2e 80 3e 43 00 01    cmp byte ptr cs:[0x43], 1
024383  75 05                jne 0x2438a
024385  c6 06 bd 5b 01       mov byte ptr [0x5bbd], 1        <-- modifier latch 1
02438a  c6 06 be 5b 00       mov byte ptr [0x5bbe], 0
02438f  80 3e 62 46 01       cmp byte ptr [0x4662], 1
024394  74 08                je 0x2439e
024396  2e 80 3e 44 00 01    cmp byte ptr cs:[0x44], 1
02439c  75 0b                jne 0x243a9
02439e  c6 06 be 5b 01       mov byte ptr [0x5bbe], 1        <-- modifier latch 2
0243a3  2e c6 06 44 00 00    mov byte ptr cs:[0x44], 0
0243a9  50                   push ax
0243aa  9a 89 bc 1e 13       lcall 0x131e, 0xbc89            (AL preserved by push/pop)
0243af  58                   pop ax
0243b0  3c 39                cmp al, 0x39                    <-- 0x39 = SPACE
0243b2  75 4a                jne 0x243fe
```

So the value every mode handler's `cmp al,imm` arms test is `cs:[0x42]`, the "last scancode"
latch written by the game's own INT 9 handler at 0x23dce (`mov cs:[0x42], al`, al = byte read
from port 0x60 at 0x23c9c). There is **no scancode->code table**: the event code is the raw
8042 key code itself.

Corroboration inside the same instruction stream: the code the INT 9 handler gives to SPACE
is 0x39 (make) / 0xb9 (break) at 0x23d48/0x23d73, and the pump tests the very same value as an
event code at 0x243b0 -> `cmp al, 0x39`, and the code INT 9 gives to F1 is 0x3b at 0x23d80, and
state 1 arms on `cmp al, 0x3b` @0x2e737 (menu). Same numbering on both sides of the latch.

Only 5 instructions in the whole code segment reference that latch: 0x23c62, 0x23c79, 0x23c8b,
0x23dce (quoted in re/game-loop-modes.md) and the producer 0x24372 above. Scan script:
linear sweep 0x231e0..0x32000 with capstone, filter op_str containing `0x42]`/`0x13222`/`0x3222`.

## pump tail

verbatim `python3 re/work/x86.py 0x24491 0x80`

```

```

## INT 9 arms -> buffer write

verbatim `python3 re/work/x86.py 0x23d48 0x90`

```

```

## state-1 arm compares

verbatim `python3 re/work/x86.py 0x2e6e9 0x60`

```

```

### pump tail / INT 9 arms / state-1 arms — real bytes

The three empty code blocks above are an artifact: x86.py treats arg2 as an absolute END
(`int(a2,16)`), not a length, so `0x80`/`0x90`/`0x60` selected an empty slice. Correct form is `+len`.

`python3 re/work/x86.py 0x24491 +0x80` — pump tail (note AL is untouched between 0x24372 and the
`ret` @0x24507; every branch that consumes a key jumps to 0x23dd9 and re-pumps):

```
024491  e9 45 f9             jmp 0x23dd9
024494  83 3e 5d 4d 01       cmp word ptr [0x4d5d], 1
024499  74 08                je 0x244a3
02449b  2e 80 3e 3d 00 01    cmp byte ptr cs:[0x3d], 1
0244a1  75 14                jne 0x244b7
0244a3  83 3e 98 3c de       cmp word ptr [0x3c98], -0x22
0244a8  7e 0d                jle 0x244b7
0244aa  83 2e 98 3c 03       sub word ptr [0x3c98], 3
0244af  9a dd 02 1e 13       lcall 0x131e, 0x2dd
0244b4  e9 22 f9             jmp 0x23dd9
0244b7  80 3e 91 3c 02       cmp byte ptr [0x3c91], 2
0244bc  75 31                jne 0x244ef
0244be  80 3e a7 46 01       cmp byte ptr [0x46a7], 1
0244c3  74 0c                je 0x244d1
0244c5  3c 44                cmp al, 0x44
0244c7  75 26                jne 0x244ef
0244c9  c6 06 a7 46 01       mov byte ptr [0x46a7], 1
0244ce  eb 1f                jmp 0x244ef
0244d0  90                   nop
0244d1  3c 41                cmp al, 0x41
0244d3  75 1a                jne 0x244ef
0244d5  c6 06 e6 3b 01       mov byte ptr [0x3be6], 1
0244da  c7 06 5c 3c bc 02    mov word ptr [0x3c5c], 0x2bc
0244e0  bf 00 00             mov di, 0
0244e3  c7 85 9b 35 32 00    mov word ptr [di + 0x359b], 0x32
0244e9  c7 85 a1 35 14 00    mov word ptr [di + 0x35a1], 0x14
0244ef  3c 7f                cmp al, 0x7f
0244f1  76 08                jbe 0x244fb
0244f3  c6 06 b8 5b 00       mov byte ptr [0x5bb8], 0
0244f8  e9 de f8             jmp 0x23dd9
0244fb  80 3e b8 5b 00       cmp byte ptr [0x5bb8], 0
024500  75 05                jne 0x24507
024502  c6 06 b8 5b 01       mov byte ptr [0x5bb8], 1
024507  5a                   pop dx
024508  59                   pop cx
024509  5b                   pop bx
02450a  c3                   ret
02450b  bf 04 00             mov di, 4
```

`python3 re/work/x86.py 0x23d48 +0x90` — INT 9 arms; the only store in the ISR is the latch:

```
023d48  3c 39                cmp al, 0x39
023d4a  75 27                jne 0x23d73
023d4c  2e c6 06 3f 00 01    mov byte ptr cs:[0x3f], 1
023d52  2e c6 06 43 00 00    mov byte ptr cs:[0x43], 0
023d58  2e c6 06 3c 00 00    mov byte ptr cs:[0x3c], 0
023d5e  2e c6 06 3d 00 00    mov byte ptr cs:[0x3d], 0
023d64  2e c6 06 40 00 00    mov byte ptr cs:[0x40], 0
023d6a  2e c6 06 41 00 00    mov byte ptr cs:[0x41], 0
023d70  eb 5c                jmp 0x23dce
023d72  90                   nop
023d73  3c b9                cmp al, 0xb9
023d75  75 09                jne 0x23d80
023d77  2e c6 06 3f 00 00    mov byte ptr cs:[0x3f], 0
023d7d  eb 4f                jmp 0x23dce
023d7f  90                   nop
023d80  3c 3b                cmp al, 0x3b
023d82  75 09                jne 0x23d8d
023d84  2e c6 06 3e 00 01    mov byte ptr cs:[0x3e], 1
023d8a  eb 42                jmp 0x23dce
023d8c  90                   nop
023d8d  3c bb                cmp al, 0xbb
023d8f  75 09                jne 0x23d9a
023d91  2e c6 06 3e 00 00    mov byte ptr cs:[0x3e], 0
023d97  eb 35                jmp 0x23dce
023d99  90                   nop
023d9a  3c 1d                cmp al, 0x1d
023d9c  75 09                jne 0x23da7
023d9e  2e c6 06 44 00 01    mov byte ptr cs:[0x44], 1
023da4  eb 28                jmp 0x23dce
023da6  90                   nop
023da7  3c 9d                cmp al, 0x9d
023da9  75 09                jne 0x23db4
023dab  2e c6 06 44 00 00    mov byte ptr cs:[0x44], 0
023db1  eb 1b                jmp 0x23dce
023db3  90                   nop
023db4  3c 38                cmp al, 0x38
023db6  75 09                jne 0x23dc1
023db8  2e c6 06 43 00 01    mov byte ptr cs:[0x43], 1
023dbe  eb 0e                jmp 0x23dce
023dc0  90                   nop
023dc1  3c b8                cmp al, 0xb8
023dc3  75 09                jne 0x23dce
023dc5  2e c6 06 43 00 00    mov byte ptr cs:[0x43], 0
023dcb  eb 01                jmp 0x23dce
023dcd  90                   nop
023dce  2e a2 42 00          mov byte ptr cs:[0x42], al
023dd2  1f                   pop ds
023dd3  5f                   pop di
023dd4  58                   pop ax
023dd5  cf                   iret
023dd6  53                   push bx
023dd7  51                   push cx
```

`python3 re/work/x86.py 0x2e6e9 +0x60` — state-1 arm compares:

```
02e6e9  3c 1e                cmp al, 0x1e
02e6eb  75 0d                jne 0x2e6fa
02e6ed  b0 03                mov al, 3
02e6ef  a2 91 3c             mov byte ptr [0x3c91], al
02e6f2  9a 6d 7e 1e 13       lcall 0x131e, 0x7e6d
02e6f7  e9 8c 02             jmp 0x2e986
02e6fa  9a b7 67 1e 13       lcall 0x131e, 0x67b7
02e6ff  3c 11                cmp al, 0x11
02e701  75 0d                jne 0x2e710
02e703  b0 04                mov al, 4
02e705  a2 91 3c             mov byte ptr [0x3c91], al
02e708  9a 6d 7e 1e 13       lcall 0x131e, 0x7e6d
02e70d  e9 76 02             jmp 0x2e986
02e710  3c 1f                cmp al, 0x1f
02e712  75 08                jne 0x2e71c
02e714  9a 1c a0 1e 13       lcall 0x131e, 0xa01c
02e719  e9 6a 02             jmp 0x2e986
02e71c  3c 12                cmp al, 0x12
02e71e  75 0d                jne 0x2e72d
02e720  b0 02                mov al, 2
02e722  a2 91 3c             mov byte ptr [0x3c91], al
02e725  9a 6d 7e 1e 13       lcall 0x131e, 0x7e6d
02e72a  e9 59 02             jmp 0x2e986
02e72d  3c 35                cmp al, 0x35
02e72f  75 06                jne 0x2e737
02e731  e8 6b f6             call 0x2dd9f
02e734  e9 4f 02             jmp 0x2e986
02e737  3c 3b                cmp al, 0x3b
02e739  75 08                jne 0x2e743
02e73b  9a c2 99 1e 13       lcall 0x131e, 0x99c2
02e740  e9 43 02             jmp 0x2e986
02e743  3c 01                cmp al, 1
02e745  75 08                jne 0x2e74f
```

## conclusion


**AL is loaded from `cs:[0x42]`, the last raw port-0x60 key code, at 0x24372 inside the pump** —
there is no scancode->event-code table and no arithmetic; event code == PC set-1 scancode, and
the `int 0x16` sites (incl. 0x28432, the address TODO_EVENT_CODE points at) are on a *different*
path that is only reachable after the BIOS INT 9 vector has been restored.

Two input paths, not one:
1. Main loop (all modes). Game ISR CS:0xab7 @0x23c97 reads port 0x60 (0x23c9c), EOI (0x23cad),
   sets hold-flags, and latches the code with the single store `mov cs:[0x42], al` @0x23dce. The
   pump reads that latch at 0x24372, so the handler chain at 0x2e6e9.. sees a scancode. The ISR
   never chains to the BIOS ISR (no `callf`/`jmpf` through DS:0xb998/0xb99a anywhere in
   0x23c97..0x23dd5) and never writes the 0040:001E typematic ring, which is why `int 0x16` does
   not appear on this path at all.
2. Menus / text entry. FUN_231e_1dac @0x24f8c (and 0x26132, 0x296b2, 0x2ba47, 0x2be7a, 0x2cbbf,
   0x2cc33) restores the saved BIOS vector — `mov dx,[0xb99a]; mov ax,[0xb998]; mov ds,ax;
   mov ah,0x25; mov al,9; int 0x21` @0x24f8d..0x24f9a — and only then do the 59 `int 0x16` sites
   make sense. 0x28432 is one of those: it is inside the scroll-list widget in FUN_231e_4b35
   (@0x27d15, reached from the pump at 0x23e37 only when DS:0x13572 selects it) and it converts
   AH=0x48/0x50 into list-row motion, returning `al = [0x455c] - [0x455a]` (row index) at
   0x2844d..0x28450 / 0x283b5..0x283bc. Not the mode-change producer.

### scancode -> event code table (state-1 arms)

`make code | break = make|0x80 (0x244ef `cmp al,0x7f` drops breaks, re-pump @0x244f8)`.

| event code | key (set 1) | state-1 effect | proof class |
|---|---|---|---|
| 0x1e | A | mode 3 (`mov [0x3c91],3` @0x2e6ef) | set-1 convention; not named in-binary |
| 0x11 | W | mode 4 @0x2e705 | set-1 convention |
| 0x12 | E | mode 2 @0x2e722 | set-1 convention |
| 0x1f | S | `lcall 0x131e,0xa01c` @0x2e714 | set-1 convention |
| 0x35 | / | `call 0x2dd9f` @0x2e731 | set-1 convention |
| 0x3b | F1 | menu FUN_231e_99c2 @0x2e73b | **proven**: ISR arm `cmp al,0x3b` @0x23d80 -> `mov cs:[0x3e],1`, same numbering as latch cs:[0x42] |
| 0x01 | Esc | menu @0x2e747 | set-1 convention |
| 0x2e | C | `lcall 0x131e,0xa26d` @0x2e753 | set-1 convention |
| 0x31 | N | `xor byte [0x3ade],1` sound toggle @0x2e75f | set-1 convention |
| 0x32 | M | `lcall 0x131e,0x3a81` @0x2e770 | set-1 convention |
| 0x3c | F2 | gated `call 0x2ed2b` @0x2e783 | set-1 convention; also the ISR-latch cheat test `cmp cs:[0x42],0x3c` @0x23c62 |
| 0x3d | F3 | gated `call 0x2ec35` @0x2e794 | set-1 convention |
| 0x44 | F10 | cheat-gated `mov word [0x3c95],1` @0x2e7a5 | set-1 convention; pump back door @0x244c5 |
| 0x2c | Z | level stepper @0x2e7af..0x2e7db | set-1 convention |
| 0x39 | Space | (pump-only) scroll DS:0x13c98 by +/-4 @0x243c2/0x243e3 | **proven**: ISR arm `cmp al,0x39` @0x23d48 and pump `cmp al,0x39` @0x243b0 |
| 0x41 | F7 | pump back door, 2nd key @0x244d1 | set-1 convention |
| 0x13..0x1a | R T Y U I O P [ | crew-stat sink @0x29997 | set-1 convention |
| 0x48/0x50/0x4b/0x4d | Up/Down/Left/Right | ISR hold-flags cs:[0x3c..0x41]; pump scrolls, never reaches arms | **proven**: ISR arms @0x23cb0/0x23d22/0x23cd6/0x23cfc, INT 16 AH tests @0x2843c/0x28441 agree |

Reclassification of three labels in re/game-loop-modes.md (bytes unchanged, reading changed):
`cmp al,0x31/0x32/0x3c/0x3d/0x44/0x2c/0x2e` are N, M, F2, F3, F10, Z, C — not '1','2','<','=','D',
',','.'. Likewise the "5"-then-"2" cheat at 0x23c62/0x23c79 is **F2 then F3**, and the "ASCII"
latch DS:0x15bb8 (set @0x24502, cleared @0x244f3) is a *make-vs-break* latch, not ASCII-vs-
scancode — `cmp al,0x7f` @0x244ef is a bit-7 test.

### Answer to the narrow question

A physical key becomes the event code in three instructions: `in al,0x60` @0x23c9c (ISR read) ->
`mov cs:[0x42],al` @0x23dce (latch) -> `mov al,cs:[0x42]` @0x24372 (pump) -> `ret` @0x24507 with
AL = that byte -> the arms at 0x2e6e9.. Nothing translates it, so **all five** of
{0x1e, 0x11, 0x12, 0x3b, 0x01} have keyboard bindings today: A, W, E, F1, Esc.
TODO_EVENT_CODE@0x28432 is the wrong site: that int 16h belongs to the list widget on the
BIOS-INT-9 path, not to the mode-1 dispatch.

UNCONFIRMED: key *names* for codes other than 0x39/0x3b/0x48/0x4b/0x4d/0x50 (the binary contains
no scancode->name string table for them, HELPME.DOC has no key list — grep found nothing);
whether bit-7 break codes are ever delivered to a mode handler (0x244ef says no); and the
identity of cs:[0x43] as Alt vs Left Shift (0x38 is LAlt in set 1, the doc called it shift).

AL-preservation check for the claim above: the only far calls on the paths between 0x24372 and
0x24507 open with `push ax` — FUN_231e_8828-style helper @0x23638 (50 53 51 52 57 56 06) and
@0x23225 (`push es; push ax`), and the 0x2443a/0x24411 repeat paths jump to 0x24471 without
touching AL. Arrow-key paths that do consume the code leave via `jmp 0x23dd9` (0x243d9, 0x243ed,
0x243fb, 0x24491) and never return.

## Applied in the port (loop.js, verified 30 Oct)
initialState() seeds mode = 1 from BH_START.DAT (was TODO_BOOT@0x23c12). toRecord() now derives
`code` from the make scancode when a row has no explicit ASCII code, per @0x24372. Result:
key:a -> mode 3 (2 draw rows), key:w -> mode 4 (3), key:e -> mode 2 (3), key:Escape -> stays 1 (3).
Still open: mouse click has no code (no int 33h ax=5 read quoted), keyup/break path TODO_KEYUP@0x23cc7.

---

## Appendix D — CORRECTION 3 (settled): the handler operand is the raw make code, and the allocator is real

An earlier pass in this session tried reading the handler operand as the int 16h **ASCII** byte
(0x13..0x1a = Ctrl+S..Ctrl+Z, 0x21..0x28 = Shift+1..8). That reading is **refuted**, and the
scancode model in §1 stands. Decisive disassembly:

    0x24372  2e a0 42 00     mov al, byte ptr cs:[0x42]   ; the pump's load, AL survives to 0x23c26
    0x243aa  9a 89 bc 1e 13  lcall 0x131e,0xbc89          ; bracketed by push ax 0x243a9 / pop ax 0x243af
    0x244ef  3c 7f           cmp al, 0x7f                 ; still the latch, on the fall-through path
    0x23d48  3c 39           cmp al, 0x39                 ; INT 9: space make  -> cs:[0x3f]=1
    0x23d73  3c b9           cmp al, 0xb9                 ; INT 9: space break -> cs:[0x3f]=0
    0x23d80  3c 3b           cmp al, 0x3b                 ; INT 9: F1 make     -> cs:[0x3e]=1
    0x23da7  3c 9d           cmp al, 0x9d                 ; INT 9: LCtrl break -> cs:[0x44]=0

cs:[0x42] is written from that same AL at 0x23dce, so the byte the four cmp chains test is a **set-1
make code**. The int 16h reader does exist — 0x28427 `mov ah,1 / int 16h`, 0x28430 `mov ah,0 / int
16h`, 0x2843c `cmp ah,0x48` (Up as AL=0/AH=make), 0x28449 `cmp al,0x0d` (Enter as ASCII) — but it is
a *dialog/menu* poll that also consumes the wheel counters [0x455a]/[0x455c]. It is not what feeds
FUN_231e_b509 and friends. Consequence for the bindings: 0x11/0x12/0x1e are **w / e / a**, 0x0c and
0x0d are **-** and **=** (state 3's pagers), 0x1c is Enter, 0x01 is Escape, 0x3c/0x3d/0x44 are
**F2/F3/F10**, and `D` is not a key.

### FUN_231e_67b7 @0x29997 is the crew-stat allocator, not a sink

It is reached twice: `lcall 0x131e,0x67b7` @0x2e6fa in state 1 (before the second compare) and @0x2ea87
as state 2's fall-through. 16 arms over the stat words DS:0x3c5e..0x3c6c (`lea di,[0x3c5e+bx]` @0x299a2):

| code | key (make) | direction | cap | cite |
|---|---|---|---|---|
| 0x13..0x1a | r t y u i o p [ | spend 1 AP into stat i | 0x4a 0x4a 0xde 0x25 0x6f×4 | @0x299a0..@0x29a6e, gated on `[0x3c70] != 0` @0x299ad |
| 0x21..0x28 | f g h j k l ; ' | free 1 AP from stat i (must be non-zero) | — | @0x29a20..@0x29b12 |

Words: pool DS:0x3c70, budget DS:0x3c5c (F2-then-F9 cheat sets it to 0x2bc = 700 @0x244da), stat
mirrors DS:0x3c72/0x3c73/0x3c74/0x3c75 = stat>>1 (@0x29ad0..@0x29b12), and any mirror change sets the
redraw latch @0x23c08-style `mov byte [0x5c1a],0xff`. The pump re-derives the pool every 7 passes —
`inc byte ptr cs:[0x42]`-adjacent counter at **0x23f67** (`fe 06 09 5b`, unique in 0x23dd6..0x245a0),
pool = budget − Σstats, clamped so budget grows to Σstats if Σstats ever exceeds it.

The cheat sequence itself is a latch test, not an arm: `cmp cs:[0x42],0x3c` @0x23c62 (F2) then
`cmp cs:[0x42],0x43` @0x23c79 (F9) → DS:0x13be6=1 @0x23c81, which gates the F10 arm's DS:0x13c95
write @0x2e7a5. So the port binds F2/F9 as latch-only inputs and F10 as the gated arm.

Port state: web/src/engine/loop.ts `fun_231e_67b7`, `tickStatPool`, `INPUT_KEYS` (make-code keyed).
34/34 checks incl. the invariant Σ(stats)+pool == budget from BH_START.DAT (budget 65, stats
8,10,2,5,10,10,10,10).
