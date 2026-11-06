#!/usr/bin/env node
// Gameplay probe: measures our engine (and dad-fighter-z's when that repo is present) with identical experiments.
// Usage: node build/tools/gameplay-probe.cjs            (DFZ_REPO=<path to dad-fighter-z-repo> to point at the reference)
// Reported in gameplay-audit.md; phase 0 of that plan turns these numbers into assertions.
const path = require('node:path');
const E = require('../public/engine.js');
let D = null;
try { D = require(path.join(process.env.DFZ_REPO || 'C:/Users/dhaak/Development/dad-fighter-z-repo', 'src/engine.js')); } catch { D = null; }
const BODY = E.SPRITE_HEIGHT, DBODY = 285; // body heights used as the unit
const pct = (v, body) => (100 * v / body).toFixed(1) + '%';
function ours() { const s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight'; s.fighters[0].x = 400; s.fighters[1].x = 480; s.fighters.forEach(f => { f.energy = 60; }); return s; }
function tick(s, a = {}, b = {}) { E.tick(s, [a, b]); }
// --- normals: total frames, hitstun/blockstun, frame advantage (simulated)
function probeNormal(key, variant = 'standing', block = false) {
  const s = ours(); const [p, q] = s.fighters; let pressed = false, contact = -1, attackerFree = -1, defenderFree = -1, stunAtContact = 0, pushed = 0; const x0 = q.x;
  for (let t = 0; t < 120; t++) {
    const a = {}; if (!pressed) { a[key] = true; if (variant === 'crouch') a.down = true; pressed = true; }
    else if (variant === 'crouch') a.down = true;
    const b = block ? { right: true } : {};
    tick(s, a, b);
    if (contact < 0 && q.stun > 0) { contact = t; stunAtContact = q.stun; pushed = q.x - x0; }
    if (contact >= 0 && attackerFree < 0 && !p.move) attackerFree = t;
    if (contact >= 0 && defenderFree < 0 && q.stun === 0) defenderFree = t;
    if (attackerFree >= 0 && defenderFree >= 0) break;
  }
  const m = variant === 'crouch' ? E.VARIANTS.crouch[key] : E.MOVES[key];
  return { key: (variant === 'crouch' ? 'c.' : '') + key, total: m.startup + m.active + m.recovery, startup: m.startup, contact: contact + 1, stun: stunAtContact, adv: defenderFree - attackerFree, push: pushed, damage: m.damage };
}
console.log('== OURS normals (frames): total, startup, hitstun, +hit, blockstun, +block, pushback, damage');
for (const [key, variant] of [['punch', 'standing'], ['kick', 'standing'], ['heavy', 'standing'], ['punch', 'crouch'], ['kick', 'crouch'], ['heavy', 'crouch']]) {
  const h = probeNormal(key, variant, false), b = probeNormal(key, variant, true);
  console.log(`${h.key.padEnd(8)} total ${String(h.total).padStart(2)}  startup ${String(h.startup).padStart(2)}  hitstun ${String(h.stun).padStart(2)} (${h.adv >= 0 ? '+' : ''}${h.adv})  blockstun ${String(b.stun).padStart(2)} (${b.adv >= 0 ? '+' : ''}${b.adv})  push ${pct(h.push, BODY)} instant  dmg ${h.damage}%`);
}
if (D) {
  console.log('\n== DFZ normals (from table): total, startup, hitstun, +hit, blockstun, +block, pushback, damage');
  for (const key of ['LP', 'LK', 'HP', 'HK', 'cLP', 'cLK', 'cHP', 'cHK']) {
    const n = D.N[key], slide = n.push * 1.2 / (1 - .82);
    console.log(`${key.padEnd(8)} total ${String(n.s + n.a + n.r).padStart(2)}  startup ${String(n.s).padStart(2)}  hitstun ${String(n.hs).padStart(2)} (${n.hs ? (n.hs - n.a - n.r >= 0 ? '+' : '') + (n.hs - n.a - n.r) : 'launch/kd'})  blockstun ${String(n.bs).padStart(2)} (${n.bs - n.a - n.r >= 0 ? '+' : ''}${n.bs - n.a - n.r})  push ${pct(slide, DBODY)} slide  dmg ${(n.dmg / 10).toFixed(1)}%`);
  }
}
// --- jumps
function jumpProbe(hold) {
  const s = ours(); const [p] = s.fighters; let apex = 0, frames = 0, airborne = false;
  for (let t = 0; t < 120; t++) { tick(s, hold || t === 0 ? { jump: true } : {}); if (p.y > 0) { airborne = true; frames++; apex = Math.max(apex, p.y); } else if (airborne) break; }
  return { frames, apex };
}
function steerProbe() {
  const s = ours(); const [p] = s.fighters; const vxs = [];
  for (let t = 0; t < 80; t++) { const a = { jump: true, right: t < 20, left: t >= 20 }; tick(s, a); if (p.y > 0) vxs.push(Math.sign(p.vx)); if (vxs.length && p.y === 0) break; }
  return vxs.includes(1) && vxs.includes(-1) ? 'reverses mid-air' : 'committed arc';
}
const full = jumpProbe(true), hop = jumpProbe(false);
console.log(`\n== jumps\nOURS full ${full.frames}f apex ${pct(full.apex, BODY)}, hop ${hop.frames}f apex ${pct(hop.apex, BODY)}, squat 4f, air control: ${steerProbe()}`);
if (D) {
  const dJump = vh => { let h = 0, v = vh, frames = 0, apex = 0; do { v -= D.C.GRAV; h += v; frames++; apex = Math.max(apex, h); } while (h > 0); return { frames, apex }; };
  const dj = dJump(D.C.JUMP_VH), dsj = dJump(D.C.SJUMP_VH);
  console.log(`DFZ  full ${dj.frames}f apex ${pct(dj.apex, DBODY)}, super ${dsj.frames}f apex ${pct(dsj.apex, DBODY)}, squat 3f, air control: committed arc (vx fixed at takeoff)`);
}
// --- launcher follow-up: can the launcher's owner land an air hit before the victim touches down?
function launcherFollow() {
  const s = ours(); const [p, q] = s.fighters; let launched = -1, best = 'no follow-up connects';
  for (let t = 0; t < 140; t++) {
    const a = {};
    if (t === 0) { a.down = true; a.heavy = true; }
    else if (launched >= 0) { a.jump = true; a.right = true; if (p.y > 0) a.punch = true; }
    tick(s, a);
    if (launched < 0 && q.launched) launched = t;
    if (launched >= 0 && q.combo >= 2) { best = `air hit connects at frame ${t} (combo ${q.combo})`; break; }
    if (launched >= 0 && q.y === 0 && q.stun === 0 && t > launched + 5) break;
  }
  return best;
}
console.log(`\n== launcher follow-up\nOURS crouch heavy launch, then jump + punch: ${launcherFollow()}; attacker recovery ${E.VARIANTS.crouch.heavy.recovery}f + squat 4f vs victim airtime ~${Math.round(2 * E.VARIANTS.crouch.heavy.launch / .65)}f`);
if (D) console.log('DFZ  cHP on hit cancels into super jump inside the 9f cancel window; air chain jLP>jLK>jHP>jHK (magic series) by design');
// --- chains
function chainProbe() {
  const s = ours(); const [p, q] = s.fighters; const order = ['punch', 'kick', 'heavy', 'special']; let i = 0, hits = 0, done = false;
  for (let t = 0; t < 200 && !done; t++) {
    const a = {};
    if (i === 0 && t === 0) { a.punch = true; i = 1; }
    else if (i < order.length && p.connected && p.move === order[i - 1]) { a[order[i]] = true; i++; }
    tick(s, a);
    hits = Math.max(hits, q.combo);
    if (i >= order.length && !p.move && !q.stun && q.y === 0) done = true;
  }
  return { hits, damage: 100 - q.hp };
}
const c = chainProbe();
console.log(`\n== chains\nOURS punch>kick>heavy>special: ${c.hits} hits, ${c.damage}% damage (cancel on hit or block, higher rank only, window 9f)`);
if (D) {
  const dchain = ['LP', 'LK', 'HP', 'HK'].reduce((acc, k, i) => acc + Math.round(D.N[k].dmg * D.scaleFor(i, false)), 0);
  console.log(`DFZ  LP>LK>HP>HK: 4 hits, ${(dchain / 10).toFixed(1)}% damage, then special/hyper cancel; launcher > super jump > air chain`);
}
console.log(`\n== health pacing\nOURS 100 HP: jab ${E.MOVES.punch.damage}% -> ${Math.ceil(100 / E.MOVES.punch.damage)} jabs to kill; heavy ${E.MOVES.heavy.damage}%; throw ${E.MOVES.throw.damage}%; super ${E.MOVES.super.damage}x${E.MOVES.super.hits}`);
if (D) console.log(`DFZ  1000 HP: LP ${D.N.LP.dmg / 10}% -> ${Math.ceil(1000 / D.N.LP.dmg)} jabs; HK ${D.N.HK.dmg / 10}%; throw ${D.SP.throw.dmg / 10}%; hyper 9 x ${D.SP.hyperHit.dmg / 10}%`);
// --- CPU vs CPU behaviour over 60 seconds, three seeds
function cpuOurs(seed) {
  const s = E.create(['a', 'b'], { cpuSlots: [true, true], seed, cpuLevel: 4 }); s.phase = 'fight';
  const stats = { hits: 0, blocks: 0, maxCombo: 0, throws: 0, specials: 0, supers: 0, airAttacks: 0 }; const prev = [null, null];
  for (let t = 0; t < 3600; t++) {
    E.tick(s, [{}, {}]);
    for (const e of s.effects) { if (e.life === e.maxLife && e.type === 'hit') stats.hits++; if (e.life === e.maxLife && e.type === 'block') stats.blocks++; }
    s.fighters.forEach((f, i) => { stats.maxCombo = Math.max(stats.maxCombo, f.combo); if (f.move && f.move !== prev[i]) { if (f.move === 'throw' || f.move === 'commandGrab') stats.throws++; else if (E.MOVES[f.move]?.rank === 3) stats.specials++; else if (f.move === 'super') stats.supers++; if (f.moveVariant === 'air') stats.airAttacks++; } prev[i] = f.move; });
    if (s.phase === 'matchover') break;
  }
  return stats;
}
console.log('\n== CPU vs CPU, 60 s (hits, blocks, longest combo, throws, specials, supers)');
for (const seed of [1, 2, 3]) { const o = cpuOurs(seed); console.log(`OURS seed ${seed}: hits ${o.hits} blocks ${o.blocks} combo ${o.maxCombo} throws ${o.throws} specials ${o.specials} supers ${o.supers} air attacks ${o.airAttacks}`); }
if (D) {
  const cpuDfz = seed => {
    const st = D.create({ teams: [['dave', 'david', 'amit'], ['sam', 'scott', 'james']], cpu: [true, true], solo: [true, true], level: [0.7, 0.7], seed });
    const stats = { hits: 0, blocks: 0, maxCombo: 0, throws: 0, specials: 0, supers: 0 };
    for (let t = 0; t < 3600; t++) {
      D.step(st, [{}, {}]);
      for (const e of st.events) { if (e.type === 'hit') { stats.hits++; stats.maxCombo = Math.max(stats.maxCombo, e.combo || 0); } if (e.type === 'block') stats.blocks++; if (e.type === 'throw') stats.throws++; if (e.type === 'special') stats.specials++; if (e.type === 'hyper') stats.supers++; }
      if (st.phase === 'over') break;
    }
    return stats;
  };
  for (const seed of [1, 2, 3]) { const d = cpuDfz(seed); console.log(`DFZ  seed ${seed}: hits ${d.hits} blocks ${d.blocks} combo ${d.maxCombo} throws ${d.throws} specials ${d.specials} hypers ${d.supers}`); }
}
// --- hit detection shape: can a standing jab hit a jumping opponent? can a jumper clear a sweep?
function hitAtHeight(key, h, variant = 'standing') {
  const s = ours(); const [, q] = s.fighters; let hit = false;
  for (let t = 0; t < 30; t++) { q.y = h; q.vy = 0; tick(s, t === 0 ? { [key]: true, down: variant === 'crouch' } : { down: variant === 'crouch' }); if (q.stun > 0) { hit = true; break; } }
  return hit;
}
console.log(`\n== vertical hit shape (reach model: |dy| < 90 ground, < 140 air)\nstanding jab hits an opponent held at height 0/60/89/95: ${[0, 60, 89, 95].map(h => hitAtHeight('punch', h)).join('/')}\nsweep hits an opponent held at height 0/60/89/95: ${[0, 60, 89, 95].map(h => hitAtHeight('kick', h, 'crouch')).join('/')}`);
if (D) console.log('DFZ: rectangle hit and hurt boxes per move and state (stand 92x285, crouch 100x190, airhit 140x170); the sweep box is 44 tall at the floor, LP spans 167-223');
if (!D) console.log('\n(dad-fighter-z engine not found; set DFZ_REPO to compare)');
