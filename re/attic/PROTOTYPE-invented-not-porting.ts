// Solar Winds — playable layer.
//
// Previous version was a slideshow with keys bound: static art, 8px boxes, and the
// only readout in the DOM. This one simulates: velocity + drag + rotation, fuel that
// burns on thrust, pirates that seek and shoot, bullets, collisions, docking, and a
// bitmap HUD drawn INTO the 320x200 indexed frame like the original did.
//
// The zone art stays as the sector background, so the RE'd assets are the arena.

import { decodeFrame } from './rle.ts';
import { Framebuffer, WIDTH, HEIGHT } from './framebuffer.ts';

const BASE = 'data/';
const cache = new Map();
const fb = new Framebuffer();
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('status');

const SECTORS = [
  { name: 'OUTER RIM',  a: 'BH_MW1A.DAT', b: 'BH_MW1B.DAT', pal: 'BH_MP1.DAT', drag: 0.985,
    bodies: [{ x: 60, y: 96, r: 14, c: 46, name: 'DELTAR' }, { x: 168, y: 60, r: 11, c: 92, name: 'KOSMA' },
             { x: 252, y: 130, r: 16, c: 22, name: 'VEGA' }, { x: 300, y: 40, r: 6, c: 15, dock: true, name: 'STATION 7' }] },
  { name: 'INNER RIM',  a: 'BH_MW2A.DAT', b: 'BH_MW2B.DAT', pal: 'BH_MP2.DAT', drag: 0.980,
    bodies: [{ x: 96, y: 140, r: 18, c: 60, name: 'TERRA NOVA' }, { x: 210, y: 84, r: 12, c: 120, name: 'HALCYON' },
             { x: 40, y: 60, r: 6, c: 15, dock: true, name: 'RELAY 2' }] },
  { name: 'CORE SYSTEM', a: 'BH_MW3A.DAT', b: 'BH_MW3B.DAT', pal: 'BH_MP3.DAT', drag: 0.970,
    bodies: [{ x: 140, y: 108, r: 26, c: 172, name: 'THE SUN' }, { x: 260, y: 160, r: 10, c: 84, name: 'ASH' },
             { x: 60, y: 150, r: 6, c: 15, dock: true, name: 'OUTPOST K' }] },
];

const S = {
  scene: 'title', sector: 0, alt: false, bgT: 0,
  ship: { x: 160, y: 100, vx: 0, vy: 0, a: -Math.PI / 2 },
  fuel: 60, hull: 100, credits: 400, cargo: 0, score: 0, wave: 1, t: 0,
  bullets: [], pirates: [], stars: [], msg: '', msgT: 0, mission: null, invuln: 0,
};
const keys = new Set();

async function bin(name) {
  if (!cache.has(name)) cache.set(name, new Uint8Array(await (await fetch(BASE + name)).arrayBuffer()));
  return cache.get(name);
}

// ---- text: rasterise a real font once, then draw it as indexed pixels ----
const fontCache = new Map();
function glyph(ch) {
  if (fontCache.has(ch)) return fontCache.get(ch);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.font = '10px "Courier New", monospace'; g.fillText(ch, 1, 11);
  const d = g.getImageData(0, 0, 16, 16).data;
  const mask = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) if (d[(y * 16 + x) * 4 + 3] > 96) mask.push(x, y);
  fontCache.set(ch, mask);
  return mask;
}
function text(s, x, y, idx = 15) {
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const m = glyph(ch);
    for (let i = 0; i < m.length; i += 2) put(cx + m[i], y + m[i + 1], idx);
    cx += 7;
  }
}
function put(x, y, v) {
  x |= 0; y |= 0;
  if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) { fb.vram[y * WIDTH + x] = v; fb.dirty = true; }
}
function line(x0, y0, x1, y1, v) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
  for (let i = 0; i <= n; i++) put(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, v);
}
function disc(cx, cy, r, v, ring) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.hypot(x, y);
    if (d <= r && (!ring || d > r - 1.6)) put(cx + x, cy + y, v);
  }
}

// ---- world ----
function newStars() {
  S.stars = Array.from({ length: 90 }, () => ({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, v: 1 + (Math.random() * 3 | 0) }));
}
function say(m) { S.msg = m; S.msgT = 2.6; }
function spawnWave() {
  const n = Math.min(1 + S.wave, 6);
  for (let i = 0; i < n; i++)
    S.pirates.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, vx: 0, vy: 0, hp: 2, cool: 1 + Math.random() * 2 });
  say(`PIRATE CONTACT x${n}`);
}

