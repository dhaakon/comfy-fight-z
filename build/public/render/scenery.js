// Living stage scenery, shared by both arena renderers (pure Canvas 2D drawing; the Pixi path paints offscreen
// canvases used as textures). Visual only: nothing here reads or changes the simulation.
//
// stage.scenery comes from the stage-scenery ComfyUI workflow (comfyui/workflows/factory/stage-scenery.json):
//   layers   cut-out background characters and props at their exact place on the painting (fractions), each with a
//            motion: still, idle (breathing), cheer (bounces when the fight heats up), hover, sway, flicker, pulse,
//            drift (patrols side to side), bob (floats on water) or spin
//   effects  ambient effects anchored on features of the painting: blink, glow, screen, hologram, steam, smoke,
//            sparks, torch, drip, searchlight, traffic, birds, clouds, fog, lightning, ripples, shimmer, wave, spin,
//            flash, embers, fireflies
//   weather  what falls in front of the fight: none, rain, storm, snow, leaves, petals, dust, embers or ash
// Layers and effects are drawn in the painting's own 960x540 cover space, inside the stage transform, so they keep
// its parallax and scale exactly; weather is drawn over the fighters with a faster parallax. A stage without scenery
// still gets weather guessed from its description (or stage.ambience).
(function (root) {
  'use strict';
  const WEATHER = ['none', 'rain', 'storm', 'snow', 'leaves', 'petals', 'dust', 'embers', 'ash'];
  const KEYWORDS = { rain: /rain/i, snow: /snow|winter|frost/i, leaves: /garden|park|forest|autumn|leaves/i, dust: /dust|desert|yard|patio|sunset|golden hour/i };
  function weather(stage) {
    if (stage?.scenery?.weather && WEATHER.includes(stage.scenery.weather)) return stage.scenery.weather;
    if (Array.isArray(stage?.ambience)) return stage.ambience.find(item => WEATHER.includes(item)) || 'none';
    const text = `${stage?.name || ''} ${stage?.description || ''}`;
    return Object.keys(KEYWORDS).find(key => KEYWORDS[key].test(text)) || 'none';
  }
  // A cheap deterministic hash: placements and rhythms are stable per stage, per effect and per index.
  const hash = (n, seed = 1) => { let x = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const stageSeed = stage => [...String(stage?.id || 'stage')].reduce((s, c) => s * 31 + c.charCodeAt(0) >>> 0, 7);
  const noise = (t, seed) => { const i = Math.floor(t), f = t - i, k = f * f * (3 - 2 * f); return hash(i, seed) + (hash(i + 1, seed) - hash(i, seed)) * k; };
  const wrap = (value, span) => ((value % span) + span) % span;
  const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`; };
  function glowDot(ctx, x, y, r, color, a) {
    if (a <= 0 || r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a)); g.addColorStop(.35, rgba(color, a * .45)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // A tired neon tube: breathing light with rare dropouts.
  const flicker = (t, seed) => hash(Math.floor(t * 9), seed + 11) < .04 ? .05 : Math.max(0, Math.min(1, .65 + .2 * Math.sin(t * (1.7 + hash(2, seed))) + .3 * (noise(t * 6, seed) - .5)));

  // ------------------------------------------------------------------------------------------------- effects
  // Each draws one effect in cover space: m maps painting fractions to it, u is its scale against a 960-wide view.
  const box = (e, m) => ({ x: m.X(e.box.x), y: m.Y(e.box.y), w: m.W(e.box.w), h: m.H(e.box.h), src: m.src(e.box) });
  function plume(ctx, e, m, t, seed, smoke) {
    const x0 = m.X(e.point.x), y0 = m.Y(e.point.y), life = smoke ? 5 : 3.4, rise = (smoke ? 110 : 70) * m.u, drift = (hash(1, seed) - .3) * 30 * m.u, color = smoke ? '60,58,64' : '226,232,240';
    for (let i = 0, n = smoke ? 11 : 9; i < n; i++) {
      const age = wrap(t + hash(i, seed) * life, life) / life, x = x0 + drift * age + Math.sin(age * 5 + i) * 6 * m.u * age, y = y0 - rise * age;
      const r = (5 + age * (smoke ? 34 : 24)) * m.u, a = (smoke ? .3 : .24) * (1 - age) * Math.min(1, age * 6), g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const EFFECTS = {
    blink(ctx, e, m, t, seed) {
      const color = e.color || '#ff3b30', period = 1.1 + hash(1, seed) * 1.3;
      ctx.globalCompositeOperation = 'lighter';
      e.points.forEach((p, i) => {
        const phase = wrap(t / period + hash(i + 3, seed) * .3, 1), on = phase < .28, x = m.X(p.x), y = m.Y(p.y);
        glowDot(ctx, x, y, (on ? 15 : 6) * m.u, color, on ? 1 - phase / .28 * .5 : .12);
        if (on) glowDot(ctx, x, y, 2.4 * m.u, '#ffffff', .9);
      });
    },
    glow(ctx, e, m, t, seed) {
      const b = box(e, m), f = flicker(t, seed), color = e.color || '#ffd38a', r = Math.max(b.w, b.h) * .75, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .1 + .3 * f; ctx.drawImage(m.plate, ...b.src, b.x, b.y, b.w, b.h); ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, rgba(color, .16 * f)); g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    },
    // A billboard: its own picture, then a hue-shifted take, then a scrolling marquee, switched through static.
    screen(ctx, e, m, t, seed) {
      const b = box(e, m), [sx, sy, sw, sh] = b.src, cycle = 3.2 + hash(1, seed) * 2.6, position = t / cycle + hash(2, seed), k = Math.floor(position), local = (position - k) * cycle;
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      const mode = Math.floor(hash(k, seed + 5) * 3);
      // A re-tinted take stays near the painting's own palette: a neighbouring hue, never the opposite one.
      if (mode === 1) { ctx.filter = `hue-rotate(${Math.round((hash(k, seed + 6) < .5 ? -1 : 1) * (40 + hash(k, seed + 7) * 60))}deg) saturate(1.3)`; ctx.drawImage(m.plate, sx, sy, sw, sh, b.x, b.y, b.w, b.h); ctx.filter = 'none'; }
      else if (mode === 2) { const off = local / cycle * b.h; ctx.drawImage(m.plate, sx, sy, sw, sh, b.x, b.y - off, b.w, b.h); ctx.drawImage(m.plate, sx, sy, sw, sh, b.x, b.y - off + b.h, b.w, b.h); }
      const band = b.y + wrap(t * .45 + hash(3, seed), 1) * (b.h + 20) - 10, g = ctx.createLinearGradient(0, band - 6, 0, band + 6);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(b.x, band - 6, b.w, 12); ctx.globalCompositeOperation = 'source-over';
      if (local < .22) {
        ctx.fillStyle = `rgba(0,0,0,${local < .08 ? .7 : .25})`; ctx.fillRect(b.x, b.y, b.w, b.h);
        const frame = Math.floor(t * 30);
        for (let i = 0; i < 18; i++) { ctx.fillStyle = `rgba(255,255,255,${.08 + hash(i + frame, seed) * .25})`; ctx.fillRect(b.x, b.y + hash(i * 7 + frame, seed) * b.h, b.w, 1 + hash(i, seed) * 2); }
      } else if (hash(Math.floor(t * 8), seed + 9) < .07) {
        const slot = Math.floor(t * 8);
        for (let i = 0; i < 4; i++) {
          const f = hash(i + slot * 5, seed), rh = b.h * .08, dx = (hash(i + 3, slot) - .5) * b.w * .12;
          ctx.drawImage(m.plate, sx, sy + f * sh, sw, rh / b.h * sh, b.x + dx, b.y + f * b.h, b.w, rh);
        }
      }
    },
    hologram(ctx, e, m, t, seed) {
      const b = box(e, m), [sx, sy, sw, sh] = b.src, glitchy = hash(Math.floor(t * 3), seed) < .25, rows = Math.max(6, Math.min(60, Math.round(b.h / 3)));
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .3 + .25 * flicker(t * 1.3, seed);
      for (let i = 0; i < rows; i++) {
        const f = i / rows, dx = (glitchy ? (hash(i + Math.floor(t * 14) * 31, seed) - .5) * 6 : Math.sin(t * 3 + i * .7) * .6) * m.u;
        ctx.drawImage(m.plate, sx, sy + f * sh, sw, sh / rows, b.x + dx, b.y + f * b.h, b.w, b.h / rows);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,0,0,.16)';
      const step = 3 * m.u;
      for (let y = b.y + wrap(t * 12 * m.u, step); y < b.y + b.h; y += step) ctx.fillRect(b.x, y, b.w, m.u);
    },
    steam: (ctx, e, m, t, seed) => plume(ctx, e, m, t, seed, false),
    smoke: (ctx, e, m, t, seed) => plume(ctx, e, m, t, seed, true),
    sparks(ctx, e, m, t, seed) {
      const x0 = m.X(e.point.x), y0 = m.Y(e.point.y), period = 1.6 + hash(1, seed) * 2.4, k = Math.floor(t / period), local = t - k * period;
      if (local > .75 || hash(k, seed + 3) > .8) return;
      const gravity = 420 * m.u, fade = 1 - local / .75;
      ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.4 * m.u;
      for (let j = 0; j < 14; j++) {
        const angle = -Math.PI / 2 + (hash(k * 31 + j, seed) - .5) * 2.4, speed = (50 + hash(k * 17 + j, seed + 1) * 110) * m.u, l = local * (.6 + hash(j, k) * .4);
        const px = x0 + Math.cos(angle) * speed * l, py = y0 + Math.sin(angle) * speed * l + .5 * gravity * l * l, vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed + gravity * l;
        ctx.strokeStyle = `rgba(255,${190 + (j % 3) * 20},110,${fade})`; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - vx * .025, py - vy * .025); ctx.stroke();
      }
      glowDot(ctx, x0, y0, 16 * m.u, e.color || '#ffd27a', .6 * fade);
    },
    torch(ctx, e, m, t, seed) {
      const x = m.X(e.point.x), y = m.Y(e.point.y), f = .75 + .25 * noise(t * 7, seed), h = 16 * m.u * f, w = 6 * m.u, sway = Math.sin(t * 9 + seed) * 1.5 * m.u;
      ctx.globalCompositeOperation = 'lighter';
      glowDot(ctx, x, y - h * .4, 34 * m.u * f, e.color || '#ff9a3c', .35);
      for (const [color, s] of [['rgba(255,120,30,.75)', 1], ['rgba(255,200,80,.85)', .62], ['rgba(255,250,220,.9)', .3]]) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x - w * s, y);
        ctx.quadraticCurveTo(x - w * s, y - h * s * .6, x + sway * s, y - h * s); ctx.quadraticCurveTo(x + w * s, y - h * s * .6, x + w * s, y); ctx.closePath(); ctx.fill();
      }
    },
    drip(ctx, e, m, t, seed) {
      const fall = 46 * m.u;
      e.points.forEach((p, i) => {
        const x = m.X(p.x), y = m.Y(p.y), period = 1.3 + hash(i, seed) * 1.6, local = wrap(t + hash(i + 9, seed) * period, period);
        if (local < .55) { ctx.fillStyle = 'rgba(190,215,255,.75)'; ctx.beginPath(); ctx.ellipse(x, y + fall * (local / .55) ** 2, 1.2 * m.u, 2.4 * m.u, 0, 0, 6.283); ctx.fill(); }
        else if (local < .8) { const s = (local - .55) / .25; ctx.strokeStyle = `rgba(190,215,255,${.6 * (1 - s)})`; ctx.lineWidth = m.u; ctx.beginPath(); ctx.ellipse(x, y + fall, 5 * m.u * s + .1, 1.5 * m.u * s + .1, 0, 0, 6.283); ctx.stroke(); }
      });
    },
    searchlight(ctx, e, m, t, seed) {
      const x = m.X(e.point.x), y = m.Y(e.point.y), angle = -Math.PI / 2 + Math.sin(t * (.25 + hash(1, seed) * .2) + hash(2, seed) * 6) * .55, length = 520 * m.u, spread = .07, color = e.color || '#dfe9ff';
      const g = ctx.createLinearGradient(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      g.addColorStop(0, rgba(color, .22)); g.addColorStop(1, rgba(color, 0));
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle - spread) * length, y + Math.sin(angle - spread) * length); ctx.lineTo(x + Math.cos(angle + spread) * length, y + Math.sin(angle + spread) * length); ctx.closePath(); ctx.fill();
      glowDot(ctx, x, y, 10 * m.u, color, .5);
    },
    // Distant vehicles: head and tail lights with a short trail, lanes alternating direction.
    traffic(ctx, e, m, t, seed) {
      const b = box(e, m), lanes = Math.max(2, Math.min(5, Math.round(b.h / (14 * m.u)))), margin = 40 * m.u, span = b.w + margin * 2;
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
      for (let lane = 0; lane < lanes; lane++) {
        const dir = lane % 2 ? -1 : 1, ly = b.y + (lane + .5) / lanes * b.h, size = (1 + lane / lanes * .6) * m.u;
        for (let v = 0, count = 2 + Math.floor(hash(lane, seed) * 2); v < count; v++) {
          const pos = wrap(t * (26 + hash(lane * 7 + v, seed) * 40) * m.u + hash(lane * 13 + v, seed + 1) * span, span), vx = dir > 0 ? b.x - margin + pos : b.x + b.w + margin - pos;
          const trail = ctx.createLinearGradient(vx, 0, vx - dir * 22 * size, 0); trail.addColorStop(0, 'rgba(255,90,90,.5)'); trail.addColorStop(1, 'rgba(255,90,90,0)');
          ctx.fillStyle = trail; ctx.fillRect(Math.min(vx, vx - dir * 22 * size), ly - size, 22 * size, 2 * size);
          glowDot(ctx, vx + dir * 6 * size, ly, 5 * size, '#fff6d8', .9); glowDot(ctx, vx, ly, 3 * size, '#ff4040', .7);
        }
      }
    },
    birds(ctx, e, m, t, seed) {
      const b = box(e, m), period = 16 + hash(1, seed) * 10, dir = hash(2, seed) < .5 ? 1 : -1, travel = wrap(t + hash(3, seed) * period, period) / (period * .75);
      if (travel > 1) return;
      ctx.strokeStyle = e.color ? rgba(e.color, .85) : 'rgba(25,22,30,.85)'; ctx.lineWidth = 1.3 * m.u; ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const lead = (b.w + 40) * travel - (i % 3) * 9 * m.u - Math.floor(i / 3) * 14 * m.u, bx = dir > 0 ? b.x - 20 + lead : b.x + b.w + 20 - lead;
        const by = b.y + b.h * (.3 + .4 * hash(i, seed)) + Math.sin(t * 1.4 + i) * 4 * m.u, s = (3 + hash(i + 5, seed) * 2) * m.u, flap = Math.sin(t * 11 + i * 1.7) * .9;
        ctx.beginPath(); ctx.moveTo(bx - s, by - s * flap); ctx.lineTo(bx, by); ctx.lineTo(bx + s, by - s * flap); ctx.stroke();
      }
    },
    clouds(ctx, e, m, t, seed) {
      const b = box(e, m), color = e.color || '#f4f1ea', span = b.w + 160 * m.u;
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      for (let i = 0; i < 4; i++) {
        const cx = b.x - 80 * m.u + wrap(t * (4 + hash(i, seed) * 6) * m.u + hash(i + 2, seed) * span, span), cy = b.y + b.h * (.2 + .6 * hash(i + 4, seed)), r = (26 + hash(i + 6, seed) * 30) * m.u;
        for (let j = 0; j < 3; j++) {
          const px = cx + (j - 1) * r * .7, py = cy + (j === 1 ? -r * .25 : 0), g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, rgba(color, .2)); g.addColorStop(1, rgba(color, 0)); ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
    },
    fog(ctx, e, m, t, seed) {
      const b = box(e, m), color = e.color || '#c8d2e6', span = b.w + 200 * m.u;
      for (let i = 0; i < 5; i++) {
        const cx = b.x - 100 * m.u + wrap(t * (6 + hash(i, seed) * 8) * m.u * (i % 2 ? 1 : -1) + hash(i + 3, seed) * span, span), cy = b.y + b.h * (.3 + .5 * hash(i + 5, seed));
        const rx = (80 + hash(i + 7, seed) * 80) * m.u, ry = Math.max(b.h * .6, 12 * m.u);
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, rgba(color, .11)); g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
      }
    },
    lightning(ctx, e, m, t, seed) {
      const b = box(e, m), period = 7 + hash(1, seed) * 6, k = Math.floor(t / period), local = t - k * period;
      if (local > .5) return;
      const i = local < .06 ? 1 : local < .12 ? .25 : local < .2 ? .85 : Math.max(0, 1 - (local - .2) / .3) * .6;
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(210,220,255,${.28 * i})`; ctx.fillRect(b.x, b.y, b.w, b.h);
      if (local >= .22) return;
      let bx = b.x + b.w * (.2 + .6 * hash(k, seed)), by = b.y;
      const end = bx + (hash(k + 1, seed) - .5) * b.w * .3, steps = 9;
      ctx.beginPath(); ctx.moveTo(bx, by);
      for (let s = 1; s <= steps; s++) { by = b.y + b.h * .85 * s / steps; bx += (end - bx) / (steps - s + 1) + (hash(k * 13 + s, seed) - .5) * 22 * m.u; ctx.lineTo(bx, by); }
      ctx.strokeStyle = 'rgba(200,215,255,.35)'; ctx.lineWidth = 5 * m.u; ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6 * m.u; ctx.stroke();
    },
    ripples(ctx, e, m, t, seed) {
      const b = box(e, m), n = Math.max(4, Math.min(16, Math.round(b.w * b.h / (900 * m.u * m.u))));
      ctx.lineWidth = m.u;
      for (let i = 0; i < n; i++) {
        const period = .9 + hash(i, seed) * .9, clock = t + hash(i + 1, seed) * period, cycle = Math.floor(clock / period), age = clock / period - cycle;
        const px = b.x + hash(cycle * 7 + i, seed + 2) * b.w, py = b.y + hash(cycle * 11 + i, seed + 3) * b.h, r = (2 + age * 9) * m.u;
        ctx.strokeStyle = `rgba(205,225,255,${.5 * (1 - age)})`; ctx.beginPath(); ctx.ellipse(px, py, r, r * .35, 0, 0, 6.283); ctx.stroke();
      }
    },
    // Water and glossy reflections: the painting's own rows wobble a pixel or two.
    shimmer(ctx, e, m, t, seed) {
      const b = box(e, m), [sx, sy, sw, sh] = b.src, rows = Math.max(4, Math.min(90, Math.round(b.h / 2)));
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip(); ctx.globalAlpha = .55;
      for (let i = 0; i < rows; i++) {
        const f = i / rows, dx = (Math.sin(f * 40 + t * 2.4 + seed) * 1.6 + Math.sin(f * 13 - t * 1.3) * 1) * m.u;
        ctx.drawImage(m.plate, sx, sy + f * sh, sw, sh / rows + 1, b.x + dx, b.y + f * b.h, b.w, b.h / rows + 1);
      }
    },
    // Foliage, flags and cloth: the painting's rows sway, most at the top.
    wave(ctx, e, m, t, seed) {
      const b = box(e, m), [sx, sy, sw, sh] = b.src, rows = Math.max(4, Math.min(80, Math.round(b.h / 2.5))), amp = Math.min(3.2 * m.u, b.w * .04);
      ctx.beginPath(); ctx.rect(b.x - amp, b.y, b.w + amp * 2, b.h); ctx.clip();
      for (let i = 0; i < rows; i++) {
        const f = i / rows, dx = (Math.sin(t * 1.7 + f * 3 + seed) * .7 + Math.sin(t * 3.1 + f * 7) * .3) * amp * (1 - f);
        ctx.drawImage(m.plate, sx, sy + f * sh, sw, sh / rows + 1, b.x + dx, b.y + f * b.h, b.w, b.h / rows + 1);
      }
    },
    // A fan, wheel or radar: the painted disc turns, squashed to its perspective ellipse.
    spin(ctx, e, m, t, seed) {
      const b = box(e, m), [sx, sy, sw, sh] = b.src, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, b.w / 2, b.h / 2, 0, 0, 6.283); ctx.clip();
      ctx.translate(cx, cy); ctx.scale(1, b.h / b.w); ctx.rotate(t * (2 + hash(1, seed) * 3) * (hash(2, seed) < .5 ? 1 : -1));
      ctx.drawImage(m.plate, sx, sy, sw, sh, -b.w / 2, -b.w / 2, b.w, b.w);
    },
    embers(ctx, e, m, t, seed) {
      const b = box(e, m);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        const life = 2.2 + hash(i, seed) * 1.8, age = wrap(t + hash(i + 1, seed) * life, life) / life;
        glowDot(ctx, b.x + hash(i + 2, seed) * b.w + Math.sin(t * 2 + i) * 6 * m.u, b.y + b.h - age * b.h, 3.5 * m.u, e.color || '#ff9a3c', (1 - age) * (.6 + .4 * Math.sin(t * 13 + i)));
      }
    },
    fireflies(ctx, e, m, t, seed) {
      const b = box(e, m);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) {
        const px = b.x + wrap(hash(i, seed) + .08 * Math.sin(t * (.3 + hash(i + 1, seed) * .4) + i), 1) * b.w, py = b.y + wrap(hash(i + 2, seed) + .1 * Math.sin(t * (.4 + hash(i + 3, seed) * .3) + i * 2), 1) * b.h;
        glowDot(ctx, px, py, 5 * m.u, e.color || '#d8ff6a', .8 * Math.max(0, Math.sin(t * (1.2 + hash(i + 4, seed)) + i * 3)));
      }
    }
  };
  // Fog and camera flashes sit in front of the elements; every other effect belongs to the painting behind them.
  const OVER = new Set(['fog', 'flash']);

  function create() {
    let excitement = 0, seenEffects = new WeakSet(), lastTime = null;
    // Camera flashes go off more often when the fight heats up.
    const flash = (ctx, e, m, t, seed) => {
      const b = box(e, m), slot = Math.floor(t * 6), local = t * 6 - slot, chance = .18 + excitement * .6;
      if (local > .5) return;
      ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1;
      for (let j = 0; j < 3; j++) {
        const k = slot * 3 + j; if (hash(k, seed) > chance) continue;
        const px = b.x + hash(k + 1, seed) * b.w, py = b.y + hash(k + 2, seed) * b.h, a = 1 - local / .5;
        glowDot(ctx, px, py, 18 * m.u, '#ffffff', .8 * a);
        ctx.strokeStyle = `rgba(255,255,255,${.7 * a})`; ctx.beginPath(); ctx.moveTo(px - 9 * m.u, py); ctx.lineTo(px + 9 * m.u, py); ctx.moveTo(px, py - 9 * m.u); ctx.lineTo(px, py + 9 * m.u); ctx.stroke();
      }
    };
    function heat(state) {
      // Hits, supers and K.O.s excite the crowd; it calms down over about two seconds.
      for (const e of state?.effects || []) if (!seenEffects.has(e)) {
        seenEffects.add(e);
        excitement = Math.min(1, excitement + (e.type === 'ko' ? 1 : e.type === 'super' ? .8 : e.type === 'hit' ? (e.heavy ? .35 : .2) : 0));
      }
      if (state?.phase === 'roundover') excitement = Math.max(excitement, .9);
    }
    function tick(info) {
      const t = info.time; if (lastTime !== null && t < lastTime) { excitement = 0; seenEffects = new WeakSet(); }
      excitement = Math.max(0, excitement - Math.max(0, t - (lastTime ?? t)) * .45); lastTime = t; heat(info.state);
    }
    // Painting fractions -> the 960x540 cover space the stage painting is drawn into.
    function mapper(plate) {
      const s = Math.max(960 / plate.width, 540 / plate.height), ox = (960 - plate.width * s) / 2, oy = (540 - plate.height * s) / 2;
      return { plate, u: plate.width * s / 960, X: f => ox + f * plate.width * s, Y: f => oy + f * plate.height * s, W: f => f * plate.width * s, H: f => f * plate.height * s,
        src: b => [b.x * plate.width, b.y * plate.height, b.w * plate.width, b.h * plate.height] };
    }
    function effect(ctx, e, m, t, seed) {
      const draw = e.type === 'flash' ? flash : EFFECTS[e.type]; if (!draw) return;
      ctx.save(); try { draw(ctx, e, m, t, seed); } finally { ctx.restore(); }
    }
    // Where a placed element is this instant: its cover-space box and the motion's offset, scale, skew, rotation,
    // alpha and glow. Motions pivot on the element's bottom centre, where it stands, so feet stay planted on the
    // painting (a spinning element pivots on its centre). Both renderers draw from this one pose.
    function layerPose(item, m, t, phase) {
      const pose = { x: m.X(item.place.x), y: m.Y(item.place.y), w: m.W(item.place.w), h: m.H(item.place.h), motion: item.motion || 'idle', dx: 0, dy: 0, sx: 1, sy: 1, skew: 0, rot: 0, alpha: 1, glow: 0, centre: false };
      const { motion, w, h } = pose;
      if (motion === 'still') return pose;
      if (motion === 'idle' || motion === 'cheer') {
        pose.sy = 1 + .014 * Math.sin(t * 1.9 + phase); pose.sx = 1 - .005 * Math.sin(t * 1.9 + phase); pose.skew = .012 * Math.sin(t * .8 + phase);
        if (motion === 'cheer' && excitement > .15) { const k = Math.min(1, excitement * 1.3); pose.dy = -Math.abs(Math.sin(t * 8.5 + phase)) * h * .05 * k; pose.skew += .03 * k * Math.sin(t * 4.2 + phase); pose.sy += .02 * k; }
      } else if (motion === 'hover') { pose.dx = Math.sin(t * .45 + phase) * w * .35; pose.dy = Math.sin(t * 1.7 + phase) * h * .08; pose.rot = .05 * Math.sin(t * .9 + phase); }
      else if (motion === 'drift') { pose.dx = Math.sin(t * .16 + phase) * Math.max(w * 1.5, 40 * m.u); pose.dy = Math.sin(t * .9 + phase) * h * .04; }
      else if (motion === 'bob') { pose.dy = Math.sin(t * 1.3 + phase) * h * .035; pose.rot = .025 * Math.sin(t * 1.1 + phase); }
      else if (motion === 'sway') pose.skew = .035 * Math.sin(t * 1.1 + phase);
      else if (motion === 'pulse') { const k = 1 + .03 * Math.sin(t * 2.4 + phase); pose.sx = pose.sy = k; pose.glow = .12 + .1 * Math.sin(t * 2.4 + phase); }
      else if (motion === 'spin') { pose.rot = t * 1.6; pose.centre = true; }
      else if (motion === 'flicker') { const n = Math.sin(t * 11 + phase) + Math.sin(t * 23.7) + Math.sin(t * 3.1 + phase); pose.alpha = n < -1.8 ? .25 : .8 + .2 * Math.sin(t * 7 + phase); pose.glow = .35 + .25 * Math.sin(t * 3 + phase); pose.dy = Math.sin(t * 1.3 + phase) * h * .03; }
      return pose;
    }
    function layer(ctx, item, m, t, phase, img) {
      const p = layerPose(item, m, t, phase);
      if (p.motion === 'still') { ctx.drawImage(img, p.x, p.y, p.w, p.h); return; }
      const top = p.centre ? -p.h / 2 : -p.h;
      ctx.save(); ctx.translate(p.x + p.w / 2 + p.dx, (p.centre ? p.y + p.h / 2 : p.y + p.h) + p.dy); ctx.rotate(p.rot); ctx.transform(p.sx, 0, p.skew, p.sy, 0, 0);
      ctx.globalAlpha = p.alpha; ctx.drawImage(img, -p.w / 2, top, p.w, p.h);
      if (p.glow > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.glow * p.alpha; ctx.drawImage(img, -p.w / 2, top, p.w, p.h); }
      ctx.restore();
    }
    const living = info => { const stage = info.stage, scenery = stage?.scenery, plate = stage && info.getImage(stage.src); return scenery && plate ? { stage, scenery, plate, m: mapper(plate), seed: stageSeed(stage) } : null; };
    // The ambient effects alone, in cover space: those on the painting, or (over) the fog and camera flashes that sit in
    // front of the elements. A renderer that draws the elements itself paints these to a texture at its own rate.
    function drawEffects(ctx, info, which = 'all') {
      const scene = living(info); if (!scene) return false;
      const effects = scene.scenery.effects || [], t = info.time;
      effects.forEach((e, i) => { if (which === 'all' || (which === 'over') === OVER.has(e.type)) effect(ctx, e, scene.m, t, scene.seed + i * 101); });
      return effects.length > 0;
    }
    function drawLayers(ctx, info) {
      const scene = living(info); if (!scene) return false;
      (scene.scenery.layers || []).forEach((item, i) => { const img = info.getImage(item.src); if (img) layer(ctx, item, scene.m, info.time, hash(i, scene.seed) * 6.283, img); });
      return true;
    }
    // The painting's living layer: effects on the painting, the placed elements, then fog and flashes in front.
    function drawStage(ctx, info) {
      if (!living(info)) return false;
      tick(info);
      drawEffects(ctx, info, 'behind'); drawLayers(ctx, info); drawEffects(ctx, info, 'over');
      return true;
    }
    // Weather over the fighters, at a faster parallax than the stage: the drops, splashes and drifting flakes of this
    // instant in screen space, for either renderer to draw.
    function frontParticles(info) {
      const kind = weather(info.stage); if (kind === 'none') return null;
      const t = info.time, view = info.view || {}, drift = -(view.x || 0) * 1.25 * (view.zoom || 1), seed = stageSeed(info.stage);
      if (kind === 'rain' || kind === 'storm') {
        const storm = kind === 'storm', n = storm ? 150 : 90, slant = storm ? 9 : 4, fall = storm ? 920 : 700, lines = [], splashes = [];
        for (let i = 0; i < n; i++) {
          const x = wrap(hash(i, seed) * 1200 + drift - t * (storm ? 260 : 140), 1200) - 120, y = wrap(hash(i, seed + 1) * 560 + t * (fall + hash(i, seed + 2) * 240), 600) - 30;
          lines.push([x, y, x - slant, y + (storm ? 22 : 18)]);
        }
        // Splashes on the deck.
        for (let i = 0; i < 14; i++) { const life = wrap(t * 3 + hash(i, seed + 3), 1), x = hash(Math.floor(t * 3 + hash(i, seed + 3)) + i * 7, seed) * 1000 - 20; splashes.push({ x: x - life * 6, y: info.floor - 1, w: 2 + life * 12, h: 1.5, alpha: (1 - life) * .5 }); }
        return { kind, lines, lineColor: `rgba(190,220,255,${storm ? .42 : .35})`, lineWidth: storm ? 1.4 : 1.2, splashes, splashColor: 'rgba(200,230,255,.35)', dots: [] };
      }
      const colors = { snow: ['#f2f6ff'], leaves: ['#c96a2b', '#e0a43a', '#9c4a1f'], petals: ['#ffc2d6', '#ff9fbf'], dust: ['rgba(255,236,190,.55)'], ash: ['rgba(170,170,175,.7)'], embers: ['#ff9a3c', '#ffd27a'] }[kind];
      const n = kind === 'snow' ? 70 : kind === 'dust' ? 32 : 40, flutter = kind === 'leaves' || kind === 'petals', dots = [];
      for (let i = 0; i < n; i++) {
        const speed = (kind === 'snow' ? 34 : kind === 'ash' ? 22 : kind === 'dust' ? 14 : 40) + hash(i, seed + 2) * 30;
        const x = wrap(hash(i, seed) * 1100 + drift * .6 + t * (flutter ? 34 : 12), 1100) - 70 + Math.sin(t * 1.5 + i) * 14;
        const y = kind === 'embers' ? 540 - wrap(hash(i, seed + 1) * 560 + t * speed, 560) : wrap(hash(i, seed + 1) * 560 + t * speed, 560);
        dots.push({ x, y, color: colors[i % colors.length], alpha: kind === 'embers' ? .6 + .4 * Math.sin(t * 9 + i) : .8, rot: t * (flutter ? 2 : .5) + i, flutter,
          rx: flutter ? (kind === 'leaves' ? 4.5 : 3.2) : kind === 'snow' ? 1.2 + hash(i, seed + 4) * 1.6 : kind === 'dust' ? 1.2 : 1.6, ry: flutter ? (kind === 'leaves' ? 2.2 : 1.8) : null });
      }
      return { kind, lines: [], splashes: [], dots };
    }
    function drawFront(ctx, info) {
      const p = frontParticles(info); if (!p) return false;
      ctx.save();
      if (p.lines.length) { ctx.strokeStyle = p.lineColor; ctx.lineWidth = p.lineWidth; ctx.beginPath(); for (const [x1, y1, x2, y2] of p.lines) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); } ctx.stroke(); }
      if (p.splashes.length) { ctx.fillStyle = p.splashColor; for (const s of p.splashes) { ctx.globalAlpha = s.alpha; ctx.fillRect(s.x, s.y, s.w, s.h); } }
      for (const d of p.dots) {
        ctx.fillStyle = d.color; ctx.globalAlpha = d.alpha;
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.beginPath();
        if (d.flutter) ctx.ellipse(0, 0, d.rx, d.ry, 0, 0, 6.283); else ctx.arc(0, 0, d.rx, 0, 6.283);
        ctx.fill(); ctx.restore();
      }
      ctx.restore();
      return true;
    }
    return { drawStage, drawFront, drawEffects, drawLayers, frontParticles, layerPose, tick, mapper, stageSeed, hash, weather, get excitement() { return excitement; } };
  }
  const api = { create, weather, WEATHER, EFFECT_TYPES: [...Object.keys(EFFECTS), 'flash'].sort() };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.CFZScenery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
