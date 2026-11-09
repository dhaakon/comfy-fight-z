# ComfyUI generation sources

This folder contains the recipes and inputs used to generate Comfy Fighter Z assets. It does not contain the browser game or generated run outputs.

| Path | Purpose |
| --- | --- |
| `workflows/comfy-hackathon.json` | Main factory: six characters, a final boss, three environments, shared art, the startup ensemble, menu video and fight intros, writing `assets.json` and `video.json` |
| `workflows/comfy-audio.json` | Music, effects, announcer and fighter voices; 99 clips mapped by `audio.json` |
| `workflows/comfy-opening.json` | Optional 25-second Seedance opening, preceded by seven text-only fictional reference generations |
| `workflows/simple-image-generation.json` | Small cloud image example |
| `workflows/factory/` | Focused character, sprite-sheet and environment factories, the muted arcade expansion for an accepted classic bundle and the living stage scenery graph (`stage-scenery.json`) |
| `workflows/advanced/` | Expanded graphs for inspecting the native cloud nodes |
| `casts/` | Cast files (schema `comfy-fighter-cast/v1`) that `build/tools/new-game.cjs` turns into whole games: `blue-wave-2026.json` is the fictional reference, `rogue-ai.json` the public Rogue Protocol cast; `midterm-2026.json` and `billionaires-brawl.json` are satire casts of public figures that stay local |
| `config/` | Canonical game configuration (`game.json`: poses, sheets, motion and detail sheets), the reusable factory defaults (`factory.json`), the example and demo configurations, and the storyboards of the explainer (`explainer.json`) and the 90-second teaser (`teaser.json`) |
| `custom_nodes/comfy_fighter_assets/` | Project-owned cloud factories, individual-sheet nodes, the media, scenery and title-card nodes, and the manifest exporters |
| `tools/` | Workflow preparation (`prepare-workflows.cjs`, `prepare-cast-run.cjs`, `prepare-duo-run.cjs`, `prepare-arcade-expansion.cjs`), the one-paid-node-at-a-time runner (`run-sequential.cjs`), the video narration tools (`prepare-explainer.cjs`, `place-narration.cjs`), custom-node installation and the node tests |
| `assets/` | Image/audio generation plans and mapping contracts |
| `docs/` | [Advanced guide](docs/advanced.md), [factory details](docs/workflow-factory.md), [asset contract](docs/asset-contract.md), [repairs](docs/incremental-refresh.md), [opening workflow](docs/video-workflow.md), [new-game runbook](docs/new-game-runbook.md) and the [explainer and teaser video guide](docs/explainer-video.md) |

Run commands from the repository root:

```powershell
npm run workflows
npm run nodes:install -- --comfy-root "C:\path\to\ComfyUI"
```

Workflow preparation writes recipes and matching browser downloads without calling a model. After installing the custom pack, restart ComfyUI and reload the editor. Open `comfyui/workflows/comfy-hackathon.json` with Nodes 2.0 enabled. Set its output root to a new absolute folder under `output/test-runs/` and use that same root for companion audio.

The default Invent fictional reference mode ignores the image selector and creates every source from text. The full arcade cast needs 104 paid image calls (100 with The Yard only): six fighters and the final boss with 63 poses (45 key and in-between poses plus the 18 motion cels of sheetF/sheetG) and ending art each, plus three arenas. Explicit Upload mode needs 94 (90). The classic 27-pose set without a boss or endings needs 57. All three environments are enabled by default. No earlier photographs or character sheets are default inputs.

The startup ensemble, looping menu video and one fight introduction per fighter add 15 image calls and 16 silent clips, including the select-screen loop and a portrait idle loop per fighter (about $11.81 for seven fighters on the default LTX-2.5 Fast; about $5.07 on Seedance 1.5 Pro at 1080p, which the project node can select and which animates far more cleanly). `node comfyui/tools/prepare-duo-run.cjs --out output/test-runs/<fresh>` prepares a cheaper complete two-fighter run that includes audio (about $7.63). A cast file (`casts/*.json`) turns into a complete new game with `node build/tools/new-game.cjs` (prepare, run, review, reroll, title-card, add-media, add-scenery, export, install); see [the new-game runbook](docs/new-game-runbook.md). Living stage scenery (`workflows/factory/stage-scenery.json`, about $0.33 a stage) is planned by a vision model, painted in place, separated into layers and animated by the game behind the fight.

To add the arcade material to an accepted classic bundle without redrawing its fighters, run `npm run workflows:expansion -- --base example/bundle --out output/test-runs/<fresh>`. It prepares 33 image calls and the 99-clip audio set, and submits nothing.

The 90-second teaser and the earlier explainer are generated here too: `config/teaser.json` is the storyboard, `tools/prepare-explainer.cjs` prices and writes the narration graph, the music bed is one cloud music node, and `build/tools/capture-teaser.cjs` and `compose-explainer.cjs` record and cut the video; see the [video guide](docs/explainer-video.md).

All inference uses cloud/API models. Opening a workflow, preparing it, validating it or building a game does not authorize paid generation. Obtain spending authorization for each new batch. Review generated assets and merge accepted replacements into a complete source bundle before passing it to the builder in `build/`.
