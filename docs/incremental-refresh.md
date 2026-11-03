# Incremental saga refresh

This path improves the existing game while retaining accepted identities, stage and unaffected assets. It prepares cloud workflows, collects reviewed replacements in a separate folder, then merges by asset ID. It never automatically submits a paid job.

## Prepare the patch

Start with a complete accepted source bundle containing `assets.json`, `audio.json` and `raw/`. The saga update expects the current six-fighter roster and The Yard. Edit `config/game.json` for permanent art direction, subtitle, descriptions, specials and `introTagline` changes, then prepare:

```powershell
npm run workflows
node tools/prepare-saga-patch.cjs --base "C:\assets\accepted-bundle" --out "C:\assets\saga-run"
```

The preparation tool writes:

| Output | Contents |
| --- | --- |
| `plan.json` | Replacement IDs, retained IDs, reference upload paths/hashes, prompts and estimates |
| `workflows/saga-images.json` | 38 image replacements: 18 pose sheets, six portraits, six heroes, six cut-ins, title background and logo |
| `workflows/saga-intros.json` | Six `fighter_<id>_intro` clips from configured taglines and stock voices |
| `workflows/repairs/*.json` | Optional individual sprite-sheet repairs; never run automatically |
| `patch/` | Output root embedded in the two main patch workflows; populated only when run |

The six existing anime identity PNGs and accepted Yard stage load directly into the patch graph. Upload the exact files and filenames listed in `plan.json.uploads` through the ComfyUI MCP. They are references, not new generation jobs. The source photographs, identities, Yard stage, selection background, HUD, emblem, effects and prior 16 audio clips are retained during the final merge.

Open and validate the workflows against the running ComfyUI before submission. The main `comfy-hackathon.json` remains the complete factory; do not run it to perform a partial refresh.

At the live node prices checked on November 2, 2026, the prepared 38-image/six-intro patch estimates **$2.326**, or **$2.614** including a maximum of four optional 2K sheet repairs. These are estimates, not billing caps. Recheck live prices and obtain authorization for the actual batch before submitting it. The prepared plan is not evidence that a generation completed.

## Review and repair

Inspect every new sheet for nine ordered poses, recognizable identity, consistent scale, right-facing attacks and complete hands/feet inside the cells. Pay particular attention to the bottom-right entrance pose, low sweep direction and duplicated accessories. Check portraits/cut-ins, title spelling and all six spoken lines. A technically valid manifest cannot judge visual quality.

Use a single-sheet repair only when a real defect remains. The prepared variants cover Allyson's `sheetC`, Georgia's `sheetB`, and The Photographer's `sheet` and `sheetC`. To prepare a repair for another sheet or a specific defect:

```powershell
node tools/prepare-saga-patch.cjs --base "C:\assets\accepted-bundle" --out "C:\assets\saga-run" --repair georgia_sheetB --defect "The sweep must kick right; keep every shoe inside its cell."
```

This writes `workflows/repairs/georgia_sheetB.json`, pointing to `repairs/georgia_sheetB/` as its separate output root. It still uses the accepted identity reference and retains the nine-pose contract. Validate it, submit only within the authorized repair allowance, then inspect its result. Preparing another repair workflow does not extend an approved spending limit.

## Merge and verify the complete game

Once image and intro outputs are accepted, merge them with the original bundle. The output must be a new or empty folder separate from every input:

```powershell
npm run merge:assets -- --base "C:\assets\accepted-bundle" --patch "C:\assets\saga-run\patch" --out "C:\assets\saga-complete"
```

For an accepted repair, add another `--patch "C:\assets\saga-run\repairs\georgia_sheetB"` before `--out`. Patches apply in order; later records replace earlier records with the same ID. The tool verifies each source hash, retains unaffected files, updates metadata from `config/game.json`, checks complete image/audio plan coverage and writes `update-report.json`. With the current plans, the merged result has 56 image records and 22 audio records. Never load a partial patch directly as the complete builder input.

Build the merged folder through the strict browser compiler:

```powershell
npm run build:bundle -- --bundle "C:\assets\saga-complete" --out "C:\assets\saga-export"
```

This requires Playwright Chromium and writes a tested `game/` directory, `game.zip`, screenshots and `build-test.json`. Review the Asset lab and play both sides of the arena to check keyed edges, grounded feet, attack silhouettes and audio timing.

Adopt the verified media into the existing repository without replacing its game code:

```powershell
npm run adopt:game -- --game "C:\assets\saga-export\game"
npm run build
```

Adoption requires FFmpeg. It writes optimized WebP/MP3 files, runtime paths and a `production.json` receipt under `public/assets/`. The prior runtime remains under `build/adopt-*/previous-assets` for recovery. Keep the complete PNG/WAV source bundle and generation receipts separately; the repository's runtime files are optimized for serving and are not a replacement for those originals.

Normal subsequent builds preserve this versioned runtime. Only use `--regenerate-assets` or the older `--from` import path when deliberately rebuilding from their staged local inputs. No merge, export, adoption or build command runs a model.
