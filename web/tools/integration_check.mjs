// Headless proof that web/src/main.ts drives web/src/engine/loop.js correctly.
//
// It imports the real entry point (no DOM, so main.js takes its fs reader), then asserts what the
// integration is supposed to do: the title frame decodes, initialState() renders once, browser
// input reaches the documented INT 9 scancodes / event codes, and DS:0x13c91 changes when an arm
// that writes it is reached. Anything that cannot happen yet is printed as a note carrying the TODO
// name from re/game-loop-modes.md rather than faked.
//
// Usage: node web/tools/integration_check.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSession, keyName, pointerLabel } from '../src/main.ts';
import { decodeFrame } from '../src/rle.ts';
import { GLOBALS, STATE_GLOBAL, STATE_VALUES } from '../src/engine/loop.ts';
import { decodeShipBanks, walkRecords } from '../src/engine/screens.ts';
import { PANEL, BOX, pageRecord } from '../src/engine/pages.ts';
import { barOrigin as barOriginAt } from '../src/engine/bars.ts';
import { State } from '../src/engine/state.ts';
import { startupString } from '../src/engine/startup.ts';
import { bearing32, turnHeadingOne } from '../src/engine/bearing.ts';
import { PROJECTILE_HOMING_TICK, updateProjectiles } from '../src/engine/combat.ts';
import { updateEnemies } from '../src/engine/enemies.ts';
import { loadStarShapes } from '../src/engine/starfield.ts';
import { sectorCoordinates } from '../src/engine/coordinates.ts';
import { CONVERSATION } from '../src/engine/conversation.ts';
import { actorPixelDelta, VIEW_CENTER } from '../src/engine/world.ts';

