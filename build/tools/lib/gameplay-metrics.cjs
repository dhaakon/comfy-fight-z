'use strict';
// Gameplay metrics for Comfy Fighter Z: the acceptance probes of gameplay-audit.md (phase 0).
//
// Every number is measured by simulating the engine through its public surface: E.create, E.tick and the
// JSON state they return (fighter x / y / facing / hp / energy / stocks / move / moveFrame / moveVariant /
// stun / blockStun / launched / combo / connected, state.effects, state.projectiles, state.motionFrame),
// the E.MOVES / E.VARIANTS / E.STYLES tables, E.moveData (when present), E.boxes and E.MAX_HP (100 life points
// when absent). The probes
// press buttons and read the results; they never call engine internals, so they keep working while later
// phases change frame data, pushback, collision, jumps, combos and the CPU.
//
// Conventions (the same as the engine's move tables):
// - Frames are simulated frames at 60 fps (state.motionFrame). Hitstop freezes both fighters and is not counted.
// - Frame 1 of a move is the frame its button is pressed. startup = the first active frame (a strike can
//   connect, a throw can grab or a projectile appears), active = the frames that can connect, total = the
//   frames until the attacker can act again, recovery = total - startup - active.
// - "Can act" = a fresh press of the taunt button (G), which never cancels anything, starts on that frame.
// - Frame advantage = the frame the defender can act minus the frame the attacker can act, with contact on
//   the first active frame at point blank (80 units between centres) and the defender idle (hit) or holding
//   back or down-back (block), so it equals stun - active - recovery. Knockdowns report 'KD' and launches
//   'launch' (rawAdvantageHit keeps the wake-up gap); air moves report stun values and damage but no advantage.
// - hitstun / blockstun = the frames after the last contact frame before the defender can act.
// - Slide = the total distance the defender travels from the contact frame until it comes to rest;
//   slideFrames = the frames on which it moved.
// - Damage is a share of max life (E.MAX_HP, else 100); damagePoints are life points.
// - Meter gain is in gauge units (E.BAR per stock), net of the stocks the move costs and of the passive gain
//   an idle fighter earns over the same frames.
// - Whiff punish: a hit whose defender, on the frame before, was in the recovery frames of a move that had not
//   connected.
// - Anti-air: a hit by a grounded attacker on a defender who, on the frame before, was airborne, not launched
//   and not in hitstun. Grounded means on the ground on the frame before the hit, or in a move that began on
//   the ground (a rising strike that has just left the floor still counts).
// - Block rate on strikes: blocks / strikes that reached the fighter (hit or blocked), counting melee strikes only;
//   throws and command grabs are unblockable and projectiles are counted separately (projectilesFaced / Blocks).
// - Per-slot CPU levels need engine support: cpuVsCpu passes `cpuLevels: [a, b]` to E.create and reads the
//   applied levels back from state.options.cpuLevels (or state.cpuLevels). An engine without it runs both CPUs
//   at `cpuLevel` and the result says perSlotLevels: false.
//
// Inputs use numpad notation relative to facing: 5A (A), 2S (down + S), 6S (toward + S), j.D (air D), 236A,
// 623A, 214A, S+D, A+S, F+D, gc:S+D (guard cancel out of blockstun). A = punch, S = kick, D = heavy,
// F = special, G = taunt. Plain names such as 'jab', 'sweep', 'fireball' or 'super' are accepted too.
const path = require('node:path');

const BUTTONS = { A: 'punch', S: 'kick', D: 'heavy', F: 'special', G: 'taunt' };
const LETTERS = Object.fromEntries(Object.entries(BUTTONS).map(([letter, button]) => [button, letter]));
const ATTACK_BUTTONS = ['punch', 'kick', 'heavy', 'special'];
const ALIASES = { jab: '5A', punch: '5A', kick: '5S', heavy: '5D', special: '5F', taunt: '5G', cjab: '2A', sweep: '2S', launcher: '2D',
  roundhouse: '6S', fireball: '236A', qcf: '236A', rising: '623A', dp: '623A', qcb: '214A', super: 'F+D', blowback: 'S+D', roll: 'A+S', throw: '6D' };
const ARROWS = ['', '↙', '↓', '↘', '←', '', '→', '↖', '↑', '↗'];
const POINT_BLANK = 80, FAR = 600, ORIGIN = 400, SETTLE = 10, MAX_TICKS = 480, LAUNCH_APEX = .2;
// Jump-ins tried for air moves: a neutral jump at point blank, then forward jumps from further out.
const AIR_LEADS = [{ distance: POINT_BLANK, dir: 8 }, { distance: 150, dir: 9 }, { distance: 220, dir: 9 }];
const CONTACTS = new Set(['hit', 'block']);
const DEFAULT_REFERENCE = 'C:/Users/dhaak/Development/dad-fighter-z-repo';

const maxLife = E => E.MAX_HP || 100;
const bodyHeight = E => E.SPRITE_HEIGHT || 225;
const gauge = (E, f) => (f.energy || 0) + (f.stocks || 0) * (E.BAR || 100);
const round = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value;
const clone = state => JSON.parse(JSON.stringify(state));
// The data the engine uses for a move: E.moveData when the engine has it (it resolves variants and the boss's own
// super), else the move tables.
function moveInfo(E, move, variant, boss = false) {
  if (!move) return null;
  const resolved = typeof E.moveData === 'function' ? E.moveData({ move, moveVariant: variant || 'standing', boss: !!boss }) : null;
  return resolved || (variant && E.VARIANTS?.[variant]?.[move]) || E.MOVES?.[move] || null;
}
// Effects the engine emitted on the last tick (effects age at the start of every tick).
const freshContacts = (s, slot) => s.effects.filter(e => e.life === e.maxLife && CONTACTS.has(e.type) && e.attacker === slot);
const snap = f => ({ x: f.x, y: f.y, hp: f.hp, move: f.move, moveFrame: f.moveFrame, moveVariant: f.moveVariant, connected: !!f.connected,
  launched: !!f.launched, stun: f.stun || 0, blockStun: !!f.blockStun });
const startedMove = (f, before) => !!f.move && (f.move !== before.move || f.moveFrame < before.moveFrame);
const inHitstun = f => (f.stun > 0 && !f.blockStun) || !!f.launched;

// ---------------------------------------------------------------- inputs
function parseInput(input) {
  if (input && typeof input === 'object' && Array.isArray(input.digits)) return input;
  const text = String(input ?? '').trim();
  let rest = ALIASES[text] || text, air = false, guardCancel = false;
  if (/^gc[.:]/i.test(rest)) { guardCancel = true; rest = rest.slice(3); }
  if (/^j\./i.test(rest)) { air = true; rest = rest.slice(2); }
  const match = /^([1-9]*)([ASDFG](?:\+[ASDFG])*)$/.exec(rest);
  if (!match) throw new Error(`Unknown input "${text}": use numpad notation such as 5A, 2S, 6S, j.D, 236A, 623A, 214A, S+D or F+D`);
  // Canonical text: 5A for a lone button, but S+D, j.A and gc:S+D without the neutral 5.
  const digits = match[1] || '5', neutral = digits === '5' && (air || match[2].includes('+'));
  return { text: `${guardCancel ? 'gc:' : ''}${air ? 'j.' : ''}${neutral ? '' : digits}${match[2]}`, air, guardCancel,
    digits: digits.split('').map(Number), buttons: match[2].split('+').map(letter => BUTTONS[letter]) };
}
function prettyInput(input) {
  const p = parseInput(input), arrows = p.digits.map(digit => ARROWS[digit]).join('');
  return `${p.guardCancel ? 'guard cancel ' : ''}${p.air ? 'air ' : ''}${arrows ? arrows + ' + ' : ''}${p.buttons.map(b => LETTERS[b]).join(' + ')}`;
}
// One numpad digit as held directions for a fighter facing right (1) or left (-1).
function dirInput(digit, facing = 1) {
  const h = (digit - 1) % 3 - 1, v = Math.floor((digit - 1) / 3) - 1, toward = facing === -1 ? 'left' : 'right', out = {};
  if (h) out[h > 0 ? toward : toward === 'left' ? 'right' : 'left'] = true;
  if (v < 0) out.down = true; else if (v > 0) out.jump = true;
  return out;
}
// The frames of an input: one per motion digit, the buttons on the last.
function scriptFrames(input) { const p = parseInput(input); return p.digits.map((digit, i) => ({ digit, buttons: i === p.digits.length - 1 ? p.buttons : [] })); }
function resolveFrame(frame, facing) { return Object.assign(dirInput(frame.digit, facing), Object.fromEntries(frame.buttons.map(b => [b, true]))); }
function inputFrames(input, facing = 1) { return scriptFrames(input).map(frame => resolveFrame(frame, facing)); }
// What the hand keeps holding after the press: down for a crouching normal, nothing otherwise.
function holdFrame(input) { const p = parseInput(input); return { digit: p.digits.length === 1 && p.digits[0] <= 3 ? 2 : 5, buttons: [] }; }

