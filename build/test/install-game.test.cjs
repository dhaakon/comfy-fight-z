const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { installGame, verifiedExport } = require('../tools/install-game.cjs');
const config = require('../../comfyui/config/game.json');
const { makeJobs, assetRecord } = require('../../comfyui/tools/prepare-workflows.cjs');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-install-game-'));
  t.after(() => { const absolute = path.resolve(root); if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('cfz-install-game-')) throw new Error('Unexpected fixture cleanup target'); fs.rmSync(absolute, { recursive: true, force: true }); });
  const source = path.join(root, 'output/exports/smoke/game');
  const game = { ...structuredClone(config), fighters: structuredClone(config.fighters.slice(0, 2)) };
  const records = makeJobs(game).map(job => {
    const src = `raw/${job.id}.png`, bytes = `verified source fixture ${job.id}`;
    write(path.join(source, 'sources', src), bytes);
    return { ...assetRecord(job), src, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const media = 'assets/shared.png', poses = Object.fromEntries(Object.values({ ...game.sheets, ...game.extraSheets }).flat().map(pose => [pose, { src: media }]));
  const runtime = { version: 1, title: game.title,
    fighters: game.fighters.map(fighter => ({ ...fighter, poses, portrait: media, hero: media, cutin: media, endingArt: media, sourceImage: media })),
    stages: game.stages.map(stage => ({ ...stage, src: media, sourceImage: media })),
    ui: Object.fromEntries(['title', 'select', 'logo', 'hud', 'icons'].map(id => [id, media])),
    effects: Object.fromEntries(['hit', 'block', 'projectile', 'dust', 'ko', 'powerup', 'dash', 'launch', 'spark'].map(id => [id, { src: media }])), audio: {} };
  write(path.join(source, media), 'verified processed fixture');
  for (const file of ['index.html', 'style.css', 'engine.js', 'anim.js', 'game.js', 'start-server.cjs', 'package.json']) write(path.join(source, file), `exported ${file}`);
  write(path.join(source, 'assets/manifest.json'), runtime);
  write(path.join(source, 'sources/assets.json'), { schema: 'comfy-fighter-assets/v1', root: '.', game, assets: records });
  const build = { strict: true, missing: [], warnings: [], sourceAssets: records.length, built: records.map(record => record.id) };
  const receipt = { status: 'passed', title: game.title, sourceAssets: records.length, poseCount: 90 };
  write(path.join(source, 'build-report.json'), build);
  write(path.join(source, '../build-test.json'), receipt);
  write(path.join(root, 'build/public/builder/index.html'), 'current builder');
  write(path.join(root, 'build/public/assets/manifest.json'), { generationPending: true });
  write(path.join(root, 'output/game/index.html'), 'previous preview');
  return { root, source, build, receipt, records };
}

test('verified two-fighter export installs with builder and recoverable preview without changing canonical media', t => {
  const item = fixture(t), receipt = installGame({ game: item.source, root: item.root });
  assert.equal(receipt.fighters, 2); assert.equal(receipt.poses, 90);
  assert.equal(fs.readFileSync(path.join(item.root, 'output/game/index.html'), 'utf8'), 'exported index.html');
  assert.equal(fs.readFileSync(path.join(item.root, 'output/game/builder/index.html'), 'utf8'), 'current builder');
  assert.equal(fs.readFileSync(path.join(receipt.previousGame, 'index.html'), 'utf8'), 'previous preview');
  assert.equal(JSON.parse(fs.readFileSync(path.join(item.root, 'build/public/assets/manifest.json'))).generationPending, true);
  assert.equal(fs.readFileSync(path.join(item.source, 'index.html'), 'utf8'), 'exported index.html');
});

test('install rejects incomplete or modified exports before replacing the preview', t => {
  const item = fixture(t);
  item.build.strict = false; write(path.join(item.source, 'build-report.json'), item.build);
  assert.throws(() => installGame({ game: item.source, root: item.root }), /complete strict export/);
  item.build.strict = true; write(path.join(item.source, 'build-report.json'), item.build);
  write(path.join(item.source, 'sources', item.records[0].src), 'changed bytes');
  assert.throws(() => verifiedExport(item.source), /hash mismatch/);
  assert.equal(fs.readFileSync(path.join(item.root, 'output/game/index.html'), 'utf8'), 'previous preview');
  assert.equal(fs.existsSync(path.join(item.root, 'output/diagnostics')), false);
});

test('install rejects failed verification receipts and missing runtime media', t => {
  const item = fixture(t);
  item.receipt.status = 'failed'; write(path.join(item.source, '../build-test.json'), item.receipt);
  assert.throws(() => verifiedExport(item.source), /passed build-test/);
  item.receipt.status = 'passed'; write(path.join(item.source, '../build-test.json'), item.receipt);
  fs.unlinkSync(path.join(item.source, 'assets/shared.png'));
  assert.throws(() => verifiedExport(item.source), /ENOENT/);
});

test('install refuses redirected destinations and cannot replace its own source', t => {
  const item = fixture(t), old = path.join(item.root, 'output/game'), saved = path.join(item.root, 'output/previous');
  fs.renameSync(old, saved);
  fs.symlinkSync(path.join(item.root, 'build/public'), old, 'junction');
  assert.throws(() => installGame({ game: item.source, root: item.root }), /redirected/);
  fs.unlinkSync(old); fs.renameSync(saved, old);
  const sourceRuntime = path.join(item.root, 'output/game');
  fs.renameSync(sourceRuntime, saved); fs.renameSync(item.source, sourceRuntime);
  write(path.join(item.root, 'output/build-test.json'), item.receipt);
  assert.throws(() => installGame({ game: sourceRuntime, root: item.root }), /separate from output/);
  assert.equal(fs.readFileSync(path.join(saved, 'index.html'), 'utf8'), 'previous preview');
});

test('a slot installs the export beside the main game for the game select instead of replacing the preview', t => {
  const item = fixture(t), receipt = installGame({ game: item.source, root: item.root, slot: 'blue-wave-2026' });
  assert.equal(receipt.slot, 'blue-wave-2026'); assert.match(receipt.note, /\/blue-wave-2026\//);
  assert.equal(fs.readFileSync(path.join(item.root, 'output/games/blue-wave-2026/index.html'), 'utf8'), 'exported index.html');
  assert.equal(fs.readFileSync(path.join(item.root, 'output/games/blue-wave-2026/builder/index.html'), 'utf8'), 'current builder');
  assert.equal(fs.readFileSync(path.join(item.root, 'output/game/index.html'), 'utf8'), 'previous preview', 'the main preview is untouched');
  assert.equal(receipt.previousGame, null);
  const again = installGame({ game: item.source, root: item.root, slot: 'blue-wave-2026' });
  assert.ok(again.previousGame, 'reinstalling a slot keeps the previous copy');
  assert.throws(() => installGame({ game: item.source, root: item.root, slot: 'Bad Slot' }), /Slot ids/);
});
