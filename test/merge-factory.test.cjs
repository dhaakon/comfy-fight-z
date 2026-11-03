const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { merge } = require('../tools/merge-bundles.cjs');
const { makeJobs, assetRecord } = require('../tools/prepare-workflows.cjs');
const canonical = require('../config/game.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const read = file => JSON.parse(fs.readFileSync(file));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-merge-factory-'));
  t.after(() => { if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('cfz-merge-factory-')) throw new Error('Unsafe fixture cleanup'); fs.rmSync(root, { recursive: true, force: true }); });
  const game = { ...structuredClone(canonical), title: 'Custom Tournament', subtitle: 'Three venues',
    fighters: canonical.fighters.slice(0, 2).map((fighter, i) => ({ ...structuredClone(fighter), id: `custom${i}`, name: `Custom ${i}` })),
    stages: Array.from({ length: 3 }, (_, i) => ({ ...canonical.stages[0], id: `arena${i}`, name: `Arena ${i}` })) };
  delete game.assetRoot;
  const base = path.join(root, 'base'), patch = path.join(root, 'patch'), out = path.join(root, 'out');
  const save = (folder, jobs, label) => jobs.map(job => {
    const bytes = `${label}: ${job.id}`, src = `raw/${job.id}-${label}.png`;
    write(path.join(folder, src), bytes);
    return { ...assetRecord(job), src, sha256: hash(bytes) };
  });
  const assets = save(base, makeJobs(game), 'base'); game.expectedAssets = assets.map(item => item.id);
  const manifest = { schema: 'dad-fighter-assets/v1', root: '.', cloudOnly: true, game, assets };
  write(path.join(base, 'assets.json'), manifest);
  const replacements = save(patch, assets.filter(item => item.id === 'custom0_sheetB'), 'patch');
  const patchMap = { ...structuredClone(manifest), partial: true, game: { ...structuredClone(game), fighters: [structuredClone(game.fighters[0])], stages: [] }, assets: replacements };
  patchMap.game.expectedAssets = replacements.map(item => item.id);
  write(path.join(patch, 'assets.json'), patchMap);
  return { root, base, patch, patches: [patch], out, game, manifest, patchMap, save };
}

test('custom three-environment factory merges an individual sheet without audio or canonical metadata', t => {
  const item = fixture(t);
  item.patchMap.game.title = 'Personal Tournament';
  item.patchMap.game.fighters[0].name = 'Renamed Hero';
  item.patchMap.game.fighters[0].introTagline = 'My own battle cry!';
  item.patchMap.game.fighters[0].specialMove = { name: 'Custom Flash', description: 'A cyan crescent from the palm.' };
  write(path.join(item.patch, 'assets.json'), item.patchMap);
  merge(item);
  const result = read(path.join(item.out, 'assets.json'));
  assert.equal(result.assets.length, 28);
  assert.equal(result.game.title, 'Personal Tournament');
  assert.equal(result.game.fighters[0].name, 'Renamed Hero');
  assert.equal(result.game.fighters[0].specialMove.name, 'Custom Flash');
  assert.equal(result.game.fighters[0].introTagline, 'My own battle cry!');
  assert.equal(result.game.fighters[1].name, 'Custom 1');
  assert.deepEqual(result.game.stages, item.game.stages);
  assert.equal(result.partial, undefined);
  assert.equal(result.game.expectedAudio, undefined);
  assert.equal(fs.existsSync(path.join(item.out, 'audio.json')), false);
  for (const asset of result.assets) {
    assert.equal(hash(fs.readFileSync(path.join(item.out, asset.src))), asset.sha256);
    if (asset.id !== 'custom0_sheetB') assert.deepEqual(asset, item.manifest.assets.find(original => original.id === asset.id));
  }
  assert.equal(result.assets.find(asset => asset.id === 'custom0_sheetB').sha256, item.patchMap.assets[0].sha256);
});

