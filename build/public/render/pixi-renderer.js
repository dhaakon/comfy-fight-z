// PixiJS arena renderer: the stage, fighters, afterimages, effects, projectiles and sparks on the GPU,
// with the same camera and pose choreography as the Canvas path. The HUD, callouts, cut-in and training
// read-outs keep drawing on the 2D overlay canvas through the Canvas renderer's screen layer.
(function (root) {
  'use strict';
  const FALLBACK_SKY = [0x293c40, 0x3a4f52, 0x4c6263, 0x5f7470, 0x798982, 0x94947f, 0xb3a07f, 0xd7b084];

  async function create({ canvas, engine: E, deps, screen }) {
    const PIXI = root.PIXI, A = root.FighterAnim;
    if (!PIXI || !A) throw new Error('PixiJS or the animation layer is missing');
    const { art, assetSource, ui, fighterData } = deps;
    const app = new PIXI.Application();
    await app.init({ canvas, width: 960, height: 540, backgroundAlpha: 0, antialias: false, autoStart: false, preference: 'webgl', resolution: 1, autoDensity: false });
    app.ticker.stop();
    const view = screen.view, FLOOR = E.GROUND, PARALLAX = .5;
    const textures = new Map();
    const texture = image => {
      if (!image) return null;
      let entry = textures.get(image);
      if (!entry) { entry = PIXI.Texture.from(image); textures.set(image, entry); }
      return entry;
    };

    // Scene graph. World children are ordered: fighters, projectiles, effects, sparks.
    const stageLayer = new PIXI.Container(), stageSprite = new PIXI.Sprite(), stageFallback = new PIXI.Graphics();
    stageLayer.addChild(stageFallback, stageSprite);
    const titleTint = new PIXI.Sprite(); titleTint.alpha = .6; titleTint.visible = false;
    // The shaker rotates the whole world a little about the screen centre on heavy impacts.
    const shaker = new PIXI.Container(); shaker.pivot.set(480, 270); shaker.position.set(480, 270);
    const world = new PIXI.Container(); shaker.addChild(world);
    const fighterLayer = new PIXI.Container(), projectileLayer = new PIXI.Container(), effectLayer = new PIXI.Container(), sparks = new PIXI.Graphics(), fxLines = new PIXI.Graphics();
    const auraLayer = new PIXI.Container(), motionLines = new PIXI.Graphics(), trailLayer = new PIXI.Container(), burstLines = new PIXI.Graphics();
    motionLines.blendMode = 'add'; burstLines.blendMode = 'add';
    world.addChild(auraLayer, trailLayer, fighterLayer, motionLines, projectileLayer, effectLayer, fxLines, burstLines, sparks);
    const flash = new PIXI.Graphics(); flash.rect(0, 0, 960, 540).fill(0xffffff); flash.alpha = 0; flash.blendMode = 'add';
    app.stage.addChild(stageLayer, titleTint, shaker, flash);
    // Soft radial glow for auras and projectile trails, drawn once.
    const glowCanvas = root.document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
    const glowContext = glowCanvas.getContext('2d'), gradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.35, 'rgba(255,255,255,.55)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 128, 128);
    const glowTexture = PIXI.Texture.from(glowCanvas);
    const colorOf = value => PIXI.Color.shared.setValue(value || '#ffd27a').toNumber();
    let fallbackDrawn = false, lastStage = null, resizes = 0;

    function drawFallbackStage() {
      // The code-built skyline used until a generated stage is imported (mirrors the Canvas path).
      const g = stageFallback; g.clear();
      FALLBACK_SKY.forEach((color, i) => g.rect(0, i * 55, 960, 56).fill(color));
      g.rect(0, 440, 960, 100).fill(0xd7b084);
      g.circle(727, 151, 57).fill({ color: 0xf6c38d, alpha: .65 });
      [0, 160, 385, 575, 820].forEach((x, i) => {
        const y = 250 + (i % 3) * 15, w = 155 + i % 2 * 28, color = [0x48595a, 0x526764, 0x4a5c5b][i % 3];
        g.rect(x, y, w, 150).fill(color); g.poly([x - 15, y, x + w / 2, y - 62, x + w + 15, y]).fill(color);
        g.rect(x + 22, y + 28, 25, 40).fill(0xc4aa79); g.rect(x + w - 47, y + 28, 25, 40).fill(0xc4aa79);
        g.rect(x + w / 2 - 15, y + 62, 30, 88).fill(0x344746);
      });
      g.rect(0, 368, 960, 50).fill(0x344d45);
      for (let x = 0; x < 960; x += 18) g.rect(x, 360, 3, 58).fill(0x79857b);
      g.rect(0, 407, 960, 15).fill(0x888d7b); g.rect(0, 422, 960, 118).fill(0x333f40);
      for (let x = -40; x < 960; x += 170) g.rect(x, 501, 92, 4).fill({ color: 0xc9b88a, alpha: .33 });
      g.moveTo(0, 450).lineTo(960, 450).stroke({ width: 2, color: 0x222d31 });
      g.moveTo(0, 180).quadraticCurveTo(480, 245, 960, 185).stroke({ width: 3, color: 0x273c3e });
      g.rect(99, 177, 7, 241).fill(0x263c3c); g.rect(865, 180, 7, 240).fill(0x263c3c);
    }
    function coverSprite(sprite, image, x, y, w, h) {
      const tex = texture(image); if (!tex) { sprite.visible = false; return; }
      const s = Math.max(w / image.width, h / image.height);
      sprite.texture = tex; sprite.visible = true; sprite.scale.set(s); sprite.position.set(x + (w - image.width * s) / 2, y + (h - image.height * s) / 2);
    }

    // Fighters: one holder per slot; afterimages are pooled sprites drawn behind the body.
    const slots = [0, 1].map(() => {
      const holder = new PIXI.Container(), trails = new PIXI.Container(), shadow = new PIXI.Graphics(), stick = new PIXI.Graphics();
      const spinner = new PIXI.Container(), body = new PIXI.Container(), sprite = new PIXI.Sprite();
      body.addChild(sprite); spinner.addChild(body); holder.addChild(spinner);
      const filter = new PIXI.ColorMatrixFilter();
      fighterLayer.addChild(shadow, trails, stick, holder);
      return { holder, trails, shadow, stick, spinner, body, sprite, filter, pool: [], history: null, clock: -1 };
    });
    function placeSprite(target, sprite, name, x, y, facing, transform, poses, ground, scale) {
      const meta = poses[name], image = meta && art(meta.src), tex = texture(image);
      if (!tex) { target.holder.visible = false; return false; }
      sprite.texture = tex; sprite.anchor.set(meta.ax / meta.w, meta.ay / meta.h);
      target.holder.visible = true; target.holder.position.set(x + transform.dx * facing, ground - y + transform.dy);
      const lift = transform.spin ? meta.h * scale * .45 : 0;
      target.spinner.position.set(0, -lift); target.spinner.rotation = transform.spin ? transform.spin * Math.PI * 2 * facing : 0;
      target.body.position.set(0, lift); target.body.rotation = transform.rotation * facing;
      target.body.scale.set(facing * scale * transform.sx, scale * transform.sy);
      return true;
    }
    function drawFighter(f, slot, state, reducedMotion, selected) {
      const data = fighterData(slot), poses = data.poses || {}, entry = slots[slot];
      // Mirror matches recolour the second fighter so both players stay readable.
      const palette = slot === 1 && selected[0] === selected[1] ? 155 : 0;
      const current = A.sample(f, state, { reducedMotion, poses });
      const pose = A.resolvePose(current.pose, poses, f.pose), meta = poses[pose], image = meta && art(meta.src);
      entry.shadow.clear().ellipse(f.x, E.GROUND + 3, Math.max(22, 52 - f.y / 9), Math.max(4, 10 - f.y / 40)).fill({ color: 0x07101e, alpha: .33 });
      if (!image) { entry.holder.visible = false; entry.trails.visible = false; drawStickFighter(entry.stick, f, data, state); entry.stick.visible = true; return; }
      entry.stick.visible = false;
      const clock = state?.motionFrame ?? state?.frame ?? 0, base = poses.idle || meta, scale = 225 / (base.bh || base.h || 400);
      if (!entry.history || clock < entry.clock) entry.history = [];
      if (clock !== entry.clock) { entry.history.unshift({ x: f.x, y: f.y, facing: f.facing, pose, transform: { ...current } }); entry.history.length = Math.min(7, entry.history.length); entry.clock = clock; }
      // Afterimages follow real travel only, so stationary attacks never stack extra limbs.
      let used = 0;
      if (current.trail && !reducedMotion) {
        for (let i = entry.history.length - 1; i >= 2; i -= 2) {
          const previous = entry.history[i];
          if (Math.hypot(f.x - previous.x, f.y - previous.y) < 8) continue;
          let ghost = entry.pool[used];
          if (!ghost) { const holder = new PIXI.Container(), spinner = new PIXI.Container(), body = new PIXI.Container(), sprite = new PIXI.Sprite(); body.addChild(sprite); spinner.addChild(body); holder.addChild(spinner); entry.trails.addChild(holder); ghost = { holder, spinner, body, sprite }; entry.pool.push(ghost); }
          if (placeSprite(ghost, ghost.sprite, previous.pose, previous.x, previous.y, previous.facing, previous.transform, poses, E.GROUND, scale)) { ghost.holder.alpha = .12 * (1 - i / 8); used++; }
        }
      }
      for (let i = used; i < entry.pool.length; i++) entry.pool[i].holder.visible = false;
      entry.trails.visible = used > 0;
      placeSprite(entry, entry.sprite, pose, f.x, f.y, f.facing, current, poses, E.GROUND, scale);
      // Hit flashes brighten the cel; mirror matches recolour the second fighter.
      if (current.flash > 0 || palette) {
        entry.filter.reset();
        if (palette) { entry.filter.hue(palette, false); entry.filter.saturate(.15, true); }
        if (current.flash > 0) { entry.filter.brightness(1 + current.flash * .8, true); entry.filter.saturate(-current.flash * .4, true); }
        entry.sprite.filters = [entry.filter];
      } else if (entry.sprite.filters) entry.sprite.filters = null;
    }
    function drawStickFighter(g, f, data, state) {
      // Placeholder fighter for bundles without artwork, drawn like the Canvas fallback.
      const color = PIXI.Color.shared.setValue(data.color || '#f49653').toNumber(), walking = f.pose === 'walk' || f.pose === 'walk2';
      const crouch = ['crouch', 'sweep', 'cjab'].includes(f.pose), down = f.pose === 'down', stride = walking ? Math.sin((state?.frame || 0) / 5) * 18 : 0;
      g.clear(); g.position.set(f.x, E.GROUND - f.y); g.scale.set(f.facing, crouch ? .72 : 1); g.rotation = down ? -Math.PI / 2 : 0; g.pivot.set(down ? -10 : 0, down ? 15 : 0);
      g.moveTo(-15, -80).lineTo(-26 + stride, -16).moveTo(15, -80).lineTo(27 - stride, -16).stroke({ width: 24, color: 0x1d292d, cap: 'round' });
      g.moveTo(-15, -81).lineTo(-24 + stride, -38).moveTo(15, -81).lineTo(f.pose === 'kick' ? 100 : 25 - stride, f.pose === 'kick' ? -95 : -38).stroke({ width: 25, color, cap: 'round' });
      g.poly([-33, -152, 32, -152, 25, -80, -25, -80]).fill(color);
      g.circle(0, -174, 24).fill(0xe8c8a2);
      g.rect(-23, -193, 45, 13).fill(0x26373a); g.rect(16, -182, 15, 5).fill(0x26373a);
      g.moveTo(25, -142).lineTo(f.pose === 'punch' ? 105 : f.pose === 'block' ? 36 : 54, f.pose === 'block' ? -180 : -125).moveTo(-25, -142).lineTo(f.pose === 'win' ? -35 : -8, f.pose === 'win' ? -217 : -122).stroke({ width: 16, color: 0xe8c8a2, cap: 'round' });
      g.moveTo(-26 + stride, -8).lineTo(-5 + stride, -8).moveTo(27 - stride, -8).lineTo(45 - stride, -8).stroke({ width: 13, color: 0x1c2a2c, cap: 'round' });
      g.rect(-15, -121, 30, 7).fill(0x141f24);
    }

    // Effect sprites are pooled per layer and rebuilt every frame from the engine's effect list.
    const pools = new Map();
    function take(layer, index) {
      let pool = pools.get(layer); if (!pool) { pool = []; pools.set(layer, pool); }
      let sprite = pool[index]; if (!sprite) { sprite = new PIXI.Sprite(); sprite.anchor.set(.5); layer.addChild(sprite); pool.push(sprite); }
      sprite.visible = true; return sprite;
    }
    function trim(layer, used) { const pool = pools.get(layer) || []; for (let i = used; i < pool.length; i++) pool[i].visible = false; }
    function effectSprite(layer, index, name, manifest, x, y, facing, opacity, size) {
      const meta = manifest.effects?.[name], image = art(assetSource(meta)), tex = texture(image);
      if (!tex) return false;
      const sprite = take(layer, index), ratio = size / Math.max(image.width, image.height);
      sprite.texture = tex; sprite.position.set(x, y); sprite.scale.set(facing * ratio, ratio); sprite.alpha = opacity; return true;
    }

    // Motion layer. Auras and bursts are pooled glow sprites; lines are rebuilt each frame.
    const motion = { particles: [], bursts: [], flashAlpha: 0, seen: new WeakSet(), projectiles: new WeakMap(), pool: [] };
    const SHOT_MOVES = new Set(['special', 'fireball', 'fastball', 'doubleball', 'skyshot', 'super']);
    function glow(index) {
      let sprite = motion.pool[index];
      if (!sprite) { sprite = new PIXI.Sprite(glowTexture); sprite.anchor.set(.5); sprite.blendMode = 'add'; auraLayer.addChild(sprite); motion.pool.push(sprite); }
      sprite.visible = true; return sprite;
    }
    function emitAura(f, color, count, spread, rise) {
      for (let i = 0; i < count; i++) motion.particles.push({ x: f.x + (Math.random() - .5) * spread, y: E.GROUND - f.y - 25 - Math.random() * 170, vx: (Math.random() - .5) * 1.2, vy: -rise - Math.random() * rise, life: 18 + Math.random() * 12, max: 30, size: 18 + Math.random() * 26, color });
    }
    function burst(x, y, color, lines, radius, life) { motion.bursts.push({ x, y, color, lines, radius, life, max: life, angle: Math.random() * Math.PI }); }
    function motionFrame(state, fighters, manifest, reducedMotion) {
      motionLines.clear(); burstLines.clear();
      if (reducedMotion || !state) { motion.particles.length = 0; motion.bursts.length = 0; motion.flashAlpha = 0; flash.alpha = 0; shaker.rotation = 0; for (const sprite of motion.pool) sprite.visible = false; for (const child of trailLayer.children) child.visible = false; return; }
      fighters.forEach((f, slot) => {
        const data = fighterData(slot), color = colorOf(data.color), charging = f.pose === 'powerup' || f.move === 'super' || (SHOT_MOVES.has(f.move) && f.moveFrame < (E.moveData(f)?.startup || 0));
        // Charging and supers wrap the body in rising energy; full power keeps a faint idle aura.
        if (charging) emitAura(f, color, f.move === 'super' ? 5 : 3, 90, 2.2);
        else if ((f.stocks ?? 0) >= (E.STOCK_MAX || 3) && !f.stun && Math.random() < .35) emitAura(f, color, 1, 70, .9);
        // Dashes, runs and rush attacks leave horizontal speed lines behind the body.
        if (f.dash > 0 || f.running || ['rush', 'armorRush', 'rekka'].includes(f.move)) {
          for (let i = 0; i < 5; i++) {
            const y = E.GROUND - f.y - 30 - Math.random() * 170, start = f.x - f.facing * (20 + Math.random() * 40), length = 50 + Math.random() * 90;
            motionLines.moveTo(start, y).lineTo(start - f.facing * length, y).stroke({ width: 1 + Math.random() * 2, color: 0xffffff, alpha: .18 + Math.random() * .25 });
          }
        }
      });
      // New engine effects: impact frames, rings and bursts, once each.
      for (const e of state.effects) if (!motion.seen.has(e)) {
        motion.seen.add(e);
        if (e.type === 'hit') { motion.flashAlpha = Math.max(motion.flashAlpha, e.heavy ? .55 : .18); burst(e.x, e.y, 0xfff1c9, e.heavy ? 12 : 6, e.heavy ? 150 : 70, e.heavy ? 12 : 8); }
        if (e.type === 'super') { motion.flashAlpha = .85; const data = fighterData(e.slot); burst(e.x ?? fighters[e.slot]?.x ?? 480, e.y ?? E.GROUND - 110, colorOf(data?.color), 18, 320, 26); }
        if (e.type === 'ko') { motion.flashAlpha = .9; burst(e.x ?? 480, e.y ?? E.GROUND - 110, 0xffffff, 16, 420, 34); }
        if (e.type === 'powerup') burst(e.x, e.y, colorOf(fighterData(e.slot ?? 0)?.color), 10, 120, 16);
      }
      // Projectiles trail a fading line of glows along their path.
      let used = 0;
      for (const p of state.projectiles) {
        let history = motion.projectiles.get(p); if (!history) { history = []; motion.projectiles.set(p, history); }
        history.unshift({ x: p.x, y: E.GROUND - p.y }); history.length = Math.min(8, history.length);
        const color = colorOf(fighterData(p.owner ?? 0)?.color);
        history.forEach((point, i) => { if (i === 0) return; let ghost = trailLayer.children[used]; if (!ghost) { ghost = new PIXI.Sprite(glowTexture); ghost.anchor.set(.5); ghost.blendMode = 'add'; trailLayer.addChild(ghost); } ghost.visible = true; ghost.position.set(point.x, point.y); ghost.tint = color; ghost.alpha = .5 * (1 - i / 8); ghost.scale.set((p.super ? 1.1 : .6) * (1 - i / 10)); used++; });
      }
      for (let i = used; i < trailLayer.children.length; i++) trailLayer.children[i].visible = false;
      // Particles.
      motion.particles = motion.particles.filter(pt => pt.life > 0);
      motion.particles.forEach((pt, i) => { pt.x += pt.vx; pt.y += pt.vy; pt.life--; const sprite = glow(i); sprite.position.set(pt.x, pt.y); sprite.tint = pt.color; sprite.alpha = .8 * Math.max(0, pt.life / pt.max); sprite.scale.set(pt.size / 128); });
      for (let i = motion.particles.length; i < motion.pool.length; i++) motion.pool[i].visible = false;
      // Bursts: radial lines and an expanding ring.
      motion.bursts = motion.bursts.filter(b => b.life > 0);
      for (const b of motion.bursts) {
        const t = 1 - b.life / b.max, r = b.radius * (.3 + t * .7), alpha = (1 - t) * .9;
        for (let i = 0; i < b.lines; i++) { const a = b.angle + i * Math.PI * 2 / b.lines; burstLines.moveTo(b.x + Math.cos(a) * r * .35, b.y + Math.sin(a) * r * .35).lineTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r); }
        burstLines.stroke({ width: 3, color: b.color, alpha }); burstLines.circle(b.x, b.y, r * .8).stroke({ width: 2 + 4 * (1 - t), color: b.color, alpha: alpha * .7 });
        b.life--;
      }
      // Impact frame and rotational shake.
      flash.alpha = motion.flashAlpha; motion.flashAlpha *= .62; if (motion.flashAlpha < .02) motion.flashAlpha = 0;
      shaker.rotation = view.shake > .5 ? (Math.random() - .5) * view.shake * .0035 : 0;
    }

    function pixel(x, y) {
      const out = app.renderer.extract.pixels({ target: app.stage, frame: new PIXI.Rectangle(x, y, 1, 1), resolution: 1 });
      const read = result => [result.pixels[0], result.pixels[1], result.pixels[2]];
      return typeof out?.then === 'function' ? out.then(read) : read(out);
    }

    function draw(frame) {
      const fighters = screen.beginFrame(frame), state = frame.state, manifest = frame.manifest, reducedMotion = !!frame.reducedMotion;
      screen.updateCamera(fighters, !state); screen.observeEffects(); screen.stepParticles();
      // Device-resolution backing store behind the CSS-sized canvas.
      const density = Math.min(3, Math.max(1, (canvas.clientWidth || 960) * Math.min(root.devicePixelRatio || 1, 3) / 960));
      if (Math.abs(app.renderer.resolution - density) > .01) { app.renderer.resize(960, 540, density); resizes++; }
      // Stage: the painting scrolls at half speed and scales about the floor line, as in the Canvas path.
      const stage = manifest.stages[frame.stageIndex], background = art(stage.src) || art(assetSource(stage.sourceImage));
      const span = 960 / view.zoom, travel = Math.max(1, E.WIDTH - span), layerScale = (1 + (E.WIDTH - 960) * PARALLAX / 960) * (1 + (view.zoom - 1) * .5);
      stageLayer.position.set(-(view.x / travel) * (960 * layerScale - 960), FLOOR * (1 - layerScale) + view.lift * .5); stageLayer.scale.set(layerScale);
      if (background) { if (background !== lastStage) { coverSprite(stageSprite, background, 0, 0, 960, 540); lastStage = background; } stageFallback.visible = false; stageSprite.visible = true; }
      else { if (!fallbackDrawn) { drawFallbackStage(); fallbackDrawn = true; } stageFallback.visible = true; stageSprite.visible = false; lastStage = null; }
      const title = !state && ui('title'); titleTint.visible = !!title; if (title) coverSprite(titleTint, title, 0, 0, 960, 540);
      world.position.set(-view.x * view.zoom + (view.shakeX || 0), FLOOR * (1 - view.zoom) + view.lift + (view.shakeY || 0)); world.scale.set(view.zoom);
      fighters.forEach((f, slot) => drawFighter(f, slot, state, reducedMotion, frame.selected));
      motionFrame(state, fighters, manifest, reducedMotion);
      let projectiles = 0, effects = 0; fxLines.clear();
      if (state) {
        state.projectiles.forEach(p => {
          const size = p.super ? 150 : 85, radius = p.super ? 55 : 28;
          if (effectSprite(projectileLayer, projectiles, 'projectile', manifest, p.x, E.GROUND - p.y, p.facing, 1, size)) { projectiles++; return; }
          const color = p.owner ? 0x82d6c5 : 0xffa657;
          fxLines.circle(p.x, E.GROUND - p.y, radius).fill({ color, alpha: .35 }).circle(p.x, E.GROUND - p.y, radius * .55).fill({ color, alpha: .6 }).circle(p.x, E.GROUND - p.y, radius * .25).fill({ color: 0xfff8da, alpha: .95 });
        });
        state.effects.forEach(e => {
          if (['ko', 'banner', 'super'].includes(e.type)) return;
          const progress = e.life / e.maxLife;
          if (effectSprite(effectLayer, effects, e.type, manifest, e.x, e.y, e.facing, progress, e.type === 'powerup' ? 230 : 115)) { effects++; return; }
          const color = e.type === 'block' ? 0x82d6c5 : 0xffc37f, stroke = { width: 3, color, alpha: progress };
          if (e.type === 'dust') fxLines.ellipse(e.x, e.y, 40 * (1 - progress) + 10, 9).stroke(stroke);
          else if (e.type === 'powerup') fxLines.ellipse(e.x, e.y, 50 * (1 - progress) + 30, 110).stroke(stroke);
          else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; fxLines.moveTo(e.x + Math.cos(a) * 5, e.y + Math.sin(a) * 5).lineTo(e.x + Math.cos(a) * 45 * (1 - progress + .3), e.y + Math.sin(a) * 45 * (1 - progress + .3)); } fxLines.stroke(stroke); }
        });
      }
      trim(projectileLayer, projectiles); trim(effectLayer, effects);
      sparks.clear();
      for (const pt of view.particles) sparks.rect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size).fill({ color: PIXI.Color.shared.setValue(pt.color).toNumber(), alpha: Math.max(0, pt.life / pt.max) });
      app.renderer.render(app.stage);
      // HUD, callouts, cut-in and training read-outs on the overlay canvas.
      if (state && frame.mode === 'training' && frame.training?.boxes) screen.drawHitboxes();
      screen.drawScreen(fighters);
    }
    function reset() { screen.reset(); for (const entry of slots) { entry.history = null; entry.clock = -1; } motion.particles.length = 0; motion.bursts.length = 0; motion.flashAlpha = 0; flash.alpha = 0; shaker.rotation = 0; }
    return { kind: 'pixi', draw, reset, pixel, view, app, stats: () => ({ resizes, textures: textures.size, resolution: app.renderer.resolution }) };
  }
  root.CFZPixiRenderer = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
