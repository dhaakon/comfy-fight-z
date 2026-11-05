const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
function ready() { const s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight'; s.fighters[0].x = 400; s.fighters[1].x = 480; s.fighters.forEach(f => { f.energy = 60; }); return s; }
function step(s, a = {}, b = {}, count = 1) { for (let i = 0; i < count; i++) E.tick(s, [a, b]); }
test('punch connects once during its active window', () => { const s = ready(); step(s, { punch: true }, {}, 35); assert.equal(s.fighters[1].hp, 93); assert.equal(s.fighters[0].hp, 100); });
test('holding back blocks and takes no chip from a normal', () => { const s = ready(); step(s, { punch: true }, { right: true }, 6); assert.equal(s.fighters[1].hp, 100); assert.equal(s.fighters[1].pose, 'block'); });
test('an out-of-range punch whiffs', () => { const s = ready(); s.fighters[1].x = 700; step(s, { punch: true }, {}, 30); assert.equal(s.fighters[1].hp, 100); });
test('the F special is free, one shot at a time, and can hit at a distance', () => { const s = ready(); s.fighters.forEach(f => { f.energy = 0; }); s.fighters[1].x = 720; step(s, { special: true }, {}, 20); assert.equal(s.projectiles.length, 1); step(s, {}, {}, 10); step(s, { special: true }, {}, 10); assert.notEqual(s.fighters[0].move, 'special', 'A second shot waits'); step(s, {}, {}, 40); assert.equal(s.fighters[1].hp, 83); });
test('jump rises after a four-frame squat and lands with feet on ground', () => { const s = ready(); step(s, { jump: true }); assert.equal(s.fighters[0].y, 0); assert.equal(s.fighters[0].jumpSquat, 4); step(s, { jump: true }, {}, 4); assert.ok(s.fighters[0].y > 0); step(s, {}, {}, 60); assert.equal(s.fighters[0].y, 0); });
test('KO awards a round then resets health without erasing score', () => { const s = ready(); s.fighters[1].hp = 5; step(s, { punch: true }, {}, 6); assert.equal(s.phase, 'roundover'); assert.equal(s.fighters[0].wins, 1); step(s, {}, {}, 200); assert.equal(s.phase, 'intro'); assert.equal(s.round, 2); assert.equal(s.fighters[1].hp, 100); assert.equal(s.fighters[0].wins, 1); });
test('second round win ends match and replay starts clean', () => { const s = ready(); s.fighters[0].wins = 1; s.fighters[1].hp = 1; step(s, { punch: true }, {}, 210); assert.equal(s.phase, 'matchover'); const replay = E.create(['a', 'b']); assert.equal(replay.fighters[0].wins, 0); assert.equal(replay.time, 5940); });
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
  assert.equal(s.fighters[0].move, 'special'); assert.ok(s.fighters[0].moveFrame >= 1, 'The buffered special starts once the freeze ends');
});

test('jump pressed just before landing starts the jump squat on the first grounded frame', () => {
  const s = ready(), f = s.fighters[0]; f.y = 5; f.vy = -3;
  step(s, { jump: true }); assert.equal(f.y, 2);
  step(s); assert.equal(f.y, 0); assert.equal(f.jumpSquat, 4, 'Landing consumes the buffered jump');
  step(s, {}, {}, 4); assert.ok(f.y > 0 && f.vy > 0); assert.equal(f.hop, true, 'A released tap becomes a short hop');
});

test('guard entered on the contact frame works equally for either player', () => {
  for (const attacker of [0, 1]) {
    const s = ready(), defender = 1 - attacker, f = s.fighters[attacker];
    f.move = 'punch'; f.moveFrame = 4;
    const input = [{}, {}]; input[defender] = defender ? { right: true } : { left: true };
    E.tick(s, input);
    assert.equal(s.fighters[defender].hp, 100); assert.equal(s.fighters[defender].pose, 'block');
  }
});

