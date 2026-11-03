// Incremental cloud refresh: reuse the accepted identities, venue, UI, effects and audio.
// This tool only writes workflows and a reviewable plan. It never submits model jobs.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { makeJobs, makeBundleGraph } = require('./prepare-workflows.cjs');
const { makeAudioJobs, makeAudioGraph } = require('./prepare-audio-workflows.cjs');
const ROOT = path.resolve(__dirname, '../..');
const IMAGE_RATES = { '1K': .048048, '2K': .072072 };
const INTRO_RATE = .1144 / 1000;
const REPAIR_LIMIT = 4;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function makeSagaPatchJobs(config, acceptedManifest) {
  const accepted = new Map(acceptedManifest.assets.map(asset => [asset.id, asset]));
  const jobs = makeJobs(config).filter(job => ['sprites', 'portrait', 'hero', 'cutin'].includes(job.kind) || ['title', 'logo'].includes(job.id));
  return jobs.map(job => {
    if (!accepted.has(job.id)) throw new Error(`Refresh can only replace an accepted asset: ${job.id}`);
    if (!job.reference) return job;
    const reference = accepted.get(job.reference);
    if (!reference) throw new Error(`Accepted identity or venue reference is missing: ${job.reference}`);
    if (typeof reference.src !== 'string' || !reference.src.endsWith('.png')) throw new Error(`Expected a PNG reference: ${job.reference}`);
    return { ...job, sourceInput: path.posix.basename(reference.src.replaceAll('\\', '/')), acceptedReference: reference.src };
  });
}

function makeRepairJob(jobs, id, defect) {
  const job = jobs.find(item => item.id === id && item.kind === 'sprites');
  if (!job) throw new Error(`Repair must name a sprite sheet in the patch: ${id}`);
  return { ...job, prompt: `${job.prompt}\nPRODUCTION REPAIR PRIORITY: ${defect || 'Keep all nine complete silhouettes fully inside their cells, including both shoes in the bottom row. Every attack faces RIGHT. Remove every visible grid line and duplicate accessory.'} Recompose safely at a slightly smaller common body scale if necessary. Preserve the exact nine named poses and accepted character identity.` };
}

function defaultRepairs(config) {
  const layouts = ['sheetC', 'sheetB', 'sheet', 'sheetC'];
  const defects = [
    'The entrance pose in bottom-right cell must include BOTH complete lower legs, shoes and green padding below; no bottom-edge cropping.',
    'The low sweep in top-right cell attacks RIGHT, with the kicking foot right of the hips. All nine faces orient right. No visible grid or frame lines.',
    'Keep every configured accessory singular and attached correctly. Both shoes and every hand remain inside each cell.',
    'All lower-row poses include complete shoes and the configured accessories, with safe empty padding. No duplicate bodies or visible cell borders.'
  ];
  return config.fighters.slice(0, REPAIR_LIMIT).map((fighter, index) => [`${fighter.id}_${layouts[index]}`, defects[index]]);
}

