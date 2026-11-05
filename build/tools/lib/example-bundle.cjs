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
  const { validateManifest, validateAudioManifest } = await import(pathToFileURL(path.join(__dirname, '../../public/builder/pack.js')).href);
  const manifest = validateManifest(read(sourceFile(directory, 'assets.json')));
  const audio = validateAudioManifest(read(sourceFile(directory, 'audio.json')), manifest.game);
  const contract = contractFor(manifest.game);
  // The generated menu frame (ui/frame) is a later addition; a release may carry it on top of its contract.
  const images = manifest.assets.length - (manifest.assets.some(asset => asset.kind === 'ui' && asset.id === 'frame') ? 1 : 0);
  if (manifest.cloudOnly !== true || manifest.game.fighters.length !== contract.fighters || manifest.game.stages.length !== contract.stages || images !== contract.images || audio.assets.length !== contract.audio)
    throw new Error(`The complete ${contract.name} example requires ${contract.fighters} fictional fighters, ${contract.stages} arena(s), ${contract.images} generated images and ${contract.audio} audio clips.`);
  if (manifest.game.fighters.filter(fighter => fighter.boss).length !== contract.bosses) throw new Error(`The complete ${contract.name} example requires ${contract.bosses} final boss(es).`);
  const required = Object.values(manifest.game.sheets || {}).flat(), poses = [...required, ...Object.values(manifest.game.extraSheets || {}).flat()];
  if (required.length !== 27 || poses.length !== contract.poses || new Set(poses).size !== poses.length) throw new Error(`Example needs the complete ${contract.poses}-pose ${contract.name} layout.`);
  for (const fighter of manifest.game.fighters) {
    const mapped = manifest.assets.filter(asset => asset.kind === 'sprites' && asset.fighter === fighter.id).flatMap(asset => asset.poses);
    if (mapped.length !== poses.length || new Set(mapped).size !== poses.length || poses.some(pose => !mapped.includes(pose))) throw new Error(`Incomplete pose map: ${fighter.id}`);
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
  let provenance;
  if (packaged) {
    provenance = read(sourceFile(directory, 'provenance.json'));
    if (provenance.schema !== 'comfy-fighter-example-provenance/v1' || provenance.imageEncoding !== 'lossless WebP; decoded RGBA pixels verified' || provenance.images?.length !== manifest.assets.length || provenance.audio?.length !== contract.audio) throw new Error('The reviewed example provenance record is missing or incomplete.');
    for (const entry of entries) {
      const records = entry.record.kind === 'audio' ? provenance.audio : provenance.images;
      const evidence = records.find(item => item.id === entry.record.id);
      if (!evidence || evidence.packagedSha256 !== entry.record.sha256 || entry.record.kind !== 'audio' && evidence.pixelsIdentical !== true) throw new Error(`Packaging evidence does not match ${entry.record.id}`);
    }
    const unknown = filesIn(directory).filter(name => !allowed.has(name));
    if (unknown.length) throw new Error(`Unmapped files in the shipped example: ${unknown.join(', ')}`);
  }
  return { directory, manifest, audio, entries, bytes, provenance, contract, poseCount: poses.length * manifest.game.fighters.length };
}

module.exports = { CONTRACTS, contractFor, hash, read, filesIn, verifyBundle };
