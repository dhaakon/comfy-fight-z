const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const api = import(pathToFileURL(path.join(__dirname, '../public/builder/pack.js')).href);
const poses = ['idle', 'walk', 'punch', 'kick', 'block', 'hit', 'special', 'down', 'win'];
test('the browser export template retains the exact repository MIT notice', () => {
  const license = fs.readFileSync(path.join(__dirname, '../../LICENSE'));
  assert.ok(license.equals(fs.readFileSync(path.join(__dirname, '../public/LICENSE'))));
  assert.match(license.toString('utf8'), /^MIT License\n\nCopyright \(c\) 2026 dhaakon/);
});
test('opening film manifest requires a portable MP4, duration and integrity hash', async () => {
  const { validateVideoManifest } = await api;
  const video = { schema: 'comfy-fighter-video/v1', root: '.', openingVideo: { id: 'opening', src: 'raw/opening.mp4', duration: 25, sha256: 'a'.repeat(64) } };
  assert.deepEqual(validateVideoManifest(video), video);
  for (const patch of [{ src: '../opening.mp4' }, { src: 'https://example.com/opening.mp4' }, { src: 'raw/opening.exe' }, { duration: 0 }, { duration: 301 }, { sha256: '' }]) {
    assert.throws(() => validateVideoManifest({ ...video, openingVideo: { ...video.openingVideo, ...patch } }));
  }
});
test('animated title can stand alone or accompany the opening and fighter intros', async () => {
  const { validateVideoManifest } = await api;
  const title = { id: 'title', src: 'raw/title.mp4', duration: 8, sha256: 'a'.repeat(64), hasAudio: false };
  const opening = { id: 'opening', src: 'raw/opening.mp4', duration: 8, sha256: 'b'.repeat(64), hasAudio: false };
  const intro = { id: 'intro-griddle', fighter: 'griddle', src: 'raw/griddle.mp4', duration: 8, sha256: 'c'.repeat(64) };
  const base = { schema: 'comfy-fighter-video/v1', root: '.' };
  assert.deepEqual(validateVideoManifest({ ...base, titleVideo: title }), { ...base, titleVideo: title });
  assert.deepEqual(validateVideoManifest({ ...base, openingVideo: opening, titleVideo: title, fighterIntros: [intro] }), { ...base, openingVideo: opening, titleVideo: title, fighterIntros: [intro] });
  for (const invalid of [
    { ...title, id: 'opening' }, { ...title, src: '../title.mp4' }, { ...title, hasAudio: 'no' },
    { ...title, sha256: 'bad' }, { ...title, duration: 0 }
  ]) assert.throws(() => validateVideoManifest({ ...base, titleVideo: invalid }));
  assert.throws(() => validateVideoManifest({ ...base, titleVideo: title, openingVideo: { ...opening, src: title.src } }), /unique/);
  // The portrait cuts phones play upright carry their own ids and may stand alone.
  const phoneTitle = { id: 'title-portrait', src: 'raw/title-portrait.mp4', duration: 8, sha256: 'd'.repeat(64), hasAudio: false };
  const phoneSelect = { id: 'select-portrait', src: 'raw/select-portrait.mp4', duration: 8, sha256: 'e'.repeat(64), hasAudio: false };
  assert.deepEqual(validateVideoManifest({ ...base, titleVideo: title, titleVideoPortrait: phoneTitle, selectVideoPortrait: phoneSelect }), { ...base, titleVideo: title, titleVideoPortrait: phoneTitle, selectVideoPortrait: phoneSelect });
  assert.deepEqual(validateVideoManifest({ ...base, titleVideoPortrait: phoneTitle }), { ...base, titleVideoPortrait: phoneTitle });
  assert.throws(() => validateVideoManifest({ ...base, titleVideoPortrait: { ...phoneTitle, id: 'title' } }), /portrait title video ID/);
  assert.throws(() => validateVideoManifest({ ...base, selectVideoPortrait: { ...phoneSelect, id: 'select' } }), /portrait select video ID/);
  assert.throws(() => validateVideoManifest({ ...base, titleVideo: title, titleVideoPortrait: { ...phoneTitle, src: title.src } }), /unique/);
});
test('intro-only video maps validate fighter identities, paths and integrity', async () => {
  const { validateVideoManifest } = await api;
  const game = { fighters: [{ id: 'griddle' }, { id: 'tempo' }] };
  const clip = { id: 'intro-griddle', fighter: 'griddle', src: 'raw/griddle-intro.mp4', duration: 8, sha256: 'a'.repeat(64) };
  const map = { schema: 'comfy-fighter-video/v1', root: '.', fighterIntros: [clip] };
  assert.deepEqual(validateVideoManifest(map, game), map);
  for (const altered of [
    { fighterIntros: [{ ...clip, fighter: 'other', id: 'intro-other' }] },
    { fighterIntros: [clip, clip] }, { fighterIntros: [{ ...clip, src: '../escape.mp4' }] },
    { fighterIntros: [{ ...clip, duration: 31 }] }, { fighterIntros: [{ ...clip, sha256: '' }] },
    { fighterIntros: [] }
  ]) assert.throws(() => validateVideoManifest({ ...map, ...altered }, game));
});
function manifest() {
  return { schema: 'comfy-fighter-assets/v1', root: '.', game: { title: 'Custom fighters', fighters: [{ id: 'dad', name: 'Dad', color: '#ff8844' }, { id: 'rival', name: 'Rival', color: '#44aaff' }], stages: [{ id: 'yard', name: 'Yard' }], sheets: { sheet: poses } },
    assets: [{ id: 'dad_sheet', kind: 'sprites', fighter: 'dad', sheet: 'sheet', poses: [...poses], src: 'raw/dad_sheet.png', key: true }] };
}
test('bundle validator accepts dimension-free plans and preserves exact sheet mapping', async () => {
  const { validateManifest } = await api, input = manifest(), result = validateManifest(input);
  assert.deepEqual(result, input); assert.notEqual(result, input); assert.deepEqual(result.assets[0].poses, poses);
});

