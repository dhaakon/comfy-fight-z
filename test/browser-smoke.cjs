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
    assert.equal(await page.title(), config.title);
    assert.equal(await page.locator('#fighter-one option').count(), config.fighters.length);
    assert.equal(await page.evaluate(() => window.FighterDebug.presentation().screen), 'title');
    assert.equal(await page.locator('#title-screen').isVisible(), true);
    await page.click('#title-start');
    assert.equal(await page.evaluate(() => window.FighterDebug.presentation().screen), 'selection');
    await page.click('#title-return');
    assert.equal(await page.locator('#title-screen').isVisible(), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'selection');
    await page.selectOption('#mode', 'local'); await page.click('#start-button');
    await page.waitForFunction(() => window.FighterDebug.presentation().introSlot === 0);
    assert.ok((await page.locator('#intro-tagline').textContent()).includes(config.fighters[0].introTagline));
    assert.equal(await page.locator('#intro-name').textContent(), config.fighters[0].name);
    const introStart = await page.evaluate(() => window.FighterDebug.snapshot());
    assert.equal(introStart.frame, 0);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(200); await page.keyboard.up('KeyD');
    await page.waitForFunction(() => window.FighterDebug.presentation().introSlot === 1, null, { timeout: 10000 });
    assert.ok((await page.locator('#intro-tagline').textContent()).includes(config.fighters[1].introTagline));
    assert.equal(await page.locator('#intro-name').textContent(), config.fighters[1].name);
    const introEnd = await page.evaluate(() => window.FighterDebug.snapshot());
    assert.equal(introEnd.frame, introStart.frame, 'Introductions must freeze combat frames');
    assert.equal(introEnd.time, introStart.time, 'Introductions must freeze the round timer');
    assert.deepEqual(introEnd.fighters, introStart.fighters, 'Intro input must not move or attack');
    await page.click('#intro-skip');
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await page.evaluate(() => window.FighterDebug.snapshot().cpu), false);
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => { const s = window.FighterDebug.snapshot(); return s.fighters[1].x - s.fighters[0].x < 90; });
    await page.keyboard.up('KeyD'); await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.FighterDebug.snapshot().fighters[1].hp < 100);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#pause-overlay').isVisible(), true);
    const pausedFrame = await page.evaluate(() => window.FighterDebug.snapshot().frame);
    await page.waitForTimeout(150); assert.equal(await page.evaluate(() => window.FighterDebug.snapshot().frame), pausedFrame);
    await page.click('#resume-button'); await page.waitForFunction(frame => window.FighterDebug.snapshot().frame > frame, pausedFrame);
    await page.click('#reset-button'); await page.selectOption('#mode', 'cpu'); await page.click('#start-button');
    await page.click('#intro-skip');
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await page.evaluate(() => window.FighterDebug.snapshot().cpu), true);
    await page.waitForFunction(() => window.FighterDebug.snapshot().fighters[1].x < 650);
    await page.click('[data-tab="lab"]'); assert.equal(await page.locator('#lab-view').isVisible(), true);
    assert.equal(await page.locator('#arena-view').isVisible(), false);
    await page.click('[data-tab="arena"]'); await page.click('#reset-button');
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
    await artPage.keyboard.press('KeyH'); await artPage.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].energy < 40);
    await artPage.waitForTimeout(450);
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
    assert.equal(await interaction.evaluate(() => window.FighterDebug.presentation().screen), 'title', 'Lab Space must not open a hidden title');
    await interaction.click('[data-tab="arena"]'); await interaction.click('#title-start');
    await interaction.locator('.fighter-tile').nth(1).focus(); await interaction.keyboard.press('Enter');
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
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(url); await mobile.waitForFunction(() => document.querySelector('#fighter-one').options.length >= 2);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must fit the viewport');
    await mobile.click('#title-start');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile selection must fit the viewport');
    await mobile.click('#start-button'); await mobile.click('#intro-skip');
    await mobile.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await mobile.locator('.touch-controls').isVisible(), true);
    await mobile.click('[data-tab="lab"]'); assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: title navigation, configured taglines, frozen intros, skip/natural completion, voice mute/pause/skip, keyboard focus, local hit, CPU, pause/resume, replay, all asset categories, mobile layout, no page errors.');
    console.log('Screenshot: build/browser-smoke.png');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
