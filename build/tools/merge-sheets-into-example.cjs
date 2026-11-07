// Merge reviewed optional sheets (motion sheetF/sheetG or detail sheetH/sheetI) from a run's bundle into example/bundle
// without touching the accepted images: each PNG becomes a pixel-verified lossless WebP with its own provenance entry.
// Usage: node build/tools/merge-sheets-into-example.cjs <run bundle dir> [<asset id regex, default _sheet[FG]$>]
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const { losslessImage } = require('./package-example.cjs');
const { verifyBundle, hash } = require('./lib/example-bundle.cjs');
(async () => {
  const run = path.resolve(ROOT, process.argv[2] || 'output/test-runs/canonical-motion-20261106/bundle'), example = path.join(ROOT, 'example/bundle');
  const source = JSON.parse(fs.readFileSync(path.join(run, 'assets.json'), 'utf8')), target = JSON.parse(fs.readFileSync(path.join(example, 'assets.json'), 'utf8'));
  const provenance = JSON.parse(fs.readFileSync(path.join(example, 'provenance.json'), 'utf8'));
  const known = new Map(target.assets.map(a => [a.id, a]));
  for (const record of source.assets) if (known.has(record.id) && !new RegExp(process.argv[3] || '_sheet[FG]$').test(record.id) && known.get(record.id).sha256 !== record.sha256 && !record.src.endsWith('.png')) throw new Error(`Accepted asset changed in the run: ${record.id}`);
  const pattern = new RegExp(process.argv[3] || '_sheet[FG]$'), added = source.assets.filter(a => pattern.test(a.id));
  for (const record of added) {
    const input = path.join(run, record.src), src = `raw/${record.id}.webp`, output = path.join(example, src);
    const pngBytes = fs.readFileSync(input), verified = await losslessImage(input, output), encoded = fs.readFileSync(output);
    const entry = { ...record, src, width: verified.width, height: verified.height, sha256: hash(encoded), bytes: encoded.length };
    const at = target.assets.findIndex(a => a.id === record.id);
    if (at >= 0) target.assets[at] = entry; else target.assets.push(entry);
    const evidence = { id: record.id, sourceSha256: hash(pngBytes), packagedSha256: hash(encoded), sourceBytes: pngBytes.length, bytes: encoded.length, ...verified };
    const p = provenance.images.findIndex(i => i.id === record.id);
    if (p >= 0) provenance.images[p] = evidence; else provenance.images.push(evidence);
    console.log(`${record.id}: ${Math.round(pngBytes.length / 1024)} KiB PNG -> ${Math.round(encoded.length / 1024)} KiB lossless WebP, identical pixels`);
  }
  if (source.game.motionSheets) target.game.motionSheets = source.game.motionSheets;
  if (source.game.detailSheets) target.game.detailSheets = source.game.detailSheets;
  if (Array.isArray(target.game.expectedAssets)) for (const record of added) if (!target.game.expectedAssets.includes(record.id)) target.game.expectedAssets.push(record.id);
  if (process.argv[3]) (provenance.detailSheets ||= []).push({ addedAt: new Date().toISOString().slice(0, 10), ids: added.map(r => r.id), run: path.relative(ROOT, path.dirname(run)).replace(/\\/g, '/'), model: 'Gemini Nano Banana 2.1 (2K)' });
  else provenance.motionSheets = { addedAt: '2026-11-06', run: 'output/test-runs/canonical-motion-20261106', model: 'Gemini Nano Banana 2.1 (2K)', estimatedUSD: 1.009008, note: 'sheetF/sheetG generated with each fighter\'s accepted reference and sheet A; the 89 earlier images are unchanged.' };
  fs.writeFileSync(path.join(example, 'assets.json'), JSON.stringify(target, null, 2) + '\n');
  fs.writeFileSync(path.join(example, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  const checked = await verifyBundle(example);
  console.log(`example verifier OK: ${checked.manifest.assets.length} images, ${checked.poseCount} mapped cels, contract ${checked.contract.name}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
