# Compact ComfyUI asset factory

Paths and command examples in this guide start at the repository root. Generation sources live in `comfyui/`, the game and builder source live in `build/`, and generated runs belong under `output/test-runs/`.

Enable Nodes 2.0 in the ComfyUI editor and open `comfyui/workflows/comfy-hackathon.json`. Its twelve functional nodes are encapsulated custom nodes: Project Settings, six Character Factories, three Environment Factories, Shared Art and Export Game Assets. They expand into native cloud generation and mapped saves when run; there are no local model checkpoints.

The example describes six fictional fighters and one fictional Yard stage. Its artwork is currently pending generation; the earlier photo-derived media has been retired. `comfyui/config/factory.json` contains six character definitions and three environment definitions. The Yard is enabled, while environments 2 and 3 remain disabled. Every image selector is empty. The default **Invent fictional reference** mode generates a fresh design from text and never loads, hashes or validates a selected image, even if a stale selection exists in an older editor tab.

## Use the main template

1. Install `comfyui/custom_nodes/dad_fighter_assets` into ComfyUI's custom nodes directory, then restart ComfyUI and reload the editor to refresh its node catalog. From this repository you can run `npm run nodes:install -- --comfy-root "C:\path\to\ComfyUI"`.
2. Open `comfyui/workflows/comfy-hackathon.json`. Set a fresh absolute folder under this repository's `output/test-runs/` in **Project Settings**, then edit the game title, subtitle and shared styles as needed.
3. Keep **Invent fictional reference** selected in each Character Factory. Edit the name, description, special move, intro tagline and accent color. The node creates the source design, identity, sheets and character art internally. To reuse a newly accepted fictional reference, deliberately select **Upload reference** and supply that file.
4. Keep Environment 1 enabled; its generated stage feeds the title and selection backgrounds. To add a second or third environment, describe its setting and enable the node. Each active environment invents its own reference in text-only mode.
5. Validate the workflow against the running ComfyUI. Review the paid request count and obtain spending authorization before running it.
6. Review the generated artwork, then open `/builder/` and load the complete output folder containing `assets.json` and `raw/` to customize and export a game.

Names, descriptions, special moves, taglines and stage definitions edited on the factory nodes are collected into the exported manifest. You do not have to hand-edit a mapping JSON after changing those fields. Keep IDs unique; changing an ID changes the asset filenames and mappings that use it.

Each Character Factory generates a saved source, one accepted anime identity reference, three 3x3 pose sheets, a portrait, a full-body hero and a special cut-in. The 27 pose names remain compatible with the game. Each enabled Environment Factory saves its own source and generates one clean arena. Shared Art generates title/select backgrounds, logo, HUD, emblem and the nine-effect atlas. The final exporter waits for every selected output and checks that the complete game art is present.

## Cost and output counts

The compact canvas hides implementation details, not paid calls. Factories expand into native **Gemini Nano Banana 2.1** API nodes, with 1K character/interface art and 2K sheets, stages and effects, using MINIMAL thinking. There are no model calls when opening, editing, uploading files to or preparing the workflow.

| Enabled factory inputs | Paid image calls | Source saves | Mapped records |
| --- | --- | --- | --- |
| Text-only: six characters + the Yard | 56 | 7 | 56 |
| Text-only: six characters + three environments | 60 | 9 | 60 |
| Uploaded references: six characters + the Yard | 49 | 7 | 56 |
| Uploaded references: six characters + three environments | 51 | 9 | 60 |

At the installed native rates checked on November 2, 2026, a 1K request is approximately $0.048048 and a 2K request $0.072072. The default text-only image factory estimates $3.195; enabling all three environments estimates $3.483. With uploaded references, estimates are $2.835 and $2.979. Source saves do not add charges beyond the listed generation calls. Actual billing may vary. Audio and video remain separate workflows; no paid retry is authorized automatically.

The exported folder uses the existing `dad-fighter-assets/v1` contract. The game metadata contains the actual enabled environments; disabled slots are absent from the final roster of stages. A source map containing three environments is a new custom bundle, not a change to the installed one-Yard release. Keep it in a separate root and use the builder to export it.

## Focused templates

| Template | Use |
| --- | --- |
| `comfyui/workflows/factory/character-factory.json` | One complete character pack, with an identity/art factory feeding three visible Sprite Sheet nodes |
| `comfyui/workflows/factory/sprite-sheet.json` | A custom Fictional Reference node feeding one custom Sprite Sheet node; two paid images |
| `comfyui/workflows/factory/environment-factory.json` | One invented environment, with reference and stage generated internally |
| `comfyui/workflows/advanced/full-image-graph.json` | The expanded native-node factory for advanced inspection and tuning |

Focused templates write **partial** manifests into separate output roots. Merge accepted replacements by an existing asset ID into a complete bundle before a strict game export. New character IDs or additional venues belong in a newly generated complete main bundle; patch merging replaces existing IDs only. A single sheet or one-character pack is not a complete game. The character pack disables its internal sheet generation because its three visible Sprite Sheet nodes handle those jobs; enabling both paths would duplicate work.

The standalone sheet template creates its reference inside `CFZFictionalReference` and the nine poses inside `CFZSpriteSheet`; it has no file-loading node. Select `sheet`, `sheetB` or `sheetC`. For repairs against a complete accepted bundle, the repair generator can instead wire an explicitly supplied new identity image for one paid sheet call. See [the pose contract](asset-contract.md) for cell order and visual checks, and [incremental refresh](incremental-refresh.md) for merging accepted patches.

## Regenerate and distribute templates

Edit factory defaults in `comfyui/config/factory.json`, then run:

```powershell
npm run workflows
```

This regenerates the compact main template, focused factory templates, the expanded advanced graph and the existing individual/audio recipes. The current game's older CLI plans still follow `comfyui/config/game.json`; template configuration and the accepted runtime remain separate. Workflow preparation never generates media or replaces `build/public/assets/`.

The builder's **New game** entry reads `build/public/builder/factory-template.json` and offers matching downloads from `build/public/builder/templates/`. Those files are generated copies of the canonical workflow JSONs. Keep permanent changes in the config or generator, then regenerate so the ComfyUI file and browser download stay identical.

The compact nodes' cloud prompts live in `comfyui/custom_nodes/dad_fighter_assets/factories.py`; reinstall the node pack and restart ComfyUI after changing them. The native advanced graph's prompts live in `comfyui/tools/prepare-workflows.cjs`. New games with different rosters or additional environments are independent builder exports. `build/tools/adopt-game.cjs` still validates against the canonical six-fighter, one-Yard `comfyui/config/game.json` before replacing the installed media.

Audio and opening-film generation are documented in [the asset contract](asset-contract.md) and [video workflow](video-workflow.md). They write companion maps into the same accepted source bundle and are included by the builder when present.
