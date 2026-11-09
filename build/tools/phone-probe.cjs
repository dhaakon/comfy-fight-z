// Phone-emulated performance probe for the served game. It drives the lite build into a fight (or holds a menu),
// throttles the CPU, samples animation-frame intervals and takes a CPU profile, then prints frame pacing, the
// renderer's own stats and the functions with the most self time. Headless Chromium rasterizes WebGL in software,
// so absolute numbers are not a phone's, but the main-thread share, long frames and mid-fight stalls are visible.
// Usage: node build/tools/phone-probe.cjs [--url http://127.0.0.1:8080/] [--throttle 4] [--renderer pixi|canvas]
//        [--screen fight|title|select] [--portrait] [--seconds 6] [--top 20] [--shot <png>]
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { browserLaunchOptions } = require('./build-bundle.cjs');
const args = process.argv.slice(2), option = (name, fallback) => { const index = args.indexOf('--' + name); return index >= 0 ? args[index + 1] : fallback; };
const url = option('url', 'http://127.0.0.1:8080/'), throttle = Number(option('throttle', 4)), renderer = option('renderer', 'pixi');
const screen = option('screen', 'fight'), seconds = Number(option('seconds', 6)), top = Number(option('top', 20)), portrait = args.includes('--portrait'), shot = option('shot', null);
(async () => {
  const browser = await chromium.launch(browserLaunchOptions(['--autoplay-policy=no-user-gesture-required', '--mute-audio']));
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: portrait ? { width: 390, height: 844 } : { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  try {
    const target = `${url}${url.includes('?') ? '&' : '?'}lite=1${renderer === 'canvas' ? '&renderer=canvas' : ''}`;
    await page.goto(target); await page.waitForFunction(() => window.FighterDebug && !document.querySelector('#title-start').disabled, null, { timeout: 60000 });
    const gate = page.locator('#boot-enter'); if (await gate.isVisible().catch(() => false)) await gate.click();
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title', null, { timeout: 20000 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    if (screen !== 'title') { await page.click('#title-start'); await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'selection'); }
    if (screen === 'fight') {
      await page.click('#start-button');
      await page.waitForFunction(() => window.FighterDebug.presentation().introSlot === 0 || window.FighterDebug.snapshot()?.phase === 'fight', null, { timeout: 30000 });
      if (await page.locator('#intro-skip').isVisible().catch(() => false)) await page.click('#intro-skip');
      await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight', null, { timeout: 30000 });
      // Walk forward so the fighters meet and trade hits.
      await page.evaluate(() => { window.__probeHold = setInterval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true })), 100); });
    }
    await page.waitForTimeout(1500);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    const sampling = page.evaluate(ms => new Promise(resolve => {
      const deltas = []; let last = performance.now(), start = last, long = 0;
      const loop = now => { const delta = now - last; last = now; deltas.push(delta); if (delta > 34) long++; if (now - start < ms) requestAnimationFrame(loop); else resolve({ deltas, long }); };
      requestAnimationFrame(loop);
    }), seconds * 1000);
    await cdp.send('Profiler.start');
    const sampled = await sampling;
    const { profile } = await cdp.send('Profiler.stop');
    const facts = await page.evaluate(() => { const p = window.FighterDebug.presentation(); return { renderer: window.FighterDebug.renderer(), stats: window.FighterDebug.rendererStats(), stage: p.stageId, lite: p.lite, drawRate: p.drawRate, phase: window.FighterDebug.snapshot()?.phase, canvas: [document.getElementById('arena').width, document.getElementById('arena').height] }; });
    if (shot) { await page.evaluate(() => clearInterval(window.__probeHold)); await page.screenshot({ path: shot }); }
    const deltas = sampled.deltas.slice(5).sort((a, b) => a - b), percentile = p => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))].toFixed(1);
    const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    console.log(JSON.stringify({ target, throttle, screen, ...facts, frames: deltas.length, meanMs: mean.toFixed(1), p50: percentile(.5), p90: percentile(.9), p99: percentile(.99), max: deltas[deltas.length - 1].toFixed(1), over34ms: sampled.long, fpsEquivalent: (1000 / mean).toFixed(1) }, null, 1));
    const nodes = new Map(profile.nodes.map(node => [node.id, node])), self = new Map(), files = new Map(); let total = 0;
    profile.samples.forEach((id, index) => {
      const frame = nodes.get(id).callFrame, time = profile.timeDeltas[index] || 0, file = frame.url ? frame.url.split('/').slice(-1)[0] : `(${frame.functionName || 'native'})`;
      const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').slice(-2).join('/')}:${frame.lineNumber + 1}`;
      total += time; self.set(key, (self.get(key) || 0) + time); files.set(file, (files.get(file) || 0) + time);
    });
    console.log(`\nTop self time (${(total / 1000).toFixed(0)} ms sampled):`);
    for (const [key, time] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(time / total * 100).toFixed(1).padStart(5)}%  ${(time / 1000).toFixed(0).padStart(5)} ms  ${key}`);
    console.log('\nBy file:'); for (const [key, time] of [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${(time / total * 100).toFixed(1).padStart(5)}%  ${key}`);
    if (errors.length) { console.log('\nPage errors and warnings:'); for (const error of errors.slice(0, 10)) console.log('  ' + error); process.exitCode = 1; }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
