// The new-game pipeline, one command per step so a person or an agent can reproduce a whole game from a cast file:
//   node build/tools/new-game.cjs prepare --cast comfyui/casts/<name>.json --out output/test-runs/<fresh-name> [--seed 42] [--no-media] [--no-audio] [--accepted <bundle>]
//     (--accepted copies an accepted bundle, such as example/bundle with --cast comfyui/config/factory.json, into the run for
//     add-on steps only; such a run refuses the full generation)
//   node build/tools/new-game.cjs run     --run output/test-runs/<name> --approve-usd <amount> [--server http://127.0.0.1:8188] [--resume]
//   node build/tools/new-game.cjs review  --run output/test-runs/<name>
//   node build/tools/new-game.cjs reroll  --run output/test-runs/<name> --node <id or title> --approve-usd <amount>
//   node build/tools/new-game.cjs reroll-art --run output/test-runs/<name> --asset <fighter>_<portrait|hero|cutin|ending|intro|idle>|title_video|select_video --approve-usd <amount> [--video-model <name>] [--video-resolution 720p|1080p] [--title-image <file>] [--select-image <file>]
//   node build/tools/new-game.cjs add-sheets --run output/test-runs/<name> --approve-usd <amount> [--sheets sheetF,sheetG] [--fighters a,b] [--reference-sheet sheetF]
//   node build/tools/new-game.cjs add-media --run output/test-runs/<name> --approve-usd <amount> [--clips intro,idle,title,select] [--fighters a,b] [--title-image <file>] [--select-image <file>]
//     (the startup and select clips a run lacks, drawn like reroll-art from the bundle's accepted images; mapped clips are skipped)
//     (--reference-sheet picks the accepted sheet sent as the style reference, default sheet A; use a clean one when sheet A has an extra figure)
//   node build/tools/new-game.cjs title-card (--run output/test-runs/<name> | --example | --crossover build/crossovers/<name>.json) --approve-usd 0.08 [--title <text>] [--tagline <text>]
//     (one 2K image: the game's key art lettered with its own name, the game-select title card; see titleCard below)
//   node build/tools/new-game.cjs pack-media --run output/test-runs/<name>
//     (free and local: re-encodes clips above 12 Mbit/s as H.264 CRF 18 and WAV sounds as MP3 VBR q2, originals kept in
//     <run>/originals/; export asks for it when the package could not fit the 1 GiB browser limit)
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
  const valued = ['--cast', '--out', '--seed', '--run', '--approve-usd', '--server', '--slot', '--node', '--asset', '--video-model', '--video-resolution', '--sheets', '--fighters', '--reference-sheet', '--stages', '--direction', '--elements', '--director-model', '--reroll', '--title', '--tagline', '--crossover', '--accepted', '--clips', '--title-image', '--select-image'];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--no-media') options.media = false;
    else if (rest[i] === '--no-audio') options.audio = false;
    else if (rest[i] === '--resume') options.resume = true;
    else if (rest[i] === '--example') options.example = true;
    else if (valued.includes(rest[i]) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) options[rest[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[++i];
    else throw new Error(`Unknown argument ${rest[i]}. ${USAGE}`);
  }
  return { command, options };
}
const USAGE = 'Usage: node build/tools/new-game.cjs <prepare|run|review|reroll|reroll-art|add-sheets|add-scenery|add-media|title-card|pack-media|export|install|status> ... (see the header of this file).';

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
  if (options.accepted) state.accepted = acceptBundle(directory, options.accepted, plan);
  fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  record(directory, 'prepared', { estimatedUSD: plan.total.estimatedUSD, images: plan.images.paidImages, clips: plan.videos?.clips || 0, audio: plan.audio?.clips || 0, seed: Number(options.seed ?? 42) });
  if (state.accepted) {
    console.log(`Prepared ${plan.title}${plan.subtitle ? ' / ' + plan.subtitle : ''} over the accepted ${state.accepted.bundle} (${state.accepted.images} images, ${state.accepted.audio} sounds, ${state.accepted.videos} clips).`);
    console.log('  Add-on steps only (add-media, add-scenery, add-sheets, reroll-art, title-card); the full generation is refused so the accepted art is never redrawn.');
    return { directory, plan };
  }
  console.log(`Prepared ${plan.title}${plan.subtitle ? ' / ' + plan.subtitle : ''}: ${plan.fighters.length} fighters, ${plan.stages.length} arena(s).`);
  console.log(`  images ${plan.images.paidImages} ($${plan.images.estimatedUSD})` + (plan.videos ? `, clips ${plan.videos.clips} / ${plan.videos.seconds} s ($${plan.videos.estimatedUSD})` : '') + (plan.audio ? `, audio ${plan.audio.clips} ($${plan.audio.estimatedUSD})` : ''));
  console.log(`  estimated total $${plan.total.estimatedUSD} — nothing submitted. Next: node build/tools/new-game.cjs run --run ${path.relative(ROOT, directory).replace(/\\/g, '/')} --approve-usd ${Math.ceil(plan.total.estimatedUSD * 100) / 100}`);
  return { directory, plan };
}