function start() {
  S.scene = 'play'; S.ship = { x: 160, y: 100, vx: 0, vy: 0, a: -Math.PI / 2 };
  S.fuel = 60; S.hull = 100; S.credits = 400; S.cargo = 0; S.score = 0; S.wave = 1;
  S.bullets = []; S.pirates = []; newStars(); nextMission(); spawnWave();
}
function nextMission() {
  const sec = SECTORS[S.sector];
  const targets = sec.bodies.filter(b) => !b.dock);
  const t = targets[Math.random() * targets.length | 0];
  S.mission = { kind: Math.random() < 0.5 ? 'SURVEY' : 'TRADE', target: t.name, pay: 180 + (Math.random() * 220 | 0) };
  say(`MISSION: ${S.mission.kind} ${t.name}`);
}

// ---- per-frame ----
function update(dt) {
  const s = S.ship, sec = SECTORS[S.sector];
  if (keys.has('ArrowLeft') || keys.has('a')) s.a -= 3.4 * dt;
  if (keys.has('ArrowRight') || keys.has('d')) s.a += 3.4 * dt;
  const boost = keys.has('ArrowUp') || keys.has('w');
  if (boost && S.fuel > 0) { s.vx += Math.cos(s.a) * 44 * dt; s.vy += Math.sin(s.a) * 44 * dt; S.fuel -= 6.5 * dt; }
  if (keys.has('ArrowDown') || keys.has('s')) { s.vx *= 1 - 1.6 * dt; s.vy *= 1 - 1.6 * dt; S.fuel -= 1.5 * dt; }
  s.vx *= Math.pow(sec.drag, dt * 60); s.vy *= Math.pow(sec.drag, dt * 60);
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > 92) { s.vx *= 92 / sp; s.vy *= 92 / sp; }
  s.x = (s.x + s.vx * dt + WIDTH) % WIDTH; s.y = (s.y + s.vy * dt + HEIGHT) % HEIGHT;
  if (S.fuel <= 0 && S.scene === 'play') { S.fuel = 0; S.scene = 'dead'; }

  for (const st of S.stars) {
    st.x = (st.x - s.vx * dt * 0.35 * st.v * 0.06 + WIDTH) % WIDTH;
    st.y = (st.y - s.vy * dt * 0.35 * st.v * 0.06 + HEIGHT) % HEIGHT;
  }

  for (const b of S.bodies = sec.bodies) {
    if (Math.hypot(s.x - b.x, s.y - b.y) < b.r + 5) {   // gravity well / collision
      if (b.c > 150 && Math.hypot(s.x - b.x, s.y - b.y) < b.r) { S.hull -= 46 * dt; say('SOLAR BURN'); }
      else { s.vx += (s.x - b.x) * 0.9 * dt; s.vy += (s.y - b.y) * 0.9 * dt; }
    }
    if (b.dock && Math.hypot(s.x - b.x, s.y - b.y) < b.r + 8 && Math.hypot(s.vx, s.vy) < 26) {
      if (keys.has('e')) return dock(b);
      if (!S.dockHintT || S.t - S.dockHintT > 2) { S.dockHintT = S.t; say('DOCKING — PRESS E'); }
    }
  }

  if (S.mission && sec.bodies.some(b) => b.name === S.mission.target && Math.hypot(s.x - b.x, s.y - b.y) < b.r + 10)) {
    S.credits += S.mission.pay; S.score += 100; say(`${S.mission.kind} COMPLETE +${S.mission.pay} CR`);
    nextMission(); if (Math.random() < 0.7) { S.wave++; spawnWave(); }
  }

  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const b = S.bullets[i];
    b.x = (b.x + b.vx * dt + WIDTH) % WIDTH; b.y = (b.y + b.vy * dt + HEIGHT) % HEIGHT; b.life -= dt;
    if (b.life <= 0) { S.bullets.splice(i, 1); continue; }
    if (b.hostile) {
      if (S.invuln <= 0 && Math.hypot(b.x - s.x, b.y - s.y) < 6) { S.hull -= 9; S.invuln = 0.4; S.bullets.splice(i, 1); say('HIT TAKEN'); if (S.hull <= 0) return S.scene = 'dead'; }
    } else for (const p of S.pirates)
      if (Math.hypot(b.x - p.x, b.y - p.y) < 7) { p.hp--; S.bullets.splice(i, 1); if (p.hp <= 0) { S.score += 55; S.pirates.splice(S.pirates.indexOf(p), 1); say('PIRATE DESTROYED'); } break; }
  }

  for (const p of S.pirates) {
    const dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.vx += (dx / d) * 17 * dt; p.vy += (dy / d) * 17 * dt;
    const ps = Math.hypot(p.vx, p.vy); if (ps > 52) { p.vx *= 52 / ps; p.vy *= 52 / ps; }
    p.x = (p.x + p.vx * dt + WIDTH) % WIDTH; p.y = (p.y + p.vy * dt + HEIGHT) % HEIGHT;
    p.cool -= dt;
    if (p.cool <= 0 && d < 150) { p.cool = 1.7; S.bullets.push({ x: p.x, y: p.y, vx: dx / d * 105, vy: dy / d * 105, life: 1.7, hostile: true }); }
    if (S.invuln <= 0 && d < 10) { S.hull -= 14; S.invuln = 0.7; say('RAMMED'); if (S.hull <= 0) return S.scene = 'dead'; }
  }
  if (S.pirates.length === 0) { S.wave++; S.score += 75; spawnWave(); }
  S.invuln = Math.max(0, S.invuln - dt);
  if (S.t > 5 && !keys.has('ArrowUp') && !keys.has('w')) S.fuel -= 0.28 * dt;
}

