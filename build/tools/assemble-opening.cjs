// Normalize an accepted Seedance movie for browsers; no model calls or still-frame substitutions.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { directoryTarget, isInside } = require('./lib/runtime-validation.cjs');
const DURATION = 25;

function command(program, args) {
  const result = spawnSync(program, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${program} failed: ${result.error?.message || result.stderr || 'unknown error'}`);
  return result.stdout;
}

function probe(file) {
  return JSON.parse(command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
}

function validateSource(metadata) {
  const video = metadata.streams?.find(stream => stream.codec_type === 'video');
  const audio = metadata.streams?.find(stream => stream.codec_type === 'audio');
  if (!video || !Number.isFinite(video.width) || !Number.isFinite(video.height) || video.width < 2 || video.height < 2) throw new Error('Source needs a decodable video stream.');
  if (!audio) throw new Error('Source needs its generated audio stream; no substitute audio is synthesized.');
  if (Math.abs(video.width / video.height - 16 / 9) > .03) throw new Error('Source must be landscape 16:9; assembly never stretches or crops it.');
  const videoDuration = Number(video.duration || metadata.format?.duration), audioDuration = Number(audio.duration || metadata.format?.duration);
  // A provider may return one extra frame. Tiny trailing padding is acceptable; a short clip is not a 25-second opening.
  for (const [kind, duration] of [['video', videoDuration], ['audio', audioDuration]]) if (!Number.isFinite(duration) || duration < 24.75 || duration > 25.5) throw new Error(`Source ${kind} duration must be 24.75–25.5 seconds; received ${duration}. Refusing to manufacture a longer opening.`);
  return { video, audio, videoDuration, audioDuration };
}

function assemble({ input, out }) {
  input = fs.realpathSync(input); out = directoryTarget(out);
  if (!fs.statSync(input).isFile()) throw new Error('Input must be a video file.');
  if (!isInside(out, directoryTarget(path.join(out, 'raw')))) throw new Error('Output raw directory must remain inside the requested root.');
  const destination = path.join(out, 'raw/opening.mp4'), manifestPath = path.join(out, 'video.json');
  if (destination === input || isInside(path.join(out, 'raw'), input)) throw new Error('Use a separate output root for the accepted source video.');
  if (fs.existsSync(destination) || fs.existsSync(manifestPath)) throw new Error('Output video or map already exists; choose a new output root.');
  const original = validateSource(probe(input));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(out, 'raw', `.opening-${process.pid}-${Date.now()}.mp4`);
  command('ffmpeg', ['-v', 'error', '-nostdin', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '-1',
    '-vf', 'fps=24,tpad=stop_mode=clone:stop_duration=0.25,trim=duration=25,setpts=PTS-STARTPTS,format=yuv420p',
    '-af', 'apad=pad_dur=0.25,atrim=duration=25,asetpts=PTS-STARTPTS',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', String(DURATION), '-movflags', '+faststart', '-y', temporary]);
  const result = probe(temporary), video = result.streams.find(stream => stream.codec_type === 'video'), audio = result.streams.find(stream => stream.codec_type === 'audio');
  if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || audio?.codec_name !== 'aac' || Number(video.nb_frames) !== 600 || Math.abs(Number(video.duration) - DURATION) > .001 || Math.abs(Number(audio.duration) - DURATION) > .025 || Math.abs(Number(result.format?.duration) - DURATION) > .05) throw new Error(`Browser codec/duration verification failed; inspect ${temporary}`);
  if (video.width !== original.video.width || video.height !== original.video.height) throw new Error('Assembly unexpectedly changed source dimensions.');
  const bytes = fs.readFileSync(temporary), sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = { schema: 'comfy-fighter-video/v1', root: '.', openingVideo: { id: 'opening', src: 'raw/opening.mp4', duration: DURATION, sha256 } };
  fs.renameSync(temporary, destination);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'video-build.json'), JSON.stringify({ source: path.basename(input), sourceSha256: createHash('sha256').update(fs.readFileSync(input)).digest('hex'), sourceVideoDuration: original.videoDuration, sourceAudioDuration: original.audioDuration, duration: Number(video.duration), audioDuration: Number(audio.duration), containerDuration: Number(result.format.duration), frames: Number(video.nb_frames), width: video.width, height: video.height, videoCodec: video.codec_name, audioCodec: audio.codec_name, pixelFormat: video.pix_fmt, frameRate: video.avg_frame_rate, bytes: bytes.length, sha256 }, null, 2) + '\n');
  console.log(`Prepared ${DURATION}-second ${video.width}x${video.height} H.264/AAC opening and video.json. No model inference performed.`);
  return manifest;
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { if (!['--input', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node build/tools/assemble-opening.cjs --input <accepted source.mp4> --out <separate output root>'); options[args[i].slice(2)] = path.resolve(args[i + 1]); }
  if (!options.input || !options.out) throw new Error('--input and --out are required.');
  assemble(options);
}
module.exports = { assemble, probe, validateSource };
