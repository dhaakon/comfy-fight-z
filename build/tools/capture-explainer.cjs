// Record the real interfaces for the project explainer. Never queues ComfyUI work.
// Requires npm ci, Playwright Chromium, FFmpeg/FFprobe, and the two local servers.
// Install the recording helper with: node build/node_modules/playwright/cli.js install ffmpeg
// Set PLAYWRIGHT_EXECUTABLE_PATH to reuse an installed Chromium browser.
// Example: node build/tools/capture-explainer.cjs --scene 05-source-mode
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const SAMPLE_ROOT = 'C:/comfy-fighter-z/output/test-runs/first-game/bundle';
const SCENES = ['01-result', '04-main-factory', '05-source-mode', '06-character-design', '07-output-and-cost', '09-builder', '10-export', '11-play'];
const settings = { comfy: 'http://127.0.0.1:8188', game: 'http://127.0.0.1:8089', bundle: 'output/test-runs/smoke-20261103-0548/bundle', out: 'output/explainer/20261103/captures', scene: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--comfy-url': 'comfy', '--game-url': 'game', '--bundle': 'bundle', '--out': 'out', '--scene': 'scene' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw new Error('Usage: node build/tools/capture-explainer.cjs [--comfy-url URL] [--game-url URL] [--bundle FOLDER] [--out FOLDER] [--scene SCENE]');
  settings[key] = process.argv[i + 1];
}
for (const key of ['comfy', 'game']) {
  const url = new URL(settings[key]);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Capture requires local servers');
  settings[key] = url.href.replace(/\/$/, '');
}
if (settings.scene) assert.ok(SCENES.includes(settings.scene), 'Unknown scene');
const OUTPUT = path.resolve(ROOT, settings.out), BUNDLE = path.resolve(ROOT, settings.bundle);
const sourceBundle = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'assets.json'), 'utf8'));
fs.mkdirSync(path.join(OUTPUT, 'raw'), { recursive: true });
const report = { capturedAt: new Date().toISOString(), inferenceSubmitted: false, sourceBundle: path.relative(ROOT, BUNDLE).replaceAll('\\', '/'), blockedComfyWrites: [], scenes: [] };

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr || result.error}`);
  return result.stdout;
}

function writeManifest() {
  const existing = SCENES.map(name => path.join(OUTPUT, `${name}.capture.json`)).filter(file => fs.existsSync(file)).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const scenes = new Map();
  for (const capture of existing) for (const scene of capture.scenes) scenes.set(scene.name, scene);
  fs.writeFileSync(path.join(OUTPUT, 'capture-manifest.json'), JSON.stringify({ ...report, comfy: existing.find(capture => capture.comfy)?.comfy, export: existing.find(capture => capture.export)?.export, game: existing.find(capture => capture.game)?.game, combat: existing.find(capture => capture.combat)?.combat, complete: SCENES.every(name => scenes.has(name)), scenes: [...scenes.values()].sort((a, b) => a.name.localeCompare(b.name)), framing: '1920x1080; key controls between y120 and y850; editor-only zoom and node resize; gold cursor overlay', warnings: 'Raw recordings include preparation and are excluded from the final edit. Only the named 20-second clips are approved capture outputs.' }, null, 2) + '\n');
}

async function cursor(page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#capture-pointer{position:fixed;z-index:2147483647;pointer-events:none;width:26px;height:26px;border:2px solid #ffd16b;border-radius:50%;box-shadow:0 0 15px #ffd16b88;transform:translate(-50%,-50%);left:1820px;top:820px;background:#ffd16b18}#capture-pointer.clicked{background:#8de9e6bb;box-shadow:0 0 25px #8de9e6;border-color:#8de9e6}';
    document.head.append(style);
    const dot = document.createElement('div'); dot.id = 'capture-pointer'; document.body.append(dot);
    document.addEventListener('mousemove', event => { dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`; });
    document.addEventListener('mousedown', () => { dot.classList.add('clicked'); setTimeout(() => dot.classList.remove('clicked'), 240); });
  });
  await page.mouse.move(1820, 820);
}

async function point(page, locator, click = false) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Pointer target is visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await page.waitForTimeout(300);
  if (click) await locator.click();
}

async function scrollTo(page, selector, top = 145) {
  await page.evaluate(({ selector, top }) => window.scrollTo({ top: document.querySelector(selector).getBoundingClientRect().top + scrollY - top, behavior: 'smooth' }), { selector, top });
  await page.waitForTimeout(850);
}