test('source bundles accept lossless WebP filenames while rejecting unsupported image types', async () => {
  const { validateManifest } = await api, input = manifest();
  input.assets[0].src = 'raw/dad_sheet.webp';
  assert.equal(validateManifest(input).assets[0].src, 'raw/dad_sheet.webp');
  for (const extension of ['jpg', 'gif', 'svg', 'exe']) {
    input.assets[0].src = `raw/dad_sheet.${extension}`;
    assert.throws(() => validateManifest(input), /PNG or WebP/);
  }
});

test('legacy imported schemas normalize to Comfy Fighter Z output contracts', async () => {
  const { validateManifest, validateAudioManifest } = await api;
  const input = manifest(); input.schema = 'dad-fighter-assets/v1';
  assert.equal(validateManifest(input).schema, 'comfy-fighter-assets/v1');
  assert.equal(input.schema, 'dad-fighter-assets/v1');
  const audio = { schema: 'dad-fighter-audio/v1', root: '.', assets: [{ id: 'music', kind: 'audio', category: 'music', src: 'raw/music.wav' }] };
  assert.equal(validateAudioManifest(audio).schema, 'comfy-fighter-audio/v1');
});

test('factory optional text can be empty while partial bundles require merging', async () => {
  const { validateManifest } = await api, input = manifest();
  input.game.subtitle = '';
  input.game.fighters[0].description = '';
  input.game.fighters[0].introTagline = '';
  input.game.stages[0].description = '';
  assert.deepEqual(validateManifest(input), input);
  assert.throws(() => validateManifest({ ...input, partial: true }), /asset patch.*Merge/);
  input.game.stages[0].description = 123;
  assert.throws(() => validateManifest(input), /description must be/);
});
test('fictional factory plans allow blank references but still reject unsafe supplied paths', async () => {
  const { validateManifest } = await api;
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/builder/example-assets.json'), 'utf8'));
  assert.ok(example.game.fighters.every(fighter => fighter.sourceImage === ''));
  assert.deepEqual(validateManifest(example), example);
  for (const sourceImage of ['../private/photo.png', 'https://example.com/photo.png', null, 123]) {
    const input = structuredClone(example); input.game.fighters[0].sourceImage = sourceImage;
    assert.throws(() => validateManifest(input), /Unsafe asset path/);
  }
});
test('bundle validator rejects traversal, network paths, duplicates and false pose mappings', async () => {
  const { validateManifest } = await api;
  for (const src of ['../secret.png', 'raw/../../secret.png', 'https://example.com/p.png', 'raw\\dad.png', '/raw/dad.png', 'raw/%2e%2e/file.png', 'raw/CON.png']) {
    const item = manifest(); item.assets[0].src = src; assert.throws(() => validateManifest(item), /Unsafe asset path/);
  }
  const duplicate = manifest(); duplicate.assets.push({ ...duplicate.assets[0] }); assert.throws(() => validateManifest(duplicate), /duplicate asset ID/);
  const posesWrong = manifest(); posesWrong.assets[0].poses.reverse(); assert.throws(() => validateManifest(posesWrong), /pose order disagrees/);
  const missing = manifest(); missing.game.expectedAssets = ['dad_sheet', 'rival_sheet']; assert.throws(() => validateManifest(missing), /expected asset records/);
  const hash = manifest(); hash.assets[0].sha256 = 'fake'; assert.throws(() => validateManifest(hash), /Invalid SHA-256/);
});
test('bundle validator detects sprite output collisions across different IDs', async () => {
  const { validateManifest } = await api, item = manifest();
  item.game.fighters = [{ id: 'a_b', name: 'First' }, { id: 'a', name: 'Second' }];
  item.game.sheets = {};
  item.assets = [
    { id: 'first', kind: 'sprites', fighter: 'a_b', poses: ['c', ...poses.slice(1)], src: 'raw/first.png' },
    { id: 'second', kind: 'sprites', fighter: 'a', poses: ['b_c', ...poses.slice(1)], src: 'raw/second.png' }
  ];
  assert.throws(() => validateManifest(item), /Duplicate runtime asset mapping/);
});
test('strict browser compiler rejects missing source before touching canvas or template network', async () => {
  const { buildGame } = await api;
  await assert.rejects(buildGame({ manifest: manifest(), files: new Map() }), /Missing 1 source image/);
  await assert.rejects(buildGame({ manifest: manifest(), files: new Map(), customization: { fighters: [{ id: 'rival', enabled: false }], allowPlaceholders: true } }), /at least two fighters/);
  await assert.rejects(buildGame({ manifest: manifest(), files: new Map([['raw/dad_sheet.png', new Blob(['not yet decoded'])]]) }), /Incomplete asset mappings/);
});
test('ZIP has readable store entries, UTF-8 names, known CRC and central directory offsets', async () => {
  const { zipFiles } = await api;
  const archive = await zipFiles(new Map([['index.html', new Blob(['123456789'])], ['assets/caf\u00e9.png', new Blob([new Uint8Array([0, 1, 2, 255])])]]));
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt16LE(6), 0x800);
  assert.equal(bytes.readUInt16LE(8), 0);
  assert.equal(bytes.readUInt32LE(14), 0xcbf43926);
  const nameLength = bytes.readUInt16LE(26), dataLength = bytes.readUInt32LE(18);
  assert.equal(bytes.subarray(30, 30 + nameLength).toString(), 'index.html');
  assert.equal(bytes.subarray(30 + nameLength, 30 + nameLength + dataLength).toString(), '123456789');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50); assert.equal(bytes.readUInt16LE(end + 10), 2);
  const central = bytes.readUInt32LE(end + 16); assert.equal(bytes.readUInt32LE(central), 0x02014b50); assert.equal(bytes.readUInt32LE(central + 42), 0);
  const secondCentral = central + 46 + nameLength, secondOffset = bytes.readUInt32LE(secondCentral + 42);
  assert.equal(bytes.readUInt32LE(secondOffset), 0x04034b50);
  assert.equal(bytes.subarray(secondOffset + 30, secondOffset + 30 + bytes.readUInt16LE(secondOffset + 26)).toString(), 'assets/caf\u00e9.png');
});
test('archive rejects path escapes and case-insensitive collisions', async () => {
  const { zipFiles } = await api;
  await assert.rejects(zipFiles(new Map([['../evil.js', new Blob(['bad'])]])), /Unsafe/);
  await assert.rejects(zipFiles(new Map([['A.png', new Blob()], ['a.png', new Blob()]])), /Duplicate export path/);
});
test('directory export refuses existing content and writes nested files to an empty selected root', async () => {
  const { writeDirectory } = await api, written = new Map();
  function directory(prefix = '', occupied = false) {
    return { kind: 'directory', async *entries() { if (occupied) yield ['old.txt', {}]; },
      async getDirectoryHandle(name) { return directory(prefix + name + '/'); },
      async getFileHandle(name) { return { async createWritable() { return { async write(blob) { written.set(prefix + name, await blob.text()); }, async close() {}, async abort() {} }; } }; } };
  }
  const files = new Map([['index.html', new Blob(['game'])], ['assets/manifest.json', new Blob(['{}'])]]);
  await assert.rejects(writeDirectory(directory('', true), files), /empty destination/); assert.equal(written.size, 0);
  assert.deepEqual(await writeDirectory(directory(), files), { files: 2 }); assert.equal(written.get('assets/manifest.json'), '{}');
});


