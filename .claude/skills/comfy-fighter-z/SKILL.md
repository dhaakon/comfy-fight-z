---
name: comfy-fighter-z
description: Work on Comfy Fighter Z — generate a cast with ComfyUI cloud nodes, review and re-roll sheets, export and install a game, build crossovers, record the teaser, or change the engine. Use for any task in this repository that touches comfyui/, build/ or example/, before spending credits, and before editing the fight.
---

# Comfy Fighter Z

Read `AGENTS.md` first: it is the contract (layout, fictional-cast rules, spending, the engine's frame data). `HANDOFF.md` is the history. This skill is the map of the commands an agent runs.

## Ground rules

- **Spend only with an explicit approval.** Every paid step takes `--approve-usd <cap>` and refuses below its estimate. Price first (`prepare`), show the estimate, get a yes, then run. Preparing, validating, building and testing never spend.
- **Everything fictional.** Casts and arenas come from text. Public figures only in a cast marked `"publicFigures": true`, which stays local and off the public site.
- **Cloud models only.** No local checkpoints; partner nodes through the project node pack installed in the running ComfyUI.
- **Never hand-edit a generated bundle, `build/public/assets/` or `example/bundle/`.** Change sources, re-run the tool, verify, then adopt or merge.
- **The engine is deterministic.** No `Math.random` in `engine.js`; measure changes with the probes before and after.

## Commands

| Task | Command |
| --- | --- |
| Build and serve the included game (free) | `npm ci && npm run example && npm start` |
| Rebuild after a code change | `npm run build` (strict: `npm run build:release`) |
| Tests | `npm test`; browser: `npm run test:browser`, `test:arcade`, `test:games` |
| Price a new game from a cast file | `node build/tools/new-game.cjs prepare --cast comfyui/casts/<cast>.json --out output/test-runs/<run>` |
| Generate (paid, one node at a time) | `node build/tools/new-game.cjs run --run <run> --approve-usd <cap>` |
| Review | `node build/tools/new-game.cjs review --run <run>` then read the contact sheets it names |
| Redraw one node | `node build/tools/new-game.cjs reroll --run <run> --node "<title>" --approve-usd 0.08` |
| Add-ons | `title-card`, `add-media`, `add-scenery`, `add-sheets`, `reroll-art` (see `comfyui/docs/new-game-runbook.md`) |
| Export and install | `node build/tools/new-game.cjs export --run <run>` then `install --run <run> --slot <id>` |
| Crossover of installed games (free) | `npm run crossover` (`build/crossovers/ultra.json`) |
| Fight metrics | `node build/tools/gameplay-probe.cjs`, `node build/tools/frame-data.cjs`, `node build/tools/phone-probe.cjs` |
| Teaser | `comfyui/config/teaser.json` → `comfyui/tools/prepare-explainer.cjs` → `build/tools/capture-teaser.cjs [--portrait]` → `build/tools/compose-explainer.cjs [--portrait]` |
| Public site | `build/deploy/README.md` (package, assemble, `install-release.sh`) |

## Reading order

1. `AGENTS.md` (rules), then `comfyui/docs/new-game-runbook.md` for a game, `comfyui/docs/explainer-video.md` for a video, `gameplay-audit.md` for the engine.
2. The run folder: `plan.json` (estimate), `pipeline.json` (what ran), `review/` (contact sheets and flags).
3. For the ComfyUI side, load the `comfy` skill family (`comfy`, `comfy-debug`, `comfy-relay`) installed by `comfy skills install`; the headless-server recipe is in the runbook's prerequisites.

## Reporting

Show the picture, not the path: read contact sheets and frames into the conversation. Report costs as the recorded estimate, not a billing statement. Say what you could not verify (you cannot hear audio).
