// Merge accepted asset updates by ID, preserving all unchanged source art/audio.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { isInside, safePath, sourceFile, directoryTarget } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
function source(root, src) {
  safePath(src);
  const file = path.resolve(root, src);
  if (!isInside(root, file)) throw new Error(`Source escapes bundle: ${src}`);
  return file;
}
const ID = /^[a-z0-9][a-z0-9_-]*$/i;
const IMAGE_SCHEMA = 'comfy-fighter-assets/v1', AUDIO_SCHEMA = 'comfy-fighter-audio/v1';
const LEGACY_SCHEMAS = { [IMAGE_SCHEMA]: 'dad-fighter-assets/v1', [AUDIO_SCHEMA]: 'dad-fighter-audio/v1' };
const MAPPING_FIELDS = ['kind', 'fighter', 'stage', 'sheet', 'poses', 'category', 'key'];
function readMap(folder, filename, schema) {
  const file = path.join(folder, filename);
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(sourceFile(folder, filename), 'utf8'));
  if (manifest.schema === LEGACY_SCHEMAS[schema]) manifest.schema = schema;
  if (manifest.schema !== schema || manifest.root !== '.' || !Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error(`Invalid bundle map: ${file}`);
  const ids = new Set();
  for (const item of manifest.assets) {
    if (!item || !ID.test(item.id) || ids.has(item.id.toLowerCase())) throw new Error(`Invalid or duplicate record: ${item?.id}`);
    ids.add(item.id.toLowerCase());
  }
  return manifest;
}
function baseContract(manifest) {
  if (!manifest || manifest.partial) throw new Error('A complete base assets.json is required; a partial patch cannot be the base.');
  const game = manifest.game, standardSheets = require('../../comfyui/config/game.json').sheets;
  if (!game || typeof game.title !== 'string' || !game.title.trim() || !Array.isArray(game.fighters) || game.fighters.length < 2 || !Array.isArray(game.stages) || !game.stages.length || !isDeepStrictEqual(game.sheets, standardSheets)) throw new Error('Complete base requires a title, two fighters, an environment and the three standard pose layouts.');
  for (const group of ['fighters', 'stages']) {
    const ids = new Set();
    for (const entry of game[group]) {
      if (!entry || !ID.test(entry.id) || ids.has(entry.id.toLowerCase()) || typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`Invalid or duplicate base ${group} definition.`);
      ids.add(entry.id.toLowerCase());
    }
  }
  const assets = new Map(manifest.assets.map(item => [item.id, item]));
  const required = (filter, label) => { if (manifest.assets.filter(filter).length !== 1) throw new Error(`Complete base is missing or duplicates ${label}.`); };
  for (const fighter of game.fighters) {
    for (const kind of ['source', 'reference', 'portrait', 'hero', 'cutin']) required(item => item.fighter === fighter.id && item.kind === kind, `${fighter.id}/${kind}`);
    for (const [sheet, poses] of Object.entries(standardSheets)) required(item => item.kind === 'sprites' && item.fighter === fighter.id && item.sheet === sheet && isDeepStrictEqual(item.poses, poses), `${fighter.id}/${sheet}`);
  }
  for (const stage of game.stages) for (const kind of ['source', 'stage']) required(item => item.stage === stage.id && item.kind === kind, `${stage.id}/${kind}`);
  for (const id of ['title', 'select', 'logo', 'hud', 'icons']) required(item => item.id === id && item.kind === 'ui', id);
  required(item => item.kind === 'effects' && isDeepStrictEqual(item.poses, ['hit', 'block', 'projectile', 'dust', 'ko', 'powerup', 'dash', 'launch', 'spark']), 'combat effects');
  if (game.expectedAssets !== undefined && (!Array.isArray(game.expectedAssets) || game.expectedAssets.length !== assets.size || new Set(game.expectedAssets).size !== assets.size || game.expectedAssets.some(id => !assets.has(id)))) throw new Error('Complete base does not include its expected asset records.');
  for (const item of manifest.assets) {
    if (!['source', 'reference', 'sprites', 'portrait', 'hero', 'cutin', 'stage', 'ui', 'effects'].includes(item.kind)) throw new Error(`Invalid base asset kind: ${item.id}`);
    if (item.fighter && !game.fighters.some(f => f.id === item.fighter) || item.stage && !game.stages.some(s => s.id === item.stage)) throw new Error(`Unknown owner on base asset: ${item.id}`);
    if (['reference', 'sprites', 'portrait', 'hero', 'cutin'].includes(item.kind) && (!item.fighter || item.stage) || item.kind === 'stage' && (!item.stage || item.fighter) || ['ui', 'effects'].includes(item.kind) && (item.fighter || item.stage) || item.kind === 'source' && Boolean(item.fighter) === Boolean(item.stage)) throw new Error(`Invalid owner mapping on base asset: ${item.id}`);
    if (item.kind === 'sprites' && !isDeepStrictEqual(item.poses, standardSheets[item.sheet])) throw new Error(`Invalid pose layout on base asset: ${item.id}`);
  }
  return assets;
}
function applyMetadata(game, original, patchGame, changes) {
  if (!patchGame) return;
  if (patchGame.sheets && !isDeepStrictEqual(patchGame.sheets, original.sheets)) throw new Error('Patch changes the configured pose layouts.');
  const update = (target, base, fields, incoming, prefix) => {
    for (const field of fields) if (Object.hasOwn(incoming, field) && !isDeepStrictEqual(incoming[field], base[field])) {
      const key = `${prefix}.${field}`;
      if (changes.has(key) && !isDeepStrictEqual(changes.get(key), incoming[field])) throw new Error(`Conflicting edited metadata: ${key}`);
      if (field === 'specialMove') {
        if (!incoming[field] || ['name', 'description'].some(key => typeof incoming[field][key] !== 'string' || !incoming[field][key].trim())) throw new Error(`Invalid special move metadata: ${prefix}`);
      } else if (typeof incoming[field] !== 'string' || ['name', 'title'].includes(field) && !incoming[field].trim()) throw new Error(`Invalid metadata: ${key}`);
      if (field === 'color' && !/^#[a-f0-9]{6}$/i.test(incoming[field])) throw new Error(`Invalid character color: ${prefix}`);
      changes.set(key, incoming[field]); target[field] = structuredClone(incoming[field]);
    }
  };
  update(game, original, ['title', 'subtitle'], patchGame, 'game');
  for (const group of ['fighters', 'stages']) {
    if (patchGame[group] === undefined) continue;
    if (!Array.isArray(patchGame[group])) throw new Error(`Invalid patch ${group} metadata.`);
    const ids = new Set();
    for (const item of patchGame[group]) {
      const base = original[group].find(entry => entry.id === item?.id), target = game[group].find(entry => entry.id === item?.id);
      if (!base || ids.has(item.id)) throw new Error(`Patch contains an unknown or duplicate ${group} definition: ${item?.id}`);
      ids.add(item.id);
      update(target, base, ['name', 'description', 'specialMove', 'introTagline', 'color'], item, `${group}.${item.id}`);
    }
  }
}
function merge({ base, patches, out, saga = false }) {
  base = fs.realpathSync(base); out = directoryTarget(out);
  const roots = [base, ...patches.map(folder => fs.realpathSync(folder))];
  if (roots.some(folder => !path.relative(out, folder) || isInside(folder, out) || isInside(out, folder))) throw new Error('Merged output must be separate from source bundles.');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('Merged output must be a new or empty folder.');
  const baseManifest = readMap(base, 'assets.json', IMAGE_SCHEMA);
  const baseImages = baseContract(baseManifest);
  const config = saga ? JSON.parse(fs.readFileSync(path.join(ROOT, 'comfyui/config/game.json'), 'utf8')) : baseManifest.game;
  const imagePlan = saga ? JSON.parse(fs.readFileSync(path.join(ROOT, 'comfyui/assets/plan.json'), 'utf8')).jobs : [...baseImages.values()];
  const audioPlan = saga ? JSON.parse(fs.readFileSync(path.join(ROOT, 'comfyui/assets/audio-plan.json'), 'utf8')).jobs : [];
  const expectedRecords = new Map([...imagePlan, ...audioPlan].map(job => [job.id, job]));
  const game = structuredClone(config), metadataChanges = new Map();
  const changes = [], imageRecords = new Map(), audioRecords = new Map();
  let videoManifest, videoInput;
  for (const folder of roots) for (const [filename, schema, records] of [['assets.json', IMAGE_SCHEMA, imageRecords], ['audio.json', AUDIO_SCHEMA, audioRecords]]) {
    const manifest = readMap(folder, filename, schema); if (!manifest) continue;
    if (!saga && folder !== base && filename === 'assets.json') applyMetadata(game, baseManifest.game, manifest.game, metadataChanges);
    for (const record of manifest.assets) {
      const isAudio = filename === 'audio.json';
      let job = expectedRecords.get(record.id);
      if (!saga && isAudio && !job) {
        if ([...expectedRecords.keys()].some(id => id.toLowerCase() === record.id.toLowerCase())) throw new Error(`Conflicting asset ID casing: ${record.id}`);
        if (record.kind !== 'audio' || !['music', 'sfx', 'voice'].includes(record.category) || record.fighter && !game.fighters.some(f => f.id === record.fighter)) throw new Error(`Invalid audio mapping: ${record.id}`);
        job = record; expectedRecords.set(record.id, record);
      }
      if (!job || isAudio !== (job.kind === 'audio')) throw new Error(`Unexpected asset record: ${record.id}; patches may only replace image IDs already in the complete base.`);
      for (const field of MAPPING_FIELDS) if ((!saga || field !== 'key') && !isDeepStrictEqual(record[field], job[field])) throw new Error(`Asset mapping disagrees with ${saga ? 'plan' : 'base'}: ${record.id}.${field}`);
      if (!(filename === 'audio.json' ? /\.(wav|mp3|ogg|flac)$/i : /\.png$/i).test(record.src)) throw new Error(`Unsupported source media: ${record.id}`);
      const input = sourceFile(folder, record.src), data = fs.readFileSync(input);
      if (!/^[a-f0-9]{64}$/i.test(record.sha256 || '') || createHash('sha256').update(data).digest('hex') !== record.sha256.toLowerCase()) throw new Error(`Source hash mismatch: ${record.id}`);
      if (folder !== base) changes.push({ id: record.id, kind: record.kind, replaces: records.has(record.id) });
      records.set(record.id, { record, input });
    }
  }
  for (const folder of roots) {
    const file = path.join(folder, 'video.json'); if (!fs.existsSync(file)) continue;
    const mapped = JSON.parse(fs.readFileSync(sourceFile(folder, 'video.json'), 'utf8')), video = mapped.openingVideo;
    if (mapped.schema !== 'comfy-fighter-video/v1' || mapped.root !== '.' || video?.id !== 'opening' || !/\.mp4$/i.test(video.src || '') || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 300 || !/^[a-f0-9]{64}$/i.test(video.sha256 || '')) throw new Error('Invalid opening video manifest.');
    const input = sourceFile(folder, video.src);
    if (createHash('sha256').update(fs.readFileSync(input)).digest('hex') !== video.sha256.toLowerCase()) throw new Error('Opening video hash mismatch.');
    videoManifest = mapped; videoInput = input;
  }
  const assets = [...imageRecords.values()].map(({ record }) => record), audio = [...audioRecords.values()].map(({ record }) => record);
  const expected = imagePlan.map(j => j.id);
  if (expected.length !== assets.length || expected.some(id => !imageRecords.has(id))) throw new Error('Merged image set does not match the complete asset plan.');
  const expectedAudio = saga ? audioPlan.map(j => j.id) : audio.length ? baseManifest.game.expectedAudio || [] : [];
  if (!Array.isArray(expectedAudio) || expectedAudio.some(id => !audioRecords.has(id))) throw new Error('Merged audio set is incomplete.');
  const paths = new Set();
  for (const { record } of [...imageRecords.values(), ...audioRecords.values()]) {
    const key = record.src.toLowerCase();
    if (paths.has(key)) throw new Error(`Conflicting source path: ${record.src}`);
    paths.add(key);
  }
  if (videoManifest && paths.has(videoManifest.openingVideo.src.toLowerCase())) throw new Error('Opening video path collides with other media.');
  fs.mkdirSync(out, { recursive: true });
  for (const { record, input } of [...imageRecords.values(), ...audioRecords.values()]) {
    const target = source(out, record.src); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== record.sha256.toLowerCase()) throw new Error(`Conflicting source path: ${record.src}`);
    fs.copyFileSync(input, target);
  }
  game.expectedAssets = assets.map(a => a.id);
  if (audio.length) game.expectedAudio = audio.map(a => a.id); else delete game.expectedAudio;
  delete game.assetRoot;
  const outputManifest = { ...baseManifest, game, assets }; delete outputManifest.partial;
  fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify(outputManifest, null, 2) + '\n');
  if (audio.length) fs.writeFileSync(path.join(out, 'audio.json'), JSON.stringify({ schema: AUDIO_SCHEMA, root: '.', title: game.title, assets: audio }, null, 2) + '\n');
  if (videoManifest) {
    const outputVideo = source(out, videoManifest.openingVideo.src); fs.mkdirSync(path.dirname(outputVideo), { recursive: true }); fs.copyFileSync(videoInput, outputVideo);
    fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify(videoManifest, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(out, 'update-report.json'), JSON.stringify({ source: 'Accepted incremental ComfyUI updates', imageAssets: assets.length, audioAssets: audio.length, changed: changes }, null, 2) + '\n');
  console.log(`Merged ${changes.length} updates into ${assets.length} images and ${audio.length} audio assets. Unchanged files retained.`);
}
if (require.main === module) {
  const options = { patches: [] }, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--saga') { options.saga = true; continue; }
    if (!['--base', '--patch', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node build/tools/merge-bundles.cjs --base <folder> --patch <folder> [--patch <folder>] --out <new folder> [--saga]');
    const key = args[i].slice(2), value = args[++i];
    if (key === 'patch') options.patches.push(value); else options[key] = value;
  }
  if (!options.base || !options.out || !options.patches.length) throw new Error('--base, --patch and --out are required.');
  merge(options);
}
module.exports = { merge };
