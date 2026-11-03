const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeSagaPatchJobs, makeRepairJob, defaultRepairs, prepareSagaPatch } = require('../../comfyui/tools/prepare-saga-patch.cjs');
const { makeJobs, makeBundleGraph, assetRecord } = require('../../comfyui/tools/prepare-workflows.cjs');
const root = path.resolve(__dirname, '../..');
const load = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const config = load('comfyui/config/game.json'), template = load('comfyui/workflows/templates/cloud-image.json');
const accepted = { assets: makeJobs(config).map(job => ({ ...assetRecord(job), src: `raw/${job.id}-accepted.png` })) };

test('saga refresh replaces only 38 selected images and shares seven accepted references', () => {
  const jobs = makeSagaPatchJobs(config, accepted);
  assert.equal(jobs.length, 38);
  assert.equal(jobs.filter(job => job.kind === 'sprites').length, 18);
  assert.equal(jobs.filter(job => job.resolution === '2K').length, 18);
  assert.equal(jobs.some(job => ['stage', 'source', 'reference', 'effects'].includes(job.kind)), false);
  const graph = makeBundleGraph(jobs, config, template, { externalReference: true, rootDirectory: 'output/test-output/saga-patch', patch: true });
  assert.equal(graph.nodes.filter(node => node.type === 'GeminiNanoBanana2V2').length, 38);
  const loads = graph.nodes.filter(node => node.type === 'LoadImage');
  assert.equal(loads.length, 7);
  for (const job of jobs.filter(item => item.reference)) {
    const generator = graph.nodes.find(node => node.title === `${job.id} | cloud generation`);
    const input = generator.inputs.find(item => item.name === 'model.images.image_1');
    const link = graph.links.find(item => item[0] === input.link);
    const source = graph.nodes.find(node => node.id === link[1]);
    assert.equal(source.type, 'LoadImage');
    assert.equal(source.widgets_values[0], `${job.reference}-accepted.png`);
  }
  const note = graph.nodes.find(node => node.type === 'MarkdownNote').widgets_values[0];
  assert.match(note, /PARTIAL assets.json/);
  assert.match(note, /Merge replacements by asset ID/);
  const bundleConfig = JSON.parse(graph.nodes.find(node => node.type === 'CFZAssetRoot').widgets_values[1]);
  assert.equal(bundleConfig.subtitle, 'Higgsfield Open Source Saga');
  assert.ok(bundleConfig.fighters.every(fighter => fighter.introTagline));
  assert.deepEqual(bundleConfig.expectedAssets, jobs.map(job => job.id));
});

test('incremental refresh cannot silently invent a missing accepted identity or asset', () => {
  assert.throws(() => makeSagaPatchJobs(config, { assets: accepted.assets.filter(asset => asset.id !== `${config.fighters[0].id}_reference`) }), /reference is missing/);
  assert.throws(() => makeSagaPatchJobs(config, { assets: accepted.assets.filter(asset => asset.id !== 'logo') }), /only replace an accepted asset/);
});

test('optional repair generates one sheet while retaining its nine-pose contract', () => {
  const jobs = makeSagaPatchJobs(config, accepted);
  const repair = makeRepairJob(jobs, `${config.fighters[0].id}_sheetC`, 'Show complete shoes in the entrance pose.');
  const graph = makeBundleGraph([repair], config, template, { externalReference: true, patch: true });
  assert.equal(graph.nodes.filter(node => node.type === 'GeminiNanoBanana2V2').length, 1);
  assert.deepEqual(repair.poses, config.sheets.sheetC);
  assert.match(repair.prompt, /Show complete shoes in the entrance pose/);
  assert.match(repair.prompt, /at least 12% clear green on ALL four sides/);
  assert.match(repair.prompt, /especially the sweep, airkick and punches attack RIGHT/);
  assert.throws(() => makeRepairJob(jobs, `${config.fighters[0].id}_hero`), /Repair must name a sprite sheet/);
});

test('repair defaults follow edited fictional IDs and never fall back to a historic bundle', () => {
  const fictional = { fighters: ['ember', 'moss', 'tide', 'nova', 'quartz', 'volt'].map(id => ({ id })) };
  assert.deepEqual(defaultRepairs(fictional).map(([id]) => id), ['ember_sheetC', 'moss_sheetB', 'tide_sheet', 'nova_sheetC']);
  assert.throws(() => prepareSagaPatch(), /Choose an accepted fictional demo bundle/);
});
