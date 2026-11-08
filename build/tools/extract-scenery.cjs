#!/usr/bin/env node
// Living-stage extraction. Compares a stage's populated scene (CFZStageScenery: the painting repainted with background
// characters and props added in place) with its clean painting, cuts every addition out at its exact position and scale,
// and writes bundle/scenery/<stage>.json: one element per cut-out with its place on the painting (fractions) and motion.
// The game draws the clean painting as the plate and animates the cut-outs over it, inside the stage's own parallax layer.
//
//   node build/tools/extract-scenery.cjs --bundle <run>/bundle --stage <id>          cut, write the JSON and a review sheet
//   node build/tools/extract-scenery.cjs --bundle <run>/bundle --stage <id> --sync   re-map a hand-edited JSON into assets.json
//
// Edit the JSON to review: change an element's motion (still, idle, cheer, hover, sway, flicker, pulse), its order,
// or delete an element; then run --sync. Re-running a full extraction keeps the motions you set on matching ids.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { loadImage, createCanvas } = require('../node_modules/@napi-rs/canvas');

const MOTIONS = ['still', 'idle', 'cheer', 'hover', 'sway', 'flicker', 'pulse'];
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--sync') out.sync = true; else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]; }
  if (!out.bundle || !out.stage) throw new Error('Usage: extract-scenery.cjs --bundle <bundle> --stage <id> [--sync] [--threshold 24] [--min-area 0.00012]');
  return out;
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Difference mask at working resolution: blurred colour distance above a threshold, closed, small specks removed.
function differenceMask(a, b, w, h, threshold) {
  const diff = new Uint8Array(w * h), dist = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    dist[i] = d; diff[i] = d > threshold ? 1 : 0;
  }
  const morph = (src, r, dilate) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = !dilate;
      for (let dy = -r; dy <= r && hit !== dilate; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy; const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? src[yy * w + xx] : 0;
        if (dilate ? v : !v) { hit = dilate; break; }
      }
      out[y * w + x] = hit ? 1 : 0;
    }
    return out;
  };
  // Open away isolated noise, then close the gaps inside each figure.
  return { dist, mask: morph(morph(morph(morph(diff, 1, false), 1, true), 5, true), 5, false) };
}
function components(mask, dist, w, h, minArea, local) {
  const label = new Int32Array(w * h), found = []; let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    const stack = [i]; label[i] = ++next; let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && Math.abs((q % w) - x) <= 1 && mask[q] && !label[q]) { label[q] = next; stack.push(q); }
    }
    found.push({ label: next, area, x0, y0, x1, y1 });
  }
  // Pieces of one figure (a dark body under a bright head) are merged when their boxes nearly touch.
  const groups = found.map(c => ({ ...c, labels: [c.label] })), gap = Math.round(w * .008);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1) {
        Object.assign(a, { area: a.area + b.area, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), labels: [...a.labels, ...b.labels] });
        groups.splice(j, 1); merged = true; break;
      }
    }
  }
  const parts = groups.filter(c => c.area >= minArea * w * h && c.x1 - c.x0 > 3 && c.y1 - c.y0 > 3);
  // One label per group, then fill holes enclosed inside each group's box (background pixels not reachable from its edge).
  const owner = new Int32Array(w * h);
  parts.forEach((c, n) => { c.label = n + 1; const set = new Set(c.labels); for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (set.has(label[y * w + x])) owner[y * w + x] = c.label; });
  // Local refinement: inside each element's box, dark parts that differ only a little from a dark background (a body in
  // shadow) join the element when they connect to it. The box grows to take in what they reach.
  for (const c of parts) {
    const m = Math.round(Math.max(c.x1 - c.x0, c.y1 - c.y0) * .25), bx0 = Math.max(0, c.x0 - m), by0 = Math.max(0, c.y0 - m), bx1 = Math.min(w - 1, c.x1 + m), by1 = Math.min(h - 1, c.y1 + m);
    const stack = []; for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (owner[y * w + x] === c.label) stack.push(y * w + x);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      for (const [qx, qy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (qx < bx0 || qx > bx1 || qy < by0 || qy > by1) continue; const q = qy * w + qx;
        if (!owner[q] && dist[q] > local) { owner[q] = c.label; stack.push(q); c.x0 = Math.min(c.x0, qx); c.x1 = Math.max(c.x1, qx); c.y0 = Math.min(c.y0, qy); c.y1 = Math.max(c.y1, qy); }
      }
    }
  }
  for (const c of parts) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, outside = new Uint8Array(bw * bh), stack = [];
    const seed = (x, y) => { const i = (y - c.y0) * bw + (x - c.x0); if (!outside[i] && owner[y * w + x] !== c.label) { outside[i] = 1; stack.push([x, y]); } };
    for (let x = c.x0; x <= c.x1; x++) { seed(x, c.y0); seed(x, c.y1); } for (let y = c.y0; y <= c.y1; y++) { seed(c.x0, y); seed(c.x1, y); }
    while (stack.length) { const [x, y] = stack.pop(); if (x > c.x0) seed(x - 1, y); if (x < c.x1) seed(x + 1, y); if (y > c.y0) seed(x, y - 1); if (y < c.y1) seed(x, y + 1); }
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (!outside[(y - c.y0) * bw + x - c.x0]) owner[y * w + x] = c.label;
  }
  return { label: owner, parts };
}
// A first guess at each element's motion; the reviewer has the last word in the JSON.
function guessMotion(c, w, h, brightness, figure = false) {
  const bw = c.x1 - c.x0, bh = c.y1 - c.y0, floating = c.y1 < h * .42;
  // Glints and reflections the scene added on the deck are composited but never move.
  if (!figure && (c.y0 + c.y1) / 2 > h * .52) return 'still';
  if (brightness > 150 && bh < bw * 1.1) return 'flicker';
  if (floating) return 'hover';
  return bh > bw * 1.15 ? 'idle' : 'sway';
}

