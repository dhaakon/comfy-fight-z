const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { buildAssets, importAssets, readProject, keyGreen, writeJson } = require('../tools/lib/assets.cjs');
const { exportDfz } = require('../tools/export-dfz.cjs');

const poses = ['idle', 'walk', 'punch', 'kick', 'block', 'hit', 'special', 'down', 'win'];
function fixture(t, jobs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, 'config/game.json'), { title: 'Fixture', fighters: [{ id: 'ember', name: 'Ember', color: '#ff3333' }], stages: [{ id: 'arena', name: 'Arena' }], sheets: { sheet: poses } });
  writeJson(path.join(root, 'assets/plan.json'), { version: 1, jobs: jobs || [{ id: 'ember_sheet', kind: 'sprites', fighter: 'ember', sheet: 'sheet', poses, key: true, output: 'assets/generated/raw/ember_sheet.png' }] });
  return root;
}
async function makeSheet(file, empty = false) {
  const canvas = createCanvas(300, 300), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 300, 300);
  if (!empty) for (let i = 0; i < 9; i++) {
    const x = i % 3 * 100, y = Math.floor(i / 3) * 100;
    ctx.fillStyle = '#e32b39'; ctx.fillRect(x + 35, y + (i === 7 ? 65 : 20), 30, i === 7 ? 20 : 65);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await canvas.encode('png'));
}

test('build keys a 3x3 sheet, exports nine anchored poses, and preserves pose height differences', async t => {
  const root = fixture(t);
  await makeSheet(path.join(root, 'assets/generated/raw/ember_sheet.png'));
  const { manifest, report } = await buildAssets({ root, strict: true });
  const fighter = manifest.fighters[0];
  assert.equal(Object.keys(fighter.poses).length, 9);
  assert.deepEqual(report.missing, []);
  assert.equal(report.built.length, 1);
  const idle = fighter.poses.idle, down = fighter.poses.down;
  assert.ok(Math.abs(idle.bh - 400) < 4, `idle body height was ${idle.bh}`);
  assert.ok(down.bh < idle.bh / 2, 'shared scale should keep down pose short');
  assert.ok(idle.ax > 0 && idle.ax < idle.w);
  assert.ok(idle.ay >= idle.bh && idle.ay < idle.h);
  const image = await loadImage(path.join(root, 'public', idle.src));
  const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  assert.equal(ctx.getImageData(0, 0, 1, 1).data[3], 0, 'green surround must become transparent');
});

test('background key preserves existing transparency', () => {
  const canvas = createCanvas(1, 1), ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(1, 1);
  pixels.data.set([20, 80, 20, 80]); ctx.putImageData(pixels, 0, 0);
  keyGreen(canvas);
  assert.ok(ctx.getImageData(0, 0, 1, 1).data[3] < 80);
});

test('development build exposes missing art; strict build fails and writes a report', async t => {
  const root = fixture(t);
  const { manifest, report } = await buildAssets({ root });
  assert.deepEqual(manifest.fighters[0].poses, {});
  assert.deepEqual(report.missing, ['ember_sheet']);
  await assert.rejects(buildAssets({ root, strict: true }), /Strict build requires all raw assets/);
  const diskReport = JSON.parse(fs.readFileSync(path.join(root, 'build/asset-report.json')));
  assert.equal(diskReport.errors.length, 1);
});

test('empty generated sprite cells fail rather than exporting invalid geometry', async t => {
  const root = fixture(t);
  await makeSheet(path.join(root, 'assets/generated/raw/ember_sheet.png'), true);
  await assert.rejects(buildAssets({ root }), /empty cells/i);
  assert.equal(fs.existsSync(path.join(root, 'public/assets/manifest.json')), false);
});

test('strict build rejects a non-square 3x3 source sheet', async t => {
  const root = fixture(t), file = path.join(root, 'assets/generated/raw/ember_sheet.png');
  const canvas = createCanvas(300, 180), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e32b39'; ctx.fillRect(0, 0, 300, 180);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await canvas.encode('png'));
  await assert.rejects(buildAssets({ root, strict: true }), /Expected a square 3x3 sheet/);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'build/asset-report.json')));
  assert.match(report.errors[0], /300x180/);
  assert.equal(fs.existsSync(path.join(root, 'public/assets/manifest.json')), false);
});

