(function (root, factory) {
  const animation = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.FighterEngine);
  if (typeof module === 'object' && module.exports) module.exports = animation;
  else root.FighterAnim = animation;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  // Pose choreography follows the arcade reference: a held load, a one-frame whip on heavy strikes,
  // a contact cel that persists into recovery, a recoil, then a settle back to guard. A strike never
  // returns to its wind-up drawing. Transforms stay visual: hitboxes never move.
  // The light kick loads lightly and snaps out on the lkick cel; the roundhouse chambers on lkick and extends on kick.
  const SEQUENCES = {
    standing: { punch: ['stance2', 'block', 'punch'], kick: ['stance2', 'stance2', 'lkick'], roundhouse: ['stance2', 'lkick', 'kick'], heavy: ['block', 'punch', 'hpunch'],
      rising: ['crouch', 'getup', 'launcher'], rush: ['stance2', 'dash', 'kick'], armorRush: ['stance2', 'dash', 'hpunch'], rekka: ['stance2', 'lkick', 'kick'],
      throw: ['stance2', 'throw', 'throw'], commandGrab: ['stance2', 'throw', 'throw'], blowback: ['block', 'hpunch', 'hpunch'], gcBlowback: ['block', 'hpunch', 'hpunch'] },
    // Low and aerial attacks keep their posture through the whole move; an upright cel in the middle reads as a flash.
    crouch: { punch: ['crouch', 'crouch', 'cjab'], kick: ['crouch', 'crouch', 'sweep'], heavy: ['crouch', 'getup', 'launcher'] },
    air: { punch: ['jump', 'jump', 'airpunch'], kick: ['jump', 'lkick', 'airkick'], heavy: ['jump', 'airpunch', 'airpunch'] }
  };
  // Optional sheetD/sheetE poses replace these frames when a fighter has them.
  // The light kick has no wind-up cel of its own: it loads on the generic load (or the stance) like a light.
  const WINDUPS = { punch: 'punchwind', roundhouse: 'kickwind', heavy: 'heavywind', blowback: 'heavywind', gcBlowback: 'heavywind' };
  // Optional motion sheets (sheetF/sheetG): a one-frame whip before heavy contact and a follow-through after it.
  const HEAVY = new Set(['roundhouse', 'heavy', 'blowback', 'gcBlowback', 'rush', 'armorRush']);
  const WHIPS = { roundhouse: 'kickwhip', heavy: 'punchwhip', blowback: 'kickwhip', gcBlowback: 'kickwhip', rush: 'kickwhip', armorRush: 'punchwhip' };
  const RECOILS = { roundhouse: 'kickrecoil', rekka: 'kickrecoil', rush: 'kickrecoil', blowback: 'kickrecoil', gcBlowback: 'kickrecoil' };
  // Button normals that take the generic load when a cast has no per-move wind-ups.
  const NORMALS = new Set(['punch', 'kick', 'heavy', 'roundhouse']);
  const SHOTS = new Set(['special', 'fireball', 'fastball', 'doubleball', 'skyshot', 'super']);
  // The neutral loop: six breathing drawings played out and back with eased holds (90 frames), as in the arcade reference.
  const IDLE_CYCLE = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1], IDLE_HOLDS = [15, 9, 6, 6, 9, 15, 9, 6, 6, 9];
  // Missing optional poses fall back to the closest required pose.
  const FALLBACKS = { walk3: 'stance2', walk4: 'stance2', run: 'dash', run2: 'dash', backstep: 'jump', jumpfall: 'jump', crouchblock: 'crouch',
    hitlow: 'hit', hitheavy: 'hit', punchwind: 'stance2', kickwind: 'lkick', heavywind: 'block', roll: 'tumble', blowback: 'hpunch',
    super: 'special', dizzy: 'hit', win2: 'win', lose: 'getup',
    load: 'stance2', punchwhip: 'punch', kickwhip: 'lkick', recoil: 'hpunch', settle: 'stance2', stepin: 'walk3', stepout: 'walk4', dashload: 'crouch', dashpass: 'dash',
    idle1: 'idle', idle2: 'idle', idle3: 'idle', idle4: 'idle', idle5: 'idle', apex: 'entrance', land: 'crouch', kickrecoil: 'kick', guardhit: 'block' };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function sample(f, state = {}, options = {}) {
    state = state || {};
    // Optional poses are used only when the caller says the fighter has them.
    const has = name => !!options.poses?.[name];
    const pick = (extra, base) => has(extra) ? extra : base;
    const frame = state.motionFrame ?? state.frame ?? 0, beat = frame + (f.slot || 0) * 9;
    const result = { pose: f.pose || 'idle', dx: 0, dy: 0, sx: 1, sy: 1, rotation: 0, phase: 'idle', trail: false, flash: 0, spin: 0 };
    const rolling = ['roll', 'gcRoll'].includes(f.move) || (f.stun > 0 && f.dash > 0);
    if (Number.isFinite(options.introFrame) || state.phase === 'intro') {
      const t = Number.isFinite(options.introFrame) ? options.introFrame : 90 - (state.phaseFrames ?? 90);
      result.phase = 'entrance'; result.pose = t < 18 ? 'entrance' : t < 76 ? 'taunt' : 'stance2';
      result.dx = -38 * Math.pow(Math.max(0, 1 - t / 18), 2);
      result.dy = -16 * Math.sin(Math.PI * clamp(t / 18, 0, 1));
      if (t >= 18 && t < 25) { result.sx = 1.04; result.sy = .94; }
    } else if (state.phase === 'roundover' || state.phase === 'matchover') {
      const celebrating = ['win', 'win2'].includes(result.pose);
      if (result.pose === 'win2') result.pose = pick('win2', 'win');
      if (result.pose === 'lose') result.pose = pick('lose', 'getup');
      if (result.pose === 'tumble' && f.y === 0) result.pose = 'down';
      result.phase = celebrating ? 'victory' : 'down';
      if (celebrating) result.sy = 1 + Math.sin(beat / 12) * .012;
    } else if (f.dizzy > 0) {
      result.phase = 'dizzy'; result.pose = pick('dizzy', 'hit');
      result.rotation = Math.sin(beat / 7) * .06; result.dx = Math.sin(beat / 9) * 5;
    } else if (rolling) {
      const t = f.move ? f.moveFrame / 17 : 1 - f.dash / 8;
      result.phase = 'roll'; result.pose = pick('roll', 'tumble'); result.trail = true;
      if (!has('roll')) result.spin = clamp(t, 0, 1);
      result.dy = has('roll') ? 0 : -40;
    } else if (f.stun > 0) {
      result.phase = f.pose === 'block' ? 'guard' : 'hit';
      const reaction = f.crouching ? pick('hitlow', 'hit') : f.heavyHit ? pick('hitheavy', 'hit') : 'hit';
      const guarding = f.crouching ? pick('crouchblock', 'crouch') : pick('guardhit', 'block');
      result.pose = f.launched ? f.y > 0 ? 'tumble' : f.stun > 5 ? 'down' : 'getup' : f.pose === 'block' ? guarding : f.stun <= 3 ? pick('settle', 'stance2') : reaction;
      // Impact: a sharp shove and squash on the first frames of the reaction.
      const impact = f.pose === 'block' ? 0 : Math.max(0, 1 - (f.hitAge || 0) / 3);
      result.dx = -(f.pose === 'block' ? 5 : 14 + 6 * impact) * Math.min(1, f.stun / 10);
      result.rotation = f.launched && f.y > 0 ? clamp(-f.vy * .025, -.28, .28) : -.03 * Math.min(1, f.stun / 10);
      result.sx = f.pose === 'block' ? 1.03 : .96 - .06 * impact; result.sy = f.pose === 'block' ? .98 : 1.03 + .06 * impact;
      result.flash = f.pose === 'block' ? 0 : Math.max(0, 1 - (f.hitAge || 0) / 5);
      result.trail = !!f.launched && f.y > 0;
    } else if (f.move === 'taunt') {
      result.phase = 'taunt'; result.pose = 'taunt'; result.sy = 1 + Math.sin(beat / 6) * .015;
    } else if (f.move === 'teleport') {
      const t = f.moveFrame, move = E.moveData(f);
      result.phase = 'teleport'; result.pose = t < move.startup ? 'dash' : 'stance2'; result.trail = true;
      result.sx = t < move.startup ? clamp(1 - t / move.startup, .15, 1) : 1;
    } else if (f.move && E.moveData(f)) {
      const move = E.moveData(f), t = f.moveFrame, activeEnd = move.startup + move.active;
      const base = SEQUENCES[f.moveVariant]?.[f.move] || SEQUENCES.standing[f.move] || ['stance2', 'powerup', 'special'];
      const standing = f.moveVariant === 'standing', windup = standing && WINDUPS[f.move];
      const sequence = windup && has(windup) ? [windup, windup, base[2]] : base;
      const recovery = clamp((t - activeEnd) / Math.max(1, move.recovery), 0, 1);
      result.phase = t < move.startup ? 'anticipation' : t < activeEnd ? 'contact' : 'recovery';
      // The settle cel returns to guard; without it the stance cel of the base sequence stands in, never the wind-up.
      const settle = standing ? pick('settle', base[0]) : sequence[0];
      if (f.move === 'super') result.pose = t < 4 ? 'stance2' : t < move.startup ? 'powerup' : recovery < .6 ? pick('super', 'special') : recovery < .85 ? 'punch' : settle;
      else if (SHOTS.has(f.move)) result.pose = t < 4 ? 'stance2' : t < move.startup ? 'powerup' : recovery < .55 ? 'special' : recovery < .82 ? 'punch' : settle;
      else if (['blowback', 'gcBlowback'].includes(f.move) && t >= move.startup && recovery < .45) result.pose = pick('blowback', 'hpunch');
      else if (t < move.startup) {
        // The load holds through startup. Heavy strikes draw one whip on the last startup frame so the extension has contrast.
        const whip = standing && HEAVY.has(f.move) && t === move.startup - 1 && has(WHIPS[f.move]);
        // The generic load serves the standing normals that have no per-move wind-up drawn; specials keep their own startup cels.
        const load = standing && NORMALS.has(f.move) && has('load') && !(windup && has(windup)) ? 'load' : null;
        result.pose = whip ? WHIPS[f.move] : load || (t < move.startup * .4 ? sequence[0] : sequence[1]);
      } else {
        // Contact persists into recovery, then a recoil (heavy) and a settle; lights go straight from contact to the settle.
        const hold = HEAVY.has(f.move) ? 3 : 2, recoil = standing && pick(RECOILS[f.move] || 'recoil', null);
        if (t < activeEnd + hold) result.pose = sequence[2];
        else if (HEAVY.has(f.move) && recovery < .5) result.pose = recoil || sequence[2];
        else result.pose = standing ? settle : recovery < .8 ? sequence[1] : sequence[0];
      }
      const strength = ['heavy', 'roundhouse', 'rising', 'rush', 'armorRush', 'blowback', 'gcBlowback'].includes(f.move) ? 1.35 : SHOTS.has(f.move) ? .7 : 1;
      if (result.phase === 'anticipation') {
        // A fast coil in the first frames, held until release. Pose art already
        // contains its own wind-up and reach, so the body stays near the collision position.
        const wind = clamp(t / Math.max(1, move.startup * .4), 0, 1);
        result.dx = -3 * strength * wind; result.sx = 1 - .05 * wind; result.sy = 1 + .035 * wind; result.rotation = -.02 * wind;
      } else {
        // Pop on the first contact frames, then settle with a cubic ease.
        const pop = result.phase === 'contact' ? Math.max(0, 1 - (t - move.startup) / 3) : 0;
        const drive = result.phase === 'contact' ? 1 : Math.pow(1 - recovery, 3);
        result.dx = 3 * strength * drive; result.sx = 1 + (.03 + .07 * pop) * drive; result.sy = 1 - (.02 + .05 * pop) * drive; result.rotation = .012 * strength * drive;
      }
      result.trail = (['heavy', 'roundhouse', 'special', 'super', 'rising', 'rush', 'armorRush', 'rekka', 'blowback'].includes(f.move) || f.moveVariant === 'air') && (result.phase === 'contact' || result.phase === 'recovery' && recovery < .2);
    } else if (f.dash > 0) {
      // Backsteps hop backward on their own cel, or the jump cel without one.
      result.phase = 'dash'; result.pose = pick('backstep', 'jump'); result.trail = true;
      result.rotation = .04 * f.dashDir * f.facing;
    } else if (f.running) {
      result.phase = 'run'; result.pose = [pick('run', 'dash'), pick('dashpass', pick('run2', 'dash'))][Math.floor(beat / 4) % 2]; result.trail = true;
      result.rotation = .03;
    } else if (f.jumpSquat > 0) {
      result.phase = 'jumpsquat'; result.pose = pick('land', 'crouch'); result.sx = 1.08; result.sy = .88;
    } else if (f.y > 0) {
      result.phase = 'air';
      result.pose = f.vy < -2 && has('jumpfall') ? 'jumpfall' : Math.abs(f.vy) < 4 ? pick('apex', 'entrance') : 'jump';
      result.sx = 1 - Math.min(.04, Math.abs(f.vy) * .003); result.sy = 1 + Math.min(.05, Math.abs(f.vy) * .004);
      result.rotation = clamp((f.vx || 0) * f.facing * .008, -.03, .03);
    } else if (f.landFrames > 0) {
      // Landing compression, then a brief settle before the stance.
      result.phase = 'landing'; result.pose = f.landFrames > 3 ? pick('land', 'crouch') : pick('settle', 'stance2');
      result.sx = 1 + .1 * f.landFrames / 6; result.sy = 1 - .13 * f.landFrames / 6;
    } else if (f.crouching || f.pose === 'crouch') {
      result.phase = 'crouch'; result.pose = f.guard ? pick('crouchblock', 'crouch') : 'crouch'; result.sy = 1 + Math.sin(beat / 15) * .005;
    } else if (f.guard) {
      // Moving backwards can still be a guard. Render the defensive pose when
      // the simulation says a hit will be blocked, even if velocity is nonzero.
      result.phase = 'guard'; result.pose = 'block'; result.sy = .99;
    } else if (Math.abs(f.vx || 0) > .1) {
      // A 24-frame stride: stride, passing step, opposite stride, passing step; walking backwards runs it in reverse.
      const w = f.vx * (f.facing || 1) < 0 ? 23 - beat % 24 : beat % 24;
      result.phase = 'walk'; result.pose = w < 8 ? 'walk' : w < 12 ? pick('stepin', pick('walk3', 'walk')) : w < 20 ? 'walk2' : pick('stepout', pick('walk4', 'walk2'));
      // The walk poses have individual foot anchors. Translating the entire
      // sprite upward on every step made both feet visibly float off the floor.
      result.dy = 0;
      result.rotation = .024 * Math.sign(f.vx * f.facing); result.sy = 1 + Math.sin(beat * Math.PI / 6) * .01;
    } else if (has('idle1') && has('idle2') && has('idle3') && has('idle4') && has('idle5')) {
      // The breathing loop restarts from the neutral drawing whenever the fighter returns to neutral.
      let phase = (Number.isFinite(f.standFrames) ? f.standFrames + (f.slot || 0) * 9 : beat) % 90, cel = 0;
      for (let i = 0; i < IDLE_HOLDS.length; i++) { if (phase < IDLE_HOLDS[i]) { cel = IDLE_CYCLE[i]; break; } phase -= IDLE_HOLDS[i]; }
      result.pose = cel ? `idle${cel}` : 'idle';
    } else {
      // One stance held with a breath; alternating two unrelated drawings makes the body pop.
      result.pose = 'idle'; result.sy = 1 + Math.sin(beat / 11) * .015; result.sx = 1 - Math.sin(beat / 11) * .005;
    }
    if (options.reducedMotion) { result.dx = 0; result.dy = 0; result.sx = 1; result.sy = 1; result.rotation = 0; result.trail = false; result.flash = 0; result.spin = 0; }
    return result;
  }
  // Resolve a pose through its fallback chain to one the fighter actually has.
  function resolvePose(name, poses, current) {
    for (let candidate = name, guard = 0; candidate && guard < 4; candidate = FALLBACKS[candidate], guard++) if (poses[candidate]) return candidate;
    return poses[current] ? current : 'idle';
  }
  function createRenderer() {
    const history = new WeakMap();
    function draw(ctx, f, data, getImage, state = {}, options = {}) {
      state = state || {};
      const poses = data.poses || {};
      const current = sample(f, state, { ...options, poses });
      const pose = resolvePose(current.pose, poses, f.pose);
      const meta = poses[pose], image = meta && getImage(meta.src);
      if (!image) return false;
      const clock = Number.isFinite(options.introFrame) ? options.introFrame : state.motionFrame ?? state.frame ?? 0;
      let track = history.get(f);
      if (!track || clock < track.frame) { track = { frame: clock, trails: [] }; history.set(f, track); }
      if (clock !== track.frame) {
        track.trails.unshift({ x: f.x, y: f.y, facing: f.facing, pose, transform: { ...current } });
        track.trails.length = Math.min(7, track.trails.length); track.frame = clock;
      }
      const ground = options.ground ?? E.GROUND, base = poses.idle || meta, scale = (options.height || 205) / (base.bh || base.h || 400);
      ctx.save(); ctx.fillStyle = '#07101e55'; ctx.beginPath(); ctx.ellipse(f.x, ground + 3, Math.max(22, 52 - f.y / 9), Math.max(4, 10 - f.y / 40), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      const sprite = (name, x, y, facing, transform, opacity = 1) => {
        const metadata = poses[name], bitmap = metadata && getImage(metadata.src); if (!bitmap) return;
        ctx.save(); ctx.globalAlpha *= opacity; ctx.translate(x + transform.dx * facing, ground - y + transform.dy);
        // A roll drawn with the tumble cel spins once around its center.
        if (transform.spin) { ctx.translate(0, -metadata.h * scale * .45); ctx.rotate(transform.spin * Math.PI * 2 * facing); ctx.translate(0, metadata.h * scale * .45); }
        ctx.rotate(transform.rotation * facing); ctx.scale(facing * scale * transform.sx, scale * transform.sy);
        ctx.drawImage(bitmap, -metadata.ax, -metadata.ay, metadata.w, metadata.h); ctx.restore();
      };
      if (current.trail && !options.reducedMotion) {
        // Afterimages follow real travel, not synthetic offsets on stationary
        // attacks. Otherwise different poses overlap as extra arms and legs.
        ctx.save();
        for (let i = track.trails.length - 1; i >= 2; i -= 2) {
          const previous = track.trails[i];
          if (Math.hypot(f.x - previous.x, f.y - previous.y) < 8) continue;
          sprite(previous.pose, previous.x, previous.y, previous.facing, previous.transform, .12 * (1 - i / 8));
        }
        ctx.restore();
      }
      ctx.save();
      // Mirror matches recolor the second fighter; hit flashes brighten the cel.
      const filters = [];
      if (options.palette) filters.push(`hue-rotate(${options.palette}deg) saturate(1.15)`);
      if (current.flash > 0) filters.push(`brightness(${1 + current.flash * .8}) saturate(${1 - current.flash * .4})`);
      if (filters.length) ctx.filter = filters.join(' ');
      // Each drawing is already a complete cel; crossfading two distinct poses
      // produces doubled silhouettes instead of an in-between animation frame.
      sprite(pose, f.x, f.y, f.facing, current);
      ctx.restore(); return true;
    }
    return { draw };
  }
  return { SEQUENCES, FALLBACKS, IDLE_CYCLE, IDLE_HOLDS, sample, resolvePose, createRenderer };
});
