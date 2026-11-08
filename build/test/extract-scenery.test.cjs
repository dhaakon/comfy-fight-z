'use strict';
// extract-scenery: a figure added to a stage painting is cut out at its exact place, with the keyed outline from the
// isolated image, and the scene's other changes become still layers mapped into assets.json.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { createCanvas } = require('../node_modules/@napi-rs/canvas');

function image(file, draw) { const c = createCanvas(800, 450), g = c.getContext('2d'); g.fillStyle = '#203048'; g.fillRect(0, 0, 800, 450); g.fillStyle = '#556677'; g.fillRect(0, 300, 800, 150); draw?.(g); fs.writeFileSync(file, c.toBuffer('image/png')); }

test('cuts an added figure in place and keeps other changes still', () => {
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-scenery-')); fs.mkdirSync(path.join(bundle, 'raw'));
  image(path.join(bundle, 'raw/plate.png'));
  const figure = g => { g.fillStyle = '#e04030'; g.fillRect(600, 180, 40, 120); };
  image(path.join(bundle, 'raw/scene.png'), g => { figure(g); g.fillStyle = '#c0d0ff'; g.fillRect(100, 360, 60, 6); });
  const iso = createCanvas(800, 450), ig = iso.getContext('2d'); ig.fillStyle = '#00ff00'; ig.fillRect(0, 0, 800, 450); figure(ig);
  fs.writeFileSync(path.join(bundle, 'raw/isolated.png'), iso.toBuffer('image/png'));
  const assets = { game: { stages: [{ id: 'yard', name: 'Yard' }], fighters: [], expectedAssets: ['yard', 'yard_scene', 'yard_isolated'] }, assets: [
    { id: 'yard', kind: 'stage', stage: 'yard', src: 'raw/plate.png' }, { id: 'yard_scene', kind: 'scene', stage: 'yard', src: 'raw/scene.png' },
    { id: 'yard_isolated', kind: 'scene', stage: 'yard', key: true, src: 'raw/isolated.png' }] };
  fs.writeFileSync(path.join(bundle, 'assets.json'), JSON.stringify(assets));
  const run = spawnSync(process.execPath, [path.join(__dirname, '../tools/extract-scenery.cjs'), '--bundle', bundle, '--stage', 'yard'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const layout = JSON.parse(fs.readFileSync(path.join(bundle, 'scenery/yard.json'), 'utf8'));
  const moving = layout.elements.filter(e => e.motion !== 'still'), still = layout.elements.filter(e => e.motion === 'still');
  assert.equal(moving.length, 1); assert.equal(still.length, 1);
  const p = moving[0].place;
  assert.ok(Math.abs(p.x * 800 - 600) < 6 && Math.abs(p.y * 450 - 180) < 6 && Math.abs(p.w * 800 - 40) < 12 && Math.abs(p.h * 450 - 120) < 12, JSON.stringify(p));
  const mapped = JSON.parse(fs.readFileSync(path.join(bundle, 'assets.json'), 'utf8'));
  assert.equal(mapped.assets.filter(a => a.kind === 'layer').length, 2);
  assert.ok(layout.elements.every(e => mapped.game.expectedAssets.includes(e.id)));
  // A reviewed motion survives a full re-extraction.
  layout.elements.find(e => e.id === moving[0].id).motion = 'cheer'; fs.writeFileSync(path.join(bundle, 'scenery/yard.json'), JSON.stringify(layout));
  assert.equal(spawnSync(process.execPath, [path.join(__dirname, '../tools/extract-scenery.cjs'), '--bundle', bundle, '--stage', 'yard']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(bundle, 'scenery/yard.json'), 'utf8')).elements.find(e => e.id === moving[0].id).motion, 'cheer');
  fs.rmSync(bundle, { recursive: true, force: true });
});
