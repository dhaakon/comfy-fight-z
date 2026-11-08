// Living stage scenery, shared by both arena renderers (pure Canvas 2D drawing; the Pixi path draws it onto
// offscreen canvases used as textures). Visual only: nothing here reads or changes the simulation.
//
// Layers, back to front, each with its own parallax depth (1 = moves with the fighters):
//   far   0.35  ambient lights drifting across the sky (drones, birds, embers), by stage mood
//   crowd 0.70  the stage's generated background characters (stage.scenery.cels: a1-a3, b1-b3, c1-c3 —
//               three bystanders, three frames each), idling and cheering when the fight heats up
//   front 1.25  rain, falling leaves or dust motes over the fighters, by stage mood
// Mood comes from stage.ambience (an array of 'rain', 'neon', 'drones', 'dust', 'embers', 'leaves', 'snow'),
// else from keywords in the stage description.
(function (root) {
  'use strict';
  const MOODS = ['rain', 'neon', 'drones', 'dust', 'embers', 'leaves', 'snow'];
  const KEYWORDS = { rain: /\brain/i, neon: /neon|hologra|billboard|arcade|cyber/i, drones: /drone|megacity|futur|cyber|tower|rooftop/i,
    dust: /dust|desert|yard|patio|sunset|golden hour/i, embers: /fire|lava|forge|ember|torch/i, leaves: /garden|park|forest|autumn|leaves/i, snow: /snow|winter|frost/i };
  function ambience(stage) {
    if (Array.isArray(stage?.ambience)) return stage.ambience.filter(m => MOODS.includes(m));
    const text = `${stage?.name || ''} ${stage?.description || ''}`;
    return MOODS.filter(m => KEYWORDS[m].test(text)).slice(0, 3);
  }
  // A cheap deterministic hash so placements are stable per stage and per index.
  const hash = (n, seed = 1) => { let x = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const stageSeed = stage => [...String(stage?.id || 'stage')].reduce((s, c) => s * 31 + c.charCodeAt(0) >>> 0, 7);

  function create() {
    let excitement = 0, seenEffects = new WeakSet(), lastTime = null;
    // Camera mapping for a layer at depth p: screen x of a world x, and the layer's ground line on screen.
    const mapper = (view, p, world) => {
      const zoom = view.zoom || 1, centre = (view.x || 0) + 480 / zoom;
      return { x: wx => 480 + (wx - centre) * zoom * p, scale: zoom * p, ground: world.floor - (1 - p) * world.horizonDrop + (view.lift || 0) * p };
    };
    function heat(state) {
      // Hits, supers and K.O.s excite the crowd; it calms down over about two seconds.
      for (const e of state?.effects || []) if (!seenEffects.has(e)) {
        seenEffects.add(e);
        excitement = Math.min(1, excitement + (e.type === 'ko' ? 1 : e.type === 'super' ? .8 : e.type === 'hit' ? (e.heavy ? .35 : .18) : 0));
      }
      if (state?.phase === 'roundover') excitement = Math.max(excitement, .9);
    }
    function crowd(ctx, frame, info, t) {
      const cels = info.stage?.scenery?.cels; if (!cels) return;
      const people = ['a', 'b', 'c'].filter(r => cels[`${r}1`]), seed = stageSeed(info.stage);
      if (!people.length) return;
      const m = mapper(info.view, .7, info), count = info.crowdCount || 7, span = info.worldWidth + 400;
      for (let i = 0; i < count; i++) {
        const who = people[Math.floor(hash(i, seed) * people.length)], wx = -200 + (i + .5) * span / count + (hash(i, seed + 3) - .5) * span / count * .6;
        const x = m.x(wx); if (x < -120 || x > 1080) continue;
        const phase = hash(i, seed + 5) * 6.28, cheering = excitement > .25 && hash(Math.floor(t * 3) + i * 17, seed) < excitement;
        const cel = cheering ? `${who}${Math.floor(t * 8 + i) % 2 ? 2 : 3}` : `${who}${Math.sin(t * 1.3 + phase) > .92 ? 2 : 1}`;
        const meta = cels[cel] || cels[`${who}1`], img = info.getImage(meta.src); if (!img) continue;
        const height = 118 * m.scale * (.9 + hash(i, seed + 9) * .2), k = height / (meta.bh || meta.h || img.height);
        const bob = cheering ? Math.abs(Math.sin(t * 9 + phase)) * 6 * m.scale : Math.sin(t * 2 + phase) * 1.2;
        const flip = hash(i, seed + 11) < .5 ? -1 : 1;
        ctx.save(); ctx.translate(x, m.ground - bob); ctx.scale(flip * k, k);
        ctx.globalAlpha = .92; ctx.filter = 'brightness(.62) saturate(.8)';
        ctx.drawImage(img, -(meta.ax ?? img.width / 2), -(meta.ay ?? img.height), img.width, img.height);
        ctx.restore();
      }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
    }
    function far(ctx, moods, info, t) {
      const m = mapper(info.view, .35, info), seed = stageSeed(info.stage);
      if (moods.includes('drones')) for (let i = 0; i < 6; i++) {
        const speed = 18 + hash(i, seed) * 30, wx = ((t * speed * (i % 2 ? 1 : -1) + hash(i, seed + 1) * 2400) % 2400 + 2400) % 2400 - 480;
        const x = m.x(wx), y = 70 + hash(i, seed + 2) * 140 + Math.sin(t * .8 + i) * 6, blink = (Math.floor(t * 2 + i) % 3) === 0;
        ctx.fillStyle = 'rgba(20,24,40,.85)'; ctx.fillRect(x - 7, y - 2, 14, 4);
        ctx.fillStyle = blink ? '#ff3d6e' : '#3df2ff'; ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(x + (i % 2 ? 7 : -7), y, 2.2, 0, 6.29); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (moods.includes('neon')) {
        // Two signs flicker: a soft additive glow over parts of the painting.
        for (let i = 0; i < 2; i++) {
          const on = Math.sin(t * (5 + i * 3)) + Math.sin(t * (13 + i)) > -1.2, x = m.x(300 + i * 700 + hash(i, seed) * 200), y = 110 + hash(i, seed + 4) * 90;
          if (!on) continue; const g = ctx.createRadialGradient(x, y, 4, x, y, 120);
          g.addColorStop(0, i ? 'rgba(255,61,139,.22)' : 'rgba(61,242,255,.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - 120, y - 120, 240, 240); ctx.globalCompositeOperation = 'source-over';
        }
      }
      if (moods.includes('embers')) for (let i = 0; i < 24; i++) {
        const life = (t * (.15 + hash(i, seed) * .2) + hash(i, seed + 1)) % 1, x = (hash(i, seed + 2) * 1100 - 70) + Math.sin(t + i) * 12, y = 540 - life * 480;
        ctx.globalAlpha = (1 - life) * .8; ctx.fillStyle = '#ff9a3c'; ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
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
    // info: { view, stage, getImage, state, time (seconds), floor, horizonDrop, worldWidth, reducedMotion }
    function drawBack(ctx, info) {
      const t = info.time; if (lastTime !== null && t < lastTime) { excitement = 0; seenEffects = new WeakSet(); }
      excitement = Math.max(0, excitement - Math.max(0, t - (lastTime ?? t)) * .45); lastTime = t; heat(info.state);
      const moods = ambience(info.stage);
      far(ctx, moods, info, t); crowd(ctx, null, info, t);
    }
    function drawFront(ctx, info) { front(ctx, ambience(info.stage), info, info.time); }
    return { drawBack, drawFront, ambience, get excitement() { return excitement; } };
  }
  const api = { create, ambience, MOODS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.CFZScenery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
