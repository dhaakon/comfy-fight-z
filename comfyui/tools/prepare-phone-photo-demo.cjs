// Two explicitly separated cloud phases. This tool never generates or uploads media.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomInt } = require('node:crypto');
const { buildCombinedGame, makeApiPrompt, checkPrices, RATES } = require('../../example/prepare.cjs');
const { assertPlainDirectory } = require('./prepare-explainer.cjs');
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUT = 'output/phone-photo-demo/20261103-phone-cast';
const CONFIG = 'comfyui/config/phone-photo-demo.json';
const PLACEHOLDER = '__PHONE_PHOTO_DEMO_BUNDLE_ROOT__';
const ids = ['griddle', 'rivet', 'tempo', 'nimbus', 'switchback', 'brick'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); };
const uuid = text => { const h = createHash('sha256').update(text).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

function validateConfig(config) {
  if (config.phonePhotoSchema !== 'comfy-fighter-phone-photo-demo/v1' || config.demoSource !== 'fictional-phone-photos-from-text') throw new Error('Use the separate fictional phone-photo demo configuration.');
  if (config.model !== 'Gemini Nano Banana 2.1') throw new Error('This recipe requires the verified Gemini Nano Banana 2.1 cloud model.');
  if (JSON.stringify(config.fighters?.map(fighter => fighter.id)) !== JSON.stringify(ids)) throw new Error('Preserve the six fictional fighter IDs and ordering.');
  if (config.stages?.length !== 3 || config.stages[0].id !== 'yard' || config.stages[0].enabled !== true || config.stages.slice(1).some(stage => stage.enabled)) throw new Error('Enable only The Yard in the first of three environment slots.');
  const identities = new Set();
  for (const item of [...config.fighters, ...config.stages]) {
    if (item.sourceImage || item.sourceInput || item.acceptedReferenceInput || item.sampleSourceImage || item.sampleSourceInput) throw new Error('Phone photos must be invented from text; do not configure earlier images or upload filenames.');
    if (!/^[a-z][a-z0-9_-]*$/.test(item.id)) throw new Error('Use filename-safe IDs.');
    if (identities.has(item.id)) throw new Error(`Duplicate fighter/environment ID: ${item.id}`);
    identities.add(item.id);
    if (item.sourceMode !== 'Upload reference') throw new Error('The phone-photo game must use Upload reference for each factory slot.');
  }
  for (const item of [...config.fighters, config.stages[0]]) if (!item.photoPrompt?.trim() || !item.description?.trim()) throw new Error(`Missing fresh photo prompt or game description: ${item.id}`);
  for (const fighter of config.fighters) if (!fighter.introTagline || !fighter.introVoice || !fighter.specialMove?.name || !fighter.specialMove?.description) throw new Error(`Complete fictional fighter audio and special fields: ${fighter.id}`);
  if (JSON.stringify(config.sheets) !== JSON.stringify(read(path.join(ROOT, 'comfyui/config/game.json')).sheets)) throw new Error('Preserve the standard three-sheet, 27-pose layouts.');
  return config;
}

function referenceJobs(config, runName, seed) {
  validateConfig(config);
  if (!/^[A-Za-z0-9_-]+$/.test(runName)) throw new Error('Use a filename-safe run name.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER - 2000) throw new Error('Use a nonnegative safe seed with room for generation offsets.');
  return [...config.fighters, config.stages[0]].map((item, index) => {
    const uploadFilename = `cfz-phone-${runName}-${item.id}.png`;
    return { id: item.id, name: item.name, category: index < 6 ? 'character' : 'environment',
      prompt: item.photoPrompt, aspect: index < 6 ? '2:3' : '16:9', resolution: '2K', seed: seed + index,
      generatorNodeId: String(index * 2 + 1), saveNodeId: String(index * 2 + 2), uploadFilename,
      filenamePrefix: `comfy-fighter-z/phone-photo-demo/${runName}/${uploadFilename.slice(0, -4)}`,
      downloadPattern: `${uploadFilename.slice(0, -4)}_*.png`, localFile: `references/${item.id}.png`,
      estimatedUSD: RATES.image2K };
  });
}

function makePhotoGraph(config, jobs) {
  const nodes = [], links = [];
  jobs.forEach((job, index) => {
    const x = (index % 3) * 970, y = Math.floor(index / 3) * 720;
    const named = { prompt: job.prompt, model: config.model, 'model.aspect_ratio': job.aspect, 'model.resolution': job.resolution,
      'model.thinking_level': 'MINIMAL', seed: job.seed, control_after_generate: 'fixed', response_modalities: 'IMAGE',
      system_prompt: 'Create exactly one photorealistic casual smartphone snapshot from this text alone. Every person is a newly invented fictional adult and every place is invented. No source images, real-person likeness, existing character or recognizable real venue are supplied or requested. Natural phone-camera realism, not illustration. No text, watermark, logos or phone-interface overlays.', temperature: 1, top_p: .95 };
    const generation = { id: Number(job.generatorNodeId), type: 'GeminiNanoBanana2V2', title: `Invent phone snapshot | ${job.name}`, pos: [x, y], size: [460, 650], flags: {}, order: nodes.length, mode: 0, inputs: [],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [index + 1] }, { name: 'STRING', type: 'STRING', links: [] }, { name: 'thought_image', type: 'IMAGE', links: [] }], properties: { 'Node name for S&R': 'GeminiNanoBanana2V2' }, widgets_values: Object.values(named), widgets_values_named: named };
    const save = { id: Number(job.saveNodeId), type: 'SaveImage', title: `Save NEW photo for upload | ${job.id}`, pos: [x + 490, y], size: [430, 600], flags: {}, order: nodes.length + 1, mode: 0,
      inputs: [{ name: 'images', type: 'IMAGE', link: index + 1 }], outputs: [], properties: { 'Node name for S&R': 'SaveImage' }, widgets_values: [job.filenamePrefix], widgets_values_named: { filename_prefix: job.filenamePrefix } };
    links.push([index + 1, generation.id, 0, save.id, 0, 'IMAGE']); nodes.push(generation, save);
  });
  nodes.push({ id: 15, type: 'MarkdownNote', title: 'Phase 1: entirely fictional phone photos', pos: [0, -370], size: [2850, 300], flags: {}, order: nodes.length, mode: 0, inputs: [], outputs: [], properties: {},
    widgets_values: ['# Phase 1: invent seven phone photographs\n\nSix newly invented adults plus one invented Yard. Seven native 2K cloud requests, estimated $0.504504. Every request is text-only: no Load Image nodes, no photo inputs and no earlier-session references. Casual phone snapshots are deliberately realistic; the subjects are fictional.\n\nReview the seven outputs, download each to the plan.json references/<id>.png path, then upload these NEW files through Comfy MCP with their exact uploadFilename. Only after that upload gate should phase2-ui.json / phase2-api.json be validated and queued. Preparing these recipes makes no model calls.'] });
  return { id: uuid(`phone-photo-references:${jobs[0].filenamePrefix}:${jobs[0].seed}`), revision: 0, last_node_id: 15, last_link_id: 7, nodes, links, groups: [], config: {}, extra: { ds: { scale: .4, offset: [80, 430] } }, version: .4 };
}

