const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateConfig, requestText, makeNarrationWorkflow, assertFreshRun, validateCatalog } = require('../../comfyui/tools/prepare-explainer.cjs');
const config = require('../../comfyui/config/explainer.json');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-explainer-'));
  t.after(() => {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('cfz-explainer-') || fs.realpathSync(target) !== target) throw new Error('Unexpected explainer fixture cleanup path.');
    fs.rmSync(target, { recursive: true, force: true });
  });
  return directory;
}

function catalog() {
  return {
    ElevenLabsTextToSpeech: { price_badge: { expr: '{"usd":widgets.model = "eleven_v4" ? 0.1144 : 0.24,"format":{"suffix":"/1K chars"}}' } },
    ElevenLabsVoiceSelector: { input: { required: { voice: ['COMBO', { options: ['Brian (male, american)', 'Adam (male, american)'] }] } } },
    SaveAudioAdvanced: { output: ['AUDIO'] }
  };
}

test('explainer has twelve stock-voice requests, exact character pricing and separate FLAC saves', () => {
  assert.equal(validateConfig(config), 394);
  const { workflow, prompt, clips } = makeNarrationWorkflow(config, 'comfy-fighter-z/explainer/test');
  assert.equal(workflow.nodes.filter(node => node.type === 'ElevenLabsTextToSpeech').length, 12);
  assert.equal(workflow.nodes.filter(node => node.type === 'SaveAudioAdvanced').length, 12);
  assert.equal(workflow.nodes.filter(node => node.type === 'ElevenLabsVoiceSelector').length, 1);
  assert.equal(Object.keys(prompt).length, 25);
  assert.equal(workflow.nodes.filter(node => /LoadImage|LoadAudio|VoiceClone|RecordAudio/.test(node.type)).length, 0);
  assert.equal(clips.reduce((sum, clip) => sum + clip.billedCharacters, 0), 3112);
  assert.equal(Number(clips.reduce((sum, clip) => sum + clip.estimatedUSD, 0).toFixed(9)), 0.3560128);
  assert.equal(new Set(clips.map(clip => clip.filenamePrefix)).size, 12);
  for (const [index, clip] of clips.entries()) {
    assert.equal(prompt[clip.ttsNodeId].inputs.text, requestText(config, config.scenes[index]));
    assert.equal(clip.narration, config.scenes[index].narration);
    assert.equal(clip.billedCharacters, [...clip.providerText].length);
    assert.equal(prompt[clip.saveNodeId].inputs.filename_prefix, clip.filenamePrefix);
    assert.equal(prompt[clip.saveNodeId].inputs.format, 'flac');
    assert.deepEqual(prompt[clip.saveNodeId].inputs.audio, [clip.ttsNodeId, 0]);
    assert.deepEqual(prompt[clip.ttsNodeId].inputs.voice, ['1', 0]);
  }
  for (const [link, sourceId, sourceSlot, targetId, targetSlot, type] of workflow.links) {
    const source = workflow.nodes.find(node => node.id === sourceId), target = workflow.nodes.find(node => node.id === targetId);
    assert.ok(source.outputs[sourceSlot].links.includes(link));
    assert.equal(target.inputs[targetSlot].link, link);
    assert.equal(source.outputs[sourceSlot].type, type);
    assert.equal(target.inputs[targetSlot].type, type);
  }
});

test('caption text excludes delivery tags and mappings cannot escape the run', () => {
  const badCaption = structuredClone(config); badCaption.scenes[0].narration = '[whisper] ' + badCaption.scenes[0].narration;
  assert.throws(() => validateConfig(badCaption), /without delivery tags/);
  const badPath = structuredClone(config); badPath.scenes[0].audio = '../original.flac';
  assert.throws(() => validateConfig(badPath), /relative media mapping/);
  const missingScene = structuredClone(config); missingScene.scenes.pop();
  assert.throws(() => validateConfig(missingScene), /twelve/);
});

test('phone-photo explainer keeps ten chapters, a 120-second timeline and a concise stock-voice script', () => {
  const short = require('../../comfyui/config/phone-photo-explainer.json');
  assert.equal(validateConfig(short), 232);
  assert.equal(short.scenes.reduce((sum, scene) => sum + scene.targetSeconds, 0), 120);
  const { prompt, clips } = makeNarrationWorkflow(short, 'comfy-fighter-z/explainer/phone-test');
  assert.equal(clips.length, 10);
  assert.equal(clips.reduce((sum, clip) => sum + clip.billedCharacters, 0), 1920);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'ElevenLabsTextToSpeech').length, 10);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'SaveAudioAdvanced').length, 10);
  const changed = structuredClone(short); changed.scenes[0].targetSeconds += 1;
  assert.throws(() => validateConfig(changed), /exactly 120/);
});

test('prepared narration is preserved while a directory containing only captures can be used', t => {
  const root = fixture(t), directory = path.join(root, 'run');
  fs.mkdirSync(path.join(directory, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'captures', '01-result.webm'), 'existing capture');
  assert.doesNotThrow(() => assertFreshRun(directory));
  for (const name of ['plan.json', 'workflow.json', 'workflow.api.json']) {
    const file = path.join(directory, name); fs.writeFileSync(file, 'approved artifact');
    assert.throws(() => assertFreshRun(directory), /fresh output\/explainer/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'approved artifact');
    fs.unlinkSync(file);
  }
});

test('redirected output directories and junction ancestors are rejected', t => {
  const root = fixture(t), destination = path.join(root, 'destination'), redirect = path.join(root, 'redirect');
  fs.mkdirSync(destination);
  try { fs.symlinkSync(destination, redirect, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Directory links unavailable in this environment'); return; } throw error; }
  try { assert.throws(() => assertFreshRun(path.join(redirect, 'new-run')), /symbolic links|junctions|redirected/); }
  finally { fs.unlinkSync(redirect); }
});

test('live pricing guard rejects a changed v4 rate even if the old rate remains elsewhere', () => {
  assert.doesNotThrow(() => validateCatalog(catalog(), config));
  const changed = catalog(); changed.ElevenLabsTextToSpeech.price_badge.expr = '{"usd":widgets.model = "eleven_v4" ? 0.25 : 0.1144,"format":{"suffix":"/1K chars"}}';
  assert.throws(() => validateCatalog(changed, config), /pricing changed/);
  const missing = catalog(); delete missing.SaveAudioAdvanced;
  assert.throws(() => validateCatalog(missing, config), /Required node/);
  const unavailable = catalog(); unavailable.ElevenLabsVoiceSelector.input.required.voice[1].options = ['Adam (male, american)'];
  assert.throws(() => validateCatalog(unavailable, config), /Stock voice unavailable/);
});
