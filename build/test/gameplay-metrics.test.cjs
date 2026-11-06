// Gameplay metrics harness (gameplay-audit.md, phase 0). These are structural assertions: the tools run, every
// move is measured, the measurements agree with the engine's own move tables and CPU runs are reproducible.
// Each later phase adds its target assertions below them (phase 1: frame data, slides, damage, meter and input).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const E = require('../public/engine.js');
const M = require('../tools/lib/gameplay-metrics.cjs');

const root = path.join(__dirname, '..', '..');
const nowhere = path.join(os.tmpdir(), `no-dad-fighter-z-${process.pid}`);
const tool = (script, args = [], env = {}) => spawnSync(process.execPath, [path.join(root, 'build', 'tools', script), ...args], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } });
let cachedRows = null;
const allRows = () => (cachedRows ||= M.measureAll(E));
const isStun = value => (Number.isInteger(value) && value >= 0) || value === 'KD' || value === 'launch';

test('the probe and the frame-data table run without the dad-fighter-z repo', () => {
  assert.equal(fs.existsSync(nowhere), false);
  assert.equal(M.loadReference(nowhere), null);
  const probe = tool('gameplay-probe.cjs', [], { DFZ_REPO: nowhere });
  assert.equal(probe.status, 0, probe.stderr);
  for (const section of ['== OURS normals', '== jumps', '== launcher follow-up', '== chains', '== health pacing', '== CPU vs CPU', '== vertical hit shape']) assert.ok(probe.stdout.includes(section), section);
  assert.match(probe.stdout, /dad-fighter-z engine not found/);
  assert.doesNotMatch(probe.stdout, /^DFZ /m, 'No reference rows without the reference engine');
  const json = tool('gameplay-probe.cjs', ['--json'], { DFZ_REPO: nowhere });
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.reference, false); assert.equal(report.cpu.length, 3); assert.ok(report.normals.length >= 9);
  const table = tool('frame-data.cjs', [], { DFZ_REPO: nowhere });
  assert.equal(table.status, 0, table.stderr);
  for (const heading of ['Ground normals:', 'Air normals', 'System moves:', 'Specials:', 'Supers:']) assert.ok(table.stdout.includes(heading), heading);
  assert.match(table.stdout, /^5A\s+punch\s+\d+/m);
  const markdown = tool('frame-data.cjs', ['--markdown'], { DFZ_REPO: nowhere });
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /^## Ground normals$/m);
  assert.match(markdown.stdout, /^\| Input \| Move \| Startup \| Active \| Recovery \| Total \| Hitstun \| Blockstun \| On hit \| On block \| Damage \|/m);
  const dump = JSON.parse(tool('frame-data.cjs', ['--json'], { DFZ_REPO: nowhere }).stdout);
  assert.deepEqual(dump.rows.map(row => row.id), allRows().map(row => row.id));
});

test('the probe adds the dad-fighter-z comparison when the reference repo is present', t => {
  const reference = process.env.DFZ_REPO || 'C:/Users/dhaak/Development/dad-fighter-z-repo';
  if (!M.loadReference(reference)) return t.skip('dad-fighter-z repo not present');
  const probe = tool('gameplay-probe.cjs', [], { DFZ_REPO: reference });
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /^DFZ normals|^== DFZ normals/m);
  assert.match(probe.stdout, /^DFZ  seed 1:/m);
});

test('input notation parses numpad motions, chords, air and guard-cancel inputs', () => {
  assert.deepEqual(M.parseInput('236A'), { text: '236A', air: false, guardCancel: false, digits: [2, 3, 6], buttons: ['punch'] });
  assert.deepEqual(M.parseInput('j.D').digits, [5]); assert.equal(M.parseInput('j.D').air, true);
  assert.deepEqual(M.parseInput('S+D').buttons, ['kick', 'heavy']);
  assert.equal(M.parseInput('gc:A+S').guardCancel, true);
  assert.deepEqual(M.parseInput('sweep').digits, [2]);
  assert.deepEqual(['A', 'j.5A', '5S+D', 'gc.A+S', 'super'].map(input => M.parseInput(input).text), ['5A', 'j.A', 'S+D', 'gc:A+S', 'F+D'], 'Inputs have one canonical spelling');
  assert.throws(() => M.parseInput('punch please'), /Unknown input/);
  assert.equal(M.prettyInput('2S'), '↓ + S'); assert.equal(M.prettyInput('623A'), '→↓↘ + A');
  assert.deepEqual(M.dirInput(1, 1), { left: true, down: true }); assert.deepEqual(M.dirInput(6, -1), { left: true }); assert.deepEqual(M.dirInput(9, 1), { right: true, jump: true });
  assert.deepEqual(M.inputFrames('214S', -1), [{ down: true }, { right: true, down: true }, { right: true, kick: true }]);
});

test('measureAll measures every normal, system move and special', () => {
  const rows = allRows(), has = (move, variant) => rows.some(row => row.move === move && (variant === undefined || row.variant === variant));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Row ids are unique');
  // Every move in the table, striking or not (the rolls, the taunt and the trickster's teleport too).
  for (const key of Object.keys(E.MOVES)) assert.ok(has(key), `${key} is measured`);
  for (const [variant, moves] of Object.entries(E.VARIANTS)) for (const key of Object.keys(moves)) assert.ok(has(key, variant), `${variant} ${key} is measured`);
  for (const id of ['5A', '5S', '5D', '2A', '2S', '2D', 'j.A', 'j.S', 'j.D', 'blowback', 'throw', 'roll', 'taunt', 'special', 'rising', 'teleport', 'super']) assert.ok(rows.some(row => row.id === id), id);
  for (const row of rows.filter(r => r.kind !== 'sequence')) {
    for (const key of ['startup', 'active', 'recovery', 'total']) assert.ok(Number.isInteger(row[key]) && row[key] >= 0, `${row.id} ${key} = ${row[key]}`);
    assert.equal(row.total, row.startup + row.active + row.recovery, row.id);
    if (!row.strikes) {
      // Moves that never strike: evasive system moves, the taunt and the teleport. Their strike columns stay empty.
      assert.ok(['roll', 'gcRoll', 'taunt', 'teleport'].includes(row.move), `${row.id} does not strike`);
      assert.deepEqual([row.hitstun, row.blockstun, row.advantageHit, row.advantageBlock, row.damagePoints], [null, null, null, null, 0], `${row.id} has no strike data`);
      const data = M.moveInfo(E, row.move, row.variant);
      assert.equal(row.total, data.startup + data.active + data.recovery, `${row.id} total`);
      assert.equal(row.invulnerable, data.invulnerable || 0, `${row.id} invulnerable frames`);
      continue;
    }
    assert.equal(row.result, 'hit', `${row.id} connects at point blank`);
    assert.ok(row.damagePoints > 0 && row.damage > 0 && row.hits >= 1, `${row.id} deals damage`);
    assert.ok(isStun(row.hitstun), `${row.id} hitstun ${row.hitstun}`);
    if (row.kind !== 'sequence' && !row.id.startsWith('gc')) assert.ok(isStun(row.blockstun) || row.unblockable, `${row.id} blockstun ${row.blockstun}`);
    if (row.airborne) {
      assert.equal(row.advantageHit, null, `${row.id} air moves report no advantage`); assert.equal(row.advantageBlock, null, row.id);
      assert.ok(Number.isInteger(row.hitstun), `${row.id} air hitstun is a stun value`);
    } else {
      assert.ok(Number.isInteger(row.advantageHit) || row.advantageHit === 'KD' || row.advantageHit === 'launch', `${row.id} advantage on hit ${row.advantageHit}`);
      if (Number.isInteger(row.blockstun)) assert.ok(Number.isInteger(row.advantageBlock), `${row.id} advantage on block`);
    }
    assert.ok(typeof row.slide === 'number' && row.slideFrames >= 1, `${row.id} moves the defender`);
    assert.equal(typeof row.meterGain, 'number', `${row.id} meter gain`);
  }
  const sequence = rows.find(row => row.kind === 'sequence');
  if (sequence) { assert.equal(sequence.hitDamages.length, sequence.steps.length); assert.ok(sequence.hits >= 1); }
});