function buildRun(config, directory, runName, seed = 20261103) {
  const references = referenceJobs(config, runName, seed), photoGraph = makePhotoGraph(config, references);
  const factory = structuredClone(config); factory.assetRoot = path.join(directory, 'bundle');
  const byId = new Map(references.map(job => [job.id, job]));
  for (const item of [...factory.fighters, ...factory.stages]) {
    item.sourceMode = 'Upload reference'; item.sourceInput = byId.get(item.id)?.uploadFilename || ''; item.sourceImage = '';
    delete item.photoPrompt;
  }
  const game = buildCombinedGame(factory, factory.assetRoot, { seed: seed + 1000, media: false });
  game.workflow.extra.cfzPhonePhotoDemo = { phase: 2, sourcePolicy: 'Upload only the seven outputs from this run\'s text-only phase 1', uploadFilenames: references.map(job => job.uploadFilename) };
  delete game.workflow.extra.cfzExample;
  const notes = game.workflow.nodes.filter(node => node.type === 'MarkdownNote');
  notes[0].widgets_values = [`# Phase 2: phone photos become a complete anime game\n\n49 paid cloud images +${game.plan.audio.paidClips} audio clips, estimated $${game.plan.total.estimatedUSD.toFixed(3)}. Six fictional adults, 162 poses, The Yard and shared artwork. All seven selected uploads must come from THIS run's phase 1: realistic phone images invented from text, never real-person or earlier-session photos. Slots2/3 stay disabled.\n\nThe Character Factories use Upload reference, preserving the new fictional faces, hair and everyday outfits as anime identities. Then they generate three sheets, portraits, heroes and cut-ins. The Yard upload drives the playable stage and title/selection venue. Native audio includes music, announcer calls, effects and every fighter line, including six introductions.`];
  notes[1].widgets_values = ['## Upload gate and one shared output folder\n\n1. Generate and visually review phase1-ui.json.\n2. Download the seven new references and upload them with the exact plan.json filenames.\n3. Validate phase2-ui.json or phase2-api.json against that server.\n4. Run this graph, then review all18 sheets/162 poses and the audio.\n\nProject Settings supplies one fresh bundle root for assets.json and audio.json. The uploaded synthetic reference photos are preserved as source assets. Keep the existing example/bundle and accepted game separate.'];
  game.plan.schema = 'comfy-fighter-phone-photo-game-plan/v1';
  game.plan.source = 'Upload reference: exactly seven newly generated fictional phone photographs from this run\'s text-only phase 1. No previous session photo or game art is an input.';
  game.plan.workflow = 'phase2-ui.json'; game.plan.apiWorkflow = 'phase2-api.json';
  game.prompt = makeApiPrompt(game.workflow);
  const referenceCost = Number(references.reduce((sum, job) => sum + job.estimatedUSD, 0).toFixed(9));
  const plan = { schema: 'comfy-fighter-phone-photo-plan/v1', preparedAt: new Date().toISOString(), title: config.title,
    cloudOnly: true, generationSubmitted: false, automaticPaidRetries: 0, sourcePolicy: 'All photo references invented from text in phase1; phase2 accepts only the newly uploaded filenames listed here.',
    seed, runName, directory, bundle: factory.assetRoot, expectedAssets: 56, expectedAudio: game.plan.audio.paidClips, runtimePoses: 162,
    phases: [{ id: 'references', workflow: 'phase1-ui.json', apiWorkflow: 'phase1-api.json', paidImages: 7, oneK: 0, twoK: 7, estimatedUSD: referenceCost },
      { id: 'game', workflow: 'phase2-ui.json', apiWorkflow: 'phase2-api.json', paidImages: game.plan.image.paidImages, paidAudioClips: game.plan.audio.paidClips, estimatedUSD: game.plan.total.estimatedUSD, dependsOn: 'Review and upload all seven phase1 references before validation/execution.' }],
    total: { paidImages: 7 + game.plan.image.paidImages, paidAudioClips: game.plan.audio.paidClips, estimatedUSD: Number((referenceCost + game.plan.total.estimatedUSD).toFixed(9)) },
    references, rates: RATES, game: game.plan, video: 'No opening film or explainer narration is included in this generation estimate.',
    estimateNote: 'Live installed ComfyUI price badges are checked when requested. Actual billing may vary.' };
  return { photoGraph, photoPrompt: makeApiPrompt(photoGraph), gameGraph: game.workflow, gamePrompt: game.prompt, config: factory, plan };
}

