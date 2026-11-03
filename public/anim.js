(function (root, factory) {
  const animation = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.FighterEngine);
  if (typeof module === 'object' && module.exports) module.exports = animation;
  else root.FighterAnim = animation;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  // Pose choreography follows the reference game's wind-up, intermediate, contact,
  // follow-through and return sequence. Transforms stay visual: hitboxes never move.
  const SEQUENCES = {
    standing: { punch: ['stance2', 'block', 'punch'], kick: ['stance2', 'lkick', 'kick'], heavy: ['block', 'punch', 'hpunch'] },
    crouch: { punch: ['crouch', 'crouch', 'cjab'], kick: ['crouch', 'lkick', 'sweep'], heavy: ['crouch', 'getup', 'launcher'] },
    air: { punch: ['jump', 'jump', 'airpunch'], kick: ['jump', 'lkick', 'airkick'], heavy: ['jump', 'airpunch', 'airpunch'] }
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function sample(f, state = {}, options = {}) {
    state = state || {};
    const frame = state.motionFrame ?? state.frame ?? 0, beat = frame + (f.slot || 0) * 9;
    const result = { pose: f.pose || 'idle', dx: 0, dy: 0, sx: 1, sy: 1, rotation: 0, phase: 'idle', trail: false, flash: 0 };
    if (Number.isFinite(options.introFrame) || state.phase === 'intro') {
      const t = Number.isFinite(options.introFrame) ? options.introFrame : 90 - (state.phaseFrames ?? 90);
      result.phase = 'entrance'; result.pose = t < 18 ? 'entrance' : t < 76 ? 'taunt' : 'stance2';
      result.dx = -38 * Math.pow(Math.max(0, 1 - t / 18), 2);
      result.dy = -16 * Math.sin(Math.PI * clamp(t / 18, 0, 1));
      if (t >= 18 && t < 25) { result.sx = 1.04; result.sy = .94; }
    } else if (state.phase === 'roundover' || state.phase === 'matchover') {
      result.phase = result.pose === 'win' ? 'victory' : 'down';
      if (result.pose === 'win') result.sy = 1 + Math.sin(beat / 12) * .012;
    } else if (f.stun > 0) {
      result.phase = f.pose === 'block' ? 'guard' : 'hit';
      result.pose = f.launched ? f.y > 0 ? 'tumble' : f.stun > 5 ? 'down' : 'getup' : f.pose === 'block' ? f.crouching ? 'crouch' : 'block' : f.stun <= 3 ? 'stance2' : 'hit';
      result.dx = -(f.pose === 'block' ? 4 : 12) * Math.min(1, f.stun / 12);
      result.rotation = f.launched && f.y > 0 ? clamp(-f.vy * .025, -.28, .28) : -.025 * Math.min(1, f.stun / 12);
      result.sx = f.pose === 'block' ? 1.025 : .97; result.sy = f.pose === 'block' ? .98 : 1.02;
      result.flash = f.pose === 'block' ? 0 : Math.max(0, 1 - (f.hitAge || 0) / 5);
      result.trail = !!f.launched && f.y > 0;
    } else if (f.move && E.moveData(f)) {
      const move = E.moveData(f), t = f.moveFrame, activeEnd = move.startup + move.active;
      const sequence = SEQUENCES[f.moveVariant]?.[f.move] || SEQUENCES.standing[f.move] || ['stance2', 'powerup', 'special'];
      const recovery = clamp((t - activeEnd) / move.recovery, 0, 1);
      result.phase = t < move.startup ? 'anticipation' : t < activeEnd ? 'contact' : 'recovery';
      if (f.move === 'special') result.pose = t < 4 ? 'stance2' : t < move.startup ? 'powerup' : recovery < .55 ? 'special' : recovery < .82 ? 'punch' : 'stance2';
      else result.pose = t < move.startup * .5 ? sequence[0] : t < move.startup ? sequence[1] : recovery < .3 ? sequence[2] : recovery < .75 ? sequence[1] : sequence[0];
      const strength = f.move === 'heavy' ? 1.35 : f.move === 'special' ? .7 : 1;
      if (result.phase === 'anticipation') {
        const windup = Math.sin(clamp(t / move.startup, 0, 1) * Math.PI / 2);
        result.dx = -8 * strength * windup; result.sx = 1 - .035 * windup; result.sy = 1 + .018 * windup; result.rotation = -.018 * windup;
      } else {
        const drive = result.phase === 'contact' ? 1 : Math.pow(1 - recovery, 2);
        result.dx = 11 * strength * drive; result.sx = 1 + .045 * drive; result.sy = 1 - .025 * drive; result.rotation = .025 * strength * drive;
      }
      result.trail = (f.move === 'heavy' || f.move === 'special' || f.moveVariant === 'air') && (result.phase === 'contact' || result.phase === 'recovery' && recovery < .2);
    } else if (f.y > 0) {
      result.phase = 'air'; result.pose = Math.abs(f.vy) < 4 ? 'entrance' : 'jump';
      result.sx = 1 - Math.min(.04, Math.abs(f.vy) * .003); result.sy = 1 + Math.min(.05, Math.abs(f.vy) * .004);
      result.rotation = clamp((f.vx || 0) * f.facing * .008, -.03, .03);
    } else if (f.landFrames > 0) {
      result.phase = 'landing'; result.pose = f.landFrames > 3 ? 'crouch' : 'stance2';
      result.sx = 1 + .065 * f.landFrames / 6; result.sy = 1 - .09 * f.landFrames / 6;
    } else if (f.crouching || f.pose === 'crouch') {
      result.phase = 'crouch'; result.pose = 'crouch'; result.sy = 1 + Math.sin(beat / 15) * .005;
    } else if (Math.abs(f.vx || 0) > .1) {
      result.phase = 'walk'; result.pose = ['walk', 'stance2', 'walk2', 'stance2'][Math.floor(beat / 6) % 4];
      result.dy = -Math.abs(Math.sin(beat * Math.PI / 12)) * 2.5;
      result.rotation = .024 * Math.sign(f.vx * f.facing); result.sy = 1 + Math.sin(beat * Math.PI / 6) * .01;
    } else if (f.guard) {
      result.phase = 'guard'; result.pose = 'block'; result.sy = .99;
    } else {
      result.pose = Math.floor(beat / 26) % 2 ? 'stance2' : 'idle'; result.sy = 1 + Math.sin(beat / 11) * .012;
    }
    if (options.reducedMotion) { result.dx = 0; result.dy = 0; result.sx = 1; result.sy = 1; result.rotation = 0; result.trail = false; result.flash = 0; }
    return result;
  }
  function createRenderer() {
    const history = new WeakMap();
    function draw(ctx, f, data, getImage, state = {}, options = {}) {
      state = state || {};
      const current = sample(f, state, options), poses = data.poses || {};
      const pose = poses[current.pose] ? current.pose : poses[f.pose] ? f.pose : 'idle';
      const meta = poses[pose], image = meta && getImage(meta.src);
      if (!image) return false;
      const clock = Number.isFinite(options.introFrame) ? options.introFrame : state.motionFrame ?? state.frame ?? 0;
      let track = history.get(f);
      if (!track || clock < track.frame) { track = { frame: clock, pose, changed: clock, previous: null, trails: [] }; history.set(f, track); }
      if (clock !== track.frame) {
        if (pose !== track.pose) { track.previous = track.pose; track.pose = pose; track.changed = clock; }
        track.trails.unshift({ x: f.x, y: f.y, facing: f.facing, pose, transform: { ...current } });
        track.trails.length = Math.min(7, track.trails.length); track.frame = clock;
      }
      const ground = options.ground ?? E.GROUND, base = poses.idle || meta, scale = (options.height || 205) / (base.bh || base.h || 400);
      ctx.save(); ctx.fillStyle = '#07101e55'; ctx.beginPath(); ctx.ellipse(f.x, ground + 3, Math.max(22, 52 - f.y / 9), Math.max(4, 10 - f.y / 40), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      const sprite = (name, x, y, facing, transform, opacity = 1) => {
        const metadata = poses[name], bitmap = metadata && getImage(metadata.src); if (!bitmap) return;
        ctx.save(); ctx.globalAlpha *= opacity; ctx.translate(x + transform.dx * facing, ground - y + transform.dy);
        ctx.rotate(transform.rotation * facing); ctx.scale(facing * scale * transform.sx, scale * transform.sy);
        ctx.drawImage(bitmap, -metadata.ax, -metadata.ay, metadata.w, metadata.h); ctx.restore();
      };
      if (current.trail && !options.reducedMotion) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = track.trails.length - 1; i >= 2; i -= 2) {
          const previous = track.trails[i];
          sprite(previous.pose, previous.x - f.facing * i * 2, previous.y, previous.facing, previous.transform, .2 * (1 - i / 8));
        }
        ctx.restore();
      }
      ctx.save();
      if (current.flash > 0) ctx.filter = `brightness(${1 + current.flash * .8}) saturate(${1 - current.flash * .4})`;
      const fading = !options.reducedMotion && track.previous && clock - track.changed < 3;
      if (fading) sprite(track.previous, f.x, f.y, f.facing, current, .32 * (1 - (clock - track.changed) / 3));
      sprite(pose, f.x, f.y, f.facing, current);
      ctx.restore(); return true;
    }
    return { draw };
  }
  return { SEQUENCES, sample, createRenderer };
});
