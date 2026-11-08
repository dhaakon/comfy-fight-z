'use strict';
// Living stage scenery: the reproducible ComfyUI workflow, the shared vocabulary, the builder's validation, the
// apply/sync tool and the renderer's effects.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { makeSceneryGraph, sceneryCounts, apiPrompt } = require('../../comfyui/tools/prepare-factory-workflows.cjs');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const schema = () => import(pathToFileURL(path.join(ROOT, 'build/public/builder/scenery-schema.mjs')).href);
const pack = () => import(pathToFileURL(path.join(ROOT, 'build/public/builder/pack.js')).href);
const config = read('comfyui/config/factory.json');

test('the stage-scenery workflow plans, paints, separates, extracts and exports one stage', () => {
  const graph = makeSceneryGraph(config), byType = type => graph.nodes.filter(node => node.type === type);
  const source = (node, name) => { const input = node.inputs.find(item => item.name === name); const link = graph.links.find(l => l[0] === input.link); return link && [link[1], link[2]]; };
  const [project] = byType('CFZProjectSettings'), [painting] = byType('LoadImage'), [director] = byType('CFZSceneDirector');
  const [painter] = byType('CFZStageScenery'), [isolate] = byType('CFZSceneIsolate'), [extract] = byType('CFZExtractScenery'), [exporter] = byType('CFZExportAssetPatch');
  assert.ok(project && painting && director && painter && isolate && extract && exporter);
  assert.deepEqual(source(director, 'stage'), [painting.id, 0]);
  assert.deepEqual(source(painter, 'stage_reference'), [painting.id, 0]); assert.deepEqual(source(painter, 'plan'), [director.id, 0]);
  assert.deepEqual(source(isolate, 'scene'), [painter.id, 1]); assert.deepEqual(source(isolate, 'plan'), [director.id, 0]);
  assert.deepEqual([source(extract, 'stage'), source(extract, 'scene'), source(extract, 'isolated'), source(extract, 'plan')], [[painting.id, 0], [painter.id, 1], [isolate.id, 1], [director.id, 0]]);
  assert.deepEqual(exporter.inputs.filter(i => i.type === 'CFZ_BUNDLE').map(i => source(exporter, i.name)), [[painter.id, 0], [isolate.id, 0], [extract.id, 0]]);
  assert.equal(byType('PreviewImage').length, 3); assert.equal(byType('PreviewAny').length, 1);
  assert.equal(director.widgets_values_named.element_count, 12); assert.equal(director.widgets_values_named.director_model, 'Gemini 3.8 Flash');
  for (const node of [director, painter, isolate, extract]) assert.equal(node.widgets_values_named.stage_id, config.stages[0].id);
  assert.ok(path.resolve(project.widgets_values_named.root_directory).startsWith(path.join(ROOT, 'output') + path.sep));
  // The shipped template is muted until the accepted painting is uploaded; the CLI runs the same graph unmuted.
  assert.ok(graph.nodes.filter(n => n.type !== 'MarkdownNote').every(n => n.mode === 2));
  assert.deepEqual(apiPrompt(graph), {}, 'a muted template queues nothing');
  const live = makeSceneryGraph(config, { muted: false, stageImage: 'cfz-scenery/stage.png', direction: 'pigeons', elementCount: 14 }), prompt = apiPrompt(live);
  assert.equal(Object.keys(prompt).length, 11);
  const director2 = Object.values(prompt).find(n => n.class_type === 'CFZSceneDirector');
  assert.equal(director2.inputs.direction, 'pigeons'); assert.equal(director2.inputs.element_count, 14);
  assert.equal(Object.values(prompt).find(n => n.class_type === 'LoadImage').inputs.image, 'cfz-scenery/stage.png');
  // Cost: two 2K edits plus a token-priced director bounded by its output cap.
  assert.deepEqual(sceneryCounts(1), { stages: 1, paidImages: 2, twoK: 2, directorCalls: 1, directorModel: 'Gemini 3.8 Flash', directorMaxUSD: 0.188588, estimatedUSD: 0.332732 });
  assert.equal(sceneryCounts(3).estimatedUSD, 0.998196);
  assert.deepEqual(read('comfyui/workflows/factory/catalog.json').scenery, sceneryCounts(1));
  assert.deepEqual(read('comfyui/workflows/factory/stage-scenery.json'), graph, 'run npm run workflows:factory after changing the generator');
});

