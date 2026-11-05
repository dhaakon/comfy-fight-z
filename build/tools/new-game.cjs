// The new-game pipeline, one command per step so a person or an agent can reproduce a whole game from a cast file:
//   node build/tools/new-game.cjs prepare --cast comfyui/casts/<name>.json --out output/test-runs/<fresh-name> [--seed 42] [--no-media] [--no-audio]
//   node build/tools/new-game.cjs run     --run output/test-runs/<name> --approve-usd <amount> [--server http://127.0.0.1:8188] [--resume]
//   node build/tools/new-game.cjs review  --run output/test-runs/<name>
//   node build/tools/new-game.cjs reroll  --run output/test-runs/<name> --node <id or title> --approve-usd <amount>
//   node build/tools/new-game.cjs export  --run output/test-runs/<name> [--out output/exports/<name>]
//   node build/tools/new-game.cjs install --run output/test-runs/<name> [--slot <id>]
//   node build/tools/new-game.cjs status  --run output/test-runs/<name>
// Every step records itself in <run>/pipeline.json. Only `run` spends cloud credits, and only with an explicit
// --approve-usd at or above the prepared estimate. See comfyui/docs/new-game-runbook.md.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const SHEETS = ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE'];
const SLOT = /^[a-z0-9][a-z0-9-]{1,31}$/;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const now = () => new Date().toISOString();

function parse(argv) {
  const [command, ...rest] = argv, options = {};
  const valued = ['--cast', '--out', '--seed', '--run', '--approve-usd', '--server', '--slot', '--node'];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--no-media') options.media = false;
    else if (rest[i] === '--no-audio') options.audio = false;
    else if (rest[i] === '--resume') options.resume = true;
    else if (valued.includes(rest[i]) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) options[rest[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[++i];
    else throw new Error(`Unknown argument ${rest[i]}. ${USAGE}`);
  }
  return { command, options };
}
const USAGE = 'Usage: node build/tools/new-game.cjs <prepare|run|review|reroll|export|install|status> ... (see the header of this file).';

function runDirectory(options) {
  if (!options.run) throw new Error('Supply --run output/test-runs/<name>.');
  const directory = path.resolve(ROOT, options.run), runs = path.join(ROOT, 'output/test-runs') + path.sep;
  if (!directory.startsWith(runs) || !fs.existsSync(path.join(directory, 'plan.json'))) throw new Error('--run must name a prepared run under output/test-runs/.');
  return directory;
}
function pipeline(run) { const file = path.join(run, 'pipeline.json'); return fs.existsSync(file) ? read(file) : { schema: 'comfy-fighter-pipeline/v1', run: path.relative(ROOT, run), steps: {} }; }
function record(run, step, value) {
  const state = pipeline(run); state.steps[step] = { at: now(), ...value };
  fs.writeFileSync(path.join(run, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  return state;
}
function node(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env, ...extraEnv } });
  if (result.error) throw result.error;
  return result.status;
}

function prepare(options) {
  const { prepare: prepareCast } = require('../../comfyui/tools/prepare-cast-run.cjs');
  if (!options.cast || !options.out) throw new Error('prepare needs --cast comfyui/casts/<name>.json and --out output/test-runs/<fresh-name>.');
  const { directory, plan } = prepareCast({ cast: options.cast, out: options.out, seed: options.seed ?? 42, media: options.media !== false, audio: options.audio !== false });
  const cast = read(path.join(directory, 'cast.json'));
  const state = pipeline(directory); state.cast = { file: options.cast, id: cast.id || null, title: cast.title, subtitle: cast.subtitle || '', fighters: plan.fighters, stages: plan.stages };
  fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  record(directory, 'prepared', { estimatedUSD: plan.total.estimatedUSD, images: plan.images.paidImages, clips: plan.videos?.clips || 0, audio: plan.audio?.clips || 0, seed: Number(options.seed ?? 42) });
  console.log(`Prepared ${plan.title}${plan.subtitle ? ' / ' + plan.subtitle : ''}: ${plan.fighters.length} fighters, ${plan.stages.length} arena(s).`);
  console.log(`  images ${plan.images.paidImages} ($${plan.images.estimatedUSD})` + (plan.videos ? `, clips ${plan.videos.clips} / ${plan.videos.seconds} s ($${plan.videos.estimatedUSD})` : '') + (plan.audio ? `, audio ${plan.audio.clips} ($${plan.audio.estimatedUSD})` : ''));
  console.log(`  estimated total $${plan.total.estimatedUSD} — nothing submitted. Next: node build/tools/new-game.cjs run --run ${path.relative(ROOT, directory).replace(/\\/g, '/')} --approve-usd ${Math.ceil(plan.total.estimatedUSD * 100) / 100}`);
  return { directory, plan };
}

