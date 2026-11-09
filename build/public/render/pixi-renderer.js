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
    // Lite presentation (window.CFZ_LITE, set by the game for phones and small devices): low-power GPU, fewer device
    // pixels, no full-screen impact shader and a quarter-size scenery texture refreshed at 15 frames a second.
    await app.init({ canvas, width: 960, height: 540, backgroundAlpha: 0, antialias: false, autoStart: false, preference: 'webgl', resolution: 1, autoDensity: false, ...(root.CFZ_LITE ? { powerPreference: 'low-power' } : {}) });
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
    // Slide, wall and super-jump dust (the shared view.dust) draws over the fighters' feet with normal blending.
    const dustLayer = new PIXI.Container();
    motionLines.blendMode = 'add'; burstLines.blendMode = 'add';
    world.addChild(auraLayer, trailLayer, fighterLayer, dustLayer, motionLines, projectileLayer, effectLayer, fxLines, burstLines, sparks);
    const flash = new PIXI.Graphics(); flash.rect(0, 0, 960, 540).fill(0xffffff); flash.alpha = 0; flash.blendMode = 'add';
    const sparkLayer = new PIXI.Container(); world.addChild(sparkLayer);
    // Living scenery, from the shared scenery module's poses and particles. The placed elements are sprites inside
    // stageLayer (uploaded once, moved by transforms), the ambient effects paint one offscreen canvas in the painting's
    // space that is uploaded every few frames (a quarter-size canvas at 7.5 frames a second on lite devices, where a
    // canvas upload is the slow path), and the weather in front of the fighters is drawn as shapes each frame.
    const sceneryScale = root.CFZ_LITE ? .5 : 1, sceneryEvery = root.CFZ_LITE ? 8 : 2;
    const effectsCanvas = document.createElement('canvas'); effectsCanvas.width = 960 * sceneryScale; effectsCanvas.height = 540 * sceneryScale;
    const effectsTexture = PIXI.Texture.from(effectsCanvas), effectsSprite = new PIXI.Sprite(effectsTexture); effectsSprite.scale.set(1 / sceneryScale);
    const layerLayer = new PIXI.Container(), weather = new PIXI.Graphics(), layerPool = [];
    stageLayer.addChild(effectsSprite, layerLayer);
    let sceneryFrame = 0, effectsDrawn = false, layerStage = null;
    app.stage.addChild(stageLayer, titleTint, shaker, weather, flash);
    function drawLayers(scenery, info, stageData, plate) {
      const S = screen.scenery, m = S.mapper(plate), seed = S.stageSeed(stageData), layers = scenery.layers || [];
      if (layerStage !== stageData) { layerStage = stageData; for (const entry of layerPool) entry.holder.visible = false; }
      layers.forEach((item, i) => {
        let entry = layerPool[i];
        if (!entry) {
          const holder = new PIXI.Container(), inner = new PIXI.Container(), sprite = new PIXI.Sprite(), glow = new PIXI.Sprite();
          glow.blendMode = 'add'; inner.addChild(sprite, glow); holder.addChild(inner); layerLayer.addChild(holder);
          entry = { holder, inner, sprite, glow }; layerPool.push(entry);
        }
        const tex = texture(art(item.src));
        if (!tex) { entry.holder.visible = false; return; }
        const p = S.layerPose(item, m, info.time, S.hash(i, seed) * 6.283);
        entry.holder.visible = true;
        for (const sprite of [entry.sprite, entry.glow]) { sprite.texture = tex; sprite.anchor.set(.5, p.centre ? .5 : 1); sprite.width = p.w; sprite.height = p.h; }
        entry.holder.position.set(p.x + p.w / 2 + p.dx, (p.centre ? p.y + p.h / 2 : p.y + p.h) + p.dy); entry.holder.rotation = p.rot;
        entry.inner.scale.set(p.sx, p.sy); entry.inner.skew.set(p.skew, 0);
        entry.sprite.alpha = p.alpha; entry.glow.visible = p.glow > 0; entry.glow.alpha = p.glow * p.alpha;
      });
      for (let i = layers.length; i < layerPool.length; i++) layerPool[i].holder.visible = false;
    }
    function drawWeather(info) {
      weather.clear();
      const p = screen.scenery.frontParticles(info); if (!p) return;
      const color = value => PIXI.Color.shared.setValue(value);
      if (p.lines.length) { for (const [x1, y1, x2, y2] of p.lines) weather.moveTo(x1, y1).lineTo(x2, y2); const c = color(p.lineColor); weather.stroke({ width: p.lineWidth, color: c.toNumber(), alpha: c.alpha }); }
      if (p.splashes.length) { const c = color(p.splashColor).toNumber(), a = color(p.splashColor).alpha; for (const s of p.splashes) weather.rect(s.x, s.y, s.w, s.h).fill({ color: c, alpha: a * s.alpha }); }
      for (const d of p.dots) {
        const c = color(d.color), fill = { color: c.toNumber(), alpha: c.alpha * d.alpha };
        // A tumbling leaf or petal: the drawing context carries the transform (Graphics itself only proxies the shapes).
        if (d.flutter) { const g = weather.context; g.save(); g.translate(d.x, d.y); g.rotate(d.rot); g.ellipse(0, 0, d.rx, d.ry).fill(fill); g.restore(); }
        else weather.circle(d.x, d.y, d.rx).fill(fill);
      }
    }
    // Impact shader on the world: chromatic aberration, radial blur, a shockwave ring and a negative flash,
    // driven per frame and attached only while something is happening. Filter space is the full screen.
    shaker.filterArea = new PIXI.Rectangle(0, 0, 960, 540);
    const shockFragment = `
precision highp float;
in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform vec4 uInputSize; uniform vec4 uInputClamp;
uniform float uAberration; uniform float uBlur; uniform vec2 uCenter; uniform float uRing; uniform float uRingWidth; uniform float uRingStrength; uniform float uInvert;
vec4 sampleClamped(vec2 uv) { return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)); }
void main() {
  vec2 uv = vTextureCoord; vec2 dir = uv - uCenter; vec2 aspect = vec2(uInputSize.x / uInputSize.y, 1.0);
  float dist = length(dir * aspect);
  float ring = smoothstep(uRingWidth, 0.0, abs(dist - uRing)) * uRingStrength;
  uv += normalize(dir + vec2(1e-5)) * ring;
  vec4 color = vec4(0.0);
  for (int i = 0; i < 6; i++) color += sampleClamped(uv - dir * uBlur * float(i) / 5.0);
  color /= 6.0;
  vec2 off = dir * uAberration;
  color.r = mix(color.r, sampleClamped(uv + off).r, 0.85); color.b = mix(color.b, sampleClamped(uv - off).b, 0.85);
  color.rgb = mix(color.rgb, (vec3(1.0) - color.rgb) * color.a, uInvert);
  finalColor = color;
}`;
    let shock = null;
    try {
      shock = new PIXI.Filter({ glProgram: PIXI.GlProgram.from({ vertex: PIXI.defaultFilterVert, fragment: shockFragment, name: 'cfz-shock' }),
        resources: { shockUniforms: { uAberration: { value: 0, type: 'f32' }, uBlur: { value: 0, type: 'f32' }, uCenter: { value: [.5, .5], type: 'vec2<f32>' }, uRing: { value: 0, type: 'f32' }, uRingWidth: { value: .08, type: 'f32' }, uRingStrength: { value: 0, type: 'f32' }, uInvert: { value: 0, type: 'f32' } } } });
    } catch (error) { console.warn('[CFZ pixi] impact shader unavailable:', error); }
    const impact = { aberration: 0, blur: 0, ring: -1, ringStrength: 0, invert: 0, center: [.5, .5], desaturate: 0 };
    const stageTone = new PIXI.ColorMatrixFilter();
    // World position to shader space (0..1 across the screen), following the current camera.
    const toScreen = (x, y) => [((x - view.x) * view.zoom + (view.shakeX || 0)) / 960, (y * view.zoom + FLOOR * (1 - view.zoom) + view.lift + (view.shakeY || 0)) / 540];
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
      const spinner = new PIXI.Container(), body = new PIXI.Container(), sprite = new PIXI.Sprite(), glow = new PIXI.Sprite();
      // Lite devices brighten a hit cel with an additive copy of itself instead of a colour-matrix filter pass.
      glow.blendMode = 'add'; glow.visible = false;
      body.addChild(sprite, glow); spinner.addChild(body); holder.addChild(spinner);
      const filter = new PIXI.ColorMatrixFilter();
      fighterLayer.addChild(shadow, trails, stick, holder);
      return { holder, trails, shadow, stick, spinner, body, sprite, glow, filter, pool: [], history: null, clock: -1 };
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
      const shake = screen.hitShake ? screen.hitShake(f) : 0;
      if (!image) { entry.holder.visible = false; entry.trails.visible = false; drawStickFighter(entry.stick, f, data, state); entry.stick.x += shake; entry.stick.visible = true; return; }
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
      // Capcom hit shake through the impact freeze (the Canvas path's rule).
      entry.holder.x += shake;
      // Hit flashes brighten the cel; mirror matches recolour the second fighter. Lite devices flash with an additive
      // copy of the cel (no filter pass) unless the palette filter is on anyway.
      const additive = root.CFZ_LITE && !palette && current.flash > 0;
      entry.glow.visible = additive;
      if (additive) { entry.glow.texture = entry.sprite.texture; entry.glow.anchor.copyFrom(entry.sprite.anchor); entry.glow.alpha = current.flash * .55; }
      if ((current.flash > 0 && !additive) || palette) {
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
      const kicking = f.pose === 'kick' || f.pose === 'lkick';
      g.moveTo(-15, -81).lineTo(-24 + stride, -38).moveTo(15, -81).lineTo(kicking ? 100 : 25 - stride, kicking ? (f.pose === 'kick' ? -95 : -60) : -38).stroke({ width: 25, color, cap: 'round' });
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
      // New engine effects: impact frames, rings, bursts, shader shocks and camera punches, once each.
      for (const e of state.effects) if (!motion.seen.has(e)) {
        motion.seen.add(e);
        if (e.type === 'hit') {
          // Spark tiers by damage (light, medium, heavy), as the shared sparks and the Canvas flash use them.
          const tier = screen.sparkTier ? screen.sparkTier(e) : e.heavy ? 2 : 0, pick = values => values[tier];
          motion.flashAlpha = Math.max(motion.flashAlpha, pick([.18, .35, .55])); burst(e.x, e.y, 0xfff1c9, pick([6, 9, 12]), pick([70, 110, 150]), pick([8, 10, 12]));
          Object.assign(impact, { aberration: pick([.005, .008, .012]), blur: pick([.015, .025, .04]), ring: .02, ringStrength: pick([.008, .013, .02]), center: toScreen(e.x, e.y) });
          view.zoom += pick([.02, .04, .06]);
        }
        // A counter hit flashes the world negative (one full frame, then a half one) and throws a red burst.
        if (e.type === 'counter') { Object.assign(impact, { invert: 1.5, center: toScreen(e.x, e.y) }); burst(e.x, e.y, 0xff2a2a, 10, 140, 12); }
        if (e.type === 'wall') burst(e.x, e.y, 0xfff3c4, 6, 60 + 6 * Math.min(10, e.force || 3), 10);
        if (e.type === 'superjump') burst(e.x, e.y - 30, colorOf(fighterData(e.slot ?? 0)?.color), 8, 110, 12);
        if (e.type === 'super') {
          motion.flashAlpha = .85; const data = fighterData(e.slot), x = e.x ?? fighters[e.slot]?.x ?? 480, y = e.y ?? E.GROUND - 110;
          burst(x, y, colorOf(data?.color), 18, 320, 26);
          Object.assign(impact, { aberration: .02, blur: .06, ring: .02, ringStrength: .035, invert: 1, center: toScreen(x, y) }); view.zoom += .1;
        }
        if (e.type === 'ko') {
          const loser = fighters.find(f => f.hp <= 0) || fighters[0], x = loser.x, y = E.GROUND - loser.y - 110;
          motion.flashAlpha = .9; burst(x, y, 0xffffff, 16, 420, 34);
          Object.assign(impact, { aberration: .025, blur: .08, ring: .02, ringStrength: .05, invert: 1, desaturate: 1, center: toScreen(x, y) }); view.zoom += .12;
        }
        if (e.type === 'powerup') burst(e.x, e.y, colorOf(fighterData(e.slot ?? 0)?.color), 10, 120, 16);
      }
      // Shader parameters decay; the ring keeps expanding until it fades.
      impact.aberration *= .78; impact.blur *= .78; impact.ringStrength *= .86; impact.invert = impact.invert > .5 ? impact.invert - .5 : 0; impact.desaturate *= .97;
      if (impact.ring >= 0) impact.ring += .045; if (impact.ringStrength < .0008) { impact.ring = -1; impact.ringStrength = 0; }
      const shockActive = !root.CFZ_LITE && shock && (impact.aberration > .0005 || impact.blur > .002 || impact.ringStrength > 0 || impact.invert > 0);
      if (shock) {
        const u = shock.resources.shockUniforms.uniforms;
        u.uAberration = impact.aberration; u.uBlur = impact.blur; u.uCenter = impact.center; u.uRing = Math.max(0, impact.ring); u.uRingStrength = impact.ringStrength; u.uInvert = impact.invert;
      }
      if (shockActive !== !!shaker.filters) shaker.filters = shockActive ? [shock] : null;
      if (impact.desaturate > .02) { stageTone.reset(); stageTone.saturate(-.7 * impact.desaturate, true); if (!stageLayer.filters) stageLayer.filters = [stageTone]; }
      else if (stageLayer.filters) stageLayer.filters = null;
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
      // Device-resolution backing store behind the CSS-sized canvas; lite devices stop at 1.25 device pixels per unit.
      const density = Math.min(root.CFZ_LITE ? 1.25 : 3, Math.max(1, (canvas.clientWidth || 960) * Math.min(root.devicePixelRatio || 1, 3) / 960));
      if (Math.abs(app.renderer.resolution - density) > .01) { app.renderer.resize(960, 540, density); resizes++; }
      // Stage: the painting scrolls at half speed and scales about the floor line, as in the Canvas path.
      const stage = manifest.stages[frame.stageIndex], background = art(stage.src) || art(assetSource(stage.sourceImage));
      const span = 960 / view.zoom, travel = Math.max(1, E.WIDTH - span), layerScale = (1 + (E.WIDTH - 960) * PARALLAX / 960) * (1 + (view.zoom - 1) * .5);
      stageLayer.position.set(-(view.x / travel) * (960 * layerScale - 960), FLOOR * (1 - layerScale) + view.lift * .5); stageLayer.scale.set(layerScale);
      if (background) { if (background !== lastStage) { coverSprite(stageSprite, background, 0, 0, 960, 540); lastStage = background; } stageFallback.visible = false; stageSprite.visible = true; }
      else { if (!fallbackDrawn) { drawFallbackStage(); fallbackDrawn = true; } stageFallback.visible = true; stageSprite.visible = false; lastStage = null; }
      if (screen.scenery) {
        const info = screen.sceneryInfo(), plate = stage && art(stage.src), living = !!state && !!stage?.scenery && !!plate;
        effectsSprite.visible = living; layerLayer.visible = living; weather.visible = !!state;
        if (state) {
          screen.scenery.tick(info);
          if (living) {
            // Ambient effects redraw at 30 frames a second, as arcade stages animated; an empty canvas is not re-uploaded.
            if ((sceneryFrame++ % sceneryEvery) === 0) {
              const g = effectsCanvas.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height); g.setTransform(sceneryScale, 0, 0, sceneryScale, 0, 0);
              const drawn = screen.scenery.drawEffects(g, info);
              if (drawn || effectsDrawn) effectsTexture.source.update();
              effectsDrawn = drawn;
            }
            drawLayers(stage.scenery, info, stage, plate);
          }
          drawWeather(info);
        } else weather.clear();
      }
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
          if (['ko', 'banner', 'super', 'counter'].includes(e.type)) return;
          const progress = e.life / e.maxLife;
          // The wall thud's streak and the super jump's ground ring are shapes, as on the Canvas path.
          if (e.type === 'wall') {
            fxLines.moveTo(e.x, e.y - 100).lineTo(e.x, Math.min(E.GROUND, e.y + 110));
            for (let i = 0; i < 4; i++) { const y = e.y - 75 + i * 50; fxLines.moveTo(e.x, y).lineTo(e.x - e.facing * (18 + 34 * (1 - progress)), y - 6); }
            fxLines.stroke({ width: 2 + 5 * progress, color: 0xfff3c4, alpha: progress, cap: 'round' }); return;
          }
          if (e.type === 'superjump') {
            fxLines.ellipse(e.x, e.y, 30 + 80 * (1 - progress), 8 + 7 * (1 - progress));
            for (const dx of [-26, 0, 26]) fxLines.moveTo(e.x + dx, e.y - 20 - 60 * (1 - progress)).lineTo(e.x + dx, e.y - 70 - 120 * (1 - progress));
            fxLines.stroke({ width: 3, color: 0xffe7b0, alpha: progress, cap: 'round' }); return;
          }
          if (effectSprite(effectLayer, effects, e.type, manifest, e.x, e.y, e.facing, progress, e.type === 'powerup' ? 230 : 115)) { effects++; return; }
          const color = e.type === 'block' ? 0x82d6c5 : 0xffc37f, stroke = { width: 3, color, alpha: progress };
          if (e.type === 'dust') fxLines.ellipse(e.x, e.y, 40 * (1 - progress) + 10, 9).stroke(stroke);
          else if (e.type === 'powerup') fxLines.ellipse(e.x, e.y, 50 * (1 - progress) + 30, 110).stroke(stroke);
          else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; fxLines.moveTo(e.x + Math.cos(a) * 5, e.y + Math.sin(a) * 5).lineTo(e.x + Math.cos(a) * 45 * (1 - progress + .3), e.y + Math.sin(a) * 45 * (1 - progress + .3)); } fxLines.stroke(stroke); }
        });
      }
      trim(projectileLayer, projectiles); trim(effectLayer, effects);
      // Sparks are additive glows rather than squares, sized by the hit's weight.
      let sparkIndex = 0;
      for (const pt of view.particles) {
        let sprite = sparkLayer.children[sparkIndex++];
        if (!sprite) { sprite = new PIXI.Sprite(glowTexture); sprite.anchor.set(.5); sprite.blendMode = 'add'; sparkLayer.addChild(sprite); }
        sprite.visible = true; sprite.position.set(pt.x, pt.y); sprite.tint = PIXI.Color.shared.setValue(pt.color).toNumber(); sprite.alpha = Math.max(0, pt.life / pt.max); sprite.scale.set(pt.size * .09);
      }
      for (let i = sparkIndex; i < sparkLayer.children.length; i++) sparkLayer.children[i].visible = false;
      // Shared rings (blocks, heavy hits, counters) and dust puffs.
      for (const r of view.rings) fxLines.circle(r.x, r.y, r.r).stroke({ width: r.width * (.4 + .6 * r.life / r.max), color: colorOf(r.color), alpha: Math.max(0, r.life / r.max) });
      let dustIndex = 0;
      for (const d of view.dust) {
        let sprite = dustLayer.children[dustIndex++];
        if (!sprite) { sprite = new PIXI.Sprite(glowTexture); sprite.anchor.set(.5); dustLayer.addChild(sprite); }
        sprite.visible = true; sprite.position.set(d.x, d.y); sprite.tint = 0xd2c3a4; sprite.alpha = .5 * Math.max(0, d.life / d.max); sprite.scale.set(d.size / 40);
      }
      for (let i = dustIndex; i < dustLayer.children.length; i++) dustLayer.children[i].visible = false;
      sparks.clear();
      app.renderer.render(app.stage);
      // HUD, callouts, cut-in and training read-outs on the overlay canvas.
      if (state && (frame.debugBoxes || (frame.mode === 'training' && frame.training?.boxes))) screen.drawHitboxes();
      screen.drawScreen(fighters);
    }
    function reset() { screen.reset(); for (const entry of slots) { entry.history = null; entry.clock = -1; } motion.particles.length = 0; motion.bursts.length = 0; motion.flashAlpha = 0; flash.alpha = 0; shaker.rotation = 0; Object.assign(impact, { aberration: 0, blur: 0, ring: -1, ringStrength: 0, invert: 0, desaturate: 0 }); shaker.filters = null; stageLayer.filters = null; }
    // Before a match: upload every cel, effect, stage and scenery texture the fight can show and compile the filter
    // programs, so the first use of a pose or the first hit costs no GPU stall mid-fight. Repeats are free.
    const warmed = new WeakSet(); let compiled = false, prepared = 0;
    function prepare(frame) {
      const manifest = frame.manifest, stage = manifest.stages[frame.stageIndex];
      const upload = image => {
        const tex = texture(image); if (!tex || warmed.has(tex)) return; warmed.add(tex);
        try { app.renderer.texture.initSource(tex.source); prepared++; } catch (_) { /* Uploaded on first draw instead. */ }
      };
      for (const slot of [0, 1]) for (const meta of Object.values(fighterData(slot)?.poses || {})) upload(art(meta.src));
      for (const meta of Object.values(manifest.effects || {})) upload(art(assetSource(meta)));
      if (stage) { upload(art(stage.src) || art(assetSource(stage.sourceImage))); for (const layer of stage.scenery?.layers || []) upload(art(layer.src)); }
      if (compiled) return;
      compiled = true;
      // One hidden render with every filter attached links their programs now rather than on the first hit or K.O.
      const idle = texture(art(fighterData(0)?.poses?.idle?.src));
      try {
        for (const entry of slots) { if (idle) { entry.sprite.texture = idle; entry.holder.visible = true; } entry.filter.reset(); entry.sprite.filters = [entry.filter]; }
        stageTone.reset(); stageLayer.filters = [stageTone]; if (shock && !root.CFZ_LITE) shaker.filters = [shock];
        app.renderer.render(app.stage);
      } catch (_) { /* The programs compile on first use instead. */ }
      for (const entry of slots) { entry.sprite.filters = null; entry.holder.visible = false; }
      stageLayer.filters = null; shaker.filters = null;
    }
    return { kind: 'pixi', draw, reset, prepare, pixel, view, app, stats: () => ({ resizes, textures: textures.size, prepared, resolution: app.renderer.resolution }) };
  }
  root.CFZPixiRenderer = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
