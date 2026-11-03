# Artwork contract

The example game is Comfy Fighter Z — Higgsfield Open Source Saga: six fictional characters and one fictional stage, The Yard. Its complete image bundle has 56 records: 49 generated game-art images and seven `source` records preserving the reference designs. The default **Invent fictional reference** mode generates those seven sources internally from text, then derives the game art from them. It requires 56 paid image calls and loads no external images. The schema names remain compatible with the existing Dad Fighter asset pipeline.

The [compact factory](workflow-factory.md) is configured separately in `config/factory.json`: six character factories and three environment factories. Each supports inventing a reference from its text description or explicitly selecting **Upload reference** for a new supplied image. All image selectors start empty. Only The Yard is enabled initially; the other two environments remain disabled and produce nothing until enabled. Never fill an empty environment slot with The Yard implicitly. A custom bundle can contain up to three environments; this does not change the installed game's one-stage configuration.

| Source mode | Enabled environments | Paid image calls | Mapped image records |
| --- | --- | --- | --- |
| Invent fictional reference (default) | One | 56 | 56 |
| Invent fictional reference | Three | 60 | 60 |
| Upload reference | One | 49 | 56 |
| Upload reference | Three | 51 | 60 |

Upload mode saves the seven or nine supplied references without generating them again. A separate nine-image sample-reference workflow is also available when preparing references before the art batch. The fictional demo is pending generation: its character and environment descriptions are configured, but no generated reference images, sheets or replacement movie have been accepted yet. Future sample images belong under `ref/demo/`; no earlier session's photos or photo-derived art supply this demo.

`game.title`, `game.subtitle` and fighter `description`, `specialMove: {name, description}` and `introTagline` metadata pass through ComfyUI, the builder and the runtime. The runtime stores the title/subtitle at the top of `assets/manifest.json` and the character fields on each fighter. Special descriptions drive the special pose and cut-in prompts; combat mechanics remain shared. `introTagline` supplies the on-screen introduction and the exact spoken line. The optional `introVoice` in `config/game.json` selects a stock ElevenLabs voice during workflow preparation; it is generation configuration, not a required runtime field.

## Audio bundle

`comfy-audio.json` writes `audio.json` beside `assets.json`, using schema `dad-fighter-audio/v1`, `root: "."`, `title`, and an `assets` array. Every entry has `id`, `kind: "audio"`, `category: "music" | "sfx" | "voice"`, a relative WAV `src`, SHA-256, sample rate, channel count and duration. Music records have `loop: true`; character special calls also have `fighter`.

Runtime IDs are `menu_music`, `yard_music`, `ann_select`, `ann_fight`, `ann_ko`, `ann_victory`, `sfx_punch`, `sfx_kick`, `sfx_block`, `sfx_special`, `fighter_<id>_special` and `fighter_<id>_intro` for each character. The complete workflow prepares **22 clips**: two music tracks, four announcer calls, four effects, six special calls and six intro taglines. Intro clips use six distinct stock voices for fictional performances, with no voice cloning. A text introduction still displays when its audio clip is absent from an accepted bundle.

The builder automatically reads both JSON files from the selected root. It copies audio to `assets/audio/`, maps it under runtime `audio`, and preserves `sources/audio.json` plus original WAVs for re-import. Audio paths and hashes are validated. Missing files in a supplied audio map fail strict export. If audio.json is absent, the builder explicitly reports that audio was not supplied. Local image and WAV processing do not perform model inference.

## Portable ComfyUI bundle

The main graph's Project Settings selects `<root_directory>`. Each factory node collects its editable names, descriptions, specials and taglines together with its generated images; the final exporter writes `assets.json` after every selected output finishes. Disabled environments are omitted. Every image is stored under that root with a content hash in its filename. Paths are relative so the whole directory can be moved:

```json
{
  "schema": "dad-fighter-assets/v1",
  "root": ".",
  "cloudOnly": true,
  "game": {
    "title": "Comfy Fighter Z",
    "subtitle": "Higgsfield Open Source Saga",
    "fighters": [], "stages": [], "sheets": {}
  },
  "assets": [{
    "id": "sample-fighter_sheet",
    "kind": "sprites",
    "fighter": "sample-fighter",
    "sheet": "sheet",
    "key": true,
    "poses": ["idle", "walk", "punch", "kick", "block", "hit", "special", "down", "win"],
    "src": "raw/sample-fighter_sheet-<hash>.png",
    "width": 2048,
    "height": 2048,
    "sha256": "<full SHA-256 of PNG bytes>"
  }]
}
```

