// Real browser lifecycle checks for optional title and opening video; no cloud calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { browserLaunchOptions } = require('../tools/build-bundle.cjs');
const { createGameServer } = require('../server/server.cjs');
const project = path.resolve(__dirname, '../..');
const root = path.resolve(process.env.CFZ_BROWSER_GAME_ROOT || path.join(project, 'output/game'));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/opening.mp4'));
const baseManifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/manifest.json')));
(async () => {
  const server = createGameServer({ root }); const address = await server.listen(0, '127.0.0.1');
  const browser = await chromium.launch(browserLaunchOptions(['--disable-features=LocalNetworkAccessChecks']));
  const errors = [];
  async function pageFor({ opening = null, title = { src: 'assets/video/title.mp4', duration: 2 }, missing = false, reducedMotion = 'no-preference' } = {}) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1) || 'index.html';
      if (['index.html', 'game.js', 'style.css'].includes(name)) {
        return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(project, 'build/public', name)) });
      }
      return route.continue();
    });
    const manifest = structuredClone(baseManifest); manifest.openingVideo = opening; manifest.titleVideo = title;
    await page.route('**/assets/manifest.json', route => route.fulfill({ json: manifest }));
    await page.route('**/assets/video/title.mp4', route => missing ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ body: fixture, contentType: 'video/mp4' }));
    await page.route('**/assets/video/opening.mp4', route => route.fulfill({ body: fixture, contentType: 'video/mp4' }));
    await page.goto(`http://127.0.0.1:${address.port}/`); await page.waitForFunction(() => window.FighterDebug && !document.querySelector('#title-start').disabled);
    return page;
  }
  try {
    let page = await pageFor();
    await page.waitForFunction(() => FighterDebug.presentation().titleMedia === 'video');
    assert.equal(await page.locator('#title-video').evaluate(v => v.muted && v.loop && !v.paused), true);
    await page.click('#settings-open'); await page.waitForFunction(() => document.querySelector('#title-video').paused);
    await page.click('#settings-close'); await page.waitForFunction(() => FighterDebug.presentation().titleMedia === 'video' && !document.querySelector('#title-video').paused);
    await page.click('#title-start'); await page.waitForFunction(() => document.querySelector('#title-video').paused);
    await page.click('#title-return'); await page.waitForFunction(() => FighterDebug.presentation().titleMedia === 'video');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('#title-video').paused && FighterDebug.presentation().titleMedia === 'image');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => FighterDebug.presentation().titleMedia === 'video');
    // The game ignores prefers-reduced-motion on purpose (AGENTS.md), so the title keeps looping when it is requested.
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => FighterDebug.presentation().titleMedia), 'video', 'Reduced motion does not stop the title loop');
    assert.equal(await page.locator('#title-video').evaluate(v => !v.paused), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('PASS title loops muted, pauses in settings/selection/hidden tabs, resumes, and ignores reduced motion on purpose'); await page.close();
    page = await pageFor({ opening: { id: 'opening', src: 'assets/video/opening.mp4', duration: 2, hasAudio: false } });
    await page.waitForFunction(() => FighterDebug.presentation().screen === 'opening');
    assert.equal(await page.locator('#opening-sound').isVisible(), false); assert.equal(await page.locator('#opening-video').evaluate(v => v.muted), true);
    await page.keyboard.press('Space'); await page.waitForFunction(() => FighterDebug.presentation().screen === 'title' && FighterDebug.presentation().titleMedia === 'video');
    console.log('PASS silent opening skips to animated title with Space'); await page.close();
    page = await pageFor({ opening: { id: 'opening', src: 'assets/video/opening.mp4', duration: 2 } });
    await page.waitForFunction(() => FighterDebug.presentation().screen === 'opening'); assert.equal(await page.locator('#opening-sound').isVisible(), true); await page.close();
    console.log('PASS older audible opening keeps its sound control');
    page = await pageFor({ missing: true }); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => FighterDebug.presentation().titleMedia), 'image'); assert.equal(await page.locator('#title-start').isEnabled(), true); await page.close();
    page = await pageFor({ title: { src: 'https://untrusted.invalid/title.mp4', duration: 2 } }); await page.waitForTimeout(200);
    assert.equal(await page.locator('#title-video').evaluate(v => v.hasAttribute('src')), false); await page.close();
    console.log('PASS unavailable and unsafe title videos retain the static image'); assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
