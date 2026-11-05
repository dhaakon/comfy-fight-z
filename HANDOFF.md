# Comfy Fighter Z: LLM handoff

Comfy Fighter Z is an MIT-licensed ComfyUI asset factory, browser game builder and 2D fighting game. The target is a late-1990s Neo Geo arcade fighter in the King of Fighters mold, but 1v1 only. The cast is six fictional fighters plus a final boss, across three arenas. Single player is an Arcade ladder; local Versus (gamepads), Training, online invite matches and QR-paired phone controllers are also supported. Read `AGENTS.md` before changes.

## Architecture

`comfyui/` contains cloud workflows, custom nodes and configuration. `build/public/` contains the game (`engine.js` simulation, `anim.js` poses, `game.js` modes and presentation) and the builder. `build/server/` runs authoritative WebSocket multiplayer on the same deterministic engine. `example/bundle/` contains reviewed fictional assets. `output/` contains ignored runs, exports and previews. Image, audio and video mappings use `assets.json`, `audio.json` and `video.json`. The builder exports a game directory or ZIP with source media and a bundled Node server.

The included example builds without ComfyUI or model credits: install Node 22+, then run `npm ci`, `npm run example` and `npm start`. The local game is installed in `output/game/`.

## State on 2026-11-04

**Game.** The engine has a three-stock power gauge, desperation supers, guard cancels, rolls, blowbacks, hop/jump, run/backstep, throw escapes, quick rise and dizzy. It also has counter hits, combo scaling, juggle limits and seven fighting styles, each with its own second special. The CPU uses eight levels with a seeded RNG (no `Math.random` in the simulation). Presentation covers the KOF-style HUD, a VS screen, win quotes, continues, endings, the staff roll, high scores and an attract demo. Settings cover difficulty, rounds, time, scanline or CRT display, and separate music/effects/voice volumes with ducking. Gamepads, a pause-menu command list and a phone taunt button are supported. The README's "Game modes" and "Fighting system" sections document all of it.

**Example: generated arcade release.** `example/bundle/` holds 7 fighters (Baron Bylaw is the boss) and 3 arenas (The Yard, Sunset Rooftop, Midnight Arcade). That is 315 poses, 7 endings and 89 images, plus 99 clips: 10 music, 20 announcer, 20 effects and 7 lines per fighter. It is packaged as 203 MiB of lossless WebP and MP3; `provenance.json` embeds the earlier classic record, so the 56 unchanged images still trace to their original outputs. The earlier six-fighter classic bundle is in Git history and backed up at `output/diagnostics/example-bundle-classic-20261104/`. `npm run example` passes strict export and gameplay checks.

**How it was generated.** Generation ran on the user's Personal Workspace (free tier, one concurrent job), under the user's **$20 cap**, and cost **$4.57** in total:

| Run | Cost |
| --- | --- |
| 33 images | $2.21 |
| 99 clips, including one dropped download | $2.12 |
| Three sheet re-rolls | $0.23 |
| First audio attempt, rate-limited | $0.01 |

The ledger is `output/diagnostics/spend-ledger-20261104.json`. The run folder is `output/test-runs/arcade-expansion-20261104b/`, with raw PNG/WAV, per-step state, repair graphs and review contact sheets. Three sheets were rejected in review and re-rolled:

- `brick_sheetD` had pose names baked into its cells.
- `bylaw_sheetE` twice drew a towering light wall in the super pose. The fix was to make the sprite prompt pose-only for supers (`factories.py` and `prepare-workflows.cjs`); the cut-in keeps the full effect text.

ComfyUI Desktop must restart once to load that prompt change. The installed node pack already has it.

**Pipeline lessons now built in:**