test('source mappings and special descriptions survive validation', async () => {
  const { validateManifest } = await api, value = manifest();
  value.game.subtitle = 'Higgsfield Open Source Saga';
  value.game.fighters[0].introTagline = 'One node. One knockout.';
  value.game.fighters[0].description = 'A fast counter fighter.';
  value.game.fighters[0].specialMove = { name: 'Flash Step', description: 'A bright forward burst.' };
  value.assets.push({ id: 'dad_source', kind: 'source', fighter: 'dad', src: 'raw/dad_source.png' });
  assert.equal(validateManifest(value).game.fighters[0].specialMove.name, 'Flash Step');
  assert.equal(validateManifest(value).game.fighters[0].introTagline, 'One node. One knockout.');
  assert.equal(validateManifest(value).game.subtitle, 'Higgsfield Open Source Saga');
  value.assets[1].stage = 'yard';
  assert.throws(() => validateManifest(value), /exactly one/);
});

test('audio manifests validate portable paths, identity and categories', async () => {
  const { validateAudioManifest } = await api;
  const input = { schema: 'comfy-fighter-audio/v1', root: '.', assets: [{ id: 'yard_music', kind: 'audio', category: 'music', src: 'raw/yard.wav', loop: true }] };
  assert.equal(validateAudioManifest(input).assets[0].loop, true);
  for (const src of ['../yard.wav', 'https://example.com/audio.wav', 'raw/sound.js']) {
    assert.throws(() => validateAudioManifest({ ...input, assets: [{ ...input.assets[0], src }] }));
  }
  assert.throws(() => validateAudioManifest({ ...input, assets: [...input.assets, ...input.assets] }), /duplicate/);
  assert.throws(() => validateAudioManifest({ ...input, assets: [{ ...input.assets[0], fighter: 'unknown' }] }, manifest().game), /Unknown audio fighter/);
});
