// Record only a known workflow and fresh run outputs. Never submits ComfyUI work.
// Stop by writing {"stop":true} to the output folder's control.json.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { browserPath } = require('./render-explainer-cards.cjs');
const ROOT = path.resolve(__dirname, '../..');
const options = { server: 'http://127.0.0.1:8188', expected: 7, label: 'Fictional reference photos', sampleRoot: 'C:/comfy-fighter-z/output/my-phone-photo-game/bundle' };
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i].slice(2);
  if (!['workflow', 'watch', 'out', 'server', 'expected', 'label'].includes(name) || !process.argv[i + 1]) throw new Error('Usage: node build/tools/record-comfy-generation.cjs --workflow GRAPH.json --watch FRESH_RUN_FOLDER --out CAPTURE_FOLDER --expected 7 --label "Fictional reference photos"');
  options[name] = name === 'expected' ? Number(process.argv[i + 1]) : process.argv[i + 1];
}
for (const name of ['workflow', 'watch', 'out']) assert.ok(options[name], `Missing --${name}`);
const workflow = path.resolve(ROOT, options.workflow), watch = path.resolve(ROOT, options.watch), output = path.resolve(ROOT, options.out);
assert.ok(output.startsWith(path.join(ROOT, 'output') + path.sep), 'Recording output must be under project output/');
assert.ok(watch.startsWith(path.join(ROOT, 'output') + path.sep) || /[\\/]ComfyUI[\\/]output[\\/]comfy-fighter-z[\\/]phone-photo-demo[\\/][^\\/]+$/i.test(watch), 'Watch only this project output or a specifically scoped Comfy phone-photo run');
const server = new URL(options.server); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(server.hostname));
fs.mkdirSync(output, { recursive: true });
assert.ok(!fs.existsSync(path.join(output, 'recorder-ready.json')), 'Use a fresh capture folder');
const control = path.join(output, 'control.json'); fs.writeFileSync(control, '{"stop":false}\n');
function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? files(child) : /\.(png|webp|wav|mp3|flac)$/i.test(entry.name) ? [child] : [];
  });
}
function sanitize(value) {
  if (typeof value === 'string' && /(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/)/.test(value)) return options.sampleRoot;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  return value;
}

