const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { prepare, apiPrompt } = require('../../comfyui/tools/prepare-arcade-expansion.cjs');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'comfyui/config/game.json'), 'utf8'));

test('arcade expansion prepares exact accepted-identity uploads and priced, unmuted API workflows without spending', async t => {
  const out = path.join(root, 'output/test-runs', `expansion-test-${randomUUID()}`);
  t.after(() => {
    if (path.dirname(out) !== path.join(root, 'output/test-runs') || !path.basename(out).startsWith('expansion-test-')) throw new Error('Unexpected cleanup path');
    fs.rmSync(out, { recursive: true, force: true });
  });
  const { directory, plan } = await prepare({ base: 'example/bundle', out });
  assert.equal(directory, out); assert.equal(plan.generationSubmitted, false); assert.equal(plan.requiresSpendingAuthorization, true);
  const heroes = config.fighters.filter(fighter => !fighter.boss);
  assert.deepEqual(plan.uploads.map(upload => upload.filename), heroes.map(fighter => `cfz-accepted-${fighter.id}-reference.png`));
  for (const upload of plan.uploads) {
    const bytes = fs.readFileSync(path.join(out, 'uploads', upload.filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), upload.sha256);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
  assert.equal(plan.images.paidImages, 33); assert.equal(plan.audio.clips, 99);
  const images = JSON.parse(fs.readFileSync(path.join(out, 'images.api.json'), 'utf8'));
  const types = Object.values(images).map(node => node.class_type);
  // Two in-between sheets per accepted fighter, plus the boss's five sheets as visible nodes (its factory's internal sheets are off).
  assert.equal(types.filter(type => type === 'CFZSpriteSheet').length, heroes.length * 2 + 5);
  const boss = Object.values(images).find(node => node.class_type === 'CFZCharacterFactory');
  assert.equal(boss.inputs.include_sprite_sheets, false); assert.equal(boss.inputs.include_arcade_art, true);
  assert.equal(types.filter(type => type === 'CFZCharacterArt').length, heroes.length);
  assert.equal(types.filter(type => type === 'CFZCharacterFactory').length, 1);
  assert.equal(types.filter(type => type === 'CFZEnvironmentFactory').length, config.stages.length - 1);
  assert.equal(types.filter(type => type === 'CFZExportAssetPatch').length, 1);
  const project = Object.values(images).find(node => node.class_type === 'CFZProjectSettings');
  assert.equal(project.inputs.root_directory, path.join(out, 'patch'));
  const audio = JSON.parse(fs.readFileSync(path.join(out, 'audio.api.json'), 'utf8'));
  const root_ = Object.values(audio).find(node => node.class_type === 'CFZAssetRoot');
  assert.equal(root_.inputs.root_directory, path.join(out, 'audio'));
  assert.equal(JSON.parse(root_.inputs.config_json).expectedAudio.length, 99);
  await assert.rejects(prepare({ base: 'example/bundle', out }), /new run directory/);
});

test('API conversion skips muted nodes and resolves links and positional widgets', () => {
  const workflow = { nodes: [
    { id: 1, type: 'LoadImage', mode: 0, widgets_values: ['upload.png', 'image'], inputs: [], outputs: [] },
    { id: 2, type: 'CFZSpriteSheet', mode: 0, widgets_values_named: { sheet: 'sheetD' }, inputs: [{ name: 'reference', link: 7 }], outputs: [] },
    { id: 3, type: 'CFZSpriteSheet', mode: 2, widgets_values_named: { sheet: 'sheetE' }, inputs: [], outputs: [] },
    { id: 4, type: 'MarkdownNote', mode: 0, widgets_values: ['notes'], inputs: [], outputs: [] }
  ], links: [[7, 1, 0, 2, 0, 'IMAGE']] };
  const prompt = apiPrompt(workflow);
  assert.deepEqual(Object.keys(prompt), ['1', '2']);
  assert.deepEqual(prompt[1].inputs, { image: 'upload.png' });
  assert.deepEqual(prompt[2].inputs, { sheet: 'sheetD', reference: ['1', 0] });
});