test('measured frame data agrees with the move tables the engine declares', () => {
  for (const row of allRows().filter(r => r.kind !== 'sequence' && r.measuredTiming)) {
    // The boss's super has its own data (two more beam hits, recovering two beam gaps later).
    const data = M.moveInfo(E, row.move, row.variant, row.boss), declared = data.startup + data.active + data.recovery;
    assert.equal(row.startup, data.startup, `${row.id} startup`);
    if (row.strikes) assert.equal(row.active, data.active, `${row.id} active`);
    // Moves that leave the ground end on landing, so only grounded moves must last exactly their declared frames.
    if (!row.airborneDuring || row.airborne) assert.equal(row.total, declared, `${row.id} total`);
    if (row.reach !== null && data.reach) assert.equal(row.reach, data.reach, `${row.id} reach`);
    assert.equal(row.contactFrame, row.startup, `${row.id} connects on its first active frame`);
    // With contact on the first active frame, advantage = stun - active - recovery.
    if (!row.airborne && Number.isInteger(row.hitstun) && row.hits === 1) assert.equal(row.advantageHit, row.hitstun - row.active - row.recovery, `${row.id} hit advantage`);
    if (!row.airborne && Number.isInteger(row.blockstun) && row.hits === 1) assert.equal(row.advantageBlock, row.blockstun - row.active - row.recovery, `${row.id} block advantage`);
  }
});

test('measureMove finds the same move from an engine move key or from its input', () => {
  const entry = M.discover(E).find(e => e.input === '2S');
  assert.ok(entry, 'Down + S starts a move');
  assert.deepEqual(M.measureMove(E, { move: entry.move, variant: entry.variant }), M.measureMove(E, { input: '2S' }));
  const standing = M.measureMove(E, { input: '5A', block: 'stand' });
  assert.equal(standing.blockedBy, 'stand');
  assert.equal(M.measureMove(E, { input: '5A', block: false }).blockstun, null);
  assert.throws(() => M.measureMove(E, { move: 'no-such-move' }), /No input/);
});

test('jumps, chains, launcher follow-ups, hit shape and pacing report their measurements', () => {
  const jump = M.jumps(E);
  assert.ok(jump.full.airtime > jump.hop.airtime && jump.hop.airtime > 0, 'A full jump lasts longer than a hop');
  assert.ok(jump.full.apex > jump.hop.apex && jump.full.apex > 0);
  assert.ok(Number.isInteger(jump.full.squat) && jump.full.squat >= 1);
  assert.equal(typeof jump.reverses, 'boolean'); assert.equal(typeof jump.superJump.isSuper, 'boolean');
  assert.equal(jump.committed, !jump.reverses && !jump.steers);
  for (const lag of [jump.landingLag.empty, jump.landingLag.attacked]) assert.ok(Number.isInteger(lag) && lag >= 0, `landing lag ${lag}`);
  const run = M.chain(E, ['5A', '5S', '5D', '236A']);
  assert.equal(run.steps.length, 4); assert.equal(run.steps[0].result, 'hit');
  assert.ok(run.hits >= 1 && run.damage > 0 && run.combo >= 1);
  for (const step of run.steps) assert.ok(['hit', 'block', 'whiff', 'not started'].includes(step.result), step.result);
  const guarded = M.chain(E, ['5A', '5S'], { block: true });
  assert.equal(guarded.hits, 0); assert.ok(guarded.blocks >= 1); assert.equal(guarded.damagePoints, 0);
  for (const route of ['jump', 'superjump']) {
    const follow = M.launcherFollowUp(E, { route });
    assert.equal(follow.launched, true, 'The crouching heavy launches');
    assert.ok(follow.victimAirtime > 0 && follow.victimApex > 0);
    assert.equal(follow.connects, follow.followUpHits > 0); assert.equal(follow.steps.length, 3);
    assert.ok(follow.damage > 0);
  }
  const shape = M.hitShape(E, { moves: ['5A'], heights: [0, 300], cases: [{ move: '5A', crouch: true }] });
  assert.equal(shape.rows[0].heights[0], true, 'A jab hits a grounded opponent');
  assert.equal(shape.rows[0].heights[300], false, 'Nothing reaches an opponent 300 units up');
  assert.equal(shape.rows[0].standing, true); assert.equal(typeof shape.cases[0].hit, 'boolean');
  const grounded = M.hitAt(E, { move: '5A', detail: true });
  assert.deepEqual(grounded, { hit: true, contact: 'hit', knockdown: false, landedStanding: true }, 'A grounded jab neither launches nor knocks down');
  assert.deepEqual(M.hitAt(E, { move: '5A', height: 300, detail: true }), { hit: false, contact: null, knockdown: false, landedStanding: null });
  const pacing = M.healthPacing(E);
  assert.ok(Number.isInteger(pacing.hitsToKill) && pacing.hitsToKill >= 1); assert.ok(pacing.firstHitDamage > 0);
  const neutral = M.neutralMeter(E, { seconds: 10 });
  assert.equal(neutral.end.length, 2); assert.ok(neutral.max >= 0);
});

