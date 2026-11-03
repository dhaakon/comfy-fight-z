// Condense real successful recordings; no simulated progress and no model calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { command } = require('./render-explainer-cards.cjs');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'output/explainer/phone-photo-20261103');
const scene = process.argv[2]; assert.ok(['03-references', '06-generate'].includes(scene), 'Pass 03-references or 06-generate');
const recording = path.join(OUT, 'generation', scene === '03-references' ? 'phase1-personal' : 'phase2-personal');
const report = JSON.parse(fs.readFileSync(path.join(recording, 'recording.json')));
assert.equal(report.events.at(-1).count, report.expected, 'Only completed successful generation footage can enter the explainer');
assert.ok(report.expected === (scene === '03-references' ? 7 : 78));
const source = path.join(recording, report.video), start = report.videoPreparationSeconds;
const sourceSeconds = Math.min(report.elapsedSeconds, report.events.at(-1).elapsed + 2);
const target = scene === '03-references' ? 4 : 10;
const clip = path.join(OUT, 'captures', scene + '.webm'); fs.mkdirSync(path.dirname(clip), { recursive: true });
(async () => {
  const sources = ['-ss', String(start), '-t', String(sourceSeconds), '-i', source];
  // Frame only the actual graph/output counter, excluding the isolated editor's
  // account toolbar. The crop never invents or changes execution progress.
  const generation = `setpts=${(target / sourceSeconds).toFixed(9)}*(PTS-STARTPTS),fps=30,crop=1760:720:80:130,scale=1920:786,pad=1920:1080:0:112:color=0x080d1d,setsar=1,trim=duration=${target},setpts=PTS-STARTPTS`;
  let filter;
  if (scene === '03-references') {
    sources.push('-i', path.join(OUT, 'cards/03-gallery.webm'));
    filter = `[0:v]${generation}[actual];[1:v]trim=duration=8,setpts=PTS-STARTPTS,fps=30,scale=1920:1080,setsar=1[gallery];[actual][gallery]concat=n=2:v=1:a=0[video]`;
  } else filter = `[0:v]${generation},tpad=stop_mode=clone:stop_duration=2,trim=duration=12[video]`;
  await command('ffmpeg', ['-y', '-v', 'error', ...sources, '-filter_complex', filter, '-map', '[video]', '-an', '-t', '12', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', clip]);
  fs.writeFileSync(path.join(OUT, 'captures', scene + '.json'), JSON.stringify({ scene, sourceRecording: path.relative(ROOT, recording).replaceAll('\\', '/'), output: path.relative(ROOT, clip).replaceAll('\\', '/'), actualSavedFiles: report.expected, generationSourceSeconds: sourceSeconds, generationEditSeconds: target, timeLapse: true, note: 'The final compositor labels condensed real generation. Raw count events are preserved in the source recording report; no model calls or fake progress.' }, null, 2) + '\n');
  console.log('Prepared ' + scene + ' from the completed actual run.');
})().catch(error => { console.error(error); process.exitCode = 1; });
