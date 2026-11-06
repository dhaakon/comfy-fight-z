const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const E = require('../public/engine.js');
const A = require('../public/anim.js');
function scene() { const state = E.create(['a', 'b'], { cpu: false }); state.phase = 'fight'; return { state, fighter: state.fighters[0] }; }

test('jab choreography anticipates, contacts, holds briefly and settles without revisiting the wind-up', () => {
  const { state, fighter } = scene(); fighter.move = 'punch';
  const samples = [1, 3, 5, 10, 11, 17, 20].map(frame => { fighter.moveFrame = frame; return A.sample(fighter, state); });
  assert.deepEqual(samples.map(s => s.pose), ['stance2', 'block', 'punch', 'punch', 'stance2', 'stance2', 'stance2']);
  assert.deepEqual(samples.map(s => s.phase), ['anticipation', 'anticipation', 'contact', 'recovery', 'recovery', 'recovery', 'recovery']);
  assert.ok(samples[1].dx < 0 && samples[2].dx > 0 && samples[6].dx < samples[2].dx);
});

test('heavy strikes load, whip for one frame, hold contact, recoil and settle when the motion cels exist', () => {
  const { state, fighter } = scene(); fighter.move = 'heavy';
  const motion = Object.fromEntries(['load', 'punchwhip', 'kickwhip', 'recoil', 'kickrecoil', 'settle', 'heavywind'].map(p => [p, {}]));
  const { startup, active, recovery } = E.MOVES.heavy, timeline = [];
  for (let frame = 0; frame < startup + active + recovery; frame++) { fighter.moveFrame = frame; timeline.push(A.sample(fighter, state, { poses: motion }).pose); }
  const runs = timeline.reduce((list, pose) => { if (list.at(-1)?.pose === pose) list.at(-1).n++; else list.push({ pose, n: 1 }); return list; }, []);
  assert.deepEqual(runs.map(r => r.pose), ['heavywind', 'punchwhip', 'hpunch', 'recoil', 'settle'], 'wind-up (sheetE) → whip → contact → recoil → settle');
  assert.equal(runs[1].n, 1, 'The whip is a single frame'); assert.equal(runs[2].n, active + 3, 'Contact persists into recovery');
  assert.ok(!timeline.slice(startup).includes('heavywind'), 'The wind-up never returns after contact');
  fighter.move = 'kick'; fighter.moveFrame = E.MOVES.kick.startup - 1;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'kickwhip');
  fighter.moveFrame = E.MOVES.kick.startup + E.MOVES.kick.active + 4;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'kickrecoil');
  // Specials keep their own startup cels: a rush still runs in on the dash drawing and whips with the kick cel.
  fighter.move = 'rush'; fighter.moveFrame = 5; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'dash');
  fighter.moveFrame = E.MOVES.rush.startup - 1; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'kickwhip');
  // Casts without the per-move wind-ups use the generic load for the three normals.
  fighter.move = 'punch'; fighter.moveFrame = 2; assert.equal(A.sample(fighter, state, { poses: { load: {} } }).pose, 'load');
  // Without the motion cels a heavy keeps its contact drawing through the recoil window, then settles on the stance.
  fighter.move = 'heavy'; fighter.moveFrame = startup + active + 6;
  assert.equal(A.sample(fighter, state).pose, 'hpunch'); fighter.moveFrame = startup + active + recovery - 1;
  assert.equal(A.sample(fighter, state).pose, 'block', 'the heavy sequence settles on its own first cel');
});

test('neutral breathes on one drawing, or cycles six coherent cels with eased holds from the stand timer', () => {
  const { state, fighter } = scene();
  const idle = [0, 13, 26, 52].map(frame => { state.motionFrame = frame; return A.sample(fighter, state); });
  assert.ok(idle.every(s => s.pose === 'idle'), 'No second stance drawing is flipped in while standing');
  assert.notEqual(idle[0].sy, idle[1].sy, 'The held drawing still breathes');
  const loop = Object.fromEntries(['idle1', 'idle2', 'idle3', 'idle4', 'idle5'].map(p => [p, {}]));
  const cels = [];
  for (let t = 0; t < 90; t++) { fighter.standFrames = t; cels.push(A.sample(fighter, state, { poses: loop }).pose); }
  const runs = cels.reduce((list, pose) => { if (list.at(-1)?.pose === pose) list.at(-1).n++; else list.push({ pose, n: 1 }); return list; }, []);
  assert.deepEqual(runs.map(r => r.pose), ['idle', 'idle1', 'idle2', 'idle3', 'idle4', 'idle5', 'idle4', 'idle3', 'idle2', 'idle1']);
  assert.deepEqual(runs.map(r => r.n), A.IDLE_HOLDS);
  fighter.standFrames = 90; assert.equal(A.sample(fighter, state, { poses: loop }).pose, 'idle', 'The loop returns to the neutral drawing');
  fighter.standFrames = 0; assert.equal(A.sample(fighter, state, { poses: loop }).pose, 'idle', 'Returning to neutral restarts from the neutral drawing');
});

