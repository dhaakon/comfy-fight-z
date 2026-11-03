const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { merge } = require('../tools/merge-bundles.cjs');
const { adoptionInputs } = require('../tools/adopt-game.cjs');
const { runtimeSources, sourceFile } = require('../tools/lib/runtime-validation.cjs');
const root = path.resolve(__dirname, '../..');
const config = require('../../comfyui/config/game.json'), imagePlan = require('../../comfyui/assets/plan.json'), audioPlan = require('../../comfyui/assets/audio-plan.json');
const hash = data => createHash('sha256').update(data).digest('hex');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
function temporary(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-runtime-test-'));
  t.after(() => { const target = path.resolve(folder); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('comfy-runtime-test-')) throw new Error('Unexpected test cleanup target'); fs.rmSync(target, { recursive: true, force: true }); });
  return folder;
}
function records(folder, jobs, label) {
  return jobs.map(job => {
    const record = Object.fromEntries(['id', 'kind', 'fighter', 'stage', 'sheet', 'poses', 'category'].filter(key => job[key] !== undefined).map(key => [key, job[key]]));
    const bytes = `${label}: ${job.id}`, src = `raw/${job.id}-${label}.${job.kind === 'audio' ? 'wav' : 'png'}`;
    write(path.join(folder, src), bytes);
    return { ...record, src, sha256: hash(bytes) };
  });
}
function bundle(folder, images, sounds, label) {
  fs.mkdirSync(folder, { recursive: true });
  const assets = records(folder, images, label), audio = records(folder, sounds, label);
  write(path.join(folder, 'assets.json'), { schema: 'comfy-fighter-assets/v1', root: '.', game: { ...config, expectedAssets: assets.map(a => a.id) }, assets });
  if (audio.length) write(path.join(folder, 'audio.json'), { schema: 'comfy-fighter-audio/v1', root: '.', title: config.title, assets: audio });
  return { assets, audio };
}
function setupMerge(t) {
  const folder = temporary(t), base = path.join(folder, 'base'), patch = path.join(folder, 'patch'), out = path.join(folder, 'out');
  const initial = bundle(base, imagePlan.jobs, audioPlan.jobs.filter(j => !j.id.endsWith('_intro')), 'base');
  const updated = bundle(patch, imagePlan.jobs.filter(j => j.kind === 'sprites').slice(0, 2), audioPlan.jobs.filter(j => j.id.endsWith('_intro')), 'patch');
  return { folder, base, patch, out, initial, updated };
}
function runtime() {
  const src = 'assets/shared.webp';
  return { title: config.title, fighters: config.fighters.map(f => ({ ...f, sourceImage: src, portrait: src, hero: src, cutin: src, poses: Object.fromEntries(Object.values(config.sheets).flat().map(pose => [pose, { src }])) })),
    stages: config.stages.map(s => ({ ...s, src, sourceImage: src })),
    ui: Object.fromEntries(imagePlan.jobs.filter(j => j.kind === 'ui').map(j => [j.id, src])),
    effects: Object.fromEntries(imagePlan.jobs.filter(j => j.kind === 'effects').flatMap(j => j.poses.map(pose => [pose, { src }]))), audio: {} };
}

test('partial image/audio patches merge into the complete plan with current configuration', t => {
  const fixture = setupMerge(t); merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: fixture.out });
  const merged = JSON.parse(fs.readFileSync(path.join(fixture.out, 'assets.json'))), audio = JSON.parse(fs.readFileSync(path.join(fixture.out, 'audio.json')));
  assert.equal(merged.assets.length, imagePlan.jobs.length); assert.equal(audio.assets.length, audioPlan.jobs.length);
  assert.deepEqual(merged.game.expectedAssets, merged.assets.map(a => a.id)); assert.deepEqual(merged.game.expectedAudio, audio.assets.map(a => a.id));
  assert.equal(merged.game.subtitle, config.subtitle); assert.equal(merged.game.fighters[0].introTagline, config.fighters[0].introTagline);
  assert.equal(merged.game.assetRoot, undefined);
  for (const record of [...merged.assets, ...audio.assets]) assert.equal(hash(fs.readFileSync(path.join(fixture.out, record.src))), record.sha256);
  for (const record of fixture.updated.assets) assert.equal(merged.assets.find(a => a.id === record.id).sha256, record.sha256);
  const unchanged = fixture.initial.assets.find(a => a.kind === 'stage');
  assert.deepEqual(merged.assets.find(a => a.id === unchanged.id), unchanged);
});

test('opening video survives unrelated patches and adopts without image conversion', t => {
  const fixture = setupMerge(t), bytes = 'integrity fixture only; media decoding is covered in browser tests';
  const mapped = { schema: 'comfy-fighter-video/v1', root: '.', openingVideo: { id: 'opening', src: 'raw/opening.mp4', duration: 25, sha256: hash(bytes) } };
  write(path.join(fixture.base, 'video.json'), mapped); write(path.join(fixture.base, mapped.openingVideo.src), bytes);
  merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: fixture.out });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.out, 'video.json'))), mapped);
  assert.equal(hash(fs.readFileSync(path.join(fixture.out, mapped.openingVideo.src))), mapped.openingVideo.sha256);
  const target = path.join(fixture.folder, 'game'), manifest = runtime();
  write(path.join(target, 'assets/shared.webp'), 'image fixture');
  write(path.join(target, 'assets/video/opening.mp4'), bytes);
  manifest.openingVideo = { ...mapped.openingVideo, src: 'assets/video/opening.mp4' };
  const video = adoptionInputs(target, manifest, config, imagePlan).get(manifest.openingVideo.src);
  assert.equal(video.video, true); assert.equal(video.next, manifest.openingVideo.src);
});

