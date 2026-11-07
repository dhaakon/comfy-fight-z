const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const E = require('../public/engine.js');
require('../public/render/canvas-renderer.js');
// The Canvas renderer on an off-screen canvas, without art: fighters draw as stick figures.
const manifest = { fighters: [{ id: 'a', poses: {} }, { id: 'b', poses: {} }], stages: [{ id: 's', name: 'S' }], effects: {} };
function renderer() {
  const deps = { art: () => null, assetSource: () => null, ui: () => null, fighterData: () => ({ name: 'A', poses: {} }), portraitSource: () => null };
  return globalThis.CFZCanvasRenderer.create({ canvas: createCanvas(960, 540), engine: E, deps });
}
const frameOf = (state, extra = {}) => ({ state, manifest, stageIndex: 0, selected: [0, 1], mode: 'versus', ...extra });
function exchange(defender = {}) {
  const s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight'; s.fighters[0].x = 400; s.fighters[1].x = 480;
  for (let t = 0; t < E.MOVES.punch.startup; t++) E.tick(s, [{ punch: t === 0 }, defender]);
  return s;
}

test('through a hit\'s impact freeze the defender shakes 2 px either way, 1 px on a guard, and nobody else shakes', () => {
  for (const [guard, size] of [[{}, 2], [{ right: true }, 1]]) {
    const r = renderer(), s = exchange(guard), [attacker, defender] = s.fighters;
    assert.ok(s.hitstop > 0 && defender.hitAge === 0 && defender.stun > 0);
    // Paused (drawn again without a simulated frame), the shake holds its side.
    r.beginFrame(frameOf(s)); const held = r.hitShake(defender); r.beginFrame(frameOf(s)); assert.ok(held !== 0 && r.hitShake(defender) === held, 'It holds still while paused');
    const shakes = [0, 1, 2, 3].map(() => { r.beginFrame(frameOf(s)); const shake = [r.hitShake(defender), r.hitShake(attacker)]; E.tick(s, [{}, {}]); return shake; });
    assert.deepEqual(shakes.map(([x]) => Math.abs(x)), [size, size, size, size]);
    assert.ok(shakes.every(([x], i) => i === 0 || x === -shakes[i - 1][0]), 'It alternates every simulated frame of the freeze');
    assert.ok(shakes.every(([, x]) => x === 0), 'The attacker holds still');
    r.beginFrame(frameOf(s, { reducedMotion: true })); assert.equal(r.hitShake(defender), 0);
    while (s.hitstop > 0) E.tick(s, [{}, {}]);
    E.tick(s, [{}, {}]); r.beginFrame(frameOf(s)); assert.equal(r.hitShake(defender), 0, 'Not once the freeze is over');
  }
});

test('sparks come in three tiers by damage on the 1000-point scale', () => {
  const r = renderer();
  assert.deepEqual([0, 44, 45, 74, 75, 300].map(damage => r.sparkTier({ damage })), [0, 0, 1, 1, 2, 2]);
});

test('the Canvas path draws counters, wall thuds, super jumps, slide dust and a K.O. in slow motion without errors', () => {
  const r = renderer(), s = E.create(['a', 'b'], { cpu: false }); s.phase = 'fight';
  const [a, d] = s.fighters; d.x = E.WIDTH - E.WALL - 20; a.x = d.x - 80;
  const seen = new Set(), most = { dust: 0, rings: 0 };
  const run = (inputs, frames) => { for (let t = 0; t < frames; t++) { E.tick(s, inputs(t)); s.effects.forEach(e => seen.add(e.type)); r.draw(frameOf(s)); most.dust = Math.max(most.dust, r.view.dust.length); most.rings = Math.max(most.rings, r.view.rings.length); } };
  run(t => [{ punch: t === 0 }, { heavy: t === 0 }], 30);
  run(t => [{ heavy: t === 0 }, {}], 50);
  a.x = 400; d.x = 900; run(t => [t < 2 ? { down: true } : { jump: t < 8 }, {}], 70);
  d.hp = 1; a.x = d.x - 80; run(t => [{ heavy: t === 0 }, {}], 90);
  for (const type of ['counter', 'hit', 'wall', 'superjump', 'ko']) assert.ok(seen.has(type), type);
  assert.ok(most.dust > 0 && most.rings > 0, `dust ${most.dust}, rings ${most.rings}`);
  assert.equal(s.phase, 'roundover');
});
