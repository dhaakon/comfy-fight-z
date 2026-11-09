// Merge reviewed additions from a run prepared over the example (new-game.cjs prepare --accepted example/bundle) back
// into example/bundle without touching the accepted art:
//   --scenery  each arena's living-scenery layers become pixel-verified lossless WebP with provenance, and the arena's
//              scenery settings (weather, effects) join the game config. The populated scene renders the layers were
//              cut from stay in the run for review; the game never ships them.
//   --videos   the startup and select clips (video.json) are copied byte for byte with their digests.
// Usage: node build/tools/merge-into-example.cjs --run output/test-runs/<name> [--scenery] [--videos]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { losslessImage } = require('./package-example.cjs');
const { verifyBundle, hash, read } = require('./lib/example-bundle.cjs');
const { sourceFile } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');

async function mergeIntoExample({ run, scenery = false, videos = false, example = path.join(ROOT, 'example/bundle'), log = console.log } = {}) {
  if (!run || (!scenery && !videos)) throw new Error('Usage: node build/tools/merge-into-example.cjs --run output/test-runs/<name> [--scenery] [--videos]');
  const directory = path.resolve(ROOT, run), bundle = path.join(directory, 'bundle'), state = read(path.join(directory, 'pipeline.json'));
  if (path.resolve(ROOT, state.accepted?.bundle || '') !== path.resolve(example)) throw new Error(`${run} was not prepared over ${path.relative(ROOT, example)} (new-game.cjs prepare --accepted).`);
  const source = read(path.join(bundle, 'assets.json')), target = read(path.join(example, 'assets.json')), provenance = read(path.join(example, 'provenance.json'));
  const today = new Date().toISOString().slice(0, 10), runPath = path.relative(ROOT, directory).split(path.sep).join('/'), summary = {};
  if (scenery) {
    const stages = source.game.stages.filter(stage => stage.scenery && source.assets.some(asset => asset.kind === 'layer' && asset.stage === stage.id));
    if (!stages.length) throw new Error('The run has no living scenery to merge; run add-scenery first.');
    const removed = new Set(target.assets.filter(asset => ['scene', 'layer'].includes(asset.kind) && stages.some(stage => stage.id === asset.stage)).map(asset => asset.id));
    target.assets = target.assets.filter(asset => !removed.has(asset.id));
    provenance.images = provenance.images.filter(item => !removed.has(item.id));
    const added = [];
    for (const stage of stages) {
      const accepted = target.game.stages.find(item => item.id === stage.id);
      if (!accepted) throw new Error(`The example has no arena ${stage.id}.`);
      accepted.scenery = { weather: stage.scenery.weather, effects: stage.scenery.effects };
      for (const record of source.assets.filter(asset => asset.kind === 'layer' && asset.stage === stage.id)) {
        const input = sourceFile(bundle, record.src), src = `raw/${record.id}.webp`, output = path.join(example, src);
        const pngBytes = fs.readFileSync(input), verified = await losslessImage(input, output), encoded = fs.readFileSync(output);
        target.assets.push({ ...record, src, width: verified.width, height: verified.height, sha256: hash(encoded), bytes: encoded.length });
        provenance.images.push({ id: record.id, sourceSha256: hash(pngBytes), packagedSha256: hash(encoded), sourceBytes: pngBytes.length, bytes: encoded.length, ...verified });
        added.push(record.id);
      }
    }
    for (const id of removed) if (!added.includes(id)) fs.rmSync(path.join(example, `raw/${id}.webp`), { force: true });
    if (Array.isArray(target.game.expectedAssets)) target.game.expectedAssets = [...target.game.expectedAssets.filter(id => !removed.has(id)), ...added];
    const runState = read(path.join(directory, 'pipeline.json'));
    provenance.scenery = { addedAt: today, run: runPath, stages: stages.map(stage => stage.id), layers: added.length, patches: (runState.addedScenery || []).flatMap(entry => entry.patches || []),
      note: 'CFZSceneDirector, CFZStageScenery and CFZSceneIsolate over each accepted arena painting, cut by CFZExtractScenery; the populated scene renders stay in the run.' };
    summary.scenery = { stages: stages.map(stage => stage.id), layers: added.length };
    log(`Scenery: ${added.length} layers for ${stages.map(stage => stage.id).join(', ')} as lossless WebP (identical pixels).`);
  }
  if (videos) {
    const { videoClips } = require('./new-game.cjs');
    const video = read(path.join(bundle, 'video.json')), clips = videoClips(video);
    if (!clips.length) throw new Error('The run has no clips to merge; run add-media first.');
    const previous = fs.existsSync(path.join(example, 'video.json')) ? read(path.join(example, 'video.json')) : null;
    const previousFiles = previous ? videoClips(previous).map(clip => clip.src) : [];
    for (const clip of clips) {
      const data = fs.readFileSync(sourceFile(bundle, clip.src));
      if (hash(data) !== clip.sha256) throw new Error(`Clip digest mismatch in the run: ${clip.id}`);
      fs.writeFileSync(path.join(example, clip.src), data);
    }
    for (const src of previousFiles) if (!clips.some(clip => clip.src === src)) fs.rmSync(path.join(example, src), { force: true });
    fs.writeFileSync(path.join(example, 'video.json'), JSON.stringify(video, null, 2) + '\n');
    const runState = read(path.join(directory, 'pipeline.json'));
    provenance.videos = clips.map(clip => ({ id: clip.id, sha256: clip.sha256, bytes: fs.statSync(path.join(example, clip.src)).size, duration: clip.duration }));
    provenance.media = { addedAt: today, run: runPath, clips: clips.length, packed: (runState.packedMedia || []).length > 0,
      note: 'CFZIntroVideo, CFZSelectIdleVideo, CFZTitleVideo and CFZSelectVideo (Seedance 1.5 Pro, 1080p) drawn by new-game.cjs add-media from the accepted identities, The Yard and the arcade title and select art; the portrait cuts (title-portrait, select-portrait) recompose that art tall for phones and are packed 720 wide.' };
    summary.videos = clips.length;
    log(`Clips: ${clips.length} copied with their digests.`);
  }
  fs.writeFileSync(path.join(example, 'assets.json'), JSON.stringify(target, null, 2) + '\n');
  fs.writeFileSync(path.join(example, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  const checked = await verifyBundle(example);
  log(`example verifier OK: ${checked.manifest.assets.length} images, ${checked.videos.length} clips, contract ${checked.contract.name}. Next: npm run example -- --out <fresh> --no-install, then adopt the export.`);
  return { ...summary, checked };
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--run') options.run = args[++index];
    else if (args[index] === '--scenery') options.scenery = true;
    else if (args[index] === '--videos') options.videos = true;
    else { console.error('Usage: node build/tools/merge-into-example.cjs --run output/test-runs/<name> [--scenery] [--videos]'); process.exit(2); }
  }
  mergeIntoExample(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { mergeIntoExample };
