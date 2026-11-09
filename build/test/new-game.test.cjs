const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { parse, prepare, run, review, reroll, rerollPlan, rerollArt, artPlan, addSheets, sheetPlan, addMedia, mediaPlan, titleCard, titleCardSource, TITLE_CARD_USD, packMedia, packageFloor, exportGame, install, pipeline } = require('../tools/new-game.cjs');
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
  await assert.rejects(run({ run: out }), /estimated at \$4\.900896; pass --approve-usd 4\.91/);
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
  assert.equal(sheetA.paid.length, 7, 'sheets B-G reference sheet A'); assert.equal(sheetA.estimatedUSD, 0.504504);
  assert.equal(sheetC.paid.length, 1); assert.equal(sheetC.estimatedUSD, 0.072072);
  const factory = rerollPlan(workflow, 'Character 1 | Keystone');
  assert.ok(factory.paid.length >= 1 + 5 + 2 + 2, 'the factory, its sheets, intro, idle, ensemble and menu loop'); assert.ok(factory.estimatedUSD > 1.5 && factory.estimatedUSD < 3, 'Seedance clips are cheaper than LTX');
  assert.throws(() => rerollPlan(workflow, 'Export video.json'), /cannot be re-rolled/);
  assert.throws(() => rerollPlan(workflow, 'nope'), /exact title/);
  await assert.rejects(reroll({ run: out, node: 'Keystone | sheet A', approveUsd: '0.1' }), /about \$0\.504504; pass --approve-usd 0\.51/);
  assert.equal(read(path.join(directory, 'workflow.api.json'))[sheetA.id].inputs.reroll, undefined, 'a refused re-roll changes nothing');
});

test('a single-image redraw prices one derived image or clip and refuses without approval', async t => {
  const out = freshRun(t), { directory } = prepare({ cast: CAST, out });
  const workflow = read(path.join(directory, 'workflow.api.json'));
  const cutin = artPlan(workflow, 'keystone_cutin'), intro = artPlan(workflow, 'keystone_intro'), idle = artPlan(workflow, 'keystone_idle');
  assert.deepEqual([cutin.type, cutin.estimatedUSD, cutin.kind], ['CFZCharacterArt', 0.048048, 'cutin']);
  // The cast runs Seedance 1.5 Pro at 1080p ($0.059/s) plus one 1K keyframe per fighter clip.
  assert.deepEqual([intro.type, intro.duration, intro.estimatedUSD, intro.video.model], ['CFZIntroVideo', 4, 0.284048, 'Seedance 1.5 Pro']);
  assert.deepEqual([idle.type, idle.duration, idle.estimatedUSD], ['CFZSelectIdleVideo', 6, 0.402048]);
  const title = artPlan(workflow, 'title_video'), select = artPlan(workflow, 'select_video', { videoModel: 'LTX-2.5 (Fast)' });
  assert.deepEqual([title.type, title.fighter, title.duration, title.estimatedUSD], ['CFZTitleVideo', null, 8, 0.472]);
  assert.deepEqual([select.type, select.estimatedUSD, select.video.model, select.video.resolution], ['CFZSelectVideo', 1.0296, 'LTX-2.5 (Fast)', '1080p'], 'LTX renders 720p whatever the resolution says, at its own rate');
  assert.throws(() => artPlan(workflow, 'title_video', { videoResolution: '4k' }), /Unsupported video model or resolution/);
  assert.equal(workflow[cutin.factory].inputs.character_id, 'keystone'); assert.ok(intro.environment);
  assert.throws(() => artPlan(workflow, 'keystone_sheet'), /--asset must be/);
  assert.throws(() => artPlan(workflow, 'nobody_cutin'), /No character factory/);
  await assert.rejects(rerollArt({ run: out, asset: 'keystone_cutin', approveUsd: '0.01' }), /about \$0\.048048; pass --approve-usd 0\.05/);
  assert.equal(pipeline(directory).artRerolls, undefined);
});

