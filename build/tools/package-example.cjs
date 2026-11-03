// Curate a generated cloud bundle for Git. This tool performs no model inference.
// FFmpeg is only needed by maintainers packaging a new example, not by example/run.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { verifyBundle, hash } = require('./lib/example-bundle.cjs');
const { directoryTarget, isInside } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');

function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', data => error += String(data));
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${error}`)));
  });
}

async function pixels(file) {
  const image = await loadImage(file), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, rgba: Buffer.from(context.getImageData(0, 0, image.width, image.height).data) };
}

async function losslessImage(input, output) {
  const original = await pixels(input);
  await command(['-i', input, '-frames:v', '1', '-vf', 'format=bgra', '-c:v', 'libwebp', '-lossless', '1', '-quality', '100', '-compression_level', '6', '-map_metadata', '-1', '-y', output]);
  const encoded = await pixels(output);
  if (original.width !== encoded.width || original.height !== encoded.height || !original.rgba.equals(encoded.rgba)) throw new Error(`Lossless image verification failed: ${path.basename(input)}`);
  return { width: encoded.width, height: encoded.height, pixelsIdentical: true, rgbaSha256: hash(encoded.rgba) };
}

function audioInfo(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot inspect audio: ${result.stderr || result.error?.message}`);
  const data = JSON.parse(result.stdout), stream = data.streams.find(item => item.codec_type === 'audio');
  const duration = Number(stream?.duration || data.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid generated audio: ${path.basename(file)}`);
  return { duration, sampleRate: Number(stream.sample_rate), channels: stream.channels, codec: stream.codec_name };
}

async function compactAudio(input, output) {
  const original = audioInfo(input);
  await command(['-i', input, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '-1', '-y', output]);
  const encoded = audioInfo(output);
  if (encoded.codec !== 'mp3' || Math.abs(encoded.duration - original.duration) > .15 || encoded.channels !== original.channels || encoded.sampleRate !== original.sampleRate) throw new Error(`Audio conversion changed timing or layout: ${path.basename(input)}`);
  return { ...encoded, sourceDuration: original.duration };
}

async function pool(items, worker, count = 3) {
  let next = 0;
  await Promise.all(Array.from({ length: count }, async () => {
    while (next < items.length) { const index = next++; await worker(items[index], index); }
  }));
}

async function packageExample({ bundle, out = path.join(ROOT, 'example/bundle'), plan, promptId } = {}) {
  if (!bundle) throw new Error('Supply --bundle <complete generated bundle directory>.');
  if (promptId && !/^[a-f0-9-]{36}$/i.test(promptId)) throw new Error('Supply the actual ComfyUI prompt UUID.');
  bundle = fs.realpathSync(bundle); out = path.resolve(out);
  const checked = await verifyBundle(bundle, { packaged: false });
  if (directoryTarget(out) !== out || out === bundle || isInside(bundle, out) || isInside(out, bundle)) throw new Error('Packaged output must be a separate plain directory.');
  if (fs.existsSync(out)) throw new Error('The packaged destination already exists. Choose a fresh folder; accepted example media is never overwritten.');
  const diagnostics = path.join(ROOT, 'output/diagnostics');
  if (directoryTarget(diagnostics) !== diagnostics) throw new Error('Diagnostics path is redirected.');
  fs.mkdirSync(diagnostics, { recursive: true });
  const work = fs.mkdtempSync(path.join(diagnostics, 'example-package-')), stage = path.join(work, 'bundle');
  fs.mkdirSync(path.join(stage, 'raw'), { recursive: true });
  const manifest = structuredClone(checked.manifest), audio = structuredClone(checked.audio);
  const provenance = { schema: 'comfy-fighter-example-provenance/v1', packagedAt: new Date().toISOString(), cloudOnly: true,
    sourceAssetsSha256: hash(fs.readFileSync(path.join(bundle, 'assets.json'))), sourceAudioSha256: hash(fs.readFileSync(path.join(bundle, 'audio.json'))),
    imageEncoding: 'lossless WebP; decoded RGBA pixels verified', audioEncoding: 'MP3 VBR quality 2; sample rate, channels and duration verified',
    images: [], audio: [] };
  if (promptId) provenance.promptId = promptId;
  if (plan) {
    const preparation = JSON.parse(fs.readFileSync(plan, 'utf8'));
    provenance.generationPlanSha256 = hash(fs.readFileSync(plan));
    provenance.generation = { expectedAssets: preparation.expectedAssets, expectedAudio: preparation.expectedAudio, cloudOnly: preparation.cloudOnly, source: preparation.source, workflowSha256: preparation.workflowSha256 };
  }
  const sourcePaths = new Map();
  await pool(checked.entries.filter(entry => entry.record.kind !== 'audio'), async ({ record, file, bytes }, index) => {
    const src = `raw/${record.id}.webp`, target = path.join(stage, src), verified = await losslessImage(file, target), encoded = fs.readFileSync(target);
    if (record.width !== verified.width || record.height !== verified.height) throw new Error(`Generated dimensions disagree with manifest: ${record.id}`);
    Object.assign(manifest.assets[index], { src, width: verified.width, height: verified.height, sha256: hash(encoded), bytes: encoded.length });
    sourcePaths.set(record.src, src);
    provenance.images[index] = { id: record.id, sourceSha256: record.sha256, packagedSha256: hash(encoded), sourceBytes: bytes, bytes: encoded.length, ...verified };
    console.log(`Image ${index + 1}/${checked.manifest.assets.length}: ${record.id} — identical pixels, ${Math.round(encoded.length / 1024)} KiB`);
  });
  await pool(checked.entries.filter(entry => entry.record.kind === 'audio'), async ({ record, file, bytes }, index) => {
    const src = `raw/${record.id}.mp3`, target = path.join(stage, src), verified = await compactAudio(file, target), encoded = fs.readFileSync(target);
    Object.assign(audio.assets[index], { src, duration: verified.duration, sampleRate: verified.sampleRate, channels: verified.channels, codec: verified.codec, sha256: hash(encoded), bytes: encoded.length });
    provenance.audio[index] = { id: record.id, sourceSha256: record.sha256, packagedSha256: hash(encoded), sourceBytes: bytes, bytes: encoded.length, ...verified };
  });
  delete manifest.game.assetRoot;
  for (const owner of [...manifest.game.fighters, ...manifest.game.stages]) {
    const source = manifest.assets.find(asset => asset.kind === 'source' && (asset.fighter === owner.id || asset.stage === owner.id));
    if (owner.sourceImage) owner.sourceImage = sourcePaths.get(owner.sourceImage) || source?.src || '';
  }
  manifest.game.expectedAssets = manifest.assets.map(asset => asset.id);
  manifest.game.expectedAudio = audio.assets.map(asset => asset.id);
  for (const [filename, data] of [['assets.json', manifest], ['audio.json', audio], ['provenance.json', provenance]]) fs.writeFileSync(path.join(stage, filename), JSON.stringify(data, null, 2) + '\n');
  const result = await verifyBundle(stage);
  const receipt = { status: 'packaged', originalBundle: bundle, destination: out, images: manifest.assets.length, audio: audio.assets.length,
    originalBytes: checked.bytes, packagedBytes: result.bytes, losslessImages: true, sourceFilesPreserved: true, packagedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(work, 'packaging-report.json'), JSON.stringify(receipt, null, 2) + '\n');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.renameSync(stage, out);
  console.log(`Packaged ${receipt.images} pixel-identical images and ${receipt.audio} audio clips: ${(result.bytes / 1024 / 1024).toFixed(1)} MiB.\nBundle: ${out}\nOriginals retained: ${bundle}\nReceipt: ${path.join(work, 'packaging-report.json')}`);
  if (result.bytes > 80 * 1024 * 1024) console.log('The lossless bundle exceeds the 80 MiB target; image fidelity was preserved.');
  return receipt;
}

if (require.main === module) Promise.resolve().then(() => {
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === '--help') return console.log('Usage: npm run example:package -- --bundle <generated bundle> [--out <fresh folder>] [--plan <generation plan>] [--prompt-id <ComfyUI UUID>]\nMaintainer-only local compression; requires FFmpeg. Preserves original generated files, verifies every image pixel, and never calls a model.');
  for (let i = 0; i < args.length; i++) {
    if (!['--bundle', '--out', '--plan', '--prompt-id'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --bundle <folder>, optional --out <fresh folder>, --plan <JSON> and --prompt-id <UUID>.');
    const flag = args[i], key = flag === '--prompt-id' ? 'promptId' : flag.slice(2);
    if (options[key]) throw new Error(`Duplicate flag: ${flag}`);
    options[key] = flag === '--prompt-id' ? args[++i] : path.resolve(args[++i]);
  }
  return packageExample(options);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { pixels, losslessImage, audioInfo, compactAudio, packageExample };