test('cpuVsCpu is deterministic for a seed and reports per-CPU behaviour', () => {
  const first = M.cpuVsCpu(E, { seed: 3, seconds: 30 }), second = M.cpuVsCpu(E, { seed: 3, seconds: 30 });
  assert.deepEqual(first, second);
  assert.equal(first.slots.length, 2); assert.ok(first.fightFrames > 0 && first.fightFrames <= first.frames);
  for (const slot of first.slots) {
    for (const key of ['hits', 'blocks', 'strikesFaced', 'strikeBlocks', 'longestCombo', 'longestConfirm', 'throws', 'throwAttempts', 'specials', 'supers', 'whiffPunishes', 'antiAirs']) assert.ok(Number.isInteger(slot[key]) && slot[key] >= 0, key);
    assert.ok(slot.blockRate === null || (slot.blockRate >= 0 && slot.blockRate <= 1));
    assert.ok(slot.strikeBlocks <= slot.strikesFaced && slot.blocks >= slot.strikeBlocks && slot.longestConfirm <= slot.longestCombo);
  }
  assert.equal(first.totals.hits, first.slots[0].hits + first.slots[1].hits);
  assert.ok([0, 1, null].includes(first.winner));
  const levels = M.cpuVsCpu(E, { seed: 1, levels: [8, 1], seconds: 5 });
  assert.deepEqual(levels.levels, [8, 1]); assert.equal(typeof levels.perSlotLevels, 'boolean'); assert.equal(levels.levelsApplied.length, 2);
  const demo = M.cpuVsCpu(E, { seed: 1, match: true });
  assert.equal(demo.matchOver, true, 'A CPU-versus-CPU match finishes'); assert.ok(demo.rounds.length >= 1);
});

test('the CPU behaviour counters classify staged two-player scenarios', () => {
  // Both slots scripted; setup places them `gap` apart, inputs(state, frame) may also move a fighter.
  const scripted = (gap, inputs, arrange = () => {}, seconds = 2) => M.cpuVsCpu(E, { cpu: [false, false], seconds, inputs,
    setup: s => { const [a, d] = s.fighters; a.x = 400; d.x = 400 + gap; a.facing = 1; d.facing = -1; arrange(s); } }).slots;
  // A heavy punch whiffed from 160 units and jabbed from point blank during its recovery: one whiff punish.
  const punished = scripted(160, (s, t) => {
    const [a, d] = s.fighters;
    if (t === 0) return [{}, { heavy: true }];
    if (d.move === 'heavy' && d.moveFrame === E.MOVES.heavy.startup + E.MOVES.heavy.active + 2 && !a.move) { a.x = d.x - M.POINT_BLANK; return [{ punch: true }, {}]; }
  });
  assert.deepEqual([punished[0].hits, punished[0].whiffPunishes, punished[0].antiAirs, punished[1].strikesFaced], [1, 1, 0, 1]);
  // A jab on an opponent in the air, neither launched nor in hitstun: one anti-air.
  const antiAir = scripted(M.POINT_BLANK, (s, t) => [t === 0 ? { punch: true } : {}, {}], s => Object.assign(s.fighters[1], { y: 60, vy: 0 }));
  assert.deepEqual([antiAir[0].hits, antiAir[0].antiAirs, antiAir[0].whiffPunishes], [1, 1, 0]);
  // A fireball blocked from 300 units: a projectile block, not a strike block.
  const shot = M.inputFrames('236A');
  const blocked = scripted(300, (s, t) => [shot[t] || {}, { right: true }]);
  assert.deepEqual([blocked[1].projectilesFaced, blocked[1].projectileBlocks, blocked[1].strikesFaced, blocked[1].strikeBlocks, blocked[1].blocks, blocked[0].hits], [1, 1, 0, 0, 1, 0]);
  // A landed throw is a throw and a throw attempt, not a strike the defender faced.
  const thrown = scripted(70, (s, t) => [t === 0 ? { right: true, heavy: true } : {}, {}]);
  assert.deepEqual([thrown[0].throws, thrown[0].throwAttempts, thrown[0].hits, thrown[1].strikesFaced], [1, 1, 1, 0]);
  // A raw super is a six-hit combo but no confirm; jab > light kick > heavy punch > super confirms three hits first.
  const raw = scripted(M.POINT_BLANK, (s, t) => [t === 0 ? { special: true, heavy: true } : {}, {}], s => { s.fighters[0].stocks = 1; }, 3);
  assert.deepEqual([raw[0].longestCombo, raw[0].longestConfirm, raw[0].supers], [6, 0, 1]);
  assert.deepEqual([raw[0].projectileHits, raw[1].projectilesFaced, raw[1].strikesFaced], [6, 6, 0], 'Every beam hit, the first included, is a projectile hit');
  const steps = [{ punch: true }, { kick: true }, { heavy: true }, { special: true, heavy: true }];
  let next = 0;
  const confirmed = scripted(M.POINT_BLANK, (s, t) => {
    // Each step on the frame after the previous one hits.
    if (next < steps.length && (t === 0 || s.effects.some(e => e.life === e.maxLife && e.type === 'hit' && e.attacker === 0))) return [steps[next++], {}];
  }, s => { s.fighters[0].stocks = 1; }, 3);
  assert.deepEqual([confirmed[0].longestCombo, confirmed[0].longestConfirm, confirmed[0].supers], [9, 3, 1]);
});

// ---------------------------------------------------------------- phase 1: frame data, pushback slides, damage, meter and input
// The targets of gameplay-audit.md phase 1. Frames at 60 fps, advantage with contact on the first active frame,
// slide = the total distance the defender travels.
const PHASE1_NORMALS = [
  // input, move, variant, startup, active, recovery, hitstun, blockstun, on hit, on block, damage, reach, slide on hit, chain rank, cel
  ['5A', 'punch', 'standing', 4, 3, 7, 14, 11, 4, 1, 32, 100, 18, 0, 'punch'],
  ['5S', 'kick', 'standing', 5, 3, 9, 15, 12, 3, 0, 36, 118, 22, 1, 'lkick'],
  ['5D', 'heavy', 'standing', 8, 4, 15, 21, 15, 2, -4, 70, 138, 36, 2, 'hpunch'],
  ['6S', 'roundhouse', 'standing', 10, 4, 18, 22, 16, 0, -6, 82, 150, 46, 2, 'kick'],
  ['2A', 'punch', 'crouch', 4, 3, 8, 14, 12, 3, 1, 28, 94, 16, 0, 'cjab'],
  ['2S', 'kick', 'crouch', 9, 4, 20, 'KD', 14, 'KD', -10, 68, 150, null, 2, 'sweep'],
  ['2D', 'heavy', 'crouch', 7, 5, 23, 'launch', 16, 'launch', -12, 60, 118, null, 2, 'launcher'],
  ['j.A', 'punch', 'air', 5, 8, 5, 16, 12, null, null, 30, 102, 10, 0, 'airpunch'],
  ['j.S', 'kick', 'air', 6, 8, 6, 17, 13, null, null, 36, 136, 12, 1, 'airkick'],
  ['j.D', 'heavy', 'air', 7, 6, 7, 19, 14, null, null, 66, 124, 16, 2, 'airpunch'],
  ['S+D', 'blowback', 'standing', 13, 4, 22, 'KD', 22, 'KD', -4, 90, 132, null, 2, 'blowback']
];
// A slide is measured until the defender comes to rest; it stops below 0.05 units a frame, which leaves at most
// 0.05 / 0.18 = 0.28 units of the table distance untravelled.
const SLIDE_TOLERANCE = .3;
// Knockdowns and the launcher slide only on block: their old push values, 1.15x as far.
const BLOCK_ONLY_SLIDE = { '2S': 22, '2D': 20, 'S+D': 44 };
const close = (value, expected, tolerance = .011) => typeof value === 'number' && Math.abs(value - expected) <= tolerance;
const rowFor = input => allRows().find(row => row.input === input && !row.boss && row.style === 'balanced');
const busyUntil = (step, data) => step.startFrame + data.startup + data.active + data.recovery;
const PRESS = { A: 'punch', S: 'kick', D: 'heavy', F: 'special' };

