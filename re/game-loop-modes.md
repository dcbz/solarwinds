# game-loop modes — draw (§2) and input (§3) evidence

Working log. One finding = one append. Addresses are linear (file offset = linear - 0xf200);
`lcall 0x131e, off` -> linear 0x231e0 + off; DS data -> linear 0x10000 + DSoffset.

## mode 0 (0x2e6e9)

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
02e747  9a c2 99 1e 13       lcall 0x131e, 0x99c2
02e74c  e9 37 02             jmp 0x2e986
02e74f  3c 2e                cmp al, 0x2e
02e751  75 08                jne 0x2e75b
02e753  9a 6d a2 1e 13       lcall 0x131e, 0xa26d
02e758  e9 2b 02             jmp 0x2e986
02e75b  3c 31                cmp al, 0x31
02e75d  75 0d                jne 0x2e76c
02e75f  80 36 de 3a 01       xor byte ptr [0x3ade], 1
02e764  9a 08 37 1e 13       lcall 0x131e, 0x3708
02e769  e9 1a 02             jmp 0x2e986
02e76c  3c 32                cmp al, 0x32
02e76e  75 08                jne 0x2e778
02e770  9a 81 3a 1e 13       lcall 0x131e, 0x3a81
02e775  e9 0e 02             jmp 0x2e986
02e778  3c 3c                cmp al, 0x3c
02e77a  75 0d                jne 0x2e789
02e77c  80 3e b8 5b 01       cmp byte ptr [0x5bb8], 1
02e781  75 06                jne 0x2e789
02e783  e8 a5 05             call 0x2ed2b
02e786  e9 fd 01             jmp 0x2e986
02e789  3c 3d                cmp al, 0x3d
02e78b  75 0d                jne 0x2e79a
02e78d  80 3e b8 5b 01       cmp byte ptr [0x5bb8], 1
02e792  75 06                jne 0x2e79a
02e794  e8 9e 04             call 0x2ec35
02e797  e9 ec 01             jmp 0x2e986
02e79a  3c 44                cmp al, 0x44
02e79c  75 0d                jne 0x2e7ab
02e79e  80 3e e6 3b 00       cmp byte ptr [0x3be6], 0
02e7a3  74 46                je 0x2e7eb
02e7a5  c7 06 95 3c 01 00    mov word ptr [0x3c95], 1
02e7ab  3c 2c                cmp al, 0x2c
02e7ad  75 3f                jne 0x2e7ee
02e7af  80 3e 72 35 02       cmp byte ptr [0x3572], 2
02e7b4  72 03                jb 0x2e7b9
02e7b6  eb 76                jmp 0x2e82e
02e7b8  90                   nop
02e7b9  fe 06 72 35          inc byte ptr [0x3572]
02e7bd  9a f9 88 1e 13       lcall 0x131e, 0x88f9
02e7c2  9a 58 04 1e 13       lcall 0x131e, 0x458
02e7c7  c6 06 1a 5c ff       mov byte ptr [0x5c1a], 0xff
02e7cc  9a 45 00 1e 13       lcall 0x131e, 0x45
02e7d1  80 3e 72 35 01       cmp byte ptr [0x3572], 1
02e7d6  75 13                jne 0x2e7eb
02e7d8  be 00 00             mov si, 0
02e7db  83 bc 60 3c 11       cmp word ptr [si + 0x3c60], 0x11
```

### correction: 0x2e6e9 is the state-1 handler, not state 0

Verbatim dispatch chain `python3 re/work/x86.py 0x23c1f +0x44`:

```
023c1f  80 3e 91 3c 01       cmp byte ptr [0x3c91], 1
023c24  75 08                jne 0x23c2e
023c26  9a 09 b5 1e 13       lcall 0x131e, 0xb509
023c2b  eb 35                jmp 0x23c62
023c2d  90                   nop
023c2e  80 3e 91 3c 02       cmp byte ptr [0x3c91], 2
023c33  75 08                jne 0x23c3d
023c35  9a 09 b8 1e 13       lcall 0x131e, 0xb809
023c3a  eb 26                jmp 0x23c62
023c3c  90                   nop
023c3d  80 3e 91 3c 03       cmp byte ptr [0x3c91], 3
023c42  75 08                jne 0x23c4c
023c44  9a ac b9 1e 13       lcall 0x131e, 0xb9ac
023c49  eb 17                jmp 0x23c62
023c4b  90                   nop
023c4c  80 3e 91 3c 04       cmp byte ptr [0x3c91], 4
023c51  75 08                jne 0x23c5b
023c53  9a ad b8 1e 13       lcall 0x131e, 0xb8ad
023c58  eb 08                jmp 0x23c62
023c5a  90                   nop
023c5b  80 3e 91 3c 05       cmp byte ptr [0x3c91], 5
023c60  75 00                jne 0x23c62
```

### annotation: state-1 handler 0x2e6e9 (FUN_231e_b509), lines 0x2e6e9..0x2e7db

AL on entry = the event code left by the pump FUN_231e_0bf6 @0x23dd6 (it exits at 0x24507
with AL = event code; `retf` at 0x2e986 ends the handler). The handler is a linear
compare-chain, first match wins, every arm jumps to the shared `retf` at 0x2e986.

| line | meaning |
|---|---|
| 0x2e6e9 `cmp al,0x1e` / 0x2e6eb | first arm: event 0x1e. Note there is no `cmp al,...` before it, so AL is consumed as-is from the pump. |
| 0x2e6ed/0x2e6ef `mov al,3; mov [0x3c91],al` | DS:0x13c91 = 3 → next loop iteration runs the state-3 handler 0x2eb8c. |
| 0x2e6f2 `lcall 0x131e,0x7e6d` | **draw**: FUN_231e_7e6d @0x2b04d with AL=3 — shared screen-blit helper (sets ES=0xA000, `rep movsb`; conditionally calls `int 0x33`). This is the redraw-on-mode-change site. |
| 0x2e6f7 `jmp 0x2e986` → 0x2e986 `retf` | exit handler. |
| 0x2e6fa `lcall 0x131e,0x67b7` | FUN_231e_67b7 @0x29997 = event **sink/consumer** for codes 0x13..0x1a (crew-stat increments: `cmp word [0x3c70],0` action-point pool, `inc word [di+0x3c5e]` against per-stat caps 0x4a/0xde/0x25/0x6f, `dec [0x3c70]`). It returns AL (possibly unchanged) for the arms below; it contains no INT 16h/33h itself. |
| 0x2e6ff..0x2e70d `cmp al,0x11` → state 4 | event 0x11 → DS:0x13c91=4 then FUN_231e_7e6d(AL=4) draw. |
| 0x2e710..0x2e719 `cmp al,0x1f` | event 0x1f → `lcall 0x131e,0xa01c` = FUN_231e_a01c @0x2d1fc (sub-screen, no mode change). |
| 0x2e71c..0x2e72d `cmp al,0x12` → state 2 | event 0x12 → DS:0x13c91=2 + FUN_231e_7e6d(AL=2) draw. |
| 0x2e72d..0x2e734 `cmp al,0x35` | event 0x35 → near `call 0x2dd9f` (FUN_231e_abbf @0x2dd9f) — the arm that contains the `int 0x16`/`int 0x21 ah=0x25` block at 0x2ddba..0x2ded5 (see §3). |
| 0x2e737..0x2e743 `cmp al,0x3b` | event 0x3b → `lcall 0x131e,0x99c2` = FUN_231e_99c2 @0x2cba2: shared in-game menu, present in **all four** state handlers (0x2e6e9, 0x2e9e9, 0x2ea8d, 0x2eb8c). Writes DS:0x13c91=1 at 0x2cbae. |
| 0x2e743..0x2e74c `cmp al,1` | event 1 → same menu FUN_231e_99c2. |
| 0x2e74f..0x2e758 `cmp al,0x2e` | event 0x2e → `lcall 0x131e,0xa26d` = FUN_231e_a26d @0x2d44d (has an `int 0x16` at 0x2d60b). |
| 0x2e75b..0x2e76c `cmp al,0x31` ('1') | `xor byte [0x3ade],1` toggles the sound-enable flag, then `lcall 0x131e,0x3708` = FUN_231e_3708 @0x268e8 (sound init/re-init). |
| 0x2e76c..0x2e775 `cmp al,0x32` ('2') | `lcall 0x131e,0x3a81` = FUN_231e_3a81 @0x26c61. |
| 0x2e778..0x2e786 `cmp al,0x3c` ('<') | gated on `cmp byte [0x5bb8],1` then `call 0x2ed2b` (thunk_FUN_231e_bb5a @0x2ed2b). [0x5bb8] is the pump's "AL is an ASCII (<=0x7f) key" latch, set at 0x24502/0x244f3. |
| 0x2e789..0x2e797 `cmp al,0x3d` ('=') | same gate, `call 0x2ec35` (thunk_FUN_231e_ba64 @0x2ec35 → 0x2ec44). |
| 0x2e79a..0x2e7a5 `cmp al,0x44` ('D') | if `[0x3be6] != 0` then `word [0x3c95] = 1`. |
| 0x2e7ab..0x2e7b9 `cmp al,0x2c` (',') | difficulty/level stepper: if `[0x3572] < 2` then `inc byte [0x3572]`, then FUN_231e_88f9 @0x2bad9, FUN_231e_0458 @0x23638, `mov byte [0x5c1a],0xff`, FUN_231e_0045 @0x23225. |
| 0x2e7d1..0x2e7e6 | if `[0x3572] == 1` and `word [0x3c60] <= 0x11`: `lea bx,[0x58b2]` + `lcall 0x131e,0x32de` = FUN_231e_32de @0x264be — that pair (BX=DS pointer to a NUL string, call) is the game's **text/status message printer**; it is also the draw primitive used at 0x2e7e6/0x2e826/0x2e999/0x2ec3c and repeatedly inside the pump. |
| 0x2e7cc `lcall 0x131e,0x45` | FUN_231e_0045 @0x23225, always paired with FUN_231e_0458 @0x23638 — this pair is the "rebuild/redraw everything" call (also used at loop 0x23c12 during init, and at 0x24111/0x24173/0x24463 in the pump). |

**§3 conclusion for state 1**: the handler itself contains **no** INT 16h / INT 33h. All
keyboard and mouse acquisition happens in the pump (called at 0x23c1c, one iteration per
loop pass) and in the callees reached from the arms above. Evidence: no `cd 16` / `cd 33`
byte anywhere in 0x2e6e9..0x2e9e8.

### §2 draw inventory for state 1

- 0x2e6f2, 0x2e708, 0x2e725 — `lcall 0x131e,0x7e6d` (FUN_231e_7e6d @0x2b04d), called with
  AL = the *new* mode; the helper writes to ES=0xA000 with `rep movsb` using the source
  segment from DS:[0x6b9d] and dest offset from DS:[0x6bb3], and issues `int 0x33` ax=1/2
  around the copy when byte [0] is nonzero (mouse present).
- 0x2e7c2, 0x2e802 — `lcall 0x131e,0x458` + `lcall 0x131e,0x45` full-screen rebuild after a
  `[0x3572]` change.
- 0x2e7e6, 0x2e826 — `lea bx,[0x58b2]` + `lcall 0x131e,0x32de` message blit.
- 0x2e8f1/0x2e8f4, 0x2e92b — `call 0x2c5d9` (FUN_231e_93f9), `call 0x2c646`
  (FUN_231e_9466), `call 0x2c307` (FUN_231e_9127) panel/row redraws for the AL=5/3 arms
  (cursor movers over the tables at DS:0x3573 / 0x359b / 0x35af).

## §3 (input) — mode-independent: installed INT 9 handler at 0x23c97 (CS:0xab7)

Installation evidence, verbatim `python3 re/work/x86.py 0x239d1 +0x40`:

```
0239d1  b4 35                mov ah, 0x35
0239d3  b0 24                mov al, 0x24
0239d5  cd 21                int 0x21
0239d7  8c 06 84 43          mov word ptr [0x4384], es
0239db  89 1e 86 43          mov word ptr [0x4386], bx
0239df  1e                   push ds
0239e0  8d 16 b3 0a          lea dx, [0xab3]
0239e4  8c c8                mov ax, cs
0239e6  8e d8                mov ds, ax
0239e8  b4 25                mov ah, 0x25
0239ea  b0 24                mov al, 0x24
0239ec  cd 21                int 0x21
0239ee  1f                   pop ds
0239ef  b4 35                mov ah, 0x35
0239f1  b0 09                mov al, 9
0239f3  cd 21                int 0x21
0239f5  8c c2                mov dx, es
0239f7  89 16 98 b9          mov word ptr [0xb998], dx
0239fb  89 1e 9a b9          mov word ptr [0xb99a], bx
0239ff  8d 16 b7 0a          lea dx, [0xab7]
023a03  89 16 9c b9          mov word ptr [0xb99c], dx
023a07  8c ca                mov dx, cs
023a09  89 16 9e b9          mov word ptr [0xb99e], dx
023a0d  b4 3d                mov ah, 0x3d
023a0f  b0 02                mov al, 2
```

and `python3 re/work/x86.py 0x23ad2 +0x14` (the actual set-vector, right after `lcall 0x131e,0xc4cf`):

```
023ad2  9a cf c4 1e 13       lcall 0x131e, 0xc4cf
023ad7  1e                   push ds
023ad8  8b 16 9c b9          mov dx, word ptr [0xb99c]
023adc  a1 9e b9             mov ax, word ptr [0xb99e]
023adf  8e d8                mov ds, ax
023ae1  b4 25                mov ah, 0x25
023ae3  b0 09                mov al, 9
```

Decoding: FUN_231e_0677 @0x23677 (reached from the init path) saves INT 24h (0x239d1) and
INT 9 (0x239ef), stashes the old INT 9 seg/ofs in DS:0xb998 / DS:0xb99a, and records the
replacement offset CS:0xab7 in DS:0xb99c with the segment in DS:0xb99e. The vector is only
*installed* at 0x23ae1 (INT 21h ah=25h al=09h) after the dispatcher/resource loader
`lcall 0x131e,0xc4cf` (FUN_231e_c4cf @0x2f6af) returns.

### The INT 9 handler body (linear 0x23c97..0x23dd5, = CS:0xab7)

verbatim `python3 re/work/x86.py 0x23c97 +0x48`:

```
023c97  50                   push ax
023c98  57                   push di
023c99  1e                   push ds
023c9a  0e                   push cs
023c9b  1f                   pop ds
023c9c  e4 60                in al, 0x60
023c9e  50                   push ax
023c9f  e4 61                in al, 0x61
023ca1  50                   push ax
023ca2  0c 80                or al, 0x80
023ca4  e6 61                out 0x61, al
023ca6  58                   pop ax
023ca7  e6 61                out 0x61, al
023ca9  58                   pop ax
023caa  50                   push ax
023cab  b0 20                mov al, 0x20
023cad  e6 20                out 0x20, al
023caf  58                   pop ax
023cb0  3c 48                cmp al, 0x48
023cb2  75 0f                jne 0x23cc3
023cb4  2e c6 06 3c 00 01    mov byte ptr cs:[0x3c], 1
023cba  2e c6 06 3d 00 00    mov byte ptr cs:[0x3d], 0
023cc0  e9 0b 01             jmp 0x23dce
023cc3  3c c8                cmp al, 0xc8
023cc5  75 0f                jne 0x23cd6
023cc7  2e c6 06 3c 00 00    mov byte ptr cs:[0x3c], 0
023ccd  2e c6 06 3d 00 00    mov byte ptr cs:[0x3d], 0
023cd3  e9 f8 00             jmp 0x23dce
023cd6  3c 4b                cmp al, 0x4b
023cd8  75 0f                jne 0x23ce9
verbatim `python3 re/work/x86.py 0x23d48 +0x8e` (tail of the ISR):

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
```

| scancode | effect | flag |
|---|---|---|
| 0x48 / 0xc8 | Up make / break | cs:[0x3c]=1, cs:[0x3d]=0 / both 0 |
| 0x50 / 0xd0 | Down make / break | cs:[0x3d]=1, cs:[0x3c]=0 / both 0 |
| 0x4d / 0xcd | Right make / break | cs:[0x40]=1, cs:[0x41]=0 / both 0 |
| 0x4b / 0xcb | Left make / break | cs:[0x41]=1, cs:[0x40]=0 / both 0 |
| 0x39 / 0xb9 | Space make / break | cs:[0x3f]=1 and all four arrows cleared / cs:[0x3f]=0 |
| 0x3b / 0xbb | F1 make / break | cs:[0x3e]=1 / 0 |
| 0x1d / 0x9d | Left Ctrl make / break | cs:[0x44]=1 / 0 |
| 0x38 / 0xb8 | Left Shift make / break | cs:[0x43]=1 / 0 |
| anything | 0x23dce `mov cs:[0x42],al` — last raw scancode (make or break) is latched | cs:[0x42] |

Because of the `cs:` override these bytes are not in the code image: CS base 0x131e:0 is
linear 0x131e0, i.e. DS:0x31e0, so the flags live at linear 0x1321c..0x13224 (file
0x401c..0x4024) = DS:0x321c..0x3224. `cmp byte ptr cs:[0x42],0x3c` at 0x23c62 is therefore
"the last scancode was '5'".

Consumers (verbatim `python3 re/work/x86.py 0x23c62 +0x30`):
023c62  2e 80 3e 42 00 3c    cmp byte ptr cs:[0x42], 0x3c
023c68  75 08                jne 0x23c72
023c6a  c6 06 a5 46 01       mov byte ptr [0x46a5], 1
023c6f  eb 1a                jmp 0x23c8b
023c71  90                   nop
023c72  80 3e a5 46 01       cmp byte ptr [0x46a5], 1
023c77  75 0d                jne 0x23c86
023c79  2e 80 3e 42 00 43    cmp byte ptr cs:[0x42], 0x43
023c7f  75 05                jne 0x23c86
023c81  c6 06 e6 3b 01       mov byte ptr [0x3be6], 1
023c86  c6 06 a5 46 00       mov byte ptr [0x46a5], 0
023c8b  2e c6 06 42 00 00    mov byte ptr cs:[0x42], 0

- 0x23c62..0x23c8b (loop body, runs for **every** mode, including modes 0 and 5 where no
  handler executes): scancode 0x3c ('5') sets DS:0x146a5; then, once that latch is set,
  scancode 0x43 ('2') sets DS:0x13be6 — a two-key cheat sequence. DS:0x13be6 is the gate
  read by the state-1 handler at 0x2e79e/0x2e832/0x2e866 (the `cmp al,0x44` 'D' arm and the
  0x0d/0x0c arms). cs:[0x42] is cleared at 0x23c8b so each press is consumed once.
- pump FUN_231e_0bf6 @0x23dd6 reads the hold-flags (verbatim `python3 re/work/x86.py 0x24440 +0x75`):
024440  74 08                je 0x2444a
024442  2e 80 3e 40 00 01    cmp byte ptr cs:[0x40], 1
024448  75 27                jne 0x24471
02444a  80 3e 93 3c ff       cmp byte ptr [0x3c93], 0xff
02444f  7f 1c                jg 0x2446d
024451  c6 06 93 3c 01       mov byte ptr [0x3c93], 1
024456  80 f9 00             cmp cl, 0
024459  75 02                jne 0x2445d
02445b  b1 20                mov cl, 0x20
02445d  fe c9                dec cl
02445f  88 0e 92 3c          mov byte ptr [0x3c92], cl
024463  9a 58 04 1e 13       lcall 0x131e, 0x458
024468  9a 45 00 1e 13       lcall 0x131e, 0x45
02446d  fe 0e 93 3c          dec byte ptr [0x3c93]
024471  83 3e 5b 4d 01       cmp word ptr [0x4d5b], 1
024476  74 08                je 0x24480
024478  2e 80 3e 3c 00 01    cmp byte ptr cs:[0x3c], 1
02447e  75 14                jne 0x24494
024480  83 3e 98 3c 22       cmp word ptr [0x3c98], 0x22
024485  7d 30                jge 0x244b7
024487  83 06 98 3c 03       add word ptr [0x3c98], 3
02448c  9a dd 02 1e 13       lcall 0x131e, 0x2dd
024491  e9 45 f9             jmp 0x23dd9
024494  83 3e 5d 4d 01       cmp word ptr [0x4d5d], 1
024499  74 08                je 0x244a3
02449b  2e 80 3e 3d 00 01    cmp byte ptr cs:[0x3d], 1
0244a1  75 14                jne 0x244b7
0244a3  83 3e 98 3c de       cmp word ptr [0x3c98], -0x22
0244a8  7e 0d                jle 0x244b7
0244aa  83 2e 98 3c 03       sub word ptr [0x3c98], 3
0244af  9a dd 02 1e 13       lcall 0x131e, 0x2dd

## §3 (input) — the pump FUN_231e_0bf6 @0x23dd6 (called once per loop pass at 0x23c1c)

verbatim `python3 re/work/x86.py 0x23dd6 +0x4a`:

```
023dd6  53                   push bx
023dd7  51                   push cx
023dd8  52                   push dx
023dd9  b0 80                mov al, 0x80
023ddb  e6 43                out 0x43, al
023ddd  e4 42                in al, 0x42
023ddf  8a d8                mov bl, al
023de1  e4 42                in al, 0x42
023de3  8a f8                mov bh, al
023de5  81 fb 18 79          cmp bx, 0x7918
023de9  77 02                ja 0x23ded
023deb  eb ec                jmp 0x23dd9
023ded  b0 b0                mov al, 0xb0
023def  e6 43                out 0x43, al
023df1  b8 18 79             mov ax, 0x7918
023df4  e6 42                out 0x42, al
023df6  8a c4                mov al, ah
023df8  e6 42                out 0x42, al
023dfa  b0 01                mov al, 1
023dfc  e6 61                out 0x61, al
023dfe  9a e4 42 1e 13       lcall 0x131e, 0x42e4
023e03  80 3e 72 35 00       cmp byte ptr [0x3572], 0
023e08  74 17                je 0x23e21
023e0a  80 3e 72 35 01       cmp byte ptr [0x3572], 1
023e0f  75 08                jne 0x23e19
023e11  9a 5c 53 1e 13       lcall 0x131e, 0x535c
023e16  eb 4e                jmp 0x23e66
023e18  90                   nop
023e19  9a d9 56 1e 13       lcall 0x131e, 0x56d9
023e1e  eb 46                jmp 0x23e66
```

- 0x23dd6..0x23dd8 prologue: `push bx/cx/dx` only (3 slots, popped by the single epilogue at
  0x24507). Every internal re-pump path jumps to **0x23dd9** (after the pushes), so restarts
  do not grow the stack.
- 0x23dd9..0x23dfc: PIT channel-2 rate limiter — `out 0x43,0x80` / two `in 0x42` reads until
  the count passes 0x7918, then `out 0x43,0xb0` + reload 0x7918; `out 0x61,1` drives the
  speaker gate. This is the frame clock for every mode, including modes 0 and 5.
- 0x23dfe `lcall 0x131e,0x42e4` = FUN_231e_42e4 @0x274c4 (per-frame animation/timer tick).
- 0x23e03..0x23e20: **the only input-gatherer selection in the pump**, on DS:0x13572:
  - 0 (default) → `lcall 0x131e,0x4b35` = FUN_231e_4b35 @0x27d15 — contains the INT 16h pair
    (0x28429, 0x28432) and 14 INT 33h sites; this is the keyboard/mouse event source.
  - 1 → FUN_231e_535c @0x2853c — no INT 16h/33h, one INT 10h (0x28622).
  - >=2 → FUN_231e_56d9 @0x288b9 — no INT 16h/33h, one INT 10h (0x2897d).
  DS:0x13572 is the value cycled by the ',' key in the state-1 handler (0x2e7ab: `inc` while
  `< 2`, then full redraw). UNCONFIRMED what the two non-default gatherers do; they are
  reached only after that keypress.
- 0x23e3c `lcall 0x131e,0x3542` = FUN_231e_3542 @0x26722; 0x23e41 `lcall 0x131e,0x91ed` =
  FUN_231e_91ed @0x2c3cd (the routine whose tail is 0x2c3cd+…; it is the one that calls
  FUN_231e_99c2 in the state-2 handler).
- 0x23e66..0x23e9e: the animation/scheduler call-out block (FUN_231e_5a22 @0x28c02,
  FUN_231e_8de4 @0x2bfc4 every 5th pass via DS:0x154c4, FUN_231e_4dc7, FUN_231e_4673,
  FUN_231e_8043, FUN_231e_bdc8 @0x2ed48, FUN_231e_aa7d, FUN_231e_6710).
- 0x23e9e..0x23f07: countdown timers DS:0x13c16 / DS:0x13c18; when DS:0x13c16 hits 0 with
  sound enabled (DS:0x13ade==1) and **mode == 1** (`cmp byte [0x3c91],1` at 0x23eb9) it
  re-inits sound via FUN_231e_3708 @0x268e8.

### pump epilogue: how the event code in AL is produced and filtered

verbatim `python3 re/work/x86.py 0x244b7 +0x54`:

```
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
```

Decoding of the epilogue (0x244b7..0x2450a):

- 0x244b7..0x244e9: a mode-2-only back door (`cmp byte [0x3c91],2`): with DS:0x146a7 unset,
  event 0x44 ('D') latches DS:0x146a7=1; once latched, event 0x41 ('A') sets DS:0x13be6=1,
  DS:0x13c5c=0x2bc and primes the scheduler slots DS:0x1359b=0x32, DS:0x135a1=0x14.
  DS:0x13be6 is the same flag the state-1 handler gates on (0x2e79e, 0x2e832, 0x2e866), so
  this is a debug/cheat key sequence handled **inside the pump**, independent of mode.
- 0x244ef `cmp al,0x7f` / `jbe 0x244fb`: AL is the event code produced by the INT 16h path in
  the gatherer (the pump's draw/animation callees all push/pop AX, e.g. FUN_231e_7e6d
  0x2b04d/0x2b19d, which is what preserves it across 0x23e37→0x244ef).
  - AL > 0x7f → `mov byte [0x5bb8],0` (DS:0x15bb8 = "last event was not ASCII") and
    `jmp 0x23dd9`: the pump **restarts its own wait cycle without returning**, so a raw
    scancode event never reaches a mode handler. Arrow keys are consumed by the pump via the
    cs:[0x3c..0x41] hold-flags written by the INT 9 handler (0x24442/0x24446/0x24478/0x2449b),
    each moving DS:0x13c98 by ±3 and calling FUN_231e_02dd @0x234bd (scroll redraw).
  - AL <= 0x7f → DS:0x15bb8=1 (latched ASCII) and fall through to 0x24507: `pop dx/cx/bx;
    ret` — one near return to the loop at 0x23c1f with AL = the event the mode handler sees.
  Consequence for §3: **modes 0 and 5 receive no key events at all through this path**; the
  only input they observe is whatever the pump and the scheduler consume internally.

### gatherer FUN_231e_4b35 @0x27d15 keyboard/mouse detail

verbatim `python3 re/work/x86.py 0x2841b +0x1c`:

```
02841b  3a 16 5c 45          cmp dl, byte ptr [0x455c]
02841f  72 39                jb 0x2845a
028421  3a 16 5c 45          cmp dl, byte ptr [0x455c]
028425  77 30                ja 0x28457
028427  b4 01                mov ah, 1
028429  cd 16                int 0x16
02842b  75 03                jne 0x28430
02842d  e9 5b ff             jmp 0x2838b
028430  b4 00                mov ah, 0
028432  cd 16                int 0x16
028434  3c 00                cmp al, 0
```

- 0x28401..0x28416 `mov ax,4 / mov cx,0x21c / mov dl,[0x455a] / shl dx,3 / sub dx,4 /
  int 0x33` = INT 33h ax=4 (set pointer position) onto the highlighted list row; `int 16h`
  ah=1 poll at 0x28429, and if a key is pending `int 16h` ah=0 to
  consume it at 0x28432; AH 0x48/0x50 (↑/↓ break-free make codes) route to the row
  inc/dec paths at 0x284b5 / 0x2845a, which move DS:0x455c within [DS:0x455a .. DS:0x4559]
  and reposition the hardware cursor with INT 33h ax=4 (0x284aa, 0x284f7).
- AL==0 with the list already at an edge → `mov al,[0x455c]; sub al,[0x455a]` (0x2844d..0x28450)
  so the *count* becomes the returned event code.
- 0x28505..0x28531: mouse/keyboard re-arm sequence guarded by `cmp byte [0],0` (the
  mouse-present flag): INT 33h ax=8 (light-pan range) cx=0x3e dx=0xc6, ax=4 (set position)
  cx=0x21c dx=0x64, ax=7 (double-speed) cx=0x1c2 dx=0x27e, ax=1 (show cursor).

## implemented in loop.js

Appended by the web/src/engine/loop.js implementation pass. Nothing above this section was
edited. `node --check web/src/engine/loop.js` is clean.

Mode numbering, checked against the bytes rather than the heading: `python3 re/work/x86.py
0x23c1c +0x48` prints `cmp byte ptr [0x3c91], 1` @0x23c1f with `lcall 0x131e, 0xb509` @0x23c26, so
the correction section holds — 0x2e6e9 = FUN_231e_b509 is the STATE-1 handler. STATE_VALUES in
loop.js is keyed 1..4 = 0x2e6e9 / 0x2e9e9 / 0x2eb8c / 0x2ea8d (verified independently against
re/work/loop/refs_3c91.txt: FUN_231e_b509 writes [0x3c91] at 0x2e6ef, b809 at 0x2e9fb, b8ad at
0x2ea9f, b9ac at 0x2eb9e); modes 0 and 5 dispatch nothing, because `jne 0x23c62` @0x23c60 is
`75 00`.

resolved (rows now carry addresses in loop.js instead of TODOs):
- INT 9: 9 flag bytes at linear 0x1321c..0x13224 (`INT9_FLAGS`) + 16 scancode arms
  (`INT9_ARMS`), the universal latch cs:[0x42] @0x23dce and the `iret` @0x23dd5.
- state-1 event table: 14 of 18 arms (`STATE1_ARMS`) — 0x1e -> mode 3 @0x2e6ef, 0x11 -> mode 4
  @0x2e705, 0x1f @0x2e714, 0x12 -> mode 2 @0x2e722, 0x35 @0x2e731, 0x3b/0x01 -> menu 0x2cba2 ->
  mode 1 @0x2cbae, 0x2e @0x2e753, '1' @0x2e75f/0x2e764, '2' @0x2e770, '<' @0x2e77c/0x2e783,
  '=' @0x2e78d/0x2e794, 'D' @0x2e79e/0x2e7a5, ',' @0x2e7af..0x2e7db.
- §2 draws: 5 rows (`STATE1_DRAWS`) — blit 0x2b04d @0x2e6f2/0x2e708/0x2e725, rebuild pair
  0x23638+0x23225 @0x2e7c2/0x2e802, message 0x264be @0x2e7e6/0x2e826, panels 0x2c5d9/0x2c646
  @0x2e8f1/0x2e8f4, row 0x2c307 @0x2e92b. `advance()` records every row that fires in state.draws.
- pump: gatherer select on DS:0x13572 @0x23e03/0x23e11/0x23e19; one int 16h event per pass
  @0x28429/0x28432; Up/Down hold-flag scroll of DS:0x13c98 by +/-3 @0x24487/0x244aa, clamped
  @0x24480/0x244a3, redraw @0x2448c/0x244af, re-pump @0x24491; epilogue ASCII filter
  @0x244ef..0x24502; mode-2 "D"/"A" back door @0x244be..0x244e9; timing tail @0x23c62..0x23c8b as
  the "5"-then-"2" cheat sequence.
- 23 DS global rows (`GLOBALS`), including the reclassification of the old tick/pending60/grace
  trio as lastScancode 0x13222 / fiveLatch 0x146a5 / cheatGate 0x13be6.

still TODO in loop.js (22 distinct names, each comment carrying its reason):
- TODO_BOOT@0x23c12 — nothing in this doc says what INIT_CALL leaves in DS:0x13c91, so
  initialState().mode stays null instead of guessing 1.
- TODO_ARMS@0x2e9e9 / @0x2ea8d / @0x2eb8c and TODO_DRAWS@ those addresses — state-2/3/4 handler
  bytes are not quoted here; only the shared menu write @0x2cbae is documented for them.
- TODO_GATHERERS — UNCONFIRMED, as marked above: FUN_231e_535c @0x2853c and FUN_231e_56d9
  @0x288b9. While DS:0x13572 != 0 the port produces no event code at all.
- TODO_EVENT_CODE@0x28432 — there is no key -> (AH,AL) table in this doc: the numeric codes the
  arms compare (0x1e/0x11/0x12/0x1f/0x35/0x13..0x1a) are not tied to any key, and the list-count
  producer @0x2844d..0x28450 needs undocumented DS:0x14559/0x1455a/0x1455c.
- TODO_INPUT_MOUSE@0x27d15 — no int 33h ax=5 / ax=0bh button read is quoted (only ax=1/2/4/7/8),
  so pointer input cannot become an event code yet.
- TODO_SINK_AL@0x29997 ("possibly unchanged" AL after codes 0x13..0x1a).
- TODO_ARM_ORDER@0x2e7db, TODO_ARM_0x0d@0x2e832, TODO_ARM_0x0c@0x2e866, TODO_ARM_0x05@0x2e8f1,
  TODO_ARM_0x03@0x2e92b — 0x2e7dc..0x2e985 is unquoted, so those four arms sit behind the quoted
  chain in the port.
- TODO_SCROLL_RIGHT@0x24442, TODO_SCROLL_LEFT@0x24446 — see the discrepancy note below.
- TODO_TIMERS@0x23e9e (DS:0x13c16/0x13c18 decrements, mode==1 re-init @0x23eb9),
  TODO_ANIM@0x274c4, TODO_BUFFER@0x28429, TODO_KEYUP@0x23cc7 (web/src/main.js emits no keyup, so
  break codes never arrive), TODO_F1_AL@0x2e737, TODO_CONSUMER@0x1321f/0x13223/0x13224,
  TODO_GLOBAL@0x15c1a/0x13c92/0x15bbb/0x13c95/0x13c5c/0x1359b/0x135a1/0x13c93/0x14d5b/0x14d5d/
  0x13c16/0x13c18/0x13c60, TODO_LEVEL2PLUS@0x2e82e, TODO_MODE_n, TODO_INPUT@0x23dd6,
  TODO_ANCHOR_0x267f9.

discrepancy found while porting (does not retract anything above):
- The §3 bullet "Arrow keys are consumed by the pump via the cs:[0x3c..0x41] hold-flags
  (0x24442/0x24446/0x24478/0x2449b), each moving DS:0x13c98 by +/-3" matches the quoted bytes only
  for Up (0x24485..0x2448c) and Down (0x244a3..0x244af). 0x24442 is the cs:[0x40] (Right) test and
  it leads to the DS:0x13c93/DS:0x13c92 repeat block plus the rebuild pair @0x24463/0x24468, not a
  scroll; and 0x24446 is a displacement byte inside the 0x24442 instruction
  (`2e 80 3e 40 00 01`), not a site, and no `cmp byte ptr cs:[0x41],1` (Left) appears in any
  quoted byte. Left/Right scrolling is therefore not modelled and stays a named TODO.
- The Down arm's continuation at 0x244b4..0x244b6 is not quoted, so loop.js infers its re-pump
  from the Up arm's `jmp 0x23dd9` @0x24491; both arms merge at 0x244b7 either way.

---

# APPENDIX C — handler inventories for states 2, 3 and 4 (30 Oct, inline capstone pass)

`re/game-loop-modes.md` §2 and the "implemented in loop.js" note both carried
`TODO_ARMS@0x2e9e9 / @0x2ea8d / @0x2eb8c — handler bytes not quoted`. They are quoted now. Source:
`python3 re/work/x86.py <start> <end>` (capstone 16-bit, `linear = file + 0xf200`), cross-checked
against `re/decomp/SOLAR1.c` FUN_231e_b809 / FUN_231e_b8ad / FUN_231e_b9ac. Every far target below
resolves as `0x131e:off -> 0x231e0 + off`, which is how the shared blit gets identified:
`lcall 0x131e,0x7e6d` -> **0x2b04d**, the `rep movsb` out of the `DS:[0x6b9d]` scratch page.

## C.1 The three handlers share the same first three arms

| arm | state 2 (0x2e9e9) | state 4 (0x2ea8d) | state 3 (0x2eb8c) | effect |
|---|---|---|---|---|
| `cmp al,0x3b` (F1) | 0x2e9e9 / call 0x2e9ed | 0x2ea8d / call 0x2ea91 | 0x2eb8c / call 0x2eb90 | `lcall 0x131e,0x99c2` = FUN_231e_99c2 @0x2cba2, the shared in-game menu; it writes DS:0x13c91 = 1 @0x2cbae |
| `cmp al,0x01` (Esc) | 0x2e9f5 / 0x2e9fb, 0x2e9fe | 0x2ea99 / 0x2ea9f, 0x2eaa2 | 0x2eb98 / 0x2eb9e, 0x2eba1 | `mov [0x3c91],1` **then** `lcall 0x131e,0x7e6d` @0x2b04d |
| `cmp al,0x35` ("5") | 0x2ea06 / 0x2ea0a | 0x2eaa6 / 0x2eaae | 0x2eba9 / 0x2ebad | `lea bx,[msg]` (2:[0xa690], 4:[0xace4], 3:[0xae6d]) + `lcall 0x131e,0x8bdc` @0x2b892 (message center) + `lcall 0x131e,0x2f4d` @0x25f4d + `lcall 0x131e,0x8a92` @0x2bc72 |

**This closes `TODO_DRAWS@0x2e9e9 / @0x2ea8d / @0x2eb8c` for the Escape arm specifically**: leaving
states 2/3/4 draws the scratch page through FUN_231e_7e6d @0x2b04d, exactly the callee §2 documents
for the state-1 mode writes. What is still unknown, and unchanged, is *which file last filled* that
page — so the port can now say "a blit happens on Escape" but still cannot say which art it shows.

## C.2 state 2 — FUN_231e_b809 @0x2e9e9, the crew/member picker

`0x2ea20 cmp al,8 / 0x2ea22 ja 0x2ea87` — everything else falls to the sink `lcall
0x131e,0x67b7` @0x29997 (0x2ea87), same callee as the state-1 sink.

For AL in 1..8 (0x2ea24 dec al -> 0-based index bx):

| site | what it proves |
|---|---|
| 0x2ea2a `cmp word ptr [bx+0x35af],0` / 0x2ea2f je 0x2ea87 | a 8-entry word table at DS:0x135af gates the pick: a zero entry means "not there", and the arm does nothing |
| 0x2ea31 `cmp byte ptr [0x3c4a],al` / jne | re-selecting the current member is a no-op |
| 0x2ea42 / 0x2ea4a `mov byte ptr [0x3c4a],al` | DS:0x13c4a = the selected member index (0-based) |
| 0x2ea4d..0x2ea50 `mov al,0xff; mov [0x5c1a],al` | DS:0x15c1a = 0xff, the same latch the pre-loop write @0x23c08 sets |
| 0x2ea53 `lcall 0x131e,0x458` -> 0x23638 | the full rebuild (same callee §2 lists for the gatherer's rebuild) |
| 0x2ea58 `lcall 0x131e,0x45` -> 0x23225 | called only in the `al==1 \|\| prev<2` branch (0x2ea3e..0x2ea48) |
| 0x2ea6b / 0x2ea7f `lcall 0x131e,0x7fc0` twice, with `mov al,0x1e` then `mov al,0x1d`, `mov di,[bx+0x35d3]` | the name-write helper (§C.4) run for the new member then the old one, DI from a pointer table at DS:0x135d3 |

Keys, via re/event-codes.md: `1`..`8` select members 0..7. Nothing else in state 2 draws.

## C.3 state 4 — FUN_231e_b8ad @0x2ea8d, two matched pointer tables

After the shared arms, 0x2eac4 walks `si = 0..0x14 step 2` (10 entries) comparing
`ax` against `[si+0x5b90]`, gated by `[si+0x3573] != 0` (0x2eacf) and `[0x5bb8] == 1` (0x2ead6). On
a hit: `lcall 0x131e,0x7fc0` with `al=0x1e` and `di=[bx+0x3587]` (0x2eae6), `call 0x2c5d9`, then the
same helper with `al=0x1d`; `si/2+1` becomes the new `[0x3c4b]` (0x2eb27), `[0x3c94]` cycles 1..4
(0x2eb0c..0x2eb24), `call 0x2c646`. A second, structurally identical walk follows at 0x2eb38 over
`[si+0x5ba4]` gated by `[si+0x359b]`, writing `[0x3c4c]` and calling `lcall
0x131e,0x9127` -> 0x2c307.

Meaning of 0x5b90/0x5ba4 (match keys), 0x5bb8 (must equal 1) and 0x3c4b/0x3c4c/0x3c94 is undetermined:
TODO_MEANING@0x5b90, TODO_MEANING@0x5bb8, TODO_MEANING@0x3c94.

## C.4 The `0x7fc0` name-write, and state 3 — FUN_231e_b9ac @0x2eb8c, a pager

FUN_231e_7fc0 @0x2a1c0 takes AL = a row number (0x1e = 30, 0x1d = 29) and DI = a string pointer,
and writes the text into the screen buffer: 0x2a1c8 `cmp byte [0x3ade],0` skips it when sound is
off — the same DS:0x13ade the "1" arm xors in state 1 (§2) is therefore a *message-display* enable,
not a sound-only flag. TODO_MEANING@0x3ade is narrowed but not closed.

State 3's own arms are page navigation on a record count at DS:0x13c56 and a cursor at DS:0x13c8e,
both gated by `[0x3c56] != 0` and `[0x5bb8] == 1`:

| key | code | sites | effect |
|---|---|---|---|
| Enter | 0x0d | 0x2ebc3, inc 0x2ebd5 | `++[0x3c8e]`; wraps to 1 when it exceeds `[0x3c56]` (0x2ebe2) |
| Ctrl+L | 0x0c | 0x2ebe9, dec 0x2ebfd | `--[0x3c8e]`; wraps to `[0x3c56]` at 0 (0x2ec09) |
| Ctrl+T | 0x14 | 0x2ec12 / call 0x2ec1d -> 0x2ec35 | the local at 0x2ec35: if `[0x3c56]==0` -> `lea bx,[0x588e]` + `lcall 0x131e,0x32de` (message center, 0x28558), else page through records |
| Ctrl+V | 0x16 | 0x2ec23 / call 0x2ec2e -> 0x2ed2b | the other pager direction |

So state 3 is a paginated list screen driven by Enter/Ctrl+L, and it draws nothing itself: no
`lcall 0x131e,0x7e6d` anywhere in 0x2eb8c..0x2ec34 except the Escape arm.

## C.5 What loop.ts gained from this

`STATE_VALUES[2].arms`, `[3].arms`, `[4].arms` are now real rows with the sites above, and
`TODO_ARMS@0x2e9e9 / @0x2ea8d / @0x2eb8c` and `TODO_DRAWS@` those addresses are replaced by
`TODO_ART_SOURCE@0x2b04d` (which file filled the scratch page) and the meaning TODOs in C.2-C.4.

### C.7 One consequence of the scancode reading, found while wiring the browser keys

If every `cmp ax,imm16` in the four handlers is a **raw set-1 make code** (§0), then the labels in
§5.1 that read like characters are not characters:

| doc label | arm | as a make code | as ASCII |
|---|---|---|---|
| `0x1e` @0x2e6ef | A -> mode 3 | `A` key ✓ | RS (record separator) ✗ |
| `0x11` @0x2e705 | W -> mode 4 | `W` key ✓ | DC1 ✗ |
| `0x12` @0x2e722 | E -> mode 2 | `E` key ✓ | DC2 ✗ |
| `0x01` @0x2e747 | Escape | Escape ✓ | SOH ✗ |
| `0x02`..`0x08` @0x2ea2a | states 2's crew picks | `1,2,3,4,5,7,8` keys — **and 0x06 is `6`**, so the run of "1..8" is really 1,2,3,4,5,6,7,8 by make code ✓ | Ctrl-B..Ctrl-H ✗ |
| `0x3c`/`0x3d` @0x2e778/@0x2e789 | "<" / "=" | **F2 / F3** | `<` / `=` ✓ |
| `0x44` @0x2e79a | "D" (needs the 0x13be6 gate) | F10 | `D` ✓ |
| `0x2c` @0x2e7ab | "," | `,` (make 0x2c) — **the two readings agree here** | `,` ✓ |
| `0x0c`/`0x0d` @0x2ebe9/@0x2ebc3 | state 3's pagers | `-` / `=` keys ✓ | Ctrl-L / Ctrl-M (`Enter`) ✗ |
| `0x14`/`0x16` @0x2ec12/@0x2ec23 | state 3's pagers | `t` / `u` keys ✓ | Ctrl-T / Ctrl-V ✗ |

So the letter rows and the pager rows agree with the scancode reading, and `<`, `=`, `D` only make
sense as ASCII (F2/F3/F10 are not a plausible "<", "=", "debug key" triple), while `,` is the same
byte either way. Both cannot be right for one producer, which means
the game switches readers — exactly what §0 predicts for the two code paths: `0x2e6ef..0x2e7ab` is
reachable from a vector-installed phase (scancodes) while the pump's back door at `0x2451c`
(`cmp al,0x41`, "event 0x41 'A'") sits after `mov word ptr cs:[0x16],0x23e03` @0x24f9a, i.e. after
the BIOS INT 9 handler is restored and the **int 16h** path is live. The cleanest consistent story is
that mode 1's letter arms are scancodes, and the punctuation arms are ASCII from the int 16h queue.

Port stance: rows are keyed by whichever reading makes them a real key, each row cites its arm, and
the two ambiguous sites are `TODO_EVENT_CODE@0x2e789` and `TODO_EVENT_CODE@0x2ebe9`. Nothing is
bound by guess; `web/src/engine/loop.ts` INPUT_KEYS carries the reasoning inline.


---

# APPENDIX E — `lcall 0x131e,0x7e6d` @0x2b04d is the page compositor, and its art is BH_PAN.DAT

Closes `TODO_ART_SOURCE@0x2b04d`, the item that made every mode change invisible.

## What it is

`FUN_231e_7e6d` takes **AL = the mode byte itself** (`mov bl,al` @0x2b061 after `mov al,[0x3c91]` at
each call site). It is not a "blit from file" routine: it selects one of two compositing modes.

```
@0x2b053  cmp byte [0],0 / je     ; mouse-present flag, int 33h ax=2 @0x2b05b (cursor off, restored by pop ax)
@0x2b061  mov bl,al
@0x2b063  cmp bl,1 / jne 0x2b06b / jmp 0x2b0d8      ; page 1 -> the strip path
@0x2b06b  mov cx,[0x6b9d] / mov es,cx / mov di,0    ; arena segment, record walk
@0x2b074  cmp bl,2 / je 0x2b08f                     ; skip (page-2) records, decrementing BL
@0x2b079    cl = es:[di] (w), al = es:[di+1] (h), di += 2 + w*h, dec bl, repeat
@0x2b08f  al/ah = the selected record's w,h ; di += 2 -> its pixels ; si = di
@0x2b0a2  di = [0x6bb3]                             ; destination offset in VRAM
@0x2b0ac  ah = 0x87 ; @0x2b0ae cx = 0x5b ; rep movsb ; @0x2b0b3 di += 0xe5  -> 91 x 135 from (228,65)
@0x2b0c3  di = [0x6bb3]-1 ; 110 x mov byte es:[di],0x8f ; di += 0x140       -> the border column
@0x2b14a  (page != 1) second box: 93 x 65 from ES:[0x9871] to A000:0xe3
@0x2b0d8  page 1 -> restore a 94-column strip (x=0xe2) for 200 rows from the scratch page [0x6b9f]
```

## Why the art is BH_PAN.DAT (the arithmetic, not a guess)

BH_PAN.DAT (dispatcher slot 8, stone variant) decodes to exactly five records:
`91x135, 91x135, 91x135, 90x24, 93x65`.

* `cx=0x5b` and `ah=0x87` @0x2b0ae/`@0x2b0ac` are 91 x 135 — the first three records.
* The walk's stop condition `cmp bl,2` makes **page N use record N-2**, so
  mode 2 -> record 0, mode 3 -> record 1, mode 4 -> record 2.
* `ES:[0x9871]` is the arena offset of record 4's pixels: three `91x135` records at 2 + 12285 bytes
  each (= 0x8FFD), then the `90x24` record at 2 + 2160 (= 0x986F), then record 4's 2-byte header —
  39023 + 2 = **0x9871**. Same walk gives 0x8FFF for record 3, which is the other literal in the
  routine. It is painted last, which is why it reads as an overlay *on top of* the panel.
* `DS:[0x6bb3] = 0x5224` in the EXE's data segment, and `0x5224 = 65*320 + 228` @0x2b0a2.
* Rendering it proves the identification: the three records are the **ENGINEERING**, **CARGO** and
  **WEAPONS** panels (`re/work/pics/PAN_pages_2_3_4.png`), and each matches its handler's arms —
  CARGO carries the `<` / `>` arrows state 3's pager arms move, WEAPONS carries the letter grid
  state 4's table arms read, ENGINEERING carries POWER DIST. / REACTOR / SHIELDS, which is what
  state 2's stat keys spend against.

`0x8f` is the panel's own left border colour (143), stamped down column 227 for 110 rows.

## State 1's arm chain

`re/event-chain-state1.md` dumps @0x2e6e9..@0x2e986 completely (capstone over the shipped bytes),
which closes `TODO_ARM_ORDER@0x2e7db` and `TODO_KEYMAP@0x2e76c` and corrects the arm rows below:
0x31/0x32/0x35 are the letters **n / m / /**, the digits are 0x02..0x0b, and the four digit arms are
presence-table cursor movers gated on `DS:0x13ade == 1` @0x2e885.

Consequently this file's earlier note that "the punctuation arms are ASCII from the int 16h queue"
is retired: F2/F3/F10 are function-key make codes (0x3c/0x3d/0x44) and `<`/`=`/`D` were the port's
labels, not the game's. The single-producer model in `re/event-codes.md` holds everywhere.

## The actor walk's dispatch, byte-exact (closes the `0x7f` coarse-cell guess)

`FUN_231e_1364 @0x24544` iterates `bx = 0x3d8 + n*0xd` and, per actor, in this order:

| address | what it does |
|---|---|
| @0x2455f..@0x24573 | sector cull: three iterations of `si = 0,2,4`, each comparing `word [bx+si]` against `byte [si+0x3ce]` **and** `byte [si+0x3cf]`. So both axes are compared together, byte-interleaved (actor +0=X0, +1=Y0, +2=X1, +3=Y1, +4=X2, +5=Y2) against the camera's own interleaved five bytes `0x3ce..0x3d7`. Any mismatch jumps to the next actor @0x24554. |
| @0x24576..@0x24581 | appends nothing yet; it parks the actor address in the scratch cursor `DS:0x3ecd` |
| @0x24586..@0x24591 | `al = [bx+0xa]` = the **type**; `0xff` clears the collectable flag `[bx+0xb]` |
| @0x24592..@0x245ff | cell cull, with `si = 6`: compares `word [bx+6]` (actor +6=X3, +7=Y3) against `CX` built from `[0x3d4]`/`[0x3d5]`, testing the packed 3x3 neighbourhood (`dec cl`, `inc cl` ×2, `inc ch` ×2). Each probe leaves the *pixel* compensation in `DX` (0/0x100/0x200 = X) and `DI` (0/0x100/0x200 = Y). |
| @0x24616 | on a hit: `ax = [bx+8]` (actor +8=X4, +9=Y4) — the sub-cell pixels, which is where `dx`/`di` get folded in |
| @0x246c0..@0x2470a | stores the type to `DS:0x3e2f`; for `type != 0xff` appends `bx` to the **list at DS:0x3bf5** through the count word `DS:0x3bf3` (@0x246d2) — this is the table `s` and `c` consume. Then the actor's *previous* screen position is read from `DS:0xae + index*4` (`mov di,[bx+0xae]` → `DS:0x5c2d`, plus bytes `[bx+0xb0]`, `[bx+0xb1]` → `DS:0x3d32/0x3d33`), i.e. the four-byte prev record {u16 dest, u8 h, u8 shade} **is inside the save blob**, not the arena. |
| @0x2470c..@0x24719 | `type >= 0xc8` → `call 0x248dc` (the object drawer) and on to the next actor; otherwise `si = (type-1)*2`, `mov ax,[si-0x4660]` = **word at DS:0xb9a0 + (type-1)*2** — the BH_PLAN pointer table — with the segment from `DS:0x6ba1`. |
| @0x2472b..@0x24748 | record header: `es:[si]` = width → `DS:0x3d30`, `es:[si+1]` = height → `DS:0x3d31`, and the destination is **centre − width/2, centre − (height/2)·320**, `di` compared against `DS:0x6bbb` (0x7d71 = col 113, row 100). |

Two consequences for the port:

1. The object branch is a *call*, and the DS:0x3bf5 append happens before it (@0x246cd), so a ship whose
   art is unresolved is still in the frame list. `world.ts` now matches that order.
2. `call 0x248dc` is its own routine with a different table: `bl = [0x3e31] - 1`, `bx *= 0x20`, fields at
   `DS:0xe0f` (selector → `word [si-0x4598]` = **DS:0xba68 + sel*2**), `DS:0xe15`, `DS:0xe1f`, `DS:0xe20`,
   and the arena segment from `DS:0x6b99`. That is ship/hull art, still unported — `TODO_OBJECT_ART@0x2499d`.

## The boot frame really is empty

`BH_START.DAT` puts the camera at `X = 7f 7f 7f 63 4e`, `Y = 7f 7f 7f 78 e2` and `DS:0x3c98` speed = 6.
161 of the 201 actors pass the sector cull (they all carry `7f × 6`), but *none* has a cell within ±1 of
(0x63,0x78): their cell deltas span X −15..52, Y −20..82. The nearest object is the CLAW (actor #155,
type 0xcd, object code 1) at cell (0x60,0x7e) — three cells west, six north. `integration_check.mjs`
asserts this instead of hiding it, and proves sprite painting by parking the camera on a star record
(type 0x10 → BH_PLAN record 15, 1639 pixels over the cockpit page, bounding box x 89..139 / y 79..119
i.e. centred on the proven (113,100)).

So `s` and `c` say NOTHING IN RANGE / UNABLE TO COMMUNICATE at the shipped camera, and only start
describing things after you fly. Earlier versions of the checks passed by parking *after* pressing the
key; they now park, repaint, and then press, which is the shipped ordering.
## BH_SHIP.DAT is a raw-header / RLE-payload picture container (10 records)

Testing the loader's run rule (`@0x29773..@0x29797`: literal byte, or `0xff` then `count, value` emitting
`count` copies) *per record* instead of over the whole file is decisive:

```
[u8 a][u8 b] then RLE payload ...  -> 10 records, consumed 122444 of 122444 bytes exactly
(0, 43,105) (2201,180,171) (16509,181,255) (36779,138,255) (58074,220,218)
(86541,209,211) (115931,53,44) (117502,54,51) (119373,56,47) (121259,56,51)
```

The header is *not* compressed (the file starts `2b 69` = 43,105 in the clear) while the payload is, which
is why a global decompress desynchronises the walk after record 1. Payload lengths land within a few bytes
of `a*b` (4532 vs 4515 on record 1), so one run rule is still slightly off — likely a `0xff` with count 0,
or a run straddling the record end. `TODO_RUN_TAIL@0x2978c`.

Open: `@0x24924` reads the selector from `DS:0xe0f + index*0x20` (record +0) and indexes `DS:0xba68 + sel*2`,
and entry 0's selector is 0x19 = 25 — more records than BH_SHIP.DAT holds. So either that arena array is
built from a different file (its builder @0x297af is reached from the BH_INTn loader) or DS:0xe0f is not the
table the renderer's object branch uses. `TODO_OBJECT_ART@0x2499d` stays open with this evidence attached.
