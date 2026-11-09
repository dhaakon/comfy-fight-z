// The teaser's generated opening: one Seedance clip from two stills, through the local ComfyUI. The first frame is the
// real run graph in the ComfyUI editor (the "behind the scenes" view) and the last frame is the game's own title art
// with its logo, so the clip ends exactly on the authentic logo. Three steps, each repeatable:
//   node build/tools/teaser-intro.cjs frames  [--config comfyui/config/teaser.json] [--out output/explainer/<run>] [--run <cast run>] [--comfy-url URL]
//   node build/tools/teaser-intro.cjs prepare ...                     writes intro.api.json and prints the estimate; spends nothing
//   node build/tools/teaser-intro.cjs run --approve-usd <amount> ...  uploads the stills, submits the graph, saves stills/intro-seedance.mp4
// Pricing follows the installed node's own price badge (resolution rate x per-second price, no reference video).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const settings = { config: 'comfyui/config/teaser.json', out: 'output/explainer/teaser-v2-20261109', run: 'output/test-runs/billionaires-brawl-20261108', comfyUrl: 'http://127.0.0.1:8188', approveUsd: null };
const [command, ...rest] = process.argv.slice(2);
for (let i = 0; i < rest.length; i += 2) {
  const key = { '--config': 'config', '--out': 'out', '--run': 'run', '--comfy-url': 'comfyUrl', '--approve-usd': 'approveUsd' }[rest[i]];
  if (!key || !rest[i + 1]) throw new Error('Usage: node build/tools/teaser-intro.cjs frames|prepare|run [--config <json>] [--out <run>] [--run <cast run>] [--comfy-url URL] [--approve-usd <amount>]');
  settings[key] = rest[i + 1];
}
const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, settings.config), 'utf8')), intro = config.intro;
if (!intro || intro.node !== 'ByteDance2FirstLastFrameNode') throw new Error('The storyboard needs an intro block for ByteDance2FirstLastFrameNode.');
const OUT = path.resolve(ROOT, settings.out), STILLS = path.join(OUT, 'stills');
const server = settings.comfyUrl.replace(/\/$/, '');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const now = () => new Date().toISOString();

// Seedance 2.0 without a reference video, from the node's price badge: duration x resolution rate x per-second price.
const RATES = { '4k': [195200, 0.00572], '1080p': [48800, 0.011011], '720p': [21600, 0.01001], '480p': [10044, 0.01001] };
function estimate() {
  const [rate, price] = RATES[intro.resolution] || [];
  if (!rate || intro.model !== 'Seedance 2.0' || !(intro.seconds >= 4 && intro.seconds <= 15)) throw new Error('The intro estimate covers Seedance 2.0 at 480p-4k for 4-15 seconds.');
  return Number((intro.seconds * rate * price / 1000).toFixed(6));
}

