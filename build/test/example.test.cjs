const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCanvas } = require('@napi-rs/canvas');
const { parseArgs, ensureBrowser, run } = require('../../example/run.cjs');
const { verifyBundle, hash } = require('../tools/lib/example-bundle.cjs');
const { losslessImage, pixels } = require('../tools/package-example.cjs');
const { patchExample } = require('../tools/patch-example.cjs');
const { makeJobs, assetRecord } = require('../../comfyui/tools/prepare-workflows.cjs');
const config = require('../../comfyui/config/game.json');
const audioPlan = require('../../comfyui/assets/audio-plan.json');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-example-'));
  t.after(() => {
    const target = path.resolve(root);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('cfz-example-')) throw new Error('Unexpected test cleanup target');
    fs.rmSync(target, { recursive: true, force: true });
  });
  return root;
}

// The reviewed classic release: six fighters in The Yard, 27 poses, intro and special voices.
function classicGame() {
  const game = structuredClone(config);
  delete game.extraSheets;
  game.fighters = game.fighters.filter(fighter => !fighter.boss); game.stages = game.stages.slice(0, 1);
  return game;
}
const CLASSIC_AUDIO = ['menu_music', 'yard_music', 'ann_select', 'ann_go', 'ann_ko', 'ann_victory', 'sfx_punch', 'sfx_kick', 'sfx_block', 'sfx_special'];

function fixture(t, { classic = false } = {}) {
  const root = temporary(t), bundle = path.join(root, 'example/bundle'), bytes = Buffer.from('distinct test media, no real-person input');
  const game = classic ? classicGame() : structuredClone(config);
  const manifest = { schema: 'comfy-fighter-assets/v1', root: '.', cloudOnly: true, game,
    assets: makeJobs(game).map(job => ({ ...assetRecord(job), src: `raw/${job.id}.webp`, width: 96, height: 96, sha256: hash(bytes) })) };
  const clips = classic ? audioPlan.jobs.filter(job => CLASSIC_AUDIO.includes(job.id) || /^fighter_.+_(intro|special)$/.test(job.id) && game.fighters.some(fighter => fighter.id === job.fighter)) : audioPlan.jobs;
  const audio = { schema: 'comfy-fighter-audio/v1', root: '.', assets: clips.map(job => ({ ...job, src: `raw/${job.id}.mp3`, sha256: hash(bytes) })) };
  const provenance = { schema: 'comfy-fighter-example-provenance/v1', imageEncoding: 'lossless WebP; decoded RGBA pixels verified',
    images: manifest.assets.map(record => ({ id: record.id, packagedSha256: record.sha256, pixelsIdentical: true })),
    audio: audio.assets.map(record => ({ id: record.id, packagedSha256: record.sha256 })) };
  for (const record of [...manifest.assets, ...audio.assets]) write(path.join(bundle, record.src), bytes);
  for (const [filename, data] of [['assets.json', manifest], ['audio.json', audio], ['provenance.json', provenance]]) write(path.join(bundle, filename), data);
  return { root, bundle, manifest, audio, provenance };
}

test('example CLI has free-build defaults and explicit output/install choices', () => {
  assert.deepEqual(parseArgs([]), { install: true, installBrowser: true });
  assert.deepEqual(parseArgs(['--no-install', '--no-install-browser', '--out', 'output/example/test/export']), { install: false, installBrowser: false, out: path.resolve('output/example/test/export') });
  for (const args of [['--generate'], ['--out'], ['--out', 'a', '--out', 'b'], ['--out', '--no-install']]) assert.throws(() => parseArgs(args), /Usage/);
});

