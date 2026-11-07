// Audit the sprites a built game actually ships: detached fragments, green chroma spill and size jumps against idle.
// Usage: node build/tools/sprite-audit.cjs <game folder> [flagged-sprites.png]
const fs = require('node:fs'), path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const EFFECT_POSES = new Set(['special', 'super', 'powerup', 'launcher', 'punchwhip', 'kickwhip', 'blowback', 'taunt', 'win', 'win2', 'dizzy']);
const UPRIGHT = new Set(['idle', 'stance2', 'walk', 'walk2', 'walk3', 'walk4', 'run', 'run2', 'backstep', 'block', 'punch', 'hpunch', 'kick', 'lkick', 'punchwind', 'kickwind', 'heavywind', 'blowback', 'throw', 'entrance', 'dizzy', 'load', 'punchwhip', 'recoil', 'settle', 'stepin', 'stepout', 'idle1', 'idle2', 'idle3', 'idle4', 'idle5', 'guardhit']);
async function audit(file) {
  const img = await loadImage(file), c = createCanvas(img.width, img.height), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height), W = img.width, H = img.height, labels = new Int32Array(W * H), q = new Int32Array(W * H), comps = [];
  let opaque = 0, green = 0;
  for (let i = 0; i < W * H; i++) { if (data[i * 4 + 3] > 30) { opaque++; const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; if (g > r + 40 && g > b + 40) green++; } }
  for (let s = 0; s < W * H; s++) {
    if (labels[s] || data[s * 4 + 3] <= 30) continue;
    const it = { n: 0, l: W, t: H, r: -1, b: -1 }; let h = 0, tl = 1; q[0] = s; labels[s] = comps.length + 1;
    while (h < tl) { const k = q[h++], x = k % W, y = (k / W) | 0; it.n++; it.l = Math.min(it.l, x); it.r = Math.max(it.r, x); it.t = Math.min(it.t, y); it.b = Math.max(it.b, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) { const a = yy * W + xx; if (!labels[a] && data[a * 4 + 3] > 30) { labels[a] = comps.length + 1; q[tl++] = a; } } }
    comps.push(it);
  }
  comps.sort((a, b) => b.n - a.n); const main = comps[0];
  const gap = c2 => Math.max(0, main.l - c2.r, c2.l - main.r, main.t - c2.b, c2.t - main.b);
  const fragments = comps.slice(1).filter(c2 => c2.n >= Math.max(40, main.n * .002) && gap(c2) > 6);
  return { opaque, greenShare: green / Math.max(1, opaque), fragments: fragments.map(c2 => ({ n: c2.n, gap: gap(c2), box: [c2.l, c2.t, c2.r, c2.b] })) };
}
(async () => {
  const game = path.resolve(process.argv[2]), manifest = JSON.parse(fs.readFileSync(path.join(game, 'assets/manifest.json'), 'utf8')), flagged = [];
  for (const f of manifest.fighters) {
    const idle = f.poses.idle;
    for (const [pose, meta] of Object.entries(f.poses)) {
      const r = await audit(path.join(game, meta.src)), notes = [];
      const ratio = meta.bh / idle.bh;
      if (UPRIGHT.has(pose) && (ratio < .86 || ratio > 1.14)) notes.push(`upright height ${ratio.toFixed(2)}x idle`);
      if (r.greenShare > .004) notes.push(`green spill ${(r.greenShare * 100).toFixed(1)}%`);
      if (r.fragments.length && !EFFECT_POSES.has(pose)) notes.push(`${r.fragments.length} detached fragment(s): ${r.fragments.map(x => `${x.n}px at ${x.gap}px`).join(', ')}`);
      if (notes.length) flagged.push({ fighter: f.id, pose, src: meta.src, notes });
    }
  }
  console.log(`${manifest.title} ${manifest.subtitle || ''}: ${manifest.fighters.length} fighters, ${manifest.fighters.reduce((n, f) => n + Object.keys(f.poses).length, 0)} sprites, ${flagged.length} flagged`);
  for (const x of flagged) console.log(`  ${x.fighter} ${x.pose}: ${x.notes.join('; ')}`);
  if (process.argv[3] && flagged.length) {
    const cols = Math.min(6, flagged.length), rows = Math.ceil(flagged.length / cols), out = createCanvas(cols * 230, rows * 270), ctx = out.getContext('2d');
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(0, 0, out.width, out.height);
    for (const [i, x] of flagged.entries()) { const img = await loadImage(path.join(game, x.src)), k = Math.min(210 / img.width, 230 / img.height), cx = (i % cols) * 230, cy = Math.floor(i / cols) * 270;
      ctx.drawImage(img, cx + 10, cy + 30, img.width * k, img.height * k); ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.fillText(`${x.fighter} ${x.pose}`, cx + 8, cy + 18); }
    fs.writeFileSync(process.argv[3], await out.encode('png'));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
