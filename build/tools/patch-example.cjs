// Replace reviewed example images from a generated patch; unchanged media is copied byte-for-byte.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { verifyBundle, read, hash } = require('./lib/example-bundle.cjs');
const { directoryTarget, isInside, sourceFile } = require('./lib/runtime-validation.cjs');
const { losslessImage } = require('./package-example.cjs');
const ROOT = path.resolve(__dirname, '../..');
const MAPPING = ['id', 'kind', 'fighter', 'stage', 'sheet', 'poses', 'key'];

async function patchExample({ patch, promptId, root = ROOT, encode = losslessImage } = {}) {
  if (!patch || !/^[a-f0-9-]{36}$/i.test(promptId || '')) throw new Error('Supply --patch <generated patch folder> and --prompt-id <ComfyUI UUID>.');
  root = fs.realpathSync(root); patch = fs.realpathSync(patch);
  const bundle = path.join(root, 'example/bundle'), diagnostics = path.join(root, 'output/diagnostics');
  for (const folder of [bundle, diagnostics]) if (directoryTarget(folder) !== folder) throw new Error('Example or diagnostics folder is redirected.');
  if (patch === bundle || isInside(bundle, patch) || isInside(patch, bundle)) throw new Error('Generated patch must be separate from the shipped bundle.');
  const base = await verifyBundle(bundle), patchFile = sourceFile(patch, 'assets.json'), update = read(patchFile);
  if (update.schema !== 'comfy-fighter-assets/v1' || update.root !== '.' || !update.partial || !Array.isArray(update.assets) || !update.assets.length) throw new Error('Expected a partial Comfy Fighter Z image bundle.');
  const seen = new Set(), changes = update.assets.map(record => {
    const previous = base.manifest.assets.find(item => item.id === record.id);
    if (!previous || seen.has(record.id) || MAPPING.some(field => !isDeepStrictEqual(previous[field], record[field]))) throw new Error(`Patch changes an asset identity or pose mapping: ${record.id}`);
    seen.add(record.id);
    const file = sourceFile(patch, record.src), bytes = fs.readFileSync(file);
    if (!/^[a-f0-9]{64}$/i.test(record.sha256 || '') || hash(bytes) !== record.sha256.toLowerCase()) throw new Error(`Patch source integrity check failed: ${record.id}`);
    if (record.sha256 === base.provenance.images.find(item => item.id === record.id).sourceSha256) throw new Error(`Patch is unchanged: ${record.id}`);
    return { record, previous, file, bytes: bytes.length };
  });
  fs.mkdirSync(diagnostics, { recursive: true });
  const work = fs.mkdtempSync(path.join(diagnostics, 'example-patch-')), stage = path.join(work, 'bundle'), backup = path.join(work, 'previous-bundle');
  fs.cpSync(bundle, stage, { recursive: true });
  const manifest = structuredClone(base.manifest), provenance = structuredClone(base.provenance);
  const receipt = { promptId, sourceManifestSha256: hash(fs.readFileSync(patchFile)), assetIds: changes.map(item => item.record.id), patchedAt: new Date().toISOString() };
  for (const { record, previous, file, bytes } of changes) {
    const src = `raw/${record.id}-${record.sha256.slice(0, 16)}.webp`, destination = path.join(stage, src);
    if (fs.existsSync(destination)) throw new Error(`Patched filename already exists: ${src}`);
    const verified = await encode(file, destination), data = fs.readFileSync(destination);
    if (!verified.pixelsIdentical || verified.width !== record.width || verified.height !== record.height) throw new Error(`Patch dimensions or pixels changed: ${record.id}`);
    const index = manifest.assets.findIndex(item => item.id === record.id);
    manifest.assets[index] = { ...previous, src, width: verified.width, height: verified.height, sha256: hash(data), bytes: data.length };
    const evidence = provenance.images.findIndex(item => item.id === record.id);
    provenance.images[evidence] = { id: record.id, sourceSha256: record.sha256, packagedSha256: hash(data), sourceBytes: bytes, bytes: data.length, ...verified, promptId,
      replaced: provenance.images[evidence] };
    for (const owner of [...manifest.game.fighters, ...manifest.game.stages]) if (owner.sourceImage === previous.src) owner.sourceImage = src;
    fs.unlinkSync(sourceFile(stage, previous.src)); // Only the staged copy; the original is retained in previous-bundle.
  }
  provenance.repairs ||= []; provenance.repairs.push(receipt);
  fs.writeFileSync(path.join(stage, 'assets.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(stage, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  const verified = await verifyBundle(stage);
  for (const entry of base.entries.filter(item => !seen.has(item.record.id))) {
    const current = verified.entries.find(item => item.record.id === entry.record.id);
    if (current.record.src !== entry.record.src || current.record.sha256 !== entry.record.sha256) throw new Error(`Patch unexpectedly changed ${entry.record.id}`);
  }
  for (const target of [bundle, backup, stage]) if (!isInside(root, directoryTarget(target))) throw new Error('Patch move escapes the project.');
  fs.renameSync(bundle, backup);
  try { fs.renameSync(stage, bundle); }
  catch (error) { fs.renameSync(backup, bundle); throw error; }
  fs.writeFileSync(path.join(work, 'patch-report.json'), JSON.stringify({ ...receipt, previousBundle: backup, sourcePatch: patch, destination: bundle, bytes: verified.bytes, unchangedMedia: base.entries.length - changes.length }, null, 2) + '\n');
  console.log(`Updated ${changes.length} image(s), preserving ${base.entries.length - changes.length} other media files byte-for-byte.\nPrevious bundle: ${backup}\nVerified bundle: ${bundle}`);
  return { bundle, backup, receipt, bytes: verified.bytes };
}

if (require.main === module) Promise.resolve().then(() => {
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === '--help') return console.log('Usage: node build/tools/patch-example.cjs --patch <generated partial bundle> --prompt-id <ComfyUI UUID>\nMaintainer operation after visual review: pixel-verifies replacement images, preserves other media and archives the prior bundle. No model calls.');
  for (let i = 0; i < args.length; i++) {
    const key = args[i] === '--patch' ? 'patch' : args[i] === '--prompt-id' ? 'promptId' : null;
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) throw new Error('Use --patch <folder> --prompt-id <UUID>.');
    options[key] = args[++i];
  }
  return patchExample(options);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { patchExample };
