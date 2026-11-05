const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { parse, prepare, run, review, reroll, rerollPlan, exportGame, install, pipeline } = require('../tools/new-game.cjs');
const ROOT = path.resolve(__dirname, '../..');
const CAST = 'comfyui/casts/blue-wave-2026.json';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function freshRun(t) {
  const out = `output/test-runs/new-game-test-${process.pid}-${Date.now()}`;
  t.after(() => fs.rmSync(path.join(ROOT, out), { recursive: true, force: true }));
  return out;
}
// A synthetic 3x3 sheet: nine silhouettes on transparency, one taller than the rest so the review flags it.
function syntheticSheet(file, tallCell = -1) {
  const size = 900, canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  for (let cell = 0; cell < 9; cell++) {
    const x = (cell % 3) * 300 + 110, height = cell === tallCell ? 260 : 180, y = Math.floor(cell / 3) * 300 + 280 - height;
    ctx.fillStyle = '#c86432'; ctx.fillRect(x, y, 80, height); ctx.fillStyle = '#2b2b33'; ctx.fillRect(x + 20, y - 30, 40, 40);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, canvas.toBuffer('image/png'));
}

test('parse maps subcommands and flags', () => {
  assert.deepEqual(parse(['prepare', '--cast', 'a.json', '--out', 'output/test-runs/x', '--no-media']), { command: 'prepare', options: { cast: 'a.json', out: 'output/test-runs/x', media: false } });
  assert.deepEqual(parse(['run', '--run', 'r', '--approve-usd', '16', '--resume']).options, { run: 'r', approveUsd: '16', resume: true });
  assert.throws(() => parse(['run', '--bogus']), /Unknown argument/);
});

test('prepare records the estimate and run refuses to spend without a sufficient approval', async t => {
  const out = freshRun(t);
  const { directory, plan } = prepare({ cast: CAST, out, seed: 5, media: false, audio: false });
  const state = pipeline(directory);
  assert.equal(state.schema, 'comfy-fighter-pipeline/v1'); assert.equal(state.cast.id, 'blue-wave-2026'); assert.equal(state.cast.fighters.length, 6);
  assert.equal(state.steps.prepared.estimatedUSD, plan.total.estimatedUSD); assert.equal(state.steps.prepared.clips, 0);
  await assert.rejects(run({ run: out }), /estimated at \$4\.036032; pass --approve-usd 4\.04/);
  await assert.rejects(run({ run: out, approveUsd: '4' }), /pass --approve-usd/);
  assert.equal(pipeline(directory).steps.approved, undefined, 'a refused approval is not recorded');
  assert.rejects(review({ run: out }), /No bundle/);
  assert.throws(() => exportGame({ run: out }), /No bundle/);
  assert.throws(() => install({ run: out }), /Export the run first/);
  assert.throws(() => exportGame({ run: 'output/test-runs/does-not-exist' }), /prepared run/);
});

test('review draws a labelled grid per fighter and flags off-scale or cropped cells', async t => {
  const out = freshRun(t), { directory } = prepare({ cast: CAST, out, media: false, audio: false });
  const bundle = path.join(directory, 'bundle'), cast = read(path.join(directory, 'cast.json'));
  const fighters = cast.fighters.slice(0, 2), assets = [];
  for (const [index, fighter] of fighters.entries()) {
    syntheticSheet(path.join(bundle, `raw/${fighter.id}_sheet.png`), index ? 4 : -1);
    assets.push({ id: `${fighter.id}_sheet`, kind: 'sprites', fighter: fighter.id, sheet: 'sheet', poses: cast.sheets.sheet, src: `raw/${fighter.id}_sheet.png`, width: 900, height: 900 });
    assets.push({ id: `${fighter.id}_portrait`, kind: 'portrait', fighter: fighter.id, src: `raw/${fighter.id}_sheet.png`, width: 900, height: 900 });
  }
  fs.writeFileSync(path.join(bundle, 'assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', game: { ...cast, fighters }, assets }));
  const report = await review({ run: out });
  assert.deepEqual(Object.keys(report.fighters), ['keystone', 'cheddar']);
  assert.equal(report.fighters.keystone.cells, 9); assert.equal(report.fighters.keystone.poses.idle.ratio, 1);
  assert.ok(fs.statSync(path.join(directory, report.fighters.cheddar.grid)).size > 1000);
  // Sheet A reads idle, walk, punch, kick, block, ...: cell 4 is "block", an upright pose drawn taller than the idle.
  assert.equal(report.fighters.cheddar.poses.block.flags.length, 1); assert.match(report.flags[0].issue, /1\.3\dx the idle height/);
  assert.equal(report.flags.length, 1); assert.equal(report.images.length, 2);
  assert.match(fs.readFileSync(path.join(directory, 'review/README.md'), 'utf8'), /faces RIGHT/);
  assert.equal(pipeline(directory).steps.reviewed.flags, 1);
});

test('a re-roll prices the node and everything downstream of it before anything is submitted', async t => {
  const out = freshRun(t), { directory } = prepare({ cast: CAST, out });
  const workflow = read(path.join(directory, 'workflow.api.json'));
  const sheetA = rerollPlan(workflow, 'Keystone | sheet A'), sheetC = rerollPlan(workflow, 'Keystone | sheet C');
  assert.equal(sheetA.paid.length, 5, 'sheets B-E reference sheet A'); assert.equal(sheetA.estimatedUSD, 0.36036);
  assert.equal(sheetC.paid.length, 1); assert.equal(sheetC.estimatedUSD, 0.072072);
  const factory = rerollPlan(workflow, 'Character 1 | Keystone');
  assert.ok(factory.paid.length >= 1 + 5 + 2 + 2, 'the factory, its sheets, intro, idle, ensemble and menu loop'); assert.ok(factory.estimatedUSD > 3);
  assert.throws(() => rerollPlan(workflow, 'Export video.json'), /cannot be re-rolled/);
  assert.throws(() => rerollPlan(workflow, 'nope'), /exact title/);
  await assert.rejects(reroll({ run: out, node: 'Keystone | sheet A', approveUsd: '0.1' }), /about \$0\.36036; pass --approve-usd 0\.37/);
  assert.equal(read(path.join(directory, 'workflow.api.json'))[sheetA.id].inputs.reroll, undefined, 'a refused re-roll changes nothing');
});
