# Compact ComfyUI asset factory

Paths and command examples in this guide start at the repository root. Generation sources live in `comfyui/`, the game and builder source live in `build/`, and generated runs belong under `output/test-runs/`.

Enable Nodes 2.0 in the ComfyUI editor and open `comfyui/workflows/comfy-hackathon.json`. Its 24 functional nodes are encapsulated custom nodes. Thirteen make the game art: Project Settings, six Character Factories, a Final boss Character Factory, three Environment Factories, Shared Art and Export Game Assets. The other eleven make the startup screen and videos: Title Ensemble Art, Menu Video, Select Video, one Fighter Intro Video per character and Export Videos. They expand into native cloud generation and mapped saves when run; there are no local model checkpoints.

The template describes the arcade cast: six fictional fighters, the fictional final boss Baron Bylaw and three fictional arenas (The Yard, Sunset Rooftop and Midnight Arcade). A complete reviewed example is included in `example/bundle/`; `npm run example` builds it without generation. `comfyui/config/factory.json` contains seven character definitions and three environment definitions, all enabled. Every image selector is empty. The default **Invent fictional reference** mode generates a fresh design from text and never loads, hashes or validates a selected image, even if a stale selection exists in an older editor tab.

## Use the main template

1. Install `comfyui/custom_nodes/comfy_fighter_assets` into ComfyUI's custom nodes directory, then restart ComfyUI and reload the editor to refresh its node catalog. From this repository you can run `npm run nodes:install -- --comfy-root "C:\path\to\ComfyUI"`.
2. Open `comfyui/workflows/comfy-hackathon.json`. Set a fresh absolute folder under this repository's `output/test-runs/` in **Project Settings**, then edit the game title, subtitle and shared styles as needed.
3. Keep **Invent fictional reference** selected in each Character Factory. Edit the name, description, special move, intro tagline and accent color. The optional arcade fields set `fighting_style`, `super_name`/`super_description`, `win_quote`, `ending` and `role`. **Final boss** closes Arcade mode, and a game may have at most one. The node creates the source design, identity, sheets and character art internally. To reuse a newly accepted fictional reference, deliberately select **Upload reference** and supply that file.
4. Keep Environment 1 enabled; its generated stage feeds the title and selection backgrounds. Environments 2 and 3 are enabled for the arcade ladder; disable them for a one-arena game. Each active environment invents its own reference in text-only mode.
5. Validate the workflow against the running ComfyUI. Review the paid request count and obtain spending authorization before running it.
6. Review the generated artwork, then open `/builder/` and load the complete output folder containing `assets.json` and `raw/` to customize and export a game.

Names, descriptions, special moves, taglines and stage definitions edited on the factory nodes are collected into the exported manifest. You do not have to hand-edit a mapping JSON after changing those fields. Keep IDs unique; changing an ID changes the asset filenames and mappings that use it.

