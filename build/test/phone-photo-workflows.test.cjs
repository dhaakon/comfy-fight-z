const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateConfig, buildRun, prepare, freshDirectory } = require('../../comfyui/tools/prepare-phone-photo-demo.cjs');
const { buildExample, makeTemplate } = require('../../example/prepare.cjs');
const config = require('../../comfyui/config/phone-photo-demo.json');
const ROOT = path.resolve(__dirname, '../..');

test('phone-photo sources are exactly seven native 2K text-only cloud requests with separate saves', () => {
  const prepared = buildRun(config, path.join(ROOT, 'output/phone-photo-demo/test'), 'test', 3000);
  const generation = prepared.photoGraph.nodes.filter(node => node.type === 'GeminiNanoBanana2V2');
  assert.equal(generation.length, 7);
  assert.equal(prepared.photoGraph.nodes.filter(node => node.type === 'SaveImage').length, 7);
  assert.equal(Object.keys(prepared.photoPrompt).length, 14);
  assert.equal(prepared.photoGraph.nodes.filter(node => /LoadImage|ImageInput|Checkpoint/.test(node.type)).length, 0);
  for (const node of generation) {
    assert.deepEqual(node.inputs, []); assert.equal(node.widgets_values_named['model.resolution'], '2K');
    assert.equal(node.widgets_values_named.model, 'Gemini Nano Banana 2.1');
    assert.match(node.widgets_values_named.prompt, /TEXT ONLY|from TEXT ONLY/);
    assert.match(node.widgets_values_named.prompt, /fictional|invented/);
    assert.match(node.widgets_values_named.prompt, /[Nn]o green.screen/);
    assert.equal(prepared.photoPrompt[node.id].inputs.images, undefined);
  }
  for (const job of prepared.plan.references) {
    assert.equal(prepared.photoPrompt[job.saveNodeId].inputs.filename_prefix, job.filenamePrefix);
    assert.deepEqual(prepared.photoPrompt[job.saveNodeId].inputs.images, [job.generatorNodeId, 0]);
    assert.equal(job.uploadFilename, `cfz-phone-test-${job.id}.png`);
    assert.equal(job.localFile, `references/${job.id}.png`);
  }
  assert.equal(prepared.plan.phases[0].estimatedUSD, .504504);
});

