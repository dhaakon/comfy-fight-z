// Prepare paid arcade-expansion runs for an ACCEPTED bundle without submitting them:
//   node comfyui/tools/prepare-arcade-expansion.cjs --base example/bundle --out output/test-runs/<fresh-name>
// Writes runnable image (partial patch) and complete-audio workflows in UI and API form,
// the exact accepted identity uploads, and a plan with estimated costs. A reviewer uploads
// the PNGs into ComfyUI's input folder and approves the spend before anything is queued.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { makeExpansionGraph, expansionCounts, apiPrompt } = require('./prepare-factory-workflows.cjs');
const { makeAudioJobs, makeAudioGraph } = require('./prepare-audio-workflows.cjs');
const { directoryTarget } = require('../../build/tools/lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
const RATES = Object.freeze({ image1K: .048048, image2K: .072072, musicSecond: .0025, effectMinute: .14, speechThousandCharacters: .1144 });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function freshDirectory(out) {
  const directory = path.resolve(ROOT, out), runs = path.join(ROOT, 'output/test-runs') + path.sep;
  if (!directory.startsWith(runs)) throw new Error('Use a fresh directory inside output/test-runs/.');
  if (directoryTarget(directory) !== path.join(fs.realpathSync(ROOT), path.relative(ROOT, directory))) throw new Error('Run directory is redirected.');
  if (fs.existsSync(directory)) throw new Error('Choose a new run directory; existing runs are preserved.');
  return directory;
}

async function prepare({ base, out, config = read(path.join(ROOT, 'comfyui/config/game.json')) } = {}) {
  if (!base || !out) throw new Error('Usage: node comfyui/tools/prepare-arcade-expansion.cjs --base <accepted bundle> --out output/test-runs/<fresh-name>');
  const directory = freshDirectory(out), baseDirectory = fs.realpathSync(path.resolve(ROOT, base));
  const manifest = read(path.join(baseDirectory, 'assets.json'));
  const heroes = config.fighters.filter(fighter => !fighter.boss);
  for (const fighter of heroes) if (!manifest.game?.fighters?.some(item => item.id === fighter.id)) throw new Error(`Accepted bundle is missing ${fighter.id}.`);
  const { loadImage, createCanvas } = require(path.join(ROOT, 'build/node_modules/@napi-rs/canvas'));
  fs.mkdirSync(path.join(directory, 'uploads'), { recursive: true });
  const uploads = [];
  for (const fighter of heroes) {
    const record = manifest.assets.find(asset => asset.kind === 'reference' && asset.fighter === fighter.id);
    if (!record) throw new Error(`Accepted identity reference missing: ${fighter.id}`);
    const source = path.resolve(baseDirectory, record.src);
    if (!source.startsWith(baseDirectory + path.sep)) throw new Error('Reference leaves the accepted bundle.');
    const data = fs.readFileSync(source);
    if (record.sha256 && hash(data) !== record.sha256) throw new Error(`Accepted reference changed: ${record.id}`);
    // Decode the lossless reference and upload exact pixels as PNG.
    const image = await loadImage(data), canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    const filename = fighter.acceptedReferenceInput || `cfz-accepted-${fighter.id}-reference.png`, png = await canvas.encode('png');
    fs.writeFileSync(path.join(directory, 'uploads', filename), png);
    uploads.push({ fighter: fighter.id, record: record.id, filename, sha256: hash(png), width: image.width, height: image.height });
  }
  const imageRoot = path.join(directory, 'patch'), audioRoot = path.join(directory, 'audio');
  const images = makeExpansionGraph(config, { rootDirectory: imageRoot });
  for (const node of images.nodes) if (node.type !== 'MarkdownNote') node.mode = 0;
  images.extra.cfzArcadeExpansion.mutedByDefault = false; images.extra.cfzArcadeExpansion.prepared = true;
  const templates = Object.fromEntries(['music', 'sfx', 'voice'].map(key => [key, read(path.join(ROOT, `comfyui/workflows/templates/cloud-${key}.json`))]));
  const audioJobs = makeAudioJobs(config);
  const audio = makeAudioGraph(audioJobs, config, templates, { rootDirectory: audioRoot, title: `${config.title}: complete arcade audio` });
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('images.workflow.json', images); write('images.api.json', apiPrompt(images));
  write('audio.workflow.json', audio); write('audio.api.json', apiPrompt(audio));
  const imageCount = expansionCounts(config);
  const voiceCharacters = audioJobs.filter(job => job.category === 'voice').reduce((sum, job) => sum + job.prompt.length, 0);
  const musicSeconds = audioJobs.filter(job => job.category === 'music').reduce((sum, job) => sum + job.duration, 0);
  const effectsSeconds = audioJobs.filter(job => job.category === 'sfx').reduce((sum, job) => sum + job.duration, 0);
  const audioUSD = Number((musicSeconds * RATES.musicSecond + effectsSeconds * RATES.effectMinute / 60 + voiceCharacters * RATES.speechThousandCharacters / 1000).toFixed(6));
  const plan = { schema: 'comfy-fighter-arcade-expansion-plan/v1', cloudOnly: true, generationSubmitted: false, requiresSpendingAuthorization: true,
    base: path.relative(ROOT, baseDirectory).replaceAll('\\', '/'), imageRoot, audioRoot, uploads,
    images: { workflow: 'images.workflow.json', apiWorkflow: 'images.api.json', ...imageCount },
    audio: { workflow: 'audio.workflow.json', apiWorkflow: 'audio.api.json', clips: audioJobs.length, musicSeconds, effectsSeconds, voiceCharacters, estimatedUSD: audioUSD },
    total: { estimatedUSD: Number((imageCount.estimatedUSD + audioUSD).toFixed(6)) }, rates: RATES,
    next: [
      'Upload uploads/*.png into the ComfyUI input folder with the same names, validate both API workflows, then queue only after approving the spend.',
      'Review every sheet, ending and arena; listen to every clip.',
      'Merge: node build/tools/merge-bundles.cjs --saga --base <accepted bundle> --patch <out>/patch --patch <out>/audio --out <fresh merged folder>',
      'Verify: npm run build:bundle -- --bundle <merged folder> --out <fresh export folder>',
      'Package for the repository: npm run example:package -- --bundle <merged folder> --out <fresh folder> --previous <accepted bundle>/provenance.json; replace example/bundle only after npm run example passes on the packaged copy.'
    ] };
  write('plan.json', plan);
  return { directory, plan };
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--base', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node comfyui/tools/prepare-arcade-expansion.cjs --base <accepted bundle> --out output/test-runs/<fresh-name>');
    options[args[i].slice(2)] = args[i + 1];
  }
  prepare(options).then(({ directory, plan }) => console.log(JSON.stringify({ directory, images: plan.images.paidImages, audio: plan.audio.clips, estimatedUSD: plan.total.estimatedUSD, generationSubmitted: false }, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepare, apiPrompt };