For the upload steps, image recommendations and additional arena slots, see [Use your own source images and backgrounds](../../README.md#use-your-own-source-images-and-backgrounds). Uploaded references are saved into the source bundle and travel with exported games.

Each Character Factory generates a saved source and one accepted anime identity reference. It then makes five 3x3 pose sheets, a portrait, a full-body hero, a super cut-in and an ending illustration. Sheets A–C hold the 27 required poses. Sheets D–E hold 18 optional arcade poses: walk and run in-betweens, backstep, jump fall, crouch block, low and heavy hit reactions, attack wind-ups, roll, blowback, super, dizzy, a second win pose and a loss pose. Turn `include_arcade_art` off for the classic three sheets without an ending. Each enabled Environment Factory saves its own source and generates one clean arena. Shared Art generates title/select backgrounds, logo, HUD, emblem and the nine-effect atlas. The final exporter waits for every selected output and checks that the complete game art is present.

## Startup image and videos

| Node | Paid calls | Result |
| --- | --- | --- |
| CFZ Title Ensemble Art | 1 image, 2K | `ui/ensemble`: the cast caught mid-clash in the first arena, from each character's identity output. The title screen uses it for any cast. |
| CFZ Menu Video | 1 LTX-2.5 Fast clip, 8 s at 720p, silent | `titleVideo`: the ensemble as the first and last frame of a looping flurry-of-blows animation behind the title menu. |
| CFZ Select Video | 1 LTX-2.5 Fast clip, 8 s at 720p, silent | `selectVideo`: the shared select backdrop as the first and last frame of a looping lights-and-embers animation behind the roster. |
| CFZ Fighter Intro Video | 1 image (1K 16:9 keyframe) + 1 clip, 4 s at 720p, silent | `intro-<fighter id>`: an aura burst, dash and signature strike in the shonen battle-anime style. The game plays both fighters' clips side by side before the match. Voices stay separate game audio. |
| CFZ Export Videos | none | `video.json` beside `assets.json`, with hashed MP4 paths under `raw/`. |

For seven fighters this adds 8 image calls and 44 seconds of video, about $6.07 at November 2026 rates. Clip length is a widget on each video node. If a clip is missing or can't play, the game keeps the still ensemble and the animated sprite entrance.

## Cost and output counts

Factories expand into native **Gemini Nano Banana 2.1** API nodes, with 1K character/interface art and 2K sheets, stages and effects, using MINIMAL thinking. There are no model calls when opening, editing, uploading files to or preparing the workflow.

| Enabled factory inputs | Paid image calls | Source saves | Mapped records |
| --- | --- | --- | --- |
| Text-only: seven characters + three environments (default) | 89 | 10 | 89 |
| Text-only: seven characters + the Yard | 85 | 8 | 85 |
| Uploaded references: seven characters + three environments | 79 | 10 | 89 |
| Uploaded references: seven characters + the Yard | 77 | 8 | 85 |
| Classic text-only: six characters without arcade art + the Yard | 56 | 7 | 56 |

At the installed native rates checked on November 3, 2026, a 1K request is approximately $0.048048 and a 2K request $0.072072. The default text-only image factory estimates $5.285, or $4.997 with The Yard only. With uploaded references, estimates are $4.733 and $4.589. The classic set estimates $3.195. Source saves do not add charges beyond the listed generation calls. Actual billing may vary. Audio and video remain separate workflows; no paid retry is authorized automatically.

The exported folder uses the `comfy-fighter-assets/v1` contract. The game metadata contains the actual enabled environments; disabled slots are absent from the final roster of stages. Keep each generated bundle in a separate root and use the builder to export it.

## Focused templates

| Template | Use |
| --- | --- |
| `comfyui/workflows/factory/character-factory.json` | One complete character pack, with an identity/art factory feeding five visible Sprite Sheet nodes |
| `comfyui/tools/prepare-duo-run.cjs --out output/test-runs/<fresh>` | Writes a complete two-fighter run with every image, the startup media and the audio as one priced workflow. Run its API file with `comfyui/tools/run-sequential.cjs`. |
| `comfyui/workflows/factory/arcade-expansion.json` | Muted template that adds the arcade material to an accepted classic bundle. Prepare a runnable copy with `npm run workflows:expansion`. |
| `comfyui/workflows/factory/sprite-sheet.json` | A custom Fictional Reference node feeding one custom Sprite Sheet node; two paid images |
| `comfyui/workflows/factory/environment-factory.json` | One invented environment, with reference and stage generated internally |
| `comfyui/workflows/advanced/full-image-graph.json` | The expanded native-node factory for advanced inspection and tuning |

Focused templates write **partial** manifests into separate output roots. Merge accepted replacements by an existing asset ID into a complete bundle before a strict game export. New character IDs or additional venues belong in a newly generated complete main bundle; patch merging replaces existing IDs only. A single sheet or one-character pack is not a complete game. The character pack disables its internal sheet generation because its five visible Sprite Sheet nodes handle those jobs; enabling both paths would duplicate work.

The standalone sheet template creates its reference inside `CFZFictionalReference` and the nine poses inside `CFZSpriteSheet`; it has no file-loading node. Select `sheet`, `sheetB`, `sheetC`, `sheetD` or `sheetE`. A separate `CFZCharacterArt` node renders one portrait, hero, cut-in or ending from an accepted identity. For repairs against a complete accepted bundle, the repair generator can instead wire an explicitly supplied new identity image for one paid sheet call. See [the pose contract](asset-contract.md) for cell order and visual checks, and [incremental refresh](incremental-refresh.md) for merging accepted patches.

## Regenerate and distribute templates

Edit factory defaults in `comfyui/config/factory.json`, then run:

```powershell
npm run workflows
```

This regenerates the compact main template, focused factory templates, the expanded advanced graph and the existing individual/audio recipes. The current game's older CLI plans still follow `comfyui/config/game.json`; template configuration and the accepted runtime remain separate. Workflow preparation never generates media or replaces `build/public/assets/`.

The builder's **New game** entry reads `build/public/builder/factory-template.json` and offers matching downloads from `build/public/builder/templates/`. Those files are generated copies of the canonical workflow JSONs. Keep permanent changes in the config or generator, then regenerate so the ComfyUI file and browser download stay identical.

The compact nodes' cloud prompts live in `comfyui/custom_nodes/comfy_fighter_assets/factories.py`; reinstall the node pack and restart ComfyUI after changing them. The native advanced graph's prompts live in `comfyui/tools/prepare-workflows.cjs`. New games with different rosters or additional environments are independent builder exports. `build/tools/adopt-game.cjs` still validates against the canonical `comfyui/config/game.json` before replacing the installed media.

Audio and opening-film generation are documented in [the asset contract](asset-contract.md) and [video workflow](video-workflow.md). They write companion maps into the same accepted source bundle and are included by the builder when present.
