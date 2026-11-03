// Capture the real local interfaces for documentation. Never submits ComfyUI jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'comfyui/docs/images');
const SAMPLE_ROOT = 'C:/comfy-fighter-z/output/test-runs/first-game/bundle';
const SCREENSHOTS = ['01-factory-overview.png', '02-character-factory.png', '03-builder-start.png', '04-builder-customize.png', '05-export-ready.png', '06-game-title.png', '07-gameplay.png'];

function options(argv) {
  const result = { comfy: 'http://127.0.0.1:8188', game: null };
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--comfy-url', '--game-url'].includes(argv[index]) || !argv[index + 1]) {
      throw new Error('Usage: node build/tools/capture-readme.cjs [--comfy-url http://127.0.0.1:8188] [--game-url http://127.0.0.1:8089]');
    }
    const value = new URL(argv[index + 1]);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname)) throw new Error('Documentation capture requires a local server.');
    result[argv[index] === '--comfy-url' ? 'comfy' : 'game'] = value.href.replace(/\/$/, '');
  }
  return result;
}

async function previewServer() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    let log = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Preview startup timed out')); }, 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited (${code}): ${log}`)); });
    child.stderr.on('data', chunk => { log += String(chunk); });
    child.stdout.on('data', chunk => { if (String(chunk).includes(url)) { clearTimeout(timeout); resolve(); } });
  });
  return { child, url };
}

async function screenshot(page, name, clip) {
  await page.screenshot({ path: path.join(OUTPUT, name), animations: 'disabled', ...(clip ? { clip } : {}) });
}

