const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
function ready() { const s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight'; s.fighters[0].x = 400; s.fighters[1].x = 480; return s; }
function step(s, a = {}, b = {}, count = 1) { for (let i = 0; i < count; i++) E.tick(s, [a, b]); }
test('punch connects once during its active window', () => { const s = ready(); step(s, { punch: true }, {}, 35); assert.equal(s.fighters[1].hp, 93); assert.equal(s.fighters[0].hp, 100); });
test('holding back blocks and takes chip instead of full damage', () => { const s = ready(); step(s, { punch: true }, { right: true }, 6); assert.equal(s.fighters[1].hp, 99); assert.equal(s.fighters[1].pose, 'block'); });
test('an out-of-range punch whiffs', () => { const s = ready(); s.fighters[1].x = 700; step(s, { punch: true }, {}, 30); assert.equal(s.fighters[1].hp, 100); });
test('special consumes meter and projectile can hit at a distance', () => { const s = ready(); s.fighters[1].x = 720; step(s, { special: true }, {}, 70); assert.equal(s.fighters[1].hp, 83); assert.ok(s.fighters[0].energy < 40); });
test('jump rises and lands with feet on ground', () => { const s = ready(); step(s, { jump: true }); assert.ok(s.fighters[0].y > 0); step(s, {}, {}, 60); assert.equal(s.fighters[0].y, 0); });
test('KO awards a round then resets health without erasing score', () => { const s = ready(); s.fighters[1].hp = 5; step(s, { punch: true }, {}, 6); assert.equal(s.phase, 'roundover'); assert.equal(s.fighters[0].wins, 1); step(s, {}, {}, 161); assert.equal(s.phase, 'intro'); assert.equal(s.round, 2); assert.equal(s.fighters[1].hp, 100); assert.equal(s.fighters[0].wins, 1); });
test('second round win ends match and replay starts clean', () => { const s = ready(); s.fighters[0].wins = 1; s.fighters[1].hp = 1; step(s, { punch: true }, {}, 170); assert.equal(s.phase, 'matchover'); const replay = E.create(['a', 'b']); assert.equal(replay.fighters[0].wins, 0); assert.equal(replay.time, 5940); });
test('same inputs produce identical deterministic simulation', () => { const a = E.create(), b = E.create(); for (let i = 0; i < 1000; i++) { const input = { right: i % 120 < 60, punch: i % 30 === 0 }; E.tick(a, [input, {}]); E.tick(b, [input, {}]); } assert.deepEqual(a, b); });

test('a brief attack press near the end of recovery comes out when free', () => {
  const s = ready(), f = s.fighters[0]; s.fighters[1].x = 800;
  f.move = 'punch'; f.moveFrame = 18;
  step(s, { kick: true }); step(s, {}, {}, 3);
  assert.equal(f.move, 'kick'); assert.equal(f.moveFrame, 1);
  step(s, {}, {}, 50); assert.equal(f.move, null, 'A buffered press should not repeat');
});

test('inputs pressed and released during hitstop survive until simulation resumes', () => {
  const s = ready(); s.hitstop = 5;
  step(s, { special: true }); step(s, {}, {}, 4);
  assert.equal(s.fighters[0].move, null); assert.equal(s.time, 5940);
  step(s);
  assert.equal(s.fighters[0].move, 'special'); assert.ok(s.fighters[0].energy < 31);
});

test('jump pressed just before landing takes off on the first grounded frame', () => {
  const s = ready(), f = s.fighters[0]; f.y = 5; f.vy = -3;
  step(s, { jump: true }); assert.equal(f.y, 2);
  step(s); assert.ok(f.y > 0 && f.vy > 0, 'Landing consumes the buffered jump');
});

test('guard entered on the contact frame works equally for either player', () => {
  for (const attacker of [0, 1]) {
    const s = ready(), defender = 1 - attacker, f = s.fighters[attacker];
    f.move = 'punch'; f.moveFrame = 4;
    const input = [{}, {}]; input[defender] = defender ? { right: true } : { left: true };
    E.tick(s, input);
    assert.equal(s.fighters[defender].hp, 99); assert.equal(s.fighters[defender].pose, 'block');
  }
});

test('equal-timing punches trade instead of granting player one priority', () => {
  const s = ready(); step(s, { punch: true }, { punch: true }, 5);
  assert.equal(s.fighters[0].hp, 93); assert.equal(s.fighters[1].hp, 93);
  assert.equal(s.fighters[0].pose, 'hit'); assert.equal(s.fighters[1].pose, 'hit');
});

test('wall collisions transfer the full push to the free fighter', () => {
  for (const positions of [[50, 70], [890, 910], [70, 50], [910, 890]]) {
    const s = ready(); s.fighters.forEach((f, i) => { f.x = positions[i]; }); step(s);
    assert.ok(s.fighters.every(f => f.x >= 50 && f.x <= 910));
    assert.equal(Math.abs(s.fighters[0].x - s.fighters[1].x), 64);
  }
});

test('projectile impact uses its travel direction after the owner turns around', () => {
  const s = ready(); s.fighters[0].x = 800; s.fighters[1].x = 700;
  s.projectiles.push({ owner: 0, x: 680, y: 105, facing: 1, damage: 17, life: 30 }); step(s);
  assert.equal(s.fighters[0].facing, -1);
  assert.equal(s.fighters[1].hp, 83); assert.ok(s.fighters[1].x > 700);
});

test('CPU cannot instantly read and guard a new point-blank jab', () => {
  const s = ready(); s.cpu = true; step(s, { punch: true }, {}, 5);
  assert.equal(s.fighters[1].hp, 93);
});

test('heavy strike is slower and stronger than a jab and never repeats from a held button', () => {
  const s = ready(); step(s, { heavy: true }, {}, 5);
  assert.equal(s.fighters[0].move, 'heavy'); assert.equal(s.fighters[1].hp, 100);
  step(s, { heavy: true }, {}, 50);
  assert.equal(s.fighters[1].hp, 85); assert.equal(s.fighters[0].move, null);
});

test('crouch input chooses a distinct jab or sweep and locks its variant through recovery', () => {
  for (const [action, pose, damage] of [['punch', 'cjab', 6], ['kick', 'sweep', 10]]) {
    const s = ready(); step(s, { down: true, [action]: true });
    const f = s.fighters[0]; assert.equal(f.moveVariant, 'crouch'); assert.equal(E.moveData(f).pose, pose);
    step(s, {}, {}, 11); assert.equal(f.moveVariant, 'crouch'); assert.equal(s.fighters[1].hp, 100 - damage);
  }
});

test('crouching heavy launches an unguarded opponent, then recovers on the ground', () => {
  const s = ready(); step(s, { down: true, heavy: true }, {}, 12);
  const victim = s.fighters[1]; assert.equal(victim.hp, 87); assert.equal(victim.pose, 'tumble'); assert.ok(victim.vy > 0 && victim.launched);
  step(s, {}, {}, 90); assert.equal(victim.y, 0); assert.equal(victim.vy, 0); assert.equal(victim.stun, 0); assert.equal(victim.launched, false);
});

test('blocking a launcher prevents launch and only takes chip damage', () => {
  const s = ready(); s.fighters[1].x = 464;
  step(s, { down: true, heavy: true }, { right: true }, 12);
  const victim = s.fighters[1]; assert.equal(victim.hp, 99); assert.equal(victim.y, 0); assert.equal(victim.launched, false); assert.equal(victim.pose, 'block');
});

test('air attacks select airborne poses and landing ends their recovery', () => {
  const s = ready(), f = s.fighters[0]; f.y = 80; f.vy = 0;
  step(s, { kick: true }); assert.equal(f.moveVariant, 'air'); assert.equal(E.moveData(f).pose, 'airkick');
  f.y = 2; f.vy = -3; step(s);
  assert.equal(f.move, null); assert.equal(f.y, 0); assert.equal(f.landFrames, 6);
});

test('impact freeze also freezes motion time and hit-reaction age', () => {
  const s = ready(); step(s, { punch: true }, {}, 5);
  const frame = s.motionFrame, age = s.fighters[1].hitAge, stop = s.hitstop;
  step(s, {}, {}, stop); assert.equal(s.motionFrame, frame); assert.equal(s.fighters[1].hitAge, age);
  step(s); assert.ok(s.motionFrame > frame); assert.ok(s.fighters[1].hitAge > age);
});

test('CPU mode ignores a second human input stream', () => {
  const s = ready(); s.cpu = true;
  step(s, {}, { heavy: true, special: true, left: true });
  assert.equal(s.fighters[1].move, null); assert.equal(s.fighters[1].x, 480); assert.equal(s.fighters[1].energy, 60.035);
});
