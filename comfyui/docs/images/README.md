# Screenshot guide

These PNGs were captured from running local interfaces on November 3, 2026 (UTC). Screenshots 01–07 show the fictional asset factory, builder and media-free source prototype. Screenshots 08–09 show a separately generated and verified two-fighter game. Screenshots 10–13 show the complete six-fighter game and builder using the included `example/bundle/`. All are direct browser screenshots without compositing or reused private images.

| Screenshot | What it shows |
| --- | --- |
| [01-factory-overview.png](01-factory-overview.png) | The main ComfyUI graph: project settings, six character factories, three environment factories, shared art and the final mapped asset export. All image selectors are empty; the two extra environments are disabled. |
| [02-character-factory.png](02-character-factory.png) | Griddle's fictional description, Sizzle Burst special, introduction tagline and Invent fictional reference mode. |
| [03-builder-start.png](03-builder-start.png) | The browser builder's six character slots and three environment slots, with The Yard enabled and two optional environments turned off. |
| [04-builder-customize.png](04-builder-customize.png) | The example asset map loaded into the roster editor. Names and accent colors are editable; the cards explicitly report that artwork is pending. |
| [05-export-ready.png](05-export-ready.png) | A prototype export after explicitly enabling placeholder assets. It shows 0/56 source images found and identifies the result as a prototype. This is not a generated-art release. |
| [06-game-title.png](06-game-title.png) | The current Comfy Fighter Z title and Higgsfield Open Source Saga subtitle, with the fictional-art-pending message. |
| [07-gameplay.png](07-gameplay.png) | One human fighter versus the CPU using the game's existing primitive fallback rendering. The arena visibly identifies these as prototype fighters. |
| [08-smoke-title.png](08-smoke-title.png) | Title screen from the verified two-fighter game, with cloud-generated fictional artwork and the Higgsfield Open Source Saga subtitle. |
| [09-smoke-gameplay.png](09-smoke-gameplay.png) | Generated Griddle and Rivet sprites fighting in the fictional Yard. This example has two fighters, not the full six-fighter roster. |
| [10-example-title.png](10-example-title.png) | Title screen of the complete included example, with Comfy Fighter Z and Higgsfield Open Source Saga branding. |
| [11-example-select.png](11-example-select.png) | All six newly generated fictional fighters, their selection artwork, special moves and The Yard. |
| [12-example-gameplay.png](12-example-gameplay.png) | Griddle versus CPU Rivet using the included sprites and fictional Yard. |
| [13-example-builder.png](13-example-builder.png) | The included bundle loaded in the builder: six fighters, 18 sheets, 56/56 images, 22/22 audio clips and a completed export with placeholders disabled. |

[`14-explainer-poster.jpg`](14-explainer-poster.jpg) is copied unchanged from the finished explainer's poster. It links to the narrated [workflow walkthrough](https://github.com/dhaakon/comfy-fight-z/releases/tag/explainer-v1), which shows the earlier two-fighter example. [`15-phone-photo-explainer.jpg`](15-phone-photo-explainer.jpg) is the poster of the [phone-photo walkthrough](https://github.com/dhaakon/comfy-fight-z/releases/tag/phone-photo-demo-v1), and [`16-teaser-poster.jpg`](16-teaser-poster.jpg) is the logo frame of the 90-second teaser's second cut (release `teaser-v2`), taken from the composed video at 8.6 seconds. These three are frames of generated or recorded video, separate from the direct browser screenshots above.

## Complete included example provenance

Screenshots 10–12 were copied unchanged from the successful strict build of `example/bundle/`. ComfyUI generated 56 images and 22 audio clips in one approved batch; one additional approved Tempo sheet repair replaced a duplicated recovery pose. All 18 sheets and the repaired extraction were visually reviewed. The resulting game has 162 mapped poses and passed browser image/audio decoding, introduction, CPU and player-control checks without placeholders.

