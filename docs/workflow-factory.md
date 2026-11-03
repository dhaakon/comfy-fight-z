# Compact ComfyUI asset factory

Open `comfy-hackathon.json` for the main template. Its twelve functional nodes are Project Settings, six Character Factories, three Environment Factories, Shared Art and Export Game Assets. Each character/environment node has its own image upload control. The graph expands into the native cloud generation and mapped save nodes when run; there are no local model checkpoints.

The shipped game remains six fighters and one playable Yard stage. The separate `config/factory.json` describes the reusable factory's six character slots and three environment slots. The Yard is enabled initially. Environments 2 and 3 are empty and disabled until you supply their own reference images and descriptions; they do not reuse the Yard photo or produce substitute art.

## Use the main template

1. Install `custom_nodes/dad_fighter_assets` into ComfyUI's custom nodes directory, then restart ComfyUI. From this repository you can run `npm run nodes:install -- --comfy-root "C:\path\to\ComfyUI"`.
2. Open `comfy-hackathon.json`. Set an absolute output folder in **Project Settings**, then edit the game title, subtitle and shared styles as needed.
3. Upload a reference in each of the six **Character Factory** nodes. Set the displayed name, description, special-move name/description, intro tagline and accent color. Stable asset IDs are available as advanced fields.
4. Set **Environment 1** as the primary arena reference. Its generated stage feeds the title and selection backgrounds. To add a second or third environment, upload that environment's own image, fill in its name/description, and enable its node.
5. Validate the workflow against the running ComfyUI. Review the paid request count and obtain spending authorization before running it.
6. Review the generated artwork, then open `/builder/` and load the complete output folder containing `assets.json` and `raw/` to customize and export a game.

Names, descriptions, special moves, taglines and stage definitions edited on the factory nodes are collected into the exported manifest. You do not have to hand-edit a mapping JSON after changing those fields. Keep IDs unique; changing an ID changes the asset filenames and mappings that use it.

Each Character Factory generates a saved source, one accepted anime identity reference, three 3x3 pose sheets, a portrait, a full-body hero and a special cut-in. The 27 pose names remain compatible with the game. Each enabled Environment Factory saves its own source and generates one clean arena. Shared Art generates title/select backgrounds, logo, HUD, emblem and the nine-effect atlas. The final exporter waits for every selected output and checks that the complete game art is present.

## Cost and output counts

The compact canvas hides implementation details, not paid calls. Factories expand into native **Gemini Nano Banana 2.1** API nodes, with 1K character/interface art and 2K sheets, stages and effects, using MINIMAL thinking. There are no model calls when opening, editing, uploading files to or preparing the workflow.

| Enabled factory inputs | Paid image calls | Source saves | Mapped records |
| --- | --- | --- | --- |
| Six characters + the Yard | 49 | 7 | 56 |
| Six characters + three environments | 51 | 9 | 60 |

At the installed native rates checked on November 2, 2026, a 1K request is approximately $0.048048 and a 2K request $0.072072. The default image factory estimates $2.835; enabling both additional environments estimates $2.979. Actual billing may vary. Each additional environment adds one paid 2K image request and one local source save. These counts exclude audio and video; their workflows remain separate. No paid retry is authorized automatically.

The exported folder uses the existing `dad-fighter-assets/v1` contract. The game metadata contains the actual enabled environments; disabled slots are absent from the final roster of stages. A source map containing three environments is a new custom bundle, not a change to the installed one-Yard release. Keep it in a separate root and use the builder to export it.

## Focused templates

| Template | Use |
| --- | --- |
| `workflows/factory/character-factory.json` | One complete character pack, with an identity/art factory feeding three visible Sprite Sheet nodes |
| `workflows/factory/sprite-sheet.json` | One sheet from an uploaded accepted identity reference and editable character definition |
| `workflows/factory/environment-factory.json` | One source-referenced environment |
| `workflows/advanced/full-image-graph.json` | The expanded native-node factory for advanced inspection and tuning |

Focused templates write **partial** manifests into separate output roots. Merge accepted replacements by an existing asset ID into a complete bundle before a strict game export. New character IDs or additional venues belong in a newly generated complete main bundle; patch merging replaces existing IDs only. A single sheet or one-character pack is not a complete game. The character pack disables its internal sheet generation because its three visible Sprite Sheet nodes handle those jobs; enabling both paths would duplicate work.

The standalone sheet template needs an accepted generated identity image uploaded to ComfyUI. Select the desired `sheet`, `sheetB` or `sheetC` layout. Keep the same reference and character description across all three sheets to retain identity and clothing. See [the pose contract](asset-contract.md) for cell order and visual checks, and [incremental refresh](incremental-refresh.md) for merging accepted patches.

## Regenerate and distribute templates

Edit factory defaults in `config/factory.json`, then run:

```powershell
npm run workflows
```

This regenerates the compact main template, focused factory templates, the expanded advanced graph and the existing individual/audio recipes. The current game's older CLI plans still follow `config/game.json`; template configuration and the accepted runtime remain separate. Workflow preparation never generates media or replaces `public/assets/`.

The builder's **New game** entry reads `public/builder/factory-template.json` and offers matching downloads from `public/builder/templates/`. Those files are generated copies of the canonical workflow JSONs. Keep permanent changes in the config or generator, then regenerate so the ComfyUI file and browser download stay identical.

The compact nodes' cloud prompts live in `custom_nodes/dad_fighter_assets/factories.py`; reinstall the node pack and restart ComfyUI after changing them. The native advanced graph's prompts live in `tools/prepare-workflows.cjs`. New games with different rosters or additional environments are independent builder exports. `tools/adopt-game.cjs` still validates against the canonical six-fighter, one-Yard `config/game.json` before replacing the installed media.

Audio and opening-film generation are documented in [the asset contract](asset-contract.md) and [video workflow](video-workflow.md). They write companion maps into the same accepted source bundle and are included by the builder when present.
