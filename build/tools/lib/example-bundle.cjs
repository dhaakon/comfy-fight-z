// Local bundle validation shared by the free example runner and its packaging tool.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { sourceFile } = require('./runtime-validation.cjs');
const CONTRACT = Object.freeze({ fighters: 6, stages: 1, images: 56, audio: 22, poses: 162 });
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
  if (manifest.cloudOnly !== true || manifest.game.fighters.length !== CONTRACT.fighters || manifest.game.stages.length !== CONTRACT.stages || manifest.assets.length !== CONTRACT.images || audio.assets.length !== CONTRACT.audio)
    throw new Error('The complete example requires 6 fictional fighters, 1 arena, 56 generated images and 22 audio clips.');
  const poses = Object.values(manifest.game.sheets || {}).flat();
  if (poses.length !== 27 || new Set(poses).size !== 27) throw new Error('Example needs the complete 27-pose layout.');
  for (const fighter of manifest.game.fighters) {
    const mapped = manifest.assets.filter(asset => asset.kind === 'sprites' && asset.fighter === fighter.id).flatMap(asset => asset.poses);
    if (mapped.length !== 27 || new Set(mapped).size !== 27 || poses.some(pose => !mapped.includes(pose))) throw new Error(`Incomplete pose map: ${fighter.id}`);
    for (const kind of ['source', 'reference', 'portrait', 'hero', 'cutin']) if (!manifest.assets.some(asset => asset.kind === kind && asset.fighter === fighter.id)) throw new Error(`Missing ${kind} for ${fighter.id}`);
    for (const role of ['intro', 'special']) if (!audio.assets.some(asset => asset.id === `fighter_${fighter.id}_${role}` && asset.fighter === fighter.id)) throw new Error(`Missing fighter audio: fighter_${fighter.id}_${role}`);
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
    if (provenance.schema !== 'comfy-fighter-example-provenance/v1' || provenance.imageEncoding !== 'lossless WebP; decoded RGBA pixels verified' || provenance.images?.length !== CONTRACT.images || provenance.audio?.length !== CONTRACT.audio) throw new Error('The reviewed example provenance record is missing or incomplete.');
    for (const entry of entries) {
      const records = entry.record.kind === 'audio' ? provenance.audio : provenance.images;
      const evidence = records.find(item => item.id === entry.record.id);
      if (!evidence || evidence.packagedSha256 !== entry.record.sha256 || entry.record.kind !== 'audio' && evidence.pixelsIdentical !== true) throw new Error(`Packaging evidence does not match ${entry.record.id}`);
    }
    const unknown = filesIn(directory).filter(name => !allowed.has(name));
    if (unknown.length) throw new Error(`Unmapped files in the shipped example: ${unknown.join(', ')}`);
  }
  return { directory, manifest, audio, entries, bytes, provenance, poseCount: poses.length * manifest.game.fighters.length };
}

module.exports = { CONTRACT, hash, read, filesIn, verifyBundle };
