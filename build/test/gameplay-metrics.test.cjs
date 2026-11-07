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
  for (const section of ['== OURS normals', '== jumps', '== projectile jumps', '== launcher follow-up', '== chains', '== health pacing', '== CPU vs CPU', '== vertical hit shape']) assert.ok(probe.stdout.includes(section), section);
  assert.match(probe.stdout, /dad-fighter-z engine not found/);
  assert.doesNotMatch(probe.stdout, /^DFZ /m, 'No reference rows without the reference engine');
  const json = tool('gameplay-probe.cjs', ['--json'], { DFZ_REPO: nowhere });
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.reference, false); assert.equal(report.cpu.length, 3); assert.ok(report.normals.length >= 9);
  // Every style, both shots, every jump kind and the three distances.
  assert.equal(report.projectileJumps.length, Object.keys(E.STYLES).length * 2 * M.JUMP_KINDS.length * 3);
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
  // Phase 4: on hit the launcher floats its victim above every shot and the super beam, so it refuses those cancels
  // there (they could only whiff); a cancelled rising strike juggles the victim. On block the shot and super cancel.
  const launcher = E.VARIANTS.crouch.heavy, special = M.chain(E, ['2D', '236A'], { block: true }), rising = M.chain(E, ['2D', '623A']);
  assert.equal(special.steps[1].move, 'fireball'); assert.ok(special.steps[1].startFrame < busyUntil(special.steps[0], launcher), 'The blocked launcher cancels into a special');
  assert.equal(rising.allHit, true, 'A rising strike cancelled from the launcher juggles its victim'); assert.ok(rising.steps[1].startFrame < busyUntil(rising.steps[0], launcher));
  assert.equal(special.connected, true, 'and the cancelled shot connects on block');
  const superCancel = M.chain(E, ['2D', 'F+D'], { stocks: 1, block: true });
  assert.equal(superCancel.steps[1].move, 'super'); assert.ok(superCancel.steps[1].startFrame < busyUntil(superCancel.steps[0], launcher), 'The blocked launcher cancels into the super');
  const refused = M.chain(E, ['2D', '236A']);
  assert.ok(refused.steps[1].startFrame === null || refused.steps[1].startFrame >= busyUntil(refused.steps[0], launcher), 'A launcher that hit refuses the shot cancel');
});

// ---------------------------------------------------------------- phase 1 review: links, guard, supers, motions, slides, symmetry, art
const freshOf = (s, type, attacker) => s.effects.filter(e => e.life === e.maxLife && e.type === type && (attacker === undefined || e.attacker === attacker));

