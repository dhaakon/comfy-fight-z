const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const E = require('../public/engine.js');
const A = require('../public/anim.js');
function scene() { const state = E.create(['a', 'b'], { cpu: false }); state.phase = 'fight'; return { state, fighter: state.fighters[0] }; }

test('jab choreography anticipates, contacts, holds briefly and settles without revisiting the wind-up', () => {
  const { state, fighter } = scene(); fighter.move = 'punch';
  // Early and late startup, the first active frame, the two-frame hold past the active frames, then the settle.
  const { startup, active, recovery } = E.MOVES.punch, end = startup + active;
  const samples = [1, startup - 1, startup, end + 1, end + 2, end + recovery - 1, end + recovery].map(frame => { fighter.moveFrame = frame; return A.sample(fighter, state); });
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
  // The roundhouse (toward + S) takes the heavy kick treatment: kick wind-up, kick whip, kick contact, kick recoil.
  const roundhouse = E.MOVES.roundhouse;
  fighter.move = 'roundhouse'; fighter.moveFrame = 2;
  assert.equal(A.sample(fighter, state, { poses: { ...motion, kickwind: {} } }).pose, 'kickwind', 'The kick wind-up (sheetE) loads the roundhouse');
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'load', 'Without it the generic load stands in');
  assert.equal(A.sample(fighter, state).pose, 'stance2');
  fighter.moveFrame = roundhouse.startup - 1;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'kickwhip');
  fighter.moveFrame = roundhouse.startup; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'kick');
  fighter.moveFrame = roundhouse.startup + roundhouse.active + 4;
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'kickrecoil');
  // The light kick (S) is a light: a light load, the lkick contact and a settle, with no whip, kick wind-up or recoil.
  const light = E.MOVES.kick, lightTimeline = [];
  fighter.move = 'kick';
  for (let frame = 1; frame <= light.startup + light.active + light.recovery; frame++) { fighter.moveFrame = frame; lightTimeline.push(A.sample(fighter, state, { poses: motion }).pose); }
  const lightRuns = lightTimeline.reduce((list, pose) => { if (list.at(-1)?.pose === pose) list.at(-1).n++; else list.push({ pose, n: 1 }); return list; }, []);
  assert.deepEqual(lightRuns.map(r => r.pose), ['load', 'lkick', 'settle'], 'light load → lkick contact → settle');
  assert.equal(lightRuns[1].n, light.active + 2, 'A light holds contact two frames past its active frames');
  fighter.moveFrame = 2; assert.equal(A.sample(fighter, state).pose, 'stance2', 'Without the motion cels the light kick loads on the stance');
  fighter.moveFrame = light.startup; assert.equal(A.sample(fighter, state).pose, 'lkick');
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