test('custom merge preserves optional audio and video through image-only patches', t => {
  const item = fixture(t), bytes = 'audio fixture', movie = 'video fixture';
  const audio = { schema: 'dad-fighter-audio/v1', root: '.', title: item.game.title, assets: [{ id: 'menu_music', kind: 'audio', category: 'music', loop: true, src: 'raw/menu.wav', sha256: hash(bytes) }] };
  const video = { schema: 'comfy-fighter-video/v1', root: '.', openingVideo: { id: 'opening', src: 'raw/opening.mp4', duration: 25, sha256: hash(movie) } };
  write(path.join(item.base, 'audio.json'), audio); write(path.join(item.base, 'raw/menu.wav'), bytes);
  write(path.join(item.base, 'video.json'), video); write(path.join(item.base, 'raw/opening.mp4'), movie);
  merge(item);
  assert.deepEqual(read(path.join(item.out, 'audio.json')), audio);
  assert.deepEqual(read(path.join(item.out, 'video.json')), video);
  assert.equal(fs.readFileSync(path.join(item.out, 'raw/opening.mp4'), 'utf8'), movie);
  assert.deepEqual(read(path.join(item.out, 'assets.json')).game.expectedAudio, ['menu_music']);
});

test('stale patch definitions retain a prior edit, while conflicting edits fail before writing', t => {
  const item = fixture(t), second = path.join(item.root, 'second');
  const secondMap = structuredClone(item.patchMap);
  secondMap.assets = item.save(second, item.manifest.assets.filter(asset => asset.id === 'custom0_sheetC'), 'second');
  secondMap.game.expectedAssets = secondMap.assets.map(asset => asset.id);
  write(path.join(second, 'assets.json'), secondMap);
  item.patchMap.game.fighters[0].name = 'Edited Hero'; write(path.join(item.patch, 'assets.json'), item.patchMap);
  merge({ ...item, patches: [item.patch, second] });
  assert.equal(read(path.join(item.out, 'assets.json')).game.fighters[0].name, 'Edited Hero');
  secondMap.game.fighters[0].name = 'Conflicting Hero'; write(path.join(second, 'assets.json'), secondMap);
  const rejected = path.join(item.root, 'rejected');
  assert.throws(() => merge({ ...item, patches: [item.patch, second], out: rejected }), /Conflicting edited metadata/);
  assert.equal(fs.existsSync(rejected), false);
});

test('custom patches cannot add an incomplete fighter or change mapping ownership', t => {
  const item = fixture(t), original = structuredClone(item.patchMap);
  item.patchMap.assets[0].id = 'newhero_sheetB'; write(path.join(item.patch, 'assets.json'), item.patchMap);
  assert.throws(() => merge(item), /Unexpected asset record/);
  item.patchMap = structuredClone(original); item.patchMap.assets[0].fighter = 'custom1'; write(path.join(item.patch, 'assets.json'), item.patchMap);
  assert.throws(() => merge(item), /mapping disagrees with base/);
  item.patchMap = structuredClone(original); item.patchMap.game.fighters.push({ id: 'newhero', name: 'New Hero' }); write(path.join(item.patch, 'assets.json'), item.patchMap);
  assert.throws(() => merge(item), /unknown or duplicate fighters/);
  assert.equal(fs.existsSync(item.out), false);
});

test('incomplete and partial bases fail before any output is created', t => {
  const item = fixture(t);
  item.manifest.assets = item.manifest.assets.filter(asset => asset.id !== 'custom1_sheetC');
  item.manifest.game.expectedAssets = item.manifest.assets.map(asset => asset.id);
  write(path.join(item.base, 'assets.json'), item.manifest);
  assert.throws(() => merge(item), /missing or duplicates custom1\/sheetC/);
  item.manifest.partial = true; write(path.join(item.base, 'assets.json'), item.manifest);
  assert.throws(() => merge(item), /partial patch cannot be the base/);
  assert.equal(fs.existsSync(item.out), false);
});