function prepareSagaPatch({ baseDirectory, outputDirectory, repair, defect } = {}) {
  if (!baseDirectory) throw new Error('Choose an accepted fictional demo bundle with --base.');
  const base = path.resolve(ROOT, baseDirectory);
  const out = path.resolve(ROOT, outputDirectory || 'output/test-runs/fictional-demo-refresh');
  const patchRoot = path.join(out, 'patch');
  if (out === base || out.startsWith(base + path.sep) || base.startsWith(out + path.sep)) throw new Error('Patch output must be separate from the accepted base bundle.');
  const config = read(path.join(ROOT, 'comfyui/config/game.json'));
  const manifestPath = path.join(base, 'assets.json'), manifest = read(manifestPath);
  const jobs = makeSagaPatchJobs(config, manifest);
  const imageTemplate = read(path.join(ROOT, 'comfyui/workflows/templates/cloud-image.json'));
  if (repair) {
    const job = makeRepairJob(jobs, repair, defect);
    const file = path.join(out, 'workflows', 'repairs', `${repair}.json`);
    write(file, makeBundleGraph([job], config, imageTemplate, { externalReference: true, rootDirectory: path.join(out, 'repairs', repair), patch: true, title: `${config.title}: optional ${repair} repair` }));
    console.log(`Prepared optional single-image repair ${file}. No generation submitted; use only within an authorized repair allowance.`);
    return { workflow: file, job };
  }
  const audioJobs = makeAudioJobs(config).filter(job => job.id.endsWith('_intro'));
  const templates = Object.fromEntries(['music', 'sfx', 'voice'].map(type => [type, read(path.join(ROOT, `comfyui/workflows/templates/cloud-${type}.json`))]));
  const imageWorkflow = path.join(out, 'workflows', 'saga-images.json');
  const audioWorkflow = path.join(out, 'workflows', 'saga-intros.json');
  write(imageWorkflow, makeBundleGraph(jobs, config, imageTemplate, { externalReference: true, rootDirectory: patchRoot, patch: true, title: `${config.title}: ${config.subtitle} art refresh` }));
  const audioGraph = makeAudioGraph(audioJobs, config, templates, { rootDirectory: patchRoot, title: `${config.title}: ${audioJobs.length} fighter intro taglines` });
  audioGraph.nodes.find(node => node.type === 'MarkdownNote').widgets_values[0] += `\n\nINCREMENTAL PATCH: this audio.json contains only ${audioJobs.length} intro clips. Merge it by asset ID with the accepted audio.json; keep the existing music, effects and move announcements.`;
  write(audioWorkflow, audioGraph);

  const sources = [...new Map(jobs.filter(job => job.reference).map(job => [job.reference, job])).values()].map(job => {
    const source = path.resolve(base, job.acceptedReference);
    if (!source.startsWith(base + path.sep)) throw new Error(`Reference path leaves the accepted bundle: ${job.acceptedReference}`);
    return { id: job.reference, source, sourceInput: job.sourceInput, sha256: hash(source) };
  });
  const defaults = defaultRepairs(config);
  const repairs = defaults.filter(([id]) => jobs.some(job => job.id === id)).map(([id, issue]) => {
    const job = makeRepairJob(jobs, id, issue), workflow = path.join(out, 'workflows', 'repairs', `${id}.json`);
    write(workflow, makeBundleGraph([job], config, imageTemplate, { externalReference: true, rootDirectory: path.join(out, 'repairs', id), patch: true, title: `${config.title}: optional ${id} repair` }));
    return { id, workflow, root: path.join(out, 'repairs', id), issue, estimatedUSD: IMAGE_RATES['2K'] };
  });
  const imageUSD = jobs.reduce((sum, job) => sum + IMAGE_RATES[job.resolution || '1K'], 0);
  const audioUSD = audioJobs.reduce((sum, job) => sum + job.prompt.length * INTRO_RATE, 0);
  const plan = {
    schema: 'comfy-fighter-incremental-plan/v1', cloudOnly: true, paid: true, automaticSubmission: false,
    baseDirectory: base, baseManifestSha256: hash(manifestPath), patchRoot,
    game: { title: config.title, subtitle: config.subtitle, fighters: config.fighters, stages: config.stages, sheets: config.sheets },
    workflows: { images: imageWorkflow, audio: audioWorkflow },
    replaceAssetIds: jobs.map(job => job.id), addAudioIds: audioJobs.map(job => job.id),
    reuseAssetIds: manifest.assets.filter(asset => !jobs.some(job => job.id === asset.id)).map(asset => asset.id),
    uploads: sources, imageJobs: jobs, audioJobs,
    estimates: { images: jobs.length, introClips: audioJobs.length, imageUSD, audioUSD, baseUSD: imageUSD + audioUSD,
      maxOptionalRepairImages: REPAIR_LIMIT, optionalRepairUSD: REPAIR_LIMIT * IMAGE_RATES['2K'],
      maximumUSD: imageUSD + audioUSD + REPAIR_LIMIT * IMAGE_RATES['2K'],
      source: 'Installed live ComfyUI price_badge (2026-11-02): Gemini Nano Banana 2.1 MINIMAL 1K $0.048048 / 2K $0.072072; Eleven v4 $0.1144/1000 characters. Approximate; actual billing may vary.' },
    optionalRepairs: repairs,
    acceptance: 'Inspect every pose sheet before replacing accepted art. A maximum of four repair images may be submitted only if explicitly authorized and a real defect remains; optional workflows never auto-run. Merge replacements into the full accepted bundle, retaining configured stages and existing audio, then run the strict asset build.'
  };
  write(path.join(out, 'plan.json'), plan);
  console.log(`Prepared ${jobs.length} image replacements + ${audioJobs.length} intros, $${plan.estimates.baseUSD.toFixed(3)} estimated; maximum with four optional repairs $${plan.estimates.maximumUSD.toFixed(3)}. No generation submitted.`);
  return plan;
}

if (require.main === module) {
  const args = process.argv.slice(2), get = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  prepareSagaPatch({ baseDirectory: get('--base'), outputDirectory: get('--out'), repair: get('--repair'), defect: get('--defect') });
}
module.exports = { makeSagaPatchJobs, makeRepairJob, defaultRepairs, prepareSagaPatch };
