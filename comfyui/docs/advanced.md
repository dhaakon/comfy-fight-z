# Comfy Fighter Z: advanced workflows

Start with the [main walkthrough](../../README.md). These options help customize, automate and update a generated game. Run commands from the repository root unless stated otherwise.

## Keep definitions reusable

| Configuration | Purpose |
| --- | --- |
| `comfyui/config/factory.json` | Main and focused image defaults; six characters and three environment slots |
| `comfyui/config/game.json` | Canonical game definitions, audio/video recipes and CLI image plans |
| `comfyui/config/fictional-demo.json` | Separate sample-reference demonstration recipe |

Graph edits do not write back to configuration. For reusable edits, update the appropriate configuration and run:

```sh
npm run workflows
npm run build
```

Regeneration restores configured defaults, including output paths. Reopen the graph and confirm Project Settings before running. Keep matching fighter IDs, special names and taglines in image and audio definitions. The canonical game has six fighters and one Yard stage; independent exports can include additional enabled environments.

Descriptions control artwork and introductions. Implement different combat mechanics in the game source. Builder names and accent colors change metadata/UI; they do not repaint pixels or redraw a baked logo.

## Image modes and cost

| Source mode | Environments | Paid image calls | Mapped records | Approximate cost |
| --- | ---: | ---: | ---: | ---: |
| Invent fictional reference | 1 | 56 | 56 | $3.20 |
| Invent fictional reference | 3 | 60 | 60 | $3.48 |
| Upload reference | 1 | 49 | 56 | $2.83 |
| Upload reference | 3 | 51 | 60 | $2.98 |

These describe complete uncached runs at recorded November 3, 2026 rates. They are estimates, not billing caps. Disabled environments make no calls. Upload mode preserves supplied references without regenerating them; Invent mode creates its source designs internally. Audio, film and repairs are separate.

The one-arena bundle contains 48 character records, two environment records and six shared-art records. Read [the factory guide](workflow-factory.md) for individual-node behavior. Main image and audio recipes default to `output/assets/generated/comfy-fighter-z`; choose a fresh folder for each new batch and use that same folder for its audio.

`npm run workflows:demo` prepares an alternative example: nine text-only references, then a 49-image art batch using those reviewed/uploaded references, then 22 audio clips. It requires ComfyUI at `127.0.0.1:8188` to check live price badges. It writes a plan under `output/test-runs/` without submitting anything. The extra two sample environments remain disabled in the game-art batch.

## Try a smaller generation first

A test completed on November 3, 2026 with Griddle, Rivet and The Yard: 24 generated source images, 54 mapped poses and a strict exported game with no missing artwork or placeholders. Browser checks passed for introductions, CPU movement and human controls. It contains no audio or opening film. The resulting game was installed as a local preview; its generated bundle is not included in the repository, and the canonical six-fighter source demo remains pending. The README's title/gameplay images show this verified result.

With ComfyUI running at `127.0.0.1:8188`, prepare a two-fighter test:

```sh
npm run smoke:prepare -- --out output/test-runs/smoke-first
```

Open `output/test-runs/smoke-first/workflow.json`. This is a complete small game bundle: two invented fighters, The Yard and shared art, with **24 paid images** and **54 runtime poses**, estimated at **$1.37**. Audio, video and paid retries are excluded. Preparation writes a reviewable `plan.json` and does not submit generation; approve the spend before an agent runs it.

After generation and visual review, export the resulting `output/test-runs/smoke-first/bundle` through the browser or the CLI below. Use a fresh run name when repeating the test; the preparation command preserves existing runs.

## Add or revise audio

Set `introTagline`, stock `introVoice`, special names and matching fighter IDs in `comfyui/config/game.json`, then run `npm run workflows:audio`. Open `comfyui/workflows/comfy-audio.json` and use the image factory's absolute output folder.

The default workflow creates 22 clips: two music tracks, four announcer calls, four effects, six special calls and six introductions. It uses Sonilo and ElevenLabs stock voices/SFX; no voice cloning. The default estimate is about $0.43. Text edits affect speech cost.

Audition every voice line and music loop. The builder detects `audio.json` beside `assets.json`; when the audio map exists, its mapped media must be present too. Without an audio map, text introductions still work.

## Export from the command line

The CLI uses the browser compiler and checks the resulting game. Install its pinned Chromium browser once:

```sh
node build/node_modules/playwright/cli.js install chromium
```

