// Living stage scenery, shared by both arena renderers (pure Canvas 2D drawing; the Pixi path paints offscreen canvases
// used as textures). Visual only: nothing here reads or changes the simulation.
//
// Layers:
//   stage elements  cut from the stage's populated scene at their exact place and scale (stage.scenery.layers, written by
//                   build/tools/extract-scenery.cjs). They are drawn over the clean painting in the painting's own space,
//                   so they share its parallax and scale exactly, and each animates in place by its reviewed motion:
//                   still, idle (breathing), cheer (idle, bouncing when the fight heats up), hover, sway, flicker, pulse.
//   front weather   rain, leaves, snow or dust motes over the fighters (parallax 1.25), by stage mood.
// Mood comes from stage.ambience (an array of 'rain', 'dust', 'leaves', 'snow'), else from the stage description.
(function (root) {
  'use strict';
  const MOODS = ['rain', 'dust', 'leaves', 'snow'];
  const KEYWORDS = { rain: /rain/i, dust: /dust|desert|yard|patio|sunset|golden hour/i, leaves: /garden|park|forest|autumn|leaves/i, snow: /snow|winter|frost/i };
  function ambience(stage) {
    if (Array.isArray(stage?.ambience)) return stage.ambience.filter(m => MOODS.includes(m));
    const text = `${stage?.name || ''} ${stage?.description || ''}`;
    return MOODS.filter(m => KEYWORDS[m].test(text)).slice(0, 2);
  }
  // A cheap deterministic hash so placements are stable per stage and per index.
  const hash = (n, seed = 1) => { let x = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const stageSeed = stage => [...String(stage?.id || 'stage')].reduce((s, c) => s * 31 + c.charCodeAt(0) >>> 0, 7);

  function create() {
    let excitement = 0, seenEffects = new WeakSet(), lastTime = null;
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
    // Stage elements, drawn in the painting's 960x540 cover space (the caller has already applied the stage transform).
    function drawLayers(ctx, info) {
      const layers = info.stage?.scenery?.layers, plate = info.stage && info.getImage(info.stage.src);
      if (!layers?.length || !plate) return;
      tick(info);
      const t = info.time, s = Math.max(960 / plate.width, 540 / plate.height), ox = (960 - plate.width * s) / 2, oy = (540 - plate.height * s) / 2;
      layers.forEach((layer, i) => {
        const img = info.getImage(layer.src); if (!img) return;
        const x = ox + layer.place.x * plate.width * s, y = oy + layer.place.y * plate.height * s, w = layer.place.w * plate.width * s, h = layer.place.h * plate.height * s;
        const phase = hash(i, stageSeed(info.stage)) * 6.283, motion = layer.motion || 'idle';
        if (motion === 'still') { ctx.drawImage(img, x, y, w, h); return; }
        // Every motion pivots on the element's bottom centre, where it stands, so feet stay planted on the painting.
        let dx = 0, dy = 0, sx = 1, sy = 1, skew = 0, rot = 0, alpha = 1, glow = 0;
        if (motion === 'idle' || motion === 'cheer') {
          sy = 1 + .014 * Math.sin(t * 1.9 + phase); sx = 1 - .005 * Math.sin(t * 1.9 + phase); skew = .012 * Math.sin(t * .8 + phase);
          if (motion === 'cheer' && excitement > .15) { const k = Math.min(1, excitement * 1.3); dy = -Math.abs(Math.sin(t * 8.5 + phase)) * h * .05 * k; skew += .03 * k * Math.sin(t * 4.2 + phase); sy += .02 * k; }
        } else if (motion === 'hover') { dx = Math.sin(t * .45 + phase) * w * .35; dy = Math.sin(t * 1.7 + phase) * h * .08; rot = .05 * Math.sin(t * .9 + phase); }
        else if (motion === 'sway') skew = .035 * Math.sin(t * 1.1 + phase);
        else if (motion === 'pulse') { const k = 1 + .03 * Math.sin(t * 2.4 + phase); sx = sy = k; }
        else if (motion === 'flicker') { const n = Math.sin(t * 11 + phase) + Math.sin(t * 23.7) + Math.sin(t * 3.1 + phase); alpha = n < -1.8 ? .25 : .8 + .2 * Math.sin(t * 7 + phase); glow = .35 + .25 * Math.sin(t * 3 + phase); dy = Math.sin(t * 1.3 + phase) * h * .03; }
        ctx.save(); ctx.translate(x + w / 2 + dx, y + h + dy); ctx.rotate(rot); ctx.transform(sx, 0, skew, sy, 0, 0);
        ctx.globalAlpha = alpha; ctx.drawImage(img, -w / 2, -h, w, h);
        if (glow > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = glow * alpha; ctx.drawImage(img, -w / 2, -h, w, h); }
        ctx.restore();
      });
    }
    function front(ctx, moods, info, t) {
      const view = info.view, drift = -(view.x || 0) * 1.25 * (view.zoom || 1), seed = stageSeed(info.stage);
      if (moods.includes('rain')) {
        ctx.strokeStyle = 'rgba(190,220,255,.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < 90; i++) {
          const x = (((hash(i, seed) * 1200 + drift - t * 140) % 1200) + 1200) % 1200 - 120, y = ((hash(i, seed + 1) * 560 + t * (680 + hash(i, seed + 2) * 240)) % 600) - 30;
          ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 18);
        }
        ctx.stroke();
        // Splashes on the deck.
        ctx.fillStyle = 'rgba(200,230,255,.35)';
        for (let i = 0; i < 14; i++) { const life = (t * 3 + hash(i, seed + 3)) % 1, x = (hash(Math.floor(t * 3 + hash(i, seed + 3)) + i * 7, seed) * 1000) - 20; ctx.globalAlpha = (1 - life) * .5; ctx.fillRect(x - life * 6, info.floor - 1, 2 + life * 12, 1.5); }
        ctx.globalAlpha = 1;
      }
      const motes = moods.includes('leaves') ? ['#c96a2b', '#e0a43a'] : moods.includes('snow') ? ['#f2f6ff'] : moods.includes('dust') ? ['rgba(255,236,190,.55)'] : null;
      if (motes) for (let i = 0; i < 28; i++) {
        const x = (((hash(i, seed) * 1100 + drift * .6 + t * 22) % 1100) + 1100) % 1100 - 70 + Math.sin(t * 1.5 + i) * 14, y = ((hash(i, seed + 1) * 560 + t * (14 + hash(i, seed + 2) * 30)) % 560);
        ctx.fillStyle = motes[i % motes.length]; ctx.globalAlpha = .75;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t + i); ctx.fillRect(-2.5, -1.2, moods.includes('dust') ? 2.4 : 5, moods.includes('dust') ? 2.4 : 2.4); ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    function drawFront(ctx, info) { front(ctx, ambience(info.stage), info, info.time); }
    return { drawLayers, drawFront, ambience, get excitement() { return excitement; } };
  }
  const api = { create, ambience, MOODS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.CFZScenery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
