#!/usr/bin/env node
// Gameplay probe: measures our engine (and dad-fighter-z's when that repo is present) with identical experiments.
// Usage: node build/tools/gameplay-probe.cjs [--engine <engine.js>] [--json]
//        (DFZ_REPO=<path to dad-fighter-z-repo> to point at the reference)
// The measurements live in build/tools/lib/gameplay-metrics.cjs; gameplay-audit.md quotes this report and
// build/test/gameplay-metrics.test.cjs turns its numbers into assertions phase by phase.
const path = require('node:path');
const M = require('./lib/gameplay-metrics.cjs');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const E = require(path.resolve(option('--engine') || path.join(__dirname, '../public/engine.js')));
const D = M.loadReference();
const BODY = M.bodyHeight(E), LIFE = M.maxLife(E), DBODY = 285; // body heights used as the unit
const pct = (v, body) => (100 * v / body).toFixed(1) + '%';
const seeds = [1, 2, 3], level = 4;

// --- measurements
const normals = M.discover(E).filter(entry => entry.kind === 'normal' || entry.kind === 'air').map(entry => M.measureMove(E, { input: entry.input }));
const jump = M.jumps(E);
// Phase 4's combo, 2A > 2D > up inside the launcher's cancel window > j.A > j.S > j.D, and the same opening without that
// input: a jump or a super jump once the launcher has recovered, or a second launcher once the victim has landed.
const LAUNCH_STARTER = ['2A'];
const launch = M.launcherFollowUp(E, { starter: LAUNCH_STARTER }), superLaunch = M.launcherFollowUp(E, { route: 'superjump', starter: LAUNCH_STARTER, relaunch: true });
const freeSuper = M.launcherFollowUp(E, { route: 'freesuper', starter: LAUNCH_STARTER }), relaunch = M.launcherFollowUp(E, { route: 'stay', starter: LAUNCH_STARTER, relaunch: true });
const chains = [['5A', '5S', '5D', '5F'], ['5A', '5S', '5D', '236A'], ['5A', '5A']].map(steps => ({ steps, run: M.chain(E, steps) }));
const pacing = M.healthPacing(E), neutral = M.neutralMeter(E);
const throwRow = M.measureMove(E, { input: '6D', block: false }), superRow = M.measureMove(E, { input: 'F+D', block: false });
const cpu = seeds.map(seed => M.cpuVsCpu(E, { seed, level, seconds: 60 }));
const shape = M.hitShape(E, { moves: ['5A', '2S', '2D'], heights: [0, 7, 9, 60, 89, 135, 144, 146, 175, 219, 221] });
const crouching = ['5A', '5S', '6S', '5D', '2S'].map(move => [move, M.hitAt(E, { move, crouch: true })]);
const antiAir = ['5A', '5S', '5D', 'j.A', 'j.S', 'j.D'].map(move => [move, M.hitAt(E, { move, height: 60, detail: true })]);
// Air kick against a standing opponent from two heights, and shots against a croucher and jumpers 300 units away.
const airKick = [150, 240].map(height => [height, M.hitAt(E, { move: 'j.S', attackerHeight: height })]);
const shots = [['crouching', { crouch: true }], ['feet at 94', { height: 94 }], ['feet at 96', { height: 96 }]].map(([label, c]) => [label, M.hitAt(E, { move: '5F', distance: 300, ...c })]);
// Jumping a projectile: per jumper style, shot (from a balanced shooter), distance and jump kind, the press timings out of
// the 0-110 frames after the shot is pressed that clear it (gameplay-metrics.cjs projectileJump).
const JUMP_STYLES = Object.keys(E.STYLES || { balanced: 1 }), SHOT_DISTANCES = [250, 350, 450];
const projectileJumps = JUMP_STYLES.flatMap(style => ['5F', '236A'].flatMap(shot => M.JUMP_KINDS.flatMap(kind => SHOT_DISTANCES.map(distance => {
  const { timings, clears } = M.projectileJump(E, { style, shot, distance, jump: kind });
  return { style, shot, distance, jump: kind, clears, timings };
}))));

