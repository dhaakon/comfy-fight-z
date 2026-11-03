// Prepare separately saved cloud narration clips. Never submit a model request.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUT = 'output/explainer/20261103';
const DEFAULT_CONFIG = 'comfyui/config/explainer.json';
const RATE = 0.1144;
const RUN_FILES = ['storyboard.json', 'workflow.json', 'workflow.api.json', 'plan.json', 'voice-price-badge.json', 'narration.txt'];
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
};
const words = text => text.trim().split(/\s+/).length;
const requestText = (config, scene) => `${config.voice.deliveryTag}\n${scene.narration}`;

function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertPlainDirectory(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const stat = statIfPresent(current);
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Explainer directories cannot contain symbolic links, junctions or files: ${current}`);
      const actual = fs.realpathSync(current);
      const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
      if (normalize(actual) !== normalize(current)) throw new Error(`Explainer directory is redirected: ${current}`);
    }
    if (path.dirname(current) === current) break;
  }
}

function assertFreshRun(directory) {
  assertPlainDirectory(directory);
  for (const filename of RUN_FILES) if (statIfPresent(path.join(directory, filename))) {
    throw new Error(`Run already contains ${filename}; use a fresh output/explainer/ run to preserve prepared or approved narration.`);
  }
}

function validateCatalog(schemas, config) {
  for (const name of ['ElevenLabsTextToSpeech', 'ElevenLabsVoiceSelector', 'SaveAudioAdvanced']) if (!schemas[name]) throw new Error(`Required node is missing: ${name}`);
  const badge = schemas.ElevenLabsTextToSpeech.price_badge;
  const rate = badge?.expr?.match(/\bwidgets\.model\s*=\s*["']eleven_v4["']\s*\?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!rate || Number(rate[1]) !== RATE || !badge.expr.includes('/1K chars')) throw new Error('Live voice pricing changed; review the current rate before preparing.');
  const presets = schemas.ElevenLabsVoiceSelector.input?.required?.voice?.[1]?.options;
  if (!Array.isArray(presets) || !presets.includes(config.voice.preset)) throw new Error(`Stock voice unavailable: ${config.voice.preset}`);
  return badge;
}

function validateConfig(config) {
  if (config.schema !== 'comfy-fighter-explainer/v1' || config.width !== 1920 || config.height !== 1080 || config.fps !== 30) throw new Error('Expected a 1920x1080, 30fps Comfy Fighter Z explainer.');
  if (!Array.isArray(config.scenes) || config.scenes.length !== 12) throw new Error('The explainer requires twelve separately narrated scenes.');
  if (config.voice.model !== 'eleven_v4' || config.voice.saveFormat !== 'flac') throw new Error('This estimate and workflow require Eleven v4 with FLAC saves.');
  const ids = new Set();
  for (const [index, scene] of config.scenes.entries()) {
    if (!new RegExp(`^${String(index + 1).padStart(2, '0')}-[a-z-]+$`).test(scene.id) || ids.has(scene.id)) throw new Error(`Invalid ordered scene ID: ${scene.id}`);
    ids.add(scene.id);
    if (typeof scene.narration !== 'string' || !scene.narration.trim() || /[\[\]]/.test(scene.narration)) throw new Error(`Scene ${scene.id} needs spoken text without delivery tags.`);
    if (scene.audio !== `audio/${scene.id}.flac` || !/^(cards|captures)\/[a-z0-9-]+\.webm$/.test(scene.visual)) throw new Error(`Invalid relative media mapping for ${scene.id}.`);
    if (requestText(config, scene).length > 10000) throw new Error(`Scene ${scene.id} exceeds the provider text limit.`);
  }
  const count = config.scenes.reduce((sum, scene) => sum + words(scene.narration), 0);
  if (count < 350 || count > 420) throw new Error(`Expected 350–420 spoken words; found ${count}.`);
  return count;
}

function makeNarrationWorkflow(config, filenameRoot) {
  validateConfig(config);
  const nodes = [], links = [], prompt = {}, clips = [];
  let nextNode = 1, nextLink = 1;
  function node(type, title, named, position, inputs, outputs) {
    const value = { id: nextNode++, type, title, pos: position, size: [460, 280], flags: {}, order: nodes.length, mode: 0,
      inputs, outputs, properties: { 'Node name for S&R': type }, widgets_values: Object.values(named), widgets_values_named: named };
    nodes.push(value);
    const apiInputs = { ...named }; delete apiInputs.control_after_generate;
    prompt[value.id] = { class_type: type, inputs: apiInputs, _meta: { title } };
    return value;
  }
  function connect(from, to, type) {
    const id = nextLink++;
    from.outputs[0].links.push(id); to.inputs[0].link = id;
    links.push([id, from.id, 0, to.id, 0, type]);
    prompt[to.id].inputs[to.inputs[0].name] = [String(from.id), 0];
  }
  const voice = node('ElevenLabsVoiceSelector', 'Stock Brian narrator | no voice cloning', { voice: config.voice.preset }, [-510, 50], [], [{ name: 'voice', type: 'ELEVENLABS_VOICE', links: [] }]);
  voice.size = [420, 140];
  config.scenes.forEach((scene, index) => {
    const text = requestText(config, scene), filenamePrefix = `${filenameRoot}/${scene.id}`;
    const generation = node('ElevenLabsTextToSpeech', `${scene.id} | ${scene.title}`, {
      text, stability: config.voice.stability, apply_text_normalization: 'auto', model: config.voice.model,
      'model.similarity_boost': config.voice.similarityBoost, language_code: config.voice.languageCode,
      seed: config.voice.seed + index, control_after_generate: 'fixed', output_format: config.voice.outputFormat
    }, [0, index * 400], [{ name: 'voice', type: 'ELEVENLABS_VOICE', link: null }], [{ name: 'AUDIO', type: 'AUDIO', links: [] }]);
    generation.size = [520, 350];
    const save = node('SaveAudioAdvanced', `Save separate narration | ${scene.id}`, { filename_prefix: filenamePrefix, format: 'flac' }, [590, index * 400],
      [{ name: 'audio', type: 'AUDIO', link: null }], [{ name: 'audio', type: 'AUDIO', links: [] }]);
    save.size = [420, 180];
    connect(voice, generation, 'ELEVENLABS_VOICE'); connect(generation, save, 'AUDIO');
    clips.push({ id: scene.id, title: scene.title, narration: scene.narration, providerText: text,
      spokenWords: words(scene.narration), billedCharacters: text.length, estimatedUSD: Number((text.length * RATE / 1000).toFixed(9)),
      ttsNodeId: String(generation.id), saveNodeId: String(save.id), filenamePrefix, downloadPattern: `${scene.id}_*.flac`,
      localAudio: scene.audio, visual: scene.visual, targetSeconds: scene.targetSeconds });
  });
  const characters = clips.reduce((sum, clip) => sum + clip.billedCharacters, 0), estimate = characters * RATE / 1000;
  nodes.push({ id: nextNode++, type: 'MarkdownNote', title: 'Twelve separately saved narration scenes', pos: [-510, -390], size: [1490, 350], flags: {}, order: nodes.length, mode: 0, inputs: [], outputs: [], properties: {},
    widgets_values: [`# Comfy Fighter Z: 1080p explainer narration\n\n12 paid Eleven v4 calls using the stock Brian voice. ${characters} input characters including delivery tags and punctuation; estimated $${estimate.toFixed(6)} at $${RATE}/1,000 characters. No music, voice cloning, input audio or image generation. No automatic paid retries.\n\nEach Save Audio node writes one FLAC beneath ComfyUI's configured output/${filenameRoot}/ directory. Fetch the twelve outputs, then place each scene at the audio/<scene-id>.flac path in the storyboard. Measure actual clip durations when editing; storyboard timings are estimates.\n\nPreparing or validating this graph spends nothing. Submit only after explicit approval of this narration batch.`] });
  const digest = createHash('sha256').update(`comfy-fighter-explainer-${filenameRoot}`).digest('hex');
  const workflow = { id: `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`, revision: 0,
    last_node_id: nextNode - 1, last_link_id: nextLink - 1, nodes, links, groups: [], config: {}, extra: { ds: { scale: 0.42, offset: [570, 430] } }, version: 0.4 };
  return { workflow, prompt, clips };
}