test('a pose-order change is rejected before a merged bundle is written', t => {
  const fixture = setupMerge(t), file = path.join(fixture.patch, 'assets.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.assets[0].poses.reverse(); write(file, manifest);
  assert.throws(() => merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: fixture.out }), /mapping disagrees.*poses/);
  assert.equal(fs.existsSync(fixture.out), false);
});

test('merge rejects corrupt bytes and incomplete intro audio', t => {
  const fixture = setupMerge(t), record = fixture.updated.assets[0];
  write(path.join(fixture.patch, record.src), 'corrupt');
  assert.throws(() => merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: fixture.out }), /hash mismatch/);
  write(path.join(fixture.patch, record.src), `patch: ${record.id}`);
  const audioFile = path.join(fixture.patch, 'audio.json'), audio = JSON.parse(fs.readFileSync(audioFile));
  audio.assets.pop(); write(audioFile, audio);
  assert.throws(() => merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: fixture.out }), /audio set is incomplete/);
  assert.equal(fs.existsSync(fixture.out), false);
});

test('merge rejects source junction escapes and output aliases to the base', t => {
  const fixture = setupMerge(t), outside = path.join(fixture.folder, 'outside');
  fs.mkdirSync(outside); write(path.join(outside, 'asset.png'), 'external');
  fs.symlinkSync(outside, path.join(fixture.patch, 'linked'), 'junction');
  const file = path.join(fixture.patch, 'assets.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.assets[0].src = 'linked/asset.png'; manifest.assets[0].sha256 = hash('external'); write(file, manifest);
  assert.throws(() => merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: fixture.out }), /symlink escapes/);
  fs.symlinkSync(fixture.base, path.join(fixture.folder, 'base-alias'), 'junction');
  assert.throws(() => merge({ saga: true, base: fixture.base, patches: [fixture.patch], out: path.join(fixture.folder, 'base-alias/nested') }), /separate from source/);
});

test('runtime validation requires exact configured poses and all mapped artwork', () => {
  const manifest = runtime(); runtimeSources(manifest, { config, plan: imagePlan, strict: true });
  delete manifest.fighters[0].poses.idle; manifest.fighters[0].poses.invented = { src: 'assets/shared.webp' };
  assert.throws(() => runtimeSources(manifest, { config, plan: imagePlan, strict: true }), /configured pose names/);
  const missing = runtime(); delete missing.ui.title;
  assert.throws(() => runtimeSources(missing, { config, plan: imagePlan, strict: true }), /mapping is missing: title/);
});

test('runtime files reject directories, traversal and junction escapes', t => {
  const folder = temporary(t), assets = path.join(folder, 'assets'), outside = path.join(folder, 'outside');
  fs.mkdirSync(assets); fs.mkdirSync(outside); write(path.join(outside, 'image.webp'), 'outside');
  fs.symlinkSync(outside, path.join(assets, 'linked'), 'junction');
  assert.throws(() => sourceFile(assets, 'linked/image.webp'), /symlink escapes/);
  assert.throws(() => sourceFile(assets, 'linked'), /symlink escapes/);
  fs.mkdirSync(path.join(assets, 'directory.webp'));
  assert.throws(() => sourceFile(assets, 'directory.webp'), /must be a file/);
  assert.throws(() => sourceFile(assets, '../outside/image.webp'), /Unsafe asset path/);
});

test('adoption preflight rejects image conversion collisions without publishing assets', t => {
  const folder = temporary(t), manifest = runtime();
  write(path.join(folder, 'assets/shared.webp'), 'accepted');
  write(path.join(folder, 'assets/shared.png'), 'different');
  manifest.fighters[0].portrait = 'assets/shared.png';
  assert.throws(() => adoptionInputs(folder, manifest, config, imagePlan), /Converted output collision/);
});

test('production build preserves accepted files and rejects wrong pose names before replacing output/game', t => {
  const folder = temporary(t), manifest = runtime();
  for (const file of ['build/tools/build.cjs', 'build/tools/lib/runtime-validation.cjs']) { const target = path.join(folder, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, file), target); }
  write(path.join(folder, 'build/tools/build-assets.cjs'), 'throw new Error("Accepted assets must not regenerate");');
  write(path.join(folder, 'comfyui/config/game.json'), config); write(path.join(folder, 'comfyui/assets/plan.json'), imagePlan);
  write(path.join(folder, 'build/public/index.html'), '<title>Keep existing game</title>');
  write(path.join(folder, 'build/public/assets/manifest.json'), manifest);
  write(path.join(folder, 'build/public/assets/production.json'), { source: 'accepted fixture' });
  write(path.join(folder, 'build/public/assets/shared.webp'), 'accepted bytes');
  const run = () => spawnSync(process.execPath, ['build/tools/build.cjs', '--strict'], { cwd: folder, encoding: 'utf8', windowsHide: true });
  const result = run(); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /no regeneration requested/);
  assert.equal(fs.readFileSync(path.join(folder, 'output/game/assets/shared.webp'), 'utf8'), 'accepted bytes');
  assert.equal(fs.readFileSync(path.join(folder, 'build/public/assets/shared.webp'), 'utf8'), 'accepted bytes');
  const previous = fs.readFileSync(path.join(folder, 'output/game/assets/manifest.json'), 'utf8');
  delete manifest.fighters[0].poses.idle; manifest.fighters[0].poses.invalid = { src: 'assets/shared.webp' };
  write(path.join(folder, 'build/public/assets/manifest.json'), manifest);
  const failed = run(); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /configured pose names/);
  assert.equal(fs.readFileSync(path.join(folder, 'output/game/assets/manifest.json'), 'utf8'), previous);
});
