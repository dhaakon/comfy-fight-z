// Adopt a verified export into the existing game; only media files are converted.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { isInside, safePath, sourceFile, directoryTarget, runtimeSources } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '..');
function inside(root, relative) {
  safePath(relative);
  const file = path.resolve(root, relative);
  if (!isInside(root, file)) throw new Error(`Path escapes asset root: ${relative}`);
  return file;
}
function adoptionInputs(source, manifest, config, plan) {
  const inputs = new Map(), outputs = new Map();
  for (const src of runtimeSources(manifest, { config, plan, strict: true })) {
    if (inputs.has(src)) continue;
    const input = sourceFile(source, src), extension = path.extname(input).toLowerCase();
    const audio = ['.wav', '.mp3', '.ogg', '.flac'].includes(extension);
    const video = extension === '.mp4';
    if (!audio && !video && !['.png', '.webp', '.jpg', '.jpeg'].includes(extension)) throw new Error(`Unsupported runtime media: ${src}`);
    const next = src.replace(/\.[^.]+$/, video ? '.mp4' : audio ? '.mp3' : '.webp'), key = next.toLowerCase();
    if (outputs.has(key)) throw new Error(`Converted output collision: ${outputs.get(key)} and ${src}`);
    outputs.set(key, src); inputs.set(src, { input, audio, video, next });
  }
  return inputs;
}
async function adopt(game) {
  const source = fs.realpathSync(game), manifest = JSON.parse(fs.readFileSync(path.join(source, 'assets/manifest.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game.json'), 'utf8'));
  if (manifest.title !== config.title) throw new Error('Export title does not match this project.');
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/plan.json'), 'utf8'));
  const inputs = adoptionInputs(source, manifest, config, plan);
  for (const folder of ['build', 'public']) if (!isInside(fs.realpathSync(ROOT), directoryTarget(path.join(ROOT, folder)))) throw new Error(`Project directory resolves outside workspace: ${folder}`);
  const destination = path.join(ROOT, 'public/assets');
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  const stage = fs.mkdtempSync(path.join(ROOT, 'build/adopt-'));
  const assets = path.join(stage, 'assets'); fs.mkdirSync(assets);
  const converted = new Map(); let sourceBytes = 0, outputBytes = 0;
  async function media(src, reference = false) {
    if (converted.has(src)) return converted.get(src);
    const { input, audio, video, next } = inputs.get(src);
    sourceBytes += fs.statSync(input).size;
    const output = inside(stage, next);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (video) fs.copyFileSync(input, output);
    else if (audio) {
      const result = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', input, '-codec:a', 'libmp3lame', '-q:a', '2', '-y', output], { windowsHide: true, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Audio conversion failed: ${result.stderr || result.error?.message}`);
    } else {
      const image = await loadImage(input), ratio = reference ? Math.min(1, 1200 / Math.max(image.width, image.height)) : 1;
      const canvas = createCanvas(Math.round(image.width * ratio), Math.round(image.height * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      fs.writeFileSync(output, await canvas.encode('webp', 94));
    }
    outputBytes += fs.statSync(output).size; converted.set(src, next); return next;
  }
  try {
    manifest.subtitle = config.subtitle || manifest.subtitle || '';
    for (const fighter of manifest.fighters) {
      const definition = config.fighters.find(f => f.id === fighter.id);
      if (!definition) throw new Error(`Unknown fighter: ${fighter.id}`);
      fighter.introTagline = definition.introTagline || '';
      for (const pose of Object.values(fighter.poses)) pose.src = await media(pose.src);
      for (const kind of ['portrait', 'hero', 'cutin']) if (fighter[kind]) fighter[kind] = await media(fighter[kind]);
      if (fighter.sourceImage) fighter.sourceImage = await media(fighter.sourceImage, true);
    }
    for (const level of manifest.stages) {
      if (level.src) level.src = await media(level.src);
      if (level.sourceImage) level.sourceImage = await media(level.sourceImage, true);
    }
    for (const [id, value] of Object.entries(manifest.ui)) manifest.ui[id] = await media(typeof value === 'string' ? value : value.src);
    for (const effect of Object.values(manifest.effects)) effect.src = await media(effect.src);
    for (const entry of Object.values(manifest.audio || {})) {
      entry.src = await media(entry.src); delete entry.sha256; // Source WAV digest does not describe the encoded MP3.
    }
    if (manifest.openingVideo) manifest.openingVideo.src = await media(manifest.openingVideo.src);
    fs.writeFileSync(path.join(assets, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(assets, 'production.json'), JSON.stringify({ title: manifest.title, source: 'Verified ComfyUI bundle export', generatedWith: ['Gemini Nano Banana 2.1', 'Sonilo', 'ElevenLabs', ...(manifest.openingVideo ? ['Seedance 2.5'] : [])], openingVideo: manifest.openingVideo ? { duration: manifest.openingVideo.duration, format: 'H.264/AAC MP4' } : null, fighters: manifest.fighters.length, stages: manifest.stages.length, poses: manifest.fighters.reduce((n, f) => n + Object.keys(f.poses).length, 0), audio: Object.keys(manifest.audio || {}).length, files: converted.size, sourceBytes, outputBytes, formats: 'WebP quality 94, MP3 VBR quality 2, accepted MP4 copied unchanged; source reference previews limited to 1200px' }, null, 2) + '\n');
    // Keep the prior accepted runtime for recovery, then publish atomically.
    if (fs.existsSync(destination)) fs.renameSync(destination, path.join(stage, 'previous-assets'));
    try { fs.renameSync(assets, destination); }
    catch (error) { if (fs.existsSync(path.join(stage, 'previous-assets'))) fs.renameSync(path.join(stage, 'previous-assets'), destination); throw error; }
    console.log(`Adopted ${converted.size} runtime files: ${(sourceBytes / 1e6).toFixed(1)} MB -> ${(outputBytes / 1e6).toFixed(1)} MB. Game code preserved.`);
    return manifest;
  } catch (error) { throw new Error(`Adoption failed; working files retained in ${stage}: ${error.message}`); }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--game') throw new Error('Usage: node tools/adopt-game.cjs --game <verified exported game directory>');
  adopt(path.resolve(args[1])).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { adopt, adoptionInputs };