test('phase 1: the frame-data table matches the normals table, measured advantages included', () => {
  for (const [input, move, variant, startup, active, recovery, hitstun, blockstun, onHit, onBlock, damage, reach, slide, rank, cel] of PHASE1_NORMALS) {
    const row = rowFor(input), data = M.moveInfo(E, row.move, row.variant);
    assert.deepEqual([row.move, row.variant], [move, variant], `${input} starts ${move}`);
    assert.deepEqual([row.startup, row.active, row.recovery], [startup, active, recovery], `${input} startup / active / recovery`);
    assert.deepEqual([row.hitstun, row.blockstun], [hitstun, blockstun], `${input} hitstun / blockstun`);
    assert.deepEqual([row.advantageHit, row.advantageBlock], [onHit, onBlock], `${input} advantage on hit / block`);
    assert.equal(row.damagePoints, damage, `${input} damage`); assert.equal(row.reach, reach, `${input} reach`);
    if (slide !== null) assert.ok(Math.abs(row.slide - slide) <= SLIDE_TOLERANCE, `${input} slides ${row.slide} on hit, table ${slide}`);
    // Blocked strikes slide 1.15x as far; knockdowns and the launcher slide (their old push) only on block.
    const blockSlide = (slide ?? BLOCK_ONLY_SLIDE[input]) * 1.15;
    assert.ok(Math.abs(row.slideBlock - blockSlide) <= SLIDE_TOLERANCE, `${input} slides ${row.slideBlock} on block, expected ${blockSlide}`);
    assert.equal(data.rank, rank, `${input} chain rank`); assert.equal(data.pose, cel, `${input} cel`);
  }
  assert.equal(rowFor('2S').blockedBy, 'crouch', 'The sweep is a low'); assert.equal(rowFor('5A').blockedBy, 'stand');
});

test('phase 1: specials, throws and supers deal their damage on the 1000-point life scale', () => {
  assert.equal(E.MAX_HP, 1000); assert.equal(M.maxLife(E), 1000);
  const table = { special: 60, fireball: 70, fastball: 50, doubleball: 50, skyshot: 60, rising: 100, rush: 95, armorRush: 120, rekka: 45, commandGrab: 160, gcBlowback: 60, throw: 120, super: 50 };
  for (const [move, damage] of Object.entries(table)) assert.equal(E.MOVES[move].damage, damage, move);
  assert.equal(E.MOVES.rekka.finish, 70, 'The third rhythm-rush hit'); assert.equal(E.MOVES.doubleball.projectile.count, 2); assert.equal(E.MOVES.super.hits, 6);
  // Measured with a balanced attacker and defender.
  const shot = rowFor('5F');
  assert.deepEqual([shot.startup, shot.damagePoints], [12, 60], 'The F shot comes out on frame 12 for 60');
  assert.equal(rowFor('236A').damagePoints, 70); assert.equal(rowFor('623A').damagePoints, 100); assert.equal(rowFor('214A').damagePoints, 95); assert.equal(rowFor('6D').damagePoints, 120);
  const superRow = allRows().find(row => row.id === 'super'), bossSuper = allRows().find(row => row.id === 'super:boss');
  // The first three hits are unscaled, then x0.82 a hit: 50, 50, 50, 41, 34, 28.
  assert.equal(superRow.hits, 6); assert.deepEqual(superRow.hitDamages, [50, 50, 50, 41, 34, 28], 'Super hits scale after the third');
  assert.equal(bossSuper.hits, 8, 'The boss adds two hits');
  // Projectiles slide 20 on hit and on block (only blocked strikes slide 1.15x as far); moves without a listed
  // slide keep their old push as the slide distance.
  assert.ok(Math.abs(shot.slide - 20) <= SLIDE_TOLERANCE, `projectile slide ${shot.slide}`);
  assert.ok(Math.abs(shot.slideBlock - 20) <= SLIDE_TOLERANCE, `blocked projectile slide ${shot.slideBlock}`);
  assert.equal(E.MOVES.rising.slide, 14); assert.equal(E.MOVES.rush.slide, 30);
  // The speed style's three-press rhythm rush: two 45s and the 70 finish, style-scaled (x0.92).
  assert.deepEqual(allRows().find(row => row.id === 'rekka:3').hitDamages, [41, 41, 64]);
});

test('phase 1: combo scaling is x0.82 per hit after the third, with a 0.30 floor for super hits', () => {
  assert.equal(E.comboScale(3), 1); assert.equal(E.comboScale(4), .82); assert.ok(close(E.comboScale(5), .6724, 1e-9));
  assert.equal(E.comboScale(30), .15); assert.equal(E.comboScale(30, true), .3);
  // Through the hit path: a super that lands as hit 10 or later of a combo deals the 0.30 floor, 15 per beam hit.
  const s = M.arena(E, { stocks: [1, 0] }), d = s.fighters[1], damages = [];
  for (let t = 0; t < 160; t++) {
    // Hold the victim in hitstun with a combo of nine already landed, as a long chain would.
    if (t === 0) Object.assign(d, { stun: 30, combo: 9 });
    E.tick(s, [t === 0 ? { special: true, heavy: true } : {}, {}]);
    for (const e of s.effects) if (e.life === e.maxLife && e.type === 'hit') damages.push(e.damage);
  }
  assert.deepEqual(damages, [15, 15, 15, 15, 15, 15], `late super hits deal ${damages}`);
});

test('phase 1: jab, jab, light kick, heavy punch and fireball chain at point blank for a fifth of a life bar', () => {
  const five = M.chain(E, ['5A', '5A', '5S', '5D', '236A']);
  assert.equal(five.allHit, true, five.steps.map(step => `${step.input} ${step.result}`).join(', ')); assert.equal(five.comboIntact, true); assert.equal(five.hits, 5);
  const four = M.chain(E, ['5A', '5S', '5D', '236A']);
  assert.equal(four.allHit, true); assert.equal(four.comboIntact, true);
  assert.ok(four.damage >= .18 && four.damage <= .25, `jab > light kick > heavy punch > fireball deals ${four.damage}`);
  // Chains cancel on block as well, and the roundhouse chains from the jab into a special.
  const guarded = M.chain(E, ['5A', '5S', '5D'], { block: true });
  assert.equal(guarded.blocks, 3); assert.equal(guarded.connected, true);
  const roundhouse = M.chain(E, ['5A', '6S', '236A']);
  assert.deepEqual(roundhouse.steps.map(step => step.move), ['punch', 'roundhouse', 'fireball']); assert.equal(roundhouse.comboIntact, true);
});