// ---------------------------------------------------------------- engine helpers
// A fight in progress with slot 0 at x and slot 1 `distance` units to its right, facing each other. reaches: per
// slot, the art-measured reaches a game passes in its fighter profiles (E.artReaches of the fighter's poses).
function arena(E, options = {}) {
  const { distance = POINT_BLANK, x = ORIGIN, styles = [], boss = [], stocks = [], energy = [], reaches = [], seed } = options;
  const ids = ['p1', 'p2'], profiles = {};
  ids.forEach((id, i) => { profiles[id] = {}; if (styles[i]) profiles[id].style = styles[i]; if (boss[i]) profiles[id].boss = true; if (reaches[i]) profiles[id].reaches = reaches[i]; });
  const s = E.create(ids, { cpu: false, profiles, ...(seed === undefined ? {} : { seed }) });
  s.phase = 'fight'; s.message = '';
  s.fighters.forEach((f, i) => { f.x = i ? x + distance : x; f.facing = i ? -1 : 1; f.stocks = stocks[i] || 0; f.energy = energy[i] || 0; });
  return s;
}
// The motion frame on which `slot` can act if it presses taunt now (null if it cannot), tested on a copy.
function actFrame(E, s, slot, inputs = [{}, {}]) {
  const copy = clone(s), probe = [0, 1].map(i => ({ ...(inputs[i] || {}) }));
  for (const button of ATTACK_BUTTONS) delete probe[slot][button];
  probe[slot].taunt = true;
  E.tick(copy, probe);
  return copy.fighters[slot]?.move === 'taunt' && s.fighters[slot].move !== 'taunt' ? copy.motionFrame : null;
}
const canAct = (E, s, slot, inputs) => actFrame(E, s, slot, inputs) !== null;
// Number of strike rectangles E.boxes reports for a fighter (null, one [x, y, w, h], or a list).
function hitboxCount(E, f) {
  let boxes; try { boxes = E.boxes?.(f); } catch { return 0; }
  const hit = boxes && (boxes.hit ?? boxes.hits);
  if (!hit) return 0;
  if (Array.isArray(hit)) return !hit.length ? 0 : typeof hit[0] === 'object' && hit[0] !== null ? hit.filter(Boolean).length : 1;
  return typeof hit === 'object' ? 1 : 0;
}
// Gauge an idle fighter earns per frame (0 once meter only comes from fighting).
const passiveRates = new WeakMap();
function passiveRate(E) {
  if (!passiveRates.has(E)) {
    const s = arena(E, { distance: 300 }), before = gauge(E, s.fighters[0]), start = s.motionFrame;
    for (let i = 0; i < 120; i++) E.tick(s, [{}, {}]);
    passiveRates.set(E, (gauge(E, s.fighters[0]) - before) / Math.max(1, s.motionFrame - start));
  }
  return passiveRates.get(E);
}
function loadReference(dir = process.env.DFZ_REPO || DEFAULT_REFERENCE) {
  try { return require(path.join(dir, 'src', 'engine.js')); } catch { return null; }
}

