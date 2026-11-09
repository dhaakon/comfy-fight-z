// Assemble accepted screen captures and cloud narration. This command never runs a model.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { sourceFile, directoryTarget } = require('./lib/runtime-validation.cjs');
const PROJECT = path.resolve(__dirname, '../..');
const FPS = 30, WIDTH = 1920, HEIGHT = 1080, HOLD = .5;
const STEM = 'comfy-fighter-z-explainer';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot probe ${file}: ${result.stderr || result.error?.message}`);
  return JSON.parse(result.stdout);
}

function run(program, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => output += String(chunk)); child.stderr.on('data', chunk => output += String(chunk));
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${program} exited ${code}: ${output.slice(-7000)}`)));
  });
}

function stamp(seconds, format = 'srt') {
  const units = format === 'ass' ? 100 : 1000, total = Math.round(Math.max(0, seconds) * units);
  const hour = Math.floor(total / (3600 * units)), minute = Math.floor(total / (60 * units)) % 60, second = Math.floor(total / units) % 60, fraction = total % units;
  if (format === 'chapter') return `${hour ? String(hour).padStart(2, '0') + ':' : ''}${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return `${format === 'ass' ? hour : String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${format === 'ass' ? '.' : ','}${String(fraction).padStart(format === 'ass' ? 2 : 3, '0')}`;
}

function wrap(text, limit = 45) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > limit) { lines.push(line); line = word; }
    else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function captions(narration, duration) {
  const words = narration.trim().split(/\s+/), chunks = []; let current = [];
  for (const word of words) {
    if (current.length && [...current, word].join(' ').length > 83) {
      const punctuation = current.map((word, index) => /[,;:]$/.test(word) ? index : -1).filter(index => index >= 3).pop();
      if (punctuation !== undefined) { chunks.push(current.slice(0, punctuation + 1).join(' ')); current = current.slice(punctuation + 1); }
      else {
        const carry = [];
        while (current.length > 3 && /^(the|a|an|and|or|to|of|with|from|in|on|your|its)$/i.test(current.at(-1))) carry.unshift(current.pop());
        chunks.push(current.join(' ')); current = carry;
      }
    }
    current.push(word);
    if (/[.!?]["”']?$/.test(word) && current.join(' ').length >= 28) { chunks.push(current.join(' ')); current = []; }
  }
  if (current.length) chunks.push(current.join(' '));
  const weights = chunks.map(chunk => chunk.split(/\s+/).reduce((sum, word) => sum + Math.max(1, word.replace(/[^a-z0-9]/gi, '').length / 5) + (/[.!?,;:]$/.test(word) ? .35 : 0), 0));
  const total = weights.reduce((a, b) => a + b, 0), beginning = Math.min(.1, duration / 20), available = duration - beginning - Math.min(.12, duration / 20);
  let time = beginning;
  return chunks.map((text, index) => { const start = time; time += available * weights[index] / total; return { start, end: time, text, wrapped: wrap(text) }; });
}

const assText = text => String(text).replaceAll('\\', '\\u005c').replaceAll('{', '(').replaceAll('}', ')').replaceAll('\n', '\\N');
function ass(scene, index, count, totalDuration, font) {
  const events = [], event = (start, end, style, text, layer = 1) => events.push(`Dialogue: ${layer},${stamp(start, 'ass')},${stamp(end, 'ass')},${style},,0,0,0,,${text}`);
  event(0, scene.duration, 'Brand', '{\\an7\\pos(65,34)}COMFY FIGHTER {\\c&H0053DAFF&}Z');
  event(0, scene.duration, 'Chapter', `{\\an9\\pos(1855,38)}{\\c&H0053DAFF&}${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}{\\c&H00D5DEEC&}    ${assText(scene.title.toUpperCase())}`);
  event(0, scene.duration, 'Footer', `{\\an2\\pos(960,1055)}${scene.silentPreview ? 'SILENT PREVIEW  ·  NARRATION PENDING' : 'WORKFLOW  →  MAPPED ASSETS  →  YOUR PLAYABLE GAME'}`);
  if (scene.id === '03-references') {
    event(0, 4, 'Chapter', '{\\an2\\pos(960,866)\\bord2}ACTUAL COMFYUI RUN  ·  TIME-LAPSE');
    event(4, scene.duration, 'Chapter', '{\\an2\\pos(960,875)\\bord2}AI-GENERATED FICTIONAL ADULTS + ENVIRONMENT');
  }
  if (scene.id === '06-generate' && scene.fixedTimeline) event(0, scene.duration, 'Chapter', '{\\an2\\pos(960,866)\\bord2}ACTUAL COMFYUI RUN  ·  CONDENSED  ·  49 NEW IMAGES + 22 AUDIO CLIPS');
  if (scene.id === '07-review' && scene.fixedTimeline) event(0, scene.duration, 'Chapter', '{\\an2\\pos(960,866)\\bord2}5 OUTPUTS REPAIRED AFTER VISUAL REVIEW');
  if (scene.id === '10-play' && scene.fixedTimeline) {
    event(scene.duration - 4, scene.duration, 'Chapter', '{\\an2\\pos(960,950)\\bord3}PLAY: comfy-fight-z.dhaakon.com/phone-photo-demo/');
    event(scene.duration - 4, scene.duration, 'Chapter', '{\\an2\\pos(960,990)\\bord3}BUILD: github.com/dhaakon/comfy-fight-z');
  }
  for (let time = 0; time < scene.duration; time += .25) {
    const progress = Math.max(1, Math.round(1790 * (scene.start + time) / totalDuration));
    event(time, Math.min(time + .25, scene.duration), 'Shape', `{\\an7\\pos(65,98)\\p1\\c&H00DFE68A&}m 0 0 l ${progress} 0 l ${progress} 3 l 0 3`, 0);
  }
  for (const cue of scene.captions) event(cue.start, cue.end, 'Caption', `{\\an2\\pos(960,1008)}${assText(cue.wrapped)}`);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${WIDTH}\nPlayResY: ${HEIGHT}\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Brand,${font},28,&H00F6F6F9,&H00F6F6F9,&H00201108,&H00000000,-1,0,0,0,100,100,1.2,0,1,0,0,7,65,65,25,1\nStyle: Chapter,${font},21,&H00D5DEEC,&H00D5DEEC,&H00201108,&H00000000,0,0,0,0,100,100,.6,0,1,0,0,9,65,65,25,1\nStyle: Caption,${font},38,&H00F9FAFF,&H00F9FAFF,&H00120805,&H50000000,-1,0,0,0,100,100,0,0,1,1,1,2,120,120,70,1\nStyle: Footer,${font},13,&H00A6B1C5,&H00A6B1C5,&H00000000,&H00000000,0,0,0,0,100,100,2,0,1,0,0,2,65,65,20,1\nStyle: Shape,${font},1,&H00DFE68A,&H00DFE68A,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`;
}

function fonts(work) {
  const folder = path.join(work, 'fonts'); fs.mkdirSync(folder);
  const candidates = process.platform === 'win32' ? [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts/arial.ttf'), path.join(process.env.WINDIR || 'C:/Windows', 'Fonts/arialbd.ttf')]
    : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
  for (const file of candidates) { if (!fs.existsSync(file)) throw new Error(`Subtitle font unavailable: ${file}`); fs.copyFileSync(file, path.join(folder, path.basename(file))); }
  return process.platform === 'win32' ? 'Arial' : 'DejaVu Sans';
}

function planScenes(config, root, selected, silentPreview = false) {
  if (config.width !== WIDTH || config.height !== HEIGHT || config.fps !== FPS || !Array.isArray(config.scenes) || !config.scenes.length) throw new Error('Explainer configuration requires 1920×1080, 30fps and scenes.');
  const ids = new Set(); let start = 0;
  const scenes = config.scenes.filter(scene => !selected || scene.id === selected).map(scene => {
    if (!/^[0-9]{2}-[a-z0-9-]+$/.test(scene.id) || ids.has(scene.id) || !scene.narration?.trim() || !scene.title) throw new Error('Invalid or duplicate explainer scene.'); ids.add(scene.id);
    const video = sourceFile(root, scene.visual), audio = silentPreview ? null : sourceFile(root, scene.audio), backgroundAudio = !silentPreview && scene.backgroundAudio ? sourceFile(root, scene.backgroundAudio) : null, videoProbe = probe(video), audioProbe = audio ? probe(audio) : null;
    const videoStream = videoProbe.streams.find(stream => stream.codec_type === 'video'), audioStream = audioProbe?.streams.find(stream => stream.codec_type === 'audio');
    const videoDuration = Number(videoStream?.duration || videoProbe.format?.duration), audioDuration = silentPreview ? Number(scene.targetSeconds) - HOLD : Number(audioStream?.duration || audioProbe?.format?.duration);
    if (!videoStream || !silentPreview && !audioStream || !Number.isFinite(videoDuration) || videoDuration < 1 || !Number.isFinite(audioDuration) || audioDuration <= .2 || audioDuration > 120) throw new Error(`Invalid video or narration duration: ${scene.id}`);
    const fixed = config.durationMode === 'fixed';
    const duration = fixed ? Number(scene.targetSeconds) : Math.ceil((audioDuration + HOLD) * FPS) / FPS;
    if (!Number.isFinite(duration) || duration <= HOLD || Math.abs(duration * FPS - Math.round(duration * FPS)) > .00001) throw new Error(`Scene duration is not frame-aligned: ${scene.id}`);
    const narrationTempo = fixed ? Math.max(1, audioDuration / (duration - .35)) : 1;
    if (narrationTempo > 1.35) throw new Error(`Narration is too long for the fixed chapter: ${scene.id}. Trim silence or review the edit before composing.`);
    const spokenDuration = audioDuration / narrationTempo;
    // Preserve every demonstrated click/result in captured UI footage. Cards may trim their quiet tail.
    const speed = fixed && scene.id === '10-play' ? 1 : scene.visual.startsWith('captures/') ? Math.min(1.12, duration / videoDuration) : Math.max(1, Math.min(1.12, duration / videoDuration));
    // Captions show the spoken text, or a scene's captionText where the voice spells something out (an address).
    const result = { ...scene, index: config.scenes.indexOf(scene), silentPreview, fixedTimeline: fixed, video, audio, backgroundAudio, videoDuration, audioDuration, narrationTempo, spokenDuration, duration, start, end: start + duration, slowFactor: speed, holdLastFrame: Math.max(0, duration - videoDuration * speed), captions: captions(scene.captionText || scene.narration, spokenDuration), sourceSha256: { audio: audio ? hash(audio) : null, backgroundAudio: backgroundAudio ? hash(backgroundAudio) : null, video: hash(video) } };
    start += duration; return result;
  });
  if (!scenes.length) throw new Error(`Unknown scene: ${selected}`);
  if (!selected && config.durationMode === 'fixed' && Math.abs(start - config.targetDurationSeconds) > .00001) throw new Error('Fixed chapter durations must match the exact target duration.');
  return { scenes, duration: start };
}

async function compose({ root = path.join(PROJECT, 'output/explainer/20261103'), config: configPath = path.join(PROJECT, 'comfyui/config/explainer.json'), scene: selected, overwrite = false, silentPreview = false } = {}) {
  root = path.resolve(root); configPath = path.resolve(configPath);
  if (!root.startsWith(path.join(PROJECT, 'output/explainer') + path.sep) || directoryTarget(root) !== root) throw new Error('Explainer output must be under output/explainer/ without redirected paths.');
  const config = read(configPath), plan = planScenes(config, root, selected, silentPreview);
  if (config.outputStem && !/^[a-z0-9-]+$/.test(config.outputStem)) throw new Error('Invalid explainer filename stem.');
  const stem = (selected ? `preview-${selected}` : config.outputStem || STEM) + (silentPreview ? '-silent-preview' : '');
  const artifacts = ['.mp4', '.srt', '.transcript.txt', '.chapters.txt', '.poster.jpg'].map(extension => path.join(root, stem + extension));
  const reportFile = path.join(root, selected || silentPreview ? `${stem}-report.json` : 'render-report.json'); artifacts.push(reportFile);
  const existing = artifacts.filter(file => fs.existsSync(file));
  if (existing.length && !overwrite) throw new Error('Rendered artifacts already exist. Use --overwrite to archive them before a new render.');
  if (existing.length) {
    const archive = path.join(root, 'previous-renders', String(Date.now())); fs.mkdirSync(archive, { recursive: true });
    for (const file of existing) { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Rendered outputs cannot be symbolic links.'); fs.renameSync(file, path.join(archive, path.basename(file))); }
  }
  const workRoot = path.join(root, 'work'); fs.mkdirSync(workRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(workRoot, 'render-')), font = fonts(work);
  const report = { status: 'rendering', title: config.title, silentPreview, generatedAt: new Date().toISOString(), width: WIDTH, height: HEIGHT, fps: FPS, voiceProcessing: silentPreview ? 'Explicitly silent review using storyboard target timings; no narration supplied' : 'Narration -16 LUFS target, -1.5 dBTP ceiling; optional explicitly mapped game music at -28 LUFS. Fixed timelines use bounded pitch-preserving tempo adjustment and silence padding, no repeated narration.', transitions: 'Short visual fade at chapter boundaries; narration is never crossfaded or repeated', subtitleTiming: 'Exact script text, phrase timing proportional to each measured narration clip; not forced word alignment', duration: plan.duration, configSha256: hash(configPath), sourceGame: config.sourceGame || 'output/exports/smoke-20261103-0548', scenes: plan.scenes, work };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  let cueNumber = 0, srt = '';
  for (const scene of plan.scenes) for (const cue of scene.captions) srt += `${++cueNumber}\n${stamp(scene.start + cue.start)} --> ${stamp(scene.start + cue.end)}\n${cue.wrapped}\n\n`;
  fs.writeFileSync(path.join(root, stem + '.srt'), srt);
  fs.writeFileSync(path.join(root, stem + '.transcript.txt'), `${config.title} — ${config.subtitle}\n\n${config.footageDisclosure}\n\n${plan.scenes.map(scene => `${stamp(scene.start, 'chapter')}  ${scene.title}\n${scene.narration}`).join('\n\n')}\n`);
  fs.writeFileSync(path.join(root, stem + '.chapters.txt'), plan.scenes.map(scene => `${stamp(scene.start, 'chapter')} ${scene.title}`).join('\n') + '\n');
  try {
    for (const scene of plan.scenes) {
      const captionFile = `${scene.id}.ass`, output = `${scene.id}.mov`;
      fs.writeFileSync(path.join(work, captionFile), ass(scene, scene.index, config.scenes.length, plan.duration, font));
      const framing = scene.fixedTimeline && scene.id === '10-play' ? 'scale=1360:765,pad=1920:1080:280:120:color=0x080d1d' : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x080d1d`;
      const video = `setpts=${scene.slowFactor.toFixed(6)}*(PTS-STARTPTS),${framing},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.max(1, scene.holdLastFrame + .5).toFixed(3)},trim=duration=${scene.duration.toFixed(6)},fade=t=in:st=0:d=0.2,fade=t=out:st=${(scene.duration - .25).toFixed(6)}:d=0.25,drawbox=x=0:y=0:w=iw:h=${scene.fixedTimeline && ['04-upload', '05-design'].includes(scene.id) ? 130 : 112}:color=0x080d1d@1:t=fill,drawbox=x=65:y=98:w=1790:h=3:color=0x23334c@1:t=fill,drawbox=x=0:y=890:w=iw:h=190:color=0x080d1d@0.94:t=fill,ass=${captionFile}:fontsdir=fonts`;
      const audio = `atempo=${scene.narrationTempo.toFixed(6)},loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,apad=whole_dur=${scene.duration.toFixed(6)},atrim=duration=${scene.duration.toFixed(6)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.012,afade=t=out:st=${(scene.duration - .2).toFixed(6)}:d=0.2`;
      const audioInput = silentPreview ? ['-f', 'lavfi', '-i', 'anullsrc=sample_rate=48000:channel_layout=stereo'] : ['-i', scene.audio];
      const mixing = scene.backgroundAudio ? ['-i', scene.backgroundAudio, '-filter_complex', `[1:a]${audio}[speech];[2:a]atrim=duration=${scene.duration},asetpts=PTS-STARTPTS,loudnorm=I=-28:TP=-8:LRA=7,aresample=48000,afade=t=in:st=0:d=1.2,afade=t=out:st=${scene.duration - 1}:d=1[music];[speech][music]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.89:level=0[mixed]`, '-map', '[mixed]'] : ['-map', '1:a:0', '-af', audio];
      // Keep chapter audio uncompressed. Encoding AAC per chapter adds encoder padding
      // at every join, shifting subtitles and breaking the exact 30fps timeline.
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-i', scene.video, ...audioInput, ...mixing, '-map', '0:v:0', '-vf', video, '-t', scene.duration.toFixed(6), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-y', output], work);
      const actual = probe(path.join(work, output));
      scene.encodedDuration = Number(actual.format.duration); scene.file = path.join(work, output);
      console.log(`${scene.id}: ${scene.audioDuration.toFixed(2)}s narration → ${scene.duration.toFixed(2)}s chapter.`);
    }
    // Explicit frame-aligned durations avoid accumulating container rounding at joins.
    fs.writeFileSync(path.join(work, 'concat.txt'), plan.scenes.map(scene => `file '${scene.id}.mov'\nduration ${scene.duration.toFixed(9)}`).join('\n') + '\n');
    const metadata = `;FFMETADATA1\ntitle=${config.title} — Build your own game\ncomment=${silentPreview ? 'Silent captioned preview; no narration supplied. Real fictional generated game assets and screen captures.' : 'Real fictional generated game assets; screen captures and exact-script cloud narration.'}\n${plan.scenes.map(scene => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(scene.start * 1000)}\nEND=${Math.round(scene.end * 1000)}\ntitle=${scene.title.replace(/[=;#\\\n]/g, ' ')}`).join('\n')}\n`;
    fs.writeFileSync(path.join(work, 'chapters.ffmetadata'), metadata);
    const movie = path.join(root, stem + '.mp4');
    // AAC priming adds 1024 samples to the MP4 movie header in this encoder.
    // Trim only the padded silent tail so fixed-duration containers remain exact.
    const tail = config.durationMode === 'fixed' ? `atrim=duration=${(plan.duration - 1024 / 48000).toFixed(6)}` : null;
    // An optional continuous music bed (config.music, under the run) plays under the whole piece, looped if it is
    // shorter, ducked under the narration by a sidechain compressor and faded at both ends.
    const music = config.music ? sourceFile(root, config.music) : null;
    const musicInput = music ? ['-stream_loop', '-1', '-i', music] : [];
    const audioMap = music ? ['-filter_complex',
      `[0:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=2[speech][key];[2:a]atrim=duration=${plan.duration.toFixed(6)},asetpts=PTS-STARTPTS,aresample=48000,loudnorm=I=${Number(config.musicLUFS) || -25}:TP=-6:LRA=9,afade=t=in:st=0:d=1.5,afade=t=out:st=${(plan.duration - 2.5).toFixed(6)}:d=2.5,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[raw];[raw][key]sidechaincompress=threshold=0.03:ratio=5:attack=15:release=350[bed];[speech][bed]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.93:level=0${tail ? ',' + tail : ''}[mixed]`, '-map', '[mixed]']
      : ['-map', '0:a:0', ...(tail ? ['-af', tail] : [])];
    report.music = music ? { file: path.relative(root, music).split(path.sep).join('/'), sha256: hash(music), lufs: Number(config.musicLUFS) || -25, ducking: 'sidechain compressor keyed by the narration' } : null;
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-i', 'chapters.ffmetadata', ...musicInput, '-map', '0:v:0', ...audioMap, '-map_metadata', '1', '-map_chapters', '1', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-t', plan.duration.toFixed(6), '-movflags', '+faststart', '-y', movie], work);
    const result = probe(movie), v = result.streams.find(stream => stream.codec_type === 'video'), a = result.streams.find(stream => stream.codec_type === 'audio');
    if (v?.codec_name !== 'h264' || v.width !== WIDTH || v.height !== HEIGHT || v.avg_frame_rate !== '30/1' || v.pix_fmt !== 'yuv420p' || a?.codec_name !== 'aac' || Math.abs(Number(result.format.duration) - plan.duration) > .6) throw new Error('Final media verification failed. Inspect intermediate scene files.');
    if (config.durationMode === 'fixed' && (Number(v.nb_frames) !== Math.round(plan.duration * FPS) || Math.abs(Number(result.format.duration) - plan.duration) > .04)) throw new Error('Fixed timeline must match its exact frame count and duration.');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(3, plan.duration / 3)), '-i', movie, '-frames:v', '1', '-q:v', '2', '-y', path.join(root, stem + '.poster.jpg')], work);
    report.status = 'complete'; report.actualDuration = Number(result.format.duration); report.bytes = fs.statSync(movie).size; report.sha256 = hash(movie); report.video = v; report.audio = a;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(`Finished ${movie}\n${report.actualDuration.toFixed(2)} seconds · ${(report.bytes / 1024 / 1024).toFixed(1)} MB · 1080p/30 H.264 + AAC`);
    return report;
  } catch (error) { report.status = 'failed'; report.error = error.message; fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); throw error; }
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--overwrite') { options.overwrite = true; continue; }
    if (args[i] === '--silent-preview') { options.silentPreview = true; continue; }
    if (!['--root', '--config', '--scene'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node build/tools/compose-explainer.cjs [--root output/explainer/20261103] [--config comfyui/config/explainer.json] [--scene 02-setup] [--silent-preview] [--overwrite]');
    options[args[i].slice(2)] = args[++i];
  }
  compose(options).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { compose, captions, wrap, stamp, ass, planScenes, probe };
