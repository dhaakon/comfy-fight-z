// Canvas 2D arena renderer: the original draw path (stage, fighters, effects, camera, HUD and callouts),
// kept complete so a browser without WebGL still plays, and so the Pixi renderer can reuse its screen layer.
(function (root) {
  'use strict';
  function createCanvasRenderer({ canvas, engine: E, deps }) {
    const ctx = canvas.getContext('2d');
    const { art, assetSource, ui, fighterData, portraitSource } = deps;
    // Life points per fighter (engines before the 1000-point scale used 100).
    const LIFE = E.MAX_HP || 100;
    // Living scenery (render/scenery.js): placed elements and effects in the painting's space, weather over the fighters.
    const scenery = root.CFZScenery ? root.CFZScenery.create() : null;
    const sceneryInfo = () => ({ view, stage: manifest?.stages?.[stageIndex], getImage: art, state, time: performance.now() / 1000, floor: FLOOR, horizonDrop: 150, worldWidth: E.WIDTH });
    const reducedMotion = { matches: false };
    let state = null, manifest = null, stageIndex = 0, selected = [0, 1], mode = 'arcade', arcade = null, training = {}, cutin = null, goFrames = 0, fighterRenderer = null, bestScore = 0, debugBoxes = false;
  function cover(image, x, y, w, h) {
    const s = Math.max(w / image.width, h / image.height), sw = w / s, sh = h / s;
    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
  }
  function stageDraw() {
    const background = art(manifest.stages[stageIndex].src) || art(assetSource(manifest.stages[stageIndex].sourceImage));
    if (background) { cover(background, 0, 0, 960, 540); return; }
    const sky = ctx.createLinearGradient(0, 0, 0, 440); sky.addColorStop(0, '#293c40'); sky.addColorStop(.65, '#798982'); sky.addColorStop(1, '#d7b084');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#f6c38d'; ctx.globalAlpha = .65; ctx.beginPath(); ctx.arc(727, 151, 57, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    // A quiet suburban skyline built only from code until a generated stage is imported.
    [0, 160, 385, 575, 820].forEach((x, i) => {
      const y = 250 + (i % 3) * 15, w = 155 + i % 2 * 28;
      ctx.fillStyle = ['#48595a', '#526764', '#4a5c5b'][i % 3]; ctx.fillRect(x, y, w, 150);
      ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x + w / 2, y - 62); ctx.lineTo(x + w + 15, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c4aa79'; ctx.fillRect(x + 22, y + 28, 25, 40); ctx.fillRect(x + w - 47, y + 28, 25, 40);
      ctx.fillStyle = '#344746'; ctx.fillRect(x + w / 2 - 15, y + 62, 30, 88);
    });
    ctx.fillStyle = '#344d45'; ctx.fillRect(0, 368, 960, 50);
    for (let x = 0; x < 960; x += 18) { ctx.fillStyle = '#79857b'; ctx.fillRect(x, 360, 3, 58); }
    ctx.fillStyle = '#888d7b'; ctx.fillRect(0, 407, 960, 15); ctx.fillStyle = '#333f40'; ctx.fillRect(0, 422, 960, 118);
    ctx.fillStyle = '#c9b88a55'; for (let x = -40; x < 960; x += 170) ctx.fillRect(x, 501, 92, 4);
    ctx.strokeStyle = '#222d31'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 450); ctx.lineTo(960, 450); ctx.stroke();
    // Telephone wire gives the flat fighting plane a useful horizon.
    ctx.strokeStyle = '#273c3e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 180); ctx.quadraticCurveTo(480, 245, 960, 185); ctx.stroke();
    ctx.fillStyle = '#263c3c'; ctx.fillRect(99, 177, 7, 241); ctx.fillRect(865, 180, 7, 240);
  }
  function fallbackFighter(f, data) {
    const color = data.color || '#f49653', walking = f.pose === 'walk' || f.pose === 'walk2', kicking = f.pose === 'kick' || f.pose === 'lkick';
    const crouch = ['crouch', 'sweep', 'cjab'].includes(f.pose), down = f.pose === 'down';
    ctx.save(); ctx.translate(f.x, E.GROUND - f.y); ctx.scale(f.facing, 1);
    if (down) { ctx.translate(10, -15); ctx.rotate(-Math.PI / 2); }
    if (crouch) { ctx.scale(1, .72); }
    const stride = walking ? Math.sin((state?.frame || 0) / 5) * 18 : 0;
    ctx.strokeStyle = '#1d292d'; ctx.lineWidth = 24; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, -80); ctx.lineTo(-26 + stride, -16); ctx.moveTo(15, -80); ctx.lineTo(27 - stride, -16); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 25; ctx.beginPath(); ctx.moveTo(-15, -81); ctx.lineTo(-24 + stride, -38); ctx.moveTo(15, -81); ctx.lineTo(kicking ? 100 : 25 - stride, kicking ? (f.pose === 'kick' ? -95 : -60) : -38); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-33, -152); ctx.lineTo(32, -152); ctx.lineTo(25, -80); ctx.lineTo(-25, -80); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8c8a2'; ctx.beginPath(); ctx.arc(0, -174, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#26373a'; ctx.fillRect(-23, -193, 45, 13); ctx.fillRect(16, -182, 15, 5);
    ctx.strokeStyle = '#e8c8a2'; ctx.lineWidth = 16; ctx.beginPath();
    ctx.moveTo(25, -142); ctx.lineTo(f.pose === 'punch' ? 105 : f.pose === 'block' ? 36 : 54, f.pose === 'block' ? -180 : -125);
    ctx.moveTo(-25, -142); ctx.lineTo(f.pose === 'win' ? -35 : -8, f.pose === 'win' ? -217 : -122); ctx.stroke();
    ctx.strokeStyle = '#1c2a2c'; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(-26 + stride, -8); ctx.lineTo(-5 + stride, -8); ctx.moveTo(27 - stride, -8); ctx.lineTo(45 - stride, -8); ctx.stroke();
    ctx.fillStyle = '#141f24'; ctx.fillRect(-15, -121, 30, 7); ctx.restore();
  }
  // Capcom hit shake: through the impact freeze a fighter that has just been hit jitters 2 px either way (1 on a guard),
  // alternating with every simulated frame (or network snapshot), so it holds still while the game is paused. Visual
  // only; the Pixi path uses it too.
  function hitShake(f) {
    if (!state || reducedMotion.matches || !(state.hitstop > 0) || !(f.stun > 0) || f.hitAge !== 0) return 0;
    return (view.ticks % 2 ? 1 : -1) * (f.blockStun ? 1 : 2);
  }
  function drawFighter(f, slot) {
    const data = fighterData(slot);
    // Mirror matches recolor the second fighter so both players stay readable.
    const palette = slot === 1 && selected[0] === selected[1] ? 155 : 0, shake = hitShake(f);
    ctx.save(); if (shake) ctx.translate(shake, 0);
    if (!fighterRenderer?.draw(ctx, f, data, art, state, { ground: E.GROUND, height: 225, reducedMotion: reducedMotion.matches, palette })) fallbackFighter(f, data);
    ctx.restore();
  }
  const PIXEL = "'Press Start 2P', Impact, sans-serif";
  // Text is drawn from cached bitmaps: stroking a pixel-font outline is the slowest thing a phone's 2D canvas does, and
  // the HUD would stroke a dozen labels a frame (more in a combo). A label is rasterized once per text, font, colours
  // and device density, then drawn as an image; the cache is bounded, so a changing score costs one raster per change.
  const labels = new Map(); let labelDensity = 1, thumbnails = new WeakMap();
  function label(value, font, fill, stroke, lineWidth) {
    const key = `${font}|${fill}|${stroke}|${lineWidth}|${value}`;
    let entry = labels.get(key);
    if (entry) return entry;
    const scratch = root.document.createElement('canvas'), g = scratch.getContext('2d');
    g.font = font; const metrics = g.measureText(value);
    const pad = Math.ceil((lineWidth || 0) / 2) + 2, ascent = Math.ceil(metrics.actualBoundingBoxAscent || parseInt(font, 10) || 10), descent = Math.ceil(metrics.actualBoundingBoxDescent || 4);
    const width = Math.ceil(metrics.width) + pad * 2, height = ascent + descent + pad * 2;
    scratch.width = Math.max(1, Math.ceil(width * labelDensity)); scratch.height = Math.max(1, Math.ceil(height * labelDensity));
    g.setTransform(labelDensity, 0, 0, labelDensity, 0, 0); g.font = font; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (stroke && lineWidth) { g.lineWidth = lineWidth; g.strokeStyle = stroke; g.strokeText(value, pad, pad + ascent); }
    if (fill) { g.fillStyle = fill; g.fillText(value, pad, pad + ascent); }
    entry = { image: scratch, width, height, pad, ascent, textWidth: metrics.width };
    if (labels.size >= 96) labels.delete(labels.keys().next().value);
    labels.set(key, entry); return entry;
  }
  // Draws a label where fillText would have put it, honouring the alignment; alpha and transforms come from ctx.
  function text(value, x, y, { font, fill, stroke = null, lineWidth = 0, align = 'left' }) {
    if (!root.document?.createElement) {
      // No DOM (tests): draw the text directly.
      ctx.save(); ctx.font = font; ctx.textAlign = align;
      if (stroke && lineWidth) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.strokeText(value, x, y); }
      if (fill) { ctx.fillStyle = fill; ctx.fillText(value, x, y); }
      ctx.restore(); return;
    }
    const entry = label(value, font, fill, stroke, lineWidth);
    const left = align === 'center' ? x - entry.textWidth / 2 : align === 'right' ? x - entry.textWidth : x;
    ctx.drawImage(entry.image, left - entry.pad, y - entry.ascent - entry.pad, entry.width, entry.height);
  }
  // The two HUD portraits, cropped (and mirrored on the right) once at the current density rather than every frame.
  function thumbnail(image, slot) {
    if (!root.document?.createElement) return null;
    let pair = thumbnails.get(image); if (!pair) { pair = []; thumbnails.set(image, pair); }
    if (pair[slot]) return pair[slot];
    const size = Math.max(1, Math.round(50 * labelDensity)), scratch = root.document.createElement('canvas'); scratch.width = scratch.height = size;
    const g = scratch.getContext('2d'); if (slot) { g.translate(size, 0); g.scale(-1, 1); }
    const s = Math.max(size / image.width, size / image.height), sw = size / s, sh = size / s;
    g.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, size, size);
    pair[slot] = scratch; return scratch;
  }
  function effect(name, x, y, facing = 1, opacity = 1, size = 120) {
    const meta = manifest.effects?.[name], img = art(assetSource(meta));
    if (img) { ctx.save(); ctx.globalAlpha = opacity; ctx.translate(x, y); ctx.scale(facing, 1); const ratio = size / Math.max(img.width, img.height); ctx.drawImage(img, -img.width * ratio / 2, -img.height * ratio / 2, img.width * ratio, img.height * ratio); ctx.restore(); return true; }
    return false;
  }
  function hud() {
    const fighters = state?.fighters || [E.create().fighters[0], E.create().fighters[1]];
    const flash = Math.floor(performance.now() / 160) % 2 === 0, colors = ['#ffe600', '#ffe600'];
    // Black top band, yellow life bars with a red damage trail and pixel type, mid-90s arcade style.
    ctx.save();
    ctx.fillStyle = '#000000e6'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(960, 0); ctx.lineTo(960, 80); ctx.lineTo(530, 80); ctx.lineTo(515, 96); ctx.lineTo(445, 96); ctx.lineTo(430, 80); ctx.lineTo(0, 80); ctx.closePath(); ctx.fill();
    fighters.forEach((f, slot) => {
      const data = fighterData(slot), width = 360, x = slot ? 530 : 70, color = colors[slot];
      const portrait = art(portraitSource(data)), px = slot ? 898 : 8;
      ctx.fillStyle = '#15191c'; ctx.fillRect(px, 10, 54, 54); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(px, 10, 54, 54);
      if (portrait) {
        const cropped = thumbnail(portrait, slot);
        if (cropped) ctx.drawImage(cropped, px + 2, 12, 50, 50);
        else { ctx.save(); ctx.beginPath(); ctx.rect(px + 2, 12, 50, 50); ctx.clip(); if (slot) { ctx.translate(px * 2 + 54, 0); ctx.scale(-1, 1); } cover(portrait, px + 2, 12, 50, 50); ctx.restore(); }
      }
      // Life bar drains toward the portrait; low health flashes oxblood (desperation, a quarter of the bar).
      const hp = Math.max(0, f.hp) / LIFE, danger = f.hp > 0 && f.hp <= LIFE / 4;
      ctx.save(); ctx.beginPath(); ctx.moveTo(x + 10, 30); ctx.lineTo(x + width, 30); ctx.lineTo(x + width - 10, 52); ctx.lineTo(x, 52); ctx.closePath(); ctx.clip();
      ctx.fillStyle = '#050607'; ctx.fillRect(x, 30, width, 22); ctx.fillStyle = '#2a0000'; ctx.fillRect(x + 2, 32, width - 4, 18);
      const fill = danger ? (flash ? '#ff2a2a' : '#b01818') : color, w = (width - 4) * hp;
      // The damage trail eases down behind the bar so a hit reads as a red chunk before it drains away.
      const shown = view.hpShown[slot] = view.hpShown[slot] == null || view.hpShown[slot] < hp ? hp : Math.max(hp, view.hpShown[slot] - .012), tw = (width - 4) * shown;
      ctx.fillStyle = '#d41f1f'; ctx.fillRect(slot ? x + 2 : x + 2 + (width - 4) - tw, 32, tw, 18);
      ctx.fillStyle = fill; ctx.fillRect(slot ? x + 2 : x + 2 + (width - 4) - w, 32, w, 18);
      ctx.fillStyle = '#ffffff40'; ctx.fillRect(slot ? x + 2 : x + 2 + (width - 4) - w, 32, w, 4); ctx.restore();
      text(data.name.toUpperCase(), slot ? x + width - 4 : x + 4, 72, { font: `14px ${PIXEL}`, fill: '#fff', stroke: '#000', lineWidth: 4, align: slot ? 'right' : 'left' });
      // Round wins as brass victory marks beside the timer.
      const target = state?.options?.roundsToWin ?? 2;
      for (let i = 0; i < target; i++) {
        const mx = slot ? 540 + i * 16 : 420 - i * 16;
        ctx.fillStyle = f.wins > i ? '#ff2a2a' : '#2a2f33'; ctx.beginPath(); ctx.moveTo(mx, 59); ctx.lineTo(mx + 6, 65); ctx.lineTo(mx, 71); ctx.lineTo(mx - 6, 65); ctx.closePath(); ctx.fill();
      }
      // Power gauge: one bar fills into up to three stocks (MAX).
      const gx = slot ? 640 : 70, gw = 250, gy = 512, stocks = f.stocks ?? 0, bar = Math.min(1, (f.energy ?? 0) / (E.BAR || 100));
      ctx.fillStyle = '#0d0f11d9'; ctx.fillRect(gx - 4, gy - 16, gw + 74, 30);
      ctx.fillStyle = '#1b2024'; ctx.fillRect(gx, gy, gw, 9);
      const full = stocks >= (E.STOCK_MAX || 3);
      ctx.fillStyle = full ? (flash ? '#ffe600' : '#ff9a00') : '#2f6bff'; ctx.fillRect(slot ? gx + gw * (1 - bar) : gx, gy, gw * (full ? 1 : bar), 9);
      text('POWER', slot ? gx + gw : gx, gy - 4, { font: `7px ${PIXEL}`, fill: '#fff', align: slot ? 'right' : 'left' });
      text(full ? 'MAX' : String(stocks), slot ? gx - 22 : gx + gw + 32, gy + 10, { font: `14px ${PIXEL}`, fill: full ? (flash ? '#ffe600' : '#fff') : stocks ? '#fff' : '#555', stroke: '#000', lineWidth: 4, align: 'center' });
    });
    // Timer plate; training and endless rounds show infinity.
    ctx.fillStyle = '#000'; ctx.fillRect(448, 12, 64, 60); ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.strokeRect(448, 12, 64, 60);
    const endless = mode === 'training' || state?.options?.roundTime === 0;
    const seconds = Math.ceil((state?.time ?? 5940) / 60), time = endless ? '∞' : String(seconds).padStart(2, '0');
    text(time, 480, 56, { font: `${endless ? 36 : 28}px ${PIXEL}`, fill: !endless && seconds <= 10 && state?.phase === 'fight' && flash ? '#ff2a2a' : '#ffe600', stroke: '#000', lineWidth: 4, align: 'center' });
    text(mode === 'training' ? 'TRAINING' : 'ROUND ' + (state?.round || 1), 480, 90, { font: `7px ${PIXEL}`, fill: '#fff', align: 'center' });
    // Arcade score line.
    if (arcade && mode === 'arcade') {
      const score = { font: `9px ${PIXEL}`, stroke: '#000', lineWidth: 3 };
      text('1UP ' + String(arcade.score).padStart(8, '0'), 420, 20, { ...score, fill: '#fff', align: 'right' });
      text('HI-SCORE ' + String(Math.max(bestScore, arcade.score)).padStart(8, '0'), 540, 20, { ...score, fill: '#ff2a2a', align: 'left' });
    }
    if (mode === 'training' && state) trainingHud();
    ctx.restore();
  }
  // Training read-outs: input history and the last measured frame data.
  function trainingHud() {
    ctx.save();
    if (training.inputs) {
      ctx.fillStyle = '#0d0f11b8'; ctx.fillRect(8, 122, 104, 18 * Math.max(1, training.history.length) + 8);
      ctx.font = '13px Consolas, monospace'; ctx.textAlign = 'left';
      training.history.forEach((entry, index) => { ctx.fillStyle = index ? '#d9cfb8' : '#f4d692'; ctx.fillText(entry.label.padEnd(7) + String(Math.min(entry.frames, 99)).padStart(3), 14, 138 + index * 18); });
    }
    if (training.frames && training.frameData) {
      const data = training.frameData, advantage = data.advantage === null ? 'WHIFF' : `${data.advantage >= 0 ? '+' : ''}${data.advantage} ON ${data.result.toUpperCase()}`;
      const line = `${data.move.toUpperCase()} · STARTUP ${data.startup ?? '-'} · TOTAL ${data.total} · ${advantage}`;
      ctx.font = '800 12px Segoe UI, Arial'; const width = ctx.measureText(line).width + 24;
      ctx.fillStyle = '#0d0f11cc'; ctx.fillRect(480 - width / 2, 462, width, 24);
      ctx.textAlign = 'center'; ctx.fillStyle = data.advantage === null ? '#d9cfb8' : data.advantage >= 0 ? '#9fd8a8' : '#d8584a'; ctx.fillText(line, 480, 479);
    }
    ctx.font = '800 9px Segoe UI, Arial'; ctx.textAlign = 'right'; ctx.fillStyle = '#d9cfb8'; ctx.fillText('ESC: OPTIONS · R: RESET', 952, 486);
    ctx.restore();
  }
  // The engine's collision rectangles in world space: the body (blue, none while knocked down), the extended limb of a
  // strike (teal), both pale while no hit can land (invulnerable, knocked out or at the juggle limit), the strike itself
  // (red; a throw's range to the opponent's centre is dashed) and every projectile's box, over the painted extents of
  // the current cel.
  function hitboxes() {
    if (!(debugBoxes || (mode === 'training' && training.boxes)) || !state) return;
    const rect = (box, stroke, fill, dash) => {
      if (!box) return;
      const [x, y, w, h] = box, top = E.GROUND - y - h;
      ctx.setLineDash(dash || []); ctx.fillStyle = fill; ctx.fillRect(x, top, w, h); ctx.strokeStyle = stroke; ctx.strokeRect(x, top, w, h); ctx.setLineDash([]);
    };
    ctx.save(); ctx.lineWidth = 2;
    state.fighters.forEach((f, slot) => {
      const { hurt, hit, limb, hittable = !f.invulnerable } = E.boxes(f), ground = E.GROUND - f.y, move = f.move && E.moveData(f);
      // Anchor, facing arrow and the painted extents of the current cel (yellow) against the boxes.
      const poses = fighterData(slot).poses || {}, meta = poses[f.pose] || poses.idle, scale = poses.idle?.bh ? E.SPRITE_HEIGHT / poses.idle.bh : 0;
      if (meta && scale) {
        const front = (meta.w - meta.ax) * scale, back = meta.ax * scale, top = ground - (meta.bh || meta.h) * scale;
        ctx.strokeStyle = '#f4d692'; ctx.setLineDash([4, 3]); ctx.strokeRect(f.facing === 1 ? f.x - back : f.x - front, top, front + back, ground - top); ctx.setLineDash([]);
      }
      ctx.fillStyle = '#f4d692'; ctx.beginPath(); ctx.arc(f.x, ground, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(f.x + f.facing * 10, ground - 214); ctx.lineTo(f.x + f.facing * 34, ground - 206); ctx.lineTo(f.x + f.facing * 10, ground - 198); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 11px Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText(`${f.pose}${f.move ? '/' + f.move : ''} ${f.facing > 0 ? '→' : '←'}`, f.x, ground - 222);
      rect(hurt, hittable ? '#5f9fd9' : '#f5ead2', '#5f9fd922');
      rect(limb, hittable ? '#82d6c5' : '#f5ead2', '#82d6c522');
      rect(hit, '#e0544a', '#e0544a33', move && !move.band ? [6, 4] : null);
    });
    if (E.projectileBox) for (const p of state.projectiles) rect(E.projectileBox(p), '#e0544a', '#e0544a33');
    ctx.restore();
  }
  // Presentation-only camera: follows the fighters' midpoint across the wider
  // stage, pushes in when they are close and lifts for airborne exchanges.
  const FLOOR = E.GROUND, PARALLAX = .5;
  // flash: the additive white impact frame; invert: frames of negative flash left (counter hits); dust and rings are
  // shared with the Pixi path, which draws them itself; beat counts drawn frames (slow-motion sparks) and ticks the
  // simulated frames drawn (the hit shake; frameSeen is the last one).
  const freshView = () => ({ x: (E.WIDTH - 960) / 2, zoom: 1, lift: 0, shake: 0, particles: [], dust: [], rings: [], flash: 0, invert: 0, beat: 0, ticks: 0, frameSeen: -1, dustClock: -1, combos: [null, null], seen: new WeakSet(), hpShown: [null, null], clock: { text: '', frames: 0 } });
  const view = freshView();
  function resetView() { Object.assign(view, freshView()); }
  function updateCamera(fighters, snap) {
    const [a, b] = fighters, distance = Math.abs(a.x - b.x), mid = (a.x + b.x) / 2;
    // MvC-style framing: fighters fill over half the frame when close (zoom 1.42, about 59% of the height)
    // and the camera eases out to the full span as they separate or leave the ground.
    const highest = Math.max(a.y, b.y), byDistance = 1200 / (distance + 420), byHeight = (FLOOR - 24) / (highest + E.SPRITE_HEIGHT + 30);
    const targetZoom = reducedMotion.matches ? 1 : Math.max(1, Math.min(1.42, byDistance, byHeight));
    const targetLift = reducedMotion.matches ? 0 : Math.min(70, highest * .35);
    const ease = snap ? 1 : .12;
    view.zoom += (targetZoom - view.zoom) * (snap ? 1 : .08); view.zoom = Math.min(1.6, view.zoom); view.lift += (targetLift - view.lift) * ease;
    // A fast rise (a super jump) outruns the easing: never stay zoomed in so far that the highest fighter's head, a body
    // height above its feet, leaves the top of the frame.
    view.zoom = Math.max(1, Math.min(view.zoom, (FLOOR + view.lift - 8) / (highest + E.SPRITE_HEIGHT)));
    const span = 960 / view.zoom, targetX = Math.max(0, Math.min(E.WIDTH - span, mid - span / 2));
    view.x += (targetX - view.x) * (snap ? 1 : .18);
    view.x = Math.max(0, Math.min(E.WIDTH - span, view.x));
    view.shake *= .86;
    const shake = view.shake > .5 && !reducedMotion.matches;
    view.shakeX = shake ? (Math.random() - .5) * view.shake * 2 : 0; view.shakeY = shake ? (Math.random() - .5) * view.shake * 2 : 0;
  }
  function worldTransform() {
    ctx.translate(-view.x * view.zoom + (view.shakeX || 0), FLOOR * (1 - view.zoom) + view.lift + (view.shakeY || 0)); ctx.scale(view.zoom, view.zoom);
  }
  function stageLayer() {
    // The single stage painting scrolls at half speed behind the fighters,
    // scaled about the floor line so the ground stays under their feet.
    const span = 960 / view.zoom, travel = Math.max(1, E.WIDTH - span), scale = (1 + (E.WIDTH - 960) * PARALLAX / 960) * (1 + (view.zoom - 1) * .5);
    const offset = (view.x / travel) * (960 * scale - 960);
    ctx.save(); ctx.translate(-offset, FLOOR * (1 - scale) + view.lift * .5); ctx.scale(scale, scale); stageDraw();
    // Living scenery (placed elements and effects on painted features) animates in the painting's own space,
    // so it keeps the painting's parallax and scale.
    if (scenery && state) scenery.drawStage(ctx, sceneryInfo());
    ctx.restore();
  }
  // Spark tiers by the damage a hit dealt, on the 1000-point life scale: light under 45, medium under 75, heavy from 75.
  // Each tier sets the sparks, the camera shake and the impact flash (both renderers); a block throws cool sparks and a ring.
  const SPARK_TIERS = [
    { count: 8, speed: 6, size: 3, color: '#fff1c9', shake: 3, flash: .18 },
    { count: 13, speed: 8, size: 3.5, color: '#ffe08a', shake: 5, flash: .35 },
    { count: 20, speed: 10, size: 4.5, color: '#ffd27a', shake: 8, flash: .55 }
  ];
  const sparkTier = e => { const damage = (e.damage || 0) * 1000 / LIFE; return damage < 45 ? 0 : damage < 75 ? 1 : 2; };
  function spawnSparks(e) {
    if (reducedMotion.matches) return;
    const block = e.type === 'block', tier = SPARK_TIERS[block ? 0 : sparkTier(e)];
    const count = block ? 6 : tier.count, color = block ? '#9fd8e6' : tier.color, speed = block ? 6 : tier.speed;
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - .5) * Math.PI * 1.2 + (e.facing > 0 ? 0 : Math.PI), v = 3 + Math.random() * speed;
      view.particles.push({ x: e.x, y: e.y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 2, life: 14 + Math.random() * 10, max: 24, color, size: block ? 3 : tier.size });
    }
    if (block) ring(e.x, e.y, 12, 3, '#9fd8e6', 3, 12);
    else if (tier === SPARK_TIERS[2]) ring(e.x, e.y, 18, 6, '#ffe600', 4, 12);
  }
  // Rings expand and fade; dust puffs drift, swell and fade. Both live in world space.
  function ring(x, y, r, grow, color, width, life) { view.rings.push({ x, y, r, grow, color, width, life, max: life }); }
  function dust(x, y, dir, count, size) {
    if (reducedMotion.matches) return;
    for (let i = 0; i < count; i++) view.dust.push({ x: x + (Math.random() - .5) * 12, y: y - Math.random() * 8, vx: dir * (.5 + Math.random() * 1.6), vy: -(.2 + Math.random() * .9), size: size * (.7 + Math.random() * .6), life: 18 + Math.random() * 12, max: 30 });
  }
  function stepParticles() {
    // K.O. slow motion: sparks and dust move on every other drawn frame too.
    if (state?.slowMotion > 0 && !(state.hitstop > 0) && view.beat % 2) return;
    view.particles = view.particles.filter(pt => pt.life > 0);
    for (const pt of view.particles) { pt.x += pt.vx; pt.y += pt.vy; pt.vy += .45; pt.vx *= .92; pt.life--; }
    view.dust = view.dust.filter(d => d.life > 0);
    for (const d of view.dust) { d.x += d.vx; d.y += d.vy; d.vx *= .93; d.vy *= .96; d.size *= 1.02; d.life--; }
    view.rings = view.rings.filter(r => r.life > 0);
    for (const r of view.rings) { r.r += r.grow; r.grow *= .9; r.life--; }
  }
  function drawParticles() {
    for (const pt of view.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max); ctx.fillStyle = pt.color; ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    for (const r of view.rings) {
      ctx.globalAlpha = Math.max(0, r.life / r.max); ctx.strokeStyle = r.color; ctx.lineWidth = r.width * (.4 + .6 * r.life / r.max);
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // A soft dust puff, drawn once: a radial gradient that fades to nothing at its edge.
  let puff = null;
  function puffImage() {
    if (puff !== null) return puff;
    try {
      const image = root.document?.createElement('canvas'), g = image?.getContext('2d');
      if (!g) return (puff = false);
      image.width = image.height = 64;
      const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(214,200,170,.9)'); gradient.addColorStop(.5, 'rgba(214,200,170,.45)'); gradient.addColorStop(1, 'rgba(214,200,170,0)');
      g.fillStyle = gradient; g.fillRect(0, 0, 64, 64); puff = image;
    } catch { puff = false; }
    return puff;
  }
  function drawDust() {
    const image = puffImage();
    ctx.fillStyle = '#d6c8aa';
    for (const d of view.dust) {
      ctx.globalAlpha = .6 * Math.max(0, d.life / d.max);
      if (image) ctx.drawImage(image, d.x - d.size * 1.3, d.y - d.size, d.size * 2.6, d.size * 2);
      else { ctx.globalAlpha *= .5; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.size, d.size * .75, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  function screenText(value, x, y, size, fill, align = 'center', alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha;
    text(value, x, y, { font: `${Math.round(size * .8)}px ${PIXEL}`, fill, stroke: '#000', lineWidth: Math.max(3, size / 8), align });
    ctx.restore();
  }
  // Arcade callout: the text slams in from a larger scale (pop 1 → 0) and can carry a second colour outline.
  function slam(value, x, y, size, fill, pop, alpha = 1, edge = null) {
    ctx.save(); ctx.translate(x, y); const k = 1 + pop * 2.2; ctx.scale(k, k);
    if (edge) { ctx.globalAlpha = alpha; text(value, 0, 0, { font: `${Math.round(size * .8)}px ${PIXEL}`, fill: null, stroke: edge, lineWidth: Math.max(6, size / 4), align: 'center' }); }
    screenText(value, 0, 0, size, fill, 'center', alpha); ctx.restore();
  }
  function overlays() {
    // Combo counters sit on the attacker's side and linger after the combo ends, which is when the defender recovers
    // or, launched or knocked down, lands (nothing can hit it lying down).
    state.fighters.forEach((defender, slot) => {
      const attacker = 1 - slot, live = defender.combo >= 2 && (defender.stun > 0 && !defender.blockStun || defender.launched) && !(defender.launched && defender.y === 0);
      if (live) view.combos[attacker] = { hits: defender.combo, damage: defender.comboDamage, life: 70 };
      const c = view.combos[attacker]; if (!c || --c.life <= 0) return;
      const x = attacker ? 930 : 30, align = attacker ? 'right' : 'left', alpha = Math.min(1, c.life / 15), color = attacker ? '#3df2ff' : '#ffe600';
      screenText(c.hits + ' HITS', x, 150, 40, color, align, alpha);
      screenText(Math.round(c.damage * 100 / LIFE) + '% DAMAGE', x, 172, 15, '#ece8dc', align, alpha);
    });
    for (const e of state.effects) {
      if (e.type === 'banner') {
        const t = e.maxLife - e.life, slide = Math.min(1, t / 8), x = e.slot ? 930 + (1 - slide) * 200 : 30 - (1 - slide) * 200, pop = Math.max(0, 1 - t / 5);
        ctx.save(); ctx.translate(x, 122); ctx.scale(1 + pop * 1.2, 1 + pop * 1.2);
        screenText(e.text, 0, 0, 24, e.slot ? '#3df2ff' : '#ffe600', e.slot ? 'right' : 'left', Math.min(1, e.life / 12)); ctx.restore();
      }
      if (e.type === 'super') {
        // Full-screen cut-in while the engine holds the cinematic freeze.
        const progress = 1 - e.life / e.maxLife, data = fighterData(e.slot), img = art(assetSource(data.cutin)) || art(portraitSource(data, true));
        const bandX = (e.slot ? 1 : -1) * (1 - Math.min(1, progress * 4)) * 960;
        ctx.save(); ctx.globalAlpha = .55 * Math.min(1, e.life / 6); ctx.fillStyle = '#05080b'; ctx.fillRect(0, 0, 960, 540);
        ctx.globalAlpha = Math.min(1, e.life / 6);
        ctx.fillStyle = '#7a1f1c'; ctx.fillRect(bandX, 150, 960, 170); ctx.fillStyle = '#c4a25e'; ctx.fillRect(bandX, 146, 960, 4); ctx.fillRect(bandX, 320, 960, 4);
        if (img) { ctx.save(); ctx.beginPath(); ctx.rect(bandX, 150, 960, 170); ctx.clip(); cover(img, bandX + (e.slot ? 380 : 0), 150, 580, 170); ctx.restore(); }
        screenText(((data.superMove?.name || (data.specialMove?.name ? data.specialMove.name + ' MAX' : 'SUPER FINISH')) + (e.desperation ? ' · MAX' : '')).toUpperCase(), bandX + (e.slot ? 40 : 920), 300, 22, '#ffe600', e.slot ? 'left' : 'right');
        ctx.restore();
      }
    }
  }
  // Reads the frame the caller already tracks, sizes the canvas to the device and clears it. Nothing here mutates game state.
  function beginFrame(frame) {
    ({ state, manifest, stageIndex, selected, mode, arcade, training, cutin, goFrames, fighterRenderer, bestScore } = frame);
    reducedMotion.matches = !!frame.reducedMotion; debugBoxes = !!frame.debugBoxes; view.beat++;
    if (state && state.frame !== view.frameSeen) { view.frameSeen = state.frame; view.ticks++; }
    // Lite devices (window.CFZ_LITE) stop at 1.25 device pixels per unit; a phone at 3x would otherwise fill 2500x1400.
    const density = Math.min(root.CFZ_LITE ? 1.25 : 3, Math.max(1, (canvas.clientWidth || 960) * Math.min(root.devicePixelRatio || 1, 3) / 960));
    const backing = Math.round(960 * density);
    if (canvas.width !== backing) { canvas.width = backing; canvas.height = Math.round(540 * density); }
    if (labelDensity !== density) { labelDensity = density; labels.clear(); thumbnails = new WeakMap(); }
    ctx.setTransform(density, 0, 0, density, 0, 0); ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, 960, 540);
    return state?.fighters || E.create(selected.map(i => manifest.fighters[i].id)).fighters;
  }
  // New engine effects shake the camera and spawn sparks exactly once each. The impact flash and the negative flash are
  // drawn by the Canvas path only (Pixi has its own); sparks, dust and rings are shared.
  function observeEffects() {
    if (state) for (const e of state.effects) if (!view.seen.has(e)) {
      view.seen.add(e);
      if (e.type === 'hit') { const tier = SPARK_TIERS[sparkTier(e)]; spawnSparks(e); view.shake = Math.max(view.shake, tier.shake); view.flash = Math.max(view.flash, tier.flash); }
      if (e.type === 'block') { spawnSparks(e); view.shake = Math.max(view.shake, 1.5); }
      if (e.type === 'counter') { view.invert = 2; if (!reducedMotion.matches) ring(e.x, e.y, 20, 7, '#ff2a2a', 5, 14); }
      if (e.type === 'wall') {
        // A wall thud: a shake by the force of the slide and dust down the wall and along the floor.
        const force = Math.min(10, e.force || 3);
        view.shake = Math.max(view.shake, 2 + force * .6);
        dust(e.x, E.GROUND - 6, -e.facing, 3 + Math.round(force / 2), 12 + force * 1.5);
        for (let i = 1; i <= 3; i++) dust(e.x, E.GROUND - i * 55, -e.facing, 1, 8 + force);
      }
      if (e.type === 'superjump') { dust(e.x - 20, E.GROUND - 4, -1, 4, 16); dust(e.x + 20, E.GROUND - 4, 1, 4, 16); view.shake = Math.max(view.shake, 2); }
      if (e.type === 'super') view.shake = Math.max(view.shake, 10);
      if (e.type === 'ko') view.shake = Math.max(view.shake, 14);
    }
    // Slide dust: a puff at the feet of a grounded fighter sliding a unit a frame or more, once per simulated frame.
    if (state && state.motionFrame !== view.dustClock) {
      view.dustClock = state.motionFrame;
      for (const f of state.fighters) if (f.y === 0 && Math.abs(f.slide || 0) >= 1) {
        const speed = Math.abs(f.slide), dir = Math.sign(f.slide);
        dust(f.x - dir * 22, E.GROUND - 4, -dir, speed > 4 ? 2 : 1, 8 + speed * 2);
      }
    }
  }
  // Effects drawn as shapes in world space: the wall thud's streak, the super jump's ground ring and the counter ring.
  const FEEL_EFFECTS = new Set(['wall', 'superjump', 'counter']);
  function feelEffect(e, progress) {
    ctx.save(); ctx.globalAlpha = progress; ctx.lineCap = 'round';
    if (e.type === 'wall') {
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 2 + 5 * progress;
      ctx.beginPath(); ctx.moveTo(e.x, e.y - 100); ctx.lineTo(e.x, Math.min(E.GROUND, e.y + 110));
      for (let i = 0; i < 4; i++) { const y = e.y - 75 + i * 50; ctx.moveTo(e.x, y); ctx.lineTo(e.x - e.facing * (18 + 34 * (1 - progress)), y - 6); }
      ctx.stroke();
    } else if (e.type === 'superjump') {
      ctx.strokeStyle = '#ffe7b0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, 30 + 80 * (1 - progress), 8 + 7 * (1 - progress), 0, 0, Math.PI * 2);
      for (const dx of [-26, 0, 26]) { ctx.moveTo(e.x + dx, e.y - 20 - 60 * (1 - progress)); ctx.lineTo(e.x + dx, e.y - 70 - 120 * (1 - progress)); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawWorld(fighters) {
    stageLayer();
    if (!state && ui('title')) { ctx.globalAlpha = .6; cover(ui('title'), 0, 0, 960, 540); ctx.globalAlpha = 1; }
    ctx.save(); worldTransform();
    fighters.forEach(drawFighter);
    drawDust();
    if (state) {
      state.projectiles.forEach(p => {
        const size = p.super ? 150 : 85, radius = p.super ? 55 : 28;
        if (!effect('projectile', p.x, E.GROUND - p.y, p.facing, 1, size)) {
          const gradient = ctx.createRadialGradient(p.x, E.GROUND - p.y, 2, p.x, E.GROUND - p.y, radius);
          gradient.addColorStop(0, '#fff8da'); gradient.addColorStop(.4, p.owner ? '#82d6c5' : '#ffa657'); gradient.addColorStop(1, '#ffffff00'); ctx.fillStyle = gradient; ctx.fillRect(p.x - radius - 2, E.GROUND - p.y - radius - 2, radius * 2 + 4, radius * 2 + 4);
        }
      });
      state.effects.forEach(e => {
        if (['ko', 'banner', 'super'].includes(e.type)) return;
        const progress = e.life / e.maxLife;
        if (FEEL_EFFECTS.has(e.type)) { feelEffect(e, progress); return; }
        if (effect(e.type, e.x, e.y, e.facing, progress, e.type === 'powerup' ? 230 : 115)) return;
        ctx.save(); ctx.globalAlpha = progress; ctx.strokeStyle = e.type === 'block' ? '#82d6c5' : '#ffc37f'; ctx.lineWidth = 3;
        ctx.beginPath(); if (e.type === 'dust') ctx.ellipse(e.x, e.y, 40 * (1 - progress) + 10, 9, 0, 0, 7);
        else if (e.type === 'powerup') ctx.ellipse(e.x, e.y, 50 * (1 - progress) + 30, 110, 0, 0, 7);
        else for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(e.x + Math.cos(a) * 5, e.y + Math.sin(a) * 5); ctx.lineTo(e.x + Math.cos(a) * 45 * (1 - progress + .3), e.y + Math.sin(a) * 45 * (1 - progress + .3)); }
        ctx.stroke(); ctx.restore();
      });
      drawParticles();
      hitboxes();
    }
    ctx.restore();
    if (scenery && state) scenery.drawFront(ctx, sceneryInfo());
  }
  // Training hitboxes in world space, for a renderer that draws the world elsewhere.
  function drawHitboxes() { ctx.save(); worldTransform(); hitboxes(); ctx.restore(); }
  function drawScreen(fighters) {
    if (state) {
      const ko = state.effects.find(e => e.type === 'ko');
      if (ko) effect('ko', 480, 250, 1, ko.life / ko.maxLife, 260);
      if (cutin && cutin.life > 0) {
        const img = art(assetSource(fighterData(cutin.slot).cutin));
        if (img) { ctx.save(); ctx.globalAlpha = Math.min(1, cutin.life / 10); ctx.fillStyle = '#101b20cc'; ctx.fillRect(0, 125, 960, 110); cover(img, cutin.slot ? 480 : 0, 125, 480, 110); ctx.restore(); }
        const special = fighterData(cutin.slot).specialMove?.name;
        if (special) { ctx.save(); ctx.globalAlpha = Math.min(1, cutin.life / 10); ctx.fillStyle = '#151719eb'; ctx.fillRect(0, 220, 960, 42); text(special.toUpperCase() + '!', 480, 250, { font: `18px ${PIXEL}`, fill: cutin.slot ? '#3df2ff' : '#ffe600', stroke: '#000', lineWidth: 4, align: 'center' }); ctx.restore(); }
      }
      overlays();
    }
    hud();
    if (!state && ui('logo')) { const img = ui('logo'); ctx.drawImage(img, 380, 92, 200, Math.min(95, 200 * img.height / img.width)); }
    // Round calls slammed in arcade style: ROUND n / FINAL ROUND, FIGHT!, then K.O., DOUBLE K.O., TIME OVER, PERFECT or DRAW GAME.
    const headline = !state ? '' : state.phase === 'intro' ? (state.phaseFrames > 30 ? state.message : '') : state.phase === 'fight' && goFrames > 0 ? 'FIGHT!' : state.phase === 'roundover' ? state.message : '';
    if (view.clock.text !== headline) { view.clock.text = headline; view.clock.frames = 0; } else view.clock.frames++;
    if (headline && mode !== 'training') {
      const k = view.clock.frames, pop = Math.max(0, 1 - k / 6), hot = headline === 'FIGHT!' || headline.includes('K.O.');
      // A white flash on the frames the FIGHT! and K.O. calls land.
      if ((hot || headline === 'PERFECT') && k < 3) { ctx.fillStyle = `rgba(255,255,255,${(3 - k) / 3 * .8})`; ctx.fillRect(0, 0, 960, 540); }
      const size = headline === 'K.O.' ? 110 : headline.length > 8 ? 40 : 64;
      slam(headline, 480, 262, size, hot ? '#ff2a2a' : '#ffe600', pop, 1, hot ? '#ffe600' : '#ff2a2a');
      if (state.phase === 'roundover' && state.phaseFrames < 110 && state.winner !== null && state.winner !== undefined) {
        text(fighterData(state.winner).name.toUpperCase() + ' TAKES THE ROUND', 480, 302, { font: `10px ${PIXEL}`, fill: '#fff', stroke: '#000', lineWidth: 4, align: 'center' });
      }
    }
  }
  // The impact frames over the world (not the HUD), as on the Pixi path: an additive white flash on hits, by spark tier,
  // and a negative flash for two frames on a counter hit.
  function impactFrames() {
    if (!reducedMotion.matches && state) {
      if (view.flash > .02) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = view.flash; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 960, 540); ctx.restore(); }
      if (view.invert > 0) { ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 960, 540); ctx.restore(); }
    }
    view.flash = view.flash * .62 < .02 ? 0 : view.flash * .62; view.invert = Math.max(0, view.invert - 1);
  }
  function draw(frame) {
    const fighters = beginFrame(frame);
    updateCamera(fighters, !state); observeEffects(); stepParticles();
    drawWorld(fighters); impactFrames(); drawScreen(fighters);
  }
    // Colour of one point in the 960x540 layout, for tests that check the rendered stage.
    function pixel(x, y) {
      const k = canvas.width / 960, d = ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    return { kind: 'canvas', draw, sceneryInfo, scenery, reset: resetView, pixel, view, beginFrame, updateCamera, observeEffects, stepParticles, drawScreen, drawHitboxes, hitShake, sparkTier, clear: () => ctx.clearRect(0, 0, 960, 540) };
  }
  root.CFZCanvasRenderer = { create: createCanvasRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