test('game phase exclusively selects the newly named seven uploads and maps complete image/audio bundles', () => {
  const { gameGraph, gamePrompt, plan } = buildRun(config, path.join(ROOT, 'output/phone-photo-demo/test'), 'test', 3000);
  const factories = gameGraph.nodes.filter(node => ['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.type));
  assert.equal(factories.length, 9);
  const selected = factories.filter(node => node.type === 'CFZCharacterFactory' || node.widgets_values_named.enabled);
  assert.equal(selected.length, 7);
  assert.deepEqual(selected.map(node => node.widgets_values_named.image).sort(), plan.references.map(job => job.uploadFilename).sort());
  for (const node of factories) assert.equal(node.widgets_values_named.source_mode, 'Upload reference');
  for (const node of factories.filter(node => node.type === 'CFZEnvironmentFactory' && !node.widgets_values_named.enabled)) assert.equal(node.widgets_values_named.image, '');
  assert.equal(plan.game.image.paidImages, 49); assert.equal(plan.game.image.oneK, 29); assert.equal(plan.game.image.twoK, 20);
  assert.equal(plan.game.image.mappedAssets, 56); assert.equal(plan.game.audio.paidClips, 2 + 1 + 4 + 20 + 20 + 6 * 7); assert.equal(plan.runtimePoses, 162);
  assert.equal(plan.total.paidImages, 56); assert.equal(plan.total.estimatedUSD, 4.4780136);
  const project = gameGraph.nodes.find(node => node.type === 'CFZProjectSettings'), bridge = gameGraph.nodes.find(node => node.type === 'CFZProjectAudioRoot');
  assert.deepEqual(gamePrompt[bridge.id].inputs.project, [String(project.id), 0]);
  assert.equal(gameGraph.nodes.filter(node => node.type === 'CFZAssetRoot').length, 0);
  for (const [id, from, slot, to, input, type] of gameGraph.links) {
    const source = gameGraph.nodes.find(node => node.id === from), target = gameGraph.nodes.find(node => node.id === to);
    assert.ok(source.outputs[slot].links.includes(id)); assert.equal(target.inputs[input].link, id);
    assert.equal(source.outputs[slot].type, type); assert.equal(target.inputs[input].type, type);
    assert.deepEqual(gamePrompt[to].inputs[target.inputs[input].name], [String(from), slot]);
  }
});

test('the phone recipe rejects earlier input files and preserves the existing example text-only policy', () => {
  for (const key of ['sourceInput', 'sourceImage', 'sampleSourceImage', 'acceptedReferenceInput']) {
    const reused = structuredClone(config); reused.fighters[0][key] = 'earlier-photo.png';
    assert.throws(() => validateConfig(reused), /earlier images/);
  }
  const wrongStage = structuredClone(config); wrongStage.stages[1].enabled = true;
  assert.throws(() => validateConfig(wrongStage), /only The Yard/);
  const duplicate = structuredClone(config); duplicate.stages[1].id = 'griddle';
  assert.throws(() => validateConfig(duplicate), /Duplicate/);
  const invent = structuredClone(config); invent.fighters[0].sourceMode = 'Invent fictional reference';
  assert.throws(() => validateConfig(invent), /must use Upload reference/);
  assert.throws(() => buildExample(config, '/unused'), /fictional Comfy Fighter Z example/);
  const old = structuredClone(require('../../example/config.json')); old.fighters[0].sourceMode = 'Upload reference';
  assert.throws(() => buildExample(old, '/unused'), /text-only/);
});

test('fresh photo descriptions reach every factory without earlier hero identity text', () => {
  const { gameGraph } = buildRun(config, path.join(ROOT, 'output/phone-photo-demo/test'), 'test', 3000);
  const original = require('../../comfyui/config/factory.json');
  for (const fighter of config.fighters) {
    const node = gameGraph.nodes.find(node => node.type === 'CFZCharacterFactory' && node.widgets_values_named.character_id === fighter.id);
    assert.equal(node.widgets_values_named.description, fighter.description);
    assert.notEqual(node.widgets_values_named.description, original.fighters.find(item => item.id === fighter.id).description);
    assert.equal(node.widgets_values_named.name, fighter.name);
    assert.equal(node.widgets_values_named.special_description, fighter.specialMove.description);
  }
  const project = gameGraph.nodes.find(node => node.type === 'CFZProjectSettings');
  assert.equal(project.widgets_values_named.style, config.style);
  assert.match(project.widgets_values_named.style, /Preserve that invented adult's visible face shape/);
  const yard = gameGraph.nodes.find(node => node.type === 'CFZEnvironmentFactory' && node.widgets_values_named.enabled);
  const shared = gameGraph.nodes.find(node => node.type === 'CFZSharedArtFactory');
  const link = gameGraph.links.find(link => link[0] === shared.inputs.find(input => input.name === 'stage_reference').link);
  assert.equal(link[1], yard.id); assert.equal(link[2], 1);
});

test('composition extraction leaves the accepted example template exactly unchanged', () => {
  const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/workflow.json'), 'utf8'));
  assert.deepEqual(makeTemplate(require('../../example/config.json')), existing);
});

test('repeated template preparation and unsafe paths fail before new artifacts are created', async () => {
  const fresh = path.join(ROOT, 'output/phone-photo-demo', `not-created-${process.pid}`);
  assert.equal(fs.existsSync(fresh), false);
  await assert.rejects(prepare({ out: fresh, templates: true }), /templates already exist/);
  assert.equal(fs.existsSync(fresh), false);
  assert.throws(() => freshDirectory('example/phone-photos'), /below output/);
  assert.throws(() => buildRun(config, fresh, 'safe-name', Number.MAX_SAFE_INTEGER), /safe seed/);
});

test('shipped photo recipes contain no personal paths and remain muted until prepared', () => {
  for (const filename of ['01-invent-phone-photos.json', '02-photos-to-game.json']) {
    const source = fs.readFileSync(path.join(ROOT, 'comfyui/workflows/phone-photo-demo', filename), 'utf8'), workflow = JSON.parse(source);
    assert.doesNotMatch(source, /C:\\\\Users|C:\/Users|cfz-demo-|comfyui\/ref\/demo/);
    assert.ok(workflow.nodes.filter(node => node.type !== 'MarkdownNote').every(node => node.mode === 2));
    assert.equal(workflow.nodes.filter(node => node.type === 'LoadImage').length, 0);
    if (filename === '02-photos-to-game.json') {
      const project = workflow.nodes.find(node => node.type === 'CFZProjectSettings');
      assert.equal(project.widgets_values_named.root_directory, '__PHONE_PHOTO_DEMO_BUNDLE_ROOT__');
      assert.equal(project.widgets_values[0], project.widgets_values_named.root_directory);
      const factories = workflow.nodes.filter(node => ['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.type));
      assert.equal(factories.length, 9);
      assert.ok(factories.every(node => node.widgets_values_named.source_mode === 'Upload reference'));
      const selected = factories.filter(node => node.type === 'CFZCharacterFactory' || node.widgets_values_named.enabled);
      const expected = [...config.fighters, config.stages[0]].map(item => `cfz-phone-NEW_RUN-${item.id}.png`);
      assert.deepEqual(selected.map(node => node.widgets_values_named.image).sort(), expected.sort());
      assert.deepEqual(workflow.extra.cfzPhonePhotoDemo.uploadFilenames.slice().sort(), expected);
      assert.ok(factories.filter(node => node.type === 'CFZEnvironmentFactory' && !node.widgets_values_named.enabled).every(node => node.widgets_values_named.image === ''));
    }
  }
});
