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
| down+S sweep | 37 f (10) | knockdown / 20 | KD / −7 (crouch-blocked) | cLK 17 f (5), cHK 37 f (10) | sweep 9/4/20, 24 / 15 |
| down+D launcher | 41 f (12) | launch / 21 | / −8 | cHP 35 f (8) | launcher 7/7/23 |

Typical Capcom lights are 3–5 f startup and 11–16 f total; mediums 5–7 f startup and about 20 f; heavies 8–12 f startup and 28–34 f. Our only three buttons map to a slow light (21 f), a 10 f "medium" kick and a heavy, so there is no fast poke and no rapid-fire pressure. Hitstun and blockstun are derived from the attacker's remaining frames plus an advantage number, which makes every block a long freeze (a blocked jab holds the defender 16 f; DFZ 11, Capcom 9–11). No normal can link into itself.

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
- As implemented: the library exports `measureMove`, `measureAll`, `jumps` (which also reports the super-jump arc and landing lag for phase 3), `chain`, `launcherFollowUp`, `hitShape`, `hitAt` (one case; with `detail` it says whether the victim was knocked down or landed on its feet), `cpuVsCpu`, plus `healthPacing` (jabs to kill) and `neutralMeter` (gauge after idling) for the phase 1 targets. It touches the engine only through `E.create` / `E.tick`, the state they return, `E.MOVES` / `E.VARIANTS` / `E.STYLES`, `E.moveData` (when present, so the boss's own super is used), `E.boxes` and `E.MAX_HP` (100 when absent). Moves are pressed as numpad inputs (`5A`, `2S`, `6S`, `j.D`, `236A`, `S+D`, `gc:S+D`), so a new normal such as → + S gets its own row as soon as the engine gives it its own move or variant. "Can act" means a taunt pressed on a copy of the state starts on that frame, startup is the first frame with a hitbox or a new projectile, and advantage is measured at point blank (80 units) with contact on the first active frame. The frame-data table also shows measured reach, chip, slide on block, meter on block and invulnerable frames, and has a `--json` form. It lists every move, the taunt and the trickster's teleport included; moves that never strike leave the strike columns empty. `arena` and `chain` take per-slot `reaches`, the art-measured reaches a game passes in its fighter profiles. The library header defines whiff punishes and anti-airs.
- As implemented: every number in the findings reproduces except two. First, the old probe guarded the sweep standing, so its blocked sweep (blockstun 30, +19) was really a hit. Crouch-blocked, the sweep has 20 frames of blockstun and is −7, as the engine declares, so finding 1's row and its "+19 on block" sentence describe a probe artefact (+19 is the wake-up gap on hit). Second, the old CPU counts treated projectile clashes and throw escapes as blocks (seed 2: 11, of which 10 are real blocks) and counted throw attempts as throws (no CPU throw connects in the three seeds). The table also shows something new: the rising strike is −19 on block, not its declared −16, because the move lasts until it lands.
- As implemented (review): the behaviour counters of `cpuVsCpu` are checked on staged two-player scenarios. Its `cpu`, `setup` and `inputs` options script either slot.
  - The staged scenarios: a whiffed heavy jabbed in its recovery counts one whiff punish; a jab on an airborne opponent one anti-air; a blocked fireball one projectile block and no strike block; a landed throw one throw.
  - A projectile that hits on the frame it appears, such as a super beam at point blank, now counts as a projectile hit, not a strike.
  - Each CPU also reports `longestConfirm`, its longest combo without super-beam hits, because a raw super alone is a six-hit combo.
  - Today's level-4 CPU on seeds 1–3, the baseline for phase 5: longest combo 6–7 in every seed, but longest confirm 1–4 per CPU; 0–3 whiff punishes and 1–7 anti-airs per CPU; it blocks 8–33 % of strikes. It already meets "a whiff punish and an anti-air per CPU across the seeds", so phase 5 should read `longestConfirm` for its combo targets and compare its punish and anti-air counts with this baseline.
- As implemented: per-slot CPU levels need engine support. `cpuVsCpu(E, { levels: [8, 1] })` passes `cpuLevels: [8, 1]` to `E.create` and reads the applied levels back from `state.options.cpuLevels` (or `state.cpuLevels`). Today's engine ignores the option and runs both CPUs at `cpuLevel`, so the result reports `perSlotLevels: false`. Phase 5's "level 8 beats level 1" test needs the engine to accept `cpuLevels`.

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
- As implemented: every frame, stun, advantage, damage, reach, rank and cel value of the table measures exactly with the table reaches (art can only lengthen them, see the review notes), and every slide within 0.3 units (`node build/tools/frame-data.cjs`). The targets hold: the five-step chain connects as one combo (20.4 %), jab → light kick → heavy punch → fireball deals 19.5 %, 32 jabs kill, 60 s of neutral builds 0 gauge, and a jab slides the defender 17.8 units over 22 frames. → + S is a new move, `roundhouse`, so the input names and the server's input list are unchanged. Normals carry `hitStun` / `blockStun` and no longer carry `onHit` / `onBlock`. The sweep and blowback are marked `noCancel`, and the launcher has `cancelRank: 3`. `E.MAX_HP`, `E.DIZZY_LIMIT` and `comboScale(hits, superHit)` are exported. Jab → jab → jab connects from 80 units with 0.3 units of reach to spare. A third crouching jab (reach 94) is out of reach after two slides, so the rapid-fire test measures crouching jabs from 64 units, the closest two fighters can stand. Crouching jab → crouching jab → sweep connects from 80.
- As implemented: the roundhouse reads the direction held on the frame S is pressed. A buffered → + S therefore still comes out as the roundhouse after the stick is let go, for example when it is pressed during hitstop. Down still takes precedence for the sweep, which is read from the crouch at the start of the move as before. A cancel now starts the next move on the cancel frame itself. Previously the fighter first took one frame of neutral movement, so it could walk a step or turn a buffered up into a jump.
- As implemented: F's startup of 12 makes it one frame faster than the 236 fireball (13), so the move list now calls F "a lighter one-button version" (60 against 70) instead of "a slower" one. The style-specific damage in the frame-data table is style-scaled; for example the power style's armored rush measures 134.
- As implemented: hits that launch or knock down set no slide, and their old one-frame shove is gone. The airborne drift, which is unchanged, carries the target, so a sweep, blowback or throw now travels about 35 units instead of 57–79. On block these moves slide their old push × 1.15. Only blocked strikes slide 1.15× as far: blocked projectiles slide 20 and blocked super hits 6, as their hits do. Projectile slides never push the shooter back at a wall; only strike slides pass the blocked part to a grounded attacker. A slide stops below 0.05 units a frame, so measured slides fall 0.2–0.3 short of the table (jab 17.8, roundhouse 45.7). A slide keeps going for those last tenths after the defender can act, until the defender starts a move, and the slide of a K.O. blow plays out during the round's end.
- As implemented: one heavy-hit threshold, 60 base damage, now drives the 7-frame hitstop, the `heavyHit` flag (the `hitheavy` cel) and heavy sparks. HEAD used 13 for the first two and 12 (or a launch) for the sparks, on its 100-point scale. Hitstop and the reaction cel change only for the sky shot (60): 7 frames instead of 5, and `hitheavy`. The sweep, rush, rekka finish and guard-cancel blowback now also draw heavy sparks: Pixi flash .55, a 12-particle burst and +.06 zoom; on canvas, shake 8 and 18 sparks. Their hitstop stays 9 and their reaction stays the knockdown tumble, because they knock down. S lost the heavy sparks of the old 12-damage kick, since it is now the light kick. The HUD scales the life bar, the danger flash (≤ 250) and the combo damage percent to `E.MAX_HP`. Arcade scoring stays comparable: damage scores 10 000 points per life bar, the life bonus pays up to 20 000 for a full bar and the time bonus is unchanged. Only a special's first press gives the 4 meter; rekka follow-ups give none. `resetRound` now keeps the art-measured reaches, which it used to drop after round 1. Hit sounds switch at 6 % and 3.4 % of a life bar of damage dealt:
  - For a balanced attacker this moves the sweep, rising strike, rush, throw and guard-cancel blowback to the heavy sound (the blowback used the punch sound, the others the kick sound).
  - Super-beam hits move from the punch sound to the kick sound. So do the rhythm rush's first hits, whose finish moves up to the heavy sound.
  - Style damage moves a few more by one class: jabs of the power, grappler and boss styles up to the kick sound, and the F shot of the speed, zoner and trickster styles and the boss's double ball down to the kick sound.
- As implemented: a super's own hits build no meter for its owner, as in Capcom games (the victim still gains 20 % of the damage). Before this, a landed six-hit super (253) refunded 63 of its 100 cost, and level-4 CPU versus CPU started 4–8 supers a minute with 39–59 % of all hits coming from super beams. The off-by-one links and the 2 → 6 reading of a stale crouch are fixed (review notes below).

Review fixes (after the phase 1 review; each is pinned by a test in `build/test/gameplay-metrics.test.cjs`, `engine.test.cjs` or `animation.test.cjs`):

- As implemented (review): supers.
  - The super beam's last hit knocks down out of juggle reach: it sets the juggle count to the limit, so the falling victim cannot be hit. Nothing links after a landed super. The beam used to leave the attacker +10 at about 104 units, so the light kick, heavy punch, launcher or rising strike continued the combo into a second super. One opening then dealt 38–50 %, and the power style and the boss dizzied the victim.
  - The boss's super recovers two beam gaps (10 frames) later, so it ends with its eighth hit as the others end with their sixth. It is now +6 on block, as every super is, instead of +16.
  - The worst one-super combo is now 407: the boss against the speed style, 5A > 6S > F+D. That is under the 420 dizzy limit, so the 1 : 1 dizzy rule stays. Only the boss's desperation super combo against the speed style (446) still dizzies from one combo.
  - The CPU no longer supers an opponent lying down after a knockdown, which the knockdown ending had made its commonest super.
- As implemented (review): block, combo and throw are judged from the stun each fighter starts the frame with (`stunAtStart`, `blockStunAtStart`).
  - On the frame its stun runs out a defender cannot act yet, so it keeps blocking, and a hit on that frame continues the combo. That frame used to be a guard hole: 35 of 1512 delayed second presses hit a defender holding back, and a link counted as a fresh hit.
  - A link now needs advantage ≥ startup, as in Capcom games, so a +4 jab links into a jab.
  - Throws read the same start-of-frame stun for both slots, so neither slot can throw on the frame the opponent's blockstun ends; slot 1 used to be able to.
  - Every measured advantage is unchanged.
- As implemented (review): presses are timed on `state.frame`, which also runs during hitstop (`pressAt` per button). The 8-frame buffer now only decides when a press expires.
  - The earliest-press rule and the chords both use this clock. Outside hitstop that is exactly the old buffer comparison, so chords are unchanged there.
  - Inside an impact freeze, presses keep their spacing instead of all reading as simultaneous. A then S four frames apart in a jab's freeze is the rapid jab, then the light kick, not a roll; F then D four frames apart is the F shot, not the super. A guard cancel needs its two buttons within two frames, like any chord.
  - A plain button, and the roundhouse or throw it makes, uses up its own press and those made up to two frames after it. Later presses stay buffered for the next step of a chain. They last the usual 8 frames, shorter than any grounded move, so after a whiff they expire unused; an air normal cut short by landing can still let one come out on landing.
  - In a cancel, a roll chord counts as its two buttons, so A + S pressed together chains the light kick instead of dropping both presses.
- As implemented (review): motions keep the lenient 16-frame subsequence match, with two limits: at most 4 frames of neutral between two of their directions, and the attack pressed at most 6 frames after the motion's last direction.
  - Keyboard rolls still count: 2,5,6, 2,2,5,5,6 and 2,5,5,5,6,6.
  - A crouch released for five frames, then → + S, is the roundhouse; → + D next to the opponent throws. Crouch-blocking, walking forward for 7 frames or more and pressing S is the roundhouse; inside the 6-frame window the same roll is a deliberate 236 + S.
  - 2A > 6S chains when the stick rests in neutral, or holds →, for a few frames before S.
  - A quick roll from a held down straight into → + S (2,6 or 2,3,6 within a couple of frames) is still the 236 fireball, as a motion should be. A crouching normal still cancels into the 236 rolled from its held down.
  - The limits apply to every motion: 236, 623, 214 and the 236236 super.
- As implemented (review): pushback slides.
  - Slides move both fighters in one pass, after their own updates and before contacts resolve, so either slot sees the same positions. A command grab at 98 units, and fireball spawns and blocks in the corner, used to depend on the slot.
  - A slide stops when the sliding fighter starts a move, so a guard cancel out of blockstun is no longer carried away. After a blocked heavy, the guard-cancel blowback reaches 64–127 units again (64–99 with the slide), and the forward guard-cancel roll crosses at 64–103 (never with the slide).
  - Slides stay out of `vx`, so a defender's last slide frames no longer show the walk cycle, and `settle` resets `vx` during the round end. The screen lock counts a slide as moving away.
  - Throws and command grabs still resolve inside the thrower's update, so a thrown victim in slot 1 starts falling one frame sooner than one in slot 0. This is pre-existing (HEAD shows it too) and leaves 3.8 units of position difference after the wake-up.
- As implemented (review): art-measured reaches can only lengthen a move. `reachOf` keeps a painted reach within 100–125 % of the table reach (it was 80–125 %), so the table reaches and the chain targets hold for every cast.
  - With Midterm Mayhem's art, the heavy punch clamped to 110–117 (table 138) and 5A > 5A > 5S > 5D > 236A dropped the heavy for all six fighters. It now connects for all six, and the test runs against the installed manifest when it is present.
  - The painted heavy punch reaches 98–127 game pixels there, and the launcher 68–113. Phase 2's hitboxes run to reach − 37 (101 and 81 at the table reaches), so a few short drawings will be overreached, by up to 13 pixels (Hamilton's launcher).
