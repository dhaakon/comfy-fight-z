// Prepare a complete cloud-only example; never submit generation or replace a game.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomInt } = require('node:crypto');
const { makeFactoryGraph, factoryCounts } = require('../comfyui/tools/prepare-factory-workflows.cjs');
const { makeAudioJobs, makeAudioGraph } = require('../comfyui/tools/prepare-audio-workflows.cjs');
const { assertPlainDirectory } = require('../comfyui/tools/prepare-explainer.cjs');
const ROOT = path.resolve(__dirname, '..');
const PLACEHOLDER = '__CFZ_EXAMPLE_BUNDLE_ROOT__';
const RATES = Object.freeze({ image1K: .048048, image2K: .072072, musicSecond: .0025, effectMinute: .14, speechThousandCharacters: .1144 });
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const round = number => Number(number.toFixed(9));

function validateConfig(config) {
  if (config.exampleSchema !== 'comfy-fighter-example/v1' || config.demoSource !== 'fictional-text-only') throw new Error('Expected a fictional Comfy Fighter Z example configuration.');
  if (config.model !== 'Gemini Nano Banana 2.1') throw new Error('The example estimate requires Gemini Nano Banana 2.1.');
  const bosses = (config.fighters || []).filter(fighter => fighter.boss);
  if (config.fighters?.length !== 7 || bosses.length !== 1 || !config.fighters[6].boss || config.stages?.length !== 3 || config.stages.some(stage => !stage.enabled) || config.stages[0].id !== 'yard') throw new Error('The example requires six fighters, a final boss in the last slot and three enabled environments with The Yard first.');
  const ids = new Set();
  for (const item of [...config.fighters, ...config.stages]) {
    if (!/^[a-z][a-z0-9_-]*$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate example ID: ${item.id}`);
    ids.add(item.id);
    if (item.sourceMode !== 'Invent fictional reference' || item.sourceImage || item.sourceInput || item.acceptedReferenceInput) throw new Error('The example only accepts text-only invented references with empty image selectors.');
  }
  for (const fighter of config.fighters) if (!fighter.description?.trim() || !fighter.specialMove?.name?.trim() || !fighter.specialMove?.description?.trim() || !fighter.introTagline?.trim() || !fighter.introVoice?.trim()) throw new Error(`Complete the description, special and introduction for ${fighter.id}.`);
  for (const fighter of config.fighters) if (!fighter.style || !fighter.superMove?.name?.trim() || !fighter.superMove?.description?.trim() || !fighter.winQuote?.trim() || !fighter.ending?.trim()) throw new Error(`Complete the arcade style, super, win quote and ending for ${fighter.id}.`);
  const canonical = read(path.join(ROOT, 'comfyui/config/game.json'));
  if (JSON.stringify(config.sheets) !== JSON.stringify(canonical.sheets)) throw new Error('Preserve the game\'s three standard 3x3 pose layouts.');
  if (JSON.stringify(config.extraSheets) !== JSON.stringify(canonical.extraSheets)) throw new Error('Keep the optional sheetD/sheetE arcade layouts for the complete example.');
  return config;
}

function makeApiPrompt(workflow) {
  const links = new Map(workflow.links.map(link => [link[0], link]));
  const prompt = {};
  for (const node of workflow.nodes) {
    if (node.type === 'MarkdownNote') continue;
    if (!node.widgets_values_named && node.widgets_values?.length) throw new Error(`No named widget mapping for ${node.type}.`);
    const inputs = { ...node.widgets_values_named };
    delete inputs.control_after_generate;
    for (const input of node.inputs || []) if (input.link !== null && input.link !== undefined) {
      const link = links.get(input.link);
      if (!link) throw new Error(`Missing link ${input.link}.`);
      inputs[input.name] = [String(link[1]), link[2]];
    }
    prompt[node.id] = { class_type: node.type, inputs, _meta: { title: node.title || node.type } };
  }
  return prompt;
}

function buildExample(input, bundleRoot, options = {}) {
  validateConfig(input);
  return buildCombinedGame(input, bundleRoot, options);
}

// Composition is reusable after a caller validates its own reference policy.
// The public example wrapper above continues to require text-only sources.
function buildCombinedGame(input, bundleRoot, { seed = 20261103, preparedAt = new Date().toISOString() } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Seed must be a nonnegative safe integer.');
  const config = structuredClone(input);
  config.assetRoot = bundleRoot;
  const game = { ...config, stages: config.stages.filter(stage => stage.enabled) };
  const jobs = makeAudioJobs(game), image = factoryCounts(config);
  const templates = Object.fromEntries(['music', 'sfx', 'voice'].map(key => [key, read(path.join(ROOT, `comfyui/workflows/templates/cloud-${key}.json`))]));
  const workflow = makeFactoryGraph(config);
  const project = workflow.nodes.find(node => node.type === 'CFZProjectSettings');
  project.widgets_values_named.root_directory = bundleRoot;
  project.widgets_values_named.seed = seed;
  project.widgets_values = Object.values(project.widgets_values_named);
  const audio = makeAudioGraph(jobs, game, templates, { rootDirectory: bundleRoot, title: 'Complete example: music, calls, effects and fighter introductions' });
  const audioRoot = audio.nodes.find(node => node.type === 'CFZAssetRoot');
  const audioConfig = JSON.parse(audioRoot.widgets_values[1]);
  delete audioConfig.assetRoot;
  audioRoot.type = 'CFZProjectAudioRoot';
  audioRoot.title = 'Audio follows the same Project Settings folder';
  audioRoot.properties = { 'Node name for S&R': audioRoot.type };
  audioRoot.inputs = [{ name: 'project', type: 'CFZ_PROJECT', link: null }];
  audioRoot.widgets_values_named = { audio_config: JSON.stringify(audioConfig, null, 2) };
  audioRoot.widgets_values = Object.values(audioRoot.widgets_values_named);
  for (const node of audio.nodes) {
    if (node.type === 'CFZSaveAudio') node.widgets_values_named = { asset_json: node.widgets_values[0] };
    if (node.widgets_values_named && 'seed' in node.widgets_values_named) {
      node.widgets_values_named.seed = seed + node.id;
      node.widgets_values = Object.values(node.widgets_values_named);
    }
  }
  const nodeOffset = workflow.last_node_id, linkOffset = workflow.last_link_id;
  for (const node of audio.nodes) {
    node.id += nodeOffset;
    for (const input of node.inputs || []) if (input.link !== null) input.link += linkOffset;
    for (const output of node.outputs || []) if (Array.isArray(output.links)) output.links = output.links.map(link => link + linkOffset);
  }
  for (const link of audio.links) { link[0] += linkOffset; link[1] += nodeOffset; link[3] += nodeOffset; }
  workflow.nodes.push(...audio.nodes);
  workflow.links.push(...audio.links);
  workflow.last_node_id = Math.max(...workflow.nodes.map(node => node.id));
  workflow.last_link_id = Math.max(...workflow.links.map(link => link[0]));
  const rootLink = ++workflow.last_link_id;
  project.outputs[0].links.push(rootLink); audioRoot.inputs[0].link = rootLink;
  workflow.links.push([rootLink, project.id, 0, audioRoot.id, 0, 'CFZ_PROJECT']);

  // Keep the six character factories at the left; audio rows are grouped by use.
  audioRoot.pos = [2220, 140]; audioRoot.size = [450, 390];
  const audioExporter = audio.nodes.find(node => node.type === 'CFZExportAudioManifest');
  audioExporter.pos = [5300, 220];
  let voiceIndex = 0;
  for (const node of audio.nodes) if (node.type === 'ElevenLabsVoiceSelector') {
    node.pos = [2220, 620 + voiceIndex++ * 180]; node.size = [450, 145];
  }
  jobs.forEach((job, index) => {
    const column = Math.floor(index / 8), row = index % 8;
    const generation = audio.nodes.find(node => node.title === `${job.id} | cloud audio`);
    const save = audio.nodes.find(node => node.title === `Save + map ${job.id}`);
    generation.pos = [2750 + column * 840, 170 + row * 570]; generation.size = [450, 320];
    save.pos = [2750 + column * 840, 505 + row * 570]; save.size = [450, 185];
  });
  audioExporter.pos = [5330, 170];
  const voiceCharacters = jobs.filter(job => job.category === 'voice').reduce((sum, job) => sum + job.prompt.length, 0);
  const musicSeconds = jobs.filter(job => job.category === 'music').reduce((sum, job) => sum + job.duration, 0);
  const effectsSeconds = jobs.filter(job => job.category === 'sfx').reduce((sum, job) => sum + job.duration, 0);
  const audioCost = round(musicSeconds * RATES.musicSecond + effectsSeconds * RATES.effectMinute / 60 + voiceCharacters * RATES.speechThousandCharacters / 1000);
  const total = round(image.estimatedUSD + audioCost);
  const notes = workflow.nodes.filter(node => node.type === 'MarkdownNote');
  const poseCount = Object.values({ ...config.sheets, ...(config.extraSheets || {}) }).flat().length;
  const counts = category => jobs.filter(job => job.category === category).length;
  notes[0].widgets_values = [`# Comfy Fighter Z: complete arcade example\n\nONE WORKFLOW: ${image.paidImages} fresh cloud images + ${jobs.length} cloud audio clips, estimated $${total.toFixed(2)}. Six fictional fighters plus a final boss, ${config.fighters.length * poseCount} poses, ${game.stages.length} arenas, ending art, menu art, UI/effects, music, announcer calls and fighter voices. No external image files, real photos, local model weights or opening film.\n\nRun node example/prepare.cjs --out output/example/<fresh-name> to fill your local output folder, then open that run's workflow.json. Edit example/config.json and prepare a new run to keep image and audio descriptions synchronized. Validate and approve the exact cloud spend before queueing. No automatic paid retries.`];
  notes[1].widgets_values = ['## One shared output folder\n\nProject Settings supplies the folder to both exporters. The run writes bundle/assets.json, bundle/audio.json and their raw/ media. All three arenas are enabled; The Yard also supplies the title and select venue.\n\nReview every fighter sheet and audition the audio. The builder loads the complete bundle and exports a strict self-contained game. A graph is a recipe, not generated artwork.'];
  notes[2].widgets_values = [`# Included audio: ${jobs.length} clips\n\n${counts('music')} music tracks (Sonilo), ${counts('sfx')} effects (ElevenLabs SFX) and ${counts('voice')} announcer and fighter lines (Eleven v4 stock voices). The audio root is linked to Project Settings; there is no second directory to edit.\n\nAudio source files are PCM WAVs. audio.json is exported after all tracks finish. Costs are estimates; actual billing varies.`];
  notes[2].pos = [2220, -270]; notes[2].size = [3550, 290];
  workflow.groups.push({ id: 4, title: 'Complete audio: music, impacts, calls and introductions', bounding: [2190, 65, 3610, 4730], color: '#745b88', font_size: 26, flags: {} });
  workflow.nodes.forEach((node, index) => node.order = index);
  workflow.extra.ds = { scale: .19, offset: [580, 350] };
  workflow.extra.cfzExample = { schema: 'comfy-fighter-example/v1', paidImages: image.paidImages, paidAudioClips: jobs.length, assetRoot: bundleRoot };
  const digest = createHash('sha256').update(`comfy-fighter-example:${bundleRoot}:${seed}`).digest('hex');
  workflow.id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const prompt = makeApiPrompt(workflow);
  const plan = {
    schema: 'comfy-fighter-example-plan/v1', title: config.title, preparedAt, seed,
    cloudOnly: true, generationSubmitted: false, requiresSpendingAuthorization: true, automaticPaidRetries: 0,
    source: 'All source references are invented from text inside this workflow. No uploaded photos or earlier media are loaded.',
    fighters: config.fighters.map(fighter => fighter.id), enabledStages: game.stages.map(stage => stage.id), disabledStages: config.stages.filter(stage => !stage.enabled).map(stage => stage.id),
    expectedAssets: image.mappedAssets, expectedAudio: jobs.length, runtimePoses: config.fighters.length * poseCount,
    image: { ...image, model: config.model, thinkingLevel: 'MINIMAL' },
    audio: { paidClips: jobs.length, musicClips: counts('music'), musicSeconds, effectsClips: counts('sfx'), effectsSeconds, voiceClips: counts('voice'), voiceCharacters, estimatedUSD: audioCost },
    total: { paidImages: image.paidImages, paidAudioClips: jobs.length, estimatedUSD: total }, rates: RATES,
    priceStatus: 'Snapshot estimate; live price check not requested. Validate current pricing before a paid submission.',
    estimateNote: 'Installed ComfyUI price badges; actual provider billing may vary. No paid retries or video generation included.',
    workflow: 'workflow.json', apiWorkflow: 'workflow.api.json', bundle: bundleRoot,
    manifests: ['bundle/assets.json', 'bundle/audio.json'], audioIds: jobs.map(job => job.id),
    audioJobs: jobs.map(job => ({ ...job, billedCharacters: job.category === 'voice' ? job.prompt.length : undefined }))
  };
  return { workflow, prompt, plan, config };
}

function checkPrices(catalog) {
  const expr = name => { const value = catalog[name]?.price_badge?.expr; if (typeof value !== 'string') throw new Error(`Missing live price badge: ${name}`); return value; };
  const image = expr('GeminiNanoBanana2V2');
  const imageTable = image.match(/\$image\s*:=\s*(\{[^}]+\})/)?.[1];
  const thinkingTable = image.match(/\$thinking\s*:=\s*(\{[^}]+\})/)?.[1];
  if (!image.includes('banana 2.1') || !imageTable || JSON.parse(imageTable)['1k'] !== RATES.image1K || JSON.parse(imageTable)['2k'] !== RATES.image2K || !thinkingTable || JSON.parse(thinkingTable).minimal !== 0) throw new Error('Live image pricing changed; review the example estimate.');
  const music = expr('SoniloTextToMusic').match(/"usd"\s*:\s*([\d.]+)\s*\*\s*widgets\.duration/);
  const effects = expr('ElevenLabsTextToSoundEffects');
  const speech = expr('ElevenLabsTextToSpeech');
  if (!music || Number(music[1]) !== RATES.musicSecond) throw new Error('Live music pricing changed; review the example estimate.');
  if (Number(effects.match(/"usd"\s*:\s*([\d.]+)/)?.[1]) !== RATES.effectMinute || !effects.includes('/minute')) throw new Error('Live effects pricing changed; review the example estimate.');
  if (Number(speech.match(/widgets\.model\s*=\s*"eleven_v4"\s*\?\s*([\d.]+)/)?.[1]) !== RATES.speechThousandCharacters || !speech.includes('/1K chars')) throw new Error('Live speech pricing changed; review the example estimate.');
  return Object.fromEntries(Object.entries(catalog).filter(([, value]) => value?.price_badge).map(([name, value]) => [name, value.price_badge]));
}