// The first frame: the run graph in the ComfyUI editor, read-only, at its wide framing. The last frame: the title
// ensemble under the logo, placed as the game's own title screen places it.
async function frames() {
  fs.mkdirSync(STILLS, { recursive: true });
  const { chromium } = require('playwright'), { browserLaunchOptions } = require('./build-bundle.cjs');
  const graph = read(path.resolve(ROOT, settings.run, 'workflow.json'));
  for (const node of graph.nodes) if (node.type === 'CFZProjectSettings') { node.widgets_values[0] = 'C:/comfy-fighter-z/output/test-runs/billionaires-brawl/bundle'; if (node.widgets_values_named) node.widgets_values_named.root_directory = node.widgets_values[0]; }
  if (/C:[\\/]Users[\\/]/i.test(JSON.stringify(graph))) throw new Error('The run graph still carries a personal path.');
  const browser = await chromium.launch(browserLaunchOptions(['--mute-audio']));
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }), page = await context.newPage();
    await context.route('**/*', route => { const request = route.request(), url = new URL(request.url()); if (url.origin === new URL(server).origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); return route.continue(); });
    await page.goto(server, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.comfyAPI?.app?.app?.canvas?.canvas, null, { timeout: 60000 });
    await page.evaluate(async graph => window.comfyAPI.app.app.loadGraphData(graph, true, true), graph);
    await page.waitForTimeout(2500);
    if (await page.getByRole('button', { name: 'NO FAVORITED INPUTS', exact: true }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Toggle properties panel', exact: true }).click().catch(() => {});
    const minimap = page.getByRole('button', { name: 'Hide Minimap (ALT + SHIFT + M)', exact: true }); if (await minimap.isVisible().catch(() => false)) await minimap.click().catch(() => {});
    await page.addStyleTag({ content: '.graph-canvas-container, #graph-canvas-container, .litegraph, #graph-canvas { background-image: none !important; background-color: #16181d !important; }' });
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('body *')) { const style = getComputedStyle(element); if (style.backgroundImage.includes('url(') && element.getBoundingClientRect().width > 600) element.style.setProperty('background-image', 'none', 'important'); }
      const app = window.comfyAPI.app.app; if (app.canvas) { app.canvas.background_image = null; app.canvas.clear_background = true; }
      const heading = [...document.querySelectorAll('*')].find(element => element.childElementCount === 0 && element.textContent.trim() === 'Job Queue');
      let panel = heading; while (panel && panel.parentElement && panel.getBoundingClientRect().height < 400) panel = panel.parentElement; if (panel) panel.style.setProperty('display', 'none', 'important');
      // Frame the graph's upper band (the project node, the first factories and the sprite-sheet grid) so it fills the
      // screen: the clip's camera pushes into this.
      const nodes = app.graph._nodes, top = Math.min(...nodes.map(n => n.pos[1])), band = nodes.filter(n => n.pos[1] < top + 1100);
      const x = Math.min(...band.map(n => n.pos[0])), y = Math.min(...band.map(n => n.pos[1])), x2 = Math.max(...band.map(n => n.pos[0] + n.size[0])), y2 = Math.max(...band.map(n => n.pos[1] + n.size[1]));
      const rect = app.canvas.canvas.getBoundingClientRect(), scale = Math.min((rect.width - 160) / (x2 - x), (rect.height - 200) / (y2 - y), .6);
      app.canvas.ds.scale = scale; app.canvas.ds.offset = [(rect.width / scale - (x2 - x)) / 2 - x + 30, (rect.height / scale - (y2 - y)) / 2 - y + 30]; app.canvas.setDirty(true, true);
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(STILLS, 'intro-first.png') });
  } finally { await browser.close(); }
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const art = await loadImage(path.join(ROOT, 'build/public/arcade/title-ensemble.webp')), logo = await loadImage(path.join(ROOT, 'build/public/arcade/title-logo.webp'));
  const canvas = createCanvas(1920, 1080), g = canvas.getContext('2d');
  const s = Math.max(1920 / art.width, 1080 / art.height); g.drawImage(art, (1920 - art.width * s) / 2, (1080 - art.height * s) / 2, art.width * s, art.height * s);
  const shade = g.createLinearGradient(0, 400, 0, 1080); shade.addColorStop(0, 'rgba(17,21,24,0)'); shade.addColorStop(1, 'rgba(17,21,24,.82)'); g.fillStyle = shade; g.fillRect(0, 400, 1920, 680);
  const logoWidth = 860, logoHeight = logoWidth * logo.height / logo.width; g.drawImage(logo, (1920 - logoWidth) / 2, 690 - logoHeight / 2, logoWidth, logoHeight);
  fs.writeFileSync(path.join(STILLS, 'intro-last.png'), canvas.toBuffer('image/png'));
  console.log(`Stills: ${path.relative(ROOT, STILLS)}/intro-first.png (the run graph) and intro-last.png (title art + logo). Nothing submitted.`);
}

function graphFor(first, last) {
  const inputs = { model: intro.model, 'model.prompt': intro.prompt, 'model.resolution': intro.resolution, 'model.ratio': intro.ratio, 'model.duration': Number(intro.seconds), 'model.generate_audio': false,
    seed: Number(config.voice?.seed || 1) % 2147483648, watermark: false, first_frame: ['first', 0], last_frame: ['last', 0] };
  return {
    first: { class_type: 'LoadImage', inputs: { image: first }, _meta: { title: 'Intro first frame | the run graph' } },
    last: { class_type: 'LoadImage', inputs: { image: last }, _meta: { title: 'Intro last frame | title art + logo' } },
    intro: { class_type: intro.node, inputs, _meta: { title: `Teaser intro | ${intro.model} ${intro.resolution} ${intro.seconds} s` } },
    // SaveVideo's format and codec are dynamic combos: the option and its sub-input both go in, as flat dotted keys.
    save: { class_type: 'SaveVideo', inputs: { video: ['intro', 0], filename_prefix: `comfy-fighter-z/explainer/${path.basename(OUT)}/intro`, format: 'auto', 'format.codec': 'auto', codec: 'auto' }, _meta: { title: 'Save the intro clip' } }
  };
}

