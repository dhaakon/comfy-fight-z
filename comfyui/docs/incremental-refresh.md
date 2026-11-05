# Incremental saga refresh

This path improves the existing game while retaining accepted identities, stage and unaffected assets. It prepares cloud workflows, collects reviewed replacements in a separate folder, then merges by asset ID. It never automatically submits a paid job.

The refresh only replaces IDs the accepted bundle already has, so its base must match the current configuration: with the arcade cast in `comfyui/config/game.json`, that is a complete arcade bundle. To grow a classic six-fighter bundle into the arcade cast, use the arcade expansion instead (`npm run workflows:expansion`; see the [README](../../README.md#optional-expand-a-classic-bundle-to-the-arcade-cast)). Reference images must be unpackaged PNG source bundles; the expansion tool converts a packaged example's WebP identities to PNG uploads itself.

## Prepare the patch

Start with a complete accepted fictional source bundle containing `assets.json`, optional `audio.json` and `raw/`. The refresh uses the roster and arena in `comfyui/config/game.json`. Edit that file for permanent art direction, subtitle, descriptions, specials and `introTagline` changes, then prepare. An explicit `--base` is required so preparation cannot silently reuse an older photo-based bundle:

Run these commands from the repository root. Keep each new run and export in its own folder under `output/`:

```powershell
$repoRoot = (Get-Location).Path
npm run workflows
node comfyui/tools/prepare-saga-patch.cjs --base "$repoRoot\output\test-runs\accepted-bundle" --out "$repoRoot\output\test-runs\saga-run"
```

The preparation tool writes these paths inside the new run folder:

| Output | Contents |
| --- | --- |
| `plan.json` | Replacement IDs, retained IDs, reference upload paths/hashes, prompts and estimates |
| `workflows/saga-images.json` | One replacement per sheet, portrait, hero and cut-in, plus the title background and logo: 58 images for the arcade cast (35 sheets, 7 portraits, 7 heroes, 7 cut-ins) |
| `workflows/saga-intros.json` | One `fighter_<id>_intro` clip per fighter from configured taglines and stock voices |
| `workflows/repairs/*.json` | Optional individual sprite-sheet repairs; never run automatically |
| `patch/` | Output root embedded in the two main patch workflows; populated only when run |

The accepted fictional identity PNGs and configured stage load directly into the patch graph. Upload the exact files and filenames listed in `plan.json.uploads` through the ComfyUI MCP. The source designs, identities, stage, selection background, HUD, emblem, effects and unaffected audio are retained during the final merge. Never use this replacement-only path to anonymize an old photo-based game: create a complete fictional bundle first so no previous likenesses, source photos or film survive.

Open and validate the workflows against the running ComfyUI before submission. The main `comfyui/workflows/comfy-hackathon.json` remains the complete factory; do not run it to perform a partial refresh.

`plan.json.estimates` calculates image costs by resolution and voice costs from the actual configured dialogue, including a separate allowance for at most four optional 2K sheet repairs. These are estimates, not billing caps. Recheck live prices and obtain authorization for the actual batch before submitting it. The prepared plan is not evidence that a generation completed.

## Review and repair

Inspect every new sheet for nine ordered poses, recognizable identity, consistent scale, right-facing attacks and complete hands/feet inside the cells. Pay particular attention to the bottom-right entrance pose, low sweep direction and duplicated accessories. Check portraits/cut-ins, title spelling and every spoken line. A technically valid manifest cannot judge visual quality.

Use a single-sheet repair only when a real defect remains. The prepared variants take their IDs from the first four configured fighters and target `sheetC`, `sheetB`, `sheet` and `sheetC`, respectively. For another sheet or a specific defect, substitute the actual fighter ID below:

```powershell
node comfyui/tools/prepare-saga-patch.cjs --base "$repoRoot\output\test-runs\accepted-bundle" --out "$repoRoot\output\test-runs\saga-run" --repair "<fighter-id>_sheetB" --defect "The sweep must kick right; keep every shoe inside its cell."
```

This writes `workflows/repairs/<fighter-id>_sheetB.json`, pointing to `repairs/<fighter-id>_sheetB/` as its separate output root. It still uses the accepted identity reference and retains the nine-pose contract. Validate it, submit only within the authorized repair allowance, then inspect its result. Preparing another repair workflow does not extend an approved spending limit.

## Merge and verify the complete game

Once image and intro outputs are accepted, merge them with the original bundle. The output must be a new or empty folder separate from every input:

```powershell
npm run merge:assets -- --base "$repoRoot\output\test-runs\accepted-bundle" --patch "$repoRoot\output\test-runs\saga-run\patch" --out "$repoRoot\output\test-runs\saga-complete"
```

For an accepted repair, add another `--patch "$repoRoot\output\test-runs\saga-run\repairs\<fighter-id>_sheetB"` before `--out`. Patches apply in order; later records replace earlier records with the same ID. The tool verifies each source hash, retains unaffected files and optional audio/video, carries consistent edited metadata from the patch, checks completeness against the base roster/pose contract and writes `update-report.json`. Replacement IDs must already exist in the complete base; use the full factory for a new roster or additional venues. The canonical arcade bundle has 89 image records and the full audio workflow adds 99 clips; the classic six-fighter, one-stage release has 56 and 22. Never load a partial patch directly as the complete builder input.

For the canonical release, add `--saga` to enforce `comfyui/assets/plan.json` (89 images), all 99 clips in `comfyui/assets/audio-plan.json` and metadata from `comfyui/config/game.json`. A saga merge also migrates an older base: base records the plan no longer lists, or maps differently (such as the classic `ann_fight` call), are retired and listed in `update-report.json`, and the result must still contain every planned ID. Leave that flag off for custom factory bundles.

Build the merged folder through the strict browser compiler:

```powershell
npm run build:bundle -- --bundle "$repoRoot\output\test-runs\saga-complete" --out "$repoRoot\output\exports\saga-export"
```

This requires Playwright Chromium and writes a tested `game/` directory, `game.zip`, screenshots and `build-test.json`. Review the Asset lab and play both sides of the arena to check keyed edges, grounded feet, attack silhouettes and audio timing.

Adopt the verified media into the existing repository without replacing its game code:

```powershell
npm run adopt:game -- --game "$repoRoot\output\exports\saga-export\game"
npm run build
```

Adoption requires FFmpeg. It writes optimized WebP/MP3 files, runtime paths and a `production.json` receipt under `build/public/assets/`. The prior runtime remains under `output/diagnostics/adopt-*/previous-assets` for recovery. Keep the complete PNG/WAV source bundle and generation receipts separately; the repository's runtime files are optimized for serving and are not a replacement for those originals.

Normal subsequent builds preserve this versioned runtime. Only use `--regenerate-assets` or the older `--from` import path when deliberately rebuilding from their staged local inputs. No merge, export, adoption or build command runs a model.
