# State 1's full event chain — `FUN_231e_b509` @0x2e6e9..@0x2e986

Target `SOLAR1.EXE`, sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.
Linear → file offset: `file = linear - 0xf200`. AL on entry is the raw set-1 **make code** latched by
INT 9 into `cs:[0x42]` and read at @0x24372 — see `re/event-codes.md`; the ASCII reading is refuted.
Disassembled here with capstone 5.0.7 (CS_ARCH_X86 / CS_MODE_16) directly from the shipped bytes;
every row below names the `cmp al,imm8` address that produced it.

This closes `TODO_ARM_ORDER@0x2e7db` (the verbatim dump in `re/game-loop-modes.md` stopped
mid-instruction at 0x2e7db, so 0x2e7dc..0x2e986 was unquoted) and `TODO_KEYMAP@0x2e76c`.

## The chain, in first-match order

| # | cmp site | code | key (set 1) | body |
|---|---|---|---|---|
| 1 | @0x2e6e9 | 0x1e | a | `mov [0x3c91],3` @0x2e6ef + compositor @0x2e6f2 → **CARGO** panel |
| 2 | @0x2e6ff | 0x11 | w | `mov [0x3c91],4` @0x2e705 + @0x2e708 → **WEAPONS** panel |
| 3 | @0x2e710 | 0x1f | s | `lcall 0x131e,0xa01c` @0x2e714 → @0x2d1fc, walks the script table `[di+0x3bf5]` (count DS:0x13bf3), reads `[bx+0xb]/[bx+0xc]`, `sub ax,0x500` |
| 4 | @0x2e71c | 0x12 | e | `mov [0x3c91],2` @0x2e722 + @0x2e725 → **ENGINEERING** panel |
| 5 | @0x2e72d | 0x35 | / | `call 0x2dd9f` @0x2e731 (holds the int 16h / int 21 ah=25 block @0x2ddba..@0x2ded5) |
| 6 | @0x2e737 | 0x3b | F1 | `lcall 0x131e,0x99c2` @0x2e73b → the shared menu @0x2cba2 |
| 7 | @0x2e743 | 0x01 | Esc | same menu @0x2e747 — **not** a "back" key in state 1 |
| 8 | @0x2e74f | 0x2e | c | `lcall 0x131e,0xa26d` @0x2e753 → @0x2d44d: re-installs the INT 9 vector (`int 21h ah=25 al=9` @0x2d461 from DS:0xb998/0xb99a), then walks the same script table; holds an int 16h @0x2d60b |
| 9 | @0x2e75b | 0x31 | n | `xor byte [0x3ade],1` @0x2e75f + `lcall 0x131e,0x3708` @0x2e764 (sound init). See the gate note below |
| 10 | @0x2e76c | 0x32 | m | `lcall 0x131e,0x3a81` @0x2e770 |
| 11 | @0x2e778 | 0x3c | F2 | gated `cmp [0x5bb8],1` @0x2e77c → `lcall 0x131e,0xbb5a` @0x2e783 |
| 12 | @0x2e789 | 0x3d | F3 | gated @0x2e78d → `lcall 0x131e,0xba64` @0x2e794 |
| 13 | @0x2e79a | 0x44 | F10 | gated `cmp [0x3be6],0 / jne` @0x2e79e → `mov word [0x3c95],1` @0x2e7a5 |
| 14 | @0x2e7ab | 0x2c | z | step **up**: `cmp [0x3572],2 / jb @0x2e7b9`; `inc [0x3572]`; `lcall 0x88f9` @0x2e7bd; `lcall 0x458` @0x2e7c2; `mov [0x5c1a],0xff` @0x2e7c7; `lcall 0x45` @0x2e7cc; if `[0x3572]==1` and `[0x3c60] <= 0x11` @0x2e7db then print @0x58b2 via `lcall 0x32de` @0x2e7e6 |
| 15 | @0x2e7ee | 0x2d | x | step **down**: `cmp [0x3572],0 / je 0x2e82e`; `dec [0x3572]` @0x2e7f9; same four callees @0x2e7fd/@0x2e802/@0x2e807/@0x2e80c; same message test @0x2e811..@0x2e826 |
| 16 | @0x2e82e | 0x0d | = | cheat-gated `cmp [0x3be6],0 / je` @0x2e832; `mov cx,[0x3c9a] / cmp cx,[0x3c5a] / jae` @0x2e83d; `inc [0x3c9a]` @0x2e843; if `[0x3c98] > 0x25` @0x2e847 then `add [0x3c98],3` @0x2e84e + `lcall 0x2dd` @0x2e853 |
| 17 | @0x2e85b | 0x0c | - | `cmp [0x3c9a],0 / je` @0x2e85f; cheat gate @0x2e866; `dec [0x3c9a]` @0x2e86d; if `[0x3c98] > 0x22` @0x2e871 then `sub [0x3c98],3` @0x2e878 + `lcall 0x2dd` @0x2e87d |
| — | @0x2e885 | *(gate)* | | `cmp byte [0x3ade],1 / je 0x2e88f / jmp retf` — **arms 18-22 only run while DS:0x13ade == 1** |
| 18 | @0x2e88f | 0x02 | 1 | cursor scan over `word [si+0x3573]`, end `0x14`, writes `[0x3c4b]` @0x2e8b4, exhausted → `mov byte [0x3c4b],1` @0x2e8c3 |
| 19 | @0x2e8cb | 0x05 | 4 | `inc [0x3c94]` @0x2e8d6 with `== 4 → mov 1` @0x2e8e1; `mov di,0xdcfa` @0x2e8ee; `call 0x2c5d9` @0x2e8f1; `call 0x2c646` @0x2e8f4 |
| 20 | @0x2e8fa | 0x03 | 2 | cursor scan over `word [si+0x359b]`, end `0x14`, `bx==0` skips the dec @0x2e90b, second pass from si=0 @0x2e939, writes `[0x3c4c]` @0x2e927, exhausted → `mov byte [0x3c4c],0` @0x2e942; `call 0x2c307` @0x2e92b |
| 21 | @0x2e94a | 0x04 | 3 | cursor scan over `word [si+0x35af]`, end `0xe`, writes `[0x3c4a]` @0x2e968, exhausted → `mov byte [0x3c4a],1` @0x2e977 |
| 22 | @0x2e97f | 0x20 | d | `call 0x2e987` @0x2e983 — walks `[di+0x3bf5]` (3×2 nested bounds @0x2e9dc/@0x2e9e1) for the next script event with `[si+0xb] < 5`, parking it in DS:0x13ae1 @0x2e9d2 |

