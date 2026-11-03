const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PLACEHOLDER, buildExample, validateConfig, prepare, checkPrices } = require('../../example/prepare.cjs');
const config = require('../../example/config.json');
const ROOT = path.resolve(__dirname, '../..');

test('complete example has six text-only factories, one arena, both mapped exports and all audio', () => {
  const { workflow, prompt, plan } = buildExample(config, PLACEHOLDER, { seed: 100 });
  assert.equal(Object.keys(prompt).length, 65);
  assert.equal(plan.expectedAssets, 56); assert.equal(plan.expectedAudio, 22); assert.equal(plan.runtimePoses, 162);
  assert.equal(plan.total.estimatedUSD, 3.619941867);
  assert.equal(plan.image.oneK, 35); assert.equal(plan.image.twoK, 21);
  assert.equal(plan.audio.voiceCharacters, 1353); assert.equal(plan.audio.musicSeconds, 105); assert.equal(plan.audio.effectsSeconds, 3.2);
  const nodes = type => workflow.nodes.filter(node => node.type === type);
  assert.equal(nodes('CFZCharacterFactory').length, 6);
  assert.equal(nodes('CFZEnvironmentFactory').length, 3);
  assert.equal(nodes('CFZEnvironmentFactory').filter(node => node.widgets_values_named.enabled).length, 1);
  for (const node of [...nodes('CFZCharacterFactory'), ...nodes('CFZEnvironmentFactory')]) {
    assert.equal(node.widgets_values_named.image, ''); assert.equal(node.widgets_values_named.source_mode, 'Invent fictional reference');
  }
  assert.equal(workflow.nodes.filter(node => /LoadImage|LoadAudio|CheckpointLoader|VoiceClone/.test(node.type)).length, 0);
  assert.equal(nodes('SoniloTextToMusic').length, 2); assert.equal(nodes('ElevenLabsTextToSoundEffects').length, 4); assert.equal(nodes('ElevenLabsTextToSpeech').length, 16);
  assert.equal(nodes('CFZSaveAudio').length, 22); assert.equal(nodes('CFZExportAudioManifest').length, 1); assert.equal(nodes('CFZExportGameAssets').length, 1);
  const project = nodes('CFZProjectSettings')[0], bridge = nodes('CFZProjectAudioRoot')[0];
  assert.equal(project.widgets_values_named.root_directory, PLACEHOLDER);
  assert.equal(nodes('CFZAssetRoot').length, 0);
  assert.deepEqual(prompt[bridge.id].inputs.project, [String(project.id), 0]);
  const audioConfig = JSON.parse(bridge.widgets_values_named.audio_config);
  assert.deepEqual(audioConfig.stages.map(stage => stage.id), ['yard']);
  assert.deepEqual(audioConfig.expectedAudio, plan.audioIds);
  for (const [id, sourceId, sourceSlot, targetId, targetSlot, type] of workflow.links) {
    const source = workflow.nodes.find(node => node.id === sourceId), target = workflow.nodes.find(node => node.id === targetId);
    assert.ok(source.outputs[sourceSlot].links.includes(id)); assert.equal(target.inputs[targetSlot].link, id);
    assert.equal(source.outputs[sourceSlot].type, type); assert.equal(target.inputs[targetSlot].type, type);
    assert.deepEqual(prompt[targetId].inputs[target.inputs[targetSlot].name], [String(sourceId), sourceSlot]);
  }
});

test('example preparation is offline by default, portable, and preserves previous runs', async t => {
  const directory = path.join(ROOT, 'output/example', `test-${randomUUID()}`);
  t.after(() => {
    if (path.dirname(directory) !== path.join(ROOT, 'output/example') || !path.basename(directory).startsWith('test-') || fs.realpathSync(directory) !== directory) throw new Error('Unexpected example fixture cleanup path.');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const result = await prepare({ out: directory, fetchImpl: () => { throw new Error('Offline preparation attempted network access'); } });
  assert.equal(result.generationSubmitted, false); assert.equal(result.total.paidImages, 56);
  assert.equal(result.bundle, path.join(directory, 'bundle'));
  const file = path.join(directory, 'workflow.api.json'), before = fs.readFileSync(file);
  const prompt = JSON.parse(before), project = Object.values(prompt).find(node => node.class_type === 'CFZProjectSettings');
  assert.equal(project.inputs.root_directory, result.bundle);
  await assert.rejects(prepare({ out: directory }), /already exists/);
  assert.deepEqual(fs.readFileSync(file), before);
  const shipped = fs.readFileSync(path.join(ROOT, 'example/workflow.json'), 'utf8');
  assert.ok(shipped.includes(PLACEHOLDER)); assert.doesNotMatch(shipped, /C:\\\\Users|C:\/Users|LoadImage/);
  assert.ok(JSON.parse(shipped).nodes.filter(node => node.type !== 'MarkdownNote').every(node => node.mode === 2), 'Unprepared shipped graph cannot queue independent audio branches');
  assert.ok(JSON.parse(fs.readFileSync(path.join(directory, 'workflow.json'))).nodes.every(node => node.mode === 0), 'Prepared workflow is runnable');
});

test('example configuration rejects reused image inputs and extra enabled environments', () => {
  const oldImage = structuredClone(config); oldImage.fighters[0].sourceInput = 'previous.png';
  assert.throws(() => validateConfig(oldImage), /text-only/);
  const stages = structuredClone(config); stages.stages[1].enabled = true;
  assert.throws(() => validateConfig(stages), /The Yard enabled/);
  const intro = structuredClone(config); intro.fighters[0].introTagline = '';
  assert.throws(() => validateConfig(intro), /introduction/);
});

test('example price guard checks the selected rate branches rather than unrelated old numbers', () => {
  const catalog = {
    GeminiNanoBanana2V2: { price_badge: { expr: 'banana 2.1; $image := {"1k":0.048048,"2k":0.072072}; $thinking := {"minimal":0};' } },
    SoniloTextToMusic: { price_badge: { expr: '{"usd":0.0025 * widgets.duration}' } },
    ElevenLabsTextToSoundEffects: { price_badge: { expr: '{"usd":0.14,"suffix":"/minute"}' } },
    ElevenLabsTextToSpeech: { price_badge: { expr: '{"usd":widgets.model = "eleven_v4" ? 0.1144 : 0.24,"suffix":"/1K chars"}' } }
  };
  assert.equal(Object.keys(checkPrices(catalog)).length, 4);
  const changed = structuredClone(catalog); changed.GeminiNanoBanana2V2.price_badge.expr = 'banana 2.1; $image := {"1k":0.20,"2k":0.072072}; $thinking := {"minimal":0}; old = 0.048048;';
  assert.throws(() => checkPrices(changed), /image pricing changed/);
  const speech = structuredClone(catalog); speech.ElevenLabsTextToSpeech.price_badge.expr = '{"usd":widgets.model = "eleven_v4" ? 0.25 : 0.1144,"suffix":"/1K chars"}';
  assert.throws(() => checkPrices(speech), /speech pricing changed/);
});
