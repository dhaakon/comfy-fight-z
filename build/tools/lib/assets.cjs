const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const DEFAULT_ROOT = path.resolve(__dirname, '../../..');
const ID = /^[a-z0-9][a-z0-9_-]*$/i;
const KINDS = new Set(['source', 'reference', 'sprites', 'portrait', 'hero', 'cutin', 'ending', 'stage', 'ui', 'effects']);

function inside(root, relative) {
  const base = path.resolve(root), file = path.resolve(base, relative);
  if (file === base || !file.startsWith(base + path.sep)) throw new Error(`Path escapes directory: ${relative}`);
  return file;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

function readProject(root = DEFAULT_ROOT) {
  root = path.resolve(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'comfyui/config/game.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'comfyui/assets/plan.json'), 'utf8'));
  if (plan.version !== 1 || !Array.isArray(plan.jobs)) throw new Error('Expected asset plan version 1 and a jobs array');
  if (!Array.isArray(config.fighters) || !Array.isArray(config.stages)) throw new Error('Game config requires fighters and stages');
  const fighterIds = new Set(), stageIds = new Set(), jobIds = new Set(), outputs = new Set();
  for (const [items, ids] of [[config.fighters, fighterIds], [config.stages, stageIds]]) {
    for (const item of items) {
      if (!ID.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate config id: ${item.id}`);
      ids.add(item.id);
    }
  }
  for (const job of plan.jobs) {
    if (!ID.test(job.id) || jobIds.has(job.id)) throw new Error(`Invalid or duplicate job id: ${job.id}`);
    jobIds.add(job.id);
    if (!KINDS.has(job.kind)) throw new Error(`Unknown asset kind: ${job.kind}`);
    if (typeof job.output !== 'string' || !job.output.replaceAll('\\', '/').startsWith('output/assets/generated/raw/')) throw new Error(`Invalid raw output: ${job.output}`);
    const output = inside(path.join(root, 'output/assets/generated/raw'), path.relative(path.join(root, 'output/assets/generated/raw'), inside(root, job.output)));
    if (outputs.has(output)) throw new Error(`Duplicate raw output: ${job.output}`);
    outputs.add(output);
    if (job.fighter && !fighterIds.has(job.fighter)) throw new Error(`Unknown fighter: ${job.fighter}`);
    if (job.stage && !stageIds.has(job.stage)) throw new Error(`Unknown stage: ${job.stage}`);
    if (['sprites', 'portrait', 'hero', 'cutin', 'ending'].includes(job.kind) && !job.fighter) throw new Error(`${job.id} needs a fighter`);
    if (job.kind === 'stage' && !job.stage) throw new Error(`${job.id} needs a stage`);
    if (job.kind === 'sprites' || job.kind === 'effects') {
      if (!Array.isArray(job.poses) || job.poses.length !== 9 || new Set(job.poses).size !== 9 || job.poses.some(p => !ID.test(p))) {
        throw new Error(`${job.id} needs nine unique, valid pose names`);
      }
    }
  }
  return { root, config, plan };
}

function keyGreen(image) {
  // Mirrors the browser builder (public/builder/pack.js).
  const context = image.getContext('2d', { willReadFrequently: true }), pixels = context.getImageData(0, 0, image.width, image.height), d = pixels.data;
  const { width, height } = image;
  for (let i = 0; i < d.length; i += 4) {
    const limit = Math.max(d[i], d[i + 2]), spill = d[i + 1] - limit;
    if (spill > 80) { d[i + 3] = 0; continue; }
    if (spill > 22) d[i + 3] = Math.round(d[i + 3] * (1 - (spill - 22) / 58));
    if (spill > 8) d[i + 1] = limit + 8;
  }
  // Edge pass: a translucent pixel beside two or more transparent neighbours is fringe, not ink.
  const alpha = new Uint8ClampedArray(width * height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = d[p * 4 + 3];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, a = alpha[p];
    if (a === 0 || a === 255) continue;
    const clear = (x > 0 && alpha[p - 1] === 0) + (x < width - 1 && alpha[p + 1] === 0) + (y > 0 && alpha[p - width] === 0) + (y < height - 1 && alpha[p + width] === 0);
    if (clear >= 2) d[p * 4 + 3] = a < 110 ? 0 : Math.round(a * .6);
  }
  context.putImageData(pixels, 0, 0);
}

function bounds(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let left = w, right = -1, top = h, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 30) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error('Empty cell after background removal');
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function mirrored(cell) {
  const flipped = createCanvas(cell.canvas.width, cell.canvas.height), context = flipped.getContext('2d');
  context.translate(flipped.width, 0); context.scale(-1, 1); context.drawImage(cell.canvas, 0, 0);
  return { canvas: flipped, bounds: bounds(flipped) };
}
// Mirrors the browser builder: fighter sheets keep native resolution (up to 2100 px); `mirror` lists cells to flip.
async function sheetCells(file, poses, keyed = true, { native = false, mirror = [] } = {}) {
  const image = await loadImage(file);
  const flip = out => { for (const pose of mirror) if (out[pose]) out[pose] = mirrored(out[pose]); return out; };
  if (image.width < 90 || image.height < 90) throw new Error(`Sheet too small: ${file}`);
  if (Math.abs(image.width - image.height) / Math.max(image.width, image.height) > 0.02) {
    throw new Error(`Expected a square 3x3 sheet (within 2%); received ${image.width}x${image.height}: ${file}`);
  }
  const cw = image.width / 3, ch = image.height / 3;
  const out = {};
  if (keyed) {
    const { segmentSheet } = await import('../../public/builder/sheet-layout.mjs');
    const width = native ? Math.min(Math.max(image.width, 1260), 2100) : 1260;
    const sheet = createCanvas(width, Math.round(width * image.height / image.width)), ctx = sheet.getContext('2d');
    ctx.drawImage(image, 0, 0, sheet.width, sheet.height); keyGreen(sheet);
    let cells;
    try { cells = segmentSheet(ctx.getImageData(0, 0, sheet.width, sheet.height).data, sheet.width, sheet.height); }
    catch (error) { throw new Error(`${path.basename(file)}: ${error.message}`); }
    cells.forEach((pixels, i) => {
      const canvas = createCanvas(pixels.width, pixels.height), context = canvas.getContext('2d');
      const data = context.createImageData(pixels.width, pixels.height); data.data.set(pixels.data); context.putImageData(data, 0, 0);
      out[poses[i]] = { canvas, bounds: bounds(canvas) };
    });
    return flip(out);
  }
  const size = native ? Math.min(Math.max(cw, 420), 700) : 420;
  for (let i = 0; i < 9; i++) {
    // Normalize resolution before applying the fighter's shared body scale.
    const canvas = createCanvas(size, Math.round(size * ch / cw));
    canvas.getContext('2d').drawImage(image, (i % 3) * cw, Math.floor(i / 3) * ch,
      cw, ch, 0, 0, canvas.width, canvas.height);
    try { out[poses[i]] = { canvas, bounds: bounds(canvas) }; }
    catch (error) { throw new Error(`${path.basename(file)} / ${poses[i]}: ${error.message}`); }
  }
  return flip(out);
}

async function saveCanvas(canvas, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // High-quality WebP retains the alpha channel used by the renderer.
  const bytes = await canvas.encode('webp', 100);
  fs.writeFileSync(destination, bytes);
}

async function exportCell(cell, scale, destination) {
  const b = cell.bounds, pad = 4;
  const x = Math.max(0, b.left - pad), y = Math.max(0, b.top - pad);
  const sw = Math.min(cell.canvas.width, b.right + pad + 1) - x;
  const sh = Math.min(cell.canvas.height, b.bottom + pad + 1) - y;
  const canvas = createCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cell.canvas, x, y, sw, sh, 0, 0, canvas.width, canvas.height);
  const actual = bounds(canvas), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const band = actual.bottom - Math.max(1, Math.round(actual.height * 0.18));
  let sum = 0, count = 0;
  for (let yy = band; yy <= actual.bottom; yy++) for (let xx = 0; xx < canvas.width; xx++) {
    if (yy >= 0 && pixels[(yy * canvas.width + xx) * 4 + 3] > 30) { sum += xx; count++; }
  }
  await saveCanvas(canvas, destination);
  return { w: canvas.width, h: canvas.height, ax: Math.round(count ? sum / count : canvas.width / 2),
    ay: actual.bottom, top: actual.top, bh: actual.bottom - actual.top };
}

async function exportImage(file, destination, { width, height, square = false, key = false } = {}) {
  const image = await loadImage(file);
  let sx = 0, sy = 0, sw = image.width, sh = image.height;
  if (square) { sw = sh = Math.min(image.width, image.height); sx = (image.width - sw) / 2; sy = (image.height - sh) * 0.3; }
  const w = width || Math.round(sw * (height || sh) / sh);
  const h = height || Math.round(sh * w / sw);
  const canvas = createCanvas(w, h);
  canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  if (key) { keyGreen(canvas); bounds(canvas); }
  await saveCanvas(canvas, destination);
}

function verifyDirectory(root, directory) {
  const actualRoot = fs.realpathSync(root), actual = fs.realpathSync(directory);
  if (!actual.startsWith(actualRoot + path.sep)) throw new Error(`Generated directory escapes project: ${directory}`);
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Generated directory cannot be a symbolic link: ${directory}`);
}

function removeAssetStaging(root, staging) {
  const build = path.join(root, 'output/diagnostics');
  if (path.dirname(staging) !== build || !path.basename(staging).startsWith('asset-stage-')) {
    throw new Error(`Refusing unexpected staging cleanup: ${staging}`);
  }
  // Resolve the final absolute target before recursive deletion; only this build's staging is eligible.
  verifyDirectory(root, build);
  verifyDirectory(root, staging);
  fs.rmSync(staging, { recursive: true, force: true });
}

function publishAssets(root, staging) {
  const publicDirectory = path.join(root, 'build/public'), destination = path.join(publicDirectory, 'assets');
  fs.mkdirSync(publicDirectory, { recursive: true });
  verifyDirectory(root, publicDirectory);
  if (fs.existsSync(destination)) verifyDirectory(root, destination);
  const previous = path.join(staging, 'previous-assets');
  let movedPrevious = false;
  if (fs.existsSync(destination)) {
    fs.renameSync(destination, previous);
    movedPrevious = true;
  }
  try {
    fs.renameSync(path.join(staging, 'assets'), destination);
  } catch (error) {
    if (movedPrevious) {
      try { fs.renameSync(previous, destination); }
      catch (restoreError) {
        throw new Error(`Publish failed: ${error.message}; restore failed: ${restoreError.message}. Prior assets preserved at ${previous}`);
      }
    }
    throw error;
  }
}

async function buildAssets({ root = DEFAULT_ROOT, strict = false } = {}) {
  const project = readProject(root), { config, plan } = project;
  root = project.root;
  const buildDirectory = path.join(root, 'output/diagnostics');
  fs.mkdirSync(buildDirectory, { recursive: true });
  verifyDirectory(root, buildDirectory);
  const report = { version: 1, strict, jobs: plan.jobs.length, built: [], missing: [], warnings: [], errors: [] };
  const reportFile = path.join(root, 'output/diagnostics/asset-report.json');
  const present = [];
  for (const job of plan.jobs) {
    if (fs.existsSync(inside(root, job.output))) present.push(job);
    else report.missing.push(job.id);
  }
  if (report.missing.length) report.warnings.push(`Missing ${report.missing.length} raw assets; runtime placeholders will be used.`);
  if (strict && report.missing.length) {
    report.errors.push(`Strict build requires all raw assets: ${report.missing.join(', ')}`);
    writeJson(reportFile, report);
    throw new Error(report.errors[0]);
  }
  const manifest = { version: 1, title: config.title, subtitle: config.subtitle || '',
    fighters: config.fighters.map(({ id, name, color, description, specialMove, introTagline, superMove, style, winQuote, ending, boss }) => ({ id, name, color, description, specialMove, introTagline, ...(superMove ? { superMove } : {}), ...(style ? { style } : {}), ...(winQuote ? { winQuote } : {}), ...(ending ? { ending } : {}), ...(boss ? { boss: true } : {}), poses: {} })),
    stages: config.stages.map(({ id, name, description }) => ({ id, name, description })), ui: {}, effects: {}, audio: {} };
  const fighters = new Map(manifest.fighters.map(f => [f.id, f]));
  const stages = new Map(manifest.stages.map(s => [s.id, s]));
  const spriteCells = new Map();
  const staging = fs.mkdtempSync(path.join(buildDirectory, 'asset-stage-'));
  let published = false;
  try {
    // Supplied photos remain clearly identified as references in the local preview.
    // Generated portraits and sprites replace them through the normal asset build.
    for (const item of [...config.fighters, ...config.stages]) if (item.sourceImage) {
      const file = inside(root, item.sourceImage);
      if (!fs.existsSync(file)) { report.warnings.push(`Source reference missing: ${item.sourceImage}`); continue; }
      await loadImage(file);
      const extension = path.extname(file).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error(`Unsupported source reference: ${item.sourceImage}`);
      const src = `assets/references/${item.id}${extension}`, target = inside(staging, src);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target);
      (fighters.get(item.id) || stages.get(item.id)).sourceImage = src;
    }
    for (const job of present.filter(j => j.kind === 'sprites')) {
      const collection = spriteCells.get(job.fighter) || {};
      const cells = await sheetCells(inside(root, job.output), job.poses, job.key !== false, { native: true, mirror: job.mirror || [] });
      for (const [pose, cell] of Object.entries(cells)) {
        if (collection[pose]) throw new Error(`Duplicate pose ${job.fighter}/${pose}`);
        collection[pose] = { ...cell, sheet: job.sheet || job.id };
      }
      spriteCells.set(job.fighter, collection);
      report.built.push(job.id);
    }
    for (const [fighterId, cells] of spriteCells) {
      if (!cells.idle) report.warnings.push(`${fighterId}: idle unavailable; using first pose as scale reference until idle is imported.`);
      const baseline = cells.idle || Object.values(cells)[0];
      const scale = 400 / Math.max(1, baseline.bounds.height - 1);
      const { poseScales } = await import('../../public/builder/sheet-layout.mjs'), corrections = poseScales(new Map(Object.entries(cells)));
      for (const [pose, cell] of Object.entries(cells)) {
        const src = `assets/fighters/${fighterId}_${pose}.webp`;
        fighters.get(fighterId).poses[pose] = { src, ...await exportCell(cell, scale * (corrections.get(pose) || 1), inside(staging, src)) };
      }
    }
    for (const job of present.filter(j => j.kind !== 'sprites')) {
      const file = inside(root, job.output);
      if (job.kind === 'source') {
        await loadImage(file); const src = `assets/references/${job.id}.png`, target = inside(staging, src);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target);
        (job.fighter ? fighters.get(job.fighter) : stages.get(job.stage)).sourceImage = src;
        report.built.push(job.id); continue;
      }
      if (job.kind === 'reference') { await loadImage(file); report.built.push(job.id); continue; }
      if (job.kind === 'effects') {
        const cells = await sheetCells(file, job.poses, job.key !== false);
        for (const [pose, cell] of Object.entries(cells)) {
          if (manifest.effects[pose]) throw new Error(`Duplicate effect pose ${pose}`);
          const src = `assets/effects/${pose}.webp`;
          manifest.effects[pose] = { src, ...await exportCell(cell, 1, inside(staging, src)) };
        }
      } else {
        const directories = { portrait: 'portraits', hero: 'heroes', cutin: 'cutins', ending: 'endings', stage: 'stages', ui: 'ui' };
        const src = `assets/${directories[job.kind]}/${job.id}.webp`;
        const options = { key: Boolean(job.key) };
        if (job.kind === 'portrait') Object.assign(options, { width: 320, square: true });
        if (job.kind === 'hero') options.height = 760;
        if (job.kind === 'cutin' || job.kind === 'ending') options.width = 960;
        if (job.kind === 'stage') options.width = 1600;
        await exportImage(file, inside(staging, src), options);
        if (job.fighter) fighters.get(job.fighter)[job.kind === 'ending' ? 'endingArt' : job.kind] = src;
        else if (job.kind === 'stage') stages.get(job.stage).src = src;
        else manifest.ui[job.id] = src;
      }
      report.built.push(job.id);
    }
    writeJson(path.join(staging, 'assets/manifest.json'), manifest);
    writeJson(reportFile, report);
    publishAssets(root, staging);
    published = true;
    return { manifest, report };
  } catch (error) {
    report.errors.push(error.message); writeJson(reportFile, report); throw error;
  } finally {
    // Keep the backup if publishing and rollback both failed, so recovery is possible.
    if (published || !fs.existsSync(path.join(staging, 'previous-assets'))) {
      try { removeAssetStaging(root, staging); }
      catch (cleanupError) {
        if (!published) throw cleanupError;
        console.warn(`Assets published; staging cleanup deferred: ${cleanupError.message}`);
      }
    }
  }
}

function walkPngs(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...walkPngs(file));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) result.push(file);
  }
  return result;
}

