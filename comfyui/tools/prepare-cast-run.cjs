// Prepare a complete new-game run from a cast file without submitting it: every game image for each
// fighter and arena, the shared interface art, the startup media (ensemble, menu and select loops, one
// fight introduction and one select idle loop per fighter) and the full audio set in ONE workflow that
// writes assets.json, audio.json and video.json into <out>/bundle. Sprite sheets are visible nodes so
// comfyui/tools/run-sequential.cjs can pace the run on a one-job workspace.
//   node comfyui/tools/prepare-cast-run.cjs --cast comfyui/casts/<name>.json --out output/test-runs/<fresh-name> [--seed 42] [--no-media] [--no-audio]
// A cast file is a factory configuration (comfy-fighter-cast/v1) that may extend comfyui/config/factory.json
// for the shared art direction and the sheet layout; see comfyui/docs/new-game-runbook.md.
const fs = require('node:fs');
const path = require('node:path');
const { graphBuilder, characterValues, environmentValues, projectValues, attachExporter, attachMedia, mediaCounts, factoryCounts, motion, videoRate, VIDEO_RATES } = require('./prepare-factory-workflows.cjs');
const { makeAudioJobs, makeAudioGraph, attachAudioGraph, INTRO_VOICES } = require('./prepare-audio-workflows.cjs');
const { apiPrompt } = require('./prepare-arcade-expansion.cjs');
const { directoryTarget } = require('../../build/tools/lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const RATES = Object.freeze({ image1K: .048048, image2K: .072072, video: VIDEO_RATES, musicSecond: .0025, effectMinute: .14, speechThousandCharacters: .1144 });
const SHEETS = ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE'], MOTION = ['sheetF', 'sheetG'];
const STYLES = ['balanced', 'grappler', 'speed', 'zoner', 'trickster', 'power', 'boss'];
const INHERITED = ['style', 'uiStyle', 'stageStyle', 'model', 'sheets', 'extraSheets', 'motionSheets'];
const CAST_SCHEMA = 'comfy-fighter-cast/v1';
const ID = /^[a-z][a-z0-9_]{1,23}$/;
const round = value => Number(value.toFixed(6));
const text = (value, min = 1, max = 4000) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

// Cast files keep only what is specific to the game; the art direction and the sheet layout come from the base.
function loadCast(file) {
  const cast = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
  if (cast.castSchema !== CAST_SCHEMA) throw new Error(`Cast files use "castSchema": "${CAST_SCHEMA}".`);
  const base = cast.extends ? read(cast.extends) : {};
  const config = { ...Object.fromEntries(INHERITED.filter(key => base[key] !== undefined).map(key => [key, base[key]])), ...cast };
  validateCast(config);
  return config;
}

function validateCast(config) {
  const fail = message => { throw new Error(`Invalid cast: ${message}`); };
  if (!text(config.title, 2, 40)) fail('title must be 2-40 characters');
  if (config.subtitle !== undefined && !text(config.subtitle, 0, 60)) fail('subtitle must be at most 60 characters');
  for (const key of ['style', 'uiStyle', 'stageStyle', 'model']) if (!text(config[key], 8)) fail(`${key} is missing (set it or extend comfyui/config/factory.json)`);
  try { videoRate(config); } catch (error) { fail(`${error.message} (videoModel: ${Object.keys(VIDEO_RATES).join(' | ')}; videoResolution: 720p | 1080p)`); }
  const layout = read('comfyui/config/game.json');
  if (JSON.stringify(config.sheets) !== JSON.stringify(layout.sheets)) fail('sheets must match comfyui/config/game.json (the 27 required poses)');
  if (JSON.stringify(config.extraSheets) !== JSON.stringify(layout.extraSheets)) fail('extraSheets must match comfyui/config/game.json (the 18 arcade poses)');
  if (config.motionSheets !== undefined && JSON.stringify(config.motionSheets) !== JSON.stringify(layout.motionSheets)) fail('motionSheets must match comfyui/config/game.json (the 18 motion cels) or be omitted');
  const fighters = (config.fighters || []).filter(f => f.enabled !== false), stages = (config.stages || []).filter(s => s.enabled !== false);
  if (fighters.length < 2 || fighters.length > 8) fail('between two and eight enabled fighters');
  if (stages.length < 1 || stages.length > 3) fail('between one and three enabled stages');
  const ids = new Set();
  for (const item of [...fighters, ...stages]) {
    if (!ID.test(item.id || '')) fail(`id "${item.id}" must match ${ID}`);
    if (ids.has(item.id)) fail(`duplicate id ${item.id}`); ids.add(item.id);
    if (!text(item.name, 2, 24)) fail(`${item.id}: name must be 2-24 characters`);
    if (!text(item.description, 80, 1600)) fail(`${item.id}: description must be 80-1600 characters`);
    if ((item.sourceMode || 'Invent fictional reference') !== 'Invent fictional reference' || item.sourceInput || item.sourceImage) fail(`${item.id}: cast runs invent every reference from text; remove sourceMode/sourceInput/sourceImage`);
  }
  if (fighters.filter(f => f.boss).length > 1) fail('at most one final boss');
  for (const f of fighters) {
    if (!/^#[0-9a-f]{6}$/i.test(f.color || '')) fail(`${f.id}: color must be a #rrggbb value`);
    if (!text(f.specialMove?.name, 2, 32) || !text(f.specialMove?.description, 40, 800)) fail(`${f.id}: specialMove needs a name and a 40-800 character description`);
    if (f.superMove && (!text(f.superMove.name, 2, 32) || !text(f.superMove.description, 20, 800))) fail(`${f.id}: superMove needs a name and a 20-800 character description`);
    if (f.style !== undefined && !STYLES.includes(f.style)) fail(`${f.id}: style must be one of ${STYLES.join(', ')}`);
    if (f.boss && f.style && f.style !== 'boss') fail(`${f.id}: the final boss uses style "boss"`);
    if (f.introTagline !== undefined && !text(f.introTagline, 4, 120)) fail(`${f.id}: introTagline must be 4-120 characters`);
    if (f.introVoice !== undefined && !INTRO_VOICES.includes(f.introVoice)) fail(`${f.id}: introVoice must be one of ${INTRO_VOICES.join(', ')}`);
    if (f.winQuote !== undefined && !text(f.winQuote, 4, 160)) fail(`${f.id}: winQuote must be 4-160 characters`);
    if (f.ending !== undefined && !text(f.ending, 40, 1200)) fail(`${f.id}: ending must be 40-1200 characters`);
    // Satire casts (publicFigures) caricature real public figures from text; every other cast stays invented.
    if (!config.publicFigures && /\b(real|actual)\s+(person|politician|senator|governor)\b|caricature of/i.test(f.description)) fail(`${f.id}: fighters are invented; do not describe real people (set "publicFigures": true only for a satire cast)`);
    if (config.publicFigures && !text(f.fullName, 4, 60)) fail(`${f.id}: a satire cast names the public figure in fullName`);
  }
  if (config.publicFigures && !text(config.about, 120, 3000)) fail('a satire cast documents its subjects and sources in "about"');
}

function buildCast(config, bundleRoot, { seed = 42, media = true, audio = true, label = 'cast run' } = {}) {
  validateCast(config);
  const fighters = config.fighters.filter(f => f.enabled !== false), stages = config.stages.filter(s => s.enabled !== false);
  const game = { ...config, fighters, stages };
  const b = graphBuilder(`${config.title} / ${config.subtitle || ''}: ${label}`);
  const project = b.node('CFZProjectSettings', `Project settings | ${label}`, { ...projectValues(config), root_directory: bundleRoot, seed }, [-510, 120], [450, 470]);
  const bundles = [];
  const characters = fighters.map((fighter, i) => {
    // Internal sheets off: five visible sheet nodes reuse the identity, so the factory runs at most four art calls at once.
    const character = b.node('CFZCharacterFactory', `Character ${i + 1} | ${fighter.name}`, characterValues({ ...fighter, sourceMode: 'Invent fictional reference' }, false, true, motion(config)), [0, 120 + i * 1250], [440, 720]);
    b.connect(project, 0, character, 'project'); bundles.push(character);
    // Sheets B-E take sheet A as a second reference so scale, line weight and facing stay consistent.
    let first = null;
    [...SHEETS, ...(motion(config) ? MOTION : [])].forEach((sheet, j) => {
      const node = b.node('CFZSpriteSheet', `${fighter.name} | sheet ${'ABCDEFG'[j]}`, { sheet }, [490, 120 + i * 1250 + j * 235], [420, 170]);
      b.connect(project, 0, node, 'project'); b.connect(character, 2, node, 'character'); b.connect(character, 1, node, 'reference'); bundles.push(node);
      if (first) b.connect(first, 1, node, 'reference_sheet'); else first = node;
    });
    return character;
  });
  const environments = stages.map((stage, i) => {
    const environment = b.node('CFZEnvironmentFactory', `Environment | ${stage.name}`, environmentValues({ ...stage, sourceMode: 'Invent fictional reference', enabled: true }), [0, 120 + fighters.length * 1250 + i * 600], [440, 540]);
    b.connect(project, 0, environment, 'project'); bundles.push(environment);
    return environment;
  });
  const shared = b.node('CFZSharedArtFactory', 'Shared art | menus, logo, HUD + effects', {}, [980, 120], [440, 160]);
  b.connect(project, 0, shared, 'project'); b.connect(environments[0], 1, shared, 'stage_reference'); bundles.push(shared);
  if (media) bundles.push(attachMedia(b, project, characters, fighters, environments[0], [1500, 120], shared));
  attachExporter(b, project, bundles, [980, 380], true);
  let jobs = [];
  if (audio) {
    const templates = Object.fromEntries(['music', 'sfx', 'voice'].map(key => [key, read(`comfyui/workflows/templates/cloud-${key}.json`)]));
    jobs = makeAudioJobs(game);
    const clips = makeAudioGraph(jobs, game, templates, { rootDirectory: bundleRoot, title: `${config.title}: music, calls, effects and fighter lines` });
    attachAudioGraph(b.graph, project, clips, { seed });
    jobs.forEach((job, index) => {
      const generation = b.graph.nodes.find(node => node.title === `${job.id} | cloud audio`), save = b.graph.nodes.find(node => node.title === `Save + map ${job.id}`);
      generation.pos = [2600 + Math.floor(index / 8) * 500, 120 + (index % 8) * 420]; save.pos = [generation.pos[0], generation.pos[1] + 250];
    });
  }
  b.note(`# ${config.title}${config.subtitle ? ' / ' + config.subtitle : ''}: ${label}\n\n${fighters.map(f => f.name).join(', ')} in ${stages.map(s => s.name).join(', ')}: every game image${media ? ', the startup ensemble, the menu and select loops, one fight introduction and one select idle loop per fighter' : ''}${audio ? ` and ${jobs.length} audio clips` : ''}, written to one bundle folder. **CLOUD ONLY / PAID.** Validate and approve the spend before queueing; on a one-job workspace run the API file with comfyui/tools/run-sequential.cjs.`, [-510, -260], [1940, 220]);
  b.graph.nodes.forEach((node, index) => { node.order = index; });
  // Paid calls: per fighter a text source, identity, portrait, hero, cut-in and ending (1K) and five 2K sheets;
  // per arena a 2K source and stage; six 1K interface images and the 2K effects atlas; then the startup media.
  const art = factoryCounts(game, true), startup = media ? mediaCounts(game) : { oneK: 0, twoK: 0, clips: 0, videoSeconds: 0, mappedAssets: 0, videoUSD: 0 };
  const oneK = art.oneK + startup.oneK, twoK = art.twoK + startup.twoK;
  const musicSeconds = jobs.filter(job => job.category === 'music').reduce((sum, job) => sum + job.duration, 0);
  const effectsSeconds = jobs.filter(job => job.category === 'sfx').reduce((sum, job) => sum + job.duration, 0);
  const voiceCharacters = jobs.filter(job => job.category === 'voice').reduce((sum, job) => sum + job.prompt.length, 0);
  const imageUSD = round(oneK * RATES.image1K + twoK * RATES.image2K), videoUSD = startup.videoUSD;
  const audioUSD = round(musicSeconds * RATES.musicSecond + effectsSeconds * RATES.effectMinute / 60 + voiceCharacters * RATES.speechThousandCharacters / 1000);
  const plan = {
    schema: 'comfy-fighter-cast-plan/v1', cloudOnly: true, generationSubmitted: false, requiresSpendingAuthorization: true,
    title: config.title, subtitle: config.subtitle || '', fighters: fighters.map(f => f.id), stages: stages.map(s => s.id), bundle: bundleRoot,
    source: 'Fresh text-only fictional designs; no image files loaded.',
    images: { paidImages: oneK + twoK, oneK, twoK, mappedAssets: art.mappedAssets + startup.mappedAssets, estimatedUSD: imageUSD },
    videos: media ? { clips: startup.clips, seconds: startup.videoSeconds, model: startup.videoModel, resolution: startup.videoResolution, ratePerSecond: startup.videoRate, estimatedUSD: videoUSD } : null,
    audio: audio ? { clips: jobs.length, musicSeconds, effectsSeconds, voiceCharacters, estimatedUSD: audioUSD } : null,
    total: { estimatedUSD: round(imageUSD + videoUSD + audioUSD) }, rates: RATES, runtimePoses: fighters.length * 45,
    next: ['Validate workflow.api.json against the running ComfyUI (every CFZ node must be installed).',
      'Approve the spend, then run: node build/tools/new-game.cjs run --run <out> --approve-usd <total>',
      'Review every sheet and clip (node build/tools/new-game.cjs review --run <out>), then export and install the bundle.']
  };
  return { workflow: b.graph, prompt: apiPrompt(b.graph), plan, game };
}

function prepare({ cast, out, seed = 42, media = true, audio = true }) {
  if (!cast) throw new Error('Use --cast comfyui/casts/<name>.json.');
  const directory = path.resolve(ROOT, out || ''), runs = path.join(ROOT, 'output/test-runs') + path.sep;
  if (!out || !directory.startsWith(runs)) throw new Error('Use --out output/test-runs/<fresh-name>.');
  if (directoryTarget(directory) !== path.join(fs.realpathSync(ROOT), path.relative(ROOT, directory))) throw new Error('Run directory is redirected.');
  if (fs.existsSync(directory)) throw new Error('Choose a new run directory; existing runs are preserved.');
  const config = loadCast(cast);
  const { workflow, prompt, plan } = buildCast(config, path.join(directory, 'bundle'), { seed: Number(seed), media, audio });
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of [['workflow.json', workflow], ['workflow.api.json', prompt], ['plan.json', plan], ['cast.json', config]]) fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  return { directory, plan };
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--no-media') options.media = false;
      else if (args[i] === '--no-audio') options.audio = false;
      else if (['--cast', '--out', '--seed'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = args[++i];
      else throw new Error('Usage: node comfyui/tools/prepare-cast-run.cjs --cast comfyui/casts/<name>.json --out output/test-runs/<fresh-name> [--seed 42] [--no-media] [--no-audio]');
    }
    const { directory, plan } = prepare(options);
    console.log(JSON.stringify({ directory, ...plan.total, images: plan.images.paidImages, clips: plan.videos?.clips || 0, audio: plan.audio?.clips || 0, generationSubmitted: false }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildCast, loadCast, validateCast, prepare, RATES, STYLES, CAST_SCHEMA };
