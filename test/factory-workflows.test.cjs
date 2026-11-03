const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { factoryCounts, makeFactoryGraph, makeCharacterTemplate, makeSheetTemplate, makeEnvironmentTemplate, builderMetadata } = require('../tools/prepare-factory-workflows.cjs');
const ROOT = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const config = read('config/factory.json');
const functional = graph => graph.nodes.filter(n => n.type !== 'MarkdownNote');

test('main factory has six character uploads, three environment uploads and one complete mapped export', () => {
  const graph = makeFactoryGraph(config);
  assert.equal(functional(graph).length, 12);
  const characters = graph.nodes.filter(n => n.type === 'CFZCharacterFactory');
  const environments = graph.nodes.filter(n => n.type === 'CFZEnvironmentFactory');
  assert.equal(characters.length, 6); assert.equal(environments.length, 3);
  characters.forEach((node, i) => {
    assert.equal(node.widgets_values_named.image, config.fighters[i].sourceInput);
    assert.equal(node.widgets_values_named.source_mode,'Invent fictional reference');
    assert.equal(node.widgets_values_named.description, config.fighters[i].description);
    assert.equal(node.widgets_values_named.special_description, config.fighters[i].specialMove.description);
    assert.equal(node.widgets_values_named.intro_tagline, config.fighters[i].introTagline);
    assert.equal(node.widgets_values_named.include_sprite_sheets, true);
  });
  assert.equal(environments[0].widgets_values_named.image, config.stages[0].sourceInput);
  for (const node of environments.slice(1)) {
    assert.equal(node.widgets_values_named.enabled, false);
    assert.equal(node.widgets_values_named.image, '');
    assert.equal(node.widgets_values_named.source_mode,'Invent fictional reference');
  }
  const exporter = graph.nodes.find(n => n.type === 'CFZExportGameAssets');
  assert.equal(exporter.inputs.filter(i => i.type === 'CFZ_BUNDLE').length, 10);
  const shared = graph.nodes.find(n => n.type === 'CFZSharedArtFactory');
  const stageLink = graph.links.find(l => l[0] === shared.inputs.find(i => i.name === 'stage_reference').link);
  assert.equal(stageLink[1], environments[0].id); assert.equal(stageLink[2], 1);
});

test('default and full factory counts are transparent without changing released one-stage configuration', () => {
  assert.deepEqual(factoryCounts(config), {paidImages:56,sourceSaves:7,mappedAssets:56,oneK:35,twoK:21,estimatedUSD:3.195192});
  assert.deepEqual(factoryCounts(config, true), {paidImages:60,sourceSaves:9,mappedAssets:60,oneK:35,twoK:25,estimatedUSD:3.48348});
  assert.equal(read('config/game.json').stages.length, 1);
  assert.notEqual(config.assetRoot, read('config/game.json').assetRoot);
  assert.deepEqual(builderMetadata(config).environments.slice(1).map(e => [e.enabled,e.reference,e.sourceInput]), [[false,'',''],[false,'','']]);
});

test('focused character template reuses one identity across exactly three explicit sheet nodes', () => {
  const graph = makeCharacterTemplate(config), character = graph.nodes.find(n => n.type === 'CFZCharacterFactory');
  assert.equal(functional(graph).length, 6);
  assert.equal(character.widgets_values_named.include_sprite_sheets, false);
  const sheets = graph.nodes.filter(n => n.type === 'CFZSpriteSheet');
  assert.deepEqual(sheets.map(n => n.widgets_values_named.sheet), ['sheet','sheetB','sheetC']);
  for (const node of sheets) {
    for (const [name, slot] of [['reference',1], ['character',2]]) {
      const link = graph.links.find(l => l[0] === node.inputs.find(i => i.name === name).link);
      assert.equal(link[1], character.id); assert.equal(link[2], slot);
    }
  }
  assert.equal(graph.nodes.filter(n => n.type === 'CFZExportAssetPatch').length, 1);
});

test('focused sheet invents a reference without any stale file and environment defaults to text', () => {
  const sheet = makeSheetTemplate(config), environment = makeEnvironmentTemplate(config);
  assert.equal(functional(sheet).length, 5); assert.equal(functional(environment).length, 3);
  assert.equal(sheet.nodes.filter(n => n.type === 'CFZCharacterFactory').length, 0);
  assert.equal(sheet.nodes.filter(n=>n.type==='LoadImage').length,0);
  assert.equal(sheet.nodes.filter(n=>n.type==='CFZFictionalReference').length,1);
  assert.equal(environment.nodes.find(n => n.type === 'CFZEnvironmentFactory').widgets_values_named.enabled, true);
  for (const graph of [sheet,environment]) assert.ok(graph.nodes.some(n => n.type === 'CFZExportAssetPatch'));
});

test('all generated sockets link consistently and named widgets match positional values', () => {
  for (const make of [makeFactoryGraph,makeCharacterTemplate,makeSheetTemplate,makeEnvironmentTemplate]) {
    const graph = make(config);
    assert.deepEqual(graph, make(config));
    for (const node of functional(graph)) {
      if (node.type !== 'LoadImage') assert.deepEqual(node.widgets_values, Object.values(node.widgets_values_named));
      for (const input of node.inputs) assert.ok(Number.isInteger(input.link), `${node.title}: missing ${input.name}`);
    }
    for (const [id,fromID,fromSlot,toID,toSlot,type] of graph.links) {
      const from = graph.nodes.find(n => n.id === fromID), to = graph.nodes.find(n => n.id === toID);
      assert.ok(from.outputs[fromSlot].links.includes(id)); assert.equal(to.inputs[toSlot].link,id);
      assert.equal(from.outputs[fromSlot].type,type); assert.equal(to.inputs[toSlot].type,type);
    }
  }
});

test('browser downloads match canonical workflows exactly and advanced native graph remains available', () => {
  for (const [canonical,download] of [['comfy-hackathon.json','comfy-hackathon.json'],
    ...['character-factory','sprite-sheet','environment-factory'].map(name=>[`workflows/factory/${name}.json`,`${name}.json`])]) {
    assert.equal(fs.readFileSync(path.join(ROOT,canonical),'utf8'), fs.readFileSync(path.join(ROOT,'public/builder/templates',download),'utf8'));
  }
  assert.deepEqual(read('comfy-hackathon.json'),makeFactoryGraph(config));
  assert.deepEqual(read('public/builder/factory-template.json'),builderMetadata(config));
  const advanced = read('workflows/advanced/full-image-graph.json');
  assert.equal(functional(advanced).length, 114);
  assert.equal(advanced.nodes.filter(n=>n.type==='GeminiNanoBanana2V2').length,56);
  assert.equal(advanced.nodes.filter(n=>n.type==='LoadImage').length,0);
  assert.equal(advanced.nodes.filter(n=>n.type==='DFZSaveAsset').length,56);
});

test('every shipped demo workflow starts without external image files', () => {
  const files = directory => fs.readdirSync(path.join(ROOT,directory),{withFileTypes:true}).flatMap(entry =>
    entry.isDirectory() ? files(path.join(directory,entry.name)) : [path.join(directory,entry.name)]);
  const recipes = [...files('workflows'),...files('public/builder/templates'),
    'comfy-hackathon.json','comfy-audio.json','comfy-opening.json','simple-image-generation.json'];
  for (const file of recipes.filter(file=>file.endsWith('.json'))) {
    for (const node of read(file).nodes || []) {
      assert.notEqual(node.type,'LoadImage',`${file} must not load a previous session image`);
      assert.ok(!node.widgets_values_named?.image,`${file} must not preselect an external image`);
    }
  }
});
