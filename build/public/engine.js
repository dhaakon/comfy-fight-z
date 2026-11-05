(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.FighterEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // The stage scrolls: it is wider than one 960-unit screen, and a screen lock
  // keeps both fighters on camera. The renderer follows their midpoint.
  const SCREEN_W = 960, WIDTH = 1440, GROUND = 438, INPUT_BUFFER = 8, WALL = 50, BODY_GAP = 64;
  // Fighters are drawn 225 px tall from their idle cel; painted reaches are measured at that height.
  const SPRITE_HEIGHT = 225;
  // Painted reach of every cel in game pixels, from the pose metadata the builder writes (width minus anchor).
  function artReaches(poses) {
    const idle = poses?.idle; if (!idle?.bh) return null;
    const scale = SPRITE_HEIGHT / idle.bh, out = {};
    for (const [name, meta] of Object.entries(poses)) if (meta && meta.w > 0 && meta.ax >= 0) out[name] = Math.round((meta.w - meta.ax) * scale);
    return out;
  }
  // A move's hit reach: the cel's painted reach less a fist's width, kept within 80-125% of the move's base reach.
  function reachOf(f, move) {
    const painted = f.reaches?.[move.pose];
    if (!move.reach || !painted) return move.reach;
    return Math.round(Math.max(move.reach * .8, Math.min(move.reach * 1.25, painted - 10)));
  }
  const MAX_DIST = SCREEN_W - 2 * WALL - 40;
  const WALK_FORWARD = 4.6, WALK_BACK = 3.8, RUN_SPEED = 8.2, AIR_SPEED = 4.2, CANCEL_WINDOW = 9;
  const MOTION_WINDOW = 16, DASH_TAP = 12, JUGGLE_LIMIT = 4, JUMP_SQUAT = 4;
  // KOF-style power gauge: each full bar becomes a stock, up to three.
  const BAR = 100, STOCK_MAX = 3, SUPER_STOCKS = 1;
  const DIZZY_LIMIT = 100, DIZZY_FRAMES = 150;
  const DEFAULTS = Object.freeze({ roundsToWin: 2, roundTime: 99, cpuLevel: 4, training: false, trainingMeter: 'infinite' });
  // Fighting styles change speed, damage and the 214 special. Every style keeps
  // the shared 236 projectile and 623 rising strike so the controls stay learnable.
  const STYLES = {
    balanced: { walk: 1, damage: 1, defense: 1, jump: 1, qcf: 'fireball', qcb: 'rush', names: { dp: 'Rising Strike', qcb: 'Charging Rush' } },
    power: { walk: .88, damage: 1.12, defense: .92, jump: .95, qcf: 'fireball', qcb: 'armorRush', names: { dp: 'Rising Hammer', qcb: 'Iron Charge (armored)' } },
    speed: { walk: 1.15, damage: .92, defense: 1.05, jump: 1.06, qcf: 'fastball', qcb: 'rekka', names: { dp: 'Rising Kick', qcb: 'Rhythm Rush (press up to 3x)' } },
    zoner: { walk: .96, damage: .98, defense: 1, jump: 1, qcf: 'fireball', qcb: 'skyshot', names: { dp: 'Rising Palm', qcb: 'Sky Shot (anti-air)' } },
    grappler: { walk: .9, damage: 1.08, defense: .9, jump: .92, qcf: 'fireball', qcb: 'commandGrab', names: { dp: 'Rising Lariat', qcb: 'Block Party Suplex (grab)' } },
    trickster: { walk: 1.08, damage: .95, defense: 1, jump: 1.04, qcf: 'fireball', qcb: 'teleport', names: { dp: 'Rising Spiral', qcb: 'Shortcut (teleport)' } },
    boss: { walk: 1, damage: 1.15, defense: .85, jump: 1, qcf: 'doubleball', qcb: 'commandGrab', names: { dp: 'Sovereign Rise', qcb: 'Eviction Notice (grab)' } }
  };
  // onHit/onBlock are frame advantage once the attacker recovers: plus means
  // the attacker acts first. Ground stun is derived from them so a landed
  // strike is never punishable, while blocked heavies stay risky.
  // height: low must be crouch-blocked, high (jump-ins) must be blocked standing.
  // chip: share of damage a blocked special still deals; normals never chip.
  const MOVES = {
    punch: { startup: 5, active: 4, recovery: 12, reach: 100, damage: 7, pose: 'punch', onHit: 4, onBlock: 0, push: 18, rank: 0 },
    kick: { startup: 10, active: 5, recovery: 18, reach: 142, damage: 12, pose: 'kick', onHit: 2, onBlock: -3, push: 26, rank: 1 },
    heavy: { startup: 9, active: 5, recovery: 20, reach: 126, damage: 15, pose: 'hpunch', onHit: 3, onBlock: -6, push: 32, rank: 2 },
    // S + D: blowback (KOF C + D). Knocks down on hit; guard cancels can use it.
    blowback: { startup: 13, active: 4, recovery: 20, reach: 132, damage: 13, pose: 'blowback', knockdown: true, onBlock: -4, push: 44, rank: 2 },
    // F is the accessible special button: free, slower than the motion version, one shot on screen.
    special: { startup: 16, active: 1, recovery: 22, reach: 0, damage: 17, pose: 'special', rank: 3, chip: .25, projectile: { speed: 8, life: 150 } },
    // Motion specials (keypad notation relative to facing): 236, 623 and 214.
    fireball: { startup: 13, active: 1, recovery: 22, reach: 0, damage: 14, pose: 'special', rank: 3, chip: .25, projectile: { speed: 8, life: 150 } },
    fastball: { startup: 10, active: 1, recovery: 19, reach: 0, damage: 10, pose: 'special', rank: 3, chip: .25, projectile: { speed: 12, life: 46 } },
    doubleball: { startup: 14, active: 1, recovery: 24, reach: 0, damage: 11, pose: 'special', rank: 3, chip: .25, projectile: { speed: 7.5, life: 150, count: 2, gap: 70 } },
    skyshot: { startup: 12, active: 1, recovery: 22, reach: 0, damage: 12, pose: 'special', rank: 3, chip: .25, projectile: { speed: 6.5, life: 80, rise: 3.8 } },
    rising: { startup: 3, active: 10, recovery: 22, reach: 112, damage: 12, pose: 'launcher', launch: 9, invulnerable: 8, onBlock: -16, push: 14, rank: 3, chip: .25, air: true },
    rush: { startup: 7, active: 14, recovery: 16, reach: 104, damage: 11, pose: 'dash', speed: 10, knockdown: true, onBlock: -6, push: 30, rank: 3, chip: .25 },
    armorRush: { startup: 12, active: 14, recovery: 18, reach: 106, damage: 15, pose: 'dash', speed: 9, knockdown: true, armor: 1, onBlock: -7, push: 34, rank: 3, chip: .25 },
    rekka: { startup: 6, active: 6, recovery: 15, reach: 104, damage: 7, pose: 'kick', speed: 6, chain: 3, onHit: 2, onBlock: -4, push: 20, rank: 3, chip: .25 },
    commandGrab: { startup: 6, active: 2, recovery: 30, reach: 112, damage: 20, pose: 'throw', unblockable: true, grab: true, knockdown: true, rank: 3 },
    teleport: { startup: 14, active: 1, recovery: 12, reach: 0, damage: 0, pose: 'dash', invulnerable: 16, teleport: true, rank: 3 },
    super: { startup: 12, active: 1, recovery: 26, reach: 0, damage: 7, hits: 6, pose: 'super', stocks: SUPER_STOCKS, rank: 4, chip: .25 },
    throw: { startup: 2, active: 1, recovery: 24, reach: 96, damage: 12, pose: 'throw', unblockable: true, knockdown: true, rank: -1 },
    // Evasion and guard cancels (one stock each) escape pressure in KOF fashion.
    roll: { startup: 1, active: 0, recovery: 22, reach: 0, damage: 0, pose: 'roll', invulnerable: 14, speed: 6.5, rank: -1 },
    gcRoll: { startup: 1, active: 0, recovery: 20, reach: 0, damage: 0, pose: 'roll', invulnerable: 16, speed: 6.5, stocks: 1, rank: -1 },
    gcBlowback: { startup: 6, active: 4, recovery: 22, reach: 128, damage: 6, pose: 'blowback', knockdown: true, invulnerable: 10, stocks: 1, onBlock: -2, push: 48, rank: -1 },
    taunt: { startup: 48, active: 0, recovery: 0, reach: 0, damage: 0, pose: 'taunt', rank: -1 }
  };
  const VARIANTS = {
    crouch: {
      punch: { startup: 4, active: 4, recovery: 10, reach: 94, damage: 6, pose: 'cjab', onHit: 4, onBlock: 1, push: 16, rank: 0 },
      kick: { startup: 10, active: 5, recovery: 22, reach: 148, damage: 10, pose: 'sweep', height: 'low', knockdown: true, onBlock: -7, push: 22, rank: 1 },
      heavy: { startup: 12, active: 5, recovery: 24, reach: 114, damage: 13, pose: 'launcher', launch: 10, onBlock: -8, push: 20, rank: 2 }
    },
    air: {
      punch: { startup: 5, active: 6, recovery: 10, reach: 102, damage: 7, pose: 'airpunch', height: 'high', hitStun: 18, blockStun: 12, rank: 0 },
      kick: { startup: 8, active: 6, recovery: 16, reach: 136, damage: 11, pose: 'airkick', height: 'high', hitStun: 20, blockStun: 13, rank: 1 },
      heavy: { startup: 10, active: 5, recovery: 20, reach: 124, damage: 14, pose: 'airpunch', height: 'high', hitStun: 22, blockStun: 14, rank: 2 }
    }
  };
  const PROJECTILE = { hitStun: 18, blockStun: 14, chip: .25 };
  const ATTACKS = ['punch', 'kick', 'heavy', 'special'];
  const NORMALS = ['punch', 'kick', 'heavy'];
  const PROJECTILE_MOVES = new Set(['special', 'fireball', 'fastball', 'doubleball', 'skyshot', 'super']);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const styleOf = f => STYLES[f.style] || STYLES.balanced;
  function moveData(f) { return VARIANTS[f.moveVariant]?.[f.move] || MOVES[f.move]; }
  function fighter(id, slot, profile = {}) {
    return { id, slot, style: STYLES[profile.style] ? profile.style : 'balanced', boss: !!profile.boss, reaches: profile.reaches || null,
      x: WIDTH / 2 + (slot ? 190 : -190), y: 0, vy: 0, vx: 0, facing: slot ? -1 : 1,
      hp: 100, energy: 0, stocks: 0, wins: 0, pose: 'idle', move: null, moveFrame: 0,
      moveVariant: 'standing', landFrames: 0, launched: false, hitAge: 99, airVX: 0,
      hitDone: false, connected: false, stun: 0, blockStun: false, guard: false, crouching: false, lastInput: {},
      dash: 0, dashDir: 0, invulnerable: 0, juggle: 0, combo: 0, comboDamage: 0, counter: false,
      running: false, skid: 0, jumpSquat: 0, hop: false, armor: 0, rekka: 0, dizzy: 0, dizzyMeter: 0,
      quickRise: false, hardKnockdown: false, neutralFrames: 0, standFrames: 0,
      motions: [], taps: { left: -99, right: -99 }, pressAt: { heavy: -99 },
      buffer: { punch: 0, kick: 0, heavy: 0, special: 0, jump: 0, taunt: 0 } };
  }
  function create(ids = ['grillmaster', 'weekendwarrior'], options = {}) {
    const settings = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([key]) => key in DEFAULTS)) };
    settings.roundsToWin = clamp(Math.round(settings.roundsToWin) || 2, 1, 3);
    settings.roundTime = settings.roundTime === 0 ? 0 : clamp(Math.round(settings.roundTime) || 99, 15, 99);
    settings.cpuLevel = clamp(Math.round(settings.cpuLevel) || 4, 1, 8);
    const profiles = options.profiles || {};
    const cpu = options.cpu !== false;
    const cpuSlots = Array.isArray(options.cpuSlots) ? options.cpuSlots.slice(0, 2).map(Boolean) : [false, cpu];
    return { frame: 0, motionFrame: 0, fighters: ids.slice(0, 2).map((id, slot) => fighter(id, slot, profiles[id])), projectiles: [], effects: [],
      time: settings.roundTime * 60, round: 1, phase: 'intro', phaseFrames: 90, winner: null, firstHit: false,
      message: 'ROUND 1', cpu: cpuSlots[1], cpuSlots, options: settings, result: null, draws: 0,
      rng: (Number(options.seed) >>> 0) || 0x2f6b9d3, cpuMemory: [{ wait: 0, plan: [] }, { wait: 0, plan: [] }], hitstop: 0 };
  }
  function random(state) {
    // xorshift32 keeps CPU decisions deterministic for replays and the server.
    let x = state.rng >>> 0 || 1; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    state.rng = x; return x / 4294967296;
  }
  function emit(state, type, x, y, facing = 1, life = 18, extra) {
    state.effects.push(Object.assign({ type, x, y, facing, life, maxLife: life }, extra));
  }
  function banner(state, slot, text) { emit(state, 'banner', slot ? WIDTH : 0, 0, slot ? -1 : 1, 70, { text, slot }); }
  // Hits beyond the second in a combo lose damage so long juggles stay fair.
  function comboScale(hits) { return hits < 3 ? 1 : Math.max(.3, Math.pow(.82, hits - 2)); }
  function gainEnergy(f, amount) {
    f.energy += amount;
    while (f.energy >= BAR && f.stocks < STOCK_MAX) { f.energy -= BAR; f.stocks++; f.stockFlash = 30; }
    if (f.stocks >= STOCK_MAX) f.energy = Math.min(BAR, f.energy);
    f.energy = Math.max(0, f.energy);
  }
  function spendEnergy(f, amount) {
    f.energy -= amount;
    while (f.energy < 0 && f.stocks > 0) { f.stocks--; f.energy += BAR; }
    f.energy = Math.max(0, f.energy);
  }
  const desperate = f => f.hp > 0 && f.hp <= 25;
  const meter = f => f.energy + f.stocks * BAR;
  function down(f) { return f.launched && f.y === 0 && f.stun > 0; }
  function hittable(target) { return target.hp > 0 && !target.invulnerable && !down(target) && !(target.launched && target.y > 0 && target.juggle >= JUGGLE_LIMIT); }
  function knockDown(target, move, wasAirborne) {
    target.vy = move.launch || (wasAirborne ? Math.max(target.vy, 6) : 5);
    target.y = Math.max(1, target.y); target.stun = Math.max(target.stun, 30); target.launched = true; target.pose = 'tumble';
    target.hardKnockdown = !!move.hardKnockdown; target.quickRise = false;
    if (wasAirborne) target.juggle++;
  }
  function dealHit(state, target, source, damage, impactX, direction = source.facing, move = {}) {
    if (!hittable(target)) return false;
    // A defender facing away from an incoming cross-up cannot block it by
    // holding back relative to an opponent now on the other side.
    const heightOk = move.height === 'low' ? target.crouching : move.height === 'high' ? !target.crouching : true;
    const blocked = !move.unblockable && target.y === 0 && !target.dizzy && (target.guard && target.facing === -direction && heightOk || target.blockStun && target.stun > 0);
    // One-hit armor absorbs a strike during an armored special (never a throw).
    if (!blocked && target.armor > 0 && !move.unblockable) {
      target.armor--; target.hp = Math.max(0, target.hp - Math.max(1, Math.round(damage * .5)));
      state.hitstop = Math.max(state.hitstop, 6); emit(state, 'armor', impactX, GROUND - target.y - 110, direction, 16);
      return true;
    }
    const counter = !blocked && !move.unblockable && !!target.move && target.moveFrame < (moveData(target)?.startup ?? 0);
    const inCombo = !blocked && (target.stun > 0 && !target.blockStun || target.launched);
    if (!blocked) { target.combo = inCombo ? target.combo + 1 : 1; if (!inCombo) target.comboDamage = 0; }
    const styleScale = styleOf(source).damage * styleOf(target).defense * (move.desperation ? 1.3 : 1);
    const dealt = blocked ? Math.floor(damage * (move.chip || 0)) : Math.max(1, Math.round(damage * styleScale * comboScale(target.combo) * (counter ? 1.25 : 1)));
    target.hp = Math.max(0, target.hp - dealt);
    if (!blocked) { target.comboDamage += dealt; target.dizzyMeter = target.dizzy ? 0 : target.dizzyMeter + dealt * 1.4; }
    if (target.dizzy && !blocked) target.dizzy = 0;
    const fixed = blocked ? move.blockStun : move.hitStun, advantage = blocked ? move.onBlock : move.onHit;
    // Strikes from a grounded attacker set stun from the attacker's remaining
    // frames; projectiles and jump-ins use fixed stun.
    const remaining = source.move && move.startup ? move.startup + move.active + move.recovery - source.moveFrame : 0;
    target.stun = fixed ?? (advantage !== undefined && remaining ? Math.max(2, remaining + advantage) : blocked ? 8 : 17);
    if (counter) target.stun += 4;
    const wasAirborne = target.y > 0;
    target.blockStun = blocked;
    target.hitAge = 0; target.counter = counter; target.heavyHit = !blocked && (damage >= 13 || counter);
    target.pose = blocked ? 'block' : 'hit';
    target.move = null; target.connected = false; target.dash = 0; target.running = false; target.jumpSquat = 0; target.rekka = 0;
    if (!blocked && target.hp > 0 && (move.launch || move.knockdown || wasAirborne)) knockDown(target, move, wasAirborne);
    const push = (move.push || 24) * (blocked ? .6 : 1), pushedX = target.x + direction * push;
    target.x = clamp(pushedX, WALL, WIDTH - WALL);
    // A defender pinned to a wall passes the remaining push to a grounded
    // attacker so corner pressure has to re-close the distance.
    if (move.startup && source.y === 0) source.x = clamp(source.x - direction * Math.abs(pushedX - target.x), WALL, WIDTH - WALL);
    gainEnergy(target, blocked ? 4 : 7);
    gainEnergy(source, blocked ? 3 : 5);
    // Contact pauses: 5 light, 7 heavy, 9 for launches and knockdowns, 4 on a guard, with poses, camera and effects held together.
    state.hitstop = Math.max(state.hitstop, blocked ? 4 : move.launch || move.knockdown ? 9 : damage >= 13 ? 7 : 5);
    emit(state, blocked ? 'block' : 'hit', impactX, GROUND - target.y - 110, direction, 18, { heavy: !blocked && (damage >= 12 || !!move.launch), damage: dealt, attacker: source.slot });
    if (!blocked) {
      const slot = source.slot ?? state.fighters.indexOf(source);
      if (!state.firstHit) { state.firstHit = true; banner(state, slot, 'FIRST ATTACK'); }
      else if (counter) banner(state, slot, 'COUNTER');
      else if (move.reversal && target.y > 0 && source.moveFrame <= move.startup + 1) banner(state, slot, 'REVERSAL');
    }
    return true;
  }
  // Keypad direction relative to facing: 1 2 3 bottom row, 4 5 6, 7 8 9.
  function direction(input, facing) {
    const forward = facing === 1 ? input.right : input.left, back = facing === 1 ? input.left : input.right;
    const h = forward && !back ? 1 : back && !forward ? -1 : 0, v = input.down ? -1 : input.jump ? 1 : 0;
    return 5 + h + v * 3;
  }
  function performed(f, sequence, frame, window = MOTION_WINDOW) {
    // Lenient subsequence match so keyboard rolls (2,5,6) still count as 236.
    let index = sequence.length - 1;
    for (let i = f.motions.length - 1; i >= 0 && index >= 0; i--) {
      const [digit, at] = f.motions[i];
      if (frame - at > window) break;
      if (digit === sequence[index]) index--;
    }
    return index < 0;
  }
  const pressedTogether = (f, a, b) => f.buffer[a] > 0 && f.buffer[b] > 0 && Math.abs(f.buffer[a] - f.buffer[b]) <= 2;
  // Decide which action a buffered press starts, honoring motions, throws, supers and system moves.
  function command(state, f, other, input) {
    if (input.command && MOVES[input.command]) return input.command;
    const style = styleOf(f);
    const pressed = ATTACKS.filter(a => f.buffer[a] > 0);
    if (f.buffer.taunt > 0 && !pressed.length && f.y === 0) return 'taunt';
    if (!pressed.length) return null;
    const grounded = f.y === 0, frame = state.frame, attack = pressed.some(a => a !== 'special');
    if (f.stocks >= SUPER_STOCKS && (performed(f, [2, 6, 2, 6], frame, 28) && attack || pressedTogether(f, 'special', 'heavy'))) return 'super';
    if (grounded && pressedTogether(f, 'punch', 'kick')) return 'roll';
    if (grounded && pressedTogether(f, 'kick', 'heavy')) return 'blowback';
    if (grounded && performed(f, [6, 2, 3], frame) && attack) return 'rising';
    const ownShot = state.projectiles.some(p => p.owner === f.slot && !p.super);
    if (grounded && performed(f, [2, 6], frame) && attack && !ownShot) return style.qcf;
    if (grounded && performed(f, [2, 4], frame) && attack && !(style.qcb === 'skyshot' && ownShot)) return style.qcb;
    const toward = (other.x >= f.x ? input.right : input.left) || (other.x >= f.x ? input.left : input.right);
    if (f.buffer.heavy > 0 && grounded && toward && !input.down && other.y === 0 && !other.stun && !other.invulnerable && !other.launched && Math.abs(other.x - f.x) < MOVES.throw.reach) return 'throw';
    return ['special', 'heavy', 'kick', 'punch'].find(a => f.buffer[a] > 0 && (a !== 'special' || !ownShot)) || null;
  }
  // Level-based CPU: deterministic, reacts after a delay and picks plans from its style.
  function cpuInput(state, slot) {
    const self = state.fighters[slot], enemy = state.fighters[1 - slot], memory = state.cpuMemory[slot];
    const level = clamp(state.options.cpuLevel + (self.boss ? 2 : 0), 1, 10), distance = Math.abs(enemy.x - self.x);
    const toward = enemy.x < self.x ? 'left' : 'right', away = toward === 'left' ? 'right' : 'left';
    const input = {}, chance = p => random(state) < p;
    if (memory.plan.length) { Object.assign(input, memory.plan.shift()); return input; }
    // Defend: react to attacks and projectiles after a level-scaled delay.
    const threat = enemy.move && enemy.moveFrame >= Math.max(2, 9 - level) && distance < 190 && !['taunt', 'roll', 'gcRoll'].includes(enemy.move);
    const shot = state.projectiles.find(p => p.owner !== slot && (self.x - p.x) * p.facing > 0 && Math.abs(self.x - p.x) < 230);
    if (self.dizzy) { if (chance(.5)) input[chance(.5) ? 'punch' : 'kick'] = true; return input; }
    if (threat && chance(.3 + level * .07)) {
      input[away] = true;
      if (enemy.moveVariant === 'crouch') input.down = true;
      if (self.blockStun && self.stocks > 0 && level >= 6 && chance(.12)) { input.punch = true; input.kick = true; }
      return input;
    }
    if (shot && self.y === 0) {
      const r = random(state);
      if (r < .35 + level * .04) input.jump = true;
      else if (r < .55 + level * .03 && level >= 4) { input.punch = true; input.kick = true; }
      else input[away] = true;
      return input;
    }
    if (enemy.y > 40 && enemy.vy < 0 && distance < 150 && self.y === 0 && chance(.12 + level * .07)) { input.command = 'rising'; return input; }
    if (memory.wait > 0) { memory.wait--; if (distance > 150) input[toward] = true; return input; }
    memory.wait = Math.max(2, 20 - level * 2 + Math.floor(random(state) * 8));
    const style = styleOf(self), r = random(state);
    if (self.stocks >= SUPER_STOCKS && distance < 380 && (enemy.stun > 0 || r < .04 + level * .01)) { input.command = 'super'; return input; }
    if (distance < 95) {
      if (r < .25) input.command = style.qcb === 'commandGrab' ? 'commandGrab' : 'throw';
      else if (r < .55) memory.plan = [{ punch: true }, {}, {}, {}, {}, { kick: true }, {}, {}, {}, {}, {}, {}, { heavy: true }];
      else if (r < .7) { input.down = true; input.kick = true; }
      else if (r < .8) { input.kick = true; input.heavy = true; }
      else input[away] = true;
      return input;
    }
    if (distance < 170) {
      if (r < .35) memory.plan = [{ kick: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, { command: style.qcf }];
      else if (r < .55) { input.down = true; input.kick = true; }
      else if (r < .7) input.command = style.qcb === 'teleport' || style.qcb === 'skyshot' ? 'rising' : style.qcb;
      else input[toward] = true;
      return input;
    }
    if (distance > 380 && r < .3 + (self.style === 'zoner' ? .25 : 0)) { input.command = style.qcf; return input; }
    if (r < .2) { memory.plan = [{ [toward]: true, jump: true }, { [toward]: true, jump: true }, { [toward]: true, jump: true }, { [toward]: true }, { [toward]: true }, { [toward]: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { heavy: true }]; return input; }
    if (r < .3 && style.qcb === 'teleport') { input.command = 'teleport'; return input; }
    if (r < .36 && level >= 5 && distance > 300 && !enemy.move) { input.taunt = true; return input; }
    input[toward] = true;
    if (r > .8 && distance > 260) memory.plan = Array.from({ length: 10 }, () => ({ [toward]: true }));
    return input;
  }
  function intro(state) {
    const target = state.options.roundsToWin;
    const final = target > 1 && state.fighters.every(f => f.wins === target - 1);
    state.phase = 'intro'; state.phaseFrames = 90; state.message = final ? 'FINAL ROUND' : 'ROUND ' + state.round; state.finalRound = final;
  }
  function resetRound(state) {
    // Wins, power stocks and the partial bar carry into the next round, as in KOF.
    state.fighters = state.fighters.map((old, slot) => Object.assign(fighter(old.id, slot, { style: old.style, boss: old.boss }), { wins: old.wins, energy: old.energy, stocks: old.stocks }));
    state.projectiles = []; state.effects = []; state.time = state.options.roundTime * 60; state.round++;
    state.winner = null; state.hitstop = 0; state.firstHit = false; state.result = null;
    state.cpuMemory = [{ wait: 0, plan: [] }, { wait: 0, plan: [] }];
    intro(state);
  }
  function startMove(state, f, action, input) {
    const variant = NORMALS.includes(action) ? f.y > 0 ? 'air' : input.down ? 'crouch' : 'standing' : 'standing';
    const data = MOVES[action];
    f.move = action; f.moveFrame = 0; f.hitDone = false; f.connected = false; f.guard = false; f.dash = 0; f.running = false; f.skid = 0;
    f.moveVariant = variant;
    for (const key of [...ATTACKS, 'taunt']) f.buffer[key] = 0;
    f.motions = [];
    spendEnergy(f, data.cost || 0);
    if (data.stocks) { f.stocks = Math.max(0, f.stocks - data.stocks); f.stockFlash = 0; }
    f.invulnerable = Math.max(f.invulnerable, data.invulnerable || 0);
    f.armor = data.armor || 0;
    if (action === 'rekka') f.rekka = 1;
    if (action === 'roll' || action === 'gcRoll') f.rollDir = (input[f.facing === 1 ? 'left' : 'right'] ? -1 : 1) * f.facing;
    if (PROJECTILE_MOVES.has(action)) emit(state, 'powerup', f.x, GROUND - f.y - 100, f.facing, 32);
    if (action === 'super') {
      // Cinematic freeze: the whole fight stops while the cut-in plays.
      f.superDesperate = desperate(f);
      state.hitstop = Math.max(state.hitstop, 36);
      emit(state, 'super', f.x, GROUND - 110, f.facing, 36, { slot: f.slot, desperation: f.superDesperate });
    }
    if (action === 'gcRoll' || action === 'gcBlowback') banner(state, f.slot, 'GUARD CANCEL');
  }
  function launchProjectiles(state, f, slot, move) {
    const shot = move.projectile || {};
    if (f.move === 'super') {
      state.projectiles.push({ owner: slot, x: f.x + f.facing * 55, y: f.y + 105, facing: f.facing, damage: move.damage, life: 150, super: true,
        hits: move.hits + (f.boss ? 2 : 0), cooldown: 0, speed: 11, kind: 'super', desperation: !!f.superDesperate });
      return;
    }
    for (let i = 0; i < (shot.count || 1); i++) {
      state.projectiles.push({ owner: slot, x: f.x + f.facing * (55 - i * (shot.gap || 0)), y: f.y + 105, facing: f.facing, damage: move.damage,
        life: shot.life || 150, hits: 1, cooldown: 0, speed: shot.speed || 8, rise: shot.rise || 0, kind: f.move });
    }
  }
  // Rounds continue to settle bodies after a KO so nobody freezes mid-air.
  function settle(f) {
    if (f.y > 0 || f.vy > 0) {
      f.y += f.vy; f.vy -= .65;
      if (f.y <= 0) { f.y = 0; f.vy = 0; f.airVX = 0; f.landFrames = 6; }
    }
  }
  function finishRound(state) {
    const [a, b] = state.fighters;
    const kind = a.hp === 0 && b.hp === 0 ? 'doubleko' : a.hp === 0 || b.hp === 0 ? 'ko' : 'time';
    state.winner = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
    if (state.winner !== null) state.fighters[state.winner].wins++; else state.draws++;
    const perfect = state.winner !== null && state.fighters[state.winner].hp === 100;
    state.result = { winner: state.winner, kind, perfect, time: Math.ceil(state.time / 60), hp: state.fighters.map(f => f.hp) };
    state.phase = 'roundover'; state.phaseFrames = 170;
    state.message = kind === 'doubleko' ? 'DOUBLE K.O.' : kind === 'ko' ? 'K.O.' : 'TIME OVER';
    if (kind === 'ko') state.hitstop = Math.max(state.hitstop, 24);
    state.fighters.forEach(f => { f.move = null; f.dash = 0; f.running = false; f.jumpSquat = 0; f.dizzy = 0; f.pose = f.hp === 0 ? 'tumble' : f.pose; });
    emit(state, 'ko', WIDTH / 2, 250, 1, 100, { kind });
  }
  function tick(state, inputs = [{}, {}]) {
    if (state.phase === 'matchover') return state;
    state.frame++;
    state.effects.forEach(e => e.life--); state.effects = state.effects.filter(e => e.life > 0);
    if (state.phase === 'intro') {
      state.motionFrame++;
      if (--state.phaseFrames <= 0) { state.phase = 'fight'; state.message = ''; }
      return state;
    }
    if (state.phase === 'roundover') {
      if (state.hitstop > 0) { state.hitstop--; return state; }
      state.motionFrame++;
      state.fighters.forEach(settle);
      // Poses resolve after bodies land: winner celebrates, a time-over loser kneels.
      if (state.phaseFrames === 110) {
        if (state.result?.perfect) state.message = 'PERFECT';
        else if (state.winner === null && state.result?.kind === 'time') state.message = 'DRAW GAME';
        state.fighters.forEach((f, i) => { f.pose = state.winner === i ? (state.round % 2 ? 'win' : 'win2') : f.hp === 0 ? 'down' : state.winner === null ? 'idle' : 'lose'; });
      }
      if (--state.phaseFrames <= 0) {
        const target = state.options.roundsToWin, maxRounds = target * 2 + 1;
        if (state.fighters.some(f => f.wins >= target) || state.round >= maxRounds) {
          state.phase = 'matchover';
          const [a, b] = state.fighters;
          state.winner = a.wins === b.wins ? null : a.wins > b.wins ? 0 : 1;
          state.message = state.winner === null ? 'DRAW GAME' : 'MATCH COMPLETE';
        } else resetRound(state);
      }
      return state;
    }
    // Only the engine's own CPU may request a move by name; remote inputs cannot.
    // Slot 1 follows state.cpu (set by servers and menus); slot 0 is CPU only in demo play.
    const controls = [0, 1].map(slot => (slot ? state.cpu : state.cpuSlots?.[0]) ? cpuInput(state, slot) : { ...(inputs[slot] || {}), command: undefined });
    state.fighters.forEach((f, slot) => {
      const input = controls[slot];
      f.slot = slot;
      for (const action of Object.keys(f.buffer)) if (input[action] && !f.lastInput[action]) f.buffer[action] = INPUT_BUFFER;
      if (input.heavy && !f.lastInput.heavy) f.pressAt.heavy = state.frame;
      // Two taps of the same direction within a short window run or backstep.
      for (const side of ['left', 'right']) if (input[side] && !f.lastInput[side]) {
        if (state.frame - f.taps[side] <= DASH_TAP && f.y === 0 && !input.down) f.dashRequest = side;
        f.taps[side] = state.frame;
      }
      // Mashing shakes off dizziness.
      if (f.dizzy > 0) for (const key of ['left', 'right', 'punch', 'kick', 'heavy', 'special']) if (input[key] && !f.lastInput[key]) f.dizzy = Math.max(1, f.dizzy - 4);
      const digit = direction(input, f.facing), lastDigit = f.motions[f.motions.length - 1];
      if (!lastDigit || lastDigit[0] !== digit) { f.motions.push([digit, state.frame]); if (f.motions.length > 10) f.motions.shift(); }
      f.lastInput = { ...input, command: undefined };
    });
    // Keep presses made during impact freeze; their window counts playable frames.
    if (state.hitstop > 0) { state.hitstop--; return state; }
    state.motionFrame++;
    if (!state.options.training && state.options.roundTime) state.time--;
    // Read both guards before either fighter can connect a hit.
    state.fighters.forEach((f, slot) => {
      const other = state.fighters[1 - slot], input = controls[slot];
      if (!f.move && !f.stun && !f.dash && !f.dizzy) f.facing = other.x >= f.x ? 1 : -1;
      f.crouching = !!input.down && f.y === 0;
      const upcomingStrike = ATTACKS.some(key => other.buffer[key] > 0 && meter(other) >= (MOVES[key].cost || 0));
      const nearbyStrike = Math.abs(other.x - f.x) < 180 && (other.move || upcomingStrike);
      const incomingShot = state.projectiles.some(p => p.owner !== slot && (f.x - p.x) * p.facing >= 0 && Math.abs(f.x - p.x) < 190);
      // Backward walking should animate as walking, not slide in the guard pose
      // when there is no attack nearby. Startup and existing projectiles count
      // as threats so blocking remains responsive on the contact frame.
      f.guard = !f.move && !f.stun && !f.dash && !f.dizzy && !f.running && !f.jumpSquat && f.y === 0 && !!(nearbyStrike || incomingShot) && !!(f.facing === 1 ? input.left : input.right);
    });
    const strikes = [];
    state.fighters.forEach((f, slot) => {
      const other = state.fighters[1 - slot], input = controls[slot], style = styleOf(f);
      f.vx = 0; f.hitAge++; f.landFrames = Math.max(0, f.landFrames - 1);
      if (f.stockFlash > 0) f.stockFlash--;
      if (f.invulnerable > 0) f.invulnerable--;
      if (f.y > 0 || f.vy > 0) {
        f.y += f.vy; f.vy -= .65;
        if (f.launched && f.y > 0) f.x = clamp(f.x - f.facing * 2.2, WALL, WIDTH - WALL);
        // Any attack button during a tumble requests a quick recovery roll.
        if (f.launched && ATTACKS.some(a => f.buffer[a] > 0) && !f.hardKnockdown) f.quickRise = true;
        if (f.y <= 0) {
          f.y = 0; f.vy = 0; f.airVX = 0; f.landFrames = 6;
          if (f.launched) {
            f.juggle = 0;
            if (f.quickRise) { f.stun = 8; f.invulnerable = 12; f.dash = 8; f.dashDir = -f.facing; banner(state, slot, 'QUICK RISE'); }
            else f.stun = Math.max(f.stun, 24);
          }
          if (f.moveVariant === 'air' && NORMALS.includes(f.move)) { f.move = null; f.moveFrame = 0; }
          emit(state, 'dust', f.x, GROUND, f.facing, 12);
        }
      }
      if (f.dizzy > 0) {
        f.dizzy--; f.pose = 'dizzy';
        if (!f.dizzy) { f.dizzyMeter = 0; f.pose = 'idle'; }
        return;
      }
      if (f.stun > 0) {
        // A launched fighter stays helpless until landing, then lies down.
        if (!(f.launched && f.y > 0)) f.stun--;
        if (f.launched) f.pose = f.y > 0 ? 'tumble' : f.stun > 5 ? 'down' : 'getup';
        // Guard cancels spend a stock to escape blockstun.
        if (f.blockStun && f.stocks > 0 && f.y === 0 && f.stun > 0) {
          const gc = pressedTogether(f, 'punch', 'kick') ? 'gcRoll' : pressedTogether(f, 'kick', 'heavy') ? 'gcBlowback' : null;
          if (gc) { f.stun = 0; f.blockStun = false; startMove(state, f, gc, input); }
        }
        if (f.stun === 0 && !f.move) {
          if (f.launched) f.invulnerable = Math.max(f.invulnerable, 6);
          f.pose = 'idle'; f.launched = false; f.blockStun = false; f.counter = false; f.quickRise = false;
          // Accumulated dizzy damage stuns a fighter who recovers on the ground.
          if (f.dizzyMeter >= DIZZY_LIMIT && f.y === 0 && f.hp > 0) { f.dizzy = DIZZY_FRAMES; f.dizzyMeter = 0; f.pose = 'dizzy'; emit(state, 'dizzy', f.x, GROUND - 220, f.facing, DIZZY_FRAMES); }
        }
        if (!f.move) { f.dashRequest = null; if (f.dash > 0 && f.y === 0) { const previousX = f.x; f.x = clamp(f.x + f.dashDir * 8, WALL, WIDTH - WALL); f.vx = f.x - previousX; f.dash--; f.pose = 'roll'; } return; }
      }
      if (!f.stun && !f.launched) { f.neutralFrames++; f.dizzyMeter = Math.max(0, f.dizzyMeter - .25); } else f.neutralFrames = 0;
      // Connected normals can chain into a stronger normal, special or super,
      // as in arcade fighters. Whiffs and repeated buttons cannot cancel.
      if (f.move && f.connected && moveData(f).rank < 3 && moveData(f).rank >= 0) {
        const move = moveData(f);
        if (f.moveFrame < move.startup + move.active + CANCEL_WINDOW) {
          const next = command(state, f, other, input), nextData = next && (VARIANTS[f.moveVariant]?.[next] || MOVES[next]);
          if (next && !['throw', 'roll', 'taunt'].includes(next) && nextData.rank > move.rank && meter(f) >= (MOVES[next].cost || 0) && f.stocks >= (MOVES[next].stocks || 0)) { f.move = null; f.connected = false; }
        }
      }
      // Rhythm rush chains: another attack press during recovery continues the rekka.
      if (f.move === 'rekka' && f.rekka < MOVES.rekka.chain && f.moveFrame >= MOVES.rekka.startup + MOVES.rekka.active - 1 && NORMALS.some(a => f.buffer[a] > 0)) {
        const stage = f.rekka + 1; f.move = null; startMove(state, f, 'rekka', input); f.rekka = stage;
      }
      if (f.dashRequest && !f.move && f.y === 0 && !f.jumpSquat) {
        const forward = (f.dashRequest === 'right') === (f.facing === 1);
        if (forward) { f.running = true; f.skid = 0; }
        else { f.dash = 12; f.dashDir = f.dashRequest === 'right' ? 1 : -1; f.invulnerable = Math.max(f.invulnerable, 5); }
      }
      f.dashRequest = null;
      // Preserve jump momentum during airborne attack startup and recovery.
      if (f.move && f.y > 0 && f.airVX) {
        const previousX = f.x;
        f.x = clamp(f.x + f.airVX, WALL, WIDTH - WALL);
        f.vx = f.x - previousX;
      }
      if (f.dash > 0 && !f.move) {
        // Backsteps travel away from the opponent and can be cancelled into attacks.
        const t = 12 - f.dash, previousX = f.x;
        f.x = clamp(f.x + f.dashDir * 10 * (1 - t / 12), WALL, WIDTH - WALL);
        f.vx = f.x - previousX; f.dash--; f.pose = 'backstep';
        if (t < 6 || !ATTACKS.some(a => f.buffer[a] > 0)) return void gainEnergy(f, .035);
        f.dash = 0;
      }
      if (f.jumpSquat > 0 && !f.move) {
        // Four-frame jump squat: holding up makes a full jump, a tap makes a hop.
        f.jumpSquat--; f.pose = 'crouch';
        if (!input.jump) f.hop = true;
        if (!f.jumpSquat) {
          const movement = (input.right ? 1 : 0) - (input.left ? 1 : 0), run = f.running ? 1.45 : 1;
          f.vy = (f.hop ? 9.6 : 13) * style.jump; f.y = 1; f.airVX = movement * AIR_SPEED * run * (f.hop ? 1.12 : 1); f.landFrames = 0; f.running = false;
        }
        return void gainEnergy(f, .035);
      }
      if (!f.move) {
        const movement = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const previousX = f.x, forwardHeld = movement === f.facing;
        if (f.running && (!forwardHeld || f.y > 0 || input.down)) { f.running = false; f.skid = f.y === 0 ? 5 : 0; }
        if (f.y > 0 && movement) f.airVX = movement * AIR_SPEED;
        let speed = f.y > 0 ? f.airVX : f.guard ? 0 : movement * (movement === f.facing ? WALK_FORWARD : WALK_BACK) * style.walk;
        if (f.running) speed = f.facing * RUN_SPEED * style.walk;
        else if (f.skid > 0) { speed = f.facing * f.skid * .8; f.skid--; }
        f.x = clamp(f.x + (input.down && f.y === 0 && !f.running ? 0 : speed), WALL, WIDTH - WALL);
        f.vx = f.x - previousX;
        if (f.buffer.jump > 0 && f.y === 0) { f.jumpSquat = JUMP_SQUAT; f.hop = !input.jump; f.buffer.jump = 0; }
        f.pose = f.y > 0 ? 'jump' : f.jumpSquat ? 'crouch' : f.running ? (state.frame % 12 < 6 ? 'run' : 'run2') : input.down ? 'crouch' : f.guard ? 'block' : movement ? (state.frame % 20 < 10 ? 'walk' : 'walk2') : (state.frame % 48 < 24 ? 'idle' : 'stance2');
        // Motion specials, throws, supers and system moves need footing; F still fires in the air.
        const action = f.jumpSquat ? null : command(state, f, other, input);
        if (action && (f.y === 0 || ATTACKS.includes(action)) && f.stocks >= (MOVES[action]?.stocks || 0)) startMove(state, f, action, input);
      }
      if (f.move) {
        const move = moveData(f); f.moveFrame++;
        f.pose = f.moveFrame < move.startup ? (f.moveVariant === 'crouch' ? 'crouch' : f.y > 0 ? 'jump' : f.move === 'super' ? 'powerup' : f.move === 'taunt' ? 'taunt' : 'stance2') : move.pose;
        if (move.speed && !['roll', 'gcRoll'].includes(f.move) && f.moveFrame < move.startup + move.active && !f.hitDone) {
          const previousX = f.x; f.x = clamp(f.x + f.facing * move.speed * (f.rekka === 3 ? 1.3 : 1), WALL, WIDTH - WALL); f.vx = f.x - previousX;
        }
        if (['roll', 'gcRoll'].includes(f.move) && f.moveFrame < 17) {
          const previousX = f.x; f.x = clamp(f.x + f.rollDir * move.speed, WALL, WIDTH - WALL); f.vx = f.x - previousX;
        }
        if (f.move === 'rising' && f.moveFrame === move.startup) { f.vy = 11; f.y = Math.max(1, f.y); f.airVX = f.facing * 1.5; }
        if (f.move === 'taunt' && f.moveFrame === 20) { spendEnergy(other, 15); emit(state, 'taunt', f.x, GROUND - 230, f.facing, 30); }
        if (f.move === 'teleport' && f.moveFrame === move.startup) {
          // Reappear just behind the opponent, inside the arena walls.
          const side = other.x >= f.x ? 1 : -1, target = clamp(other.x + side * 92, WALL, WIDTH - WALL);
          f.x = Math.abs(target - other.x) < 60 ? clamp(other.x - side * 92, WALL, WIDTH - WALL) : target; f.facing = other.x >= f.x ? 1 : -1;
          emit(state, 'dash', f.x, GROUND - 100, f.facing, 14);
        }
        if (f.moveFrame >= move.startup && f.moveFrame < move.startup + move.active && !f.hitDone) {
          if (PROJECTILE_MOVES.has(f.move)) { launchProjectiles(state, f, slot, move); f.hitDone = true; }
          else if (f.move === 'throw' || move.grab) {
            f.hitDone = true;
            const reachable = hittable(other) && other.y === 0 && Math.abs(other.x - f.x) < reachOf(f, move) && (move.grab || !other.stun);
            // Pressing heavy within seven frames of the throw escapes it, even if that press started an attack.
            if (reachable && f.move === 'throw' && (state.frame - other.pressAt.heavy <= 7 || pressedTogether(other, 'punch', 'kick'))) {
              // Pressing heavy as the throw lands escapes it.
              const side = other.x >= f.x ? 1 : -1;
              f.x = clamp(f.x - side * 34, WALL, WIDTH - WALL); other.x = clamp(other.x + side * 34, WALL, WIDTH - WALL);
              other.buffer.heavy = 0; other.move = null; banner(state, 1 - slot, 'THROW ESCAPE');
              emit(state, 'block', (f.x + other.x) / 2, GROUND - 130, f.facing);
            } else if (reachable) {
              // Backward throws swap sides before the toss.
              if (f.move === 'throw' && input[f.facing === 1 ? 'left' : 'right']) { const x = f.x; f.x = other.x; other.x = x; f.facing *= -1; }
              dealHit(state, other, f, move.damage, (f.x + other.x) / 2, f.facing, move);
              f.connected = true;
            }
          } else if (!move.teleport && move.reach) strikes.push({ source: f, target: other, move: f.move === 'rising' ? { ...move, reversal: true } : move, direction: f.facing });
        }
        if (f.move === 'armorRush' && f.moveFrame >= move.startup + move.active) f.armor = 0;
        if (f.moveFrame >= move.startup + move.active + move.recovery && (f.move !== 'rising' || f.y === 0)) { f.move = null; f.armor = 0; f.rekka = 0; f.pose = 'idle'; }
      }
      // Consecutive frames standing in neutral; the animation layer restarts the breathing loop from it. Visual only.
      f.standFrames = !f.move && f.y === 0 && !f.stun && !f.dash && !f.running && !f.jumpSquat && !f.crouching && !f.dizzy && f.landFrames === 0 && Math.abs(f.vx) < .1 ? f.standFrames + 1 : 0;
      gainEnergy(f, .035);
    });
    const contacts = strikes.filter(({ source, target, move, direction }) =>
      hittable(target) && (target.x - source.x) * direction >= 0 && Math.abs(source.x - target.x) < reachOf(source, move) && Math.abs(source.y - target.y) < (move.air ? 140 : 90));
    // Resolve contacts together so equal-timing attacks trade fairly on either side.
    for (const { source, target, move, direction } of contacts) {
      const data = source.move === 'rekka' && source.rekka === 3 ? { ...move, damage: 11, knockdown: true } : move;
      dealHit(state, target, source, data.damage, (source.x + target.x) / 2, direction, data); source.hitDone = true; source.connected = true;
    }
    state.fighters.forEach(f => { for (const action of Object.keys(f.buffer)) f.buffer[action] = Math.max(0, f.buffer[action] - 1); });
    const [a, b] = state.fighters;
    state.projectiles.forEach(p => {
      p.x += p.facing * (p.speed || 8); p.y += p.rise || 0; p.life--; p.cooldown = Math.max(0, (p.cooldown || 0) - 1);
      // Opposing projectiles cancel; a super beam plows through a fireball.
      const rival = state.projectiles.find(q => q !== p && q.owner !== p.owner && q.life > 0 && Math.abs(q.x - p.x) < 40 && Math.abs(q.y - p.y) < 60);
      if (rival && p.life > 0) {
        emit(state, 'block', (p.x + rival.x) / 2, GROUND - p.y, p.facing);
        if (!rival.super) rival.life = 0;
        if (!p.super) p.life = 0;
        if (p.life <= 0) return;
      }
      const victim = state.fighters[1 - p.owner];
      if (!p.cooldown && Math.abs(p.x - victim.x) < (p.super ? 60 : 40) && Math.abs(p.y - victim.y - 105) < 75 && hittable(victim)) {
        dealHit(state, victim, state.fighters[p.owner], p.damage, p.x, p.facing, Object.assign({ push: p.super ? 8 : 24, desperation: !!p.desperation }, PROJECTILE, p.super ? { hitStun: 12, blockStun: 8 } : {}));
        p.hits--; p.cooldown = 5;
        // A super beam carries its victim so every hit of the barrage lands.
        if (p.super) p.x = victim.x - p.facing * 20;
        if (p.hits <= 0) p.life = 0;
      }
    });
    state.projectiles = state.projectiles.filter(p => p.life > 0 && p.x > -50 && p.x < WIDTH + 50 && p.y < 700);
    const passing = f => ['roll', 'gcRoll', 'teleport'].includes(f.move);
    if (Math.abs(a.x - b.x) < BODY_GAP && Math.abs(a.y - b.y) < 100 && !passing(a) && !passing(b)) {
      const left = a.x <= b.x ? a : b, right = left === a ? b : a;
      const correction = (BODY_GAP - (right.x - left.x)) / 2;
      left.x -= correction; right.x += correction;
      // Transfer pushback to the free fighter when the other is against a wall.
      if (left.x < WALL) { right.x += WALL - left.x; left.x = WALL; }
      if (right.x > WIDTH - WALL) { left.x -= right.x - (WIDTH - WALL); right.x = WIDTH - WALL; }
    }
    // Screen lock: neither fighter can walk the other off camera. The fighter
    // moving away is held; if both are, they share the correction.
    const gap = Math.abs(a.x - b.x) - MAX_DIST;
    if (gap > 0) {
      const left = a.x <= b.x ? a : b, right = left === a ? b : a;
      const leftAway = Math.max(0, -left.vx), rightAway = Math.max(0, right.vx), total = leftAway + rightAway;
      const leftShare = total ? leftAway / total : .5;
      left.x += gap * leftShare; right.x -= gap * (1 - leftShare);
    }
    if (state.options.training) {
      // Training restores health after each exchange and can keep meter full.
      state.fighters.forEach(f => {
        if (f.hp === 0) f.hp = 1;
        if (f.neutralFrames > 40 && f.hp < 100) { f.hp = 100; f.combo = 0; }
        if (state.options.trainingMeter === 'infinite') { f.stocks = STOCK_MAX; f.energy = BAR; }
      });
      return state;
    }
    if (a.hp === 0 || b.hp === 0 || (state.options.roundTime && state.time <= 0)) finishRound(state);
    return state;
  }
  // Approximate collision boxes for the training overlay: [x, y-from-ground, width, height].
  function boxes(f) {
    const crouch = f.crouching || f.pose === 'crouch', hurt = [f.x - 34, f.y, 68, crouch ? 120 : 190];
    const move = f.move && moveData(f);
    let hit = null;
    if (move && move.reach && f.moveFrame >= move.startup && f.moveFrame < move.startup + move.active) {
      const low = move.height === 'low', y = f.y + (low ? 10 : move.air ? 70 : 100);
      const reach = reachOf(f, move);
      hit = [f.facing === 1 ? f.x : f.x - reach, y, reach, low ? 50 : 70];
    }
    return { hurt, hit };
  }
  // Human-readable move list for menus, built from the fighter's style.
  function moveList(fighterData = {}) {
    const style = STYLES[fighterData.style] || STYLES.balanced, special = fighterData.specialMove?.name || 'Energy Shot';
    return [
      { name: special, input: '↓↘→ + attack (or F)', note: style.qcf === 'fastball' ? 'Fast short-range shot; F fires a slower standard shot' : style.qcf === 'doubleball' ? 'Twin projectile; F fires a single shot' : 'Projectile; F is a slower one-button version' },
      { name: style.names.dp, input: '→↓↘ + attack', note: 'Invulnerable rising strike' },
      { name: style.names.qcb, input: '↓↙← + attack', note: '' },
      { name: fighterData.superMove?.name || 'Super Art', input: '↓↘→↓↘→ + attack or F + D', note: 'Costs one power stock; stronger at low health' },
      { name: 'Blowback', input: 'S + D', note: 'Knockdown strike; guard cancel with a stock while blocking' },
      { name: 'Evasive roll', input: 'A + S', note: 'Invulnerable roll; guard cancel with a stock while blocking' },
      { name: 'Throw', input: '→ or ← + D up close', note: 'Press D as you are thrown to escape' },
      { name: 'Run / backstep', input: '→→ / ←←', note: 'Tap ↑ to hop, hold ↑ to jump' },
      { name: 'Taunt', input: 'G', note: 'Drains the opponent’s power gauge' }
    ];
  }
  return { WIDTH, SCREEN_W, GROUND, WALL, MAX_DIST, BAR, STOCK_MAX, MOVES, VARIANTS, STYLES, DEFAULTS, moveData, create, tick, resetRound, comboScale, boxes, moveList , SPRITE_HEIGHT, artReaches, reachOf };
});
