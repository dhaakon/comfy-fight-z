// Run after npm run build. Uses only synthetic PNG fixtures; never generates paid art.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { createCanvas } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/game.json'), 'utf8'));
async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve)); return port;
}
function syntheticManifest() {
  const poses = Object.fromEntries(['idle','walk','punch','kick','block','hit','special','down','win','stance2','crouch','sweep','launcher','jump','airkick','hpunch','dash','tumble','walk2','lkick','cjab','airpunch','throw','taunt','getup','powerup','entrance'].map(pose => [pose, { src: 'fixture.png', w: 120, h: 180, ax: 60, ay: 179, top: 0, bh: 180 }]));
  return {
    title: 'Synthetic Art Test',
    fighters: ['Alpha', 'Beta'].map((name, i) => ({ id: name.toLowerCase(), name, introTagline: `${name} is ready for the showdown.`, color: i ? '#82d6c5' : '#f49653', poses, portrait: 'fixture.png', hero: 'fixture.png', cutin: 'fixture.png' })),
    stages: [{ id: 'test', name: 'Fixture Arena', src: 'fixture.png' }],
    ui: Object.fromEntries(['title','select','logo','hud','icons'].map(id => [id, 'fixture.png'])),
    effects: Object.fromEntries(['hit','block','projectile','dust','ko','powerup'].map(id => [id, { src: 'fixture.png', w: 120, h: 180, ax: 60, ay: 179 }]))
  };
}
async function skipOptionalOpening(page) {
  await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
  if (await page.locator('#opening-screen').isVisible()) await page.keyboard.press('Space');
  await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title');
}
(async () => {
  const port = await unusedPort(), url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['tools/serve.cjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited (${code})`)); });
      server.stdout.on('data', chunk => { if (String(chunk).includes(url)) { clearTimeout(timeout); resolve(); } });
      server.stderr.on('data', chunk => process.stderr.write(chunk));
    });
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#fighter-one').options.length >= 2);
    await skipOptionalOpening(page);
    assert.equal(await page.title(), config.title);
    assert.equal(await page.locator('#fighter-one option').count(), config.fighters.length);
    assert.equal(await page.evaluate(() => window.FighterDebug.presentation().screen), 'title');
    assert.equal(await page.locator('#title-screen').isVisible(), true);
    await page.click('#fullscreen-button'); await page.waitForFunction(() => !!document.fullscreenElement);
    await page.click('#fullscreen-button'); await page.waitForFunction(() => !document.fullscreenElement);
    await page.click('#title-start');
    assert.equal(await page.evaluate(() => window.FighterDebug.presentation().screen), 'selection');
    await page.click('#title-return');
    assert.equal(await page.locator('#title-screen').isVisible(), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'selection');
    assert.equal(await page.evaluate(() => window.FighterDebug.presentation().humanPlayers), 1);
    assert.equal(await page.locator('#mode option[value="local"]').count(), 0);
    await page.click('#start-button');
    await page.waitForFunction(() => window.FighterDebug.presentation().introSlot === 0);
    assert.ok((await page.locator('#intro-tagline').textContent()).includes(config.fighters[0].introTagline));
    assert.equal(await page.locator('#intro-name').textContent(), config.fighters[0].name);
    const introStart = await page.evaluate(() => window.FighterDebug.snapshot());
    assert.equal(introStart.frame, 0);
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(200); await page.keyboard.up('ArrowRight');
    await page.waitForFunction(() => window.FighterDebug.presentation().introSlot === 1, null, { timeout: 10000 });
    assert.ok((await page.locator('#intro-tagline').textContent()).includes(config.fighters[1].introTagline));
    assert.equal(await page.locator('#intro-name').textContent(), config.fighters[1].name);
    const introEnd = await page.evaluate(() => window.FighterDebug.snapshot());
    assert.equal(introEnd.frame, introStart.frame, 'Introductions must freeze combat frames');
    assert.equal(introEnd.time, introStart.time, 'Introductions must freeze the round timer');
    assert.deepEqual(introEnd.fighters, introStart.fighters, 'Intro input must not move or attack');
    await page.click('#intro-skip');
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await page.evaluate(() => window.FighterDebug.snapshot().cpu), true);
    const initialX = await page.evaluate(() => window.FighterDebug.snapshot().fighters[0].x);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(x => window.FighterDebug.snapshot().fighters[0].x > x + 20, initialX);
    await page.keyboard.up('ArrowRight'); await page.keyboard.press('KeyA');
    await page.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].move === 'punch');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#pause-overlay').isVisible(), true);
    const pausedFrame = await page.evaluate(() => window.FighterDebug.snapshot().frame);
    await page.waitForTimeout(150); assert.equal(await page.evaluate(() => window.FighterDebug.snapshot().frame), pausedFrame);
    await page.click('#resume-button'); await page.waitForFunction(frame => window.FighterDebug.snapshot().frame > frame, pausedFrame);
    await page.click('#back-select'); await page.click('#start-button');
    await page.click('#intro-skip');
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await page.evaluate(() => window.FighterDebug.snapshot().cpu), true);
    await page.keyboard.press('KeyD'); await page.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].move === 'heavy');
    await page.waitForFunction(() => window.FighterDebug.snapshot().fighters[1].x < 650);
    await page.click('[data-tab="lab"]'); assert.equal(await page.locator('#lab-view').isVisible(), true);
    assert.equal(await page.locator('#arena-view').isVisible(), false);
    await page.click('[data-tab="arena"]'); await page.click('#resume-button'); await page.click('#back-select');
    fs.mkdirSync(path.join(root, 'build'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'build/browser-smoke.png'), fullPage: true });
    assert.deepEqual(errors, []);
    // Serve fake art in-memory to verify every asset category is actually loaded by the UI.
    const fixture = createCanvas(120, 180), c = fixture.getContext('2d'); c.fillStyle = '#f49653'; c.fillRect(10, 10, 100, 160); c.fillStyle = '#82d6c5'; c.fillRect(30, 35, 60, 30);
    const png = fixture.toBuffer('image/png'), synthetic = syntheticManifest();
    const artPage = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); artPage.on('pageerror', error => errors.push(error.message));
    await artPage.route('**/assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(synthetic) }));
    await artPage.route('**/fixture.png', route => route.fulfill({ contentType: 'image/png', body: png }));
    await artPage.goto(url); await artPage.waitForFunction(() => Number(document.querySelector('#asset-count').textContent) > 0);
    await skipOptionalOpening(artPage);
    assert.equal(await artPage.locator('#placeholder-label').isVisible(), false);
    assert.equal(await artPage.locator('.fighter-card img').count(), 2);
    await artPage.click('#title-start');
    await artPage.click('[data-tab="lab"]');
    for (const group of ['fighters','portraits','stages','ui','effects']) {
      await artPage.selectOption('#lab-filter', group);
      assert.ok(await artPage.locator('.asset-card img').count() > 0, `${group} must load artwork`);
    }
    await artPage.click('[data-tab="arena"]'); await artPage.click('#start-button');
    assert.ok((await artPage.locator('#intro-tagline').textContent()).includes(synthetic.fighters[0].introTagline));
    await artPage.waitForFunction(() => window.FighterDebug.presentation().introSlot === 1, null, { timeout: 10000 });
    assert.ok((await artPage.locator('#intro-tagline').textContent()).includes(synthetic.fighters[1].introTagline));
    assert.equal(await artPage.evaluate(() => window.FighterDebug.snapshot().frame), 0);
    // Let this match finish both introductions naturally; the first match exercised skip.
    await artPage.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    await artPage.keyboard.press('KeyF'); await artPage.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].energy < 40);
    await artPage.waitForTimeout(450);
    await artPage.waitForFunction(() => { const f = window.FighterDebug.snapshot().fighters[0]; return !f.move && !f.stun; });
    await artPage.keyboard.press('KeyS'); await artPage.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].move === 'kick');
    assert.deepEqual(errors, []);
    // Controlled voice playback makes mute/pause/skip testable without cloud audio.
    const interaction = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); interaction.on('pageerror', error => errors.push(error.message));
    const voiced = { ...synthetic, audio: Object.fromEntries(synthetic.fighters.map(f => [`fighter_${f.id}_intro`, { src: `${f.id}_intro.mp3`, duration: 6 }])) };
    await interaction.route('**/assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(voiced) }));
    await interaction.route('**/fixture.png', route => route.fulfill({ contentType: 'image/png', body: png }));
    await interaction.addInitScript(() => {
      window.testAudio = [];
      window.Audio = class extends EventTarget {
        constructor(src) { super(); this.src = src; this.paused = true; this.currentTime = 0; this.duration = 6; window.testAudio.push(this); }
        play() { this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; }
      };
    });
    const playingIntro = () => interaction.evaluate(() => window.testAudio.filter(a => a.src.includes('_intro') && !a.paused).length);
    await interaction.goto(url); await interaction.waitForFunction(() => !document.querySelector('#title-start').disabled);
    await interaction.click('[data-tab="lab"]'); await interaction.locator('body').click({ position: { x: 5, y: 5 } }); await interaction.keyboard.press('Space');
    assert.equal(await interaction.locator('#title-screen').isVisible(), false, 'Lab Space must not reveal a hidden title');
    await interaction.click('[data-tab="arena"]'); await interaction.click('#title-start');
    await interaction.locator('.fighter-tile').nth(1).focus(); await interaction.keyboard.press('Space');
    assert.equal(await interaction.evaluate(() => document.activeElement.dataset.fighter), 'beta', 'Roster selection must retain keyboard focus');
    await interaction.click('#start-button'); assert.equal(await playingIntro(), 1);
    await interaction.locator('#audio-button').focus(); await interaction.keyboard.press('Enter');
    assert.equal(await playingIntro(), 0);
    assert.equal(await interaction.evaluate(() => window.FighterDebug.presentation().introSlot), 0, 'Sound-button Enter must not skip the intro');
    await interaction.keyboard.press('Enter'); assert.equal(await playingIntro(), 1);
    await interaction.keyboard.press('Enter'); assert.equal(await playingIntro(), 0, 'Muting again must stop a resumed voice');
    await interaction.keyboard.press('Enter'); assert.equal(await playingIntro(), 1);
    await interaction.locator('[data-tab="lab"]').focus(); await interaction.keyboard.press('Enter');
    assert.equal(await interaction.locator('#lab-view').isVisible(), true); assert.equal(await playingIntro(), 0);
    await interaction.keyboard.press('Escape'); assert.equal(await playingIntro(), 0, 'Lab Escape must not resume a hidden fight');
    await interaction.click('[data-tab="arena"]'); assert.equal(await interaction.locator('#pause-overlay').isVisible(), true);
    await interaction.locator('#resume-button').focus(); await interaction.keyboard.press('Enter');
    assert.equal(await interaction.locator('#pause-overlay').isVisible(), false);
    assert.equal(await interaction.evaluate(() => window.FighterDebug.presentation().introSlot), 0, 'Resume-button Enter must preserve the intro');
    assert.equal(await interaction.evaluate(() => document.activeElement.id), 'intro-skip'); assert.equal(await playingIntro(), 1);
    await interaction.keyboard.press('Enter'); assert.equal(await playingIntro(), 0);
    await interaction.waitForFunction(() => window.FighterDebug.snapshot().phase === 'fight');
    await interaction.keyboard.press('Escape'); assert.equal(await interaction.evaluate(() => document.activeElement.id), 'resume-button');
    await interaction.keyboard.press('Enter'); assert.equal(await interaction.evaluate(() => document.activeElement.id), 'arena');
    await interaction.click('#back-select'); assert.equal(await interaction.evaluate(() => document.activeElement.dataset.fighter), 'beta');
    // A tiny, locally encoded test clip exercises real browser media events only.
    const videoPage = await browser.newPage({ viewport: { width: 1280, height: 720 } }); videoPage.on('pageerror', error => errors.push(error.message));
    const videoManifest = { ...synthetic, openingVideo: { id: 'opening', src: 'opening-fixture.mp4', duration: 2 } };
    await videoPage.route('**/assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(videoManifest) }));
    await videoPage.route('**/fixture.png', route => route.fulfill({ contentType: 'image/png', body: png }));
    await videoPage.route('**/opening-fixture.mp4', route => route.fulfill({ contentType: 'video/mp4', body: fs.readFileSync(path.join(__dirname, 'fixtures/opening.mp4')) }));
    await videoPage.goto(url); await videoPage.waitForFunction(() => window.FighterDebug.presentation().screen === 'opening');
    await videoPage.waitForFunction(() => document.querySelector('#opening-video').currentTime > .05);
    assert.equal(await videoPage.evaluate(() => window.FighterDebug.snapshot()), null, 'Opening video must not start combat');
    await videoPage.keyboard.press('Space');
    await videoPage.waitForFunction(() => window.FighterDebug.presentation().screen === 'title');
    assert.equal(await videoPage.locator('#opening-video').evaluate(video => video.paused), true);
    await videoPage.click('#opening-replay');
    await videoPage.waitForFunction(() => document.querySelector('#opening-video').ended, null, { timeout: 8000 });
    assert.equal(await videoPage.evaluate(() => window.FighterDebug.presentation().screen), 'title', 'Natural video completion returns to title');
    await videoPage.click('#opening-replay');
    await videoPage.locator('#opening-video').evaluate(video => video.dispatchEvent(new Event('error')));
    await videoPage.waitForFunction(() => window.FighterDebug.presentation().screen === 'title');
    assert.equal(await videoPage.locator('#opening-video').evaluate(video => video.paused), true, 'Media failure must close and stop the opening');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(url); await mobile.waitForFunction(() => document.querySelector('#fighter-one').options.length >= 2);
    await skipOptionalOpening(mobile);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must fit the viewport');
    await mobile.click('#title-start');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile selection must fit the viewport');
    await mobile.locator('.fighter-tile[data-fighter="photographer"]').click();
    assert.equal(await mobile.locator('#fighter-one').inputValue(), String(config.fighters.findIndex(fighter => fighter.id === 'photographer')), 'Mobile hero cards must not intercept roster taps');
    await mobile.click('#start-button'); await mobile.click('#intro-skip');
    await mobile.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await mobile.locator('.touch-controls').isVisible(), true);
    await mobile.click('[data-tab="lab"]'); assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: opening video skip/end/error, title navigation, taglines, frozen intros, voice lifecycle, keyboard focus, one human vs CPU, arrow movement and ASDF attacks, pause/resume, all asset categories, mobile layout, no page errors.');
    console.log('Screenshot: build/browser-smoke.png');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
