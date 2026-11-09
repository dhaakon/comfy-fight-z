// Place recorded narration into a teaser or explainer run: copy each scene's FLAC from ComfyUI's output folder into
// narration/raw/, trim the leading and trailing silence with FFmpeg, and write audio/<scene>.flac for the composer.
// Never submits a model request.
//   node comfyui/tools/place-narration.cjs [--config comfyui/config/teaser.json] [--out output/explainer/<run>]
//        [--comfy-output <ComfyUI output folder>] [--max-tempo 1.35]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const settings = { config: 'comfyui/config/teaser.json', out: 'output/explainer/teaser-v2-20261109', comfyOutput: path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents/ComfyUI/output'), maxTempo: '1.35' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = { '--config': 'config', '--out': 'out', '--comfy-output': 'comfyOutput', '--max-tempo': 'maxTempo' }[args[i]];
  if (!key || !args[i + 1]) throw new Error('Usage: node comfyui/tools/place-narration.cjs [--config <json>] [--out <run>] [--comfy-output <folder>] [--max-tempo 1.35]');
  settings[key] = args[i + 1];
}
const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.config), 'utf8'));
const run = path.resolve(ROOT, settings.out), source = path.join(path.resolve(settings.comfyOutput), 'comfy-fighter-z/explainer', path.basename(run));
const raw = path.join(run, 'narration/raw'), audio = path.join(run, 'audio');
fs.mkdirSync(raw, { recursive: true }); fs.mkdirSync(audio, { recursive: true });
const probe = file => Number(JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }).stdout).format.duration);
const placed = [];
for (const scene of config.scenes) {
  const candidates = fs.readdirSync(source).filter(name => name.startsWith(`${scene.id}_`) && name.endsWith('.flac')).sort();
  if (!candidates.length) throw new Error(`No recording for ${scene.id} under ${source}`);
  const recorded = path.join(source, candidates[candidates.length - 1]), copy = path.join(raw, `${scene.id}.flac`), target = path.join(audio, `${scene.id}.flac`);
  fs.copyFileSync(recorded, copy);
  const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', copy, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse', '-c:a', 'flac', target], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`FFmpeg failed on ${scene.id}: ${result.stderr}`);
  const before = probe(copy), after = probe(target), tempo = after / (scene.targetSeconds - .35);
  placed.push({ id: scene.id, recorded: candidates[candidates.length - 1], seconds: Number(before.toFixed(2)), trimmed: Number(after.toFixed(2)), targetSeconds: scene.targetSeconds, tempo: Number(Math.max(1, tempo).toFixed(3)) });
  if (tempo > Number(settings.maxTempo)) console.warn(`  ${scene.id}: ${after.toFixed(2)}s of speech needs ${tempo.toFixed(2)}x tempo for its ${scene.targetSeconds}s scene; shorten the narration or give the scene more time.`);
}
fs.writeFileSync(path.join(run, 'narration/placed.json'), JSON.stringify({ placedAt: new Date().toISOString(), source, trim: 'silenceremove -45 dB, 60 ms head / 120 ms tail', clips: placed }, null, 2) + '\n');
console.log(placed.map(clip => `${clip.id}: ${clip.seconds}s → ${clip.trimmed}s for ${clip.targetSeconds}s (tempo ${clip.tempo})`).join('\n'));