test('guard reactions, landings and the jump apex use their motion cels when present', () => {
  const { state, fighter } = scene(), motion = { guardhit: {}, land: {}, settle: {}, apex: {} };
  fighter.stun = 8; fighter.pose = 'block';
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'guardhit'); assert.equal(A.sample(fighter, state).pose, 'block');
  fighter.stun = 0; fighter.pose = 'idle'; fighter.landFrames = 5;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'land'); fighter.landFrames = 2;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'settle'); assert.equal(A.sample(fighter, state).pose, 'stance2');
  fighter.landFrames = 0; fighter.y = 120; fighter.vy = 1;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'apex'); assert.equal(A.sample(fighter, state).pose, 'entrance');
});

test('crouching and airborne attacks use their corresponding generated pose sets', () => {
  const { state, fighter } = scene(); fighter.move = 'heavy'; fighter.moveVariant = 'crouch'; fighter.moveFrame = 12;
  assert.equal(A.sample(fighter, state).pose, 'launcher');
  fighter.moveVariant = 'air'; fighter.moveFrame = 10;
  const air = A.sample(fighter, state); assert.equal(air.pose, 'airpunch'); assert.equal(air.trail, true);
  fighter.move = 'special'; fighter.moveFrame = 10;
  assert.equal(A.sample(fighter, state).pose, 'powerup');
});

test('walking is a 24-frame stride with passing steps and landing has a brief anchored compression', () => {
  const { state, fighter } = scene(); fighter.vx = 3.5;
  const poses = [0, 9, 12, 21].map(frame => { state.motionFrame = frame; return A.sample(fighter, state).pose; });
  assert.deepEqual(poses, ['walk', 'walk', 'walk2', 'walk2'], 'Without passing-step cels each stride simply holds; no standing guard is cut in');
  const steps = { stepin: {}, stepout: {} };
  assert.deepEqual([0, 9, 12, 21].map(frame => { state.motionFrame = frame; return A.sample(fighter, state, { poses: steps }).pose; }), ['walk', 'stepin', 'walk2', 'stepout']);
  fighter.vx = -3.5;
  assert.deepEqual([0, 9, 12, 21].map(frame => { state.motionFrame = frame; return A.sample(fighter, state, { poses: steps }).pose; }), ['stepout', 'walk2', 'stepin', 'walk'], 'Retreating runs the stride in reverse');
  fighter.vx = 3.5;
  fighter.landFrames = 6; const landing = A.sample(fighter, state);
  assert.equal(landing.pose, 'crouch'); assert.ok(landing.sy < 1 && landing.sx > 1); assert.equal(landing.dy, 0);
});

test('grounded walking keeps feet on their anchor and attacks stay aligned with simulation', () => {
  const { state, fighter } = scene(); fighter.vx = 4;
  for (let frame = 0; frame < 24; frame++) {
    state.motionFrame = frame;
    assert.equal(A.sample(fighter, state).dy, 0, 'A grounded walk frame must not lift the feet');
  }
  fighter.vx = 0; fighter.move = 'heavy';
  for (let frame = 0; frame < E.MOVES.heavy.startup + E.MOVES.heavy.active + E.MOVES.heavy.recovery; frame++) {
    fighter.moveFrame = frame;
    assert.ok(Math.abs(A.sample(fighter, state).dx) <= 4.1, 'Painted fighter must stay near the hitbox');
  }
});

test('backwards movement displays a guard when the fighter is actually blocking', () => {
  const { state, fighter } = scene(); fighter.vx = -3; fighter.guard = true;
  assert.equal(A.sample(fighter, state).pose, 'block');
  fighter.guard = false;
  assert.equal(A.sample(fighter, state).phase, 'walk');
});

test('stationary pose changes draw one clear cel, while a moving strike may leave a subtle trail', () => {
  const { state, fighter } = scene(), renderer = A.createRenderer();
  const canvas = createCanvas(300, 180), ctx = canvas.getContext('2d'), sprite = createCanvas(30, 60);
  const meta = { src: 'fixture', w: 30, h: 60, ax: 15, ay: 60, bh: 60 };
  const data = { poses: Object.fromEntries(['idle', 'stance2', 'block', 'punch', 'hpunch'].map(p => [p, meta])) };
  const originalDraw = ctx.drawImage.bind(ctx); let draws = 0;
  ctx.drawImage = (...args) => { draws++; return originalDraw(...args); };
  fighter.x = 100; fighter.move = 'heavy';
  for (let frame = 1; frame <= 12; frame++) {
    state.motionFrame = frame; fighter.moveFrame = frame; draws = 0;
    renderer.draw(ctx, fighter, data, () => sprite, state, { ground: 150, height: 100 });
    assert.equal(draws, 1, 'A stationary fighter must not have a ghost of the previous pose');
  }
  for (let frame = 13; frame <= 18; frame++) {
    state.motionFrame = frame; fighter.moveFrame = 10; fighter.x += 5; draws = 0;
    renderer.draw(ctx, fighter, data, () => sprite, state, { ground: 150, height: 100 });
  }
  assert.ok(draws > 1, 'A strike moving across the stage may retain a visual trail');
});

