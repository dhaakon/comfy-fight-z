(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.FighterEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // The stage scrolls: it is wider than one 960-unit screen, and a screen lock
  // keeps both fighters on camera. The renderer follows their midpoint.
  const SCREEN_W = 960, WIDTH = 1440, GROUND = 438, INPUT_BUFFER = 8, WALL = 50, BODY_GAP = 64;
  // Fighters are drawn 225 px tall from their idle cel; painted reaches are measured at that height.
  const SPRITE_HEIGHT = 225;
  // Painted reach of every cel in game pixels, from the pose metadata the builder writes (width minus anchor).
  function artReaches(poses) {
    const idle = poses?.idle; if (!idle?.bh) return null;
    const scale = SPRITE_HEIGHT / idle.bh, out = {};
    for (const [name, meta] of Object.entries(poses)) if (meta && meta.w > 0 && meta.ax >= 0) out[name] = Math.round((meta.w - meta.ax) * scale);
    return out;
  }
  // A move's hit reach: the cel's painted reach less a fist's width, kept within 100-125% of the move's base reach.
  // Art can lengthen a move but never shorten it, so the frame data and chains of the move tables hold for every cast.
  function reachOf(f, move) {
    const painted = f.reaches?.[move.pose];
    if (!move.reach || !painted) return move.reach;
    return Math.round(Math.max(move.reach, Math.min(move.reach * 1.25, painted - 10)));
  }
  const MAX_DIST = SCREEN_W - 2 * WALL - 40;
  const WALK_FORWARD = 4.6, WALK_BACK = 3.8, RUN_SPEED = 8.2, AIR_SPEED = 4.2, CANCEL_WINDOW = 9;
  const MOTION_WINDOW = 16, DASH_TAP = 12, JUGGLE_LIMIT = 4, JUMP_SQUAT = 4;
  // Jumps are committed: the takeoff fixes the vertical speed and the horizontal speed (a share of AIR_SPEED, from the
  // direction held on the last squat frame), and nothing steers in the air. Holding up jumps, a tap hops, and a down
  // direction (1, 2 or 3) on any of the SUPER_JUMP_WINDOW frames before up is pressed (or with it) super-jumps.
  const JUMPS = Object.freeze({ full: Object.freeze({ vy: 13, vx: 1 }), hop: Object.freeze({ vy: 9.6, vx: 1.12 }), super: Object.freeze({ vy: 16.5, vx: 1.15 }) }), SUPER_JUMP_WINDOW = 10;
  // A jump that attacked or was hit lands with LANDING_LAG frames of no action and no guard; an empty jump has none.
  // An air reset (an airReset light on an airborne target that is not launched) keeps AIR_RESET_LIFT of the target's
  // vertical speed, so it falls under gravity, and drifts it away at AIR_RESET_DRIFT a frame. When that hitstun runs
  // out before the landing, the target air-techs: AIR_TECH invulnerable frames, then no attacks until it lands.
  const LANDING_LAG = 3, AIR_RESET_LIFT = .3, AIR_RESET_DRIFT = 1.5, AIR_TECH = 6;
  // Launcher combos. The launcher's victim floats: it leaves at the move's launch speed under LAUNCH_GRAVITY x gravity,
  // drifts away LAUNCH_DRIFT a frame (other knockdowns KNOCKDOWN_DRIFT) and stays helpless until it lands. Every hit on a
  // launched victim in the air re-pops it less, at max(vy x JUGGLE_LIFT, JUGGLE_POP - JUGGLE_DECAY x juggle count), and
  // the air heavy spikes it down at JUGGLE_SPIKE; JUGGLE_LIMIT hits in the air end the juggle, and a floating victim that
  // passes its apex before anything juggles it falls out of juggle reach. A launcher hit cancels
  // into a super jump with no squat, aimed at the victim: horizontal speed (victim.x - x) / SUPER_JUMP_AIM, at most
  // SUPER_JUMP_MAX either way. In the air each normal (one per rank) can be used once per jump, fresh or chained.
  const GRAVITY = .65, LAUNCH_GRAVITY = .9, LAUNCH_DRIFT = 1, KNOCKDOWN_DRIFT = 2.2;
  const JUGGLE_LIFT = .3, JUGGLE_POP = 5.5, JUGGLE_DECAY = .8, JUGGLE_SPIKE = -7, SUPER_JUMP_AIM = 22, SUPER_JUMP_MAX = 7;
  // Life points on the Capcom scale, so damage and combo scaling stay fine-grained. Desperation below a quarter.
  const MAX_HP = 1000, DESPERATION_HP = MAX_HP / 4;
  // KOF-style power gauge: each full bar becomes a stock, up to three. Meter only comes from fighting:
  // a landed hit gives the attacker 25% and the defender 20% of the damage dealt, a block 8% and 5% of the
  // move's damage, and starting a special gives 4. Nothing fills it passively.
  const BAR = 100, STOCK_MAX = 3, SUPER_STOCKS = 1;
  const METER = { hit: .25, hitTaken: .2, block: .08, blockTaken: .05, special: 4 };
  // Damage taken fills the dizzy meter 1:1; it dizzies at 420 and drains 2.5 per neutral frame.
  const DIZZY_LIMIT = 420, DIZZY_DRAIN = 2.5, DIZZY_FRAMES = 150;
  // Pushback is a slide: a hit or block gives the defender a velocity that decays x0.82 per simulated frame and
  // starts at 0.18 x the slide distance, so the whole slide covers that distance; blocked strikes slide 1.15x as far.
  const SLIDE_DECAY = .82, SLIDE_START = .18, BLOCK_SLIDE = 1.15, SLIDE_STOP = .05, DEFAULT_SLIDE = 24, PROJECTILE_SLIDE = 20, SUPER_SLIDE = 6;
  // Rank-0 normals (jab, crouching jab) may cancel into each other this many times in a row.
  const RAPID_FIRE = 2;
  // Presses are timed on state.frame, which also runs during hitstop. Among buffered presses the earliest wins,
  // unless a stronger button followed within PRESS_WINDOW frames; two buttons pressed within CHORD_WINDOW frames
  // of each other are a chord (A + S, S + D, F + D).
  const PRESS_WINDOW = 2, CHORD_WINDOW = 2;
  // A motion may rest in neutral for at most MOTION_REST frames between two of its directions (a keyboard roll
  // such as 2,5,6), and its button must follow its last direction within MOTION_PRESS frames, so an old crouch or
  // a walk forward does not turn toward + S into 236 + S.
  const MOTION_REST = 4, MOTION_PRESS = 6;
  // Base damage from which a strike hits heavy: longer hitstop and the heavy reaction cel.
  const HEAVY_DAMAGE = 60;
  // Feel: a counter hit holds its impact COUNTER_HITSTOP frames longer. A slide that a wall stops at WALL_THUD units a
  // frame or more thuds once (a 'wall' effect). After a K.O. freeze the next SLOW_MOTION ticks move the bodies and the
  // animation clock on every other tick (state.slowMotion counts them down); the round-over timer keeps its pace.
  const COUNTER_HITSTOP = 2, WALL_THUD = 1, SLOW_MOTION = 36;
  // Collision rectangles are [x, y, width, height]: x the left edge, y the bottom edge above the ground.
  // Hurtboxes, width x height centred on the fighter: standing and crouching (crouching, crouch-blocking or in a
  // crouching attack) from the feet; airborne and not hit, legs tucked, from AIR_LIFT above the feet (the jump squat
  // keeps the standing box); launched or in air hitstun from AIR_HIT_LIFT above the feet. A fighter lying down after a
  // knockdown has none.
  const HURT = Object.freeze({ stand: [74, 225], crouch: [80, 140], air: [70, 150], airHit: [110, 130] }), AIR_LIFT = 30, AIR_HIT_LIFT = 20;
  // A strike's hitbox spans its height band above the attacker's feet and runs forward from HIT_START in front of the
  // attacker's centre to its reach less half a standing body, so the contact range against a standing opponent is the
  // move's reach. Through the strike's active and recovery frames its limb can be hit: the inner LIMB share of the box.
  const HIT_START = 20, HALF_BODY = HURT.stand[0] / 2, LIMB = .6;
  // Projectile boxes are centred on the projectile. Throws keep the centre-distance rule; GRAB_BAND only draws them.
  const SHOT_BOX = Object.freeze([50, 40]), BEAM_BOX = Object.freeze([70, 60]), GRAB_BAND = Object.freeze([100, 170]);
  const DEFAULTS = Object.freeze({ roundsToWin: 2, roundTime: 99, cpuLevel: 4, training: false, trainingMeter: 'infinite' });
  // Fighting styles change speed, damage and the 214 special. Every style keeps
  // the shared 236 projectile and 623 rising strike so the controls stay learnable.
  const STYLES = {
    balanced: { walk: 1, damage: 1, defense: 1, jump: 1, qcf: 'fireball', qcb: 'rush', names: { dp: 'Rising Strike', qcb: 'Charging Rush' } },
    power: { walk: .88, damage: 1.12, defense: .92, jump: .95, qcf: 'fireball', qcb: 'armorRush', names: { dp: 'Rising Hammer', qcb: 'Iron Charge (armored)' } },
    speed: { walk: 1.15, damage: .92, defense: 1.05, jump: 1.06, qcf: 'fastball', qcb: 'rekka', names: { dp: 'Rising Kick', qcb: 'Rhythm Rush (press up to 3x)' } },
    zoner: { walk: .96, damage: .98, defense: 1, jump: 1, qcf: 'fireball', qcb: 'skyshot', names: { dp: 'Rising Palm', qcb: 'Sky Shot (anti-air)' } },
    grappler: { walk: .9, damage: 1.08, defense: .9, jump: .92, qcf: 'fireball', qcb: 'commandGrab', names: { dp: 'Rising Lariat', qcb: 'Block Party Suplex (grab)' } },
    trickster: { walk: 1.08, damage: .95, defense: 1, jump: 1.04, qcf: 'fireball', qcb: 'teleport', names: { dp: 'Rising Spiral', qcb: 'Shortcut (teleport)' } },
    boss: { walk: 1, damage: 1.15, defense: .85, jump: 1, qcf: 'doubleball', qcb: 'commandGrab', names: { dp: 'Sovereign Rise', qcb: 'Eviction Notice (grab)' } }
  };
  // Normals set fixed stun: hitStun / blockStun are the frames after contact before the defender can act, so
  // with contact on the first active frame the advantage is stun - active - recovery. Specials keep onHit /
  // onBlock, the frame advantage once the attacker recovers (plus means the attacker acts first), and derive
  // ground stun from it so a landed special is never punishable while blocked ones stay risky.
  // slide: the distance a hit pushes the defender (blocks slide 1.15x as far); moves that launch or knock down
  // slide only on block. rank: connected moves chain up-rank inside the cancel window; noCancel moves never
  // cancel and cancelRank is the lowest rank a move may cancel into.
  // height: low must be crouch-blocked, high (jump-ins) must be blocked standing.
  // band: a strike's hitbox height above the attacker's feet, [low, high]; reach sets how far forward it runs. Every
  // strike has one; throws and command grabs reach the opponent's centre instead.
  // chip: share of damage a blocked special still deals; normals never chip.
  // airReset: on an airborne target that is not launched the hit is an air reset (air hitstun, then an air tech and a
  // landing on its feet). Every other hit on an airborne target knocks it down.
  // launch: the vertical speed a launch gives; float: the victim floats (the launcher), superJumpCancel: a hit cancels
  // into a super jump; spike: on a launched victim in the air the hit spikes it down instead of re-popping it.
  const MOVES = {
    // A jab, S light kick, D heavy punch, toward + S roundhouse (standing only).
    punch: { startup: 4, active: 3, recovery: 7, reach: 100, band: [110, 175], damage: 32, pose: 'punch', hitStun: 14, blockStun: 11, slide: 18, rank: 0, airReset: true },
    kick: { startup: 5, active: 3, recovery: 9, reach: 118, band: [60, 140], damage: 36, pose: 'lkick', hitStun: 15, blockStun: 12, slide: 22, rank: 1, airReset: true },
    heavy: { startup: 8, active: 4, recovery: 15, reach: 138, band: [120, 195], damage: 70, pose: 'hpunch', hitStun: 21, blockStun: 15, slide: 36, rank: 2 },
    roundhouse: { startup: 10, active: 4, recovery: 18, reach: 150, band: [150, 215], damage: 82, pose: 'kick', hitStun: 22, blockStun: 16, slide: 46, rank: 2 },
    // S + D: blowback (KOF C + D). Knocks down on hit and never cancels; guard cancels can use it.
    blowback: { startup: 13, active: 4, recovery: 22, reach: 132, band: [90, 190], damage: 90, pose: 'blowback', knockdown: true, blockStun: 22, slide: 44, rank: 2, noCancel: true },
    // F is the accessible special button: free, lighter than the motion version, one shot on screen.
    special: { startup: 12, active: 1, recovery: 22, reach: 0, damage: 60, pose: 'special', rank: 3, chip: .25, projectile: { speed: 8, life: 150 } },
    // Motion specials (keypad notation relative to facing): 236, 623 and 214.
    fireball: { startup: 13, active: 1, recovery: 22, reach: 0, damage: 70, pose: 'special', rank: 3, chip: .25, projectile: { speed: 8, life: 150 } },
    fastball: { startup: 10, active: 1, recovery: 19, reach: 0, damage: 50, pose: 'special', rank: 3, chip: .25, projectile: { speed: 12, life: 46 } },
    doubleball: { startup: 14, active: 1, recovery: 24, reach: 0, damage: 50, pose: 'special', rank: 3, chip: .25, projectile: { speed: 7.5, life: 150, count: 2, gap: 70 } },
    skyshot: { startup: 12, active: 1, recovery: 22, reach: 0, damage: 60, pose: 'special', rank: 3, chip: .25, projectile: { speed: 6.5, life: 80, rise: 3.8 } },
    rising: { startup: 3, active: 10, recovery: 22, reach: 112, band: [60, 260], damage: 100, pose: 'launcher', launch: 9, invulnerable: 8, onBlock: -16, slide: 14, rank: 3, chip: .25, air: true },
    rush: { startup: 7, active: 14, recovery: 16, reach: 104, band: [50, 190], damage: 95, pose: 'dash', speed: 10, knockdown: true, onBlock: -6, slide: 30, rank: 3, chip: .25 },
    armorRush: { startup: 12, active: 14, recovery: 18, reach: 106, band: [50, 190], damage: 120, pose: 'dash', speed: 9, knockdown: true, armor: 1, onBlock: -7, slide: 34, rank: 3, chip: .25 },
    // Up to three presses; the third (finish damage) knocks down.
    rekka: { startup: 6, active: 6, recovery: 15, reach: 104, band: [50, 190], damage: 45, finish: 70, pose: 'kick', speed: 6, chain: 3, onHit: 2, onBlock: -4, slide: 20, rank: 3, chip: .25 },
    commandGrab: { startup: 6, active: 2, recovery: 30, reach: 112, damage: 160, pose: 'throw', unblockable: true, grab: true, knockdown: true, rank: 3 },
    teleport: { startup: 14, active: 1, recovery: 12, reach: 0, damage: 0, pose: 'dash', invulnerable: 16, teleport: true, rank: 3 },
    // Damage per hit of the beam, one hit every BEAM_GAP frames; the last hit knocks down out of juggle reach.
    super: { startup: 12, active: 1, recovery: 26, reach: 0, damage: 50, hits: 6, pose: 'super', stocks: SUPER_STOCKS, rank: 4, chip: .25 },
    throw: { startup: 2, active: 1, recovery: 24, reach: 96, damage: 120, pose: 'throw', unblockable: true, knockdown: true, rank: -1 },
    // Evasion and guard cancels (one stock each) escape pressure in KOF fashion.
    roll: { startup: 1, active: 0, recovery: 22, reach: 0, damage: 0, pose: 'roll', invulnerable: 14, speed: 6.5, rank: -1 },
    gcRoll: { startup: 1, active: 0, recovery: 20, reach: 0, damage: 0, pose: 'roll', invulnerable: 16, speed: 6.5, stocks: 1, rank: -1 },
    gcBlowback: { startup: 6, active: 4, recovery: 22, reach: 128, band: [90, 190], damage: 60, pose: 'blowback', knockdown: true, invulnerable: 10, stocks: 1, onBlock: -2, slide: 48, rank: -1 },
    taunt: { startup: 48, active: 0, recovery: 0, reach: 0, damage: 0, pose: 'taunt', rank: -1 }
  };
  const VARIANTS = {
    crouch: {
      punch: { startup: 4, active: 3, recovery: 8, reach: 94, band: [55, 110], damage: 28, pose: 'cjab', hitStun: 14, blockStun: 12, slide: 16, rank: 0, airReset: true },
      kick: { startup: 9, active: 4, recovery: 20, reach: 150, band: [0, 38], damage: 68, pose: 'sweep', height: 'low', knockdown: true, blockStun: 14, slide: 22, rank: 2, noCancel: true },
      // The launcher cancels only into specials and supers.
      // On hit, up held or pressed inside the cancel window super-jumps after the victim.
      heavy: { startup: 7, active: 5, recovery: 23, reach: 118, band: [90, 250], damage: 60, pose: 'launcher', launch: 14, float: true, superJumpCancel: true, blockStun: 16, slide: 20, rank: 2, cancelRank: 3 }
    },
    air: {
      punch: { startup: 5, active: 8, recovery: 5, reach: 102, band: [60, 150], damage: 30, pose: 'airpunch', height: 'high', hitStun: 16, blockStun: 12, slide: 10, rank: 0, airReset: true },
      kick: { startup: 6, active: 8, recovery: 6, reach: 136, band: [0, 100], damage: 36, pose: 'airkick', height: 'high', hitStun: 17, blockStun: 13, slide: 12, rank: 1, airReset: true },
      heavy: { startup: 7, active: 6, recovery: 7, reach: 124, band: [20, 130], damage: 66, pose: 'airpunch', height: 'high', hitStun: 19, blockStun: 14, slide: 16, rank: 2, spike: true }
    }
  };
  const PROJECTILE = { hitStun: 18, blockStun: 14, chip: .25 };
  // The super beam hits every BEAM_GAP frames. The boss's beam adds two hits, and the boss's super recovers that
  // much later too, so no fighter can act before its own beam has landed its last hit.
  const BEAM_GAP = 5, BOSS_SUPER = Object.freeze({ ...MOVES.super, hits: MOVES.super.hits + 2, recovery: MOVES.super.recovery + 2 * BEAM_GAP });
  const ATTACKS = ['punch', 'kick', 'heavy', 'special'];
  const NORMALS = ['punch', 'kick', 'heavy'];
  // Button strength, weakest first: simultaneous presses resolve to the strongest.
  const STRENGTH = ['punch', 'kick', 'heavy', 'special'];
  // The button behind each action a single press starts (the roundhouse is S held toward, the throw D held sideways).
  const PRESS_OF = { punch: 'punch', kick: 'kick', roundhouse: 'kick', heavy: 'heavy', throw: 'heavy', special: 'special' };
  const PROJECTILE_MOVES = new Set(['special', 'fireball', 'fastball', 'doubleball', 'skyshot', 'super']);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const styleOf = f => STYLES[f.style] || STYLES.balanced;
  function moveData(f) { return f.move === 'super' && f.boss ? BOSS_SUPER : VARIANTS[f.moveVariant]?.[f.move] || MOVES[f.move]; }
  // The three attack buttons take an air or crouching variant; every other action stands.
  function variantOf(f, action, input) { return NORMALS.includes(action) ? f.y > 0 ? 'air' : input.down ? 'crouch' : 'standing' : 'standing'; }
  // Whether an action is an air normal whose rank this jump has already used (each air normal once per jump).
  const airRankUsed = (f, action, input) => variantOf(f, action, input) === 'air' && !!f.airRanks?.includes(VARIANTS.air[action].rank);
  function fighter(id, slot, profile = {}) {
    return { id, slot, style: STYLES[profile.style] ? profile.style : 'balanced', boss: !!profile.boss, reaches: profile.reaches || null,
      x: WIDTH / 2 + (slot ? 190 : -190), y: 0, vy: 0, vx: 0, facing: slot ? -1 : 1,
      hp: MAX_HP, energy: 0, stocks: 0, wins: 0, pose: 'idle', move: null, moveFrame: 0,
      moveVariant: 'standing', landFrames: 0, launched: false, hitAge: 99, airVX: 0,
      // superJump: the jump under way (from its squat to its landing) is a super jump; superPress: the last press of up
      // came within SUPER_JUMP_WINDOW frames of down (downAt, the last frame down was held). airActed: this airborne
      // stretch attacked or was hit, so it lands with landLag frames left. airTech: air-teched, no attacks until landing.
      superJump: false, superPress: false, downAt: -99, landLag: 0, airActed: false, airTech: false,
      // airRanks: the air normal ranks used this jump. floating: launched by the launcher (lighter gravity, slower drift)
      // until it lands; juggled: hit again in the air since that launch. hitConfirmed: the move's contact was a hit (not a
      // block or armor), as the super-jump cancel needs.
      airRanks: [], floating: false, juggled: false, hitConfirmed: false,
      hitDone: false, connected: false, stun: 0, blockStun: false, stunAtStart: 0, blockStunAtStart: false, guard: false, crouching: false, hitCrouch: false, lastInput: {},
      dash: 0, dashDir: 0, invulnerable: 0, juggle: 0, combo: 0, comboDamage: 0, counter: false,
      running: false, skid: 0, jumpSquat: 0, hop: false, armor: 0, rekka: 0, dizzy: 0, dizzyMeter: 0,
      quickRise: false, hardKnockdown: false, neutralFrames: 0, standFrames: 0,
      // wallThud: the current slide has already thudded against a wall. specialDir: the keypad direction held as F was
      // pressed, which picks the one-button special (as kickDir picks the light kick or the roundhouse).
      slide: 0, slideWall: false, wallThud: false, rapid: 0, kickDir: 5, specialDir: 5,
      motions: [], taps: { left: -99, right: -99 }, pressAt: { punch: -99, kick: -99, heavy: -99, special: -99, jump: -99, taunt: -99 },
      buffer: { punch: 0, kick: 0, heavy: 0, special: 0, jump: 0, taunt: 0 } };
  }
  function create(ids = ['grillmaster', 'weekendwarrior'], options = {}) {
    const settings = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([key]) => key in DEFAULTS)) };
    settings.roundsToWin = clamp(Math.round(settings.roundsToWin) || 2, 1, 3);
    settings.roundTime = settings.roundTime === 0 ? 0 : clamp(Math.round(settings.roundTime) || 99, 15, 99);
    settings.cpuLevel = clamp(Math.round(settings.cpuLevel) || 4, 1, 8);
    // Per-slot CPU levels (cpuLevels: [slot 0, slot 1]); cpuLevel alone sets both.
    settings.cpuLevels = [0, 1].map(slot => clamp(Math.round(Array.isArray(options.cpuLevels) ? options.cpuLevels[slot] : settings.cpuLevel) || settings.cpuLevel, 1, 8));
    const profiles = options.profiles || {};
    const cpu = options.cpu !== false;
    const cpuSlots = Array.isArray(options.cpuSlots) ? options.cpuSlots.slice(0, 2).map(Boolean) : [false, cpu];
    // slowMotion: ticks of K.O. slow motion still to run once the K.O. freeze (hitstop) is over; 0 outside it.
    return { frame: 0, motionFrame: 0, fighters: ids.slice(0, 2).map((id, slot) => fighter(id, slot, profiles[id])), projectiles: [], effects: [], slowMotion: 0,
      time: settings.roundTime * 60, round: 1, phase: 'intro', phaseFrames: 90, winner: null, firstHit: false,
      message: 'ROUND 1', cpu: cpuSlots[1], cpuSlots, options: settings, result: null, draws: 0,
      rng: (Number(options.seed) >>> 0) || 0x2f6b9d3, cpuMemory: [cpuMemory(), cpuMemory()], hitstop: 0 };
  }
  function random(state) {
    // xorshift32 keeps CPU decisions deterministic for replays and the server.
    let x = state.rng >>> 0 || 1; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    state.rng = x; return x / 4294967296;
  }
  function emit(state, type, x, y, facing = 1, life = 18, extra) {
    state.effects.push(Object.assign({ type, x, y, facing, life, maxLife: life }, extra));
  }
  function banner(state, slot, text) { emit(state, 'banner', slot ? WIDTH : 0, 0, slot ? -1 : 1, 70, { text, slot }); }
  // The first three hits of a combo deal full damage, then each further hit x0.82, down to 15% (30% for super hits).
  function comboScale(hits, superHit = false) { return hits <= 3 ? 1 : Math.max(superHit ? .3 : .15, Math.pow(.82, hits - 3)); }
  function gainEnergy(f, amount) {
    f.energy += amount;
    while (f.energy >= BAR && f.stocks < STOCK_MAX) { f.energy -= BAR; f.stocks++; f.stockFlash = 30; }
    if (f.stocks >= STOCK_MAX) f.energy = Math.min(BAR, f.energy);
    f.energy = Math.max(0, f.energy);
  }
  function spendEnergy(f, amount) {
    f.energy -= amount;
    while (f.energy < 0 && f.stocks > 0) { f.stocks--; f.energy += BAR; }
    f.energy = Math.max(0, f.energy);
  }
  const desperate = f => f.hp > 0 && f.hp <= DESPERATION_HP;
  const meter = f => f.energy + f.stocks * BAR;
  function down(f) { return f.launched && f.y === 0 && f.stun > 0; }
  function hittable(target) { return target.hp > 0 && !target.invulnerable && !down(target) && !(target.launched && target.y > 0 && target.juggle >= JUGGLE_LIMIT); }
  const overlaps = (a, b) => !!a && !!b && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  // A grounded fighter reeling from a hit: in hitstun, or on the frame its hitstun runs out (it cannot act until the
  // next one), as the combo rule counts it. Knocked-down and dizzy fighters are not reeling.
  const reeling = f => !f.launched && !f.dizzy && (f.stun > 0 && !f.blockStun || f.stunAtStart > 0 && !f.blockStunAtStart);
  // The posture the body box follows. A move keeps its own variant, and a reeling fighter keeps the posture the hit
  // found it in (hitCrouch), as in Capcom games: holding down in hitstun does not duck the rest of a combo, nor does
  // letting go stand into it. Otherwise it is the crouch the player holds, crouching or crouch-blocking; blockstun
  // follows the stick, so a guard can still switch height.
  // A fighter in landing lag cannot act, so it cannot crouch either: it keeps the standing box.
  function crouched(f) {
    if (f.y > 0) return false;
    if (f.move) return f.moveVariant === 'crouch';
    if (reeling(f)) return !!f.hitCrouch;
    return !!f.crouching && !f.dizzy && !f.dash && !f.running && !f.jumpSquat && !f.landLag;
  }
  // The body box for the fighter's state; null while it lies down after a knockdown.
  function hurtbox(f) {
    if (down(f)) return null;
    if (f.launched || (f.y > 0 && f.stun > 0 && !f.blockStun)) { const [w, h] = HURT.airHit; return [f.x - w / 2, f.y + AIR_HIT_LIFT, w, h]; }
    if (f.y > 0) { const [w, h] = HURT.air; return [f.x - w / 2, f.y + AIR_LIFT, w, h]; }
    const [w, h] = crouched(f) ? HURT.crouch : HURT.stand;
    return [f.x - w / 2, f.y, w, h];
  }
  function strikeBox(f, move) {
    const far = Math.max(HIT_START + 1, reachOf(f, move) - HALF_BODY), [low, high] = move.band;
    return [f.facing === 1 ? f.x + HIT_START : f.x - far, f.y + low, far - HIT_START, high - low];
  }
  // The attacker's extended limb: the inner share of its strike box, nearest the body.
  function limbBox(f, move) {
    const [x, y, w, h] = strikeBox(f, move), limb = w * LIMB;
    return [f.facing === 1 ? x : x + w - limb, y, limb, h];
  }
  // A strike's limb stays out from its first active frame until the move ends (a rising strike's lasts until it lands).
  function limbOf(f) { const move = f.move && moveData(f); return move?.band && f.moveFrame >= move.startup ? limbBox(f, move) : null; }
  function projectileBox(p) { const [w, h] = p.super ? BEAM_BOX : SHOT_BOX; return [p.x - w / 2, p.y - h / 2, w, h]; }
  // Where a strike or projectile box touches a fighter: the centre of its overlap with the body, else with the limb.
  function contactPoint(box, f) {
    for (const hurt of [hurtbox(f), limbOf(f)]) if (overlaps(box, hurt)) {
      const left = Math.max(box[0], hurt[0]), right = Math.min(box[0] + box[2], hurt[0] + hurt[2]);
      const bottom = Math.max(box[1], hurt[1]), top = Math.min(box[1] + box[3], hurt[1] + hurt[3]);
      return { x: (left + right) / 2, y: (bottom + top) / 2 };
    }
    return null;
  }
  function knockDown(target, move, wasAirborne) {
    // A launched victim hit in the air is juggled: each hit re-pops it less and the air heavy spikes it down. A fresh
    // launch or knockdown sets its own speed, and only the launcher's floats.
    if (wasAirborne && target.launched) { target.vy = move.spike ? JUGGLE_SPIKE : Math.max(target.vy * JUGGLE_LIFT, JUGGLE_POP - JUGGLE_DECAY * target.juggle); target.juggled = true; }
    else { target.vy = move.launch || (wasAirborne ? Math.max(target.vy, 6) : 5); target.floating = !!move.float; target.juggled = false; }
    target.y = Math.max(1, target.y); target.stun = Math.max(target.stun, 30); target.launched = true; target.pose = 'tumble';
    target.hardKnockdown = !!move.hardKnockdown; target.quickRise = false;
    // A combo ender (the super beam's last hit) knocks down out of juggle reach: nothing follows it.
    if (move.endsCombo) target.juggle = JUGGLE_LIMIT;
    else if (wasAirborne) target.juggle++;
  }
  // impactX / impactY: where the boxes touch (impactY above the ground); the effects are drawn there.
  function dealHit(state, target, source, damage, impactX, direction = source.facing, move = {}, impactY = target.y + 110) {
    if (!hittable(target)) return false;
    // The posture the hit finds the target in (read before the hit clears its move); its hitstun keeps it.
    const crouchedAtHit = crouched(target);
    // A defender facing away from an incoming cross-up cannot block it by
    // holding back relative to an opponent now on the other side.
    const heightOk = move.height === 'low' ? target.crouching : move.height === 'high' ? !target.crouching : true;
    // Block and combo are judged from the stun the target started the frame with: on the frame its stun runs out
    // it cannot act yet, so a blocking target still blocks and a hit target is still in the combo.
    const guarding = target.blockStun && target.stun > 0 || target.blockStunAtStart && !target.move;
    const blocked = !move.unblockable && target.y === 0 && !target.dizzy && (target.guard && target.facing === -direction && heightOk || guarding);
    // One-hit armor absorbs a strike during an armored special (never a throw).
    if (!blocked && target.armor > 0 && !move.unblockable) {
      target.armor--; target.hp = Math.max(0, target.hp - Math.max(1, Math.round(damage * .5)));
      state.hitstop = Math.max(state.hitstop, 6); emit(state, 'armor', impactX, GROUND - impactY, direction, 16);
      return 'armor';
    }
    const counter = !blocked && !move.unblockable && !!target.move && target.moveFrame < (moveData(target)?.startup ?? 0);
    const inCombo = !blocked && (target.stun > 0 && !target.blockStun || target.launched || target.stunAtStart > 0 && !target.blockStunAtStart && !target.dizzy);
    if (!blocked) { target.combo = inCombo ? target.combo + 1 : 1; if (!inCombo) target.comboDamage = 0; }
    const styleScale = styleOf(source).damage * styleOf(target).defense * (move.desperation ? 1.3 : 1);
    const dealt = blocked ? Math.floor(damage * (move.chip || 0)) : Math.max(1, Math.round(damage * styleScale * comboScale(target.combo, move.superHit) * (counter ? 1.25 : 1)));
    target.hp = Math.max(0, target.hp - dealt);
    if (!blocked) { target.comboDamage += dealt; target.dizzyMeter = target.dizzy ? 0 : target.dizzyMeter + dealt; }
    if (target.dizzy && !blocked) target.dizzy = 0;
    // Normals, air normals and projectiles use fixed stun; grounded specials set it from the attacker's
    // remaining frames plus their declared advantage.
    const fixed = blocked ? move.blockStun : move.hitStun, advantage = blocked ? move.onBlock : move.onHit;
    // A strike carries the frames its attacker had left before contacts resolved (in a trade the first hit clears them).
    const remaining = move.remaining ?? (source.move && move.startup ? move.startup + move.active + move.recovery - source.moveFrame : 0);
    target.stun = fixed ?? (advantage !== undefined && remaining ? Math.max(2, remaining + advantage) : blocked ? 8 : 17);
    if (counter) target.stun += 4;
    const wasAirborne = target.y > 0;
    target.blockStun = blocked;
    target.hitAge = 0; target.counter = counter; target.heavyHit = !blocked && (damage >= HEAVY_DAMAGE || counter);
    target.pose = blocked ? 'block' : 'hit';
    target.move = null; target.connected = false; target.hitConfirmed = false; target.dash = 0; target.running = false; target.jumpSquat = 0; target.rekka = 0;
    // A hit ends a jump in progress (its squat included), an air tech and a landing lag.
    target.superJump = false; target.airTech = false; target.landLag = 0;
    // An airReset light on an airborne target that is not launched is an air reset: air hitstun for the move's
    // hitstun, falling under gravity with AIR_RESET_LIFT of its vertical speed and drifting away from the attacker.
    // Every other hit on an airborne target knocks it down (and launched targets keep the juggle rules).
    const airReset = !blocked && wasAirborne && !target.launched && !!move.airReset && !move.launch && !move.knockdown;
    if (!blocked && target.hp > 0 && (move.launch || move.knockdown || wasAirborne && !airReset)) knockDown(target, move, wasAirborne);
    if (airReset) { target.vy *= AIR_RESET_LIFT; target.airVX = direction * AIR_RESET_DRIFT; }
    // An air reset lands free and can guard at once, so an anti-air never guarantees a follow-up; only a jump that
    // itself attacked lands with the lag (being reset also clears the victim's own air attack).
    if (wasAirborne && !blocked) target.airActed = false;
    target.hitCrouch = !blocked && !target.launched && crouchedAtHit;
    // Pushback slides over the following frames (a new hit replaces the slide); launched and knocked-down
    // fighters drift through the air instead, as does an air reset. Blocked strikes slide 1.15x as far; projectiles and
    // super hits slide their own distance either way. A strike's slide that a wall stops pushes a grounded attacker back.
    const sliding = blocked || !target.launched && !airReset, strike = !!move.startup;
    target.slide = sliding ? direction * (move.slide ?? DEFAULT_SLIDE) * (blocked && strike ? BLOCK_SLIDE : 1) * SLIDE_START : 0;
    target.slideWall = sliding && strike; target.wallThud = false;
    // A super's own hits build no meter for its owner (as in Capcom games), so a landed super never pays for itself.
    if (blocked) { if (!move.superHit) gainEnergy(source, damage * METER.block); gainEnergy(target, damage * METER.blockTaken); }
    else { if (!move.superHit) gainEnergy(source, dealt * METER.hit); gainEnergy(target, dealt * METER.hitTaken); }
    // Contact pauses: 5 light, 7 heavy, 9 for launches and knockdowns, 4 on a guard and COUNTER_HITSTOP more on a counter
    // hit, with poses, camera and effects held together.
    state.hitstop = Math.max(state.hitstop, (blocked ? 4 : move.launch || move.knockdown ? 9 : damage >= HEAVY_DAMAGE ? 7 : 5) + (counter ? COUNTER_HITSTOP : 0));
    emit(state, blocked ? 'block' : 'hit', impactX, GROUND - impactY, direction, 18, { heavy: !blocked && (damage >= HEAVY_DAMAGE || !!move.launch), damage: dealt, attacker: source.slot });
    // Every counter hit also emits 'counter' (the renderers flash the screen negative), banner or not.
    if (counter) emit(state, 'counter', impactX, GROUND - impactY, direction, 18, { damage: dealt, attacker: source.slot });
    if (!blocked) {
      const slot = source.slot ?? state.fighters.indexOf(source);
      if (!state.firstHit) { state.firstHit = true; banner(state, slot, 'FIRST ATTACK'); }
      else if (counter) banner(state, slot, 'COUNTER');
      else if (move.reversal && target.y > 0 && source.moveFrame <= move.startup + 1) banner(state, slot, 'REVERSAL');
    }
    return blocked ? 'block' : 'hit';
  }
  // One frame of a pushback slide: grounded fighters move, then the velocity decays (also while airborne). Returns
  // how far the fighter moved, the part a wall stopped (stopped) and the part of a strike slide a wall stopped (wall),
  // which the caller passes to the attacker. The slide stays out of vx, which is the fighter's own walking movement.
  function slideStep(f) {
    const out = { moved: 0, wall: 0, stopped: 0 };
    if (!f.slide) return out;
    if (f.y === 0) {
      const want = f.x + f.slide, x = clamp(want, WALL, WIDTH - WALL);
      out.moved = x - f.x; f.x = x; out.stopped = want - x;
      if (f.slideWall) out.wall = out.stopped;
    }
    f.slide *= SLIDE_DECAY;
    if (Math.abs(f.slide) < SLIDE_STOP) { f.slide = 0; f.slideWall = false; }
    return out;
  }
  // A slide that a wall stops thuds once, at the wall behind the fighter: the renderers shake and raise dust. force is
  // the speed the wall stopped, in units a frame.
  function wallThud(state, f, { stopped }) {
    if (f.wallThud || Math.abs(stopped) < WALL_THUD) return;
    f.wallThud = true;
    const side = Math.sign(stopped);
    emit(state, 'wall', f.x + side * HALF_BODY, GROUND - f.y - 110, side, 20, { slot: f.slot, force: Math.abs(stopped) });
  }
  // Keypad direction relative to facing: 1 2 3 bottom row, 4 5 6, 7 8 9.
  function direction(input, facing) {
    const forward = facing === 1 ? input.right : input.left, back = facing === 1 ? input.left : input.right;
    const h = forward && !back ? 1 : back && !forward ? -1 : 0, v = input.down ? -1 : input.jump ? 1 : 0;
    return 5 + h + v * 3;
  }
  // Whether a motion was entered: every direction inside `window` frames, at most MOTION_REST frames of neutral
  // between two of them and the button (pressed on frame `pressFrame`) at most MOTION_PRESS frames after the last.
  function performed(f, sequence, frame, window = MOTION_WINDOW, pressFrame = frame) {
    // Lenient subsequence match so keyboard rolls (2,5,6) still count as 236, newest direction first.
    let index = sequence.length - 1, last = null, rest = 0;
    for (let i = f.motions.length - 1; i >= 0 && index >= 0; i--) {
      const [digit, at] = f.motions[i];
      if (frame - at > window) break;
      if (digit === sequence[index]) { if (last === null) last = at; index--; rest = 0; }
      else if (digit === 5 && last !== null) {
        // Neutral inside the motion is a short release in a keyboard roll; a longer one is a fighter standing up.
        rest += (i + 1 < f.motions.length ? f.motions[i + 1][1] : frame + 1) - at;
        if (rest > MOTION_REST) return false;
      }
    }
    return index < 0 && pressFrame - last <= MOTION_PRESS;
  }
  const pressedTogether = (f, a, b) => f.buffer[a] > 0 && f.buffer[b] > 0 && Math.abs(f.pressAt[a] - f.pressAt[b]) <= CHORD_WINDOW;
  // The button a buffered press starts: the earliest press wins, unless a stronger button was pressed within
  // PRESS_WINDOW frames of it (then the strongest of those). Presses are ordered by the frame they were made on. In the
  // air a button whose normal this jump has used is passed over (it stays buffered), so it does not hold up the next one.
  function firstPress(f, ownShot, input) {
    const pressed = STRENGTH.filter(a => f.buffer[a] > 0 && (a !== 'special' || !ownShot) && !airRankUsed(f, a, input));
    if (!pressed.length) return null;
    const earliest = Math.min(...pressed.map(a => f.pressAt[a]));
    return pressed.filter(a => f.pressAt[a] - earliest <= PRESS_WINDOW).pop();
  }
  // Decide which action a buffered press starts, honoring motions, throws, supers and system moves. In a cancel
  // (cancel = true) rolls, throws and the taunt are not candidates, so their buttons count as ordinary presses.
  function command(state, f, other, input, cancel = false) {
    if (input.command && MOVES[input.command]) return input.command;
    const style = styleOf(f);
    const pressed = ATTACKS.filter(a => f.buffer[a] > 0);
    if (f.buffer.taunt > 0 && !pressed.length && f.y === 0) return cancel ? null : 'taunt';
    if (!pressed.length) return null;
    const grounded = f.y === 0, frame = state.frame, attacks = pressed.filter(a => a !== 'special');
    // A motion counts with the latest attack press (F alone stays the F shot).
    const pressFrame = attacks.length ? Math.max(...attacks.map(a => f.pressAt[a])) : frame;
    const motion = (sequence, window) => attacks.length > 0 && performed(f, sequence, frame, window, pressFrame);
    if (f.stocks >= SUPER_STOCKS && (motion([2, 6, 2, 6], 28) || pressedTogether(f, 'special', 'heavy'))) return 'super';
    if (grounded && !cancel && pressedTogether(f, 'punch', 'kick')) return 'roll';
    if (grounded && pressedTogether(f, 'kick', 'heavy')) return 'blowback';
    if (grounded && motion([6, 2, 3])) return 'rising';
    const ownShot = state.projectiles.some(p => p.owner === f.slot && !p.super);
    if (grounded && motion([2, 6]) && !ownShot) return style.qcf;
    if (grounded && motion([2, 4]) && !(style.qcb === 'skyshot' && ownShot)) return style.qcb;
    // One-button special: on the ground F takes the direction held as it was pressed, down (1, 2 or 3) the rising
    // strike, toward the style's 214 special and neutral or back the F shot; in the air F is the shot. A shot (the F
    // shot or the zoner's sky shot) waits while the fighter's own shot is on screen.
    const dir = f.specialDir, oneButton = !grounded ? 'special' : dir <= 3 ? 'rising' : dir === 6 || dir === 9 ? style.qcb : 'special';
    const button = firstPress(f, ownShot && PROJECTILE_MOVES.has(oneButton), input);
    if (!button) return null;
    if (button === 'special') return oneButton;
    // Forward or back + D up close throws (a back throw swaps sides). The opponent must have been out of stun since
    // the frame began, whichever slot each fighter is in.
    const sideways = (other.x >= f.x ? input.right : input.left) || (other.x >= f.x ? input.left : input.right);
    if (button === 'heavy' && !cancel && grounded && sideways && !input.down && other.y === 0 && !other.stun && !other.stunAtStart && !other.invulnerable && !other.launched && Math.abs(other.x - f.x) < MOVES.throw.reach) return 'throw';
    // S pressed while holding toward is the standing roundhouse, even when it comes out of the buffer after the
    // direction was let go; holding down still makes the sweep.
    if (button === 'kick' && grounded && !input.down && f.kickDir === 6) return 'roundhouse';
    return button;
  }
  // How a connected move may cancel into the next action: 'chain' (up-rank, at least the move's cancelRank),
  // 'rapid' (a grounded rank-0 normal into another, at most RAPID_FIRE times in a row) or null.
  function cancelKind(f, move, next, input) {
    if (['throw', 'roll', 'taunt'].includes(next)) return null;
    if (!(f.y === 0 || ATTACKS.includes(next)) || meter(f) < (MOVES[next].cost || 0) || f.stocks < (MOVES[next].stocks || 0)) return null;
    const variant = variantOf(f, next, input), data = VARIANTS[variant]?.[next] || MOVES[next];
    if (airRankUsed(f, next, input)) return null;
    // A launcher that hit floats its victim above every shot and the super beam, so those cancels are refused there
    // (they could only whiff and waste a stock); on block they cancel as usual.
    if (move.float && f.hitConfirmed && PROJECTILE_MOVES.has(next)) return null;
    if (data.rank > move.rank && data.rank >= (move.cancelRank || 0)) return 'chain';
    if (move.rank === 0 && data.rank === 0 && f.moveVariant !== 'air' && variant !== 'air' && (f.rapid || 0) < RAPID_FIRE) return 'rapid';
    return null;
  }
  // ---------------------------------------------------------------- the CPU
  // A level-scaled opponent (levels 1-8; the boss plays two levels higher). It sees an opponent's move, or the squat of
  // a jump, only max(2, 14 - 1.5 x level) simulated frames after it starts, and acts only through inputs a player could
  // make (input.command names a move, which only the engine's own CPU may do). Every choice draws on random(state), so a
  // seed replays exactly, and its memory (state.cpuMemory[slot]) is plain JSON that starts afresh every round.
  // In priority order it mashes out of dizzy, quick-rises, escapes throws, guards and guard-cancels, runs hit-confirm
  // scripts, jumps shots, anti-airs, punishes, blocks by the attack's height and otherwise plays neutral around its
  // style's preferred distance: pressure up close, pokes, jump-ins and dashes from further out, shots from range.
  // Specials are budgeted (CPU_SPECIALS a minute, from none at the start of a match) and supers are kept for punishes,
  // combo finishes and desperation.
  const CPU_SPACING = Object.freeze({ zoner: 360, trickster: 240, balanced: 180, power: 160, speed: 140, grappler: 110, boss: 170 });
  const CPU_SPECIALS = 8, CPU_TOKEN_CAP = 3;
  // A stand-off is broken at CPU_APPROACH (inside poke range); an opponent that has not attacked, jumped or come
  // forward for CPU_QUIET frames is no threat to guard against.
  const CPU_APPROACH = 100, CPU_QUIET = 180;
  // Script steps in numpad notation: the move requested by name, with down held for the crouching variants. sj holds up
  // and toward (the launcher's super-jump cancel), rk presses a rhythm-rush follow-up and tick throws once the opponent's
  // blockstun ends. Any other step names a move (a special or the super).
  const CPU_STEPS = Object.freeze({
    '5A': { command: 'punch' }, '5S': { command: 'kick' }, '5D': { command: 'heavy' }, '6S': { command: 'roundhouse' },
    '2A': { command: 'punch', crouch: true }, '2S': { command: 'kick', crouch: true }, '2D': { command: 'heavy', crouch: true },
    'j.A': { command: 'punch', air: true }, 'j.S': { command: 'kick', air: true }, 'j.D': { command: 'heavy', air: true },
    sj: { superJump: true }, rk: { rekka: true }, tick: { command: 'throw', tick: true }
  });
  // Punish openers, fastest first.
  const CPU_OPENERS = ['5A', '2A', '5S', '2D', '5D', '2S', '6S'];
  const cpuStep = name => CPU_STEPS[name] || { command: name };
  const cpuData = name => { const step = cpuStep(name); return step.command && (VARIANTS[step.crouch ? 'crouch' : step.air ? 'air' : 'none']?.[step.command] || MOVES[step.command]); };
  const groundNormal = name => !!CPU_STEPS[name]?.command && !CPU_STEPS[name].air && !CPU_STEPS[name].tick;
  function cpuMemory() {
    return { started: false, tokens: 0, next: 0, act: null, guardUntil: -1, plan: [], script: null, rolls: {}, foe: { move: null, frame: 0, id: 0 }, own: null,
      jump: { id: 0, at: -99, on: false }, hurt: 0, hurtOn: false, guarded: 0, guardOn: false, shot: null, air: 0, airOn: false, wake: false, contact: 0,
      foeActive: -999, pressure: 0, blockEnd: -99, answer: -1, walled: 0, foeBlockOn: false };
  }
  function cpuLevelOf(state, slot) {
    const levels = state.options.cpuLevels, base = Array.isArray(levels) && Number.isFinite(levels[slot]) ? levels[slot] : state.options.cpuLevel;
    return clamp(Math.round(base) + (state.fighters[slot].boss ? 2 : 0), 1, 10);
  }
  // A coin drawn once for (key, id) and then remembered, so each threat, opening or jump is judged once.
  function cpuRoll(c, key, id, p) {
    const prior = c.memory.rolls[key];
    if (prior && prior[0] === id) return prior[1];
    const result = random(c.state) < p; c.memory.rolls[key] = [id, result]; return result;
  }
  // Where a fighter is t simulated frames from now if nothing acts on it: airborne it follows its committed arc (a
  // launcher's floating victim under its lighter gravity and slower drift), on the ground it finishes its pushback slide.
  function cpuPredict(f, t) {
    let x = f.x, y = f.y, vy = f.vy;
    if (y <= 0 && vy <= 0) return { x: clamp(x + (f.slide || 0) * (1 - Math.pow(SLIDE_DECAY, t)) / (1 - SLIDE_DECAY), WALL, WIDTH - WALL), y: 0 };
    const fall = gravity(f), drift = f.launched ? -f.facing * (f.floating ? LAUNCH_DRIFT : KNOCKDOWN_DRIFT) : f.airVX || 0;
    for (let i = 0; i < t && (y > 0 || vy > 0); i++) { y += vy; vy -= fall; x += drift; }
    return { x: clamp(x, WALL, WIDTH - WALL), y: Math.max(0, y) };
  }
  // The body box a fighter will have at a predicted position, t frames from now (null when no hit can land there).
  // A launcher's floating victim that nothing has juggled leaves juggle reach at its apex (vy <= 0).
  function cpuBody(f, at, t) {
    if (down(f) || f.hp <= 0 || f.invulnerable > t || f.launched && (at.y <= 0 || f.juggle >= JUGGLE_LIMIT || f.floating && !f.juggled && f.vy - t * gravity(f) <= 0)) return null;
    if (at.y > 0) { const hit = f.launched || f.stun > 0 && !f.blockStun, [w, h] = hit ? HURT.airHit : HURT.air; return [at.x - w / 2, at.y + (hit ? AIR_HIT_LIFT : AIR_LIFT), w, h]; }
    const [w, h] = crouched(f) ? HURT.crouch : HURT.stand;
    return [at.x - w / 2, 0, w, h];
  }
  // Whether a strike started `delay` frames from now by f, facing `facing`, meets the target's body (or its extended
  // limb, with limb) on one of its active frames. Both fighters follow their arcs; rushes travel and a rising strike rises.
  function cpuConnects(f, target, data, facing, limb = false, delay = 0) {
    if (!data?.band) return false;
    const airborne = f.y > 0 || f.vy > 0;
    for (let t = delay + data.startup; t < delay + data.startup + data.active; t++) {
      const me = airborne ? cpuPredict(f, t) : { x: f.x, y: 0 }, them = cpuPredict(target, t);
      if (airborne && me.y <= 0) break;
      let { x, y } = me;
      if (data === MOVES.rising) { const k = t - delay - data.startup; y = 1 + 11 * k - .325 * k * (k - 1); x += facing * 1.5 * k; }
      else if (data.speed) x += facing * data.speed * (t - delay);
      if ((them.x - x) * facing < 0) continue;
      const box = strikeBox({ x, y, facing, reaches: f.reaches }, data);
      if (overlaps(box, cpuBody(target, them, t)) || limb && overlaps(box, limbOf(target))) return true;
    }
    return false;
  }
  // Whether a full jump toward world direction dir, pressed after `delay` frames standing still, clears shot p: the shot
  // never meets the body, and it has passed or died by the landing. The press frame walks, then the squat and the arc.
  function cpuClears(f, p, dir, delay) {
    const style = styleOf(f), [w, h] = p.super ? BEAM_BOX : SHOT_BOX;
    let x = f.x, y = 0, vy = 0, px = p.x, py = p.y, life = p.life, flying = false;
    for (let t = 0; t < delay + 80; t++) {
      const k = t - delay;
      if (k === 0) x += dir * WALK_FORWARD * style.walk;
      else if (k === JUMP_SQUAT) { y = 1; vy = JUMPS.full.vy * style.jump; flying = true; }
      else if (k > JUMP_SQUAT) { y = Math.max(0, y + vy); vy -= .65; x += dir * AIR_SPEED * JUMPS.full.vx; }
      x = clamp(x, WALL, WIDTH - WALL);
      if (life <= 0) return true;
      px += p.facing * (p.speed || 8); py += p.rise || 0; life--;
      const [bw, bh] = y > 0 ? HURT.air : HURT.stand;
      if (overlaps([px - w / 2, py - h / 2, w, h], [x - bw / 2, y > 0 ? y + AIR_LIFT : 0, bw, bh])) return false;
      if (flying && y === 0) return (x - px) * p.facing < 0 || life <= 0;
    }
    return false;
  }
  const cpuOwnShot = c => c.state.projectiles.some(p => p.owner === c.slot && !p.super);
  const cpuCanGuard = f => !f.move && !f.dash && !f.dizzy && !f.jumpSquat && !f.landLag && f.y === 0;
  // Guard by the attack's height: crouch for lows and against a grounded opponent (a crouch guard blocks every ground
  // strike; the roundhouse passes over it), stand for jump-ins and air moves once they are seen.
  function cpuGuard(c) {
    const { enemy, memory } = c, data = enemy.move && moveData(enemy), seen = data && enemy.moveFrame >= c.reaction;
    const airborne = memory.jump.on && c.now - memory.jump.at >= c.reaction || enemy.y > 0 && enemy.moveFrame >= c.reaction;
    const low = seen && data.height ? data.height === 'low' : !airborne;
    return { [c.away]: true, down: low };
  }
  // Whether the CPU spends a stock on a super now: from level 6 whenever it holds one; below that it keeps a single
  // stock back unless the gauge is full, the super would finish the round or it is desperate.
  const cpuSupers = c => c.self.stocks >= SUPER_STOCKS && (c.level >= 6 || c.self.stocks >= STOCK_MAX || c.enemy.hp <= 200 || desperate(c.self));
  // The combo ender: the super when a stock is held (see cpuSupers), else the style's special (one that reaches from a chain).
  // A launcher's floating victim rises over shots and the super's beam, so after a launch only a rush, the rekka or the
  // rising strike ends the combo.
  function cpuEnder(c) {
    const { self, enemy, memory, level } = c, style = styleOf(self), floating = enemy.launched && enemy.floating;
    if (level < 3) return null;
    if (!floating && cpuSupers(c)) return ['super'];
    if (memory.tokens < 1) return null;
    if (style.qcb === 'rekka') return ['rekka', 'rk', 'rk'];
    if (style.qcb === 'rush' || style.qcb === 'armorRush') return [style.qcb];
    if (floating) return ['rising'];
    return cpuOwnShot(c) ? null : [style.qcf];
  }
  // Hit-confirm routes from an opener; low levels cut them short (level 1 never chains past two hits).
  function cpuRoute(c, opener) {
    const { level } = c, coin = () => random(c.state);
    const routes = {
      '5A': level >= 4 && c.distance < 90 ? ['5A', '5A', '5S', '5D', 'ender'] : ['5A', '5S', '5D', 'ender'],
      '2A': level >= 5 && coin() < .35 ? ['2A', '2D', 'sj', 'j.A', 'j.S', 'j.D'] : ['2A', '2A', '2S'],
      '5S': ['5S', '5D', 'ender'], '5D': ['5D', 'ender'], '6S': ['6S', 'ender'],
      '2D': level >= 5 ? ['2D', 'sj', 'j.A', 'j.S', 'j.D'] : ['2D', 'ender'],
      jump: [coin() < .6 ? 'j.D' : 'j.S', '5A'].concat(level >= 4 && coin() < .5 ? ['5A'] : [], ['5S', '5D', 'ender'])
    };
    const steps = routes[opener] || [opener];
    return steps.slice(0, level <= 1 ? 2 : level <= 3 ? 3 : steps.length);
  }
  function cpuBegin(c, steps, options = {}) {
    // Below level 4 the CPU never links a new string into one that has landed, so its combos stay as short as its routes.
    if (c.level <= 3 && (c.enemy.launched || c.enemy.stun > 0 && !c.enemy.blockStun)) return {};
    c.memory.script = { steps, at: 0, started: false, since: c.now, prev: [c.self.move, c.self.moveFrame], frame: 0, stage: 0, blocked: 0, flew: false,
      trap: !!options.trap, gap: options.gap || 0, wait: false };
    return cpuScript(c) || {};
  }
  function cpuEnd(c) { c.memory.script = null; c.memory.next = Math.max(c.memory.next, c.now + 2); return null; }
  function cpuNext(c) {
    const script = c.memory.script;
    script.at++; script.started = false; script.since = c.now; script.prev = [c.self.move, c.self.moveFrame]; script.stage = c.self.rekka || 0;
    return script.at < script.steps.length;
  }
  // Runs the current script one frame: a step is pressed until its move starts, then watched until it connects. On a
  // hit the next step fires; on block the string goes on to a second blocked hit at most and stops (from level 6 it ends
  // in a tick throw or, from range, a safe shot); a whiff ends it. Returns the frame's input, or null once it has ended.
  function cpuScript(c) {
    const { self, enemy, memory, level, now } = c, script = memory.script;
    if (self.y > 0) script.flew = true;
    for (let pass = 0; pass < 6; pass++) {
      if (script.steps[script.at] === 'ender') {
        // The ender only cancels a move that connected on hit, so a special or super never comes out raw.
        const combo = self.move && self.connected && (enemy.stun > 0 && !enemy.blockStun || enemy.launched);
        const ender = combo && cpuEnder(c);
        if (!ender) return cpuEnd(c);
        script.steps.splice(script.at, 1, ...ender);
      }
      const name = script.steps[script.at], step = cpuStep(name), data = cpuData(name);
      if (!script.started) {
        const started = step.superJump ? self.y > 0 && self.superJump : step.rekka ? self.move === 'rekka' && self.rekka > script.stage
          : self.move === step.command && (script.prev[0] !== self.move || self.moveFrame < script.prev[1]);
        if (!started) {
          // The launcher's super-jump cancel aborts once the cancel window has passed on the ground.
          if (step.superJump && self.y === 0 && !(self.move && self.connected && self.moveFrame < moveData(self).startup + moveData(self).active + CANCEL_WINDOW)) return cpuEnd(c);
          if (step.air && script.flew && self.y === 0 && !self.jumpSquat) return cpuEnd(c);
          if (!step.air && !step.superJump && (self.y > 0 || self.landLag)) script.since = now;
          if (!step.air && !step.superJump && now - script.since > (script.wait || step.tick || step.rekka ? 24 : 10)) return cpuEnd(c);
          return cpuIssue(c, script, step, name);
        }
        script.started = true; script.frame = self.moveFrame;
        if (step.superJump) { if (!cpuNext(c)) return cpuEnd(c); continue; }
        // Shots, the super and moves that never connect end the script once they are out.
        if (!data?.band && !step.rekka && !data?.grab && step.command !== 'throw') { cpuEnd(c); return {}; }
      }
      const current = step.rekka ? 'rekka' : step.command;
      if (self.move !== current || self.moveFrame < script.frame) return cpuEnd(c);
      script.frame = self.moveFrame;
      if (!self.connected) return {};
      const result = enemy.stun > 0 && enemy.blockStun ? 'block' : enemy.stun > 0 || enemy.launched || enemy.hp === 0 ? 'hit' : 'none';
      if (result === 'hit') {
        if (!cpuNext(c)) return cpuEnd(c);
        // Nothing on the ground follows a knockdown.
        if (enemy.launched && groundNormal(script.steps[script.at])) return cpuEnd(c);
        continue;
      }
      if (result === 'none') return cpuEnd(c);
      script.blocked++;
      if (script.blocked < 2 && script.at + 1 < script.steps.length && groundNormal(script.steps[script.at + 1])) { cpuNext(c); script.wait = script.trap; continue; }
      if (level < 6) return cpuEnd(c);
      // From level 6 a blocked string ends in a tick throw up close, or a shot cancel when the slide leaves it safe.
      const after = Math.abs(cpuPredict(enemy, 14).x - self.x);
      const finish = after >= 140 && memory.tokens >= 1 && !cpuOwnShot(c) ? styleOf(self).qcf : after < 120 && ['punch', 'kick'].includes(self.move) ? 'tick' : null;
      if (!finish) return cpuEnd(c);
      script.steps.splice(script.at + 1, script.steps.length, finish); cpuNext(c);
    }
    return {};
  }
  // The input that presses a script step this frame ({} while it waits for its moment).
  function cpuIssue(c, script, step, name) {
    const { self, enemy, now } = c;
    // The launcher's super jump only when an air jab from it can still meet the floating victim (an anti-air launch from
    // high up floats out of reach), judged once.
    if (step.superJump) {
      script.reach ??= cpuSuperJumpReaches(c);
      if (!script.reach) { cpuEnd(c); return {}; }
      return { jump: true, [c.toward]: true };
    }
    if (step.rekka) return self.lastInput.punch || !self.connected ? {} : { punch: true };
    if (step.tick) {
      if (self.move || enemy.stun > 0 || enemy.y > 0) return {};
      return c.distance > MOVES.throw.reach - 10 ? { [c.toward]: true } : { command: 'throw', [c.toward]: true };
    }
    if (step.air) {
      if (self.y <= 0) return {};
      if (self.move) return { command: step.command };
      return cpuAirTiming(c, cpuData(name)) ? { command: step.command } : {};
    }
    // A special or the super after the opener only ever cancels a move that connected.
    if (script.at > 0 && !groundNormal(name) && !step.tick && !(self.move && self.connected)) { cpuEnd(c); return {}; }
    if (self.y > 0 || self.landLag) return {};
    // A frame trap lets the blocked move recover and waits a beat before the next strike.
    if (script.wait) { if (self.move) { script.since = now; return {}; } if (now - script.since < script.gap) return {}; }
    if (groundNormal(name) && script.at > 0) {
      const facing = self.move ? self.facing : c.side;
      if (!cpuConnects(self, enemy, cpuData(name), facing)) {
        // Out of reach: skip ahead to a later normal that reaches (chains only go up-rank), or to the ender.
        let j = script.at + 1;
        while (j < script.steps.length && groundNormal(script.steps[j]) && !cpuConnects(self, enemy, cpuData(script.steps[j]), facing)) j++;
        if (j >= script.steps.length || cpuStep(script.steps[j]).air || script.steps[j] === 'sj') { cpuEnd(c); return {}; }
        script.steps.splice(script.at, j - script.at);
        return cpuScript(c) || {};
      }
    }
    return { command: step.command, down: !!step.crouch };
  }
  // Whether the launcher's super-jump cancel, taken on the first free frame, lets an air jab meet the floating victim
  // before it leaves juggle reach: the jump as superJumpCancel aims it, against the victim's float (see cpuBody).
  function cpuSuperJumpReaches(c) {
    const { self, enemy } = c, data = cpuData('j.A');
    const jumper = { ...self, y: 1, vy: JUMPS.super.vy * styleOf(self).jump, launched: false, floating: false,
      airVX: clamp((enemy.x - self.x) / SUPER_JUMP_AIM, -SUPER_JUMP_MAX, SUPER_JUMP_MAX) };
    for (let delay = 0; delay < 30; delay++) if (cpuConnects(jumper, enemy, data, self.facing, false, delay)) return true;
    return false;
  }
  // The punish for an opponent recovering from a move: the super when its beam lands in time, else the fastest normal
  // that reaches the body or the extended limb before the move ends, then its confirm route.
  function cpuPunish(c, left) {
    const { self, enemy, level } = c;
    if (level >= 3 && cpuSupers(c)) {
      const travel = Math.max(0, Math.ceil((c.distance - 55 - BEAM_BOX[0] / 2 - HALF_BODY) / 11));
      if (left > MOVES.super.startup + travel + 1 && (c.distance > 150 || random(c.state) < .4)) return ['super'];
    }
    for (const name of CPU_OPENERS) {
      const data = cpuData(name);
      if (left >= data.startup + 1 && cpuConnects(self, enemy, data, c.side, true)) return cpuRoute(c, name);
    }
    return null;
  }
  // Whether an air normal pressed now lands at the right moment: as soon as it connects against an airborne opponent,
  // as late as it still connects (within two frames) against a grounded one, so the hit is deep enough to confirm.
  function cpuAirTiming(c, data) {
    const { self, enemy } = c;
    if (!cpuConnects(self, enemy, data, self.facing)) return false;
    if (enemy.y > 0) return true;
    // Rising at a grounded opponent: wait for the way down.
    if (self.vy > 0) return false;
    return !cpuConnects(self, enemy, data, self.facing, false, 2);
  }
  // Frames until an airborne fighter lands on its arc.
  function cpuLanding(f) { let t = 0; while (t < 90 && cpuPredict(f, t).y > 0) t++; return t; }
  // The earliest frame from now at which a forward jump clears the shot, taken in the middle of its window (-1: none).
  function cpuJumpTime(c, p) {
    let first = -1, last = -1;
    for (let k = 0; k <= 40; k++) {
      if (cpuClears(c.self, p, -p.facing, k)) { if (first < 0) first = k; last = k; } else if (first >= 0) break;
    }
    return first < 0 ? -1 : c.now + Math.floor((first + last) / 2);
  }
  function cpuJump(c, dir) {
    const key = dir > 0 ? 'right' : 'left';
    c.memory.plan = Array.from({ length: JUMP_SQUAT }, () => ({ jump: true, [key]: true }));
    return { jump: true, [key]: true };
  }
  function cpuInput(state, slot) {
    const self = state.fighters[slot], enemy = state.fighters[1 - slot];
    let memory = state.cpuMemory[slot];
    if (!memory || !memory.rolls) memory = state.cpuMemory[slot] = cpuMemory();
    const level = cpuLevelOf(state, slot), now = state.motionFrame, side = enemy.x >= self.x ? 1 : -1;
    const c = { state, slot, self, enemy, memory, level, now, side, distance: Math.abs(enemy.x - self.x), toward: side > 0 ? 'right' : 'left', away: side > 0 ? 'left' : 'right',
      reaction: Math.max(2, 14 - 1.5 * level), pBlock: Math.min(.98, .08 + .09 * level) };
    // Bookkeeping. The first decision of a round waits out the reaction time.
    if (!memory.started) { memory.started = true; memory.next = now + c.reaction; memory.contact = now; }
    // The last exchange (either fighter in hitstun or blockstun), so a stand-off can be broken.
    if (self.stun > 0 || enemy.stun > 0) memory.contact = now;
    memory.tokens = Math.min(CPU_TOKEN_CAP, memory.tokens + CPU_SPECIALS / 3600);
    const foe = memory.foe;
    if (enemy.move && (enemy.move !== foe.move || enemy.moveFrame < foe.frame)) foe.id++;
    foe.move = enemy.move; foe.frame = enemy.moveFrame;
    const jumping = !enemy.launched && !enemy.airTech && enemy.move !== 'rising' && !(enemy.stun > 0 && !enemy.blockStun) && (enemy.jumpSquat > 0 || enemy.y > 0);
    if (jumping && !memory.jump.on) { memory.jump.id++; memory.jump.at = now; }
    memory.jump.on = jumping;
    // The opponent's last sign of aggression: a move (not a taunt), a jump, a run or a step forward.
    if (enemy.move && enemy.move !== 'taunt' || jumping || enemy.running || enemy.vx * side < 0) memory.foeActive = now;
    // Strings of the CPU's that the opponent blocked, cleared once the opponent is hit: a guard to open up.
    const foeBlocking = enemy.stun > 0 && enemy.blockStun;
    if (foeBlocking && !memory.foeBlockOn) memory.walled = Math.min(4, memory.walled + 1);
    if (enemy.stun > 0 && !enemy.blockStun || enemy.launched) memory.walled = 0;
    memory.foeBlockOn = foeBlocking;
    // Each special started spends a token (a rhythm-rush follow-up continues the same special).
    if (self.move && self.move !== memory.own && MOVES[self.move]?.rank === 3) memory.tokens -= 1;
    memory.own = self.move;
    const hurt = self.stun > 0 && !self.blockStun || self.launched, guarding = self.stun > 0 && self.blockStun;
    if (hurt && !memory.hurtOn) { memory.hurt++; memory.pressure = 0; }
    // Blocked spells that follow each other within a second are sustained pressure.
    if (guarding && !memory.guardOn) { memory.guarded++; memory.pressure = now - memory.blockEnd <= 60 ? memory.pressure + 1 : 1; }
    // As a spell of hitstun, knockdown or blockstun ends the next attack is likely: guard it with the per-threat chance.
    if (!hurt && memory.hurtOn && cpuRoll(c, 'afterHurt', memory.hurt, c.pBlock)) memory.guardUntil = Math.max(memory.guardUntil, now + Math.min(60, 2 + 2 * level * level));
    if (!guarding && memory.guardOn) {
      memory.blockEnd = now;
      // From level 3 sustained pressure is answered (judged once per spell): the next opening within 40 frames is
      // taken instead of guarding again, so safe pressure such as mashed jabs cannot keep the CPU blocking for ever.
      if (memory.pressure >= 2 && level >= 3 && cpuRoll(c, 'answer', memory.guarded, Math.min(.6, .06 * level))) { memory.answer = now + 40; memory.guardUntil = -1; }
      else if (cpuRoll(c, 'afterBlock', memory.guarded, c.pBlock)) memory.guardUntil = Math.max(memory.guardUntil, now + Math.min(60, 2 + 2 * level * level));
    }
    memory.hurtOn = hurt; memory.guardOn = guarding;
    const chance = p => random(state) < p;
    if (self.dizzy) { memory.script = null; memory.plan = []; const input = {}; if (chance(.5)) input[chance(.5) ? 'punch' : 'kick'] = true; return input; }
    // Knocked down: a quick rise, judged once per knockdown.
    if (self.launched) {
      memory.script = null; memory.plan = [];
      return self.y > 0 && !self.hardKnockdown && !self.lastInput.punch && cpuRoll(c, 'rise', memory.hurt, .1 * level) ? { punch: true } : {};
    }
    // Throws: a level-scaled chance to escape, judged once per throw (the escape press has to come before it lands).
    if (enemy.move === 'throw' && enemy.moveFrame < MOVES.throw.startup && c.distance < MOVES.throw.reach + 12 && !self.lastInput.heavy && cpuRoll(c, 'tech', foe.id, Math.min(.9, .05 + .1 * level))) return { heavy: true };
    // Hitstun: hold a guard for whatever follows, judged once per spell.
    if (hurt) { memory.script = null; memory.plan = []; return cpuRoll(c, 'hurtGuard', memory.hurt, c.pBlock) ? cpuGuard(c) : {}; }
    // Blockstun: keep guarding; from level 6 a stock buys a guard cancel, judged once per spell.
    if (guarding) {
      memory.script = null; memory.plan = [];
      if (level >= 6 && self.stocks > 0 && !self.lastInput.kick && cpuRoll(c, 'gc', memory.guarded, .2 + .05 * (level - 6))) return c.distance < 125 ? { kick: true, heavy: true } : { punch: true, kick: true };
      return cpuGuard(c);
    }
    // A committed sequence (a jump's squat, a dash's taps), then a script under way. A hitstop frame does not simulate,
    // so it holds the sequence's current input without using it up.
    if (memory.plan.length) return state.hitstop > 0 ? { ...memory.plan[0] } : memory.plan.shift();
    if (memory.script) { const input = cpuScript(c); if (input) return input; }
    // In the air without a script (over a shot, say): strike on the way down when it reaches, judged once per jump.
    if (self.y > 0) {
      if (!memory.airOn) { memory.airOn = true; memory.air++; }
      if (!self.move && !self.airTech && !enemy.launched) {
        const name = c.distance > 110 ? 'j.S' : 'j.D';
        if (cpuAirTiming(c, cpuData(name)) && cpuRoll(c, 'air', memory.air, .2 + .08 * level)) return cpuBegin(c, cpuRoute(c, 'jump').map((s, i) => i ? s : name));
      }
      return {};
    }
    memory.airOn = false;
    const free = c.free = !self.move && !self.stun && !self.jumpSquat && !self.landLag && !self.dash;
    // Shots: a forward jump timed to clear them (judged once per shot), else a guard.
    const shot = state.projectiles.filter(p => p.owner !== slot && p.life > 0 && (self.x - p.x) * p.facing > 0).sort((a, b) => Math.abs(self.x - a.x) - Math.abs(self.x - b.x))[0];
    if (shot && free) {
      const key = Math.round((shot.from ?? 0) * 10) + ':' + (shot.life + now) + ':' + shot.kind, gap = Math.abs(self.x - shot.x);
      if (gap < 560 && level >= 2 && cpuRoll(c, 'shotJump', key, .25 + .08 * level)) {
        if (memory.shot?.key !== key) memory.shot = { key, at: cpuJumpTime(c, shot) };
        if (memory.shot.at >= 0 && now >= memory.shot.at && cpuClears(self, shot, -shot.facing, 0)) return cpuJump(c, -shot.facing);
        if (memory.shot.at >= 0 && now < memory.shot.at) return {};
      }
      if (gap < 200 && cpuRoll(c, 'shotGuard', key, c.pBlock)) return { [c.away]: true };
    }
    // Anti-air: an opponent jumping in (seen) within 190 draws the rising strike (from level 3), a heavy punch or a launcher.
    const jump = memory.jump;
    if (jump.on && enemy.y > 0 && now - jump.at >= c.reaction && c.distance < 190 && (enemy.airVX * side < 0 || c.distance < 110)) {
      if (free && cpuRoll(c, 'antiAir', jump.id, Math.min(.95, .1 + .1 * level))) {
        // The rising strike leaves a token for a confirm's ender.
        const options = (level >= 3 && memory.tokens >= 1.6 ? ['rising'] : []).concat(['5D', '2D']);
        for (const name of options) if (cpuConnects(self, enemy, cpuData(name), side)) return cpuBegin(c, name === '2D' ? cpuRoute(c, '2D').filter(s => s !== 'ender') : [name]);
        return cpuRoll(c, 'airGuard', jump.id, c.pBlock) ? { [c.away]: true } : {};
      }
      if (cpuCanGuard(self) && cpuRoll(c, 'airGuard', jump.id, c.pBlock)) return { [c.away]: true };
    }
    // Punish: an opponent recovering from a move (seen), whiffed or blocked, judged once per move.
    const foeData = enemy.move && moveData(enemy);
    if (foeData && free && (enemy.y === 0 || enemy.move === 'rising') && enemy.moveVariant !== 'air' && enemy.moveFrame >= c.reaction && enemy.moveFrame >= foeData.startup + foeData.active && !enemy.invulnerable) {
      const end = foeData.startup + foeData.active + foeData.recovery, left = Math.max(end - enemy.moveFrame, enemy.y > 0 ? cpuLanding(enemy) : 0);
      if (left > 1 && cpuRoll(c, 'punish', foe.id, Math.min(.95, .15 + .12 * level))) { const route = cpuPunish(c, left); if (route) return cpuBegin(c, route); }
    }
    // An answer to sustained pressure takes the next opening (see cpuAnswer).
    if (now < memory.answer && free && enemy.y === 0) { const answer = cpuAnswer(c); if (answer) { memory.answer = -1; return answer; } }
    // A strike seen coming is blocked at its height with the per-threat chance.
    if (foeData?.band && enemy.moveFrame >= c.reaction && enemy.moveFrame < foeData.startup + foeData.active && cpuCanGuard(self)
      && c.distance < reachOf(enemy, foeData) + 60 + (foeData.speed || 0) * (foeData.startup + foeData.active - enemy.moveFrame) && cpuRoll(c, 'block', foe.id, c.pBlock)) {
      memory.guardUntil = Math.max(memory.guardUntil, now + foeData.startup + foeData.active - enemy.moveFrame + 2);
    }
    // Wake-up pressure: close in on an opponent lying down, then time a string (or a throw) to meet its first
    // vulnerable frame as it gets up.
    if (enemy.launched && enemy.y === 0) { memory.wake = true; memory.guardUntil = -1; }
    else if (memory.wake && (enemy.launched || enemy.move || !enemy.invulnerable)) memory.wake = false;
    if (memory.wake && free) {
      if (enemy.launched) return c.distance > 92 ? { [c.toward]: true } : {};
      if (enemy.invulnerable <= 4 && c.distance <= 96) {
        memory.wake = false;
        const r = random(state);
        if (r < .25 && enemy.invulnerable <= 1 && c.distance < MOVES.throw.reach - 8) return cpuBegin(c, ['throw']);
        return cpuBegin(c, cpuRoute(c, r < .8 ? '5A' : '2A'));
      }
      return {};
    }
    if (now < memory.guardUntil && cpuCanGuard(self)) return cpuGuard(c);
    if (now < memory.next || !free) return cpuActivity(c);
    return cpuDecide(c);
  }
  // The answer to sustained pressure: from level 5 an invulnerable rising strike through a strike seen coming; otherwise,
  // once the opponent stands free in reach, a throw up close or a jab and its confirm (null: no opening yet).
  function cpuAnswer(c) {
    const { self, enemy, memory, level, distance } = c, data = enemy.move && moveData(enemy);
    if (data?.band && enemy.moveFrame < data.startup + data.active) {
      return level >= 5 && memory.tokens >= 1 && enemy.moveFrame >= c.reaction && cpuConnects(self, enemy, MOVES.rising, c.side) ? cpuBegin(c, ['rising']) : null;
    }
    if (enemy.move || enemy.stun || enemy.jumpSquat || enemy.invulnerable) return null;
    if (distance < MOVES.throw.reach - 8) return cpuBegin(c, ['throw']);
    return cpuConnects(self, enemy, cpuData('5A'), c.side) ? cpuBegin(c, cpuRoute(c, '5A')) : null;
  }
  // The neutral activity until the next decision: a walk toward a target distance, or standing still.
  function cpuActivity(c) {
    const act = c.memory.act;
    if (!act || act.kind !== 'walk') return {};
    if (act.dir > 0 ? c.distance <= act.stop : c.distance >= act.stop) { c.memory.act = null; return c.free ? cpuDecide(c) : {}; }
    return { [act.dir > 0 ? c.toward : c.away]: true };
  }
  // A neutral decision, around the style's preferred distance: guard a threat with the per-threat chance; supers in
  // desperation or to finish; a taunt with a 30 % lead at range; otherwise pressure up close (jab and crouching-jab
  // strings, throws, sweeps, frame traps), pokes and walk-ins in poke range, jump-ins, dashes and shots from further out.
  function cpuDecide(c) {
    const { state, self, enemy, memory, level, distance, now } = c, style = styleOf(self), coin = () => random(state);
    // The style's distance, or CPU_APPROACH to break a stand-off: five seconds without an exchange (two against a quiet
    // opponent), or the last twenty seconds of a round with the CPU level or behind on life.
    const quiet = now - memory.foeActive > CPU_QUIET;
    const stall = now - memory.contact > (quiet ? 120 : 300) || state.options.roundTime && state.time < 1200 && self.hp <= enemy.hp;
    const spacing = self.boss ? CPU_SPACING.boss : CPU_SPACING[self.style] || CPU_SPACING.balanced, preferred = stall ? Math.min(spacing, CPU_APPROACH) : spacing;
    memory.next = now + Math.max(4, Math.round(24 - 2 * level + coin() * 10));
    memory.act = null;
    const lying = enemy.launched || down(enemy), reeling = enemy.stun > 0 && !enemy.blockStun;
    const walk = (dir, stop) => { memory.act = { kind: 'walk', dir, stop }; return { [dir > 0 ? c.toward : c.away]: true }; };
    // A backstep: two taps away from the opponent.
    const backstep = () => { memory.plan = [{ [c.away]: true }, {}, { [c.away]: true }]; return {}; };
    if (lying) return distance > 130 ? walk(1, 110) : {};
    // A ranged style backs off toward its distance (walking back guards as well).
    const ranged = preferred >= 240;
    if (ranged && !reeling && distance < preferred - 60 && coin() < .6) return level >= 3 && coin() < .4 ? backstep() : walk(-1, preferred);
    // A threat: an opponent in striking range that has been attacking or coming forward. Guard it with the per-threat
    // chance, for longer at higher levels.
    if (level >= 2 && !reeling && !quiet && distance < 175 && enemy.y === 0 && coin() < c.pBlock) { memory.guardUntil = memory.next = now + Math.round(Math.min(90, 3 * level * level) * (.75 + .5 * coin())); return cpuGuard(c); }
    // Never start an attack into a strike already seen coming.
    const foeData = enemy.move && moveData(enemy);
    if (foeData?.band && enemy.moveFrame >= c.reaction && enemy.moveFrame < foeData.startup + foeData.active && distance < reachOf(enemy, foeData) + 40) { memory.next = now + 2; return {}; }
    if (self.stocks >= SUPER_STOCKS && level >= 2 && distance < 380 && (desperate(self) || enemy.hp <= 90) && coin() < .1 + .03 * level) return cpuBegin(c, ['super']);
    if (distance > 320 && self.hp - enemy.hp >= .3 * MAX_HP && level >= 2 && !enemy.move && !self.lastInput.taunt && coin() < .35) return { taunt: true };
    const options = [], add = (weight, act) => { if (weight > 0) options.push([weight, act]); };
    const reaches = name => cpuConnects(self, enemy, cpuData(name), c.side);
    const tokens = memory.tokens, shotFree = !cpuOwnShot(c);
    if (distance <= 105) {
      if (reaches('5A')) add(ranged ? 1 : 4, () => cpuBegin(c, cpuRoute(c, '5A')));
      if (reaches('2A')) add(ranged ? .5 : 1.5, () => cpuBegin(c, cpuRoute(c, '2A')));
      if (level >= 3 && reaches('5A')) add(1, () => cpuBegin(c, cpuRoute(c, '5A'), { trap: true, gap: 1 + Math.floor(coin() * 3) }));
      // Strings the opponent keeps blocking make throws (and against a standing guard the sweep) likelier.
      if (distance < MOVES.throw.reach - 8 && enemy.y === 0 && !enemy.stun && !enemy.invulnerable) add(1 + memory.walled / 2, () => cpuBegin(c, ['throw']));
      if (style.qcb === 'commandGrab' && tokens >= 1 && distance < MOVES.commandGrab.reach - 8) add(1.5 + memory.walled / 4, () => cpuBegin(c, ['commandGrab']));
      if (reaches('2S')) add(.3 + (enemy.crouching ? 0 : .25 * memory.walled), () => cpuBegin(c, ['2S']));
      if (ranged) { add(3, () => walk(-1, preferred - 40)); if (level >= 3) add(1.5, backstep); }
    } else if (distance <= 160) {
      if (reaches('5S')) add(1.2, () => cpuBegin(c, cpuRoute(c, '5S')));
      if (reaches('6S')) add(1, () => cpuBegin(c, cpuRoute(c, '6S')));
      if (reaches('2S')) add(.3, () => cpuBegin(c, ['2S']));
      if (reaches('5D')) add(.4, () => cpuBegin(c, cpuRoute(c, '5D')));
      // Space control: a poke just out of reach catches an opponent walking in, and gives a whiff to punish otherwise.
      if (!reaches('5S') && distance < 170) add(2.4, () => cpuBegin(c, [coin() < .75 ? '6S' : '5S']));
      if (['rush', 'armorRush', 'rekka'].includes(style.qcb) && tokens >= 2) add(.25, () => cpuBegin(c, style.qcb === 'rekka' ? ['rekka', 'rk', 'rk'] : [style.qcb]));
      add(ranged ? .5 : 4, () => walk(1, 78));
      if (ranged) { add(3, () => walk(-1, preferred - 40)); if (level >= 3) add(1, backstep); }
    } else {
      // Jump-ins, likelier against a crouching guard that keeps blocking.
      if (distance >= 150 && distance <= 270) add(.15 + .06 * level + (enemy.crouching ? .2 * memory.walled : 0), () => { cpuBegin(c, cpuRoute(c, 'jump')); return cpuJump(c, c.side); });
      if (distance > preferred + 30) add(3, () => walk(1, Math.max(preferred - 20, 90)));
      if (level >= 4 && distance > preferred + 100) add(2, () => { memory.plan = [{ [c.toward]: true }, {}, { [c.toward]: true }]; memory.act = { kind: 'walk', dir: 1, stop: 100 }; return {}; });
      if (tokens >= 2 && shotFree && distance > 230) add(style.qcf && self.style === 'zoner' ? 4 : 1, () => cpuBegin(c, [coin() < .5 ? 'special' : style.qcf]));
      if (style.qcb === 'teleport' && tokens >= 2 && distance > 200) add(.5, () => cpuBegin(c, ['teleport']));
      if (distance < preferred - 30) add(2.5, () => walk(-1, preferred));
      add(1.5, () => distance > preferred + 30 ? walk(1, Math.max(preferred, distance - 60)) : {});
    }
    if (!options.length) return {};
    let pick = coin() * options.reduce((sum, [weight]) => sum + weight, 0);
    for (const [weight, act] of options) { pick -= weight; if (pick <= 0) return act() || {}; }
    return options[options.length - 1][1]() || {};
  }
  function intro(state) {
    const target = state.options.roundsToWin;
    const final = target > 1 && state.fighters.every(f => f.wins === target - 1);
    state.phase = 'intro'; state.phaseFrames = 90; state.message = final ? 'FINAL ROUND' : 'ROUND ' + state.round; state.finalRound = final;
  }
  function resetRound(state) {
    // Wins, power stocks and the partial bar carry into the next round, as in KOF.
    state.fighters = state.fighters.map((old, slot) => Object.assign(fighter(old.id, slot, { style: old.style, boss: old.boss, reaches: old.reaches }), { wins: old.wins, energy: old.energy, stocks: old.stocks }));
    state.projectiles = []; state.effects = []; state.time = state.options.roundTime * 60; state.round++;
    state.winner = null; state.hitstop = 0; state.slowMotion = 0; state.firstHit = false; state.result = null;
    // The CPU's memory starts afresh; only its special budget carries over, as the power gauge does, so the limit of
    // CPU_SPECIALS a minute holds across a round change.
    state.cpuMemory = state.cpuMemory.map(old => Object.assign(cpuMemory(), { tokens: Math.min(old?.tokens ?? 0, CPU_TOKEN_CAP) }));
    intro(state);
  }
  function startMove(state, f, action, input, { rapid = false, chained = false } = {}) {
    const variant = variantOf(f, action, input);
    const data = MOVES[action];
    f.move = action; f.moveFrame = 0; f.hitDone = false; f.connected = false; f.hitConfirmed = false; f.guard = false; f.dash = 0; f.running = false; f.skid = 0;
    f.moveVariant = variant;
    // An attack in the air earns the landing lag, and an air normal uses its rank for the rest of the jump.
    if (f.y > 0) f.airActed = true;
    if (variant === 'air') (f.airRanks ||= []).push(VARIANTS.air[action].rank);
    // Rapid-fire chains count consecutive rank-0 cancels; any other start resets the count.
    f.rapid = rapid ? (f.rapid || 0) + 1 : 0;
    // A move uses up the presses it came from. A plain button (and the roundhouse or throw it makes) uses its own
    // press and those made up to PRESS_WINDOW frames after it, so a later press stays buffered for the next step of
    // a chain; chords, motions and system moves use every buffered press.
    const button = PRESS_OF[action], until = button && f.buffer[button] > 0 ? f.pressAt[button] + PRESS_WINDOW : Infinity;
    for (const key of [...ATTACKS, 'taunt']) if (f.pressAt[key] <= until) f.buffer[key] = 0;
    f.motions = [];
    // A move's own movement replaces a pushback slide still running (a guard cancel out of blockstun, say).
    f.slide = 0; f.slideWall = false;
    spendEnergy(f, data.cost || 0);
    if (data.stocks) { f.stocks = Math.max(0, f.stocks - data.stocks); f.stockFlash = 0; }
    // Starting a special builds a little meter (a rekka follow-up continues the same special).
    if (data.rank === 3 && !chained) gainEnergy(f, METER.special);
    f.invulnerable = Math.max(f.invulnerable, data.invulnerable || 0);
    f.armor = data.armor || 0;
    if (action === 'rekka') f.rekka = 1;
    if (action === 'roll' || action === 'gcRoll') f.rollDir = (input[f.facing === 1 ? 'left' : 'right'] ? -1 : 1) * f.facing;
    if (PROJECTILE_MOVES.has(action)) emit(state, 'powerup', f.x, GROUND - f.y - 100, f.facing, 32);
    if (action === 'super') {
      // Cinematic freeze: the whole fight stops while the cut-in plays.
      f.superDesperate = desperate(f);
      state.hitstop = Math.max(state.hitstop, 36);
      emit(state, 'super', f.x, GROUND - 110, f.facing, 36, { slot: f.slot, desperation: f.superDesperate });
    }
    if (action === 'gcRoll' || action === 'gcBlowback') banner(state, f.slot, 'GUARD CANCEL');
  }
  // from: the shooter's centre when it fired. A projectile only hits a target whose centre is not behind that point, so
  // the double ball's second ball, which starts behind its shooter, never hits an opponent standing behind it.
  function launchProjectiles(state, f, slot, move) {
    const shot = move.projectile || {};
    if (f.move === 'super') {
      state.projectiles.push({ owner: slot, x: f.x + f.facing * 55, y: f.y + 105, from: f.x, facing: f.facing, damage: move.damage, life: 150, super: true,
        hits: move.hits, cooldown: 0, speed: 11, kind: 'super', desperation: !!f.superDesperate });
      return;
    }
    for (let i = 0; i < (shot.count || 1); i++) {
      state.projectiles.push({ owner: slot, x: f.x + f.facing * (55 - i * (shot.gap || 0)), y: f.y + 105, from: f.x, facing: f.facing, damage: move.damage,
        life: shot.life || 150, hits: 1, cooldown: 0, speed: shot.speed || 8, rise: shot.rise || 0, kind: f.move });
    }
  }
  // The launcher's super-jump cancel: it leaves the ground at once (no squat) at a super jump's vertical speed, aimed at
  // the victim where it stood when the frame began (victimX), so either slot aims the same way. The air normals that
  // follow use their ranks for this jump. Like a super jump's takeoff it emits 'superjump' (the dust ring; the animation
  // layer trails the jump while superJump is set).
  function superJumpCancel(state, f, victimX, style) {
    f.move = null; f.moveFrame = 0; f.connected = false; f.hitConfirmed = false; f.armor = 0;
    f.buffer.jump = 0; f.jumpSquat = 0; f.hop = false; f.running = false; f.dash = 0; f.superJump = true; f.airRanks = [];
    f.vy = JUMPS.super.vy * style.jump; f.y = 1; f.airVX = clamp((victimX - f.x) / SUPER_JUMP_AIM, -SUPER_JUMP_MAX, SUPER_JUMP_MAX); f.landFrames = 0;
    f.pose = 'jump';
    emit(state, 'superjump', f.x, GROUND, f.facing, 20, { slot: f.slot });
  }
  // Gravity this frame: a floating launch victim falls at LAUNCH_GRAVITY of it.
  const gravity = f => GRAVITY * (f.floating ? LAUNCH_GRAVITY : 1);
  // Rounds continue to settle bodies after a KO so nobody freezes mid-air or mid-slide.
  function settle(f) {
    f.vx = 0;
    if (f.y > 0 || f.vy > 0) {
      f.y += f.vy; f.vy -= gravity(f);
      if (f.y <= 0) { f.y = 0; f.vy = 0; f.airVX = 0; f.landFrames = 6; f.airActed = false; f.airTech = false; f.superJump = false; f.floating = false; f.juggled = false; f.airRanks = []; }
    }
    return slideStep(f);
  }
  function finishRound(state) {
    const [a, b] = state.fighters;
    const kind = a.hp === 0 && b.hp === 0 ? 'doubleko' : a.hp === 0 || b.hp === 0 ? 'ko' : 'time';
    state.winner = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
    if (state.winner !== null) state.fighters[state.winner].wins++; else state.draws++;
    const perfect = state.winner !== null && state.fighters[state.winner].hp === MAX_HP;
    state.result = { winner: state.winner, kind, perfect, time: Math.ceil(state.time / 60), hp: state.fighters.map(f => f.hp) };
    state.phase = 'roundover'; state.phaseFrames = 170;
    state.message = kind === 'doubleko' ? 'DOUBLE K.O.' : kind === 'ko' ? 'K.O.' : 'TIME OVER';
    if (kind === 'ko') { state.hitstop = Math.max(state.hitstop, 24); state.slowMotion = SLOW_MOTION; }
    state.fighters.forEach(f => { f.move = null; f.dash = 0; f.running = false; f.jumpSquat = 0; f.dizzy = 0; f.pose = f.hp === 0 ? 'tumble' : f.pose; });
    emit(state, 'ko', WIDTH / 2, 250, 1, 100, { kind });
  }
  function tick(state, inputs = [{}, {}]) {
    if (state.phase === 'matchover') return state;
    state.frame++;
    state.effects.forEach(e => e.life--); state.effects = state.effects.filter(e => e.life > 0);
    if (state.phase === 'intro') {
      state.motionFrame++;
      if (--state.phaseFrames <= 0) { state.phase = 'fight'; state.message = ''; }
      return state;
    }
    if (state.phase === 'roundover') {
      if (state.hitstop > 0) { state.hitstop--; return state; }
      // K.O. slow motion: through SLOW_MOTION ticks after the freeze the bodies and the animation clock move on every
      // other tick. The round-over timer below keeps its pace, so the round still ends on the same tick.
      const still = state.slowMotion > 0 && state.slowMotion-- % 2 === 1;
      if (!still) {
        state.motionFrame++;
        state.fighters.forEach(f => wallThud(state, f, settle(f)));
      }
      // Poses resolve after bodies land: winner celebrates, a time-over loser kneels.
      if (state.phaseFrames === 110) {
        if (state.result?.perfect) state.message = 'PERFECT';
        else if (state.winner === null && state.result?.kind === 'time') state.message = 'DRAW GAME';
        state.fighters.forEach((f, i) => { f.pose = state.winner === i ? (state.round % 2 ? 'win' : 'win2') : f.hp === 0 ? 'down' : state.winner === null ? 'idle' : 'lose'; });
      }
      if (--state.phaseFrames <= 0) {
        const target = state.options.roundsToWin, maxRounds = target * 2 + 1;
        if (state.fighters.some(f => f.wins >= target) || state.round >= maxRounds) {
          state.phase = 'matchover';
          const [a, b] = state.fighters;
          state.winner = a.wins === b.wins ? null : a.wins > b.wins ? 0 : 1;
          state.message = state.winner === null ? 'DRAW GAME' : 'MATCH COMPLETE';
        } else resetRound(state);
      }
      return state;
    }
    // Only the engine's own CPU may request a move by name; remote inputs cannot.
    // Slot 1 follows state.cpu (set by servers and menus); slot 0 is CPU only in demo play.
    const controls = [0, 1].map(slot => (slot ? state.cpu : state.cpuSlots?.[0]) ? cpuInput(state, slot) : { ...(inputs[slot] || {}), command: undefined });
    state.fighters.forEach((f, slot) => {
      const input = controls[slot], digit = direction(input, f.facing);
      f.slot = slot;
      // A press stays buffered for INPUT_BUFFER simulated frames; its press frame (state.frame, which also runs during
      // hitstop) orders it against other presses and times chords and the throw escape.
      for (const action of Object.keys(f.buffer)) if (input[action] && !f.lastInput[action]) { f.buffer[action] = INPUT_BUFFER; f.pressAt[action] = state.frame; }
      // The direction held as S is pressed picks the light kick or the roundhouse (keypad digit, 6 = toward), and the one
      // held as F is pressed the one-button special.
      if (input.kick && !f.lastInput.kick) f.kickDir = digit;
      if (input.special && !f.lastInput.special) f.specialDir = digit;
      // A press of up within SUPER_JUMP_WINDOW frames of a down direction (held on this frame too) is a super jump.
      if (input.down) f.downAt = state.frame;
      if (input.jump && !f.lastInput.jump) f.superPress = state.frame - f.downAt <= SUPER_JUMP_WINDOW;
      // Two taps of the same direction within a short window run or backstep.
      for (const side of ['left', 'right']) if (input[side] && !f.lastInput[side]) {
        if (state.frame - f.taps[side] <= DASH_TAP && f.y === 0 && !input.down) f.dashRequest = side;
        f.taps[side] = state.frame;
      }
      // Mashing shakes off dizziness.
      if (f.dizzy > 0) for (const key of ['left', 'right', 'punch', 'kick', 'heavy', 'special']) if (input[key] && !f.lastInput[key]) f.dizzy = Math.max(1, f.dizzy - 4);
      const lastDigit = f.motions[f.motions.length - 1];
      if (!lastDigit || lastDigit[0] !== digit) { f.motions.push([digit, state.frame]); if (f.motions.length > 10) f.motions.shift(); }
      f.lastInput = { ...input, command: undefined };
    });
    // Keep presses made during impact freeze; their window counts playable frames.
    if (state.hitstop > 0) { state.hitstop--; return state; }
    state.motionFrame++;
    if (!state.options.training && state.options.roundTime) state.time--;
    // Read both guards before either fighter can connect a hit.
    state.fighters.forEach((f, slot) => {
      const other = state.fighters[1 - slot], input = controls[slot];
      // The stun each fighter starts the frame with. Its stun runs out during its own update, but it cannot act
      // until the next frame, so hits, blocks and throws on this frame are judged from this value for both slots.
      f.stunAtStart = f.stun; f.blockStunAtStart = f.blockStun && f.stun > 0;
      if (!f.move && !f.stun && !f.dash && !f.dizzy) f.facing = other.x >= f.x ? 1 : -1;
      f.crouching = !!input.down && f.y === 0;
      const upcomingStrike = ATTACKS.some(key => other.buffer[key] > 0 && meter(other) >= (MOVES[key].cost || 0));
      const nearbyStrike = Math.abs(other.x - f.x) < 180 && (other.move || upcomingStrike);
      const incomingShot = state.projectiles.some(p => p.owner !== slot && (f.x - p.x) * p.facing >= 0 && Math.abs(f.x - p.x) < 190);
      // Backward walking should animate as walking, not slide in the guard pose
      // when there is no attack nearby. Startup and existing projectiles count
      // as threats so blocking remains responsive on the contact frame.
      // No guard in the landing lag (landLag is the lag frames still to come).
      f.guard = !f.move && !f.stun && !f.dash && !f.dizzy && !f.running && !f.jumpSquat && !f.landLag && f.y === 0 && !!(nearbyStrike || incomingShot) && !!(f.facing === 1 ? input.left : input.right);
    });
    // Where each fighter stands as the frame begins, before either updates (the launcher's super jump aims at it).
    const strikes = [], startX = state.fighters.map(f => f.x);
    state.fighters.forEach((f, slot) => {
      const other = state.fighters[1 - slot], input = controls[slot], style = styleOf(f);
      f.vx = 0; f.hitAge++; f.landFrames = Math.max(0, f.landFrames - 1);
      if (f.stockFlash > 0) f.stockFlash--;
      if (f.invulnerable > 0) f.invulnerable--;
      if (f.y > 0 || f.vy > 0) {
        f.y += f.vy; f.vy -= gravity(f);
        if (f.launched && f.y > 0) {
          f.x = clamp(f.x - f.facing * (f.floating ? LAUNCH_DRIFT : KNOCKDOWN_DRIFT), WALL, WIDTH - WALL);
          // A launcher's victim that reaches its apex before anything juggles it falls out of juggle reach, so only a
          // cancel can follow a launch: the super jump, the rising strike or a rush (shots and beams pass under it).
          if (f.floating && !f.juggled && f.vy <= 0) f.juggle = JUGGLE_LIMIT;
        }
        // Air hitstun drifts at the speed the air reset gave (in a move or free, the code below carries airVX).
        else if (f.y > 0 && f.stun > 0 && !f.blockStun && f.airVX) { const previousX = f.x; f.x = clamp(f.x + f.airVX, WALL, WIDTH - WALL); f.vx = f.x - previousX; }
        // Any attack button during a tumble requests a quick recovery roll.
        if (f.launched && ATTACKS.some(a => f.buffer[a] > 0) && !f.hardKnockdown) f.quickRise = true;
        if (f.y <= 0) {
          f.y = 0; f.vy = 0; f.airVX = 0; f.landFrames = 6;
          // A jump that attacked or was hit lands with the landing lag, this frame the first of it; an empty one has none.
          if (f.airActed && !f.launched) f.landLag = LANDING_LAG;
          const teched = f.airTech;
          f.airActed = false; f.airTech = false; f.superJump = false; f.floating = false; f.juggled = false; f.airRanks = [];
          // An air tech ends its hitstun in the air, so the dizzy check that a ground recovery runs happens on landing.
          if (teched && !f.launched && f.hp > 0 && f.dizzyMeter >= DIZZY_LIMIT) { f.dizzy = DIZZY_FRAMES; f.dizzyMeter = 0; f.pose = 'dizzy'; emit(state, 'dizzy', f.x, GROUND - 220, f.facing, DIZZY_FRAMES); }
          if (f.launched) {
            f.juggle = 0;
            if (f.quickRise) { f.stun = 8; f.invulnerable = 12; f.dash = 8; f.dashDir = -f.facing; banner(state, slot, 'QUICK RISE'); }
            else f.stun = Math.max(f.stun, 24);
          }
          if (f.moveVariant === 'air' && NORMALS.includes(f.move)) { f.move = null; f.moveFrame = 0; }
          emit(state, 'dust', f.x, GROUND, f.facing, 12);
        }
      }
      if (f.dizzy > 0) {
        f.dizzy--; f.pose = 'dizzy';
        if (!f.dizzy) { f.dizzyMeter = 0; f.pose = 'idle'; }
        return;
      }
      if (f.stun > 0) {
        // A launched fighter stays helpless until landing, then lies down.
        if (!(f.launched && f.y > 0)) f.stun--;
        if (f.launched) f.pose = f.y > 0 ? 'tumble' : f.stun > 5 ? 'down' : 'getup';
        // Guard cancels spend a stock to escape blockstun.
        if (f.blockStun && f.stocks > 0 && f.y === 0 && f.stun > 0) {
          const gc = pressedTogether(f, 'punch', 'kick') ? 'gcRoll' : pressedTogether(f, 'kick', 'heavy') ? 'gcBlowback' : null;
          if (gc) { f.stun = 0; f.blockStun = false; startMove(state, f, gc, input); }
        }
        if (f.stun === 0 && !f.move) {
          if (f.launched) f.invulnerable = Math.max(f.invulnerable, 6);
          // Air hitstun that runs out before the landing ends in an air tech: invulnerable, then no attacks until landing.
          else if (f.y > 0 && !f.blockStun) { f.invulnerable = Math.max(f.invulnerable, AIR_TECH); f.airTech = true; }
          f.pose = 'idle'; f.launched = false; f.blockStun = false; f.counter = false; f.quickRise = false;
          // Accumulated dizzy damage stuns a fighter who recovers on the ground.
          if (f.dizzyMeter >= DIZZY_LIMIT && f.y === 0 && f.hp > 0) { f.dizzy = DIZZY_FRAMES; f.dizzyMeter = 0; f.pose = 'dizzy'; emit(state, 'dizzy', f.x, GROUND - 220, f.facing, DIZZY_FRAMES); }
        }
        if (!f.move) { f.dashRequest = null; if (f.dash > 0 && f.y === 0) { const previousX = f.x; f.x = clamp(f.x + f.dashDir * 8, WALL, WIDTH - WALL); f.vx = f.x - previousX; f.dash--; f.pose = 'roll'; } return; }
      }
      if (!f.stun && !f.launched) { f.neutralFrames++; f.dizzyMeter = Math.max(0, f.dizzyMeter - DIZZY_DRAIN); } else f.neutralFrames = 0;
      // Landing lag: no action (no walk, dash, jump or attack) until it runs out; presses stay buffered.
      if (f.landLag > 0 && !f.move) { f.dashRequest = null; f.pose = 'crouch'; return; }
      // Connected normals cancel inside the window, as in arcade fighters: up-rank into a stronger normal,
      // special or super, and rank-0 normals into each other up to twice in a row. Whiffs never cancel, nor do
      // sweeps and blowbacks; the launcher cancels only into specials, supers and, on hit, a super jump (up held or
      // pressed inside the window). In the air each normal can be used once per jump.
      if (f.move && f.connected) {
        const move = moveData(f);
        if (move.rank >= 0 && move.rank < 3 && !move.noCancel && f.moveFrame < move.startup + move.active + CANCEL_WINDOW) {
          if (move.superJumpCancel && f.hitConfirmed && f.y === 0 && (input.jump || f.buffer.jump > 0)) { superJumpCancel(state, f, startX[1 - slot], style); return; }
          const next = command(state, f, other, input, true), kind = next && cancelKind(f, move, next, input);
          if (kind) { f.move = null; f.connected = false; startMove(state, f, next, input, { rapid: kind === 'rapid' }); }
        }
      }
      // Rhythm rush chains: another attack press during recovery continues the rekka (F too, so a rush started with
      // → + F goes on with F).
      if (f.move === 'rekka' && f.rekka < MOVES.rekka.chain && f.moveFrame >= MOVES.rekka.startup + MOVES.rekka.active - 1 && ATTACKS.some(a => f.buffer[a] > 0)) {
        const stage = f.rekka + 1; f.move = null; startMove(state, f, 'rekka', input, { chained: true }); f.rekka = stage;
      }
      if (f.dashRequest && !f.move && f.y === 0 && !f.jumpSquat) {
        const forward = (f.dashRequest === 'right') === (f.facing === 1);
        if (forward) { f.running = true; f.skid = 0; }
        else { f.dash = 12; f.dashDir = f.dashRequest === 'right' ? 1 : -1; f.invulnerable = Math.max(f.invulnerable, 5); }
      }
      f.dashRequest = null;
      // Preserve jump momentum during airborne attack startup and recovery.
      if (f.move && f.y > 0 && f.airVX) {
        const previousX = f.x;
        f.x = clamp(f.x + f.airVX, WALL, WIDTH - WALL);
        f.vx = f.x - previousX;
      }
      if (f.dash > 0 && !f.move) {
        // Backsteps travel away from the opponent and can be cancelled into attacks.
        const t = 12 - f.dash, previousX = f.x;
        f.x = clamp(f.x + f.dashDir * 10 * (1 - t / 12), WALL, WIDTH - WALL);
        f.vx = f.x - previousX; f.dash--; f.pose = 'backstep';
        if (t < 6 || !ATTACKS.some(a => f.buffer[a] > 0)) return;
        f.dash = 0;
      }
      if (f.jumpSquat > 0 && !f.move) {
        // Four-frame jump squat: holding up makes a full jump, a tap makes a hop and a press of up just after down a super
        // jump (never a hop). The direction held on the last squat frame fixes the horizontal speed for the whole jump.
        f.jumpSquat--; f.pose = 'crouch';
        if (!input.jump) f.hop = true;
        if (!f.jumpSquat) {
          if (f.superJump) f.hop = false;
          const movement = (input.right ? 1 : 0) - (input.left ? 1 : 0), run = f.running ? 1.45 : 1, arc = f.superJump ? JUMPS.super : f.hop ? JUMPS.hop : JUMPS.full;
          f.vy = arc.vy * style.jump; f.y = 1; f.airVX = movement * AIR_SPEED * run * arc.vx; f.landFrames = 0; f.running = false;
          // A super jump's takeoff: the renderers raise a dust ring (the animation layer trails the jump itself).
          if (f.superJump) emit(state, 'superjump', f.x, GROUND, f.facing, 20, { slot });
        }
        return;
      }
      if (!f.move) {
        const movement = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const previousX = f.x, forwardHeld = movement === f.facing;
        if (f.running && (!forwardHeld || f.y > 0 || input.down)) { f.running = false; f.skid = f.y === 0 ? 5 : 0; }
        // In the air the takeoff speed carries on unchanged: a jump is committed.
        let speed = f.y > 0 ? f.airVX : f.guard ? 0 : movement * (movement === f.facing ? WALK_FORWARD : WALK_BACK) * style.walk;
        if (f.running) speed = f.facing * RUN_SPEED * style.walk;
        else if (f.skid > 0) { speed = f.facing * f.skid * .8; f.skid--; }
        f.x = clamp(f.x + (input.down && f.y === 0 && !f.running ? 0 : speed), WALL, WIDTH - WALL);
        f.vx = f.x - previousX;
        if (f.buffer.jump > 0 && f.y === 0) { f.jumpSquat = JUMP_SQUAT; f.hop = !input.jump; f.buffer.jump = 0; f.superJump = !!f.superPress; }
        f.pose = f.y > 0 ? 'jump' : f.jumpSquat ? 'crouch' : f.running ? (state.frame % 12 < 6 ? 'run' : 'run2') : input.down ? 'crouch' : f.guard ? 'block' : movement ? (state.frame % 20 < 10 ? 'walk' : 'walk2') : (state.frame % 48 < 24 ? 'idle' : 'stance2');
        // Motion specials, throws, supers and system moves need footing; F still fires in the air, but not after an air tech.
        const action = f.jumpSquat || f.airTech ? null : command(state, f, other, input);
        if (action && (f.y === 0 || ATTACKS.includes(action)) && f.stocks >= (MOVES[action]?.stocks || 0) && !airRankUsed(f, action, input)) startMove(state, f, action, input);
      }
      if (f.move) {
        const move = moveData(f); f.moveFrame++;
        f.pose = f.moveFrame < move.startup ? (f.moveVariant === 'crouch' ? 'crouch' : f.y > 0 ? 'jump' : f.move === 'super' ? 'powerup' : f.move === 'taunt' ? 'taunt' : 'stance2') : move.pose;
        if (move.speed && !['roll', 'gcRoll'].includes(f.move) && f.moveFrame < move.startup + move.active && !f.hitDone) {
          const previousX = f.x; f.x = clamp(f.x + f.facing * move.speed * (f.rekka === 3 ? 1.3 : 1), WALL, WIDTH - WALL); f.vx = f.x - previousX;
        }
        if (['roll', 'gcRoll'].includes(f.move) && f.moveFrame < 17) {
          const previousX = f.x; f.x = clamp(f.x + f.rollDir * move.speed, WALL, WIDTH - WALL); f.vx = f.x - previousX;
        }
        if (f.move === 'rising' && f.moveFrame === move.startup) { f.vy = 11; f.y = Math.max(1, f.y); f.airVX = f.facing * 1.5; }
        if (f.move === 'taunt' && f.moveFrame === 20) { spendEnergy(other, 15); emit(state, 'taunt', f.x, GROUND - 230, f.facing, 30); }
        if (f.move === 'teleport' && f.moveFrame === move.startup) {
          // Reappear just behind the opponent, inside the arena walls.
          const side = other.x >= f.x ? 1 : -1, target = clamp(other.x + side * 92, WALL, WIDTH - WALL);
          f.x = Math.abs(target - other.x) < 60 ? clamp(other.x - side * 92, WALL, WIDTH - WALL) : target; f.facing = other.x >= f.x ? 1 : -1;
          emit(state, 'dash', f.x, GROUND - 100, f.facing, 14);
        }
        if (f.moveFrame >= move.startup && f.moveFrame < move.startup + move.active && !f.hitDone) {
          if (PROJECTILE_MOVES.has(f.move)) { launchProjectiles(state, f, slot, move); f.hitDone = true; }
          else if (f.move === 'throw' || move.grab) {
            f.hitDone = true;
            const reachable = hittable(other) && other.y === 0 && Math.abs(other.x - f.x) < reachOf(f, move) && (move.grab || !other.stun && !other.stunAtStart);
            // Pressing heavy within seven frames of the throw escapes it, even if that press started an attack.
            if (reachable && f.move === 'throw' && (state.frame - other.pressAt.heavy <= 7 || pressedTogether(other, 'punch', 'kick'))) {
              // Pressing heavy as the throw lands escapes it.
              const side = other.x >= f.x ? 1 : -1;
              f.x = clamp(f.x - side * 34, WALL, WIDTH - WALL); other.x = clamp(other.x + side * 34, WALL, WIDTH - WALL);
              other.buffer.heavy = 0; other.move = null; banner(state, 1 - slot, 'THROW ESCAPE');
              emit(state, 'block', (f.x + other.x) / 2, GROUND - 130, f.facing);
            } else if (reachable) {
              // Backward throws swap sides before the toss; the victim turns to face the thrower, so it drifts away.
              if (f.move === 'throw' && input[f.facing === 1 ? 'left' : 'right']) { const x = f.x; f.x = other.x; other.x = x; f.facing *= -1; other.facing = -f.facing; }
              dealHit(state, other, f, move.damage, (f.x + other.x) / 2, f.facing, move);
              f.connected = true;
            }
          } else if (move.band) {
            // The strike as it stands on this frame, fixed before any contact resolves: in a trade the first hit clears the
            // other fighter's move, rekka stage and frames, which the second hit's stun and the rekka finisher depend on.
            const strike = { ...move, remaining: move.startup + move.active + move.recovery - f.moveFrame };
            if (f.move === 'rising') strike.reversal = true;
            if (f.move === 'rekka' && f.rekka === 3) Object.assign(strike, { damage: move.finish, knockdown: true });
            strikes.push({ source: f, target: other, move: strike, direction: f.facing });
          }
        }
        if (f.move === 'armorRush' && f.moveFrame >= move.startup + move.active) f.armor = 0;
        if (f.moveFrame >= move.startup + move.active + move.recovery && (f.move !== 'rising' || f.y === 0)) { f.move = null; f.armor = 0; f.rekka = 0; f.pose = 'idle'; }
      }
      // Consecutive frames standing in neutral; the animation layer restarts the breathing loop from it. Visual only.
      f.standFrames = !f.move && f.y === 0 && !f.stun && !f.dash && !f.running && !f.jumpSquat && !f.crouching && !f.dizzy && f.landFrames === 0 && Math.abs(f.vx) < .1 ? f.standFrames + 1 : 0;
    });
    // Pushback slides move both fighters in one pass after their own updates, so neither slot's decisions see the
    // other's slide earlier. A wall that stops a strike slide passes the stopped part to a grounded attacker.
    const slides = state.fighters.map(slideStep);
    slides.forEach((slide, slot) => {
      const other = state.fighters[1 - slot];
      if (slide.wall && other.y === 0) other.x = clamp(other.x - slide.wall, WALL, WIDTH - WALL);
      wallThud(state, state.fighters[slot], slide);
    });
    // Contact is rectangle overlap: the strike box against the target's body box or extended limb, for a target in
    // front of the attacker. Both fighters' contacts are found before either lands, so equal-timing attacks trade.
    const contacts = strikes.map(strike => ({ ...strike, at: hittable(strike.target) && (strike.target.x - strike.source.x) * strike.direction >= 0
      ? contactPoint(strikeBox(strike.source, strike.move), strike.target) : null })).filter(contact => contact.at);
    for (const { source, target, move, direction, at } of contacts) { source.hitConfirmed = dealHit(state, target, source, move.damage, at.x, direction, move, at.y) === 'hit'; source.hitDone = true; source.connected = true; }
    // The landing lag counts down once contacts have resolved, so a lag frame keeps its standing box; like stun, what is
    // left is the lag still to come.
    state.fighters.forEach(f => { for (const action of Object.keys(f.buffer)) f.buffer[action] = Math.max(0, f.buffer[action] - 1); if (f.landLag > 0) f.landLag--; });
    const [a, b] = state.fighters;
    state.projectiles.forEach(p => {
      // A shot a clash cancelled earlier this frame, on its rival's turn, neither moves nor hits.
      if (p.life <= 0) return;
      p.x += p.facing * (p.speed || 8); p.y += p.rise || 0; p.life--; p.cooldown = Math.max(0, (p.cooldown || 0) - 1);
      // Opposing projectiles whose boxes touch cancel; a super beam plows through a fireball.
      const rival = state.projectiles.find(q => q !== p && q.owner !== p.owner && q.life > 0 && overlaps(projectileBox(q), projectileBox(p)));
      if (rival && p.life > 0) {
        emit(state, 'block', (p.x + rival.x) / 2, GROUND - p.y, p.facing);
        if (!rival.super) rival.life = 0;
        if (!p.super) p.life = 0;
        if (p.life <= 0) return;
      }
      // A projectile's box hits the victim's body or extended limb, unless the victim is behind the point it was fired from.
      const victim = state.fighters[1 - p.owner], ahead = p.from === undefined || (victim.x - p.from) * p.facing >= 0;
      const at = !p.cooldown && ahead && hittable(victim) ? contactPoint(projectileBox(p), victim) : null;
      if (at) {
        // The beam's last hit knocks down out of juggle reach, so no normal or special can extend a landed super.
        const finalHit = p.super && p.hits <= 1;
        dealHit(state, victim, state.fighters[p.owner], p.damage, at.x, p.facing, Object.assign({ slide: p.super ? SUPER_SLIDE : PROJECTILE_SLIDE, desperation: !!p.desperation, superHit: !!p.super }, PROJECTILE,
          p.super ? { hitStun: 12, blockStun: 8 } : {}, finalHit ? { knockdown: true, endsCombo: true } : {}), at.y);
        p.hits--; p.cooldown = BEAM_GAP;
        // A super beam carries its victim so every hit of the barrage lands.
        if (p.super) p.x = victim.x - p.facing * 20;
        if (p.hits <= 0) p.life = 0;
      }
    });
    state.projectiles = state.projectiles.filter(p => p.life > 0 && p.x > -50 && p.x < WIDTH + 50 && p.y < 700);
    const passing = f => ['roll', 'gcRoll', 'teleport'].includes(f.move);
    if (Math.abs(a.x - b.x) < BODY_GAP && Math.abs(a.y - b.y) < 100 && !passing(a) && !passing(b)) {
      const left = a.x <= b.x ? a : b, right = left === a ? b : a;
      const correction = (BODY_GAP - (right.x - left.x)) / 2;
      left.x -= correction; right.x += correction;
      // Transfer pushback to the free fighter when the other is against a wall.
      if (left.x < WALL) { right.x += WALL - left.x; left.x = WALL; }
      if (right.x > WIDTH - WALL) { left.x -= right.x - (WIDTH - WALL); right.x = WIDTH - WALL; }
    }
    // Screen lock: neither fighter can walk the other off camera. The fighter
    // moving away (walking or sliding) is held; if both are, they share the correction.
    const gap = Math.abs(a.x - b.x) - MAX_DIST;
    if (gap > 0) {
      const left = a.x <= b.x ? a : b, right = left === a ? b : a, moved = f => f.vx + slides[state.fighters.indexOf(f)].moved;
      const leftAway = Math.max(0, -moved(left)), rightAway = Math.max(0, moved(right)), total = leftAway + rightAway;
      const leftShare = total ? leftAway / total : .5;
      left.x += gap * leftShare; right.x -= gap * (1 - leftShare);
    }
    if (state.options.training) {
      // Training restores health after each exchange and can keep meter full.
      state.fighters.forEach(f => {
        if (f.hp === 0) f.hp = 1;
        if (f.neutralFrames > 40 && f.hp < MAX_HP) { f.hp = MAX_HP; f.combo = 0; }
        if (state.options.trainingMeter === 'infinite') { f.stocks = STOCK_MAX; f.energy = BAR; }
      });
      return state;
    }
    if (a.hp === 0 || b.hp === 0 || (state.options.roundTime && state.time <= 0)) finishRound(state);
    return state;
  }
  // The collision rectangles of a fighter, [x, y-above-ground, width, height]: hurt the body box (null while it lies
  // down after a knockdown), hit the strike box during its active frames and limb the extended limb, out from the
  // strike's first active frame until the move ends. A throw or command grab shows its range to the opponent's
  // centre as hit, since throws keep the centre-distance rule. hittable says whether a hit can land on the body or
  // limb this frame (not while invulnerable, knocked out or launched at the juggle limit).
  function boxes(f) {
    const move = f.move && moveData(f), active = !!move && f.moveFrame >= move.startup && f.moveFrame < move.startup + move.active;
    let hit = null;
    if (active && move.band) hit = strikeBox(f, move);
    else if (active && move.reach && (f.move === 'throw' || move.grab)) {
      const reach = reachOf(f, move);
      hit = [f.facing === 1 ? f.x : f.x - reach, f.y + GRAB_BAND[0], reach, GRAB_BAND[1] - GRAB_BAND[0]];
    }
    return { hurt: hurtbox(f), hit, limb: limbOf(f), hittable: hittable(f) };
  }
  // Human-readable move list for menus, built from the fighter's style.
  function moveList(fighterData = {}) {
    const style = STYLES[fighterData.style] || STYLES.balanced, special = fighterData.specialMove?.name || 'Energy Shot';
    return [
      { name: special, input: '↓↘→ + attack, or F', note: (style.qcf === 'fastball' ? 'Fast short-range shot; F fires a slower standard shot' : style.qcf === 'doubleball' ? 'Twin projectile; F fires a single shot' : 'Projectile; F fires a lighter one-button version') + ' (F neutral, back or in the air)' },
      { name: style.names.dp, input: '→↓↘ + attack, or ↓ + F', note: 'Invulnerable rising strike' },
      { name: style.names.qcb, input: '↓↙← + attack, or → + F', note: '' },
      { name: fighterData.superMove?.name || 'Super Art', input: '↓↘→↓↘→ + attack or F + D', note: 'Costs one power stock; stronger at low health' },
      { name: 'Roundhouse', input: '→ + S', note: 'Long-reach heavy kick; standing only' },
      { name: 'Sweep (low)', input: '↓ + S', note: 'Knockdown; block it crouching' },
      { name: 'Launcher', input: '↓ + D', note: 'Launches; hold ↑ on hit to super-jump after the victim, then air A > S > D. Otherwise cancels only into specials and supers' },
      { name: 'Chain combo', input: 'A > S > D > special', note: 'A connected normal cancels into a stronger one; A and ↓ + A repeat twice; in the air each button once per jump' },
      { name: 'Blowback', input: 'S + D', note: 'Knockdown strike; guard cancel with a stock while blocking' },
      { name: 'Evasive roll', input: 'A + S', note: 'Invulnerable roll; guard cancel with a stock while blocking' },
      { name: 'Throw', input: '→ or ← + D up close', note: 'Press D as you are thrown to escape' },
      { name: 'Run / backstep', input: '→→ / ←←', note: 'Tap ↑ to hop, hold ↑ to jump' },
      { name: 'Super jump', input: '↓ then ↑', note: 'Higher and longer; no jump can be steered once it leaves the ground' },
      { name: 'Taunt', input: 'G', note: 'Drains the opponent’s power gauge' }
    ];
  }
  return { WIDTH, SCREEN_W, GROUND, WALL, MAX_DIST, MAX_HP, BAR, STOCK_MAX, DIZZY_LIMIT, MOVES, VARIANTS, STYLES, DEFAULTS, moveData, create, tick, resetRound, comboScale, boxes, projectileBox, moveList, SPRITE_HEIGHT, artReaches, reachOf };
});
