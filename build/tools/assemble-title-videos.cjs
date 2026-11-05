// Assemble reviewed title/opening clips into a fresh bundle without model calls.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { sourceFile, directoryTarget, isInside } = require('./lib/runtime-validation.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function assemble({ bundle, title, opening, out }) {
  if (![bundle, out].every(value => value && path.isAbsolute(value)) || ![title, opening].some(Boolean) || [title, opening].some(value => value && !path.isAbsolute(value))) throw new Error('Use absolute --bundle, --out, and --title and/or --opening paths.');
  bundle = fs.realpathSync(bundle); out = directoryTarget(out);
  if (fs.existsSync(out) || out === bundle || isInside(bundle, out) || isInside(out, bundle)) throw new Error('Choose a fresh output outside the source bundle.');
  const read = name => JSON.parse(fs.readFileSync(sourceFile(bundle, name), 'utf8'));
  const images = read('assets.json');
  if (images.schema !== 'comfy-fighter-assets/v1' || images.root !== '.' || images.partial || !Array.isArray(images.assets)) throw new Error('Use a complete image bundle.');
  const audio = fs.existsSync(path.join(bundle, 'audio.json')) ? read('audio.json') : null;
  if (audio && (audio.root !== '.' || !Array.isArray(audio.assets))) throw new Error('Invalid audio manifest.');
  const mapped = fs.existsSync(path.join(bundle, 'video.json')) ? read('video.json') : { schema: 'comfy-fighter-video/v1', root: '.' };
  if (mapped.schema !== 'comfy-fighter-video/v1' || mapped.root !== '.' || mapped.fighterIntros !== undefined && !Array.isArray(mapped.fighterIntros)) throw new Error('Invalid video manifest.');
  if (title && mapped.titleVideo || opening && mapped.openingVideo) throw new Error('The bundle already has one of these videos; use a separate bundle or remove the old mapping explicitly before assembly.');
  const incoming = [];
  for (const [id, source] of [['title', title], ['opening', opening]]) if (source) {
    const file = fs.realpathSync(source);
    if (!fs.statSync(file).isFile() || file === out || isInside(out, file)) throw new Error(`Invalid ${id} source.`);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`Cannot inspect ${id}: ${probe.error?.message || probe.stderr}`);
    const info = JSON.parse(probe.stdout), video = info.streams?.find(stream => stream.codec_type === 'video');
    const duration = Number(video?.duration || info.format?.duration);
    if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width < 640 || Math.abs(video.width / video.height - 16 / 9) > .04 || duration < 7.75 || duration > 8.3 || info.streams?.some(stream => stream.codec_type === 'audio')) throw new Error(`${id}: expected silent, approximately 8-second 16:9 H.264/yuv420p MP4.`);
    const bytes = fs.readFileSync(file);
    incoming.push({ id, src: `raw/${id}.mp4`, duration, sha256: sha(bytes), hasAudio: false, bytes });
  }
  const existing = [...images.assets, ...(audio?.assets || []), ...(mapped.openingVideo ? [mapped.openingVideo] : []), ...(mapped.titleVideo ? [mapped.titleVideo] : []), ...(mapped.fighterIntros || [])];
  const used = new Set();
  const copies = existing.map(record => {
    if (!record || typeof record.src !== 'string' || used.has(record.src.toLowerCase())) throw new Error('Duplicate or invalid existing media path.');
    used.add(record.src.toLowerCase()); const file = sourceFile(bundle, record.src), bytes = fs.readFileSync(file);
    if (record.sha256 && sha(bytes) !== record.sha256.toLowerCase()) throw new Error(`Source hash mismatch: ${record.src}`);
    return { src: record.src, file };
  });
  for (const video of incoming) if (used.has(video.src.toLowerCase())) throw new Error(`Video path collides with existing media: ${video.src}`);
  fs.mkdirSync(out, { recursive: true });
  for (const entry of copies) { const dest = path.join(out, entry.src); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(entry.file, dest); }
  fs.copyFileSync(path.join(bundle, 'assets.json'), path.join(out, 'assets.json'));
  if (audio) fs.copyFileSync(path.join(bundle, 'audio.json'), path.join(out, 'audio.json'));
  for (const video of incoming) {
    const { bytes, ...record } = video, dest = path.join(out, video.src);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    mapped[video.id === 'title' ? 'titleVideo' : 'openingVideo'] = record;
  }
  fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify(mapped, null, 2) + '\n');
  console.log(`Prepared ${incoming.length} reviewed title/opening videos in ${out}; no generation submitted.`);
  return mapped;
}
if (require.main === module) {
  try { const options = {}, args = process.argv.slice(2); for (let i = 0; i < args.length; i++) { const key = args[i]; if (!['--bundle', '--title', '--opening', '--out'].includes(key) || !args[i + 1] || options[key.slice(2)]) throw new Error('Use --bundle <dir> --title <mp4> --opening <mp4> --out <fresh dir>.'); options[key.slice(2)] = args[++i]; } assemble(options); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assemble };