test('a pushback slide never shows the walk cycle: the defender goes from its reaction straight to idle', () => {
  for (const [press, guard] of [[{ punch: true }, {}], [{ heavy: true }, {}], [{ right: true, kick: true }, {}], [{ punch: true }, { right: true }], [{ heavy: true }, { right: true }]]) {
    const state = E.create(['a', 'b'], { cpu: false }); state.phase = 'fight';
    const [attacker, defender] = state.fighters; attacker.x = 400; defender.x = 480;
    const phases = [];
    for (let t = 0; t < 70; t++) {
      E.tick(state, [t ? {} : press, defender.stun > 0 || t < 3 ? guard : {}]);
      if (defender.hitAge < 60) phases.push(A.sample(defender, state).phase);
      assert.equal(defender.vx, 0, 'Sliding is not walking');
    }
    assert.ok(phases.includes('hit') || phases.includes('guard'), 'The defender reacts');
    assert.ok(!phases.includes('walk'), `${JSON.stringify(press)} ${guard.right ? 'blocked' : 'hit'}: ${[...new Set(phases)].join(' > ')}`);
  }
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

test('a hit reaction keeps the posture the hit found, while a guard follows the stick', () => {
  const poses = { hitlow: {}, crouchblock: {}, guardhit: {} };
  // Slot 0 jabs from 80 units; slot 1 holds `before` until the jab connects, then `after`. The cels slot 1 shows in its stun.
  const reaction = (before, after) => {
    const state = E.create(['a', 'b'], { cpu: false }), d = state.fighters[1], cels = [];
    state.phase = 'fight'; state.fighters[0].x = 400; d.x = 480;
    let touched = false;
    for (let t = 0; t < 30; t++) {
      E.tick(state, [t ? {} : { punch: true }, touched ? after : before]);
      if (state.effects.some(e => e.life === e.maxLife && (e.type === 'hit' || e.type === 'block'))) touched = true;
      if (touched && d.stun > 3) cels.push(A.sample(d, state, { poses }).pose);
    }
    return [...new Set(cels)];
  };
  assert.deepEqual(reaction({}, { down: true }), ['hit'], 'Hit standing, then holding down: the standing reaction throughout');
  assert.deepEqual(reaction({ down: true }, {}), ['hitlow'], 'Hit crouching, then letting go: the crouching reaction throughout');
  assert.deepEqual(reaction({ right: true, down: true }, { right: true }), ['crouchblock', 'guardhit'], 'A crouching guard stands up with the stick');
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

test('air hitstun keeps the reaction cel in the air, the air tech shows the apex, and landing lag holds the land cel', () => {
  const { state, fighter } = scene(), motion = { jumpfall: {}, apex: {}, land: {}, settle: {} };
  // Air hitstun (an air reset): the reaction cel through the impact and never the standing settle, then the falling cel.
  Object.assign(fighter, { y: 100, vy: 0, stun: 10, pose: 'hit', hitAge: 0 });
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'hit');
  fighter.stun = 2; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'hit', 'No settle cel in the air');
  Object.assign(fighter, { hitAge: 8, vy: -3, stun: 6 });
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'jumpfall', 'Falling after the impact: the falling jump cel when the fighter has one');
  assert.equal(A.sample(fighter, state).pose, 'hit', 'otherwise the hit cel');
  fighter.heavyHit = true; assert.equal(A.sample(fighter, state, { poses: { hitheavy: {} } }).pose, 'hitheavy', 'A counter hit takes the heavy reaction');
  // The air tech: the apex cel (or the jump cel) through its invulnerable frames, then the usual airborne cels.
  Object.assign(fighter, { stun: 0, heavyHit: false, pose: 'jump', airTech: true, invulnerable: 4, vy: -6 });
  const tech = A.sample(fighter, state, { poses: motion });
  assert.deepEqual([tech.phase, tech.pose], ['airtech', 'apex']); assert.equal(A.sample(fighter, state).pose, 'jump');
  fighter.invulnerable = 0; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'jumpfall');
  // Landing lag holds the land cel (the crouch without it) until it ends, then the settle.
  Object.assign(fighter, { y: 0, vy: 0, airTech: false, landLag: 1, landFrames: 2, pose: 'crouch' });
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'land'); assert.equal(A.sample(fighter, state).pose, 'crouch');
  fighter.landLag = 0; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'settle');
  // A super jump draws the jump and apex cels as any jump does.
  Object.assign(fighter, { y: 150, vy: 10, superJump: true, landFrames: 0 });
  assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'jump'); fighter.vy = 1; assert.equal(A.sample(fighter, state, { poses: motion }).pose, 'apex');
});

test('an anti-air jab reset plays hit, air tech and landing cels in order, with no standing cel in the air', () => {
  const motion = { jumpfall: {}, apex: {}, land: {}, settle: {} };
  const state = E.create(['a', 'b'], { cpu: false }); state.phase = 'fight';
  const [a, d] = state.fighters; a.x = 400; d.x = 480;
  let hit = false;
  const frames = [];
  for (let t = 0; t < 90; t++) {
    if (!hit) { d.y = 120; d.vy = 0; }
    E.tick(state, [t ? {} : { punch: true }, {}]);
    if (state.effects.some(e => e.life === e.maxLife && e.type === 'hit')) hit = true;
    if (hit) { const s = A.sample(d, state, { poses: motion }); frames.push({ y: d.y, phase: s.phase, pose: s.pose }); }
    if (hit && d.y === 0 && !d.stun && !d.landLag && d.landFrames === 0) break;
  }
  // A tech low enough lands inside its invulnerable frames, with no plain airborne stretch after it.
  const phases = frames.map(f => f.phase).filter((phase, i, list) => phase !== list[i - 1]);
  assert.deepEqual(phases.filter(phase => phase !== 'air'), ['hit', 'airtech', 'landing', 'idle'], phases.join(' > '));
  assert.ok(!phases.includes('air') || phases.indexOf('air') === 2, phases.join(' > '));
  assert.ok(frames.filter(f => f.y > 0).every(f => ['hit', 'jumpfall', 'apex', 'jump'].includes(f.pose)), `airborne cels: ${[...new Set(frames.filter(f => f.y > 0).map(f => f.pose))]}`);
  assert.ok(frames.filter(f => f.phase === 'landing').slice(0, 3).every(f => f.pose === 'land'), 'The landing lag shows the land cel');
});