This excerpt illustrates fields; a runnable bundle includes the actual roster, stages, sheet definitions, hashes, and all generated asset records. The builder accepts `assets.json` plus its selected root folder, verifies hashes, and uses `src` rather than guessing filenames. The final exporter rejects missing, duplicated, cross-root, or changed files. New raw images do not overwrite those referenced by an earlier complete manifest.

The browser export includes `assets/manifest.json` with processed PNG sprite paths and anchor geometry, `sources/assets.json` with the portable source mapping, `sources/raw/` with original sheets and artwork, and `assets/source-manifest.json` with provenance. It also includes the standalone game code and a small local server. The older CLI pipeline below emits equivalent runtime metadata with WebP files instead.

`npm run adopt:game -- --game <verified exported game directory>` installs optimized runtime media into the versioned `public/assets/`: WebP quality 94 and MP3 VBR quality 2, with source-reference previews limited to 1200 pixels on their longest side. It updates runtime paths and writes `production.json`; original PNG/WAV hashes continue to belong to the separate source bundle, not the re-encoded media. `npm run build` checks and preserves this accepted runtime before copying it to `dist/`.

Builder customizations change the game title, displayed fighter/stage names, roster selection, and fighter UI accents. They do not recolor baked sprite pixels or regenerate lettering inside an image. Replace those source assets through ComfyUI when changing the visual identity.

## CLI job plan

`assets/plan.json` is generated from `config/game.json` by `npm run workflows`. Each job identifies its kind, output PNG path, workflow, optional fighter/stage, and optional reference. Sprite and effects jobs also identify the nine cells to extract. The older CLI import/regeneration path uses that plan. The compact factory and direct builder export instead use the complete `assets.json` source mapping and its actual fighter/stage metadata, so custom IDs and supplied environments do not require editing the released game's plan.

## Fighter pose sheets

Each fighter has three square 3×3 sheets. Read cells left to right, then top to bottom. Every pose faces right; the renderer mirrors it for an opponent facing left.

| Sheet | Top row | Middle row | Bottom row |
| --- | --- | --- | --- |
| `sheet` | idle, walk, punch | kick, block, hit | special, down, win |
| `sheetB` | stance2, crouch, sweep | launcher, jump, airkick | hpunch, dash, tumble |
| `sheetC` | walk2, lkick, cjab | airpunch, throw, taunt | getup, powerup, entrance |

These are 27 key poses, not 27 consecutive animation frames. The game chooses and holds poses according to combat state. `stance2` is a second upright guard; `crouch` is the low guard. Keep these definitions distinct when editing prompts.

Generate all sheets from the same accepted character reference. Maintain face, proportions, outfit, palette, camera, and body scale. The saga prompts choose a common scale that accommodates the widest attack, request at least 12% empty margin on every cell edge, and keep standing feet near 82% of cell height. Both shoes must remain visible in the bottom row. Sweeps and airborne attacks must also point right. Use solid `#00ff00` with no grid lines, labels, ground shadows or detached aura clouds. Green garments and effects will be removed by the chroma keyer.

The builder normalizes sheet resolution, keys green, and isolates complete connected silhouettes using the nine nominal grid positions. This preserves hands and feet that extend slightly across cell boundaries. Long straight grid separators are removed; nearby detached particles stay with their closest pose. Ambiguous or missing silhouettes fail the build for review. Unkeyed sheets use equal-cell slicing. A shared fighter scale makes the idle pose about 400 pixels tall; it does not independently force every pose to that height. This preserves crouch/jump/knockdown size differences. Generated model inconsistency between sheets may still need correction.

Each pose is written as `assets/fighters/<fighter-id>_<pose>.webp` and described in the runtime manifest:

```json
{
  "src": "assets/fighters/sample-fighter_idle.webp",
  "w": 250,
  "h": 410,
  "ax": 125,
  "ay": 405,
  "top": 5,
  "bh": 400
}
```