function dock(b) {
  S.scene = 'dock'; S.dockedAt = b.name; S.fuel = Math.min(100, S.fuel + 40);
  S.cargo = Math.min(6, S.cargo + (S.credits > 90 ? 1 : 0) - 0);
  say(`DOCKED AT ${b.name}`);
}

function shoot() {
  const s = S.ship;
  S.bullets.push({ x: s.x + Math.cos(s.a) * 7, y: s.y + Math.sin(s.a) * 7, vx: Math.cos(s.a) * 165 + s.vx, vy: Math.sin(s.a) * 165 + s.vy, life: 0.9 });
  S.fuel -= 0.25;
}

// ---- render ----
async function drawSector() {
  const sec = SECTORS[S.sector];
  if (!sec.pix) {
    const dat = await bin(sec.a), alt = await bin(sec.b), pal = await bin(sec.pal);
    sec.pix = decodeFrame(dat, 'wind').pixels;
    sec.alt = decodeFrame(alt, 'wind').pixels;
    fb.loadPalette(pal);
  }
  fb.blt(S.alt ? sec.alt : sec.pix, 0);
}

function draw() {
  const s = S.ship;
  for (const st of S.stars) put(st.x, st.y, st.v > 2 ? 7 : 24);
  for (const b of SECTORS[S.sector].bodies) {
    disc(b.x, b.y, b.r, b.dock ? 15 : b.c, !b.dock);
    if (b.dock) { line(b.x - 6, b.y, b.x + 6, b.y, 15); line(b.x, b.y - 6, b.x, b.y + 6, 15); }
    if (S.mission && b.name === S.mission.target) {
      const t = (S.t * 3 | 0) % 4;
      disc(b.x, b.y, b.r + 4 + t, 15, true);
    }
    text(b.name, b.x - b.r - 3, b.y + b.r + 1, b.dock ? 15 : 14);
  }
  for (const b of S.bullets) put(b.x, b.y, b.hostile ? 60 : 15);
  for (const p of S.pirates) { disc(p.x, p.y, 4, 132, true); put(p.x, p.y, 12); }
  if (!(S.invuln > 0 && (S.t * 12 | 0) % 2)) {
    const c = [[Math.cos(s.a), Math.sin(s.a)], [Math.cos(s.a + 2.5), Math.sin(s.a + 2.5)], [Math.cos(s.a - 2.5), Math.sin(s.a - 2.5)]];
    line(s.x + c[0][0] * 8, s.y + c[0][1] * 8, s.x + c[1][0] * 6, s.y + c[1][1] * 6, 15);
    line(s.x + c[1][0] * 6, s.y + c[1][1] * 6, s.x + c[2][0] * 6, s.y + c[2][1] * 6, 15);
    line(s.x + c[2][0] * 6, s.y + c[2][1] * 6, s.x + c[0][0] * 8, s.y + c[0][1] * 8, 15);
    if (keys.has('ArrowUp') || keys.has('w')) { put(s.x - Math.cos(s.a) * 8, s.y - Math.sin(s.a) * 8, 60); S.fuelT = 1; }
  }

  fb.vram.fill(0, 0, 10 * WIDTH);                       // HUD bar
  text(`FUEL ${S.fuel | 0}`, 2, 1, S.fuel < 15 ? 60 : 15);
  text(`HULL ${S.hull | 0}`, 58, 1, S.hull < 30 ? 60 : 15);
  text(`CR ${S.credits}`, 112, 1, 15);
  text(SECTORS[S.sector].name, 176, 1, 14);
  text(`W${S.wave} P${S.pirates.length} X${S.score}`, 262, 1, 15);
  if (S.msgT > 0) { fb.vram.fill(0, 9 * WIDTH, 10 * WIDTH); text(S.msg, 2, 9, 15); }
  if (S.mission) text(`${S.mission.kind} ${S.mission.target}`, 2, 192, 14);
  const mm = new Set([1, 2, 4, 8]);                     // radar
  for (const b of SECTORS[S.sector].bodies) { const d = Math.hypot(b.x - s.x, b.y - s.y); if (d > 120) { put(308 + (b.x - s.x) / WIDTH * 11, 190 + (b.y - s.y) / HEIGHT * 9, 24); } }
}