async function main() {
  const o = args(process.argv.slice(2)), bundle = path.resolve(o.bundle), stageId = o.stage;
  const assetsFile = path.join(bundle, 'assets.json'), assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));
  const plate = assets.assets.find(a => a.id === stageId && a.kind === 'stage'), scene = assets.assets.find(a => a.id === `${stageId}_scene` && a.kind === 'scene');
  if (!plate || !scene) throw new Error(`The bundle needs the stage ${stageId} and its ${stageId}_scene.`);
  const dir = path.join(bundle, 'scenery'), jsonFile = path.join(dir, `${stageId}.json`);
  fs.mkdirSync(path.join(dir, stageId), { recursive: true });
  const previous = fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile, 'utf8')) : null;
  let layout = previous;

  if (!o.sync) {
    const [plateImage, sceneImage] = await Promise.all([loadImage(path.join(bundle, plate.src)), loadImage(path.join(bundle, scene.src))]);
    const W = sceneImage.width, H = sceneImage.height, k = Math.min(1, 1100 / W), w = Math.round(W * k), h = Math.round(H * k);
    const sample = image => { const c = createCanvas(w, h), g = c.getContext('2d'); g.filter = 'blur(1.5px)'; g.drawImage(image, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
    const { mask, dist } = differenceMask(sample(plateImage), sample(sceneImage), w, h, Number(o.threshold || 24));
    // Full-resolution scene pixels for the cut-outs.
    const full = createCanvas(W, H), fg = full.getContext('2d'); fg.drawImage(sceneImage, 0, 0); const sceneData = fg.getImageData(0, 0, W, H).data;
    // With the separation edit (<stage>_isolated: the additions alone on chroma green, in place), its keyed outlines are the
    // animated figures, and the scene's remaining changes (glows, reflections) become still layers so the composite stays the
    // scene. Without it, every difference region is an element with a guessed motion.
    const isolated = assets.assets.find(a => a.id === `${stageId}_isolated` && a.kind === 'scene');
    let keyData = null, groups;
    const greenAlpha = (d, i) => { const r = d[i], g = d[i + 1], b2 = d[i + 2], gd = g - Math.max(r, b2); return gd < 30 ? 1 : gd > 90 ? 0 : 1 - (gd - 30) / 60; };
    if (isolated) {
      const isoImage = await loadImage(path.join(bundle, isolated.src));
      if (isoImage.width !== W || isoImage.height !== H) throw new Error(`${stageId}_isolated is ${isoImage.width}x${isoImage.height}; the scene is ${W}x${H}.`);
      const fc = createCanvas(W, H), fcg = fc.getContext('2d'); fcg.drawImage(isoImage, 0, 0); keyData = fcg.getImageData(0, 0, W, H).data;
      const small = createCanvas(w, h), sg2 = small.getContext('2d'); sg2.drawImage(isoImage, 0, 0, w, h); const sd = sg2.getImageData(0, 0, w, h).data;
      // The edit may keep the scene's unchanged line art on the green: a figure pixel must also be where the scene changed.
      const changed = new Uint8Array(w * h), cr = 4;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) for (let dy = -cr; dy <= cr; dy++) for (let dx = -cr; dx <= cr; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) changed[yy * w + xx] = 1; }
      const figure = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) figure[i] = changed[i] && greenAlpha(sd, i * 4) > .5 ? 1 : 0;
      const grown = new Uint8Array(w * h), r = 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (figure[y * w + x]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) grown[yy * w + xx] = 1; }
      const rest = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) rest[i] = mask[i] && !grown[i] ? 1 : 0;
      groups = [{ kind: 'figure', ...components(figure, dist, w, h, Number(o['min-area'] || .00012), 255) }, { kind: 'still', ...components(rest, dist, w, h, Number(o['min-area'] || .00012), 255) }];
      const [figures, stills] = groups, margin = .2;
      for (const f of figures.parts) {
        const mx = (f.x1 - f.x0) * margin, my = (f.y1 - f.y0) * margin;
        stills.parts = stills.parts.filter(st => {
          if (st.x0 > f.x1 + mx || st.x1 < f.x0 - mx || st.y0 > f.y1 + my || st.y1 < f.y0 - my) return true;
          // Halo and scraps the edit changed around a figure: the clean plate shows there, so nothing ghosts when it moves.
          return false;
        });
      }
    } else groups = [{ kind: 'diff', ...components(mask, dist, w, h, Number(o['min-area'] || .00012), Number(o.local || 13)) }];
    // Ids, motions and order follow the reviewed JSON: each new element keeps the id of the previous one it overlaps most.
    const overlap = (p, q) => { const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)), iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y)); return ix * iy / (p.w * p.h + q.w * q.h - ix * iy); };
    const used = new Set(), taken = new Set((previous?.elements || []).map(e => e.id)); let nextId = 1;
    const freshId = () => { while (taken.has(`${stageId}_el${nextId}`)) nextId++; taken.add(`${stageId}_el${nextId}`); return `${stageId}_el${nextId}`; };
    for (const old of previous?.elements || []) { const f = path.join(bundle, old.src); if (fs.existsSync(f)) fs.rmSync(f); }
    const elements = [];
    for (const group of groups) group.parts.sort((a, b) => a.x0 - b.x0).forEach((c, index) => {
      const label = group.label, figure = group.kind === 'figure';
      const pad = 3, x0 = Math.max(0, Math.floor((c.x0 - pad) / k)), y0 = Math.max(0, Math.floor((c.y0 - pad) / k)), x1 = Math.min(W, Math.ceil((c.x1 + pad + 1) / k)), y1 = Math.min(H, Math.ceil((c.y1 + pad + 1) / k));
      const cw = x1 - x0, ch = y1 - y0, cut = createCanvas(cw, ch), cg = cut.getContext('2d'), img = cg.createImageData(cw, ch);
      // Region membership from the working-resolution labels; a figure's edge comes from its full-resolution key instead.
      const near = (mx, my, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = mx + dx, yy = my + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && label[yy * w + xx] === c.label) return 1; } return 0; };
      const inside = (mx, my) => { const xx = Math.min(w - 1, Math.max(0, mx)), yy = Math.min(h - 1, Math.max(0, my)); return label[yy * w + xx] === c.label ? 1 : 0; };
      let lum = 0, n = 0;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const s2 = ((y0 + y) * W + x0 + x) * 4, d = (y * cw + x) * 4;
        let a;
        if (figure) {
          const mx = Math.round((x0 + x) * k), my = Math.round((y0 + y) * k);
          a = near(mx, my, 1) ? greenAlpha(keyData, s2) : 0;
        }
        else {
          const fx = (x0 + x) * k - .5, fy = (y0 + y) * k - .5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
          a = Math.min(1, 1.4 * ((inside(ix, iy) * (1 - tx) + inside(ix + 1, iy) * tx) * (1 - ty) + (inside(ix, iy + 1) * (1 - tx) + inside(ix + 1, iy + 1) * tx) * ty));
        }
        img.data[d] = sceneData[s2]; img.data[d + 1] = sceneData[s2 + 1]; img.data[d + 2] = sceneData[s2 + 2]; img.data[d + 3] = Math.round(a * 255);
        if (a > .5) { lum += (sceneData[s2] + sceneData[s2 + 1] + sceneData[s2 + 2]) / 3; n++; }
      }
      cg.putImageData(img, 0, 0);
      const place = { x: +(x0 / W).toFixed(5), y: +(y0 / H).toFixed(5), w: +(cw / W).toFixed(5), h: +(ch / H).toFixed(5) };
      const kept = (previous?.elements || []).filter(e => !used.has(e.id)).map(e => ({ e, o: overlap(e.place, place) })).filter(m => m.o > .25).sort((m, n) => n.o - m.o)[0]?.e;
      if (kept) used.add(kept.id);
      const id = kept?.id || freshId(), file = `scenery/${stageId}/${id}.png`;
      fs.writeFileSync(path.join(bundle, file), cut.toBuffer('image/png'));
      // Still layers sit under the figures. A reviewed motion always wins over the guess.
      const guess = group.kind === 'still' ? 'still' : group.kind === 'figure' ? guessMotion(c, w, h, n ? lum / n : 0, true) : guessMotion(c, w, h, n ? lum / n : 0);
      elements.push({ id, src: file, place, motion: kept ? kept.motion : guess, order: group.kind === 'still' ? 0 : 1 + index });
    });
    elements.sort((p, q) => p.id.localeCompare(q.id, 'en', { numeric: true }));
    layout = { schema: 'comfy-fighter-scenery/v1', stage: stageId, plate: plate.src, scene: scene.src, ...(isolated ? { isolated: isolated.src } : {}), size: { width: W, height: H }, motions: MOTIONS, elements };
    fs.writeFileSync(jsonFile, JSON.stringify(layout, null, 2) + '\n');
    // Review sheet: the scene with every element boxed and labelled, beside the plate.
    const rk = 1280 / W, sheet = createCanvas(1280, Math.round(H * rk) * 2), sg = sheet.getContext('2d');
    sg.drawImage(sceneImage, 0, 0, 1280, H * rk); sg.drawImage(plateImage, 0, H * rk, 1280, H * rk);
    sg.lineWidth = 2; sg.font = 'bold 15px sans-serif';
    for (const e of elements) {
      const x = e.place.x * 1280, y = e.place.y * H * rk; sg.strokeStyle = '#ffe600'; sg.strokeRect(x, y, e.place.w * 1280, e.place.h * H * rk);
      sg.fillStyle = '#000'; sg.fillRect(x, y - 18, sg.measureText(`${e.id.split('_').pop()} ${e.motion}`).width + 8, 18); sg.fillStyle = '#ffe600'; sg.fillText(`${e.id.split('_').pop()} ${e.motion}`, x + 4, y - 4);
    }
    fs.writeFileSync(path.join(dir, `${stageId}-review.png`), sheet.toBuffer('image/png'));
  }
  if (!layout) throw new Error(`No ${path.relative(bundle, jsonFile)} to sync; run the extraction first.`);

  // Map the reviewed layout into assets.json as one `layer` record per element.
  const layers = [];
  for (const e of layout.elements) {
    if (!MOTIONS.includes(e.motion)) throw new Error(`${e.id}: unknown motion ${e.motion}. Use one of ${MOTIONS.join(', ')}.`);
    const bytes = fs.readFileSync(path.join(bundle, e.src)), image = await loadImage(bytes);
    layers.push({ id: e.id, kind: 'layer', stage: stageId, key: false, src: e.src, sha256: sha(bytes), width: image.width, height: image.height, place: e.place, motion: e.motion, order: e.order ?? 0, ...(e.depth ? { depth: e.depth } : {}) });
  }
  const stale = new Set(assets.assets.filter(a => a.kind === 'layer' && a.stage === stageId).map(a => a.id));
  assets.assets = [...assets.assets.filter(a => !(a.kind === 'layer' && a.stage === stageId)), ...layers];
  if (Array.isArray(assets.game.expectedAssets)) assets.game.expectedAssets = [...assets.game.expectedAssets.filter(id => !stale.has(id)), ...layers.map(l => l.id)];
  fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n');
  console.log(`${stageId}: ${layers.length} animated element(s) -> ${path.relative(process.cwd(), jsonFile)}${o.sync ? '' : ` (review ${path.relative(process.cwd(), path.join(dir, `${stageId}-review.png`))})`}`);
}
main().catch(error => { console.error(error.message); process.exit(1); });
