(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.FighterEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 960, GROUND = 438, INPUT_BUFFER = 6, WALL = 50, BODY_GAP = 64;
  const MOVES = {
    punch: { startup: 5, active: 4, recovery: 12, reach: 100, damage: 7, pose: 'punch' },
    kick: { startup: 10, active: 5, recovery: 18, reach: 142, damage: 12, pose: 'kick' },
    heavy: { startup: 9, active: 5, recovery: 20, reach: 126, damage: 15, pose: 'hpunch' },
    special: { startup: 16, active: 1, recovery: 22, reach: 0, damage: 17, pose: 'special', cost: 30 }
  };
  const VARIANTS = {
    crouch: {
      punch: { startup: 4, active: 4, recovery: 10, reach: 94, damage: 6, pose: 'cjab' },
      kick: { startup: 10, active: 5, recovery: 22, reach: 148, damage: 10, pose: 'sweep' },
      heavy: { startup: 12, active: 5, recovery: 24, reach: 114, damage: 13, pose: 'launcher', launch: 10 }
    },
    air: {
      punch: { startup: 5, active: 6, recovery: 10, reach: 102, damage: 7, pose: 'airpunch' },
      kick: { startup: 8, active: 6, recovery: 16, reach: 136, damage: 11, pose: 'airkick' },
      heavy: { startup: 10, active: 5, recovery: 20, reach: 124, damage: 14, pose: 'airpunch' }
    }
  };
  function moveData(f) { return VARIANTS[f.moveVariant]?.[f.move] || MOVES[f.move]; }
  function fighter(id, slot) {
    return { id, slot, x: slot ? 670 : 290, y: 0, vy: 0, vx: 0, facing: slot ? -1 : 1,
      hp: 100, energy: 60, wins: 0, pose: 'idle', move: null, moveFrame: 0,
      moveVariant: 'standing', landFrames: 0, launched: false, hitAge: 99,
      hitDone: false, stun: 0, guard: false, crouching: false, lastInput: {},
      buffer: { punch: 0, kick: 0, heavy: 0, special: 0, jump: 0 } };
  }
  function create(ids = ['grillmaster', 'weekendwarrior'], options = {}) {
    return { frame: 0, motionFrame: 0, fighters: ids.slice(0, 2).map(fighter), projectiles: [], effects: [],
      time: 99 * 60, round: 1, phase: 'intro', phaseFrames: 90, winner: null,
      message: 'ROUND 1', cpu: options.cpu !== false, hitstop: 0 };
  }
  function emit(state, type, x, y, facing = 1, life = 18) {
    state.effects.push({ type, x, y, facing, life, maxLife: life });
  }
  function dealHit(state, target, source, damage, impactX, direction = source.facing, move = {}) {
    if (target.hp <= 0) return;
    const blocked = target.guard && target.y === 0;
    target.hp = Math.max(0, target.hp - (blocked ? Math.max(1, Math.floor(damage * .15)) : damage));
    target.stun = blocked ? 8 : 17;
    target.hitAge = 0;
    target.pose = blocked ? 'block' : 'hit';
    target.move = null;
    if (!blocked && move.launch && target.hp > 0) { target.vy = move.launch; target.y = Math.max(1, target.y); target.stun = 38; target.launched = true; target.pose = 'tumble'; }
    target.x = Math.max(WALL, Math.min(WIDTH - WALL, target.x + direction * (blocked ? 10 : 24)));
    target.energy = Math.min(100, target.energy + 7);
    source.energy = Math.min(100, source.energy + 5);
    state.hitstop = Math.max(state.hitstop, blocked ? 2 : damage >= 13 ? 7 : 5);
    emit(state, blocked ? 'block' : 'hit', impactX, GROUND - target.y - 110, direction);
  }
  function cpuInput(state) {
    const [enemy, self] = state.fighters, distance = Math.abs(enemy.x - self.x);
    const input = {}, beat = state.frame % 100;
    const toward = enemy.x < self.x ? 'left' : 'right';
    // The CPU reacts after startup has begun instead of reading a new button instantly.
    if (enemy.move && enemy.moveFrame >= 6 && distance < 160 && beat < 62) input[toward === 'left' ? 'right' : 'left'] = true;
    else if (distance > 112) input[toward] = true;
    if (distance < 135 && beat % 29 === 0) input.kick = true;
    if (distance < 100 && beat % 23 === 0) input.punch = true;
    if (distance < 125 && beat % 61 === 0) input.heavy = true;
    if (distance > 200 && beat === 70 && self.energy >= 30) input.special = true;
    if (state.projectiles.some(p => p.owner === 0 && Math.abs(p.x - self.x) < 180)) input.jump = true;
    return input;
  }
  function resetRound(state) {
    state.fighters = state.fighters.map((old, slot) => Object.assign(fighter(old.id, slot), { wins: old.wins }));
    state.projectiles = []; state.effects = []; state.time = 99 * 60; state.round++;
    state.phase = 'intro'; state.phaseFrames = 90; state.message = 'ROUND ' + state.round;
    state.winner = null; state.hitstop = 0;
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
      state.motionFrame++;
      if (--state.phaseFrames <= 0) {
        if (state.fighters.some(f => f.wins >= 2)) { state.phase = 'matchover'; state.message = 'MATCH COMPLETE'; }
        else resetRound(state);
      }
      return state;
    }
    const controls = [inputs[0] || {}, state.cpu ? cpuInput(state) : inputs[1] || {}];
    state.fighters.forEach((f, slot) => {
      const input = controls[slot];
      for (const action of Object.keys(f.buffer)) if (input[action] && !f.lastInput[action]) f.buffer[action] = INPUT_BUFFER;
      f.lastInput = { ...input };
    });
    // Keep presses made during impact freeze; their window counts playable frames.
    if (state.hitstop > 0) { state.hitstop--; return state; }
    state.motionFrame++;
    state.time--;
    // Read both guards before either fighter can connect a hit.
    state.fighters.forEach((f, slot) => {
      const other = state.fighters[1 - slot], input = controls[slot];
      if (!f.move && !f.stun) f.facing = other.x >= f.x ? 1 : -1;
      f.crouching = !!input.down && f.y === 0;
      f.guard = !f.move && !f.stun && f.y === 0 && !!(f.facing === 1 ? input.left : input.right);
    });
    const strikes = [];
    state.fighters.forEach((f, slot) => {
      const other = state.fighters[1 - slot], input = controls[slot];
      f.vx = 0; f.hitAge++; f.landFrames = Math.max(0, f.landFrames - 1);
      if (f.y > 0 || f.vy > 0) {
        f.y += f.vy; f.vy -= .65;
        if (f.y <= 0) {
          f.y = 0; f.vy = 0; f.landFrames = 6;
          if (f.moveVariant === 'air' && f.move !== 'special') { f.move = null; f.moveFrame = 0; }
          emit(state, 'dust', f.x, GROUND, f.facing, 12);
        }
      }
      if (f.stun > 0) {
        f.stun--;
        if (f.launched) f.pose = f.y > 0 ? 'tumble' : f.stun > 5 ? 'down' : 'getup';
        if (f.stun === 0) { f.pose = 'idle'; f.launched = false; }
        return;
      }
      if (!f.move) {
        const movement = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const previousX = f.x;
        f.x = Math.max(WALL, Math.min(WIDTH - WALL, f.x + movement * (input.down && f.y === 0 ? 0 : 3.5)));
        f.vx = f.x - previousX;
        if (f.buffer.jump > 0 && f.y === 0) { f.vy = 13; f.y = 1; f.landFrames = 0; f.buffer.jump = 0; }
        f.pose = f.y > 0 ? 'jump' : input.down ? 'crouch' : f.guard ? 'block' : movement ? (state.frame % 20 < 10 ? 'walk' : 'walk2') : (state.frame % 48 < 24 ? 'idle' : 'stance2');
        const action = ['special', 'heavy', 'kick', 'punch'].find(a => f.buffer[a] > 0 && f.energy >= (MOVES[a].cost || 0));
        if (action) {
          f.move = action; f.moveFrame = 0; f.hitDone = false; f.guard = false;
          f.moveVariant = f.y > 0 ? 'air' : input.down ? 'crouch' : 'standing';
          f.buffer[action] = 0;
          f.energy -= MOVES[action].cost || 0;
          if (action === 'special') emit(state, 'powerup', f.x, GROUND - f.y - 100, f.facing, 32);
        }
      }
      if (f.move) {
        const move = moveData(f); f.moveFrame++;
        f.pose = f.moveFrame < move.startup ? (f.moveVariant === 'crouch' ? 'crouch' : f.y > 0 ? 'jump' : 'stance2') : move.pose;
        if (f.moveFrame >= move.startup && f.moveFrame < move.startup + move.active && !f.hitDone) {
          if (f.move === 'special') {
            state.projectiles.push({ owner: slot, x: f.x + f.facing * 55, y: f.y + 105, facing: f.facing, damage: move.damage, life: 150 }); f.hitDone = true;
          } else strikes.push({ source: f, target: other, move, direction: f.facing });
        }
        if (f.moveFrame >= move.startup + move.active + move.recovery) { f.move = null; f.pose = 'idle'; }
      }
      f.energy = Math.min(100, f.energy + .035);
    });
    const contacts = strikes.filter(({ source, target, move, direction }) =>
      (target.x - source.x) * direction >= 0 && Math.abs(source.x - target.x) < move.reach && Math.abs(source.y - target.y) < 90);
    // Resolve contacts together so equal-timing attacks trade fairly on either side.
    for (const { source, target, move, direction } of contacts) {
      dealHit(state, target, source, move.damage, (source.x + target.x) / 2, direction, move); source.hitDone = true;
    }
    state.fighters.forEach(f => { for (const action of Object.keys(f.buffer)) f.buffer[action] = Math.max(0, f.buffer[action] - 1); });
    const [a, b] = state.fighters;
    state.projectiles.forEach(p => {
      p.x += p.facing * 8; p.life--;
      const victim = state.fighters[1 - p.owner];
      if (Math.abs(p.x - victim.x) < 40 && Math.abs(p.y - victim.y - 105) < 75) {
        dealHit(state, victim, state.fighters[p.owner], p.damage, p.x, p.facing); p.life = 0;
      }
    });
    state.projectiles = state.projectiles.filter(p => p.life > 0 && p.x > -50 && p.x < WIDTH + 50);
    if (Math.abs(a.x - b.x) < BODY_GAP && Math.abs(a.y - b.y) < 100) {
      const left = a.x <= b.x ? a : b, right = left === a ? b : a;
      const correction = (BODY_GAP - (right.x - left.x)) / 2;
      left.x -= correction; right.x += correction;
      // Transfer pushback to the free fighter when the other is against a wall.
      if (left.x < WALL) { right.x += WALL - left.x; left.x = WALL; }
      if (right.x > WIDTH - WALL) { left.x -= right.x - (WIDTH - WALL); right.x = WIDTH - WALL; }
    }
    if (a.hp === 0 || b.hp === 0 || state.time <= 0) {
      state.winner = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
      if (state.winner !== null) state.fighters[state.winner].wins++;
      state.phase = 'roundover'; state.phaseFrames = 160;
      state.message = state.winner === null ? 'DRAW' : a.hp === 0 || b.hp === 0 ? 'K.O.' : 'TIME';
      state.fighters.forEach((f, i) => { f.move = null; f.pose = state.winner === i ? 'win' : state.winner === null ? 'idle' : 'down'; });
      emit(state, 'ko', WIDTH / 2, 250, 1, 100);
    }
    return state;
  }
  return { WIDTH, GROUND, MOVES, VARIANTS, moveData, create, tick, resetRound };
});
