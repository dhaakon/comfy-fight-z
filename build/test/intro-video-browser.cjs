// Browser integration checks for generated fighter intro clips. No cloud calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { browserLaunchOptions } = require('../tools/build-bundle.cjs');
const { createGameServer } = require('../server/server.cjs');
const project = path.resolve(__dirname, '../..');
const root = path.resolve(process.env.CFZ_BROWSER_GAME_ROOT || path.join(project, 'output/game'));
// The optional eight-second fixture can be produced locally by looping opening.mp4;
// the checked-in two-second clip keeps the test independent of ffmpeg.
const fixture = fs.readFileSync(process.env.CFZ_INTRO_FIXTURE || path.join(__dirname, 'fixtures/opening.mp4'));
const originalManifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/manifest.json')));
(async () => {
  const server = createGameServer({ root });
  const address = await server.listen(0, '127.0.0.1');
  const browser = await chromium.launch(browserLaunchOptions(['--disable-features=LocalNetworkAccessChecks']));
  const errors = [];
  async function pageFor(clips, opts = {}) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    // Separate headless contexts emulate separate physical players.
    await page.addInitScript(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.hasFocus = () => true;
      window.addEventListener('blur', event => { if (event.isTrusted) event.stopImmediatePropagation(); }, true);
    });
    // Exercise current source against a reviewed export without overwriting it.
    await page.route('**/*', route => {
      const name = new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html';
      if (['index.html', 'game.js', 'style.css', 'anim.js', 'engine.js', 'render/arena.js', 'render/canvas-renderer.js', 'render/pixi-renderer.js', 'vendor/pixi.min.js'].includes(name)) {
        const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript';
        return route.fulfill({ contentType: type, body: fs.readFileSync(path.join(project, 'build/public', name)) });
      }
      return route.continue();
    });
    const manifest = structuredClone(originalManifest);
    // Only the clips under test are mapped, whatever the export root ships.
    manifest.fighters.forEach(fighter => delete fighter.introVideo);
    for (const [index, clip] of Object.entries(clips)) manifest.fighters[Number(index)].introVideo = clip;
    await page.route('**/assets/manifest.json', route => route.fulfill({ json: manifest }));
    await page.route('**/assets/video/**', route => opts.missing ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ body: fixture, contentType: 'video/mp4' }));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => window.FighterDebug && !document.querySelector('#title-start').disabled);
    if (await page.locator('#opening-screen').isVisible()) await page.click('#opening-skip');
    // Versus keeps the chosen opponent, so both mapped clips play in order.
    if (!opts.lobby) { await page.click('#title-versus'); await page.click('#start-button'); }
    return page;
  }
  try {
    let page = await pageFor({ 0: { src: 'assets/video/intro-griddle.mp4', duration: 8 }, 1: { src: 'assets/video/intro-rivet.mp4', duration: 8 } });
    await page.waitForFunction(() => FighterDebug.presentation().introMedia === 'video', null, { timeout: 6000 });
    const started = Date.now();
    assert.equal(await page.locator('#intro-video').isVisible(), true);
    assert.equal(await page.locator('#intro-video').evaluate(v => v.muted), true);
    assert.equal(await page.evaluate(() => FighterDebug.snapshot().frame), 0);
    await page.click('#settings-open');
    await page.waitForFunction(() => document.querySelector('#intro-video').paused);
    const pausedAt = await page.locator('#intro-video').evaluate(v => v.currentTime);
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await page.locator('#intro-video').evaluate(v => v.currentTime)) - pausedAt) < .05, 'Paused introduction video must stop');
    assert.equal(await page.evaluate(() => FighterDebug.snapshot().frame), 0);
    await page.click('#settings-close');
    await page.waitForFunction(() => !document.querySelector('#intro-video').paused);
    // Both clips play side by side on one screen.
    await page.waitForFunction(() => FighterDebug.presentation().introHalves?.every(media => media === 'video'), null, { timeout: 12000 });
    assert.equal(await page.locator('#intro-video-2').isVisible(), true);
    assert.equal(await page.evaluate(() => FighterDebug.snapshot().frame), 0);
    if (process.env.CFZ_INTRO_FIXTURE) { await page.waitForTimeout(7600 - (Date.now() - started)); assert.equal(await page.evaluate(() => FighterDebug.presentation().screen), 'intro', 'Eight-second clips play through rather than being cut short'); }
    await page.click('#intro-skip');
    await page.waitForFunction(() => FighterDebug.snapshot().phase === 'fight');
    assert.equal(await page.locator('#intro-video').evaluate(v => v.paused && !v.hasAttribute('src')), true);
    console.log('PASS video plays muted, freezes combat, pauses/resumes, advances to second fighter and skips');
    await page.close();

    page = await pageFor({ 0: { src: 'assets/video/intro-missing.mp4', duration: 8 } }, { missing: true });
    await page.waitForFunction(() => FighterDebug.presentation().introMedia === 'sprite', null, { timeout: 6000 });
    assert.equal(await page.locator('#intro-actor').count(), 1);
    assert.equal(await page.locator('#intro-video').isVisible(), false);
    assert.equal(await page.evaluate(() => FighterDebug.snapshot().frame), 0);
    await page.click('#intro-skip'); await page.waitForFunction(() => FighterDebug.snapshot().phase === 'fight');
    console.log('PASS missing video falls back to the existing sprite intro');
    await page.close();

    page = await pageFor({ 0: { src: 'https://untrusted.invalid/intro.mp4', duration: 8 } });
    assert.equal(await page.evaluate(() => FighterDebug.presentation().introMedia), 'sprite');
    assert.equal(await page.locator('#intro-video').evaluate(v => v.hasAttribute('src')), false);
    await page.close();
    console.log('PASS external and unsafe video URLs are not loaded');

    const clips = { 0: { src: 'assets/video/intro-griddle.mp4', duration: 8 }, 1: { src: 'assets/video/intro-rivet.mp4', duration: 8 } };
    const one = await pageFor(clips, { lobby: true }), two = await pageFor(clips, { lobby: true });
    await one.click('#title-online'); await one.click('#network-create');
    await one.waitForFunction(() => !!document.querySelector('#network-invite').value, null, { timeout: 10000 });
    const invite = await one.locator('#network-invite').inputValue();
    await two.goto(invite); await two.waitForFunction(() => !!FighterDebug.presentation().network);
    await one.locator('#network-roster [data-fighter]').nth(0).click(); await two.locator('#network-roster [data-fighter]').nth(1).click();
    await one.click('#network-ready'); await two.click('#network-ready');
    await Promise.all([one, two].map(p => p.waitForFunction(() => FighterDebug.presentation().introMedia === 'video')));
    assert.equal(await one.evaluate(() => FighterDebug.snapshot().frame), 0); assert.equal(await two.evaluate(() => FighterDebug.snapshot().frame), 0);
    await one.evaluate(() => dispatchEvent(new Event('blur')));
    await two.waitForFunction(() => FighterDebug.presentation().network.paused);
    await two.waitForFunction(() => document.querySelector('#intro-video').paused);
    const otherTime = await two.locator('#intro-video').evaluate(v => v.currentTime);
    await two.waitForTimeout(250);
    assert.ok(Math.abs((await two.locator('#intro-video').evaluate(v => v.currentTime)) - otherTime) < .05);
    await one.reload();
    await one.waitForFunction(() => FighterDebug.presentation().network?.connected && FighterDebug.presentation().network.phase === 'intro', null, { timeout: 12000 });
    await two.waitForFunction(() => !FighterDebug.presentation().network.paused, null, { timeout: 12000 });
    await one.waitForFunction(() => FighterDebug.presentation().introMedia === 'video', null, { timeout: 6000 });
    assert.equal(await one.evaluate(() => FighterDebug.snapshot().frame), 0); assert.equal(await two.evaluate(() => FighterDebug.snapshot().frame), 0);
    await one.click('#intro-skip');
    await Promise.all([one, two].map(p => p.waitForFunction(() => FighterDebug.snapshot()?.phase === 'fight' && !FighterDebug.presentation().network.paused, null, { timeout: 12000 })));
    assert.equal(await two.locator('#intro-video').evaluate(v => v.paused && !v.hasAttribute('src')), true);
    await one.close(); await two.close();
    console.log('PASS online disconnect pauses video and combat, reload resumes, and either player skips both screens');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
