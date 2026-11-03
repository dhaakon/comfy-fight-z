const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare, buildSmoke, freshRunDirectory } = require('../../comfyui/tools/prepare-smoke-test.cjs');
const { factoryCounts } = require('../../comfyui/tools/prepare-factory-workflows.cjs');
const main = require('../../comfyui/workflows/comfy-hackathon.json');
const config = require('../../comfyui/config/factory.json');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-smoke-workflow-'));
  t.after(() => { if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('cfz-smoke-workflow-')) throw new Error('Unexpected smoke fixture cleanup path'); fs.rmSync(root, { recursive: true, force: true }); });
  write(path.join(root, 'comfyui/workflows/comfy-hackathon.json'), main);
  return root;
}

test('smoke graph budgets a complete text-only two-fighter game without changing the main graph', () => {
  const before = structuredClone(main), result = buildSmoke(main, path.resolve('output/test-runs/test-only'), 'fixed-time');
  const { workflow, prompt, plan } = result;
  assert.deepEqual(main, before);
  assert.equal(workflow.nodes.length, 6); assert.equal(Object.keys(prompt).length, 6);
  assert.deepEqual(workflow.nodes.map(node => node.type), ['CFZProjectSettings', 'CFZCharacterFactory', 'CFZCharacterFactory', 'CFZEnvironmentFactory', 'CFZSharedArtFactory', 'CFZExportGameAssets']);
  const count = factoryCounts({ ...config, fighters: config.fighters.slice(0, 2), stages: config.stages.filter(stage => stage.enabled).slice(0, 1) });
  for (const key of ['paidImages', 'mappedAssets', 'oneK', 'twoK', 'estimatedUSD']) assert.equal(plan[key], count[key], key);
  assert.equal(plan.paidImages, 24); assert.equal(plan.runtimePoses, 54); assert.equal(plan.estimatedUSD, 1.369368);
  assert.equal(plan.generationSubmitted, false); assert.equal(plan.paidRetries, 0);
  for (const node of workflow.nodes.filter(node => ['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.type))) {
    assert.equal(node.widgets_values_named.image, '');
    assert.equal(node.widgets_values_named.source_mode, 'Invent fictional reference');
    assert.equal(prompt[node.id].inputs.image, '');
  }
});

test('smoke UI links, widget values and API inputs describe exactly the same executable graph', () => {
  const { workflow, prompt } = buildSmoke(main, path.resolve('output/test-runs/equivalent'));
  const nodes = new Map(workflow.nodes.map(node => [node.id, node])), seen = new Set();
  for (const node of workflow.nodes) {
    assert.equal(prompt[node.id].class_type, node.type);
    assert.deepEqual(node.widgets_values, Object.values(node.widgets_values_named));
    const expected = { ...node.widgets_values_named }; delete expected.control_after_generate;
    for (const input of node.inputs) {
      const link = workflow.links.find(link => link[0] === input.link);
      assert.ok(link); assert.equal(link[3], node.id); assert.equal(node.inputs[link[4]].name, input.name);
      const upstream = nodes.get(link[1]); assert.ok(upstream);
      assert.ok(upstream.outputs[link[2]].links.includes(link[0]));
      assert.equal(upstream.outputs[link[2]].type, link[5]);
      expected[input.name] = [String(link[1]), link[2]]; seen.add(link[0]);
    }
    assert.deepEqual(prompt[node.id].inputs, expected);
  }
  assert.equal(seen.size, workflow.links.length);
  const exporter = workflow.nodes.find(node => node.type === 'CFZExportGameAssets');
  assert.equal(exporter.inputs.filter(input => input.name.startsWith('bundles.')).length, 4);
});

test('smoke preflight rejects photos, omitted sheets and links to excluded nodes', () => {
  for (const change of [node => node.widgets_values_named.image = 'previous-photo.png', node => node.widgets_values_named.source_mode = 'Upload reference', node => node.widgets_values_named.include_sprite_sheets = false]) {
    const input = structuredClone(main); change(input.nodes.find(node => node.type === 'CFZCharacterFactory'));
    assert.throws(() => buildSmoke(input, path.resolve('output/test-runs/rejected')), /text-only fictional|all three sprite/);
  }
  const input = structuredClone(main);
  input.nodes.find(node => node.type === 'CFZSharedArtFactory').inputs.find(input => input.name === 'stage_reference').link = -1;
  assert.throws(() => buildSmoke(input, path.resolve('output/test-runs/rejected')), /excluded node/);
});

test('smoke preparation reads pricing only, writes fresh recipes and preserves an existing run', async t => {
  const root = fixture(t), requests = [];
  const fetchImpl = async (...args) => { requests.push(args); return { ok: true, async json() { return { GeminiNanoBanana2V2: { price_badge: { expr: '1K 0.048048; 2K 0.072072' } } }; } }; };
  const plan = await prepare('output/test-runs/new-run', { root, fetchImpl });
  assert.deepEqual(requests, [['http://127.0.0.1:8188/object_info/GeminiNanoBanana2V2']]);
  const run = path.dirname(plan.workflow), original = fs.readFileSync(plan.workflow);
  assert.deepEqual(fs.readdirSync(run).sort(), ['plan.json', 'price-badge.json', 'workflow.api.json', 'workflow.json']);
  assert.equal(fs.existsSync(plan.bundle), false);
  await assert.rejects(prepare('output/test-runs/new-run', { root, fetchImpl }), /existing runs are preserved/);
  assert.equal(requests.length, 1); assert.ok(fs.readFileSync(plan.workflow).equals(original));
});

test('smoke freshness rejects traversal, redirected runs and price changes without writing recipes', async t => {
  const root = fixture(t);
  for (const out of ['output/test-runs', 'output/test-runs/../../outside', '../outside']) assert.throws(() => freshRunDirectory(root, out), /inside output\/test-runs/);
  fs.mkdirSync(path.join(root, 'elsewhere')); fs.mkdirSync(path.join(root, 'output/test-runs'), { recursive: true });
  fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, 'output/test-runs/redirected'), 'junction');
  assert.throws(() => freshRunDirectory(root, 'output/test-runs/redirected/new-run'), /redirected/);
  const fetchImpl = async () => ({ ok: true, async json() { return { GeminiNanoBanana2V2: { price_badge: { expr: 'new rates' } } }; } });
  await assert.rejects(prepare('output/test-runs/price-change', { root, fetchImpl }), /pricing changed/);
  assert.equal(fs.existsSync(path.join(root, 'output/test-runs/price-change')), false);
});
