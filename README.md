# Comfy Fighter Z — Higgsfield Open Source Saga

Create an anime fighting game with your own fictional cast. ComfyUI generates the artwork; the browser builder turns its asset folder into a playable game directory or ZIP.

The default game has six fighters, one backyard arena called **The Yard**, and one human player versus the CPU. Each fighter has 27 poses, selection art, an introduction and a special move.

> **Included example:** six fictional fighters, The Yard, 162 poses and 22 music, effects and voice clips. The reviewed assets are included in [`example/`](example/README.md), so building this game requires no ComfyUI server, cloud account or generation credits. Regenerating the assets is optional.

![Included six-fighter example title screen](comfyui/docs/images/10-example-title.png)

*The included example, built from the fictional artwork in `example/bundle/`.*

## Watch the walkthrough

[![Play the Comfy Fighter Z workflow walkthrough](comfyui/docs/images/14-explainer-poster.jpg)](https://github.com/dhaakon/comfy-fight-z/releases/download/explainer-v1/comfy-fighter-z-explainer.mp4)

**[Watch or download the video — 2:53, 1080p](https://github.com/dhaakon/comfy-fight-z/releases/download/explainer-v1/comfy-fighter-z-explainer.mp4)** · [Transcript](https://github.com/dhaakon/comfy-fight-z/releases/download/explainer-v1/comfy-fighter-z-explainer.transcript.txt) · [Subtitles](https://github.com/dhaakon/comfy-fight-z/releases/download/explainer-v1/comfy-fighter-z-explainer.srt)

See the ComfyUI factories, fictional character generation, asset review and game export, with narration and captions. The video shows the earlier two-fighter walkthrough; the current six-fighter example and its build commands are below.

## 1. Build the included example

Install [Node.js 22 or newer](https://nodejs.org/en/download) and Git, then run:

```sh
git clone https://github.com/dhaakon/comfy-fight-z.git
cd comfy-fight-z
npm ci
npm run example
npm start
```

Open **[the builder](http://127.0.0.1:8080/builder/)** or **[the game preview](http://127.0.0.1:8080/)**. Leave the server terminal open and use a second terminal for later commands.

`npm run example` checks the included assets, builds and tests a game directory and ZIP, then installs the game in `output/game/`. It installs the pinned Chromium browser once if needed. Later builds use the installed browser; there are no model calls. The command prints the export paths.

To customize these assets, choose the repository's **`example/bundle/` folder** in the builder and continue at step 4. To generate a new cast, follow the steps below or the [combined example workflow guide](example/README.md).

![Builder with the six character factories and environment slots](comfyui/docs/images/03-builder-start.png)

## 2. Connect ComfyUI

For generation, use a local [ComfyUI installation](https://docs.comfy.org/installation/desktop/windows), a signed-in Comfy account and cloud credits. All models run through cloud/API nodes; no image checkpoints are needed.

Install this project's custom nodes into the ComfyUI instance you actually run:

```powershell
npm run nodes:install -- --comfy-root "C:\path\to\your\ComfyUI"
npm run workflows
```

On macOS/Linux, replace the path with your absolute ComfyUI directory. It must contain **`main.py` and `nodes.py`**—not this game's `comfyui/` folder.

Restart ComfyUI, reload its editor, then open **`comfyui/workflows/comfy-hackathon.json`**. You can also download this workflow from the builder. Enable **Nodes 2.0** for the interface shown here; that setting changes the renderer and does not install missing nodes.

The tested setup is ComfyUI 0.43.2 with frontend 1.57.4. See [Comfy's Partner-node requirements](https://docs.comfy.org/tutorials/partner-nodes/overview) for authentication and network setup.

## 3. Generate your artwork

![Main Comfy Fighter Z asset workflow](comfyui/docs/images/01-factory-overview.png)

The main workflow contains Project Settings, six Character Factories, three Environment Factories, Shared Art and one final exporter.

1. In **Project Settings**, set `root_directory` to a **fresh absolute folder**, such as `C:\games\comfy-fight-z\output\test-runs\my-game\bundle`. This is where ComfyUI writes the bundle; use a path on the ComfyUI server's machine.
2. Edit each character's name, description, special move and introduction tagline. Keep each `character_id` unique and stable.
3. Keep **Invent fictional reference** selected to create designs entirely from text. Image selectors can stay empty. To use a newly supplied fictional illustration, explicitly switch that factory to **Upload reference** and select its image.
4. Keep **Environment 1 / The Yard enabled**. Leave the other two environments disabled for the one-arena game; they make no model calls.
5. Review the cloud cost, then run the workflow and wait for the final exporter to finish.

![Character description, special move and fictional source mode](comfyui/docs/images/02-character-factory.png)

Descriptions guide the artwork; they do not change combat code. Give fighters distinct silhouettes and outfits. Avoid green clothing because the sprite processor removes chroma-green backgrounds.

| Complete image batch | Paid image calls | Approximate cost |
| --- | ---: | ---: |
| Six invented fighters + The Yard | 56 | $3.20 |
| Six invented fighters + all three environments | 60 | $3.48 |

Estimates use recorded November 3, 2026 rates; actual billing may vary. Audio, video and repairs cost extra. Running generation spends credits; opening or editing a workflow does not. If an agent submits it for you, approve the specific batch first.

For a smaller two-fighter trial, follow the [24-image test](comfyui/docs/advanced.md#try-a-smaller-generation-first).

The completed folder contains:

```text
bundle/
  assets.json
  raw/
    ...character designs, sheets, portraits, stages and shared artwork
```

Keep the whole folder together. Review all three sheets per fighter for complete hands and feet, consistent identity and nine correctly ordered poses. A valid file cannot guarantee a good drawing.

### Optional: add sound

Open **`comfyui/workflows/comfy-audio.json`**, set its **Asset Root to the same folder** as the image workflow, and run it after reviewing the separate cost. It adds `audio.json` and 22 clips for music, effects, announcements, special moves and introductions—about **$0.43** for the default dialogue.

If you changed names or taglines, update `comfyui/config/game.json` and run `npm run workflows:audio` before opening the audio graph. Canvas edits in the image workflow do not update audio automatically. Voices use stock presets, without voice cloning.

## 4. Export your game

In the [builder](http://127.0.0.1:8080/builder/):

1. Click **Choose asset folder** and select the folder containing `assets.json` and `raw/`.
2. Check the asset inventory. Customize the title, names, colors and roster; keep at least **two fighters and one arena**.
3. Leave **Allow placeholder assets unchecked** for a game using complete generated artwork.
4. Click **Build my game**, then **Download game ZIP** or **Save to a directory**.

![Builder with all 56 images and 22 audio clips ready to export](comfyui/docs/images/13-example-builder.png)

*The included bundle passes a strict build with all six fighters and The Yard. Download the finished ZIP or save its directory.*

Directory export needs a supported browser and a new, empty destination. Use ZIP if that option is unavailable. Selecting JSON alone loads metadata; the matching media folder is still required.

The export includes the game, processed sprites and original source bundle. To edit it again, load the export's **`sources/` folder** into the builder.

## 5. Play and share

Extract the ZIP, open a terminal **inside the exported game folder**, and run:

```sh
npm start
```

Open the printed URL, normally `http://127.0.0.1:8080/`. No `npm install`, ComfyUI or cloud account is needed to play. Stop the earlier preview server with Ctrl+C if it already uses that port.

Choose **ENTER THE SAGA**, your fighter and the CPU opponent, then **LET'S FIGHT**. Combat waits for the introductions to finish.

![All six fictional fighters in the included example](comfyui/docs/images/11-example-select.png)

| Control | Action |
| --- | --- |
| Arrow keys | Move, jump and crouch |
| A / S / D / F | Punch / kick / heavy strike / special |
| Hold away from the opponent | Block |
| Space | Skip introductions or the optional opening movie |
| Escape | Pause or resume combat |
| FULLSCREEN | Enter native fullscreen after a click |

![Generated Griddle and Rivet fighting in the fictional Yard](comfyui/docs/images/12-example-gameplay.png)

*Griddle versus Rivet in the included six-fighter game. Arrow keys and ASDF control your fighter; the opponent is the CPU.*

Serve the game over HTTP rather than double-clicking `index.html`. Share the complete ZIP or host the exported folder on a static web server.

## Where things live

| Folder | Contents |
| --- | --- |
| [`comfyui/`](comfyui/README.md) | Workflows, custom nodes and character/environment definitions |
| [`build/`](build/README.md) | Game and builder source, dependencies and tests |
| [`example/`](example/README.md) | Complete generated bundle, combined workflow and a free build command |
| [`output/`](output/README.md) | Generated bundles, local previews and exports |

`build/` contains source code. Use `npm run example` for the included generated game. The development command `npm run build` replaces `output/game/` with the canonical source preview; it does not rebuild the included example.

## Common fixes

| Problem | Fix |
| --- | --- |
| Missing CFZ nodes | Install into the running ComfyUI instance, restart it, reload the editor and reopen the workflow. |
| Output points to another computer | Run `npm run workflows` and set a fresh absolute Project Settings path. |
| Missing images or audio | Select the complete bundle; keep `assets.json`, optional `audio.json` and their mapped files together. |
| Changed game code is not visible | Run `npm run example` again and reload the browser to rebuild the included game with your changes. |
| Port is occupied | Stop the other server or choose another `PORT`; see the advanced guide. |
| Feet are clipped or poses drift | Review and repair the source sheet before exporting. |

For [configuration, audio, automated exports, optional video, repairs and tests](comfyui/docs/advanced.md), use the advanced guide. The [asset contract](comfyui/docs/asset-contract.md) documents the mapped files and pose order.

The [explainer video guide](comfyui/docs/explainer-video.md) includes the narration workflow, screen recorder and captioned video renderer.

Shipped designs are fictional. Keep private photos, retired media, credentials and raw generation runs out of published source and screenshots. Earlier Git history can still contain older files; the current demo does not use them.