async function missingNodes(workflow, server) {
  const response = await fetch(`${server}/object_info`);
  if (!response.ok) throw new Error(`ComfyUI answered ${response.status} at ${server}/object_info.`);
  const info = await response.json(), classes = [...new Set(Object.values(workflow).map(item => item.class_type))];
  return classes.filter(type => !Object.hasOwn(info, type));
}

async function run(options) {
  const directory = runDirectory(options), plan = read(path.join(directory, 'plan.json')), state = pipeline(directory);
  const approved = Number(options.approveUsd);
  if (!Number.isFinite(approved) || approved < plan.total.estimatedUSD) throw new Error(`This run is estimated at $${plan.total.estimatedUSD}; pass --approve-usd ${Math.ceil(plan.total.estimatedUSD * 100) / 100} (or more) only after the spend is authorized.`);
  if (state.steps.ran && !options.resume) throw new Error('This run already executed; pass --resume to let the sequential runner continue from its cache, or prepare a fresh run.');
  const server = (options.server || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const missing = await missingNodes(read(path.join(directory, 'workflow.api.json')), server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}. Run node comfyui/tools/install-comfy-nodes.cjs --base-directory <ComfyUI base folder> (or --comfy-root), restart ComfyUI, then retry.`);
  record(directory, 'approved', { usd: approved, estimatedUSD: plan.total.estimatedUSD, server });
  console.log(`Approved $${approved} against an estimate of $${plan.total.estimatedUSD}; submitting one paid node at a time to ${server}.`);
  const status = node([path.join(ROOT, 'comfyui/tools/run-sequential.cjs'), '--workflow', path.join(directory, 'workflow.api.json'), '--server', server]);
  const bundle = path.join(directory, 'bundle');
  const produced = ['assets.json', 'audio.json', 'video.json'].filter(name => fs.existsSync(path.join(bundle, name)));
  const expected = ['assets.json', ...(plan.audio ? ['audio.json'] : []), ...(plan.videos ? ['video.json'] : [])];
  const complete = status === 0 && expected.every(name => produced.includes(name));
  record(directory, 'ran', { exitCode: status, complete, manifests: produced });
  if (!complete) throw new Error(`The run did not finish (exit ${status}; bundle has ${produced.join(', ') || 'no manifests'}). Fix the cause and rerun with --resume; cached nodes are not billed again.`);
  console.log(`Generation complete: ${path.relative(ROOT, bundle)} holds ${expected.join(', ')}. Next: node build/tools/new-game.cjs review --run ${path.relative(ROOT, directory).replace(/\\/g, '/')}`);
}

// Contact sheets an agent can read: every cel of every fighter at the idle height, labelled with its size ratio,
// plus a JSON report of measurable problems (unsegmentable sheets, cells touching an edge, off-scale upright poses).
async function review(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle');
  if (!fs.existsSync(path.join(bundle, 'assets.json'))) throw new Error('No bundle/assets.json yet; run the generation first.');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const { segmentSheet, UPRIGHT_POSES } = await import('../public/builder/sheet-layout.mjs');
  const assets = read(path.join(bundle, 'assets.json')), out = path.join(directory, 'review');
  fs.mkdirSync(out, { recursive: true });
  const report = { schema: 'comfy-fighter-review/v1', generatedAt: now(), fighters: {}, flags: [], images: [], videos: [], audio: null };
  for (const fighter of assets.game.fighters) {
    const sheets = assets.assets.filter(asset => asset.kind === 'sprites' && asset.fighter === fighter.id).sort((a, b) => SHEETS.indexOf(a.sheet) - SHEETS.indexOf(b.sheet));
    const cells = [];
    for (const sheet of sheets) {
      const image = await loadImage(path.join(bundle, sheet.src)), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      let boxes;
      try { boxes = segmentSheet(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height); }
      catch (error) { report.flags.push({ fighter: fighter.id, sheet: sheet.sheet, issue: error.message }); continue; }
      sheet.poses.forEach((pose, i) => cells.push({ pose, sheet: sheet.sheet, image, box: boxes[i], width: image.width, height: image.height }));
    }
    const idle = cells.find(cell => cell.pose === 'idle'), size = 150, perRow = 9, rows = Math.ceil(cells.length / perRow);
    const canvas = createCanvas(perRow * size, Math.max(1, rows) * (size + 22)), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2b2b33'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const poses = {};
    cells.forEach((cell, index) => {
      const ratio = idle ? cell.box.height / idle.box.height : 1, x = (index % perRow) * size, y = Math.floor(index / perRow) * (size + 22);
      const flags = [];
      if (UPRIGHT_POSES.has(cell.pose) && (ratio < .85 || ratio > 1.15)) flags.push(`upright pose is ${ratio.toFixed(2)}x the idle height`);
      if (cell.box.x <= 1 || cell.box.y <= 1 || cell.box.x + cell.box.width >= cell.width - 1 || cell.box.y + cell.box.height >= cell.height - 1) flags.push('silhouette touches the sheet edge (likely cropped)');
      poses[cell.pose] = { sheet: cell.sheet, width: cell.box.width, height: cell.box.height, ratio: Number(ratio.toFixed(3)), flags };
      for (const issue of flags) report.flags.push({ fighter: fighter.id, pose: cell.pose, sheet: cell.sheet, issue });
      const scale = Math.min((idle ? 118 / idle.box.height : 118 / cell.box.height), (size - 8) / cell.box.width, (size - 8) / cell.box.height);
      ctx.strokeStyle = flags.length ? '#ff5a5a' : '#4a4a58'; ctx.lineWidth = flags.length ? 3 : 1; ctx.strokeRect(x + 1, y + 21, size - 2, size - 2);
      ctx.fillStyle = '#6f8f5a'; ctx.fillRect(x, y + 21 + size - 14, size, 1);
      const w = cell.box.width * scale, h = cell.box.height * scale;
      ctx.drawImage(cell.image, cell.box.x, cell.box.y, cell.box.width, cell.box.height, x + (size - w) / 2, y + 21 + size - 14 - h, w, h);
      ctx.fillStyle = flags.length ? '#ff9a9a' : '#ffe9a8'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(`${cell.pose} ${ratio.toFixed(2)}`, x + 3, y + 15);
    });
    const file = path.join(out, `${fighter.id}.png`); fs.writeFileSync(file, canvas.toBuffer('image/png'));
    report.fighters[fighter.id] = { name: fighter.name, grid: path.relative(directory, file).replace(/\\/g, '/'), cells: cells.length, poses };
  }
  report.images = assets.assets.filter(asset => asset.kind !== 'sprites').map(asset => ({ id: asset.id, kind: asset.kind, src: asset.src, width: asset.width, height: asset.height }));
  if (fs.existsSync(path.join(bundle, 'video.json'))) {
    const video = read(path.join(bundle, 'video.json'));
    report.videos = [video.titleVideo, video.selectVideo, video.openingVideo, ...(video.fighterIntros || []), ...(video.selectIdles || [])].filter(Boolean).map(clip => ({ id: clip.id, src: clip.src, duration: clip.duration }));
  }
  if (fs.existsSync(path.join(bundle, 'audio.json'))) {
    const audio = read(path.join(bundle, 'audio.json')), by = {};
    for (const clip of audio.assets) by[clip.category] = (by[clip.category] || 0) + 1;
    report.audio = by;
  }
  fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify(report, null, 2) + '\n');
  const checklist = ['# Review checklist', '', `Grids: ${Object.values(report.fighters).map(f => f.grid).join(', ')}`, '',
    'Look at every grid and every other image before exporting:', '- every cel faces RIGHT (the game mirrors the sprite for the left side);',
    '- costume, colors, hair and build match the identity across all five sheets;', '- no text, labels, grid lines, props or extra figures inside cells;',
    '- red cells are flagged below; a re-roll is one node (see the runbook);', '- portraits, hero art, cut-ins, endings, the arena and the interface images are clean and on theme;',
    '- clips loop or end cleanly and show the right fighter.', '', `Flags (${report.flags.length}):`, ...report.flags.map(flag => `- ${flag.fighter}${flag.pose ? ' ' + flag.pose : ''} (${flag.sheet}): ${flag.issue}`), ''];
  fs.writeFileSync(path.join(out, 'README.md'), checklist.join('\n'));
  record(directory, 'reviewed', { grids: Object.keys(report.fighters).length, flags: report.flags.length, folder: path.relative(ROOT, out).replace(/\\/g, '/') });
  console.log(`Review material in ${path.relative(ROOT, out)}: ${Object.keys(report.fighters).length} grids, ${report.flags.length} flagged cell(s). Read review/README.md, then export.`);
  return report;
}

function exportGame(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle');
  if (!fs.existsSync(path.join(bundle, 'assets.json'))) throw new Error('No bundle/assets.json yet; run the generation first.');
  const out = path.resolve(ROOT, options.out || path.join('output/exports', path.basename(directory)));
  if (!out.startsWith(path.join(ROOT, 'output/exports') + path.sep)) throw new Error('--out must be a fresh folder under output/exports/.');
  if (fs.existsSync(out)) throw new Error(`${path.relative(ROOT, out)} exists; exports are never overwritten.`);
  const status = node([path.join(ROOT, 'build/tools/build-bundle.cjs'), '--bundle', bundle, '--out', out]);
  const receiptFile = path.join(out, 'build-test.json'), receipt = fs.existsSync(receiptFile) ? read(receiptFile) : null;
  record(directory, 'exported', { exitCode: status, out: path.relative(ROOT, out).replace(/\\/g, '/'), status: receipt?.status || 'missing', checks: receipt?.checks?.length || 0 });
  if (status !== 0 || receipt?.status !== 'passed') throw new Error(`Strict export failed (exit ${status}, ${receipt?.status || 'no receipt'}). Fix the bundle (re-roll or review) and export to a fresh folder.`);
  console.log(`Export passed: ${path.relative(ROOT, out)}. Next: node build/tools/new-game.cjs install --run ${path.relative(ROOT, directory).replace(/\\/g, '/')} --slot <id>`);
}

function install(options) {
  const directory = runDirectory(options), state = pipeline(directory);
  if (!state.steps.exported?.out) throw new Error('Export the run first.');
  const slot = options.slot ?? state.cast?.id ?? null;
  if (slot !== null && !SLOT.test(slot)) throw new Error('Slot ids use 2-32 lowercase letters, digits or dashes.');
  const game = path.join(ROOT, state.steps.exported.out, 'game');
  const status = node([path.join(ROOT, 'build/tools/install-game.cjs'), '--game', game, ...(slot ? ['--slot', slot] : [])]);
  record(directory, 'installed', { exitCode: status, slot, game: path.relative(ROOT, game).replace(/\\/g, '/') });
  if (status !== 0) throw new Error('Installation failed.');
  console.log(slot ? `Installed at /${slot}/. Run npm start and open GAME SELECT on any title screen.` : 'Installed as the main game. Run npm start.');
}

function status(options) {
  const directory = runDirectory(options), state = pipeline(directory);
  console.log(JSON.stringify(state, null, 2));
}

// What one re-rolled node costs: the node itself plus every paid node downstream of it (sheets B-E follow sheet A,
// the ensemble and the menu loop follow any fighter). Rates are list prices from the cast plan.
const RATES = { image1K: .048048, image2K: .072072, videoSecond720p: .1287 };
const REROLL = {
  CFZSpriteSheet: () => RATES.image2K,
  CFZCharacterFactory: () => 6 * RATES.image1K,
  CFZEnvironmentFactory: () => 2 * RATES.image2K,
  CFZSharedArtFactory: () => 6 * RATES.image1K + RATES.image2K,
  CFZTitleArt: () => RATES.image2K,
  CFZTitleVideo: node => Number(node.inputs.duration || 8) * RATES.videoSecond720p,
  CFZSelectVideo: node => Number(node.inputs.duration || 8) * RATES.videoSecond720p,
  CFZSelectIdleVideo: node => RATES.image1K + Number(node.inputs.duration || 6) * RATES.videoSecond720p,
  CFZIntroVideo: node => RATES.image1K + Number(node.inputs.duration || 4) * RATES.videoSecond720p
};
function rerollPlan(workflow, target) {
  const id = workflow[target] ? target : Object.keys(workflow).find(key => workflow[key]._meta?.title === target);
  if (!id) throw new Error('--node must be a node id or the exact title of a node in workflow.api.json.');
  if (!REROLL[workflow[id].class_type]) throw new Error(`${workflow[id].class_type} cannot be re-rolled; choose one of ${Object.keys(REROLL).join(', ')}.`);
  const consumers = key => Object.keys(workflow).filter(other => Object.values(workflow[other].inputs || {}).some(value => Array.isArray(value) && value[0] === key));
  const affected = new Set([id]);
  for (const key of affected) for (const child of consumers(key)) affected.add(child);
  const paid = [...affected].filter(key => REROLL[workflow[key].class_type]);
  const estimatedUSD = Number(paid.reduce((sum, key) => sum + REROLL[workflow[key].class_type](workflow[key]), 0).toFixed(6));
  return { id, title: workflow[id]._meta?.title || workflow[id].class_type, paid, estimatedUSD };
}

async function reroll(options) {
  const directory = runDirectory(options), file = path.join(directory, 'workflow.api.json'), workflow = read(file);
  if (!options.node) throw new Error('Supply --node <id or exact title> from workflow.api.json.');
  const planned = rerollPlan(workflow, options.node), approved = Number(options.approveUsd);
  if (!Number.isFinite(approved) || approved < planned.estimatedUSD) throw new Error(`Re-rolling "${planned.title}" redraws ${planned.paid.length} paid node(s) for about $${planned.estimatedUSD}; pass --approve-usd ${Math.ceil(planned.estimatedUSD * 100) / 100} (or more) once authorized.`);
  const server = (options.server || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const missing = await missingNodes(workflow, server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}; install the node pack and restart it.`);
  const { submit, outcome } = require('../../comfyui/tools/run-sequential.cjs');
  const node = workflow[planned.id]; node.inputs.reroll = (Number(node.inputs.reroll) || 0) + 1;
  fs.writeFileSync(file, JSON.stringify(workflow, null, 2) + '\n');
  const state = pipeline(directory); state.rerolls = [...(state.rerolls || []), { at: now(), node: planned.id, title: planned.title, reroll: node.inputs.reroll, affected: planned.paid, estimatedUSD: planned.estimatedUSD, approvedUSD: approved }];
  fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Re-rolling "${planned.title}" (reroll ${node.inputs.reroll}); ${planned.paid.length} paid node(s) will redraw, everything else comes from the cache.`);
  const promptId = submit(file), result = await outcome(server, promptId, 30 * 60000);
  const entry = state.rerolls[state.rerolls.length - 1]; entry.promptId = promptId; entry.ok = result.ok; entry.executed = Object.keys(workflow).filter(key => REROLL[workflow[key].class_type] && !result.cached.includes(key));
  fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  if (!result.ok) throw new Error(`Re-roll failed: ${result.error?.exception_type || ''}: ${result.error?.exception_message || 'unknown error'}`);
  console.log(`Re-roll complete (${promptId}); paid nodes executed: ${entry.executed.join(', ') || 'none'}. Review again, then export to a fresh folder.`);
}

async function main(argv) {
  const { command, options } = parse(argv);
  const commands = { prepare, run, reroll, review, export: exportGame, install, status };
  if (!commands[command]) throw new Error(USAGE);
  await commands[command](options);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, prepare, run, review, reroll, rerollPlan, exportGame, install, pipeline, missingNodes };