Anything else falls through to `retf` @0x2e986. Codes 0x06..0x0b (digits 5-0), 0x0f (Tab), 0x1c
(Enter), 0x33/0x34 and 0x1a-0x1b are **compared nowhere in this chain**.

## The cursor-scan shape (arms 18/20/21)

Verbatim from @0x2e89a: `mov bl,[cursor] / mov bh,0 / dec bx / shl bx,1 / mov si,bx / add si,2`,
then loop `cmp word [si+base],0 / je advance`, accept with `shr si,1 / inc si / mov [cursor],cl`,
advance with `add si,2 / cmp si,end / jb loop`, and on exhaustion store a constant. So a cursor
moves to the *next* non-zero presence entry (1-based) and wraps to 1 (or 0 for arm 20) at the table
end. `dec bx` on 0 wraps `bx` to 0xffff and `shl/add` land `si` on 0, so cursor 0 restarts at entry
0 — the port mirrors that arithmetic instead of special-casing it.

These are the same three presence tables the state-2 crew picker (@0x2ea2a, `DS:0x135af`) and the
state-4 table arms (@0x2eac9 `pres: 0x13573`, @0x2eb38 `pres: 0x1359b`) read, so the digit keys are
the *pointer movement* for the tables those handlers consume.

## Two corrections this produces

1. **`0x31`/`0x32`/`0x35` are n / m / slash, not 1 / 2 / 5.** The port's key table had them keyed by
   their ASCII values, which `re/event-codes.md` already refuted for the mode switches; the digits
   are 0x02..0x0b and the four rows above show they are *bound* (arms 18-21). This is why
   `TODO_KEYMAP@0x2e76c` ("3 is unbound") was wrong: make 0x04 is the "3" arm, it was just past the
   quoted window.
2. **The `=` / `-` keys are two different mechanics depending on the state.** In state 1 they are the
   cheat-gated scroller (arms 16/17, moving DS:0x13c9a within DS:0x13c5a and stepping the pixel
   offset DS:0x13c98 by 3 through the `lcall 0x131e,0x2dd` scroll callee). In state 3 the same codes
   page the record cursor DS:0x13c8e (`re/game-loop-modes.md` App. C.4). Both are now modelled.

## Still open after this pass

* `TODO_GLOBAL@0x13c60` — arms 14/15 compare it with 0x11 (`mov si,0 / cmp [si+0x3c60],0x11 / ja`)
  and nothing in `re/` names a writer. Its *role* is now known (it suppresses the @0x58b2 message once
  the value passes 0x11) even though its value is not.
* Why DS:0x13ade doubles as the sound flag (arm 9) and the gate for the digit arms (@0x2e885) is not
  evidenced anywhere in these bytes.
* The three presence tables' entry semantics (what a non-zero word *means*) still come only from their
  being tested against 0.
