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

Each phase is one agent-sized change with its own tests. The probe script becomes the acceptance tool in phase 0, and every later phase states the numbers it must produce. Constraints throughout: no `Math.random` in the simulation, the server runs the same engine (re-run `npm run bundle:server`), keep the pose names, keep `engine.js` and `anim.js` renderer-agnostic, keep the browser suites green, and re-export both installed games at the end.

### Phase 0: metrics harness (half a day)

- Turn `build/tools/gameplay-probe.cjs` into `build/test/gameplay-metrics.test.cjs` as assertions with the target numbers from the phases below, plus a `node build/tools/gameplay-metrics.cjs` report that prints the comparison table (ours, DFZ when the repo is present, targets).
- Add a frame-data dump (`node build/tools/frame-data.cjs`) that prints every move's startup/active/recovery/hitstun/blockstun/advantage from the engine, so changes are reviewed as a table, not by play.
- Acceptance: the report runs in CI without the DFZ repo.

### Phase 1: frame data, stun tables and the light kick (one day)

- Adopt fixed per-move `hitStun` / `blockStun` (stop deriving them from remaining frames). Baseline table from the Neo Geo port, which already encodes the user's own game: jab 4/3/7 (hs 14, bs 10); light kick 5/3/9 (14/11, `lkick` cel); heavy punch 8/4/15 (19/14, `hpunch`); roundhouse 10/4/18 (21/16, `kick` cel, toward+S); crouch jab 4/3/8 (13/10); sweep 9/4/20 (24/15, low, knockdown); launcher 7/7/23 (launch); air punch 5/8/5, air kick 5/9/6 (high), air heavy 7/7/7; blowback 14/4/26 (knockdown). Specials keep their shapes; the F special drops to 12 f startup.
- Button map stays A/S/D/F: A jab, S light kick, D heavy punch, toward+S roundhouse, down+button for the crouch set, air set in the air. Command list and move list update.
- Rapid-fire lights: A → A and S → S chain once on hit or block; chains otherwise stay up-rank; cancel window stays 9 f.
- Damage on a 1000-point life bar (HUD divides by ten): jab 32, light kick 36, heavy 70, roundhouse 82, crouch jab 28, sweep 68, launcher 60, air 30/34/60, blowback 104, throw 120, projectile 70, rising 100, rush 95, super 9 × 36. Scaling stays `0.82^(hits−2)` with the floor at 0.15 (0.30 for supers).
- Meter: no passive gain; strikes give the attacker 12 % of damage dealt and the defender 8 % (DFZ ratios), whiffed specials 10 points, blocks half. Stocks still carry between rounds.
- Input precedence: the earliest buffered press starts; presses within two frames resolve to the stronger button; chords require both presses within two frames and neither older than that.
- Tests: frame-data dump matches the table; a blocked jab is +1, a blocked heavy −4; jab → jab chains once; four-hit chain lands 20–25 %; 30 ± 3 jabs kill; meter stays at zero through 60 s of neutral.

### Phase 2: hit and hurt boxes (one day)

