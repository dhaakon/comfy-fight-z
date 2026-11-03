// Browser integration from mapped PNG bundle through custom game ZIP. No paid APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { createCanvas } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '../..');

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function startServer(script, cwd) {
  const port = await unusedPort(), url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [script], { cwd, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out')); }, 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited (${code})`)); });
    child.stdout.on('data', chunk => { if (String(chunk).includes(url)) { clearTimeout(timeout); resolve(); } });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
  });
  return { child, url };
}
async function syntheticBundle(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build/public/builder/example-assets.json'), 'utf8'));
  manifest.game.subtitle = 'Synthetic Open Source Saga';
  manifest.game.fighters.forEach(fighter => { fighter.introTagline = `${fighter.name} is ready for the showdown.`; });
  for (const [id, name] of [['rooftop', 'Rooftop Reference'], ['courtyard', 'Courtyard Reference']]) {
    manifest.game.stages.push({ id, name, description: `A distinct uploaded ${name.toLowerCase()} for multi-environment export testing.` });
    manifest.assets.push({ id: `${id}_source`, kind: 'source', stage: id, key: false, src: `raw/${id}_source.png` }, { id, kind: 'stage', stage: id, key: false, src: `raw/${id}.png` });
  }
  if (manifest.game.expectedAssets) manifest.game.expectedAssets = manifest.assets.map(asset => asset.id);
  for (const asset of manifest.assets) {
    const sheet = asset.kind === 'sprites' || asset.kind === 'effects';
    const width = sheet ? 300 : asset.kind === 'stage' ? 600 : 240, height = sheet ? 300 : asset.kind === 'stage' ? 338 : 300;
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    const stageColors = { yard: '#142d38', rooftop: '#205d32', courtyard: '#792d4c' };
    ctx.fillStyle = asset.key ? '#00ff00' : asset.stage ? stageColors[asset.stage] : '#142d38'; ctx.fillRect(0, 0, width, height);
    if (sheet) for (let i = 0; i < 9; i++) {
      const x = (i % 3) * 100, y = Math.floor(i / 3) * 100;
      ctx.fillStyle = i % 2 ? '#69b8db' : '#ed8034'; ctx.fillRect(x + 37, y + 20, 26, 60);
      ctx.fillStyle = '#ffd1a2'; ctx.fillRect(x + 41, y + 8, 18, 18);
    } else { ctx.fillStyle = '#ef9155'; ctx.fillRect(width * .3, height * .15, width * .4, height * .75); }
    asset.width = width; asset.height = height;
    const target = path.join(folder, asset.src); fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = await canvas.encode('png');
    fs.writeFileSync(target, bytes);
    asset.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  fs.writeFileSync(path.join(folder, 'assets.json'), JSON.stringify(manifest));
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  const audio = { schema: 'comfy-fighter-audio/v1', root: '.', title: manifest.game.title, assets: ['menu_music', 'sfx_punch'].map(id => ({ id, kind: 'audio', category: id.endsWith('music') ? 'music' : 'sfx', src: `raw/${id}.wav`, sha256: createHash('sha256').update(wav).digest('hex'), loop: id.endsWith('music') })) };
  for (const asset of audio.assets) fs.writeFileSync(path.join(folder, asset.src), wav);
  fs.writeFileSync(path.join(folder, 'audio.json'), JSON.stringify(audio));
  const video = fs.readFileSync(path.join(__dirname, 'fixtures/opening.mp4'));
  fs.writeFileSync(path.join(folder, 'raw/opening.mp4'), video);
  fs.writeFileSync(path.join(folder, 'video.json'), JSON.stringify({ schema: 'comfy-fighter-video/v1', root: '.', openingVideo: { id: 'opening', src: 'raw/opening.mp4', duration: 2, sha256: createHash('sha256').update(video).digest('hex') } }));
  return manifest;
}
function unzipStored(bytes, destination) {
  const files = new Map(); let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(at + 8), 0, 'Expected standards ZIP store mode');
    const length = bytes.readUInt32LE(at + 18), nameLength = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    const start = at + 30 + nameLength + extra, data = bytes.subarray(start, start + length), target = path.resolve(destination, name);
    assert.ok(target.startsWith(destination + path.sep));
    assert.equal(data.length, length); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
    files.set(name, data); at = start + length;
  }
  assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'Expected central directory after local files');
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50, 'Expected ZIP end record');
  assert.equal(bytes.readUInt16LE(bytes.length - 12), files.size, 'Central entry count must match');
  return files;
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-fighter-builder-'));
  const bundle = path.join(temp, 'bundle'); fs.mkdirSync(bundle);
  const manifest = await syntheticBundle(bundle), servers = [];
  let browser;
  try {
    const server = await startServer('build/tools/serve.cjs', root); servers.push(server.child);
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.url}/builder/`);
    const factory = JSON.parse(fs.readFileSync(path.join(root, 'build/public/builder/factory-template.json'), 'utf8'));
    await page.waitForFunction(() => !document.querySelector('#factory-slots').hidden);
    assert.equal(await page.locator('#factory-characters .factory-slot').count(), factory.characters.length);
    assert.equal(await page.locator('#factory-environments .factory-slot').count(), factory.environments.length);
    assert.equal(await page.locator('#factory-environments [data-enabled="false"]').count(), factory.environments.filter(stage => stage.enabled === false).length);
    assert.ok((await page.locator('#download-workflow').getAttribute('href')).endsWith(factory.workflowURL));
    await page.click('#load-example');
    await page.waitForFunction(() => document.querySelector('#fighter-list').children.length >= 2);
    assert.equal(await page.locator('#allow-placeholders').isChecked(), false);
    await page.click('#build-button');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Missing'));
    assert.equal(await page.locator('#export-ready').isVisible(), false);
    await page.check('#allow-placeholders'); await page.click('#build-button');
    await page.locator('#export-ready').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.locator('#status').textContent(), /Prototype built/);
    const placeholderDownload = page.waitForEvent('download'); await page.click('#download-zip');
    const prototype = await placeholderDownload; await prototype.saveAs(path.join(temp, 'prototype.zip'));
    assert.ok(fs.statSync(path.join(temp, 'prototype.zip')).size > 1000);

    await page.locator('#folder-input').setInputFiles(bundle);
    await page.waitForFunction(count => document.querySelector('#file-count').textContent === `${count}/${count}`, manifest.assets.length);
    assert.equal(await page.locator('#allow-placeholders').isChecked(), false, 'Fresh bundle resets placeholder consent');
    const badHashError = await page.evaluate(async input => {
      const { buildGame } = await import('./pack.js');
      input.assets[0].sha256 = '0'.repeat(64);
      const files = new Map([...document.querySelector('#folder-input').files].map(file => [file.webkitRelativePath.split('/').slice(1).join('/'), file]));
      try { await buildGame({ manifest: input, files }); return 'unexpected success'; }
      catch (error) { return error.message; }
    }, manifest);
    assert.match(badHashError, /SHA-256 mismatch/, 'Strict build verifies image content against the source manifest');
    await page.fill('#game-title', 'Custom Backyard Championship');
    await page.fill(`[data-fighter-name="${manifest.game.fighters[0].id}"]`, 'Captain Barbecue');
    await page.locator(`[data-fighter-color="${manifest.game.fighters[0].id}"]`).fill('#cc4466');
    await page.fill(`[data-stage-name="${manifest.game.stages[0].id}"]`, 'Championship Patio');
    await page.fill('[data-stage-name="rooftop"]', 'Neon Rooftop');
    await page.fill('[data-stage-name="courtyard"]', 'Moon Courtyard');
    assert.equal(await page.locator('.stage-editor .stage-preview img').count(), 3, 'Each environment must preview its own source art');
    await page.click('#build-button'); await page.locator('#export-ready').waitFor({ state: 'visible', timeout: 60000 });
    assert.match(await page.locator('#status').textContent(), /custom game is built/);
    const downloaded = page.waitForEvent('download'); await page.click('#download-zip');
    const download = await downloaded, zipPath = path.join(temp, 'custom.zip'); await download.saveAs(zipPath);
    const exported = path.join(temp, 'exported'); fs.mkdirSync(exported);
    const packageFiles = unzipStored(fs.readFileSync(zipPath), exported);
    assert.deepEqual(packageFiles.get('LICENSE'), fs.readFileSync(path.join(root, 'LICENSE')), 'Preserve the complete MIT notice in the game ZIP');
    assert.equal(JSON.parse(packageFiles.get('package.json')).license, 'MIT');
    const runtime = JSON.parse(packageFiles.get('assets/manifest.json'));
    assert.equal(runtime.title, 'Custom Backyard Championship');
    assert.equal(runtime.subtitle, manifest.game.subtitle);
    assert.equal(runtime.fighters[0].name, 'Captain Barbecue'); assert.equal(runtime.fighters[0].color, '#cc4466');
    assert.equal(runtime.stages.length, 3);
    assert.deepEqual(runtime.stages.map(stage => stage.name), ['Championship Patio', 'Neon Rooftop', 'Moon Courtyard']);
    const poseCount = manifest.game.fighters.length * 27;
    assert.equal(runtime.fighters.reduce((sum, fighter) => sum + Object.keys(fighter.poses).length, 0), poseCount);
    assert.equal(runtime.fighters[0].description, manifest.game.fighters[0].description);
    assert.equal(runtime.fighters[0].introTagline, manifest.game.fighters[0].introTagline);
    assert.deepEqual(runtime.fighters[0].specialMove, manifest.game.fighters[0].specialMove);
    assert.deepEqual(Object.keys(runtime.audio).sort(), ['menu_music', 'sfx_punch']);
    assert.ok(packageFiles.has('assets/audio/menu_music.wav'));
    assert.ok(packageFiles.has('sources/audio.json'));
    assert.ok(packageFiles.has('anim.js'), 'Procedural animation must be in the standalone export');
    assert.equal(runtime.openingVideo.src, 'assets/video/opening.mp4');
    assert.ok(packageFiles.has('sources/video.json'));
    assert.deepEqual(packageFiles.get(runtime.openingVideo.src), packageFiles.get('sources/raw/opening.mp4'));
    for (const job of manifest.assets.filter(a => a.kind === 'source')) assert.ok(packageFiles.has(`assets/references/${job.id}.png`));
    for (const job of manifest.assets.filter(a => a.stage)) assert.deepEqual(packageFiles.get(`sources/${job.src}`), fs.readFileSync(path.join(bundle, job.src)), `Retain exact source bytes for ${job.id}`);
    for (const job of manifest.assets.filter(a => a.kind === 'sprites')) assert.ok(packageFiles.has(`sources/${job.src}`), `Retain source sheet ${job.id}`);
    assert.ok(packageFiles.has('sources/assets.json'), 'Retain reimportable source bundle map');
    assert.equal(JSON.parse(packageFiles.get('build-report.json')).strict, true);
    assert.ok(!packageFiles.has('builder/app.js'), 'Export is standalone game, not builder');

    // Test the directory export UI with the browser's filesystem interface stubbed.
    await page.evaluate(() => {
      window.directoryFiles = {};
      function directory(prefix = '') {
        return { kind: 'directory', name: 'browser-test-export', async *entries() {},
          async getDirectoryHandle(name) { return directory(prefix + name + '/'); },
          async getFileHandle(name) { return { async createWritable() { return { async write(blob) { window.directoryFiles[prefix + name] = await blob.text(); }, async close() {}, async abort() {} }; } }; } };
      }
      window.showDirectoryPicker = async () => directory();
      document.querySelector('#export-directory').disabled = false;
    });
    await page.click('#export-directory');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Game exported'));
    assert.equal(await page.evaluate(() => JSON.parse(window.directoryFiles['assets/manifest.json']).title), 'Custom Backyard Championship');
    assert.equal(await page.evaluate(() => Object.keys(window.directoryFiles).length), packageFiles.size);
    fs.mkdirSync(path.join(root, 'output/diagnostics'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'output/diagnostics/builder-smoke.png'), fullPage: true });

    const gameServer = await startServer('start-server.cjs', exported); servers.push(gameServer.child);
    const game = await browser.newPage(); game.on('pageerror', error => errors.push(error.message));
    await game.goto(gameServer.url); await game.waitForFunction(() => document.querySelector('#fighter-one').options.length >= 2);
    await game.waitForFunction(() => Number(document.querySelector('#asset-count').textContent) >= 54);
    if (await game.locator('#opening-screen').isVisible()) await game.keyboard.press('Space');
    await game.waitForFunction(() => window.FighterDebug.presentation().screen === 'title');
    assert.equal(await game.title(), 'Custom Backyard Championship');
    assert.equal(await game.evaluate(() => window.FighterDebug.presentation().screen), 'title');
    assert.equal(await game.locator('#saga-subtitle').textContent(), manifest.game.subtitle);
    assert.match(await game.locator('#title-roster-summary').textContent(), /THREE ARENAS/);
    assert.match(await game.locator('#fighter-one').textContent(), /Captain Barbecue/);
    assert.equal(await game.locator('#placeholder-label').isVisible(), false);
    assert.ok(Number(await game.locator('#asset-count').textContent()) >= 54);
    const audioDuration = await game.evaluate(src => new Promise((resolve, reject) => {
      const audio = new Audio(); audio.onloadedmetadata = () => resolve(audio.duration); audio.onerror = () => reject(new Error('Exported audio did not decode')); audio.src = src;
    }), runtime.audio.menu_music.src);
    assert.ok(audioDuration > 0 && audioDuration < 1, 'Exported WAV must decode in the browser');
    const videoDuration = await game.evaluate(src => new Promise((resolve, reject) => {
      const video = document.createElement('video'); video.onloadedmetadata = () => resolve(video.duration); video.onerror = () => reject(new Error('Exported opening video did not decode')); video.src = src;
    }), runtime.openingVideo.src);
    assert.ok(Math.abs(videoDuration - 2) < .1, 'Exported MP4 must retain its duration');
    const audioURL = `${gameServer.url}/${runtime.audio.menu_music.src}`;
    const partial = await fetch(audioURL, { headers: { Range: 'bytes=0-43' } });
    assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 44);
    const invalid = await fetch(audioURL, { headers: { Range: 'bytes=999999-' } });
    assert.equal(invalid.status, 416);
    await game.click('#title-start');
    assert.equal(await game.evaluate(() => window.FighterDebug.presentation().screen), 'selection');
    assert.equal(await game.locator('#stage-control').isVisible(), true);
    assert.equal(await game.locator('#stage option').count(), 3);
    assert.equal(await game.locator('#selection-eyebrow').textContent(), 'ONE NIGHT. THREE ARENAS. YOUR FIGHTERS.');
    await game.screenshot({ path: path.join(root, 'output/diagnostics/multi-environment-select.png') });
    await game.click('#start-button');
    assert.ok((await game.locator('#intro-tagline').textContent()).includes(runtime.fighters[0].introTagline));
    assert.equal(await game.locator('#intro-name').textContent(), 'Captain Barbecue');
    assert.equal(await game.evaluate(() => window.FighterDebug.snapshot().frame), 0);
    await game.click('#intro-skip'); await game.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await game.evaluate(() => window.FighterDebug.snapshot().cpu), true);
    assert.equal(await game.evaluate(() => window.FighterDebug.presentation().humanPlayers), 1);
    await game.keyboard.press('KeyD'); await game.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].move === 'heavy');
    for (const [index, id, name, color] of [[1, 'rooftop', 'Neon Rooftop', [32, 93, 50]], [2, 'courtyard', 'Moon Courtyard', [121, 45, 76]]]) {
      await game.click('#back-select'); await game.selectOption('#stage', String(index));
      assert.equal(await game.evaluate(() => window.FighterDebug.presentation().stageId), id);
      assert.equal(await game.locator('#stage-name').textContent(), name.toUpperCase());
      assert.equal(await game.locator('#stage-label').textContent(), name.toUpperCase());
      assert.ok((await game.locator('#fight-stage-label').textContent()).includes(name.toUpperCase()));
      assert.equal(await game.locator('#result-stage-label').textContent(), `${name.toUpperCase()} HAS A CHAMPION`);
      await game.click('#start-button'); await game.click('#intro-skip'); await game.waitForFunction(() => window.FighterDebug.snapshot().phase === 'fight');
      const pixel = await game.evaluate(() => [...document.querySelector('#arena').getContext('2d').getImageData(20, 110, 1, 1).data].slice(0, 3));
      assert.deepEqual(pixel, color, `Gameplay canvas must render selected environment ${id}`);
    }
    await game.click('#back-select'); await game.setViewportSize({ width: 390, height: 844 }); await game.selectOption('#stage', '1');
    assert.equal(await game.locator('#stage-control').isVisible(), true, 'Multi-environment picker remains usable on phones');
    assert.equal(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await game.evaluate(() => {
      const opponent = document.querySelector('#fighter-two').getBoundingClientRect(), environments = document.querySelector('.battle-ready').getBoundingClientRect();
      return opponent.bottom <= environments.top;
    }), true, 'Environment controls must not cover the CPU opponent selector');
    await game.screenshot({ path: path.join(root, 'output/diagnostics/multi-environment-mobile.png') });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(`${server.url}/builder/`); await mobile.click('#load-example');
    await mobile.waitForFunction(() => document.querySelector('#fighter-list').children.length >= 2);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Builder must fit mobile viewport');
    await mobile.locator('#factory-panel').screenshot({ path: path.join(root, 'output/diagnostics/factory-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(`Builder browser passed: factory slots, strict missing-art gate, placeholder ZIP, ${manifest.assets.length} images, audio/opening-video import, descriptions/specials/taglines/subtitle, ${poseCount} poses, three colored environments with retained source bytes, ZIP/directory export, selected-stage gameplay pixels and mobile stage picker.`);
    console.log('Screenshot: output/diagnostics/builder-smoke.png');
  } finally {
    if (browser) await browser.close();
    for (const child of servers) child.kill();
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('comfy-fighter-builder-')) fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