async function captureComfy(browser, url, report) {
  const context = await browser.newContext({ viewport: { width: 2000, height: 1900 }, deviceScaleFactor: 1 });
  // The graph only changes in this isolated browser. Block execution and every other
  // HTTP write to the server, including autosave, so capture cannot change a session.
  await context.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin === new URL(url).origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      const pathname = new URL(request.url()).pathname;
      report.blockedComfyWrites.push({ method: request.method(), path: pathname });
      // Panel/minimap controls update the isolated UI normally without persisting
      // preferences into the user's server profile or showing a failed-save toast.
      if (/^\/(?:api\/)?settings\//.test(pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'comfyui/workflows/comfy-hackathon.json'), 'utf8'));
  for (const node of graph.nodes) {
    if (node.type === 'CFZProjectSettings') {
      node.widgets_values[0] = SAMPLE_ROOT;
      node.widgets_values_named.root_directory = SAMPLE_ROOT;
    }
    if (['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.type)) {
      assert.equal(node.widgets_values_named.image, '', 'Shipped demo selectors must be empty');
      assert.equal(node.widgets_values_named.source_mode, 'Invent fictional reference');
    }
  }
  assert.ok(!JSON.stringify(graph).match(/C:[\\/]Users[\\/]/i), 'Screenshot graph may not contain a personal filesystem path');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.comfyAPI?.app?.app?.canvas?.canvas, null, { timeout: 60000 });
  await page.evaluate(async data => { await window.comfyAPI.app.app.loadGraphData(data, true, true); }, graph);
  await page.waitForTimeout(1200);
  if (await page.getByRole('button', { name: 'NO FAVORITED INPUTS', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Toggle properties panel', exact: true }).click();
  }
  const minimap = page.getByRole('button', { name: 'Hide Minimap (ALT + SHIFT + M)', exact: true });
  if (await minimap.isVisible()) await minimap.click();
  report.comfy = await page.evaluate(async () => {
    const app = window.comfyAPI.app.app;
    const prompt = (await app.graphToPrompt()).output;
    return {
      unknownNodes: app.graph._nodes.filter(node => node.has_errors).map(node => node.type),
      visibleImages: app.graph._nodes.reduce((count, node) => count + (node.imgs?.length || 0), 0),
      types: app.graph._nodes.map(node => node.type),
      sourceInputs: Object.values(prompt).filter(node => ['CFZCharacterFactory', 'CFZEnvironmentFactory'].includes(node.class_type)).map(node => ({ image: node.inputs.image, sourceMode: node.inputs.source_mode })),
      sampleRoot: Object.values(prompt).find(node => node.class_type === 'CFZProjectSettings').inputs.root_directory
    };
  });
  assert.deepEqual(report.comfy.unknownNodes, []);
  assert.equal(report.comfy.visibleImages, 0);
  assert.equal(report.comfy.types.filter(type => type === 'CFZCharacterFactory').length, 6);
  assert.equal(report.comfy.types.filter(type => type === 'CFZEnvironmentFactory').length, 3);
  assert.ok(report.comfy.sourceInputs.every(input => input.image === '' && input.sourceMode === 'Invent fictional reference'));
  assert.equal(report.comfy.sampleRoot, SAMPLE_ROOT);
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const nodes = app.graph._nodes;
    const minX = Math.min(...nodes.map(node => node.pos[0])) - 35;
    const minY = Math.min(...nodes.map(node => node.pos[1] - 35)) - 35;
    const maxX = Math.max(...nodes.map(node => node.pos[0] + node.size[0])) + 35;
    const maxY = Math.max(...nodes.map(node => node.pos[1] + node.size[1])) + 35;
    const width = app.canvas.canvas.clientWidth - 170, height = app.canvas.canvas.clientHeight - 210;
    const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
    app.canvas.ds.scale = scale;
    app.canvas.ds.offset = [-minX + (width / scale - (maxX - minX)) / 2 + 110 / scale, -minY + (height / scale - (maxY - minY)) / 2 + 140 / scale];
    app.canvas.setDirty(true, true);
  });
  await page.waitForTimeout(700);
  await screenshot(page, '01-factory-overview.png', { x: 75, y: 115, width: 1920, height: 1770 });

  await page.setViewportSize({ width: 1200, height: 1150 });
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const node = app.graph._nodes.find(node => node.type === 'CFZCharacterFactory');
    app.canvas.ds.scale = 1.2;
    app.canvas.ds.offset = [145 - node.pos[0], 170 - node.pos[1]];
    app.canvas.setDirty(true, true);
  });
  await page.waitForTimeout(700);
  const detail = await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const node = app.graph._nodes.find(node => node.type === 'CFZCharacterFactory');
    const box = app.canvas.canvas.getBoundingClientRect(), scale = app.canvas.ds.scale;
    return { x: box.x + 154, y: box.y + 154, width: Math.ceil((node.size[0] + 36) * scale), height: Math.ceil((node.size[1] + 65) * scale) };
  });
  await screenshot(page, '02-character-factory.png', detail);
  await context.close();
}

async function captureBuilder(browser, url, report) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  await page.goto(`${url}/builder/`);
  await page.locator('#factory-slots').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#factory-characters .factory-slot').count(), 6);
  assert.equal(await page.locator('#factory-environments .factory-slot').count(), 3);
  assert.equal(await page.locator('#factory-environments [data-enabled="false"]').count(), 2);
  await page.locator('#factory-panel').screenshot({ path: path.join(OUTPUT, '03-builder-start.png'), animations: 'disabled' });
  await page.click('#load-example');
  await page.locator('#customize-content').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#fighter-list .fighter-editor').count(), 6);
  assert.equal(await page.locator('#allow-placeholders').isChecked(), false);
  assert.ok((await page.locator('#file-count').innerText()).startsWith('0/'));
  await page.setViewportSize({ width: 1440, height: 1550 });
  await page.locator('#customize-panel').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#customize-panel').getBoundingClientRect().top + window.scrollY - 20));
  const customize = await page.locator('#customize-panel').boundingBox();
  const stages = await page.locator('#stage-list').boundingBox();
  await screenshot(page, '04-builder-customize.png', { x: customize.x, y: Math.max(0, customize.y), width: customize.width, height: Math.ceil(stages.y + stages.height - customize.y + 18) });
  await page.click('#build-button');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Missing'));
  assert.equal(await page.locator('#export-ready').isVisible(), false, 'Strict build must reject the empty example');
  await page.check('#allow-placeholders');
  await page.click('#build-button');
  await page.locator('#export-ready').waitFor({ state: 'visible', timeout: 60000 });
  assert.match(await page.locator('#status').innerText(), /Prototype built/);
  await page.locator('.export-panel').screenshot({ path: path.join(OUTPUT, '05-export-ready.png'), animations: 'disabled' });
  report.builder = {
    characters: 6, environments: 3, disabledEnvironments: 2,
    source: await page.locator('#example-notice').innerText(),
    found: await page.locator('#file-count').innerText(),
    strictMissingFilesRejected: true,
    placeholdersExplicitlyEnabled: await page.locator('#allow-placeholders').isChecked(),
    result: await page.locator('#status').innerText()
  };
  await page.close();
}

