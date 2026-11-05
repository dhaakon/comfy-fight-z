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
  const root = graph.nodes.find(node => node.type === 'CFZAssetRoot');
  const exported = graph.nodes.find(node => node.type === 'CFZExportAudioManifest');
  // Music: menu, select, one per stage, boss, victory, continue, game over, ending. Twenty announcer calls,
  // twenty effects, then six lines per fighter plus an intro tagline when configured.
  const stages = config.stages.filter(stage => stage.enabled !== false).length, bosses = config.fighters.filter(f => f.boss).length;
  assert.equal(jobs.filter(job => job.category === 'music').length, 2 + stages + bosses + 4);
  assert.equal(jobs.length, 2 + stages + bosses + 4 + 20 + 20 + config.fighters.length * 6 + config.fighters.filter(fighter => fighter.introTagline).length);
  assert.ok(jobs.length <= 100, 'The audio exporter accepts at most 100 clips');
  for (const stage of config.stages) assert.ok(jobs.some(job => job.id === `${stage.id}_music` && job.loop), `Stage music for ${stage.id}`);
  assert.deepEqual(JSON.parse(root.widgets_values[1]).expectedAudio, jobs.map(job => job.id));
  assert.equal(graph.nodes.filter(node => node.type === 'CFZSaveAudio').length, jobs.length);
  assert.equal(exported.inputs.filter(input => input.type === 'CFZ_AUDIO_ASSET').length, jobs.length);
  assert.equal(graph.nodes.some(node => /Clone|Checkpoint|Loader/.test(node.type)), false);
  for (const job of jobs) {
    const generator = graph.nodes.find(node => node.title === `${job.id} | cloud audio`);
    assert.equal(generator.type, job.model);
    assert.deepEqual(generator.widgets_values, Object.values(generator.widgets_values_named));
    const saveLink = graph.links.find(link => link[1] === generator.id && link[5] === 'AUDIO');
    const save = byId.get(saveLink[3]); assert.equal(save.type, 'CFZSaveAudio');
    assert.equal(JSON.parse(save.widgets_values[0]).id, job.id);
    assert.ok(graph.links.some(link => link[1] === save.id && link[3] === exported.id));
  }
});

test('intro taglines use distinct configured stock voices and preserve exact dialogue', () => {
  const config = load('comfyui/config/game.json'), jobs = makeAudioJobs(config).filter(job => job.id.endsWith('_intro'));
  const templates = { music: load('comfyui/workflows/templates/cloud-music.json'), voice: load('comfyui/workflows/templates/cloud-voice.json'), sfx: load('comfyui/workflows/templates/cloud-sfx.json') };
  const graph = makeAudioGraph(jobs, config, templates);
  assert.equal(jobs.length, config.fighters.length); assert.equal(new Set(jobs.map(job => job.voice)).size, config.fighters.length);
  assert.equal(graph.nodes.filter(node => node.type === 'ElevenLabsVoiceSelector').length, config.fighters.length);
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

test('every fighter line keeps one stock voice per fighter, and the announcer keeps one voice', () => {
  const config = load('comfyui/config/game.json'), jobs = makeAudioJobs(config);
  for (const fighter of config.fighters) {
    const lines = jobs.filter(job => job.fighter === fighter.id);
    assert.deepEqual(lines.map(job => job.id.split('_').pop()).sort(), ['attack', 'hurt', 'intro', 'ko', 'special', 'super', 'win']);
    assert.ok(lines.every(job => job.voice === fighter.introVoice && job.category === 'voice'));
    assert.ok(lines.find(job => job.id.endsWith('_win')).prompt.endsWith(fighter.winQuote));
    if (fighter.superMove) assert.match(lines.find(job => job.id.endsWith('_super')).prompt, new RegExp(fighter.superMove.name));
  }
  const announcer = jobs.filter(job => job.id.startsWith('ann_'));
  assert.equal(new Set(announcer.map(job => job.voice)).size, 1);
  for (const id of ['ann_round1', 'ann_final', 'ann_ready', 'ann_go', 'ann_ko', 'ann_perfect', 'ann_timeover', 'ann_continue', 'ann_gameover']) assert.ok(announcer.some(job => job.id === id), id);
  assert.ok(jobs.filter(job => job.category === 'sfx').every(job => job.duration >= 0.5 && job.duration <= 30));
});
