// Frame strips of walk forward, walk back, roll and sweep for player one in training (Canvas path on #arena-hud),
// each frame labelled with the cel the animation layer draws. Needs a running game (npm start).
//   [FIGHTER=<id>] node build/tools/capture-moves.cjs [base url] [out dir] [prefix]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const base = process.argv[2] || 'http://127.0.0.1:8096/', OUT = path.resolve(process.argv[3] || path.join(__dirname, '../../output/diagnostics/moves')), prefix = process.argv[4] || process.env.FIGHTER || 'fighter';
async function strip(frames, file, cols, crop, k = .55, labels = []) {
  const images = await Promise.all(frames.map(d => loadImage(Buffer.from(d.split(',')[1], 'base64'))));
  const w = Math.round(crop[2] * k), h = Math.round(crop[3] * k), rows = Math.ceil(images.length / cols), c = createCanvas(cols * w, rows * (h + 14)), ctx = c.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
  images.forEach((im, i) => { const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 14); ctx.drawImage(im, crop[0], crop[1], crop[2], crop[3], x, y + 14, w, h); ctx.fillStyle = '#ffe9a8'; ctx.font = '11px sans-serif'; ctx.fillText(labels[i] || String(i), x + 3, y + 11); });
  fs.writeFileSync(file, c.toBuffer('image/png')); console.log(path.basename(file), images.length, 'frames');
}
// script: frame index -> { down: [codes], up: [codes] }. Captures every `every` simulated frames.
const recorder = async ({ n, script, every }) => {
  const canvas = document.querySelector('#arena-hud'), out = [], labels = [];
  const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  let last = FighterDebug.snapshot().frame;
  for (let i = 0; i < n; i++) {
    for (const code of script[i]?.down || []) ev('keydown', code);
    for (const code of script[i]?.up || []) ev('keyup', code);
    for (let guard = 0; guard < 8; guard++) { await new Promise(r => requestAnimationFrame(r)); const now = FighterDebug.snapshot().frame; if (now !== last) { last = now; break; } }
    if (i % every === 0) { const f = FighterDebug.snapshot().fighters[0]; out.push(canvas.toDataURL('image/png')); labels.push(`${i} ${window.__poses ? FighterAnim.sample(f, FighterDebug.snapshot(), { poses: window.__poses }).pose : (f.move || '') + ' ' + (f.pose || '')}`.trim()); }
  }
  return { out, labels };
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(base + '?renderer=canvas&debug=1');
  await page.waitForFunction(() => !document.querySelector('#title-start').disabled);
  if (await page.locator('#opening-screen').isVisible()) await page.keyboard.press('Space');
  await page.waitForFunction(() => FighterDebug.presentation().screen === 'title');
  await page.click('#title-training');
  if (process.env.FIGHTER) { await page.locator(`.fighter-tile[data-fighter="${process.env.FIGHTER}"]`).click(); }
  await page.click('#start-button');
  await page.waitForFunction(() => FighterDebug.snapshot()?.phase === 'fight', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(async () => { const m = await (await fetch('assets/manifest.json')).json(); window.__poses = m.fighters.find(x => x.id === FighterDebug.snapshot().fighters[0].id).poses; });
  const rec = args => page.evaluate(`(${recorder.toString()})(${JSON.stringify(args)})`);
  const crop = [80, 120, 1000, 600];
  const runs = {
    walkf: { n: 48, every: 1, script: { 0: { down: ['ArrowRight'] }, 47: { up: ['ArrowRight'] } } },
    walkb: { n: 48, every: 2, script: { 0: { down: ['ArrowLeft'] }, 47: { up: ['ArrowLeft'] } } },
    roll: { n: 34, every: 1, script: { 1: { down: ['KeyA', 'KeyS'] }, 3: { up: ['KeyA', 'KeyS'] } } },
    sweep: { n: 40, every: 1, script: { 0: { down: ['ArrowDown'] }, 2: { down: ['KeyS'] }, 4: { up: ['KeyS'] }, 39: { up: ['ArrowDown'] } } },
  };
  for (const [name, args] of Object.entries(runs)) {
    await page.keyboard.press('KeyR'); await page.waitForTimeout(500);
    const { out, labels } = await rec(args);
    await strip(out, `${OUT}/${prefix}-${name}.png`, name === 'roll' || name === 'sweep' ? 10 : 8, crop, .32, labels);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
