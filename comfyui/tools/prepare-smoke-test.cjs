const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

const { directoryTarget } = require('../../build/tools/lib/runtime-validation.cjs');

function freshRunDirectory(root, out) {
  const directory = path.resolve(root, out || `output/test-runs/smoke-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  const runs = path.join(root, 'output/test-runs') + path.sep;
  if (!directory.startsWith(runs)) throw new Error('Use a fresh directory inside output/test-runs/.');
  const expected = path.join(fs.realpathSync(root), path.relative(root, directory));
  if (directoryTarget(directory) !== expected) throw new Error('Smoke-test path is redirected outside its expected run directory.');
  if (fs.existsSync(directory)) throw new Error('Choose a new smoke-test directory; existing runs are preserved.');
  return directory;
}

function buildSmoke(input, directory, preparedAt = new Date().toISOString()) {
  const workflow = structuredClone(input);
  const project = workflow.nodes.find(node => node.type === 'CFZProjectSettings');
  if (!project || project.widgets_values_named.model !== 'Gemini Nano Banana 2.1') throw new Error('The smoke-test estimate requires Gemini Nano Banana 2.1.');
  const fighters = workflow.nodes.filter(node => node.type === 'CFZCharacterFactory').slice(0, 2);
  const stage = workflow.nodes.find(node => node.type === 'CFZEnvironmentFactory' && node.widgets_values_named.enabled);
  const shared = workflow.nodes.find(node => node.type === 'CFZSharedArtFactory');
  const exporter = workflow.nodes.find(node => node.type === 'CFZExportGameAssets');
  if (fighters.length !== 2 || !stage || !shared || !exporter) throw new Error('The main factory is incomplete.');
  const nodes = [project, ...fighters, stage, shared, exporter];
  const ids = new Set(nodes.map(node => node.id));
  for (const node of [...fighters, stage]) {
    if (node.widgets_values_named.source_mode !== 'Invent fictional reference' || node.widgets_values_named.image) throw new Error('Smoke tests require text-only fictional designs and empty image selectors.');
  }
  if (fighters.some(node => !node.widgets_values_named.include_sprite_sheets)) throw new Error('Both fighters require all three sprite sheets.');
  project.widgets_values_named.root_directory = path.join(directory, 'bundle');
  project.widgets_values = Object.values(project.widgets_values_named);
  const originalLinks = new Map(workflow.links.map(link => [link[0], link]));
  const prompt = {};
  for (const node of nodes) {
    const inputs = { ...node.widgets_values_named };
    delete inputs.control_after_generate;
    for (const input of node.inputs) {
      const link = originalLinks.get(input.link);
      if (node !== exporter && input.link !== null && (!link || !ids.has(link[1]))) throw new Error(`Smoke input ${node.type}.${input.name} refers to an excluded node.`);
      if (link && ids.has(link[1])) inputs[input.name] = [String(link[1]), link[2]];
    }
    if (node === exporter) {
      for (const key of Object.keys(inputs)) if (key.startsWith('bundles.')) delete inputs[key];
      [...fighters, stage, shared].forEach((source, index) => { inputs[`bundles.bundle_${index}`] = [String(source.id), 0]; });
    }
    prompt[node.id] = { class_type: node.type, inputs, _meta: { title: node.title } };
  }
  // Rebuild links so the small UI graph and API prompt describe the same run.
  workflow.nodes = nodes;
  workflow.groups = [];
  workflow.links = [];
  workflow.last_link_id = 0;
  nodes.forEach((node, index) => {
    node.order = index;
    node.pos = [[0, 0], [520, 0], [1040, 0], [520, 850], [1040, 850], [1560, 400]][index];
    node.inputs = [];
    for (const output of node.outputs) output.links = [];
  });
  for (const node of nodes) for (const [name, input] of Object.entries(prompt[node.id].inputs)) {
    if (!Array.isArray(input)) continue;
    const source = nodes.find(candidate => String(candidate.id) === input[0]);
    const output = source.outputs[input[1]], id = ++workflow.last_link_id;
    node.inputs.push({ name, type: output.type, link: id });
    output.links.push(id);
    workflow.links.push([id, source.id, input[1], node.id, node.inputs.length - 1, output.type]);
  }
  workflow.extra.ds = { scale: 0.45, offset: [80, 80] };
  // Count paid calls from the selected nodes: optional arcade art adds two 2K sheets and a 1K ending per fighter.
  const invents = node => node.widgets_values_named.source_mode === 'Invent fictional reference';
  const arcade = node => node.widgets_values_named.include_arcade_art !== false;
  const oneK = fighters.reduce((sum, node) => sum + 4 + (arcade(node) ? 1 : 0) + (invents(node) ? 1 : 0), 0) + 5;
  const twoK = fighters.reduce((sum, node) => sum + 3 + (arcade(node) ? 2 : 0), 0) + 1 + (invents(stage) ? 1 : 0) + 1;
  const mappedAssets = fighters.reduce((sum, node) => sum + 8 + (arcade(node) ? 3 : 0), 0) + 2 + 6;
  const plan = {
    title: 'Comfy Fighter Z generation smoke test', preparedAt,
    workflow: path.join(directory, 'workflow.api.json'), bundle: path.join(directory, 'bundle'),
    fighters: fighters.map(node => node.widgets_values_named.character_id), stage: stage.widgets_values_named.stage_id,
    paidImages: oneK + twoK, oneK, twoK, mappedAssets, runtimePoses: fighters.reduce((sum, node) => sum + 27 + (arcade(node) ? 18 : 0), 0),
    estimatedUSD: Number((oneK * 0.048048 + twoK * 0.072072).toFixed(6)),
    model: project.widgets_values_named.model, source: 'Fresh text-only fictional designs; no image files loaded.',
    audio: false, video: false, paidRetries: 0, generationSubmitted: false,
    note: 'Preparation does not submit jobs. Confirm the cloud spend before running through ComfyUI.',
  };
  return { workflow, prompt, plan };
}

async function prepare(out, { root = ROOT, fetchImpl = fetch } = {}) {
  root = path.resolve(root);
  const directory = freshRunDirectory(root, out);
  const response = await fetchImpl('http://127.0.0.1:8188/object_info/GeminiNanoBanana2V2');
  if (!response.ok) throw new Error('Start ComfyUI to verify the current image price badge.');
  const badge = (await response.json()).GeminiNanoBanana2V2?.price_badge;
  if (![0.048048, 0.072072].every(rate => badge?.expr?.includes(String(rate)))) throw new Error('Image pricing changed. Review the estimate before preparing a paid run.');
  const input = JSON.parse(fs.readFileSync(path.join(root, 'comfyui/workflows/comfy-hackathon.json'), 'utf8'));
  const { workflow, prompt, plan } = buildSmoke(input, directory);
  freshRunDirectory(root, directory);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  write('workflow.api.json', prompt); write('workflow.json', workflow); write('plan.json', plan); write('price-badge.json', badge);
  return plan;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node comfyui/tools/prepare-smoke-test.cjs [--out output/test-runs/new-name]');
  prepare(args[1]).then(plan => console.log(JSON.stringify(plan, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepare, buildSmoke, freshRunDirectory };
