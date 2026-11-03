# Generated output and local working files

This folder separates generated artifacts from the recipes in `comfyui/` and reusable code in `build/`. Its contents are ignored by Git except this guide.

| Path | Purpose |
| --- | --- |
| `game/` | Current browser game produced by `npm run build` and served by `npm start` |
| `assets/generated/` | Explicitly staged inputs for the older CLI image-processing pipeline |
| `test-runs/` | Separate cloud run plans, fetched outputs, receipts and portable source bundles |
| `exports/` | Independent custom game directories, ZIPs and export verification artifacts |
| `diagnostics/` | Import/build reports, test screenshots, temporary checks and adoption backups |
| `private-archive/` | Preserved earlier private inputs and retired media; never served or exported |

Use a fresh run directory for each generation batch. A complete source bundle contains `assets.json` and `raw/`, with optional companion `audio.json` and `video.json`. Keep that source bundle after exporting or adopting a game: optimized runtime images and audio do not replace the original files, hashes and generation receipts.

The fictional demo's replacement assets and opening are pending generation. Prepared workflow files are not proof of a completed run. Paid image, audio and video generation requires spending authorization; building and checking existing files does not generate media.

`npm run build` replaces `output/game/` from the accepted source in `build/public/`. Keep source bundles and personal work outside `game/`. The game server exposes only `game/`, so run receipts, raw assets and `private-archive/` remain outside its served tree. Never move the earlier photo-derived characters, film, screenshots or private sources into a demo export.