// Copy an accepted bundle (its manifests and every mapped file) into a prepared run, so add-on steps can extend it: the
// original game's example/bundle with --cast comfyui/config/factory.json. Its cast must match the run's.
function acceptBundle(directory, source, plan) {
  const from = path.resolve(ROOT, source), assets = read(path.join(from, 'assets.json'));
  if (!['comfy-fighter-assets/v1', 'dad-fighter-assets/v1'].includes(assets.schema) || assets.partial || !Array.isArray(assets.assets)) throw new Error(`${source} is not a complete accepted assets.json bundle.`);
  const same = (a, b) => a.length === b.length && a.every(id => b.includes(id));
  if (!same(assets.game.fighters.map(f => f.id), plan.fighters) || !same(assets.game.stages.map(s => s.id), plan.stages)) throw new Error(`${source} holds a different cast than the run (${plan.fighters.join(', ')} in ${plan.stages.join(', ')}).`);
  const bundle = path.join(directory, 'bundle'), { sourceFile } = require('./lib/runtime-validation.cjs'), records = [...assets.assets];
  const manifests = ['assets.json', 'audio.json', 'video.json'].filter(name => fs.existsSync(path.join(from, name)));
  const audio = manifests.includes('audio.json') ? read(path.join(from, 'audio.json')).assets || [] : [], video = manifests.includes('video.json') ? read(path.join(from, 'video.json')) : {};
  const clips = videoClips(video);
  for (const record of [...records, ...audio, ...clips]) {
    const target = path.join(bundle, record.src); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(sourceFile(from, record.src), target);
  }
  for (const name of manifests) fs.copyFileSync(path.join(from, name), path.join(bundle, name));
  return { bundle: path.relative(ROOT, from).split(path.sep).join('/'), at: now(), images: records.length, audio: audio.length, videos: clips.length };
}

async function missingNodes(workflow, server) {
  const response = await fetch(`${server}/object_info`);
  if (!response.ok) throw new Error(`ComfyUI answered ${response.status} at ${server}/object_info.`);
  const info = await response.json(), classes = [...new Set(Object.values(workflow).map(item => item.class_type))];
  return classes.filter(type => !Object.hasOwn(info, type));
}

