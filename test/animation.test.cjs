const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const E = require('../public/engine.js');
const A = require('../public/anim.js');
function scene() { const state = E.create(['a', 'b'], { cpu: false }); state.phase = 'fight'; return { state, fighter: state.fighters[0] }; }

test('jab choreography anticipates, contacts and returns rather than holding one attack sprite', () => {
  const { state, fighter } = scene(); fighter.move = 'punch';
  const samples = [1, 3, 5, 17, 20].map(frame => { fighter.moveFrame = frame; return A.sample(fighter, state); });
  assert.deepEqual(samples.map(s => s.pose), ['stance2', 'block', 'punch', 'block', 'stance2']);
  assert.deepEqual(samples.map(s => s.phase), ['anticipation', 'anticipation', 'contact', 'recovery', 'recovery']);
  assert.ok(samples[1].dx < 0 && samples[2].dx > 0 && samples[4].dx < samples[2].dx);
});

test('crouching and airborne attacks use their corresponding generated pose sets', () => {
  const { state, fighter } = scene(); fighter.move = 'heavy'; fighter.moveVariant = 'crouch'; fighter.moveFrame = 12;
  assert.equal(A.sample(fighter, state).pose, 'launcher');
  fighter.moveVariant = 'air'; fighter.moveFrame = 10;
  const air = A.sample(fighter, state); assert.equal(air.pose, 'airpunch'); assert.equal(air.trail, true);
  fighter.move = 'special'; fighter.moveFrame = 10;
  assert.equal(A.sample(fighter, state).pose, 'powerup');
});

test('walking has intermediate stance frames and landing has a brief anchored compression', () => {
  const { state, fighter } = scene(); fighter.vx = 3.5;
  const poses = [0, 6, 12, 18].map(frame => { state.motionFrame = frame; return A.sample(fighter, state).pose; });
  assert.deepEqual(poses, ['walk', 'stance2', 'walk2', 'stance2']);
  fighter.landFrames = 6; const landing = A.sample(fighter, state);
  assert.equal(landing.pose, 'crouch'); assert.ok(landing.sy < 1 && landing.sx > 1); assert.equal(landing.dy, 0);
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
