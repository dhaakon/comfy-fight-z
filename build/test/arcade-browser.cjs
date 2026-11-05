// Run after npm run build. Exercises Arcade, Training, local Versus with a simulated gamepad,
// and persisted options in a real browser. Uses only the canonical preview; no paid art.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'comfyui/config/game.json'), 'utf8'));
async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
(async () => {
  const port = await unusedPort(), url = `http://127.0.0.1:${port}/?debug=1`;
  const server = spawn(process.execPath, ['build/tools/serve.cjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited (${code})`)); });
      server.stdout.on('data', chunk => { if (String(chunk).includes(`127.0.0.1:${port}`)) { clearTimeout(timeout); resolve(); } });
    });
    browser = await chromium.launch(require('../tools/build-bundle.cjs').browserLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // A simulated standard gamepad lets local versus run without hardware.
    await page.addInitScript(() => {
      const pad = { index: 0, id: 'Simulated gamepad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.testPad = pad; Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.testPadConnected ? [pad] : [] });
    });
    const present = () => page.evaluate(() => window.FighterDebug.presentation());
    const snap = () => page.evaluate(() => window.FighterDebug.snapshot());
    const toFight = async () => {
      for (let i = 0; i < 40; i++) {
        const view = await present();
        if (view.overlay === 'vs' || view.screen === 'intro') await page.keyboard.press('Enter');
        if ((await snap())?.phase === 'fight') return;
        await page.waitForTimeout(200);
      }
      throw new Error('Match never reached the fight phase');
    };
    await page.goto(url); await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
    for (const id of ['title-start', 'title-versus', 'title-training']) assert.equal(await page.locator('#' + id).isVisible(), true, `${id} is offered on the title`);
    // Arcade hides the final boss from selection and ends its ladder with them.
    await page.click('#title-start');
    const boss = config.fighters.find(fighter => fighter.boss);
    assert.equal(await page.locator('.fighter-tile').count(), config.fighters.length - 1);
    assert.equal(await page.locator(`.fighter-tile[data-fighter="${boss.id}"]`).count(), 0);
    assert.equal(await page.locator('.mystery-card').count(), 1);
    await page.click('#start-button');
    await page.waitForFunction(() => window.FighterDebug.presentation().overlay === 'vs');
    const ladder = (await present()).arcade.ladder;
    assert.equal(ladder.length, config.fighters.length - 1); assert.equal(ladder[ladder.length - 1], boss.id);
    await toFight();
    // Enter on the VS screen advances it; it must not re-click the hidden start button and reshuffle the ladder.
    assert.deepEqual((await present()).arcade.ladder, ladder, 'Enter on the VS screen keeps the announced ladder');
    // Win a match: KO twice, then the win screen and the next ladder stage.
    for (let round = 0; round < 2 && (await snap())?.phase !== 'matchover'; round++) {
      await page.evaluate(() => window.FighterDebug.setHealth(1, 0));
      await page.waitForFunction(() => { const s = window.FighterDebug.snapshot(); return !s || s.phase !== 'fight'; });
      await page.waitForFunction(() => { const s = window.FighterDebug.snapshot(); return !s || ['fight', 'matchover'].includes(s.phase) || window.FighterDebug.presentation().overlay === 'win'; }, null, { timeout: 20000 });
    }
    await page.waitForFunction(() => window.FighterDebug.presentation().overlay === 'win', null, { timeout: 20000 });
    assert.ok((await present()).arcade.score > 0, 'Arcade scoring counts the win');
    await page.click('#win-continue');
    await page.waitForFunction(() => window.FighterDebug.presentation().arcade.index === 1);
    // Lose the next match: the continue countdown offers a rematch at the same stage.
    await toFight();
    for (let round = 0; round < 3 && (await present()).overlay !== 'continue'; round++) {
      await page.evaluate(() => window.FighterDebug.setHealth(0, 0));
      await page.waitForFunction(() => { const s = window.FighterDebug.snapshot(); return !s || s.phase === 'fight' || s.phase === 'matchover' || window.FighterDebug.presentation().overlay === 'continue'; }, null, { timeout: 20000 });
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => window.FighterDebug.presentation().overlay === 'continue', null, { timeout: 20000 });
    await page.click('#continue-yes');
    await page.waitForFunction(() => window.FighterDebug.presentation().overlay === 'vs');
    assert.equal((await present()).arcade.continues, 1); assert.equal((await present()).arcade.index, 1);
    await page.keyboard.press('Escape'); await toFight();
    await page.keyboard.press('Escape'); await page.click('#pause-quit');
    await page.waitForFunction(() => window.FighterDebug.presentation().screen === 'title');
    // Training: endless timer, refilling meter, options panel and position reset.
    await page.click('#title-training'); await page.click('#start-button');
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.options?.training === true);
    const training = await snap();
    assert.equal(training.phase, 'fight'); assert.equal(training.options.roundTime, 0);
    await page.keyboard.press('KeyA'); await page.waitForTimeout(500);
    assert.equal((await snap()).fighters[0].stocks, 3, 'Training keeps the power gauge full');
    await page.keyboard.press('Escape'); await page.click('#pause-training');
    await page.check('#train-boxes'); await page.selectOption('#train-action', 'crouch'); await page.click('#train-close');
    await page.waitForTimeout(300);
    assert.equal((await snap()).fighters[1].crouching, true, 'The dummy follows its training action');
    await page.keyboard.press('KeyR'); assert.equal((await snap()).fighters[0].x, 530, 'R resets positions');
    await page.keyboard.press('Escape'); await page.click('#pause-quit');
    // Local versus: with a gamepad connected, player two is human and the pad drives slot two.
    await page.evaluate(() => { window.testPadConnected = true; });
    await page.click('#title-versus'); await page.click('#start-button');
    await page.click('#intro-skip'); await page.waitForTimeout(200);
    if ((await present()).screen === 'intro') await page.click('#intro-skip');
    await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight', null, { timeout: 15000 });
    assert.equal((await snap()).cpu, false); assert.equal((await present()).humanPlayers, 2);
    await page.evaluate(() => { window.testPad.buttons[2].pressed = true; window.testPad.buttons[2].value = 1; });
    await page.waitForFunction(() => window.FighterDebug.snapshot().fighters[1].move === 'punch', null, { timeout: 5000 });
    await page.evaluate(() => { window.testPad.buttons[2].pressed = false; window.testPad.buttons[2].value = 0; });
    // Options persist in the browser: difficulty survives a reload.
    await page.evaluate(() => { window.testPadConnected = false; });
    await page.keyboard.press('Escape'); await page.click('#pause-quit');
    await page.click('#settings-open'); await page.selectOption('#opt-difficulty', '7'); await page.selectOption('#opt-display', 'crt'); await page.click('#settings-close');
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
    assert.equal(await page.locator('#opt-difficulty').inputValue(), '7');
    assert.equal(await page.evaluate(() => document.querySelector('.canvas-wrap').classList.contains('filter-crt')), true);
    assert.deepEqual(errors, []);
    console.log('Arcade browser test passed: title modes, boss-terminated ladder, win screen, continue, training tools, gamepad versus, persisted options, no page errors.');
  } finally {
    await browser?.close(); server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