test('an example may carry startup clips and living-scenery layers outside its contract, each mapped and proven', async t => {
  const item = fixture(t), clip = Buffer.from('fixture clip bytes, not a real video');
  write(path.join(item.bundle, 'raw/title-0123456789abcdef.mp4'), clip);
  write(path.join(item.bundle, 'video.json'), { schema: 'comfy-fighter-video/v1', root: '.', titleVideo: { id: 'title', src: 'raw/title-0123456789abcdef.mp4', duration: 8, sha256: hash(clip), hasAudio: false } });
  await assert.rejects(verifyBundle(item.bundle), /Packaging evidence does not match title/);
  write(path.join(item.bundle, 'provenance.json'), { ...item.provenance, videos: [{ id: 'title', sha256: hash(clip), bytes: clip.length, duration: 8 }] });
  const withClip = await verifyBundle(item.bundle);
  assert.deepEqual(withClip.videos.map(entry => entry.record.id), ['title']);
  // A cut-out layer for an arena joins the images without counting against the contract.
  const layer = Buffer.from('fixture layer'), record = { id: 'yard_el1', kind: 'layer', stage: 'yard', key: false, place: { x: .1, y: .4, w: .08, h: .3 }, motion: 'idle', order: 1, label: 'Neighbor', src: 'raw/yard_el1.webp', sha256: hash(layer), width: 40, height: 80 };
  write(path.join(item.bundle, record.src), layer);
  const assets = { ...item.manifest, assets: [...item.manifest.assets, record], game: { ...item.manifest.game, stages: item.manifest.game.stages.map(stage => stage.id === 'yard' ? { ...stage, scenery: { weather: 'none', effects: [] } } : stage) } };
  write(path.join(item.bundle, 'assets.json'), assets);
  write(path.join(item.bundle, 'provenance.json'), { ...item.provenance, images: [...item.provenance.images, { id: 'yard_el1', packagedSha256: record.sha256, pixelsIdentical: true }], videos: [{ id: 'title', sha256: hash(clip) }] });
  const withLayer = await verifyBundle(item.bundle);
  assert.equal(withLayer.manifest.assets.length, item.manifest.assets.length + 1);
  // A clip that video.json does not map is refused.
  write(path.join(item.bundle, 'raw/stray.mp4'), clip);
  await assert.rejects(verifyBundle(item.bundle), /Unmapped files in the shipped example: raw\/stray\.mp4/);
});

test('bundled example verifies every image/audio digest and all seven complete pose maps', async t => {
  const item = fixture(t), result = await verifyBundle(item.bundle);
  assert.equal(result.contract.name, 'arcade');
  assert.equal(result.entries.length, 89 + 1 + 99); assert.equal(result.poseCount, 7 * 45);
  fs.appendFileSync(path.join(item.bundle, item.manifest.assets[0].src), 'altered');
  await assert.rejects(verifyBundle(item.bundle), /integrity check failed/);
});

test('the reviewed classic six-fighter release still verifies exactly, and cannot pass as half an arcade bundle', async t => {
  const item = fixture(t, { classic: true }), result = await verifyBundle(item.bundle);
  assert.equal(result.contract.name, 'classic');
  assert.equal(result.entries.length, 56 + 1 + 22); assert.equal(result.poseCount, 6 * 27);
  // Declaring the arcade layout without its boss, arenas, extra sheets and voices is rejected.
  item.manifest.game.extraSheets = config.extraSheets; write(path.join(item.bundle, 'assets.json'), item.manifest);
  await assert.rejects(verifyBundle(item.bundle), /complete arcade example requires 7/);
});

test('the shipped generated example is complete, portable and contains no unmapped private media', async () => {
  const bundle = path.resolve(__dirname, '../../example/bundle'), result = await verifyBundle(bundle), { contract } = result;
  // The optional motion sheets (sheetF/sheetG) ship for the whole cast: two more images and 18 more cels per fighter.
  const motion = result.manifest.game.motionSheets || {}, motionIds = new Set(Object.keys(motion));
  const withMotion = result.manifest.game.fighters.filter(f => result.manifest.assets.some(a => a.fighter === f.id && motionIds.has(a.sheet))).length;
  assert.equal(withMotion, contract.fighters, 'Every fighter carries the motion sheets');
  // Detail sheets (sheetH/sheetI) are optional per fighter and per sheet; each carried sheet adds nine cels.
  const detailIds = new Set(Object.keys(result.manifest.game.detailSheets || {})), detailSheets = result.manifest.assets.filter(a => a.kind === 'sprites' && detailIds.has(a.sheet)).length;
  // The menu frame and the game-select title card are later optional interface art on top of the contract.
  const laterUi = ['frame', 'card'].filter(id => result.manifest.assets.some(a => a.kind === 'ui' && a.id === id)).length;
  assert.equal(result.manifest.assets.some(a => a.kind === 'ui' && a.id === 'card'), true, 'The example carries its game-select title card');
  // Living-scenery layers and the startup and select clips ride on top of the contract too.
  const sceneryLayers = result.manifest.assets.filter(a => ['scene', 'layer'].includes(a.kind)).length;
  assert.deepEqual(result.manifest.game.stages.filter(stage => stage.scenery).map(stage => stage.id), ['yard', 'rooftop', 'arcade'], 'Every arena carries living scenery');
  // The phone cuts of both menu loops (title-portrait, select-portrait) ride on top of the wide loops.
  const phoneCuts = ['titleVideoPortrait', 'selectVideoPortrait'].filter(key => result.video?.[key]).length;
  assert.equal(phoneCuts, 2, 'The example carries the portrait cuts of its title and select loops');
  assert.equal(result.videos.length, 2 + phoneCuts + result.manifest.game.fighters.length * 2, 'A title loop, a select loop, their phone cuts and an intro and idle loop per fighter');
  assert.equal(result.entries.length, contract.images + laterUi + withMotion * motionIds.size + detailSheets + sceneryLayers + contract.audio);
  assert.equal(result.poseCount, contract.fighters * contract.poses + withMotion * Object.values(motion).flat().length + detailSheets * 9);
  for (const filename of ['assets.json', 'audio.json', 'provenance.json']) {
    const json = fs.readFileSync(path.join(bundle, filename), 'utf8');
    assert.doesNotMatch(json, /[A-Za-z]:[\\/]|\/(?:Users|home)\/|private-archive/);
  }
  assert.equal(result.provenance.cloudOnly, true);
  assert.ok(result.entries.every(entry => entry.bytes < 100 * 1024 * 1024));
});

