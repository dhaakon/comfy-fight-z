// Merge accepted asset updates by ID, preserving all unchanged source art/audio.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isInside, safePath, sourceFile, directoryTarget } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '..');
function source(root, src) {
  safePath(src);
  const file = path.resolve(root, src);
  if (!isInside(root, file)) throw new Error(`Source escapes bundle: ${src}`);
  return file;
}
function merge({ base, patches, out }) {
  base = fs.realpathSync(base); out = directoryTarget(out);
  const roots = [base, ...patches.map(folder => fs.realpathSync(folder))];
  if (roots.some(folder => !path.relative(out, folder) || isInside(folder, out) || isInside(out, folder))) throw new Error('Merged output must be separate from source bundles.');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('Merged output must be a new or empty folder.');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game.json'), 'utf8'));
  const imagePlan = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/plan.json'), 'utf8')).jobs;
  const audioPlan = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/audio-plan.json'), 'utf8')).jobs;
  const expectedRecords = new Map([...imagePlan, ...audioPlan].map(job => [job.id, job]));
  const changes = [], imageRecords = new Map(), audioRecords = new Map();
  let baseManifest, videoManifest, videoInput;
  for (const folder of roots) for (const [filename, schema, records] of [['assets.json', 'dad-fighter-assets/v1', imageRecords], ['audio.json', 'dad-fighter-audio/v1', audioRecords]]) {
    const file = path.join(folder, filename); if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.schema !== schema || manifest.root !== '.' || !Array.isArray(manifest.assets)) throw new Error(`Invalid bundle map: ${file}`);
    if (folder === base && filename === 'assets.json') baseManifest = manifest;
    const ids = new Set();
    for (const record of manifest.assets) {
      if (ids.has(record.id)) throw new Error(`Duplicate record: ${record.id}`); ids.add(record.id);
      const job = expectedRecords.get(record.id);
      if (!job || (filename === 'audio.json') !== (job.kind === 'audio')) throw new Error(`Unexpected asset record: ${record.id}`);
      for (const field of ['kind', 'fighter', 'stage', 'sheet', 'poses', 'category']) if (JSON.stringify(record[field]) !== JSON.stringify(job[field])) throw new Error(`Asset mapping disagrees with plan: ${record.id}.${field}`);
      if (!(filename === 'audio.json' ? /\.(wav|mp3|ogg|flac)$/i : /\.png$/i).test(record.src)) throw new Error(`Unsupported source media: ${record.id}`);
      const input = sourceFile(folder, record.src), data = fs.readFileSync(input);
      if (!record.sha256 || createHash('sha256').update(data).digest('hex') !== record.sha256) throw new Error(`Source hash mismatch: ${record.id}`);
      if (folder !== base) changes.push({ id: record.id, kind: record.kind, replaces: records.has(record.id) });
      records.set(record.id, { record, input });
    }
  }
  if (!baseManifest) throw new Error('Base assets.json is required.');
  for (const folder of roots) {
    const file = path.join(folder, 'video.json'); if (!fs.existsSync(file)) continue;
    const mapped = JSON.parse(fs.readFileSync(file, 'utf8')), video = mapped.openingVideo;
    if (mapped.schema !== 'comfy-fighter-video/v1' || mapped.root !== '.' || video?.id !== 'opening' || !/\.mp4$/i.test(video.src || '') || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 300 || !/^[a-f0-9]{64}$/i.test(video.sha256 || '')) throw new Error('Invalid opening video manifest.');
    const input = sourceFile(folder, video.src);
    if (createHash('sha256').update(fs.readFileSync(input)).digest('hex') !== video.sha256.toLowerCase()) throw new Error('Opening video hash mismatch.');
    videoManifest = mapped; videoInput = input;
  }
  const assets = [...imageRecords.values()].map(({ record }) => record), audio = [...audioRecords.values()].map(({ record }) => record);
  const expected = imagePlan.map(j => j.id);
  if (expected.length !== assets.length || expected.some(id => !imageRecords.has(id))) throw new Error('Merged image set does not match the complete asset plan.');
  const expectedAudio = audioPlan.map(j => j.id);
  if (expectedAudio.some(id => !audioRecords.has(id))) throw new Error('Merged audio set is incomplete.');
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
    if (fs.existsSync(target) && createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== record.sha256) throw new Error(`Conflicting source path: ${record.src}`);
    fs.copyFileSync(input, target);
  }
  const game = { ...baseManifest.game, ...config, expectedAssets: assets.map(a => a.id), expectedAudio: audio.map(a => a.id) };
  delete game.assetRoot;
  fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify({ ...baseManifest, game, assets }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'audio.json'), JSON.stringify({ schema: 'dad-fighter-audio/v1', root: '.', title: game.title, assets: audio }, null, 2) + '\n');
  if (videoManifest) {
    const outputVideo = source(out, videoManifest.openingVideo.src); fs.mkdirSync(path.dirname(outputVideo), { recursive: true }); fs.copyFileSync(videoInput, outputVideo);
    fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify(videoManifest, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(out, 'update-report.json'), JSON.stringify({ source: 'Accepted incremental ComfyUI updates', imageAssets: assets.length, audioAssets: audio.length, changed: changes }, null, 2) + '\n');
  console.log(`Merged ${changes.length} updates into ${assets.length} images and ${audio.length} audio assets. Unchanged files retained.`);
}
if (require.main === module) {
  const options = { patches: [] }, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--base', '--patch', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node tools/merge-bundles.cjs --base <folder> --patch <folder> [--patch <folder>] --out <new folder>');
    if (args[i] === '--patch') options.patches.push(args[i + 1]); else options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.base || !options.out || !options.patches.length) throw new Error('--base, --patch and --out are required.');
  merge(options);
}
module.exports = { merge };