// ---------------------------------------------------------------- one measured press
function attackerInput(s, cfg, ctx, frames, hold) {
  const f = s.fighters[0], facing = f.facing, lead = cfg.airLead || AIR_LEADS[0];
  if (ctx.stage === 'guard') { if (!ctx.opponentBlocked) return dirInput(4, facing); ctx.stage = 'press'; }
  if (ctx.stage === 'squat') { if (f.y <= 0) return dirInput(lead.dir, facing); ctx.stage = 'air'; ctx.airFrames = 0; }
  if (ctx.stage === 'air') { if (ctx.airFrames < (cfg.airDelay || 0)) { ctx.airFrames++; return {}; } ctx.stage = 'press'; }
  if (ctx.stage === 'press') {
    const input = resolveFrame(frames[ctx.sent++], facing);
    if (cfg.guardCancel) Object.assign(input, dirInput(4, facing));
    if (ctx.sent >= frames.length) { ctx.stage = 'hold'; ctx.pressed = true; }
    return input;
  }
  return resolveFrame(hold, facing);
}
function defenderInput(s, cfg, ctx, guard, tick) {
  if (cfg.guardCancel) return tick === 0 ? { punch: true } : {};
  if (!guard || !ctx.pressed || ctx.release) return {};
  return dirInput(guard === 'crouch' ? 1 : 4, s.fighters[1].facing);
}
// Simulates one press of slot 0 against slot 1 and records what happened. mode: 'identify' (stop once the move
// starts), 'scan' (stop at the first contact, no probes), 'whiff' (opponent far away), 'hit' (opponent idle at
// point blank), 'stand' or 'crouch' (opponent guards high or low from the frame of the press).
function runMeasured(E, cfg, mode) {
  const guard = mode === 'stand' || mode === 'crouch' ? mode : null, probing = mode !== 'identify' && mode !== 'scan';
  const lead = cfg.airLead || AIR_LEADS[0], distance = cfg.distance ?? (mode === 'whiff' ? FAR : cfg.air ? lead.distance : POINT_BLANK);
  const s = arena(E, { distance, styles: [cfg.style, cfg.defenderStyle], boss: [cfg.boss, false], stocks: [cfg.stocks || 0, 0] });
  const frames = scriptFrames(cfg.input), hold = holdFrame(cfg.input);
  const ctx = { stage: cfg.guardCancel ? 'guard' : cfg.air ? 'squat' : 'press', sent: 0, airFrames: 0, pressed: false, opponentBlocked: false, release: false };
  const out = { started: null, air: false, pressFrame: null, contacts: [], activeFrames: [], attackerFree: null, defenderFree: null, moveEnd: null,
    airborneDuring: false, projectile: false, firstActiveGap: null, firstActiveGapBefore: null, xBefore: null, slideFrames: 0, knocked: false, apex: 0, travel: 0, invulnerable: 0, simFrames: 0, defenderPassive: 0,
    hp0: null, gauge0: null, defenderGauge0: null, x0: null };
  let quiet = 0;
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const [a, d] = s.fighters;
    const aIn = attackerInput(s, cfg, ctx, frames, hold);
    if (ctx.pressed && out.pressFrame === null) { out.pressFrame = s.motionFrame + 1; out.hp0 = d.hp; out.gauge0 = gauge(E, a); out.defenderGauge0 = gauge(E, d); out.x0 = a.x; }
    let dIn = defenderInput(s, cfg, ctx, guard, tick);
    if (probing && out.started) {
      if (!out.air && out.attackerFree === null) out.attackerFree = actFrame(E, s, 0, [aIn, dIn]);
      if (out.contacts.length && out.defenderFree === null) out.defenderFree = actFrame(E, s, 1, [aIn, dIn]);
      // Once both sides are free and nothing is in flight the defender lets go of the guard so it does not walk away.
      if (guard && !ctx.release && out.defenderFree !== null && (out.attackerFree !== null || out.moveEnd !== null) && !s.projectiles.some(p => p.owner === 0)) { ctx.release = true; dIn = {}; }
    }
    const before = [snap(a), snap(d)], shots = new Set(s.projectiles), motion = s.motionFrame;
    E.tick(s, [aIn, dIn]);
    const [A, D] = s.fighters, m = s.motionFrame, simulated = m !== motion;
    if (!ctx.pressed) { if (cfg.guardCancel && freshContacts(s, 1).some(e => e.type === 'block')) ctx.opponentBlocked = true; continue; }
    if (!out.started) {
      if (startedMove(A, before[0])) { out.started = { move: A.move, variant: A.moveVariant, airborne: before[0].y > 0, frame: m }; out.air = out.started.airborne; }
      else { if (m - out.pressFrame > 12) break; continue; }
      if (mode === 'identify') break;
    }
    const live = out.moveEnd === null && A.move === out.started.move && !(m > out.started.frame && startedMove(A, before[0]));
    if (out.moveEnd === null && !live) out.moveEnd = A.move ? m : m + 1;
    if (live) {
      const spawned = s.projectiles.some(p => p.owner === 0 && !shots.has(p));
      if (simulated && (hitboxCount(E, A) > 0 || spawned)) {
        if (!out.activeFrames.length) { out.firstActiveGap = Math.abs(D.x - A.x); out.firstActiveGapBefore = Math.abs(before[1].x - before[0].x); }
        out.activeFrames.push(m);
      }
      if (spawned) out.projectile = true;
      if (simulated && A.y > 0) out.airborneDuring = true;
      if (simulated && A.invulnerable > 0) out.invulnerable++;
      out.travel = Math.abs(A.x - out.x0);
    }
    const fresh = freshContacts(s, 0);
    if (fresh.length) {
      const drop = before[1].hp - D.hp;
      if (out.xBefore === null) out.xBefore = before[1].x;
      fresh.forEach((e, i) => out.contacts.push({ frame: m, type: e.type, damage: typeof e.damage === 'number' ? e.damage : i ? 0 : drop }));
      out.defenderFree = null; quiet = 0;
      if (mode === 'scan') break;
    }
    if (out.contacts.length && simulated) { if (Math.abs(D.x - before[1].x) > .01) { out.slideFrames++; quiet = 0; } else quiet++; }
    if (out.contacts.some(c => c.type === 'hit') && D.launched) out.knocked = true;
    if (out.knocked) out.apex = Math.max(out.apex, D.y);
    if (simulated) {
      out.simFrames++;
      if (!out.contacts.length || (fresh.length && out.contacts.length === fresh.length) || (out.defenderFree !== null && m >= out.defenderFree)) out.defenderPassive++;
    }
    const attackerDone = out.air ? out.moveEnd !== null : out.attackerFree !== null, inFlight = s.projectiles.some(p => p.owner === 0);
    if (mode === 'whiff') { if (attackerDone) break; continue; }
    if (!out.contacts.length) { if ((attackerDone || (out.moveEnd !== null && mode === 'scan')) && !inFlight) break; if (m - out.started.frame > 150) break; }
    else if (out.defenderFree !== null && attackerDone && !inFlight && quiet >= SETTLE) break;
  }
  const [A, D] = s.fighters;
  out.slide = out.xBefore === null ? null : Math.abs(D.x - out.xBefore);
  out.damagePoints = out.hp0 === null ? 0 : out.hp0 - D.hp;
  out.gaugeDelta = out.gauge0 === null ? 0 : gauge(E, A) - out.gauge0;
  out.defenderGaugeDelta = out.defenderGauge0 === null ? 0 : gauge(E, D) - out.defenderGauge0;
  return out;
}
function outcome(E, cfg, run, data) {
  const hits = run.contacts.filter(c => c.type === 'hit'), blocks = run.contacts.filter(c => c.type === 'block');
  const result = hits.length ? 'hit' : blocks.length ? 'block' : 'whiff';
  if (result === 'whiff') return { result };
  const last = run.contacts[run.contacts.length - 1].frame, body = bodyHeight(E);
  const label = run.knocked ? data?.knockdown ? 'KD' : data?.launch || run.apex >= LAUNCH_APEX * body ? 'launch' : 'KD' : null;
  const stun = run.defenderFree === null ? null : run.defenderFree - last - 1;
  const raw = !run.air && run.defenderFree !== null && run.attackerFree !== null ? run.defenderFree - run.attackerFree : null;
  const cost = (data?.stocks || 0) * (E.BAR || 100) + (data?.cost || 0), rate = passiveRate(E);
  return { result, hits: hits.length, blocks: blocks.length, label, stun: label || stun, advantage: run.air ? null : label || raw, rawAdvantage: raw,
    damagePoints: round(run.damagePoints, 3), damage: round(run.damagePoints / maxLife(E), 4), hitDamages: run.contacts.map(c => round(c.damage, 3)),
    slide: round(run.slide, 2), slideFrames: run.slideFrames, apex: run.knocked ? round(run.apex / body, 3) : null,
    meterGain: round(run.gaugeDelta + cost - rate * run.simFrames, 2), defenderMeterGain: round(run.defenderGaugeDelta - rate * run.defenderPassive, 2) };
}
// When to press an air move so it connects on its first active frame against a standing opponent.
function findAirTiming(E, cfg, startup) {
  let fallback = null;
  for (const airLead of AIR_LEADS) for (let airDelay = 0; airDelay <= 50; airDelay++) {
    const run = runMeasured(E, { ...cfg, airLead, airDelay }, 'scan');
    if (!run.started || !run.started.airborne) break;
    if (!run.contacts.length) continue;
    if (startup === null || run.contacts[0].frame - run.started.frame + 1 === startup) return { airLead, airDelay };
    fallback = fallback || { airLead, airDelay };
  }
  return fallback;
}

// Reach: the centre-to-centre distance, on the first active frame, beyond which the move no longer connects on that
// frame against an idle standing opponent (found by bisecting the starting distance).
function measureReach(E, cfg, started, startup) {
  const test = distance => {
    const run = runMeasured(E, { ...cfg, distance }, 'scan');
    const same = !!run.started && run.started.move === started.move && run.started.variant === started.variant;
    return { hit: same && !!run.contacts[0] && run.contacts[0].frame - run.started.frame + 1 === startup, gap: same ? run.firstActiveGap : null, gapBefore: same ? run.firstActiveGapBefore : null };
  };
  let near = 20, far = 420;
  if (!test(near).hit || test(far).hit) return null;
  for (let i = 0; i < 18; i++) { const mid = (near + far) / 2; if (test(mid).hit) near = mid; else far = mid; }
  // The first miss gives the gap on the active frame; where the input becomes another move out there (a throw
  // turns into a heavy), the last hit's gap at the start of its active frame stands in.
  const miss = test(far), gap = miss.gap ?? test(near).gapBefore;
  return gap === null || gap === undefined ? null : Math.round(gap);
}

