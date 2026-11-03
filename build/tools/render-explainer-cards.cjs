// Render original motion graphics around accepted fictional game art. No model calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { sourceFile, directoryTarget } = require('./lib/runtime-validation.cjs');
const { verifiedExport } = require('./install-game.cjs');
const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(ROOT, 'output/exports/smoke-20261103-0548/game');
const DEFAULT_OUTPUT = path.join(ROOT, 'output/explainer/20261103');
const IDS = ['02-setup', '03-custom-nodes', '08-review-bundle', '12-next-steps'];
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function browserPath() {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'ms-playwright');
  if (fs.existsSync(cache)) for (const version of fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
    const file = path.join(cache, version, 'chrome-win64/chrome.exe'); if (fs.existsSync(file)) return file;
  }
  throw new Error('Install Playwright Chromium or set PLAYWRIGHT_EXECUTABLE_PATH.');
}

function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => output += String(chunk)); child.stderr.on('data', chunk => output += String(chunk));
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${program} failed (${code}): ${output.slice(-5000)}`)));
  });
}

function cardBody(id, bundle, runtime) {
  const sheet = bundle.assets.find(asset => asset.fighter === runtime.fighters[0].id && asset.sheet === 'sheet');
  const heroes = runtime.fighters.slice(0, 2).map(fighter => `<img class="hero-art" src="/asset/${escape(fighter.hero)}" alt="${escape(fighter.name)}">`).join('');
  if (id === '02-setup') return `<div class="eyebrow">A CLEAN START</div><h1>One project.<br><em>Three clear folders.</em></h1>
    <div class="setup-grid"><div class="folders">
      <article class="folder step1"><span class="folder-icon">01</span><div><b>comfyui/</b><p>Workflows &amp; generation sources</p></div><span class="tag">GENERATE</span></article>
      <article class="folder step2"><span class="folder-icon">02</span><div><b>build/</b><p>Game, builder &amp; tools</p></div><span class="tag">ASSEMBLE</span></article>
      <article class="folder step3"><span class="folder-icon">03</span><div><b>output/</b><p>Your bundles, game &amp; exports</p></div><span class="tag">PLAY</span></article>
    </div><div class="terminal step2"><div class="terminal-title"><i></i><i></i><i></i><span>FROM THE REPOSITORY ROOT</span></div><pre><span class="muted"># Node.js 22+</span>\n<span class="prompt">$</span> npm ci\n<span class="prompt">$</span> npm run workflows\n<span class="prompt">$</span> npm run build\n<span class="prompt">$</span> npm start<span class="cursor">▌</span></pre><div class="terminal-foot">BUILDER <b>127.0.0.1:8080/builder/</b></div></div></div>`;
  if (id === '03-custom-nodes') return `<div class="eyebrow">CONNECT THE FACTORIES</div><h1>Install once.<br><em>Create in ComfyUI.</em></h1>
    <div class="command-card step1"><div class="terminal-title"><i></i><i></i><i></i><span>POINT TO THE COMFYUI SERVER YOU ACTUALLY RUN</span></div><code>npm run nodes:install -- --comfy-root "&lt;ComfyUI folder&gt;"</code><p>Choose the folder containing <strong>main.py</strong> and <strong>nodes.py</strong>.</p></div>
    <div class="install-flow"><article class="step1"><span>01</span><h2>INSTALL</h2><p>The included factory pack</p></article><div class="flow-arrow">→</div><article class="step2"><span>02</span><h2>RESTART</h2><p>Server, then reload the editor</p></article><div class="flow-arrow">→</div><article class="step3"><span>03</span><h2>OPEN</h2><p style="font:17px Consolas,monospace;white-space:nowrap">comfyui/workflows/comfy-hackathon.json</p></article></div><div class="cloud-note step3"><b>CLOUD MODELS</b><span>Sign in to Comfy · No local checkpoints · Nodes 2.0</span></div>`;
  if (id === '08-review-bundle') return `<div class="review-layout"><div class="sheet-panel step1"><div class="eyebrow">ACTUAL GENERATED ART · ${escape(runtime.fighters[0].name.toUpperCase())}</div><div class="sheet-wrap"><img src="/asset/sources/${escape(sheet.src)}" alt="Freshly generated nine-pose sheet"><div class="cell-focus"></div></div><p class="sheet-label">3 × 3 SHEET <span>CHECK EVERY POSE</span></p></div><div class="review-copy"><div class="eyebrow">REVIEW BEFORE YOU BUILD</div><h1>Real sheets.<br><em>Mapped assets.</em></h1><div class="metrics step2"><div><b>${bundle.assets.length}</b><span>GENERATED IMAGES</span></div><div><b>${runtime.fighters.reduce((count, fighter) => count + Object.keys(fighter.poses).length, 0)}</b><span>FIGHTER POSES</span></div></div><div class="bundle-map step2"><div><span class="tree-icon">▰</span> bundle/</div><div class="indent">├─ <strong>assets.json</strong> <small>IDs · paths · hashes</small></div><div class="indent">└─ <strong>raw/</strong> <small>Original source media</small></div></div><ul class="checks step3"><li>Consistent identity &amp; outfit</li><li>Complete hands and feet</li><li>Nine clear poses in order</li><li>Keep the whole bundle together</li></ul></div></div>`;
  if (id === '12-next-steps') return `<div class="closing"><div class="closing-copy"><div class="eyebrow">YOUR NEXT CHALLENGER</div><h1>Comfy Fighter <em>Z</em></h1><p class="closing-subtitle">HIGGSFIELD OPEN SOURCE SAGA</p><div class="pill-row step1"><span>DESCRIBE</span><b>→</b><span>GENERATE</span><b>→</b><span>BUILD</span><b>→</b><span>PLAY</span></div><p class="closing-detail step2">Start with the working example.<br>Make the next cast your own.</p><div class="repo-link step3"><small>OPEN SOURCE · WORKFLOWS + GAME BUILDER</small><b>github.com/dhaakon/comfy-fight-z</b></div></div><div class="closing-heroes">${heroes}</div></div>`;
  throw new Error(`Unknown card: ${id}`);
}