if (args.includes('--json')) console.log(JSON.stringify({ maxLife: LIFE, bodyHeight: BODY, normals, jumps: jump, launcher: { jump: launch, superjump: superLaunch, freesuper: freeSuper, stay: relaunch }, chains, pacing, neutral, cpu, shape, crouching: Object.fromEntries(crouching), antiAir: Object.fromEntries(antiAir), airKick: Object.fromEntries(airKick), shots: Object.fromEntries(shots), projectileJumps, reference: !!D }, null, 2));
else printReport();

function printReport() {
  // --- normals: total frames, hitstun/blockstun, frame advantage (simulated)
  const stunText = (stun, advantage, air) => `${String(stun ?? '-').padStart(2)} (${air ? 'air' : M.signed(advantage)})`;
  console.log('== OURS normals (frames): total, startup, hitstun, +hit, blockstun, +block, slide, damage');
  for (const n of normals) {
    const label = `${n.input.padEnd(4)}${(n.move + (n.variant === 'standing' ? '' : '/' + n.variant)).padEnd(13)}`;
    const slide = n.slide === null ? '-' : `${pct(n.slide, BODY)} over ${n.slideFrames}f`;
    console.log(`${label} total ${String(n.total).padStart(2)}  startup ${String(n.startup).padStart(2)}  hitstun ${stunText(n.hitstun, n.advantageHit, n.airborne)}  blockstun ${stunText(n.blockstun, n.advantageBlock, n.airborne)}  slide ${slide}  dmg ${M.percent(n.damage)}`);
  }
  console.log('(every move: node build/tools/frame-data.cjs)');
  if (D) {
    console.log('\n== DFZ normals (from table): total, startup, hitstun, +hit, blockstun, +block, pushback, damage');
    for (const key of ['LP', 'LK', 'HP', 'HK', 'cLP', 'cLK', 'cHP', 'cHK']) {
      const n = D.N[key], slide = n.push * 1.2 / (1 - .82);
      console.log(`${key.padEnd(8)} total ${String(n.s + n.a + n.r).padStart(2)}  startup ${String(n.s).padStart(2)}  hitstun ${String(n.hs).padStart(2)} (${n.hs ? (n.hs - n.a - n.r >= 0 ? '+' : '') + (n.hs - n.a - n.r) : 'launch/kd'})  blockstun ${String(n.bs).padStart(2)} (${n.bs - n.a - n.r >= 0 ? '+' : ''}${n.bs - n.a - n.r})  push ${pct(slide, DBODY)} slide  dmg ${(n.dmg / 10).toFixed(1)}%`);
    }
  }

  // --- jumps
  const superText = jump.superJump.isSuper ? `, super jump ${jump.superJump.airtime}f apex ${M.percent(jump.superJump.apex)}` : ', no super jump';
  console.log(`\n== jumps\nOURS full ${jump.full.airtime}f apex ${M.percent(jump.full.apex)}, hop ${jump.hop.airtime}f apex ${M.percent(jump.hop.apex)}, squat ${jump.full.squat}f${superText}, air control: ${jump.airControl}, landing lag ${jump.landingLag.empty}f empty / ${jump.landingLag.attacked}f after an air attack`);
  if (D) {
    const dJump = vh => { let h = 0, v = vh, frames = 0, apex = 0; do { v -= D.C.GRAV; h += v; frames++; apex = Math.max(apex, h); } while (h > 0); return { frames, apex }; };
    const dj = dJump(D.C.JUMP_VH), dsj = dJump(D.C.SJUMP_VH);
    console.log(`DFZ  full ${dj.frames}f apex ${pct(dj.apex, DBODY)}, super ${dsj.frames}f apex ${pct(dsj.apex, DBODY)}, squat 3f, air control: committed arc (vx fixed at takeoff)`);
  }

  // --- projectile jumps: how many press timings clear a shot, per jumper style, shot, distance and jump kind
  console.log(`\n== projectile jumps (balanced shooter; press timings out of 0-110 frames after the shot that clear it, from ${SHOT_DISTANCES.join(' / ')} units)`);
  for (const style of JUMP_STYLES) for (const shot of ['5F', '236A']) {
    const cells = M.JUMP_KINDS.map(kind => `${kind} ${SHOT_DISTANCES.map(distance => projectileJumps.find(r => r.style === style && r.shot === shot && r.jump === kind && r.distance === distance).clears).join('/')}`);
    console.log(`OURS ${style.padEnd(9)} ${(shot === '5F' ? 'F shot' : '236A').padEnd(6)}  ${cells.join('  ')}`);
  }

  // --- launcher follow-up: can the launcher's owner land an air hit before the victim recovers?
  const followText = run => run.connects ? `${run.followUpHits} follow-up hit(s), combo ${run.combo}, ${M.percent(run.damage)} damage (first at ${run.firstFollowUpFrame}f)`
    : run.jumped ? `no follow-up connects (takeoff at ${run.takeoffFrame}f)` : 'no follow-up connects (the attacker never leaves the ground)';
  const relaunchText = run => !run.relaunch ? 'not tried' : !run.relaunch.hit ? 'whiffs on the downed victim' : run.relaunch.victimDown ? 'hits the downed victim' : 'hits only once the victim has got up (a new combo)';
  const opening = [...LAUNCH_STARTER, '2D'].join('>'), cancelled = superLaunch.superJump && superLaunch.takeoffFrame === 1 ? ' (super jump on the first free frame, no squat)' : '';
  console.log(`\n== launcher follow-up\nOURS ${opening} launch: victim airborne ${launch.victimAirtime}f, apex ${M.percent(launch.victimApex)}, recovers at ${launch.victimRecovered}f after the hit`);
  console.log(`OURS ${opening}, up inside the cancel window${cancelled} > j.A > j.S > j.D: ${followText(superLaunch)}`);
  console.log(`OURS ${opening}, jump when free > j.A > j.S > j.D: ${followText(launch)}`);
  console.log(`OURS ${opening}, super jump when free > j.A > j.S > j.D: ${followText(freeSuper)}`);
  console.log(`OURS second 2D once the victim has landed: ${relaunchText(relaunch)}; once both have landed after the air combo: ${relaunchText(superLaunch)}`);
  if (D) console.log('DFZ  cHP on hit cancels into super jump inside the 9f cancel window; air chain jLP>jLK>jHP>jHK (magic series) by design');

  // --- chains
  console.log('\n== chains (each step pressed on the frame after the previous one connects, point blank)');
  for (const { steps, run } of chains) {
    const stopped = run.steps.findIndex(step => step.result !== 'hit' && step.result !== 'block');
    const why = stopped < 0 ? '' : ` (step ${stopped + 1}, ${run.steps[stopped].input}: ${run.steps[stopped].result})`;
    console.log(`OURS ${steps.join('>')}: ${run.hits} hit${run.hits === 1 ? '' : 's'}, ${M.percent(run.damage)} damage, combo ${run.combo}${why}`);
  }
  if (D) {
    const dchain = ['LP', 'LK', 'HP', 'HK'].reduce((acc, k, i) => acc + Math.round(D.N[k].dmg * D.scaleFor(i, false)), 0);
    console.log(`DFZ  LP>LK>HP>HK: 4 hits, ${(dchain / 10).toFixed(1)}% damage, then special/hyper cancel; launcher > super jump > air chain`);
  }

  // --- health pacing
  const kill = pacing.hitsToKill === null ? `more than ${pacing.hits}` : pacing.hitsToKill;
  console.log(`\n== health pacing\nOURS ${LIFE} HP: jab ${M.percent(pacing.firstHitDamage)} -> ${kill} jabs to kill (measured); throw ${M.percent(throwRow.damage)}; super ${superRow.hits} hits ${M.percent(superRow.damage)}; 60 s of neutral builds ${neutral.max} gauge`);
  if (D) console.log(`DFZ  1000 HP: LP ${D.N.LP.dmg / 10}% -> ${Math.ceil(1000 / D.N.LP.dmg)} jabs; HK ${D.N.HK.dmg / 10}%; throw ${D.SP.throw.dmg / 10}%; hyper 9 x ${D.SP.hyperHit.dmg / 10}%`);

  // --- CPU vs CPU behaviour over 60 seconds, three seeds
  console.log(`\n== CPU vs CPU, 60 s at level ${level} (hits, blocks, longest combo and longest confirm without super-beam hits, throws, specials, supers; per CPU: block rate on strikes, whiff punishes, anti-airs)`);
  cpu.forEach((run, i) => {
    const t = run.totals, perSlot = run.slots.map((slot, n) => `P${n + 1} blocks ${M.percent(slot.blockRate, 0)} punish ${slot.whiffPunishes} anti-air ${slot.antiAirs}`).join(', ');
    console.log(`OURS seed ${seeds[i]}: hits ${t.hits} blocks ${t.blocks} combo ${t.longestCombo} (confirm ${t.longestConfirm}) throws ${t.throws} (${t.throwAttempts} tried) specials ${t.specials} supers ${t.supers} air attacks ${t.airAttacks} | ${perSlot} | winner ${run.winner === null ? 'none' : 'P' + (run.winner + 1)}`);
  });
  if (D) {
    const cpuDfz = seed => {
      const st = D.create({ teams: [['dave', 'david', 'amit'], ['sam', 'scott', 'james']], cpu: [true, true], solo: [true, true], level: [0.7, 0.7], seed });
      const stats = { hits: 0, blocks: 0, maxCombo: 0, throws: 0, specials: 0, supers: 0 };
      for (let t = 0; t < 3600; t++) {
        D.step(st, [{}, {}]);
        for (const e of st.events) { if (e.type === 'hit') { stats.hits++; stats.maxCombo = Math.max(stats.maxCombo, e.combo || 0); } if (e.type === 'block') stats.blocks++; if (e.type === 'throw') stats.throws++; if (e.type === 'special') stats.specials++; if (e.type === 'hyper') stats.supers++; }
        if (st.phase === 'over') break;
      }
      return stats;
    };
    for (const seed of seeds) { const d = cpuDfz(seed); console.log(`DFZ  seed ${seed}: hits ${d.hits} blocks ${d.blocks} combo ${d.maxCombo} throws ${d.throws} specials ${d.specials} hypers ${d.supers}`); }
  }

  // --- hit detection shape: can a standing jab hit a jumping opponent? can a jumper clear a sweep?
  const row = move => shape.rows.find(r => r.move === move);
  console.log(`\n== vertical hit shape (contact against an opponent held in the air, and against a crouching one)`);
  console.log(`standing jab hits an opponent held at height ${shape.heights.join('/')}: ${shape.heights.map(h => row('5A').heights[h]).join('/')}`);
  console.log(`sweep hits an opponent held at height ${shape.heights.join('/')}: ${shape.heights.map(h => row('2S').heights[h]).join('/')}`);
  console.log(`launcher hits an opponent held at height ${shape.heights.join('/')}: ${shape.heights.map(h => row('2D').heights[h]).join('/')}`);
  console.log(`against a crouching opponent: ${crouching.map(([move, hit]) => `${move} ${hit ? 'hits' : 'whiffs'}`).join(', ')}`);
  console.log(`against an opponent held 60 up (air reset or knockdown; air moves from 100 up): ${antiAir.map(([move, r]) => `${move} ${!r.hit ? 'whiffs' : r.knockdown ? 'knocks down' : 'resets'}`).join(', ')}`);
  console.log(`air kick against a standing opponent from height ${airKick.map(([height, hit]) => `${height}: ${hit ? 'hits' : 'whiffs'}`).join(', ')}`);
  console.log(`F shot from 300 against an opponent ${shots.map(([label, hit]) => `${label}: ${hit ? 'hits' : 'passes'}`).join(', ')}`);
  if (E.boxes && E.projectileBox) console.log('OURS: rectangle hit and hurt boxes (stand 74x225, crouch 80x140, jump 70x150 from 30 up, air hit 110x130 from 20 up, limbs through recovery; shots 50x40, beam 70x60)');
  if (D) console.log('DFZ: rectangle hit and hurt boxes per move and state (stand 92x285, crouch 100x190, airhit 140x170); the sweep box is 44 tall at the floor, LP spans 167-223');
  if (!D) console.log('\n(dad-fighter-z engine not found; set DFZ_REPO to compare)');
}
