// Render the same poses for every fighter of one or more built games at game scale on a shared ground line.
// Usage: node build/tools/pose-rows.cjs <out.png> <pose,pose,...> <game folder> [<game folder> ...]
const fs = require('node:fs'), path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
(async () => {
  const [out, poseList, ...games] = process.argv.slice(2), poses = poseList.split(','), rows = [];
  for (const game of games) { const m = JSON.parse(fs.readFileSync(path.join(game, 'assets/manifest.json'), 'utf8')); for (const f of m.fighters) rows.push({ game, f }); }
  const cw = 150, rh = 150, canvas = createCanvas(110 + poses.length * cw, rows.length * rh + 24), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#353a42'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif';
  poses.forEach((p, i) => ctx.fillText(p, 110 + i * cw + 8, 16));
  for (const [r, { game, f }] of rows.entries()) {
    const scale = 120 / f.poses.idle.bh, base = 24 + r * rh + rh - 8;
    ctx.fillStyle = '#fff'; ctx.fillText(f.id, 6, base - 60); ctx.strokeStyle = '#6c7'; ctx.beginPath(); ctx.moveTo(110, base); ctx.lineTo(canvas.width, base); ctx.stroke();
    ctx.strokeStyle = '#c66'; ctx.beginPath(); ctx.moveTo(110, base - 120); ctx.lineTo(canvas.width, base - 120); ctx.stroke();
    for (const [i, p] of poses.entries()) { const meta = f.poses[p]; if (!meta) continue; const img = await loadImage(path.join(game, meta.src));
      ctx.drawImage(img, 110 + i * cw + cw / 2 - meta.ax * scale, base - meta.ay * scale, img.width * scale, img.height * scale); }
  }
  fs.writeFileSync(out, await canvas.encode('png')); console.log('wrote', out, rows.length, 'fighters');
})();