const g = (key) => GLOBALS[key].addr;
/** Fly the camera onto actor #i by copying its ten interleaved coordinate bytes, then repaint. */
function parkOn(session, i) {
  const a = 0x3d8 + i * 0xd;
  for (let k = 0; k < 10; k++) session.state.sv.byteAt(0x3ce + k, session.state.sv.byteAt(a + k));
  session.tick();
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const note = (label, text) => console.log(`NOTE ${label}: ${text}`);

// --- 0. the dispatcher presents EPIC -> staged TITLE -> ship/story -> PAGE -----------------
const boot = await createSession({ playStartup: true });
const epicRef = decodeFrame(new Uint8Array(readFileSync('web/data/BH_EPIC.DAT')), 'wind');
check('FUN_231e_c4cf starts on BH_EPIC with BH_EPAL, before PAGE.DAT is presented (@0x2fca1)',
  boot.startup?.phase === 'epic' && Buffer.compare(Buffer.from(boot.fb.vram), Buffer.from(epicRef.pixels)) === 0,
  `phase=${boot.startup?.phase} sha=${sha(boot.fb.vram)}`);
boot.keydown({ key: 'Enter' });
check('input ends the EPIC hundredth-clock wait and begins the staged BH_TITLE copies (@0x2fde4)',
  boot.startup?.phase === 'title' && boot.startup.titleStage === 0,
  `phase=${boot.startup?.phase} stage=${boot.startup?.titleStage}`);
boot.keyup({ key: 'Enter' });
boot.keydown({ key: 'Enter' });
const seqRef = decodeFrame(new Uint8Array(readFileSync('web/data/BH_SEQ.DAT')), 'wind');
check('title input enters BH_SEQ and draws the executable story text over the ship frame (@0x301be)',
  boot.startup?.phase === 'intro' &&
  startupString(boot.startup ? boot.state.exe : new Uint8Array(), 0x8a17).startsWith('In a galaxy') &&
  Buffer.compare(Buffer.from(boot.fb.vram), Buffer.from(seqRef.pixels)) !== 0,
  `phase=${boot.startup?.phase} story=${JSON.stringify(startupString(boot.state.exe, 0x8a17).slice(0, 34))}`);
boot.keyup({ key: 'Enter' });
boot.keydown({ key: 'Enter' });
check('input during the story takes the original @0x3064b skip to live PAGE and draws BH_MS heading 0x16',
  boot.startup === null && boot.playerShip?.heading === 0x16 && boot.playerShip.painted > 0,
  `heading=${boot.playerShip?.heading} dest=0x${boot.playerShip?.dest.toString(16)} painted=${boot.playerShip?.painted}`);

// --- 1. title remains loadable, while INIT reaches the real PAGE.DAT cockpit -----------------
const s = await createSession();
const ref = decodeFrame(new Uint8Array(readFileSync('web/data/BH_TITLE.DAT')), 'wind');
const pageRef = decodeFrame(new Uint8Array(readFileSync('PAGE.DAT')), 'wind');
check('BH_TITLE.DAT decodes to one 320x200 frame',
  s.title.decoded === 64001 && s.title.pixels.length === 64000,
  `${s.title.file} ${s.title.decoded} decoded, ${s.title.pixels.length} kept`);
check('the live session boots PAGE.DAT, while preserving its clean cockpit as the compositor page',
  Buffer.compare(Buffer.from(s.pageBuf), Buffer.from(pageRef.pixels)) === 0 &&
  Buffer.compare(Buffer.from(s.fb.vram), Buffer.from(ref.pixels)) !== 0,
  `PAGE sha ${sha(s.pageBuf)} · live ${sha(s.fb.vram)} · ${s.visibleActors.length} actors`);
// FUN_231e_1364's two culls (@0x2455f sector words, @0x24592 3x3 cell window) say what is drawn. The
// BH_START camera sits at cell (0x63,0x78) and NO actor's cell is within +-1 of it: 161 objects share
// the 7f,7f,7f sector but their cells spread -15..52 / -20..82 around it. The nearest is the CLAW
// (actor #155, type 0xcd, object code 1) at cell (0x60,0x7e) = 3 cells west, 6 north. So an empty
// first frame is the shipped behaviour, not a port gap — the starfield arrives when you fly.
check('the boot frame has no foreground actor because the shipped save parks the camera in an empty cell (@0x24592 window)',
  s.visibleActors.length === 0,
  `camera cell (${s.state.sv.byteAt(0x3d4)},${s.state.sv.byteAt(0x3d5)}) · CLAW 3 cells away`);

// FUN_231e_7ad6 is the opening live-story scheduler. BH_START seeds its counter to 199 so its
// first pump takes the 200 branch, places actor #160 next to the camera, and prints the uncloaking
// alert. This is separate from the cinematic's long-range CLAW message.
const opening = await createSession();
const openingCameraLow = opening.state.sv.byteAt(0x3d6);
opening.tick();
check('the first live pump advances the shipped 199 counter to 200 and uncloaks UNKNOWN actor #160 beside the player (@0x2acd5)',
  opening.state.sv.wordAt(0x3bea) === 200 && opening.visibleActors.includes(0xbf8) &&
  opening.state.sv.byteAt(0xc00) === ((openingCameraLow + 0x50) & 0xff) &&
  opening.state.scriptLog?.at(-1)?.text === 'A SHIP IS UNCLOAKING NEARBY',
  `counter=${opening.state.sv.wordAt(0x3bea)} visible=${opening.visibleActors.map((a) => a.toString(16))} message=${JSON.stringify(opening.state.scriptLog?.at(-1)?.text)}`);
opening.keydown({ key: 'c' });
check('communicating with the opening ship reads mutable ship record 6 and starts its real BH_CONV script 3',
  opening.conversation?.scriptId === 3 && /^KAA!\s+The rumors are to be believed/.test(opening.conversation?.prompt || ''),
  `script=${opening.conversation?.scriptId} prompt=${JSON.stringify(opening.conversation?.prompt?.slice(0, 45))}`);
const openingFace = opening.conversation?.portrait;
const openingSequence = openingFace?.animation || [];
const openingFrame0 = openingFace?.frames[(openingSequence[0] || 1) - 1];
const openingFrame1 = openingFace?.frames[(openingSequence[1] || 1) - 1];
const retainedFacePixel = openingFrame0 && openingFrame1
  ? openingFrame0.pixels.findIndex((p, i) => p !== 0 && openingFrame1.pixels[i] === 0)
  : -1;
const faceAt = CONVERSATION.portraitBase + CONVERSATION.portraitDelta;
const retainedScreenPixel = retainedFacePixel < 0 ? -1
  : faceAt + Math.floor(retainedFacePixel / CONVERSATION.portraitSize) * 320 +
    retainedFacePixel % CONVERSATION.portraitSize;
const retainedColour = retainedScreenPixel < 0 ? -1 : opening.fb.vram[retainedScreenPixel];
for (let i = 0; i < 7; i++) opening.tick();
check('transparent BH_PEOP pixels retain the preceding face frame instead of exposing black modal backing',
  retainedFacePixel >= 0 && retainedColour === openingFrame0?.pixels[retainedFacePixel] &&
  opening.fb.vram[retainedScreenPixel] === retainedColour,
  `portrait pixel ${retainedFacePixel} remains colour 0x${retainedColour.toString(16)}`);
opening.keydown({ key: 'Escape' });
check('returning from conversation 3 runs FUN_231e_a592: counter -> 0x3b6 and the mutable script byte is cleared',
  opening.conversation === null && opening.state.sv.wordAt(0x3bea) === 0x3b6 && opening.state.sv.byteAt(0x1478) === 0,
  `counter=0x${opening.state.sv.wordAt(0x3bea).toString(16)} script=${opening.state.sv.byteAt(0x1478)}`);
for (let i = 0; i < 50; i++) opening.tick();
check('50 passes after that conversation the original scheduler reaches 1000 and announces the ship cloaking',
  opening.state.sv.wordAt(0x3bea) === 1000 && opening.state.scriptLog?.at(-1)?.text === 'A SHIP IS CLOAKING NEARBY',
  `counter=${opening.state.sv.wordAt(0x3bea)} message=${JSON.stringify(opening.state.scriptLog?.at(-1)?.text)}`);
for (let i = 0; i < 30; i++) opening.tick();
check('at counter 0x406 UNKNOWN leaves the local sector and its saved ship record becomes later-story conversation 15',
  opening.state.sv.wordAt(0x3bea) === 0x406 && opening.state.sv.byteAt(0xbfc) === 0x78 &&
  opening.state.sv.byteAt(0xbfd) === 0x7a && opening.state.sv.byteAt(0x1478) === 15,
  `sector bytes=${opening.state.sv.byteAt(0xbfc).toString(16)},${opening.state.sv.byteAt(0xbfd).toString(16)} script=${opening.state.sv.byteAt(0x1478)}`);

const unansweredHail = await createSession();
for (let i = 0; i < 336; i++) unansweredHail.tick();
check('an unanswered opening contact emits both the timed C prompt and FUN_231e_ab0a incoming-hail reminder',
  unansweredHail.state.scriptLog?.some((e) => e.text === "* PRESS 'C' TO COMMUNICATE *") &&
  unansweredHail.state.scriptLog?.at(-1)?.text === 'YOU ARE BEING HAILED',
  (unansweredHail.state.scriptLog || []).map((e) => e.text).join(' / '));
const backdropShapes = loadStarShapes(s.state.exe);
check('FUN_231e_8708 seeds the separate 20-star backdrop and FUN_231e_42e4 paints its executable shapes',
  s.backgroundStars.length === 20 && s.backdropPixels === 111 &&
  s.backgroundStars[0].x === 82 && s.backgroundStars[0].y === 88 &&
  s.backgroundStars[0].shape === 1 && backdropShapes.length === 16 &&
  s.fb.vram.reduce((n, v) => n + (v >= 0x90 && v <= 0x9f ? 1 : 0), 0) === 111,
  `${s.backgroundStars.length} seeded · ${s.backdropPixels} pixels · first ${JSON.stringify(s.backgroundStars[0])}`);
check('FUN_231e_81e8 prints the starting sector -28,7 used by the intro rendezvous at -31,1',
  s.sector.x === -28 && s.sector.y === 7 &&
  sectorCoordinates(s.state.sv).x === -28 && sectorCoordinates(s.state.sv).y === 7,
  `cockpit sector ${s.sector.x},${s.sector.y}`);
check('the empty actor cell still contains the player craft: BH_MS[0x16] is anchored by DS:0x33b2',
  s.playerShip?.heading === 0x16 && s.playerShip.dest === 0x7d71 - 0x1192 && s.playerShip.painted > 0,
  `dest=0x${s.playerShip?.dest.toString(16)} painted=${s.playerShip?.painted}`);
const hullBanks = decodeShipBanks(new Uint8Array(readFileSync('web/data/BH_SHIP.DAT')));
check('BH_SHIP.DAT is seven length-framed banks (types 0xc8..0xce), each decoding to 32 directional hulls',
  hullBanks.length === 7 && hullBanks.every((bank, i) => bank.type === 0xc8 + i && bank.records.length === 32),
  hullBanks.map((bank) => `0x${bank.type.toString(16)}:${bank.records[0].width}x${bank.records[0].height}`).join(' '));
const enemy = await createSession();
parkOn(enemy, 155); // CLAW: type 0xcd, code 1, EXE DS:0xe0f selector 0x19
check('the real CLAW enemy hull is selected through type 0xcd -> BH_SHIP bank 5 and object selector 0x19',
  enemy.visibleActors.includes(0x3d8 + 155 * 0xd) && enemy.visibleSprite === -1 - (5 * 32 + 0x19),
  `sprite namespace ${enemy.visibleSprite} · ${enemy.fb.vram.reduce((n, v, i) => n + (v !== enemy.pageBuf[i] ? 1 : 0), 0)} painted pixels`);
// Follow the actual opening directions without copying actor bytes: start at -28,7 facing 22,
// fly toward -31,1, brake, face west, then close the final pixel window and communicate.
const rendezvous = await createSession();
rendezvous.keydown({ key: 'ArrowUp' });
for (let i = 0; i < 330; i++) rendezvous.tick();
rendezvous.keyup({ key: 'ArrowUp' });
for (let i = 0; i < 10; i++) { rendezvous.keydown({ key: ' ' }); rendezvous.keyup({ key: ' ' }); }
rendezvous.keydown({ key: 'ArrowRight' });
for (let i = 0; i < 40 && rendezvous.state.sv.byteAt(0x3c92) !== 16; i++) rendezvous.tick();
rendezvous.keyup({ key: 'ArrowRight' });
rendezvous.keydown({ key: 'ArrowUp' });
for (let i = 0; i < 160 && !rendezvous.visibleActors.includes(0x3d8 + 155 * 0xd); i++) rendezvous.tick();
rendezvous.keyup({ key: 'ArrowUp' });
rendezvous.keydown({ key: 'c' });
check('the intro route is playable end to end: normal flight reaches CLAW near sector -31,1 and `c` opens story node 1',
  rendezvous.sector.x === -30 && rendezvous.sector.y === 1 &&
  rendezvous.visibleActors.includes(0x3d8 + 155 * 0xd) && rendezvous.conversation?.scriptId === 1 &&
  /^Greetings Bounty Hunter/.test(rendezvous.conversation?.prompt || ''),
  `sector ${rendezvous.sector.x},${rendezvous.sector.y} · visible=${rendezvous.visibleActors.map((a) => a.toString(16))} · script=${rendezvous.conversation?.scriptId}`);
const clawActor = 0x3d8 + 155 * 0xd, clawObject = 0xe0f;
const clawBefore = [...Array(10)].map((_, i) => enemy.state.sv.byteAt(clawActor + i));
for (let i = 0; i < 14; i++) enemy.tick();
const clawAfter = [...Array(10)].map((_, i) => enemy.state.sv.byteAt(clawActor + i));
check('FUN_231e_bdc8 activates the parked CLAW from state 5 to pursuit state 4, steers it and moves its 40-bit position',
  enemy.state.sv.byteAt(clawObject + 7) === 4 &&
  (enemy.state.sv.byteAt(clawObject) !== 0x19 || clawAfter.some((v, i) => v !== clawBefore[i])),
  `state=${enemy.state.sv.byteAt(clawObject + 7)} heading=${enemy.state.sv.byteAt(clawObject)} moved=${clawAfter.some((v, i) => v !== clawBefore[i])}`);
const missileSprites = walkRecords(new Uint8Array(readFileSync('web/data/BH_MIS.DAT')));
check('BH_MIS.DAT is exactly the 32 raw directional projectile records indexed at @0x24bc6',
  missileSprites.length === 32 && missileSprites[0].width === 15 && missileSprites[0].height === 5 &&
  missileSprites[22].width === 8 && missileSprites[22].height === 13,
  `heading 0 ${missileSprites[0].width}x${missileSprites[0].height} · heading 22 ${missileSprites[22].width}x${missileSprites[22].height}`);
const combat = await createSession();
const combatState = combat.state.sv;
const ammoBefore = combatState.wordAt(0x359b);
const projectileBefore = combat.fb.vram.slice();
const firedShot = combat.keydown({ key: 'Control' });
check('Ctrl feeds DS:0x5bbe and FUN_231e_91ed launches weapon 1 into the first DS:0xd8b slot',
  combatState.byteAt(0xd8b) !== 0 && combatState.byteAt(0xd95) === 0xff &&
  combatState.byteAt(0xd97) === 1 && combatState.byteAt(0x1d9b) === 0x16 &&
  firedShot.trace.some((line) => line.includes('FUN_231e_91ed@0x2c3cd: weapon 1 launched')),
  [...Array(13)].map((_, i) => combatState.byteAt(0xd8b + i).toString(16).padStart(2, '0')).join(' '));
check('launch consumes one real ammo word, arms the 0x32-pass delay, and paints BH_MIS over PAGE',
  combatState.wordAt(0x359b) === ammoBefore - 1 && combatState.byteAt(0x3c54) === 0x32 &&
  Buffer.compare(Buffer.from(combat.fb.vram), Buffer.from(projectileBefore)) !== 0,
  `ammo ${ammoBefore}->${combatState.wordAt(0x359b)} cooldown=${combatState.byteAt(0x3c54)}`);
const shotX = combatState.byteAt(0xd93), shotY = combatState.byteAt(0xd94);
combat.tick();
check('FUN_231e_4dc7 follows the executable DS:0x6393 trajectory pair and loops its frame index',
  combatState.byteAt(0xd93) === ((shotX - 2) & 0xff) &&
  combatState.byteAt(0xd94) === ((shotY + 5) & 0xff) && combatState.byteAt(0x1d9e) === 2 &&
  combatState.wordAt(0x1dfe) === 2 && combatState.byteAt(0x3c54) === 0x31,
  `low (${shotX},${shotY})->(${combatState.byteAt(0xd93)},${combatState.byteAt(0xd94)}) frame=${combatState.byteAt(0x1d9e)}`);
const battle = await createSession();
const battleState = battle.state.sv;
for (let k = 0; k < 10; k++) battleState.byteAt(0x3ce + k, battleState.byteAt(clawActor + k));
// Heading 22's muzzle offset and first trajectory pair put the shot at camera (-17,+30).
battleState.byteAt(0x3d6, battleState.byteAt(0x3d6) + 24);
battleState.byteAt(0x3d7, battleState.byteAt(0x3d7) - 31);
const battleHit = battle.keydown({ key: 'Control' });
check('FUN_231e_420f resolves a live projectile against the CLAW and removes two points from every shield facing',
  [13, 12, 4, 4].every((v, i) => battleState.byteAt(clawObject + 0x0b + i) === v) &&
  battleState.byteAt(clawObject + 0x10) === 12 && battleState.byteAt(0x1dfd) === 1 &&
  battleHit.trace.some((line) => line.includes('FUN_231e_420f@0x273ef: projectile 1 hit hostile object 1')),
  `shields=${[...Array(4)].map((_, i) => battleState.byteAt(clawObject + 0x0b + i)).join('/')} hull=${battleState.byteAt(clawObject + 0x10)}`);
battle.tick();
check('a projectile consumed by a collision follows the original 0xf0f0 expiry path and frees its actor slot next pass',
  battleState.byteAt(0xd8b) === 0,
  `slot0=${battleState.byteAt(0xd8b)} age=0x${battleState.wordAt(0x1dfe).toString(16)}`);
const battleDelta = actorPixelDelta(battleState, clawActor);
const battleHeading = battleState.byteAt(clawObject);
const battleSprite = hullBanks[5].records[battleHeading];
const battleTop = battleDelta
  ? VIEW_CENTER + battleDelta.dx + battleDelta.dy * 320 -
    (battleSprite.width >> 1) - (battleSprite.height >> 1) * 320
  : -1;
let missingHullPixels = 0;
if (battleTop >= 0) {
  for (let y = 0; y < battleSprite.height; y++) {
    for (let x = 0; x < battleSprite.width; x++) {
      const p = battleSprite.pixels[y * battleSprite.width + x];
      if (p !== 0 && battle.fb.vram[battleTop + y * 320 + x] !== p) missingHullPixels++;
    }
  }
}
check('restoring PAGE.DAT also clears the depth page, so an expired projectile cannot cut missing-pixel lines through a ship',
  battleTop >= 0 && missingHullPixels === 0,
  `${missingHullPixels} nontransparent hull pixels missing after impact`);
const destroyed = await createSession();
parkOn(destroyed, 155);
destroyed.state.sv.byteAt(clawObject + 0x10, 0);
destroyed.state.sv.byteAt(clawObject + 0x11, 0x16);
destroyed.tick();
const explosionBridge = destroyed.state.sv.byteAt(clawObject + 0x11);
destroyed.tick();
check('zero hull drives the original state-3 explosion bridge 0xfe -> 0xff and removes the hostile actor',
  explosionBridge === 0xfe && destroyed.state.sv.wordAt(clawActor) === 0,
  `bridge=0x${explosionBridge.toString(16)} actorWord=0x${destroyed.state.sv.wordAt(clawActor).toString(16)}`);
const returnFire = await createSession();
parkOn(returnFire, 155);
const returnState = returnFire.state.sv;
returnState.byteAt(clawObject + 0x15, 1); // state-2 fire-enable field @0x2f650
returnState.byteAt(clawObject + 0x1d, 0); // launcher cooldown @0x2bcdb
returnState.byteAt(clawObject + 0x1f, 10);
const enemyShot = returnFire.tick();
const shieldBeforeHit = returnState.wordAt(0x3c68);
const playerHit = returnFire.tick();
check('the hostile launcher at @0x2bcc2 allocates the shared projectile slot with its enemy marker',
  returnState.byteAt(0x1e00) === 1 &&
  enemyShot.trace.some((line) => line.includes('1 fired')),
  `special=${returnState.byteAt(0x1e00)} heading=${returnState.byteAt(0x1d9b)}`);
check('FUN_231e_62b1 sends an enemy projectile into the persisted directional player shield pool',
  shieldBeforeHit === 10 && returnState.wordAt(0x3c68) === 2 && returnState.byteAt(0x3c46) === 50 &&
  playerHit.trace.some((line) => line.includes('FUN_231e_62b1@0x29491')),
  `shield5 ${shieldBeforeHit}->${returnState.wordAt(0x3c68)} hull=${returnState.byteAt(0x3c46)}`);

check('FUN_231e_30c9 uses the executable integer thresholds for all eight axes and its asymmetric 180-degree turn tie',
  [[0x1100, 0x1000, 0], [0x1100, 0x0f00, 4], [0x1000, 0x0f00, 8],
   [0x0f00, 0x0f00, 12], [0x0f00, 0x1000, 16], [0x0f00, 0x1100, 20],
   [0x1000, 0x1100, 24], [0x1100, 0x1100, 28]]
    .every(([x, y, heading]) => bearing32(0x1000, 0x1000, x, y).heading === heading) &&
  turnHeadingOne(20, 4) === 21 && turnHeadingOne(4, 20) === 3,
  'cardinals 0/8/16/24, diagonals 4/12/20/28; opposite ties follow numeric branch order');

const homingState = new State(readFileSync('web/data/BH_START.DAT'));
for (let hostile = 0xbb7; hostile < 0xd8b; hostile += 0xd) {
  for (let i = 0; i < 6; i++) homingState.byteAt(hostile + i, 0);
}
for (let i = 0; i < 6; i++) {
  homingState.byteAt(0xd8b + i, 1);
  homingState.byteAt(0xbb7 + i, 1);
}
homingState.byteAt(0xd91, 0x10); homingState.byteAt(0xd93, 0);
homingState.byteAt(0xd92, 0x10); homingState.byteAt(0xd94, 0);
homingState.byteAt(0xbbd, 0x12); homingState.byteAt(0xbbf, 0);
homingState.byteAt(0xbbe, 0x10); homingState.byteAt(0xbc0, 0);
homingState.byteAt(0xd95, 0xff);
homingState.byteAt(0x1d9b, 8);
homingState.byteAt(0x1d9c, 4);
homingState.byteAt(PROJECTILE_HOMING_TICK, 5);
updateProjectiles(homingState, new Uint8Array(readFileSync('web/data/SOLAR1.EXE')));
check('weapon 4 scans the shipped hostile array every sixth pass and turns one 32-way step toward the nearest target (@0x280a8)',
  homingState.byteAt(PROJECTILE_HOMING_TICK) === 0 && homingState.byteAt(0x1d9b) === 7 &&
  homingState.byteAt(0x1d9e) === 0,
  `homing tick=${homingState.byteAt(PROJECTILE_HOMING_TICK)} heading 8->${homingState.byteAt(0x1d9b)} frame=${homingState.byteAt(0x1d9e)}`);

const waypointState = new State(readFileSync('web/data/BH_START.DAT'));
const waypointExe = new Uint8Array(readFileSync('web/data/SOLAR1.EXE'));
for (let hostile = 0xbb7; hostile < 0xd8b; hostile += 0xd) waypointState.byteAt(hostile + 10, 0);
waypointState.byteAt(0xbb7 + 10, 0xcd);
const waypointObject = 0xe0f;
waypointState.byteAt(waypointObject + 7, 4);
waypointState.byteAt(waypointObject + 8, 0x21);
for (let i = 0; i < 10; i++) waypointState.byteAt(0x3ce + i, waypointState.byteAt(0xbb7 + i));
updateEnemies(waypointState, waypointExe); // captures FUN_231e_0677's transient DS:0x53e2 table
const waypointX = waypointState.byteAt(0xbb7 + 6);
const waypointY = waypointState.byteAt(0xbb7 + 7);
waypointState.byteAt(0xbb7 + 6, waypointX + 5);
waypointState.byteAt(waypointObject + 0x12, waypointState.byteAt(waypointObject + 0x13) - 1);
updateEnemies(waypointState, waypointExe);
const enteredWaypoint = waypointState.byteAt(waypointObject + 7) === 10 &&
  waypointState.byteAt(0x458c) === 4 && waypointState.byteAt(0x458d) === 0x21 &&
  waypointState.byteAt(waypointObject + 8) === 0x78;
waypointState.byteAt(0xbb7 + 6, waypointX);
waypointState.byteAt(0xbb7 + 7, waypointY);
waypointState.byteAt(0xbb7 + 8, 0);
waypointState.byteAt(waypointObject + 0x12, waypointState.byteAt(waypointObject + 0x13) - 1);
updateEnemies(waypointState, waypointExe);
check('FUN_231e_bdc8/state 10 snapshots the original cell, returns an escaped hostile, then restores its saved AI and speed',
  enteredWaypoint && waypointState.byteAt(waypointObject + 7) === 4 &&
  waypointState.byteAt(waypointObject + 8) === 0x21,
  `entered=${enteredWaypoint} restored state=${waypointState.byteAt(waypointObject + 7)} speed=${waypointState.byteAt(waypointObject + 8)}`);

const death = await createSession();
death.state.sv.byteAt(0x3c46, 0);
const deathFirst = death.tick();
check('signed zero hull repumps through FUN_231e_7bcc and paints BH_EXPL frame 0 in place of the player ship',
  death.state.playerDeath?.counter === 1 && death.state.playerDeath?.frame === 0 &&
  death.playerShip === null && deathFirst.trace.some((line) => line.includes('BH_EXPL frame 0')) &&
  death.fb.vram.some((v, i) => v !== death.pageBuf[i]),
  `counter=${death.state.playerDeath?.counter} frame=${death.state.playerDeath?.frame} ship=${death.playerShip}`);
for (let i = 1; i < 36; i++) death.tick();
check('the shipped 36-pass destruction sequence erases the ship after frame 5 and raises DS:0x457b=2',
  death.state.sv.wordAt(0x457c) === 36 && death.state.sv.byteAt(0x457b) === 2 &&
  death.state.playerDeath?.frame === null && death.mode === 1,
  `counter=${death.state.sv.wordAt(0x457c)} phase=${death.state.sv.byteAt(0x457b)} mode=${death.mode}`);

// --- 2. initialState() rendered exactly once, before any input -------------------------------
check('initialState() renders once at boot', s.paints === 1, `paints=${s.paints}`);

// --- 3. the dispatch key comes from the save blob, not a guess ------------------------------
const blob = new State(readFileSync('web/data/BH_START.DAT'));
check('DS:0x13c91 seeded from BH_START.DAT (TODO_BOOT@0x23c12)',
  s.state.g[STATE_GLOBAL] === blob.mode && blob.mode === 1,
  `blob DS:0x3c91=${blob.mode} -> g[0x13c91]=${s.state.g[STATE_GLOBAL]} -> handler ` +
  `${STATE_VALUES[blob.mode].handlerAddr.toString(16)} (${STATE_VALUES[blob.mode].name})`);
check('gatherer select DS:0x13572 is 0, so the pump really emits codes (@0x23e03)',
  s.state.g[g('gathererSelect')] === blob.inputGatherer && blob.inputGatherer === 0);

// --- 4. keydown maps to real INT 9 scancodes, keyup to break codes ---------------------------
const speed0 = s.state.sv.scrollPos;
let t = s.keydown({ key: 'ArrowUp' });
check('ArrowUp -> make 0x48 sets the INT 9 Up flag (@0x23cb0)',
  t.held.up === 1 && t.trace.some((x) => x.includes('int9 0x48')),
  t.trace.find((x) => x.includes('int9 0x48')));
check('held Up moves DS:0x13c98 +3 (@0x24487) and re-pumps, so no handler pass runs',
  s.state.sv.scrollPos === speed0 + 3 && t.trace.some((x) => x.startsWith('repump@0x23dd9')),
  `DS:0x3c98 speed ${speed0} -> ${s.state.sv.scrollPos} (@0x24487 add word [0x3c98],3)`);
t = s.keyup({ key: 'ArrowUp' });
check('keyup ArrowUp -> break 0xc8 clears the Up flag (closes TODO_KEYUP@0x23cc7)',
  t.held.up === 0 && t.trace.some((x) => x.includes('int9 0xc8')));

const s1 = await createSession();
const gateOff = s1.state.g[g('soundEnable')];
t = s1.keydown({ key: 'n' });
check('"n" (make 0x31 — the old row here took 0x31 as the digit "1", which is its ASCII, not its make code) xors DS:0x13ade @0x2e75f with no mode change',
  gateOff === 0 && t.g[g('soundEnable')] === 1 && s1.mode === 1,
  `${gateOff} -> ${t.g[g('soundEnable')]} (${t.trace.find((x) => x.startsWith('xor 0x13ade'))})`);

// The four digit arms sit behind @0x2e885 `cmp byte ptr [0x3ade],1 / je 0x2e88f / jmp retf`, so the
// same key moves a cursor with the flag set and does nothing with it clear. BH_START.DAT seeds
// DS:0x13c4b (tableSelA) = 1 and the first presence word DS:0x13573 = 1.
const from = s1.state.g[g('tableSelA')] ?? 1; // the blob seeds DS:0x13c4b = 1; the sparse mirror stays unset until a writer runs
t = s1.keydown({ key: '1' });
const moved = s1.state.g[g('tableSelA')];
check('with DS:0x13ade == 1 the "1" arm scans DS:0x13573 for the next non-zero entry and parks tableSelA (@0x2e89a..@0x2e8c3)',
  t.trace.some((x) => x.startsWith('cursor scan @0x2e89a')) && moved === from + 1,
  `${from} -> ${moved}`);
s1.keydown({ key: 'n' });                        // clear the gate again
t = s1.keydown({ key: '1' });
check('and with it clear the gate @0x2e885 ends the chain, so the same key does nothing',
  s1.state.g[g('tableSelA')] === moved && t.trace.some((x) => x.includes('0x13ade') && x.includes('arm skipped')),
  `tableSelA holds ${moved} · ${t.trace.filter((x) => x.includes('arm skipped')).slice(-1)}`);

const s5 = await createSession();
for (const key of ['F2', 'F9', 'F10']) s5.keydown({ key });
check('F2 then F9 arms the cheat gate through the ISR latch cs:[0x42] (@0x23c62, @0x23c79, @0x23c81)',
  s5.state.g[g('cheatGate')] === 1, `DS:0x13be6=${s5.state.g[g('cheatGate')]}`);
check('then F10 (make 0x44, gate open) writes DS:0x13c95 (@0x2e7a5)',
  s5.state.g[g('debugWord')] === 1 && s5.mode === 1, `DS:0x13c95=${s5.state.g[g('debugWord')]}`);
check('keyName lower-cases a bare character and passes an arrow/F-key name through, which is what the make-code table is keyed by (@0x24372 reads the INT 9 latch)',
  keyName({ key: 'D' }) === 'd' && keyName({ key: 'A' }) === 'a' && keyName({ key: 'ArrowUp' }) === 'ArrowUp' && keyName({ key: 'F2' }) === 'F2',
  `${keyName({ key: 'D' })}/${keyName({ key: 'A' })}/${keyName({ key: 'ArrowUp' })}`);

// --- 5. the mouse uses the documented 2:1 X mapping and FUN_231e_bc89 panel routing ------------
const sp = await createSession();
t = sp.pointer(160, 100);
check('click at 160,100 -> INT 33h raw 320,100 (ax=7 range 0..638, ax=8 range 0..200)',
  pointerLabel(160, 100) === 'pointer:320,100' && pointerLabel(319, 199) === 'pointer:638,199');
check('FUN_231e_bc89 consumes the left-button edge, halves X and routes it without poisoning the keyboard queue',
  sp.pending === 0 && t.trace.some((line) => line.includes('left click raw (320,100) -> panel (160,100)')),
  `pending=${sp.pending} · ${t.trace.find((line) => line.includes('left click'))}`);

const engineering = await createSession();
engineering.keydown({ key: 'e' });
const engineeringState = engineering.state.sv;
const engineeringStat = engineeringState.wordAt(0x3c5e);
// The ENGINEERING readout is the bar band FUN_231e_8043 paints (7 px per stat, foot at row 128,
// nine apart from col 239), not a text box: the labels are baked into BH_PAN record 0.
const engineeringBox = () => Buffer.from(engineering.fb.vram.slice(91 * 320 + 239, 129 * 320 + 311));
const engineeringBefore = sha(engineeringBox());
engineering.keydown({ key: 'f' });
const engineeringAfter = sha(engineeringBox());
check('the engineering panel is live: F removes one point from system 1, returns it to AP and shortens the system 1 bar',
  engineering.mode === 2 && engineeringState.wordAt(0x3c5e) === engineeringStat - 1 &&
  engineeringState.wordAt(0x3c70) === 1 && engineeringBefore !== engineeringAfter,
  `system1 ${engineeringStat}->${engineeringState.wordAt(0x3c5e)} AP=${engineeringState.wordAt(0x3c70)} box ${engineeringBefore}->${engineeringAfter}`);
engineering.keydown({ key: 'r' });
check('R spends that AP back into system 1 and preserves the budget invariant',
  engineeringState.wordAt(0x3c5e) === engineeringStat && engineeringState.wordAt(0x3c70) === 0,
  `system1=${engineeringState.wordAt(0x3c5e)} AP=${engineeringState.wordAt(0x3c70)}`);
engineering.pointer(242, 120);
check('the lower engineering hit box invokes the same allocator as F (@0x29bd6)',
  engineeringState.wordAt(0x3c5e) === engineeringStat - 1 && engineeringState.wordAt(0x3c70) === 1,
  `system1=${engineeringState.wordAt(0x3c5e)} AP=${engineeringState.wordAt(0x3c70)}`);
engineering.pointer(236, 77);
check('the shared panel BACK stone returns to flight mode and restores the cockpit strip',
  engineering.mode === 1 && engineering.pending === 0, `mode=${engineering.mode} pending=${engineering.pending}`);

const weapons = await createSession();
weapons.keydown({ key: 'w' });
const weaponsState = weapons.state.sv;
const weaponsBefore = sha(weapons.fb.vram.slice(3 * 320 + 230, 64 * 320 + 316));
t = weapons.keydown({ key: '2' });
check('state 4 reads initialized EXE table DS:0x5b90: key 2 selects owned pulse bank 2 in the save image',
  weaponsState.byteAt(0x3c4b) === 2 && weapons.state.g[g('tableSelA')] === 2 &&
  t.trace.some((line) => line.includes('table arm tableA matched entry 1')),
  `pulse=${weaponsState.byteAt(0x3c4b)} · ${t.trace.find((line) => line.includes('pulse bank'))}`);
weapons.keydown({ key: '2' });
check('reselecting the current pulse bank cycles its original 1..3 power field and redraws the panel',
  weaponsState.byteAt(0x3c94) === 2 && weaponsBefore !== sha(weapons.fb.vram.slice(3 * 320 + 230, 64 * 320 + 316)),
  `power=${weaponsState.byteAt(0x3c94)}`);
t = weapons.keydown({ key: 'j' });
check('state 4 reads DS:0x5ba4 and its ammo gate: J selects missile bank 4, the other armed fresh-game bank',
  weaponsState.byteAt(0x3c4c) === 4 && weaponsState.wordAt(0x35a1) === 2 &&
  t.trace.some((line) => line.includes('table arm tableB matched entry 3')),
  `missile=${weaponsState.byteAt(0x3c4c)} ammo=${weaponsState.wordAt(0x35a1)}`);
const bank4Ammo = weaponsState.wordAt(0x35a1);
weapons.keydown({ key: 'Control' });
check('the weapon menu writes the canonical field used by Ctrl fire: the launched projectile is bank 4 and consumes bank-4 ammo',
  weaponsState.byteAt(0x1d9c) === 4 && weaponsState.wordAt(0x35a1) === bank4Ammo - 1,
  `projectile weapon=${weaponsState.byteAt(0x1d9c)} ammo ${bank4Ammo}->${weaponsState.wordAt(0x35a1)}`);

const weaponPointer = await createSession();
weaponPointer.keydown({ key: 'w' });
weaponPointer.pointer(258, 104);
weaponPointer.pointer(258, 104);
weaponPointer.pointer(284, 150);
check('weapon grid clicks select/cycle pulse bank 2 and select missile bank 4 through the same availability gates',
  weaponPointer.state.sv.byteAt(0x3c4b) === 2 && weaponPointer.state.sv.byteAt(0x3c94) === 2 &&
  weaponPointer.state.sv.byteAt(0x3c4c) === 4 && weaponPointer.pending === 0,
  `pulse=${weaponPointer.state.sv.byteAt(0x3c4b)} power=${weaponPointer.state.sv.byteAt(0x3c94)} missile=${weaponPointer.state.sv.byteAt(0x3c4c)}`);

const cargo = await createSession();
const cargoState = cargo.state.sv;
cargoState.wordAt(0x3c56, 1);
cargoState.wordAt(0x3c8e, 1);
cargoState.byteAt(0x3c7a, 0x0d);
const cargoBudget = cargoState.wordAt(0x3c5c);
cargo.keydown({ key: 'a' });
cargo.keydown({ key: 'u' });
check('cargo TRANSPORT executes FUN_231e_bb5a: type 13 adds 190 engineering capacity and removes the selected row',
  cargoState.wordAt(0x3c5c) === cargoBudget + 0xbe && cargoState.wordAt(0x3c56) === 0 &&
  cargo.state.scriptLog?.at(-1)?.text === 'CRYSTALS INSTALLED IN REACTOR CORE',
  `budget ${cargoBudget}->${cargoState.wordAt(0x3c5c)} count=${cargoState.wordAt(0x3c56)} message=${JSON.stringify(cargo.state.scriptLog?.at(-1)?.text)}`);

const cargoPointer = await createSession();
const cargoPointerState = cargoPointer.state.sv;
cargoPointerState.wordAt(0x3c56, 1);
cargoPointerState.wordAt(0x3c8e, 1);
cargoPointerState.byteAt(0x3c7a, 3);
const pointerBudget = cargoPointerState.wordAt(0x3c5c);
cargoPointer.keydown({ key: 'a' });
cargoPointer.pointer(250, 157);
check('the lower cargo action hit box runs TRANSPORT too: type 3 adds 20 capacity and compacts cargo',
  cargoPointerState.wordAt(0x3c5c) === pointerBudget + 0x14 && cargoPointerState.wordAt(0x3c56) === 0 &&
  cargoPointer.pending === 0,
  `budget ${pointerBudget}->${cargoPointerState.wordAt(0x3c5c)} count=${cargoPointerState.wordAt(0x3c56)}`);

// --- 6. DS:0x13c91 changes when an arm that writes it is reached ----------------------------
for (const [code, to] of [[0x1e, 3], [0x11, 4], [0x12, 2]]) {
  const m = await createSession();
  const from = m.mode;
  m.inject(code);
  check(`event 0x${code.toString(16)} writes DS:0x13c91 = ${to} (@0x2e6ef/0x2e705/0x2e722)`,
    m.mode === to && m.state.g[STATE_GLOBAL] === to,
    `mode ${from} -> ${to}, handler ${STATE_VALUES[to].handlerAddr.toString(16)} (${STATE_VALUES[to].name})`);
}
const m3 = await createSession();
m3.inject(0x1e);
t = m3.inject(0x1e);
check('once in mode 3 the handler has documented arms, and 0x1e matches none of them (retf @0x2ec34, no sink)',
  m3.mode === 3 && t.trace.some((x) => x.startsWith('mode=3'))
    && t.trace.some((x) => x.includes('no arm matched event 0x1e') && x.includes('0x2ec34'))
    && !t.trace.some((x) => x.includes('0x2e6fa')),
  `${(t.trace.find((x) => x.startsWith('mode=3')) || '').slice(0, 90)}…`);

async function runKey(k, mods = {}) {
  const sess = await createSession();
  const r = sess.keydown({ key: k, ...mods });
  return { mode: sess.mode, pending: r.events.length, trace: r.trace };
}
// re/event-codes.md CORRECTION 3: the value the handlers compare is the int 16h ASCII byte, so the
// mode switches are Ctrl-combos (0x11 Ctrl+Q, 0x12 Ctrl+R, 0x1e Ctrl+^) and a bare letter matches
// no arm anywhere in the four handlers.
const LEAVERS = [['w', {}, 4], ['e', {}, 2], ['a', {}, 3]];
const HOLDERS = [['q', {}], ['f', {}], ['Tab', {}], ['Enter', {}], ['1', {}], ['2', {}], ['3', {}],
  ['4', {}], ['6', {}], ['7', {}], ['8', {}], ['9', {}], ['0', {}], ['p', {}], ['m', {}], [',', {}],
  ['.', {}], ['/', {}], ['[', {}], [']', {}], ['\\', {}], [';', {}], ["'", {}], ['`', {}]];
const runs = [];
for (const [k, m, want] of LEAVERS) runs.push([`${k}${JSON.stringify(m)}`, await runKey(k, m), want]);
for (const [k, m] of HOLDERS) runs.push([`${k}${JSON.stringify(m)}`, await runKey(k, m), 1]);
const wrong = runs.filter(([label, r, want]) => r.mode !== want);
check('the mode global moves only on the documented make codes: w -> 4 (@0x2e705), e -> 2 (@0x2e722), a -> 3 (@0x2e6ef), and 25 other keys hold it at 1',
  wrong.length === 0, wrong.map(([label, r]) => `${label}->${r.mode}`).join(' ') || '3 move, 25 hold');
const stuck = runs.filter(([, r]) => r.pending !== 0);
check('every key the port can name is consumed by the pump; a key with no documented code stays queued and says so instead of being guessed',
  stuck.every(([label, r]) => r.trace.some((x) => x.includes('TODO_EVENT_CODE'))),
  stuck.map(([label]) => label).join(' ') || 'nothing left pending');

// --- the crew-stat allocator, FUN_231e_67b7 @0x29997, read straight out of BH_START.DAT -------
const alloc = await createSession();
const sv = alloc.state.sv;
const ds = [0x3c5e, 0x3c60, 0x3c62, 0x3c64, 0x3c66, 0x3c68, 0x3c6a, 0x3c6c];
const bootStats = ds.map((d) => sv.wordAt(d));
const bootPool = sv.wordAt(0x3c70);
const bootBudget = sv.wordAt(0x3c5c);
check(`BH_START.DAT satisfies the pump's own invariant: budget DS:0x3c5c = ${bootBudget} == sum(stats ${bootStats.join(',')}) and pool DS:0x3c70 = ${bootPool}`,
  bootStats.reduce((a, b) => a + b, 0) === bootBudget && bootPool === 0, `sum=${bootStats.reduce((a, b) => a + b, 0)} budget=${bootBudget} pool=${bootPool}`);

// Ctrl+S..Ctrl+Z spend from the pool (empty at boot), Shift+1..8 give back.
alloc.keydown({ key: 'r' });
check('"r" (make 0x13) cannot spend from an empty pool: the arm tests [0x3c70] != 0 first (@0x299ad)',
  sv.wordAt(0x3c5e) === bootStats[0] && sv.wordAt(0x3c70) === 0, `stat0=${sv.wordAt(0x3c5e)} pool=${sv.wordAt(0x3c70)}`);
for (let n = 0; n < 4; n++) alloc.keydown({ key: 'f' });
check('"f" x4 (make 0x21) moves 4 points out of system 1 into the pool (@0x29a8d, @0x29abf)',
  sv.wordAt(0x3c5e) === bootStats[0] - 4 && sv.wordAt(0x3c70) === 4, `stat0=${sv.wordAt(0x3c5e)} pool=${sv.wordAt(0x3c70)}`);
alloc.keydown({ key: 'r' });
alloc.keydown({ key: 'r' });
check('"r" x2 (make 0x13) puts 2 of them back (@0x299b4), keeping sum(stats)+pool at the budget',
  sv.wordAt(0x3c5e) === bootStats[0] - 2 && ds.reduce((a, d) => a + sv.wordAt(d), 0) + sv.wordAt(0x3c70) === bootBudget,
  `stat0=${sv.wordAt(0x3c5e)} pool=${sv.wordAt(0x3c70)} sum+pool=${ds.reduce((a, d) => a + sv.wordAt(d), 0) + sv.wordAt(0x3c70)}`);
for (let n = 0; n < 40; n++) alloc.keydown({ key: 'g' });
for (let n = 0; n < 40; n++) alloc.keydown({ key: 't' });
check('the per-stat caps hold: "t" spends into system 2 up to its cap and sum(stats)+pool stays at the budget (@0x299ad caps, re-derived @0x23f67)',
  sv.wordAt(0x3c62) <= 0xde && sv.wordAt(0x3c70) >= 0 && ds.reduce((a, d) => a + sv.wordAt(d), 0) + sv.wordAt(0x3c70) === sv.wordAt(0x3c5c),
  `sys3=${sv.wordAt(0x3c62)} pool=${sv.wordAt(0x3c70)} budget=${sv.wordAt(0x3c5c)}`);

// The same keys inside state 3, where the pager arms live (@0x2ebc3 forward, @0x2ebe9 back).
const s3 = await createSession();
s3.keydown({ key: 'a' }); // make 0x1e -> mode 3 (@0x2e6ef)
s3.state.sv.wordAt(0x13c56 - 0x10000, 3); // three records to page through
const seen = [];
for (const ev of [{ key: 'Enter' }, { key: '=' }, { key: '-' }, { key: '=' }, { key: 'Escape' }]) seen.push(s3.keydown(ev).g?.[0x13c8e]);
check('inside state 3 the keyboard pages the record cursor: 1, "="(0x0d) -> 2, "-"(0x0c) -> 1, "=" -> 2, "=" -> 3, Escape(0x01) leaves (@0x2ebc3, @0x2ebe9, @0x2eb9e)',
  seen.slice(1, 4).join(',') === '2,1,2' && s3.mode === 1,
  `cursor ${seen.slice(0, 4)} then mode ${s3.mode}`);


const sc = await createSession();
t = sc.keydown({ key: 'z' });
check('"z" (make 0x2c) steps DS:0x13572 0 -> 1 (@0x2e7b9)', t.g[g('gathererSelect')] === 1 && sc.mode === 1,
  `DS:0x13572=${sc.state.g[g('gathererSelect')]}`);
t = sc.inject(0x1e);
check('and from that pass on the pump emits no event code (TODO_GATHERERS.level1)',
  sc.mode === 1 && t.trace.some((x) => x.startsWith('UNCONFIRMED gatherer')),
  `${t.trace.find((x) => x.startsWith('UNCONFIRMED gatherer')).slice(0, 72)}…`);


// --- 8. APPENDIX C: states 2, 3 and 4 now execute their documented arms --------------------
const { GLOBALS: G } = await import('../src/engine/loop.ts');
const m3b = await createSession();
m3b.inject(0x1e); // -> mode 3 (0x1e = Ctrl+^^, written @0x2e6ef)
const gated = m3b.inject(0x0d);
check('the pump epilogue re-writes the ASCII latch at @0x24502 every pass, so state 3\'s [0x5bb8] gate is fed by the pump, not by a key',
  gated.trace.some((x) => x.includes('0x15bb8=') && x.includes('@0x24502')),
  gated.trace.filter((x) => x.includes('0x15bb8=')).join(' · ').slice(0, 60));

const m3c = await createSession();
m3c.inject(0x1e);
const pageCountFresh = m3c.state.sv.wordAt(0x13c56 - 0x10000);
// The latch needs no forcing here: the epilogue sets it (@0x24502).
const noRecords = m3c.inject(0x0d);
check(`state 3: a fresh BH_START carries DS:0x13c56 = ${pageCountFresh} records, so 0x0d is skipped at the count test (@0x2ebc7) even with the latch set`,
  noRecords.trace.some((x) => x.includes('[0x13c56]=0x0') && x.includes('arm skipped')),
  noRecords.trace.filter((x) => x.includes('skipped')).join(' · ').slice(0, 78));

// Give it something to page through: the count is a blob word, so writing it is the same edit the
// engine's own record loader would have made.
m3c.state.sv.wordAt(0x13c56 - 0x10000, 3);
const p1 = m3c.inject(0x0d);
const p2 = m3c.inject(0x0d);
const p3 = m3c.inject(0x0d);
check('state 3: with DS:0x13c56 = 3 and the blob cursor DS:0x13c8e = 1, 0x0d pages 2 -> 3 and then the wrap store @0x2ebe5 puts it back to 1',
  p1.g[G.pageIndex.addr] === 2 && p2.g[G.pageIndex.addr] === 3 && p3.g[G.pageIndex.addr] === 1,
  [p1, p2, p3].map((r) => r.g[G.pageIndex.addr]).join(' -> '));

const esc3 = m3c.inject(0x01);
check('state 3: Escape writes mode 1 at 0x2eb9e and blits the scratch page through 0x2b04d (@0x2eba1)',
  esc3.mode === 1 && esc3.draws.some((d) => (Array.isArray(d.callee) ? d.callee[0] : d.callee) === 0x2b04d && d.site === 0x2eba1),
  `mode ${esc3.mode}, draws ${JSON.stringify(esc3.draws.map((d) => [d.callee, d.site]))}`);

const m2 = await createSession();
m2.inject(0x12); // -> mode 2 (0x12 = Ctrl+R, written @0x2e722)
const presence = m2.state.sv.wordAt(0x135af - 0x10000);
const pick = m2.inject(0x02); // AL 2 -> member index 1, gated on [0x35af+2] (@0x2ea2a)
check(`state 2: the number keys pick a crew member, gated on the DS:0x135af presence table (fresh entry 1 = ${presence ? 'present' : 'absent'}) (@0x2ea2a..@0x2ea4a)`,
  presence === 0
    ? pick.trace.some((x) => x.includes('presence') && x.includes('arm skipped')) && pick.g[G.memberSel.addr] === undefined
    : pick.g[G.memberSel.addr] === 1,
  pick.trace.filter((x) => x.includes('presence') || x.includes('0x13c4a=')).join(' · ').slice(0, 90));

const m4 = await createSession();
m4.inject(0x11); // -> mode 4 (W, 0x11 @0x2e6ff)
const s4 = m4.inject(0x20);
check('state 4: a code that matches neither table returns at the retf @0x2eb8b with nothing called (no sink, unlike state 2)',
  m4.mode === 4 && s4.trace.some((x) => x.includes('TODO_STATE4_FALLTHROUGH@0x2eac4'))
    && !s4.trace.some((x) => x.includes('0x2e6fa') || x.includes('0x2ea87'))
    && !s4.draws.some((d) => d.site >= 0x2ea8d && d.site <= 0x2eb8b), // no draw from the handler itself
  s4.trace.filter((x) => x.includes('FALLTHROUGH') || x.includes('mode=4')).join(' · ').slice(0, 96));

// --- 9. FUN_231e_7e6d: a mode change actually moves pixels -------------------------------
// The compositor's argument is the mode byte (all 21 lcall sites load AL from [0x3c91]), and the art
// it walks is BH_PAN.DAT — proven by its record geometry matching the routine's own literals.
const cmp = await createSession();
const bootVram = cmp.fb.vram.slice();
const panRecs = walkRecords(decodeFrame(new Uint8Array(readFileSync('web/data/BH_PAN.DAT')), 'stone').pixels);
check('BH_PAN.DAT decodes to the 5-record stream the compositor indexes (3x 91x135, 90x24, 93x65)',
  panRecs.length === 5 && panRecs[0].width === PANEL.w && panRecs[0].height === PANEL.h
  && panRecs[3].width === 90 && panRecs[4].width === BOX.w && panRecs[4].height === BOX.h,
  panRecs.map((r) => `${r.width}x${r.height}`).join(' '));

const in3 = cmp.inject(0x1e); // 'a' -> mode 3 (@0x2e6ef) and the compositor call @0x2e6f2
const rec = panRecs[pageRecord(in3.page ?? 3)];
check('mode 3 blits BH_PAN record 1 to A000:0x5224 = col 228 row 65 (@0x2b0ae, dest from DS:[0x6bb3])',
  cmp.page?.page === 3 && cmp.fb.vram[PANEL.dest] === rec.pixels[0]
  && cmp.fb.vram[PANEL.dest + PANEL.w - 1] === rec.pixels[PANEL.w - 1]
  && cmp.fb.vram[PANEL.dest + (PANEL.h - 1) * 320] === rec.pixels[(PANEL.h - 1) * PANEL.w],
  `page ${cmp.page?.page}, first/last/row86 bytes match pan[1]`);
check('and stamps the 0x8f border down col 227 for 110 rows (@0x2b0c3..@0x2b0d3)',
  Array.from({ length: PANEL.borderRows }, (_, r) => cmp.fb.vram[PANEL.dest - 1 + r * 320]).every((v) => v === PANEL.borderIndex));
check('mode != 1 also paints the 93x65 record 4 box at A000:0xe3 = col 227 row 0 (@0x2b14a, source ES:[0x9871])',
  cmp.fb.vram[BOX.dest] === panRecs[4].pixels[0]
  && cmp.fb.vram[BOX.dest + 320] === panRecs[4].pixels[BOX.w],
  `pan[4][0]=${panRecs[4].pixels[0]} vram[0x${BOX.dest.toString(16)}]=${cmp.fb.vram[BOX.dest]}`);

const backHome = cmp.inject(0x01); // Escape -> mode 1 + page 1 @0x2eba1
// In mode 1 the pump's animation block still runs FUN_231e_8043, whose base is A000:0xd934 with
// sound off (`mov si,0xd934` @0x2b293) = col 244 foot row 173. Those bar pixels legitimately sit on
// the strip, so the strip comparison has to exclude the band it writes.
const BARS = [...Array(8)].map((_, i) => barOriginAt(1, false, i));
const inBars = (col, row) => BARS.some((b) => col >= b.x && col < b.x + 7 && row <= b.y && row > b.y - 37);
let stripBad = '';
for (let y = 0; y < 200 && !stripBad; y++) {
  for (let x = 0; x < 94; x++) {
    if (inBars(226 + x, y)) continue;
    const o = y * 320 + 0xe2 + x;
    // Page 1 runs after FUN_231e_81e8 in this event pass, so it also erases that pass's coordinate
    // glyphs from the strip; the next pump pass redraws them. Compare the compositor source itself.
    if (cmp.fb.vram[o] !== cmp.pageBuf[o]) { stripBad = `row ${y} col ${226 + x}`; break; }
  }
}
check('Escape runs page 1, which restores the 94-column strip from the page buffer and erases the panel (@0x2b11c)',
  backHome.mode === 1 && cmp.page?.page === 1 && stripBad === '',
  stripBad || 'cols 226..319 identical to the PAGE compositor source again');


// ── 10. the script engine: object tables, the 0x500 selector, BH_CONV, zone cutscenes, the clock ──
const SCR = await import('../src/engine/script.ts');
const ZN = await import('../src/engine/zones.ts');
const CLK = await import('../src/engine/clock.ts');
const fileRead = async (n) => new Uint8Array(readFileSync('web/data/' + n));
const exeBytes = new Uint8Array(readFileSync('web/data/SOLAR1.EXE'));
const convBytes = new Uint8Array(readFileSync('web/data/BH_CONV.DAT'));
const peopleBytes = new Uint8Array(readFileSync('web/data/BH_PEOP.DAT'));
const VM = await import('../src/engine/vm.ts');
const TXT = await import('../src/engine/text.ts');

const font = TXT.loadTextFont(new Uint8Array(readFileSync('web/data/BH_CHAR.DAT')), exeBytes);
check('BH_CHAR.DAT is the raw 8x8 indexed font and SOLAR1.EXE DS:0xb300 supplies proportional widths (@0x263d1)',
  TXT.glyphWidth(font, 'A'.charCodeAt(0)) > 0 && TXT.textWidth(font, 'SOLAR WINDS') > TXT.textWidth(font, 'SOLAR'),
  `A=${TXT.glyphWidth(font, 65)} px · title=${TXT.textWidth(font, 'SOLAR WINDS')} px`);

const playable = await createSession();
let starPaint = {};
// --- inertial flight: FUN_231e_02dd @0x234bd + the pump's integrator @0x24199..@0x2433f ---------
const fsv = playable.state.sv;
const s16 = (at) => ((fsv.byteAt(at) | (fsv.byteAt(at + 1) << 8)) << 16) >> 16;
const cam0 = playable.camera, heading0 = fsv.byteAt(0x3c92);
playable.keydown({ key: 'ArrowUp' });
for (let i = 0; i < 40; i++) playable.tick();
const speed = s16(0x3c98);
check('held Up is +3/pass on DS:0x3c98 speed up to the 0x22 cap, and FUN_231e_02dd turns it into sub-pixel deltas',
  speed === 36, `speed=${speed} (the gate is cmp 0x22/jge, so 33 -> 36 and then it holds @0x24480)`);
playable.keydown({ key: 'ArrowUp' });
check('the camera really moves: DS:0x3ec5/0x3ec7 accumulate the deltas and step the five bytes per axis when they cross 128',
  playable.camera.x !== cam0.x || playable.camera.y !== cam0.y,
  `camera ${cam0.x},${cam0.y} -> ${playable.camera.x},${playable.camera.y}`);
playable.keyup({ key: 'ArrowUp' });
const camCoast = playable.camera;
for (let i = 0; i < 12; i++) playable.tick();
check('and nothing decelerates it: there is no friction anywhere in the pump, so the ship coasts after release',
  s16(0x3c98) === speed && (playable.camera.x !== camCoast.x || playable.camera.y !== camCoast.y),
  `speed held at ${speed}, coasted to ${playable.camera.x},${playable.camera.y}`);
const velocityBeforeTurn = { x: s16(0x3e39), y: s16(0x3e37) };
playable.keydown({ key: 'ArrowRight' });
for (let i = 0; i < 6; i++) playable.tick();
playable.keyup({ key: 'ArrowRight' });
const turnedHeading = fsv.byteAt(0x3c92);
const expectedTurnVx = (s16(0x3e3f + turnedHeading * 2) * speed) >> 4;
const expectedTurnVy = (s16(0x3e7f + turnedHeading * 2) * speed) >> 4;
check('a real turn follows FUN_231e_0458 into FUN_231e_02dd @0x237f1, rotating velocity to the new heading',
  turnedHeading !== heading0 && s16(0x3e39) === expectedTurnVx && s16(0x3e37) === expectedTurnVy &&
  (s16(0x3e39) !== velocityBeforeTurn.x || s16(0x3e37) !== velocityBeforeTurn.y),
  `heading ${heading0}->${turnedHeading} · velocity (${velocityBeforeTurn.x},${velocityBeforeTurn.y})->(${s16(0x3e39)},${s16(0x3e37)})`);
playable.keydown({ key: 'Control' });
check('after turning at speed, the player hull, movement vector and newly fired projectile share the same heading',
  playable.playerShip?.heading === turnedHeading && fsv.byteAt(0x1d9b) === turnedHeading &&
  s16(0x3e39) === expectedTurnVx && s16(0x3e37) === expectedTurnVy,
  `ship=${playable.playerShip?.heading} projectile=${fsv.byteAt(0x1d9b)} velocity=(${s16(0x3e39)},${s16(0x3e37)})`);
playable.keyup({ key: 'Control' });
for (let i = 0; i < 40; i++) playable.inject(0x39);           // Space: the brake at @0x243b0
check('Space brakes toward zero 4 units a pass and clamps a positive speed to 0x27 first (@0x243c7)',
  s16(0x3c98) === 0, `speed after braking = ${s16(0x3c98)}`);
fsv.byteAt(0x3c98, 0); fsv.byteAt(0x3c99, 0);
playable.keydown({ key: 'Escape' });
playable.keydown({ key: 's' });
const savedCamera = playable.camera.x;
playable.keydown({ key: 'r' });
playable.keydown({ key: 'ArrowRight' }); playable.keyup({ key: 'ArrowRight' });
playable.keydown({ key: 'Escape' }); playable.keydown({ key: 'l' });
check('the exact F1/Escape disk menu saves and loads the 17,831-byte state blob end-to-end',
  playable.menu === null && playable.camera.x === savedCamera,
  `slot 1 restored camera x=${playable.camera.x}`);

const ship1 = SCR.readRecord(exeBytes, 'ships', SCR.recordAt(exeBytes, 'ships', 1));
const star0 = SCR.readRecord(exeBytes, 'stars', SCR.recordAt(exeBytes, 'stars', 0));
check('the ship table at DS:0x128f (stride 0x17, 1-based) is read out of the EXE data segment: record 1 = CLAW, script id 1',
  ship1.name === 'CLAW' && ship1.scriptId === 1 && /^Known to be the Ship of Emer Kane/.test(ship1.description),
  `${ship1.name} script=${ship1.scriptId} "${ship1.description.slice(0, 34)}…"`);
check('and the star table at DS:0x1e5b (stride 0x1c, 0-based, name at +2) opens with ENIGMA (@0x2d4a9 lea si,[0x1e5b])',
  star0.name === 'ENIGMA' && star0.description.startsWith('The star of this solar system'),
  `${star0.name}: ${star0.description.slice(0, 32)}`);
check('the $-walk is rec+stride then scan to the next $, so records are variable length: ship 2 = ROC at DS:0x1355',
  SCR.recordAt(exeBytes, 'ships', 2) === 0x1355 && SCR.readRecord(exeBytes, 'ships', SCR.recordAt(exeBytes, 'ships', 2)).name === 'ROC');
check('the 0x500 selector: code 0x500 -> star 0, code 1 -> ship 1, code 0 -> no object',
  SCR.classifyObject(0x500).kind === 'star' && SCR.classifyObject(0x500).number === 0
  && SCR.classifyObject(1).kind === 'ship' && SCR.classifyObject(0) === null);

const scn = await createSession();
scn.state.exe = exeBytes; scn.state.conv = convBytes;
scn.inject(0x1e); scn.inject(0x01);                             // a, Escape -> mode 1
// FUN_231e_a01c and FUN_231e_a26d describe what the renderer appended to DS:0x3bf5 at @0x246cd, i.e.
// only what survives the sector (@0x2455f) and 3x3 cell (@0x245a9) culls. The BH_START camera is in an
// empty cell, so first fly: park on actor #0 (star 0, object code 0x500) and paint, then press `s`.
parkOn(scn, 0);
scn.inject(0x1f);                                              // s
const scanLog = scn.state.scriptLog || [];
check('`s` (FUN_231e_a01c @0x2d1fc) prints the real record text of the star on screen, not a trace stub',
  scanLog.some((e) => /^ENIGMA: The star of this solar system\./.test(e.text)),
  (scanLog.find((e) => /^ENIGMA/.test(e.text)) || { text: JSON.stringify(scanLog.map((e) => e.text)) }).text.slice(0, 60));
check('the actor array at DS:0x3d8 is sentinel-terminated by a 0xffff first word (@0x24604..@0x24609): 201 records in BH_START',
  SCR.collectVisible(scn.state.sv).length === 201,
  `${SCR.collectVisible(scn.state.sv).length} actors, each carrying object code 0x500|index`);

const convImg = SCR.decodeConv(convBytes);
check('BH_CONV.DAT is a RAW struct image (@0x2d50b reads 0xEA60 with int 21h/3Fh, no RLE): 0x7210 bytes, magic at +0',
  convBytes.length === 0x7210 && String.fromCharCode(...Array.from(convImg.slice(0, 14))) === 'SOLAR WINDS\x1a\x1a-',
  `${convBytes.length} bytes = 0x${convBytes.length.toString(16)}; and @0x24fc0, the "lcall 0x131e,0x1de0" the old note called an interpreter, is only a 9-byte DS stub returning arena selector 0xbf9`);
check('the CONV node table is the u16 array at +0x521 indexed by (script id - 1) (@0x25079 shl bx,1 / @0x2507b mov ax,[bx+0x521])',
  SCR.CONV.nodeTable === 0x521 && SCR.convNode(convImg, 1).addr === 0x541,
  'node 1 @0x541, text pointer == node+6 (@0x25081 mov ax,[bx])');

// The conversation `c` enters FUN_231e_1e14's own modal loop. The quest switch runs only after that
// function returns, so choices mutate the 64-byte save slot first and Escape/END then applies it.
scn.state.scriptLog = [];
parkOn(scn, 155);                                              // the CLAW: type 0xcd, object code 1
scn.inject(0x2e);                                             // c
await new Promise((r) => setTimeout(r, 120));
const slog = (scn.state.scriptLog || []).filter((e) => e.site === SCR.RUNNER.converseInterp);
check('`c` converse-talks to the on-screen ship and plays a real BH_CONV node with its own choice labels',
  slog.length === 1 && /^Greetings Bounty Hunter\./.test(slog[0].text) && slog[0].choices.length === 4 &&
  /^YES, I AM INTERESTED$/.test(slog[0].choices[0].label),
  slog.map((e) => `"${e.text.slice(0, 34)}…" (${(e.choices || []).length} choices: ${(e.choices || []).map((c) => c.label).join(', ').slice(0, 60)})`).join(' | '));
check('FUN_231e_1e14 is modal: the caller-side quest switch has not run while the VM is awaiting a choice',
  scn.conversation?.scriptId === 1 && scn.state.g[0x10000 + 0x3be7] === undefined,
  `script=${scn.conversation?.scriptId} g[0x3be7]=${scn.state.g[0x10000 + 0x3be7]}`);
check('the modal VM is drawn into A000 with the original shaded backdrop, 0x87 portrait border, glyphs and choices',
  scn.fb.vram[6 * 320 + 13] === 0x87 && scn.fb.vram[7 * 320 + 12] === 0x87 &&
  Buffer.compare(Buffer.from(scn.fb.vram), Buffer.from(scn.pageBuf)) !== 0,
  `border=${scn.fb.vram[6 * 320 + 13].toString(16)} live sha=${sha(scn.fb.vram)}`);
const reply = (a) => { let e = a; while (e < convImg.length && convImg[e] !== 0x24) e++; return Buffer.from(convImg.subarray(a, e)).toString('latin1'); };
const yes = slog[0].choices.find((c) => /YES, I AM INTERESTED/.test(c.label));
const nope = slog[0].choices.find((c) => /NOT AT ALL INTERESTED/.test(c.label));
check('the choice block is "label$" <u16 reply-address>: YES leads to acceptance, NO to persuasion',
  /Excellent\.\s+The job consists of collecting an escaped criminal/.test(reply(yes.target)) &&
  /You fool\.\s*I am willing to pay you an incredible price/.test(reply(nope.target)),
  `"${reply(yes.target).slice(0, 40)}…" / "${reply(nope.target).slice(0, 40)}…"`);
scn.keydown({ key: '1' });
check('choice 1 follows link 0x783, shows its response, and executes the 0/1/2 effect cascade into script slot 1 (@0x25349..@0x2538d)',
  /^Excellent\.\s+The job consists of collecting an escaped criminal/.test(scn.conversation?.response || '')
  && Array.from(scn.state.sv.region(0x35e1, 7)).join(',') === '1,0,0,1,1,1,1',
  `${scn.conversation?.response?.slice(0, 42)}… slot=${Array.from(scn.state.sv.region(0x35e1, 7))}`);
const replyPages = scn.conversationPage;
check('the reply pages at @0x25f5c instead of truncating: the "Excellent…" response plus the follow-on prompt exceed one ten-row page',
  !!replyPages && replyPages.pages > 1 && replyPages.page === 0,
  replyPages ? `${replyPages.page + 1}/${replyPages.pages}` : 'no pages');
let pageGuard = 0;
while (scn.conversationPage && scn.conversationPage.page < scn.conversationPage.pages - 1 && pageGuard++ < 20) scn.keydown({ key: 'Enter' });
check('turning the response page advances the @0x25f64 wait cursor to the last page without closing the modal',
  scn.conversation !== null && scn.conversationPage?.page === scn.conversationPage?.pages - 1,
  scn.conversationPage ? `${scn.conversationPage.page + 1}/${scn.conversationPage.pages}` : 'closed early');
scn.keydown({ key: 'Escape' });
check('after the modal VM returns, script 1 writes DS:0x3be7=1 / DS:0x3ac9=1 (@0x2d6a8)',
  scn.conversation === null && scn.state.g[0x10000 + 0x3be7] === 1 && scn.state.g[0x10000 + 0x3ac9] === 1,
  `g[0x3be7]=${scn.state.g[0x10000 + 0x3be7]} g[0x3ac9]=${scn.state.g[0x10000 + 0x3ac9]}`);

const portraits = VM.decodePortraits(peopleBytes);
check('BH_PEOP.DAT is the VM art file: 16 <u16 length> records decode into 50x50 portrait animation frames',
  portraits.length === 16 && portraits.every((p) => p.frames.length > 0 && p.frames.every((f) => f.width === 50 && f.height === 50)),
  portraits.map((p) => p.frames.length).join('/') + ' frames');
check('BH_CONV supplies the non-linear frame sequences used by FUN_231e_248f instead of playing every BH_PEOP frame in order',
  VM.portraitAnimation(convBytes, 3).slice(0, 8).join(',') === '2,3,4,2,3,2,4,5' &&
  VM.portraitAnimation(convBytes, 15).slice(0, 8).join(',') === '1,2,3,4,1,2,1,3' &&
  VM.portraitAnimation(convBytes, 3).length === 60,
  `portrait 3: ${VM.portraitAnimation(convBytes, 3).slice(0, 8).join(',')} · portrait 15: ${VM.portraitAnimation(convBytes, 15).slice(0, 8).join(',')}`);
const isolated = new State(readFileSync('web/data/BH_START.DAT'));
const vm1 = VM.createConversationVm(convBytes, isolated, 1, peopleBytes);
check('the complete VM loads all three original data sources without caller-supplied tables',
  vm1.view().node === 0x541 && vm1.view().portrait?.index === 14 && vm1.view().alternatePortrait?.index === 15 &&
  vm1.view().portrait?.animation?.slice(0, 4).join(',') === '1,2,3,1',
  `node=0x${vm1.view().node.toString(16)} portrait=${vm1.view().portrait?.index}/${vm1.view().alternatePortrait?.index} animation=${vm1.view().portrait?.animation?.slice(0, 4)}`);
check('CONV_EFFECTS covers every id the switch at @0x2d53f..@0x2d6f3 tests, with the zone gates',
  [1, 4, 5, 9, 10, 11, 13, 14, 15].every((i) => SCR.CONV_EFFECTS[i]) &&
  SCR.CONV_EFFECTS[4].zone === 1 && SCR.CONV_EFFECTS[11].zone === 2 && SCR.CONV_EFFECTS[14].zone === 3,
  'zone cutscenes hang off ids 4 / 0xb / 0xe via `inc byte[gate]` + `cmp` (@0x2d6c8, @0x2d6eb)');
check('no shipped static record carries the zone-gate ids: ships give 1,2,3,9,13 and all 201 stars give 0',
  (() => {
    // The live DOS data image is writable and the completed conversation above cleared CLAW's
    // script byte. Re-read the shipped artifact for this static-data assertion.
    const shippedExe = new Uint8Array(readFileSync('web/data/SOLAR1.EXE'));
    const seen = new Set();
    for (let n = 1; n <= 9; n++) { const id = SCR.readRecord(shippedExe, 'ships', SCR.recordAt(shippedExe, 'ships', n)).scriptId; if (id && id < 16) seen.add(id); }
    for (let n = 0; n < 201; n++) { const id = SCR.readRecord(shippedExe, 'stars', SCR.recordAt(shippedExe, 'stars', n)).scriptId; if (id) seen.add(id); }
    return [...seen].sort((a, b) => a - b).join(',') === '1,2,3,9,13';
  })(),
  'so the zone sequences are entered by runtime-assigned ids, not by the static tables — recorded as an open end');

const z1 = await ZN.loadZoneAssets(1, fileRead);
const z3 = await ZN.loadZoneAssets(3, fileRead);
check('zone 1 loads two full-screen frames (BH_MW1A/MW1B, wind variant, 0xc350 read = 64000 px)',
  z1.frames.length === 2 && z1.frames.every((f) => f.pixels.length === 64000),
  z1.frames.map((f) => f.file).join(' + '));
check('zone 3 is MW3A[0..3] + MW3B[0..3] record planes framed <u8 w><u8 h><w*h>, step 2+w*h (@0x2a312) — not INT 21h/42h seeks',
  z3.records.length === 2 && z3.records.every((r) => r.list.length === 4)
  && z3.records[0].list.every((r) => r.pixels.length === r.width * r.height),
  z3.records.flatMap((r) => r.list.map((x) => `${x.width}x${x.height}`)).join(' '));
const zv = new Uint8Array(64000);
const zp = ZN.createZonePlayer(z3, zv);
for (let i = 0; i < 160; i++) zp.step();
check('stepping zone 3 paints planet sprites into A000 (final vram nonzero @0x2a925..@0x2a966)',
  zv.reduce((a, b) => a + (b ? 1 : 0), 0) > 3000,
  `${zv.reduce((a, b) => a + (b ? 1 : 0), 0)}/64000 indices set`);

check('the frame clock is PIT counter 2 spun in the pump (@0x23dd9..@0x23ded) reloaded 0x7918 = 31000 counts, not a timer interrupt',
  Math.abs(CLK.PUMP_PERIOD_MS - (31000 / 1193181.6666) * 1000) < 1e-9
  && Math.round(CLK.PUMP_HZ * 100) === 3849 && CLK.SCENE_RELOAD === 0x8ca0,
  `${CLK.PUMP_PERIOD_MS.toFixed(3)} ms/pass = ${CLK.PUMP_HZ.toFixed(2)} Hz; scenes ${CLK.SCENE_PERIOD_MS.toFixed(3)} ms`);

check('the actor walk paints BH_PLAN sprites: park the camera on a star record and its pixels land over the cockpit page',
  (() => {
    // An actor whose type is < 0xc8 indexes BH_PLAN directly (@0x24720: sprite = type - 1), so this
    // proves the sprite path end to end. Ship/hull records (type >= 0xc8) go through the DS:0xe0f +
    // DS:0xba68 tables instead — see TODO_OBJECT_ART@0x2499d.
    const b = playable.state.sv;
    let star = -1;
    for (let i = 0; i < 220; i++) {
      const a = 0x3d8 + i * 0xd;
      if (b.byteAt(a) === 0xff && b.byteAt(a + 1) === 0xff) break;
      if (b.byteAt(a + 0xa) < 0xc8) { star = a; break; }
    }
    const saved = Array.from({ length: 10 }, (_, k) => b.byteAt(0x3ce + k));
    for (let k = 0; k < 10; k++) b.byteAt(0x3ce + k, b.byteAt(star + k));
    playable.tick();
    const painted = playable.fb.vram.reduce((n, v, i) => n + (v !== playable.pageBuf[i] ? 1 : 0), 0);
    const listed = playable.visibleActors.length;
    const sprite = playable.visibleSprite;   // BH_PLAN record index = type - 1 (@0x24720)
    saved.forEach((v, k) => b.byteAt(0x3ce + k, v));
    playable.tick();
    starPaint = { painted, listed, sprite };
    return listed >= 1 && painted > 200;
  })(),
  `${starPaint.listed} listed · ${starPaint.painted} pixels painted · BH_PLAN record ${starPaint.sprite}`);

let poolScanEmpty = '(none)';

const MSG = await import('../src/engine/messages.ts');
const { advance: advLoop } = await import('../src/engine/loop.ts');
const exeImg = exeBytes;
const poolNames = Object.keys(MSG.MSG);
const poolTexts = poolNames.map((k) => MSG.poolString(exeImg, MSG.MSG[k]));
check('every pool address in messages.ts resolves to ASCII that occurs verbatim in SOLAR1.EXE (re/messages-pool.md)',
  (() => {
    const bad = poolNames.filter((k, i) => {
      const t = poolTexts[i];
      if (!t || t.length < 8) return true;
      // poolString folds 0x60 -> ' the way the engine's own printer does, so normalise the haystack the same way
    const hay = Buffer.from(exeImg.buffer ?? exeImg, exeImg.byteOffset, exeImg.length).toString('latin1').replace(/\x60/g, "'");
      return !hay.includes(t);
    });
    if (bad.length) console.log('   bad pool entries:', bad.map((k) => `${k}=DS:${MSG.MSG[k].toString(16)} -> ${JSON.stringify(MSG.poolString(exeImg, MSG.MSG[k]))}`).join('\n     '));
    return bad.length === 0;
  })(),
  `${poolNames.length} entries, e.g. "${poolTexts[0]}" / "${poolTexts[2]}"`);

check('the invented status strings are gone: `s` with nothing visible prints the shipped DS:0x5949 text',
  (() => {
    const seeded = { ...playable.state, scriptLog: [], trace: [] };
    const after = advLoop(seeded, { events: [{ kind: 'injected', code: 0x1f }] });
    const log = after.scriptLog || [];
    const last = log[log.length - 1] || {};
    if (/NOTHING IN RANGE|UNABLE TO COMMUNICATE/.test(JSON.stringify(log))) return false;
    poolScanEmpty = last.text;
    return last.msgDs === MSG.MSG.objectMustBeOnScreenToScan
      && last.text === MSG.poolString(exeImg, MSG.MSG.objectMustBeOnScreenToScan);
  })(),
  `scriptLog text = ${JSON.stringify(poolScanEmpty)}`);

// --- FUN_231e_a592 @0x2d772, the campaign director: deferred slot triggers grant cargo/ammo/crew --
const RW = await import('../src/engine/rewards.ts');
const startBytes = new Uint8Array(readFileSync('web/data/BH_START.DAT'));
const cargoOf = (sv) => Array.from(sv.region(0x3c7a, sv.wordAt(0x3c56)));
check('a592 trigger 0x66 grants cargo type 8, resets script-1 to stage 3, sets 0x3ac9=1 / 0x3ab9=0',
  (() => {
    const sv = new State(startBytes);
    sv.byteAt(0x35e1 + 10, 0x66);
    const r = RW.applyStoryReward(sv);
    return !!r && r.trigger === 0x66 && sv.byteAt(0x35e1 + 10) === 0 &&
      cargoOf(sv).join(',') === '8' && sv.byteAt(0x35e1) === 3 && sv.wordAt(0x3ac9) === 1;
  })(), 'slot cleared, cargo=[8], script1 stage=3');
check('a592 trigger 0x6f refills both missile banks (+10/+5) and lights four presence words',
  (() => {
    const sv = new State(startBytes);
    const a0 = sv.wordAt(0x359b); const b0 = sv.wordAt(0x35a1);
    sv.byteAt(0x35e1 + 7, 0x6f);
    const r = RW.applyStoryReward(sv);
    return r.trigger === 0x6f && sv.wordAt(0x359b) === a0 + 10 && sv.wordAt(0x35a1) === b0 + 5 &&
      sv.wordAt(0x35b7) === 1 && sv.wordAt(0x3579) === 1;
  })(), 'missile resupply + presence flags');
check('a592 trigger 0x6d grows the crew/AP budget by 200 (0x3c5c) and re-inits sound',
  (() => {
    const sv = new State(startBytes);
    const c0 = sv.wordAt(0x3c5c);
    sv.byteAt(0x35e1 + 5, 0x6d);
    const r = RW.applyStoryReward(sv);
    return r.trigger === 0x6d && r.crew === 200 && sv.wordAt(0x3c5c) === c0 + 200 &&
      r.calls.includes('sound');
  })(), 'crew hiring raises the AP budget');
check('a592 trigger 0x74 relocates the camera to DS:0x3d2..0x3d7 and returns; 0x70 mirrors its 0x5c1a latch',
  (() => {
    const sv = new State(startBytes);
    sv.byteAt(0x35e1 + 3, 0x74);
    const r = RW.applyStoryReward(sv);
    const cam = [0x3d2, 0x3d3, 0x3d4, 0x3d5, 0x3d6, 0x3d7].map((a) => sv.byteAt(a)).join(',');
    const sv2 = new State(startBytes);
    sv2.byteAt(0x35e1 + 3, 0x70);
    const r2 = RW.applyStoryReward(sv2);
    return cam === '200,200,127,127,100,100' && !!r && r.calls.includes('starfield') &&
      r2.latch.includes(0x5c1a);
  })(), 'camera bytes 200,200,7f,7f,64,64 + transient latch routed out of the blob');
check('a shipped conversation choice really leaves a deferred trigger, and applying it mutates the world',
  (() => {
    for (let sid = 1; sid <= 16; sid++) {
      for (let stage = 1; stage <= 6; stage++) {
        let vm; const probe = new State(startBytes); probe.byteAt(0x35e1 + (sid - 1) * 0x40, stage);
        try { vm = VM.createConversationVm(convBytes, probe, sid, peopleBytes); } catch { continue; }
        let n = 0; try { n = vm.view().choices.length; } catch { continue; }
        for (let disp = 0; disp < n; disp++) {
          const sv = new State(startBytes); sv.byteAt(0x35e1 + (sid - 1) * 0x40, stage);
          let vm2; try { vm2 = VM.createConversationVm(convBytes, sv, sid, peopleBytes); } catch { continue; }
          try { vm2.choose(disp); } catch { continue; }
          let planted = 0;
          for (let i = 0; i < 0x40; i++) { const b = sv.byteAt(0x35e1 + (sid - 1) * 0x40 + i); if (b > 0x63 && b !== 0xff) { planted = b; break; } }
          if (planted) {
            const res = RW.applyStoryReward(sv);
            return !!res && res.trigger === planted && !!RW.STORY_REWARDS[planted] &&
              sv.byteAt(0x35e1 + res.slotIndex) === 0;
          }
        }
      }
    }
    return false;
  })(), 'end-to-end: conversation -> slot byte -> reward');
check('a592 returns null when no deferred trigger is pending (fresh save scans clean)',
  RW.applyStoryReward(new State(startBytes)) === null,
  'a fresh BH_START has no reward queued');

// --- the remaining in-world menus: m tasks, / help, d track ---------------------------------------
const TS = await import('../src/engine/textscreen.ts');
const menuSess = await createSession();
menuSess.keydown({ key: 'Enter' }); menuSess.tick?.(); menuSess.keydown({ key: 'Enter' }); menuSess.tick?.();
check('`m` opens the TASKS list (FUN_231e_3a81 @0x26c61) driven by the DS:0x3ab5 quest-word array',
  (() => {
    menuSess.keydown({ key: 'm' });
    const sc = menuSess.state.textScreen;
    const shown = !!sc && sc.title.trim() === 'TASKS TO COMPLETE' &&
      sc.body.some((b) => /sector -31,1 to meet with Emer Kane/.test(b));
    menuSess.keydown({ key: 'x' });
    return shown && menuSess.state.textScreen === null;
  })(), 'header + the active mission string, dismissed on a key');
check('a reward that sets a quest word makes the matching task appear in the `m` list',
  (() => {
    const sv = new State(startBytes);
    sv.byteAt(0x35e1 + 4, 0x69);            // @0x2d8c4: cargo 0xc + word DS:0x3abf=1 (task index 5)
    RW.applyStoryReward(sv);
    return TS.activeTasks(exeBytes, sv).some((t) => /Deliver intensifier to asteroid in sector 6,-16/.test(t.text));
  })(), 'word DS:0x3abf != 0 -> the intensifier-delivery task is visible');
check('`/` opens the MAIN HELP MENU topic list (@0x2ddc0) and turns a page on the matching key',
  (() => {
    menuSess.keydown({ key: '/' });
    const list = menuSess.state.textScreen;
    const listed = !!list && list.title === 'MAIN HELP MENU' && list.body.length === 7 &&
      /THE STORY/.test(list.body[0]);
    menuSess.keydown({ key: '1' });
    const page = menuSess.state.textScreen;
    const showed = !!page && page.title === 'THE STORY' && (page.body[0]?.length ?? 0) > 200 && page.returnToHelp === true;
    menuSess.keydown({ key: ' ' });
    const back = !!menuSess.state.textScreen?.options;
    menuSess.keydown({ key: '7' });
    return listed && showed && back && menuSess.state.textScreen === null;
  })(), 'topic -> page -> topic -> return-to-game exits');
check('the Control Panel help page switches on the DS:0x3ade sound/message gate (@0x2de46)',
  (() => {
    const exe = exeBytes;
    const off = new State(startBytes); off.byteAt(0x3ade, 0);
    const on = new State(startBytes); on.byteAt(0x3ade, 1);
    const a = TS.helpPageText(exe, off, 2); const b = TS.helpPageText(exe, on, 2);
    return a.length > 0 && b.length > 0 && a !== b;
  })(), 'two distinct page strings for the same option, chosen by the gate');
check('`d` advances the DS:0x3ae1 target to a trackable visible actor (class < 5), or reports NOTHING TO TRACK',
  (() => {
    const sv = menuSess.state.sv;
    sv.wordAt(0x3ae1, 0); menuSess.state.g[0x13ae1] = 0;
    menuSess.state.visibleActors = [];              // force the collectVisible(sv) fallback (@0x24544)
    const before = menuSess.state.scriptLog?.length || 0;
    menuSess.keydown({ key: 'd' });
    const tracked = (menuSess.state.g[0x13ae1] ?? 0) !== 0;
    const saidNone = (menuSess.state.scriptLog || []).slice(before).some((e) => e.msgDs === 0x49a3);
    return (tracked || saidNone) && menuSess.state.mode === 1;   // never leaves flight mode
  })(), 'DS:0x3ae1 set to a class<5 actor, else NOTHING TO TRACK (DS:0x49a3)');

console.log(`\n${pass}/${pass + fail} checks passed · title frame + initialState render proven, ` +
  `states 1..4 run their documented arms, @0x2b04d composites BH_PAN, ` +
  'the script tables describe real planets, `c` plays BH_CONV conversation nodes, and the quest switch writes world flags');
process.exit(fail ? 1 : 0);