// ---------------------------------------------------------------- catalogue of inputs
function catalogue(E) {
  const styles = Object.keys(E.STYLES || {}).length ? Object.keys(E.STYLES) : ['balanced'];
  const items = [{ input: 'S+D', kind: 'system' }, { input: '6D', kind: 'system' }, { input: 'A+S', kind: 'system' }, { input: 'gc:S+D', kind: 'system' }, { input: 'gc:A+S', kind: 'system' }, { input: '5G', kind: 'system' }];
  for (const digit of ['5', '6', '4', '2', '3', '1']) for (const button of ['A', 'S', 'D']) items.push({ input: digit + button, kind: 'normal' });
  for (const button of ['A', 'S', 'D']) items.push({ input: 'j.' + button, kind: 'air' });
  for (const digit of ['5', '6', '4', '2']) items.push({ input: digit + 'F', kind: 'special' });
  items.push({ input: 'j.F', kind: 'special' });
  for (const style of styles) for (const motion of ['236A', '623A', '214A']) items.push({ input: motion, kind: 'special', style });
  items.push({ input: 'F+D', kind: 'super' }, { input: 'F+D', kind: 'super', style: styles.includes('boss') ? 'boss' : undefined, boss: true });
  return items;
}
function baseConfig(E, item, spec = {}) {
  const input = parseInput(item.input);
  return { input, style: item.style || spec.style || 'balanced', boss: !!(item.boss ?? spec.boss), defenderStyle: spec.defenderStyle || 'balanced',
    guardCancel: input.guardCancel, air: input.air, airLead: AIR_LEADS[0], airDelay: 0, stocks: E.STOCK_MAX || 3 };
}
// Every distinct move the catalogue's inputs start, in catalogue order (cached per engine).
const discoveries = new WeakMap();
function discover(E) {
  if (discoveries.has(E)) return discoveries.get(E);
  const entries = [], seen = new Set();
  for (const item of catalogue(E)) {
    let started = null;
    try { started = runMeasured(E, baseConfig(E, item), 'identify').started; } catch { started = null; }
    if (!started) continue;
    const key = [started.move, started.variant, started.airborne ? 'air' : 'ground', item.boss ? 'boss' : ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const named = item.kind === 'system' || item.kind === 'special' || item.kind === 'super';
    const id = named ? started.move + (started.airborne ? ':air' : '') + (item.boss ? ':boss' : '') : item.input;
    entries.push({ ...item, id, move: started.move, variant: started.variant, airborne: started.airborne });
  }
  discoveries.set(E, entries);
  return entries;
}

// ---------------------------------------------------------------- public measurements
// Frame data of one move. spec: { input } (numpad notation) or { move, variant } (an engine move key, found
// through the input catalogue), plus style, boss, defenderStyle and block (true = stand, then crouch;
// 'stand' or 'crouch' forces the guard; false skips the blocked case).
function measureMove(E, spec = {}) {
  let item;
  if (spec.input !== undefined) {
    const text = parseInput(spec.input).text;
    item = discover(E).find(e => e.input === text && (!spec.style || e.style === spec.style) && !!e.boss === !!spec.boss) || { input: text, style: spec.style, boss: spec.boss };
  } else if (spec.move) {
    item = discover(E).find(e => e.move === spec.move && (spec.variant === undefined || e.variant === spec.variant) && (spec.boss === undefined || !!e.boss === !!spec.boss));
    if (!item) throw new Error(`No input in the catalogue performs ${spec.move}${spec.variant ? ' (' + spec.variant + ')' : ''}`);
  } else throw new Error('measureMove needs { input } or { move, variant }');
  const cfg = baseConfig(E, item, spec);
  const started = item.move ? { move: item.move, variant: item.variant, airborne: item.airborne } : runMeasured(E, cfg, 'identify').started;
  if (!started) throw new Error(`Input ${item.input} does not start a move`);
  const data = moveInfo(E, started.move, started.variant, cfg.boss), notes = [];
  Object.assign(cfg, { stocks: data?.stocks || 0, air: started.airborne });
  // The long-range run times the move unless the input starts something else out there (a throw is a heavy at range).
  const whiff = cfg.guardCancel ? null : runMeasured(E, cfg, 'whiff');
  const timingRun = whiff?.started && whiff.started.move === started.move && whiff.started.variant === started.variant ? whiff : null;
  let startup = timingRun?.activeFrames.length ? timingRun.activeFrames[0] - timingRun.started.frame + 1 : null;
  if (cfg.air) { const timing = findAirTiming(E, cfg, startup); if (timing) Object.assign(cfg, timing); else notes.push('no jump-in connects with a standing opponent'); }
  const hit = runMeasured(E, cfg, 'hit'), source = timingRun || hit;
  const firstContact = hit.contacts.length && hit.started ? hit.contacts[0].frame - hit.started.frame + 1 : null;
  if (startup === null && source.activeFrames.length && source.started) startup = source.activeFrames[0] - source.started.frame + 1;
  const measuredTiming = startup !== null;
  if (startup === null) startup = firstContact ?? data?.startup ?? null;
  const active = source.activeFrames.length ? new Set(source.activeFrames).size : data?.active ?? 0;
  const end = source.started ? (source.air ? source.moveEnd : source.attackerFree) : null;
  const total = end !== null && end !== undefined && source.started ? end - source.started.frame : null;
  const recovery = total !== null && startup !== null ? total - startup - active : null;
  if (firstContact !== null && measuredTiming && firstContact !== startup) notes.push(`contact on frame ${firstContact}, first active frame ${startup}`);
  const h = outcome(E, cfg, hit, data);
  let b = null, blockedBy = null, unblockable = false;
  const block = cfg.guardCancel ? false : spec.block ?? true;
  if (block !== false && h.result !== 'whiff') {
    const tried = [];
    for (const posture of block === 'stand' || block === 'crouch' ? [block] : ['stand', 'crouch']) {
      const o = outcome(E, cfg, runMeasured(E, cfg, posture), data);
      tried.push(o.result);
      if (o.result === 'block') { b = o; blockedBy = posture; break; }
    }
    unblockable = !b && tried.length > 0 && tried.every(result => result === 'hit');
  }
  const air = !!cfg.air, landed = h.result === 'hit';
  return { id: item.id || item.input, kind: item.kind || (air ? 'air' : 'normal'), input: item.input, notation: prettyInput(item.input), move: started.move, variant: started.variant,
    airborne: air, style: cfg.style, boss: cfg.boss, startup, active, recovery, total, measuredTiming,
    hitstun: landed ? h.stun : null, blockstun: b ? b.stun : null,
    advantageHit: air || !landed ? null : h.advantage, advantageBlock: air || !b ? null : b.advantage, rawAdvantageHit: air || !landed ? null : h.rawAdvantage,
    knockdown: landed ? h.label : null, result: h.result,
    damage: h.damage ?? 0, damagePoints: h.damagePoints ?? 0, hits: h.hits ?? 0, hitDamages: h.hitDamages || [],
    chipDamage: b ? b.damage : null, chipDamagePoints: b ? b.damagePoints : null,
    slide: h.slide ?? null, slideFrames: h.slideFrames ?? null, slideBlock: b ? b.slide : null, slideBlockFrames: b ? b.slideFrames : null,
    meterGain: h.meterGain ?? null, meterGainBlock: b ? b.meterGain : null, defenderMeterGain: h.defenderMeterGain ?? null, defenderMeterGainBlock: b ? b.defenderMeterGain : null,
    blockedBy, unblockable, contactFrame: firstContact, launchApex: h.apex ?? null, projectile: source.projectile,
    reach: !cfg.guardCancel && !source.projectile && h.result !== 'whiff' && startup !== null ? measureReach(E, cfg, started, startup) : null,
    travel: round(source.travel, 1), invulnerable: source.invulnerable, airborneDuring: source.airborneDuring,
    strikes: source.activeFrames.length > 0 || hit.contacts.length > 0,
    airTiming: air ? { distance: cfg.airLead.distance, jump: cfg.airLead.dir === 9 ? 'forward' : 'neutral', delay: cfg.airDelay } : null,
    notes };
}
// Frame data of every standing, crouching and air normal, the system moves (blowback, throw, roll, guard
// cancels, taunt), every special (one row per move, from the first style that has it), the super (also the
// boss's) and multi-press sequences such as the three-step rekka. Moves that never strike (the rolls, the taunt
// and the teleport) report their frames and invulnerability with empty strike columns.
function measureAll(E) {
  const rows = [];
  for (const entry of discover(E)) {
    const row = measureMove(E, { input: entry.input, style: entry.style, boss: entry.boss });
    rows.push(Object.assign(row, { id: entry.id, kind: entry.kind }));
  }
  for (const [style, data] of Object.entries(E.STYLES || {})) {
    const move = data.qcb, info = moveInfo(E, move);
    if (!(info?.chain > 1) || rows.some(row => row.id === `${move}:${info.chain}`)) continue;
    const steps = ['214A', ...Array(info.chain - 1).fill('5A')], run = chain(E, steps, { style });
    rows.push({ id: `${move}:${info.chain}`, kind: 'sequence', input: steps.join(' > '), notation: steps.map(prettyInput).join(' > '), move, variant: 'standing', airborne: false, style, boss: false,
      hits: run.hits, combo: run.combo, damage: run.damage, damagePoints: run.damagePoints, hitDamages: run.steps.map(step => step.damagePoints), connected: run.connected, steps: run.steps });
  }
  return rows;
}
// Full jump, hop, forward jump and super jump (down, then up) arcs, plus whether a jump can be steered.
function jumps(E) {
  const body = bodyHeight(E);
  function arc(script) {
    const s = arena(E, { distance: 500 }), f = s.fighters[0], x0 = f.x, dx = [];
    let airtime = 0, apex = 0, takeoff = null, press = null;
    for (let t = 0; t < 200; t++) {
      const input = script(t, f.y > 0, f.facing), x = f.x;
      if (press === null && input.jump) press = s.motionFrame + 1;
      E.tick(s, [input, {}]);
      if (f.y > 0) { if (takeoff === null) takeoff = s.motionFrame; airtime++; apex = Math.max(apex, f.y); dx.push(f.x - x); }
      else if (takeoff !== null) break;
    }
    return { airtime, apex: round(apex / body, 3), apexUnits: round(apex, 1), squat: takeoff === null || press === null ? null : takeoff - press, distance: round(Math.abs(f.x - x0), 1), dx };
  }
  const hold = dir => (t, air, facing) => air ? {} : dirInput(dir, facing);
  const full = arc(hold(8)), hop = arc(t => t === 0 ? { jump: true } : {}), forward = arc(hold(9));
  const superJump = arc((t, air, facing) => t === 0 ? { down: true } : air ? {} : dirInput(8, facing));
  // Steering: a forward jump that holds back once airborne, and a neutral jump that holds forward.
  let airborneFor = 0;
  const reverse = arc((t, air, facing) => { airborneFor = air ? airborneFor + 1 : 0; return !air ? dirInput(9, facing) : airborneFor > 6 ? dirInput(4, facing) : dirInput(6, facing); });
  airborneFor = 0;
  const steer = arc((t, air, facing) => { airborneFor = air ? airborneFor + 1 : 0; return !air ? dirInput(8, facing) : airborneFor > 6 ? dirInput(6, facing) : {}; });
  const reverses = reverse.dx.some(v => v > .01) && reverse.dx.some(v => v < -.01), steers = steer.dx.some(v => Math.abs(v) > .01);
  const strip = ({ dx, ...rest }) => rest;
  return { full: strip(full), hop: strip(hop), forward: strip(forward),
    superJump: { ...strip(superJump), isSuper: superJump.airtime > full.airtime + 2 || superJump.apex > full.apex + .05 },
    reverses, steers, committed: !reverses && !steers, airControl: reverses ? 'reverses mid-air' : steers ? 'steers mid-air' : 'committed arc',
    landingLag: { empty: landingLag(E, null), attacked: landingLag(E, 0) } };
}
// Frames between touching down from a full jump and the first frame the fighter can act (0 = it can act on the
// touchdown frame). attackDelay: press A that many frames after takeoff (null = an empty jump).
function landingLag(E, attackDelay) {
  const s = arena(E, { distance: 500 }), f = s.fighters[0];
  let airborne = false, airFrames = 0, touchdown = null;
  for (let t = 0; t < 240; t++) {
    let input = airborne ? {} : dirInput(8, f.facing);
    if (airborne && touchdown === null && attackDelay !== null && airFrames++ === attackDelay) input = { punch: true };
    const probe = airborne ? actFrame(E, s, 0, [input, {}]) : null;
    E.tick(s, [input, {}]);
    if (!airborne) { airborne = f.y > 0; continue; }
    if (touchdown === null && f.y <= 0) touchdown = s.motionFrame;
    if (touchdown !== null && probe !== null && probe >= touchdown) return probe - touchdown;
  }
  return null;
}
// Presses a cancel sequence such as ['5A', '5S', '5D', '236A'] at point blank. Each step is pressed on the frame
// after the previous step made contact (timing 'cancel'), as soon as the attacker can act ('link'), or a number of
// frames after the contact; a step may be { input, timing }. Options: block, crouch (the defender's posture),
// afterHit (a numpad digit the defender holds from the frame after it is first hit, such as 2 to duck or 1 to
// crouch-guard in hitstun, or 5 to let go of a crouch), style, defenderStyle, boss, stocks, distance, reaches (per
// slot, as for arena).
function chain(E, steps, options = {}) {
  const { block = false, crouch = false, afterHit = null, distance = POINT_BLANK, style, defenderStyle, boss = false, stocks = E.STOCK_MAX || 3, timing = 'cancel', stepTimeout = 120, reaches = [] } = options;
  const plan = steps.map(step => step && typeof step === 'object' && !Array.isArray(step.digits) ? { input: parseInput(step.input), timing: step.timing ?? timing } : { input: parseInput(step), timing });
  const s = arena(E, { distance, styles: [style, defenderStyle], boss: [boss, false], stocks: [stocks, 0], reaches });
  const hp0 = s.fighters[1].hp;
  const results = plan.map(p => ({ input: p.input.text, move: null, variant: null, result: 'not started', startFrame: null, contactFrame: null, hits: 0, blocks: 0, damagePoints: 0 }));
  let current = -1, queue = [], hold = { digit: 5, buttons: [] }, issuedAt = null, lastContact = null, combo = 0, hits = 0, blocks = 0, idle = 0;
  const defender = facing => hits && afterHit !== null ? dirInput(afterHit, facing) : block ? dirInput(crouch ? 1 : 4, facing) : crouch ? { down: true } : {};
  for (let tick = 0; tick < 1200; tick++) {
    const [a, d] = s.fighters, dIn = defender(d.facing);
    if (!queue.length && current + 1 < plan.length) {
      const next = plan[current + 1], prev = results[current];
      let ready = current < 0;
      if (!ready && prev.contactFrame !== null) ready = next.timing === 'cancel' || (next.timing === 'link' ? canAct(E, s, 0, [resolveFrame(hold, a.facing), dIn]) : typeof next.timing === 'number' && s.motionFrame - prev.contactFrame >= next.timing);
      if (ready) { current++; queue = scriptFrames(next.input); hold = holdFrame(next.input); issuedAt = tick; }
      else if (current >= 0 && tick - issuedAt > stepTimeout) break;
    }
    const aIn = queue.length ? resolveFrame(queue.shift(), a.facing) : resolveFrame(hold, a.facing), before = snap(a);
    E.tick(s, [aIn, dIn]);
    const A = s.fighters[0], D = s.fighters[1], step = results[current];
    if (step && startedMove(A, before) && step.startFrame === null) { step.move = A.move; step.variant = A.moveVariant; step.startFrame = s.motionFrame; step.result = 'whiff'; }
    const fresh = freshContacts(s, 0);
    if (fresh.length && step) {
      const drop = fresh.reduce((sum, e) => sum + (typeof e.damage === 'number' ? e.damage : 0), 0);
      for (const e of fresh) { if (e.type === 'hit') { step.hits++; hits++; } else { step.blocks++; blocks++; } }
      step.damagePoints = round(step.damagePoints + drop, 3);
      if (step.contactFrame === null) step.contactFrame = s.motionFrame;
      step.result = step.hits ? 'hit' : 'block';
      combo = Math.max(combo, D.combo || 0);
      lastContact = tick;
    }
    if (current === plan.length - 1 && !queue.length) {
      const settled = lastContact === null ? tick - issuedAt > stepTimeout : tick - lastContact > 20;
      if (settled && canAct(E, s, 0) && canAct(E, s, 1) && !s.projectiles.some(p => p.owner === 0)) break;
      if (++idle > 600) break;
    }
  }
  const damagePoints = round(hp0 - s.fighters[1].hp, 3);
  return { steps: results, hits, blocks, combo, damagePoints, damage: round(damagePoints / maxLife(E), 4),
    connected: results.every(r => r.result === 'hit' || r.result === 'block'), allHit: results.every(r => r.result === 'hit'), comboIntact: hits > 0 && combo === hits };
}
// The launcher's follow-up. route 'jump' jumps toward the victim as soon as the attacker can act; route
// 'superjump' presses up inside the launcher's cancel window (it only leaves the ground if the engine lets the
// launcher cancel into a jump). The first air step is pressed `delay` frames after takeoff and each later one on
// the frame after the previous one connects or ends; the best delay is reported. starter: steps before the
// launcher; relaunch: press the launcher again once both have landed.
function launcherFollowUp(E, options = {}) {
  const { starter = [], launcher = '2D', route = 'jump', air = ['j.A', 'j.S', 'j.D'], relaunch = false, maxDelay = 30, style } = options;
  const body = bodyHeight(E), life = maxLife(E);
  const base = launchSnapshot(E, [...starter, launcher], style);
  const summary = { route, starter, launcher, launched: !!base, openingHits: base ? base.hits : 0, victimAirtime: null, victimApex: null, victimRecovered: null, jumped: false,
    takeoffFrame: null, delay: null, followUpHits: 0, connects: false, firstFollowUpFrame: null, combo: base ? base.combo : 0,
    damagePoints: base ? base.points : 0, damage: base ? round(base.points / life, 4) : 0, steps: [], relaunch: null };
  if (!base) return summary;
  let best = null;
  for (let delay = 0; delay <= maxDelay; delay++) {
    const run = followUp(E, base, { route, air, delay, relaunch: false });
    if (!best || run.followUpHits > best.followUpHits) best = { ...run, delay };
    if (!run.jumped) break;
  }
  const final = relaunch ? { ...followUp(E, base, { route, air, delay: best.delay, relaunch: true }), delay: best.delay } : best;
  const damagePoints = round(base.points + final.followUpPoints, 3);
  return Object.assign(summary, { victimAirtime: final.victimAirtime, victimApex: round(final.victimApex / body, 3), victimRecovered: final.victimRecovered,
    jumped: final.jumped, takeoffFrame: final.takeoffFrame, delay: final.followUpHits ? final.delay : null, followUpHits: final.followUpHits, connects: final.followUpHits > 0,
    firstFollowUpFrame: final.firstFollowUpFrame, combo: Math.max(base.combo, final.combo), damagePoints, damage: round(damagePoints / life, 4), steps: final.steps, relaunch: final.relaunch });
}
// Plays the opening steps (each on the frame after the previous contact) and returns the state on the frame
// after the launcher's hit, or null if it did not launch.
function launchSnapshot(E, steps, style) {
  const plan = steps.map(parseInput), s = arena(E, { styles: [style], stocks: [E.STOCK_MAX || 3, 0] }), hp0 = s.fighters[1].hp;
  let current = -1, queue = [], hold = { digit: 5, buttons: [] }, contacted = false, hits = 0;
  for (let tick = 0; tick < 400; tick++) {
    if (!queue.length && current + 1 < plan.length && (current < 0 || contacted)) { current++; queue = scriptFrames(plan[current]); hold = holdFrame(plan[current]); contacted = false; }
    const a = s.fighters[0];
    E.tick(s, [queue.length ? resolveFrame(queue.shift(), a.facing) : resolveFrame(hold, a.facing), {}]);
    const fresh = freshContacts(s, 0);
    if (fresh.length) {
      contacted = true; hits += fresh.filter(e => e.type === 'hit').length;
      if (current === plan.length - 1) return s.fighters[1].launched ? { json: JSON.stringify(s), frame: s.motionFrame, hits, combo: s.fighters[1].combo || 0, points: round(hp0 - s.fighters[1].hp, 3) } : null;
    }
  }
  return null;
}
// One follow-up attempt from the launch snapshot. Only hits on a victim that has not recovered (still launched or
// in hitstun on the frame before) extend the combo; a jump-in that lands after the victim got up does not count.
function followUp(E, base, { route, air, delay, relaunch }) {
  const s = JSON.parse(base.json), plan = air.map(parseInput);
  const out = { jumped: false, takeoffFrame: null, victimAirtime: null, victimApex: 0, victimRecovered: null, followUpHits: 0, followUpPoints: 0,
    firstFollowUpFrame: null, combo: 0, steps: plan.map(p => ({ input: p.text, result: 'not started' })), relaunch: null };
  let stage = route === 'superjump' ? 'jump' : 'wait', airFrames = 0, index = -1, queue = [], pressedAt = 0, landedAt = null, relaunchAt = null, freeFor = 0;
  for (let tick = 0; tick < 480; tick++) {
    const a = s.fighters[0];
    let input = {};
    if (stage === 'wait' && canAct(E, s, 0)) stage = 'jump';
    if (stage === 'jump') {
      if (a.y > 0) { stage = 'air'; out.jumped = true; out.takeoffFrame = s.motionFrame - base.frame; }
      else {
        input = dirInput(9, a.facing);
        // Without a launcher cancel the held press never becomes a jump: stop once the attacker has stood free a while.
        if (route === 'superjump' && canAct(E, s, 0) && ++freeFor > 8) { stage = 'landed'; input = {}; }
      }
    }
    if (stage === 'air') {
      if (a.y <= 0) stage = 'landed';
      else {
        const step = out.steps[index];
        if (!queue.length) {
          const advance = index < 0 ? airFrames >= delay : step.result === 'hit' || step.result === 'block' || (step.result === 'whiff' && !a.move);
          if (advance && index + 1 < plan.length) { index++; queue = scriptFrames(plan[index]); pressedAt = tick; }
          // A press the engine dropped (still busy) is pressed again once the attacker is free in the air.
          else if (index >= 0 && step.result === 'not started' && !a.move && tick - pressedAt > 2) { queue = scriptFrames(plan[index]); pressedAt = tick; }
        }
        airFrames++;
        if (queue.length) input = resolveFrame(queue.shift(), a.facing);
      }
    }
    if (stage === 'landed' && relaunch && relaunchAt === null && landedAt !== null && canAct(E, s, 0)) { stage = 'relaunch'; relaunchAt = tick; queue = scriptFrames('2D'); out.relaunch = { attempted: true, hit: false, victimDown: null }; }
    if (stage === 'relaunch' && queue.length) input = resolveFrame(queue.shift(), a.facing);
    const before = snap(a), victim = snap(s.fighters[1]);
    E.tick(s, [input, {}]);
    const A = s.fighters[0], D = s.fighters[1], step = out.steps[index];
    if (stage === 'air' && step && step.result === 'not started' && startedMove(A, before)) step.result = 'whiff';
    for (const e of freshContacts(s, 0)) {
      if (stage === 'relaunch') { if (e.type === 'hit') out.relaunch.hit = true; if (out.relaunch.victimDown === null) out.relaunch.victimDown = inHitstun(victim); continue; }
      const juggle = inHitstun(victim);
      if (e.type === 'hit' && juggle) {
        out.followUpHits++; out.followUpPoints += typeof e.damage === 'number' ? e.damage : 0; out.combo = Math.max(out.combo, D.combo || 0);
        if (out.firstFollowUpFrame === null) out.firstFollowUpFrame = s.motionFrame - base.frame;
      }
      if (step) step.result = e.type !== 'hit' ? (step.result === 'hit' ? 'hit' : 'block') : juggle ? 'hit' : 'hit after recovery';
    }
    if (D.y > 0) out.victimApex = Math.max(out.victimApex, D.y);
    if (landedAt === null && D.y <= 0) { landedAt = tick; out.victimAirtime = s.motionFrame - base.frame; }
    if (landedAt !== null && out.victimRecovered === null && !inHitstun(D)) out.victimRecovered = s.motionFrame - base.frame;
    if (stage === 'relaunch') { if (tick - relaunchAt > 40) break; continue; }
    if (out.victimRecovered !== null && A.y <= 0 && (!relaunch || relaunchAt !== null)) break;
  }
  return out;
}
// Whether a move hits an opponent held at a height, or crouching. case: { move, height, attackerHeight (air moves,
// default 100), crouch, distance, style, window, detail }. With detail: true it returns { hit, contact, knockdown,
// landedStanding } instead, after letting both fall and the victim recover: knockdown = the victim was launched or
// knocked down, landedStanding = it came back to its feet without being knocked down.
function hitAt(E, c) {
  const input = parseInput(c.move), s = arena(E, { distance: c.distance ?? POINT_BLANK, styles: [c.style], stocks: [E.STOCK_MAX || 3, 0] });
  const [a, d] = s.fighters, frames = scriptFrames(input), hold = holdFrame(input);
  const height = c.height || 0, attackerHeight = input.air ? c.attackerHeight ?? 100 : c.attackerHeight || 0;
  let contact = null;
  for (let t = 0, sent = 0; t < (c.window ?? 60) + frames.length && !contact; t++) {
    if (height > 0) { d.y = height; d.vy = 0; }
    if (attackerHeight > 0) { a.y = attackerHeight; a.vy = 0; }
    E.tick(s, [resolveFrame(sent < frames.length ? frames[sent++] : hold, a.facing), c.crouch ? { down: true } : {}]);
    const fresh = freshContacts(s, 0);
    if (fresh.length) contact = fresh.some(e => e.type === 'hit') ? 'hit' : 'block';
  }
  if (!c.detail) return contact === 'hit';
  if (!contact) return { hit: false, contact: null, knockdown: false, landedStanding: null };
  let knockdown = !!s.fighters[1].launched;
  for (let t = 0; t < 300; t++) {
    E.tick(s, [{}, {}]);
    if (s.fighters[1].launched) knockdown = true;
    if (s.fighters[1].y <= 0 && canAct(E, s, 1)) break;
  }
  return { hit: contact === 'hit', contact, knockdown, landedStanding: contact === 'hit' && !knockdown };
}
// Projectile jumps. Slot 0 (shooterStyle, balanced by default) fires `shot` (a numpad input such as 5F, 236A or F+D)
// at slot 1 (`style`, the jumper) `distance` units away. The jumper starts its jump on frame k after the shot's first
// input, for every k from 0 to `frames`: up held `hold` frames straight up (neutral), toward the shooter (forward) or
// away (back); a hop taps up for one frame; a super jump holds down on frame k and up for `hold` frames after it. A
// timing clears the shot when every projectile it fires leaves without touching the jumper (no hit and no block).
const JUMP_KINDS = ['neutral', 'forward', 'back', 'hop', 'super'];
function jumpPress(kind, t, k, hold, facing) {
  if (kind === 'hop') return t === k ? { jump: true } : {};
  if (kind === 'super') return t === k ? { down: true } : t > k && t <= k + hold ? { jump: true } : {};
  return t >= k && t < k + hold ? dirInput(kind === 'forward' ? 9 : kind === 'back' ? 7 : 8, facing) : {};
}
function clearsShot(E, cfg, k) {
  const s = arena(E, { distance: cfg.distance, styles: [cfg.shooterStyle, cfg.style], boss: [cfg.shooterStyle === 'boss', cfg.style === 'boss'], stocks: [E.STOCK_MAX || 3, 0] });
  const queue = inputFrames(cfg.shot, 1), jumper = s.fighters[1];
  let fired = false;
  for (let t = 0; t < 400; t++) {
    E.tick(s, [t < queue.length ? queue[t] : {}, jumpPress(cfg.jump, t, k, cfg.hold, jumper.facing)]);
    if (freshContacts(s, 0).length) return false;
    const shots = s.projectiles.filter(p => p.owner === 0);
    if (shots.length) fired = true;
    // Once every shot is gone or past the widest body box (55 units either side of the centre), none can touch it.
    if (fired && shots.every(p => (p.x - jumper.x) * p.facing > (E.projectileBox ? E.projectileBox(p)[2] / 2 : 25) + 56)) return true;
  }
  return false;
}
function projectileJump(E, options = {}) {
  const { style = 'balanced', shooterStyle = 'balanced', shot = '5F', distance = 350, jump = 'neutral', frames = 110, hold = 6 } = options;
  if (!JUMP_KINDS.includes(jump)) throw new Error(`Unknown jump kind "${jump}": use ${JUMP_KINDS.join(', ')}`);
  const cfg = { style, shooterStyle, shot: parseInput(shot), distance, jump, hold }, timings = [];
  for (let k = 0; k <= frames; k++) if (clearsShot(E, cfg, k)) timings.push(k);
  return { style, shooterStyle, shot: cfg.shot.text, distance, jump, frames, hold, timings, clears: timings.length };
}
// The vertical shape of hits: each move against an opponent held at each height, standing and crouching, plus
// any explicit cases.
function hitShape(E, options = {}) {
  const { moves = ['5A', '2S'], heights = [0, 60, 89, 95], cases = [] } = options;
  return { heights,
    rows: moves.map(move => ({ move, notation: prettyInput(move), heights: Object.fromEntries(heights.map(height => [height, hitAt(E, { move, height })])), standing: hitAt(E, { move }), crouching: hitAt(E, { move, crouch: true }) })),
    cases: cases.map(c => ({ ...c, hit: hitAt(E, c) })) };
}
// How many presses of one input (a jab by default) it takes to empty a full life bar, each a fresh hit.
function healthPacing(E, { input = '5A', limit = 150 } = {}) {
  const s = arena(E), frames = scriptFrames(input), life = maxLife(E);
  let hits = 0, first = null;
  for (let exchange = 0; exchange < limit && s.phase === 'fight' && s.fighters[1].hp > 0; exchange++) {
    for (let wait = 0; wait < 400 && !(canAct(E, s, 0) && canAct(E, s, 1)); wait++) E.tick(s, [{}, {}]);
    const [a, d] = s.fighters;
    a.x = ORIGIN; d.x = ORIGIN + POINT_BLANK;
    const hp = d.hp;
    let landed = false;
    for (let t = 0; t < frames.length + 60 && !landed && s.phase === 'fight'; t++) {
      E.tick(s, [t < frames.length ? resolveFrame(frames[t], a.facing) : {}, {}]);
      landed = freshContacts(s, 0).some(e => e.type === 'hit');
    }
    if (!landed) break;
    hits++;
    if (first === null) first = hp - s.fighters[1].hp;
  }
  return { input, maxLife: life, hitsToKill: s.fighters[1].hp <= 0 ? hits : null, hits, firstHitPoints: first, firstHitDamage: first === null ? null : round(first / life, 4) };
}
// Gauge both fighters hold after standing still (meter that comes from doing nothing).
function neutralMeter(E, { seconds = 60 } = {}) {
  const s = arena(E, { distance: 300 }), start = s.fighters.map(f => gauge(E, f));
  let max = Math.max(...start);
  for (let i = 0; i < seconds * 60; i++) { E.tick(s, [{}, {}]); max = Math.max(max, ...s.fighters.map(f => gauge(E, f))); }
  return { seconds, start, end: s.fighters.map(f => round(gauge(E, f), 3)), max: round(max, 3) };
}
// CPU versus CPU. options: level (both) or levels [slot 0, slot 1], seed, seconds (simulated time from FIGHT!),
// match (play on until the match ends, up to maxSeconds), styles, boss, ids. Scripted play: cpu ([slot 0, slot 1],
// false = scripted), setup(state) once after the fight starts and inputs(state, frame) -> [input 0, input 1] every
// frame (it may also arrange the scene), so the behaviour counters can be checked on staged two-player scenarios.
// longestCombo counts every hit; longestConfirm leaves out super-beam hits, so a raw super does not count as a confirm.
function cpuVsCpu(E, options = {}) {
  const { level = 4, levels = null, seed = 1, seconds = 60, match = false, maxSeconds = 1200, styles = [], boss = [], ids = ['p1', 'p2'], cpu = [true, true], setup = null, inputs = null } = options;
  const requested = levels ? levels.slice(0, 2) : [level, level], profiles = {};
  ids.forEach((id, i) => { profiles[id] = {}; if (styles[i]) profiles[id].style = styles[i]; if (boss[i]) profiles[id].boss = true; });
  const s = E.create(ids, { cpuSlots: cpu.slice(0, 2).map(Boolean), seed, cpuLevel: requested[0], cpuLevels: requested, profiles });
  s.phase = 'fight'; s.message = '';
  if (setup) setup(s);
  const applied = Array.isArray(s.options?.cpuLevels) ? s.options.cpuLevels.slice(0, 2) : Array.isArray(s.cpuLevels) ? s.cpuLevels.slice(0, 2) : null;
  const slots = [0, 1].map(() => ({ hits: 0, blocks: 0, strikesFaced: 0, strikeBlocks: 0, blockRate: null, projectilesFaced: 0, projectileBlocks: 0, projectileHits: 0,
    throws: 0, throwAttempts: 0, specials: 0, supers: 0, airAttacks: 0, whiffPunishes: 0, antiAirs: 0, longestCombo: 0, longestConfirm: 0, damageDealt: 0, specialsPerMinute: null }));
  const instance = [0, 1].map(() => ({ connected: false, grounded: true }));
  const rounds = [], limit = Math.round((match ? maxSeconds : seconds) * 60);
  let frames = 0, fightFrames = 0;
  for (; frames < limit && s.phase !== 'matchover'; frames++) {
    const controls = inputs ? inputs(s, frames) || [{}, {}] : [{}, {}];
    const phase = s.phase, pre = s.fighters.map(snap), preInstance = instance.map(i => ({ ...i })), shots = s.projectiles.map(p => [p, p.hits, !!p.super]);
    E.tick(s, controls);
    if (phase !== 'fight') { if (s.phase === 'fight') instance.forEach(i => { i.connected = false; i.grounded = true; }); continue; }
    fightFrames++;
    s.fighters.forEach((f, i) => {
      if (startedMove(f, pre[i])) {
        instance[i] = { connected: false, grounded: pre[i].y <= 0 && f.moveVariant !== 'air' };
        if (f.move !== pre[i].move) {
          const data = moveInfo(E, f.move, f.moveVariant);
          if (f.move === 'throw' || data?.grab) slots[i].throwAttempts++;
          else if (data?.rank === 3) slots[i].specials++;
          else if (data?.rank === 4 || f.move === 'super') slots[i].supers++;
          if (f.moveVariant === 'air') slots[i].airAttacks++;
        }
      } else if (!f.move) instance[i] = { connected: false, grounded: f.y <= 0 };
      if (f.connected) instance[i].connected = true;
    });
    const shotContacts = [0, 0], beamContacts = [0, 0];
    for (const [p, hits, beam] of shots) if (typeof hits === 'number' && typeof p.hits === 'number' && p.hits < hits) { shotContacts[p.owner] += hits - p.hits; if (beam) beamContacts[p.owner] += hits - p.hits; }
    for (const e of s.effects) {
      if (e.life !== e.maxLife || !CONTACTS.has(e.type) || (e.attacker !== 0 && e.attacker !== 1)) continue;
      // A contact comes from a shot already in flight, or from one fired this frame (it can hit on the frame it
      // appears): a move that fires projectiles has no strike of its own.
      const a = e.attacker, d = 1 - a, move = s.fighters[a].move || pre[a].move, fires = !!(moveInfo(E, move)?.projectile || move === 'super');
      const inFlight = shotContacts[a] > 0 ? (shotContacts[a]--, true) : false, projectile = inFlight || fires;
      const beam = inFlight ? beamContacts[a] > 0 && (beamContacts[a]--, true) : projectile && move === 'super';
      const grab = !projectile && (move === 'throw' || !!moveInfo(E, move)?.grab);
      instance[a].connected = true;
      if (e.type === 'hit') {
        slots[a].hits++; slots[a].damageDealt += typeof e.damage === 'number' ? e.damage : 0;
        slots[a].longestCombo = Math.max(slots[a].longestCombo, s.fighters[d].combo || 1);
        if (!beam) slots[a].longestConfirm = Math.max(slots[a].longestConfirm, s.fighters[d].combo || 1);
        if (grab) slots[a].throws++;
        else if (projectile) { slots[d].projectilesFaced++; slots[a].projectileHits++; }
        else slots[d].strikesFaced++;
        const victim = pre[d], data = moveInfo(E, victim.move, victim.moveVariant);
        if (data && victim.moveFrame >= (data.startup || 0) + (data.active || 0) && !preInstance[d].connected) slots[a].whiffPunishes++;
        const grounded = pre[a].y <= 0 || (!projectile && preInstance[a].grounded && !!move);
        if (grounded && victim.y > 0 && !victim.launched && !inHitstun(victim)) slots[a].antiAirs++;
      } else if (projectile) { slots[d].projectilesFaced++; slots[d].projectileBlocks++; slots[d].blocks++; }
      else { slots[d].strikesFaced++; slots[d].strikeBlocks++; slots[d].blocks++; }
    }
    if (s.phase === 'roundover' || s.phase === 'matchover') rounds.push({ ...s.result });
  }
  const life = maxLife(E), minutes = fightFrames / 3600;
  slots.forEach(slot => { slot.blockRate = slot.strikesFaced ? round(slot.strikeBlocks / slot.strikesFaced, 3) : null; slot.damageDealt = round(slot.damageDealt / life, 4); slot.specialsPerMinute = minutes ? round(slot.specials / minutes, 2) : null; });
  const [a, b] = s.fighters, wins = [a.wins || 0, b.wins || 0];
  const winner = s.phase === 'matchover' ? s.winner : wins[0] !== wins[1] ? (wins[0] > wins[1] ? 0 : 1) : a.hp !== b.hp ? (a.hp > b.hp ? 0 : 1) : null;
  const sum = key => slots[0][key] + slots[1][key];
  return { seed, levels: requested, levelsApplied: applied || [s.options?.cpuLevel, s.options?.cpuLevel], perSlotLevels: !!applied,
    frames, fightFrames, seconds: round(frames / 60, 2), matchOver: s.phase === 'matchover', winner, wins, hp: [round(a.hp / life, 4), round(b.hp / life, 4)], rounds, slots,
    totals: { hits: sum('hits'), blocks: sum('blocks'), longestCombo: Math.max(slots[0].longestCombo, slots[1].longestCombo), longestConfirm: Math.max(slots[0].longestConfirm, slots[1].longestConfirm), throws: sum('throws'), throwAttempts: sum('throwAttempts'),
      specials: sum('specials'), supers: sum('supers'), airAttacks: sum('airAttacks'), whiffPunishes: sum('whiffPunishes'), antiAirs: sum('antiAirs') } };
}

// ---------------------------------------------------------------- formatting helpers for the tools
const signed = value => typeof value === 'number' ? (value > 0 ? '+' : '') + value : value ?? '-';
const percent = (value, digits = 1) => typeof value === 'number' ? (value * 100).toFixed(digits) + '%' : '-';

module.exports = {
  measureMove, measureAll, jumps, chain, launcherFollowUp, hitShape, hitAt, projectileJump, JUMP_KINDS, cpuVsCpu, healthPacing, neutralMeter,
  arena, parseInput, prettyInput, inputFrames, dirInput, canAct, actFrame, discover, catalogue, moveInfo, maxLife, bodyHeight, gauge, passiveRate, loadReference,
  signed, percent, round, POINT_BLANK, FAR
};