function importAssets({ root = DEFAULT_ROOT, from, strict = false } = {}) {
  if (!from) throw new Error('Supply --from <ComfyUI/output>');
  const project = readProject(root), files = walkPngs(path.resolve(from));
  const report = { imported: [], unchanged: [], missing: [], selections: [] };
  const actions = [];
  for (const job of project.plan.jobs) {
    const regex = new RegExp(`^${job.id}(?:_\\d+_?)?\\.png$`, 'i');
    const matches = files.filter(file => regex.test(path.basename(file))).map(file => ({ file, time: fs.statSync(file).mtimeMs }));
    matches.sort((a, b) => b.time - a.time || a.file.localeCompare(b.file));
    if (!matches.length) { report.missing.push(job.id); continue; }
    if (matches.length > 1 && matches[0].time === matches[1].time) {
      throw new Error(`Ambiguous newest output for ${job.id}: ${matches.filter(m => m.time === matches[0].time).map(m => m.file).join(', ')}. Keep only the intended output in the import directory.`);
    }
    const selected = matches[0].file, target = inside(project.root, job.output);
    report.selections.push({ id: job.id, selected, candidates: matches.length });
    actions.push({ id: job.id, selected, target });
  }
  if (strict && report.missing.length) throw new Error(`Missing outputs: ${report.missing.join(', ')}`);
  for (const { id, selected, target } of actions) {
    const content = fs.readFileSync(selected);
    const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    if (fs.existsSync(target) && digest(content) === digest(fs.readFileSync(target))) { report.unchanged.push(id); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    report.imported.push(id);
  }
  writeJson(path.join(project.root, 'output/diagnostics/import-report.json'), report);
  return report;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--strict') args.strict = true;
    else if (['--root', '--from', '--out'].includes(token)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${token}`);
      args[token.slice(2)] = argv[++i];
    } else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

module.exports = { DEFAULT_ROOT, inside, writeJson, readProject, keyGreen, bounds, sheetCells, exportCell, exportImage, buildAssets, importAssets, parseArgs };
