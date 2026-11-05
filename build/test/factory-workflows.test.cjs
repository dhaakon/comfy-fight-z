const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { factoryCounts, expansionCounts, makeFactoryGraph, makeCharacterTemplate, makeSheetTemplate, makeEnvironmentTemplate, makeExpansionGraph, builderMetadata } = require('../../comfyui/tools/prepare-factory-workflows.cjs');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const config = read('comfyui/config/factory.json');
const functional = graph => graph.nodes.filter(n => n.type !== 'MarkdownNote');
const SCHEMAS = read('comfyui/workflows/templates/compact-factory-schema.json');

test('main factory has six fighters, a final boss, three environments and one complete mapped export', () => {
  const graph = makeFactoryGraph(config);
  // 13 game-art nodes plus the startup ensemble, menu video, seven fight introductions and video.json.
  assert.equal(functional(graph).length, 31);
  assert.equal(functional(makeFactoryGraph(config, { media: false })).length, 13);
  const characters = graph.nodes.filter(n => n.type === 'CFZCharacterFactory');
  const environments = graph.nodes.filter(n => n.type === 'CFZEnvironmentFactory');
  assert.equal(characters.length, 7); assert.equal(environments.length, 3);
  assert.deepEqual(characters.map(n => n.widgets_values_named.role), [...Array(6).fill('Fighter'), 'Final boss']);
  characters.forEach((node, i) => {
    assert.equal(node.widgets_values_named.image, config.fighters[i].sourceInput);
    assert.equal(node.widgets_values_named.source_mode,'Invent fictional reference');
    assert.equal(node.widgets_values_named.description, config.fighters[i].description);
    assert.equal(node.widgets_values_named.special_description, config.fighters[i].specialMove.description);
    assert.equal(node.widgets_values_named.intro_tagline, config.fighters[i].introTagline);
    assert.equal(node.widgets_values_named.include_sprite_sheets, true);
    assert.equal(node.widgets_values_named.include_arcade_art, true);
    assert.equal(node.widgets_values_named.fighting_style, config.fighters[i].style);
    assert.equal(node.widgets_values_named.super_name, config.fighters[i].superMove.name);
    assert.equal(node.widgets_values_named.win_quote, config.fighters[i].winQuote);
    assert.equal(node.widgets_values_named.ending, config.fighters[i].ending);
  });
  for (const [i, node] of environments.entries()) {
    assert.equal(node.widgets_values_named.enabled, true);
    assert.equal(node.widgets_values_named.image, '');
    assert.equal(node.widgets_values_named.source_mode,'Invent fictional reference');
    assert.equal(node.widgets_values_named.stage_id, config.stages[i].id);
  }
  const exporter = graph.nodes.find(n => n.type === 'CFZExportGameAssets');
  assert.equal(exporter.inputs.filter(i => i.type === 'CFZ_BUNDLE').length, 12, 'Eleven art bundles plus the startup ensemble');
  const source = (node, name) => { const link = graph.links.find(l => l[0] === node.inputs.find(i => i.name === name).link); return link && [link[1], link[2]]; };
  const ensemble = graph.nodes.find(n => n.type === 'CFZTitleArt'), menu = graph.nodes.find(n => n.type === 'CFZTitleVideo');
  assert.deepEqual(source(ensemble, 'stage_reference'), [environments[0].id, 1]);
  characters.forEach((character, i) => assert.deepEqual(source(ensemble, `fighter_${i + 1}`), [character.id, 1]));
  assert.deepEqual(source(menu, 'title_image'), [ensemble.id, 1]); assert.equal(menu.widgets_values_named.duration, '8');
  const intros = graph.nodes.filter(n => n.type === 'CFZIntroVideo');
  assert.equal(intros.length, 7);
  intros.forEach((intro, i) => { assert.deepEqual(source(intro, 'character'), [characters[i].id, 2]); assert.deepEqual(source(intro, 'reference'), [characters[i].id, 1]); assert.equal(intro.widgets_values_named.duration, '4'); });
  const videos = graph.nodes.find(n => n.type === 'CFZExportVideos');
  const select = graph.nodes.find(n => n.type === 'CFZSelectVideo'), sharedArt = graph.nodes.find(n => n.type === 'CFZSharedArtFactory');
  assert.deepEqual(source(select, 'select_image'), [sharedArt.id, 1]); assert.equal(select.widgets_values_named.duration, '8');
  const idles = graph.nodes.filter(n => n.type === 'CFZSelectIdleVideo');
  assert.equal(idles.length, characters.length);
  idles.forEach((idle, i) => { assert.deepEqual(source(idle, 'character'), [characters[i].id, 2]); assert.deepEqual(source(idle, 'reference'), [characters[i].id, 1]); assert.equal(idle.widgets_values_named.duration, '6'); });
  assert.deepEqual(videos.inputs.filter(i => i.type === 'CFZ_VIDEO').map(i => source(videos, i.name)[0]), [menu.id, select.id, ...intros.map(n => n.id), ...idles.map(n => n.id)]);
  const shared = graph.nodes.find(n => n.type === 'CFZSharedArtFactory');
  const stageLink = graph.links.find(l => l[0] === shared.inputs.find(i => i.name === 'stage_reference').link);
  assert.equal(stageLink[1], environments[0].id); assert.equal(stageLink[2], 1);
});