- Hurtboxes per state, scaled to the 225-unit body: stand 74 × 225, crouch 80 × 150, air 90 × 170, air-hit 110 × 135, knocked down 120 × 60 (unhittable except by moves flagged `otg`, none yet).
- Hitboxes per move from pose metadata: horizontal extent from `artReaches` (keep the 80–125 % clamp around the table reach), vertical band by move class (jab and heavy punch 55–85 % of body height, kicks 35–75 %, sweep 0–20 %, launcher 40–110 %, air moves 20–70 % relative to the attacker's feet). Boxes live in the engine, the training overlay draws the real ones.
- Contact is rectangle overlap resolved for both fighters in the same frame (keep the trade behaviour). Projectiles get a 40 × 40 box.
- Tests: a standing jab whiffs against a crouching opponent at the jab's maximum reach; a jump clears a sweep from 25 % of a body up; a launcher hits a jumper at 60 % up; the air kick cannot hit a standing opponent before the kicker descends below 70 %.

### Phase 3: committed jumps and the air game (half a day)

- Horizontal jump velocity is set once at takeoff (hold toward or back during the 4 f squat); no steering in the air. Keep 40 f airtime and the hop; add a super jump (down then up within 10 f, or any launcher cancel): vy 17 for 52 f and a 100 % body apex, which fits the camera's 1.95-body headroom.
- Air hits that are not launches or knockdowns put the defender in air hitstun (`hs` from the table, cel `hit`), after which they tech with 6 f invulnerability (DFZ `airtech`); only launches, sweeps, blowbacks, air heavies on an airborne target and knockdown specials tumble.
- Landing recovery: 4 f when landing from an attack or air hitstun, 0 f from an empty jump.
- Tests: the probe reports "committed arc"; an air jab on an airborne opponent resets instead of knocking down; air heavy on an airborne opponent knocks down.

### Phase 4: launcher combos and juggles (one and a half days)

- On hit, the launcher cancels into a super jump toward the victim inside the 9 f window (`vx = clamp((target.x − x) / 22, −7, 7)`, vy 17). Launch float: victim vy 15, 90 f of helpless air time, drifting away 1.2/frame.
- Air chain A → S → D up-rank once per jump; each juggle hit floats the victim less (`vy = max(vy × 0.3, 8 − juggle × 1.1)`) and stuns less (`hs = max(8, 14 − juggle × 2)`); air D on a juggled victim knocks down. `JUGGLE_LIMIT` becomes hitstun deterioration rather than a hard count.
- Ground bounce for the heavy blowback into a wall (one per combo) is optional; leave for later.
- Special and super cancels keep their current rules; rising becomes a juggle starter (launch 9) that air normals can follow after a run.
- CPU and training dummy expose `launched` and `juggle` in `FighterDebug.snapshot()` for tests.
- Tests: launcher → super jump → air A, S, D lands a 5-hit combo for 28–34 %; the same string with a second launcher attempt fails (scaling and float decay); the combo counter ends when the victim techs.

### Phase 5: a CPU that confirms, punishes and blocks (one and a half days)

Replace the random plan table with a small deterministic behaviour set, all seeded by `random(state)`:

- **Threat response.** Read the incoming move's height and block correctly (crouch for lows, stand for jump-ins); reaction delay 2–12 f by level; guard cancel at level ≥ 6 with a stock.
- **Confirm scripts.** Steps fire when the previous move `connected` (DFZ pattern): jab → light kick → heavy → special; crouch jab → sweep; launcher → super jump → air chain at level ≥ 5; end with a super when a stock is held and the victim is in hitstun.
- **Whiff punish.** When the opponent is in recovery inside reach, start the fastest normal that reaches, level-scaled probability.
- **Anti-air.** Rising strike or launcher when the opponent is descending within range, probability by level.
- **Pressure and mix-ups.** At close range alternate throw, low, overhead-ish jump-in and a frame trap; back off after a blocked heavy.
- **Spacing.** Walk to a style-specific preferred distance; zoners keep range and shoot, grapplers walk in, tricksters teleport behind.
- **Budgets.** Specials at most 8 per minute, supers only to punish or finish; taunt only above 30 % life lead.
- Acceptance (`gameplay-metrics`): at level 4 over 60 s, longest combo ≥ 5, blocks ≥ 40 % of blockable strikes thrown inside reach, at least one whiff punish and one anti-air per minute, specials ≤ 8; at level 1 the block rate drops below 15 % and combos stop at 2; levels stay deterministic across seeds and the demo match still finishes.

### Phase 6: the feel layer (one day, renderer only)

- Defender hit shake during hitstop (±2 px alternating, Canvas and Pixi), brightness flash already present on Pixi, add on Canvas.
- Sparks by strength: light (small burst), medium, heavy (bladed starburst, 16 f) and block (flat ring); slide dust under a pushed defender; wall thud when a slide ends at a wall.
- Counter hit: freeze +2 f, inverted flash, the existing banner; super jump trail; KO slow-motion for 20 f.
- One-button special by direction: neutral projectile, down rising, toward rush/style move, back the 214 special; the move list and intro cards say so.
- No engine changes beyond emitting `counter`, `slide` and `wall` effects.

### Phase 7: art for the main cast (paid, needs approval)

- Generate sheets F and G for the canonical six and Baron Bylaw with `new-game.cjs add-sheets` on the accepted bundle: 14 × 2K calls, about **$1.01** at the current rate, then re-export the example and the preview. Everything in phases 1–6 works without this; it only makes the sequencing visible outside Midterm Mayhem.
- Nothing else needs new cels: `lkick` (light kick), `kick` (roundhouse), `hitlow`, `hitheavy`, `crouchblock`, `guardhit`, `jumpfall`, `tumble`, `getup` already cover the new states.

### Order, dependencies and verification

0 → 1 → 2 → 3 → 4 → 5 → 6; phase 7 at any time after approval. Phases 1–4 touch `engine.js`, `anim.js` (pose timing for the new normals), `game.js` (HUD scale, move list, debug hooks), the engine tests and the runbook; phase 5 touches only `cpuInput`; phase 6 only the renderers. After each phase: `npm test`, the browser suites, `npm run bundle:server`, then re-export both installed games and capture the ROUND / FIGHT! / K.O. strips with `output/diagnostics/arcade-skin/shots.cjs` and the pose timelines with `output/diagnostics/sprite-study/capture-seq.cjs` for a human look. Commit per phase on `pixi-port`.

### Expected result

A jab that comes out in four frames and chains into itself, hits that shove the opponent across the floor, jumps you can call, sweeps you can jump over, a launcher that starts an air combo, rounds that last long enough to turn around, and a CPU that confirms, punishes and blocks like one from the arcade.
