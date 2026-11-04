// Browser integration checks. No generation, media adoption or output/game reset.
// node build/test/multiplayer-browser.cjs [--url https://host/path/] [--screenshots output/diagnostics/multiplayer]
// CFZ_BROWSER_GAME_ROOT may point to a reviewed game export for full-art screenshots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createGameServer } = require('../server/server.cjs');
const { browserExecutable } = require('../tools/build-bundle.cjs');
const project = path.resolve(__dirname, '../..');
const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const screenshotRoot = path.resolve(project, option('--screenshots') || 'output/diagnostics/multiplayer');
const runtimeRoot = path.join(project, 'build/public');
const root = path.resolve(process.env.CFZ_BROWSER_GAME_ROOT || runtimeRoot);
const sourceFiles = new Set(['index.html', 'game.js', 'anim.js', 'engine.js', 'style.css', 'network.css', 'multiplayer.js', 'session-client.js', 'controller.html', 'controller.js']);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
let server, browser, base;
const errors = [], checks = [];
const check = message => { checks.push(message); console.log('PASS ' + message); };
async function device(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', ...options });
  // A single headless browser represents separate physical devices here. Ignore its
  // trusted tab-focus blur; explicitly dispatched blur remains testable below.
  await context.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.hasFocus = () => true;
    window.addEventListener('blur', event => { if (event.isTrusted) event.stopImmediatePropagation(); }, true);
    window.__testPointerIds = {};
    document.addEventListener('pointerdown', event => { if (event.target.closest('[data-key]')) window.__testPointerIds[event.target.closest('[data-key]').dataset.key] = event.pointerId; }, true);
  });
  if (!option('--url') && root !== runtimeRoot) await context.route('**/*', route => {
    const url = new URL(route.request().url());
    const name = url.pathname === '/' || url.pathname === '/phone-photo-demo/' ? 'index.html' : path.posix.basename(url.pathname);
    if (sourceFiles.has(name)) return route.fulfill({ contentType: mime[path.extname(name)], body: fs.readFileSync(path.join(runtimeRoot, name)) });
    return route.continue();
  });
  const page = await context.newPage(); page.on('websocket', ws => { ws.on('socketerror', error => console.log('socket error:', error)); ws.on('close', () => console.log('socket closed')); ws.on('framereceived', event => { try { const m=JSON.parse(event.payload); if(m.type==='error') console.log('server error:',m.code,m.message); } catch (_) {} }); }); page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function title(page, url = base) {
  await page.goto(url); await page.waitForFunction(() => window.FighterDebug && !document.querySelector('#title-start').disabled);
  if (await page.locator('#opening-screen').isVisible()) await page.click('#opening-skip');
}
async function snapshot(page) { return page.evaluate(() => window.FighterDebug.snapshot()); }
async function fighting(page) { await page.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight' && !window.FighterDebug.presentation().network?.paused, null, { timeout: 12000 }); }
async function screenshot(page, name) { await page.screenshot({ path: path.join(screenshotRoot, name + '.png'), fullPage: true }); }
async function disconnect(page) {
  if (!await page.locator('#network-dialog').evaluate(dialog => dialog.open) && await page.locator('#network-badge').isVisible()) await page.click('#network-badge');
  if (await page.locator('#network-leave').isVisible()) await page.click('#network-leave');
}
async function pairPhone(url, index = 0) {
  const phone = await device({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  await phone.goto(url); await phone.click('#controller-pair');
  await phone.waitForFunction(() => window.FighterControllerDebug.snapshot().connected);
  assert.equal(new URL(phone.url()).hash, '', 'Pairing secret must leave the address bar after connecting');
  await phone.locator('#controller-roster [data-fighter]').nth(index).click();
  await phone.waitForFunction(() => !!window.FighterControllerDebug.snapshot().fighter);
  return phone;
}
async function projection(mode) {
  const tv = await device(); await title(tv); await tv.click('#title-phones'); await tv.selectOption('#network-play-mode', mode); await tv.click('#network-project');
  await tv.waitForFunction(count => document.querySelectorAll('#network-pairing a').length === count, mode === 'solo' ? 1 : 2);
  const urls = await tv.locator('#network-pairing a').evaluateAll(links => links.map(link => link.href));
  assert.ok(urls.every(url => new URL(url).pathname.startsWith(new URL(base).pathname) && url.includes('controller.html?session=')));
  await screenshot(tv, mode + '-qr');
  const phones = [];
  for (const [index, url] of urls.entries()) phones.push(await pairPhone(url, index));
  await screenshot(phones[0], mode + '-phone-select');
  for (const phone of phones) await phone.click('#controller-ready');
  await tv.waitForFunction(() => window.FighterDebug.presentation().screen === 'intro');
  assert.equal((await snapshot(tv)).frame, 0); assert.equal((await snapshot(tv)).cpu, mode === 'solo');
  await tv.click('#intro-skip'); await fighting(tv);
  for (const phone of phones) await phone.waitForFunction(() => window.FighterControllerDebug.snapshot().phase === 'playing' && !window.FighterControllerDebug.snapshot().paused);
  return { tv, phones };
}
(async () => {
  fs.mkdirSync(screenshotRoot, { recursive: true });
  if (option('--url')) base = new URL(option('--url')).href.replace(/\/?$/, '/');
  else { server = createGameServer({ root, mounts: { '/': root, '/phone-photo-demo/': root } }); const address = await server.listen(0, '127.0.0.1'); base = 'http://127.0.0.1:' + address.port + '/phone-photo-demo/'; }
  browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, args: option('--url') ? [] : ['--disable-features=LocalNetworkAccessChecks'] });
  try {
    const offline = await device(); await title(offline); await screenshot(offline, 'title');
    await offline.click('#title-start'); await offline.click('#start-button');
    assert.equal((await snapshot(offline)).cpu, true); assert.equal((await snapshot(offline)).frame, 0);
    await offline.click('#intro-skip'); await fighting(offline); await offline.keyboard.press('KeyD');
    await offline.waitForFunction(() => window.FighterDebug.snapshot().fighters[0].move === 'heavy');
    await offline.keyboard.press('Escape'); assert.equal(await offline.locator('#pause-overlay').isVisible(), true);
    check('Default single-player CPU, introductions, ASDF and pause remain intact'); await offline.context().close();

    const one = await device(), two = await device(); await title(one); await one.click('#title-online'); await one.click('#network-create');
    await one.waitForFunction(() => !!document.querySelector('#network-invite').value, null, {timeout: 8000}).catch(async e => { console.error('Room status:', await one.locator('#network-status').textContent(), 'config:', await one.evaluate(() => window.CFZ_CONFIG), 'errors:', errors); throw e; });
    const invite = await one.locator('#network-invite').inputValue(); assert.ok(new URL(invite).pathname.startsWith(new URL(base).pathname));
    await title(two, invite); await two.waitForFunction(() => !!window.FighterDebug.presentation().network);
    await one.locator('#network-roster [data-fighter]').nth(0).click(); await two.locator('#network-roster [data-fighter]').nth(1).click();
    await screenshot(one, 'online-lobby'); await one.click('#network-ready'); await two.click('#network-ready');
    await one.waitForFunction(() => window.FighterDebug.presentation().screen === 'intro'); await two.waitForFunction(() => window.FighterDebug.presentation().screen === 'intro');
    await one.keyboard.press('KeyF'); await one.waitForTimeout(450);
    assert.equal((await snapshot(one)).frame, 0); assert.equal((await snapshot(two)).frame, 0);
    check('Both online fighters enter with synchronized frozen combat');
    await two.click('#intro-skip'); await Promise.all([fighting(one), fighting(two)]);
    assert.equal((await snapshot(one)).cpu, false); assert.equal(await one.evaluate(() => window.FighterDebug.presentation().humanPlayers), 2);
    const x0 = (await snapshot(two)).fighters[0].x;
    await one.keyboard.down('ArrowRight'); await two.waitForFunction(x => window.FighterDebug.snapshot().fighters[0].x > x + 20, x0); await one.keyboard.up('ArrowRight');
    const x1 = (await snapshot(one)).fighters[1].x;
    await two.keyboard.down('ArrowLeft'); await one.waitForFunction(x => window.FighterDebug.snapshot().fighters[1].x < x - 20, x1); await two.keyboard.up('ArrowLeft');
    for (const [key, move] of [['KeyA', 'punch'], ['KeyS', 'kick'], ['KeyD', 'heavy'], ['KeyF', 'special']]) {
      await one.waitForFunction(() => !window.FighterDebug.snapshot().fighters[1].move); await two.keyboard.press(key);
      await one.waitForFunction(move => window.FighterDebug.snapshot().fighters[1].move === move, move);
    }
    check('Both humans use arrows and ASDF; authoritative opponent snapshots show movement and every attack');
    await one.evaluate(() => dispatchEvent(new Event('blur')));
    await two.waitForFunction(() => window.FighterDebug.presentation().network.paused);
    const held = (await snapshot(two)).frame; await two.waitForTimeout(250); assert.equal((await snapshot(two)).frame, held);
    await one.evaluate(() => dispatchEvent(new Event('focus'))); await fighting(two);
    check('Loss of player presence pauses the shared server frame and resumes cleanly');
    const matchId = await two.evaluate(() => window.FighterDebug.presentation().network.matchId);
    await two.reload(); await two.waitForFunction(match => window.FighterDebug.presentation().network?.matchId === match && window.FighterDebug.presentation().network.connected, matchId);
    await fighting(two); assert.equal(await two.evaluate(() => window.FighterDebug.presentation().network.side), 1);
    check('Same-tab online reload resumes the correct seat and match without another invite');
    await screenshot(one, 'online-fight');
    if (server) {
      const code = new URL(invite).searchParams.get('room'), room = server.rooms.get(code);
      // Finish the real engine round quickly; the browser still uses the real server result/rematch path.
      room.state.fighters[0].wins = 1; room.state.fighters[0].hp = 100; room.state.fighters[1].hp = 1; room.state.time = 1;
      await one.waitForFunction(() => window.FighterDebug.snapshot().phase === 'matchover', null, { timeout: 10000 });
      await one.click('#rematch-button'); await two.click('#rematch-button'); await one.click('#network-ready'); await two.click('#network-ready');
      await one.waitForFunction(id => window.FighterDebug.presentation().network.matchId !== id && window.FighterDebug.presentation().screen === 'intro', matchId);
      assert.equal((await snapshot(one)).frame, 0); await one.click('#intro-skip'); await fighting(one);
      check('Result screen rematch requires both players and starts a fresh introduction');
    }
    await disconnect(two); await one.waitForFunction(() => document.querySelector('#network-dialog').open && window.FighterDebug.presentation().network.phase === 'lobby');
    check('Peer departure returns the remaining player to an actionable lobby');
    await disconnect(one); await one.context().close(); await two.context().close();

    const solo = await projection('solo'), phone = solo.phones[0];
    const cdp = await phone.context().newCDPSession(phone);
    const stick = await phone.locator('#controller-stick').boundingBox(), attack = await phone.locator('[data-key="punch"]').boundingBox();
    const initialX = (await snapshot(solo.tv)).fighters[0].x;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width * .85, y: stick.y + stick.height / 2, id: 1 }, { x: attack.x + attack.width / 2, y: attack.y + attack.height / 2, id: 2 }] });
    await phone.waitForFunction(() => window.FighterControllerDebug.snapshot().held.right && window.FighterControllerDebug.snapshot().held.punch);
    await solo.tv.waitForFunction(x => window.FighterDebug.snapshot().fighters[0].x > x + 10, initialX);
    await phone.evaluate(() => { const button = document.querySelector('[data-key="punch"]'); button.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: window.__testPointerIds.punch })); });
    await phone.waitForFunction(() => !window.FighterControllerDebug.snapshot().held.punch && window.FighterControllerDebug.snapshot().held.right);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await phone.waitForFunction(() => Object.keys(window.FighterControllerDebug.snapshot().held).length === 0);
    check('One phone controls a CPU match with simultaneous stick/attack; lost capture and touch cancel release inputs');
    const session = new URL(phone.url()).searchParams.get('session'); await phone.reload();
    await phone.waitForFunction(() => window.FighterControllerDebug.snapshot().connected && window.FighterControllerDebug.snapshot().phase === 'playing');
    assert.equal(new URL(phone.url()).searchParams.get('session'), session); await fighting(solo.tv);
    check('Controller reload resumes its private seat after the pairing fragment is removed');
    await screenshot(phone, 'phone-controller-landscape'); await phone.setViewportSize({ width: 390, height: 844 }); await screenshot(phone, 'phone-controller-portrait');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.click('#controller-leave'); await solo.tv.waitForFunction(() => document.querySelector('#network-dialog').open && document.querySelectorAll('#network-pairing a').length === 1);
    check('Leaving a phone returns the TV to a fresh single-use pairing code');
    await disconnect(solo.tv); await solo.tv.context().close(); await phone.context().close();

    const versus = await projection('versus');
    assert.equal((await snapshot(versus.tv)).cpu, false);
    await versus.phones[1].keyboard.down('ArrowLeft'); const otherX = (await snapshot(versus.tv)).fighters[1].x;
    await versus.tv.waitForFunction(x => window.FighterDebug.snapshot().fighters[1].x < x - 15, otherX); await versus.phones[1].keyboard.up('ArrowLeft');
    await versus.phones[1].evaluate(() => dispatchEvent(new Event('blur'))); await versus.tv.waitForFunction(() => window.FighterDebug.presentation().network.paused);
    await versus.phones[1].evaluate(() => dispatchEvent(new Event('focus'))); await fighting(versus.tv);
    const projectionId = await versus.tv.evaluate(() => window.FighterDebug.presentation().network.matchId); await versus.tv.reload();
    await versus.tv.waitForFunction(id => window.FighterDebug.presentation().network?.matchId === id, projectionId); await fighting(versus.tv);
    check('Two independent phone seats play versus; phone blur pauses everyone and TV reload resumes ownership');
    await screenshot(versus.tv, 'two-phone-fight'); await disconnect(versus.tv);
    for (const device of [versus.tv, ...versus.phones]) await device.context().close();
    assert.deepEqual(errors, []); check('No browser exceptions across offline, online and shared-screen modes');
    fs.writeFileSync(path.join(screenshotRoot, 'report.json'), JSON.stringify({ base, checks, errors }, null, 2));
  } finally { await browser?.close(); await server?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
