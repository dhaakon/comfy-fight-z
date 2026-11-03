const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeAudioJobs, makeAudioGraph } = require('../../comfyui/tools/prepare-audio-workflows.cjs');
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'));

test('audio graph maps cloud outputs and waits for the complete audio bundle', () => {
  const config = load('comfyui/config/game.json'), jobs = makeAudioJobs(config);
  const templates = { music: load('comfyui/workflows/templates/cloud-music.json'), voice: load('comfyui/workflows/templates/cloud-voice.json'), sfx: load('comfyui/workflows/templates/cloud-sfx.json') };
  const graph = makeAudioGraph(jobs, config, templates);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const root = graph.nodes.find(node => node.type === 'DFZAssetRoot');
  const exported = graph.nodes.find(node => node.type === 'DFZExportAudioManifest');
  assert.equal(jobs.length, 10 + config.fighters.length + config.fighters.filter(fighter => fighter.introTagline).length);
  assert.deepEqual(JSON.parse(root.widgets_values[1]).expectedAudio, jobs.map(job => job.id));
  assert.equal(graph.nodes.filter(node => node.type === 'DFZSaveAudio').length, jobs.length);
  assert.equal(exported.inputs.filter(input => input.type === 'DFZ_AUDIO_ASSET').length, jobs.length);
  assert.equal(graph.nodes.some(node => /Clone|Checkpoint|Loader/.test(node.type)), false);
  for (const job of jobs) {
    const generator = graph.nodes.find(node => node.title === `${job.id} | cloud audio`);
    assert.equal(generator.type, job.model);
    assert.deepEqual(generator.widgets_values, Object.values(generator.widgets_values_named));
    const saveLink = graph.links.find(link => link[1] === generator.id && link[5] === 'AUDIO');
    const save = byId.get(saveLink[3]); assert.equal(save.type, 'DFZSaveAudio');
    assert.equal(JSON.parse(save.widgets_values[0]).id, job.id);
    assert.ok(graph.links.some(link => link[1] === save.id && link[3] === exported.id));
  }
});

test('intro taglines use six distinct configured stock voices and preserve exact dialogue', () => {
  const config = load('comfyui/config/game.json'), jobs = makeAudioJobs(config).filter(job => job.id.endsWith('_intro'));
  const templates = { music: load('comfyui/workflows/templates/cloud-music.json'), voice: load('comfyui/workflows/templates/cloud-voice.json'), sfx: load('comfyui/workflows/templates/cloud-sfx.json') };
  const graph = makeAudioGraph(jobs, config, templates);
  assert.equal(jobs.length, 6); assert.equal(new Set(jobs.map(job => job.voice)).size, 6);
  assert.equal(graph.nodes.filter(node => node.type === 'ElevenLabsVoiceSelector').length, 6);
  for (const fighter of config.fighters) {
    const job = jobs.find(item => item.fighter === fighter.id);
    assert.ok(job.prompt.endsWith(fighter.introTagline));
    assert.equal(job.voice, fighter.introVoice);
    const generator = graph.nodes.find(node => node.title === `${job.id} | cloud audio`);
    const link = graph.links.find(item => item[0] === generator.inputs.find(input => input.name === 'voice').link);
    const voice = graph.nodes.find(node => node.id === link[1]);
    assert.equal(voice.type, 'ElevenLabsVoiceSelector');
    assert.equal(voice.widgets_values_named.voice, fighter.introVoice);
    assert.deepEqual(voice.widgets_values, Object.values(voice.widgets_values_named));
  }
});

test('character special announcements follow configured special-move names', () => {
  const jobs = makeAudioJobs({ fighters: [{ id: 'test', description: 'Original fictional fighter.', specialMove: { name: 'Camera Flash', description: 'A bright energy projectile.' } }] });
  const special = jobs.find(job => job.id === 'fighter_test_special');
  assert.match(special.prompt, /Camera Flash!/);
  assert.equal(special.specialMove.description, 'A bright energy projectile.');
  assert.equal(special.fighter, 'test');
  assert.equal(special.model, 'ElevenLabsTextToSpeech');
});
