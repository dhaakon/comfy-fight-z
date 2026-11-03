// Capture the real editor, builder, and NEW phone-photo game. Never queues models.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { browserPath, command } = require('./render-explainer-cards.cjs');
const ROOT = path.resolve(__dirname, '../..');
const opts = { scene: '', run: 'output/phone-photo-demo/20261103-phone-cast', bundle: '', out: 'output/explainer/phone-photo-20261103', comfy: 'http://127.0.0.1:8188', builder: 'http://127.0.0.1:8089', game: '' };
for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i].slice(2); assert.ok(Object.hasOwn(opts, key) && process.argv[i + 1]); opts[key] = process.argv[i + 1]; }
assert.ok(['04-upload', '05-design', '08-builder', '09-export', '10-play'].includes(opts.scene), 'Choose a supported --scene');
for (const key of ['comfy', 'builder', 'game']) if (opts[key]) { const u = new URL(opts[key]); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)); opts[key] = u.href.replace(/\/$/, ''); }
const run = path.resolve(ROOT, opts.run), output = path.resolve(ROOT, opts.out, 'captures');
const BUNDLE = opts.bundle ? path.resolve(ROOT, opts.bundle) : null;
if (['08-builder', '09-export', '10-play'].includes(opts.scene)) assert.ok(BUNDLE && BUNDLE.startsWith(run + path.sep) && ['accepted-bundle', 'packaged-bundle'].includes(path.basename(BUNDLE)), 'Pass --bundle pointing to this run accepted-bundle or packaged-bundle');
assert.ok(run.startsWith(path.join(ROOT, 'output/phone-photo-demo') + path.sep));
assert.ok(output.startsWith(path.join(ROOT, 'output/explainer') + path.sep));
fs.mkdirSync(output, { recursive: true });
const report = { scene: opts.scene, sourceRun: opts.run, sourceBundle: opts.bundle || null, paidCalls: 0, blockedWrites: [], capturedAt: new Date().toISOString() };
const SAMPLE = 'C:/comfy-fighter-z/output/my-phone-photo-game/bundle';
async function camera(page, box, duration = 800) {
  await page.evaluate(async ({ box, duration }) => {
    const app = window.comfyAPI.app.app, rect = app.canvas.canvas.getBoundingClientRect();
    const frame = { x: 90, y: 145, width: 1740, height: 710 }, scale = Math.min(frame.width / box.width, frame.height / box.height, box.maxScale || 1.35);
    const target = [(frame.x - rect.x + (frame.width - box.width * scale) / 2) / scale - box.x, (frame.y - rect.y + (frame.height - box.height * scale) / 2) / scale - box.y];
    const start = [...app.canvas.ds.offset], original = app.canvas.ds.scale, began = performance.now();
    await new Promise(resolve => { function tick(now) { const t = duration ? Math.min(1, (now - began) / duration) : 1, ease = t * t * (3 - 2 * t); app.canvas.ds.scale = original + (scale - original) * ease; app.canvas.ds.offset = start.map((value, i) => value + (target[i] - value) * ease); app.canvas.setDirty(true, true); if (t < 1) requestAnimationFrame(tick); else resolve(); } requestAnimationFrame(tick); });
  }, { box, duration });
}
async function nodeCamera(page, type, index = 0, duration = 800) {
  const box = await page.evaluate(({ type, index }) => { const n = window.comfyAPI.app.app.graph._nodes.filter(n => n.type === type)[index]; return { x: n.pos[0] - 25, y: n.pos[1] - 40, width: n.size[0] + 50, height: n.size[1] + 65 }; }, { type, index }); await camera(page, box, duration);
}
async function point(page, locator, click = false) { const b = await locator.boundingBox(); assert.ok(b, 'Pointer target visible'); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); if (click) await locator.click(); }
async function scroll(page, selector) { await page.evaluate(selector => window.scrollTo({ top: scrollY + document.querySelector(selector).getBoundingClientRect().top - 150, behavior: 'smooth' }), selector); await page.waitForTimeout(650); }
async function loadBundle(page) { await page.locator('#folder-input').setInputFiles(BUNDLE); await page.locator('#customize-content').waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('#file-count').textContent === '56/56'); assert.equal(await page.locator('.fighter-editor').count(), 6); assert.equal(await page.locator('#allow-placeholders').isChecked(), false); }
async function prepareComfy(context, page) {
  const names = ['griddle', 'rivet', 'tempo', 'nimbus', 'switchback', 'brick', 'yard'].map(id => `cfz-phone-20261103-phone-cast-${id}.png`);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === opts.comfy && /\/(?:api\/)?view$/.test(url.pathname) && !names.includes(url.searchParams.get('filename'))) return route.abort('blockedbyclient');
    if (url.origin === opts.comfy && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blockedWrites.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return route.continue();
  });
  const graph = JSON.parse(fs.readFileSync(path.join(run, 'phase2-ui.json')));
  for (const n of graph.nodes) if (n.type === 'CFZProjectSettings') { n.widgets_values[0] = SAMPLE; n.widgets_values_named.root_directory = SAMPLE; }
  // The run note contains local receipts. Keep only a portable, truthful description.
  for (const n of graph.nodes) if (n.type === 'MarkdownNote') n.widgets_values = ['Fresh fictional phone-photo demo. Six characters, one Yard, and two disabled environment slots. All model inference is cloud-hosted.'];
  assert.ok(!/C:[\\/]Users[\\/]/i.test(JSON.stringify(graph)));
  await page.goto(opts.comfy); await page.waitForFunction(() => !!window.comfyAPI?.app?.app?.canvas, null, { timeout: 60000 });
  await page.evaluate(async graph => window.comfyAPI.app.app.loadGraphData(graph, true, true), graph); await page.waitForTimeout(1400);
  if (await page.getByRole('button', { name: 'NO FAVORITED INPUTS', exact: true }).isVisible()) await page.getByRole('button', { name: 'Toggle properties panel', exact: true }).click();
  const minimap = page.getByRole('button', { name: 'Hide Minimap (ALT + SHIFT + M)', exact: true }); if (await minimap.isVisible()) await minimap.click();
  report.editor = await page.evaluate(async () => { const app = window.comfyAPI.app.app, p = (await app.graphToPrompt()).output; return { unknown: app.graph._nodes.filter(n => n.has_errors).map(n => n.type), factories: Object.values(p).filter(n => ['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(n.class_type)).map(n => ({ type: n.class_type, image: n.inputs.image, mode: n.inputs.source_mode, enabled: n.inputs.enabled })) }; });
  assert.deepEqual(report.editor.unknown, []); assert.equal(report.editor.factories.length, 9);
  const active = report.editor.factories.filter(n => n.type === 'CFZCharacterFactory' || n.enabled);
  assert.equal(active.length, 7); assert.ok(active.every(n => n.mode === 'Upload reference' && names.includes(n.image)));
  assert.ok(report.editor.factories.filter(n => n.enabled === false).every(n => !n.image));
  await page.evaluate(() => { const app = window.comfyAPI.app.app, n = app.graph._nodes.find(n => n.type === 'CFZCharacterFactory'); n.pos = [10000, 100]; n.setSize([850, 650]); app.canvas.setDirty(true, true); });
  await page.addStyleTag({ content: '[node-id="2"] textarea{font-size:15px!important;line-height:1.35!important}' });
  await nodeCamera(page, 'CFZCharacterFactory', 0, 0);
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath(), args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: path.join(output, 'raw'), size: { width: 1920, height: 1080 } } });
  const page = await context.newPage(), video = page.video(); page.setDefaultTimeout(20000);
  try {
    if (['04-upload', '05-design'].includes(opts.scene)) await prepareComfy(context, page);
    else if (['08-builder', '09-export'].includes(opts.scene)) {
      await page.goto(opts.builder + '/builder/'); await page.locator('#factory-slots').waitFor();
      await page.addStyleTag({ content: '.shell{max-width:1700px}.workspace{grid-template-columns:minmax(0,1fr) 430px}.export-column{top:135px}.fighter-preview{height:150px}.export-contents{display:none}.fighter-fields input[type=text]{font-size:16px}' });
      if (opts.scene === '09-export') { await loadBundle(page); await scroll(page, '#customize-panel'); } else await scroll(page, '#input-panel');
    } else {
      assert.ok(opts.game, 'New game requires explicit --game localhost URL'); await page.goto(opts.game);
      await page.waitForFunction(() => !!window.FighterDebug && !document.querySelector('#title-start').disabled);
      const actual = await page.evaluate(async () => (await fetch('assets/manifest.json')).json());
      assert.equal(actual.fighters.length, 6); assert.equal(actual.stages.length, 1); assert.ok(actual.fighters.every(f => Object.keys(f.poses).length === 27));
      const map = await page.evaluate(async () => (await fetch('sources/assets.json')).json());
      const expected = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'assets.json')));
      assert.equal(map.assets.find(a => a.id === 'griddle_source').sha256, expected.assets.find(a => a.id === 'griddle_source').sha256, 'Gameplay must use the supplied accepted or packaged bundle');
      assert.deepEqual(map.assets.map(a => [a.id, a.sha256]).sort(), expected.assets.map(a => [a.id, a.sha256]).sort(), 'Every gameplay source must match the reviewed bundle including repairs');
      fs.mkdirSync(path.join(run, 'video-stills'), { recursive: true });
      await page.screenshot({ path: path.join(run, 'video-stills/game-title.png') });
      await page.locator('#title-start').click();
      await page.screenshot({ path: path.join(run, 'video-stills/game-selection.png') });
      await page.locator('#start-button').click(); await page.locator('#intro-screen').waitFor({ state: 'visible' });
    }
    await page.addStyleTag({ content: '#video-pointer{position:fixed;z-index:2147483647;width:27px;height:27px;border:2px solid #ffd16b;border-radius:50%;pointer-events:none;left:1800px;top:820px;transform:translate(-50%,-50%);box-shadow:0 0 18px #ffd16b88;background:#ffd16b18}' });
    await page.evaluate(() => { const p = document.createElement('div'); p.id = 'video-pointer'; document.body.append(p); document.addEventListener('mousemove', e => { p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px'; }); });
    await page.waitForTimeout(500); const began = Date.now(), at = async sec => page.waitForTimeout(Math.max(0, sec * 1000 - (Date.now() - began)));
    if (opts.scene === '04-upload') {
      await at(4); await camera(page, { x: 9950, y: 575, width: 950, height: 275, maxScale: 1.6 });
      await at(5); await point(page, page.getByText('Upload reference', { exact: true }).first()); await page.waitForTimeout(400); await page.mouse.move(1820, 820);
      await at(8); await nodeCamera(page, 'CFZCharacterFactory');
      await at(11); await nodeCamera(page, 'CFZEnvironmentFactory');
      await at(15); await camera(page, { x: -40, y: 1700, width: 1530, height: 700 });
    } else if (opts.scene === '05-design') {
      await at(1); await point(page, page.locator('[node-id="2"] textarea').first(), true);
      await at(5); await point(page, page.locator('input[aria-label="special_name"]').first());
      await at(8); await point(page, page.locator('input[aria-label="intro_tagline"]').first());
      await at(11); await nodeCamera(page, 'CFZProjectSettings');
      await at(14); await point(page, page.locator('input[aria-label="root_directory"]'), true); await page.keyboard.press('Control+A'); await at(17); await page.keyboard.press('End'); await page.keyboard.press('Tab');
    } else if (opts.scene === '08-builder') {
      await at(1); await point(page, page.locator('label[for="folder-input"]')); await at(3); await loadBundle(page); await scroll(page, '#customize-panel');
      await at(7); await point(page, page.locator('#game-title'), true); await page.locator('#game-title').fill('Backyard Champions');
      await at(10); await point(page, page.locator('[data-fighter-color]').first()); await page.locator('[data-fighter-color]').first().fill('#ff9e45');
      await at(14); await page.locator('#game-title').fill('Comfy Fighter Z');
      report.builder = { mappedImages: await page.locator('#file-count').innerText(), roster: await page.locator('.fighter-editor').count(), readiness: await page.locator('#readiness').innerText() };
    } else if (opts.scene === '09-export') {
      await at(1); await point(page, page.locator('#build-button'), true); await page.locator('#export-ready').waitFor({ state: 'visible', timeout: 120000 });
      assert.match(await page.locator('#status').innerText(), /custom game is built/i); assert.equal(await page.locator('#allow-placeholders').isChecked(), false);
      report.export = { strict: true, summary: await page.locator('#build-summary').innerText(), status: await page.locator('#status').innerText() };
      await page.waitForTimeout(2000); await point(page, page.locator('#download-zip')); await page.waitForTimeout(2000); await point(page, page.locator('#export-directory')); await page.waitForTimeout(2000);
    } else {
      await at(1); if (await page.locator('#intro-skip').isVisible()) await page.locator('#intro-skip').click();
      await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight'); await page.locator('#arena').click({ position: { x: 900, y: 300 } }); await page.mouse.move(1810, 840);
      await page.keyboard.down('ArrowRight'); await page.waitForTimeout(650); await page.keyboard.up('ArrowRight');
      for (const key of ['a', 's', 'd', 'f', 'ArrowUp', 'a', 's', 'ArrowDown', 'd', 'f', 'a', 's', 'f']) { await page.keyboard.press(key); await page.waitForTimeout(950); }
      report.game = await page.evaluate(() => ({ presentation: window.FighterDebug.presentation(), phase: window.FighterDebug.snapshot()?.phase }));
    }
    await at(19.5); await page.screenshot({ path: path.join(output, opts.scene + '.png') }); await at(20); const capturedSeconds = (Date.now() - began) / 1000; await context.close();
    const raw = await video.path(), p = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', raw]));
    await command('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, Number(p.format.duration) - capturedSeconds)), '-i', raw, '-t', String(capturedSeconds), '-an', '-vf', 'fps=30,scale=1920:1080', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', path.join(output, opts.scene + '.webm')]);
    report.capturedSeconds = capturedSeconds;
    fs.writeFileSync(path.join(output, opts.scene + '.json'), JSON.stringify(report, null, 2) + '\n'); console.log('Captured ' + opts.scene + ' with no model calls.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