test('successful development rebuild removes stale artwork after a raw asset is removed', async t => {
  const root = fixture(t), raw = path.join(root, 'assets/generated/raw/ember_sheet.png');
  await makeSheet(raw);
  await buildAssets({ root, strict: true });
  fs.writeFileSync(path.join(root, 'public/keep.txt'), 'outside generated assets');
  assert.ok(fs.existsSync(path.join(root, 'public/assets/fighters/ember_idle.webp')));
  fs.unlinkSync(raw);
  const { manifest } = await buildAssets({ root });
  assert.deepEqual(manifest.fighters[0].poses, {});
  assert.equal(fs.existsSync(path.join(root, 'public/assets/fighters')), false);
  assert.equal(fs.readFileSync(path.join(root, 'public/keep.txt'), 'utf8'), 'outside generated assets');
  assert.equal(fs.readdirSync(path.join(root, 'build')).some(name => name.startsWith('asset-stage-')), false);
});

test('malformed later input preserves the prior manifest and art after partial processing', async t => {
  const jobs = [
    { id: 'ember_sheet', kind: 'sprites', fighter: 'ember', poses, key: true },
    { id: 'title', kind: 'ui' },
  ].map(job => ({ ...job, output: `assets/generated/raw/${job.id}.png` }));
  const root = fixture(t, jobs);
  for (const job of jobs) await makeSheet(path.join(root, job.output));
  await buildAssets({ root, strict: true });
  const manifestFile = path.join(root, 'public/assets/manifest.json');
  const spriteFile = path.join(root, 'public/assets/fighters/ember_idle.webp');
  const previousManifest = fs.readFileSync(manifestFile), previousSprite = fs.readFileSync(spriteFile);
  const replacement = createCanvas(300, 300), ctx = replacement.getContext('2d');
  ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 300, 300);
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = '#3333ee'; ctx.fillRect(i % 3 * 100 + 30, Math.floor(i / 3) * 100 + 25, 35, 60);
  }
  fs.writeFileSync(path.join(root, jobs[0].output), await replacement.encode('png'));
  fs.writeFileSync(path.join(root, jobs[1].output), 'malformed image');
  await assert.rejects(buildAssets({ root, strict: true }));
  assert.deepEqual(fs.readFileSync(manifestFile), previousManifest);
  assert.deepEqual(fs.readFileSync(spriteFile), previousSprite);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'build/asset-report.json')));
  assert.ok(report.errors.length > 0);
  assert.equal(fs.readdirSync(path.join(root, 'build')).some(name => name.startsWith('asset-stage-')), false);
});

test('import recognizes Comfy counters, chooses newest explicitly, and is idempotent', async t => {
  const root = fixture(t), from = path.join(root, 'comfy-output/hackathon');
  fs.mkdirSync(from, { recursive: true });
  const old = path.join(from, 'ember_sheet_00001_.png'), fresh = path.join(from, 'ember_sheet_00002_.png');
  fs.writeFileSync(old, 'old'); fs.writeFileSync(fresh, 'new');
  fs.writeFileSync(path.join(from, 'ember_sheet_other_00003_.png'), 'not a match');
  fs.utimesSync(old, 100, 100); fs.utimesSync(fresh, 200, 200);
  const report = importAssets({ root, from });
  assert.deepEqual(report.imported, ['ember_sheet']);
  assert.equal(report.selections[0].candidates, 2);
  assert.equal(fs.readFileSync(path.join(root, 'assets/generated/raw/ember_sheet.png'), 'utf8'), 'new');
  assert.deepEqual(importAssets({ root, from }).unchanged, ['ember_sheet']);
});

