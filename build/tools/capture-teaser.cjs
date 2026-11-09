// Record the teaser's scenes from the real interfaces: the installed games on the local server, the run's graph in the
// ComfyUI editor (reads only; every write is intercepted) and cards drawn from the pipeline's own files (a cast file,
// a run's plan, an export receipt, review sheets). Playwright records each shot at 1920x1080; FFmpeg trims the shots
// to the storyboard's seconds and joins a scene's shots with hard cuts. Never queues ComfyUI work or spends anything.
//   node build/tools/capture-teaser.cjs [--config comfyui/config/teaser.json] [--out output/explainer/<run>] [--scene 04-workflow]
//        [--game-url http://127.0.0.1:8096] [--comfy-url http://127.0.0.1:8188] [--run output/test-runs/<cast run>]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { sourceFile } = require('./lib/runtime-validation.cjs');

const ROOT = path.resolve(__dirname, '../..');
const settings = { config: 'comfyui/config/teaser.json', out: 'output/explainer/teaser-v2-20261109', scene: null, gameUrl: 'http://127.0.0.1:8096', comfyUrl: 'http://127.0.0.1:8188',
  run: 'output/test-runs/billionaires-brawl-20261108', cast: 'comfyui/casts/billionaires-brawl.json', export: 'output/exports/billionaires-brawl-card', sceneryRun: 'output/test-runs/canonical-20261109' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--config': 'config', '--out': 'out', '--scene': 'scene', '--game-url': 'gameUrl', '--comfy-url': 'comfyUrl', '--run': 'run', '--cast': 'cast', '--export': 'export', '--scenery-run': 'sceneryRun', '--card': 'card', '--png': 'png' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw new Error('Usage: node build/tools/capture-teaser.cjs [--config <json>] [--out <run>] [--scene <id>] [--game-url URL] [--comfy-url URL] [--run <cast run>] | --card <name> --png <file>');
  settings[key] = process.argv[i + 1];
}
for (const key of ['gameUrl', 'comfyUrl']) {
  const url = new URL(settings[key]);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Capture requires local servers.');
  settings[key] = url.href.replace(/\/$/, '');
}
const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.config), 'utf8'));
const OUT = path.resolve(ROOT, settings.out), CAPTURES = path.join(OUT, 'captures'), RAW = path.join(CAPTURES, 'raw');
fs.mkdirSync(RAW, { recursive: true });
const scenes = config.scenes.filter(scene => !settings.scene || scene.id === settings.scene);
if (!scenes.length) throw new Error(`Unknown scene ${settings.scene}`);
const report = { capturedAt: new Date().toISOString(), inferenceSubmitted: false, blockedComfyWrites: [], scenes: [] };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name} failed: ${(result.stderr || String(result.error)).slice(-2000)}`);
  return result.stdout;
}
const probeDuration = file => Number(JSON.parse(command('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file])).format.duration);

// ---------------------------------------------------------------- cards: pages drawn from the pipeline's own files
const CSS = `@font-face{font-family:'Press Start 2P';src:url('/file/build/public/fonts/PressStart2P-Regular.ttf')}
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#080d1d;color:#f6f6f9;font-family:'Segoe UI',Arial,sans-serif}
.card{position:absolute;inset:0;padding:120px 110px 150px;display:flex;flex-direction:column;gap:26px}
.eyebrow{font-family:'Press Start 2P',monospace;font-size:18px;color:#ffd23f;letter-spacing:2px;text-shadow:3px 3px 0 #000}
h1{font-family:'Press Start 2P',monospace;font-size:38px;line-height:1.45;margin:0;text-shadow:4px 4px 0 #000}h1 em{font-style:normal;color:#2edbc8}
.mono{font-family:Consolas,'Cascadia Mono',monospace;font-size:30px;line-height:1.5;white-space:pre;color:#d5deec}
.panel{background:#0f1730;border:3px solid #23334c;box-shadow:12px 12px 0 #000;padding:38px 44px;overflow:hidden;position:relative;flex:1;min-height:560px}
.key{color:#8de9e6}.str{color:#ffd27a}.num{color:#ff8ba7}.hl{background:#ffd23f22;outline:2px solid #ffd23f55}
.cursor::after{content:'▌';color:#ffd23f;animation:blink 1s steps(2) infinite}@keyframes blink{to{opacity:0}}
.stage{position:absolute;inset:0;background:#080d1d}.stage img{position:absolute;left:0;top:0}
.tag{position:absolute;font-family:'Press Start 2P',monospace;font-size:16px;color:#fff;background:#000c;border:2px solid #ffd23f;padding:12px 16px;letter-spacing:1px}
.end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;text-align:center}
.end h1{font-size:54px}.end .url{font-family:'Press Start 2P',monospace;font-size:24px;color:#ffd23f;text-shadow:3px 3px 0 #000}.end .url small{display:block;color:#8de9e6;font-size:14px;margin-bottom:12px}
.line{opacity:0;animation:rise .5s forwards}@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`;

function castCard() {
  const cast = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.cast), 'utf8')), fighter = cast.fighters[0], stage = cast.stages[0];
  const lines = [];
  const push = (text, cls = '') => lines.push({ text, cls });
  push(`{`); push(`  "castSchema": "${cast.castSchema}",`); push(`  "title": "${cast.title}",`); push(`  "subtitle": "${cast.subtitle}",`); push(`  "videoModel": "${cast.videoModel}", "videoResolution": "${cast.videoResolution}",`);
  push(`  "fighters": [`); push(`    {`); push(`      "id": "${fighter.id}", "name": "${fighter.name}", "color": "${fighter.color}",`);
  push(`      "description": "${fighter.description.slice(0, 78)}…",`, 'hl'); push(`      "specialMove": { "name": "${fighter.specialMove.name}",`, 'hl');
  push(`        "description": "${fighter.specialMove.description.slice(0, 66)}…" },`, 'hl'); push(`      "introTagline": "${fighter.introTagline.slice(0, 70)}",`); push(`      "style": "${fighter.style}"`);
  push(`    },`); push(`    … ${cast.fighters.length - 1} more fighters`); push(`  ],`); push(`  "stages": [`); push(`    { "id": "${stage.id}", "name": "${stage.name}",`, 'hl'); push(`      "description": "${stage.description.slice(0, 70)}…" }`, 'hl'); push(`    … ${cast.stages.length - 1} more arenas`); push(`  ]`); push(`}`);
  const code = lines.map((line, i) => `<div class="line ${line.cls}" style="animation-delay:${(0.4 + i * 0.22).toFixed(2)}s">${escape(line.text).replace(/"([a-zA-Z]+)":/g, '<span class="key">"$1"</span>:').replace(/: "([^"]*)"/g, ': <span class="str">"$1"</span>')}</div>`).join('');
  return `<div class="card"><div class="eyebrow">01 · THE CAST FILE</div><h1>${escape(path.relative(ROOT, path.resolve(ROOT, settings.cast)).split(path.sep).join('/'))}</h1><div class="panel mono" style="font-size:27px;line-height:1.42">${code}</div></div>`;
}

function prepareCard() {
  const plan = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.run, 'plan.json'), 'utf8'));
  // The run folder's date suffix is noise on screen.
  const run = 'output/test-runs/' + path.basename(path.resolve(ROOT, settings.run)).replace(/-\d{8}$/, ''), cast = path.basename(settings.cast);
  const money = value => `$${Number(value).toFixed(2)}`, approve = Math.ceil(plan.total.estimatedUSD * 100) / 100;
  const lines = [
    `$ new-game.cjs prepare --cast casts/${cast} \\`, `      --out ${run}`,
    `Prepared ${plan.title} / ${plan.subtitle}: ${plan.fighters.length} fighters, ${plan.stages.length} arenas.`,
    `  images ${plan.images.paidImages} (${money(plan.images.estimatedUSD)}), clips ${plan.videos.clips} / ${plan.videos.seconds} s (${money(plan.videos.estimatedUSD)}),`,
    `  audio ${plan.audio.clips} (${money(plan.audio.estimatedUSD)})`,
    `  estimated total ${money(plan.total.estimatedUSD)} — nothing submitted.`,
    ``,
    `$ new-game.cjs run --run ${run}`,
    `This run is estimated at ${money(plan.total.estimatedUSD)};`, `pass --approve-usd ${approve} (or more) once authorized.`,
    ``,
    `$ new-game.cjs run --run ${run} --approve-usd ${approve}`,
    `Submitting one paid node at a time…`
  ];
  const html = lines.map((line, i) => `<div class="line${i === lines.length - 1 ? ' cursor' : ''}" style="animation-delay:${(0.5 + i * 0.6).toFixed(2)}s">${line.startsWith('$') ? `<span class="key">${escape(line)}</span>` : escape(line).replace(/\$[0-9.]+/g, m => `<span class="num">${m}</span>`)}</div>`).join('');
  return `<div class="card"><div class="eyebrow">02 · PRICE THE RUN</div><h1>One command, one <em>estimate</em>, one approval</h1><div class="panel mono" style="font-size:27px;line-height:1.45">${html}</div></div>`;
}

function exportCard() {
  const receipt = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.export, 'build-test.json'), 'utf8')), checks = receipt.checks.slice(0, 9);
  const run = 'output/test-runs/' + path.basename(path.resolve(ROOT, settings.run)).replace(/-\d{8}$/, '');
  const html = [`<div class="line key" style="animation-delay:.3s">$ new-game.cjs export --run ${escape(run)}</div>`,
    ...checks.map((check, i) => `<div class="line" style="animation-delay:${(0.6 + i * 0.32).toFixed(2)}s"><span class="str">✓</span> ${escape(check.length > 62 ? check.slice(0, 60) + '…' : check)}</div>`),
    `<div class="line" style="animation-delay:${(0.8 + checks.length * 0.32).toFixed(2)}s">… <span class="num">${receipt.checks.length} checks ${receipt.status}</span> · ${receipt.poseCount} poses · ${receipt.sourceAssets} source assets</div>`].join('');
  return `<div class="card"><div class="eyebrow">06 · STRICT EXPORT</div><h1>Every file and clip <em>checked</em> before it ships</h1><div class="panel mono" style="font-size:27px;line-height:1.45">${html}</div></div>`;
}

// A still the camera drifts across. The image is fitted to the frame (contain, or to its width) and moved between two
// framings, each an image point (fractions) held at the screen centre at a zoom relative to the fitted scale.
function pngSize(file) {
  const header = Buffer.alloc(24), fd = fs.openSync(file, 'r'); fs.readSync(fd, header, 0, 24, 0); fs.closeSync(fd);
  if (header.toString('latin1', 1, 4) !== 'PNG') throw new Error(`Not a PNG: ${file}`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}
function panCard(file, { from, to, seconds, label, eyebrow, fit = 'contain' }) {
  const { width, height } = pngSize(file), base = fit === 'width' ? 1920 / width : Math.min(1920 / width, 1080 / height);
  const place = ({ zoom, x, y }) => { const s = base * zoom; return `translate(${(960 - x * width * s).toFixed(1)}px,${(540 - y * height * s).toFixed(1)}px) scale(${s.toFixed(4)})`; };
  const src = `/file/${path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/')}`;
  return `<div class="stage"><img src="${escape(src)}" style="transform-origin:0 0;transform:${place(from)};animation:pan ${seconds}s cubic-bezier(.3,0,.6,1) forwards"><style>@keyframes pan{from{transform:${place(from)}}to{transform:${place(to)}}}</style>
    ${eyebrow ? `<div class="tag" style="left:60px;top:120px;color:#ffd23f">${escape(eyebrow)}</div>` : ''}${label ? `<div class="tag" style="left:60px;bottom:200px">${escape(label)}</div>` : ''}</div>`;
}

function endCard() {
  return `<div class="end"><div class="eyebrow">COMFY FIGHTER Z</div><h1>ULTRA <em>DREAM MATCH</em></h1><div class="mono" style="font-size:20px;color:#a6b1c5">26 FIGHTERS · 8 ARENAS · ONE FINAL BOSS</div>
    <div class="url line" style="animation-delay:.8s"><small>PLAY</small>${escape(String(config.liveURL || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>
    <div class="url line" style="animation-delay:1.6s"><small>BUILD</small>${escape(String(config.repositoryURL || '').replace(/^https?:\/\//, ''))}</div></div>`;
}

// The pipeline as a diagram: five stages light up left to right with their arrows, the review loop curls back from the
// bundle to the run, and the last stage fans out to where the game plays. Every label names a real file or command.
function pipelineCard() {
  const cast = path.basename(settings.cast);
  const stages = [
    { title: 'CAST FILE', lines: [`casts/${cast}`, 'fighters · special moves · arenas', 'text only: no photos, no venues'] },
    { title: 'COMFYUI RUN', lines: ['one graph: comfy-hackathon.json', 'factories → 3×3 sprite sheets → arenas', 'menus · clips · voices · music', 'cloud models, one paid node at a time'] },
    { title: 'MAPPED BUNDLE', lines: ['assets.json · audio.json · video.json', 'raw/ images, clips and sounds', 'review → reroll one node'] },
    { title: 'BROWSER BUILDER', lines: ['cuts each sheet into cels', 'keys chroma, maps 45+ poses', 'strict export: every file checked'] },
    { title: 'PLAYABLE GAME', lines: ['npm start · GAME SELECT', 'online 1v1 · phone & TV', 'comfy-fight-z.dhaakon.com'] }
  ];
  const at = index => 0.4 + index * 1.4, delay = seconds => `animation-delay:${seconds.toFixed(2)}s`;
  const boxes = stages.map((stage, index) => `<div class="stage line" style="grid-column:${index * 2 + 1} / ${index * 2 + 2};grid-row:1;${delay(at(index))}"><div class="stage-title">${escape(stage.title)}</div>${stage.lines.map(line => `<div class="stage-line">${escape(line)}</div>`).join('')}</div>`);
  const arrows = stages.slice(1).map((_, index) => `<div class="arrow line" style="grid-column:${index * 2 + 2} / ${index * 2 + 3};grid-row:1;${delay(at(index) + 0.95)}">▶</div>`);
  return `<style>
    .flow{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 56px minmax(0,1fr) 56px minmax(0,1fr) 56px minmax(0,1fr) 56px minmax(0,1fr);align-items:start;gap:0;margin-top:150px;height:400px}
    .stage{background:#0f1730;border:3px solid #23334c;box-shadow:12px 12px 0 #000;padding:24px 20px;display:flex;flex-direction:column;gap:12px;min-height:300px;min-width:0}
    .stage-title{font-family:'Press Start 2P',monospace;font-size:17px;color:#ffd23f;line-height:1.5;text-shadow:3px 3px 0 #000;margin-bottom:8px;overflow-wrap:anywhere}
    .stage-line{font-family:Consolas,'Cascadia Mono',monospace;font-size:18px;line-height:1.35;color:#d5deec;white-space:normal;overflow-wrap:anywhere}
    .stage:nth-child(2) .stage-title{color:#8de9e6}.stage:nth-child(5) .stage-title{color:#2edbc8}
    .arrow{align-self:center;text-align:center;font-size:40px;color:#ffd23f;text-shadow:3px 3px 0 #000;margin-top:130px}
    .loop{position:absolute;left:0;top:-130px;width:1700px;height:140px;pointer-events:none}
    .loop path{fill:none;stroke:#ff8ba7;stroke-width:5;stroke-dasharray:14 10}
    .loop text{font-family:'Press Start 2P',monospace;font-size:15px;fill:#ff8ba7;text-anchor:middle}
    .targets{display:flex;gap:18px;justify-content:center;margin-top:40px}
    .chip{font-family:'Press Start 2P',monospace;font-size:14px;color:#fff;background:#000c;border:2px solid #2edbc8;padding:12px 16px;letter-spacing:1px}
  </style>
  <div class="card"><div class="eyebrow">05 · THE PIPELINE</div><h1>ComfyUI <em>generation</em> → build → playable game</h1>
    <div class="flow">${boxes.join('')}${arrows.join('')}
      <svg class="loop line" viewBox="0 0 1700 140" style="${delay(at(3))}"><path d="M 850 134 C 850 50, 497 50, 497 126" marker-end="url(#tip)"/><defs><marker id="tip" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="9" refY="9" orient="auto"><path d="M0,0 L18,9 L0,18 z" fill="#ff8ba7"/></marker></defs><text x="673" y="30">REVIEW · REROLL ONE NODE · THE CACHE KEEPS THE REST</text></svg>
    </div>
    <div class="targets">${['browser', 'phone', 'shared TV + phones', 'online 1v1', 'static site'].map((target, index) => `<div class="chip line" style="${delay(at(4) + 0.6 + index * 0.25)}">${escape(target.toUpperCase())}</div>`).join('')}</div>
  </div>`;
}

const CARDS = {
  cast: castCard, prepare: prepareCard, export: exportCard, end: endCard, pipeline: pipelineCard,
  // The sweep comparison is eight rows of four cells (wind-up, full, through, back; the full cell is the one that went
  // wrong); fitted to the width, two rows fill the frame, and the camera crawls down from the first pair.
  sweeps: () => panCard(path.join(OUT, 'stills/sweeps-compare.png'), { fit: 'width', from: { zoom: 1, x: .5, y: .125 }, to: { zoom: 1, x: .5, y: .5 }, seconds: 5, eyebrow: '04 · REVIEW', label: 'sweepfull: a standing kick, redrawn until it connected low' }),
  cutins: () => panCard(path.join(OUT, 'stills/cutins-new.png'), { fit: 'width', from: { zoom: 1, x: .5, y: .5 }, to: { zoom: 1.12, x: .5, y: .5 }, seconds: 3, label: 'super cut-ins after the prompt fix' }),
  posegrid: () => panCard(path.join(OUT, 'stills/pose-grid.png'), { from: { zoom: 1, x: .5, y: .5 }, to: { zoom: 1.4, x: .4, y: .3 }, seconds: 4, eyebrow: '04 · REVIEW', label: 'new-game.cjs review · every pose on one grid' }),
  scenery: () => panCard(path.join(OUT, 'stills/yard-review.png'), { fit: 'width', from: { zoom: 1, x: .5, y: .25 }, to: { zoom: 1.08, x: .5, y: .36 }, seconds: 5, eyebrow: '05 · LIVING SCENERY', label: 'director plan → painted → separated → placed layers' })
};

function serveCards() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname.startsWith('/card/')) {
          const card = CARDS[url.pathname.slice(6)];
          if (!card) { response.writeHead(404); return response.end(); }
          // Render before writing headers, so a card that throws is reported rather than crashing the server.
          const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${card()}`;
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return response.end(html);
        }
        if (url.pathname.startsWith('/file/')) {
          const file = sourceFile(ROOT, decodeURIComponent(url.pathname.slice(6)));
          const types = { '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
          response.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
          return fs.createReadStream(file).pipe(response);
        }
        response.writeHead(404); response.end();
      } catch (error) { console.error(`card ${request.url}: ${error.stack || error.message}`); if (!response.headersSent) response.writeHead(500); response.end(String(error.message)); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ---------------------------------------------------------------- the games
async function openGame(page, mount = '') {
  await page.goto(`${settings.gameUrl}/${mount}`);
  await page.waitForFunction(() => document.getElementById('boot-screen')?.hidden && !document.querySelector('#title-start').disabled, null, { timeout: 120000 });
  if (await page.locator('#opening-screen').isVisible()) await page.keyboard.press('Space');
}
async function pickFighters(page, p1, p2, stage) {
  await page.evaluate(({ p1, p2 }) => {
    const pick = (selectId, name) => { const select = document.getElementById(selectId), option = [...select.options].find(o => o.textContent.toLowerCase().replace(/[^a-z]/g, '').endsWith(name)); if (!option) throw new Error(`no fighter ${name}`); select.value = option.value; select.dispatchEvent(new Event('change')); };
    pick('fighter-one', p1); pick('fighter-two', p2);
  }, { p1, p2 });
  for (let i = 0; i < 9 && await page.evaluate(() => FighterDebug.presentation().stageId) !== stage; i++) { await page.click('#stage-next'); await page.waitForTimeout(100); }
}
async function startTraining(page, p1, p2, stage) {
  await page.click('#title-training'); await page.waitForTimeout(300);
  await pickFighters(page, p1, p2, stage);
  await page.click('#start-button');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(400); if (await page.evaluate(() => FighterDebug.snapshot()?.phase === 'fight' && !FighterDebug.presentation().introSlot && FighterDebug.presentation().screen === 'fight')) break; await page.keyboard.press('Space').catch(() => {}); }
  await page.waitForTimeout(500);
}
async function exchange(page, keys, walk = 500) {
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(walk); await page.keyboard.up('ArrowRight');
  for (const key of keys) { if (Array.isArray(key)) { for (const k of key) await page.keyboard.down(k); await page.waitForTimeout(60); for (const k of key) await page.keyboard.up(k); } else await page.keyboard.press(key); await page.waitForTimeout(420); }
}

// ---------------------------------------------------------------- the ComfyUI editor (reads only)
async function openComfy(context, page) {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(settings.comfyUrl).origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.blockedComfyWrites.push({ method: request.method(), path: url.pathname });
      if (/^\/(?:api\/)?(?:prompt|queue|interrupt)(?:\/|$)/.test(url.pathname)) return route.abort('blockedbyclient');
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  const graph = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.run, 'workflow.json'), 'utf8'));
  for (const node of graph.nodes) if (node.type === 'CFZProjectSettings') {
    // The run's absolute output folder is personal; the editor shows a generic one.
    node.widgets_values[0] = 'C:/comfy-fighter-z/output/test-runs/billionaires-brawl/bundle';
    if (node.widgets_values_named) node.widgets_values_named.root_directory = node.widgets_values[0];
  }
  if (/C:[\\/]Users[\\/]/i.test(JSON.stringify(graph))) throw new Error('The run graph still carries a personal path.');
  await page.goto(settings.comfyUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.comfyAPI?.app?.app?.canvas?.canvas, null, { timeout: 60000 });
  await page.evaluate(async graph => window.comfyAPI.app.app.loadGraphData(graph, true, true), graph);
  await page.waitForTimeout(2500);
  // Close the properties panel only when it is open (the toggle would open it), hide the minimap, and clear any canvas
  // wallpaper this install shows behind the graph: only the run's nodes belong on screen.
  if (await page.getByRole('button', { name: 'NO FAVORITED INPUTS', exact: true }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Toggle properties panel', exact: true }).click().catch(() => {});
  const minimap = page.getByRole('button', { name: 'Hide Minimap (ALT + SHIFT + M)', exact: true }); if (await minimap.isVisible().catch(() => false)) await minimap.click().catch(() => {});
  await page.addStyleTag({ content: '.graph-canvas-container, #graph-canvas-container, .litegraph, #graph-canvas { background-image: none !important; background-color: #16181d !important; }' });
  await page.evaluate(() => { for (const element of document.querySelectorAll('body *')) { const style = getComputedStyle(element); if (style.backgroundImage.includes('url(') && element.getBoundingClientRect().width > 600) element.style.setProperty('background-image', 'none', 'important'); }
    const app = window.comfyAPI.app.app; if (app.canvas) { app.canvas.background_image = null; app.canvas.clear_background = true; app.canvas.setDirty(true, true); } });
  // The Job Queue panel lists this install's recent jobs; close it, by its button, its shortcut or by hiding it.
  const queueOpen = () => page.getByText('Job Queue', { exact: true }).first().isVisible().catch(() => false);
  if (await queueOpen()) { const button = page.getByRole('button', { name: /queue/i }).first(); if (await button.isVisible().catch(() => false)) await button.click().catch(() => {}); await page.waitForTimeout(300); }
  if (await queueOpen()) { await page.keyboard.press('q'); await page.waitForTimeout(300); }
  if (await queueOpen()) await page.evaluate(() => {
    const heading = [...document.querySelectorAll('*')].find(element => element.childElementCount === 0 && element.textContent.trim() === 'Job Queue');
    let panel = heading; while (panel && panel.parentElement && panel.getBoundingClientRect().height < 400) panel = panel.parentElement;
    if (panel) panel.style.setProperty('display', 'none', 'important');
  });
  await page.waitForTimeout(400);
  report.comfy = await page.evaluate(() => { const app = window.comfyAPI.app.app; return { nodes: app.graph._nodes.length, factories: app.graph._nodes.filter(n => n.type === 'CFZCharacterFactory').length, sheets: app.graph._nodes.filter(n => n.type === 'CFZSpriteSheet').length, errors: app.graph._nodes.filter(n => n.has_errors).map(n => n.type) }; });
  if (report.comfy.errors.length) throw new Error(`The editor lacks nodes: ${report.comfy.errors.join(', ')}`);
}
async function camera(page, box, duration = 1400) {
  await page.evaluate(async ({ box, duration }) => {
    const app = window.comfyAPI.app.app, rect = app.canvas.canvas.getBoundingClientRect(), area = { x: 60, y: 130, width: 1800, height: 740 };
    const scale = Math.min(area.width / box.width, area.height / box.height, box.maxScale || 1.2);
    const target = [(area.x - rect.x + (area.width - box.width * scale) / 2) / scale - box.x, (area.y - rect.y + (area.height - box.height * scale) / 2) / scale - box.y];
    const startScale = app.canvas.ds.scale, start = [...app.canvas.ds.offset], began = performance.now();
    await new Promise(resolve => { (function step(now) { const t = duration ? Math.min((now - began) / duration, 1) : 1, e = t * t * (3 - 2 * t); app.canvas.ds.scale = startScale + (scale - startScale) * e; app.canvas.ds.offset = start.map((v, i) => v + (target[i] - v) * e); app.canvas.setDirty(true, true); if (t < 1) requestAnimationFrame(step); else resolve(); })(performance.now()); });
  }, { box, duration });
}
const bounds = (page, filter) => page.evaluate(filter => {
  const nodes = window.comfyAPI.app.app.graph._nodes.filter(new Function('node', `return ${filter}`));
  const x = Math.min(...nodes.map(n => n.pos[0])), y = Math.min(...nodes.map(n => n.pos[1])), x2 = Math.max(...nodes.map(n => n.pos[0] + n.size[0])), y2 = Math.max(...nodes.map(n => n.pos[1] + n.size[1]));
  return { x: x - 40, y: y - 60, width: x2 - x + 80, height: y2 - y + 100, count: nodes.length };
}, filter);

// ---------------------------------------------------------------- shots
// A shot records one page; `keep` seconds from its end are kept, so preparation never shows. A `clip` shot is a
// generated video under the run (the Seedance opening): it plays from its start and holds its last frame to fill.
// Training with the collision boxes on: the settings dialog's DEBUG option persists for the page.
async function boxesOn(page) {
  await page.click('#settings-open'); await page.selectOption('#opt-debug', 'boxes'); await page.selectOption('#opt-difficulty', '8'); await page.click('#settings-close'); await page.waitForTimeout(200);
}
const SHOTS = {
  '01-intro': [{ keep: 9, clip: config.intro?.clip || 'stills/intro-seedance.mp4' }],
  '02-cast': [{ keep: 9, card: 'cast', run: async page => page.waitForTimeout(9500) }],
  '03-prepare': [{ keep: 8, card: 'prepare', run: async page => page.waitForTimeout(8500) }],
  '04-workflow': [{ keep: 11, comfy: true, run: async page => {
    const all = await bounds(page, 'true'); await camera(page, { ...all, maxScale: 0.5 }, 0); await page.waitForTimeout(1700);
    const characters = await bounds(page, 'node.type === "CFZCharacterFactory"'); await camera(page, { ...characters, maxScale: 0.42 }, 1300); await page.waitForTimeout(800);
    const sheets = await bounds(page, 'node.type === "CFZSpriteSheet" && node.title.startsWith("Musk")'); await camera(page, { ...sheets, maxScale: 1 }, 1200); await page.waitForTimeout(1000);
    const environment = await bounds(page, 'node.type === "CFZEnvironmentFactory"'); await camera(page, { ...environment, maxScale: 0.9 }, 1100); await page.waitForTimeout(800);
    const media = await bounds(page, '["CFZTitleArt","CFZTitleVideo","CFZSelectVideo","CFZIntroVideo","CFZSelectIdleVideo"].includes(node.type)'); await camera(page, { ...media, maxScale: 0.8 }, 1100); await page.waitForTimeout(900);
    const audio = await bounds(page, 'node.type === "CFZSaveAudio" || /cloud audio/.test(node.title || "")'); await camera(page, { ...audio, maxScale: 0.5 }, 1300); await page.waitForTimeout(1300);
  } }],
  '05-pipeline': [{ keep: 9, card: 'pipeline', run: async page => page.waitForTimeout(9500) }],
  '06-review': [
    { keep: 4, card: 'posegrid', run: async page => page.waitForTimeout(4600) },
    { keep: 3, card: 'cutins', run: async page => page.waitForTimeout(4400) }
  ],
  '07-engine': [
    // Collision boxes and the frame-data read-out answering a jab, a kick, a roundhouse, a heavy and a launcher.
    { keep: 8, game: '', run: async page => { await boxesOn(page); await startTraining(page, 'griddle', 'rivet', 'yard'); await exchange(page, ['a', 's', ['ArrowRight', 's'], 'd'], 1800); await page.waitForTimeout(700); await exchange(page, [['ArrowDown', 'd'], 'a', 'a', 'f'], 500); await page.waitForTimeout(1600); } },
    // The shared display: the server pairs phones by code and owns the match.
    { keep: 5, game: '', run: async page => {
      await page.click('#title-phones'); await page.waitForTimeout(700);
      const modes = page.locator('input[name="network-play-mode"]'); if (await modes.count() > 1) await modes.nth(1).check().catch(() => {});
      await page.click('#network-project'); await page.waitForFunction(() => document.querySelectorAll('#network-pairing a').length >= 1, null, { timeout: 20000 }); await page.waitForTimeout(5200);
    } }
  ],
  '08-scenery': [
    { keep: 4, card: 'scenery', run: async page => page.waitForTimeout(4600) },
    { keep: 4, game: '', run: async page => { await startTraining(page, 'brick', 'tempo', 'yard'); await exchange(page, ['a', 's', 'd', 'f']); await page.waitForTimeout(1500); } }
  ],
  '09-games': [
    { keep: 3.5, card: 'export', run: async page => page.waitForTimeout(4200) },
    { keep: 4.5, game: '', run: async page => { await page.click('#title-games'); await page.waitForTimeout(900); const cards = page.locator('#games-grid .game-card'); const count = await cards.count(); for (let i = 0; i < count; i++) { await cards.nth(i).focus(); await page.waitForTimeout(600); } await page.waitForTimeout(600); } }
  ],
  '10-ultra': [
    { keep: 4, game: 'ultra/', run: async page => { await startTraining(page, 'overmind', 'bezos', 'datacore'); await exchange(page, ['a', 's', 'd']); await page.keyboard.down('KeyF'); await page.keyboard.down('KeyD'); await page.waitForTimeout(80); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyF'); await page.waitForTimeout(2000); } },
    { keep: 4, card: 'end', run: async page => page.waitForTimeout(4600) }
  ]
};

async function record(browser, cards, scene) {
  const shots = SHOTS[scene.id];
  if (!shots) throw new Error(`No shot list for ${scene.id}`);
  const kept = shots.reduce((sum, shot) => sum + shot.keep, 0);
  if (Math.abs(kept - scene.targetSeconds) > 0.01) throw new Error(`${scene.id}: shots keep ${kept}s but the storyboard allots ${scene.targetSeconds}s.`);
  const parts = [];
  for (const [index, shot] of shots.entries()) {
    if (shot.clip) {
      const source = sourceFile(OUT, shot.clip), part = path.join(RAW, `${scene.id}-${index}.webm`);
      if (probeDuration(source) > shot.keep + .05) throw new Error(`${scene.id}: the clip runs ${probeDuration(source).toFixed(2)}s, longer than its ${shot.keep}s shot.`);
      command('ffmpeg', ['-y', '-v', 'error', '-i', source, '-an', '-vf', `fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x080d1d,setsar=1,tpad=stop_mode=clone:stop_duration=${shot.keep},trim=duration=${shot.keep}`, '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '6', part]);
      parts.push(part); continue;
    }
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } } });
    const page = await context.newPage(), video = page.video(); page.setDefaultTimeout(30000);
    if (shot.comfy) await openComfy(context, page);
    else if (shot.card) { await page.goto(`${cards.url}/card/${shot.card}`); await page.waitForTimeout(400); }
    else await openGame(page, shot.game);
    await shot.run(page);
    await context.close();
    const raw = await video.path(), duration = probeDuration(raw), part = path.join(RAW, `${scene.id}-${index}.webm`);
    if (duration < shot.keep) throw new Error(`${scene.id} shot ${index} recorded ${duration}s, under its ${shot.keep}s.`);
    command('ffmpeg', ['-y', '-v', 'error', '-ss', (duration - shot.keep).toFixed(3), '-i', raw, '-t', String(shot.keep), '-an', '-vf', 'fps=30,scale=1920:1080,setsar=1', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '6', part]);
    parts.push(part);
  }
  const target = path.join(CAPTURES, `${scene.id}.webm`);
  if (parts.length === 1) fs.copyFileSync(parts[0], target);
  else {
    // Absolute, forward-slash paths: the concat demuxer does not resolve entries against the list's folder here.
    const list = path.join(RAW, `${scene.id}.txt`); fs.writeFileSync(list, parts.map(part => `file '${part.split(path.sep).join('/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    command('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', target]);
  }
  const seconds = probeDuration(target);
  report.scenes.push({ id: scene.id, shots: parts.length, seconds, bytes: fs.statSync(target).size });
  console.log(`${scene.id}: ${parts.length} shot(s), ${seconds.toFixed(2)}s`);
}