async function overlay(art, palFile, lines) {
  const [dat, pal] = await Promise.all([bin(art), bin(palFile)]);
  fb.loadPalette(pal); fb.blt(decodeFrame(dat, 'wind').pixels, 0);
  fb.vram.fill(0, HEIGHT * WIDTH - 4 * WIDTH, HEIGHT * WIDTH);
  lines.forEach((l, i) => text(l, 4, HEIGHT - 32 + i * 8, i ? 15 : 14));
}

// ---- loop ----
let prev = 0;
async function loop(ms) {
  const dt = Math.min(0.05, (ms - prev) / 1000) || 0.016; prev = ms; S.t += dt;
  if (S.msgT > 0) S.msgT -= dt;

  if (S.scene === 'title') {
    if (S.t > 4 && S.t < 4.2) S.scene = 'ready';
    await overlay(S.t > 2 ? 'BH_TITLE.DAT' : 'BH_EPIC.DAT', S.t > 2 ? 'BH_PAL.DAT' : 'BH_EPAL.DAT',
      ['SOLAR WINDS', 'ARROWS/WASD FLY  SPACE FIRE  E DOCK  Q WARP']);
  } else if (S.scene === 'ready') {
    await overlay('BH_ORD.DAT', 'BH_PAL.DAT', ['COMMAND ORDERS', 'PRESS ENTER TO LAUNCH']);
  } else if (S.scene === 'play') {
    if (S.t - S.bgT > 0.14) { S.bgT = S.t; await drawSector(); } else await drawSector();
    update(dt); draw();
  } else if (S.scene === 'dock') {
    await overlay('BH_WR.DAT', 'BH_PAL.DAT', [`WAR REPORT - ${S.dockedAt}`, 'R REPAIR  T SELL CARGO  ENTER LAUNCH']);
  } else if (S.scene === 'dead') {
    fb.clear(0);
    text('SHIP LOST', 118, 90, 60); text(`FINAL SCORE ${S.score}`, 108, 102, 15); text('PRESS ANY KEY', 112, 118, 14);
  }
  hud.textContent = `${S.scene.toUpperCase()}  fuel ${S.fuel | 0}  hull ${S.hull | 0}  cr ${S.credits}  score ${S.score}`;
  fb.present(ctx, canvas);
  requestAnimationFrame(loop);
}

addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (S.scene === 'title') { if (e.key === 'Enter') { S.t = 4.1; } return; }
  if (S.scene === 'dead') return start();
  if (S.scene === 'ready' && e.key === 'Enter') return start();
  if (S.scene === 'play') {
    if (e.key === ' ') { e.preventDefault(); shoot(); }
    if (e.key === 'q') { S.sector = (S.sector + 1) % SECTORS.length; S.fuel -= 8; S.pirates = []; S.bullets = [];
      if (S.fuel <= 0) return S.scene = 'dead'; newStars(); nextMission(); spawnWave(); say(`WARP → ${SECTORS[S.sector].name}`); }
  } else if (S.scene === 'dock') {
    if (e.key === 'r' && S.credits >= 120) { S.credits -= 120; S.hull = 100; say('HULL REPAIRED'); }
    if (e.key === 't' && S.cargo > 0) { S.cargo--; S.credits += 150; say('CARGO SOLD +150 CR'); }
    if (e.key === 'Enter') { S.scene = 'play'; S.ship.vx = S.ship.vy = 0; say('LAUNCHED'); }
  }
});
addEventListener('keyup', (e) => keys.delete(e.key));
canvas.addEventListener('click', () => { if (S.scene !== 'play') return; S.ship.a = Math.atan2(100, 160); shoot(); });
canvas.width = WIDTH; canvas.height = HEIGHT; ctx.imageSmoothingEnabled = false;
newStars();
if (new URLSearchParams(location.search).get('gallery') === '1') await import('./app.ts');
else requestAnimationFrame(loop);