test('import rejects tied newest candidates before copying', t => {
  const root = fixture(t), from = path.join(root, 'comfy-output');
  fs.mkdirSync(from);
  for (const counter of ['00001', '00002']) {
    const file = path.join(from, `ember_sheet_${counter}_.png`);
    fs.writeFileSync(file, counter); fs.utimesSync(file, 100, 100);
  }
  assert.throws(() => importAssets({ root, from }), /Ambiguous newest output/);
  assert.equal(fs.existsSync(path.join(root, 'assets/generated/raw/ember_sheet.png')), false);
});

test('asset plan rejects traversal paths', t => {
  const root = fixture(t, [{ id: 'escape', kind: 'reference', output: 'assets/generated/raw/../../../../escape.png' }]);
  assert.throws(() => readProject(root), /Path escapes/);
});

test('build wires every visual asset category into the runtime manifest', async t => {
  const jobs = [
    { id: 'ember_reference', kind: 'reference', fighter: 'ember' },
    { id: 'ember_portrait', kind: 'portrait', fighter: 'ember', key: true },
    { id: 'ember_hero', kind: 'hero', fighter: 'ember', key: true },
    { id: 'ember_cutin', kind: 'cutin', fighter: 'ember', key: true },
    { id: 'arena', kind: 'stage', stage: 'arena' },
    { id: 'title', kind: 'ui' },
    { id: 'combat_effects', kind: 'effects', poses, key: true },
  ].map(job => ({ ...job, output: `assets/generated/raw/${job.id}.png` }));
  const root = fixture(t, jobs);
  for (const job of jobs) await makeSheet(path.join(root, job.output));
  const { manifest, report } = await buildAssets({ root, strict: true });
  assert.equal(report.built.length, 7);
  assert.equal(manifest.fighters[0].portrait, 'assets/portraits/ember_portrait.webp');
  assert.equal(manifest.fighters[0].hero, 'assets/heroes/ember_hero.webp');
  assert.equal(manifest.fighters[0].cutin, 'assets/cutins/ember_cutin.webp');
  assert.equal(manifest.stages[0].src, 'assets/stages/arena.webp');
  assert.equal(manifest.ui.title, 'assets/ui/title.webp');
  assert.equal(Object.keys(manifest.effects).length, 9);
  const portrait = await loadImage(path.join(root, 'public', manifest.fighters[0].portrait));
  assert.deepEqual([portrait.width, portrait.height], [320, 320]);
});

test('DFZ export uses reference-compatible names and refuses an existing repository', async t => {
  const root = fixture(t);
  await makeSheet(path.join(root, 'assets/generated/raw/ember_sheet.png'));
  await buildAssets({ root, strict: true });
  const out = path.join(root, 'build/dfz');
  const report = exportDfz({ root, out });
  assert.equal(report.files, 9);
  assert.ok(fs.existsSync(path.join(out, 'src/assets/fighters/ember_idle.webp')));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'src/assets/fighters/meta.json')));
  assert.equal(meta.ember.idle.src, undefined);
  assert.ok(meta.ember.idle.ax > 0);
  const occupied = path.join(root, 'existing-game');
  fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, 'package.json'), '{}');
  assert.throws(() => exportDfz({ root, out: occupied }), /nonempty/);
  assert.equal(fs.existsSync(path.join(occupied, 'src')), false);
});

test('repeated DFZ exports remove stale managed artwork and preserve unrelated files', async t => {
  const root = fixture(t);
  await makeSheet(path.join(root, 'assets/generated/raw/ember_sheet.png'));
  const { manifest } = await buildAssets({ root, strict: true });
  const out = path.join(root, 'build/dfz');
  exportDfz({ root, out });
  fs.writeFileSync(path.join(out, 'review-notes.txt'), 'keep me');
  delete manifest.fighters[0].poses.win;
  writeJson(path.join(root, 'public/assets/manifest.json'), manifest);
  const report = exportDfz({ root, out });
  assert.deepEqual(report.removed, ['src/assets/fighters/ember_win.webp']);
  assert.equal(fs.existsSync(path.join(out, 'src/assets/fighters/ember_win.webp')), false);
  assert.equal(fs.readFileSync(path.join(out, 'review-notes.txt'), 'utf8'), 'keep me');
  assert.equal(fs.existsSync(path.join(out, 'src/assets/fighters/ember_idle.webp')), true);
});
