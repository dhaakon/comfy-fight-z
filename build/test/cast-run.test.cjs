const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCast, loadCast, validateCast, prepare } = require('../../comfyui/tools/prepare-cast-run.cjs');
const ROOT = path.resolve(__dirname, '../..');
const CAST = 'comfyui/casts/blue-wave-2026.json';
const root = path.resolve('portable-cast/bundle');
const count = (prompt, type) => Object.values(prompt).filter(node => node.class_type === type).length;

test('a cast file extends the canonical art direction and layout and invents every reference from text', () => {
  const cast = loadCast(CAST), base = JSON.parse(fs.readFileSync(path.join(ROOT, 'comfyui/config/factory.json'), 'utf8'));
  assert.equal(cast.title, 'Comfy Fighter Z'); assert.equal(cast.subtitle, 'Blue Wave Saga');
  assert.deepEqual(cast.sheets, base.sheets); assert.deepEqual(cast.extraSheets, base.extraSheets); assert.equal(cast.model, base.model);
  assert.notEqual(cast.style, base.style, 'the cast carries its own theme text');
  assert.equal(cast.fighters.length, 6); assert.equal(cast.stages.length, 1);
  assert.ok(cast.fighters.every(f => !f.sourceImage && !f.sourceInput && f.description.includes('completely invented')));
  assert.ok(!JSON.stringify(cast).match(/\b(Trump|Cooper|Talarico|Paxton|Abbott|Ossoff|Pritzker)\b/), 'no real people are named');
});

test('the six-fighter cast run prices every image, the startup media and the audio in one workflow', () => {
  const { workflow, prompt, plan, game } = buildCast(loadCast(CAST), root, { seed: 9 });
  assert.deepEqual([count(prompt, 'CFZCharacterFactory'), count(prompt, 'CFZSpriteSheet'), count(prompt, 'CFZEnvironmentFactory'), count(prompt, 'CFZSharedArtFactory')], [6, 30, 1, 1]);
  assert.deepEqual([count(prompt, 'CFZTitleArt'), count(prompt, 'CFZTitleVideo'), count(prompt, 'CFZSelectVideo'), count(prompt, 'CFZIntroVideo'), count(prompt, 'CFZSelectIdleVideo'), count(prompt, 'CFZExportVideos'), count(prompt, 'CFZExportGameAssets')], [1, 1, 1, 6, 6, 1, 1]);
  assert.equal(count(prompt, 'CFZSaveAudio'), 89); assert.equal(count(prompt, 'CFZExportAudioManifest'), 1);
  // Sheets B-E of every fighter reference sheet A so scale and facing stay consistent.
  const sheets = Object.values(prompt).filter(node => node.class_type === 'CFZSpriteSheet');
  assert.equal(sheets.filter(node => node.inputs.reference_sheet).length, 24);
  for (const node of Object.values(prompt)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(prompt[value[0]], 'Every link resolves');
  const project = Object.values(prompt).find(node => node.class_type === 'CFZProjectSettings');
  assert.equal(project.inputs.root_directory, root); assert.equal(project.inputs.seed, 9); assert.equal(project.inputs.subtitle, 'Blue Wave Saga');
  assert.ok(project.inputs.style.includes('hometown champions'));
  assert.deepEqual(plan.images, { paidImages: 81, oneK: 48, twoK: 33, mappedAssets: 76, estimatedUSD: 4.68468 });
  assert.deepEqual([plan.videos.clips, plan.videos.seconds, plan.audio.clips], [14, 76, 89]);
  assert.equal(plan.total.estimatedUSD, 15.615426); assert.equal(plan.generationSubmitted, false); assert.equal(plan.runtimePoses, 270);
  assert.deepEqual(plan.fighters, ['keystone', 'cheddar', 'saguaro', 'beacon', 'bluebonnet', 'sunflower']); assert.deepEqual(plan.stages, ['statehouse']);
  assert.equal(game.fighters.length, 6);
  assert.equal(workflow.nodes.filter(node => node.type !== 'MarkdownNote').length, Object.keys(prompt).length);
});

test('media and audio can be left out and the plan prices only what remains', () => {
  const cast = loadCast(CAST);
  const images = buildCast(cast, root, { media: false, audio: false });
  assert.equal(count(images.prompt, 'CFZTitleArt') + count(images.prompt, 'CFZIntroVideo') + count(images.prompt, 'CFZSaveAudio'), 0);
  assert.equal(images.plan.videos, null); assert.equal(images.plan.audio, null);
  assert.deepEqual(images.plan.images, { paidImages: 68, oneK: 36, twoK: 32, mappedAssets: 75, estimatedUSD: 4.036032 });
  assert.equal(images.plan.total.estimatedUSD, 4.036032);
  const stills = buildCast(cast, root, { media: false });
  assert.equal(stills.plan.audio.clips, 89); assert.equal(stills.plan.total.estimatedUSD, 5.185578);
});

test('cast validation rejects what the factory or the game cannot use', () => {
  const cast = loadCast(CAST), clone = () => JSON.parse(JSON.stringify(cast));
  const broken = (mutate, pattern) => { const copy = clone(); mutate(copy); assert.throws(() => validateCast(copy), pattern); };
  broken(copy => { copy.fighters[1].id = 'keystone'; }, /duplicate id/);
  broken(copy => { copy.fighters[0].introVoice = 'Someone famous'; }, /introVoice/);
  broken(copy => { copy.fighters[0].style = 'ninja'; }, /style must be one of/);
  broken(copy => { copy.fighters[0].boss = true; copy.fighters[1].boss = true; }, /at most one final boss/);
  broken(copy => { copy.fighters[0].sourceMode = 'Upload reference'; copy.fighters[0].sourceInput = 'photo.png'; }, /invent every reference/);
  broken(copy => { copy.fighters[0].description = 'A real senator from Texas drawn as a fighter.'; }, /80-1600 characters|real people/);
  broken(copy => { copy.fighters.push(...copy.fighters.slice(0, 3).map(f => ({ ...f, id: f.id + '2' }))); }, /between two and eight/);
  broken(copy => { copy.stages = []; }, /between one and three/);
  broken(copy => { copy.sheets.sheet[0] = 'rest'; }, /sheets must match/);
  broken(copy => { copy.title = 'X'; }, /title/);
  broken(copy => { copy.fighters[0].color = 'blue'; }, /color/);
});

test('prepare writes the workflow, API prompt, plan and merged cast into a fresh run folder', t => {
  const out = `output/test-runs/cast-test-${process.pid}-${Date.now()}`, directory = path.join(ROOT, out);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { plan } = prepare({ cast: CAST, out, seed: 3, media: false });
  assert.deepEqual(fs.readdirSync(directory).sort(), ['cast.json', 'plan.json', 'workflow.api.json', 'workflow.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'cast.json'), 'utf8')).fighters.length, 6);
  assert.equal(plan.bundle, path.join(directory, 'bundle')); assert.equal(plan.videos, null);
  assert.throws(() => prepare({ cast: CAST, out, seed: 3 }), /Choose a new run directory/);
  assert.throws(() => prepare({ cast: CAST, out: 'output/exports/nope' }), /output\/test-runs/);
  assert.throws(() => prepare({ out: 'output/test-runs/none' }), /--cast/);
});