async function camera(page, box, duration = 850) {
  await page.evaluate(async ({ box, duration }) => {
    const app = window.comfyAPI.app.app, rect = app.canvas.canvas.getBoundingClientRect();
    const available = { x: 100, y: 145, width: 1720, height: 705 };
    const scale = Math.min(available.width / box.width, available.height / box.height, box.maxScale || 1.3);
    const target = [(available.x - rect.x + (available.width - box.width * scale) / 2) / scale - box.x, (available.y - rect.y + (available.height - box.height * scale) / 2) / scale - box.y];
    const startScale = app.canvas.ds.scale, start = [...app.canvas.ds.offset], began = performance.now();
    await new Promise(resolve => {
      function step(now) {
        const t = duration ? Math.min((now - began) / duration, 1) : 1, ease = t * t * (3 - 2 * t);
        app.canvas.ds.scale = startScale + (scale - startScale) * ease;
        app.canvas.ds.offset = start.map((value, i) => value + (target[i] - value) * ease);
        app.canvas.setDirty(true, true);
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
  }, { box, duration });
}

async function nodeCamera(page, type, index = 0, duration = 850) {
  const box = await page.evaluate(({ type, index }) => {
    const node = window.comfyAPI.app.app.graph._nodes.filter(node => node.type === type)[index];
    return { x: node.pos[0] - 30, y: node.pos[1] - 45, width: node.size[0] + 60, height: node.size[1] + 70, maxScale: 1.3 };
  }, { type, index });
  await camera(page, box, duration);
}

async function prepareComfy(context, page) {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(settings.comfy).origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.blockedComfyWrites.push({ method: request.method(), path: url.pathname });
      // Return a local acknowledgement for settings/autosave. Nothing reaches Comfy.
      if (/^\/(?:api\/)?(?:prompt|queue|interrupt)(?:\/|$)/.test(url.pathname)) return route.abort('blockedbyclient');
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'comfyui/workflows/comfy-hackathon.json'), 'utf8'));
  for (const node of graph.nodes) {
    if (node.type === 'CFZProjectSettings') {
      node.widgets_values[0] = SAMPLE_ROOT;
      node.widgets_values_named.root_directory = SAMPLE_ROOT;
    }
    if (['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.type)) {
      assert.equal(node.widgets_values_named.image, '');
      assert.equal(node.widgets_values_named.source_mode, 'Invent fictional reference');
    }
  }
  assert.ok(!/C:[\\/]Users[\\/]/i.test(JSON.stringify(graph)));
  await page.goto(settings.comfy, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.comfyAPI?.app?.app?.canvas?.canvas, null, { timeout: 60000 });
  await page.evaluate(async graph => window.comfyAPI.app.app.loadGraphData(graph, true, true), graph);
  await page.waitForTimeout(1500);
  if (await page.getByRole('button', { name: 'NO FAVORITED INPUTS', exact: true }).isVisible()) await page.getByRole('button', { name: 'Toggle properties panel', exact: true }).click();
  const minimap = page.getByRole('button', { name: 'Hide Minimap (ALT + SHIFT + M)', exact: true });
  if (await minimap.isVisible()) await minimap.click();
  const verified = await page.evaluate(async () => {
    const app = window.comfyAPI.app.app, prompt = (await app.graphToPrompt()).output;
    return { unknown: app.graph._nodes.filter(node => node.has_errors).map(node => node.type), images: app.graph._nodes.reduce((n, node) => n + (node.imgs?.length || 0), 0), factories: Object.values(prompt).filter(node => ['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.class_type)).map(node => ({ image: node.inputs.image, mode: node.inputs.source_mode })), root: Object.values(prompt).find(node => node.class_type === 'CFZProjectSettings').inputs.root_directory };
  });
  assert.deepEqual(verified.unknown, []); assert.equal(verified.images, 0); assert.equal(verified.factories.length, 9);
  assert.ok(verified.factories.every(factory => factory.image === '' && factory.mode === 'Invent fictional reference'));
  assert.equal(verified.root, SAMPLE_ROOT);
  report.comfy = verified;
}

async function prepareBuilder(page, load = false) {
  await page.goto(`${settings.game}/builder/`);
  await page.locator('#factory-slots').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#factory-characters .factory-slot').count(), 6);
  assert.equal(await page.locator('#factory-environments .factory-slot').count(), 3);
  // Browser-only framing. Content and application behavior are unchanged.
  await page.addStyleTag({ content: '.export-column{top:135px}.shell{max-width:1660px}.workspace{grid-template-columns:minmax(0,1fr) 420px}.export-panel h2{font-size:21px}.stats span{font-size:9px}.stats strong{font-size:32px}.factory-slot strong{font-size:15px}.factory-slot small{font-size:10px}.factory-slot-number{font-size:10px}.factory-summary,.factory-next{font-size:13px}.fighter-fields input[type=text]{font-size:16px}.fighter-preview{height:160px}.export-contents{display:none}' });
  if (load) await loadBundle(page);
}

async function loadBundle(page) {
  await page.locator('#folder-input').setInputFiles(BUNDLE);
  await page.locator('#customize-content').waitFor({ state: 'visible' });
  await page.waitForFunction(count => document.querySelector('#file-count').textContent === `${count}/${count}`, sourceBundle.assets.length);
  assert.equal(await page.locator('#allow-placeholders').isChecked(), false);
  assert.equal(await page.locator('.fighter-editor').count(), sourceBundle.game.fighters.length);
}

async function prepareGame(page) {
  await page.goto(settings.game);
  await page.waitForFunction(() => !!window.FighterDebug && !document.querySelector('#title-start').disabled);
  const manifest = await page.evaluate(async () => (await fetch('assets/manifest.json')).json());
  assert.ok(!manifest.generationPending, 'Video must show the generated game');
  assert.ok(manifest.fighters.length >= 2);
  assert.ok(manifest.fighters.every(fighter => Object.keys(fighter.poses).length === 27));
  report.game = { generatedFighters: manifest.fighters.length, generatedPoses: manifest.fighters.length * 27, stages: manifest.stages.length, humanPlayers: 1 };
}

async function capture(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: path.join(OUTPUT, 'raw'), size: { width: 1920, height: 1080 } }, reducedMotion: 'no-preference' });
  const page = await context.newPage(), video = page.video();
  page.setDefaultTimeout(15000);
  if (['04-main-factory', '05-source-mode', '06-character-design', '07-output-and-cost'].includes(name)) await prepareComfy(context, page);
  else if (['09-builder', '10-export'].includes(name)) await prepareBuilder(page, name === '10-export');
  else await prepareGame(page);
  if (name === '04-main-factory') await camera(page, { x: -550, y: -310, width: 2550, height: 2690 }, 0);
  if (['05-source-mode', '06-character-design'].includes(name)) {
    // Resize and move the selected node in this isolated editor for a readable
    // close-up; this is the same live node with its original inputs and links.
    await page.evaluate(() => {
      const app = window.comfyAPI.app.app, node = app.graph._nodes.find(node => node.type === 'CFZCharacterFactory');
      node.pos = [3100, 100]; node.setSize([850, 650]); app.canvas.setDirty(true, true);
    });
    await page.addStyleTag({ content: '[node-id="2"] textarea{font-size:14px!important;line-height:1.35!important}' });
    await nodeCamera(page, 'CFZCharacterFactory', 0, 0);
  }
  if (name === '07-output-and-cost') {
    await page.evaluate(() => {
      const app = window.comfyAPI.app.app, node = app.graph._nodes.find(node => String(node.id) === '13');
      node.pos = [3100, 100]; node.setSize([1100, 440]); app.canvas.setDirty(true, true);
    });
    await page.addStyleTag({ content: '.comfy-markdown-content p{font-size:16px!important;line-height:1.65!important}.comfy-markdown-content h1{font-size:26px!important}.comfy-markdown-content h2{font-size:20px!important}' });
    await nodeCamera(page, 'CFZProjectSettings', 0, 0);
  }
  if (name === '09-builder') await scrollTo(page, '#factory-panel');
  if (name === '10-export') {
    await scrollTo(page, '#customize-panel');
  }
  if (name === '11-play') await page.locator('#title-start').click();
  await cursor(page);
  await page.waitForTimeout(700);
  const began = Date.now(), at = async seconds => page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - began)));
  console.log(`Recording ${name}`);
  if (name === '01-result') {
    await at(5); await point(page, page.locator('#title-start'), true);
    await at(9); await point(page, page.locator('#fighter-grid .fighter-tile').first(), true);
    await at(14); await point(page, page.locator('#fighter-grid .fighter-tile').nth(1));
    assert.equal(await page.locator('#fighter-grid .fighter-tile.picked-one').getAttribute('data-fighter'), sourceBundle.game.fighters[0].id);
    assert.equal(await page.locator('#fighter-grid .fighter-tile.picked-two').getAttribute('data-fighter'), sourceBundle.game.fighters[1].id);
  } else if (name === '04-main-factory') {
    await at(4); await camera(page, { x: -25, y: 75, width: 1480, height: 1640 });
    await at(10); await camera(page, { x: -25, y: 1730, width: 1480, height: 620 });
    await at(15); await camera(page, { x: 1470, y: 560, width: 530, height: 850 });
  } else if (name === '05-source-mode') {
    const mode = page.getByText('Invent fictional reference', { exact: true }).first();
    await at(1); await camera(page, { x: 3050, y: 585, width: 950, height: 255, maxScale: 1.6 });
    await at(3); await point(page, mode, true);
    await at(7); await page.keyboard.press('Escape');
    await at(9); await nodeCamera(page, 'CFZCharacterFactory');
    await at(10); await point(page, page.locator('input[aria-label="name"]').first());
    await at(14); await point(page, page.locator('[node-id="2"] textarea').first());
  } else if (name === '06-character-design') {
    const description = page.locator('[node-id="2"] textarea').first();
    await at(2); await point(page, description, true);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Keep his stance grounded and his silhouette easy to read.', { delay: 28 });
    await at(8); await point(page, page.locator('input[aria-label="special_name"]').first(), true);
    await page.locator('input[aria-label="special_name"]').first().fill('Sizzle Burst');
    await at(12); await point(page, page.locator('input[aria-label="intro_tagline"]').first(), true);
    await page.locator('input[aria-label="intro_tagline"]').first().fill('The grill is hot. Your winning streak is toast.');
    await at(15); await page.keyboard.press('Tab');
  } else if (name === '07-output-and-cost') {
    await at(2); await point(page, page.locator('input[aria-label="root_directory"]'), true);
    await page.keyboard.press('Control+A');
    await at(6); await page.keyboard.press('End'); await page.keyboard.press('Tab');
    await at(8); await nodeCamera(page, 'MarkdownNote', 0);
    await at(14); await nodeCamera(page, 'CFZExportGameAssets');
  } else if (name === '09-builder') {
    await at(4); await scrollTo(page, '#input-panel');
    await point(page, page.locator('label[for="folder-input"]'));
    await at(7); await loadBundle(page); await scrollTo(page, '#customize-panel');
    await at(10); await point(page, page.locator('#game-title'), true); await page.locator('#game-title').fill('Backyard Champions');
    await at(13); await point(page, page.locator('[data-fighter-name]').first(), true); await page.locator('[data-fighter-name]').first().fill(`${sourceBundle.game.fighters[0].name} Prime`);
    await at(16); await point(page, page.locator('[data-fighter-color]').first());
    await page.locator('[data-fighter-color]').first().fill('#ff9e45');
  } else if (name === '10-export') {
    await at(2); await point(page, page.locator('#build-button'), true);
    await page.locator('#export-ready').waitFor({ state: 'visible', timeout: 60000 });
    assert.match(await page.locator('#status').innerText(), /custom game is built/i);
    assert.equal(await page.locator('#allow-placeholders').isChecked(), false);
    report.export = { strict: true, assets: await page.locator('#file-count').innerText(), summary: await page.locator('#build-summary').innerText(), status: await page.locator('#status').innerText() };
    await at(12); await point(page, page.locator('#download-zip'));
    await at(16); await point(page, page.locator('#export-directory'));
  } else if (name === '11-play') {
    await at(1); await point(page, page.locator('#start-button'), true);
    await page.locator('#intro-screen').waitFor({ state: 'visible' });
    await at(6); if (await page.locator('#intro-skip').isVisible()) await page.locator('#intro-skip').click();
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    await page.locator('#arena').click({ position: { x: 900, y: 300 } });
    await page.mouse.move(1800, 810, { steps: 12 });
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(650); await page.keyboard.up('ArrowRight');
    for (const key of ['a', 's', 'd', 'f', 'ArrowUp', 'a', 's', 'ArrowDown', 'd', 'f']) {
      await page.keyboard.press(key); await page.waitForTimeout(650);
    }
    report.combat = await page.evaluate(() => ({ presentation: window.FighterDebug.presentation(), phase: window.FighterDebug.snapshot().phase }));
  }
  await at(19.5);
  await page.screenshot({ path: path.join(OUTPUT, `${name}.png`) });
  await at(20);
  await context.close();
  const raw = await video.path();
  const source = JSON.parse(command('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', raw]));
  const duration = Number(source.format.duration);
  const target = path.join(OUTPUT, `${name}.webm`);
  command('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, duration - 20)), '-i', raw, '-t', '20', '-an', '-vf', 'fps=30,scale=1920:1080', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', target]);
  const output = JSON.parse(command('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', target]));
  const stream = output.streams.find(item => item.codec_type === 'video');
  assert.equal(stream.width, 1920); assert.equal(stream.height, 1080);
  assert.ok(Number(output.format.duration) >= 19.8);
  report.scenes.push({ name, seconds: Number(output.format.duration), width: stream.width, height: stream.height, fps: stream.r_frame_rate, bytes: fs.statSync(target).size });
  fs.writeFileSync(path.join(OUTPUT, `${name}.capture.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved ${name}.webm (${output.format.duration}s)`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'], ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  try {
    for (const scene of settings.scene ? [settings.scene] : SCENES) await capture(browser, scene);
    assert.ok(!report.blockedComfyWrites.some(request => /^\/(?:api\/)?(?:prompt|queue|interrupt)(?:\/|$)/.test(request.path)), 'An execution request was attempted');
    writeManifest();
    console.log('Finished. No cloud jobs submitted; installed game unchanged.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