function freshDirectory(out) {
  const directory = path.resolve(ROOT, out), base = path.join(ROOT, 'output/phone-photo-demo');
  if (!directory.startsWith(base + path.sep)) throw new Error('Use a new directory below output/phone-photo-demo/.');
  assertPlainDirectory(directory);
  try { fs.lstatSync(directory); throw new Error('Run already exists; preserve previous prepared/approved artifacts.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return directory;
}

async function prepare({ out = DEFAULT_OUT, configPath = CONFIG, server = 'http://127.0.0.1:8188', checkLivePrices = false, templates = false } = {}) {
  // A repeat template request must fail before creating any new run artifacts.
  if (templates) for (const filename of ['01-invent-phone-photos.json', '02-photos-to-game.json']) {
    const file = path.join(ROOT, 'comfyui/workflows/phone-photo-demo', filename);
    assertPlainDirectory(path.dirname(file));
    try { fs.lstatSync(file); throw new Error('Review templates already exist; omit --templates to prepare a new runnable run.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const directory = freshDirectory(out), config = read(path.resolve(ROOT, configPath)), runName = path.basename(directory);
  const prepared = buildRun(config, directory, runName, randomInt(1, 2 ** 31));
  let prices;
  if (checkLivePrices) {
    const catalog = {};
    for (const name of ['GeminiNanoBanana2V2', 'SoniloTextToMusic', 'ElevenLabsTextToSoundEffects', 'ElevenLabsTextToSpeech', 'CFZProjectAudioRoot']) {
      const response = await fetch(`${server.replace(/\/$/, '')}/object_info/${name}`);
      if (!response.ok) throw new Error(`Cannot read live ${name}.`);
      catalog[name] = (await response.json())[name]; if (!catalog[name]) throw new Error(`Install/restart the current node pack: ${name} is missing.`);
    }
    prices = { checkedAt: new Date().toISOString(), badges: checkPrices(catalog), rates: RATES };
  }
  prepared.plan.livePricesChecked = !!prices;
  freshDirectory(directory);
  fs.mkdirSync(directory, { recursive: true });
  for (const [filename, data] of [['phase1-ui.json', prepared.photoGraph], ['phase1-api.json', prepared.photoPrompt], ['phase2-ui.json', prepared.gameGraph], ['phase2-api.json', prepared.gamePrompt], ['config.json', prepared.config], ['plan.json', prepared.plan]]) write(path.join(directory, filename), data);
  if (prices) write(path.join(directory, 'prices.json'), prices);
  if (templates) {
    const portable = buildRun(config, PLACEHOLDER, 'NEW_RUN', 20261103);
    const project = portable.gameGraph.nodes.find(node => node.type === 'CFZProjectSettings');
    project.widgets_values_named.root_directory = PLACEHOLDER; project.widgets_values = Object.values(project.widgets_values_named);
    for (const graph of [portable.photoGraph, portable.gameGraph]) {
      for (const node of graph.nodes) if (node.type !== 'MarkdownNote') node.mode = 2;
      const note = graph.nodes.find(node => node.type === 'MarkdownNote');
      note.widgets_values[0] = '# MUTED REVIEW TEMPLATE\n\nPrepare a new run with node comfyui/tools/prepare-phone-photo-demo.cjs --out output/phone-photo-demo/<fresh-run>. Open the prepared phase1/phase2 UI files; this review template cannot queue model calls.\n\n' + note.widgets_values[0];
    }
    write(path.join(ROOT, 'comfyui/workflows/phone-photo-demo/01-invent-phone-photos.json'), portable.photoGraph);
    write(path.join(ROOT, 'comfyui/workflows/phone-photo-demo/02-photos-to-game.json'), portable.gameGraph);
  }
  return prepared.plan;
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check-live-prices') { options.checkLivePrices = true; continue; }
    if (args[index] === '--templates') { options.templates = true; continue; }
    if (!['--out', '--config', '--server'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node comfyui/tools/prepare-phone-photo-demo.cjs [--out output/phone-photo-demo/<fresh-run>] [--config JSON] [--server URL] [--check-live-prices] [--templates]');
    options[args[index] === '--config' ? 'configPath' : args[index].slice(2)] = args[++index];
  }
  prepare(options).then(plan => console.log(JSON.stringify({ directory: plan.directory, bundle: plan.bundle, total: plan.total, references: plan.references.map(job => ({ id: job.id, localFile: job.localFile, uploadFilename: job.uploadFilename })) }, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validateConfig, referenceJobs, makePhotoGraph, buildRun, freshDirectory, prepare };