test('a super jump trails afterimages from takeoff to landing, air attacks included; a jump does not', () => {
  const { state, fighter } = scene();
  Object.assign(fighter, { y: 150, vy: 10, superJump: true });
  assert.deepEqual([A.sample(fighter, state).phase, A.sample(fighter, state).trail], ['air', true]);
  fighter.superJump = false; assert.equal(A.sample(fighter, state).trail, false, 'A normal jump keeps no trail');
  // An air kick's startup has no trail of its own, but inside a super jump it keeps the jump's.
  Object.assign(fighter, { superJump: true, move: 'kick', moveVariant: 'air', moveFrame: 2 });
  assert.deepEqual([A.sample(fighter, state).phase, A.sample(fighter, state).trail], ['anticipation', true]);
  assert.equal(A.sample(fighter, state, { reducedMotion: true }).trail, false);
  // The squat before takeoff and the landing do not trail.
  Object.assign(fighter, { move: null, y: 0, vy: 0, jumpSquat: 2 }); assert.equal(A.sample(fighter, state).trail, false);
  // Through the engine: a super jump trails from its takeoff frame.
  const s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight'; const f = s.fighters[0]; s.fighters[1].x = 900;
  E.tick(s, [{ down: true }, {}]); for (let t = 0; t < 5; t++) E.tick(s, [{ jump: true }, {}]);
  assert.ok(f.y > 0 && f.superJump); assert.equal(A.sample(f, s).trail, true);
});

// The optional detail sheets (sheetH/sheetI): drawn walk cycles, crouch transitions, a five-frame roll and a four-frame sweep.
const DETAIL = Object.fromEntries([...require('../../comfyui/config/game.json').detailSheets.sheetH, ...require('../../comfyui/config/game.json').detailSheets.sheetI].map(p => [p, {}]));
const runsOf = list => list.reduce((out, pose) => { if (out.at(-1)?.pose === pose) out.at(-1).n++; else out.push({ pose, n: 1 }); return out; }, []);

test('drawn walk cycles play six frames a cel, forward and backward on their own drawings', () => {
  const { state, fighter } = scene(); fighter.facing = 1;
  for (const [vx, cycle] of [[4.6, ['walkf1', 'walkf2', 'walkf3', 'walkf4']], [-3.8, ['walkb1', 'walkb2', 'walkb3', 'walkb4']]]) {
    fighter.vx = vx; const poses = [];
    for (let frame = 0; frame < 24; frame++) { state.motionFrame = frame; poses.push(A.sample(fighter, state, { poses: DETAIL }).pose); }
    assert.deepEqual(runsOf(poses).map(r => [r.pose, r.n]), cycle.map(p => [p, 6]));
  }
  // A left-facing fighter walking toward the right walks forward.
  fighter.facing = -1; fighter.vx = -4.6; state.motionFrame = 0;
  assert.equal(A.sample(fighter, state, { poses: DETAIL }).pose, 'walkf1');
  // Without the detail cels the old stride stays.
  fighter.facing = 1; fighter.vx = 4.6; assert.equal(A.sample(fighter, state).pose, 'walk');
});

test('a drawn roll dives, tumbles twice, kneels and rises across the whole roll', () => {
  const { state, fighter } = scene(); fighter.move = 'roll';
  const { startup, recovery } = E.MOVES.roll, poses = [];
  for (let frame = 0; frame < startup + recovery; frame++) { fighter.moveFrame = frame; poses.push(A.sample(fighter, state, { poses: DETAIL })); }
  assert.deepEqual(runsOf(poses.map(s => s.pose)).map(r => r.pose), ['roll1', 'roll2', 'roll3', 'roll4', 'rollrise']);
  assert.ok(poses.every(s => !s.spin), 'Drawn roll frames are not spun');
});

test('a drawn sweep chambers, extends through contact, follows through and draws the leg back', () => {
  const { state, fighter } = scene(); Object.assign(fighter, { move: 'kick', moveVariant: 'crouch', crouching: true });
  const { startup, active, recovery } = E.VARIANTS.crouch.kick, poses = [];
  for (let frame = 0; frame < startup + active + recovery; frame++) { fighter.moveFrame = frame; poses.push(A.sample(fighter, state, { poses: DETAIL }).pose); }
  const runs = runsOf(poses);
  assert.deepEqual(runs.map(r => r.pose), ['sweepwind', 'sweepfull', 'sweepthrough', 'sweepback', 'crouch']);
  assert.equal(runs[0].n, startup); assert.equal(runs[1].n, active + 3, 'The extension holds three frames past the active frames');
});

test('crouching starts and ends on the half crouch when the fighter has it', () => {
  const s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight'; const f = s.fighters[0], seen = [];
  for (let i = 0; i < 12; i++) { E.tick(s, [{ down: i < 8 }, {}]); seen.push(A.sample(f, s, { poses: DETAIL }).pose); }
  assert.deepEqual(seen.slice(0, 4), ['crouchdown', 'crouchdown', 'crouchdown', 'crouch'], 'three frames of the half crouch, then the crouch');
  assert.ok(seen.slice(8, 11).every(p => p === 'crouchdown'), 'standing up passes through the half crouch');
  assert.ok(seen[11] !== 'crouchdown');
  assert.equal(JSON.parse(JSON.stringify(s)).fighters[0].uncrouch, f.uncrouch, 'the counters stay JSON state');
});
