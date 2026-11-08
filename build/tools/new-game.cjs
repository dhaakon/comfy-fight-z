// The new-game pipeline, one command per step so a person or an agent can reproduce a whole game from a cast file:
//   node build/tools/new-game.cjs prepare --cast comfyui/casts/<name>.json --out output/test-runs/<fresh-name> [--seed 42] [--no-media] [--no-audio]
//   node build/tools/new-game.cjs run     --run output/test-runs/<name> --approve-usd <amount> [--server http://127.0.0.1:8188] [--resume]
//   node build/tools/new-game.cjs review  --run output/test-runs/<name>
//   node build/tools/new-game.cjs reroll  --run output/test-runs/<name> --node <id or title> --approve-usd <amount>
//   node build/tools/new-game.cjs reroll-art --run output/test-runs/<name> --asset <fighter>_<portrait|hero|cutin|ending|intro|idle>|title_video|select_video --approve-usd <amount> [--video-model <name>] [--video-resolution 720p|1080p]
//   node build/tools/new-game.cjs add-sheets --run output/test-runs/<name> --approve-usd <amount> [--sheets sheetF,sheetG] [--fighters a,b] [--reference-sheet sheetF]
//     (--reference-sheet picks the accepted sheet sent as the style reference, default sheet A; use a clean one when sheet A has an extra figure)
//   node build/tools/new-game.cjs export  --run output/test-runs/<name> [--out output/exports/<name>]
//   node build/tools/new-game.cjs install --run output/test-runs/<name> [--slot <id>]
//   node build/tools/new-game.cjs status  --run output/test-runs/<name>
// Every step records itself in <run>/pipeline.json. Only `run` spends cloud credits, and only with an explicit
// --approve-usd at or above the prepared estimate. See comfyui/docs/new-game-runbook.md.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const SHEETS = ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE', 'sheetF', 'sheetG', 'sheetH', 'sheetI'];
const SLOT = /^[a-z0-9][a-z0-9-]{1,31}$/;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const now = () => new Date().toISOString();

