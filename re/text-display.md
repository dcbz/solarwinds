# Text, modal conversation, and live world display

This closes the former “text only exists in the status line” gap.

## Font

`FUN_231e_31f1 @0x263d1` indexes `BH_CHAR.DAT` as `character * 0x40`. Each glyph is eight rows with
an eight-byte source stride. Width is `DS:0xb300[character]`; zero pixels are transparent and all
nonzero indexed pixels are copied verbatim. The immutable width table is at EXE file offset
`0xb300 + 0xf90 = 0xc290`. `$`, `0x01`, `0x0d`, and values above `0x85` terminate/control a line.
`FUN_231e_8bdc @0x2b892` wraps general messages at 0xc4 pixels and advances ten scanlines.

The transcription is `web/src/engine/text.ts`.

## Conversation presentation

The overlay constants at the conversation resource segment `0xbf9:0x70e3` are
`0f 0a c8 03 05 05`: text starts at x=15,y=8; adding 0x505 places the first portrait at x=13,y=7;
the shade rectangle begins x=5,y=4. It is 216x186, split into two 93-line panes. The second pane is
`+0x7440`, portraits are 50x50 with border index 0x87, and text indents 56 pixels beside them.

The shade transform at `0x253ce..0x2549c` is implemented by palette-ramp thresholds. Portrait
animation follows the DOS hundredths bit-0x10 poll, approximately 160 ms per frame. See
`web/src/engine/conversation.ts`.

## PAGE and actors

Dispatcher slot 19 opens `PAGE.DAT @0x30668`, wind-decodes it and copies 64,000 bytes to A000. It is
the cockpit/game screen, not another splash. The pointer table built at `0x30727..0x30759` walks the
record stream in `DS:[0x6ba1]`; that segment is established by the preceding `BH_PLAN.DAT` stone
decode at `0x2faff..0x2fbbf`. Its frames are `<u8 width,u8 height,width*height pixels>`, exactly the
shape consumed by `FUN_231e_1364 @0x24720`.

`web/src/engine/world.ts` draws those frames from the saved 13-byte actor array and passes its
frame-local actor addresses to scan/conversation, the browser equivalent of DS:0x3bf5. Navigation
currently advances the deepest coordinate pair DS:0x3d4/0x3d5. The full five-byte inertial update
at `SOLAR1.c:13552..13625` remains open. Because BH_START's coarse cells are still the
pre-initialisation 0x7f fill, the bridge caps the frame-local list to the twelve nearest actors;
otherwise all 201 catalogue entries overlap. Both limitations are explicit in the module.
