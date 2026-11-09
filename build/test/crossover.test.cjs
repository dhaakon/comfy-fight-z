const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createCanvas } = require('@napi-rs/canvas');
const { buildCrossover, loadDefinition } = require('../tools/crossover.cjs');

const ROOT = path.resolve(__dirname, '../..');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = file => path.relative(ROOT, file).split(path.sep).join('/');

function png(file, color, width = 48, height = 64) {
  const canvas = createCanvas(width, height), context = canvas.getContext('2d');
  context.fillStyle = color; context.fillRect(0, 0, width, height);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, canvas.toBuffer('image/png'));
}
function bytes(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }

// A small installed game: three poses a fighter, a portrait, voice lines, one arena with music, shared clips and art.
function game(dir, { fighters, stages, color, boss = null }) {
  const manifest = { version: 1, title: 'Comfy Fighter Z', subtitle: path.basename(dir), fighters: [], stages: [], ui: {}, effects: {}, audio: {} };
  const clip = (key, text) => { const src = `assets/audio/${key}.mp3`; bytes(path.join(dir, src), text); manifest.audio[key] = { id: key, src, duration: 1, sha256: digest(path.join(dir, src)) }; };
  for (const id of fighters) {
    const poses = {};
    for (const pose of ['idle', 'walk', 'punch']) { const src = `assets/fighters/${id}_${pose}.png`; png(path.join(dir, src), color); poses[pose] = { src, w: 48, h: 64, ax: 24, ay: 63, top: 0, bh: 64 }; }
    const portrait = `assets/portraits/${id}_portrait.png`; png(path.join(dir, portrait), color);
    manifest.fighters.push({ id, name: id.toUpperCase(), style: id === boss ? 'boss' : 'balanced', ...(id === boss ? { boss: true } : {}), poses, portrait });
    for (const line of ['intro', 'win']) clip(`fighter_${id}_${line}`, `${id} ${line}`);
  }
  for (const id of stages) { const src = `assets/stages/${id}.png`; png(path.join(dir, src), color, 96, 54); manifest.stages.push({ id, name: id, src }); clip(`${id}_music`, `${id} music`); }
  for (const key of ['menu_music', 'ann_versus']) clip(key, `${path.basename(dir)} ${key}`);
  for (const id of ['logo', 'ensemble']) { manifest.ui[id] = `assets/ui/${id}.png`; png(path.join(dir, manifest.ui[id]), color, 96, 54); }
  manifest.effects.hit = { src: 'assets/effects/hit.png', w: 48, h: 64, ax: 24, ay: 63 }; png(path.join(dir, manifest.effects.hit.src), color);
  bytes(path.join(dir, 'assets/manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function fixture(t) {
  const base = path.join(ROOT, 'output/test-runs', `.crossover-${process.pid}-${crypto.randomBytes(3).toString('hex')}`);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  game(path.join(base, 'alpha'), { fighters: ['ace', 'bolt', 'czar'], stages: ['dock', 'roof'], color: '#e33', boss: 'czar' });
  game(path.join(base, 'beta'), { fighters: ['dart', 'echo', 'zero'], stages: ['lab'], color: '#33e', boss: 'zero' });
  const definition = {
    schema: 'comfy-fighter-crossover/v1', slot: 'mashup', title: 'Comfy Fighter Z', subtitle: 'Test Dream Match', publicFigures: false,
    shared: 'alpha', finalBoss: 'czar', bossStage: 'roof', arcade: { perSeries: 2 },
    series: [{ id: 'alpha', tag: 'Alpha', name: 'Alpha Game', game: relative(path.join(base, 'alpha')) }, { id: 'beta', name: 'Beta Game', game: relative(path.join(base, 'beta')) }]
  };
  const write = (value, name = 'mashup.json') => { const file = path.join(base, name); bytes(file, JSON.stringify(value, null, 2)); return file; };
  return { base, definition, write };
}

test('a crossover merges every fighter and arena with one final boss, series data and only the shared series\' common clips', async t => {
  const { base, definition, write } = fixture(t);
  const before = ['alpha', 'beta'].map(id => digest(path.join(base, id, 'assets/manifest.json')));
  const { manifest, record } = await buildCrossover({ definitionPath: write(definition), out: path.join(base, 'out'), log: () => {} });
  const out = path.join(base, 'out');
  assert.deepEqual(manifest.fighters.map(f => f.id), ['ace', 'bolt', 'czar', 'dart', 'echo', 'zero']);
  assert.deepEqual(manifest.fighters.map(f => f.series), ['alpha', 'alpha', 'alpha', 'beta', 'beta', 'beta']);
  assert.deepEqual(manifest.stages.map(s => [s.id, s.series]), [['dock', 'alpha'], ['roof', 'alpha'], ['lab', 'beta']]);
  // One final boss; the other game's boss stays selectable with its boss moveset.
  assert.deepEqual(manifest.fighters.filter(f => f.boss).map(f => f.id), ['czar']);
  assert.equal(manifest.fighters.find(f => f.id === 'zero').style, 'boss');
  assert.equal('boss' in manifest.fighters.find(f => f.id === 'zero'), false);
  assert.deepEqual(manifest.series.map(s => [s.id, s.tag, s.fighters.length, s.stages.length]), [['alpha', 'Alpha', 3, 2], ['beta', 'Beta Game', 3, 1]]);
  assert.deepEqual(manifest.arcade, { perSeries: 2, bossStage: 'roof' });
  assert.equal(manifest.publicFigures, false);
  // Voice lines and arena music travel with their owners; common clips come from the shared series only.
  for (const id of ['ace', 'bolt', 'czar', 'dart', 'echo', 'zero']) assert.ok(manifest.audio[`fighter_${id}_intro`] && manifest.audio[`fighter_${id}_win`], id);
  for (const id of ['dock', 'roof', 'lab']) assert.ok(manifest.audio[`${id}_music`], id);
  assert.equal(fs.readFileSync(path.join(out, manifest.audio.menu_music.src), 'utf8'), 'alpha menu_music');
  assert.deepEqual(record.droppedAudio.sort(), ['beta:ann_versus', 'beta:menu_music']);
  assert.equal(manifest.ui.logo, 'assets/ui/logo.png');
  assert.equal(fs.readFileSync(path.join(out, 'assets/ui/logo.png')).equals(fs.readFileSync(path.join(base, 'alpha/assets/ui/logo.png'))), true);
  // Every mapped file is in place, output media is hard-linked where possible, and the sources are untouched.
  for (const fighter of manifest.fighters) for (const pose of Object.values(fighter.poses)) assert.ok(fs.statSync(path.join(out, pose.src)).isFile());
  assert.ok(record.linked + record.copied >= 30);
  for (const file of ['index.html', 'game.js', 'engine.js', 'style.css', 'start-server.cjs', 'package.json', 'installation.json']) assert.ok(fs.existsSync(path.join(out, file)), file);
  assert.equal(record.fighters, 6); assert.equal(record.stages, 3); assert.equal(record.poses, 18); assert.equal(record.finalBoss, 'czar');
  assert.deepEqual(['alpha', 'beta'].map(id => digest(path.join(base, id, 'assets/manifest.json'))), before);
  assert.equal(fs.readdirSync(base).some(name => name.includes('staging')), false);
});

test('a crossover refuses ambiguous rosters, a missing boss or arena, undeclared satire and missing media', async t => {
  const { base, definition, write } = fixture(t);
  const build = value => buildCrossover({ definitionPath: write(value), out: path.join(base, 'out'), log: () => {} });
  await assert.rejects(build({ ...definition, publicFigures: undefined }), /publicFigures/);
  await assert.rejects(build({ ...definition, finalBoss: 'nobody' }), /finalBoss nobody/);
  await assert.rejects(build({ ...definition, bossStage: 'moon' }), /bossStage moon/);
  await assert.rejects(build({ ...definition, shared: 'gamma' }), /shared must name a series/);
  await assert.rejects(build({ ...definition, series: [definition.series[0]] }), /at least two games/);
  // The same fighter id in two games would make voice lines and art ambiguous.
  game(path.join(base, 'gamma'), { fighters: ['ace', 'fang'], stages: ['pit'], color: '#3e3' });
  await assert.rejects(build({ ...definition, series: [...definition.series, { id: 'gamma', name: 'Gamma', game: relative(path.join(base, 'gamma')) }] }), /Fighter ace is in both alpha and gamma/);
  fs.rmSync(path.join(base, 'beta/assets/fighters/echo_walk.png'));
  await assert.rejects(build(definition), /ENOENT|no such file/i);
  assert.equal(fs.existsSync(path.join(base, 'out')), false);
  assert.equal(fs.readdirSync(base).some(name => name.includes('staging')), false);
});

test('the Ultra definition names every installed game, one final boss and the satire flag', () => {
  const definition = loadDefinition(path.join(ROOT, 'build/crossovers/ultra.json'));
  assert.deepEqual(definition.series.map(s => s.id), ['cfz', 'rogue', 'midterm', 'billionaires']);
  assert.equal(definition.series[0].game, 'build/public');
  assert.equal(definition.publicFigures, true);
  assert.equal(definition.finalBoss, 'bylaw');
  assert.equal(definition.shared, 'cfz');
  // The canonical runtime that anchors the crossover stays the fictional cast.
  const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/public/assets/manifest.json'), 'utf8'));
  assert.ok(canonical.fighters.some(f => f.id === definition.finalBoss && f.boss === true));
  assert.ok(canonical.stages.some(s => s.id === definition.bossStage));
  assert.equal(canonical.series, undefined);
});

test('the title montage and key-art composite come from the listed images and clips', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async t => {
  const { base, definition, write } = fixture(t);
  const clip = path.join(base, 'beta/assets/video/title.mp4');
  fs.mkdirSync(path.dirname(clip), { recursive: true });
  const made = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '1.5', '-pix_fmt', 'yuv420p', clip], { windowsHide: true });
  assert.equal(made.status, 0, String(made.stderr));
  const images = ['alpha/assets/ui/ensemble.png', 'beta/assets/ui/ensemble.png', 'alpha/assets/stages/dock.png', 'beta/assets/stages/lab.png'].map(file => relative(path.join(base, file)));
  const { manifest } = await buildCrossover({ definitionPath: write({ ...definition, ensemble: images, titleMontage: [{ image: images[0], seconds: 2 }, { video: relative(clip) }] }), out: path.join(base, 'out'), log: () => {} });
  assert.equal(manifest.ui.ensemble, 'assets/ui/ensemble.webp');
  assert.ok(fs.statSync(path.join(base, 'out/assets/ui/ensemble.webp')).size > 0);
  assert.equal(manifest.titleVideo.src, 'assets/video/title.mp4');
  // Two segments joined by one 0.4 s flash: 2 + 1.5 - 0.4 seconds.
  assert.ok(Math.abs(manifest.titleVideo.duration - 3.1) < 0.15, String(manifest.titleVideo.duration));
  assert.equal(manifest.titleVideo.sha256, digest(path.join(base, 'out/assets/video/title.mp4')));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(base, 'out/assets/video/title.mp4')], { encoding: 'utf8', windowsHide: true });
  assert.equal(probe.stdout.trim(), '1920,1080');
});
