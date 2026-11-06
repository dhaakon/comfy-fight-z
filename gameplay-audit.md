# Gameplay audit and plan (2026-11-06)

**Question.** Why does Comfy Fighter Z still play worse than `C:\Users\dhaak\Development\dad-fighter-z-repo` (DFZ, modelled on Marvel vs. Capcom 2) and Capcom fighters, and what fixes it?

**Verdict.** The engine is a sound deterministic KOF-flavoured system, but five of its core numbers and models were never tuned against a reference: normals are slow and sticky, hits teleport the defender instead of sliding them, collision is a one-dimensional reach test, jumps are steerable, and the combo system stops at a three-hit chain with doubled damage. The CPU does not fight like a fighting-game CPU (no hit-confirms, no punishes). None of this needs new art; the main cast simply also lacks the motion cels Midterm Mayhem already has. The plan below is engine-first, measured by the same probe script used for this audit, so an agent can verify each phase without a human at the controls.

## How the audit was done

- Read `build/public/engine.js`, `anim.js`, `game.js` (input and loop), both renderers; DFZ `src/engine.js`, `src/anim.js`, `src/index.html`; the Neo Geo port `C:\Users\dhaak\Development\neogeo\ref\dfz-next\main.c` (its `moves[]` table) and its `docs/KOF_MOTION_STUDY.md` and `docs/MOVEMENT_V9.md`.
- Ran identical probes in both JavaScript engines: `node build/tools/gameplay-probe.cjs` (set `DFZ_REPO` if the reference repo lives elsewhere). It simulates every normal to measure total frames, hitstun, blockstun and frame advantage, measures jumps and air control, tries a launcher follow-up, runs the chain, computes health pacing, runs CPU-versus-CPU for 60 seconds on three seeds, and tests the vertical hit shape. Numbers below come from that run (2026-11-06, commit `6ef87dd`).
- Capcom figures quoted as "typical" are the usual Street Fighter II / Alpha / Marvel ranges, not exact frame data for a specific game.

## Findings, ranked by how much they change the feel

### 1. Normals are slow and sticky

| Normal | Ours total (startup) | Hitstun / blockstun | Advantage | DFZ equivalent | Neo Geo port |
|---|---|---|---|---|---|
| A punch | 21 f (5) | 20 / 16 | +4 / 0 | LP 14 f (4), 13 / 11, +3 / +1 | jab 4/3/7, 14 / 10 |
| S kick | 33 f (10) | 25 / 20 | +2 / −3 | LK 17 f (5), 14 / 12 | short 5/3/9, 14 / 11 |
| D heavy | 34 f (9) | 28 / 19 | +3 / −6 | HP 27 f (8), 18 / 15 | strong 8/4/15, 19 / 14 |
| down+A | 18 f (4) | 18 / 15 | +4 / +1 | cLP 14 f (4), 12 / 11 | 4/3/8, 13 / 10 |
| down+S sweep | 37 f (10) | knockdown / 30 | +19 / +19 | cLK 17 f (5), cHK 37 f (10) | sweep 9/4/20, 24 / 15 |
| down+D launcher | 41 f (12) | launch / 21 | / −8 | cHP 35 f (8) | launcher 7/7/23 |

Typical Capcom lights are 3–5 f startup and 11–16 f total; mediums 5–7 f startup and about 20 f; heavies 8–12 f startup and 28–34 f. Our only three buttons map to a slow light (21 f), a 10 f "medium" kick and a heavy, so there is no fast poke and no rapid-fire pressure. Hitstun and blockstun are derived from the attacker's remaining frames plus an advantage number, which makes every block a long freeze (a blocked jab holds the defender 16 f; DFZ 11, Capcom 9–11). A blocked sweep is +19 for the attacker, which is wrong for a sweep. No normal can link into itself.

The `lkick` cel already exists in every bundle (it is only used as the kick wind-up), so a real light kick costs no art.

### 2. Hits teleport the defender