async function prepare({ configPath = DEFAULT_CONFIG, out = DEFAULT_OUT, server = 'http://127.0.0.1:8188' } = {}) {
  const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, configPath), 'utf8'));
  const spokenWords = validateConfig(config), directory = path.resolve(ROOT, out), outputRoot = path.resolve(ROOT, 'output/explainer');
  if (!directory.startsWith(outputRoot + path.sep)) throw new Error('Explainer artifacts must stay in a run folder under output/explainer/.');
  const runName = path.basename(directory);
  if (!/^[a-zA-Z0-9_-]+$/.test(runName)) throw new Error('Use a filename-safe explainer run name.');
  assertFreshRun(directory);
  const schemas = {};
  for (const name of ['ElevenLabsTextToSpeech', 'ElevenLabsVoiceSelector', 'SaveAudioAdvanced']) {
    const response = await fetch(`${server.replace(/\/$/, '')}/object_info/${name}`);
    if (!response.ok) throw new Error(`Cannot read live ${name} schema.`);
    const object = await response.json(); schemas[name] = object[name];
    if (!schemas[name]) throw new Error(`Required node is missing: ${name}`);
  }
  const badge = validateCatalog(schemas, config);
  const { workflow, prompt, clips } = makeNarrationWorkflow(config, `comfy-fighter-z/explainer/${runName}`);
  const billedCharacters = clips.reduce((sum, clip) => sum + clip.billedCharacters, 0);
  const plan = { schema: 'comfy-fighter-explainer-plan/v1', preparedAt: new Date().toISOString(), cloudOnly: true,
    generationSubmitted: false, requiresSpendingAuthorization: true, automaticPaidRetries: 0,
    voice: config.voice.preset, model: config.voice.model, paidClips: clips.length, spokenWords, billedCharacters,
    rateUSDPerThousandCharacters: RATE, estimatedUSD: Number((billedCharacters * RATE / 1000).toFixed(9)),
    estimateSource: 'Live installed ElevenLabsTextToSpeech price_badge. Count includes exact provider text, tags, spaces and punctuation; actual provider billing may vary.',
    targetDurationSeconds: config.targetDurationSeconds, estimatedSpokenSeconds: Number((spokenWords / config.narrationWordsPerMinute * 60).toFixed(2)),
    localRun: path.relative(ROOT, directory).replaceAll('\\', '/'), workflow: 'workflow.json', apiWorkflow: 'workflow.api.json',
    downloadDirectory: 'narration', canonicalAudioDirectory: 'audio', clips };
  assertFreshRun(directory);
  write(path.join(directory, 'storyboard.json'), config);
  write(path.join(directory, 'workflow.json'), workflow);
  write(path.join(directory, 'workflow.api.json'), prompt);
  write(path.join(directory, 'plan.json'), plan);
  write(path.join(directory, 'voice-price-badge.json'), { checkedAt: plan.preparedAt, node: 'ElevenLabsTextToSpeech', price_badge: badge });
  fs.writeFileSync(path.join(directory, 'narration.txt'), config.scenes.map(scene => `${scene.id} | ${scene.title}\n${scene.narration}`).join('\n\n') + '\n', { flag: 'wx' });
  const reusable = path.join(ROOT, 'comfyui/workflows/audio/explainer-narration.json');
  if (!statIfPresent(reusable)) { assertPlainDirectory(path.dirname(reusable)); write(reusable, workflow); }
  console.log(JSON.stringify({ directory, paidClips: plan.paidClips, spokenWords, billedCharacters, estimatedUSD: plan.estimatedUSD, submitted: false }, null, 2));
  return plan;
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--config', '--out', '--server'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node comfyui/tools/prepare-explainer.cjs [--config <json>] [--out output/explainer/<run>] [--server <ComfyUI URL>]');
    options[args[index] === '--config' ? 'configPath' : args[index].slice(2)] = args[index + 1];
  }
  prepare(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validateConfig, requestText, makeNarrationWorkflow, assertPlainDirectory, assertFreshRun, validateCatalog, prepare };