test('adding motion sheets to an existing run prices two 2K sheets per fighter and refuses without approval', async t => {
  const out = freshRun(t), { directory } = prepare({ cast: CAST, out, media: false, audio: false });
  const workflow = read(path.join(directory, 'workflow.api.json')), cast = read(path.join(directory, 'cast.json'));
  const all = sheetPlan(workflow, cast), two = sheetPlan(workflow, cast, { sheets: 'sheetF', fighters: 'keystone,cheddar' });
  assert.deepEqual([all.sheets, all.fighters.length, all.estimatedUSD], [['sheetF', 'sheetG'], 6, 0.864864]);
  assert.deepEqual([two.sheets, two.fighters.map(f => f.id), two.estimatedUSD], [['sheetF'], ['keystone', 'cheddar'], 0.144144]);
  assert.throws(() => sheetPlan(workflow, cast, { sheets: 'sheetD' }), /motion sheets/);
  assert.throws(() => sheetPlan(workflow, cast, { fighters: 'nobody' }), /No character factory/);
  fs.mkdirSync(path.join(directory, 'bundle'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'bundle/assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', game: cast, assets: [] }));
  await assert.rejects(addSheets({ run: out, approveUsd: '0.5' }), /about \$0\.864864; pass --approve-usd 0\.87/);
  assert.equal(pipeline(directory).addedSheets, undefined, 'a refused request records nothing');
});

test('a run over accepted art copies it, refuses the full generation and adds only the clips it lacks', async t => {
  const out = freshRun(t), accepted = path.join(ROOT, `${out}-accepted`), bytes = Buffer.from('accepted fixture art');
  t.after(() => fs.rmSync(accepted, { recursive: true, force: true }));
  const cast = read(path.join(ROOT, CAST)), fighters = cast.fighters.filter(f => f.enabled !== false).map(f => f.id), stages = cast.stages.filter(s => s.enabled !== false).map(s => s.id);
  const records = [...fighters.map(id => ({ id: `${id}_reference`, kind: 'reference', fighter: id, src: `raw/${id}_reference.webp` })), ...stages.map(id => ({ id, kind: 'stage', stage: id, src: `raw/${id}.webp` })), { id: 'select', kind: 'ui', src: 'raw/select.webp' }];
  for (const record of records) { fs.mkdirSync(path.join(accepted, 'raw'), { recursive: true }); fs.writeFileSync(path.join(accepted, record.src), bytes); }
  const game = { title: cast.title, subtitle: cast.subtitle, fighters: fighters.map(id => ({ id })), stages: stages.map(id => ({ id })) };
  fs.writeFileSync(path.join(accepted, 'assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', game, assets: records }));
  // A bundle of another cast is refused.
  assert.throws(() => prepare({ cast: 'comfyui/config/factory.json', out: `${out}-other`, accepted: path.relative(ROOT, accepted) }), /different cast/);
  fs.rmSync(path.join(ROOT, `${out}-other`), { recursive: true, force: true });
  const { directory } = prepare({ cast: CAST, out, accepted: path.relative(ROOT, accepted) });
  assert.deepEqual(pipeline(directory).accepted.images, records.length);
  for (const record of records) assert.ok(fs.existsSync(path.join(directory, 'bundle', record.src)), record.src);
  await assert.rejects(run({ run: out, approveUsd: '999' }), /extends the accepted .*add-media/);
  const workflow = read(path.join(directory, 'workflow.api.json')), bundle = path.join(directory, 'bundle');
  // The title loop animates ui/ensemble, which this bundle lacks unless --title-image names the art.
  assert.throws(() => mediaPlan(workflow, bundle, {}), /The title loop animates ui\/ensemble.*--title-image/);
  const fighterClips = mediaPlan(workflow, bundle, { clips: 'intro,idle' });
  assert.equal(fighterClips.todo.length, fighters.length * 2);
  assert.equal(fighterClips.estimatedUSD, Number((fighters.length * (0.284048 + 0.402048)).toFixed(6)));
  fs.writeFileSync(path.join(bundle, 'video.json'), JSON.stringify({ schema: 'comfy-fighter-video/v1', root: '.', fighterIntros: [{ id: `intro-${fighters[0]}`, fighter: fighters[0], src: 'raw/x.mp4', duration: 4, sha256: '0'.repeat(64) }] }));
  const resumed = mediaPlan(workflow, bundle, { clips: 'intro,idle,title,select', titleImage: 'build/public/arcade/title-ensemble.webp' });
  assert.deepEqual(resumed.skipped, [`${fighters[0]}_intro`]);
  assert.equal(resumed.todo.length, fighters.length * 2 - 1 + 2);
  assert.throws(() => mediaPlan(workflow, bundle, { clips: 'outro' }), /--clips takes intro, idle, title, select/);
  await assert.rejects(addMedia({ run: out, approveUsd: '0.01', clips: 'intro' }), /Adding \d+ clips costs about/);
  assert.equal(pipeline(directory).addedMedia, undefined);
});

