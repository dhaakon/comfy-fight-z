// End-to-end rehearsal of the arcade expansion without model calls: synthetic stand-ins in the
// exact ComfyUI patch/audio formats -> saga merge onto a classic base (derived from the shipped
// arcade example) -> strict browser build -> runtime checks. Add --package to also run FFmpeg packaging against the arcade
// contract, and --keep to leave the run folder under output/test-runs/ for review.
//   node build/test/expansion-pipeline.cjs [--package] [--keep]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createCanvas } = require('@napi-rs/canvas');
const { merge } = require('../tools/merge-bundles.cjs');
const { verifyBundle } = require('../tools/lib/example-bundle.cjs');
const root = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const config = read('comfyui/config/game.json'), plan = read('comfyui/assets/plan.json'), audioPlan = read('comfyui/assets/audio-plan.json');
const args = new Set(process.argv.slice(2));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const SIZE = { '1:1': [1024, 1024], '2:3': [848, 1264], '3:2': [1264, 848], '16:9': [1376, 768] };
const SIZE2K = { '1:1': [2048, 2048], '2:3': [1696, 2528], '16:9': [2752, 1536] };
const colorOf = job => {
  const color = config.fighters.find(fighter => fighter.id === job.fighter)?.color || '#b03a2e';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return g - Math.max(r, b) > 20 ? '#b03a2e' : color;
};
// One connected silhouette per pose, so the sheet segmenter finds nine separate figures.
function figure(context, cx, cy, size, color, variant) {
  context.fillStyle = color; context.strokeStyle = color; context.lineCap = 'round'; context.lineWidth = size * .09;
  context.beginPath(); context.arc(cx, cy - size * .38, size * .1, 0, Math.PI * 2); context.fill();
  context.fillRect(cx - size * .1, cy - size * .28, size * .2, size * .34);
  const reach = (variant % 3) * .1, stride = (variant % 2) * .08;
  for (const [x1, y1, x2, y2] of [[0, -.2, .22 + reach, -.18 - reach], [0, -.2, -.2, -.05], [-.05, .05, -.14 - stride, .4], [.05, .05, .14 + stride, .4]]) {
    context.beginPath(); context.moveTo(cx + size * x1, cy + size * y1); context.lineTo(cx + size * x2, cy + size * y2); context.stroke();
  }
  context.fillStyle = '#26211d';
  context.fillRect(cx - size * (.22 + stride), cy + size * .37, size * .14, size * .06); context.fillRect(cx + size * (.08 + stride), cy + size * .37, size * .16, size * .06);
}
function standIn(job) {
  const [width, height] = (job.resolution === '2K' ? SIZE2K : SIZE)[job.aspect] || [1024, 1024];
  const canvas = createCanvas(width, height), context = canvas.getContext('2d');
  const opaque = job.kind === 'ending' || job.kind === 'stage' || job.kind === 'source' && job.stage;
  if (opaque) {
    const sky = context.createLinearGradient(0, 0, 0, height); sky.addColorStop(0, '#2b3557'); sky.addColorStop(.8, '#c98d5a'); sky.addColorStop(1, '#6d4a32');
    context.fillStyle = sky; context.fillRect(0, 0, width, height); context.fillStyle = '#5b3d2a'; context.fillRect(0, height * .82, width, height * .18);
    if (job.kind === 'ending') figure(context, width / 2, height * .55, height * .7, colorOf(job), 1);
  } else {
    context.fillStyle = '#00ff00'; context.fillRect(0, 0, width, height);
    if (job.kind === 'sprites') for (let i = 0; i < 9; i++) figure(context, width / 3 * (i % 3 + .5), height / 3 * (Math.floor(i / 3) + .5), height / 3 * .6, colorOf(job), i);
    else figure(context, width / 2, height / 2, Math.min(width, height) * .75, colorOf(job), 2);
  }
  return { bytes: canvas.toBuffer('image/png'), width, height };
}
function wav(index) {
  const rate = 22050, samples = Math.round(rate * .25), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * (220 + index * 7)) * 6000 * (1 - i / samples)), 44 + i * 2);
  return data;
}
// The shipped example is the arcade release: derive the classic base it grew from (six fighters,
// The Yard, the 56 classic images and 22 clips), with packaging evidence for exactly those files.
const CLASSIC_AUDIO = ['menu_music', 'yard_music', 'ann_select', 'ann_go', 'ann_ko', 'ann_victory', 'sfx_punch', 'sfx_kick', 'sfx_block', 'sfx_special'];
function classicBase(source, folder) {
  const read = file => JSON.parse(fs.readFileSync(path.join(source, file), 'utf8'));
  const manifest = read('assets.json'), audio = read('audio.json'), provenance = read('provenance.json');
  const game = structuredClone(manifest.game); delete game.extraSheets;
  game.fighters = game.fighters.filter(fighter => !fighter.boss); game.stages = game.stages.slice(0, 1);
  const fighters = new Set(game.fighters.map(fighter => fighter.id)), stage = game.stages[0].id;
  const images = manifest.assets.filter(record => record.fighter ? fighters.has(record.fighter) && !['sheetD', 'sheetE'].includes(record.sheet) && record.kind !== 'ending'
    : record.stage ? record.stage === stage : true);
  const clips = audio.assets.filter(record => CLASSIC_AUDIO.includes(record.id) || /^fighter_.+_(intro|special)$/.test(record.id) && fighters.has(record.fighter));
  for (const record of [...images, ...clips]) write(path.join(folder, record.src), fs.readFileSync(path.join(source, record.src)));
  game.expectedAssets = images.map(record => record.id); game.expectedAudio = clips.map(record => record.id);
  const keep = (list, records) => list.filter(item => records.some(record => record.id === item.id));
  write(path.join(folder, 'assets.json'), JSON.stringify({ ...manifest, game, assets: images }));
  write(path.join(folder, 'audio.json'), JSON.stringify({ ...audio, assets: clips }));
  write(path.join(folder, 'provenance.json'), JSON.stringify({ ...provenance, images: keep(provenance.images, images), audio: keep(provenance.audio, clips), previous: undefined }));
}
(async () => {
  const run = path.join(root, 'output/test-runs', `expansion-pipeline-${randomUUID()}`);
  try {
    let base = path.join(root, 'example/bundle');
    if ((await verifyBundle(base)).contract.name === 'arcade') { classicBase(base, path.join(run, 'classic')); base = path.join(run, 'classic'); }
    const classic = await verifyBundle(base);
    assert.equal(classic.contract.name, 'classic', 'The rehearsal expands a classic base');
    // 1. The expansion run's outputs: a partial image patch (as CFZExportAssetPatch writes it) and the complete audio set.
    const baseIds = new Set(classic.manifest.assets.map(record => record.id)), jobs = plan.jobs.filter(job => !baseIds.has(job.id));
    const assets = jobs.map(job => {
      const { bytes, width, height } = standIn(job), digest = hash(bytes), src = `raw/${job.id}-${digest.slice(0, 16)}.png`;
      write(path.join(run, 'patch', src), bytes);
      const record = Object.fromEntries(['id', 'kind', 'fighter', 'stage', 'sheet', 'poses', 'key'].filter(key => job[key] !== undefined).map(key => [key, job[key]]));
      return { ...record, src, sha256: digest, width, height };
    });
    assert.equal(assets.length, 33, 'The expansion adds 33 images to the classic example');
    write(path.join(run, 'patch/assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', cloudOnly: true, partial: true, game: { ...config, expectedAssets: assets.map(a => a.id) }, assets }, null, 2));
    // Records carry only the fields CFZSaveAudio keeps (see _audio_metadata), so plan-only fields cannot hide a mismatch.
    const audio = audioPlan.jobs.map((job, index) => {
      const bytes = wav(index), src = `raw/${job.id}.wav`; write(path.join(run, 'audio', src), bytes);
      return { id: job.id, kind: 'audio', category: job.category, ...(job.fighter ? { fighter: job.fighter } : {}), ...(job.loop !== undefined ? { loop: job.loop } : {}),
        src, sha256: hash(bytes), sampleRate: 22050, channels: 1, duration: .25 };
    });
    write(path.join(run, 'audio/audio.json'), JSON.stringify({ schema: 'comfy-fighter-audio/v1', root: '.', title: config.title, assets: audio }, null, 2));
    console.log(`PASS stand-ins: ${assets.length} images and ${audio.length} clips in the expansion's patch formats`);
    // 2. Saga merge onto the real classic example.
    merge({ saga: true, base, patches: [path.join(run, 'patch'), path.join(run, 'audio')], out: path.join(run, 'merged') });
    const report = JSON.parse(fs.readFileSync(path.join(run, 'merged/update-report.json'), 'utf8'));
    assert.equal(report.imageAssets, plan.jobs.length); assert.equal(report.audioAssets, audioPlan.jobs.length);
    const verified = await verifyBundle(path.join(run, 'merged'), { packaged: false });
    assert.equal(verified.contract.name, 'arcade'); assert.equal(verified.poseCount, config.fighters.length * 45);
    console.log(`PASS saga merge: ${report.imageAssets} images, ${report.audioAssets} clips, retired ${(report.retired || []).join(', ') || 'none'}; arcade contract satisfied`);
    // 3. Strict browser build with its own gameplay checks.
    const build = spawnSync(process.execPath, [path.join(root, 'build/tools/build-bundle.cjs'), '--bundle', path.join(run, 'merged'), '--out', path.join(run, 'export')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 600000 });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const runtime = JSON.parse(fs.readFileSync(path.join(run, 'export/game/assets/manifest.json'), 'utf8'));
    assert.deepEqual(runtime.fighters.map(fighter => fighter.id), config.fighters.map(fighter => fighter.id));
    assert.deepEqual(runtime.stages.map(stage => stage.id), config.stages.map(stage => stage.id));
    assert.equal(runtime.fighters.filter(fighter => fighter.boss).length, 1);
    for (const fighter of runtime.fighters) {
      assert.equal(Object.keys(fighter.poses).length, 45, `${fighter.id} has all 45 poses`);
      assert.ok(fighter.endingArt && fs.existsSync(path.join(run, 'export/game', fighter.endingArt)), `${fighter.id} has ending art`);
    }
    assert.equal(Object.keys(runtime.audio || {}).length, audioPlan.jobs.length);
    console.log(`PASS strict build: ${runtime.fighters.length} fighters (boss ${runtime.fighters.find(f => f.boss).id}), ${runtime.stages.length} arenas, 45 poses and ending art each, ${Object.keys(runtime.audio).length} clips`);
    // 4. Optional maintainer packaging (FFmpeg) against the arcade contract.
    if (args.has('--package')) {
      const { packageExample } = require('../tools/package-example.cjs');
      await packageExample({ bundle: path.join(run, 'merged'), out: path.join(run, 'packaged'), previous: path.join(base, 'provenance.json') });
      const packaged = await verifyBundle(path.join(run, 'packaged'));
      assert.equal(packaged.contract.name, 'arcade');
      const carried = packaged.provenance.images.filter(image => image.originalSha256).length;
      assert.equal(carried, classic.manifest.assets.length, 'Unchanged classic images keep their original generation hashes');
      console.log(`PASS packaging: pixel-identical WebP, ${carried} images trace to the classic generation record`);
    }
    console.log('Expansion pipeline rehearsal passed without model calls.');
  } finally {
    const inside = path.dirname(run) === path.join(root, 'output/test-runs') && path.basename(run).startsWith('expansion-pipeline-');
    if (args.has('--keep')) console.log(`Kept: ${run}`);
    else if (inside) fs.rmSync(run, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