On contact the engine adds `push` to the defender's x in one frame (8–14 % of a body height) and holds a single `hit` cel until three frames before recovery. DFZ gives the defender a velocity (`push × 1.2`, decaying 0.82 per frame), so a jab slides them 12 % and a roundhouse 28 % of a body over the stun, with the cel changing as they slide. Capcom games do the same: pushback is a slide, and the slide distance is what makes heavies read as heavy. Our Neo Geo port also moves bodies over the stun. This is the single most visible difference in a hit exchange.

### 3. Collision is a horizontal reach plus a height band

`contacts` tests `|dx| < reach` and `|dy| < 90` (140 for air moves). There are no hurt or hit rectangles; the training-overlay boxes are cosmetic. Measured consequences:

- A standing jab hits an opponent hovering 89 units up (40 % of a body), so jabs are reliable anti-airs.
- A sweep hits the same opponent at 89 units, so a jump cannot clear a sweep until it is above 40 % of a body; most of the arc is sweepable.
- Crouching never makes a standing punch whiff; there is no crouch-under, no spacing by limb height, no cross-up geometry.

DFZ keeps a rectangle per move (`box`) and per state (stand 92×285, crouch 100×190, air-hit 140×170); the Neo Geo port keeps a per-move `reach` and height class. Capcom games are entirely box-driven.

### 4. Jumps are steerable and floaty

| | Airtime | Apex | Pre-jump | Air control |
|---|---|---|---|---|
| Ours (hold) | 42 f | 61 % body | 4 f | reverses mid-air (`airVX` is re-read every airborne frame) |
| Ours (tap hop) | 31 f | 34 % | 4 f | same |
| DFZ | 31 f | 53 % | 3 f | committed (vx fixed at takeoff); super jump 43 f, 98 % |
| KOF / SF2 typical | 40–45 f | ~60–75 % | 3–4 f | committed |

The duration is fine for a KOF-style game; the mid-air steering is not. A committed arc is what makes anti-airs, jump-ins and empty jumps readable for both players and for the CPU. Every air hit also becomes a knockdown (`wasAirborne → knockDown`), so there are no air-to-air resets.

### 5. The combo system stops early and hits too hard

- Chains go only up-rank (A → S → D → special → super): 4 hits for **42 %** of a life bar. DFZ's LP → LK → HP → HK does 20.5 %; a Capcom jab-jab-fierce-fireball lands 25–30 %. Jab 7 % means 15 jabs kill (DFZ 32, Capcom 25–30). Rounds end in a handful of exchanges, and integer damage on 100 HP makes scaling coarse.
- The crouching heavy launches, but the attacker has 24 f recovery plus a 4 f jump squat against a 31 f float: **no follow-up ever connects** (probe). DFZ cancels the launcher into a super jump inside the 9 f window and chains in the air; this is the signature of the reference.
- No links (a jab is +4 with a 5 f startup), no rapid-fire lights, and `JUGGLE_LIMIT` only matters after a launch.
- Meter trickles at 0.035 per frame in neutral, a full bar every 48 s without touching the opponent; stocks also carry between rounds. Supers are therefore common and cheap. DFZ and Capcom build meter from strikes and whiffs only.

### 6. The CPU does not fight like a fighting-game CPU

60 s of CPU versus CPU, level 4, three seeds:

| | Hits | Blocks | Longest combo | Throws | Specials | Supers |
|---|---|---|---|---|---|---|
| Ours | 28–45 | 1–11 | 3–7 | 0–3 | 16–23 | 3–5 |
| DFZ (level 0.7) | 34–43 | 2–6 | 10 | 0–3 | 6–9 | 2–3 |

Our `cpuInput` picks random plans (fixed button sequences) and blocks with a probability after a delay. It never confirms a hit into a follow-up, never punishes a whiff, rarely anti-airs, and spends most of its decisions on specials and supers. DFZ's AI runs scripts whose steps fire when the previous move `connected`, punishes whiffed attacks with a launcher combo, blocks by reading the attack height, anti-airs with down+special, and ends combos with a hyper when it has meter. Capcom CPUs read the same things.

### 7. The feel layer is thinner than the numbers suggest

