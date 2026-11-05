# Comfy Fighter Z: advanced workflows

Start with the [main walkthrough](../../README.md). These options help customize, automate and update a generated game. Run commands from the repository root unless stated otherwise.

## Keep definitions reusable

| Configuration | Purpose |
| --- | --- |
| `comfyui/config/factory.json` | Main and focused image defaults; six characters, the final boss and three environments |
| `comfyui/config/game.json` | Canonical game definitions, audio/video recipes and CLI image plans |
| `comfyui/config/fictional-demo.json` | Separate sample-reference demonstration recipe |

Graph edits do not write back to configuration. For reusable edits, update the appropriate configuration and run:

```sh
npm run workflows
npm run build
```

Regeneration restores configured defaults, including output paths. Reopen the graph and confirm Project Settings before running. Keep matching fighter IDs, special names and taglines in image and audio definitions. The canonical game has six fighters, a final boss (`boss: true`) and three arenas. Arcade fields per fighter (`style`, `superMove`, `winQuote`, `ending`, `introVoice`) flow through the factories into the runtime manifest.

Descriptions control artwork and introductions. Implement different combat mechanics in the game source. Builder names and accent colors change metadata/UI; they do not repaint pixels or redraw a baked logo.

## Image modes and cost

| Source mode | Environments | Paid image calls | Mapped records | Approximate cost |
| --- | ---: | ---: | ---: | ---: |
| Invent fictional reference | 3 | 89 | 89 | $5.29 |
| Invent fictional reference | 1 | 85 | 85 | $5.00 |
| Upload reference | 3 | 79 | 89 | $4.73 |
| Upload reference | 1 | 77 | 85 | $4.59 |
| Classic set: Invent, `include_arcade_art` off, no boss | 1 | 56 | 56 | $3.20 |
| Arcade expansion of an accepted classic bundle | 2 new | 33 | 33 | $2.09 |

These describe complete uncached runs at recorded November 3, 2026 rates. They are estimates, not billing caps. Disabled environments make no calls. Upload mode preserves supplied references without regenerating them; Invent mode creates its source designs internally. Audio, film and repairs are separate.

The full bundle contains 77 character records (11 per fighter: source, identity, five sheets, portrait, hero, cut-in and ending), six environment records and six shared-art records. Read [the factory guide](workflow-factory.md) for individual-node behavior. Main image and audio recipes default to `output/assets/generated/comfy-fighter-z`; choose a fresh folder for each new batch and use that same folder for its audio.

`npm run workflows:demo` prepares an alternative example: nine text-only references, then a 49-image classic art batch using those reviewed/uploaded references, then 89 audio clips (about $1.14). It requires ComfyUI at `127.0.0.1:8188` to check live price badges. It writes a plan under `output/test-runs/` without submitting anything. The extra two sample environments remain disabled in the game-art batch.

## Try a smaller generation first

An earlier classic-format test completed on November 3, 2026 with Griddle, Rivet and The Yard: 24 generated source images, 54 mapped poses and a strict exported game with no missing artwork or placeholders. Its generated bundle is not included in the repository. The smoke test now includes the arcade sheets and ending art.

With ComfyUI running at `127.0.0.1:8188`, prepare a two-fighter test:

```sh
npm run smoke:prepare -- --out output/test-runs/smoke-first
```

Open `output/test-runs/smoke-first/workflow.json`. This is a complete small game bundle: two invented fighters with arcade sheets and endings, The Yard and shared art, with **30 paid images** and **90 runtime poses**, estimated at **$1.75**. Audio, video and paid retries are excluded. Preparation writes a reviewable `plan.json` and does not submit generation; approve the spend before an agent runs it.

After generation and visual review, export the resulting `output/test-runs/smoke-first/bundle` through the browser or the CLI below. Use a fresh run name when repeating the test; the preparation command preserves existing runs.

## Run paid workflows one call at a time

