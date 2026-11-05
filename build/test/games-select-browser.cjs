// Run after npm run build. Mounts the preview twice (the second copy retitled) and checks the GAME SELECT screen.
// No paid generation: the asset-free preview is enough for the listing, the screen and the navigation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createGameServer } = require('../server/server.cjs');
const { browserLaunchOptions } = require('../tools/build-bundle.cjs');
const root = path.resolve(__dirname, '../..');
const preview = path.join(root, 'output/game');
if (!fs.existsSync(path.join(preview, 'assets/manifest.json'))) throw new Error('Run npm run build first.');

(async () => {
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-games-'));
  const errors = [];
  let browser, server;
  try {
    fs.cpSync(preview, second, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(second, 'assets/manifest.json'), 'utf8'));
    fs.writeFileSync(path.join(second, 'assets/manifest.json'), JSON.stringify({ ...manifest, title: 'Comfy Fighter Z', subtitle: 'Blue Wave Saga' }));
    server = createGameServer({ root: preview, mounts: { '/': preview, '/blue-wave-2026/': second } });
    const address = await server.listen(0, '127.0.0.1'), base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch(browserLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/');
    await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
    if (await page.locator('#opening-screen').isVisible()) await page.keyboard.press('Space');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title' && window.FighterDebug.presentation().games.length === 2);
    assert.equal(await page.locator('#title-games').isVisible(), true, 'GAME SELECT appears when another game is mounted');
    await page.click('#title-games');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'games');
    const cards = page.locator('#games-grid .game-card');
    assert.equal(await cards.count(), 2);
    assert.equal(await cards.nth(0).evaluate(card => card.classList.contains('current')), true, 'the current game is marked');
    assert.match(await cards.nth(1).innerText(), /BLUE WAVE SAGA/i);
    assert.match(await cards.nth(1).innerText(), /FIGHTERS/);
    console.log('PASS the title offers GAME SELECT and lists both mounted games');
    // Escape returns to the title; the keyboard moves between cards; Enter plays the focused game.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title');
    await page.click('#title-games');
    await page.waitForFunction(() => document.activeElement?.classList.contains('game-card'));
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('current')), false);
    await Promise.all([page.waitForURL(url => new URL(url).pathname === '/blue-wave-2026/'), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
    if (await page.locator('#opening-screen').isVisible()) await page.keyboard.press('Space');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title' && window.FighterDebug.presentation().games.length === 2);
    assert.equal(await page.locator('#saga-subtitle').innerText(), 'BLUE WAVE SAGA');
    const listing = await page.evaluate(async () => (await fetch('games.json')).json());
    assert.deepEqual(listing.games.map(game => [game.basePath, game.current]), [['/', false], ['/blue-wave-2026/', true]]);
    await page.click('#title-games');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'games');
    await Promise.all([page.waitForURL(url => new URL(url).pathname === '/'), page.locator('#games-grid .game-card').nth(0).click()]);
    await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
    console.log('PASS keyboard and click navigation switch between mounted games');
    // A lone game hides the button entirely.
    const alone = createGameServer({ root: preview });
    const single = await alone.listen(0, '127.0.0.1');
    try {
      await page.goto(`http://127.0.0.1:${single.port}/`);
      await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
      if (await page.locator('#opening-screen').isVisible()) await page.keyboard.press('Space');
      await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title' && window.FighterDebug.presentation().games.length === 1);
      assert.equal(await page.locator('#title-games').isVisible(), false);
    } finally { await alone.close(); }
    assert.deepEqual(errors, []);
    console.log('PASS a single game hides GAME SELECT and no page errors occurred');
    console.log('Game select browser test passed.');
  } finally {
    await browser?.close(); await server?.close();
    fs.rmSync(second, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