test('the scenery vocabulary is the same in the node pack, the builder and the renderer', async () => {
  const { SCENERY_WEATHER, LAYER_MOTIONS, EFFECT_TYPES } = await schema(), python = fs.readFileSync(path.join(ROOT, 'comfyui/custom_nodes/comfy_fighter_assets/__init__.py'), 'utf8');
  const tuple = name => [...python.match(new RegExp(`${name} = \\(([^)]*)\\)`))[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]);
  const effects = Object.fromEntries([...python.match(/EFFECT_TYPES = \{([\s\S]*?)\n\}/)[1].matchAll(/"([a-z]+)": "([a-z]+)"/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(tuple('SCENERY_WEATHER'), SCENERY_WEATHER); assert.deepEqual(tuple('LAYER_MOTIONS'), LAYER_MOTIONS); assert.deepEqual(effects, EFFECT_TYPES);
  const renderer = require('../public/render/scenery.js');
  assert.deepEqual(renderer.WEATHER, SCENERY_WEATHER); assert.deepEqual(renderer.EFFECT_TYPES, Object.keys(EFFECT_TYPES).sort());
});

test('the builder validates stage scenery and placed layers', async () => {
  const { validateManifest } = await pack();
  const base = () => ({ schema: 'comfy-fighter-assets/v1', root: '.', game: { title: 'T', fighters: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    stages: [{ id: 'roof', name: 'Roof', scenery: { weather: 'rain', effects: [{ id: 'fx1', type: 'blink', points: [{ x: .5, y: .1 }], color: '#ff3344' }, { id: 'fx2', type: 'screen', box: { x: .1, y: .1, w: .2, h: .1 } }] } }] },
    assets: [{ id: 'roof', kind: 'stage', stage: 'roof', src: 'raw/roof.png' },
      { id: 'roof_el1', kind: 'layer', stage: 'roof', src: 'raw/roof_el1.png', place: { x: .7, y: .3, w: .05, h: .15 }, motion: 'cheer', order: 2, label: 'fan' }] });
  assert.equal(validateManifest(base()).game.stages[0].scenery.weather, 'rain');
  const broken = [m => { m.game.stages[0].scenery.weather = 'meteors'; }, m => { m.game.stages[0].scenery.effects[0].type = 'teleport'; },
    m => { m.game.stages[0].scenery.effects[1].box.w = 0; }, m => { m.game.stages[0].scenery.effects[0].color = 'red'; },
    m => { m.assets[1].motion = 'moonwalk'; }, m => { delete m.assets[1].place; }, m => { delete m.assets[1].stage; }];
  for (const change of broken) { const m = base(); change(m); assert.throws(() => validateManifest(m)); }
});

const png = (w, h, color) => { const c = createCanvas(w, h), g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('a scenery patch applies to an accepted bundle and a reviewed layout syncs back', async () => {
  const { apply, sync } = require('../tools/stage-scenery.cjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-scenery-apply-')), bundle = path.join(temp, 'bundle'), patch = path.join(temp, 'patch');
  for (const folder of [bundle, patch]) fs.mkdirSync(path.join(folder, 'raw'), { recursive: true });
  const file = (folder, name, bytes) => { fs.writeFileSync(path.join(folder, name), bytes); return { src: name, sha256: sha(bytes) }; };
  const plate = file(bundle, 'raw/roof.png', png(64, 36, '#203048'));
  const stale = file(bundle, 'raw/roof_el1-old.png', png(4, 4, '#000'));
  const accepted = { schema: 'comfy-fighter-assets/v1', root: '.', game: { title: 'T', fighters: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], stages: [{ id: 'roof', name: 'Roof' }],
    expectedAssets: ['roof', 'roof_el1'] },
    assets: [{ id: 'roof', kind: 'stage', stage: 'roof', key: false, ...plate, width: 64, height: 36 }, { id: 'roof_el1', kind: 'layer', stage: 'roof', key: false, ...stale, width: 4, height: 4, place: { x: 0, y: 0, w: .1, h: .1 }, motion: 'idle', order: 1 }] };
  fs.writeFileSync(path.join(bundle, 'assets.json'), JSON.stringify(accepted));
  const scene = file(patch, 'raw/roof_scene-1.png', png(64, 36, '#304058')), isolated = file(patch, 'raw/roof_isolated-1.png', png(64, 36, '#00ff00'));
  const el1 = file(patch, 'raw/roof_el1-1.png', png(6, 9, '#ff0000')), el2 = file(patch, 'raw/roof_el2-1.png', png(8, 2, '#ffffff'));
  const scenery = { weather: 'storm', effects: [{ id: 'fx1', type: 'lightning', box: { x: 0, y: 0, w: 1, h: .4 } }] };
  fs.writeFileSync(path.join(patch, 'assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', partial: true, game: { title: 'T', fighters: [], stages: [{ id: 'roof', name: 'Roof', scenery }] },
    assets: [{ id: 'roof_scene', kind: 'scene', stage: 'roof', key: false, ...scene, width: 64, height: 36 }, { id: 'roof_isolated', kind: 'scene', stage: 'roof', key: true, ...isolated, width: 64, height: 36 },
      { id: 'roof_el1', kind: 'layer', stage: 'roof', key: false, ...el1, width: 6, height: 9, place: { x: .6, y: .2, w: .1, h: .25 }, motion: 'hover', order: 1, label: 'drone' },
      { id: 'roof_el2', kind: 'layer', stage: 'roof', key: false, ...el2, width: 8, height: 2, place: { x: .2, y: .8, w: .12, h: .05 }, motion: 'still', order: 0 }] }));
  const layout = { schema: 'comfy-fighter-scenery/v1', stage: 'roof', weather: 'storm', effects: scenery.effects,
    elements: [{ id: 'roof_el1', src: el1.src, place: { x: .6, y: .2, w: .1, h: .25 }, motion: 'hover', order: 1, label: 'drone' }, { id: 'roof_el2', src: el2.src, place: { x: .2, y: .8, w: .12, h: .05 }, motion: 'still', order: 0 }] };
  fs.mkdirSync(path.join(patch, 'scenery')); fs.writeFileSync(path.join(patch, 'scenery/roof.json'), JSON.stringify(layout));
  await apply({ patch, bundle });
  let merged = JSON.parse(fs.readFileSync(path.join(bundle, 'assets.json'), 'utf8'));
  assert.deepEqual(merged.assets.filter(a => a.stage === 'roof').map(a => a.id).sort(), ['roof', 'roof_el1', 'roof_el2', 'roof_isolated', 'roof_scene']);
  assert.equal(merged.assets.find(a => a.id === 'roof_el1').src, el1.src, 'the old layer is replaced');
  assert.deepEqual(merged.game.stages[0].scenery, scenery);
  assert.deepEqual([...merged.game.expectedAssets].sort(), ['roof', 'roof_el1', 'roof_el2', 'roof_isolated', 'roof_scene']);
  assert.ok(fs.existsSync(path.join(bundle, el1.src)) && fs.existsSync(path.join(bundle, 'scenery/roof.json')));
  // A reviewer deletes the still element, sets the drone to drift and drops the storm to rain.
  const edited = { ...layout, weather: 'rain', elements: [{ ...layout.elements[0], motion: 'drift' }] };
  fs.writeFileSync(path.join(bundle, 'scenery/roof.json'), JSON.stringify(edited));
  await sync({ bundle, stage: 'roof' });
  merged = JSON.parse(fs.readFileSync(path.join(bundle, 'assets.json'), 'utf8'));
  assert.deepEqual(merged.assets.filter(a => a.kind === 'layer').map(a => [a.id, a.motion, a.width, a.height]), [['roof_el1', 'drift', 6, 9]]);
  assert.equal(merged.game.stages[0].scenery.weather, 'rain'); assert.ok(!merged.game.expectedAssets.includes('roof_el2'));
  assert.ok(fs.existsSync(path.join(bundle, 'scenery/roof-review.png')));
  fs.writeFileSync(path.join(bundle, 'scenery/roof.json'), JSON.stringify({ ...edited, elements: [{ ...edited.elements[0], motion: 'moonwalk' }] }));
  await assert.rejects(sync({ bundle, stage: 'roof' }), /unknown motion/);
  // A changed patch file is refused.
  fs.writeFileSync(path.join(patch, el2.src), png(8, 2, '#000000'));
  await assert.rejects(apply({ patch, bundle }), /changed since export/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('every effect, motion and weather draws in the painting space without errors', async () => {
  const { create, EFFECT_TYPES } = require('../public/render/scenery.js'), { EFFECT_TYPES: geometry, LAYER_MOTIONS, SCENERY_WEATHER } = await schema();
  const plate = await loadImage(png(1376, 768, '#30405a')), element = await loadImage(png(40, 90, '#e04030'));
  const images = new Map([['raw/plate.png', plate], ['raw/el.png', element]]), getImage = src => images.get(src);
  const shape = type => geometry[type] === 'box' ? { box: { x: .3, y: .2, w: .3, h: .3 } } : geometry[type] === 'point' ? { point: { x: .5, y: .5 } } : { points: [{ x: .4, y: .3 }, { x: .6, y: .35 }] };
  const differs = (a, b) => { for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return true; return false; };
  const frame = (stage, t, state = { effects: [] }) => {
    const canvas = createCanvas(960, 540), ctx = canvas.getContext('2d'); ctx.drawImage(plate, 0, 0, 960, 540);
    const scenery = create(); scenery.drawStage(ctx, { stage, getImage, state, time: t, view: { x: 0, zoom: 1 }, floor: 470 });
    return ctx.getImageData(0, 0, 960, 540).data;
  };
  const blank = frame({ id: 'none', src: 'raw/plate.png', scenery: { effects: [] } }, 1);
  for (const type of EFFECT_TYPES) {
    const stage = { id: `fx-${type}`, src: 'raw/plate.png', scenery: { weather: 'none', effects: [{ id: 'fx1', type, ...shape(type) }] } };
    // Some effects are intermittent (lightning, sparks, birds, flashes): one of these moments must show it.
    assert.ok([0.1, 0.5, 1.3, 2.7, 4.1, 7.9, 9.3, 12.2, 15.6, 21.4, 33.3].some(t => differs(frame(stage, t, { effects: [{ type: 'ko' }] }), blank)), `${type} draws nothing`);
  }
  for (const motion of LAYER_MOTIONS) {
    const stage = { id: `m-${motion}`, src: 'raw/plate.png', scenery: { layers: [{ id: 'el', src: 'raw/el.png', place: { x: .4, y: .3, w: .04, h: .15 }, motion, order: 1 }] } };
    assert.ok(differs(frame(stage, 1.7), blank), `${motion} element is not drawn`);
  }
  for (const kind of SCENERY_WEATHER) {
    const canvas = createCanvas(960, 540), ctx = canvas.getContext('2d'), drawn = create().drawFront(ctx, { stage: { id: 'w', scenery: { weather: kind } }, time: 3, view: {}, floor: 470 });
    assert.equal(drawn, kind !== 'none', `${kind} weather`);
  }
  assert.equal(require('../public/render/scenery.js').weather({ name: 'Rooftop', description: 'A rain-slick deck' }), 'rain', 'a stage without scenery still gets weather from its description');
});
