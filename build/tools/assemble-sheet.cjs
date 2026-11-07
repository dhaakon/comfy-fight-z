// Assemble a reviewed sprite sheet from cells of several generations of the same sheet (same fighter, same prompt).
// Pixels are copied exactly (no resampling); each moved figure must lie inside its cell in the source.
// Usage: node build/tools/assemble-sheet.cjs <run dir> <asset id> <base png> <cell>=<source png> [...]
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const keyed = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; return g > 120 && g > r * 1.25 && g > b * 1.25; };
const rect = (cell, W, H) => ({ x0: Math.round(cell % 3 * W / 3), x1: Math.round((cell % 3 + 1) * W / 3), y0: Math.round(Math.floor(cell / 3) * H / 3), y1: Math.round((Math.floor(cell / 3) + 1) * H / 3) });
(async () => {
  const [run, id, base, ...swaps] = process.argv.slice(2);
  if (!run || !id || !base || !swaps.length) throw new Error('Usage: assemble-sheet.cjs <run dir> <asset id> <base png> <cell>=<source png> [...]');
  const bundle = path.resolve(run, 'bundle'), file = path.join(bundle, 'assets.json'), assets = JSON.parse(fs.readFileSync(file, 'utf8'));
  const record = assets.assets.find(asset => asset.id === id); if (!record) throw new Error(`No asset ${id}`);
  const baseImage = await loadImage(base), W = baseImage.width, H = baseImage.height, out = createCanvas(W, H), ctx = out.getContext('2d');
  ctx.drawImage(baseImage, 0, 0); const sources = { base: path.basename(base), cells: {} };
  for (const swap of swaps) {
    const [cellText, source] = swap.split('='), cell = Number(cellText), image = await loadImage(source);
    if (image.width !== W || image.height !== H) throw new Error(`${source} is ${image.width}x${image.height}, base is ${W}x${H}`);
    const scratch = createCanvas(W, H), sctx = scratch.getContext('2d'); sctx.drawImage(image, 0, 0);
    const { x0, x1, y0, y1 } = rect(cell, W, H), pixels = sctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = pixels.data, w = x1 - x0, h = y1 - y0;
    // The moved figure must not touch the cell border, or part of it would be left behind in the neighbour.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x < 3 || x >= w - 3 || y < 3 || y >= h - 3) && !keyed(d, (y * w + x) * 4)) throw new Error(`Cell ${cell} of ${path.basename(source)} touches its border at ${x},${y}.`);
    ctx.putImageData(pixels, x0, y0); sources.cells[cell] = path.basename(source);
  }
  const bytes = await out.encode('png'), digest = crypto.createHash('sha256').update(bytes).digest('hex'), name = `${id}-assembled-${digest.slice(0, 16)}.png`;
  fs.writeFileSync(path.join(bundle, 'raw', name), bytes);
  const aside = path.resolve(run, 'set-aside'); fs.mkdirSync(aside, { recursive: true });
  if (fs.existsSync(path.join(bundle, record.src))) fs.renameSync(path.join(bundle, record.src), path.join(aside, path.basename(record.src)));
  Object.assign(record, { src: `raw/${name}`, sha256: digest, width: W, height: H });
  fs.writeFileSync(file, JSON.stringify(assets, null, 2) + '\n');
  const pipelineFile = path.resolve(run, 'pipeline.json'), state = JSON.parse(fs.readFileSync(pipelineFile, 'utf8'));
  (state.assembledSheets ||= []).push({ id, file: name, ...sources, note: 'Reviewed assembly: cells copied pixel for pixel from earlier generations of the same sheet.' });
  fs.writeFileSync(pipelineFile, JSON.stringify(state, null, 2) + '\n');
  console.log(`${id}: assembled ${name} from ${sources.base} with cells ${Object.entries(sources.cells).map(([c, s]) => `${c}<-${s}`).join(', ')}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
