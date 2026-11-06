// Canvas 2D arena renderer: the original draw path (stage, fighters, effects, camera, HUD and callouts),
// kept complete so a browser without WebGL still plays, and so the Pixi renderer can reuse its screen layer.
(function (root) {
  'use strict';
  function createCanvasRenderer({ canvas, engine: E, deps }) {
    const ctx = canvas.getContext('2d');
    const { art, assetSource, ui, fighterData, portraitSource } = deps;
    // Life points per fighter (engines before the 1000-point scale used 100).
    const LIFE = E.MAX_HP || 100;
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
  function drawFighter(f, slot) {
    const data = fighterData(slot);
    // Mirror matches recolor the second fighter so both players stay readable.
    const palette = slot === 1 && selected[0] === selected[1] ? 155 : 0;
    if (!fighterRenderer?.draw(ctx, f, data, art, state, { ground: E.GROUND, height: 225, reducedMotion: reducedMotion.matches, palette })) fallbackFighter(f, data);
  }
  const PIXEL = "'Press Start 2P', Impact, sans-serif";
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
      if (portrait) { ctx.save(); ctx.beginPath(); ctx.rect(px + 2, 12, 50, 50); ctx.clip(); if (slot) { ctx.translate(px * 2 + 54, 0); ctx.scale(-1, 1); } cover(portrait, px + 2, 12, 50, 50); ctx.restore(); }
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
      ctx.textAlign = slot ? 'right' : 'left'; ctx.font = `14px ${PIXEL}`; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const nameX = slot ? x + width - 4 : x + 4; ctx.strokeText(data.name.toUpperCase(), nameX, 72); ctx.fillStyle = '#fff'; ctx.fillText(data.name.toUpperCase(), nameX, 72);
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
      ctx.fillStyle = '#fff'; ctx.font = `7px ${PIXEL}`; ctx.textAlign = slot ? 'right' : 'left'; ctx.fillText('POWER', slot ? gx + gw : gx, gy - 4);
      ctx.textAlign = 'center'; ctx.font = `14px ${PIXEL}`; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const label = full ? 'MAX' : String(stocks), lx = slot ? gx - 30 + 0 : gx + gw + 32;
      ctx.strokeText(label, slot ? gx - 22 : lx, gy + 10); ctx.fillStyle = full ? (flash ? '#ffe600' : '#fff') : stocks ? '#fff' : '#555'; ctx.fillText(label, slot ? gx - 22 : lx, gy + 10);
    });
    // Timer plate; training and endless rounds show infinity.
    ctx.fillStyle = '#000'; ctx.fillRect(448, 12, 64, 60); ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.strokeRect(448, 12, 64, 60);
    const endless = mode === 'training' || state?.options?.roundTime === 0;
    const seconds = Math.ceil((state?.time ?? 5940) / 60), time = endless ? '∞' : String(seconds).padStart(2, '0');
    ctx.textAlign = 'center'; ctx.font = `${endless ? 36 : 28}px ${PIXEL}`; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(time, 480, 56);
    ctx.fillStyle = !endless && seconds <= 10 && state?.phase === 'fight' && flash ? '#ff2a2a' : '#ffe600'; ctx.fillText(time, 480, 56);
    ctx.font = `7px ${PIXEL}`; ctx.fillStyle = '#fff'; ctx.fillText(mode === 'training' ? 'TRAINING' : 'ROUND ' + (state?.round || 1), 480, 90);
    // Arcade score line.
    if (arcade && mode === 'arcade') {
      const best = bestScore;
      ctx.font = `9px ${PIXEL}`; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      ctx.textAlign = 'right'; ctx.strokeText('1UP ' + String(arcade.score).padStart(8, '0'), 420, 20); ctx.fillStyle = '#fff'; ctx.fillText('1UP ' + String(arcade.score).padStart(8, '0'), 420, 20);
      ctx.textAlign = 'left'; ctx.strokeText('HI-SCORE ' + String(Math.max(best, arcade.score)).padStart(8, '0'), 540, 20); ctx.fillStyle = '#ff2a2a'; ctx.fillText('HI-SCORE ' + String(Math.max(best, arcade.score)).padStart(8, '0'), 540, 20);
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
  const view = { x: (E.WIDTH - 960) / 2, zoom: 1, lift: 0, shake: 0, particles: [], combos: [null, null], seen: new WeakSet(), hpShown: [null, null], clock: { text: '', frames: 0 } };
  function resetView() { Object.assign(view, { x: (E.WIDTH - 960) / 2, zoom: 1, lift: 0, shake: 0, particles: [], combos: [null, null], seen: new WeakSet(), hpShown: [null, null], clock: { text: '', frames: 0 } }); }
  function updateCamera(fighters, snap) {
    const [a, b] = fighters, distance = Math.abs(a.x - b.x), mid = (a.x + b.x) / 2;
    // MvC-style framing: fighters fill over half the frame when close (zoom 1.42, about 59% of the height)
    // and the camera eases out to the full span as they separate or leave the ground.
    const highest = Math.max(a.y, b.y), byDistance = 1200 / (distance + 420), byHeight = (FLOOR - 24) / (highest + E.SPRITE_HEIGHT + 30);
    const targetZoom = reducedMotion.matches ? 1 : Math.max(1, Math.min(1.42, byDistance, byHeight));
    const targetLift = reducedMotion.matches ? 0 : Math.min(70, highest * .35);
    const ease = snap ? 1 : .12;
    view.zoom += (targetZoom - view.zoom) * (snap ? 1 : .08); view.zoom = Math.min(1.6, view.zoom); view.lift += (targetLift - view.lift) * ease;
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
    ctx.save(); ctx.translate(-offset, FLOOR * (1 - scale) + view.lift * .5); ctx.scale(scale, scale); stageDraw(); ctx.restore();
  }
  function spawnSparks(e) {
    if (reducedMotion.matches) return;
    const count = e.type === 'block' ? 6 : e.heavy ? 18 : 10, color = e.type === 'block' ? '#9fd8e6' : e.heavy ? '#ffd27a' : '#fff1c9';
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - .5) * Math.PI * 1.2 + (e.facing > 0 ? 0 : Math.PI), speed = 3 + Math.random() * (e.heavy ? 9 : 6);
      view.particles.push({ x: e.x, y: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2, life: 14 + Math.random() * 10, max: 24, color, size: e.heavy ? 4 : 3 });
    }
  }
  function stepParticles() {
    view.particles = view.particles.filter(pt => pt.life > 0);
    for (const pt of view.particles) { pt.x += pt.vx; pt.y += pt.vy; pt.vy += .45; pt.vx *= .92; pt.life--; }
  }
  function drawParticles() {
    for (const pt of view.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max); ctx.fillStyle = pt.color; ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }
  function screenText(text, x, y, size, fill, align = 'center', alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = align; ctx.font = `${Math.round(size * .8)}px ${PIXEL}`; ctx.lineWidth = Math.max(3, size / 8); ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y); ctx.restore();
  }
  // Arcade callout: the text slams in from a larger scale (pop 1 → 0) and can carry a second colour outline.
  function slam(text, x, y, size, fill, pop, alpha = 1, edge = null) {
    ctx.save(); ctx.translate(x, y); const k = 1 + pop * 2.2; ctx.scale(k, k);
    if (edge) { ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.font = `${Math.round(size * .8)}px ${PIXEL}`; ctx.lineWidth = Math.max(6, size / 4); ctx.strokeStyle = edge; ctx.strokeText(text, 0, 0); }
    screenText(text, 0, 0, size, fill, 'center', alpha); ctx.restore();
  }
  function overlays() {
    // Combo counters sit on the attacker's side and linger after the combo ends.
    state.fighters.forEach((defender, slot) => {
      const attacker = 1 - slot, live = defender.combo >= 2 && (defender.stun > 0 && !defender.blockStun || defender.launched);
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
    reducedMotion.matches = !!frame.reducedMotion; debugBoxes = !!frame.debugBoxes;
    const density = Math.min(3, Math.max(1, (canvas.clientWidth || 960) * Math.min(root.devicePixelRatio || 1, 3) / 960));
    const backing = Math.round(960 * density);
    if (canvas.width !== backing) { canvas.width = backing; canvas.height = Math.round(540 * density); }
    ctx.setTransform(density, 0, 0, density, 0, 0); ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, 960, 540);
    return state?.fighters || E.create(selected.map(i => manifest.fighters[i].id)).fighters;
  }
  // New engine effects shake the camera and spawn sparks exactly once each.
  function observeEffects() {
    if (state) for (const e of state.effects) if (!view.seen.has(e)) {
      view.seen.add(e);
      if (e.type === 'hit') { spawnSparks(e); view.shake = Math.max(view.shake, e.heavy ? 8 : 3); }
      if (e.type === 'block') { spawnSparks(e); view.shake = Math.max(view.shake, 1.5); }
      if (e.type === 'super') view.shake = Math.max(view.shake, 10);
      if (e.type === 'ko') view.shake = Math.max(view.shake, 14);
    }
  }
  function drawWorld(fighters) {
    stageLayer();
    if (!state && ui('title')) { ctx.globalAlpha = .6; cover(ui('title'), 0, 0, 960, 540); ctx.globalAlpha = 1; }
    ctx.save(); worldTransform();
    fighters.forEach(drawFighter);
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
        if (special) { ctx.save(); ctx.globalAlpha = Math.min(1, cutin.life / 10); ctx.fillStyle = '#151719eb'; ctx.fillRect(0, 220, 960, 42); ctx.textAlign = 'center'; ctx.font = `18px ${PIXEL}`; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(special.toUpperCase() + '!', 480, 250); ctx.fillStyle = cutin.slot ? '#3df2ff' : '#ffe600'; ctx.fillText(special.toUpperCase() + '!', 480, 250); ctx.restore(); }
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
        ctx.textAlign = 'center'; ctx.font = `10px ${PIXEL}`; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
        const sub = fighterData(state.winner).name.toUpperCase() + ' TAKES THE ROUND';
        ctx.strokeText(sub, 480, 302); ctx.fillStyle = '#fff'; ctx.fillText(sub, 480, 302);
      }
    }
  }
  function draw(frame) {
    const fighters = beginFrame(frame);
    updateCamera(fighters, !state); observeEffects(); stepParticles();
    drawWorld(fighters); drawScreen(fighters);
  }
    // Colour of one point in the 960x540 layout, for tests that check the rendered stage.
    function pixel(x, y) {
      const k = canvas.width / 960, d = ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    return { kind: 'canvas', draw, reset: resetView, pixel, view, beginFrame, updateCamera, observeEffects, stepParticles, drawScreen, drawHitboxes, clear: () => ctx.clearRect(0, 0, 960, 540) };
  }
  root.CFZCanvasRenderer = { create: createCanvasRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