test('phase 1: 31 to 33 jabs empty a life bar and a jab slides the defender over several frames', () => {
  const pacing = M.healthPacing(E);
  assert.ok(pacing.hitsToKill >= 31 && pacing.hitsToKill <= 33, `${pacing.hitsToKill} jabs kill`);
  const jab = rowFor('5A');
  assert.ok(jab.slide >= 15 && jab.slide <= 21, `a jab hit slides ${jab.slide}`); assert.ok(jab.slideFrames > 5, `over ${jab.slideFrames} frames`);
});

test('phase 1: pushback slides decay x0.82 a frame, hold during hitstop, restart on a new hit and pass a wall to the attacker', () => {
  const start = E.MOVES.punch.slide * .18;
  const s = M.arena(E), defender = s.fighters[1], steps = [];
  for (let t = 0; t < 40; t++) { const x = defender.x, frozen = s.hitstop > 0; E.tick(s, [t ? {} : { punch: true }, {}]); steps.push({ dx: defender.x - x, frozen }); }
  const moving = steps.filter(step => Math.abs(step.dx) > 1e-9);
  assert.ok(steps.some(step => step.frozen) && steps.filter(step => step.frozen).every(step => step.dx === 0), 'Nothing slides during the impact freeze');
  assert.ok(close(moving[0].dx, start, 1e-9), `first slide frame ${moving[0].dx}`);
  for (let i = 1; i < 8; i++) assert.ok(close(moving[i].dx / moving[i - 1].dx, .82, 1e-9), `slide frame ${i} decays x0.82`);
  // A second jab replaces the slide: once its freeze ends the defender moves at the starting speed again.
  const again = M.arena(E), victim = again.fighters[1], afterSecond = [];
  let hits = 0, pressed = false;
  for (let t = 0; t < 60; t++) {
    // Frames from the one after the second contact on (the contact frame itself still plays the first slide).
    const x = victim.x, frozen = again.hitstop > 0, landed = hits, press = t === 0 || (hits === 1 && !pressed);
    if (press && t) pressed = true;
    E.tick(again, [press ? { punch: true } : {}, {}]);
    hits += again.effects.filter(e => e.life === e.maxLife && e.type === 'hit').length;
    if (landed === 2 && !frozen && Math.abs(victim.x - x) > 1e-9) afterSecond.push(victim.x - x);
  }
  assert.ok(afterSecond.length && close(afterSecond[0], start, 1e-9), 'The second hit restarts the slide');
  // Five units from the right wall the defender soon stops, so the grounded attacker is pushed back frame by frame.
  const wall = M.arena(E, { x: E.WIDTH - E.WALL - 75, distance: 70 }), [attacker, cornered] = wall.fighters, from = attacker.x, pushes = [];
  for (let t = 0; t < 40; t++) { const x = attacker.x; E.tick(wall, [t ? {} : { punch: true }, {}]); if (x - attacker.x > 1e-9) pushes.push(x - attacker.x); }
  assert.equal(cornered.x, E.WIDTH - E.WALL);
  assert.ok(pushes.length > 5, `the attacker is pushed back over ${pushes.length} frames`);
  assert.ok(Math.abs(from - attacker.x + 5 - E.MOVES.punch.slide) <= SLIDE_TOLERANCE, `the wall passes ${from - attacker.x} to the attacker`);
});

test('phase 1: meter only comes from fighting', () => {
  assert.equal(M.neutralMeter(E, { seconds: 60 }).max, 0, 'Sixty seconds of neutral build no meter');
  assert.equal(M.passiveRate(E), 0);
  // On hit the attacker gains 25% and the defender 20% of the damage dealt; on block 8% and 5% of the move's damage.
  for (const input of ['5A', '5D', '6S', '2S', 'j.D']) {
    const row = rowFor(input), base = M.moveInfo(E, row.move, row.variant).damage;
    assert.ok(close(row.meterGain, row.damagePoints * .25) && close(row.defenderMeterGain, row.damagePoints * .2), `${input} meter on hit ${row.meterGain} / ${row.defenderMeterGain}`);
    assert.ok(close(row.meterGainBlock, base * .08) && close(row.defenderMeterGainBlock, base * .05), `${input} meter on block ${row.meterGainBlock} / ${row.defenderMeterGainBlock}`);
  }
  // Starting a special adds 4.
  const shot = rowFor('5F');
  assert.ok(close(shot.meterGain, 4 + shot.damagePoints * .25), `F shot meter ${shot.meterGain}`);
  assert.ok(close(shot.meterGainBlock, 4 + E.MOVES.special.damage * .08), `blocked F shot meter ${shot.meterGainBlock}`);
});

test('phase 1: the earliest buffered press wins unless a stronger one follows within two frames, and chords are unchanged', () => {
  // Slot 0 whiffs a heavy punch far from its opponent and presses buttons during its last recovery frames; the
  // first free frame shows which press the buffer starts. presses: [frames before the free frame, buttons].
  const firstOut = (presses, stocks = 0) => {
    const s = M.arena(E, { distance: 600, stocks: [stocks, 0] }), f = s.fighters[0], heavy = E.MOVES.heavy;
    const free = heavy.startup + heavy.active + heavy.recovery + 1;
    for (let t = 1; t <= free; t++) {
      const input = t === 1 ? { heavy: true } : {};
      for (const [before, buttons] of presses) if (t === free - before) for (const letter of buttons.split('+')) input[PRESS[letter]] = true;
      E.tick(s, [input, {}]);
    }
    return f.moveFrame === 1 ? f.move : null;
  };
  assert.equal(firstOut([[4, 'A'], [1, 'S']]), 'punch', 'A, then S three frames later: the jab');
  assert.equal(firstOut([[4, 'S'], [1, 'A']]), 'kick', 'S, then A: the light kick');
  assert.equal(firstOut([[4, 'A'], [1, 'D']]), 'punch', 'A, then D three frames later: the jab');
  assert.equal(firstOut([[3, 'A'], [1, 'D']]), 'heavy', 'D within two frames of A: the stronger heavy punch');
  assert.equal(firstOut([[4, 'D'], [1, 'A']]), 'heavy', 'D, then A: the heavy punch');
  assert.equal(firstOut([[1, 'A+D']]), 'heavy', 'Simultaneous presses: the strongest');
  assert.equal(firstOut([[2, 'A'], [1, 'S']]), 'roll', 'A and S inside the chord window still roll');
  assert.equal(firstOut([[3, 'S'], [1, 'D']]), 'blowback', 'S and D inside the chord window still blow back');
  assert.equal(firstOut([[2, 'F'], [1, 'D']], 1), 'super', 'F and D with a stock are still the super');
  assert.equal(firstOut([[2, 'F'], [1, 'D']]), 'special', 'Without a stock, F then D fires the stronger F shot');
});