The same bundle passed a separate fresh-install test with no copied dependencies, no ComfyUI connection and no access to the original repository. Run `npm ci`, `npm run example` and `npm start` to build and play it. The source media, hashes and generation/repair provenance are included in [`example/bundle/`](../../../example/bundle/); the generated exports and test reports stay under ignored `output/`.

Screenshot 13 is a separate 1440×1000 browser capture after importing that same bundle into the local builder and completing a strict export. It shows the actual generated portrait previews and export controls without changing the interface styles or asset data.

## Earlier two-fighter smoke-test provenance

Screenshots 08–09 were copied unchanged from the browser captures of a successful strict `build:bundle` export. ComfyUI generated 24 source images from text-only fictional designs; the build produced 54 mapped poses and passed runtime image, introduction, CPU and player-control checks without placeholders. No audio or video was generated for this test, and no real-person or real-venue photographs were inputs.

The source bundle and exported game remain local under ignored `output/` folders; only these reviewed screenshots are included here. They do not indicate that the canonical six-fighter source demo has accepted artwork. See [the smaller-generation walkthrough](../advanced.md#try-a-smaller-generation-first) to reproduce the process with a new authorized run.

## Prototype interface provenance

The ComfyUI captures load [the main workflow](../../workflows/comfy-hackathon.json) into a fresh, isolated browser context. Its output root is changed only in that browser to `C:/comfy-fighter-z/output/test-runs/first-game/bundle`; the workflow file is unchanged, and this sample directory is never used for generation. No personal paths, account details, old reference photographs or photo-derived media are included.

The capture script verifies that all custom nodes resolve, all nine factory image selectors are blank and use Invent mode, and no image previews are loaded. It checks that the example builder fails a strict build before placeholder consent, then explicitly enables placeholders for the prototype screenshot. The game captures require the fictional pending manifest with no image, audio or video assets.

## Recapture the prototype interfaces (01–07)

The commands below rebuild the canonical source preview and capture only screenshots 01–07. They do not recreate or overwrite the generated-game screenshots 08–13. Rebuilding also replaces an installed local game preview with the canonical source preview.

Use [build/tools/capture-readme.cjs](../../../build/tools/capture-readme.cjs) from the repository root. Node.js 22+, the npm dependencies, a Playwright-compatible Chromium browser and a running local ComfyUI server are required:

```powershell
npm ci
npm run build
```

Install Playwright's matching browser if it is not already available:

```powershell
node build/node_modules/playwright/cli.js install chromium
```

Alternatively, point Playwright at an already installed compatible Chromium executable for this shell:

```powershell
$env:PLAYWRIGHT_EXECUTABLE_PATH = 'C:\path\to\chromium\chrome.exe'
```

Install the project custom nodes into the ComfyUI instance you intend to capture, restart that instance, and enable Nodes 2.0. See [the factory guide](../workflow-factory.md). With ComfyUI running at `http://127.0.0.1:8188`, run:

```powershell
node build/tools/capture-readme.cjs
```

The script starts its own game preview server on an available loopback port, serving the existing `output/game/` build, and stops that server when finished. It overwrites only the seven named screenshots and writes a capture report to `output/diagnostics/readme-capture.json`, including checks, dimensions, byte counts and SHA-256 hashes. The report stays outside Git.

To use a game preview already running at port 8089, pass both local URLs explicitly:

```powershell
node build/tools/capture-readme.cjs --comfy-url http://127.0.0.1:8188 --game-url http://127.0.0.1:8089
```

If needed, start that preview in a separate terminal with:

```powershell
$env:PORT = '8089'
npm start
```

Both URL flags accept local loopback servers only. `PLAYWRIGHT_EXECUTABLE_PATH` affects the capture browser; `PORT` affects a separately started game preview. Neither changes the ComfyUI port.

The capture script never queues a workflow. It blocks ComfyUI HTTP writes, including execution and autosave, and handles panel/minimap preference changes only within the isolated browser. No cloud model calls, uploads or paid jobs are needed. Review every newly captured image before committing it; future generated-art screenshots need their own accurate captions and provenance.
