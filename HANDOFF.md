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

## Limitations and guardrails

Combat needs human playtesting for timing, balance and feel. Generated art can show artifacts and inconsistent proportions. Snapshots update at 30 Hz; rooms live in memory; there is no matchmaking. Browser emulation does not replace device testing. Workflows use paid cloud models, so get spending consent before submitting jobs, and don't queue other ComfyUI work while `run-sequential` runs. `npm run build`, `test:browser`, `test:arcade` and `test:builder` replace `output/game/` with the media-free preview; `npm run example` reinstalls the full game. Intentional local changes are uncommitted; GitHub and AWS are older. Do not deploy to AWS without the user's instruction.