- `comfyui/tools/run-sequential.cjs` runs any API workflow one paid node at a time. It uses cumulative prompts, so cached results are reused, and it refuses to resume after a ComfyUI restart. A burst of 99 calls had hit HTTP 429 on the free tier.
- The browser builder's export cap is now 1 GB, and the ZIP references blobs instead of copying them. A raw PNG/WAV arcade bundle exports at about 520 MB.
- `build:bundle` reports a refused export instead of timing out.
- `--saga` merges retire base records the plan dropped.
- Audio records carry no `stage`: arena themes are found by `<stage-id>_music`.
- The VS screen takes focus. Enter on it had re-clicked the hidden START button and reshuffled the Arcade ladder.

**Known art caveats.** Bylaw's dizzy pose shows a bare left hand. Griddle's and Switchback's endings include in-world signage text. Tempo's super rings are large but stay in her cell. The optional $1.75 smoke run was not needed after the real run succeeded.

**Branch `two-fighter-media-template`: startup image and videos.** The main template now has 23 nodes. As well as the art, it makes the startup screen and videos:

- **CFZ Title Ensemble Art** draws the cast in the first arena (2K) and saves it as `ui/ensemble`. The title screen shows it for any cast.
- **CFZ Menu Video** turns that picture into an 8-second silent LTX-2.5 Fast loop (`titleVideo`), using it as the first and last frame.
- **CFZ Fighter Intro Video** makes a 1K keyframe and a 6-second clip per fighter (`fighterIntros`).
- **CFZ Export Videos** writes `video.json`.

The asset lab has a Videos filter and count. For seven fighters the media add 8 images and 50 seconds of video, about $6.84.

**Two-fighter run.** `comfyui/tools/prepare-duo-run.cjs` prepared `output/test-runs/duo-media-20261104/`: Griddle and Rivet in The Yard, with 33 images, 3 clips and 61 audio clips, estimated at $5.47. `run-sequential.cjs` ran it in 79 steps with no retries, and no paid node was re-executed. It cost **$5.79** (balance $246.97 → $241.18).

- The first attempt stopped at step 1, before any spend: `_cloud` unpacked a single reference link as two images. It is fixed and covered by offline expansion tests.
- Every image and clip passed review, so nothing was re-rolled. `sfx_jump` is about 13 dB quieter than the example's.
- Total spend under the $20 cap is now **$10.36**, leaving $9.64.

**Export.** `npm run build:bundle` passed strictly into `output/exports/duo-media-20261104/`: 90 poses, 61 audio clips, 3 videos and a 280 MB ZIP. It now also checks that the ensemble is the title backdrop and that the asset lab lists every video. `output/diagnostics/verify-media-game.cjs` confirmed in a browser that:

- the menu loop plays behind the title;
- both intro clips play while combat stays frozen;
- the lab shows all three clips.

Its screenshots are in that export's `media-check/` folder.

**Second pass (2026-11-05): DBZ-style presentation.** The user found the first clips slow and asked for Dragon Ball Z energy, split-screen intros, cleaner sprites and snappier animation, and asked about Pixi. Decisions: fix animation in the Canvas renderer first, Pixi later if still wanted; regenerate the menu loop and both intros (approved up to $2.70).

- `game.js`/`index.html`/`style.css`: one split-screen introduction (`.intro-half` ×2, diagonal brass slash, VS burst, rays, slam-in). Each half plays its fighter's clip or the sprite entrance; voices take turns; `presentation().introHalves` reports each half's media and `introSlot` is always 0 during the scene. Tests that waited for `introSlot === 1` now check `#intro-name-2`/`#intro-tagline-2`.
- `anim.js`: hard coil in the first 40% of start-up, pop on the first contact frames, cubic settle, contact cel held for half the recovery, sharper hit squash, faster walk/run cycles. Painted offsets stay ≤ 4 px (`anim.test.cjs` enforces it).
- `pack.js` and `tools/lib/assets.cjs` `keyGreen`: key at spill > 80, despill the fringe, and an edge pass that removes translucent pixels bordering transparency. `output/diagnostics/edge-compare.png` shows the before/after.
- `factories.py`: shonen `ANIMATION_STYLE`; menu loop is a power-up; intros are a 4-second aura burst, dash and signature strike with a whip-pan camera (default duration 4). Media for seven fighters is now 36 s, about $5.04; the duo plan is $4.96.
- `output/diagnostics/build-dbz-regen.py` expands the updated nodes offline into `output/test-runs/duo-dbz-20261105/workflow.api.json` (LoadImage of the reviewed ensemble, identities and arena; 5 paid nodes, $2.16), so the running ComfyUI did not need a restart. ComfyUI Desktop still needs one before the template's new prompts apply there.