test('factory and expansion counts are transparent for the arcade roster', () => {
  const full = {paidImages:89,sourceSaves:10,mappedAssets:89,oneK:47,twoK:42,estimatedUSD:5.28528};
  assert.deepEqual(factoryCounts(config), full);
  assert.deepEqual(factoryCounts(config, true), full);
  // Without the optional arcade art the original per-fighter pack remains eight images.
  const classic = { ...config, extraSheets: undefined, fighters: config.fighters.slice(0, 6), stages: config.stages.map((s, i) => ({ ...s, enabled: i === 0 })) };
  assert.deepEqual(factoryCounts(classic), {paidImages:56,sourceSaves:7,mappedAssets:56,oneK:35,twoK:21,estimatedUSD:3.195192});
  assert.deepEqual(expansionCounts(config), {paidImages:33,oneK:12,twoK:21,mappedAssets:33,estimatedUSD:2.090088});
  assert.equal(read('comfyui/config/game.json').stages.length, 3);
  assert.equal(config.assetRoot, read('comfyui/config/game.json').assetRoot, 'Default image and audio bundles share their output root');
  assert.deepEqual(builderMetadata(config).environments.map(e => [e.enabled,e.reference,e.sourceInput]), [[true,'',''],[true,'',''],[true,'','']]);
});