Linux may also need browser system dependencies; see [Playwright's browser guide](https://playwright.dev/docs/browsers). You can instead set `PLAYWRIGHT_EXECUTABLE_PATH` to a compatible Chromium executable.

Use a complete generated bundle and fresh absolute export path. PowerShell:

```powershell
$repoRoot = (Get-Location).Path
$bundle = (Resolve-Path ".\output\test-runs\my-game\bundle").Path
$export = Join-Path $repoRoot "output\exports\my-game-001"
npm run build:bundle -- --bundle "$bundle" --out "$export"
```

Bash / zsh:

```sh
npm run build:bundle -- \
  --bundle "$PWD/output/test-runs/my-game/bundle" \
  --out "$PWD/output/exports/my-game-001"
```

The command starts a temporary server and writes `game/`, `game.zip`, `build-test.json` and review screenshots. The destination must be new or empty and separate from the source bundle. Add `--title "My Game"` for a custom title. Review screenshots and play a match; automated checks cannot approve drawing quality or audio.

The browser compiler limits selected source data to 512 MB total and individual image/audio inputs to 64 MB. Source exports remain editable: select their `sources/` folder in the builder to reimport them.

### Show a verified export on the local preview server

After a successful `build:bundle`, install its game folder and start the usual server:

```powershell
npm run install:game -- --game "$export\game"
npm start
```

This copies the verified game into `output/game/`, preserves the builder route and backs up the previous preview under `output/diagnostics/game-install-*/previous-game/`. It supports the two-fighter test without changing canonical source media. **Running `npm run build` afterward restores the canonical source preview.** A browser-only export must first pass `build:bundle` to produce the required verification receipt.

## Accept a game as the repository demo

Keep custom rosters or extra arenas as independent exports. Adoption into this repository's demo requires its configured title, six fighter IDs, Yard stage and complete pose contract.

After verifying a matching export, use PowerShell:

```powershell
npm run adopt:game -- --game "$export\game"
npm run build:release
```

Set `$export` using the export block above. Adoption updates `build/public/assets/`, preserves game code and backs up the prior runtime under `output/diagnostics/adopt-*/previous-assets/`. It requires FFmpeg when converting accepted audio to MP3; image-only adoption does not. Keep the original source bundle separately from the optimized runtime.

The pending prototype intentionally fails `build:release`; normal `build` remains available. Strict release builds require accepted complete artwork.

## Add the optional 25-second opening

Prepare the recipes:

```sh
node comfyui/tools/prepare-cinematic-workflows.cjs --templates-only
```

Choose one of `comfyui/workflows/video/opening-1080p.json` or `opening-720p.json`. Each creates seven fresh fictional references, followed by one Seedance 2.5 movie with sound. It does not reuse the game's accepted identity images automatically, so review character consistency.

Recorded totals including references are approximately $20.72 at 1080p or $8.64 at 720p. Obtain separate approval if an agent submits the batch. The game works without a movie.

The Save Video node writes `comfy-fighter-z/opening/opening-<resolution>_*.mp4` under ComfyUI's configured output directory. Download or copy the reviewed clip to your chosen local path before assembly. With FFmpeg and FFprobe on `PATH`:

```powershell
$repoRoot = (Get-Location).Path
node build/tools/assemble-opening.cjs --input "$repoRoot\output\test-runs\opening\downloaded.mp4" --out "$repoRoot\output\test-runs\opening\video-patch"
npm run merge:assets -- --base "$repoRoot\output\test-runs\my-game\bundle" --patch "$repoRoot\output\test-runs\opening\video-patch" --out "$repoRoot\output\test-runs\my-game-with-film"
npm run build:bundle -- --bundle "$repoRoot\output\test-runs\my-game-with-film" --out "$repoRoot\output\exports\my-game-with-film-001"
```

Replace `downloaded.mp4` with the actual file if needed. Assembly verifies footage, audio and duration, then writes `video.json` and `raw/opening.mp4`. The accepted movie plays before the title; Space skips it.

The [film guide](video-workflow.md) also covers `--base` preparation for an optional arena-border repair. `--templates-only` needs no existing bundle; the repair path needs an accepted complete fictional bundle and its stage/source images.

## Repair individual assets

Keep the complete accepted bundle as your base. Generate each replacement into a separate folder and inspect it before merging.

| Focused template under `comfyui/workflows/factory/` | Result |
| --- | --- |
| `character-factory.json` | One character pack, with three sheet nodes sharing its identity |
| `sprite-sheet.json` | One newly invented reference and one nine-pose sheet |
| `environment-factory.json` | One environment source and stage |

Focused templates export **partial manifests**, not complete games. The standalone sheet template invents a fresh identity. For a repair that preserves an accepted character, follow the [incremental refresh guide](incremental-refresh.md).

```powershell
$repoRoot = (Get-Location).Path
npm run merge:assets -- --base "$repoRoot\output\test-runs\my-game\bundle" --patch "$repoRoot\output\test-runs\reviewed-patch" --out "$repoRoot\output\test-runs\my-game-v2"
npm run build:bundle -- --bundle "$repoRoot\output\test-runs\my-game-v2" --out "$repoRoot\output\exports\my-game-v2"
```

The merge replaces matching IDs and retains unchanged media. Repeat `--patch` for several replacements; later patches win. Use a new or empty destination. New fighter IDs or additional arenas require a complete factory bundle first. SHA-256 mismatches mean the map and files do not match; recover the correct bundle rather than bypassing validation.

## Ports, refresh and verification

The default server port is 8080. To use 8089 in PowerShell:

```powershell
$env:PORT = "8089"
npm start
```

In Bash/zsh use `PORT=8089 npm start`. Update both the game and builder URLs. After changing source files or workflow downloads, run `npm run build` and reload; the preview serves `output/game/`.

| Command | Purpose |
| --- | --- |
| `npm test` | JavaScript unit and pipeline checks |
| `npm run test:browser` | Game flow, controls, introductions and layout |
| `npm run test:builder` | Folder loading, validation and exports |
| `npm run workflows:factory` | Regenerate main and focused factories |
| `npm run workflows:audio` | Regenerate the audio recipe |

Browser tests require Playwright Chromium. Tests use synthetic fixtures and make no paid model calls. Reports go under `output/diagnostics/`.

To refresh screenshots, build the preview, start ComfyUI, then run `node build/tools/capture-readme.cjs`. See the [capture guide](images/README.md). It uses explicit prototypes and does not submit generation.

The [asset contract](asset-contract.md) describes schemas, pose order, provenance and the older plan-based import route. Keep generated files in `output/`, game code in `build/` and generation sources in `comfyui/`.
