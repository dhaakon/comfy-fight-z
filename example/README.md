# Comfy Fighter Z: complete example

Build a complete browser fighting game from the included generated assets, then customize it or generate your own cast.

**Verified example:** the complete generated bundle is included in `example/bundle/`. A fresh checkout passed dependency installation, strict export, and browser gameplay checks: **seven fighters (six plus the final boss), three arenas, 315 poses, and 99 audio clips**. Building this example never generates missing assets or spends cloud credits.

## Build and play

Install [Node.js 22 or newer](https://nodejs.org/), then run these commands from the repository root:

```sh
npm ci
npm run example
npm start
```

Open **http://127.0.0.1:8080/**. The local build needs no ComfyUI server, API key, cloud credits, or FFmpeg. It downloads the project's pinned Chromium browser once if needed for gameplay verification.

**ARCADE** is the default: pick a fighter and climb a CPU ladder through every rival, with continues and a high-score table. **VERSUS** takes a second player on a gamepad, and **TRAINING** adds hitboxes, frame data and a configurable dummy. **Arrow keys** move, jump, and crouch; **A** punches, **S** kicks, **D** uses a heavy strike, and **F** uses the special. **G** taunts; **A+S** rolls, **S+D** performs a blowback and **F+D** a super. The pause menu's command list shows each fighter's moves. The game fills the browser window; its fullscreen button enters native fullscreen.

New builds also offer **ONLINE VERSUS** for an invited opponent and **PHONE / TV** for one phone against the CPU or two phones on a shared display. Phones have a stick, four attack buttons (press two together for a roll, blowback or super) and a taunt button. Follow the [multiplayer and phone guide](../build/docs/multiplayer.md). For local phone play, open the server's printed **Phone / LAN** address on the display before creating the session.

The example contains:

- Six fictional fighters (Griddle, Rivet, Tempo, Nimbus, Switchback and Brick) and the final boss, Baron Bylaw.
- Five 3×3 sheets per fighter: **315 named poses** in total (27 key poses and 18 arcade in-betweens each). Each fighter also has a portrait, a selection hero, a super-move cut-in and an ending illustration.
- Three arenas: **The Yard**, **Sunset Rooftop** and **Midnight Arcade**, with title, selection, HUD, logo, and effects artwork.
- **89 mapped images and 99 audio clips:** ten music tracks, twenty announcer calls, twenty effects, and seven voice lines per fighter.

The arcade material was added to the earlier six-fighter release on November 4, 2026 with the [arcade expansion](../README.md#optional-expand-a-classic-bundle-to-the-arcade-cast). That run made 33 images and 99 clips, then three single-sheet repairs, for **$4.57** of cloud generation. The earlier release remains in Git history. `npm run example` accepts either release, but each must be complete.

All character and environment sources are invented from text. No real-person photos, earlier private media, or opening film are included. The generation template's three environment slots are all used.

For a separate demonstration that first invents realistic phone snapshots and then uses them as uploaded game references, see [Phone snapshots → Comfy Fighter Z](phone-photos/README.md). That new demonstration is under review; it does not replace this included example or change `npm run example`.

## Find your game and customize it

Each build creates a fresh folder under `output/example/` containing:

```text
<timestamp>/export/
  game/             Self-contained browser game
  game.zip          Shareable game archive
  build-test.json   Strict build and gameplay results
```

The command also installs the verified game into `output/game/`, which `npm start` serves. A previous installed preview is backed up under `output/diagnostics/game-install-*`. The command prints the exact paths when it finishes.

To customize the included artwork, open **http://127.0.0.1:8080/builder/** and choose the entire `example/bundle/` folder. Change the title, fighter labels, or interface colors, then export a new game directory or ZIP. These controls change game metadata and presentation; they do not repaint the generated images.

Useful build options:

```sh
npm run example -- --out output/example/my-game/export
npm run example -- --no-install
npm run example -- --no-install-browser
```

Use a fresh output folder. `--no-install` creates the export while preserving the currently installed game. `--no-install-browser` requires Chromium to be installed already. Running `npm run build` instead of `npm run example` restores the source preview.

## Generate a new example with ComfyUI

Regeneration is optional and uses paid cloud models. Editing [config.json](config.json) affects future generation; it does not change the bundled artwork. Describe each fighter, their special and super moves, introduction, win quote and ending there. Keep the standard pose layouts, the seven-fighter arcade cast and its three arenas for this example.

Install the included custom pack into the ComfyUI instance you actually run, restart its server, and reload the editor:

```sh
npm run nodes:install -- --comfy-root "<ComfyUI folder>"
```

Use the server folder containing `main.py` and `nodes.py`. Sign in to Comfy for its cloud models. Prepare a fresh run, checking the current installed price badges:

```sh
npm run example:prepare -- --out output/example/my-run --check-live-prices
```

Preparation writes a plan and workflow files; it does **not** submit generation. Without `--check-live-prices`, preparation works offline using the recorded estimate. If ComfyUI uses another address, add `--server http://127.0.0.1:8188` with your actual address.

Open **`output/example/my-run/workflow.json`** in ComfyUI. The shipped [workflow.json](workflow.json) is a muted review template with a portable placeholder; use the prepared copy to run it. One Project Settings node supplies the output folder to both image and audio exporters.

Review `plan.json`, validate the prepared graph, and approve the exact cloud spend before queueing through the MCP. The default batch is **89 image calls plus 99 audio calls, approximately $7.05** at the checked rates. Actual provider billing may vary. No automatic paid retries or video generation are included.

The run creates `output/example/my-run/bundle/assets.json`, `audio.json`, and their `raw/` media. Review every sprite sheet and listen to the audio, then load the complete bundle in the builder to export your custom game. Fighter descriptions guide the art; the existing combat rules remain shared across the cast.

## What the bundle verifies

The included `bundle/assets.json` and `bundle/audio.json` map every source file by asset ID and SHA-256 hash. `bundle/provenance.json` records original and packaged hashes, confirms pixel-identical lossless WebP images, and records the audio conversion metadata. Audio is packaged as MP3; original cloud outputs stay in the maintainer's separate generation run.

`npm run example` checks the bundled records, hashes, and required roster/media before building, then runs strict export and browser gameplay checks. Read the resulting `build-test.json` for that build's outcome. Additional workflows are in the [advanced guide](../comfyui/docs/advanced.md).

For maintainers, `npm run example:package -- --bundle <reviewed generated bundle> --plan <plan.json>` packages a new source bundle. When the bundle was merged onto the current example, add `--previous example/bundle/provenance.json` so unchanged images keep their original generation record. This separate maintenance command requires FFmpeg, verifies image pixels, preserves original media, and refuses to overwrite an accepted bundle. It performs no model inference.