test('phase 1: presses made during hitstop keep their order, and a chord that cannot cancel falls back to its buttons', () => {
  // A point-blank jab connects on tick 3 and freezes ticks 4-8; presses: [tick, buttons]. Returns the moves slot 0
  // starts, in order, and the defender's combo count.
  const run = (presses, stocks = 0) => {
    const s = M.arena(E, { stocks: [stocks, 0] }), [a, d] = s.fighters, moves = [];
    let move = null, frame = 0, combo = 0;
    for (let t = 0; t < 80; t++) {
      const input = {};
      for (const [at, buttons] of presses) if (t === at) for (const letter of buttons.split('+')) input[PRESS[letter]] = true;
      E.tick(s, [input, {}]);
      if (a.move && (a.move !== move || a.moveFrame < frame)) moves.push(a.move);
      move = a.move; frame = a.moveFrame; combo = Math.max(combo, d.combo);
    }
    return { moves: moves.join(' > '), combo };
  };
  assert.deepEqual(run([[0, 'A'], [4, 'A'], [8, 'S']]), { moves: 'punch > punch > kick', combo: 3 }, 'A then S four frames apart in the freeze: the rapid jab, then the light kick');
  assert.deepEqual(run([[0, 'A'], [4, 'A'], [8, 'D']]), { moves: 'punch > punch > heavy', combo: 3 }, 'A then D four frames apart in the freeze: the jab first');
  assert.deepEqual(run([[0, 'A'], [4, 'S'], [8, 'D']]), { moves: 'punch > kick > heavy', combo: 3 }, 'S then D in the freeze: the light kick, then the heavy punch');
  assert.deepEqual(run([[0, 'A'], [4, 'A'], [9, 'S']]), { moves: 'punch > punch > kick', combo: 3 }, 'A in the freeze, S on the first free frame: no roll chord');
  assert.equal(run([[0, 'A'], [4, 'F'], [8, 'D']], 1).moves, 'punch > special', 'F then D four frames apart is not the super chord');
  assert.equal(run([[0, 'A'], [7, 'F'], [8, 'D']], 1).moves, 'punch > super', 'F and D a frame apart in the freeze are still the super');
  assert.equal(run([[0, 'A'], [5, 'A+S']]).moves, 'punch > kick', 'A roll chord cannot cancel, so the stronger of its buttons chains');
  // A fighter waiting out the 36-frame super freeze presses A on its frame 5 and D on its frame 20: the jab.
  const s = M.arena(E, { distance: 300, stocks: [0, 1] }), a = s.fighters[0];
  E.tick(s, [{}, { special: true, heavy: true }]);
  for (let t = 1; t <= 37 && !a.move; t++) E.tick(s, [t === 5 ? { punch: true } : t === 20 ? { heavy: true } : {}, {}]);
  assert.equal(a.move, 'punch', 'The earliest press of the freeze comes out first');
});

test('phase 1: rank-0 normals rapid-fire twice in a row, then only chain up-rank', () => {
  const jab = E.MOVES.punch, crouchJab = E.VARIANTS.crouch.punch;
  const jabs = M.chain(E, ['5A', '5A', '5A', '5A']);
  assert.deepEqual(jabs.steps.slice(0, 3).map(step => step.result), ['hit', 'hit', 'hit'], 'Jab, jab, jab is a chain'); assert.equal(jabs.combo, 3);
  assert.ok(jabs.steps[3].startFrame === null || jabs.steps[3].startFrame >= busyUntil(jabs.steps[2], jab), 'A fourth jab cannot cancel the third');
  const crouching = M.chain(E, ['2A', '2A', '2A', '2A'], { distance: 64 });
  assert.deepEqual(crouching.steps.slice(0, 3).map(step => step.result), ['hit', 'hit', 'hit'], 'Crouching jabs rapid-fire too');
  assert.ok(crouching.steps[3].startFrame === null || crouching.steps[3].startFrame >= busyUntil(crouching.steps[2], crouchJab), 'A fourth crouching jab cannot cancel');
  assert.equal(M.chain(E, ['5A', '5A', '5A', '5S']).allHit, true, 'After two rapid cancels a jab still chains into the light kick');
  assert.equal(M.chain(E, ['2A', '2A', '2S']).allHit, true, 'Crouching jab, crouching jab, sweep');
  assert.equal(M.chain(E, ['5A', '2A', '5A']).allHit, true, 'Standing and crouching jabs mix');
  // The light kick is rank 1: it does not rapid-fire into itself.
  const kicks = M.chain(E, ['5S', '5S']);
  assert.ok(kicks.steps[1].startFrame === null || kicks.steps[1].startFrame >= busyUntil(kicks.steps[0], E.MOVES.kick), 'A light kick does not cancel into a light kick');
});

test('phase 1: sweeps and blowbacks never cancel, and the launcher cancels only into specials and supers', () => {
  const notCancelled = (steps, options, why) => {
    const run = M.chain(E, steps, options), [first, second] = run.steps;
    assert.ok(first.result === 'hit' || first.result === 'block', `${steps[0]} connects`);
    assert.ok(second.startFrame === null || second.startFrame >= busyUntil(first, M.moveInfo(E, first.move, first.variant)), why);
  };
  notCancelled(['2S', '236A'], {}, 'A sweep never cancels on hit');
  notCancelled(['2S', '236A'], { block: true, crouch: true }, 'A sweep never cancels on block');
  notCancelled(['S+D', '236A'], {}, 'A blowback never cancels on hit');
  notCancelled(['S+D', '236A'], { block: true }, 'A blowback never cancels on block');
  notCancelled(['2D', '5D'], {}, 'The launcher does not cancel into a heavy punch');
  notCancelled(['2D', '5S'], {}, 'The launcher does not cancel into a light kick');
  notCancelled(['2D', '5D'], { block: true }, 'nor into a heavy punch on block');
  const launcher = E.VARIANTS.crouch.heavy, special = M.chain(E, ['2D', '236A']);
  assert.equal(special.allHit, true, 'The launcher cancels into a special'); assert.ok(special.steps[1].startFrame < busyUntil(special.steps[0], launcher));
  assert.equal(M.chain(E, ['2D', '236A'], { block: true }).connected, true, 'and does so on block');
  const superCancel = M.chain(E, ['2D', 'F+D'], { stocks: 1 });
  assert.equal(superCancel.steps[1].move, 'super'); assert.ok(superCancel.steps[1].startFrame < busyUntil(superCancel.steps[0], launcher), 'The launcher cancels into the super');
});

// ---------------------------------------------------------------- phase 1 review: links, guard, supers, motions, slides, symmetry, art
const freshOf = (s, type, attacker) => s.effects.filter(e => e.life === e.maxLife && e.type === type && (attacker === undefined || e.attacker === attacker));

