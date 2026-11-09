# Generated output and local working files

This folder separates generated artifacts from the recipes in `comfyui/` and reusable code in `build/`. Its contents are ignored by Git except this guide.

| Path | Purpose |
| --- | --- |
| `game/` | Current browser game produced by `npm run build` or `npm run example`, served by `npm start` at `/` |
| `games/<slot>/` | Games installed with `new-game.cjs install --slot <id>` or composed by `npm run crossover`; `npm start` serves each at `/<slot>/` and lists them under GAME SELECT |
| `example/` | Builds of the included example (`npm run example`): the export, its ZIP and `build-test.json` per run |
| `test-runs/` | Separate cloud run plans, fetched outputs, receipts and portable source bundles, including cast-file runs |
| `exports/` | Independent custom game directories, ZIPs and export verification artifacts |
| `explainer/` | Explainer and teaser runs: narration graphs and clips, screen recordings, cards and the composed videos |
| `deploy/` | Packaged site releases, their checksums and deployment receipts |
| `phone-photo-demo/` | Runs of the retired phone-photo demonstration |
| `assets/generated/` | Explicitly staged inputs for the older CLI image-processing pipeline |
| `diagnostics/` | Import/build reports, test screenshots, probe results, temporary checks and adoption backups |
| `private-archive/` | Preserved earlier private inputs and retired media; never served or exported |

Use a fresh run directory for each generation batch. A complete source bundle contains `assets.json` and `raw/`, with optional companion `audio.json` and `video.json`. Keep that source bundle after exporting or adopting a game: optimized runtime images and audio do not replace the original files, hashes and generation receipts.

Prepared workflow files are not proof of a completed run. Paid image, audio and video generation requires spending authorization; building and checking existing files does not generate media.

`npm run build` replaces `output/game/` from the accepted source in `build/public/`. Keep source bundles and personal work outside `game/` and `games/`. The game server exposes only those game folders, so run receipts, raw assets and `private-archive/` remain outside its served tree. Never move the earlier photo-derived characters, film, screenshots or private sources into a demo export.