test('shipped example rejects unmapped media and unproven image compression', async t => {
  const item = fixture(t);
  write(path.join(item.bundle, 'old-unmapped-photo.png'), 'unmapped fixture');
  await assert.rejects(verifyBundle(item.bundle), /Unmapped files/);
  fs.unlinkSync(path.join(item.bundle, 'old-unmapped-photo.png'));
  item.provenance.images[0].pixelsIdentical = false; write(path.join(item.bundle, 'provenance.json'), item.provenance);
  await assert.rejects(verifyBundle(item.bundle), /Packaging evidence/);
});

test('partial examples cannot silently omit an intro, special or pose', async t => {
  const item = fixture(t);
  item.audio.assets.find(asset => asset.id.startsWith('fighter_') && asset.id.endsWith('_special')).id = 'unexpected_special'; write(path.join(item.bundle, 'audio.json'), item.audio);
  await assert.rejects(verifyBundle(item.bundle), /Missing fighter audio/);
});

test('browser bootstrap uses the pinned local CLI only when Chromium is missing', async () => {
  let detectCount = 0, called;
  const found = await ensureBrowser({ root: path.resolve('portable-project'), env: {}, detect: () => { if (++detectCount === 1) throw new Error('missing'); return 'available-browser'; }, execute: async (...args) => { called = args; } });
  assert.equal(found, 'available-browser'); assert.equal(called[0], process.execPath);
  assert.deepEqual(called[1].slice(1), ['install', 'chromium']);
  assert.ok(called[1][0].endsWith(path.join('build', 'node_modules', 'playwright', 'cli.js')));
  await assert.rejects(ensureBrowser({ installBrowser: false, detect: () => { throw new Error('missing'); }, execute: () => assert.fail('Unexpected browser download') }), /missing/);
  await assert.rejects(ensureBrowser({ env: { PLAYWRIGHT_EXECUTABLE_PATH: 'user-supplied-browser' }, detect: () => { throw new Error('invalid custom browser'); }, execute: () => assert.fail('An explicit browser path must be honored') }), /invalid custom browser/);
});

test('offline runner exports into a fresh folder and installs only after a passed build', async t => {
  const item = fixture(t), out = path.join(item.root, 'output/example/new/export'), calls = [];
  const result = await run({ root: item.root, out, services: {
    browser: async () => calls.push('browser'),
    build: async options => { assert.equal(options.bundle, item.bundle); assert.equal(options.out, out); calls.push('build'); return { status: 'passed' }; },
    install: options => { assert.equal(options.game, path.join(out, 'game')); calls.push('install'); }
  } });
  assert.deepEqual(calls, ['browser', 'build', 'install']); assert.equal(result.installed, true);
  await assert.rejects(run({ root: item.root, out, services: { browser: async () => {}, build: async () => ({ status: 'failed' }), install: () => assert.fail('Failed exports must not install') } }), /did not pass/);
});

test('no-install and existing-output guards preserve the current playable game', async t => {
  const item = fixture(t), out = path.join(item.root, 'output/example/export');
  const result = await run({ root: item.root, out, install: false, services: { browser: async () => {}, build: async () => ({ status: 'passed' }), install: () => assert.fail('No-install must preserve output/game') } });
  assert.equal(result.installed, false);
  write(path.join(out, 'precious.txt'), 'keep');
  await assert.rejects(run({ root: item.root, out, services: { browser: () => assert.fail('Must check output before downloading a browser') } }), /new or empty/);
  assert.equal(fs.readFileSync(path.join(out, 'precious.txt'), 'utf8'), 'keep');
  await assert.rejects(run({ root: item.root, out: path.join(item.bundle, 'export') }), /separate/);
});