function page(id, bundle, runtime) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}body{background:#080d1d;color:#f7f7fc;font-family:"Segoe UI",Arial,sans-serif}body:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 85% 40%,#123b5666,transparent 60%),radial-gradient(ellipse at 12% 84%,#5d381f33,transparent 60%)}body:after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(#87c6df08 1px,transparent 1px),linear-gradient(90deg,#87c6df08 1px,transparent 1px);background-size:72px 72px;mask-image:linear-gradient(transparent,#0006)}main{position:absolute;left:105px;right:105px;top:145px;height:700px;z-index:1}.eyebrow{font-size:18px;font-weight:700;letter-spacing:4px;color:#83e8e3;margin-bottom:22px}h1{font-family:"Bahnschrift","Segoe UI",sans-serif;font-size:73px;line-height:1.06;letter-spacing:-2px;margin:0 0 30px;font-weight:700}h1 em{color:#ffda53;font-style:normal}h2{font-family:"Bahnschrift","Segoe UI",sans-serif}p{margin:0}.step1{animation:rise .8s .3s both}.step2{animation:rise .8s .7s both}.step3{animation:rise .8s 1.1s both}@keyframes rise{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}.setup-grid{display:grid;grid-template-columns:1fr .88fr;gap:55px;margin-top:43px}.folders{display:grid;gap:18px}.folder{border:1px solid #36445c;background:#111d31dd;border-radius:16px;padding:24px;display:flex;align-items:center;gap:24px;min-height:122px;box-shadow:0 10px 35px #0002}.folder-icon{font:700 33px "Bahnschrift";color:#ffda53;border:1px solid #ffda5350;width:65px;height:65px;display:grid;place-items:center;border-radius:13px}.folder b{font-size:32px}.folder p{font-size:20px;color:#aab8ce;margin-top:7px}.tag{margin-left:auto;font-size:13px;color:#83e8e3;letter-spacing:1.5px}.terminal,.command-card{border:1px solid #3a4660;border-radius:18px;background:#070c17;box-shadow:0 20px 70px #0003;overflow:hidden}.terminal-title{display:flex;align-items:center;gap:8px;height:57px;padding:0 25px;background:#152036}.terminal-title i{display:block;width:10px;height:10px;border-radius:50%;background:#4d617c}.terminal-title i:first-child{background:#ffda53}.terminal-title span{font-size:12px;letter-spacing:1.6px;color:#b6c5da;margin-left:12px}.terminal pre{font-family:Consolas,"Courier New",monospace;font-size:27px;line-height:1.8;margin:24px 32px}.muted{color:#7789a5}.prompt{color:#78dbd9}.cursor{color:#ffda53;animation:blink 1.2s step-end infinite}@keyframes blink{50%{opacity:0}}.terminal-foot{border-top:1px solid #1c2b42;padding:17px 30px;color:#7990af;font-size:13px;letter-spacing:1px;display:flex;justify-content:space-between}.terminal-foot b{color:#83e8e3}.command-card{width:100%;margin-top:28px}.command-card code{display:block;font:31px/1.5 Consolas,"Courier New",monospace;padding:24px 33px;color:#ffdf78}.command-card p{font-size:18px;color:#a8b7cd;padding:0 35px 25px}.command-card strong{color:#e7efff}.install-flow{display:flex;align-items:center;gap:22px;margin-top:28px}.install-flow article{flex:1;padding:22px 26px;border-radius:14px;border:1px solid #304158;background:#122036}.install-flow article>span{font-size:17px;color:#ffda53;font-weight:800}.install-flow h2{font-size:24px;letter-spacing:2px;margin:5px 0 9px}.install-flow p{font-size:18px;color:#aabbd3}.flow-arrow{font-size:32px;color:#83e8e3}.cloud-note{display:flex;gap:25px;align-items:center;margin-top:24px;font-size:17px;color:#a9b8d0}.cloud-note b{color:#83e8e3;letter-spacing:2px;font-size:13px}.review-layout{display:grid;grid-template-columns:670px 1fr;gap:90px}.sheet-panel .eyebrow{font-size:15px;letter-spacing:2px;margin-bottom:15px}.sheet-wrap{position:relative;width:620px;height:620px;box-shadow:0 15px 70px #0006;border:1px solid #546570;border-radius:10px;overflow:hidden}.sheet-wrap img{width:100%;height:100%;object-fit:contain}.cell-focus{position:absolute;width:33.333%;height:33.333%;left:0;top:0;border:4px solid #ffda53;box-shadow:inset 0 0 0 2px #12172788;animation:scan 18s step-end infinite}@keyframes scan{0%{left:0;top:0}11%{left:33.333%;top:0}22%{left:66.666%;top:0}33%{left:0;top:33.333%}44%{left:33.333%;top:33.333%}55%{left:66.666%;top:33.333%}66%{left:0;top:66.666%}77%{left:33.333%;top:66.666%}88%{left:66.666%;top:66.666%}}.sheet-label{display:flex;justify-content:space-between;width:620px;margin-top:13px;font-size:12px;letter-spacing:2px;color:#91a5bd}.sheet-label span{color:#ffda53}.review-copy{padding-top:24px}.review-copy h1{font-size:66px;margin-bottom:26px}.metrics{display:flex;gap:58px;margin:20px 0 29px}.metrics>div{display:flex;flex-direction:column;gap:3px}.metrics b{font:700 65px "Bahnschrift";color:#ffda53;line-height:1}.metrics span{font-size:13px;color:#91a5bd;letter-spacing:2px}.bundle-map{background:#101b2e;border:1px solid #34415b;border-radius:13px;padding:23px 27px;font:24px/1.6 Consolas,monospace}.tree-icon{color:#ffda53}.indent{margin-left:18px;color:#87a0bb}.indent strong{font-weight:400;color:#dbe7f9}.indent small{font:15px "Segoe UI";color:#8c9fb6;margin-left:22px}.checks{padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:17px 16px;margin:27px 0;font-size:18px;color:#b7c6db}.checks li:before{content:"✓";color:#83e8e3;margin-right:12px;font-weight:700}.closing{display:grid;grid-template-columns:1fr 630px;height:100%;align-items:center}.closing-copy{position:relative;z-index:3}.closing h1{font-size:81px;white-space:nowrap;letter-spacing:-3px;transform:skew(-4deg);margin-bottom:12px}.closing h1 em{font-size:105px}.closing-subtitle{font-size:20px;color:#ccdcf2;letter-spacing:4px;margin-bottom:38px}.pill-row{display:flex;align-items:center;gap:15px}.pill-row span{border:1px solid #445471;background:#17263d;border-radius:9px;padding:13px 15px;font-size:15px;font-weight:700;letter-spacing:1.4px}.pill-row b{color:#83e8e3;font-size:24px}.closing-detail{font-size:28px;color:#afbdd3;line-height:1.5;margin:33px 0 34px}.repo-link{padding:22px 25px;border-left:4px solid #ffda53;background:#152039bd}.repo-link small{display:block;color:#83e8e3;letter-spacing:2px;font-size:12px;margin-bottom:12px}.repo-link b{font-size:27px;letter-spacing:.2px}.closing-heroes{height:650px;position:relative}.closing-heroes:before{content:"";position:absolute;inset:15% -15%;border-radius:50%;background:radial-gradient(ellipse,#339fc055,transparent 65%)}.hero-art{position:absolute;height:100%;width:72%;object-fit:contain;filter:drop-shadow(0 20px 20px #0006);animation:breathe 6s ease-in-out infinite}.hero-art:first-child{left:-12%;top:17px}.hero-art:last-child{right:-8%;top:-20px;transform:scaleX(-1);animation-delay:-3s}@keyframes breathe{50%{translate:0 -7px}}
  </style></head><body><main>${cardBody(id, bundle, runtime)}</main></body></html>`;
}

async function renderCards({ out = DEFAULT_OUTPUT, game = SOURCE, scene } = {}) {
  const ids = scene ? IDS.filter(id => id === scene) : IDS;
  if (!ids.length) throw new Error(`Unknown card: ${scene}`);
  const destination = path.resolve(out);
  if (!destination.startsWith(path.join(ROOT, 'output/explainer') + path.sep) || directoryTarget(destination) !== destination) throw new Error('Cards must stay within output/explainer/ without junction redirects.');
  const source = verifiedExport(path.resolve(game)).source;
  const bundle = JSON.parse(fs.readFileSync(sourceFile(source, 'sources/assets.json'))), runtime = JSON.parse(fs.readFileSync(sourceFile(source, 'assets/manifest.json')));
  if (runtime.fighters.length !== 2 || runtime.stages.length !== 1) throw new Error('These motion cards require a verified two-fighter, one-arena example.');
  const cards = path.join(destination, 'cards'); fs.mkdirSync(cards, { recursive: true });
  const takes = fs.mkdtempSync(path.join(cards, 'raw-takes-'));
  const previous = scene && fs.existsSync(path.join(cards, 'capture.json')) ? JSON.parse(fs.readFileSync(path.join(cards, 'capture.json'))) : null;
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/asset/')) { const file = sourceFile(source, pathname.slice(7)); response.writeHead(200, { 'Content-Type': 'image/png' }); fs.createReadStream(file).pipe(response); return; }
      const id = pathname.slice(1); if (!IDS.includes(id)) { response.writeHead(404); return response.end(); }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page(id, bundle, runtime));
    } catch (error) { response.writeHead(400); response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: browserPath() });
  const report = { source, width: 1920, height: 1080, fps: 30, duration: 20, generatedWith: 'Original HTML/CSS motion graphics and accepted fictional game art; no model calls', cards: previous?.cards?.filter(card => card.id !== scene) || [] };
  try {
    for (let index = 0; index < ids.length; index += 2) {
      const clips = await Promise.all(ids.slice(index, index + 2).map(async id => {
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: takes, size: { width: 1920, height: 1080 } } });
        const tab = await context.newPage(), errors = []; tab.on('pageerror', error => errors.push(error.message));
        await tab.goto(`http://127.0.0.1:${server.address().port}/${id}`, { waitUntil: 'networkidle' });
        await tab.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
        await tab.waitForTimeout(3000); await tab.screenshot({ path: path.join(cards, `${id}.png`) });
        await tab.waitForTimeout(18000);
        const video = tab.video(); await context.close();
        if (errors.length) throw new Error(errors.join('\n'));
        const raw = await video.path(), output = path.join(cards, `${id}.webm`);
        await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '0.7', '-i', raw, '-t', '20', '-an', '-vf', 'fps=30,scale=1920:1080,setsar=1', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-threads', '4', '-crf', '27', '-b:v', '0', '-y', output]);
        console.log(`Rendered ${id}: 20 seconds, 1920x1080.`);
        return { id, file: output, raw, screenshot: path.join(cards, `${id}.png`) };
      }));
      report.cards.push(...clips);
    }
    report.cards.sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id));
    fs.writeFileSync(path.join(cards, 'capture.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--out', '--scene', '--game'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node build/tools/render-explainer-cards.cjs [--out output/explainer/20261103] [--game verified-export/game] [--scene 03-custom-nodes]');
    options[args[index].slice(2)] = args[index + 1];
  }
  renderCards(options).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { renderCards, cardBody, page, browserPath, command };
