// Status-message pool — the `$`-delimited ASCII block the engine prints cockpit messages from.
//
// Evidence for the address mapping: `rea read-bytes SOLAR1.EXE 0x15a9d` returned
// `204152454120504c414e45545324...` (" AREA PLANETS$") as Evidence
// ev_eb620c8844abf5e1a21f9bc3fe1996f86bcd9be57f59ecb0fb6846d5c2e52758 (authority
// shipped-artifact, sha256 7e7484a4a5ee...). The local file holds the same 64 bytes at
// 0x15a9d - 0xf200 = 0x689d, so `file = DS + 0xE00` and `linear = DS + 0x10000`.
//
// Sites call it with `lea bx,[disp16]` (`8d 1e lo hi`) followed by `lcall 0x131e,0x8bdc`
// (message centre, wraps at 0xc4 px — re/messages-pool.md), or `lcall 0x131e,0x32de`.
//
// Two strings this module replaces were invented by an earlier draft of the port: the scan
// and communicate arms printed "NOTHING IN RANGE" / "UNABLE TO COMMUNICATE", which occur
// nowhere in the shipped image. The real text is below.

import type { Framebuffer } from '../framebuffer.ts';
import { drawWrapped } from './text.ts';
import type { TextFont, WrappedLine } from './text.ts';

/** DS offset -> file offset, verified above. */
export const POOL_FILE_DELTA = 0x0e00;

/** Pool entries, by DS offset. Observed: the bytes are in the shipped image. */
export const MSG = {
  objectMustVisibleToCommunicate: 0x5926, // "OBJECT MUST VISIBLE TO COMMUNICATE"
  objectMustBeOnScreenToScan: 0x5949, // "OBJECT MUST BE ON SCREEN TO SCAN"
  scienceScanReportsNothing: 0x5a6b, // "SCIENCE SCAN REPORTS NOTHING"
  scienceScanLocalPlanets: 0x5a88, // "SCIENCE SCAN OF LOCAL AREA PLANETS"
  scienceScanLocalSpacecraft: 0x5ac5, // "SCIENCE SCAN OF LOCAL SPACECRAFT"
  pressAKey: 0x5aab, // "PRESS A KEY"
  shipUncloaking: 0x59a8, // "A SHIP IS UNCLOAKING NEARBY"
  shipCloaking: 0x59c4, // "A SHIP IS CLOAKING NEARBY"
  noResponse: 0x59de, // "NO RESPONSE ON ANY CHANNEL"
  vadiumDetected: 0x598b, // "VADIUM FIELD DETECTED NEARBY"
  cloakNulled: 0x59f9, // "CLOAK HAS BEEN NULLED"
  nothingToUse: 0x5a0f, // "NOTHING TO USE"
  nothingToTransport: 0x5a1e, // "NOTHING TO TRANSPORT"
  noLaserPower: 0x5a33, // "NO LASER POWER"
  noMisslesLeft: 0x5b83, // "NO MISSLES LEFT" (the shipped spelling)
  insufficientPower: 0x5a42, // "INSUFFICIENT POWER TO SENSORS FOR DETAIL"
  youAreBeingHailed: 0x5b2a, // "YOU ARE BEING HAILED"
  hyperjumpSpeedZero: 0x5b0a, // "CAN'T MAKE HYPERJUMP: SPEED = 0"
  interfere: 0x589a, // "'Someone is starting to interfere with our activities.'"
  takeCare: 0x58d2, // "'Make sure that this problem is taken care of soon.'"
  thatIsAll: 0x5907, // "'That is all.  You may leave.'"
} as const;

/** Read one `$`-terminated pool string straight out of the shipped image. */
export function poolString(exe: Uint8Array, ds: number): string {
  const start = ds + POOL_FILE_DELTA;
  if (start < 0 || start >= exe.length) return '';
  let end = start;
  while (end < exe.length && exe[end] !== 0x24 && exe[end] !== 0x00) end += 1;
  let out = '';
  for (let i = start; i < end; i += 1) out += String.fromCharCode(exe[i]);
  return out.replace(/\x01/g, '').replace(/\x60/g, "'");
}

/**
 * Print a pool message at the documented cursor origin (DS:[0x6bb5] = 0x12cf -> x 15, y 15,
 * text.ts MESSAGE_ORIGIN) with the 0xc4-pixel wrap that FUN_231e_8bdc applies.
 *
 * Inferred, and flagged as such by selftest: the *vertical* slot of a transient status message is
 * not pinned by a quoted write in re/. The origin is the one the port already uses for the other
 * FUN_231e_8bdc callers, so status text lands where narration lands rather than somewhere new.
 */
export function drawMessage(
  fb: Framebuffer,
  font: TextFont,
  exe: Uint8Array,
  ds: number,
  options: { x?: number; y?: number } = {},
): WrappedLine[] {
  return drawWrapped(fb, font, poolString(exe, ds), options);
}
