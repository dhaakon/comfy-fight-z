// Prepare a complete two-fighter game run without submitting it: every game image, the startup
// ensemble, a looping menu video, a looping select-screen video, two fight introductions, two select-screen idle loops and the full audio set in ONE workflow
// that writes assets.json, audio.json and video.json into <out>/bundle. Sprite sheets are visible
// nodes so comfyui/tools/run-sequential.cjs can pace the run on a one-job workspace.
//   node comfyui/tools/prepare-duo-run.cjs --out output/test-runs/<fresh-name> [--fighters griddle,rivet]
// The run is the canonical cast cut down to two fighters and its first arena; prepare-cast-run.cjs builds it.
const fs = require('node:fs');
const path = require('node:path');
const { buildCast, CAST_SCHEMA } = require('./prepare-cast-run.cjs');
const { directoryTarget } = require('../../build/tools/lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

function buildDuo(config, fighterIds, bundleRoot, { seed = 42 } = {}) {
  const fighters = fighterIds.map(id => config.fighters.find(fighter => fighter.id === id));
  if (fighters.length !== 2 || fighters.some(fighter => !fighter) || fighterIds[0] === fighterIds[1]) throw new Error(`Choose two different fighters from: ${config.fighters.map(f => f.id).join(', ')}`);
  if (!config.extraSheets) throw new Error('The two-fighter run uses the arcade layout (extraSheets).');
  const stage = config.stages[0];
  const { workflow, prompt, plan } = buildCast({ ...config, castSchema: CAST_SCHEMA, fighters, stages: [stage] }, bundleRoot, { seed, label: 'two-fighter complete run' });
  return { workflow, prompt, plan: { ...plan, schema: 'comfy-fighter-duo-plan/v1', stage: stage.id } };
}

function prepare({ out, fighters = 'griddle,rivet', seed = 42 }) {
  const directory = path.resolve(ROOT, out || ''), runs = path.join(ROOT, 'output/test-runs') + path.sep;
  if (!out || !directory.startsWith(runs)) throw new Error('Use --out output/test-runs/<fresh-name>.');
  if (directoryTarget(directory) !== path.join(fs.realpathSync(ROOT), path.relative(ROOT, directory))) throw new Error('Run directory is redirected.');
  if (fs.existsSync(directory)) throw new Error('Choose a new run directory; existing runs are preserved.');
  const { workflow, prompt, plan } = buildDuo(read('comfyui/config/factory.json'), fighters.split(','), path.join(directory, 'bundle'), { seed });
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of [['workflow.json', workflow], ['workflow.api.json', prompt], ['plan.json', plan]]) fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  return { directory, plan };
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--fighters'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node comfyui/tools/prepare-duo-run.cjs --out output/test-runs/<fresh-name> [--fighters griddle,rivet]');
    options[args[i].slice(2)] = args[i + 1];
  }
  try { const { directory, plan } = prepare(options); console.log(JSON.stringify({ directory, ...plan.total, images: plan.images.paidImages, clips: plan.videos.clips, audio: plan.audio.clips, generationSubmitted: false }, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildDuo, prepare };