test('lossless WebP packaging preserves saturated chroma and alpha pixels exactly', async t => {
  if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0) return t.skip('FFmpeg is only required for maintainer packaging');
  const root = temporary(t), source = path.join(root, 'sprite.png'), destination = path.join(root, 'sprite.webp');
  const canvas = createCanvas(96, 96), context = canvas.getContext('2d');
  context.fillStyle = '#00ff00'; context.fillRect(0, 0, 96, 96);
  context.fillStyle = '#f0184b'; context.fillRect(11, 9, 25, 70);
  context.fillStyle = '#154bfa'; context.fillRect(52, 12, 31, 68);
  context.clearRect(0, 0, 2, 2); context.fillStyle = 'rgba(0, 100, 255, 0.5)'; context.fillRect(40, 40, 2, 2);
  const original = canvas.toBuffer('image/png'); fs.writeFileSync(source, original);
  const result = await losslessImage(source, destination);
  assert.equal(result.pixelsIdentical, true); assert.equal(result.width, 96); assert.equal(result.height, 96);
  assert.ok((await pixels(source)).rgba.equals((await pixels(destination)).rgba));
  assert.ok(fs.readFileSync(source).equals(original), 'Original raw file must not be changed');
});

test('lossless WebP packaging keeps soft-edged scenery cut-outs exact, translucent pixels included', async t => {
  if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0) return t.skip('FFmpeg is only required for maintainer packaging');
  const root = temporary(t), source = path.join(root, 'layer.png'), destination = path.join(root, 'layer.webp');
  // An alpha ramp of dark, saturated colour: the pixels a canvas round trip rounds differently for PNG and WebP.
  const canvas = createCanvas(64, 48), context = canvas.getContext('2d');
  for (let x = 0; x < 64; x++) { context.fillStyle = `rgba(${16 + x}, ${x % 7}, 0, ${(x + 1) / 64})`; context.fillRect(x, 4, 1, 40); }
  fs.writeFileSync(source, canvas.toBuffer('image/png'));
  const result = await losslessImage(source, destination);
  assert.equal(result.pixelsIdentical, true);
  assert.deepEqual([result.width, result.height], [64, 48]);
});

function patchFixture(item) {
  const folder = path.join(item.root, 'output/repair/bundle'), original = item.manifest.assets.find(record => record.id === 'tempo_sheetC');
  const bytes = Buffer.from('new reviewed Tempo sheet pixels'), record = { ...original, src: 'raw/tempo_sheetC-new.png', sha256: hash(bytes) };
  write(path.join(folder, record.src), bytes);
  const manifest = { schema: 'comfy-fighter-assets/v1', root: '.', partial: true, assets: [record] };
  write(path.join(folder, 'assets.json'), manifest);
  return { folder, record, original, manifest };
}

test('reviewed sheet patch changes only its image, archives the old bundle and records repair provenance', async t => {
  const item = fixture(t), patch = patchFixture(item), promptId = '12345678-1234-1234-1234-123456789abc';
  const originalAudio = fs.readFileSync(path.join(item.bundle, 'audio.json'));
  const result = await patchExample({ root: item.root, patch: patch.folder, promptId, encode: async (input, output) => {
    fs.copyFileSync(input, output); return { width: 96, height: 96, pixelsIdentical: true, rgbaSha256: hash(fs.readFileSync(input)) };
  } });
  const current = await verifyBundle(item.bundle), changed = current.manifest.assets.find(record => record.id === patch.record.id);
  assert.notEqual(changed.src, patch.original.src); assert.equal(changed.sha256, patch.record.sha256);
  assert.equal(fs.existsSync(path.join(item.bundle, patch.original.src)), false);
  assert.equal(fs.existsSync(path.join(result.backup, patch.original.src)), true);
  assert.ok(fs.readFileSync(path.join(item.bundle, 'audio.json')).equals(originalAudio));
  for (const record of item.manifest.assets.filter(record => record.id !== changed.id)) assert.deepEqual(current.manifest.assets.find(item => item.id === record.id), record);
  assert.equal(current.provenance.repairs[0].promptId, promptId);
  assert.deepEqual(current.provenance.repairs[0].assetIds, ['tempo_sheetC']);
});

test('failed compression or altered pose mappings cannot replace a working example bundle', async t => {
  const item = fixture(t), patch = patchFixture(item), before = fs.readFileSync(path.join(item.bundle, 'assets.json'));
  const options = { root: item.root, patch: patch.folder, promptId: '12345678-1234-1234-1234-123456789abc' };
  await assert.rejects(patchExample({ ...options, encode: async () => { throw new Error('pixel mismatch'); } }), /pixel mismatch/);
  assert.ok(fs.readFileSync(path.join(item.bundle, 'assets.json')).equals(before));
  patch.manifest.assets[0].poses.reverse(); write(path.join(patch.folder, 'assets.json'), patch.manifest);
  await assert.rejects(patchExample({ ...options, encode: () => assert.fail('Changed mappings must fail before compression') }), /identity or pose mapping/);
  assert.ok(fs.readFileSync(path.join(item.bundle, 'assets.json')).equals(before));
});
