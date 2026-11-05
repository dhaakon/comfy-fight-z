// Prepare a complete two-fighter game run without submitting it: every game image, the startup
// ensemble, a looping menu video, a looping select-screen video, two fight introductions, two select-screen idle loops and the full audio set in ONE workflow
// that writes assets.json, audio.json and video.json into <out>/bundle. Sprite sheets are visible
// nodes so comfyui/tools/run-sequential.cjs can pace the run on a one-job workspace.
//   node comfyui/tools/prepare-duo-run.cjs --out output/test-runs/<fresh-name> [--fighters griddle,rivet]
const fs = require('node:fs');
const path = require('node:path');
const { graphBuilder, characterValues, environmentValues, projectValues, attachExporter, attachMedia, mediaCounts } = require('./prepare-factory-workflows.cjs');
const { makeAudioJobs, makeAudioGraph, attachAudioGraph } = require('./prepare-audio-workflows.cjs');
const { apiPrompt } = require('./prepare-arcade-expansion.cjs');
const { directoryTarget } = require('../../build/tools/lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const RATES = Object.freeze({ image1K: .048048, image2K: .072072, videoSecond720p: .1287, musicSecond: .0025, effectMinute: .14, speechThousandCharacters: .1144 });
const SHEETS = ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE'];
const round = value => Number(value.toFixed(6));

function buildDuo(config, fighterIds, bundleRoot, { seed = 42 } = {}) {
  const fighters = fighterIds.map(id => config.fighters.find(fighter => fighter.id === id));
  if (fighters.length !== 2 || fighters.some(fighter => !fighter) || fighterIds[0] === fighterIds[1]) throw new Error(`Choose two different fighters from: ${config.fighters.map(f => f.id).join(', ')}`);
  if (!config.extraSheets) throw new Error('The two-fighter run uses the arcade layout (extraSheets).');
  const stage = config.stages[0], game = { ...config, fighters, stages: [stage] };
  const b = graphBuilder(`${config.title}: two-fighter complete run`);
  const project = b.node('CFZProjectSettings', 'Project settings | two-fighter run', { ...projectValues(config), root_directory: bundleRoot, seed }, [-510, 120], [450, 470]);
  const bundles = [];
  const characters = fighters.map((fighter, i) => {
    // Internal sheets off: five visible sheet nodes reuse the identity, so the factory runs at most four art calls at once.
    const character = b.node('CFZCharacterFactory', `Character ${i + 1} | ${fighter.name}`, characterValues(fighter, false, true), [0, 120 + i * 1250], [440, 720]);
    b.connect(project, 0, character, 'project'); bundles.push(character);
    // Sheets B-E take sheet A as a second reference so scale, line weight and facing stay consistent.
    let first = null;
    SHEETS.forEach((sheet, j) => {
      const node = b.node('CFZSpriteSheet', `${fighter.name} | sheet ${'ABCDE'[j]}`, { sheet }, [490, 120 + i * 1250 + j * 235], [420, 170]);
      b.connect(project, 0, node, 'project'); b.connect(character, 2, node, 'character'); b.connect(character, 1, node, 'reference'); bundles.push(node);
      if (first) b.connect(first, 1, node, 'reference_sheet'); else first = node;
    });
    return character;
  });
  const environment = b.node('CFZEnvironmentFactory', `Environment | ${stage.name}`, environmentValues({ ...stage, enabled: true }), [0, 2700], [440, 540]);
  b.connect(project, 0, environment, 'project'); bundles.push(environment);
  const shared = b.node('CFZSharedArtFactory', 'Shared art | menus, logo, HUD + effects', {}, [980, 120], [440, 160]);
  b.connect(project, 0, shared, 'project'); b.connect(environment, 1, shared, 'stage_reference'); bundles.push(shared);
  bundles.push(attachMedia(b, project, characters, fighters, environment, [1500, 120], shared));
  attachExporter(b, project, bundles, [980, 380], true);
  const templates = Object.fromEntries(['music', 'sfx', 'voice'].map(key => [key, read(`comfyui/workflows/templates/cloud-${key}.json`)]));
  const jobs = makeAudioJobs(game);
  const audio = makeAudioGraph(jobs, game, templates, { rootDirectory: bundleRoot, title: 'Two-fighter run: music, calls, effects and fighter lines' });
  attachAudioGraph(b.graph, project, audio, { seed });
  jobs.forEach((job, index) => {
    const generation = b.graph.nodes.find(node => node.title === `${job.id} | cloud audio`), save = b.graph.nodes.find(node => node.title === `Save + map ${job.id}`);
    generation.pos = [2600 + Math.floor(index / 8) * 500, 120 + (index % 8) * 420]; save.pos = [generation.pos[0], generation.pos[1] + 250];
  });
  b.note(`# ${config.title}: two-fighter complete run\n\n${fighters.map(f => f.name).join(' and ')} in ${stage.name}: every game image, the startup ensemble, a looping menu video, a looping select-screen video, two fight introductions, two select-screen idle loops and ${jobs.length} audio clips, written to one bundle folder. **CLOUD ONLY / PAID.** Validate and approve the spend before queueing; on a one-job workspace run the API file with comfyui/tools/run-sequential.cjs.`, [-510, -260], [1940, 220]);
  b.graph.nodes.forEach((node, index) => { node.order = index; });
  // Paid calls: per fighter a text source, identity, portrait, hero, cut-in and ending (1K) and five 2K sheets;
  // the arena source and stage (2K); five 1K interface images and the 2K effects atlas; then the startup media.
  const media = mediaCounts(game);
  const oneK = fighters.length * 6 + 5 + media.oneK, twoK = fighters.length * 5 + 2 + 1 + media.twoK;
  const musicSeconds = jobs.filter(job => job.category === 'music').reduce((sum, job) => sum + job.duration, 0);
  const effectsSeconds = jobs.filter(job => job.category === 'sfx').reduce((sum, job) => sum + job.duration, 0);
  const voiceCharacters = jobs.filter(job => job.category === 'voice').reduce((sum, job) => sum + job.prompt.length, 0);
  const imageUSD = round(oneK * RATES.image1K + twoK * RATES.image2K), videoUSD = round(media.videoSeconds * RATES.videoSecond720p);
  const audioUSD = round(musicSeconds * RATES.musicSecond + effectsSeconds * RATES.effectMinute / 60 + voiceCharacters * RATES.speechThousandCharacters / 1000);
  const plan = {
    schema: 'comfy-fighter-duo-plan/v1', cloudOnly: true, generationSubmitted: false, requiresSpendingAuthorization: true,
    fighters: fighters.map(f => f.id), stage: stage.id, bundle: bundleRoot, source: 'Fresh text-only fictional designs; no image files loaded.',
    images: { paidImages: oneK + twoK, oneK, twoK, mappedAssets: fighters.length * 11 + 2 + 6 + 1, estimatedUSD: imageUSD },
    videos: { clips: media.clips, seconds: media.videoSeconds, model: 'LTX-2.5 (Fast)', resolution: '1280x720', estimatedUSD: videoUSD },
    audio: { clips: jobs.length, musicSeconds, effectsSeconds, voiceCharacters, estimatedUSD: audioUSD },
    total: { estimatedUSD: round(imageUSD + videoUSD + audioUSD) }, rates: RATES, runtimePoses: fighters.length * 45,
    next: ['Validate workflow.api.json against the running ComfyUI.', 'Approve the spend, then run: node comfyui/tools/run-sequential.cjs --workflow <out>/workflow.api.json',
      'Review every sheet, the ensemble and both intros, then export <out>/bundle with npm run build:bundle.']
  };
  return { workflow: b.graph, prompt: apiPrompt(b.graph), plan };
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