`w/h` describe the trimmed image. `ax/ay` locate its ground anchor, `top` is the first opaque row, and `bh` measures opaque body height. The current anchor heuristic uses the lower opaque portion of the pose. A horizontal body or extended foot can shift it; review these poses carefully. The renderer places `(ax, ay)` at the fighter's world position and mirrors around that anchor.

## Other art

| Kind | Input | Build/runtime use |
| --- | --- | --- |
| Reference | One full-body design per fighter | Identity source for cloud generation; checked as a source image |
| Source | One generated fictional reference per character/stage | Preserved source design; used as a visibly marked preview when game artwork is absent |
| Portrait | Square character close-up | 320px select portrait and HUD portrait |
| Hero | Full-body selection art | 760px tall selection illustration |
| Cut-in | Wide attack illustration | 960px wide special-attack overlay |
| Stage | 16:9 side-on arena | 1600px wide fight background |
| UI | Title, select backdrop, logo, HUD frame, emblem | Manifest-driven screen decorations |
| Effects | One square 3×3 atlas | Keyed, sliced individual combat effects |

Effects use row-major order: `hit`, `block`, `projectile`, `dust`, `ko`, `powerup`, `dash`, `launch`, `spark`. They are individual effect images, not an animated sequence. Current combat renders the applicable effects; all entries are available in the Asset lab and manifest for extensions.

Stages should leave the central fight plane clear and put their ground line near 82% of image height. UI artwork must not bake gameplay numbers or changing health bars into an image; the game draws those values. Only the logo job asks the model to render lettering. A font-rendered game title remains available when the logo is absent.

## Reviewing generated art

An optional `video.json` companion uses `{"schema":"comfy-fighter-video/v1","root":".","openingVideo":{"id":"opening","src":"raw/opening.mp4","duration":25,"sha256":"<64 hexadecimal characters>"}}`. The builder verifies the MP4 hash, preserves the source map/movie, and maps it to `assets/video/opening.mp4` under runtime `openingVideo`. Unrelated asset merges preserve this companion. Adoption copies the accepted H.264/AAC movie without re-encoding it. See [the video workflow](video-workflow.md) for preparing and verifying the exact 25-second opening.

Before importing a full batch, inspect the raw sheets for exactly nine cells and the correct order. Verify the same character appears throughout, all faces point right, limbs are complete, and no pose spills into a neighboring cell. If a cell is wrong, regenerate that sheet using its individual workflow and the same accepted reference.

For an incremental update, the patch exporter writes only the selected replacement IDs. Keep its root separate from the accepted bundle. `npm run merge:assets -- --base <complete folder> --patch <patch folder> --out <new folder>` validates source hashes, replaces IDs already present in the base, retains unaffected images and optional audio/video, and requires the merged set to satisfy the base bundle's roster and pose contract. Consistent edited character/stage definitions accompany their accepted replacements; the merge does not substitute the canonical roster. Repeat `--patch` for accepted single-sheet repairs; later patches take precedence. New identities or additional venues must come from a complete factory bundle first. See [incremental refresh](incremental-refresh.md) for preparation and review steps. A partial manifest is not a standalone game bundle.

After importing and building, inspect the Asset lab on a contrasting background. Check green halos, accidental removal of clothing, white dividers, clipped outlines, and foot anchors. Play idle, walking, crouching, attacks and jumps on both sides of the arena to catch scale changes and sliding feet. Verify stages align with the game floor and UI overlays leave the fight visible. Review any generated title spelling yourself.

Strict builds reject missing and unprocessable planned files. They cannot recognize incorrect anatomy, swapped poses, inconsistent identities, poor typography, or a believable-looking but wrong grid. A successful strict build is not visual approval.

## Import selection and reproducibility

An import accepts `<job-id>.png` and ComfyUI counter names such as `<job-id>_00001_.png`. It selects the newest matching file by modification time and reports that choice; equal newest timestamps fail rather than choosing arbitrarily. Keep approved outputs in a dedicated import folder to make selections explicit. `build/import-report.json` records source selections and `build/asset-report.json` records build coverage and errors.

No image generation is part of `npm run build`. With `public/assets/production.json` present, it verifies and copies accepted runtime files. `--regenerate-assets` or `--from <ComfyUI/output>` explicitly invokes the older local import/image-processing path; use these only when intentionally replacing that runtime from staged inputs. Fixed seeds in the workflows are a request to the cloud provider, not a promise that repeated API calls return identical images.