- As implemented (review): a blocked heavy punch is −4 and a blocked roundhouse −6, but their block slides (41 and 53 units) leave the defender out of a jab's reach.
  - Only a rising strike buffered in blockstun punished a blocked heavy punch, and only from 64–70 units. A blocked roundhouse was punished up close by the light kick or the rising strike, and the blowback (−4) was safe. Phase 2's limb hurtboxes change all three, and the blowback is no longer safe: see the phase 2 punish note.
  - Sweeps (−10) and launchers (−12) stay punishable.
  - These follow from the table's numbers, so they stay; the engine test and the README now say so.
- As implemented (review): other fixes.
  - The boss's double ball is −3 on block (−2 before), because a blocked first ball now slides 20 instead of 23 and the second ball arrives a frame sooner.
  - A back-thrown victim turns to face the thrower, so its knockdown drift carries it away instead of shoving the thrower about 13 units.
  - The CPU's mid-range light-kick plan is taken only inside the light kick's reach; beyond it the CPU pokes with the roundhouse and a buffered F. It used to whiff the light kick from 118 to 170 units and lose its follow-up.

### Phase 2: hit and hurt boxes (one day)

- Hurtboxes (width × height above the feet, centred on the fighter): standing 74 × 225; crouching, crouch-blocking or in a crouching attack 80 × 140; jumping 70 × 170; in air hitstun or launched 110 × 130 starting 20 above the feet; knocked down: unhittable, as now. During a strike's active and recovery frames the attacker also has a limb hurtbox over the inner 60 % of its hitbox, at the hitbox's height.
- Hitboxes run forward from 20 units in front of the attacker's centre to `reachOf(f, move) − 37`, so standing contact range equals the table reach. Height bands above the attacker's feet: jab 110–175, light kick 60–140, heavy punch 120–195, roundhouse 150–215, crouching jab 55–110, sweep 0–38, launcher 90–250, blowback and guard-cancel blowback 90–190, rush / armored rush / rekka 50–190, rising strike 60–260, air jab 60–150, air kick 0–100, air heavy 20–130. Projectiles are 50 × 40 boxes centred on their position (super beam 70 × 60). Throws keep the centre-distance rule.
- Contact is rectangle overlap, resolved for both fighters in the same frame so trades stay. `E.boxes(f)` returns the real rectangles and the training overlay draws them.
- Tests: the roundhouse whiffs over a crouching opponent and hits a standing one; a jab still hits a croucher; a jump clears a sweep once the feet are above 38; a launcher hits a jumper whose feet are at 135; an air kick hits a standing opponent from height 150 but not from 240; a heavy punch that cannot reach the body hits a whiffed roundhouse's extended leg during its recovery; projectiles hit crouchers and pass under a jumper whose feet are above 125.
- As implemented: every target holds (`build/test/gameplay-metrics.test.cjs`, phase 2), at these boundaries: the sweep hits feet up to 37.9 and misses from 38.1; the launcher hits feet below 250; the air kick hits a standing body while the attacker's feet are below 225; the F shot and the fireball hit feet at 124 and pass under 126, and the super beam (70 × 60) under 136. From 170 units the roundhouse's step forward leaves 165, beyond the heavy punch's 138, and the heavy punch hits the leg on any of the roundhouse's recovery frames (14–31). It reaches the leg until the fighters' centres are about 177 apart. Two roundhouses that cannot reach each other's bodies trade leg to leg on the same frame.
- As implemented: the box model.
  - Each strike carries its height band as data, `band: [low, high]` on the move (the 16 strikes of the list). A move strikes when it has a band; throws and command grabs keep the centre-distance rule.
  - Outside a move and outside hitstun the crouch box follows the crouch the player holds on the ground, so crouching and crouch-blocking take it. Blockstun follows the stick, so a guard can switch height, as the `crouchblock` and `guardhit` cels do. In a move the box follows the move: a crouching attack keeps the crouch box when down is let go, and a standing attack keeps the standing box with down held.
  - Hitstun keeps the posture the hit found, as in Capcom games (review fix). Every hit that does not knock down records it (`hitCrouch`), and the body box keeps it until the fighter can act again, the frame its stun runs out included. A defender hit standing that holds down or down-back therefore cannot crouch out of a chain into the roundhouse, and one hit crouching that lets go of down does not stand into it: the roundhouse still passes over a crouch-hit defender. The `hitlow` reaction cel follows the same flag.
  - With down held, the jump squat, backstep and dizzy frames use the standing box, and so would a run, but down ends a run on the frame it is pressed, in a crouch. A landing uses the standing box only on its touchdown frame, because the crouch is read while the fighter is still airborne; from the next frame a fighter holding down crouches, as its crouch pose does. Phase 3's landing lag decides the box of its lag frames.
  - "In air hitstun or launched" is any airborne fighter in hitstun. Until phase 3 every air hit launches, so this is the launched box.
  - A limb is the inner 60 % of the strike box, nearest the body. It is out from the strike's first active frame until the move ends; the rising strike's limb lasts until it lands. It can be hit whenever its fighter can, so not during the rising strike's invulnerable frames, nor during the guard-cancel blowback's, which cover its whole active window. On a move's last frame (the frame its `moveFrame` reaches startup + active + recovery) the move has ended and the arm is back in, so a punish must land one frame earlier on the limb than on the body.
  - Projectile boxes also hit an extended limb. Two opposing projectiles clash, and cancel, when their boxes overlap; a super beam survives a clash and the shot it meets does not (review fix: clashes kept the old centre test, |dx| < 40 and |dy| < 60, so drawn boxes 40–50 apart did not clash and a rising sky shot clashed with a fireball 40–60 below it).
  - `E.boxes(f)` returns `{ hurt, hit, limb, hittable }`: `hurt` is null while the fighter lies down after a knockdown, `hit` stays drawn through the active frames after a hit lands, as before, and `hittable` says whether a hit can land on the body or limb this frame (review fix). A throw or command grab shows its range to the opponent's centre as `hit`. `E.projectileBox(p)` gives a projectile's box. The Canvas overlay, which the Pixi path also draws through `drawHitboxes`, shows the body (blue) and the limb (teal), both pale while no hit can land (invulnerable, knocked out, or launched at the juggle limit; the limb used to stay teal), the strike (red; a throw's range dashed) and every projectile box.
- As implemented: three additions the plan does not list.
  - Contact keeps the old in-front rule: a strike box only hits a target whose centre is not behind the attacker's. A jumper that has crossed just behind an attacker can still overlap the inner end of a forward box (a launcher hits a jumper 10 units in front, not 10 behind), and a hit there would drive the victim the wrong way.
  - A projectile never hits a target whose centre is behind the point it was fired from (`from`, the shooter's centre when it fired; review fix). The boss's second double ball starts 15 units behind the boss (its 70-unit gap), and its box reaches about 40 behind, so it hit a balanced opponent standing 64 units behind the boss (1000 to 943), who faced the boss and could not block a ball travelling the boss's way. Shots in front of their firing point are unchanged, so the double ball's frame data is too, and a shot fired before its shooter turned around still hits.
  - Sparks, rings and the armor flash appear where the boxes touch (the centre of the overlap), not halfway between the fighters at a fixed 110 up: a sweep sparks at the shins, a roundhouse at the head, a shot at its own height.
- As implemented: what the boxes change elsewhere.
  - Frame data: every normal measures as in phase 1, reach included (contact range against a standing body is the table reach). Only two rows change. The air F shot now connects from any jump height, so the frame-data tool fires it right after takeoff (it waited 23 frames for the descent before). The boss's double ball is −2 on hit and −6 on block at point blank (+1 / −3 before), because its second ball's box meets the defender's body about 22 units (three frames) sooner than the old 40-unit centre test. Every projectile now connects at its box edge, about 22 units sooner. The zoner's rising sky shot is the exception: the 225-tall standing box keeps it in contact as it climbs, so it now hits a standing opponent from up to 340 units (210 before) and a croucher from up to 200 (210).
  - Punishes (the phase 1 review notes above). Limbs stay out through recovery, so several blocked moves are now punished by their limb from further out. Measured by the engine test's `punishes()` method (the reply buffered in blockstun so that its last frame lands on the defender's first free frame) from 64 to 170 units in 2-unit steps; HEAD (`531df29`) in brackets:
    - Heavy punch (−4): the jab and the light kick never [never]; the three-frame rising strike 64–104 [64–74], by catching the arm on the heavy's last recovery frame.
    - Roundhouse (−6): the jab 64–92 [never], by its leg; the light kick 64–70 [64–70], which strikes below the leg and reaches only the body; the rising strike 64–106 [64–70].
    - Blowback (−4): the rising strike 64–90 [never], by its arm, so the blowback is no longer safe; the jab and the light kick never.
    - Armored rush (−7): the jab at every distance 64–170 [never], by its limb in recovery; the light kick and the rising strike 64–170 [64–170].
    - Rush (−6): the jab 64–134 [64–124], the light kick 64–152 [64–142], the rising strike 64–150 [64–140].
    - One-hit rhythm rush (−4): the jab 64–100 [64–100], the light kick never [never], the rising strike 64–124 with patchy hits out to 156 [64–114].
    - Launcher (−12): the jab 64–96 [64–76], the light kick 64–114 [64–94], the rising strike 64–116 [64–102].
    - A sweep reply is no punish measure here: the attacker guards standing once it recovers, so a low reply hits whenever it reaches.
    - `engine.test.cjs` pins the heavy punch (the jab and the light kick never punish at 64, 80 or 100 units; the rising strike does at 64 and 100, not 110) and the roundhouse (the jab at 90, not 100; the light kick at 70, not 80; the rising strike at 106, not 110), and the README describes both. Only the heavy punch was pinned before the review, and its roundhouse figure read "about 100".
    - Whether the blowback and the armored rush should stay safe is a design decision outside the plan (for example, a limb that ends with the active frames, or a shorter limb for these moves). It is left to the user; phase 5's CPU punishes build on these figures.
  - Anti-airs and jump-ins: a standing jab now hits a jumper whose feet are below 175 (it was 89), so every height of a normal jump; phase 3 turns these anti-airs into air resets. Air normals hit a croucher only from low: the air jab while the attacker's feet are below 80, the air kick below 140 and the air heavy below 120.
  - As implemented: conflict. The plan's projectile box and its jump box together keep most projectiles from being jumped, an existing feature. A shot's 50 × 40 box flies at its shooter's feet + 105, so it spans 85–125 and passes only under feet above 125, while the 70 × 170 jump box starts at the feet. A balanced jump (apex 137.5) keeps its feet above 125 for 12 frames, but an F shot overlaps a stationary jumper for (50 + 70) / 8 = 15 frames. On HEAD the centre test let a shot pass under feet above 75. Measured with an F shot or 236 + A fired from 250, 350 and 450 units and the jump pressed on each frame 0–110 after the shot (held 6 frames); clearing timings per distance, HEAD in brackets:
    - Balanced, zoner and the boss never clear a shot with a neutral jump [19 timings] and clear one with a forward jump at 1–5 timings [16–35].
    - The power style (apex 124.5) and the grappler (apex 117.1) can never jump a projectile, at any timing or distance [neutral 14–15, forward 15–29].
    - The speed style (apex 154) clears one with a neutral jump at 5 timings [20–22] and a forward jump at 4–16 [16–39]; the trickster (apex 148) at 3 [20–21] and 4–13 [16–37].
    - Back jumps never clear [1–6], nor do hops (apex about 77) [the speed style and trickster at 1–2]. The super beam (75–135) is cleared only by the speed style and the trickster, at 1–9 timings [6–28 for every style].
    - The plan's stated tests hold, because `hitAt` holds the jumper at a fixed height: shots hit crouchers and feet at 124 and pass under feet at 126, and the beam passes under 136.
    - The CPU answers an incoming shot with a one-frame jump press, normally a hop: over 6 style pairs × 12 seeds × 60 s at level 4 it took off with a shot incoming 144 times, 8 of them full jumps [183 and 3]. On HEAD, whose centre test let a shot pass under feet above 75, its hops now and then cleared a shot near their apex (3 times at level 4 in that sample; at level 8 about 7 hops and 9 full jumps did); now none clear at either level (the few passes left are invulnerable wake-ups). Level-4 CPU versus CPU still lands 50–68 hits a minute per match, with blocks, punishes, anti-airs and combos of 7–9.
    - Options, each keeping the plan's tests: (a) accept the loss until phase 3's super jump; (b) lower the flight height (at feet + 85 a balanced neutral jump clears at 6 timings and a forward jump at 8–17, at + 75 at 8 and 9–21, measured on scratch copies), the only option that helps the power style and the grappler, which moves this phase's 124 / 126 and 134 / 136 boundary tests and draws shots lower unless the renderers offset the art; (c) give non-super projectiles the strikes' in-front rule, so a shot only hits a victim whose centre is not behind the shot's (neutral jumps then clear at 5–6 timings for balanced and zoner and 10–13 for the speed style and trickster, forward jumps at about 12; power and grappler still never). A jump box tucked above the feet is no option: it would break the sweep target (the sweep hits feet at 10, 30 and 37.9). The choice is left to the user before phase 3.
  - Tests: the phase 1 guard-hole scan now has the defender guard standing against a roundhouse until it has blocked it, then down-back for a following sweep, because a crouching guard lets the roundhouse pass overhead. The probe's vertical hit-shape section now reports the jab, sweep and launcher at heights 0 to 175, the air kick from 150 and 240, and the F shot against a croucher and jumpers at 124 and 126.

Review fixes (after the phase 2 review; each is pinned by a test in `build/test/gameplay-metrics.test.cjs`, `engine.test.cjs` or `animation.test.cjs`):

- As implemented (review): hitstun keeps the posture of the hit (the box model above). Before the fix a defender holding down or down-back in hitstun took the crouch box, so it could escape, and then punish, any chain ending in → + S: 5A > 6S, 5S > 6S and 2A > 6S fell from 2 hits to 1, 5A > 5S > 6S from 3 to 2, and 5A > 5A > 5A > 5S > 6S > 214A from 6 hits (233) to 4 (126). A defender hit crouching that let go of down took the standing box and was hit by a crouch-confirmed roundhouse. `chain()` takes `afterHit`, a direction the defender holds once it has been hit.
- As implemented (review): projectile exchanges no longer depend on the slot. A shot that a clash cancels on its rival's turn neither moves nor hits; when both fighters pressed F on the same frame from 80 to 120 units, the shots clashed and slot 1's cancelled shot still hit slot 0. Clashes use the projectile boxes (the box model above).
- As implemented (review): a trade resolves both strikes as they stood on the contact frame. Each strike carries its remaining frames, and the rhythm rush's third press its finisher damage and knockdown, from before any contact lands. The first hit used to clear the second attacker's move before its own hit was resolved, so a rhythm-rush trade gave the slot-0 victim the fallback 17 frames of stun and the slot-1 victim 21, and a third press trading from slot 1 lost its finisher. Normals use fixed stun and the other specials that derive stun from their frames knock down, so only the rhythm rush was affected.
- As implemented (review): a projectile never hits a target behind the point it was fired from (the additions above).
- As implemented (review): tests now reach the box rules that none did before: the standing box of dizzy, jump-squat, backstep and run frames with down held and of a landing's touchdown frame, a shot hitting an extended limb, the rising strike's limb after its frames run out in the air, and a command grab or throw against a victim lying down. The null body box of a downed fighter had left the knocked-down check in `hittable()`, the only thing that stops a command grab there, without a test.

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
