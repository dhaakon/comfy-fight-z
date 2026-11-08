#!/usr/bin/env node
// Living stage scenery in an accepted bundle. The ComfyUI workflow (comfyui/workflows/factory/stage-scenery.json, or
// `new-game.cjs add-scenery`) writes a scenery PATCH folder: a partial assets.json with the stage's populated scene,
// isolated layer and placed `layer` cut-outs, the stage's weather and effects, and scenery/<stage>.json.
//
//   node build/tools/stage-scenery.cjs apply --patch <patch folder> --bundle <accepted bundle> [--stage <id>]
//       fold the patch into the bundle: copy and verify its files, replace the stage's scenery records and set
//       game.stages[].scenery (the previous layout is kept as scenery/<stage>.previous.json)
//   node build/tools/stage-scenery.cjs sync --bundle <accepted bundle> --stage <id>
//       after a reviewer edits scenery/<stage>.json (an element's motion, order or label; deleting an element;
//       the weather or effects), map it back into assets.json and redraw scenery/<stage>-review.png
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { safePath, isInside } = require('./lib/runtime-validation.cjs');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const schema = () => import('../public/builder/scenery-schema.mjs');
function inside(root, src) {
  safePath(src);
  const file = path.resolve(root, src);
  if (!isInside(root, file)) throw new Error(`Path leaves its folder: ${src}`);
  return file;
}
function manifest(folder, { partial }) {
  const file = path.join(folder, 'assets.json');
  if (!fs.existsSync(file)) throw new Error(`No assets.json in ${folder}.`);
  const value = read(file);
  if (value.schema !== 'comfy-fighter-assets/v1' || value.root !== '.' || !Array.isArray(value.assets) || !value.game) throw new Error(`Not a Comfy Fighter Z asset map: ${file}`);
  if (partial !== undefined && !!value.partial !== partial) throw new Error(partial ? `${file} is a complete bundle, not a scenery patch.` : `${file} is a patch; apply it to a complete accepted bundle.`);
  return value;
}
const sceneryRecord = (record, stage) => ['scene', 'layer'].includes(record.kind) && record.stage === stage;

async function apply({ patch, bundle, stage: only }) {
  if (!patch || !bundle) throw new Error('Usage: stage-scenery.cjs apply --patch <patch folder> --bundle <accepted bundle> [--stage <id>]');
  patch = fs.realpathSync(patch); bundle = fs.realpathSync(bundle);
  const { validateScenery, validateLayer } = await schema();
  const source = manifest(patch, { partial: true }), target = manifest(bundle, { partial: false });
  const stages = source.game.stages.filter(stage => stage.scenery && (!only || stage.id === only));
  if (!stages.length) throw new Error(only ? `The patch has no scenery for ${only}.` : 'The patch has no stage scenery.');
  const summary = [];
  for (const stage of stages) {
    const accepted = target.game.stages.find(item => item.id === stage.id);
    if (!accepted) throw new Error(`The bundle has no stage ${stage.id}.`);
    const records = source.assets.filter(record => sceneryRecord(record, stage.id));
    if (!records.some(record => record.kind === 'layer')) throw new Error(`The patch has no placed layers for ${stage.id}.`);
    const clash = target.assets.find(record => !sceneryRecord(record, stage.id) && records.some(item => item.id.toLowerCase() === record.id.toLowerCase()));
    if (clash) throw new Error(`Patch record ${clash.id} would replace a non-scenery asset.`);
    for (const record of records) {
      if (record.kind === 'layer') validateLayer(record);
      const input = inside(patch, record.src), data = fs.readFileSync(input);
      if (sha(data) !== record.sha256) throw new Error(`Patch file changed since export: ${record.src}`);
      const output = inside(bundle, record.src);
      if (fs.existsSync(output) && sha(fs.readFileSync(output)) !== record.sha256) throw new Error(`A different file already sits at ${record.src} in the bundle.`);
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(input, output);
    }
    const replaced = new Set(target.assets.filter(record => sceneryRecord(record, stage.id)).map(record => record.id));
    target.assets = [...target.assets.filter(record => !sceneryRecord(record, stage.id)), ...records.map(({ _root, ...record }) => record)];
    accepted.scenery = validateScenery(stage.scenery, stage.id);
    if (Array.isArray(target.game.expectedAssets)) target.game.expectedAssets = [...target.game.expectedAssets.filter(id => !replaced.has(id)), ...records.map(record => record.id)];
    // The placement file and review sheet travel with the stage; a previous reviewed layout is kept beside it.
    for (const name of [`scenery/${stage.id}.json`, `scenery/${stage.id}-review.png`]) {
      const input = path.join(patch, name), output = path.join(bundle, name);
      if (!fs.existsSync(input)) continue;
      if (name.endsWith('.json') && fs.existsSync(output)) fs.copyFileSync(output, path.join(bundle, `scenery/${stage.id}.previous.json`));
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(input, output);
    }
    summary.push(`${stage.id}: ${records.filter(r => r.kind === 'layer').length} placed layer(s), ${accepted.scenery.effects.length} effect(s), weather ${accepted.scenery.weather}`);
  }
  write(path.join(bundle, 'assets.json'), target);
  console.log(`Applied living scenery into ${bundle}:\n  ${summary.join('\n  ')}`);
}