test('animation is deterministic, leaves simulation untouched, and stops during impact freeze', () => {
  const { state, fighter } = scene(); state.motionFrame = 7; fighter.move = 'heavy'; fighter.moveFrame = 9;
  const before = JSON.stringify(state), first = A.sample(fighter, state);
  assert.equal(JSON.stringify(state), before);
  state.frame += 100; assert.deepEqual(A.sample(fighter, state), first, 'Render time must not run past frozen simulation time');
});

test('entrance choreography can run while the combat frame stays frozen', () => {
  const { state, fighter } = scene(); state.phase = 'intro';
  assert.deepEqual([0, 30, 90].map(introFrame => A.sample(fighter, state, { introFrame }).pose), ['entrance', 'taunt', 'stance2']);
  assert.equal(state.frame, 0); assert.equal(state.time, 5940);
});

test('reduced motion retains move readability without trails, flashing or deformation', () => {
  const { state, fighter } = scene(); fighter.move = 'heavy'; fighter.moveFrame = 9;
  const normal = A.sample(fighter, state), reduced = A.sample(fighter, state, { reducedMotion: true });
  assert.equal(reduced.pose, normal.pose); assert.equal(reduced.phase, 'contact');
  assert.deepEqual([reduced.dx, reduced.dy, reduced.sx, reduced.sy, reduced.rotation, reduced.trail, reduced.flash], [0, 0, 1, 1, 0, false, 0]);
});

test('renderer draws anchored mirrored art without changing canvas state or fighter data', () => {
  const { state, fighter } = scene(), renderer = A.createRenderer(), canvas = createCanvas(180, 180), ctx = canvas.getContext('2d');
  const sprite = createCanvas(30, 60), painter = sprite.getContext('2d'); painter.fillStyle = '#fff'; painter.fillRect(0, 0, 30, 60);
  const data = { poses: Object.fromEntries(['idle', 'stance2', 'block', 'punch', 'hpunch'].map(p => [p, { src: 'fixture', w: 30, h: 60, ax: 15, ay: 60, bh: 60 }])) };
  fighter.x = 90; fighter.facing = -1; fighter.move = 'heavy'; fighter.moveFrame = 9;
  const original = JSON.stringify(fighter); ctx.globalAlpha = .7; const alpha = ctx.globalAlpha, transform = ctx.getTransform().toString();
  for (let frame = 0; frame < 7; frame++) { state.motionFrame = frame; assert.equal(renderer.draw(ctx, fighter, data, () => sprite, state, { ground: 150, height: 100 }), true); }
  assert.equal(ctx.globalAlpha, alpha); assert.equal(ctx.getTransform().toString(), transform); assert.equal(JSON.stringify(fighter), original);
  assert.ok(ctx.getImageData(80, 90, 1, 1).data[3] > 0, 'The fighter must actually render');
  assert.equal(renderer.draw(ctx, fighter, data, () => null, state), false, 'Missing sprites must remain visible to the caller instead of silently substituting art');
});

test('optional arcade poses replace in-betweens only when the fighter has them', () => {
  const { state, fighter } = scene();
  const all = Object.fromEntries(['walk3', 'walk4', 'run', 'run2', 'punchwind', 'jumpfall', 'crouchblock', 'dizzy', 'roll', 'super'].map(p => [p, {}]));
  fighter.vx = 3.5;
  const walk = [0, 9, 12, 21].map(frame => { state.motionFrame = frame; return A.sample(fighter, state, { poses: all }).pose; });
  assert.deepEqual(walk, ['walk', 'walk3', 'walk2', 'walk4']);
  fighter.vx = 0; fighter.move = 'punch'; fighter.moveFrame = 1;
  assert.equal(A.sample(fighter, state, { poses: all }).pose, 'punchwind');
  assert.equal(A.sample(fighter, state).pose, 'stance2', 'Without the optional sheet the original wind-up remains');
  fighter.move = null; fighter.running = true; state.motionFrame = 0;
  assert.ok(['run', 'run2'].includes(A.sample(fighter, state, { poses: all }).pose));
  fighter.running = false; fighter.dizzy = 30;
  assert.equal(A.sample(fighter, state, { poses: all }).pose, 'dizzy');
  assert.equal(A.sample(fighter, state).pose, 'hit');
  fighter.dizzy = 0; fighter.move = 'roll'; fighter.moveFrame = 8;
  const fallbackRoll = A.sample(fighter, state);
  assert.equal(fallbackRoll.pose, 'tumble'); assert.ok(fallbackRoll.spin > 0, 'A missing roll cel spins the tumble pose');
  assert.equal(A.sample(fighter, state, { poses: all }).spin, 0);
});

test('pose resolution follows fallbacks to a required pose', () => {
  const poses = { idle: {}, stance2: {}, dash: {}, tumble: {}, hit: {}, hpunch: {} };
  assert.equal(A.resolvePose('run2', poses), 'dash');
  assert.equal(A.resolvePose('roll', poses), 'tumble');
  assert.equal(A.resolvePose('hitheavy', poses), 'hit');
  assert.equal(A.resolvePose('blowback', poses), 'hpunch');
  assert.equal(A.resolvePose('unknown', poses), 'idle');
});