test('phase 1: a defender holding back blocks every delayed second strike, and links count from the stun-end frame', () => {
  // The first strike is blocked; the second is pressed once, 1-24 frames later. The defender holds back (down-back
  // against the sweep) the whole time, so nothing may hit, including on the frame its blockstun runs out.
  const hold = input => M.parseInput(input).digits[0] <= 3 ? { down: true } : {};
  const holes = [];
  for (const first of ['5A', '2A', '5S', '6S', '5D', '2D', '2S']) for (const second of ['5A', '5S', '5D', '6S', '2A', '2S', '2D', 'S+D', '5F']) for (let delay = 1; delay <= 24; delay++) {
    const s = M.arena(E), low = first === '2S' || second === '2S', guard = M.dirInput(low ? 1 : 4, -1);
    let queue = M.inputFrames(first), blocked = 0;
    for (let t = 0; t < 120; t++) {
      if (t === delay) queue = M.inputFrames(second);
      E.tick(s, [queue.length ? queue.shift() : hold(t < delay ? first : second), guard]);
      blocked += freshOf(s, 'block', 0).length;
      if (freshOf(s, 'hit', 0).length) { holes.push(`${first} > ${second} at +${delay}`); break; }
    }
    assert.ok(blocked >= 1, `${first} is blocked`);
  }
  assert.deepEqual(holes, [], 'No strike hits a guarding defender');
  // A jab pressed on the first frame the attacker can act after a jab hit (+4) lands on the defender's stun-end frame:
  // a four-frame link that counts as a combo.
  const link = M.chain(E, ['5A', { input: '5A', timing: 'link' }]);
  assert.equal(link.allHit, true); assert.equal(link.combo, 2, 'The linked jab is the second hit of the combo');
  // The throw follows the same rule for either slot: never on the frame the opponent's blockstun runs out.
  for (const slot of [0, 1]) {
    const s = M.arena(E), attacker = s.fighters[slot], defender = s.fighters[1 - slot];
    if (slot) { attacker.x = 400; defender.x = 400 + M.POINT_BLANK; attacker.facing = 1; defender.facing = -1; }
    defender.blockStun = true; defender.stun = 1; defender.pose = 'block';
    const inputs = [{}, {}]; inputs[slot] = { right: true, heavy: true };
    E.tick(s, inputs);
    assert.equal(attacker.move, 'heavy', `slot ${slot}: forward + D on the opponent's last blockstun frame is a heavy punch, not a throw`);
  }
});

test('phase 1: a landed super ends in a knockdown, so nothing pressed after it continues the combo', () => {
  for (const [style, boss] of [['balanced', false], ['power', false], ['boss', true]]) for (const distance of [64, 80]) {
    const beam = E.moveData({ move: 'super', boss });
    for (const input of ['5A', '2A', '5S', '6S', '5D', '2S', '2D', 'S+D', '236A', '623A', 'F+D']) for (const delay of [0, 3, 6]) {
      const s = M.arena(E, { distance, styles: [style], boss: [boss], stocks: [3, 0] }), [a, d] = s.fighters;
      let queue = M.inputFrames('F+D'), free = null, superHits = 0, extra = 0, combo = 0;
      for (let t = 0; t < 260; t++) {
        // The attacker's first free frame after its super; its follow-up is pressed `delay` frames later.
        if (free === null && t > 0 && !a.move && !queue.length) free = t;
        if (free !== null && t === free + delay) queue = M.inputFrames(input);
        E.tick(s, [queue.length ? queue.shift() : {}, {}]);
        const hits = freshOf(s, 'hit', 0).length;
        if (free === null || t < free + delay) superHits += hits; else extra += hits;
        combo = Math.max(combo, d.combo);
        if (free !== null && t >= free + delay && !d.stun && !d.launched && d.y === 0) break;
      }
      assert.equal(superHits, beam.hits, `${style} super lands all ${beam.hits} hits at ${distance}`);
      assert.equal(extra, 0, `${style} super at ${distance}, then ${input} ${delay} frames after it ends: nothing hits before the victim stands`);
      assert.ok(combo <= beam.hits, `${style}: the combo stops at the super (${combo})`);
    }
  }
  // The boss's super lasts until its eighth beam hit has landed.
  const boss = E.moveData({ move: 'super', boss: true });
  assert.deepEqual([boss.hits, boss.recovery], [E.MOVES.super.hits + 2, E.MOVES.super.recovery + 10]);
});

test('phase 1: a stale crouch does not turn toward + S or toward + D into the 236 motion', () => {
  const D = { 1: { down: true, left: true }, 2: { down: true }, 3: { down: true, right: true }, 5: {}, 6: { right: true } };
  // script: [held input, frames]; returns the moves slot 0 starts and the defender's best combo.
  const run = (script, distance = 400) => {
    const s = M.arena(E, { distance }), [a, d] = s.fighters, moves = [];
    let move = null, frame = 0, combo = 0;
    for (const [input, frames] of script) for (let i = 0; i < frames; i++) {
      E.tick(s, [input, {}]);
      if (a.move && (a.move !== move || a.moveFrame < frame)) moves.push(a.move);
      move = a.move; frame = a.moveFrame; combo = Math.max(combo, d.combo);
    }
    return { moves: moves.join(' > '), combo };
  };
  const motion = (digits, button) => run([...digits.map(digit => [D[digit], 1]), [{ ...D[digits[digits.length - 1]], [button]: true }, 1], [{}, 2]]).moves;
  // Deliberate motions still fire, including keyboard rolls that pass through neutral.
  for (const digits of [[2, 6], [2, 3, 6], [2, 5, 6], [2, 2, 5, 5, 6], [2, 5, 5, 5, 6, 6]]) for (const button of ['punch', 'kick']) assert.equal(motion(digits, button), 'fireball', `${digits.join(',')} + ${button}`);
  // Crouch, stand for five frames, then toward + S: the roundhouse; next to the opponent toward + D throws.
  assert.equal(run([[D[2], 5], [D[5], 5], [D[6], 2], [{ ...D[6], kick: true }, 1], [D[6], 3]]).moves, 'roundhouse');
  assert.equal(run([[D[2], 5], [D[5], 5], [D[6], 2], [{ ...D[6], heavy: true }, 1], [D[6], 3]], 70).moves, 'throw');
  // Crouch-blocking, then walking forward for eight frames (rolling through 2 and 3) and poking: the roundhouse.
  // Inside the 6-frame button window the same roll is a deliberate 236 + S, as in Capcom games.
  assert.equal(run([[D[1], 10], [D[2], 1], [D[3], 1], [D[6], 8], [{ ...D[6], kick: true }, 1], [D[6], 3]]).moves, 'roundhouse');
  assert.equal(run([[D[1], 10], [D[2], 1], [D[3], 1], [D[6], 4], [{ ...D[6], kick: true }, 1], [D[6], 3]]).moves, 'fireball');
  // 2A > 6S is a chain once the stick rests in neutral or holds toward before S.
  assert.deepEqual(run([[{ ...D[2], punch: true }, 1], [D[2], 2], [D[5], 5], [{ ...D[6], kick: true }, 1], [D[6], 40]], 70), { moves: 'punch > roundhouse', combo: 2 });
  assert.deepEqual(run([[{ ...D[2], punch: true }, 1], [D[2], 2], [D[6], 7], [{ ...D[6], kick: true }, 1], [D[6], 40]], 70), { moves: 'punch > roundhouse', combo: 2 });
  // A crouching normal still cancels into the motion rolled from its held down (2, 3, 6).
  assert.deepEqual(run([[{ ...D[2], heavy: true }, 1], [D[2], 6], [D[3], 1], [{ ...D[6], punch: true }, 1], [{}, 40]], 70), { moves: 'heavy > fireball', combo: 2 });
  assert.equal(M.chain(E, ['2A', '236A']).allHit, true, 'Crouching jab, then the fireball');
});