function prepare() {
  for (const still of ['intro-first.png', 'intro-last.png']) if (!fs.existsSync(path.join(STILLS, still))) throw new Error(`Run the frames step first: ${still} is missing.`);
  const plan = { schema: 'comfy-fighter-teaser-intro-plan/v1', preparedAt: now(), model: intro.model, node: intro.node, resolution: intro.resolution, ratio: intro.ratio, seconds: intro.seconds, estimatedUSD: estimate(), submitted: false,
    estimateSource: 'ByteDance2FirstLastFrameNode price badge: seconds x resolution rate x per-second price (no reference video).', prompt: intro.prompt, firstFrame: 'stills/intro-first.png', lastFrame: 'stills/intro-last.png', clip: intro.clip };
  fs.writeFileSync(path.join(OUT, 'intro.api.json'), JSON.stringify(graphFor('intro-first.png', 'intro-last.png'), null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'intro-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ estimatedUSD: plan.estimatedUSD, seconds: intro.seconds, resolution: intro.resolution, graph: path.relative(ROOT, path.join(OUT, 'intro.api.json')), submitted: false }, null, 2));
  return plan;
}

async function upload(file) {
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file)); form.append('subfolder', 'cfz-teaser'); form.append('overwrite', 'true');
  const response = await fetch(`${server}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`ComfyUI refused the upload (${response.status}).`);
  const info = await response.json(); return `${info.subfolder ? info.subfolder + '/' : ''}${info.name}`;
}

// The account's API key, from the repository's ignored .env (COMFYUI=...) or the environment. A multi-minute partner
// render polled with the server's stored login token can lose that token mid-way ("Unauthorized: Please login first")
// and still be billed; a key attached to the prompt does not expire.
function apiKey() {
  if (process.env.COMFYUI) return process.env.COMFYUI.trim();
  const env = path.join(ROOT, '.env');
  if (fs.existsSync(env)) { const match = /^COMFYUI=(.+)$/m.exec(fs.readFileSync(env, 'utf8')); if (match) return match[1].trim().replace(/^["']|["']$/g, ''); }
  return null;
}
async function wait(server, promptId, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const history = await (await fetch(`${server}/history/${promptId}`)).json(), entry = history[promptId];
    if (entry?.status?.completed || entry?.status?.status_str === 'error') return entry;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the intro render.');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
async function run() {
  const plan = prepare(), approved = Number(settings.approveUsd);
  if (!Number.isFinite(approved) || approved < plan.estimatedUSD) throw new Error(`The intro clip costs about $${plan.estimatedUSD}; pass --approve-usd ${Math.ceil(plan.estimatedUSD * 100) / 100} (or more) once authorized.`);
  const info = await (await fetch(`${server}/object_info/${intro.node}`)).json();
  if (!info[intro.node]) throw new Error(`The running ComfyUI lacks ${intro.node}.`);
  const key = apiKey();
  if (!key) throw new Error('No ComfyUI API key: set COMFYUI in .env or the environment, so the render cannot lose its login mid-way.');
  const first = await upload(path.join(STILLS, 'intro-first.png')), last = await upload(path.join(STILLS, 'intro-last.png'));
  const graph = graphFor(first, last), file = path.join(OUT, 'intro.api.json'); fs.writeFileSync(file, JSON.stringify(graph, null, 2) + '\n');
  plan.submittedAt = now(); plan.approvedUSD = approved; plan.submitted = true; plan.auth = 'api key attached to the prompt'; fs.writeFileSync(path.join(OUT, 'intro-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(`Submitting the ${intro.seconds} s ${intro.model} intro (about $${plan.estimatedUSD})…`);
  const response = await fetch(`${server}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: `teaser-intro-${Date.now()}`, extra_data: { api_key_comfy_org: key } }) });
  if (!response.ok) throw new Error(`ComfyUI refused the prompt (${response.status}): ${(await response.text()).slice(0, 600)}`);
  const promptId = (await response.json()).prompt_id;
  plan.promptId = promptId; fs.writeFileSync(path.join(OUT, 'intro-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  const entry = await wait(server, promptId, 40 * 60000), failure = entry.status?.status_str === 'error';
  plan.ok = !failure;
  if (failure) {
    const message = JSON.stringify(entry.status?.messages || []).match(/"exception_message":\s*"((?:[^"\\]|\\.)*)"/);
    fs.writeFileSync(path.join(OUT, 'intro-plan.json'), JSON.stringify(plan, null, 2) + '\n'); throw new Error(`The intro failed: ${message ? message[1] : 'see the server history'}`);
  }
  // The saved clip is in ComfyUI's output folder under the prefix; fetch it through the server.
  const outputs = entry.outputs || {};
  const saved = Object.values(outputs).flatMap(output => [...(output.images || []), ...(output.gifs || []), ...(output.video || []), ...(output.videos || [])]).find(item => /\.mp4$/i.test(item.filename));
  if (!saved) throw new Error('The run finished but no MP4 output was recorded in its history.');
  const url = `${server}/view?filename=${encodeURIComponent(saved.filename)}&subfolder=${encodeURIComponent(saved.subfolder || '')}&type=${encodeURIComponent(saved.type || 'output')}`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer()), clip = path.join(OUT, intro.clip);
  fs.mkdirSync(path.dirname(clip), { recursive: true }); fs.writeFileSync(clip, bytes);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-show_entries', 'format=duration', '-of', 'json', clip], { encoding: 'utf8', windowsHide: true });
  const facts = probe.status === 0 ? JSON.parse(probe.stdout) : null;
  Object.assign(plan, { clip: intro.clip, bytes: bytes.length, width: facts?.streams?.[0]?.width, height: facts?.streams?.[0]?.height, duration: Number(facts?.format?.duration) });
  fs.writeFileSync(path.join(OUT, 'intro-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(`Saved ${path.relative(ROOT, clip)}: ${plan.width}x${plan.height}, ${plan.duration?.toFixed(2)} s, ${(bytes.length / 1e6).toFixed(1)} MB. Review it (comfy preview), then capture scene 01-intro.`);
}

({ frames, prepare, run }[command] || (() => { throw new Error('First argument: frames, prepare or run.'); }))();