**Third pass (2026-11-05): consistency.** The user reported sprites that "look like crap", sizes jumping, fighters switching direction, a split-screen intro that "is not working", and asked for menu videos that are not the standard pose animated. Measured causes and fixes:

- *Sizes jumped* because each generated sheet draws the body at a different scale (Griddle: sheet B–E poses 7–14% taller than sheet A, so idle↔stance2 and walk↔walk3 pulsed). `sheet-layout.mjs` `poseScales()` now corrects each sheet by the median of its upright poses against the idle sheet, then trims every upright pose to the idle height (±12%); other poses keep their proportions. Both pipelines apply it. `output/diagnostics/check-normalization.cjs` dry-runs it on a bundle; `pose-grid.cjs` draws the exported poses on their anchors.
- *Direction switches*: `run2` was drawn facing left for both fighters. Sheet records accept `"mirror": ["run2"]` (validated against the sheet's poses) and the builder flips those cells. The bundle's two sheet D records carry it.
- *Soft sprites*: sheets were downsampled to 1260 px, cut into 420 px cells and then upscaled to the 400 px idle; now fighter sheets keep native resolution (up to 2100 px; small sheets still 1260) and the arena canvas draws at device resolution (`render()` sizes the backing store to the CSS size × DPR, up to 3×).
- *Intro "not working"*: the 4 s clips froze on their last frame while the two voice lines finished (~7.7 s). Clips now loop and the scene ends with the last voice line. `output/diagnostics/intro-timeline.cjs` and `menu-timeline.cjs` record real-Edge timelines.
- *Menu videos*: `CFZTitleArt` now draws a mid-battle clash (fists colliding, speed lines) and `CFZTitleVideo` loops a flurry of blows back into it; new `CFZSelectVideo` loops the shared select backdrop (`CFZSharedArtFactory` gained a `select_image` output) as `selectVideo`; the game plays it behind the roster and each fighter card plays that fighter's intro clip darkened behind the hero art. Builder, strict export checks, asset lab, factory template (24 nodes), duo run (4 clips, $5.99) and docs cover `selectVideo`. Menu motion CSS (title stagger, button sheen, card slide-ins, tile pops, VS breathe, overlay slams) is at the end of `style.css`.
- Regeneration from reviewed images: `output/diagnostics/build-menu-regen.py` → `output/test-runs/duo-menu-20261105/` (1 image + 2 loops, **$2.14**). The running ComfyUI still had the old pack, so the select loop was saved under the `opening` id and renamed, and the title-art save was forced with a `PreviewAny`. Total under the cap: **$14.67**, $5.33 left.
- Export: `output/exports/duo-dbz-20261105c/` (strict, 21 checks). Griddle's intro clip still has a near white-out frame around 2.4 s; a re-roll is about $0.56.

**Not done.** The included example (`example/bundle/`) has no videos yet; startup media for its seven fighters would cost about $6.07. A Pixi renderer port was deferred. The title eyebrow line is hidden by the full-screen layout. ComfyUI Desktop needs a restart before the template's new nodes apply there. The Pixi renderer port continues on the `pixi-port` branch; see `port-pixi.md`.

## Branch `pixi-port` (2026-11-05)

The arena renderer port described in `port-pixi.md`. `game.js` no longer draws: `render/arena.js` picks `render/pixi-renderer.js` (vendored PixiJS 8.22.0 in `vendor/pixi.min.js`, WebGL) when it initializes, otherwise `render/canvas-renderer.js` (the original 2D path, extracted whole). Pixi owns `#arena`; the HUD, callouts, cut-in and training read-outs always draw on the 2D `#arena-hud` canvas on top through the Canvas renderer's screen layer, so both paths share one camera (`view`), one effect observer and one particle list. The Pixi path adds the motion layer: additive auras while charging or at MAX power, dash and rush speed lines, impact flashes and rings, super and KO bursts, projectile glow trails and a rotational shake; reduced motion turns all of it off. `engine.js` and `anim.js` are untouched.

Tooling: `FighterDebug.renderer()`, `pixel(x, y)` (stage colour probe for the builder test) and `rendererStats()` (texture count, resizes, average draw time); `?renderer=canvas` forces the fallback. Browser suites launch headless Chromium with ANGLE/SwiftShader through `browserLaunchOptions()` so they run on Pixi; `CFZ_FORCE_CANVAS=1` runs them on the fallback. The game server whitelist, the builder's template list, the static-site tool and the bundled runtime server all ship the renderer and vendor files (`npm run bundle:server` after editing `build/server/server.cjs`). Probes: `output/diagnostics/pixi-shot.cjs` (renderer kind, fps, draw time, screenshots of a special, a run and a hit).

**Fourth pass (2026-11-05, cap raised to $50).** User asks: generated idle stances on the select cards that loop start to finish after a beat; only the split-screen intro before a fight; more dramatic, startling game animation using shaders; facing and heights still inconsistent.

- *Select idle loops*: `CFZSelectIdleVideo` (1K 9:16 keyframe + 6 s portrait 720p LTX loop, first frame = last frame) per fighter, mapped as `selectIdles` / `idle-<fighter>` in `video.json` and `fighter.selectVideo` at runtime. Cards play the loop to the end, hold 650 ms, restart; the intro clip only stands in darkened when no idle exists. Builder, strict export, lab, template (31 nodes), duo run (35 images, 6 clips, $7.63), docs and tests updated.
- *One pre-fight screen*: `showVersus()` now plays the announcer call and starts the split-screen introduction at once; `arcade-browser` waits for the intro instead of the VS overlay.
- *Dramatic impacts (Pixi)*: a custom GLSL filter on the world (`shaker.filterArea` = screen) with chromatic aberration, radial blur, an expanding shockwave ring and a negative flash, driven by hit/super/KO effects and decaying per frame; camera punch-ins (`view.zoom` spikes); glow sparks instead of squares; stage desaturation on KO; KO burst centred on the fallen fighter. Fragment shaders need `precision highp float;` to match Pixi's vertex shader.
- *Consistency*: `CFZSpriteSheet` takes `reference_sheet`; the character factory and the duo run chain sheet A into B–E ("match its body scale, line weight, colours and RIGHT-facing direction"). The fight capture (`output/diagnostics/fight-strip.cjs`) showed facing correct in play except the `down` cel's head pointing at the opponent and `airkick` ambiguity; the KO burst had been drawn at the engine's screen-centre coordinates.
- Regeneration `output/test-runs/duo-idle-20261105/` (idle loops ×2, sheets B–E ×2 with reference, Griddle intro): see the ledger for the actual cost; `adopt-idle-regen.cjs` folds results into the bundle.

## Limitations and guardrails

Combat needs human playtesting for timing, balance and feel. Generated art can show artifacts and inconsistent proportions. Snapshots update at 30 Hz; rooms live in memory; there is no matchmaking. Browser emulation does not replace device testing. Workflows use paid cloud models, so get spending consent before submitting jobs, and don't queue other ComfyUI work while `run-sequential` runs. `npm run build`, `test:browser`, `test:arcade` and `test:builder` replace `output/game/` with the media-free preview; `npm run example` reinstalls the full game. Intentional local changes are uncommitted; GitHub and AWS are older. Do not deploy to AWS without the user's instruction.