test('equal-timing punches trade instead of granting player one priority', () => {
  const s = ready(); step(s, { punch: true }, { punch: true }, 5);
  assert.equal(s.fighters[0].hp, 93); assert.equal(s.fighters[1].hp, 93);
  assert.equal(s.fighters[0].pose, 'hit'); assert.equal(s.fighters[1].pose, 'hit');
});

test('wall collisions transfer the full push to the free fighter', () => {
  for (const positions of [[50, 70], [E.WIDTH - 70, E.WIDTH - 50], [70, 50], [E.WIDTH - 50, E.WIDTH - 70]]) {
    const s = ready(); s.fighters.forEach((f, i) => { f.x = positions[i]; }); step(s);
    assert.ok(s.fighters.every(f => f.x >= 50 && f.x <= E.WIDTH - 50));
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
  const victim = s.fighters[1]; assert.equal(victim.hp, 100); assert.equal(victim.y, 0); assert.equal(victim.launched, false); assert.equal(victim.pose, 'block');
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
  const human = ready(), quiet = ready(); human.cpu = quiet.cpu = true;
  for (let i = 0; i < 120; i++) { E.tick(human, [{}, { heavy: true, special: i % 2 === 0, left: true }]); E.tick(quiet, [{}, {}]); }
  assert.deepEqual(human, quiet, 'The CPU, not the remote stream, controls slot two');
});

test('a confirmed jab can chain into a buffered heavy during hitstop', () => {
  for (const attacker of [0, 1]) {
    const s = ready(), defender = 1 - attacker, controls = [{}, {}];
    controls[attacker] = { punch: true };
    for (let i = 0; i < 5; i++) E.tick(s, controls);
    assert.equal(s.fighters[defender].hp, 93);
    controls[attacker] = { heavy: true }; E.tick(s, controls);
    controls[attacker] = {};
    for (let i = 0; i < 20; i++) E.tick(s, controls);
    assert.equal(s.fighters[defender].hp, 78, 'Both chained hits must connect');
  }
});

test('a whiff cannot be cancelled and a held button does not auto-chain', () => {
  const s = ready(), attacker = s.fighters[0]; s.fighters[1].x = 800;
  step(s, { punch: true }, {}, 5); step(s, { heavy: true }); step(s, {}, {}, 2);
  assert.equal(attacker.move, 'punch'); assert.equal(attacker.connected, false);
  step(s, {}, {}, 25); assert.equal(attacker.move, null);
});

test('a confirmed strike can cancel into one special projectile', () => {
  const s = ready(), attacker = s.fighters[0]; step(s, { punch: true }, {}, 5);
  step(s, { special: true }); step(s, {}, {}, 6);
  assert.equal(attacker.move, 'special');
  s.fighters[1].x = 800; // Leave room to observe the projectile before impact.
  step(s, {}, {}, 15); assert.equal(s.projectiles.length, 1);
  step(s, {}, {}, 5);
  assert.equal(s.projectiles.length, 1, 'Only one shot is on screen');
});

test('air attacks preserve jump momentum and landing clears it', () => {
  for (const direction of [-1, 1]) {
    const s = ready(), f = s.fighters[0]; s.fighters[1].x = direction > 0 ? 800 : 100;
    const key = direction > 0 ? 'right' : 'left';
    step(s, { [key]: true, jump: true }, {}, 5); const before = f.x;
    step(s, { kick: true }, {}, 7);
    assert.ok((f.x - before) * direction > 20, 'Attack should continue the jump trajectory');
    step(s, {}, {}, 70); assert.equal(f.y, 0); assert.equal(f.airVX, 0);
  }
});

test('a follow-up impact during blockstun stays blocked even if back is released', () => {
  const s = ready(); step(s, { punch: true }, { right: true }, 5);
  const defender = s.fighters[1]; assert.equal(defender.hp, 100); assert.equal(defender.blockStun, true);
  step(s, {}, {}, s.hitstop);
  s.projectiles.push({ owner: 0, x: defender.x - 8, y: 105, facing: 1, damage: 17, life: 30 });
  step(s); assert.equal(defender.hp, 96); assert.equal(defender.pose, 'block');
});

test('forward movement is quicker than retreat while both stop at the arena walls', () => {
  const s = ready(), f = s.fighters[0]; s.fighters[1].x = 800;
  const start = f.x; step(s, { right: true }, {}, 5); const forward = f.x - start;
  const middle = f.x; step(s, { left: true }, {}, 5); const backward = middle - f.x;
  assert.ok(forward > backward && backward > 0);
  f.x = 51; step(s, { left: true }, {}, 5); assert.equal(f.x, 50);
});

test('retreat animates as walking until a nearby attack threatens, then guards in place', () => {
  for (const defender of [0, 1]) {
    const s = ready(), fighter = s.fighters[defender], attacker = s.fighters[1 - defender];
    attacker.x = defender ? 120 : 840;
    const away = defender ? 'right' : 'left', controls = [{}, {}];
    controls[defender] = { [away]: true };
    const start = fighter.x; E.tick(s, controls);
    assert.notEqual(fighter.x, start); assert.equal(fighter.guard, false);
    assert.ok(['walk', 'walk2'].includes(fighter.pose));
    attacker.x = defender ? fighter.x - 80 : fighter.x + 80;
    controls[1 - defender] = { punch: true };
    const held = fighter.x; E.tick(s, controls);
    assert.equal(fighter.x, held); assert.equal(fighter.guard, true); assert.equal(fighter.pose, 'block');
    for (let i = 0; i < 5; i++) E.tick(s, controls);
    assert.equal(fighter.hp, 100, 'The nearby attack remains blockable');
  }
});

test('projectiles must approach the defender from the guarded side', () => {
  for (const direction of [-1, 1]) {
    const s = ready(), target = s.fighters[1], owner = s.fighters[0];
    target.x = 480; owner.x = target.x - direction * 300;
    s.projectiles.push({ owner: 0, x: target.x - direction * 8, y: 105, facing: direction, damage: 17, life: 30 });
    const guard = direction > 0 ? { right: true } : { left: true };
    step(s, {}, guard);
    assert.equal(target.hp, 96, 'Incoming attack from the front is blocked');
    const cross = ready(), victim = cross.fighters[1];
    victim.x = 480; cross.fighters[0].x = victim.x + direction * 300;
    cross.projectiles.push({ owner: 0, x: victim.x - direction * 8, y: 105, facing: direction, damage: 17, life: 30 });
    const awayFromOwner = direction > 0 ? { left: true } : { right: true };
    step(cross, {}, awayFromOwner);
    assert.equal(victim.hp, 83, 'A shot arriving behind the guarded side connects');
  }
});

test('a held attack cannot lock the defender in guard after the move ends', () => {
  const s = ready(), defender = s.fighters[1];
  const start = defender.x;
  step(s, { punch: true }, { right: true }, 70);
  assert.equal(defender.hp, 100);
  assert.ok(defender.x > start + 40, 'Retreat resumes after recovery even while the attack button is held');
  assert.equal(defender.guard, false);
});

function advantage(s, button, defenderInput = {}) {
  const [a, d] = s.fighters; let aFree = -1, dFree = -1;
  for (let t = 0; t < 90 && (aFree < 0 || dFree < 0); t++) {
    E.tick(s, [t ? {} : { [button]: true }, defenderInput]);
    if (d.hitAge > 90) continue;
    if (aFree < 0 && !a.move) aFree = s.motionFrame;
    if (dFree < 0 && !d.stun) dFree = s.motionFrame;
  }
  return dFree - aFree;
}

test('every standing strike leaves the attacker plus on hit', () => {
  for (const button of ['punch', 'kick', 'heavy']) assert.equal(advantage(ready(), button), E.MOVES[button].onHit, button);
});

test('a blocked heavy is punishable by a jab while a blocked jab is safe', () => {
  assert.ok(advantage(ready(), 'heavy', { right: true }) <= -E.MOVES.punch.startup);
  assert.ok(advantage(ready(), 'punch', { right: true }) >= 0);
});

test('hitting a cornered defender pushes the attacker away instead', () => {
  const s = ready(), right = E.WIDTH - 50; s.fighters[0].x = right - 70; s.fighters[1].x = right - 5;
  step(s, { punch: true }, {}, 8);
  assert.equal(s.fighters[1].x, right);
  assert.ok(s.fighters[0].x < right - 70, 'The attacker absorbs the push the wall prevents');
});

function motion(s, digits, button, slot = 0) {
  // Feed keypad digits for player one facing right, one frame each, then the button.
  const map = { 1: { down: true, left: true }, 2: { down: true }, 3: { down: true, right: true }, 4: { left: true }, 5: {}, 6: { right: true } };
  for (const d of digits) { const input = [{}, {}]; input[slot] = map[d]; E.tick(s, input); }
  const input = [{}, {}]; input[slot] = { ...map[digits[digits.length - 1]], [button]: true }; E.tick(s, input);
}

test('quarter-circle forward throws a free fireball, one at a time', () => {
  const s = ready(); s.fighters[1].x = 900; const meter = s.fighters[0].energy;
  motion(s, [2, 3, 6], 'punch'); assert.equal(s.fighters[0].move, 'fireball');
  step(s, {}, {}, 14); assert.equal(s.projectiles.length, 1); assert.ok(s.fighters[0].energy >= meter);
  step(s, {}, {}, 25); motion(s, [2, 3, 6], 'punch'); assert.notEqual(s.fighters[0].move, 'fireball', 'A second fireball waits for the first');
});

test('the rising uppercut is invulnerable on startup and launches', () => {
  const s = ready(); s.fighters[1].move = 'kick'; s.fighters[1].moveFrame = 1; s.fighters[1].moveVariant = 'standing';
  motion(s, [6, 2, 3], 'heavy');
  assert.equal(s.fighters[0].move, 'rising'); assert.ok(s.fighters[0].invulnerable > 0);
  step(s, {}, {}, 12);
  assert.equal(s.fighters[0].hp, 100, 'The kick passes through the reversal');
  assert.ok(s.fighters[1].launched);
});

test('lows must be blocked crouching and jump-ins must be blocked standing', () => {
  const low = ready(); step(low, { down: true, kick: true }, { right: true }, 14); assert.ok(low.fighters[1].hp < 100);
  const crouched = ready(); step(crouched, { down: true, kick: true }, { right: true, down: true }, 14); assert.equal(crouched.fighters[1].hp, 100);
  const high = ready(), a = high.fighters[0]; a.y = 40; a.vy = -2; a.move = 'kick'; a.moveVariant = 'air'; a.moveFrame = 7;
  step(high, {}, { right: true, down: true }, 3); assert.ok(high.fighters[1].hp < 100, 'A crouching guard loses to a jump-in');
});

test('forward plus heavy up close is an unblockable throw that knocks down', () => {
  const s = ready(); s.fighters[1].x = 470;
  step(s, { right: true, heavy: true }, { right: true }, 3);
  assert.equal(s.fighters[0].move, 'throw'); assert.equal(s.fighters[1].hp, 88); assert.ok(s.fighters[1].launched);
});

test('double-tapping and holding forward runs faster than walking, then skids to a stop', () => {
  const s = ready(), f = s.fighters[0]; s.fighters[1].x = 1200; const start = f.x;
  step(s, { right: true }); step(s); step(s, { right: true }, {}, 15);
  assert.equal(f.running, true); assert.ok(f.x - start > 100, 'run covered ' + (f.x - start));
  step(s); assert.equal(f.running, false); assert.ok(f.skid > 0);
});

test('double-tapping back is an invulnerable backstep', () => {
  const s = ready(), f = s.fighters[0]; const start = f.x;
  step(s, { left: true }); step(s); step(s, { left: true });
  assert.ok(f.dash > 0 && f.invulnerable > 0); step(s, {}, {}, 12);
  assert.ok(start - f.x > 50);
});

test('combo damage scales down after the second hit', () => {
  assert.equal(E.comboScale(1), 1); assert.equal(E.comboScale(2), 1);
  assert.ok(E.comboScale(4) < E.comboScale(3) && E.comboScale(30) === .3);
  const s = ready(); step(s, { punch: true }, {}, 7); step(s, { kick: true }, {}, 16);
  assert.equal(s.fighters[1].combo, 2, 'A punch cancelled into a kick is a two-hit combo');
});

test('F and D together with a power stock starts a multi-hit super with a cinematic freeze', () => {
  const s = ready(); s.fighters[0].stocks = 1; s.fighters[1].x = 700;
  step(s, { special: true, heavy: true });
  assert.equal(s.fighters[0].move, 'super'); assert.equal(s.fighters[0].stocks, 0); assert.ok(s.hitstop >= 30);
  step(s, {}, {}, 120); assert.ok(s.fighters[1].hp <= 75 && s.fighters[1].combo >= 5);
});

test('the screen lock keeps both fighters within one screen of each other', () => {
  const s = ready(); s.fighters[0].x = 300; s.fighters[1].x = 300 + E.MAX_DIST;
  step(s, { left: true }, { right: true }, 30);
  assert.ok(Math.abs(s.fighters[0].x - s.fighters[1].x) <= E.MAX_DIST + .001);
});

test('remote players cannot request moves by name', () => {
  const s = ready(); step(s, { command: 'super' }, { command: 'super' });
  assert.ok(s.fighters.every(f => f.move === null));
});

function styled(p0, p1 = 'balanced') {
  const s = E.create(['a', 'b'], { cpu: false, profiles: { a: { style: p0 }, b: { style: p1 } } });
  s.phase = 'fight'; s.fighters[0].x = 400; s.fighters[1].x = 480; return s;
}
function motionFor(s, digits, button, slot = 0) {
  const map = { 1: { down: true, left: true }, 2: { down: true }, 3: { down: true, right: true }, 4: { left: true }, 5: {}, 6: { right: true } };
  for (const d of digits) { const input = [{}, {}]; input[slot] = map[d]; E.tick(s, input); }
  const input = [{}, {}]; input[slot] = { ...map[digits[digits.length - 1]], [button]: true }; E.tick(s, input);
}

test('the power gauge fills into at most three stocks and meter carries between rounds', () => {
  const s = ready(), f = s.fighters[0]; f.energy = 0; f.stocks = 0;
  for (let i = 0; i < 40; i++) { f.energy += 10; E.tick(s, [{}, {}]); }
  assert.equal(f.stocks, 3); assert.ok(f.energy <= E.BAR);
  f.hp = 100; s.fighters[1].hp = 1; step(s, { punch: true }, {}, 6); step(s, {}, {}, 200);
  assert.equal(s.round, 2); assert.equal(s.fighters[0].stocks, 3, 'Stocks carry into the next round');
});

test('a tapped jump hops lower than a held jump', () => {
  const apex = held => { const s = ready(), f = s.fighters[0]; let top = 0; step(s, { jump: true }); for (let i = 0; i < 60; i++) { E.tick(s, [held ? { jump: true } : {}, {}]); top = Math.max(top, f.y); } return top; };
  assert.ok(apex(true) > apex(false) + 40);
});

test('A and S together roll through a strike with invulnerability', () => {
  const s = ready(), f = s.fighters[0]; s.fighters[1].move = 'punch'; s.fighters[1].moveFrame = 1; s.fighters[1].moveVariant = 'standing';
  step(s, { punch: true, kick: true });
  assert.equal(f.move, 'roll'); assert.ok(f.invulnerable > 0);
  step(s, {}, {}, 10); assert.equal(f.hp, 100, 'The jab whiffs during the invulnerable roll');
  step(s, {}, {}, 20); assert.ok(f.x > s.fighters[1].x, 'The roll passes through the opponent');
});

test('S and D together throw a knockdown blowback', () => {
  const s = ready(); s.fighters[1].x = 500;
  step(s, { kick: true, heavy: true }); assert.equal(s.fighters[0].move, 'blowback');
  step(s, {}, {}, 16); assert.ok(s.fighters[1].launched); assert.ok(s.fighters[1].hp < 100);
});

test('a stock guard-cancels blockstun into an invulnerable roll', () => {
  const s = ready(), defender = s.fighters[1]; defender.stocks = 1;
  step(s, { heavy: true }, { right: true }, 9); assert.equal(defender.blockStun, true);
  // The cancel press is buffered through the four-frame guard pause and comes out as soon as play resumes.
  step(s, {}, { punch: true, kick: true }); step(s, {}, {}, s.hitstop + 1);
  assert.equal(defender.move, 'gcRoll'); assert.equal(defender.stocks, 0); assert.equal(defender.blockStun, false);
});

test('pressing heavy as a throw lands escapes it', () => {
  const s = ready(); s.fighters[1].x = 470;
  step(s, { right: true, heavy: true }, { heavy: true }, 3);
  assert.equal(s.fighters[1].hp, 100); assert.ok(s.effects.some(e => e.type === 'banner' && e.text === 'THROW ESCAPE'));
});

test('an attack press during a knockdown tumble quick-rises', () => {
  const s = ready(), d = s.fighters[1]; s.fighters[1].x = 500;
  step(s, { down: true, kick: true }, {}, 12); assert.ok(d.launched);
  let rose = false;
  for (let i = 0; i < 40; i++) { E.tick(s, [{}, i % 4 === 0 ? { punch: true } : {}]); rose = rose || d.quickRise || s.effects.some(e => e.text === 'QUICK RISE'); }
  assert.ok(rose); assert.equal(d.launched, false, 'Quick rise shortens the downtime');
});

test('accumulated damage dizzies a fighter and mashing shortens it', () => {
  const s = ready(), d = s.fighters[1]; d.dizzyMeter = 99;
  step(s, { punch: true }, {}, 5); step(s, {}, {}, 30);
  assert.ok(d.dizzy > 0); const before = d.dizzy;
  for (let i = 0; i < 6; i++) E.tick(s, [{}, { punch: i % 2 === 0 }]);
  assert.ok(before - d.dizzy > 6, 'Mashing shakes off the daze faster');
});

test('a taunt drains the opponent power gauge', () => {
  const s = ready(); s.fighters[1].x = 900; s.fighters[1].energy = 50;
  step(s, { taunt: true }, {}, 25);
  assert.equal(s.fighters[0].move, 'taunt'); assert.ok(s.fighters[1].energy < 40);
});

test('fighting styles map 214 to distinct specials', () => {
  const grab = styled('grappler'); motionFor(grab, [2, 1, 4], 'punch'); assert.equal(grab.fighters[0].move, 'commandGrab');
  for (let i = 0; i < 9; i++) E.tick(grab, [{}, { right: true }]);
  assert.ok(grab.fighters[1].hp < 100, 'The command grab is unblockable');
  const trick = styled('trickster'); trick.fighters[1].x = 700; motionFor(trick, [2, 1, 4], 'punch'); step(trick, {}, {}, 15);
  assert.ok(trick.fighters[0].x > 700, 'The teleport reappears behind the opponent');
  const zone = styled('zoner'); zone.fighters[1].x = 900; motionFor(zone, [2, 1, 4], 'punch'); step(zone, {}, {}, 14);
  assert.ok(zone.projectiles.length === 1 && zone.projectiles[0].rise > 0, 'Sky Shot rises as an anti-air');
  const boss = styled('boss'); boss.fighters[1].x = 1100; motionFor(boss, [2, 3, 6], 'punch'); step(boss, {}, {}, 15);
  assert.equal(boss.projectiles.length, 2, 'The boss fires a twin projectile');
  const speed = styled('speed'); speed.fighters[1].x = 520; motionFor(speed, [2, 1, 4], 'punch');
  for (let i = 0; i < 40; i++) E.tick(speed, [i % 6 === 0 ? { punch: true } : {}, {}]);
  assert.ok(speed.fighters[1].combo >= 2 || speed.fighters[1].hp <= 86, 'The rhythm rush chains');
});

test('armored rush absorbs one hit and keeps charging', () => {
  const s = styled('power'); s.fighters[1].x = 500;
  motionFor(s, [2, 1, 4], 'punch'); assert.equal(s.fighters[0].move, 'armorRush');
  s.fighters[1].move = 'punch'; s.fighters[1].moveFrame = 4; s.fighters[1].moveVariant = 'standing';
  step(s, {}, {}, 3);
  assert.ok(s.effects.some(e => e.type === 'armor') && s.fighters[0].move === 'armorRush', 'The armored rush keeps charging through a jab');
});

test('rounds announce FINAL ROUND, perfect and time-over results', () => {
  const s = ready(); s.fighters.forEach(f => { f.wins = 1; }); E.resetRound(s);
  assert.equal(s.message, 'FINAL ROUND');
  const perfect = ready(); perfect.fighters[1].hp = 1; step(perfect, { punch: true }, {}, 6);
  assert.equal(perfect.result.kind, 'ko'); assert.equal(perfect.result.perfect, true);
  step(perfect, {}, {}, 90); assert.equal(perfect.message, 'PERFECT');
  const time = ready(); time.time = 2; time.fighters[0].hp = 60; step(time, {}, {}, 3);
  assert.equal(time.result.kind, 'time'); assert.equal(time.winner, 1); assert.equal(time.message, 'TIME OVER');
});

test('round options control wins, timer and training refills', () => {
  const one = E.create(['a', 'b'], { cpu: false, roundsToWin: 1 }); one.phase = 'fight'; one.fighters[1].hp = 1; one.fighters[0].x = 400; one.fighters[1].x = 480;
  step(one, { punch: true }, {}, 210); assert.equal(one.phase, 'matchover');
  const endless = E.create(['a', 'b'], { cpu: false, roundTime: 0 }); endless.phase = 'fight'; step(endless, {}, {}, 30); assert.equal(endless.time, 0); assert.equal(endless.phase, 'fight');
  const training = E.create(['a', 'b'], { cpu: false, training: true }); training.phase = 'fight'; training.fighters[0].x = 400; training.fighters[1].x = 480;
  training.fighters[1].hp = 5; step(training, { punch: true }, {}, 6); assert.equal(training.phase, 'fight');
  step(training, {}, {}, 80); assert.equal(training.fighters[1].hp, 100); assert.equal(training.fighters[0].stocks, E.STOCK_MAX);
});

test('CPU levels stay deterministic and two CPUs finish a demo match', () => {
  const run = () => { const s = E.create(['a', 'b'], { cpuSlots: [true, true], cpuLevel: 6, roundsToWin: 1, seed: 7, profiles: { a: { style: 'speed' }, b: { style: 'grappler' } } }); for (let i = 0; i < 99 * 60 + 600 && s.phase !== 'matchover'; i++) E.tick(s, [{}, {}]); return s; };
  const a = run(), b = run();
  assert.deepEqual(a, b); assert.equal(a.phase, 'matchover');
  assert.ok(a.fighters.some(f => f.hp < 100), 'The CPUs actually fight');
});

test('move lists describe each style for menus', () => {
  const list = E.moveList({ style: 'grappler', specialMove: { name: 'Sizzle Burst' }, superMove: { name: 'Five-Alarm Cookout' } });
  assert.equal(list[0].name, 'Sizzle Burst'); assert.match(list[2].name, /grab/i); assert.equal(list[3].name, 'Five-Alarm Cookout');
  assert.deepEqual(Object.keys(E.boxes(ready().fighters[0])), ['hurt', 'hit']);
});