(async () => {
  const graph = sanitize(JSON.parse(fs.readFileSync(workflow, 'utf8')));
  assert.ok(!/[A-Za-z]:[\\/]Users[\\/]/i.test(JSON.stringify(graph)));
  const browser = await chromium.launch({ headless: true, executablePath: browserPath(), args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: path.join(output, 'raw'), size: { width: 1920, height: 1080 } } });
  const blocked = [], events = [], startedAt = Date.now();
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === server.origin && /\/(?:api\/)?view$/.test(url.pathname) && !/^cfz-phone-20261103-phone-cast-/.test(url.searchParams.get('filename') || '')) return route.abort('blockedbyclient');
    if (url.origin === server.origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  const page = await context.newPage(), video = page.video();
  try {
    await page.goto(server.href);
    await page.waitForFunction(() => !!window.comfyAPI?.app?.app?.canvas, null, { timeout: 60000 });
    await page.evaluate(async graph => window.comfyAPI.app.app.loadGraphData(graph, true, true), graph);
    await page.waitForTimeout(1300);
    if (await page.getByRole('button', { name: 'NO FAVORITED INPUTS', exact: true }).isVisible()) await page.getByRole('button', { name: 'Toggle properties panel', exact: true }).click();
    const minimap = page.getByRole('button', { name: 'Hide Minimap (ALT + SHIFT + M)', exact: true }); if (await minimap.isVisible()) await minimap.click();
    const bad = await page.evaluate(() => window.comfyAPI.app.app.graph._nodes.filter(node => node.has_errors).map(node => node.type)); assert.deepEqual(bad, []);
    await page.evaluate(({ label, expected }) => {
      const app = window.comfyAPI.app.app, nodes = app.graph._nodes.filter(node => node.type !== 'MarkdownNote');
      const left = Math.min(...nodes.map(node => node.pos[0])) - 40, top = Math.min(...nodes.map(node => node.pos[1])) - 60;
      const right = Math.max(...nodes.map(node => node.pos[0] + node.size[0])) + 40, bottom = Math.max(...nodes.map(node => node.pos[1] + node.size[1])) + 40;
      const scale = Math.min(1710 / (right - left), 570 / (bottom - top));
      app.canvas.ds.scale = scale; app.canvas.ds.offset = [100 / scale - left + (1710 / scale - (right - left)) / 2, 300 / scale - top]; app.canvas.setDirty(true, true);
      const panel = document.createElement('div'); panel.id = 'run-evidence'; panel.style.cssText = 'position:fixed;left:90px;right:90px;top:130px;height:130px;z-index:2147483646;background:#0c162bed;border:1px solid #4a6680;border-radius:16px;padding:18px 28px;color:#f4f6ff;font-family:Arial;box-sizing:border-box;box-shadow:0 10px 30px #0008';
      const heading = document.createElement('div'); heading.textContent = label; heading.style.cssText = 'font-size:30px;font-weight:700;color:#ffda53;margin-bottom:10px';
      const counter = document.createElement('div'); counter.id = 'run-count'; counter.textContent = `0 / ${expected} media files saved`; counter.style.cssText = 'font-size:24px';
      const disclosure = document.createElement('div'); disclosure.textContent = 'ACTUAL RUN OUTPUTS • AI-GENERATED FICTIONAL PEOPLE AND PLACES'; disclosure.style.cssText = 'font-size:13px;letter-spacing:2px;color:#83e8e3;margin-top:10px';
      panel.append(heading, counter, disclosure); document.body.append(panel);
    }, options);
    const readyAt = Date.now(), ready = { readyAt: new Date(readyAt).toISOString(), workflow: path.relative(ROOT, workflow).replaceAll('\\', '/'), watch: path.relative(ROOT, watch).replaceAll('\\', '/'), expected: options.expected, label: options.label, videoPreparationSeconds: (readyAt - startedAt) / 1000, stopsWhen: 'control.json contains stop:true', blockedComfyWrites: true, inferenceSubmitted: false };
    fs.writeFileSync(path.join(output, 'recorder-ready.json'), JSON.stringify(ready, null, 2) + '\n');
    console.log(`READY: ${path.relative(ROOT, output)}. Queue the already-approved workflow separately. Stop via control.json.`);
    let last = -1, lastShot = 0;
    while (!JSON.parse(fs.readFileSync(control, 'utf8')).stop) {
      const count = files(watch).length, elapsed = (Date.now() - readyAt) / 1000;
      await page.evaluate(({ count, expected }) => { document.querySelector('#run-count').textContent = `${count} / ${expected} media files saved${count >= expected ? ' • OUTPUTS COMPLETE' : ' • Live output count'}`; }, { count, expected: options.expected });
      if (count !== last) {
        events.push({ elapsed, count, observedAt: new Date().toISOString() }); last = count;
        console.log(`${options.label}: ${count}/${options.expected} saved`);
        await page.screenshot({ path: path.join(output, `progress-${String(count).padStart(3, '0')}.png`) });
      }
      if (elapsed - lastShot >= 5) { await page.screenshot({ path: path.join(output, 'latest.png') }); lastShot = elapsed; }
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: path.join(output, 'finished.png') });
    await context.close();
    const raw = await video.path();
    fs.writeFileSync(path.join(output, 'recording.json'), JSON.stringify({ ...ready, stoppedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - readyAt) / 1000, video: path.relative(output, raw).replaceAll('\\', '/'), blocked, events, disclosure: 'Real ComfyUI interface; graph layout and visible absolute root sanitized only in isolated browser. Counter observes only this run folder. Preparation frames must be excluded; condensed playback must be labeled.' }, null, 2) + '\n');
    console.log(`STOPPED: ${path.relative(ROOT, output)}; recording.json identifies the raw video and exact progress event times.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