async function run(options) {
  const directory = runDirectory(options), plan = read(path.join(directory, 'plan.json')), state = pipeline(directory);
  if (state.accepted) throw new Error(`This run extends the accepted ${state.accepted.bundle}; the full generation would redraw it. Use add-media, add-scenery, add-sheets, reroll-art or title-card.`);
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
  if (fs.existsSync(path.join(bundle, 'video.json'))) report.videos = videoClips(read(path.join(bundle, 'video.json'))).map(clip => ({ id: clip.id, src: clip.src, duration: clip.duration }));
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

// Every clip a video.json maps: the game-wide loops (the opening, the title and select loops and their portrait cuts
// for phones) and the per-fighter introductions and idle loops.
const VIDEO_KEYS = ['openingVideo', 'titleVideo', 'selectVideo', 'titleVideoPortrait', 'selectVideoPortrait'];
const videoClips = video => [...VIDEO_KEYS.map(key => video?.[key]), ...(video?.fighterIntros || []), ...(video?.selectIdles || [])].filter(Boolean);
// The media records of a bundle: every clip in video.json and every sound in audio.json.
function mediaRecords(bundle) {
  const video = fs.existsSync(path.join(bundle, 'video.json')) ? read(path.join(bundle, 'video.json')) : {};
  const audio = fs.existsSync(path.join(bundle, 'audio.json')) ? read(path.join(bundle, 'audio.json')) : { assets: [] };
  return { video, audio, clips: videoClips(video), sounds: audio.assets || [] };
}
const PACKAGE_LIMIT = 1024 * 1024 * 1024;
// The package holds every referenced source plus a byte-identical runtime copy of each clip and sound, so that sum is a
// floor on its size: past the builder's 1 GiB limit the export cannot pass.
function packageFloor(bundle) {
  const { clips, sounds } = mediaRecords(bundle), size = src => { try { return fs.statSync(path.join(bundle, src)).size; } catch { return 0; } };
  const media = [...clips, ...sounds].reduce((sum, item) => sum + size(item.src), 0);
  return { bytes: read(path.join(bundle, 'assets.json')).assets.reduce((sum, item) => sum + size(item.src), 0) + 2 * media, clips: clips.length, sounds: sounds.length };
}
function exportGame(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle');
  if (!fs.existsSync(path.join(bundle, 'assets.json'))) throw new Error('No bundle/assets.json yet; run the generation first.');
  const out = path.resolve(ROOT, options.out || path.join('output/exports', path.basename(directory)));
  if (!out.startsWith(path.join(ROOT, 'output/exports') + path.sep)) throw new Error('--out must be a fresh folder under output/exports/.');
  if (fs.existsSync(out)) throw new Error(`${path.relative(ROOT, out)} exists; exports are never overwritten.`);
  // Say so before minutes of building when the package cannot fit.
  const floor = packageFloor(bundle);
  if (floor.bytes > PACKAGE_LIMIT) throw new Error(`The package would be at least ${Math.round(floor.bytes / 1048576)} MiB (the sources plus runtime copies of ${floor.clips} clips and ${floor.sounds} sounds), over the 1 GiB browser package limit. Run node build/tools/new-game.cjs pack-media --run ${path.relative(ROOT, directory).replace(/\\/g, '/')} (free and local: web-encodes heavy clips, MP3 audio, originals kept), then export.`);
  const status = node([path.join(ROOT, 'build/tools/build-bundle.cjs'), '--bundle', bundle, '--out', out]);
  const receiptFile = path.join(out, 'build-test.json'), receipt = fs.existsSync(receiptFile) ? read(receiptFile) : null;
  record(directory, 'exported', { exitCode: status, out: path.relative(ROOT, out).replace(/\\/g, '/'), status: receipt?.status || 'missing', checks: receipt?.checks?.length || 0 });
  if (status !== 0 || receipt?.status !== 'passed') throw new Error(`Strict export failed (exit ${status}, ${receipt?.status || 'no receipt'}). Fix the bundle (re-roll or review) and export to a fresh folder.`);
  console.log(`Export passed: ${path.relative(ROOT, out)}. Next: node build/tools/new-game.cjs install --run ${path.relative(ROOT, directory).replace(/\\/g, '/')} --slot <id>`);
}

// Web-ready media before export, free and local. Seedance 1080p clips arrive at 17-33 Mbit/s and the package ships
// each clip and sound twice (runtime and sources), which pushed a seven-fighter cast past the 1 GiB browser limit.
// Clips above WEB_VIDEO_BITRATE become H.264 CRF 18 (visually lossless, +faststart, same size, rate and frame count)
// and WAV sounds become MP3 VBR q2 like the shipped example. The portrait cuts of the menu loops are made for phones:
// they always become 720-wide H.264 Main CRF 22 capped at 3.5 Mbit/s (same rate, frame count and duration), the size
// a phone decodes and downloads comfortably. Originals move to <run>/originals/; pipeline.json lists every
// conversion. Running it again skips what is already packed.
const WEB_VIDEO_BITRATE = 12e6, PHONE_CLIP = /^(title|select)-portrait$/, PHONE_WIDTH = 720;
function probeMedia(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot inspect ${path.basename(file)}: ${result.stderr || result.error?.message}`);
  const data = JSON.parse(result.stdout), video = data.streams.find(s => s.codec_type === 'video');
  return { video, audio: data.streams.find(s => s.codec_type === 'audio'), duration: Number(data.format.duration), bitRate: Number(data.format.bit_rate), frames: Number(video?.nb_read_packets) };
}
async function packMedia(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle'), originals = path.join(directory, 'originals');
  const { compactAudio } = require('./package-example.cjs'), crypto = require('node:crypto');
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const stem = src => path.basename(src).replace(/-[0-9a-f]{16}(?=\.[a-z0-9]+$)/i, '').replace(/\.[a-z0-9]+$/i, '');
  const { video, audio, clips, sounds } = mediaRecords(bundle), conversions = [];
  fs.mkdirSync(originals, { recursive: true });
  // The converted file takes a content-addressed name in raw/ and the original moves out of the bundle.
  const adopt = (temp, record, extension) => {
    const sha256 = digest(temp), name = `${stem(record.src)}-${sha256.slice(0, 16)}.${extension}`, before = fs.statSync(path.join(bundle, record.src)).size;
    fs.renameSync(temp, path.join(bundle, 'raw', name));
    fs.renameSync(path.join(bundle, record.src), path.join(originals, path.basename(record.src)));
    const entry = { id: record.id || stem(record.src), from: record.src, fromSha256: record.sha256 || null, to: `raw/${name}`, sha256, bytesBefore: before, bytesAfter: fs.statSync(path.join(bundle, 'raw', name)).size };
    conversions.push(entry); Object.assign(record, { src: entry.to, sha256 });
    return entry;
  };
  for (const record of clips) {
    const input = path.join(bundle, record.src), source = probeMedia(input), phone = PHONE_CLIP.test(record.id || '');
    // A phone cut is packed once: a 720-wide encode at or under the cap is already the phone file.
    if (phone ? source.video.width <= PHONE_WIDTH && source.bitRate <= 3.6e6 : !(source.bitRate > WEB_VIDEO_BITRATE)) continue;
    const temp = path.join(bundle, 'raw', `.packing-${stem(record.src)}.mp4`);
    const scale = phone && source.video.width > PHONE_WIDTH ? ['-vf', `scale=${PHONE_WIDTH}:-2:flags=lanczos`] : [];
    const quality = phone ? ['-crf', '22', '-maxrate', '3.5M', '-bufsize', '7M', '-profile:v', 'main', '-level', '4.0'] : ['-crf', '18'];
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:v:0', ...(source.audio ? ['-map', '0:a:0', '-c:a', 'copy'] : ['-an']), ...scale,
      '-c:v', 'libx264', '-preset', 'slow', ...quality, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', '-y', temp], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`FFmpeg failed on ${record.src}: ${result.stderr || result.error?.message}`);
    const encoded = probeMedia(temp);
    const expectedWidth = scale.length ? PHONE_WIDTH : source.video.width, expectedHeight = scale.length ? Math.round(source.video.height * PHONE_WIDTH / source.video.width / 2) * 2 : source.video.height;
    if (encoded.video.width !== expectedWidth || encoded.video.height !== expectedHeight || encoded.video.r_frame_rate !== source.video.r_frame_rate
      || encoded.frames !== source.frames || Math.abs(encoded.duration - source.duration) > .05 || !!encoded.audio !== !!source.audio) {
      fs.rmSync(temp, { force: true }); throw new Error(`The web encode of ${record.src} changed its size, rate, frames or duration; nothing was replaced.`);
    }
    Object.assign(adopt(temp, record, 'mp4'), { kind: 'video', crf: phone ? 22 : 18, phone, bitRateBefore: source.bitRate, bitRateAfter: encoded.bitRate, width: encoded.video.width, height: encoded.video.height });
    record.duration = Number(encoded.duration.toFixed(3));
  }
  for (const record of sounds) {
    if (!/\.wav$/i.test(record.src)) continue;
    const temp = path.join(bundle, 'raw', `.packing-${stem(record.src)}.mp3`), verified = await compactAudio(path.join(bundle, record.src), temp);
    const entry = adopt(temp, record, 'mp3'); entry.kind = 'audio';
    Object.assign(record, { duration: verified.duration, sampleRate: verified.sampleRate, channels: verified.channels, codec: 'mp3', bytes: entry.bytesAfter });
  }
  if (!conversions.length) { console.log('Nothing to pack: every clip is at most 12 Mbit/s (phone cuts 720 wide), and every sound is already compressed.'); return; }
  if (conversions.some(entry => entry.kind === 'video')) fs.writeFileSync(path.join(bundle, 'video.json'), JSON.stringify(video, null, 2) + '\n');
  if (conversions.some(entry => entry.kind === 'audio')) fs.writeFileSync(path.join(bundle, 'audio.json'), JSON.stringify(audio, null, 2) + '\n');
  const before = conversions.reduce((sum, entry) => sum + entry.bytesBefore, 0), after = conversions.reduce((sum, entry) => sum + entry.bytesAfter, 0);
  const state = pipeline(directory);
  state.packedMedia = [...(state.packedMedia || []), { at: now(), video: 'H.264 CRF 18, preset slow, yuv420p, +faststart; size, frame rate, frame count and duration verified', phone: 'portrait menu loops: 720 wide, H.264 Main CRF 22 capped at 3.5 Mbit/s; frame rate, frame count and duration verified', audio: 'MP3 VBR quality 2; sample rate, channels and duration verified', originals: path.relative(ROOT, originals).replace(/\\/g, '/'), bytesBefore: before, bytesAfter: after, conversions }];
  fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  const mib = bytes => `${(bytes / 1048576).toFixed(1)} MiB`;
  console.log(`Packed ${conversions.filter(e => e.kind === 'video').length} clip(s) and ${conversions.filter(e => e.kind === 'audio').length} sound(s): ${mib(before)} -> ${mib(after)}. Originals in ${path.relative(ROOT, originals)}. Next: export to a fresh folder.`);
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
  const match = /^(?:([a-z][a-z0-9_]*)_(portrait|hero|cutin|ending|intro|idle)|(title|select)(_portrait)?_video)$/.exec(asset || '');
  if (!match) throw new Error('--asset must be <fighter>_<portrait|hero|cutin|ending|intro|idle>, title_video, select_video, title_portrait_video or select_portrait_video.');
  // The phone cut of a menu loop (title_portrait_video, select_portrait_video) adds one 2K recomposition of the art.
  const fighter = match[1] || null, kind = match[2] || match[3], portraitCut = !!match[4], video = videoSettings(workflow, overrides);
  const project = Object.keys(workflow).find(id => workflow[id].class_type === 'CFZProjectSettings');
  const environment = Object.keys(workflow).find(id => workflow[id].class_type === 'CFZEnvironmentFactory');
  const factory = fighter ? Object.keys(workflow).find(id => workflow[id].class_type === 'CFZCharacterFactory' && workflow[id].inputs.character_id === fighter) : null;
  if (fighter && !factory) throw new Error(`No character factory for ${fighter} in workflow.api.json.`);
  const original = Object.keys(workflow).find(id => workflow[id].class_type === ART_KINDS[kind] && (!fighter || workflow[id].inputs.character?.[0] === factory));
  const duration = Number(original ? workflow[original].inputs.duration : kind === 'intro' ? 4 : kind === 'idle' ? 6 : 8);
  const clip = ['intro', 'idle', 'title', 'select'].includes(kind);
  const estimatedUSD = Number((clip ? (fighter ? RATES.image1K : 0) + (portraitCut ? RATES.image2K : 0) + duration * video.rate : RATES.image1K).toFixed(6));
  return { fighter, kind, portraitCut, type: ART_KINDS[kind], factory, project, environment, duration, clip, video, estimatedUSD };
}
// Where a game-wide clip lives in video.json, and its id.
const clipKey = planned => planned.fighter ? null : `${planned.kind}Video${planned.portraitCut ? 'Portrait' : ''}`;
const clipId = planned => planned.fighter ? `${planned.kind}-${planned.fighter}` : `${planned.kind}${planned.portraitCut ? '-portrait' : ''}`;
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
    // The menu loops animate the accepted interface art: the cast ensemble or the select backdrop, or the art a game
    // keeps outside its bundle (the original game's arcade title and select art) named by --title-image/--select-image.
    const source = planned.kind === 'title' ? 'ensemble' : 'select', art = options.sourceImage || (planned.kind === 'title' ? options.titleImage : options.selectImage);
    const image = art ? await uploadInput(server, path.resolve(ROOT, art), 'cfz-redraw') : await upload(assets.assets.find(item => item.kind === 'ui' && item.id === source));
    prompt.image = { class_type: 'LoadImage', inputs: { image }, _meta: { title: art ? `Accepted ${path.basename(art)}` : `Accepted ${source} art` } };
    inputs[planned.kind === 'title' ? 'title_image' : 'select_image'] = ['image', 0];
  }
  if (planned.kind === 'intro') { prompt.stage = { class_type: 'LoadImage', inputs: { image: await upload(assets.assets.find(item => item.kind === 'stage')) }, _meta: { title: 'Accepted stage' } }; inputs.stage_reference = ['stage', 0]; }
  if (planned.clip) inputs.duration = String(planned.duration); else inputs.kind = planned.kind;
  if (planned.portraitCut) inputs.portrait = true;
  prompt.redraw = { class_type: planned.type, inputs, _meta: { title: `Redraw ${options.asset} #${count}` } };
  prompt.keep = { class_type: 'PreviewAny', inputs: { source: ['redraw', 0] }, _meta: { title: 'keep' } };
  const missing = await missingNodes(prompt, server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}.`);
  const file = path.join(directory, `redraw-${options.asset}-${count}.api.json`); fs.writeFileSync(file, JSON.stringify(prompt, null, 2) + '\n');
  const { submit, outcome } = require('../../comfyui/tools/run-sequential.cjs');
  const before = new Set(fs.readdirSync(path.join(bundle, 'raw')));
  const entry = { at: now(), asset: options.asset, attempt: count, estimatedUSD: planned.estimatedUSD, approvedUSD: approved, prompt: path.basename(file), ...(planned.clip ? { video: planned.video } : {}) };
  state.artRerolls = [...(state.artRerolls || []), entry]; fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`${options.create ? 'Drawing' : 'Redrawing'} ${options.asset} (attempt ${count}, about $${planned.estimatedUSD}) from the bundle's accepted art; nothing else is touched.`);
  const promptId = submit(file), result = await outcome(server, promptId, 30 * 60000);
  entry.promptId = promptId; entry.ok = result.ok;
  if (!result.ok) { fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n'); throw new Error(`Redraw failed: ${result.error?.exception_type || ''}: ${result.error?.exception_message || 'unknown error'}`); }
  // Point the manifest at the new file; the exporter is not rerun, so nothing else in the bundle changes.
  const prefix = planned.clip ? `${clipId(planned)}-` : `${planned.fighter}_${planned.kind}-`;
  const produced = fs.readdirSync(path.join(bundle, 'raw')).filter(name => name.startsWith(prefix) && !before.has(name));
  if (produced.length !== 1) throw new Error(`Expected one new ${prefix}* file, found ${produced.length}.`);
  const target = path.join(bundle, 'raw', produced[0]), digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (planned.clip) {
    const videoFile = path.join(bundle, 'video.json'), video = fs.existsSync(videoFile) ? read(videoFile) : { schema: 'comfy-fighter-video/v1', root: '.' };
    let record = !planned.fighter ? video[clipKey(planned)] : (planned.kind === 'intro' ? video.fighterIntros : video.selectIdles)?.find(item => item.fighter === planned.fighter);
    // add-media draws clips a run never had: the record is created here, in the shape CFZExportVideos writes.
    if (!record && options.create) {
      record = planned.fighter ? { id: clipId(planned), fighter: planned.fighter } : { id: clipId(planned) };
      if (!planned.fighter) video[clipKey(planned)] = record;
      else (planned.kind === 'intro' ? (video.fighterIntros ||= []) : (video.selectIdles ||= [])).push(record);
    }
    if (!record) throw new Error(`video.json has no ${planned.kind} record${planned.fighter ? ' for ' + planned.fighter : ''}.`);
    record.hasAudio = false;
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
  console.log(`${options.create ? 'Drew' : 'Redrew'} ${options.asset} → ${entry.file}. Review again, then export to a fresh folder.`);
}

// Add the startup and select media a run lacks: one fight introduction and one select idle loop per fighter, the title
// loop and the select loop, and their portrait cuts for phones (title-portrait, select-portrait: the art recomposed
// tall, animated, and packed 720 wide by pack-media). Each clip is drawn like reroll-art (accepted images uploaded
// from the bundle, the character rebuilt from the cast text) and recorded in video.json; clips already mapped are
// skipped, so a rerun resumes after a failure. --title-image and --select-image animate interface art kept outside
// the bundle. The default set is the wide clips; name the portrait cuts in --clips to add them.
const MEDIA_CLIPS = ['intro', 'idle', 'title', 'select', 'title-portrait', 'select-portrait'], DEFAULT_CLIPS = ['intro', 'idle', 'title', 'select'];
const MENU_CLIPS = { title: 'title_video', select: 'select_video', 'title-portrait': 'title_portrait_video', 'select-portrait': 'select_portrait_video' };
function mediaPlan(workflow, bundle, options = {}) {
  const clips = (options.clips || DEFAULT_CLIPS.join(',')).split(',').map(item => item.trim()).filter(Boolean);
  for (const clip of clips) if (!MEDIA_CLIPS.includes(clip)) throw new Error(`--clips takes ${MEDIA_CLIPS.join(', ')}.`);
  const assets = read(path.join(bundle, 'assets.json')), fighters = options.fighters ? options.fighters.split(',').map(item => item.trim()) : assets.game.fighters.map(f => f.id);
  const videoFile = path.join(bundle, 'video.json'), video = fs.existsSync(videoFile) ? read(videoFile) : {};
  const mapped = new Set([video.titleVideo && 'title_video', video.selectVideo && 'select_video', video.titleVideoPortrait && 'title_portrait_video', video.selectVideoPortrait && 'select_portrait_video',
    ...(video.fighterIntros || []).map(item => `${item.fighter}_intro`), ...(video.selectIdles || []).map(item => `${item.fighter}_idle`)].filter(Boolean));
  const wanted = [...fighters.flatMap(id => ['intro', 'idle'].filter(kind => clips.includes(kind)).map(kind => `${id}_${kind}`)),
    ...Object.keys(MENU_CLIPS).filter(kind => clips.includes(kind)).map(kind => MENU_CLIPS[kind])];
  const overrides = { videoModel: options.videoModel, videoResolution: options.videoResolution };
  const todo = wanted.filter(asset => !mapped.has(asset)).map(asset => ({ asset, plan: artPlan(workflow, asset, overrides) }));
  for (const [kind, file] of [['title', options.titleImage], ['select', options.selectImage]]) {
    if (file) { if (!fs.existsSync(path.resolve(ROOT, file))) throw new Error(`--${kind}-image ${file} does not exist.`); continue; }
    const source = kind === 'title' ? 'ensemble' : 'select';
    if (todo.some(item => item.asset === `${kind}_video` || item.asset === `${kind}_portrait_video`) && !assets.assets.some(item => item.kind === 'ui' && item.id === source)) throw new Error(`The ${kind} loop animates ui/${source}, which the bundle lacks; pass --${kind}-image <file>.`);
  }
  return { todo, skipped: wanted.filter(asset => mapped.has(asset)), estimatedUSD: Number(todo.reduce((sum, item) => sum + item.plan.estimatedUSD, 0).toFixed(6)) };
}
async function addMedia(options) {
  const directory = runDirectory(options), bundle = path.join(directory, 'bundle'), workflow = read(path.join(directory, 'workflow.api.json'));
  if (!fs.existsSync(path.join(bundle, 'assets.json'))) throw new Error('No bundle/assets.json yet; generate or accept the art first.');
  const planned = mediaPlan(workflow, bundle, options), approved = Number(options.approveUsd);
  if (!planned.todo.length) { console.log(`Every requested clip is already mapped (${planned.skipped.length}).`); return planned; }
  if (!Number.isFinite(approved) || approved < planned.estimatedUSD) throw new Error(`Adding ${planned.todo.length} clips costs about $${planned.estimatedUSD}; pass --approve-usd ${Math.ceil(planned.estimatedUSD * 100) / 100} (or more) once authorized.`);
  const state = pipeline(directory), entry = { at: now(), clips: planned.todo.map(item => item.asset), skipped: planned.skipped, estimatedUSD: planned.estimatedUSD, approvedUSD: approved };
  state.addedMedia = [...(state.addedMedia || []), entry]; fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Adding ${planned.todo.length} clips (about $${planned.estimatedUSD})${planned.skipped.length ? `, ${planned.skipped.length} already mapped` : ''}, one paid clip at a time.`);
  for (const { asset, plan } of planned.todo) {
    const sourceImage = asset.startsWith('title_') ? options.titleImage : asset.startsWith('select_') ? options.selectImage : undefined;
    await rerollArt({ ...options, asset, create: true, sourceImage, approveUsd: String(plan.estimatedUSD) });
  }
  const done = pipeline(directory); done.addedMedia[done.addedMedia.length - 1].ok = true; fs.writeFileSync(path.join(directory, 'pipeline.json'), JSON.stringify(done, null, 2) + '\n');
  console.log(`Added ${planned.todo.length} clips to video.json. Review them (node build/tools/new-game.cjs review --run ${path.relative(ROOT, directory).replace(/\\/g, '/')}), then export to a fresh folder.`);
  return planned;
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

// The game-select title card (CFZTitleCard): a game's accepted key art with its own name lettered across it, one 2K
// image. Cache-independent like reroll-art: the key art is uploaded from disk and a repeat draws with a fresh seed.
//   --run <run>         a cast run: the bundle's ui/ensemble lettered with the subtitle (the edition's name) over the
//                       title; the card joins assets.json as ui/card, then export and install as usual.
//   --example           the included example: the original cast's arcade title ensemble lettered with the title over
//                       the subtitle; the card joins example/bundle as a lossless WebP with provenance.
//   --crossover <file>  a crossover definition: its four-game key-art composite lettered with the subtitle over the title,
//                       written to the definition's interface.card file for the next crossover build.
// --title and --tagline change the lettering.
const TITLE_CARD_USD = RATES.image2K;
async function uploadInput(server, file, subfolder) {
  const form = new FormData(), name = path.basename(file);
  form.append('image', new Blob([fs.readFileSync(file)], { type: /\.webp$/i.test(name) ? 'image/webp' : 'image/png' }), name);
  form.append('subfolder', subfolder); form.append('overwrite', 'true');
  const response = await fetch(`${server}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`ComfyUI refused the reference upload (${response.status}).`);
  const info = await response.json(); return `${info.subfolder ? info.subfolder + '/' : ''}${info.name}`;
}
// Project settings for sources without a run workflow: the node's own defaults, read from the running server.
async function projectDefaults(server, overrides) {
  const info = await fetch(`${server}/object_info/CFZProjectSettings`).then(response => response.json()).catch(() => ({}));
  const inputs = info.CFZProjectSettings?.input; if (!inputs) throw new Error(`The ComfyUI at ${server} lacks CFZProjectSettings; install the node pack and restart it.`);
  const defaults = Object.fromEntries(Object.entries({ ...inputs.required, ...inputs.optional }).filter(([, spec]) => spec?.[1]?.default !== undefined).map(([key, spec]) => [key, spec[1].default]));
  return { ...defaults, ...overrides };
}
function titleCardSource(options) {
  const modes = ['run', 'example', 'crossover'].filter(key => options[key]);
  if (modes.length !== 1) throw new Error('Choose one title-card source: --run output/test-runs/<name>, --example or --crossover build/crossovers/<name>.json.');
  if (options.run) {
    const directory = runDirectory(options), bundle = path.join(directory, 'bundle'), assets = read(path.join(bundle, 'assets.json'));
    const ensemble = assets.assets.find(item => item.kind === 'ui' && item.id === 'ensemble');
    if (!ensemble) throw new Error('The run has no accepted ui/ensemble key art to letter; generate the startup media first.');
    return { mode: 'run', label: path.relative(ROOT, directory), reference: path.join(bundle, ensemble.src), root: bundle, state: directory,
      title: assets.game.subtitle || assets.game.title, tagline: assets.game.title, directory, bundle };
  }
  if (options.example) {
    const example = path.join(ROOT, 'example/bundle'), game = read(path.join(example, 'assets.json')).game;
    // The original game is named by its title; every other edition by its subtitle.
    return { mode: 'example', label: 'example/bundle', reference: path.join(ROOT, 'build/public/arcade/title-ensemble.webp'), root: path.join(ROOT, 'output/test-runs/title-card-example'),
      title: game.title, tagline: game.subtitle, project: { title: game.title, subtitle: game.subtitle }, example };
  }
  const { loadDefinition } = require('./crossover.cjs'), file = path.resolve(ROOT, options.crossover), definition = loadDefinition(file);
  const target = definition.interface?.card;
  if (typeof target !== 'string' || !target.startsWith('output/')) throw new Error(`${path.relative(ROOT, file)} needs interface.card: the output/ file the crossover build copies, such as output/crossovers/${definition.slot}/card.png.`);
  if (!Array.isArray(definition.ensemble)) throw new Error('The crossover needs its ensemble list: the card letters that key-art composite.');
  const root = path.join(ROOT, 'output/crossovers', definition.slot);
  return { mode: 'crossover', label: path.relative(ROOT, file), definition, root, title: definition.subtitle || definition.title, tagline: definition.title,
    project: { title: definition.title, subtitle: definition.subtitle || '' }, target: path.resolve(ROOT, target) };
}
async function titleCard(options) {
  const source = titleCardSource(options), approved = Number(options.approveUsd);
  if (!Number.isFinite(approved) || approved < TITLE_CARD_USD) throw new Error(`A title card is one 2K image, about $${TITLE_CARD_USD}; pass --approve-usd 0.08 (or more) once authorized.`);
  const server = (options.server || 'http://127.0.0.1:8188').replace(/\/$/, ''), title = options.title || source.title, tagline = options.tagline || source.tagline;
  fs.mkdirSync(source.root, { recursive: true });
  if (source.mode === 'crossover') {
    const { ensembleArt } = require('./crossover.cjs');
    source.reference = path.join(source.root, 'key-art.webp');
    await ensembleArt(source.definition.ensemble.map(file => path.resolve(ROOT, file)), source.reference);
  }
  const stateFile = path.join(source.mode === 'run' ? source.directory : source.root, 'pipeline.json');
  const state = fs.existsSync(stateFile) ? read(stateFile) : { schema: 'comfy-fighter-pipeline/v1', run: path.relative(ROOT, source.root).split(path.sep).join('/'), steps: {} };
  const attempt = (state.titleCards || []).length + 1, save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  const base = source.mode === 'run' ? read(path.join(source.directory, 'workflow.api.json')) : null;
  const projectInputs = base ? Object.values(base).find(item => item.class_type === 'CFZProjectSettings')?.inputs : await projectDefaults(server, source.project);
  if (!projectInputs) throw new Error('The run workflow has no CFZProjectSettings node.');
  const prompt = {
    project: { class_type: 'CFZProjectSettings', inputs: { ...projectInputs, root_directory: source.root, seed: (Number(projectInputs.seed) + attempt * 1000) % 2 ** 32 }, _meta: { title: `Project settings | title card #${attempt}` } },
    art: { class_type: 'LoadImage', inputs: { image: await uploadInput(server, source.reference, 'cfz-title-card') }, _meta: { title: 'Accepted key art' } },
    card: { class_type: 'CFZTitleCard', inputs: { project: ['project', 0], title_image: ['art', 0], title_text: title, tagline_text: tagline }, _meta: { title: `Title card #${attempt}: ${title}` } },
    keep: { class_type: 'PreviewAny', inputs: { source: ['card', 0] }, _meta: { title: 'keep' } }
  };
  const missing = await missingNodes(prompt, server);
  if (missing.length) throw new Error(`The running ComfyUI lacks ${missing.join(', ')}; install the node pack and restart it.`);
  const file = path.join(path.dirname(stateFile), `title-card-${attempt}.api.json`); fs.writeFileSync(file, JSON.stringify(prompt, null, 2) + '\n');
  const raw = path.join(source.root, 'raw'), before = new Set(fs.existsSync(raw) ? fs.readdirSync(raw) : []);
  const entry = { at: now(), source: source.label, attempt, title, tagline, estimatedUSD: TITLE_CARD_USD, approvedUSD: approved, prompt: path.relative(ROOT, file).split(path.sep).join('/') };
  state.titleCards = [...(state.titleCards || []), entry]; save();
  console.log(`Lettering "${title}" / "${tagline}" over ${path.relative(ROOT, source.reference)} (attempt ${attempt}, about $${TITLE_CARD_USD}).`);
  const { submit, outcome } = require('../../comfyui/tools/run-sequential.cjs');
  const promptId = submit(file), result = await outcome(server, promptId, 30 * 60000);
  entry.promptId = promptId; entry.ok = result.ok; save();
  if (!result.ok) throw new Error(`Title card failed: ${result.error?.exception_type || ''}: ${result.error?.exception_message || 'unknown error'}`);
  const produced = (fs.existsSync(raw) ? fs.readdirSync(raw) : []).filter(name => /^card-[0-9a-f]{16}\.png$/.test(name) && !before.has(name));
  if (produced.length !== 1) throw new Error(`Expected one new raw/card-*.png, found ${produced.length}.`);
  const output = path.join(raw, produced[0]), bytes = fs.readFileSync(output), digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const { loadImage } = require('@napi-rs/canvas'), image = await loadImage(bytes);
  entry.file = path.relative(ROOT, output).split(path.sep).join('/');
  if (source.mode === 'run') {
    const assetsFile = path.join(source.bundle, 'assets.json'), assets = read(assetsFile), record = { id: 'card', kind: 'ui', key: false, src: `raw/${produced[0]}`, sha256: digest, width: image.width, height: image.height };
    const at = assets.assets.findIndex(item => item.id === 'card');
    if (at >= 0) assets.assets[at] = record; else assets.assets.push(record);
    if (Array.isArray(assets.game.expectedAssets) && !assets.game.expectedAssets.includes('card')) assets.game.expectedAssets.push('card');
    fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n');
    console.log(`Mapped ui/card → bundle/raw/${produced[0]}. Review it, then export to a fresh folder and install the slot again.`);
  } else if (source.mode === 'example') {
    const { losslessImage } = require('./package-example.cjs'), { verifyBundle, hash } = require('./lib/example-bundle.cjs');
    const assetsFile = path.join(source.example, 'assets.json'), assets = read(assetsFile), provenanceFile = path.join(source.example, 'provenance.json'), provenance = read(provenanceFile);
    const src = 'raw/card.webp', verified = await losslessImage(output, path.join(source.example, src)), encoded = fs.readFileSync(path.join(source.example, src));
    const record = { id: 'card', kind: 'ui', key: false, src, width: verified.width, height: verified.height, sha256: hash(encoded), bytes: encoded.length };
    const at = assets.assets.findIndex(item => item.id === 'card');
    if (at >= 0) assets.assets[at] = record; else assets.assets.push(record);
    if (Array.isArray(assets.game.expectedAssets) && !assets.game.expectedAssets.includes('card')) assets.game.expectedAssets.push('card');
    const evidence = { id: 'card', sourceSha256: hash(bytes), packagedSha256: hash(encoded), sourceBytes: bytes.length, bytes: encoded.length, ...verified };
    const known = provenance.images.findIndex(item => item.id === 'card');
    if (known >= 0) provenance.images[known] = evidence; else provenance.images.push(evidence);
    provenance.titleCard = { addedAt: now().slice(0, 10), run: path.relative(ROOT, source.root).split(path.sep).join('/'), promptId, model: projectInputs.model, estimatedUSD: TITLE_CARD_USD, title, tagline,
      note: 'CFZTitleCard lettering over build/public/arcade/title-ensemble.webp (the original cast\'s title art), for the game-select menu.' };
    fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n'); fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + '\n');
    const checked = await verifyBundle(source.example);
    console.log(`Added ui/card to example/bundle (lossless WebP, identical pixels); verifier OK with ${checked.manifest.assets.length} images. Run npm run example, then adopt the export.`);
  } else {
    fs.mkdirSync(path.dirname(source.target), { recursive: true }); fs.copyFileSync(output, source.target);
    console.log(`Wrote ${path.relative(ROOT, source.target)}; rebuild the crossover to use it.`);
  }
  save();
}

async function main(argv) {
  const { command, options } = parse(argv);
  const commands = { prepare, run, reroll, 'reroll-art': rerollArt, 'add-sheets': addSheets, 'add-scenery': addScenery, 'add-media': addMedia, 'title-card': titleCard, review, 'pack-media': packMedia, export: exportGame, install, status };
  if (!commands[command]) throw new Error(USAGE);
  await commands[command](options);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, prepare, run, review, reroll, rerollPlan, rerollArt, artPlan, addSheets, sheetPlan, addMedia, mediaPlan, acceptBundle, titleCard, titleCardSource, TITLE_CARD_USD, packMedia, packageFloor, exportGame, install, pipeline, missingNodes, videoClips, VIDEO_KEYS };
