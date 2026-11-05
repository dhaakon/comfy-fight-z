const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { assemble } = require('../tools/assemble-title-videos.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('title assembly validates clips, preserves existing intros and never overwrites outputs', t => {
  if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0 || spawnSync('ffprobe', ['-version'], { windowsHide: true }).status !== 0) return t.skip('ffmpeg and ffprobe required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-title-assembly-'));
  t.after(() => { const target = path.resolve(dir); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('cfz-title-assembly-')) throw new Error('Unexpected cleanup target'); fs.rmSync(target, { recursive: true, force: true }); });
  const bundle = path.join(dir, 'bundle'), raw = path.join(bundle, 'raw'), out = path.join(dir, 'out'); fs.mkdirSync(raw, { recursive: true });
  const file = path.join(dir, 'clip.mp4'), encoder = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=24', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-y', file], { windowsHide: true, encoding: 'utf8' });
  if (encoder.status !== 0) return t.skip('H.264 encoder unavailable');
  const bytes = fs.readFileSync(file), image = Buffer.from('fictional image'); fs.writeFileSync(path.join(raw, 'fighter.png'), image); fs.writeFileSync(path.join(raw, 'intro.mp4'), bytes);
  const intro = { id: 'intro-hero', fighter: 'hero', src: 'raw/intro.mp4', duration: 8, sha256: hash(bytes) };
  fs.writeFileSync(path.join(bundle, 'assets.json'), JSON.stringify({ schema: 'comfy-fighter-assets/v1', root: '.', game: { fighters: [{ id: 'hero' }] }, assets: [{ id: 'hero', src: 'raw/fighter.png', sha256: hash(image) }] }));
  fs.writeFileSync(path.join(bundle, 'video.json'), JSON.stringify({ schema: 'comfy-fighter-video/v1', root: '.', fighterIntros: [intro] }));
  const result = assemble({ bundle, title: file, opening: file, out });
  assert.deepEqual(result.fighterIntros, [intro]);
  for (const item of [result.titleVideo, result.openingVideo]) {
    assert.equal(item.hasAudio, false); assert.ok(Math.abs(item.duration - 8) < .1);
    assert.equal(hash(fs.readFileSync(path.join(out, item.src))), item.sha256);
  }
  assert.equal(hash(fs.readFileSync(path.join(out, intro.src))), intro.sha256);
  assert.throws(() => assemble({ bundle, title: file, out }), /fresh output/);
  const nested = path.join(bundle, 'nested'); assert.throws(() => assemble({ bundle, title: file, out: nested }), /outside/);
  const second = path.join(dir, 'second'); assert.throws(() => assemble({ bundle: out, title: file, out: second }), /already has/);
  assert.equal(fs.existsSync(second), false);
});
