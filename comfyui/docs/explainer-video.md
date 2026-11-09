# Reproduce the Comfy Fighter Z explainer

[Watch or download the finished walkthrough (2:53, 1080p)](https://github.com/dhaakon/comfy-fight-z/releases/download/explainer-v1/comfy-fighter-z-explainer.mp4). The [video release](https://github.com/dhaakon/comfy-fight-z/releases/tag/explainer-v1) also includes subtitles, a transcript and chapter timestamps. It shows the earlier two-fighter demonstration; the [current README](../../README.md) builds the included six-fighter example with audio.

The explainer combines real ComfyUI and builder recordings, four motion cards, and twelve separately generated narration clips. The output is a 1920 × 1080, 30 fps MP4 with captions, a transcript, chapter timestamps, and a poster. It targets about three minutes; the final length follows the actual narration.

The footage shows the completed **two-fighter example**, Griddle and Rivet in The Yard: 24 generated images and 54 poses. The main six-character template remains intact. The example has no generated game audio or opening film; the explainer narration is separate.

## Before recording

- Follow the [project setup](../../README.md). Use Node.js 22+, install the dependencies with `npm ci`, and have the custom node pack working in ComfyUI.
- Install Playwright Chromium with `npm --prefix build exec -- playwright install chromium`. Put FFmpeg and FFprobe on your `PATH`; the renderers need `libx264`, `libvpx-vp9`, and the `ass` subtitle filter.
- Have a reviewed, generated game and its complete source bundle available locally. Generated media under `output/` is not included in a fresh clone. The [advanced guide](advanced.md) explains how to prepare the smaller cloud smoke run.
- Serve the generated game with `npm start` and open ComfyUI. Do not run `npm run build` over an installed generated example: that command restores the source preview. The recorder accepts your actual game URL; `npm start` defaults to port 8080.

All commands below run from the repository root. Replace `my-explainer` with a fresh run name and the sample bundle path with your reviewed bundle.

## Prepare and approve the narration

The script and storyboard are in [config/explainer.json](../config/explainer.json). Each scene has an `id`, `title`, spoken `narration`, relative `audio` and `visual` paths, and visual directions. Keep delivery tags in `voice.deliveryTag`; they do not belong in the spoken captions. Keep the twelve scene IDs when using the supplied recorder and cards.

```powershell
node comfyui/tools/prepare-explainer.cjs --out output/explainer/my-explainer --server http://127.0.0.1:8188
```

This reads the installed voice-node schemas and current price badge. It creates `storyboard.json`, `plan.json`, `workflow.json`, `workflow.api.json`, `narration.txt`, and the price receipt. It **does not generate audio**. Preparation rejects redirected output folders and refuses to overwrite any existing prepared artifacts; a folder containing only captures can be used.

For the supplied script, the reviewed estimate is:

| Item | Prepared value |
| --- | --- |
| Voice | Stock Brian, Eleven v4 |
| Spoken script | 394 words |
| Paid requests | 12 text-to-speech clips |
| Billed input estimate | 3,112 characters, including delivery tags |
| Checked rate | $0.1144 per 1,000 characters |
| Estimated narration total | $0.3560128, approximately **$0.36** |

The rate was checked against the installed node on November 3, 2026. Actual provider billing may vary. Changed text changes the estimate; a changed live rate stops preparation for review. The image-generation examples discussed in the video are separate costs.

Review the exact script, plan, and workflow, validate the graph through the Comfy MCP, and obtain explicit approval of that paid narration batch before submitting it. Use the **run folder's** `workflow.json` or `workflow.api.json` so the output prefix matches the plan. The reusable `comfyui/workflows/audio/explainer-narration.json` is an example graph, not an automatically refreshed copy of every new run. There are no automatic paid retries.

The graph uses one stock voice selector, twelve text-to-speech nodes, and twelve `SaveAudioAdvanced` nodes set to FLAC. It has no uploaded audio, voice-cloning, or image inputs. ComfyUI saves the clips beneath its configured output folder using:

```text
comfy-fighter-z/explainer/my-explainer/<scene-id>_<counter>.flac
```

After the authorized run, download the outputs through the MCP into the run's `narration/` folder. MCP may rename downloads to job-and-index filenames. Use each returned file's URL (`filename` query parameter) to match `plan.json` → `clips[].downloadPattern`, then copy its returned local path to `clips[].localAudio`, for example:

```text
output/explainer/my-explainer/audio/01-result.flac
output/explainer/my-explainer/audio/02-setup.flac
...
output/explainer/my-explainer/audio/12-next-steps.flac
```

Keep the original downloads and their filename mapping as receipts. Check all twelve clips for missing words or unwanted spoken delivery tags before editing.

## Record the interfaces and render the cards

The recorder captures eight scenes from the local ComfyUI editor, builder, and game. It blocks ComfyUI generation requests. Its builder export is a local build using the supplied bundle.

```powershell
node build/tools/capture-explainer.cjs --comfy-url http://127.0.0.1:8188 --game-url http://127.0.0.1:8080 --bundle output/test-runs/my-smoke/bundle --out output/explainer/my-explainer/captures
```

Use `--scene 09-builder`, for example, to record just one interface scene. Inspect the recordings for readable text, complete clicks, and unintended personal information before rendering the final video.

Render the four original motion cards:

```powershell
node build/tools/render-explainer-cards.cjs --out output/explainer/my-explainer --game output/exports/my-smoke/game
```

Pass a verified two-fighter, one-arena game export, including its passed `build:bundle` receipt, for the card artwork and sheet. Without `--game`, the renderer uses the original local smoke export; a source checkout alone does not contain it. The four card IDs are `02-setup`, `03-custom-nodes`, `08-review-bundle`, and `12-next-steps`. Pass `--scene` to render one card. These recording and rendering commands do not call a model.

## Compose and review

Use the run's frozen storyboard so later script changes cannot change an approved edit:

```powershell
node build/tools/compose-explainer.cjs --root output/explainer/my-explainer --config output/explainer/my-explainer/storyboard.json
```

The composer requires all mapped visuals and audio. It measures each clip, adds about half a second of breathing room, and fits the footage to that duration. Captions use the exact script with estimated phrase timing, so review their synchronization by watching the result. No background music is added.

The run folder receives:

- `comfy-fighter-z-explainer.mp4` — H.264 video with narration and burned-in captions.
- `comfy-fighter-z-explainer.srt` — separate subtitle file.
- `comfy-fighter-z-explainer.transcript.txt` and `.chapters.txt`.
- `comfy-fighter-z-explainer.poster.jpg` and `render-report.json`.

Use `--scene 09-builder` for a single-scene preview. `--silent-preview` creates a visibly labeled, silent review using storyboard timing when narration is not yet available. Existing final renders are preserved unless `--overwrite` is supplied; that option archives them before replacement. Intermediate files stay beneath the run's `work/` folder.

Watch the complete MP4 before sharing: verify the two-fighter disclosure, cost labels, readable controls, narration, captions, and closing repository link. Keep the generated movie and raw recordings in `output/` rather than committing them as source files.

## The 90-second teaser

The teaser is a second, shorter piece with its own storyboard, [config/teaser.json](../config/teaser.json) (`kind: teaser`, a fixed 90-second timeline). It opens on a generated behind-the-scenes clip, shows the pipeline from a cast file to a playable game, and spends most of its time on the game engine. Its narration, music and opening clip are generated through ComfyUI; everything else is a real screen recording of the games, the run graph in the ComfyUI editor, and cards drawn from the pipeline's own files.

The run folder is `output/explainer/<run>`; the commands below use `teaser-v2-20261109`.

1. **Narration.** `node comfyui/tools/prepare-explainer.cjs --config comfyui/config/teaser.json --out output/explainer/teaser-v2-20261109` writes the Eleven v4 graph and its estimate (about $0.19 for ten scenes). Submit the run folder's `workflow.api.json` with `node comfyui/tools/run-sequential.cjs` once the estimate is approved, then `node comfyui/tools/place-narration.cjs --out output/explainer/teaser-v2-20261109` copies the clips from ComfyUI's output folder, trims their silence into `audio/<scene>.flac` and reports each scene's tempo. The composer refuses a scene that needs more than 1.35x; shorten that scene's text or give it more seconds and re-record only that scene.
2. **Music.** One `SoniloTextToMusic` node saved as `audio/teaser-music.flac` (90 s, $0.225). The storyboard's `music` and `musicLUFS` place it under the whole piece, ducked by the narration.
3. **Opening clip.** `node build/tools/teaser-intro.cjs frames` renders the two stills: the real run graph in the ComfyUI editor as the first frame and the title art under the Comfy Fighter Z logo as the last. `prepare` writes `intro.api.json` and prices the clip from the installed node's own badge (Seedance 2.0 at 1080p, about $0.54 a second; 8 s about $4.30). `run --approve-usd <amount>` uploads the stills, submits `ByteDance2FirstLastFrameNode` with the account's API key attached to the prompt (a multi-minute partner render polled with the server's login token can lose that token mid-way and still be billed), and saves `stills/intro-seedance.mp4`. The `intro` block of the storyboard holds the prompt and settings; the clip is read by the `01-intro` scene.
4. **Recordings.** `node build/tools/capture-teaser.cjs --out output/explainer/teaser-v2-20261109` records every scene from the local games (`--game-url`, default port 8096 with every installed game mounted), the run graph in the ComfyUI editor (writes intercepted, queue panel and wallpaper hidden, personal paths replaced) and the HTML cards. `--scene <id>` re-records one scene; `--card pipeline --png <file>` screenshots a card early and settled to check its design before recording. The `01-intro` scene pads the Seedance clip to its length instead of recording anything.
5. **Compose.** `node build/tools/compose-explainer.cjs --root output/explainer/teaser-v2-20261109 --config comfyui/config/teaser.json` cuts the ten scenes with captions (`captionText` where the voice spells an address), writes the MP4, SRT, transcript, chapters and poster. Review the contact sheet and the tempo report before sharing.

Nothing here runs without the approval amounts above, and the whole run is reproducible from the storyboard and the files it names.
