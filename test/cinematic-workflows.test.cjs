const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { makeOpeningGraph, makeYardEditGraph } = require('../tools/prepare-cinematic-workflows.cjs');
const { validateSource, assemble, probe } = require('../tools/assemble-opening.cjs');
const root = path.resolve(__dirname, '..');
const load = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('opening alternatives each wire seven photos to one 25-second Seedance cloud request', () => {
  const config = load('config/game.json'), template = load('workflows/templates/cloud-seedance-reference.json');
  for (const resolution of ['1080p', '720p']) {
    const graph = makeOpeningGraph(config, template, { resolution });
    const generation = graph.nodes.find(node => node.type === 'ByteDance2ReferenceNodeV2');
    assert.equal(graph.nodes.filter(node => node.type === 'ByteDance2ReferenceNodeV2').length, 1);
    assert.equal(graph.nodes.filter(node => node.type === 'LoadImage').length, 7);
    assert.equal(generation.widgets_values_named['model.duration'], 25);
    assert.equal(generation.widgets_values_named['model.resolution'], resolution);
    assert.equal(generation.widgets_values_named['model.generate_audio'], true);
    assert.deepEqual(generation.widgets_values, Object.values(generation.widgets_values_named));
    for (const [index, item] of [...config.fighters, config.stages[0]].entries()) {
      const link = graph.links.find(link => link[0] === generation.inputs[index].link);
      const source = graph.nodes.find(node => node.id === link[1]);
      assert.equal(source.widgets_values[0], item.sourceInput);
      assert.equal(generation.inputs[index].name, `model.reference_images.image_${index + 1}`);
    }
    for (const fighter of config.fighters) assert.ok(generation.widgets_values_named['model.prompt'].includes(fighter.specialMove.name));
    assert.match(generation.widgets_values_named['model.prompt'], /Photorealistic LIVE-ACTION/);
  }
});

test('Yard edit preserves one stage mapping and distinguishes target from original photo', () => {
  const config = load('config/game.json'), template = load('workflows/templates/cloud-image.json');
  const graph = makeYardEditGraph(config, template, { acceptedYardInput: 'accepted-yard.png', outputRoot: 'test-output/yard' });
  const generation = graph.nodes.find(node => node.type === 'GeminiNanoBanana2V2');
  const sources = ['model.images.image_1', 'model.images.image_2'].map(name => {
    const link = graph.links.find(item => item[0] === generation.inputs.find(input => input.name === name).link);
    return graph.nodes.find(node => node.id === link[1]).widgets_values[0];
  });
  assert.deepEqual(sources, ['accepted-yard.png', config.stages[0].sourceInput]);
  assert.deepEqual(JSON.parse(graph.nodes.find(node => node.type === 'DFZAssetRoot').widgets_values[1]).expectedAssets, ['yard']);
  assert.equal(JSON.parse(graph.nodes.find(node => node.type === 'DFZSaveAsset').widgets_values[0]).stage, 'yard');
  assert.match(generation.widgets_values_named.prompt, /CHANGE ONLY/);
});

test('assembly rejects short movies and missing native audio instead of extending them to 25 seconds', () => {
  const metadata = duration => ({ streams: [{ codec_type: 'video', width: 1920, height: 1080, duration: String(duration) }, { codec_type: 'audio', duration: String(duration) }] });
  assert.throws(() => validateSource(metadata(10)), /Refusing to manufacture/);
  assert.throws(() => validateSource(metadata(30)), /Refusing to manufacture/);
  assert.throws(() => validateSource({ streams: [metadata(25).streams[0]] }), /generated audio/);
  assert.equal(validateSource(metadata(25.04)).videoDuration, 25.04);
});

test('local 25-second fixture becomes an H264/AAC movie with a valid portable digest', { skip: spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0 || spawnSync('ffprobe', ['-version'], { windowsHide: true }).status !== 0 }, t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-video-test-'));
  t.after(() => { const target = path.resolve(folder); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('comfy-video-test-')) throw new Error('Unexpected fixture cleanup target'); fs.rmSync(target, { recursive: true, force: true }); });
  const input = path.join(folder, 'source.mp4'), out = path.join(folder, 'bundle');
  const source = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=25', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-y', input], { windowsHide: true, encoding: 'utf8' });
  assert.equal(source.status, 0, source.stderr);
  const manifest = assemble({ input, out }), resultFile = path.join(out, manifest.openingVideo.src), result = probe(resultFile);
  assert.equal(manifest.schema, 'comfy-fighter-video/v1'); assert.equal(manifest.root, '.'); assert.equal(manifest.openingVideo.duration, 25);
  assert.equal(createHash('sha256').update(fs.readFileSync(resultFile)).digest('hex'), manifest.openingVideo.sha256);
  assert.equal(result.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
  assert.equal(result.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
  assert.equal(Number(result.streams.find(stream => stream.codec_type === 'video').duration), 25);
  assert.equal(Number(result.streams.find(stream => stream.codec_type === 'video').nb_frames), 600);
  assert.equal(Number(result.streams.find(stream => stream.codec_type === 'audio').duration), 25);
  assert.ok(Math.abs(Number(result.format.duration) - 25) < .05, 'AAC priming may add container bookkeeping, not extra video frames');
  const bytes = fs.readFileSync(resultFile);
  assert.ok(bytes.indexOf(Buffer.from('moov')) < bytes.indexOf(Buffer.from('mdat')), 'faststart metadata precedes media payload');
  assert.throws(() => assemble({ input, out }), /already exists/);
});