function parse(argv) {
  const [command, ...rest] = argv, options = {};
  const valued = ['--cast', '--out', '--seed', '--run', '--approve-usd', '--server', '--slot', '--node', '--asset', '--video-model', '--video-resolution', '--sheets', '--fighters', '--reference-sheet', '--stages', '--direction', '--elements', '--director-model', '--reroll'];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--no-media') options.media = false;
    else if (rest[i] === '--no-audio') options.audio = false;
    else if (rest[i] === '--resume') options.resume = true;
    else if (valued.includes(rest[i]) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) options[rest[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[++i];
    else throw new Error(`Unknown argument ${rest[i]}. ${USAGE}`);
  }
  return { command, options };
}
const USAGE = 'Usage: node build/tools/new-game.cjs <prepare|run|review|reroll|reroll-art|add-sheets|add-scenery|export|install|status> ... (see the header of this file).';

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
  const { keyGreen } = require('./lib/assets.cjs');
  const { segmentSheet, UPRIGHT_POSES } = await import('../public/builder/sheet-layout.mjs');
  const assets = read(path.join(bundle, 'assets.json')), out = path.join(directory, 'review');
  fs.mkdirSync(out, { recursive: true });
  const report = { schema: 'comfy-fighter-review/v1', generatedAt: now(), fighters: {}, flags: [], images: [], videos: [], audio: null };
  for (const fighter of assets.game.fighters) {
    const sheets = assets.assets.filter(asset => asset.kind === 'sprites' && asset.fighter === fighter.id).sort((a, b) => SHEETS.indexOf(a.sheet) - SHEETS.indexOf(b.sheet));
    const cells = [];
    for (const sheet of sheets) {
      // Generated sheets are chroma green; key it out the way the builder does before measuring silhouettes.
      const image = await loadImage(path.join(bundle, sheet.src)), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0); if (sheet.key !== false) keyGreen(canvas);
      let boxes;
      try { boxes = segmentSheet(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height, { picks: sheet.poses.map(pose => sheet.figures?.[pose] || null) }); }
      catch (error) { report.flags.push({ fighter: fighter.id, sheet: sheet.sheet, issue: error.message }); continue; }
      sheet.poses.forEach((pose, i) => cells.push({ pose, sheet: sheet.sheet, image: canvas, box: boxes[i], width: image.width, height: image.height }));
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
const RATES = { image1K: .048048, image2K: .072072 };
const { VIDEO_RATES } = require('../../comfyui/tools/prepare-factory-workflows.cjs');
function videoSettings(workflow, overrides = {}) {
  const project = Object.values(workflow).find(node => node.class_type === 'CFZProjectSettings')?.inputs || {};
  const model = overrides.videoModel || project.video_model || 'LTX-2.5 (Fast)', resolution = overrides.videoResolution || project.video_resolution || '720p', rate = VIDEO_RATES[model]?.[resolution];
  if (!rate) throw new Error(`Unsupported video model or resolution: ${model} ${resolution} (models: ${Object.keys(VIDEO_RATES).join(', ')}; resolutions: 720p, 1080p).`);
  return { model, resolution, rate };
}
const REROLL = {
  CFZSpriteSheet: () => RATES.image2K,
  CFZCharacterFactory: () => 6 * RATES.image1K,
  CFZEnvironmentFactory: () => 2 * RATES.image2K,
  CFZSharedArtFactory: () => 6 * RATES.image1K + RATES.image2K,
  CFZTitleArt: () => RATES.image2K,
  CFZTitleVideo: (node, rate) => Number(node.inputs.duration || 8) * rate,
  CFZSelectVideo: (node, rate) => Number(node.inputs.duration || 8) * rate,
  CFZSelectIdleVideo: (node, rate) => RATES.image1K + Number(node.inputs.duration || 6) * rate,
  CFZIntroVideo: (node, rate) => RATES.image1K + Number(node.inputs.duration || 4) * rate
};
function rerollPlan(workflow, target) {
  const id = workflow[target] ? target : Object.keys(workflow).find(key => workflow[key]._meta?.title === target);
  if (!id) throw new Error('--node must be a node id or the exact title of a node in workflow.api.json.');
  if (!REROLL[workflow[id].class_type]) throw new Error(`${workflow[id].class_type} cannot be re-rolled; choose one of ${Object.keys(REROLL).join(', ')}.`);
  const consumers = key => Object.keys(workflow).filter(other => Object.values(workflow[other].inputs || {}).some(value => Array.isArray(value) && value[0] === key));
  const affected = new Set([id]);
  for (const key of affected) for (const child of consumers(key)) affected.add(child);
  const paid = [...affected].filter(key => REROLL[workflow[key].class_type]);
  const video = videoSettings(workflow);
  const estimatedUSD = Number(paid.reduce((sum, key) => sum + REROLL[workflow[key].class_type](workflow[key], video.rate), 0).toFixed(6));
  return { id, title: workflow[id]._meta?.title || workflow[id].class_type, paid, estimatedUSD, video };
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

// Redraw one derived image or clip of a fighter without touching anything else: a small prompt reuses the cached
// factory (same node ids and inputs), gives the new node a project copy with an offset seed, and patches the record.
const ART_KINDS = { portrait: 'CFZCharacterArt', hero: 'CFZCharacterArt', cutin: 'CFZCharacterArt', ending: 'CFZCharacterArt', intro: 'CFZIntroVideo', idle: 'CFZSelectIdleVideo', title: 'CFZTitleVideo', select: 'CFZSelectVideo' };
function artPlan(workflow, asset, overrides = {}) {
  const match = /^(?:([a-z][a-z0-9_]*)_(portrait|hero|cutin|ending|intro|idle)|(title|select)_video)$/.exec(asset || '');
  if (!match) throw new Error('--asset must be <fighter>_<portrait|hero|cutin|ending|intro|idle>, title_video or select_video.');
  const fighter = match[1] || null, kind = match[2] || match[3], video = videoSettings(workflow, overrides);
  const project = Object.keys(workflow).find(id => workflow[id].class_type === 'CFZProjectSettings');
  const environment = Object.keys(workflow).find(id => workflow[id].class_type === 'CFZEnvironmentFactory');
  const factory = fighter ? Object.keys(workflow).find(id => workflow[id].class_type === 'CFZCharacterFactory' && workflow[id].inputs.character_id === fighter) : null;
  if (fighter && !factory) throw new Error(`No character factory for ${fighter} in workflow.api.json.`);
  const original = Object.keys(workflow).find(id => workflow[id].class_type === ART_KINDS[kind] && (!fighter || workflow[id].inputs.character?.[0] === factory));
  const duration = Number(original ? workflow[original].inputs.duration : kind === 'intro' ? 4 : kind === 'idle' ? 6 : 8);
  const clip = ['intro', 'idle', 'title', 'select'].includes(kind);
  const estimatedUSD = Number((clip ? (fighter ? RATES.image1K : 0) + duration * video.rate : RATES.image1K).toFixed(6));
  return { fighter, kind, type: ART_KINDS[kind], factory, project, environment, duration, clip, video, estimatedUSD };
}
async function rerollArt(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle'), workflow = read(path.join(directory, 'workflow.api.json'));
  const planned = artPlan(workflow, options.asset, { videoModel: options.videoModel, videoResolution: options.videoResolution }), approved = Number(options.approveUsd);
  if (!Number.isFinite(approved) || approved < planned.estimatedUSD) throw new Error(`Redrawing ${options.asset} costs about $${planned.estimatedUSD}; pass --approve-usd ${Math.ceil(planned.estimatedUSD * 100) / 100} (or more) once authorized.`);
  const server = (options.server || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const state = pipeline(directory), count = (state.artRerolls || []).filter(entry => entry.asset === options.asset).length + 1;
  // The accepted identity (and the stage, for an intro) come from the bundle's own files uploaded to ComfyUI's input
  // folder, and the character from a free definition node, so the redraw never depends on the server's cache.
  const assets = read(path.join(bundle, 'assets.json')), factory = workflow[planned.factory], project = workflow[planned.project];
  const upload = async record => {
    if (!record) throw new Error('The bundle lacks the reference image this redraw needs.');
    const name = path.basename(record.src), form = new FormData();
    form.append('image', new Blob([fs.readFileSync(path.join(bundle, record.src))], { type: 'image/png' }), name); form.append('subfolder', 'cfz-redraw'); form.append('overwrite', 'true');
    const response = await fetch(`${server}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`ComfyUI refused the reference upload (${response.status}).`);
    const info = await response.json(); return `${info.subfolder ? info.subfolder + '/' : ''}${info.name}`;
  };
  const prompt = {
    project: { class_type: 'CFZProjectSettings', inputs: { ...project.inputs, seed: (Number(project.inputs.seed) + count * 1000) % 2 ** 32, video_model: planned.video.model, video_resolution: planned.video.resolution }, _meta: { title: `Project settings | redraw ${options.asset} #${count}` } }
  };
  const inputs = { project: ['project', 0] };
  if (planned.fighter) {
    const definition = Object.fromEntries(['name', 'description', 'special_name', 'special_description', 'intro_tagline', 'color', 'character_id', 'fighting_style', 'super_name', 'super_description', 'win_quote', 'ending', 'role'].filter(key => factory.inputs[key] !== undefined).map(key => [key, factory.inputs[key]]));
    prompt.character = { class_type: 'CFZCharacterDefinition', inputs: definition, _meta: { title: `Character | ${planned.fighter}` } };
    prompt.reference = { class_type: 'LoadImage', inputs: { image: await upload(assets.assets.find(item => item.id === `${planned.fighter}_reference`)) }, _meta: { title: 'Accepted identity reference' } };
    inputs.character = ['character', 0]; inputs.reference = ['reference', 0];
  } else {
    // The menu loops animate the accepted interface art: the cast ensemble or the select backdrop.
    const source = planned.kind === 'title' ? 'ensemble' : 'select';
    prompt.image = { class_type: 'LoadImage', inputs: { image: await upload(assets.assets.find(item => item.kind === 'ui' && item.id === source)) }, _meta: { title: `Accepted ${source} art` } };
    inputs[planned.kind === 'title' ? 'title_image' : 'select_image'] = ['image', 0];
  }
  if (planned.kind === 'intro') { prompt.stage = { class_type: 'LoadImage', inputs: { image: await upload(assets.assets.find(item => item.kind === 'stage')) }, _meta: { title: 'Accepted stage' } }; inputs.stage_reference = ['stage', 0]; }
  if (planned.clip) inputs.duration = String(planned.duration); else inputs.kind = planned.kind;
  prompt.redraw = { class_type: planned.type, inputs, _meta: { title: `Redraw ${options.asset} #${count}` } };
  prompt.keep = { class_type: 'PreviewAny', inputs: { source: ['redraw', 0] }, _meta: { title: 'keep' } };
  const missing = await missingNodes(prompt, server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}.`);
  const file = path.join(directory, `redraw-${options.asset}-${count}.api.json`); fs.writeFileSync(file, JSON.stringify(prompt, null, 2) + '\n');
  const { submit, outcome } = require('../../comfyui/tools/run-sequential.cjs');
  const before = new Set(fs.readdirSync(path.join(bundle, 'raw')));
  const entry = { at: now(), asset: options.asset, attempt: count, estimatedUSD: planned.estimatedUSD, approvedUSD: approved, prompt: path.basename(file), ...(planned.clip ? { video: planned.video } : {}) };
  state.artRerolls = [...(state.artRerolls || []), entry]; fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Redrawing ${options.asset} (attempt ${count}, about $${planned.estimatedUSD}) from the bundle's accepted identity; nothing else is touched.`);
  const promptId = submit(file), result = await outcome(server, promptId, 30 * 60000);
  entry.promptId = promptId; entry.ok = result.ok;
  if (!result.ok) { fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n'); throw new Error(`Redraw failed: ${result.error?.exception_type || ''}: ${result.error?.exception_message || 'unknown error'}`); }
  // Point the manifest at the new file; the exporter is not rerun, so nothing else in the bundle changes.
  const prefix = !planned.fighter ? `${planned.kind}-` : planned.clip ? `${planned.kind}-${planned.fighter}-` : `${planned.fighter}_${planned.kind}-`;
  const produced = fs.readdirSync(path.join(bundle, 'raw')).filter(name => name.startsWith(prefix) && !before.has(name));
  if (produced.length !== 1) throw new Error(`Expected one new ${prefix}* file, found ${produced.length}.`);
  const target = path.join(bundle, 'raw', produced[0]), digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (planned.clip) {
    const videoFile = path.join(bundle, 'video.json'), video = read(videoFile);
    const record = planned.kind === 'title' ? video.titleVideo : planned.kind === 'select' ? video.selectVideo : (planned.kind === 'intro' ? video.fighterIntros : video.selectIdles)?.find(item => item.fighter === planned.fighter);
    if (!record) throw new Error(`video.json has no ${planned.kind} record${planned.fighter ? ' for ' + planned.fighter : ''}.`);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target], { encoding: 'utf8', windowsHide: true });
    const duration = Number(probe.stdout); if (Number.isFinite(duration) && duration > 0) record.duration = Number(duration.toFixed(3));
    Object.assign(record, { src: `raw/${produced[0]}`, sha256: digest }); fs.writeFileSync(videoFile, JSON.stringify(video, null, 2) + '\n');
  } else {
    const { loadImage } = require('@napi-rs/canvas'), image = await loadImage(fs.readFileSync(target));
    const assetsFile = path.join(bundle, 'assets.json'), assets = read(assetsFile), record = assets.assets.find(item => item.id === options.asset);
    if (!record) throw new Error(`assets.json has no record ${options.asset}.`);
    Object.assign(record, { src: `raw/${produced[0]}`, sha256: digest, width: image.width, height: image.height }); fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n');
  }
  entry.file = `raw/${produced[0]}`; fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Redrew ${options.asset} → ${entry.file}. Review again, then export to a fresh folder.`);
}

// Add the optional motion sheets (sheetF: strike transitions; sheetG: breathing loop and air cels) to a run that was
// generated without them. Cache-independent like reroll-art: the accepted identity and sheet A are uploaded from the
// bundle, the character is rebuilt from the cast text, and the new sheet records join assets.json.
const MOTION_SHEETS = ['sheetF', 'sheetG'];
function sheetPlan(workflow, bundleGame, options = {}) {
  const sheets = (options.sheets ? options.sheets.split(',') : MOTION_SHEETS).map(s => s.trim()).filter(Boolean);
  const config = read(path.join(ROOT, 'comfyui/config/game.json')), layouts = { ...(config.motionSheets || {}), ...(config.detailSheets || {}) };
  for (const sheet of sheets) if (!layouts[sheet]) throw new Error(`--sheets must name motion sheets from comfyui/config/game.json (${Object.keys(layouts).join(', ')}).`);
  const wanted = options.fighters ? options.fighters.split(',').map(s => s.trim()) : bundleGame.fighters.map(f => f.id);
  const fighters = wanted.map(id => {
    const factory = Object.keys(workflow).find(key => workflow[key].class_type === 'CFZCharacterFactory' && workflow[key].inputs.character_id === id);
    if (!factory) throw new Error(`No character factory for ${id} in workflow.api.json.`);
    return { id, factory };
  });
  const estimatedUSD = Number((fighters.length * sheets.length * RATES.image2K).toFixed(6));
  return { sheets, layouts, fighters, estimatedUSD };
}
async function addSheets(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle'), workflow = read(path.join(directory, 'workflow.api.json'));
  const assetsFile = path.join(bundle, 'assets.json');
  if (!fs.existsSync(assetsFile)) throw new Error('No bundle/assets.json yet; run the generation first.');
  const assets = read(assetsFile), planned = sheetPlan(workflow, assets.game, options), approved = Number(options.approveUsd);
  const existing = planned.fighters.flatMap(f => planned.sheets.filter(sheet => assets.assets.some(asset => asset.id === `${f.id}_${sheet}`)).map(sheet => `${f.id}_${sheet}`));
  if (existing.length) throw new Error(`Already in the bundle: ${existing.join(', ')}. Use reroll-art style redraws for existing sheets.`);
  if (!Number.isFinite(approved) || approved < planned.estimatedUSD) throw new Error(`Adding ${planned.sheets.join('+')} for ${planned.fighters.length} fighter(s) costs about $${planned.estimatedUSD}; pass --approve-usd ${Math.ceil(planned.estimatedUSD * 100) / 100} (or more) once authorized.`);
  const server = (options.server || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const project = Object.values(workflow).find(node => node.class_type === 'CFZProjectSettings');
  const probe = { probe: { class_type: 'CFZSpriteSheet', inputs: { sheet: planned.sheets[0] } } };
  const missing = await missingNodes({ ...probe, def: { class_type: 'CFZCharacterDefinition' }, load: { class_type: 'LoadImage' } }, server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}; install the node pack and restart it.`);
  const info = await (await fetch(`${server}/object_info/CFZSpriteSheet`)).json(), choices = info.CFZSpriteSheet?.input?.required?.sheet?.[1]?.options || [];
  for (const sheet of planned.sheets) if (!choices.includes(sheet)) throw new Error(`The running ComfyUI's CFZSpriteSheet predates ${sheet}; reinstall the node pack and restart ComfyUI.`);
  const upload = async record => {
    if (!record) throw new Error('The bundle lacks a reference image this sheet needs.');
    const name = path.basename(record.src), form = new FormData();
    form.append('image', new Blob([fs.readFileSync(path.join(bundle, record.src))], { type: 'image/png' }), name); form.append('subfolder', 'cfz-redraw'); form.append('overwrite', 'true');
    const response = await fetch(`${server}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`ComfyUI refused the reference upload (${response.status}).`);
    const uploaded = await response.json(); return `${uploaded.subfolder ? uploaded.subfolder + '/' : ''}${uploaded.name}`;
  };
  const { submit, outcome } = require('../../comfyui/tools/run-sequential.cjs'), { loadImage } = require('@napi-rs/canvas'), crypto = require('node:crypto');
  const state = pipeline(directory); state.addedSheets = state.addedSheets || [];
  const prompt = { project: { class_type: 'CFZProjectSettings', inputs: { ...project.inputs }, _meta: { title: `Project settings | motion sheets` } } };
  const saves = [];
  for (const fighter of planned.fighters) {
    const factory = workflow[fighter.factory];
    const definition = Object.fromEntries(['name', 'description', 'special_name', 'special_description', 'intro_tagline', 'color', 'character_id', 'fighting_style', 'super_name', 'super_description', 'win_quote', 'ending', 'role'].filter(key => factory.inputs[key] !== undefined).map(key => [key, factory.inputs[key]]));
    prompt[`${fighter.id}_character`] = { class_type: 'CFZCharacterDefinition', inputs: definition, _meta: { title: `Character | ${fighter.id}` } };
    prompt[`${fighter.id}_reference`] = { class_type: 'LoadImage', inputs: { image: await upload(assets.assets.find(item => item.id === `${fighter.id}_reference`)) }, _meta: { title: `Accepted identity | ${fighter.id}` } };
    // The style reference is sheet A unless --reference-sheet names another accepted sheet (one drawn with exactly nine figures).
    const referenceId = `${fighter.id}_${options.referenceSheet || 'sheet'}`, referenceRecord = assets.assets.find(item => item.id === referenceId && item.kind === 'sprites');
    if (!referenceRecord) throw new Error(`--reference-sheet ${options.referenceSheet}: ${referenceId} is not an accepted sheet in the bundle.`);
    prompt[`${fighter.id}_sheetA`] = { class_type: 'LoadImage', inputs: { image: await upload(referenceRecord) }, _meta: { title: `Accepted reference sheet ${options.referenceSheet || 'sheet'} | ${fighter.id}` } };
    for (const sheet of planned.sheets) {
      const id = `${fighter.id}_${sheet}`;
      prompt[id] = { class_type: 'CFZSpriteSheet', inputs: { project: ['project', 0], character: [`${fighter.id}_character`, 0], reference: [`${fighter.id}_reference`, 0], reference_sheet: [`${fighter.id}_sheetA`, 0], sheet }, _meta: { title: `${fighter.id} | ${sheet}` } };
      prompt[`keep_${id}`] = { class_type: 'PreviewAny', inputs: { source: [id, 0] }, _meta: { title: `keep ${id}` } };
      saves.push({ fighter: fighter.id, sheet, id });
    }
  }
  const file = path.join(directory, `add-sheets-${Date.now()}.api.json`); fs.writeFileSync(file, JSON.stringify(prompt, null, 2) + '\n');
  const entry = { at: now(), sheets: planned.sheets, fighters: planned.fighters.map(f => f.id), estimatedUSD: planned.estimatedUSD, approvedUSD: approved, prompt: path.basename(file), ...(options.referenceSheet ? { referenceSheet: options.referenceSheet } : {}) };
  state.addedSheets.push(entry); fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Generating ${planned.sheets.join(' and ')} for ${planned.fighters.length} fighter(s) (about $${planned.estimatedUSD}), one paid node at a time.`);
  const status = node([path.join(ROOT, 'comfyui/tools/run-sequential.cjs'), '--workflow', file, '--server', server]);
  if (status !== 0) { entry.ok = false; fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n'); throw new Error('The sequential run did not finish; rerun add-sheets with the same arguments to resume from the cache.'); }
  // Each sheet node saved its PNG under raw/<id>-<hash>.png; record them like the exporter would.
  const raw = fs.readdirSync(path.join(bundle, 'raw'));
  for (const save of saves) {
    const files = raw.filter(name => name.startsWith(`${save.id}-`) && name.endsWith('.png')).map(name => ({ name, time: fs.statSync(path.join(bundle, 'raw', name)).mtimeMs })).sort((a, b) => b.time - a.time);
    if (!files.length) throw new Error(`No saved image for ${save.id} in bundle/raw.`);
    const target = path.join(bundle, 'raw', files[0].name), bytes = fs.readFileSync(target), digest = crypto.createHash('sha256').update(bytes).digest('hex'), image = await loadImage(bytes);
    assets.assets.push({ id: save.id, kind: 'sprites', fighter: save.fighter, key: true, poses: planned.layouts[save.sheet], sheet: save.sheet, src: `raw/${files[0].name}`, sha256: digest, width: image.width, height: image.height });
  }
  const config = read(path.join(ROOT, 'comfyui/config/game.json'));
  if (planned.sheets.some(sheet => Object.hasOwn(config.motionSheets || {}, sheet))) assets.game.motionSheets = config.motionSheets;
  if (planned.sheets.some(sheet => Object.hasOwn(config.detailSheets || {}, sheet))) assets.game.detailSheets = config.detailSheets;
  if (Array.isArray(assets.game.expectedAssets)) assets.game.expectedAssets.push(...saves.map(save => save.id));
  fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n');
  entry.ok = true; entry.added = saves.map(save => save.id); fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Added ${saves.length} sheet(s): ${saves.map(save => save.id).join(', ')}. Review again, then export to a fresh folder.`);
}

// Living stage scenery: per stage, the same graph as comfyui/workflows/factory/stage-scenery.json (scene director,
// populated scene, separation, local extraction, patch export) runs one paid node at a time into a patch folder under
// <run>/scenery/, which build/tools/stage-scenery.cjs then applies to the run's bundle.
async function addScenery(options) {
  const { makeSceneryGraph, sceneryCounts, apiPrompt } = require('../../comfyui/tools/prepare-factory-workflows.cjs');
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle'), workflow = read(path.join(directory, 'workflow.api.json'));
  const assetsFile = path.join(bundle, 'assets.json');
  if (!fs.existsSync(assetsFile)) throw new Error('No bundle/assets.json yet; run the generation first.');
  const assets = read(assetsFile), stages = options.stages ? options.stages.split(',').map(s => s.trim()) : assets.game.stages.map(s => s.id);
  for (const id of stages) {
    if (!assets.game.stages.some(s => s.id === id)) throw new Error(`Unknown stage ${id}.`);
    if (!assets.assets.some(a => a.id === id && a.kind === 'stage')) throw new Error(`The bundle lacks the stage painting for ${id}.`);
  }
  const elementCount = options.elements === undefined ? 12 : Number(options.elements), model = options.directorModel || 'Gemini 3.8 Flash';
  if (!Number.isInteger(elementCount) || elementCount < 4 || elementCount > 16) throw new Error('--elements must be a whole number from 4 to 16.');
  const counts = sceneryCounts(stages.length, model), approved = Number(options.approveUsd);
  if (!Number.isFinite(approved) || approved < counts.estimatedUSD) throw new Error(`Living scenery for ${stages.length} stage(s) costs at most about $${counts.estimatedUSD} (${counts.twoK} 2K edits and a scene director bounded at $${counts.directorMaxUSD}); pass --approve-usd ${Math.ceil(counts.estimatedUSD * 100) / 100} (or more) once authorized.`);
  const server = (options.server || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const missing = await missingNodes(Object.fromEntries(['CFZSceneDirector', 'CFZScenePlan', 'CFZStageScenery', 'CFZSceneIsolate', 'CFZExtractScenery', 'GeminiNodeV3', 'LoadImage'].map((type, i) => [i, { class_type: type }])), server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}; install the node pack and restart it.`);
  const projectNode = Object.values(workflow).find(node => node.class_type === 'CFZProjectSettings');
  const state = pipeline(directory); state.addedScenery = state.addedScenery || [];
  const entry = { at: now(), stages, elementCount, directorModel: model, estimatedUSD: counts.estimatedUSD, approvedUSD: approved, patches: [] }; state.addedScenery.push(entry);
  const save = () => fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  save();
  for (const id of stages) {
    const stage = assets.game.stages.find(s => s.id === id), painting = assets.assets.find(a => a.id === id && a.kind === 'stage');
    // The accepted painting is uploaded from the bundle, so the server's cache and input folder do not matter.
    const form = new FormData(); form.append('image', new Blob([fs.readFileSync(path.join(bundle, painting.src))], { type: 'image/png' }), `cfz-accepted-${id}-stage.png`);
    form.append('subfolder', 'cfz-scenery'); form.append('overwrite', 'true');
    const response = await fetch(`${server}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`ComfyUI refused the stage upload (${response.status}).`);
    const uploaded = await response.json(), patch = path.join(directory, 'scenery', `${id}-${Date.now()}`);
    const graph = makeSceneryGraph({ title: assets.game.title, stages: [stage] }, { stage, stageImage: `${uploaded.subfolder ? uploaded.subfolder + '/' : ''}${uploaded.name}`,
      project: { ...projectNode.inputs }, rootDirectory: patch, direction: options.direction || '', elementCount, model, reroll: Number(options.reroll || 0), muted: false });
    fs.mkdirSync(patch, { recursive: true });
    fs.writeFileSync(path.join(patch, 'stage-scenery.workflow.json'), JSON.stringify(graph, null, 2) + '\n');
    const file = path.join(patch, 'stage-scenery.api.json'); fs.writeFileSync(file, JSON.stringify(apiPrompt(graph), null, 2) + '\n');
    entry.patches.push(path.relative(ROOT, patch)); save();
    console.log(`Living scenery for ${id}: scene director, populated scene and separation, one paid node at a time, then the local extraction.`);
    if (node([path.join(ROOT, 'comfyui/tools/run-sequential.cjs'), '--workflow', file, '--server', server]) !== 0) { entry.ok = false; save(); throw new Error(`The sequential run for ${id} did not finish; rerun add-scenery to resume from the cache.`); }
    if (node([path.join(ROOT, 'build/tools/stage-scenery.cjs'), 'apply', '--patch', patch, '--bundle', bundle, '--stage', id]) !== 0) { entry.ok = false; save(); throw new Error(`Applying the scenery patch for ${id} failed.`); }
  }
  entry.ok = true; save();
  console.log(`Added living scenery for ${stages.join(', ')}. Review bundle/scenery/<stage>-review.png, edit motions in bundle/scenery/<stage>.json and run build/tools/stage-scenery.cjs sync if needed, then export to a fresh folder.`);
}

async function main(argv) {
  const { command, options } = parse(argv);
  const commands = { prepare, run, reroll, 'reroll-art': rerollArt, 'add-sheets': addSheets, 'add-scenery': addScenery, review, export: exportGame, install, status };
  if (!commands[command]) throw new Error(USAGE);
  await commands[command](options);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, prepare, run, review, reroll, rerollPlan, rerollArt, artPlan, addSheets, sheetPlan, exportGame, install, pipeline, missingNodes };