What is already right: hitstop 5/7/9 f (4 on block) matches DFZ (5–10) and the Neo Geo port (6/9); the camera frames fighters at 42–59 % of the screen; the Pixi path has sparks, shockwave, flash and rotational shake; proximity guard, run/backstep, throw tech, rolls, guard cancels and dizzy all work.

What is missing: the defender does not shake or flash in place during hitstop (Capcom's hit shake), sparks do not scale with strength, there is no slide dust or wall-splat sound on pushback, counter hits only post a banner, and the one-button special (F) fires only the projectile with a 16 f startup. DFZ's one-button special chooses rising, rush, utility or projectile from the direction held, which is the accessible way to keep motion specials optional.

### 8. Input precedence

`command()` returns the strongest buffered button, so A then S within eight frames starts the kick and drops the jab. Capcom games start the first press and only resolve simultaneous presses to the stronger button. The chord window (`pressedTogether`, ±2 f) can also turn a fast A, S in neutral into a roll.

### 9. Art coverage of the main cast

The motion cels (sheets F and G: load, whips, recoil, settle, passing steps, breathing idle, apex, land, guard hit) exist only in Midterm Mayhem. The canonical six, Baron Bylaw, the two-fighter preview and the example bundle still animate with the 45-pose fallbacks, so the "sprites and sequence" improvements from the seventh pass are invisible in the main game. Reaction cels (`hitlow`, `hitheavy`, `crouchblock`, `guardhit`) exist in the arcade sets and need no generation.

## What to keep

Keep our engine and evolve it; do not port DFZ's engine wholesale. DFZ is a 3v3 tag game with assists and one round; ours carries the features AGENTS.md requires (A/S/D/F controls with A+S roll, S+D blowback, F+D super, stocks, rolls, guard cancels, run and backstep, dizzy, arcade ladder, styles, deterministic server-authoritative simulation, the 27 + 18 + 18 pose vocabulary). Everything below grafts Capcom and DFZ behaviour onto that base.

## Plan

Each phase is one agent-sized change with its own tests. The probe script becomes the acceptance tool in phase 0, and every later phase states the numbers it must produce. Constraints throughout: no `Math.random` in the simulation, the server runs the same engine, keep the pose names, keep `engine.js` and `anim.js` renderer-agnostic, keep the browser suites green, and re-export both installed games at the end.

### Phase 0: metrics harness (half a day)

- `build/tools/lib/gameplay-metrics.cjs` holds the probes as functions (frame data measured by simulation, slides, jumps, chains, launcher follow-up, hit shape, CPU-versus-CPU behaviour). `build/tools/gameplay-probe.cjs` prints the report (and the dad-fighter-z comparison when that repo is present); `build/test/gameplay-metrics.test.cjs` asserts the targets, phase by phase.
- `node build/tools/frame-data.cjs [--markdown]` prints every normal, system move and special: startup, active, recovery, hitstun, blockstun, measured advantage on hit and on block, damage and meter gain, so changes are reviewed as a table.
- Acceptance: both tools and the test run without the dad-fighter-z repo.

### Phase 1: frame data, pushback slides, damage, meter and input (one day)

Normals (frames at 60 fps). Advantage is measured when the first active frame connects, so it equals stun − active − recovery. Slide is the total distance the defender travels.

| Input | Move | Startup / active / recovery | Hitstun / blockstun | On hit / block | Damage | Reach | Slide on hit | Chain rank | Cel |
|---|---|---|---|---|---|---|---|---|---|
| A | jab | 4 / 3 / 7 | 14 / 11 | +4 / +1 | 32 | 100 | 18 | 0 | `punch` |
| S | light kick | 5 / 3 / 9 | 15 / 12 | +3 / 0 | 36 | 118 | 22 | 1 | `lkick` |
| D | heavy punch | 8 / 4 / 15 | 21 / 15 | +2 / −4 | 70 | 138 | 36 | 2 | `hpunch` |
| → + S | roundhouse | 10 / 4 / 18 | 22 / 16 | 0 / −6 | 82 | 150 | 46 | 2 | `kick` |
| ↓ + A | crouching jab | 4 / 3 / 8 | 14 / 12 | +3 / +1 | 28 | 94 | 16 | 0 | `cjab` |
| ↓ + S | sweep (low) | 9 / 4 / 20 | knockdown / 14 | KD / −10 | 68 | 150 | — | 2, never cancels | `sweep` |
| ↓ + D | launcher | 7 / 5 / 23 | launch / 16 | launch / −12 | 60 | 118 | — | 2 | `launcher` |
| air A | air jab (high) | 5 / 8 / 5 | 16 / 12 | — | 30 | 102 | 10 | 0 | `airpunch` |
| air S | air kick (high) | 6 / 8 / 6 | 17 / 13 | — | 36 | 136 | 12 | 1 | `airkick` |
| air D | air heavy (high) | 7 / 6 / 7 | 19 / 14 | — | 66 | 124 | 16 | 2 | `airpunch` |
| S + D | blowback | 13 / 4 / 22 | knockdown / 22 | KD / −4 | 90 | 132 | — | 2, never cancels | `blowback` |

- Normals use these fixed stun values; specials keep their frame shapes and their onHit/onBlock-derived stun. Special damage on the new scale: F projectile 60 (startup 16 → 12), fireball 70, fastball 50, double ball 2 × 50, sky shot 60, rising strike 100, rush 95, armored rush 120, rekka 45 / 45 / 70, command grab 160, guard-cancel blowback 60, throw 120, super 6 × 50 (the boss adds two hits). Moves without a listed slide use their old `push` value as the slide distance; projectiles slide 20, super hits 6.
- Life is 1000 points (`E.MAX_HP`). The HUD, desperation (≤ 250), PERFECT, the arcade time-and-life bonus (scaled so scores stay comparable) and training refills follow it.
- Damage scaling: the first three hits of a combo deal full damage, then ×0.82 for every further hit, floor 0.15 (0.30 for super hits). Counter hits stay ×1.25 damage and +4 stun.
- Dizzy: damage taken adds 1 : 1 to the dizzy meter, which dizzies at 420 and drains 2.5 per neutral frame.
- Pushback slides: a hit or block gives the defender a velocity that decays ×0.82 per simulated frame (initial speed = slide × 0.18); blocked strikes slide 1.15× as far; a new hit replaces the slide; slides stop during hitstop with everything else; a defender held by a wall passes the blocked part of each frame's slide to a grounded attacker.
- Chains on hit or block inside the 9-frame window: up-rank as now, plus rapid-fire between rank-0 normals (jab, crouching jab) up to twice in a row. Sweep and blowback never cancel. The launcher cancels only into specials, supers and (phase 4) the super jump.
- Meter: no passive gain. On hit the attacker gains 25 % and the defender 20 % of the damage dealt; on block 8 % and 5 % of the move's damage; starting a special gives 4. Stocks still carry between rounds; the taunt still drains 15.
- Input precedence: among buffered attack presses the earliest wins, unless a stronger button was pressed within two frames of it (then the strongest of those). Chords (A + S, S + D, F + D) are unchanged.
- Tests: the frame-data dump matches the table; measured advantages match it exactly; at point blank jab → jab → light kick → heavy punch → fireball all connect; jab → light kick → heavy punch → fireball deals 18–25 % of a life bar; 31–33 jabs kill; meter stays 0 through 60 s of neutral; a jab hit slides the defender 15–21 units, spread over more than five frames.

### Phase 2: hit and hurt boxes (one day)

- Hurtboxes (width × height above the feet, centred on the fighter): standing 74 × 225; crouching, crouch-blocking or in a crouching attack 80 × 140; jumping 70 × 170; in air hitstun or launched 110 × 130 starting 20 above the feet; knocked down: unhittable, as now. During a strike's active and recovery frames the attacker also has a limb hurtbox over the inner 60 % of its hitbox, at the hitbox's height.
- Hitboxes run forward from 20 units in front of the attacker's centre to `reachOf(f, move) − 37`, so standing contact range equals the table reach. Height bands above the attacker's feet: jab 110–175, light kick 60–140, heavy punch 120–195, roundhouse 150–215, crouching jab 55–110, sweep 0–38, launcher 90–250, blowback and guard-cancel blowback 90–190, rush / armored rush / rekka 50–190, rising strike 60–260, air jab 60–150, air kick 0–100, air heavy 20–130. Projectiles are 50 × 40 boxes centred on their position (super beam 70 × 60). Throws keep the centre-distance rule.
- Contact is rectangle overlap, resolved for both fighters in the same frame so trades stay. `E.boxes(f)` returns the real rectangles and the training overlay draws them.
- Tests: the roundhouse whiffs over a crouching opponent and hits a standing one; a jab still hits a croucher; a jump clears a sweep once the feet are above 38; a launcher hits a jumper whose feet are at 135; an air kick hits a standing opponent from height 150 but not from 240; a heavy punch that cannot reach the body hits a whiffed roundhouse's extended leg during its recovery; projectiles hit crouchers and pass under a jumper whose feet are above 125.

### Phase 3: committed jumps and the air game (half a day)

- Horizontal jump speed is fixed at takeoff from the direction held on the last squat frame; there is no steering in the air. Jump and hop heights and durations stay (about 40 and 31 frames).
- Super jump: a down direction (1, 2 or 3) within the 10 frames before up, or the phase 4 launcher cancel. Vertical speed 16.5 (about 51 frames, apex about 93 % of a body), horizontal speed 1.15× a normal jump; the camera's lift keeps it on screen.
- Airborne targets that are not launched: jab, light kick, crouching jab, air jab and air kick put them in air hitstun (the move's hitstun, cel `hit`), after which they air-tech (6 frames invulnerable, no more attacks that jump) and land normally. Heavy punch, roundhouse, air heavy, launcher, blowback, projectiles, knockdown specials and supers knock an airborne target down.
- Landing lag: 3 frames with no action and no guard after a jump that attacked or was hit; none after an empty jump.
- Tests: the probe reports a committed arc; super jump apex and airtime in range; air jab against a jumper resets them to a standing landing, air heavy knocks down; a standing jab anti-air resets, a heavy punch anti-air knocks down; landing lag is 3 after an attacking jump and 0 after an empty one.

### Phase 4: launcher combos and juggles (one and a half days)

- On a launcher hit, holding or pressing up inside the cancel window super-jumps immediately (no squat) toward the victim: vertical 16.5, horizontal `clamp((victim.x − x) / 22, −7, 7)`.
- Launch: the victim leaves at vertical speed 14 under 0.9× gravity (about 48 frames, apex about 75 % of a body), drifts away 1 unit per frame and stays helpless until landing.
- Air chain: air A → S → D up-rank, each at most once per jump, on hit or block inside the cancel window.
- Juggle decay: every air hit on a launched victim re-pops them less (vertical speed = max(current × 0.3, 5.5 − 0.8 × juggle count)); air D spikes them down (vertical −7); `JUGGLE_LIMIT` (4) stays as the hard cap and downed victims stay unhittable.
- Special and super cancels keep their rules. The rising strike keeps its launch.
- Tests: crouching jab → launcher → super jump → air A → air S → air D is a 5-hit combo for 17–24 % of a life bar; without the super-jump input no follow-up connects; a second launcher after the landing whiffs on the downed victim; the combo counter ends when the victim lands.

### Phase 5: a CPU that confirms, punishes and blocks (one and a half days)

Replace the random plan table with deterministic behaviours driven by `random(state)`; CPU memory stays JSON-serialisable and resets each round.

- **Reaction.** The CPU sees an opponent's move only after `max(2, 14 − 1.5 × level)` frames (boss +2 levels as now).
- **Defence.** Block by the move's height (crouch for lows, stand for jump-ins and air moves) with chance 0.08 + 0.09 × level per threat; guard-cancel at level ≥ 6 with a stock; escape throws with a level-scaled chance.
- **Hit-confirm scripts.** Each step fires when the previous move connected on hit: jab → light kick → heavy punch → style special; crouching jab → crouching jab → sweep; at level ≥ 5 crouching jab → launcher → super jump → air A → S → D; finish with a super when a stock is held. On block stop after two hits, or at level ≥ 6 go for a tick throw or a safe projectile.
- **Whiff punish.** An opponent recovering from a move that did not connect, inside reach, draws the fastest normal that reaches (level-scaled chance), then a confirm.
- **Anti-air.** An opponent jumping in (not launched) within 190 horizontally draws the rising strike (level ≥ 3) or a heavy punch / launcher.
- **Spacing.** Preferred distance by style: zoner 360, trickster 240, balanced 180, power 160, speed 140, grappler 110, boss 170; dash in at level ≥ 4.
- **Pressure.** Close up: jab strings, throws, sweeps and frame traps; jump-ins from mid range.
- **Budgets.** At most 8 specials a minute; supers only to punish, to finish or in desperation; taunt only with a 30 % life lead at range.
- Acceptance over three seeds of 60 s CPU versus CPU: level 4 has a longest combo ≥ 4 in every seed and ≥ 5 in one, blocks 40–80 % of strikes that reach it, at least one whiff punish and one anti-air per CPU across the seeds, and ≤ 8 specials per CPU per minute; level 1 blocks < 15 % and never combos past 2; level 8 beats level 1 in at least 4 of 5 seeded matches; determinism holds and the demo match finishes.

### Phase 6: the feel layer (one day)

- Engine: a `counter` effect and +2 frames of hitstop on counter hits; a `wall` effect when a slide stops at a wall; a `superjump` effect; after a K.O. freeze the next 36 ticks run the simulation at half speed (deterministic, so the server agrees).
- Renderers (Canvas and Pixi): the defender shakes ±2 px during hitstop on the hit frame; Canvas gets the hit flash Pixi already has; spark tiers by damage (light < 45, medium < 75, heavy, plus a block ring); slide dust under a sliding fighter; a wall thud (shake and dust); a negative flash on counter hits; an afterimage trail on super jumps.
- One-button special by direction: F (neutral or back) fires the F projectile, ↓ + F the rising strike, → + F the style's 214 special, F in the air the projectile, F + D the super. The move list, command list and controls panel say so.

### Phase 7: art for the main cast (paid, needs approval)

- Generate sheets F and G for the canonical six and Baron Bylaw with `new-game.cjs add-sheets` on the accepted bundle: 14 × 2K calls, about **$1.01** at the current rate, then re-export the example and the preview. Everything in phases 1–6 works without this; it only makes the sequencing visible outside Midterm Mayhem.
- Nothing else needs new cels: `lkick` (light kick), `kick` (roundhouse), `hitlow`, `hitheavy`, `crouchblock`, `guardhit`, `jumpfall`, `tumble`, `getup` already cover the new states.

### Order, dependencies and verification

0 → 1 → 2 → 3 → 4 → 5 → 6, on the `gameplay` branch; phase 7 at any time after approval. Phases 1–4 touch `engine.js`, `anim.js` (cel sequences for the new normals and air states), `game.js` (HUD scale, move list, debug hooks, controls), the engine and animation tests; phase 5 touches `cpuInput`; phase 6 the renderers plus the effects the engine emits. The multiplayer server loads each game's `engine.js` at runtime, so only a change to `build/server/server.cjs` needs `npm run bundle:server`. After each phase: `npm test`, the seven browser suites (smoke, arcade, game select, multiplayer, intro video, title video, builder), the probe and the frame-data table. At the end re-export both installed games and capture the ROUND / FIGHT! / K.O. strips with `output/diagnostics/arcade-skin/shots.cjs` and pose timelines with `output/diagnostics/sprite-study/capture-seq.cjs` for a human look. Commit per phase.

### Expected result

A jab that comes out in four frames and chains into itself, hits that shove the opponent across the floor, jumps you can call, sweeps you can jump over, a launcher that starts an air combo, rounds that last long enough to turn around, and a CPU that confirms, punishes and blocks like one from the arcade.
