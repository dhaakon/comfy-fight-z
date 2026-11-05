const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildDuo } = require('../../comfyui/tools/prepare-duo-run.cjs');
const config = require('../../comfyui/config/factory.json');
const root = path.resolve('portable-duo/bundle');

test('two-fighter run builds every image, the startup media and full audio in one priced workflow', () => {
  const { workflow, prompt, plan } = buildDuo(config, ['griddle', 'rivet'], root, { seed: 7 });
  const count = type => Object.values(prompt).filter(node => node.class_type === type).length;
  assert.deepEqual([count('CFZCharacterFactory'), count('CFZSpriteSheet'), count('CFZEnvironmentFactory'), count('CFZSharedArtFactory')], [2, 14, 1, 1]);
  assert.deepEqual([count('CFZTitleArt'), count('CFZTitleVideo'), count('CFZIntroVideo'), count('CFZExportVideos'), count('CFZExportGameAssets')], [1, 1, 2, 1, 1]);
  assert.equal(count('CFZSaveAudio'), 61); assert.equal(count('CFZExportAudioManifest'), 1);
  // Visible sheets: each factory's internal sheets are off, so no factory step runs more than four art calls.
  for (const node of Object.values(prompt).filter(node => node.class_type === 'CFZCharacterFactory')) {
    assert.equal(node.inputs.include_sprite_sheets, false); assert.equal(node.inputs.include_arcade_art, true);
  }
  const project = Object.entries(prompt).find(([, node]) => node.class_type === 'CFZProjectSettings');
  assert.equal(project[1].inputs.root_directory, root); assert.equal(project[1].inputs.seed, 7);
  const bridge = Object.values(prompt).find(node => node.class_type === 'CFZProjectAudioRoot');
  assert.deepEqual(bridge.inputs.project, [project[0], 0], 'Audio writes into the same bundle folder');
  for (const node of Object.values(prompt)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(prompt[value[0]], 'Every link resolves');
  const exporter = Object.values(prompt).find(node => node.class_type === 'CFZExportGameAssets');
  assert.equal(Object.keys(exporter.inputs).filter(name => name.startsWith('bundles.')).length, 2 + 14 + 1 + 1 + 1);
  assert.deepEqual(plan.images, { paidImages: 40, oneK: 22, twoK: 18, mappedAssets: 36, estimatedUSD: 2.354352 });
  assert.equal(plan.videos.clips, 6); assert.equal(plan.videos.seconds, 36); assert.equal(plan.audio.clips, 61);
  assert.equal(plan.total.estimatedUSD, 7.965955); assert.equal(plan.generationSubmitted, false);
  assert.equal(workflow.nodes.filter(node => node.type !== 'MarkdownNote').length, Object.keys(prompt).length);
  assert.throws(() => buildDuo(config, ['griddle', 'griddle'], root), /two different fighters/);
  assert.throws(() => buildDuo(config, ['griddle', 'nobody'], root), /two different fighters/);
});