(async () => {
  const cards = await serveCards();
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'], ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  try {
    // Card design check: screenshots of one card early and settled, nothing recorded.
    if (settings.card) {
      if (!CARDS[settings.card] || !settings.png) throw new Error('--card needs a known card name and --png <file>.');
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`${cards.url}/card/${settings.card}`); await page.waitForTimeout(1500); await page.screenshot({ path: settings.png.replace(/\.png$/i, '') + '-early.png' });
      await page.waitForTimeout(7000); await page.screenshot({ path: settings.png.replace(/\.png$/i, '') + '-settled.png' });
      const facts = await page.evaluate(() => [...document.querySelectorAll('.stage')].map(stage => { const line = stage.querySelector('.stage-line'); const style = line && getComputedStyle(line); return { box: Math.round(stage.getBoundingClientRect().width), line: line && { scroll: line.scrollWidth, client: line.clientWidth, whiteSpace: style.whiteSpace, wrap: style.overflowWrap, font: style.font.slice(0, 40) } }; }));
      console.log(`Card ${settings.card}: early and settled screenshots written.`, JSON.stringify(facts)); return;
    }
    for (const scene of scenes) await record(browser, cards, scene);
    if (report.blockedComfyWrites.some(request => /^\/(?:api\/)?(?:prompt|queue|interrupt)(?:\/|$)/.test(request.path))) throw new Error('An execution request was attempted.');
    fs.writeFileSync(path.join(CAPTURES, 'capture-manifest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Finished. No cloud jobs submitted.');
  } finally { await browser.close(); cards.server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