function makeTemplate(config) {
  const { workflow } = buildExample(config, PLACEHOLDER, { seed: 20261103, preparedAt: '2026-11-03T00:00:00.000Z' });
  for (const node of workflow.nodes) if (node.type !== 'MarkdownNote') node.mode = 2;
  workflow.extra.cfzExample.requiresPreparation = true;
  const note = workflow.nodes.find(node => node.type === 'MarkdownNote');
  note.widgets_values[0] = '# REVIEW TEMPLATE: generation is disabled\n\nRun `npm run example:prepare -- --out output/example/<fresh-name>` to create a runnable copy with your local output folder. Open that run\'s workflow.json. The template deliberately mutes every functional node so opening or queueing an unresolved example cannot start cloud work.\n\n' + note.widgets_values[0];
  note.size = [1940, 410]; note.pos = [-510, -380];
  return workflow;
}

function freshDirectory(out) {
  const directory = path.resolve(ROOT, out), parent = path.join(ROOT, 'output/example');
  if (!directory.startsWith(parent + path.sep)) throw new Error('Use a fresh run directory under output/example/.');
  assertPlainDirectory(directory);
  try { fs.lstatSync(directory); throw new Error('The example run already exists; use a fresh output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return directory;
}

async function prepare({ out = `output/example/run-${new Date().toISOString().replace(/[-:.]/g, '')}`, configPath = 'example/config.json', checkLivePrices = false, server = 'http://127.0.0.1:8188', fetchImpl = fetch } = {}) {
  const directory = freshDirectory(out), config = read(path.resolve(ROOT, configPath));
  const prepared = buildExample(config, path.join(directory, 'bundle'), { seed: randomInt(1, 2 ** 31) });
  let prices;
  if (checkLivePrices) {
    const names = ['GeminiNanoBanana2V2', 'SoniloTextToMusic', 'ElevenLabsTextToSoundEffects', 'ElevenLabsTextToSpeech', 'CFZProjectAudioRoot'];
    const catalog = {};
    for (const name of names) {
      const response = await fetchImpl(`${server.replace(/\/$/, '')}/object_info/${name}`);
      if (!response.ok) throw new Error(`Cannot read installed ${name}; start ComfyUI and install the included pack.`);
      catalog[name] = (await response.json())[name];
      if (!catalog[name]) throw new Error(`Required node is missing: ${name}. Install the included pack and restart ComfyUI.`);
    }
    prices = { checkedAt: new Date().toISOString(), source: 'Live ComfyUI object_info price_badge; read-only check.', rates: RATES, badges: checkPrices(catalog) };
    prepared.plan.priceStatus = 'Live price badges checked; exact workflow still needs MCP validation and explicit spending consent.';
  }
  freshDirectory(directory);
  fs.mkdirSync(path.dirname(directory), { recursive: true }); fs.mkdirSync(directory);
  write(path.join(directory, 'workflow.json'), prepared.workflow);
  write(path.join(directory, 'workflow.api.json'), prepared.prompt);
  write(path.join(directory, 'config.json'), prepared.config);
  write(path.join(directory, 'plan.json'), prepared.plan);
  if (prices) write(path.join(directory, 'prices.json'), prices);
  return { directory, ...prepared.plan };
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check-live-prices') { options.checkLivePrices = true; continue; }
    if (!['--out', '--config', '--server'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node example/prepare.cjs [--out output/example/<fresh-run>] [--config example/config.json] [--check-live-prices] [--server URL]');
    options[args[index] === '--config' ? 'configPath' : args[index].slice(2)] = args[++index];
  }
  prepare(options).then(plan => console.log(JSON.stringify({ directory: plan.directory, bundle: plan.bundle, ...plan.total, priceStatus: plan.priceStatus, generationSubmitted: false }, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { PLACEHOLDER, RATES, validateConfig, makeApiPrompt, buildExample, buildCombinedGame, makeTemplate, checkPrices, freshDirectory, prepare };