async function captureGame(browser, url, report) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction(() => !!window.FighterDebug && !document.querySelector('#title-start').disabled);
  const manifest = await page.evaluate(async () => (await fetch('assets/manifest.json')).json());
  assert.equal(manifest.generationPending, true, 'These screenshots document the current media-free prototype');
  assert.equal(manifest.demoSource, 'fictional-text-only');
  assert.ok(!manifest.openingVideo);
  assert.ok(manifest.fighters.every(fighter => Object.keys(fighter.poses).length === 0 && !fighter.hero && !fighter.portrait && !fighter.cutin && !fighter.sourceImage));
  assert.ok(manifest.stages.every(stage => !stage.src && !stage.sourceImage));
  assert.equal(Object.keys(manifest.audio || {}).length, 0);
  assert.equal(Object.keys(manifest.effects || {}).length, 0);
  assert.equal(Object.keys(manifest.ui || {}).length, 0);
  assert.equal(await page.locator('#opening-screen').isVisible(), false);
  await screenshot(page, '06-game-title.png');
  await page.click('#title-start');
  await page.click('#start-button');
  await page.locator('#intro-screen').waitFor({ state: 'visible' });
  await page.click('#intro-skip');
  await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('KeyA');
  await page.waitForTimeout(70);
  assert.equal(await page.locator('#placeholder-label').isVisible(), true);
  await screenshot(page, '07-gameplay.png');
  report.game = { pending: true, fictionalOnly: true, generatedFighterPoses: 0, introSkipped: true, humanPlayers: (await page.evaluate(() => window.FighterDebug.presentation())).humanPlayers, prototypeLabel: await page.locator('#placeholder-label').innerText() };
  await page.close();
}

(async () => {
  const settings = options(process.argv.slice(2));
  fs.mkdirSync(OUTPUT, { recursive: true });
  const report = { capturedAt: new Date().toISOString(), generationSubmitted: false, screenshotDirectory: 'comfyui/docs/images', blockedComfyWrites: [] };
  let server, browser;
  try {
    if (!settings.game) { server = await previewServer(); settings.game = server.url; }
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    await captureComfy(browser, settings.comfy, report);
    await captureBuilder(browser, settings.game, report);
    await captureGame(browser, settings.game, report);
    report.screenshots = SCREENSHOTS.map(name => {
      const bytes = fs.readFileSync(path.join(OUTPUT, name));
      return { name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    assert.ok(!report.blockedComfyWrites.some(request => /^\/(?:api\/)?(?:prompt|queue|interrupt)(?:\/|$)/.test(request.path)), 'Capture attempted an execution request');
    const reports = path.join(ROOT, 'output/diagnostics');
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, 'readme-capture.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Captured seven fresh UI screenshots in comfyui/docs/images/. No cloud jobs submitted.');
  } finally {
    if (browser) await browser.close();
    if (server) server.child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