test('a title card letters each kind of game with its own name and refuses without approval', async t => {
  const out = freshRun(t), { directory } = prepare({ cast: CAST, out });
  assert.deepEqual(parse(['title-card', '--example', '--approve-usd', '0.08', '--title', 'X', '--tagline', 'Y']).options, { example: true, approveUsd: '0.08', title: 'X', tagline: 'Y' });
  assert.throws(() => titleCardSource({}), /Choose one title-card source/);
  assert.throws(() => titleCardSource({ example: true, crossover: 'build/crossovers/ultra.json' }), /Choose one title-card source/);
  // A cast run letters its edition (the subtitle) over the series title, from the accepted ensemble.
  fs.mkdirSync(path.join(directory, 'bundle/raw'), { recursive: true });
  const game = { title: 'Comfy Fighter Z', subtitle: 'Blue Wave Saga', expectedAssets: ['title'] };
  fs.writeFileSync(path.join(directory, 'bundle/assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', game, assets: [{ id: 'title', kind: 'ui', src: 'raw/title.png' }] }));
  assert.throws(() => titleCardSource({ run: out }), /no accepted ui\/ensemble/);
  fs.writeFileSync(path.join(directory, 'bundle/assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', game, assets: [{ id: 'ensemble', kind: 'ui', src: 'raw/ensemble-0123456789abcdef.png' }] }));
  const cast = titleCardSource({ run: out });
  assert.deepEqual([cast.mode, cast.title, cast.tagline, path.relative(directory, cast.reference).split(path.sep).join('/'), cast.root],
    ['run', 'Blue Wave Saga', 'Comfy Fighter Z', 'bundle/raw/ensemble-0123456789abcdef.png', path.join(directory, 'bundle')]);
  await assert.rejects(titleCard({ run: out, approveUsd: '0.05' }), new RegExp(`one 2K image, about \\$${TITLE_CARD_USD}; pass --approve-usd 0\\.08`));
  assert.equal(pipeline(directory).titleCards, undefined);
  // The original game letters its own title over its saga, from the original cast's arcade title art.
  const example = titleCardSource({ example: true });
  assert.deepEqual([example.title, example.tagline, path.relative(ROOT, example.reference).split(path.sep).join('/')], ['Comfy Fighter Z', 'Higgsfield Open Source Saga', 'build/public/arcade/title-ensemble.webp']);
  // A crossover letters its subtitle and writes the card its definition maps as interface.card.
  const ultra = titleCardSource({ crossover: 'build/crossovers/ultra.json' });
  assert.deepEqual([ultra.title, ultra.tagline, path.relative(ROOT, ultra.target).split(path.sep).join('/')], ['Ultra Dream Match', 'Comfy Fighter Z', 'output/crossovers/ultra/card.png']);
  const definition = read(path.join(ROOT, 'build/crossovers/ultra.json')); delete definition.interface.card;
  const file = path.join(directory, 'crossover.json'); fs.writeFileSync(file, JSON.stringify(definition));
  assert.throws(() => titleCardSource({ crossover: path.relative(ROOT, file) }), /needs interface\.card/);
});

