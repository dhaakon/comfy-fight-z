// Add reviewed LTX clips to a fresh copy of a complete source bundle. No model calls.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { sourceFile, directoryTarget, isInside } = require('./lib/runtime-validation.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function assemble({ bundle, clips, out, fighters }) {
  if (![bundle, clips, out].every(value => value && path.isAbsolute(value))) throw new Error('Use absolute --bundle, --clips and --out paths.');
  bundle = fs.realpathSync(bundle); clips = fs.realpathSync(clips); out = directoryTarget(out);
  if (fs.existsSync(out) || [bundle, clips].some(root => out === root || isInside(root, out) || isInside(out, root))) throw new Error('Choose a fresh output directory outside both inputs.');
  const image = JSON.parse(fs.readFileSync(sourceFile(bundle, 'assets.json'), 'utf8'));
  if (image.schema !== 'comfy-fighter-assets/v1' || image.root !== '.' || image.partial || !Array.isArray(image.assets) || !Array.isArray(image.game?.fighters)) throw new Error('Use a complete Comfy Fighter Z image bundle.');
  const ids = fighters ? fighters.split(',').filter(Boolean) : image.game.fighters.map(f => f.id);
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !/^[a-z0-9][a-z0-9_-]*$/i.test(id) || !image.game.fighters.some(f => f.id === id))) throw new Error('Fighter IDs must be unique and present in the bundle.');
  const audioPath = path.join(bundle, 'audio.json'), videoPath = path.join(bundle, 'video.json');
  const audio = fs.existsSync(audioPath) ? JSON.parse(fs.readFileSync(sourceFile(bundle, 'audio.json'), 'utf8')) : null;
  const oldVideo = fs.existsSync(videoPath) ? JSON.parse(fs.readFileSync(sourceFile(bundle, 'video.json'), 'utf8')) : { schema: 'comfy-fighter-video/v1', root: '.' };
  if (oldVideo.schema !== 'comfy-fighter-video/v1' || oldVideo.root !== '.' || (oldVideo.fighterIntros !== undefined && !Array.isArray(oldVideo.fighterIntros))) throw new Error('Invalid existing video manifest.');
  if (audio && (!Array.isArray(audio.assets) || audio.root !== '.')) throw new Error('Invalid audio bundle.');
  const incoming = ids.map(id => {
    const file = sourceFile(clips, `${id}.mp4`), result = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot probe ${id}: ${result.error?.message || result.stderr}`);
    const data = JSON.parse(result.stdout), video = data.streams?.find(stream => stream.codec_type === 'video'), duration = Number(video?.duration || data.format?.duration);
    if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width < 640 || Math.abs(video.width / video.height - 16 / 9) > .04 || duration < 7.75 || duration > 8.3) throw new Error(`${id}: expected an approximately eight-second landscape H.264/yuv420p MP4.`);
    const bytes = fs.readFileSync(file); return { id: `intro-${id}`, fighter: id, src: `raw/intro-${id}.mp4`, duration, sha256: digest(bytes), bytes };
  });
  const intros = [...(oldVideo.fighterIntros || []).filter(record => !ids.includes(record.fighter)), ...incoming.map(({ bytes, ...record }) => record)];
  const records = [...image.assets, ...(audio?.assets || []), ...(oldVideo.openingVideo ? [oldVideo.openingVideo] : []), ...(oldVideo.titleVideo ? [oldVideo.titleVideo] : []), ...(oldVideo.fighterIntros || []).filter(record => !ids.includes(record.fighter))];
  const used = new Set();
  const copies = records.map(record => {
    if (!record || used.has(record.src?.toLowerCase())) throw new Error('Duplicate or invalid existing media path.');
    used.add(record.src.toLowerCase()); const file = sourceFile(bundle, record.src), bytes = fs.readFileSync(file);
    if (record.sha256 && digest(bytes) !== record.sha256.toLowerCase()) throw new Error(`Source hash mismatch: ${record.src}`);
    return { src: record.src, file };
  });
  for (const record of incoming) if (used.has(record.src.toLowerCase())) throw new Error(`Video path collides with existing media: ${record.src}`);
  fs.mkdirSync(out, { recursive: true });
  for (const record of copies) { const target = path.join(out, record.src); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(record.file, target); }
  for (const record of incoming) { const target = path.join(out, record.src); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, record.bytes); }
  fs.copyFileSync(path.join(bundle, 'assets.json'), path.join(out, 'assets.json'));
  if (audio) fs.copyFileSync(audioPath, path.join(out, 'audio.json'));
  const manifest = { ...oldVideo, fighterIntros: intros };
  fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Prepared ${incoming.length} reviewed fighter introductions in ${out}. No generation submitted.`);
  return manifest;
}
if (require.main === module) {
  try { const options = {}, args = process.argv.slice(2); for (let i = 0; i < args.length; i++) { const key = args[i]; if (!['--bundle', '--clips', '--out', '--fighters'].includes(key) || !args[i + 1] || options[key.slice(2)]) throw new Error('Use --bundle <dir> --clips <dir> --out <fresh dir> [--fighters id,id].'); options[key.slice(2)] = args[++i]; } assemble(options); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assemble };