test('arcade expansion adds in-betweens and endings from muted accepted identities plus the boss and new stages', () => {
  const graph = makeExpansionGraph(config);
  assert.equal(graph.extra.cfzArcadeExpansion.mutedByDefault, true);
  assert.ok(functional(graph).every(node => node.mode === 2));
  const uploads = graph.nodes.filter(n => n.type === 'LoadImage');
  assert.deepEqual(uploads.map(n => n.widgets_values[0]), config.fighters.filter(f => !f.boss).map(f => `cfz-accepted-${f.id}-reference.png`));
  const sheets = graph.nodes.filter(n => n.type === 'CFZSpriteSheet'), boss = graph.nodes.filter(n => n.type === 'CFZCharacterFactory');
  const bossSheets = sheets.filter(sheet => graph.links.some(link => link[1] === boss[0].id && link[3] === sheet.id));
  assert.equal(sheets.length, 12 + 5);
  assert.deepEqual([...new Set(sheets.filter(n => !bossSheets.includes(n)).map(n => n.widgets_values_named.sheet))], ['sheetD', 'sheetE']);
  // The boss's five sheets are visible nodes fed by its identity, so its factory runs at most four art calls at once.
  assert.deepEqual(bossSheets.map(n => n.widgets_values_named.sheet), ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE']);
  assert.equal(graph.nodes.filter(n => n.type === 'CFZCharacterArt' && n.widgets_values_named.kind === 'ending').length, 6);
  assert.equal(boss.length, 1); assert.equal(boss[0].widgets_values_named.role, 'Final boss'); assert.equal(boss[0].widgets_values_named.source_mode, 'Invent fictional reference');
  assert.equal(boss[0].widgets_values_named.include_sprite_sheets, false); assert.equal(boss[0].widgets_values_named.include_arcade_art, true);
  assert.deepEqual(graph.nodes.filter(n => n.type === 'CFZEnvironmentFactory').map(n => n.widgets_values_named.stage_id), ['rooftop', 'arcade']);
  const exporter = graph.nodes.find(n => n.type === 'CFZExportAssetPatch');
  assert.equal(exporter.inputs.filter(i => i.type === 'CFZ_BUNDLE').length, 6 * 3 + 1 + 5 + 2);
  assert.equal(graph.nodes.filter(n => n.type === 'CFZExportGameAssets').length, 0, 'An expansion writes only a partial patch');
});

test('focused character template reuses one identity across five explicit sheet nodes', () => {
  const graph = makeCharacterTemplate(config), character = graph.nodes.find(n => n.type === 'CFZCharacterFactory');
  assert.equal(functional(graph).length, 8);
  assert.equal(character.widgets_values_named.include_sprite_sheets, false);
  assert.equal(character.widgets_values_named.include_arcade_art, true);
  const sheets = graph.nodes.filter(n => n.type === 'CFZSpriteSheet');
  assert.deepEqual(sheets.map(n => n.widgets_values_named.sheet), ['sheet','sheetB','sheetC','sheetD','sheetE']);
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
  for (const make of [makeFactoryGraph,makeCharacterTemplate,makeSheetTemplate,makeEnvironmentTemplate,makeExpansionGraph]) {
    const graph = make(config);
    assert.deepEqual(graph, make(config));
    for (const node of functional(graph)) {
      if (node.type !== 'LoadImage') assert.deepEqual(node.widgets_values, Object.values(node.widgets_values_named));
      // Optional sockets (the ensemble's unused eighth fighter slot) may stay empty.
      for (const input of node.inputs) if (!SCHEMAS[node.type]?.input.optional?.[input.name]) assert.ok(Number.isInteger(input.link), `${node.title}: missing ${input.name}`);
    }
    for (const [id,fromID,fromSlot,toID,toSlot,type] of graph.links) {
      const from = graph.nodes.find(n => n.id === fromID), to = graph.nodes.find(n => n.id === toID);
      assert.ok(from.outputs[fromSlot].links.includes(id)); assert.equal(to.inputs[toSlot].link,id);
      assert.equal(from.outputs[fromSlot].type,type); assert.equal(to.inputs[toSlot].type,type);
    }
  }
});

test('browser downloads match canonical workflows exactly and advanced native graph remains available', () => {
  for (const [canonical,download] of [['comfyui/workflows/comfy-hackathon.json','comfy-hackathon.json'],
    ...['character-factory','sprite-sheet','environment-factory','arcade-expansion'].map(name=>[`comfyui/workflows/factory/${name}.json`,`${name}.json`])]) {
    assert.equal(fs.readFileSync(path.join(ROOT,canonical),'utf8'), fs.readFileSync(path.join(ROOT,'build/public/builder/templates',download),'utf8'));
  }
  assert.deepEqual(read('comfyui/workflows/comfy-hackathon.json'),makeFactoryGraph(config));
  assert.deepEqual(read('build/public/builder/factory-template.json'),builderMetadata(config));
  const advanced = read('comfyui/workflows/advanced/full-image-graph.json');
  assert.equal(functional(advanced).length, 180);
  assert.equal(advanced.nodes.filter(n=>n.type==='GeminiNanoBanana2V2').length,89);
  assert.equal(advanced.nodes.filter(n=>n.type==='LoadImage').length,0);
  assert.equal(advanced.nodes.filter(n=>n.type==='CFZSaveAsset').length,89);
});

test('shipped recipes use text-only fictional art or explicitly muted upload templates', () => {
  const files = directory => fs.readdirSync(path.join(ROOT,directory),{withFileTypes:true}).flatMap(entry =>
    entry.isDirectory() ? files(path.join(directory,entry.name)) : [path.join(directory,entry.name)]);
  const recipes = [...files('comfyui/workflows'),...files('build/public/builder/templates'),
    'comfyui/workflows/comfy-hackathon.json','comfyui/workflows/comfy-audio.json','comfyui/workflows/comfy-opening.json','comfyui/workflows/simple-image-generation.json'];
  for (const file of recipes.filter(file=>file.endsWith('.json'))) {
    const workflow=read(file);
    const phoneUpload=file.replaceAll('\\','/')==='comfyui/workflows/phone-photo-demo/02-photos-to-game.json';
    const ensembleUpload=file.replaceAll('\\','/')==='comfyui/workflows/ensemble-title.json';
    const ltxSingle=file.replaceAll('\\','/')==='comfyui/workflows/ltx-intro-single.json';
    const ltxBatch=file.replaceAll('\\','/')==='comfyui/workflows/ltx-intro-six-fighters.json';
    const ltxTitle=file.replaceAll('\\','/')==='comfyui/workflows/ltx-title-animation.json';
    const ltxOpening=file.replaceAll('\\','/')==='comfyui/workflows/ltx-opening-animation.json';
    const expansion=/(^|\/)arcade-expansion\.json$/.test(file.replaceAll('\\','/'));
    if(expansion) {
      assert.equal(workflow.extra.cfzArcadeExpansion.mutedByDefault,true);
      assert.ok(functional(workflow).every(node=>node.mode===2),`${file} must stay muted until accepted identities are uploaded`);
      for(const node of workflow.nodes.filter(node=>node.type==='LoadImage')) assert.match(node.widgets_values[0],/^cfz-accepted-[a-z0-9-]+-reference\.png$/);
    }
    if(phoneUpload) {
      assert.equal(workflow.extra.cfzPhonePhotoDemo.phase,2);
      assert.ok(functional(workflow).every(node=>node.mode===2),`${file} upload template must remain muted`);
    }
    if(ensembleUpload) {
      assert.equal(workflow.extra.cfzEnsembleTitle.defaultMuted,true);
      assert.ok(functional(workflow).every(node=>node.mode===2),`${file} must remain muted until references are chosen`);
      const uploads=workflow.nodes.filter(node=>node.type==='LoadImage');
      assert.equal(uploads.length,6);
      uploads.forEach((node,index)=>assert.equal(node.widgets_values[0],`cfz-title-upload-${index+1}.png`));
    }
    if(ltxSingle || ltxBatch) {
      assert.equal(workflow.extra.cfzLtxIntros.mutedByDefault,true);
      assert.ok(functional(workflow).every(node=>node.mode===2),`${file} must stay muted until fresh references are selected`);
      const ids=ltxSingle?['griddle']:['griddle','rivet','tempo','nimbus','switchback','brick'];
      const uploads=workflow.nodes.filter(node=>node.type==='LoadImage');
      const models=workflow.nodes.filter(node=>node.type==='LtxApi25ImageToVideo');
      assert.equal(uploads.length,ids.length); assert.equal(models.length,ids.length);
      uploads.forEach((node,index)=>assert.equal(node.widgets_values[0],`cfz-ltx-new-frame-${ids[index]}.png`));
      models.forEach(node=>{
        const w=node.widgets_values_named;
        assert.equal(w.model,'LTX-2.5 (Fast)'); assert.equal(w['model.duration'],'8');
        assert.equal(w['model.resolution'],'1280x720'); assert.equal(w['model.fps'],'24'); assert.equal(w['model.generate_audio'],false);
      });
    }
    if(ltxTitle || ltxOpening) {
      const kind=ltxTitle?'title':'opening';
      assert.equal(workflow.extra.cfzLtxTitleOpening.mutedByDefault,true);
      assert.equal(workflow.extra.cfzLtxTitleOpening.kind,kind);
      assert.ok(functional(workflow).every(node=>node.mode===2),`${file} must stay muted until a new fictional reference is selected`);
      const uploads=workflow.nodes.filter(node=>node.type==='LoadImage');
      const models=workflow.nodes.filter(node=>node.type==='LtxApi25ImageToVideo');
      assert.equal(uploads.length,1); assert.equal(models.length,1);
      assert.equal(uploads[0].widgets_values[0],`cfz-ltx-new-${kind}-reference.png`);
      const w=models[0].widgets_values_named;
      assert.equal(w.model,'LTX-2.5 (Fast)'); assert.equal(w['model.duration'],'8');
      assert.equal(w['model.resolution'],'1280x720'); assert.equal(w['model.fps'],'24'); assert.equal(w['model.generate_audio'],false);
      const lastFrame=models[0].inputs.find(input=>input.name==='last_frame');
      assert.equal(lastFrame.link !== null,ltxTitle,`${file} title loop uses the same start/end frame`);
    }
    for (const node of workflow.nodes || []) {
      if(!ensembleUpload && !ltxSingle && !ltxBatch && !ltxTitle && !ltxOpening && !expansion) assert.notEqual(node.type,'LoadImage',`${file} must not load a previous session image`);
      if(phoneUpload && node.widgets_values_named?.image) {
        assert.ok(['CFZCharacterFactory','CFZEnvironmentFactory'].includes(node.type));
        assert.equal(node.widgets_values_named.source_mode,'Upload reference');
        assert.match(node.widgets_values_named.image,/^cfz-phone-NEW_RUN-(griddle|rivet|tempo|nimbus|switchback|brick|yard)\.png$/);
      } else if(!(expansion && node.type==='LoadImage')) assert.ok(!node.widgets_values_named?.image,`${file} must not preselect an external image`);
      if (['CFZProjectSettings','CFZAssetRoot'].includes(node.type)) {
        const outputRoot=node.widgets_values_named?.root_directory || node.widgets_values[0];
        if(phoneUpload) assert.equal(outputRoot,'__PHONE_PHOTO_DEMO_BUNDLE_ROOT__');
        else assert.ok(path.resolve(outputRoot).startsWith(path.join(ROOT,'output')+path.sep),`${file} must write generated assets under output/`);
      }
    }
  }
});