ComfyUI starts every ready cloud node at once. A workspace limited to one concurrent job answers with HTTP 429, and some nodes (Sonilo music, for example) do not retry and abort the whole prompt. `node comfyui/tools/run-sequential.cjs --workflow <api.json>` submits cumulative prompts instead. Step *k* contains the paid nodes of steps 1…*k*, each ending in a free Preview Any node, so earlier results stay cached and in use, and exactly one new paid call runs. A final run of the original workflow then executes only the free save and export nodes.

The runner records progress beside the workflow (`<name>.sequential.json`) and resumes from it. It refuses to resume after a ComfyUI restart, because the cache would be gone. It retries rate limits and, at most twice per step, dropped downloads (which may already have been billed). It stops at the first sign that an earlier paid node ran again. `--dry-run` lists the steps without submitting. Don't queue other prompts while it runs: another workflow would evict the cached results.

## Add or revise audio

Set `introTagline`, stock `introVoice`, special names and matching fighter IDs in `comfyui/config/game.json`, then run `npm run workflows:audio`. Open `comfyui/workflows/comfy-audio.json` and use the image factory's absolute output folder.

The default workflow creates 99 clips: 10 music tracks (title, select, one per arena, boss, victory, continue, game over and ending), 20 announcer calls, 20 effects, and seven lines per fighter (introduction, special, super, attack, hurt, KO and win). It uses Sonilo music and ElevenLabs stock voices and effects; there is no voice cloning. Each fighter speaks in their configured `introVoice`; the announcer uses one stock voice. The default estimate is about $1.76: $1.26 of music, $0.04 of effects and $0.47 of speech. Text edits affect speech cost.

The game plays every clip it finds and silently skips missing ones. Music, effects and voices have separate volume controls, and voices duck the music. A bundle with the classic 22 clips therefore still works.

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

The browser compiler limits selected source data and the exported package to 1 GB each (a complete arcade cast from ComfyUI, with PNG and WAV sources, exports at about 550 MB) and individual image/audio inputs to 64 MB. Source exports remain editable: select their `sources/` folder in the builder to reimport them.

### Show a verified export on the local preview server

After a successful `build:bundle`, install its game folder and start the usual server:

```powershell
npm run install:game -- --game "$export\game"
npm start
```

This copies the verified game into `output/game/`, preserves the builder route and backs up the previous preview under `output/diagnostics/game-install-*/previous-game/`. It supports the two-fighter test without changing canonical source media. **Running `npm run build` afterward restores the canonical source preview.** A browser-only export must first pass `build:bundle` to produce the required verification receipt.

## Accept a game as the repository demo

Keep custom rosters as independent exports. Adoption into this repository's demo requires its configured title, fighter and stage IDs, and the complete pose contract.

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
| `npm test` | JavaScript unit and pipeline checks. Set `COMFYUI_PYTHON` and `COMFYUI_ROOT` to an installed ComfyUI's Python and folder to include the custom-node checks |
| `npm run test:browser` | Game flow, controls, introductions and layout |
| `npm run test:arcade` | Arcade ladder and boss, win and continue screens, Training tools, gamepad Versus and saved options |
| `npm run test:builder` | Folder loading, validation and exports |
| `npm run test:expansion` | Rehearses the arcade expansion with synthetic stand-ins: saga merge onto a classic base derived from the shipped example, strict build and runtime checks. Add `-- --package` for FFmpeg packaging, `-- --keep` to keep the run |
| `node build/test/multiplayer-browser.cjs` | Online rooms, phone pairing, reconnection and phone controls |
| `npm run workflows:factory` | Regenerate main and focused factories |
| `npm run workflows:audio` | Regenerate the audio recipe |

Browser tests require Playwright Chromium. Tests use synthetic fixtures and make no paid model calls. Reports go under `output/diagnostics/`.

To refresh screenshots, build the preview, start ComfyUI, then run `node build/tools/capture-readme.cjs`. See the [capture guide](images/README.md). It uses explicit prototypes and does not submit generation.

The [asset contract](asset-contract.md) describes schemas, pose order, provenance and the older plan-based import route. Keep generated files in `output/`, game code in `build/` and generation sources in `comfyui/`.
