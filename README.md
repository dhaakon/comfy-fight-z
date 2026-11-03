# Comfy Fighter Z — Higgsfield Open Source Saga

A browser fighting game and cloud ComfyUI asset factory, extending the existing Dad Fighter Z inspired game. Six photo-referenced fighters—**Allyson, Deep, Georgia, Matt, The Photographer, and Rob**—fight in one arena: **The Yard**, the indoor venue in `ref/levels/level-theyard.jpeg`.

The saga adds an anime title screen and individual pre-fight introductions with original taglines. CPU/local versus, blocking, projectiles, rounds, pause and touch controls remain available. Character descriptions drive the special-move artwork and announcements. The art direction uses bold ink, cel shadows and energetic 1990s battle-anime poses while preserving each person's likeness and outfit.

![Comfy Fighter Z title screen with the six fighters at The Yard](docs/title-screen.png)

The included release has 162 fighter poses and 22 audio clips, including six spoken introductions. Its optimized runtime media totals about 12.3 MB. Gameplay updates add buffered inputs, simultaneous-hit handling, fair blocking, corner collision fixes and a short CPU reaction delay.

## Clone and play

Requires Node.js 22+:

```powershell
git clone https://github.com/dhaakon/comfy-fight-z.git
cd comfy-fight-z
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8080`. To use the hackathon preview port, set `$env:PORT='8089'` before `npm start`.

Accepted, optimized WebP/MP3 media is versioned in `public/assets/`. A normal build checks those files and copies the current game into `dist/`; it preserves accepted artwork and makes no model calls. `public/assets/production.json` records the installed asset counts and conversion details. ComfyUI and cloud credentials are only needed to generate new assets.

Workflow files are recipes, not generation receipts. Consult `public/assets/production.json` for installed pose and audio counts. Text introductions remain available if an older accepted bundle lacks the six voiced intro clips; new generated media is adopted after review.

## Generate and customize assets

| File | Purpose |
| --- | --- |
| `comfy-hackathon.json` | Complete factory: 49 cloud images, seven source saves, final `assets.json` |
| `comfy-audio.json` | Complete 22-clip audio factory, final `audio.json` |
| `config/game.json` | Title/subtitle, six fighters, descriptions, specials, intro taglines/stock voices, one stage and art style |
| `workflows/packs/`, `workflows/jobs/` | Character/environment packs and individual asset workflows |
| `assets/plan.json`, `assets/audio-plan.json` | Generated image and audio output contracts |
| `tools/prepare-saga-patch.cjs` | Incremental art/intro refresh using accepted reference images |

Edit `config/game.json`, then regenerate both complete workflows:

```powershell
npm run workflows
```

This writes workflow JSON, not generated media. Keep permanent prompt changes in the configuration or generator scripts; generated workflows are overwritten by this command.

Install the project-owned mapping nodes into your ComfyUI installation, then restart ComfyUI:

```powershell
npm run nodes:install -- --comfy-root "C:\path\to\ComfyUI"
```

Upload the seven photos from `ref/` using the `sourceInput` filenames in the config. Open `comfy-hackathon.json` through ComfyUI/MCP, set its **Asset Root** to an absolute output directory, and validate it against the live node catalog. Set the same root in `comfy-audio.json`. Source photos produce accepted anime identities; those feed each fighter's three 3x3 sheets, portrait, hero illustration and special cut-in. The stage photo produces The Yard.

All model inference uses cloud/API nodes: Gemini Nano Banana 2.1 images, Sonilo music, and ElevenLabs effects and stock voices. No local model weights or voice clones are used. Generating costs credits and requires spending authorization; preparation, validation, file processing and game builds do not. Check live prices before submitting a batch.

For a partial refresh, use [the incremental workflow guide](docs/incremental-refresh.md). It reuses the existing identities, Yard and unaffected assets, merges approved replacements by ID, and supports individual sheet repairs.

## Asset folder to custom game

The workflows produce a portable source folder:

```text
<asset-root>/
  assets.json       # roster, subtitle, taglines, source paths and pose order
  audio.json        # music, effects, announcer, specials and intro calls
  raw/              # content-hashed PNG and WAV files
```

Open `/builder/`, select the complete folder, customize the title, fighter names/selection and accents, and export a standalone directory or ZIP. The builder verifies file hashes, keys green backgrounds, extracts sprites and computes anchors. It retains the original source maps and media. Customizations do not regenerate lettering or recolor baked artwork.

Missing mapped files block a strict export. Audio is optional when no `audio.json` is supplied, and the builder reports that state. A partial patch must be merged into a complete bundle before export.

For an automated strict export and browser verification:

```powershell
npm run build:bundle -- --bundle "C:\absolute\complete-bundle" --out "C:\absolute\new-export-folder"
```

This requires Playwright Chromium and produces `game/`, `game.zip`, screenshots and `build-test.json`. Extract the ZIP and run `npm start` inside it; no dependencies or ComfyUI connection are needed. Serve the game over HTTP, not `file://`.

To install a verified export into this repository's existing game:

```powershell
npm run adopt:game -- --game "C:\absolute\new-export-folder\game"
npm run build
```

Adoption requires FFmpeg on `PATH`. It converts runtime media to WebP/MP3, preserves the game code and retains the previous asset folder under `build/adopt-*/previous-assets`. Keep the portable source bundle separately: optimized runtime media does not replace the original generation records.

`npm run build -- --regenerate-assets` explicitly invokes the older local image-processing pipeline; use it only when intentionally rebuilding from its staged inputs. A normal build preserves the installed runtime.

## Controls and checks

P1: A/D move, W jump, S crouch, F punch, G kick, H special. P2: arrows and J/K/L attacks. Hold away to block; specials cost 30 meter. Escape pauses during combat. Enter or Space starts the title screen; Enter, Space or Escape skips fighter introductions. Sound starts after interaction and has a mute control. The Asset lab previews sprites and audio.

```powershell
npm test
npm run test:browser
npm run test:builder
```

Tests make no paid model calls. Browser checks require Playwright Chromium or `PLAYWRIGHT_EXECUTABLE_PATH`. Review generated art for complete limbs, pose order, consistent identity, right-facing attacks, clean keying and foot anchors; listen to voices and music joins before accepting outputs.

See [the asset contract](docs/asset-contract.md) for schemas and all 27 pose names. The read-only reference project is `C:/Users/dhaak/Development/dad-fighter-z-repo`; `npm run export:dfz -- --out exports/dad-fighter-z` stages compatible WebP assets without modifying it.