test('phase 1: a defender holding back blocks every delayed second strike, and links count from the stun-end frame', () => {
  // The first strike is blocked; the second is pressed once, 1-24 frames later. The defender holds back (down-back
  // against the sweep) throughout, so nothing may hit, including on the frame its blockstun runs out. A roundhouse passes
  // over a crouching guard (phase 2), so against 6S > 2S the defender guards standing until it has blocked the roundhouse.
  const hold = input => M.parseInput(input).digits[0] <= 3 ? { down: true } : {};
  const holes = [];
  for (const first of ['5A', '2A', '5S', '6S', '5D', '2D', '2S']) for (const second of ['5A', '5S', '5D', '6S', '2A', '2S', '2D', 'S+D', '5F']) for (let delay = 1; delay <= 24; delay++) {
    const s = M.arena(E), low = first === '2S' || second === '2S';
    let queue = M.inputFrames(first), blocked = 0;
    for (let t = 0; t < 120; t++) {
      if (t === delay) queue = M.inputFrames(second);
      const guard = M.dirInput(low && (first !== '6S' || blocked > 0) ? 1 : 4, -1);
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
  // A crouching normal still cancels into the motion rolled from its held down (2, 3, 6). Phase 4: the launcher's victim
  // floats above the fireball, so a launcher that hit refuses the shot cancel; the crouching jab's fireball connects.
  assert.deepEqual(run([[{ ...D[2], heavy: true }, 1], [D[2], 6], [D[3], 1], [{ ...D[6], punch: true }, 1], [{}, 40]], 70), { moves: 'heavy', combo: 1 });
  assert.deepEqual(run([[{ ...D[2], punch: true }, 1], [D[2], 2], [D[3], 1], [{ ...D[6], punch: true }, 1], [{}, 40]], 70), { moves: 'punch > fireball', combo: 2 });
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

// ---------------------------------------------------------------- phase 2: hit and hurt boxes
// The targets of gameplay-audit.md phase 2. Boxes are [x, y-above-ground, width, height], as E.boxes returns them.
const PHASE2_BANDS = {
  punch: [110, 175], kick: [60, 140], heavy: [120, 195], roundhouse: [150, 215], 'crouch.punch': [55, 110], 'crouch.kick': [0, 38],
  'crouch.heavy': [90, 250], blowback: [90, 190], gcBlowback: [90, 190], rush: [50, 190], armorRush: [50, 190], rekka: [50, 190],
  rising: [60, 260], 'air.punch': [60, 150], 'air.kick': [0, 100], 'air.heavy': [20, 130]
};
const sameBox = (box, expected) => Array.isArray(box) && box.length === 4 && box.every((value, i) => Math.abs(value - expected[i]) < 1e-9);

test('phase 2: every strike carries its height band, and only throws and command grabs reach without one', () => {
  for (const [key, band] of Object.entries(PHASE2_BANDS)) {
    const [variant, move] = key.includes('.') ? key.split('.') : [null, key];
    assert.deepEqual((variant ? E.VARIANTS[variant][move] : E.MOVES[move]).band, band, key);
  }
  for (const [name, move] of Object.entries(E.MOVES)) if (move.reach) assert.equal(!!move.band, !(name === 'throw' || move.grab), `${name} band`);
  for (const [variant, moves] of Object.entries(E.VARIANTS)) for (const [name, move] of Object.entries(moves)) assert.ok(move.band, `${variant} ${name} band`);
});

test('phase 2: hurtboxes follow the posture, and a strike box runs from 20 units in front of the centre to the reach less 37', () => {
  // Standing 74 x 225 and crouching 80 x 140, centred on the fighter.
  const s = M.arena(E), [a] = s.fighters;
  assert.deepEqual(E.boxes(a), { hurt: [a.x - 37, 0, 74, 225], hit: null, limb: null, hittable: true });
  E.tick(s, [{ down: true }, {}]); assert.deepEqual(E.boxes(a).hurt, [a.x - 40, 0, 80, 140], 'crouching');
  // A crouching attack keeps the crouch box when down is let go; a standing one keeps the standing box when down is held.
  const low = M.arena(E, { distance: 600 }), [c] = low.fighters;
  E.tick(low, [{ down: true, punch: true }, {}]); E.tick(low, [{}, {}]);
  assert.deepEqual([c.move, c.moveVariant, E.boxes(c).hurt], ['punch', 'crouch', [c.x - 40, 0, 80, 140]], 'in a crouching attack');
  const high = M.arena(E, { distance: 600 }), [h] = high.fighters;
  E.tick(high, [{ heavy: true }, {}]); E.tick(high, [{ down: true }, {}]);
  assert.deepEqual([h.move, h.crouching, E.boxes(h).hurt], ['heavy', true, [h.x - 37, 0, 74, 225]], 'in a standing attack');
  // Crouch-blocking keeps the crouch box through the blockstun.
  const guard = M.arena(E), g = guard.fighters[1];
  for (let t = 0; t < 8; t++) E.tick(guard, [t ? {} : { down: true, punch: true }, M.dirInput(1, -1)]);
  assert.ok(g.blockStun && g.stun > 0, 'The crouching jab is blocked low'); assert.deepEqual(E.boxes(g).hurt, [g.x - 40, 0, 80, 140], 'crouch-blocking');
  // Jumping (phase 3): 70 x 150 from 30 above the feet, legs tucked.
  const jump = M.arena(E, { distance: 600 }), [j] = jump.fighters;
  for (let t = 0; t < 10; t++) E.tick(jump, [{ jump: true }, {}]);
  assert.ok(j.y > 0); assert.deepEqual(E.boxes(j).hurt, [j.x - 35, j.y + 30, 70, 150], 'jumping');
  // Launched: 110 x 130 from 20 above the feet; lying down after the knockdown there is no hurtbox at all.
  const launch = M.arena(E), v = launch.fighters[1];
  for (let t = 0; t < 12; t++) E.tick(launch, [t ? {} : { down: true, heavy: true }, {}]);
  assert.ok(v.launched && v.y > 0); assert.deepEqual(E.boxes(v).hurt, [v.x - 55, v.y + 20, 110, 130], 'launched');
  for (let t = 0; t < 120 && v.y > 0; t++) E.tick(launch, [{}, {}]);
  assert.ok(v.launched && v.y === 0 && v.stun > 0, 'The victim lies down'); assert.equal(E.boxes(v).hurt, null, 'knocked down');
  // Jabs 600 apart, facing each other: the strike box covers 20 to reach - 37 units in front at 110-175 during the active
  // frames, and the limb, its inner 60 %, stays out from the first active frame until the move ends.
  const jab = E.MOVES.punch, far = jab.reach - 37, both = M.arena(E, { distance: 600 }), [p, q] = both.fighters, seen = [];
  for (let t = 0; t < 16; t++) { E.tick(both, [t ? {} : { punch: true }, t ? {} : { punch: true }]); seen.push({ frame: p.moveFrame, move: p.move, own: E.boxes(p), mirror: E.boxes(q) }); }
  for (const { frame, move, own, mirror } of seen) {
    const active = !!move && frame >= jab.startup && frame < jab.startup + jab.active, out = !!move && frame >= jab.startup, w = far - 20;
    assert.ok(active ? sameBox(own.hit, [p.x + 20, 110, w, 65]) : own.hit === null, `jab frame ${frame}: strike box ${own.hit}`);
    assert.ok(out ? sameBox(own.limb, [p.x + 20, 110, w * .6, 65]) : own.limb === null, `jab frame ${frame}: limb ${own.limb}`);
    assert.ok(active ? sameBox(mirror.hit, [q.x - far, 110, w, 65]) : mirror.hit === null, `mirrored jab frame ${frame}: strike box ${mirror.hit}`);
    assert.ok(out ? sameBox(mirror.limb, [q.x - 20 - w * .6, 110, w * .6, 65]) : mirror.limb === null, `mirrored jab frame ${frame}: limb ${mirror.limb}`);
  }
  assert.ok(seen.some(e => e.move === null), 'The jab ends inside the window');
  // Painted art lengthens the box with the reach; a throw shows its range to the opponent's centre.
  const art = M.arena(E, { distance: 600, reaches: [{ punch: 140 }] }), [r] = art.fighters;
  for (let t = 0; t < jab.startup; t++) E.tick(art, [t ? {} : { punch: true }, {}]);
  assert.ok(sameBox(E.boxes(r).hit, [r.x + 20, 110, E.reachOf(r, jab) - 57, 65]), `art reach ${E.boxes(r).hit}`);
  const toss = M.arena(E, { distance: 70 }), [t0] = toss.fighters;
  for (let t = 0; t < E.MOVES.throw.startup; t++) E.tick(toss, [t ? {} : { right: true, heavy: true }, {}]);
  assert.deepEqual([t0.move, E.boxes(t0).hit, E.boxes(t0).limb], ['throw', [t0.x, 100, E.MOVES.throw.reach, 70], null]);
});

test('phase 2: the roundhouse whiffs over a crouching opponent and hits a standing one, and a jab still hits a croucher', () => {
  assert.equal(M.hitAt(E, { move: '6S', crouch: true }), false, 'The roundhouse passes over a croucher');
  assert.equal(M.hitAt(E, { move: '6S' }), true, 'and hits a standing opponent');
  assert.equal(M.hitAt(E, { move: '5A', crouch: true }), true, 'A jab still hits a croucher');
  for (const move of ['5S', '5D', '2A', '2S', '2D', 'S+D']) assert.equal(M.hitAt(E, { move, crouch: true }), true, `${move} hits a croucher`);
});

test('phase 2: a jump clears a sweep once its feet are above 8, and a launcher hits a jumper whose feet are at 135', () => {
  // The sweep reaches 38 above the floor and phase 3 tucks the jump box 30 above the feet, so feet above 8 clear it.
  for (const height of [1, 5, 7.9]) assert.equal(M.hitAt(E, { move: '2S', height }), true, `The sweep hits feet at ${height}`);
  for (const height of [8.1, 10, 30, 37.9, 45, 60, 89]) assert.equal(M.hitAt(E, { move: '2S', height }), false, `Feet at ${height} clear the sweep`);
  assert.equal(M.hitAt(E, { move: '2D', height: 135 }), true, 'The launcher hits a jumper whose feet are at 135');
});

test('phase 2: an air kick hits a standing opponent from height 150 but not from 240', () => {
  assert.equal(M.hitAt(E, { move: 'j.S', attackerHeight: 150 }), true, 'from 150');
  assert.equal(M.hitAt(E, { move: 'j.S', attackerHeight: 240 }), false, 'from 240');
});

test("phase 2: a heavy punch that cannot reach the body hits a whiffed roundhouse's extended leg during its recovery", () => {
  // Slot 1 presses toward + S 170 units away (its step forward leaves 165) and whiffs; slot 0 presses D 12 frames later.
  const round = E.MOVES.roundhouse, heavy = E.MOVES.heavy, s = M.arena(E, { distance: 170 }), [a, d] = s.fighters;
  let contact = null;
  for (let t = 0; t < 60 && !contact; t++) {
    const before = { move: d.move, moveFrame: d.moveFrame, gap: d.x - a.x };
    E.tick(s, [t === 12 ? { heavy: true } : {}, t === 0 ? { left: true, kick: true } : {}]);
    const hits = freshOf(s, 'hit');
    if (hits.length) contact = { ...before, attackers: hits.map(e => e.attacker) };
  }
  assert.ok(contact, 'The heavy punch connects');
  assert.deepEqual(contact.attackers, [0], 'Only the heavy punch hits: the roundhouse whiffed');
  const frame = contact.moveFrame + 1;
  assert.ok(contact.move === 'roundhouse' && frame >= round.startup + round.active && frame < round.startup + round.active + round.recovery, `It lands on the roundhouse's recovery frame ${frame}`);
  assert.ok(contact.gap >= E.reachOf(a, heavy), `The body is ${contact.gap} away, beyond the heavy punch's reach`);
  assert.equal(M.hitAt(E, { move: '5D', distance: 165 }), false, 'The same heavy punch whiffs an idle opponent there');
  assert.equal(d.hp, E.MAX_HP - heavy.damage, 'A full-damage hit on the leg, not a counter hit');
  // Two roundhouses out of reach of each other's bodies trade leg to leg on the same frame.
  const trade = M.arena(E, { distance: 170 }), [p, q] = trade.fighters;
  let both = [], gap = null;
  for (let t = 0; t < 40 && !both.length; t++) {
    gap = q.x - p.x;
    E.tick(trade, [t ? {} : { right: true, kick: true }, t ? {} : { left: true, kick: true }]);
    both = freshOf(trade, 'hit').map(e => e.attacker).sort();
  }
  assert.deepEqual(both, [0, 1], 'Both roundhouses connect on the same frame'); assert.ok(gap > round.reach, `${gap} apart`);
  assert.deepEqual([p.hp, q.hp], [E.MAX_HP - round.damage, E.MAX_HP - round.damage]);
});

test('phase 2: projectiles hit crouchers and pass under a jumper whose feet are above 95', () => {
  // Shots fly 85-125 above the floor and phase 3 tucks the jump box 30 above the feet, so feet above 95 pass over them.
  for (const move of ['5F', '236A']) {
    assert.equal(M.hitAt(E, { move, crouch: true }), true, `${move} hits a croucher at point blank`);
    assert.equal(M.hitAt(E, { move, crouch: true, distance: 300 }), true, `${move} hits a croucher from 300`);
    assert.equal(M.hitAt(E, { move, height: 94, distance: 300 }), true, `${move} hits a jumper whose feet are at 94`);
    assert.equal(M.hitAt(E, { move, height: 96, distance: 300 }), false, `${move} passes under a jumper whose feet are at 96`);
  }
  // Projectiles are 50 x 40 boxes centred on their position and the super beam 70 x 60 (75-135), so the beam passes under feet above 105.
  assert.deepEqual(E.projectileBox({ x: 300, y: 105 }), [275, 85, 50, 40]); assert.deepEqual(E.projectileBox({ x: 300, y: 105, super: true }), [265, 75, 70, 60]);
  assert.equal(M.hitAt(E, { move: 'F+D', height: 104, distance: 300, window: 120 }), true, 'The beam hits a jumper whose feet are at 104');
  assert.equal(M.hitAt(E, { move: 'F+D', height: 106, distance: 300, window: 120 }), false, 'and passes under one at 106');
});

test("phase 2: a strike box only hits a target whose centre is in front of the attacker's", () => {
  // A launcher's first active frame against a jumper held 150 up, 10 units in front of or behind the attacker: the
  // boxes overlap either way, but a target that has crossed behind the attacker is not hit by its forward strike.
  const launches = offset => {
    const s = M.arena(E), [a, d] = s.fighters, launcher = E.VARIANTS.crouch.heavy;
    Object.assign(a, { move: 'heavy', moveVariant: 'crouch', moveFrame: launcher.startup - 1 });
    Object.assign(d, { x: a.x + offset, y: 150, vy: 0 });
    E.tick(s, [{ down: true }, {}]);
    return freshOf(s, 'hit', 0).length > 0;
  };
  assert.equal(launches(10), true, 'In front'); assert.equal(launches(-10), false, 'Behind');
});

test('phase 2: hitstun keeps the posture the hit found, while blockstun follows the stick', () => {
  // A defender that ducks (or crouch-guards) once it is hit cannot crouch out of a chain into the roundhouse...
  for (const afterHit of [2, 1]) for (const steps of [['5A', '6S'], ['5A', '5S', '6S'], ['5A', '6S', '236A'], ['5A', '5A', '5A', '5S', '6S', '214A']]) {
    const run = M.chain(E, steps, { afterHit });
    assert.equal(run.allHit && run.comboIntact, true, `${steps.join(' > ')}, ${afterHit} held after the first hit: ${run.steps.map(step => step.result).join(', ')}`);
  }
  // ...and one hit crouching does not stand into it by letting go of down: the roundhouse still passes over.
  for (const steps of [['5A', '6S'], ['5A', '5S', '6S']]) {
    const run = M.chain(E, steps, { crouch: true, afterHit: 5 });
    assert.deepEqual(run.steps.map(step => step.result), [...steps.slice(1).map(() => 'hit'), 'whiff'], `${steps.join(' > ')} against a crouch-hit defender that lets go`);
  }
  // Frame by frame: slot 1 holds `before` until slot 0's jab hits it, then `after`. Through its hitstun, the frame the
  // stun runs out included (it cannot act yet), it keeps the posture of the hit; on its first free frame it takes the new one.
  const reel = (before, after) => {
    const s = M.arena(E), d = s.fighters[1], frames = [];
    let hit = false;
    for (let t = 0; t < 60; t++) {
      const free = hit && M.canAct(E, s, 1, [{}, after]), motion = s.motionFrame;
      E.tick(s, [t ? {} : { punch: true }, hit ? after : before]);
      if (hit && s.motionFrame > motion) frames.push({ free, height: E.boxes(d).hurt[3] });
      if (freshOf(s, 'hit', 0).length) hit = true;
    }
    const firstFree = frames.findIndex(frame => frame.free);
    return { reeling: [...new Set(frames.slice(0, firstFree).map(frame => frame.height))], free: frames[firstFree]?.height, frames: firstFree };
  };
  const ducked = reel({}, { down: true }), stood = reel({ down: true }, {});
  assert.ok(ducked.frames >= E.MOVES.punch.hitStun, `${ducked.frames} reeling frames`);
  assert.deepEqual([ducked.reeling, ducked.free], [[225], 140], 'Hit standing, then holding down: standing until free');
  assert.deepEqual([stood.reeling, stood.free], [[140], 225], 'Hit crouching, then letting go: crouching until free');
  // Blockstun follows the stick, so a guard can switch height: a jab blocked crouching, then back alone and down-back
  // again on alternate frames of the blockstun.
  const guard = M.arena(E), g = guard.fighters[1], heights = [];
  let blocked = false;
  for (let t = 0; t < 30 && heights.length < 4; t++) {
    const motion = guard.motionFrame, stand = heights.length % 2 === 0;
    E.tick(guard, [t ? {} : { punch: true }, M.dirInput(blocked && stand ? 4 : 1, -1)]);
    if (blocked && guard.motionFrame > motion && g.blockStun && g.stun > 0) heights.push([stand ? 'stand' : 'crouch', E.boxes(g).hurt[3]]);
    if (freshOf(guard, 'block', 0).length) blocked = true;
  }
  assert.deepEqual(heights, [['stand', 225], ['crouch', 140], ['stand', 225], ['crouch', 140]]);
});

test('phase 2: dizzy, jump-squat and backstep frames stand with down held, down ends a run, and a landing crouches after touchdown', () => {
  const STAND = 225, CROUCH = 140, height = f => E.boxes(f).hurt[3];
  // A dizzy defender holding down keeps the standing box, so a point-blank roundhouse hits it.
  const dizzy = M.arena(E), dz = dizzy.fighters[1];
  Object.assign(dz, { dizzy: 60, pose: 'dizzy' });
  let hit = false;
  for (let t = 0; t < 30 && !hit; t++) {
    E.tick(dizzy, [t ? {} : { right: true, kick: true }, { down: true }]);
    hit = freshOf(dizzy, 'hit', 0).length > 0;
    if (!hit) assert.deepEqual([dz.dizzy > 0, dz.crouching, height(dz)], [true, true, STAND], `dizzy frame ${t}`);
  }
  assert.equal(hit, true, 'The roundhouse hits the dizzy defender holding down');
  // Up, then down held through the jump squat: the squat stands, and the jump still leaves the ground.
  const squat = M.arena(E, { distance: 600 }), sq = squat.fighters[0], squatting = [];
  E.tick(squat, [{ jump: true }, {}]);
  for (let t = 0; t < 10 && sq.y === 0; t++) { E.tick(squat, [{ down: true }, {}]); if (sq.jumpSquat > 0) squatting.push([sq.crouching, height(sq)]); }
  assert.ok(squatting.length >= 2 && squatting.every(([crouching, h]) => crouching && h === STAND), `jump squat ${JSON.stringify(squatting)}`);
  assert.ok(sq.y > 0, 'The jump leaves the ground');
  // A backstep (back, back) with down held stands until it ends; then the held down crouches.
  const back = M.arena(E, { distance: 600 }), bs = back.fighters[0], stepping = [];
  for (const input of [{ left: true }, {}, { left: true }]) E.tick(back, [input, {}]);
  assert.ok(bs.dash > 0, 'The backstep starts');
  for (let t = 0; t < 20 && bs.dash > 0; t++) { E.tick(back, [{ down: true }, {}]); if (bs.dash > 0) stepping.push([bs.crouching, height(bs)]); }
  assert.ok(stepping.length > 5 && stepping.every(([crouching, h]) => crouching && h === STAND), `backstep ${JSON.stringify(stepping)}`);
  E.tick(back, [{ down: true }, {}]); assert.equal(height(bs), CROUCH, 'Down held after the backstep crouches');
  // Down ends a run on the frame it is pressed, in a crouch; a fighter still running keeps the standing box.
  const run = M.arena(E, { distance: 600 }), rn = run.fighters[0];
  for (const input of [{ right: true }, {}, { right: true }, { right: true }, { right: true }]) E.tick(run, [input, {}]);
  assert.equal(rn.running, true, 'The run starts');
  assert.equal(height({ ...rn, crouching: true }), STAND, 'A running fighter stands');
  E.tick(run, [{ right: true, down: true }, {}]);
  assert.deepEqual([rn.running, height(rn)], [false, CROUCH], 'Down ends the run in a crouch');
  // Landing with down held: only the touchdown frame stands (the crouch was read in the air); from the next frame
  // the fighter crouches, as its crouch pose does.
  const land = M.arena(E, { distance: 600 }), ln = land.fighters[0], landing = [];
  for (let t = 0; t < 90 && landing.length < 3; t++) {
    const airborne = ln.y > 0;
    E.tick(land, [t < 6 ? { jump: true } : { down: true }, {}]);
    if ((airborne && ln.y === 0) || landing.length) landing.push([ln.landFrames, height(ln)]);
  }
  assert.deepEqual(landing.map(([, h]) => h), [STAND, CROUCH, CROUCH], `landing ${JSON.stringify(landing)}`);
  assert.ok(landing.every(([frames]) => frames > 0), 'all inside the landing frames');
});

test('phase 2: a projectile hits an extended limb, and a rising strike keeps its limb until it lands', () => {
  // Slot 1 stands at 600 facing left in its heavy punch's recovery, its arm out toward slot 0. A shot flying right at
  // the arm's height stops one unit short of the body after this frame's move: only the arm is in reach, and it connects.
  const s = M.arena(E, { x: 300, distance: 300 }), [a, d] = s.fighters, heavy = E.MOVES.heavy, speed = 8;
  Object.assign(d, { move: 'heavy', moveVariant: 'standing', moveFrame: heavy.startup + heavy.active + 2 });
  const { hurt, limb } = E.boxes(d);
  assert.ok(limb && limb[0] < hurt[0] - 1, 'The arm reaches past the body');
  const x = hurt[0] - 1 - E.projectileBox({ x: 0, y: 0 })[2] / 2 - speed, y = (heavy.band[0] + heavy.band[1]) / 2;
  s.projectiles.push({ owner: 0, x, y, from: a.x, facing: 1, damage: 17, life: 30, hits: 1, cooldown: 0, speed });
  E.tick(s, [{}, {}]);
  assert.equal(freshOf(s, 'hit', 0).length, 1, 'The shot hits the arm'); assert.equal(d.hp, E.MAX_HP - 17);
  // The rising strike's limb stays out on its airborne frames past startup + active + recovery, until it lands.
  const rise = M.arena(E, { distance: 400 }), r = rise.fighters[0], rising = E.MOVES.rising, total = rising.startup + rising.active + rising.recovery;
  const queue = M.inputFrames('623A');
  let late = 0;
  for (let t = 0; t < 80; t++) {
    E.tick(rise, [queue.length ? queue.shift() : {}, {}]);
    if (r.move === 'rising' && r.y > 0 && r.moveFrame >= total) { late++; assert.ok(E.boxes(r).limb, `limb on airborne frame ${r.moveFrame}`); }
  }
  assert.ok(late > 0, 'The rising strike is still airborne past its frames'); assert.equal(r.move, null, 'and ends once it lands');
});

test('phase 2: neither a command grab nor a throw catches a victim lying down after a knockdown', () => {
  // A sweep knocks slot 1 down. While it lies on the floor (no body box), slot 0 is put on the last startup frame of
  // a command grab or a throw 70 units from it. The same grab and throw catch a victim standing there.
  const grabs = (move, downed) => {
    const s = M.arena(E, { styles: ['grappler'] }), [a, d] = s.fighters, queue = M.inputFrames('2S');
    if (downed) {
      for (let t = 0; t < 150 && !(d.launched && d.y === 0 && d.stun > 2); t++) E.tick(s, [queue.length ? queue.shift() : {}, {}]);
      assert.equal(E.boxes(d).hurt, null, 'The victim lies down');
    }
    Object.assign(a, { move, moveVariant: 'standing', moveFrame: E.MOVES[move].startup - 1, hitDone: false, connected: false, x: d.x - 70, facing: 1 });
    const hp = d.hp; E.tick(s, [{}, {}]);
    return d.hp < hp;
  };
  for (const move of ['commandGrab', 'throw']) {
    assert.equal(grabs(move, true), false, `A ${move} whiffs on a downed victim`);
    assert.equal(grabs(move, false), true, `A ${move} catches a standing victim`);
  }
});

test('phase 2: same-frame shots that clash cancel for both slots, so neither hits from 80 to 130 units', () => {
  for (const styles of [[], ['zoner', 'power'], ['power', 'zoner']]) for (let distance = 80; distance <= 130; distance += 10) {
    const s = M.arena(E, { distance, styles }), hits = [];
    for (let t = 0; t < 40; t++) { E.tick(s, [t ? {} : { special: true }, t ? {} : { special: true }]); hits.push(...freshOf(s, 'hit').map(e => e.attacker)); }
    assert.deepEqual([hits, s.fighters.map(f => f.hp), s.projectiles.length], [[], [E.MAX_HP, E.MAX_HP], 0], `${styles.join(' v ') || 'balanced'} at ${distance}`);
  }
});

test('phase 2: projectiles clash when their boxes touch, and a super beam plows through a shot', () => {
  // Two shots between fighters 800 apart, staged one frame before they would meet; returns the owners of the survivors.
  const clash = (p, q) => {
    const s = M.arena(E, { x: 100, distance: 800 }), shot = { damage: 50, life: 60, hits: 1, cooldown: 0, speed: 8 };
    s.projectiles.push({ ...shot, owner: 0, facing: 1, ...p }, { ...shot, owner: 1, facing: -1, ...q });
    E.tick(s, [{}, {}]);
    return s.projectiles.map(survivor => survivor.owner);
  };
  assert.deepEqual(clash({ x: 500, y: 105 }, { x: 561, y: 105 }), [], 'Boxes overlapping 45 units apart clash');
  assert.deepEqual(clash({ x: 500, y: 105 }, { x: 520, y: 155 }), [0, 1], 'A shot 50 above the other passes over it');
  assert.deepEqual(clash({ x: 500, y: 105, super: true, hits: 6, speed: 11 }, { x: 540, y: 105 }), [0], 'The beam survives the clash');
});

test('phase 2: a trade resolves both strikes as they stood on the contact frame, whichever slot each attacker is in', () => {
  // Two speed-style fighters 200 apart enter 214 + A on the same frames: their rhythm-rush hits trade, and each victim
  // takes the stun of the frames the other's rush had left.
  const s = M.arena(E, { distance: 200, styles: ['speed', 'speed'] }), [p, q] = s.fighters, left = M.inputFrames('214A', 1), right = M.inputFrames('214A', -1);
  let traded = null;
  for (let t = 0; t < 30 && !traded; t++) {
    E.tick(s, [left[t] || {}, right[t] || {}]);
    const hits = freshOf(s, 'hit');
    if (hits.length) traded = { attackers: hits.map(e => e.attacker).sort(), stun: [p.stun, q.stun], hp: [p.hp, q.hp] };
  }
  assert.deepEqual(traded?.attackers, [0, 1], 'Both rushes connect on the same frame');
  assert.equal(traded.stun[0], traded.stun[1], `stun ${traded.stun}`); assert.equal(traded.hp[0], traded.hp[1]);
  // A third rhythm-rush press trading with a jab still lands its finisher (70 and a knockdown), from either slot.
  const finisher = rekkaSlot => {
    const t = M.arena(E, { styles: ['speed', 'speed'] }), R = t.fighters[rekkaSlot], J = t.fighters[1 - rekkaSlot];
    Object.assign(R, { x: 400, facing: 1, move: 'rekka', moveVariant: 'standing', moveFrame: E.MOVES.rekka.startup - 1, rekka: 3 });
    Object.assign(J, { x: 490, facing: -1, move: 'punch', moveVariant: 'standing', moveFrame: E.MOVES.punch.startup - 1 });
    E.tick(t, [{}, {}]);
    return { jabber: J.hp, knockedDown: J.launched, rusher: R.hp };
  };
  const first = finisher(0);
  assert.deepEqual(finisher(1), first, 'The same trade from either slot');
  assert.equal(first.jabber, E.MAX_HP - Math.round(E.MOVES.rekka.finish * E.STYLES.speed.damage * E.STYLES.speed.defense), 'The finisher damage');
  assert.deepEqual([first.knockedDown, first.rusher < E.MAX_HP], [true, true], 'knocks down, and the jab hits the rusher');
});

test('phase 2: a projectile never hits a target behind the point it was fired from', () => {
  // The boss's double ball on its last startup frame, facing away from an opponent standing 64 units behind it: the
  // second ball starts behind the boss and its box overlaps that opponent, but only targets in front can be hit.
  const s = M.arena(E, { styles: ['boss', 'balanced'] }), [boss, other] = s.fighters;
  Object.assign(boss, { x: 600, facing: 1, move: 'doubleball', moveVariant: 'standing', moveFrame: E.MOVES.doubleball.startup - 1 });
  Object.assign(other, { x: 536, facing: 1 });
  let hit = false;
  for (let t = 0; t < 12; t++) {
    E.tick(s, [{}, {}]);
    hit ||= freshOf(s, 'hit', 0).length > 0;
    if (t === 0) { const body = E.boxes(other).hurt; assert.ok(s.projectiles.some(p => E.projectileBox(p)[0] < body[0] + body[2]), 'The second ball overlaps the opponent'); }
  }
  assert.deepEqual([hit, other.hp], [false, E.MAX_HP]);
  // The same double ball still hits an opponent in front at point blank, twice.
  const front = M.arena(E, { styles: ['boss', 'balanced'] }), [shooter] = front.fighters;
  Object.assign(shooter, { move: 'doubleball', moveVariant: 'standing', moveFrame: E.MOVES.doubleball.startup - 1 });
  let hits = 0;
  for (let t = 0; t < 40; t++) { E.tick(front, [{}, {}]); hits += freshOf(front, 'hit', 0).length; }
  assert.equal(hits, 2, 'Both balls hit an opponent in front');
});

test('phase 2: E.boxes says whether a hit can land, so the overlay pales an invulnerable limb and a body at the juggle limit', () => {
  const s = M.arena(E, { distance: 400 }), [a, d] = s.fighters, queue = M.inputFrames('623A'), invulnerable = [];
  assert.equal(E.boxes(a).hittable, true);
  for (let t = 0; t < 20; t++) {
    E.tick(s, [queue.length ? queue.shift() : {}, {}]);
    const box = E.boxes(a);
    if (a.move === 'rising' && box.limb && a.invulnerable) invulnerable.push(box.hittable);
  }
  assert.ok(invulnerable.length > 0 && invulnerable.every(h => h === false), `The rising strike's invulnerable limb cannot be hit: ${invulnerable}`);
  Object.assign(d, { launched: true, y: 100, vy: 0, stun: 20, juggle: 99 });
  assert.equal(E.boxes(d).hittable, false, 'A launched body at the juggle limit cannot be hit');
  d.juggle = 0; assert.equal(E.boxes(d).hittable, true, 'and one below it can');
});

// ---------------------------------------------------------------- phase 3: committed jumps and the air game
// The targets of gameplay-audit.md phase 3: committed arcs, the super jump, air resets and air techs, landing lag and
// the tucked jump box that lets a full jump clear a shot.
// The x travelled on each airborne frame of a jump by slot 0 (opponent 600 units away): squat(t) is held until takeoff,
// air(t) once airborne.
const flight = (squat, air = () => ({})) => {
  const s = M.arena(E, { distance: 600 }), f = s.fighters[0], dx = [];
  let airborne = 0;
  for (let t = 0; t < 120; t++) {
    const x = f.x;
    E.tick(s, [f.y > 0 ? air(airborne++, f.facing) : squat(t, f.facing), {}]);
    if (f.y > 0 && x !== f.x) dx.push(+(f.x - x).toFixed(9));
    if (airborne && f.y === 0) break;
  }
  return dx;
};

test('phase 3: jumps are committed arcs of the same height and length, and only an attacking jump has landing lag', () => {
  const jump = M.jumps(E);
  assert.deepEqual([jump.committed, jump.reverses, jump.steers, jump.airControl], [true, false, false, 'committed arc'], 'The probe reports a committed arc');
  // Jump and hop heights and durations stay: 42 and 31 airborne frames, apex 137.5 and 76.7 units, a four-frame squat.
  assert.deepEqual([jump.full.airtime, jump.full.apexUnits, jump.hop.airtime, jump.hop.apexUnits, jump.full.squat], [42, 137.5, 31, 76.7, 4]);
  assert.deepEqual(jump.landingLag, { empty: 0, attacked: 3 }, 'Three frames of landing lag after an attacking jump, none after an empty one');
  // The direction held on the last squat frame fixes the horizontal speed for the whole jump, whatever is held in the air.
  const forward = flight((t, facing) => M.dirInput(9, facing), (t, facing) => M.dirInput(t > 6 ? 4 : 6, facing));
  assert.ok(forward.length > 30 && forward.every(dx => Math.abs(dx - 4.2) < 1e-9), `A forward jump that holds back keeps 4.2 a frame: ${[...new Set(forward)]}`);
  const neutral = flight((t, facing) => M.dirInput(8, facing), (t, facing) => M.dirInput(6, facing));
  assert.deepEqual(neutral, [], 'A neutral jump that holds forward in the air stays in place');
  const late = flight((t, facing) => M.dirInput(t < 3 ? 8 : 9, facing));
  assert.ok(late.length > 30 && late.every(dx => Math.abs(dx - 4.2) < 1e-9), 'Toward pressed on the last squat frame still makes a forward jump');
  const hop = flight((t, facing) => t === 0 ? { jump: true } : M.dirInput(6, facing), (t, facing) => M.dirInput(4, facing));
  assert.ok(hop.length > 20 && hop.every(dx => Math.abs(dx - 4.2 * 1.12) < 1e-9), `A forward hop keeps 1.12x: ${[...new Set(hop)]}`);
  // Air attacks keep the momentum.
  const kick = flight((t, facing) => M.dirInput(9, facing), t => t === 3 ? { kick: true } : {});
  assert.ok(kick.length > 30 && kick.every(dx => Math.abs(dx - 4.2) < 1e-9), 'An air kick keeps the jump momentum');
});

test('phase 3: a down direction within the ten frames before up super-jumps: higher, longer and 1.15x as fast', () => {
  const superJump = M.jumps(E).superJump;
  assert.equal(superJump.isSuper, true);
  // Vertical speed 16.5: with the engine's integration that is 52 airborne frames and an apex of 97 % of a body.
  assert.ok(superJump.airtime >= 49 && superJump.airtime <= 53, `super jump airtime ${superJump.airtime}`);
  assert.ok(superJump.apex >= .9 && superJump.apex <= 1, `super jump apex ${superJump.apex}`);
  // script: [input, frames] pairs for slot 0, then up held. Returns the takeoff kind and the speeds of the jump.
  const jumpAfter = (script, up = M.dirInput(8, 1), hold = 6) => {
    const s = M.arena(E, { distance: 600 }), f = s.fighters[0], frames = [];
    for (const [input, count] of script) for (let i = 0; i < count; i++) frames.push(input);
    for (let i = 0; i < hold; i++) frames.push(up);
    let apex = 0, flagged = false, vx = null, airtime = 0;
    for (let t = 0; t < 140; t++) {
      E.tick(s, [frames[t] || {}, {}]);
      if (f.y > 0) { airtime++; apex = Math.max(apex, f.y); flagged ||= f.superJump; if (vx === null) vx = f.airVX; }
      else if (airtime) break;
    }
    return { super: flagged, apex: M.round(apex, 1), airtime, vx: M.round(vx, 6), landed: { superJump: f.superJump, y: f.y } };
  };
  const full = jumpAfter([]);
  assert.deepEqual([full.super, full.apex, full.airtime], [false, 137.5, 42], 'Up alone is a full jump');
  for (const gap of [1, 5, 10]) assert.equal(jumpAfter([[{ down: true }, 1], [{}, gap - 1]]).super, true, `Down ${gap} frame(s) before up super-jumps`);
  assert.equal(jumpAfter([[{ down: true }, 1], [{}, 10]]).super, false, 'Down 11 frames before up is a full jump');
  assert.equal(jumpAfter([[{ down: true }, 20]]).super, true, 'Up from a held crouch super-jumps');
  for (const digit of [1, 3]) assert.equal(jumpAfter([[M.dirInput(digit, 1), 1]]).super, true, `Down direction ${digit} counts`);
  const tapped = jumpAfter([[{ down: true }, 1]], { jump: true }, 1);
  assert.deepEqual([tapped.super, tapped.airtime], [true, superJump.airtime], 'A tap of up after down is a super jump, never a hop');
  const both = jumpAfter([], { down: true, jump: true }, 1);
  assert.equal(both.super, true, 'Down held with the press of up counts too');
  // 1.15x the horizontal speed of a jump, fixed at takeoff; the flag clears on landing.
  const forward = jumpAfter([[M.dirInput(3, 1), 1]], M.dirInput(9, 1));
  assert.deepEqual([forward.super, forward.vx], [true, M.round(4.2 * 1.15, 6)]);
  assert.deepEqual(forward.landed, { superJump: false, y: 0 }, 'The super-jump flag clears on landing');
  assert.equal(jumpAfter([], M.dirInput(9, 1)).vx, 4.2);
  const superFlight = flight((t, facing) => t === 0 ? M.dirInput(3, facing) : M.dirInput(9, facing), (t, facing) => M.dirInput(4, facing));
  assert.ok(superFlight.length > 40 && superFlight.every(dx => Math.abs(dx - 4.2 * 1.15) < 1e-9), 'A super jump cannot be steered either');
});

test('phase 3: the tucked jump box lets a full jump clear a shot and a sweep catch a jumper only on its takeoff frame', () => {
  // Slot 1 holds up from frame 0 (squat frames 0-3, takeoff on frame 4); slot 0's sweep is first active on frame `first`.
  const swept = first => {
    const s = M.arena(E), [a, d] = s.fighters, sweep = E.VARIANTS.crouch.kick, boxes = [];
    Object.assign(a, { move: 'kick', moveVariant: 'crouch', moveFrame: sweep.startup - 1 - first });
    let hit = false;
    for (let t = 0; t < first + sweep.active && !hit; t++) { E.tick(s, [{ down: true }, { jump: true }]); boxes.push(E.boxes(d).hurt); hit = freshOf(s, 'hit', 0).length > 0; }
    return { hit, boxes };
  };
  assert.equal(swept(4).hit, true, 'A sweep active from the takeoff frame catches the jumper');
  const late = swept(5);
  assert.equal(late.hit, false, 'One frame later the feet are 14 up and the sweep passes under');
  assert.deepEqual(late.boxes.slice(0, 4).map(box => [box[1], box[3]]), [[0, 225], [0, 225], [0, 225], [0, 225]], 'The jump squat keeps the standing box');
  assert.deepEqual(late.boxes.slice(4, 6).map(box => [box[1], box[2], box[3]]), [[31, 70, 150], [44, 70, 150]], 'Airborne: 70 x 150 from 30 above the feet (1, then 14)');
});

test('phase 3: a balanced neutral jump clears a shot at several timings, a forward jump at many more, and a hop never', () => {
  const clears = (style, shot, distance, jump) => M.projectileJump(E, { style, shot, distance, jump }).clears;
  const report = M.projectileJump(E, { shot: '5F', distance: 350, jump: 'neutral' });
  assert.deepEqual([report.shot, report.frames, report.timings.length], ['5F', 110, report.clears]);
  for (const shot of ['5F', '236A']) for (const distance of [250, 350, 450]) {
    const neutral = clears('balanced', shot, distance, 'neutral'), forward = clears('balanced', shot, distance, 'forward');
    assert.ok(neutral >= 3, `A balanced neutral jump clears ${shot} from ${distance} at ${neutral} timings`);
    // From 250 the forward jump's window opens before the shot is fired, so the 110 frames after the shot cut it short.
    assert.ok(forward > neutral && (distance === 250 || forward >= 2 * neutral), `A forward jump clears ${shot} from ${distance} at ${forward} timings (neutral ${neutral})`);
    for (const style of ['power', 'grappler']) assert.ok(clears(style, shot, distance, 'forward') >= 1, `The ${style} style clears ${shot} from ${distance} with a forward jump`);
    for (const style of Object.keys(E.STYLES)) assert.equal(clears(style, shot, distance, 'hop'), 0, `A ${style} hop never clears ${shot} from ${distance}`);
  }
  assert.throws(() => M.projectileJump(E, { jump: 'sideways' }), /Unknown jump kind/);
});

test('phase 3: light hits reset an airborne opponent to a standing landing, and heavier hits knock it down', () => {
  // Air to air (the attacker held 100 up), and anti-airs from the ground, against an opponent held 60 up.
  for (const [move, reset] of [['j.A', true], ['j.S', true], ['j.D', false], ['5A', true], ['5S', true], ['2A', true], ['5D', false], ['6S', false], ['2D', false], ['S+D', false], ['5F', false]]) {
    const r = M.hitAt(E, { move, height: 60, detail: true });
    assert.deepEqual([r.hit, r.knockdown, r.landedStanding], [true, !reset, reset], `${move} ${reset ? 'resets' : 'knocks down'} an airborne opponent`);
  }
  // A light hit on a launched victim keeps the juggle rules: it stays launched and the juggle count rises.
  const s = M.arena(E), [a, d] = s.fighters;
  Object.assign(d, { launched: true, y: 100, vy: 0, stun: 30, juggle: 1, pose: 'tumble' });
  Object.assign(a, { move: 'punch', moveVariant: 'standing', moveFrame: E.MOVES.punch.startup - 1 });
  E.tick(s, [{}, {}]);
  assert.deepEqual([freshOf(s, 'hit', 0).length, d.launched, d.juggle], [1, true, 2], 'A jab juggles a launched victim as before');
});

test('phase 3: an air reset is the move\'s hitstun falling away, then an air tech and a free landing on the feet', () => {
  // Slot 1 is held `height` up, still, until slot 0's strike (an air move from 100 up) connects; then both fall freely.
  // With mash, slot 1 presses A on alternate frames once it has teched. A taunt pressed on a copy probes when it can act.
  const reset = (move, { counter = false, mash = false, height = 120 } = {}) => {
    const s = M.arena(E), [a, d] = s.fighters, queue = M.inputFrames(move), air = M.parseInput(move).air, log = [];
    let contact = null;
    for (let t = 0; t < 200; t++) {
      if (!contact) { d.y = height; d.vy = 0; if (air) { a.y = 100; a.vy = 0; } if (counter) Object.assign(d, { move: 'heavy', moveVariant: 'standing', moveFrame: 1 }); }
      const before = { y: d.y, vy: d.vy, x: d.x }, motion = s.motionFrame;
      const free = contact && d.y === 0 && M.canAct(E, s, 1);
      E.tick(s, [queue.length ? queue.shift() : {}, mash && contact && d.airTech && t % 2 ? { punch: true } : {}]);
      if (!contact && freshOf(s, 'hit', 0).length) contact = { t, stun: d.stun, launched: d.launched, pose: d.pose, vy: d.vy, vyBefore: before.vy, hittable: E.boxes(d).hittable };
      else if (contact) log.push({ simulated: s.motionFrame > motion, y: d.y, dx: d.x - before.x, stun: d.stun, tech: d.airTech, invulnerable: d.invulnerable, hittable: E.boxes(d).hittable, move: d.move, landLag: d.landLag, free, launched: d.launched });
      if (free) break;
    }
    return { contact, log: log.filter(f => f.simulated), free: log.filter(f => f.simulated).findIndex(f => f.free) };
  };
  // The light kick reaches feet below 110, so it meets its victim lower.
  for (const [move, stun, height] of [['5A', E.MOVES.punch.hitStun, 120], ['5S', E.MOVES.kick.hitStun, 100], ['j.A', E.VARIANTS.air.punch.hitStun, 120], ['j.S', E.VARIANTS.air.kick.hitStun, 120]]) {
    const { contact, log, free } = reset(move, { height });
    assert.ok(contact, `${move} connects`);
    assert.deepEqual([contact.stun, contact.launched, contact.pose], [stun, false, 'hit'], `${move}: air hitstun for the move's hitstun`);
    const hitstun = log.slice(0, stun), teched = log.findIndex(f => f.tech), touchdown = log.findIndex(f => f.y === 0);
    assert.ok(hitstun.every((f, i) => f.y > 0 && Math.abs(f.dx - 1.5) < 1e-9 && (i === 0 || f.y < hitstun[i - 1].y)), `${move}: falls and drifts away 1.5 a frame through the hitstun`);
    // The stun runs out in the air: six invulnerable frames, then hittable but no attack until it lands.
    assert.equal(teched, stun - 1, `${move}: the air tech on the frame the hitstun runs out`);
    // (A low reset may land inside those frames; landing frees it at once, so the log can end before the seventh.)
    const guarded = log.slice(teched, teched + 7).map(f => f.hittable);
    assert.ok(guarded.length >= 6 || touchdown < teched + 6, `${move}: logged through the invulnerability or landed inside it`);
    assert.deepEqual(guarded, [false, false, false, false, false, false, true].slice(0, guarded.length), `${move}: six invulnerable frames`);
    // On its feet (never launched) it lands free, like an empty jump: no landing lag, so it can guard at once and an
    // anti-air never guarantees a follow-up.
    assert.ok(touchdown > teched && log.every(f => !f.launched), `${move}: lands on its feet`);
    assert.ok(log[touchdown].landLag === 0 && free - touchdown <= 1, `${move}: no landing lag after an air reset`);
    // Presses after the tech start nothing in the air; the last one stays buffered and comes out on the landing.
    const mashed = reset(move, { mash: true, height }).log, landed = mashed.findIndex(f => f.y === 0);
    assert.ok(mashed.slice(teched, landed).every(f => f.y > 0 && f.tech && f.move === null), `${move}: no attack until it lands`);
    assert.equal(mashed[landed].move, 'punch', `${move}: the buffered press comes out on the landing`);
  }
  // A counter hit adds 4 to the air hitstun, as on the ground.
  assert.equal(reset('5A', { counter: true }).contact.stun, E.MOVES.punch.hitStun + 4);
  // A full dizzy meter dizzies a fighter whose hitstun ran out in an air tech, on landing.
  const s = M.arena(E), [, d] = s.fighters, queue = M.inputFrames('5A'); d.dizzyMeter = E.DIZZY_LIMIT - 5;
  let hit = false, dizzy = false;
  for (let t = 0; t < 200 && !dizzy; t++) { if (!hit) { d.y = 120; d.vy = 0; } E.tick(s, [queue.length ? queue.shift() : {}, {}]); hit = hit || d.stun > 0; dizzy = d.dizzy > 0 && d.y === 0; }
  assert.ok(hit && dizzy, 'An air-teched fighter with a full dizzy meter is dizzied when it lands');
});

test('phase 3: landing lag stands and cannot guard, and the CPU answers an incoming shot with a full jump', () => {
  // Slot 1 lands from a jump (it attacked, or not) as slot 0's jab, staged, becomes active `delay` frames later; slot 1 holds back.
  const landing = (attacked, delay) => {
    const s = M.arena(E), [a, d] = s.fighters;
    Object.assign(d, { y: 2, vy: -3, airActed: attacked });
    Object.assign(a, { move: 'punch', moveVariant: 'standing', moveFrame: E.MOVES.punch.startup - 1 - delay });
    let result = null, height = null;
    for (let t = 0; t <= delay && !result; t++) {
      E.tick(s, [{}, { right: true, down: true }]);
      height = E.boxes(d).hurt[3];
      result = freshOf(s, 'hit', 0).length ? 'hit' : freshOf(s, 'block', 0).length ? 'block' : null;
    }
    return { result, height, landLag: d.landLag };
  };
  assert.deepEqual([0, 1, 2, 3].map(delay => landing(true, delay).result), ['hit', 'hit', 'hit', 'block'], 'No guard on the touchdown frame and the two lag frames after it');
  assert.deepEqual([0, 1, 2].map(delay => landing(true, delay).height), [225, 225, 225], 'The landing lag stands, down held or not');
  assert.equal(landing(true, 3).height, 140, 'Then the held down crouches');
  assert.deepEqual([landing(false, 0).result, landing(false, 1).result], ['hit', 'block'], 'An empty jump guards from the frame after touchdown');
  // The CPU (slot 1) sees a shot 220 units away: when it jumps, it holds up and toward through the squat.
  const takeoffs = [];
  for (let seed = 1; seed <= 12; seed++) {
    const s = E.create(['p1', 'p2'], { cpuSlots: [false, true], seed, cpuLevel: 8 });
    s.phase = 'fight'; s.message = '';
    const [p, c] = s.fighters; p.x = 300; c.x = 700; p.facing = 1; c.facing = -1;
    s.projectiles.push({ owner: 0, x: c.x - 220, y: 105, from: p.x, facing: 1, damage: 60, life: 150, hits: 1, cooldown: 0, speed: 8, kind: 'special' });
    for (let t = 0; t < 12 && c.y === 0; t++) E.tick(s, [{}, {}]);
    if (c.y > 0) takeoffs.push({ hop: c.hop, toward: Math.sign(c.airVX) === Math.sign(p.x - c.x) });
  }
  assert.ok(takeoffs.length >= 3, `The CPU jumped in ${takeoffs.length} of 12 seeds`);
  assert.ok(takeoffs.every(t => !t.hop && t.toward), `Every CPU jump over the shot is a full forward jump: ${JSON.stringify(takeoffs)}`);
});

// ---------------------------------------------------------------- phase 4: launcher combos and juggles
// The targets of gameplay-audit.md phase 4: the launcher's super-jump cancel, its floating victim, the air chain (each
// rank once per jump) and juggle decay. COMBO is the exact frame script of 2A > 2D > super jump > j.A > j.S > j.D at point
// blank, slot 0's input on each tick (hitstop ticks included): 2A on tick 0; 2D on tick 8, the jab's last hitstop tick;
// up held through the launcher's hitstop (ticks 16-25), so the cancel leaves the ground on tick 25, the first frame after
// it; A on tick 26, the first airborne frame; S and D in the hitstops of the air jab (tick 31) and of the air kick (42).
const COMBO = (() => {
  const script = { 0: { down: true, punch: true }, 8: { down: true, heavy: true }, 26: { punch: true }, 31: { kick: true }, 42: { heavy: true } };
  for (let t = 1; t < 16; t++) script[t] ||= { down: true };
  for (let t = 16; t < 26; t++) script[t] = { jump: true };
  return script;
})();
// Plays slot 0's script (tick: input, or a function of the state, the tick and the log so far) against an idle slot 1 at
// point blank, logging every tick: slot 0's fresh hits (their damage) and both fighters' state after the tick.
const play = (script, { ticks = 140 } = {}) => {
  const s = M.arena(E), [a, d] = s.fighters, log = [];
  for (let t = 0; t < ticks; t++) {
    const input = (typeof script === 'function' ? script(s, t, log) : script[t]) || {};
    E.tick(s, [input, {}]);
    log.push({ t, hits: freshOf(s, 'hit', 0).map(e => e.damage), move: a.move, variant: a.moveVariant, ax: a.x, ay: a.y, avy: a.vy, superJump: a.superJump, airVX: a.airVX,
      dx: d.x, dy: d.y, dvy: d.vy, launched: d.launched, floating: d.floating, juggle: d.juggle, combo: d.combo, hp: d.hp, stun: d.stun, hurt: E.boxes(d).hurt, hittable: E.boxes(d).hittable });
  }
  return { s, log, hits: log.filter(f => f.hits.length) };
};

test('phase 4: crouching jab, launcher, super jump, air A, air S and air D are a five-hit combo for 17-24 % of a life bar', () => {
  const { log, hits } = play(COMBO);
  assert.deepEqual(hits.map(f => [f.t, `${f.move}/${f.variant}`, f.combo]), [[3, 'punch/crouch', 1], [15, 'heavy/crouch', 2], [30, 'punch/air', 3], [41, 'kick/air', 4], [53, 'heavy/air', 5]]);
  // 28 + 60 + 30, then x0.82 and x0.82 squared for the fourth and fifth hits: 192 points, 19.2 % of the bar.
  assert.deepEqual(hits.map(f => f.hits[0]), [28, 60, 30, 30, 44]);
  const damage = E.MAX_HP - log.at(-1).hp;
  assert.ok(damage >= .17 * E.MAX_HP && damage <= .24 * E.MAX_HP, `${damage} points`);
  // The cancel has no squat: in the launcher on tick 24 (its last hitstop tick), airborne on 25 at a super jump's 16.5,
  // aimed at the victim at (victim.x - x) / 22 a frame.
  const [before, takeoff] = [log[24], log[25]];
  assert.deepEqual([before.move, before.ay], ['heavy', 0]);
  assert.deepEqual([takeoff.move, takeoff.ay, takeoff.avy, takeoff.superJump], [null, 1, 16.5, true]);
  assert.ok(Math.abs(takeoff.airVX - (before.dx - before.ax) / 22) < 1e-9, `airVX ${takeoff.airVX}`);
  // The victim floats: it leaves at 14 under 0.9 x gravity and drifts away 1 unit a frame.
  assert.deepEqual([log[15].dvy, log[15].floating, log[15].launched], [14, true, true]);
  assert.ok(Math.abs(log[25].dvy - (14 - .65 * .9)) < 1e-9 && Math.abs(log[25].dx - log[24].dx - 1) < 1e-9, 'Floating: 0.9 x gravity and a 1-unit drift');
  // Each air hit re-pops it less, at max(vy x 0.3, 5.5 - 0.8 x juggle count), and the air heavy spikes it down at -7.
  assert.deepEqual(hits.slice(2).map(f => [M.round(f.dvy, 6), f.juggle]), [[5.5, 1], [4.7, 2], [-7, 3]]);
  // Every style lands the same combo, and the probe reports it.
  for (const style of Object.keys(E.STYLES)) {
    const run = M.launcherFollowUp(E, { route: 'superjump', starter: ['2A'], style });
    assert.deepEqual([run.superJump, run.takeoffFrame, run.followUpHits, run.combo], [true, 1, 3, 5], style);
    assert.ok(run.damage >= .17 && run.damage <= .24, `${style}: ${run.damage}`);
  }
  const probe = tool('gameplay-probe.cjs', [], { DFZ_REPO: nowhere });
  assert.ok(probe.stdout.includes('OURS 2A>2D, up inside the cancel window (super jump on the first free frame, no squat) > j.A > j.S > j.D: 3 follow-up hit(s), combo 5, 19.2% damage'), probe.stdout);
});

test('phase 4: the launcher combo plays the same from either slot and facing', () => {
  // The exact script from slot 0 facing right (the reference), slot 0 facing left and slot 1 either way: the same hits on
  // the same ticks, and on every tick the positions mirror the reference's. The super jump aims where the victim stood as
  // the frame began, so slot 1, which updates after its victim has drifted, aims as slot 0 does (it drifted 1.6 apart).
  const run = (slot, facing) => {
    const s = M.arena(E), a = s.fighters[slot], d = s.fighters[1 - slot], frames = [];
    [a.x, d.x, a.facing, d.facing] = facing === 1 ? [400, 480, 1, -1] : [480, 400, -1, 1];
    for (let t = 0; t < 140; t++) {
      E.tick(s, slot ? [{}, COMBO[t] || {}] : [COMBO[t] || {}, {}]);
      frames.push({ hits: freshOf(s, 'hit', slot).map(e => e.damage), ax: facing * (a.x - 440), ay: a.y, dx: facing * (d.x - 440), dy: d.y, hp: d.hp });
    }
    return frames;
  };
  const reference = run(0, 1);
  assert.equal(reference.filter(f => f.hits.length).length, 5);
  for (const [slot, facing] of [[0, -1], [1, -1], [1, 1]]) run(slot, facing).forEach((f, t) => {
    const r = reference[t];
    assert.deepEqual([f.hits, f.hp], [r.hits, r.hp], `slot ${slot} facing ${facing}, tick ${t}`);
    for (const key of ['ax', 'ay', 'dx', 'dy']) assert.ok(Math.abs(f[key] - r[key]) < 1e-6, `slot ${slot} facing ${facing}, tick ${t}: ${key} ${f[key]} against ${r[key]}`);
  });
});

test('phase 4: without the super-jump input no follow-up connects', () => {
  // The same script without up: A, S and D come in the launcher's recovery, which cancels only into specials and supers.
  const grounded = Object.fromEntries(Object.entries(COMBO).map(([t, input]) => [t, input.jump ? { down: true } : input]));
  const { log, hits } = play(grounded);
  assert.equal(hits.length, 2); assert.ok(log.every(f => f.ay === 0), 'The attacker never leaves the ground');
  // The launch alone: hittable on the way up, out of juggle reach from its apex, which nothing juggled it before.
  const flight = log.filter(f => f.launched && f.dy > 0), apex = flight.findIndex(f => f.dvy <= 0);
  assert.ok(apex > 10 && flight.slice(0, apex).every(f => f.hittable) && flight.slice(apex).every(f => !f.hittable && f.juggle === 4), `apex at ${apex}`);
  // Jumping or super-jumping (with its squat) once the launcher has recovered arrives after the apex, for every style.
  for (const style of Object.keys(E.STYLES)) for (const route of ['jump', 'freesuper']) {
    const run = M.launcherFollowUp(E, { route, starter: ['2A'], style });
    assert.deepEqual([run.jumped, run.superJump, run.connects], [true, route === 'freesuper', false], `${style} ${route}`);
  }
  // The float is 49 airborne frames with an apex of 78 % of a body.
  const alone = M.launcherFollowUp(E, { route: 'stay' });
  assert.deepEqual([alone.victimAirtime, alone.victimApex], [49, .78]);
});

test('phase 4: a second launcher after the landing whiffs on the downed victim', () => {
  // 2A > 2D with no follow-up, down held; then a second 2D pressed on tick k, for every k from the attacker's first free
  // tick until the victim can be hit again: it never connects, on the victim falling out of juggle reach or lying down.
  const hold = t => t < 16 ? COMBO[t] || { down: true } : { down: true };
  const dry = play((s, t) => hold(t), { ticks: 160 }).log;
  const free = dry.findIndex((f, t) => t > 15 && !f.move) + 1, landed = dry.findIndex(f => f.launched && f.dy === 0);
  const rehit = dry.findIndex((f, t) => t > landed && f.hittable);
  assert.ok(free > 15 && landed > free && rehit > landed + 30, `free ${free}, landed ${landed}, hittable again ${rehit}`);
  assert.ok(dry.slice(landed, rehit).every(f => f.hurt === null || f.stun === 0), 'Lying down it has no box');
  let tried = 0;
  for (let k = free; k + 12 <= rehit; k++, tried++) {
    const { hits } = play((s, t) => t === k ? { down: true, heavy: true } : hold(t), { ticks: k + 14 });
    assert.equal(hits.length, 2, `A second launcher pressed on tick ${k} whiffs`);
  }
  assert.ok(tried > 40, `${tried} timings`);
  // The harness agrees: a second launcher once the victim has landed whiffs.
  assert.deepEqual(M.launcherFollowUp(E, { route: 'stay', starter: ['2A'], relaunch: true }).relaunch, { attempted: true, hit: false, victimDown: null });
});

test('phase 4: the combo counter ends when the victim lands', () => {
  // The exact combo, then 2D as soon as the attacker can act and the victim can be hit again.
  let relaunch = null;
  const { log, hits } = play((s, t, so) => {
    if (t <= 42) return COMBO[t];
    if (relaunch === null && s.fighters[0].y === 0 && so.at(-1).hittable && M.canAct(E, s, 0)) relaunch = t;
    return relaunch === null ? {} : { down: true, heavy: t === relaunch };
  }, { ticks: 200 });
  const landed = log.findIndex(f => f.launched && f.dy === 0), stood = log.findIndex((f, t) => t > landed && !f.launched);
  assert.deepEqual(log.slice(0, landed).filter(f => f.hits.length).map(f => f.combo), [1, 2, 3, 4, 5]);
  // From the landing until it stands the victim has no box and cannot be hit, and the counter stays at five hits.
  assert.ok(stood > landed && log.slice(landed, stood).every(f => f.hurt === null && !f.hittable && f.combo === 5), `landed ${landed}, stood ${stood}`);
  // The next hit starts a new combo at full damage.
  assert.ok(relaunch > stood);
  assert.deepEqual([hits.length, hits.at(-1).combo, hits.at(-1).hits[0]], [6, 1, 60]);
});

test('phase 4: the air chain cannot repeat a rank in one jump, and chains on hit or block', () => {
  // Slot 0 jumps (a super jump: down, then up held) 600 units from slot 1 and presses a button on given airborne frames.
  // Returns the air moves started, as move@airborne frame, and the ranks the jump used.
  const airPresses = (presses, superJump = true) => {
    const s = M.arena(E, { distance: 600 }), a = s.fighters[0], started = [];
    let air = 0;
    for (let t = 0; t < 140; t++) {
      if (a.y > 0) air++;
      const input = a.y > 0 ? presses[air] ? { [presses[air]]: true } : {} : air ? {} : t === 0 && superJump ? { down: true } : { jump: true };
      const [move, frame] = [a.move, a.moveFrame];
      E.tick(s, [input, {}]);
      if (a.move && (a.move !== move || a.moveFrame < frame)) started.push(`${a.move}@${air}`);
      if (air && a.y === 0) return { started, ranks: [...a.airRanks] };
    }
    return null;
  };
  // A super jump: A (18 frames), A again once it is over, S, S again, D. A used button neither starts nor holds up the next.
  assert.deepEqual(airPresses({ 1: 'punch', 20: 'punch', 23: 'kick', 44: 'kick', 46: 'heavy' }).started, ['punch@1', 'kick@23', 'heavy@46']);
  assert.deepEqual(airPresses({ 1: 'kick', 22: 'punch', 41: 'kick' }).started, ['kick@1', 'punch@22'], 'Each rank once, whatever the order');
  // A full jump fitted two jabs before; now one. The ranks reset on landing.
  assert.deepEqual(airPresses({ 1: 'punch', 20: 'punch' }, false), { started: ['punch@1'], ranks: [] });
  // Two jumps in a row both start their jab.
  const s = M.arena(E, { distance: 600 }), a = s.fighters[0], jabs = [];
  for (let jump = 0, t = 0; jump < 2 && t < 200; t++) {
    const airborne = a.y > 0;
    E.tick(s, [airborne ? { punch: !(t % 2) } : { jump: true }, {}]);
    if (airborne && a.move === 'punch' && a.moveFrame === 1) jabs.push(jump);
    if (airborne && a.y === 0) jump++;
  }
  assert.deepEqual(jabs, [0, 1]);
  // On hit: once the combo's air heavy is over (tick 73), presses of A, S and D start nothing more in that jump.
  const after = play({ ...COMBO, 76: { punch: true }, 82: { kick: true }, 88: { heavy: true } }).log;
  const done = after.findIndex(f => f.t > 53 && f.move === null), airborneAfter = after.slice(done).filter(f => f.ay > 0);
  assert.ok(done === 73 && airborneAfter.length > 15 && airborneAfter.every(f => f.move === null), `No air normal after j.A > j.S > j.D (over on tick ${done})`);
  // On block: a super jump at 70 units against a standing guard chains j.A > j.S > j.D, each pressed on the frame after
  // the previous contact and starting before the previous move has ended.
  const g = M.arena(E, { distance: 70 }), [ga, gd] = g.fighters, blocks = [];
  let air = 0, step = -1, contact = false;
  for (let t = 0; t < 120; t++) {
    if (ga.y > 0) air++;
    let input = ga.y === 0 ? air ? {} : t === 0 ? { down: true } : { jump: true } : {};
    if ((air === 1 && step < 0) || (contact && step < 2)) input = { [['punch', 'kick', 'heavy'][++step]]: true };
    const previous = ga.move;
    E.tick(g, [input, { right: true }]);
    contact = freshOf(g, 'block', 0).length + freshOf(g, 'hit', 0).length > 0;
    if (freshOf(g, 'block', 0).length) blocks.push(ga.move);
    // Each step is a cancel: the next move replaces the previous one while it is still under way.
    if (ga.move && ga.move !== previous) assert.ok(previous === null ? step === 0 : step > 0, `${ga.move} after ${previous}`);
    if (air && ga.y === 0) break;
  }
  assert.deepEqual(blocks, ['punch', 'kick', 'heavy'], 'Blocked j.A > j.S > j.D');
  assert.equal(gd.hp, E.MAX_HP);
});

test('phase 4: every air hit on a launched victim re-pops it less, the air heavy spikes it and four end the juggle', () => {
  // A launched victim held 100 up with vertical speed vy and juggle count j, hit by a staged jab, or by an air heavy from
  // 150 up. Returns its vertical speed after the hit (null if nothing hit).
  const pop = (j, vy = 0, air = false) => {
    const s = M.arena(E), [a, d] = s.fighters;
    Object.assign(d, { launched: true, y: 100, vy, stun: 30, juggle: j, pose: 'tumble' });
    if (air) Object.assign(a, { move: 'heavy', moveVariant: 'air', moveFrame: E.VARIANTS.air.heavy.startup - 1, y: 150, vy: 0, airRanks: [2] });
    else Object.assign(a, { move: 'punch', moveVariant: 'standing', moveFrame: E.MOVES.punch.startup - 1 });
    E.tick(s, [{}, {}]);
    return freshOf(s, 'hit', 0).length ? M.round(d.vy, 6) : null;
  };
  // Falling (vy 0 is -0.65 by the hit): 5.5 - 0.8 x the juggle count; rising fast, 30 % of its speed (19.35 -> 5.805).
  assert.deepEqual([0, 1, 2, 3].map(j => pop(j)), [5.5, 4.7, 3.9, 3.1]);
  assert.equal(pop(0, 20), M.round(19.35 * .3, 6));
  assert.equal(pop(4), null, 'After four air hits nothing more lands');
  assert.equal(pop(1, 0, true), -7, 'The air heavy spikes it down');
  // Only the launcher floats: the rising strike keeps its launch, 9 up under full gravity, drifting 2.2 a frame.
  const s = M.arena(E), d = s.fighters[1], queue = M.inputFrames('623A');
  let launch = null;
  for (let t = 0; t < 40 && !launch; t++) { E.tick(s, [queue.shift() || {}, {}]); if (freshOf(s, 'hit', 0).length) launch = { vy: d.vy, floating: d.floating, x: d.x }; }
  assert.deepEqual([launch.vy, launch.floating], [9, false]);
  for (let i = s.hitstop; i >= 0; i--) E.tick(s, [{}, {}]);
  assert.ok(Math.abs(d.vy - (9 - .65)) < 1e-9 && Math.abs(d.x - launch.x - 2.2) < 1e-9, `vy ${d.vy}, drift ${d.x - launch.x}`);
  // A forward jumper knocked down by a heavy punch drifts away 2.2 a frame: its jump's own speed no longer carries it.
  const k = M.arena(E), [ka, kd] = k.fighters;
  Object.assign(kd, { y: 120, vy: 0, airVX: -4.2 });
  Object.assign(ka, { move: 'heavy', moveVariant: 'standing', moveFrame: E.MOVES.heavy.startup - 1 });
  E.tick(k, [{}, {}]);
  assert.equal(kd.launched, true);
  const x0 = kd.x;
  for (let i = k.hitstop; i >= 0; i--) E.tick(k, [{}, {}]);
  assert.ok(Math.abs(kd.x - x0 - 2.2) < 1e-9, `drift ${kd.x - x0}`);
});

// ---------------------------------------------------------------- phase 5: a CPU that confirms, punishes and blocks
// The targets of gameplay-audit.md phase 5, measured by CPU versus CPU over seeds 1-3 of 60 s. Combo targets read
// longestConfirm (no super-beam hits), as the phase 0 notes say. Staged scenarios use well-mixed seeds, because
// xorshift32's first draws from small seeds are near zero and would decide every first roll the same way.
const CPU_SEEDS = [1, 2, 3];
const mixedSeeds = count => Array.from({ length: count }, (_, i) => (Math.imul(i + 1, 0x9e3779b1) >>> 0) || 1);
const cpuRuns = (level, options = {}) => CPU_SEEDS.map(seed => M.cpuVsCpu(E, { level, seed, seconds: 60, ...options }));
const slotSum = (runs, slot, key) => runs.reduce((sum, run) => sum + run.slots[slot][key], 0);
const blockRate = (runs, slot) => slotSum(runs, slot, 'strikeBlocks') / slotSum(runs, slot, 'strikesFaced');
// Slot 0 scripted, slot 1 the CPU `gap` units in front; watch(state, before, frame) returns the outcome or null.
function cpuStage(level, seed, gap, script, frames, watch, arrange) {
  const s = E.create(['p', 'c'], { cpuSlots: [false, true], seed, cpuLevel: level });
  s.phase = 'fight'; s.message = '';
  const [p, c] = s.fighters; p.x = 500; c.x = 500 + gap; p.facing = 1; c.facing = -1;
  if (arrange) arrange(s);
  for (let t = 0; t < frames; t++) {
    const before = JSON.parse(JSON.stringify(s.fighters));
    E.tick(s, [script(s, t) || {}, {}]);
    const out = watch(s, before, t);
    if (out !== null) return out;
  }
  return false;
}
const stagedCount = (level, ...args) => mixedSeeds(20).filter(seed => cpuStage(level, seed, ...args) === true).length;

test('phase 5: CPU levels are set per slot, and cpuLevel alone sets both', () => {
  assert.deepEqual(E.create(['a', 'b'], { cpuLevels: [8, 1] }).options.cpuLevels, [8, 1]);
  assert.deepEqual(E.create(['a', 'b'], { cpuLevel: 6 }).options.cpuLevels, [6, 6]);
  assert.deepEqual(E.create(['a', 'b'], { cpuLevels: [12, 0] }).options.cpuLevels, [8, 4], 'Out-of-range levels clamp to 1-8, a missing one falls back to cpuLevel');
  const run = M.cpuVsCpu(E, { seed: 1, levels: [8, 1], seconds: 5 });
  assert.equal(run.perSlotLevels, true); assert.deepEqual(run.levelsApplied, [8, 1]);
});

test('phase 5: level-4 CPUs confirm, block 40-80 %, whiff-punish, anti-air and keep to 8 specials a minute', () => {
  const runs = cpuRuns(4);
  const confirms = runs.map(run => run.totals.longestConfirm);
  assert.ok(confirms.every(n => n >= 4), `Longest confirm of 4 or more in every seed: ${confirms}`);
  assert.ok(confirms.some(n => n >= 5), `Longest confirm of 5 or more in one seed: ${confirms}`);
  for (const slot of [0, 1]) {
    const rate = blockRate(runs, slot);
    assert.ok(rate >= .4 && rate <= .8, `CPU ${slot} blocks ${(rate * 100).toFixed(1)} % of the strikes that reach it`);
    assert.ok(slotSum(runs, slot, 'whiffPunishes') >= 1, `CPU ${slot} whiff-punishes across the seeds`);
    assert.ok(slotSum(runs, slot, 'antiAirs') >= 1, `CPU ${slot} anti-airs across the seeds`);
    for (const run of runs) assert.ok(run.slots[slot].specialsPerMinute <= 8, `CPU ${slot} starts ${run.slots[slot].specialsPerMinute} specials a minute (seed ${run.seed})`);
  }
});

test('phase 5: a level-1 CPU blocks under 15 % and never combos past two hits', () => {
  const runs = cpuRuns(1);
  for (const slot of [0, 1]) {
    const rate = blockRate(runs, slot);
    assert.ok(rate < .15, `CPU ${slot} blocks ${(rate * 100).toFixed(1)} %`);
    for (const run of runs) assert.ok(run.slots[slot].longestConfirm <= 2, `CPU ${slot} confirms ${run.slots[slot].longestConfirm} hits (seed ${run.seed})`);
  }
});

test('phase 5: level 8 beats level 1 in at least four of five seeded matches, from either slot', () => {
  for (const [levels, winner] of [[[8, 1], 0], [[1, 8], 1]]) {
    const matches = [1, 2, 3, 4, 5].map(seed => M.cpuVsCpu(E, { levels, seed, match: true }));
    assert.ok(matches.every(match => match.matchOver), 'Every match finishes');
    const won = matches.filter(match => match.winner === winner).length;
    assert.ok(won >= 4, `Level 8 in slot ${winner} wins ${won} of 5`);
  }
});

test('phase 5: staged CPU reactions scale with level: throw escapes, whiff punishes, anti-airs and guard cancels', () => {
  const thrown = level => stagedCount(level, 70, (s, t) => t === 0 ? { right: true, heavy: true } : {}, 30,
    s => s.effects.some(e => e.type === 'banner' && e.text === 'THROW ESCAPE') ? true : s.fighters[1].launched ? false : null);
  // A roundhouse whiffed from 175 units, punished when the CPU hits it during its recovery (the heavy reaches the leg).
  const punished = level => stagedCount(level, 175, (s, t) => t === 0 ? { right: true, kick: true } : {}, 60,
    (s, before) => freshOf(s, 'hit', 1).length ? before[0].move === 'roundhouse' : before[0].move && !s.fighters[0].move ? false : null);
  // A forward jump-in from 230 with an air heavy on the way down, anti-aired when the CPU hits it in the air.
  const jumpIn = (s, t) => {
    const p = s.fighters[0];
    if (t < 6) return { jump: true, right: true };
    if (p.y > 0 && p.y < 110 && p.vy < 0 && !p.move) return { heavy: true };
  };
  const antiAired = level => stagedCount(level, 230, jumpIn, 90, (s, before) => freshOf(s, 'hit', 1).length ? before[0].y > 0
    : freshOf(s, 'hit', 0).length || freshOf(s, 'block', 0).length || before[0].y > 0 && s.fighters[0].y === 0 ? false : null);
  // A heavy punch blocked from 100 units by a CPU that holds a stock (told to guard).
  const cancelled = level => stagedCount(level, 100, (s, t) => t === 0 ? { heavy: true } : {}, 40, s => ['gcRoll', 'gcBlowback'].includes(s.fighters[1].move) ? true : null,
    s => { s.fighters[1].stocks = 1; Object.assign(s.cpuMemory[1], { started: true, guardUntil: 999 }); });
  const [tech1, tech8] = [thrown(1), thrown(8)], [punish1, punish8] = [punished(1), punished(8)], [air1, air8] = [antiAired(1), antiAired(8)];
  assert.ok(tech1 <= 7 && tech8 >= 12, `Throw escapes in 20 seeds: level 1 ${tech1}, level 8 ${tech8}`);
  assert.ok(punish1 <= 10 && punish8 >= 16, `Whiff punishes of a roundhouse: level 1 ${punish1}, level 8 ${punish8}`);
  assert.ok(air1 <= 10 && air8 >= 16, `Anti-airs of a jump-in: level 1 ${air1}, level 8 ${air8}`);
  assert.equal(cancelled(5), 0, 'No guard cancel below level 6');
  assert.ok(cancelled(8) >= 1, 'Level 8 guard-cancels with a stock');
});

test('phase 5: the CPU guards by height: crouching against a grounded opponent, standing against a jump it has seen', () => {
  const told = s => Object.assign(s.cpuMemory[1], { started: true, guardUntil: 999 });
  for (const level of [1, 4, 8]) {
    const crouches = stagedCount(level, 150, () => ({}), 12, (s, before, t) => t === 11 ? s.fighters[1].crouching && !!s.fighters[1].lastInput.right : null, told);
    const reaction = Math.max(2, 14 - 1.5 * level);
    const stands = stagedCount(level, 300, (s, t) => t < 6 ? { jump: true, right: true } : {}, 40,
      s => s.motionFrame > reaction + 8 && s.fighters[0].y > 0 && s.fighters[0].y < 120 ? !s.fighters[1].crouching && !!s.fighters[1].lastInput.right : null, told);
    assert.deepEqual([crouches, stands], [20, 20], `Level ${level}`);
  }
  // In CPU versus CPU every block of a sweep is crouching and every block of an air normal standing.
  let lows = 0, highs = 0;
  for (const level of [4, 8]) for (const seed of CPU_SEEDS) {
    const s = E.create(['a', 'b'], { cpuSlots: [true, true], seed, cpuLevel: level }); s.phase = 'fight'; s.message = '';
    for (let t = 0; t < 3600 && s.phase !== 'matchover'; t++) {
      E.tick(s, [{}, {}]);
      for (const e of freshOf(s, 'block')) {
        const a = s.fighters[e.attacker], d = s.fighters[1 - e.attacker], height = a?.move && E.moveData(a).height;
        if (height === 'low') { lows++; assert.ok(d.crouching || d.blockStunAtStart, 'A sweep is blocked crouching'); }
        if (height === 'high') { highs++; assert.ok(!d.crouching || d.blockStunAtStart, 'An air normal is blocked standing'); }
      }
    }
  }
  assert.ok(lows > 0 && highs > 0, `CPUs blocked ${lows} sweeps and ${highs} air normals`);
});

test('phase 5: supers only punish, finish a combo or the round, or come in desperation; taunts need a 30 % lead at range', () => {
  const contexts = { combo: 0, punish: 0, desperate: 0, finish: 0 };
  for (const level of [4, 8]) for (const styles of [['balanced', 'balanced'], ['zoner', 'speed'], ['grappler', 'boss']]) for (const seed of [1, 2]) {
    const profiles = { a: { style: styles[0], boss: styles[0] === 'boss' }, b: { style: styles[1], boss: styles[1] === 'boss' } };
    const s = E.create(['a', 'b'], { cpuSlots: [true, true], seed, cpuLevel: level, profiles }); s.phase = 'fight'; s.message = '';
    for (let t = 0; t < 3600 && s.phase !== 'matchover'; t++) {
      const before = JSON.parse(JSON.stringify(s.fighters));
      E.tick(s, [{}, {}]);
      s.fighters.forEach((f, i) => {
        const me = before[i], foe = before[1 - i], data = foe.move && E.moveData(foe);
        if (f.move === 'super' && me.move !== 'super') {
          const kind = foe.stun > 0 && !foe.blockStun || foe.launched ? 'combo' : data && foe.moveFrame >= data.startup + data.active ? 'punish'
            : me.hp <= E.MAX_HP / 4 ? 'desperate' : foe.hp <= 200 ? 'finish' : null;
          assert.ok(kind, `A super at ${t} (level ${level}, ${styles}) against ${foe.move || 'an idle opponent'} at ${foe.hp}`);
          contexts[kind]++;
        }
        if (f.move === 'taunt' && me.move !== 'taunt') assert.ok(me.hp - foe.hp >= .3 * E.MAX_HP && Math.abs(me.x - foe.x) > 320, 'A taunt needs a 30 % lead at range');
      });
    }
  }
  assert.ok(contexts.combo > 0 && contexts.punish > 0, JSON.stringify(contexts));
  // With a 40 % lead and the opponent 420 units away, a CPU may taunt before it walks in.
  const taunts = mixedSeeds(8).filter(seed => cpuStage(4, seed, 420, () => ({}), 300, s => s.fighters[1].move === 'taunt' ? true : null,
    s => { s.fighters[0].hp = 500; s.fighters[1].hp = 900; })).length;
  assert.ok(taunts >= 1, `${taunts} of 8 CPUs taunted`);
});

test('phase 5: spacing follows the style: zoners keep their range, grapplers crowd', () => {
  const median = style => {
    const gaps = [];
    for (const seed of [1, 2]) {
      const s = E.create(['a', 'b'], { cpuSlots: [true, true], seed, cpuLevel: 4, profiles: { a: { style }, b: { style } } }); s.phase = 'fight'; s.message = '';
      for (let t = 0; t < 3600 && s.phase === 'fight'; t++) {
        E.tick(s, [{}, {}]);
        if (s.fighters.every(f => !f.move && !f.stun && f.y === 0) && !s.cpuMemory.some(m => m.script)) gaps.push(Math.abs(s.fighters[0].x - s.fighters[1].x));
      }
    }
    return gaps.sort((a, b) => a - b)[gaps.length >> 1];
  };
  const [zoner, trickster, balanced, grappler] = ['zoner', 'trickster', 'balanced', 'grappler'].map(median);
  assert.ok(zoner >= 300 && trickster >= 190 && trickster < zoner && balanced >= 130 && balanced < trickster && grappler < balanced,
    `Median gaps in mirror matches: zoner ${zoner}, trickster ${trickster}, balanced ${balanced}, grappler ${grappler}`);
});

test('phase 5: CPU memory is plain JSON, starts afresh every round and replays exactly; the launcher route ends cleanly', () => {
  let s = null, checked = 0, launchersEnded = 0, leakedJumps = 0;
  for (const seed of [9, 10, 11, 12]) {
    s = E.create(['a', 'b'], { cpuSlots: [true, true], seed, cpuLevel: 6 }); s.phase = 'fight'; s.message = '';
    const launchEnd = [-99, -99];
    for (let t = 0; t < 4000 && s.phase !== 'matchover'; t++) {
      if (t % 400 === 199) {
        // A JSON round trip of the whole state (CPU memory included) continues exactly as the original.
        const copy = JSON.parse(JSON.stringify(s));
        for (let k = 0; k < 120; k++) { E.tick(s, [{}, {}]); E.tick(copy, [{}, {}]); }
        assert.equal(JSON.stringify(copy), JSON.stringify(s)); checked++;
      }
      const before = s.fighters.map(f => [f.move, f.moveVariant]);
      E.tick(s, [{}, {}]);
      s.fighters.forEach((f, i) => {
        // Without the phase 4 super-jump cancel the launcher route stops at the launcher: no jump leaks out of it.
        if (before[i][0] === 'heavy' && before[i][1] === 'crouch' && !f.move && f.y === 0) { launchEnd[i] = t; launchersEnded++; }
        if (f.jumpSquat === 4 && t - launchEnd[i] <= 2) leakedJumps++;
      });
    }
  }
  assert.ok(checked >= 20); assert.ok(launchersEnded > 0, 'Level-6 CPUs launch'); assert.equal(leakedJumps, 0);
  // A new round rebuilds the memory; only the special budget carries over.
  s.cpuMemory[0].tokens = 1.5; s.cpuMemory[0].script = { steps: ['5A'] };
  E.resetRound(s);
  assert.equal(s.cpuMemory[0].tokens, 1.5); assert.equal(s.cpuMemory[0].script, null); assert.deepEqual(s.cpuMemory[0].plan, []);
  const replay = () => M.cpuVsCpu(E, { level: 4, seed: 2, seconds: 30 });
  assert.deepEqual(replay(), replay());
});

// Scripted players in slot 0 against the CPU in slot 1 for one round of up to 60 s: [player life, CPU life, seconds].
function versusPlayer(level, seed, play) {
  const s = E.create(['p', 'c'], { cpuSlots: [false, true], seed, cpuLevel: level, roundsToWin: 1 }); s.phase = 'fight'; s.message = '';
  let t = 0;
  for (; t < 3600 && s.phase === 'fight'; t++) E.tick(s, [play(s, t) || {}, {}]);
  return [s.fighters[0].hp, s.fighters[1].hp, t / 60];
}
const awayFrom = s => s.fighters[1].x > s.fighters[0].x ? 'left' : 'right', towardOf = s => awayFrom(s) === 'left' ? 'right' : 'left';

test('phase 5: the CPU answers safe pressure and opens a player who only blocks; committed inputs hold through hitstop', () => {
  const seeds = mixedSeeds(4);
  // Mashed jabs at point blank, walking in when out of reach: the jab is +1 on block, so guarding alone never ends it.
  const masher = (s, t) => Math.abs(s.fighters[1].x - s.fighters[0].x) > 90 ? { [towardOf(s)]: true } : t % 6 < 3 ? { punch: true } : {};
  const mashed = seeds.map(seed => versusPlayer(8, seed, masher));
  assert.ok(mashed.every(([player]) => player === 0), `Level 8 knocks out a jab masher: ${JSON.stringify(mashed)}`);
  assert.ok(mashed.reduce((sum, [, cpu]) => sum + cpu, 0) / mashed.length > .7 * E.MAX_HP, 'and loses under 30 % of its life on average');
  // A crouching guard is opened by throws and jump-ins, a standing guard by throws and sweeps; an idle player falls
  // faster to a stronger CPU, which does not guard against an opponent that never attacks.
  const crouching = s => ({ down: true, [awayFrom(s)]: true }), standing = s => ({ [awayFrom(s)]: true });
  for (const [name, play, level, limit] of [['crouching', crouching, 8, 40], ['standing', standing, 8, 40], ['crouching', crouching, 4, 60]]) {
    const runs = seeds.map(seed => versusPlayer(level, seed, play));
    assert.ok(runs.every(([player, , seconds]) => player === 0 && seconds <= limit), `Level ${level} opens a ${name} guard within ${limit} s: ${JSON.stringify(runs)}`);
  }
  const idleTime = level => seeds.reduce((sum, seed) => sum + versusPlayer(level, seed, () => ({}))[2], 0);
  assert.ok(idleTime(8) < idleTime(1), 'An idle player falls faster to level 8 than to level 1');
  // A hitstop frame does not simulate, so it holds a committed sequence (here a forward jump's press and squat) unused.
  const s = E.create(['p', 'c'], { cpuSlots: [false, true], seed: 5, cpuLevel: 4 }); s.phase = 'fight'; s.message = '';
  Object.assign(s.cpuMemory[1], { started: true, next: 999, plan: Array.from({ length: 5 }, () => ({ jump: true, left: true })) });
  s.hitstop = 3;
  for (let t = 0; t < 3; t++) E.tick(s, [{}, {}]);
  assert.equal(s.cpuMemory[1].plan.length, 5, 'No planned input is used up during hitstop');
  for (let t = 0; t < 6 && !(s.fighters[1].y > 0); t++) E.tick(s, [{}, {}]);
  const c = s.fighters[1];
  assert.ok(c.y > 0 && !c.hop && c.airVX < 0, `A full jump toward the left (y ${c.y}, hop ${c.hop}, airVX ${c.airVX})`);
});

// ---------------------------------------------------------------- integration of phases 4, 5 and 6
// Phase 4 (the launcher's super-jump cancel, the float and the air chain), phase 5 (the CPU) and phase 6 (the feel
// effects and the one-button F by direction) were built in parallel; these tests hold them together.
const A = require('../public/anim.js');
const CPU_LAUNCH_STYLES = Object.keys(E.STYLES).filter(style => style !== 'boss');
// Every CPU launcher hit in CPU versus CPU, levels 5-8 with the styles in rotation (seed i + 1 for the i-th pairing):
// where the victim stood, whether the super jump came (and its 'superjump' effect), and how many air hits followed.
const cpuLaunches = () => {
  const launches = [];
  for (const level of [5, 6, 7, 8]) CPU_LAUNCH_STYLES.forEach((style, i) => {
    const styles = [style, CPU_LAUNCH_STYLES[(i + 1) % CPU_LAUNCH_STYLES.length]];
    let watch = null;
    M.cpuVsCpu(E, { level, seed: i + 1, seconds: 60, styles, inputs: s => {
      if (s.phase !== 'fight') { if (watch) launches.push({ ...watch, ko: true }); watch = null; return [{}, {}]; }
      for (let slot = 0; slot < 2 && !watch; slot++) {
        const f = s.fighters[slot], v = s.fighters[1 - slot];
        if (f.move === 'heavy' && f.moveVariant === 'crouch' && f.hitConfirmed && v.launched && v.floating) watch = { level, style: styles[slot], slot, at: s.frame, from: v.y, hp: v.hp, superJump: false, effect: false, airHits: 0 };
      }
      if (watch) {
        const f = s.fighters[watch.slot], v = s.fighters[1 - watch.slot];
        if (f.superJump && f.y > 0) watch.superJump = true;
        if (s.effects.some(e => e.type === 'superjump' && e.slot === watch.slot)) watch.effect = true;
        if (v.hp < watch.hp) { if (f.y > 0 && f.moveVariant === 'air') watch.airHits++; watch.hp = v.hp; }
        if (v.y === 0 && s.frame - watch.at > 5) { launches.push(watch); watch = null; }
      }
      return [{}, {}];
    } });
  });
  return launches;
};
// The frame after a CPU's launcher hit, staged for `style` in `slot` at point blank (midscreen, or with the victim in the
// corner), the victim floating up from `from`, the CPU on the 'sj' step of its level 5+ route. Returns whether it
// super-jumped and how many air hits it landed.
const stagedLaunch = (style, slot, { from = 1, corner = false } = {}) => {
  const s = E.create(['p1', 'p2'], { cpuSlots: [slot === 0, slot === 1], seed: 7, cpuLevel: 6, profiles: { p1: { style }, p2: { style } } });
  s.phase = 'fight'; s.message = '';
  const c = s.fighters[slot], v = s.fighters[1 - slot], data = E.VARIANTS.crouch.heavy, dir = slot ? -1 : 1;
  const edge = dir > 0 ? E.WIDTH - E.WALL : E.WALL;
  v.x = corner ? edge : E.WIDTH / 2 + dir * M.POINT_BLANK / 2; c.x = v.x - dir * M.POINT_BLANK; c.facing = dir; v.facing = -dir;
  Object.assign(c, { move: 'heavy', moveVariant: 'crouch', moveFrame: data.startup, connected: true, hitConfirmed: true, hitDone: true, crouching: true, pose: 'launcher' });
  Object.assign(v, { y: from, vy: data.launch, launched: true, floating: true, juggled: false, juggle: from > 1 ? 1 : 0, stun: 30, pose: 'tumble' });
  s.hitstop = 9;
  Object.assign(s.cpuMemory[slot], { started: true, next: 1e9, tokens: 3, script: { steps: ['2D', 'sj', 'j.A', 'j.S', 'j.D'], at: 1, started: false, since: s.motionFrame,
    prev: ['heavy', data.startup], frame: data.startup, stage: 0, blocked: 0, flew: false, trap: false, gap: 0, wait: false } });
  let superJump = false, airHits = 0, hp = v.hp;
  for (let t = 0; t < 120; t++) {
    E.tick(s, [{}, {}]);
    if (c.superJump && c.y > 0) superJump = true;
    if (v.hp < hp) { if (c.moveVariant === 'air') airHits++; hp = v.hp; }
  }
  return { superJump, airHits };
};

test('integration: from level 5 the CPU follows a launcher hit with the super jump and lands air A > S > D', () => {
  const launches = cpuLaunches(), ground = launches.filter(l => l.from <= 1);
  assert.ok(launches.length >= 10 && ground.length >= 8, `${launches.length} launches, ${ground.length} from the ground`);
  // Every launch from the ground super-jumps (with its takeoff effect) into the full air chain, unless a hit K.O.s.
  const missed = ground.filter(l => !l.superJump || !l.effect || l.airHits < 3 && !l.ko);
  assert.deepEqual(missed, [], 'Every ground launch is followed by the super jump and three air hits');
  // A super jump is only taken when it reaches: none of them comes down empty.
  assert.deepEqual(launches.filter(l => l.superJump && l.airHits === 0 && !l.ko), [], 'No super jump whiffs');
  // Staged for every style from either slot: a ground launch, midscreen or into the corner, gets the super jump and the
  // air chain; a launch from high up (an anti-air) floats out of the jump's reach, so the CPU stays on the ground.
  for (const style of CPU_LAUNCH_STYLES) for (const slot of [0, 1]) {
    for (const corner of [false, true]) assert.deepEqual(stagedLaunch(style, slot, { corner }), { superJump: true, airHits: 3 }, `${style}, slot ${slot}${corner ? ', corner' : ''}`);
    assert.deepEqual(stagedLaunch(style, slot, { from: 215 }), { superJump: false, airHits: 0 }, `${style}, slot ${slot}: a launch from 215 up`);
  }
});

test('integration: after a launch the CPU ends a combo with a rush, the rekka or the rising strike, never a shot or the super', () => {
  // Level 6 holding a stock (it would spend it on a super ender) and a full special budget, the 2D > ender route staged
  // at point blank against an idle opponent: the launcher's float lifts the victim over shots and the beam.
  for (const style of CPU_LAUNCH_STYLES) {
    const s = E.create(['p1', 'p2'], { cpuSlots: [true, false], seed: 7, cpuLevel: 6, profiles: { p1: { style }, p2: { style } } });
    s.phase = 'fight'; s.message = '';
    const [c, v] = s.fighters; c.x = E.WIDTH / 2 - M.POINT_BLANK / 2; v.x = c.x + M.POINT_BLANK; c.stocks = 1;
    Object.assign(s.cpuMemory[0], { started: true, next: 1e9, tokens: 3, script: { steps: ['2D', 'ender'], at: 0, started: false, since: 0, prev: [null, 0], frame: 0, stage: 0, blocked: 0, flew: false, trap: false, gap: 0, wait: false } });
    const moves = [];
    let combo = 0;
    for (let t = 0; t < 90; t++) { E.tick(s, [{}, {}]); if (c.move && !moves.includes(c.move)) moves.push(c.move); combo = Math.max(combo, v.combo); }
    // The ender, then (once the victim is down) the CPU's own wake-up pressure, never a shot or the super.
    assert.equal(moves[0], 'heavy', `${style}: ${moves}`);
    assert.ok(['rush', 'armorRush', 'rekka', 'rising'].includes(moves[1]), `${style}: ${moves}`);
    assert.ok(!moves.some(move => ['super', 'special', 'fireball', 'fastball', 'doubleball', 'skyshot'].includes(move)), `${style}: ${moves}`);
    assert.ok(combo >= 2, `${style}: the ${moves[1]} connects (combo ${combo})`);
    assert.equal(c.stocks, 1, `${style}: the stock is kept`);
  }
});

test('integration: the launcher super jump emits its effect and trails; counters, F by direction and a K.O. work with it', () => {
  // The super-jump cancel has no squat, so it emits 'superjump' itself: once, on the takeoff tick, at the attacker's feet.
  // The afterimage trail runs from takeoff to landing, the air chain included.
  const s = M.arena(E), [a, d] = s.fighters, takeoffs = [], rows = [];
  for (let t = 0; t < 140; t++) {
    const x = a.x;
    E.tick(s, [COMBO[t] || {}, {}]);
    for (const e of s.effects) if (e.type === 'superjump' && e.life === e.maxLife) takeoffs.push([t, e.x === x, e.y, e.slot]);
    rows.push({ t, y: a.y, superJump: a.superJump, trail: !!A.sample(a, s).trail });
  }
  assert.deepEqual(takeoffs, [[25, true, E.GROUND, 0]]);
  const airborne = rows.filter(row => row.y > 0);
  assert.equal(airborne[0].t, 25);
  assert.ok(airborne.length > 40 && airborne.every(row => row.superJump && row.trail), 'Every airborne tick of the super jump trails');
  assert.equal(rows.at(-1).superJump, false);
  assert.ok(d.hp < E.MAX_HP);
  // A counter-hit launcher (the victim is in its heavy punch's startup) emits 'counter' and holds 9 + 2 frames; the
  // super jump still leaves on the first frame after the hitstop, and the air jab lands.
  const counter = play((st, t) => {
    if (t === 0) Object.assign(st.fighters[1], { move: 'heavy', moveVariant: 'standing', moveFrame: 0 });
    if (t < 7) return { down: true, heavy: t === 0 };
    return st.fighters[0].y === 0 ? { jump: true } : st.fighters[0].y > 0 && !st.fighters[0].move ? { punch: true } : {};
  }, { ticks: 60 });
  const launch = counter.log.findIndex(row => row.hits.length);
  assert.equal(counter.log[launch].variant, 'crouch');
  assert.equal(counter.log.findIndex(row => row.ay > 0), launch + 9 + 2 + 1, 'Takeoff on the first frame after the counter hitstop');
  assert.ok(counter.log.some(row => row.variant === 'air' && row.hits.length), 'The air jab lands after the counter launch');
  const countered = M.arena(E);
  for (let t = 0; t < 12; t++) {
    if (t === 0) Object.assign(countered.fighters[1], { move: 'heavy', moveVariant: 'standing', moveFrame: 0 });
    E.tick(countered, [t < 7 ? { down: true, heavy: t === 0 } : {}, {}]);
    if (freshOf(countered, 'counter').length) { assert.equal(countered.hitstop, 9 + 2); break; }
    assert.ok(t < 11, 'The launcher counter-hits');
  }
  // F by direction from the launcher on hit: down + F cancels into the rising strike (every style) and toward + F into
  // the style's 214 rush (rush, armored rush, rhythm rush), each juggling the floating victim for a second hit.
  const cancel = (style, dir) => {
    const st = M.arena(E, { styles: [style] }), [f, v] = st.fighters, moves = [];
    let combo = 0;
    for (let t = 0; t < 60; t++) {
      E.tick(st, [t === 0 ? { down: true, heavy: true } : t < 12 ? { down: true } : t === 12 ? { ...dir, special: true } : t < 20 ? dir : {}, {}]);
      if (f.move && !moves.includes(f.move)) moves.push(f.move);
      combo = Math.max(combo, v.combo);
    }
    return [moves, combo];
  };
  for (const style of CPU_LAUNCH_STYLES) assert.deepEqual(cancel(style, { down: true }), [['heavy', 'rising'], 2], `${style}: 2D > 2F`);
  for (const [style, move] of [['balanced', 'rush'], ['power', 'armorRush'], ['speed', 'rekka']]) assert.deepEqual(cancel(style, { right: true }), [['heavy', move], 2], `${style}: 2D > 6F`);
  // F in the air: pressed in the air heavy's hitstop at the end of the air chain it cancels into the shot, in the air.
  const shot = play({ ...COMBO, 54: { special: true } }, { ticks: 80 });
  const fired = shot.log.find(row => row.move === 'special');
  assert.ok(fired && fired.ay > 0, 'j.D > F starts the shot in the air');
  // A K.O. by the air jab: the 24-frame freeze, then 36 ticks of slow motion while the floating victim falls under its
  // lighter gravity; it lands with the float cleared, and the round ends 24 + 170 ticks after the K.O., as without it.
  const k = M.arena(E), [, kv] = k.fighters; kv.hp = 100;
  let ko = -1, slow = 0, landed = -1, next = -1;
  for (let t = 0; t < 320 && next < 0; t++) {
    const before = k.slowMotion;
    E.tick(k, [COMBO[t] || {}, {}]);
    if (ko < 0 && k.phase === 'roundover') { ko = t; assert.ok(kv.floating && kv.y > 0, 'K.O. mid float'); }
    if (k.slowMotion < before) slow++;
    if (ko >= 0 && landed < 0 && kv.y === 0) landed = t;
    if (ko >= 0 && k.phase !== 'roundover') next = t;
  }
  assert.ok(ko > 0 && landed > ko, `K.O. on ${ko}, landed on ${landed}`);
  assert.equal(slow, 36, 'Thirty-six ticks of slow motion');
  assert.equal(kv.floating, false);
  assert.equal(next - ko, 24 + 170);
});

test('phase 4: a launcher that hit refuses shot and super cancels (the victim floats above them); on block they cancel', () => {
  const started = { '236A': 'fireball', F: 'special', 'F+D': 'super' };
  for (const blocked of [false, true]) for (const next of Object.keys(started)) {
    const s = M.arena(E, { distance: 80, stocks: [1, 0] }), [a, d] = s.fighters, queue = M.inputFrames('2D');
    // The follow-up is entered once, right after contact; a cancel is the move replacing the launcher mid-move.
    let contact = false, entered = false, cancelled = false;
    for (let t = 0; t < 40; t++) {
      if (contact && !entered) { queue.push(...M.inputFrames(next)); entered = true; }
      const before = a.move;
      E.tick(s, [queue.length ? queue.shift() : {}, blocked ? { right: true } : {}]);
      contact = contact || (blocked ? d.blockStun : d.launched);
      if (before === 'heavy' && a.move === started[next]) cancelled = true;
    }
    assert.ok(contact, `the launcher ${blocked ? 'is blocked' : 'launches'}`);
    assert.equal(cancelled, blocked, `${blocked ? 'blocked' : 'hit'} launcher ${blocked ? 'cancels' : 'refuses to cancel'} into ${next}`);
    if (!blocked) assert.equal(a.stocks, 1, `the refused ${next} spends no stock`);
  }
});