test('pack-media web-encodes heavy clips and WAV sounds, keeps the originals, and the export floor counts both copies', async t => {
  const { spawnSync } = require('node:child_process'), crypto = require('node:crypto');
  if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0 || spawnSync('ffprobe', ['-version'], { windowsHide: true }).status !== 0) return t.skip('ffmpeg and ffprobe required');
  const out = freshRun(t), { directory } = prepare({ cast: CAST, out, media: false, audio: false }), bundle = path.join(directory, 'bundle'), raw = path.join(bundle, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  const ffmpeg = args => assert.equal(spawnSync('ffmpeg', ['-v', 'error', ...args, '-y'], { windowsHide: true, encoding: 'utf8' }).status, 0);
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const frames = file => Number(JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }).stdout).streams[0].nb_read_packets);
  // A lossless 720p test pattern stands in for a Seedance clip (far above 12 Mbit/s); the light clip must be left alone.
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', '-an', path.join(raw, 'title-0123456789abcdef.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', '-an', path.join(raw, 'select-fedcba9876543210.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '2', '-ar', '44100', path.join(raw, 'menu_music-00112233445566aa.wav')]);
  const titleSha = sha(path.join(raw, 'title-0123456789abcdef.mp4')), titleFrames = frames(path.join(raw, 'title-0123456789abcdef.mp4'));
  fs.writeFileSync(path.join(bundle, 'video.json'), JSON.stringify({ titleVideo: { id: 'title', src: 'raw/title-0123456789abcdef.mp4', sha256: titleSha, duration: 1 },
    selectVideo: { id: 'select', src: 'raw/select-fedcba9876543210.mp4', sha256: sha(path.join(raw, 'select-fedcba9876543210.mp4')), duration: 1 } }));
  fs.writeFileSync(path.join(bundle, 'audio.json'), JSON.stringify({ schema: 'comfy-fighter-audio/v1', root: '.', assets: [{ id: 'menu_music', kind: 'audio', category: 'music', loop: true, src: 'raw/menu_music-00112233445566aa.wav', sha256: sha(path.join(raw, 'menu_music-00112233445566aa.wav')) }] }));
  fs.writeFileSync(path.join(bundle, 'assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', assets: [] }));
  const before = packageFloor(bundle);
  assert.equal(before.clips, 2); assert.equal(before.sounds, 1);
  assert.equal(before.bytes, 2 * ['title-0123456789abcdef.mp4', 'select-fedcba9876543210.mp4', 'menu_music-00112233445566aa.wav'].reduce((sum, name) => sum + fs.statSync(path.join(raw, name)).size, 0), 'runtime and sources each carry every clip and sound');
  await packMedia({ run: out });
  const video = read(path.join(bundle, 'video.json')), audio = read(path.join(bundle, 'audio.json')), state = pipeline(directory);
  assert.match(video.titleVideo.src, /^raw\/title-[0-9a-f]{16}\.mp4$/); assert.notEqual(video.titleVideo.sha256, titleSha);
  assert.equal(sha(path.join(bundle, video.titleVideo.src)), video.titleVideo.sha256);
  assert.equal(frames(path.join(bundle, video.titleVideo.src)), titleFrames, 'the web encode keeps every frame');
  assert.equal(video.selectVideo.src, 'raw/select-fedcba9876543210.mp4', 'a light clip is left alone');
  assert.match(audio.assets[0].src, /^raw\/menu_music-[0-9a-f]{16}\.mp3$/); assert.equal(audio.assets[0].codec, 'mp3'); assert.equal(audio.assets[0].sampleRate, 44100);
  assert.ok(fs.existsSync(path.join(directory, 'originals/title-0123456789abcdef.mp4')) && fs.existsSync(path.join(directory, 'originals/menu_music-00112233445566aa.wav')), 'originals are kept');
  assert.deepEqual(state.packedMedia[0].conversions.map(c => [c.id, c.kind]), [['title', 'video'], ['menu_music', 'audio']]);
  assert.ok(packageFloor(bundle).bytes < before.bytes);
  await packMedia({ run: out });
  assert.equal(pipeline(directory).packedMedia.length, 1, 'a second pass finds nothing left to pack');
});
