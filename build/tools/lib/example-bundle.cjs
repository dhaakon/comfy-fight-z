// Local bundle validation shared by the free example runner and its packaging tool.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { sourceFile } = require('./runtime-validation.cjs');
// A shipped example matches one reviewed release exactly: the classic six-fighter Yard bundle, or
// the arcade bundle with a final boss, three arenas and 45 poses each (27 required + 18 in-betweens).
const CONTRACTS = Object.freeze({
  classic: Object.freeze({ name: 'classic', fighters: 6, bosses: 0, stages: 1, images: 56, audio: 22, poses: 27,
    art: ['source', 'reference', 'portrait', 'hero', 'cutin'], voices: ['intro', 'special'] }),
  arcade: Object.freeze({ name: 'arcade', fighters: 7, bosses: 1, stages: 3, images: 89, audio: 99, poses: 45,
    art: ['source', 'reference', 'portrait', 'hero', 'cutin', 'ending'], voices: ['intro', 'special', 'super', 'attack', 'hurt', 'ko', 'win'] })
});
const contractFor = game => game?.extraSheets ? CONTRACTS.arcade : CONTRACTS.classic;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function filesIn(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Example bundles cannot contain links: ${name}`);
    if (entry.isDirectory()) return filesIn(root, name);
    if (!entry.isFile()) throw new Error(`Unsupported bundle entry: ${name}`);
    return [name];
  });
}

async function verifyBundle(directory, { packaged = true } = {}) {
  directory = fs.realpathSync(directory);
  const { validateManifest, validateAudioManifest, validateVideoManifest } = await import(pathToFileURL(path.join(__dirname, '../../public/builder/pack.js')).href);
  const manifest = validateManifest(read(sourceFile(directory, 'assets.json')));
  const audio = validateAudioManifest(read(sourceFile(directory, 'audio.json')), manifest.game);
  // Startup and select clips are optional (the classic example has none); each one is mapped and digest-checked.
  const video = fs.existsSync(path.join(directory, 'video.json')) ? validateVideoManifest(read(sourceFile(directory, 'video.json')), manifest.game) : null;
  const clips = video ? [video.openingVideo, video.titleVideo, video.selectVideo, ...(video.fighterIntros || []), ...(video.selectIdles || [])].filter(Boolean) : [];
  const contract = contractFor(manifest.game);
  // The generated menu frame (ui/frame) and game-select title card (ui/card) are later additions; a release may carry
  // them on top of its contract.
  const motionSheets = manifest.assets.filter(asset => asset.kind === 'sprites' && (Object.hasOwn(manifest.game.motionSheets || {}, asset.sheet) || Object.hasOwn(manifest.game.detailSheets || {}, asset.sheet))).length;
  const later = ['frame', 'card'].filter(id => manifest.assets.some(asset => asset.kind === 'ui' && asset.id === id)).length;
  // Living-scenery records (populated scenes and cut-out layers) are optional per arena, outside the contract.
  const scenery = manifest.assets.filter(asset => ['scene', 'layer'].includes(asset.kind)).length;
  const images = manifest.assets.length - later - motionSheets - scenery;
  if (manifest.cloudOnly !== true || manifest.game.fighters.length !== contract.fighters || manifest.game.stages.length !== contract.stages || images !== contract.images || audio.assets.length !== contract.audio)
    throw new Error(`The complete ${contract.name} example requires ${contract.fighters} fictional fighters, ${contract.stages} arena(s), ${contract.images} generated images and ${contract.audio} audio clips.`);
  if (manifest.game.fighters.filter(fighter => fighter.boss).length !== contract.bosses) throw new Error(`The complete ${contract.name} example requires ${contract.bosses} final boss(es).`);
  // Motion sheets (sheetF/sheetG) are a later optional addition on top of either contract.
  // Detail sheets (sheetH/sheetI) are optional per sheet and per fighter; each carried sheet is complete by layout.
  const required = Object.values(manifest.game.sheets || {}).flat(), motion = Object.values(manifest.game.motionSheets || {}).flat(), detail = Object.values(manifest.game.detailSheets || {}).flat();
  const poses = [...required, ...Object.values(manifest.game.extraSheets || {}).flat(), ...motion, ...detail];
  if (required.length !== 27 || poses.length - motion.length - detail.length !== contract.poses || new Set(poses).size !== poses.length) throw new Error(`Example needs the complete ${contract.poses}-pose ${contract.name} layout.`);
  const base = poses.filter(pose => !motion.includes(pose) && !detail.includes(pose));
  for (const fighter of manifest.game.fighters) {
    const mapped = manifest.assets.filter(asset => asset.kind === 'sprites' && asset.fighter === fighter.id).flatMap(asset => asset.poses);
    // A fighter carries either every motion cel or none; the contract poses are always complete.
    const motionMapped = mapped.filter(pose => motion.includes(pose)), core = mapped.filter(pose => !motion.includes(pose) && !detail.includes(pose));
    for (const [sheet, list] of Object.entries(manifest.game.detailSheets || {})) { const carried = list.filter(pose => mapped.includes(pose)); if (carried.length && carried.length !== list.length) throw new Error(`Incomplete ${sheet} pose map: ${fighter.id}`); }
    if (motionMapped.length && (motionMapped.length !== motion.length || new Set(motionMapped).size !== motion.length)) throw new Error(`Incomplete motion pose map: ${fighter.id}`);
    if (core.length !== base.length || new Set(core).size !== base.length || base.some(pose => !core.includes(pose))) throw new Error(`Incomplete pose map: ${fighter.id}`);
    for (const kind of contract.art) if (!manifest.assets.some(asset => asset.kind === kind && asset.fighter === fighter.id)) throw new Error(`Missing ${kind} for ${fighter.id}`);
    for (const role of contract.voices) if (!audio.assets.some(asset => asset.id === `fighter_${fighter.id}_${role}` && asset.fighter === fighter.id)) throw new Error(`Missing fighter audio: fighter_${fighter.id}_${role}`);
  }
  const allowed = new Set(['assets.json', 'audio.json', 'provenance.json']);
  const entries = []; let bytes = 0;
  for (const record of [...manifest.assets, ...audio.assets]) {
    if (allowed.has(record.src)) throw new Error(`Colliding example source path: ${record.src}`);
    allowed.add(record.src);
    const file = sourceFile(directory, record.src), data = fs.readFileSync(file);
    if (!/^[a-f0-9]{64}$/i.test(record.sha256 || '') || hash(data) !== record.sha256.toLowerCase()) throw new Error(`Source integrity check failed: ${record.id}`);
    if (!data.length || data.length > 64 * 1024 * 1024) throw new Error(`Source exceeds the supported file size: ${record.id}`);
    if (record.kind !== 'audio' && (!Number.isInteger(record.width) || !Number.isInteger(record.height))) throw new Error(`Image dimensions are missing: ${record.id}`);
    bytes += data.length; entries.push({ record, file, bytes: data.length });
  }
  if (video) allowed.add('video.json');
  const videos = [];
  for (const clip of clips) {
    if (allowed.has(clip.src)) throw new Error(`Colliding example source path: ${clip.src}`);
    allowed.add(clip.src);
    const file = sourceFile(directory, clip.src), data = fs.readFileSync(file);
    if (hash(data) !== clip.sha256.toLowerCase()) throw new Error(`Source integrity check failed: ${clip.id}`);
    if (!data.length || data.length > 64 * 1024 * 1024) throw new Error(`Source exceeds the supported file size: ${clip.id}`);
    bytes += data.length; videos.push({ record: clip, file, bytes: data.length });
  }
  let provenance;
  if (packaged) {
    provenance = read(sourceFile(directory, 'provenance.json'));
    if (provenance.schema !== 'comfy-fighter-example-provenance/v1' || provenance.imageEncoding !== 'lossless WebP; decoded RGBA pixels verified' || provenance.images?.length !== manifest.assets.length || provenance.audio?.length !== contract.audio) throw new Error('The reviewed example provenance record is missing or incomplete.');
    for (const entry of entries) {
      const records = entry.record.kind === 'audio' ? provenance.audio : provenance.images;
      const evidence = records.find(item => item.id === entry.record.id);
      if (!evidence || evidence.packagedSha256 !== entry.record.sha256 || entry.record.kind !== 'audio' && evidence.pixelsIdentical !== true) throw new Error(`Packaging evidence does not match ${entry.record.id}`);
    }
    for (const entry of videos) {
      const evidence = (provenance.videos || []).find(item => item.id === entry.record.id);
      if (!evidence || evidence.sha256 !== entry.record.sha256) throw new Error(`Packaging evidence does not match ${entry.record.id}`);
    }
    const unknown = filesIn(directory).filter(name => !allowed.has(name));
    if (unknown.length) throw new Error(`Unmapped files in the shipped example: ${unknown.join(', ')}`);
  }
  // Mapped cels, so a bundle without the optional motion sheets reports its real count.
  const poseCount = manifest.assets.filter(asset => asset.kind === 'sprites').reduce((sum, asset) => sum + asset.poses.length, 0);
  return { directory, manifest, audio, video, videos, entries, bytes, provenance, contract, poseCount };
}

module.exports = { CONTRACTS, contractFor, hash, read, filesIn, verifyBundle };