test('phase 1: a guard cancel stops the pushback slide, so the guard-cancel blowback and roll reach as before', () => {
  // Slot 0 presses the strike at `gap`; slot 1 holds back with a stock and presses the chord on the first frame
  // after the block, in the guard freeze.
  const guardCancel = (strike, gap, chord) => {
    const s = M.arena(E, { distance: gap, x: 600, stocks: [0, 1] }), [a, d] = s.fighters;
    let queue = M.inputFrames(strike), blockedAt = null;
    for (let t = 0; t < 200; t++) {
      const dIn = blockedAt === null ? M.dirInput(4, -1) : t === blockedAt + 1 ? chord : {};
      E.tick(s, [queue.length ? queue.shift() : {}, dIn]);
      if (blockedAt === null && freshOf(s, 'block', 0).length) blockedAt = t;
    }
    return { hit: a.hp < E.MAX_HP, crossed: d.x < a.x, move: d.move };
  };
  for (const gap of [80, 100]) assert.equal(guardCancel('5D', gap, { kick: true, heavy: true }).hit, true, `The guard-cancel blowback hits after a blocked heavy at ${gap}`);
  assert.equal(guardCancel('6S', 100, { kick: true, heavy: true }).hit, true, 'and after a blocked roundhouse at 100');
  assert.equal(guardCancel('5D', 80, { punch: true, kick: true }).crossed, true, 'The forward guard-cancel roll crosses after a blocked heavy at 80');
});

test('phase 1: either slot gets the same result from the same situation', () => {
  // The attacker stands on the left facing right in slot 0 or in slot 1; the other fighter holds back.
  const mirror = (attackerSlot, script, { gap = 80, x = 400, styles = [], frames = 120 } = {}) => {
    const s = E.create(['p1', 'p2'], { cpu: false, profiles: { p1: { style: styles[attackerSlot ? 1 : 0] }, p2: { style: styles[attackerSlot ? 0 : 1] } } });
    s.phase = 'fight'; s.message = '';
    const a = s.fighters[attackerSlot], d = s.fighters[1 - attackerSlot];
    a.x = x; d.x = x + gap; a.facing = 1; d.facing = -1;
    const log = [];
    for (let t = 0; t < frames; t++) {
      const inputs = [{}, {}]; inputs[attackerSlot] = script[t] || {}; inputs[1 - attackerSlot] = { right: true };
      E.tick(s, inputs);
      for (const e of s.effects) if (e.life === e.maxLife && (e.type === 'hit' || e.type === 'block')) log.push(`${t}:${e.type}`);
      for (const p of s.projectiles) if (p.owner === attackerSlot && p.life === (E.MOVES.fireball.projectile.life - 1)) log.push(`${t}:shot@${p.x.toFixed(3)}`);
    }
    return { hp: d.hp, gap: +(d.x - a.x).toFixed(6), log: log.join(' ') };
  };
  // A blocked jab cancelled into the grappler's command grab, from 64 to 100 units: the same grab connects or
  // whiffs. (Throws still resolve inside the attacker's update, so a thrown fighter in slot 1 starts falling one
  // frame sooner; only life and contact timing are compared here.)
  const grabbed = (slot, gap) => { const { hp, log } = mirror(slot, [{ punch: true }, {}, {}, {}, { down: true }, { down: true, left: true }, { left: true, punch: true }], { gap, styles: ['grappler'] }); return { hp, log }; };
  for (let gap = 64; gap <= 100; gap += 2) assert.deepEqual(grabbed(1, gap), grabbed(0, gap), `command grab at ${gap}`);
  // A cornered, blocked jab > light kick > heavy punch > fireball.
  const string = [{ punch: true }, {}, {}, {}, { kick: true }, {}, {}, {}, {}, {}, {}, {}, {}, { heavy: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { down: true }, { down: true, right: true }, { right: true, punch: true }];
  for (const gap of [64, 72, 80, 90]) assert.deepEqual(mirror(1, string, { gap, x: E.WIDTH - E.WALL - gap }), mirror(0, string, { gap, x: E.WIDTH - E.WALL - gap }), `cornered string at ${gap}`);
});

test('phase 1: art-measured reaches only lengthen a move, so the chain targets hold for an installed cast', t => {
  // Art shorter than the table keeps the table reach; longer art adds up to 25%.
  const heavy = E.MOVES.heavy, painted = reach => ({ reaches: { [heavy.pose]: reach } });
  assert.equal(E.reachOf(painted(100), heavy), heavy.reach); assert.equal(E.reachOf(painted(heavy.reach + 20), heavy), heavy.reach + 10);
  assert.equal(E.reachOf(painted(400), heavy), Math.round(heavy.reach * 1.25));
  const file = path.join(root, 'output', 'games', 'midterm-2026', 'assets', 'manifest.json');
  if (!fs.existsSync(file)) return t.skip('Midterm Mayhem is not installed');
  for (const fighter of JSON.parse(fs.readFileSync(file, 'utf8')).fighters) {
    const reaches = E.artReaches(fighter.poses), options = { reaches: [reaches, reaches] };
    for (const move of [E.MOVES.punch, E.MOVES.kick, heavy, E.MOVES.roundhouse, ...Object.values(E.VARIANTS.crouch)]) assert.ok(E.reachOf({ reaches }, move) >= move.reach, `${fighter.id} ${move.pose}`);
    const five = M.chain(E, ['5A', '5A', '5S', '5D', '236A'], options), four = M.chain(E, ['5A', '5S', '5D', '236A'], options);
    assert.equal(five.allHit && five.comboIntact, true, `${fighter.id}: ${five.steps.map(step => step.result).join(', ')}`);
    assert.equal(four.allHit && four.comboIntact, true, fighter.id); assert.ok(four.damage >= .18 && four.damage <= .25, `${fighter.id} ${four.damage}`);
    assert.equal(M.chain(E, ['5A', '5A', '5A'], options).combo, 3, `${fighter.id} jab, jab, jab`);
    assert.equal(M.chain(E, ['5A', '5S', '5D'], { ...options, block: true }).blocks, 3, `${fighter.id} blocked chain`);
  }
});
