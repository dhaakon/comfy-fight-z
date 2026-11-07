// Count full-size figures on every fighter sheet of a bundle (keyed like the builder). A sheet that is not exactly
// nine figures needs reviewed picks or a redraw. Usage: node build/tools/sheet-figures.mjs <bundle dir> [fighter]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const [bundle, only] = process.argv.slice(2), assets = JSON.parse(fs.readFileSync(path.join(bundle, 'assets.json'), 'utf8'));
const key = d => { for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (g > 120 && g > r * 1.25 && g > b * 1.25) d[i + 3] = 0; } };
for (const rec of assets.assets.filter(a => a.kind === 'sprites' && (!only || a.fighter === only))) {
  const img = await loadImage(path.join(bundle, rec.src)), W = 700, H = Math.round(700 * img.height / img.width), c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H); const { data } = ctx.getImageData(0, 0, W, H); key(data);
  const labels = new Int32Array(W * H), q = new Int32Array(W * H), comps = [];
  for (let s = 0; s < W * H; s++) { if (labels[s] || data[s * 4 + 3] <= 30) continue; const it = { n: 0, l: W, t: H, r: -1, b: -1, sx: 0, sy: 0 }; let h = 0, tl = 1; q[0] = s; labels[s] = comps.length + 1;
    while (h < tl) { const k = q[h++], x = k % W, y = (k / W) | 0; it.n++; it.sx += x; it.sy += y; it.l = Math.min(it.l, x); it.r = Math.max(it.r, x); it.t = Math.min(it.t, y); it.b = Math.max(it.b, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) { const a = yy * W + xx; if (!labels[a] && data[a * 4 + 3] > 30) { labels[a] = comps.length + 1; q[tl++] = a; } } }
    comps.push(it); }
  // Pieces of one drawing (a body split by a thin gap) are joined when their centres lie within 6 % of the sheet of each
  // other; whole figures in neighbouring cells are at least a fifth of the sheet apart.
  const pieces = comps.filter(x => x.n > W * H / 9 * .02), centre = c => [c.sx / c.n / W, c.sy / c.n / H];
  for (let merged = true; merged;) { merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) for (let j = i + 1; j < pieces.length && !merged; j++) {
      const [ax, ay] = centre(pieces[i]), [bx, by] = centre(pieces[j]);
      if (Math.abs(ax - bx) < .06 && Math.abs(ay - by) < .06) { const a = pieces[i], b = pieces.splice(j, 1)[0]; Object.assign(a, { n: a.n + b.n, sx: a.sx + b.sx, sy: a.sy + b.sy, l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) }); merged = true; } } }
  const big = pieces.sort((a, b) => b.n - a.n), median = big[Math.min(big.length - 1, 4)]?.n || 1;
  // Whole figures, lying and tucked poses included; detached limbs and effects are far smaller. More than nine means the
  // model drew an extra figure (pick with `figures` or redraw); fewer means a pose merged with its neighbour or is missing.
  const figures = big.filter(x => x.n > median * .3);
  if (figures.length !== 9) console.log(`${rec.id}: ${figures.length} figures -> ${figures.sort((a, b) => (a.sy / a.n) - (b.sy / b.n)).map(x => `(${(x.sx / x.n / W).toFixed(2)},${(x.sy / x.n / H).toFixed(2)})`).join(' ')}`);
}
console.log('checked', assets.assets.filter(a => a.kind === 'sprites' && (!only || a.fighter === only)).length, 'sheets in', bundle);