async function sync({ bundle, stage: id }) {
  if (!bundle || !id) throw new Error('Usage: stage-scenery.cjs sync --bundle <accepted bundle> --stage <id>');
  bundle = fs.realpathSync(bundle);
  const { validateScenery, validateLayer } = await schema();
  const target = manifest(bundle, { partial: false }), stage = target.game.stages.find(item => item.id === id);
  if (!stage) throw new Error(`The bundle has no stage ${id}.`);
  const layoutFile = path.join(bundle, 'scenery', `${id}.json`);
  if (!fs.existsSync(layoutFile)) throw new Error(`No scenery/${id}.json in the bundle; apply a scenery patch first.`);
  const layout = read(layoutFile);
  if (layout.schema !== 'comfy-fighter-scenery/v1' || layout.stage !== id || !Array.isArray(layout.elements)) throw new Error(`scenery/${id}.json is not a placement file for ${id}.`);
  const { loadImage } = require('@napi-rs/canvas'), ids = new Set(), layers = [];
  for (const element of layout.elements) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(element.id || '') || ids.has(element.id)) throw new Error(`Invalid or duplicate element id: ${element.id}`);
    ids.add(element.id);
    const fields = validateLayer(element), data = fs.readFileSync(inside(bundle, element.src)), image = await loadImage(data);
    layers.push({ id: element.id, kind: 'layer', stage: id, key: false, ...fields, src: element.src, sha256: sha(data), width: image.width, height: image.height });
  }
  const removed = target.assets.filter(record => record.kind === 'layer' && record.stage === id).map(record => record.id);
  target.assets = [...target.assets.filter(record => !(record.kind === 'layer' && record.stage === id)), ...layers];
  stage.scenery = validateScenery({ weather: layout.weather, effects: layout.effects }, id);
  if (Array.isArray(target.game.expectedAssets)) target.game.expectedAssets = [...target.game.expectedAssets.filter(item => !removed.includes(item)), ...layers.map(layer => layer.id)];
  write(path.join(bundle, 'assets.json'), target);
  await review(bundle, target, id, layout);
  console.log(`${id}: ${layers.filter(l => l.motion !== 'still').length} animated and ${layers.filter(l => l.motion === 'still').length} still element(s), ${stage.scenery.effects.length} effect(s), weather ${stage.scenery.weather} -> assets.json`);
}

// The review sheet: elements boxed over the populated scene, effects marked over the clean painting.
async function review(bundle, target, id, layout) {
  const scene = target.assets.find(record => record.id === `${id}_scene`), plate = target.assets.find(record => record.kind === 'stage' && record.stage === id);
  if (!scene || !plate) return;
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const [top, bottom] = await Promise.all([loadImage(inside(bundle, scene.src)), loadImage(inside(bundle, plate.src))]);
  const width = 1280, height = Math.round(top.height * width / top.width), sheet = createCanvas(width, height * 2), g = sheet.getContext('2d');
  g.drawImage(top, 0, 0, width, height); g.drawImage(bottom, 0, height, width, height); g.lineWidth = 2; g.font = 'bold 15px sans-serif';
  const tag = (x, y, label, color) => { g.fillStyle = '#000'; g.fillRect(x - 3, y - 15, g.measureText(label).width + 6, 19); g.fillStyle = color; g.fillText(label, x, y); };
  for (const element of layout.elements) {
    const p = element.place, color = element.motion === 'still' ? '#9aa0a6' : '#ffe600';
    g.strokeStyle = color; g.strokeRect(p.x * width, p.y * height, p.w * width, p.h * height); tag(p.x * width + 2, Math.max(15, p.y * height - 4), `${element.id.split('_').pop()} ${element.motion}`, color);
  }
  g.strokeStyle = '#3df2ff';
  for (const effect of layout.effects || []) {
    if (effect.box) { const b = effect.box; g.strokeRect(b.x * width, height + b.y * height, b.w * width, b.h * height); tag(b.x * width + 4, height + b.y * height + 16, effect.type, '#3df2ff'); continue; }
    const points = effect.point ? [effect.point] : effect.points || [];
    for (const p of points) { g.beginPath(); g.arc(p.x * width, height + p.y * height, 6, 0, Math.PI * 2); g.stroke(); }
    if (points[0]) tag(points[0].x * width + 9, height + points[0].y * height + 5, effect.type, '#3df2ff');
  }
  fs.writeFileSync(path.join(bundle, 'scenery', `${id}-review.png`), sheet.toBuffer('image/png'));
}

async function main(argv) {
  const [command, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i++) {
    if (!['--patch', '--bundle', '--stage'].includes(rest[i]) || !rest[i + 1]) throw new Error(`Unknown or incomplete option: ${rest[i]}`);
    options[rest[i].slice(2)] = rest[++i];
  }
  if (command === 'apply') return apply(options);
  if (command === 'sync') return sync(options);
  throw new Error('Usage: stage-scenery.cjs <apply|sync> ... (see the header of build/tools/stage-scenery.cjs)');
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
module.exports = { apply, sync };
