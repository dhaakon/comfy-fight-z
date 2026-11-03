# Opening movie and clean Yard stage

`comfy-opening.json` is a cloud Seedance 2.5 reference-to-video workflow for one **25-second live-action opening**, with synchronized sound. The six original character photographs identify the cast; the seventh image identifies The Yard's indoor venue. The prompt describes a filmed martial-arts sequence with practical-looking gold/cyan/magenta energy effects, natural faces and clothing, and original music. It preserves the game's original people and powers, without franchise characters or costumes.

The startup player shows an installed opening movie before the title screen. **Space skips directly to the title**; natural completion also opens the title. An older bundle without a movie starts at the title. Preparing a workflow does not mean its movie has been generated or installed.

## Prepare and validate

```powershell
node tools/prepare-cinematic-workflows.cjs --base "C:\assets\accepted-saga-bundle" --out "C:\assets\cinematic-run"
```

The accepted base must contain `assets.json` and its current Yard PNG. The tool writes `plan.json`, two alternative opening workflows, and a separate `yard-clean.json` image-edit workflow under the new run's `workflows/`. It also writes the reusable 1080p recipe to `comfy-opening.json` and both video alternatives to `workflows/video/`.

The installed `ByteDance2ReferenceNodeV2` schema supports Seedance 2.5 clips from **4 to 30 seconds in one-second steps**, at 480p, 720p or 1080p. This recipe uses 16:9, 25 seconds, seven reference images and native audio. The live node accepts up to 30 image references; no video/audio reference inputs are connected here. The seed controls rerunning/caching and does not promise deterministic visual results.

Use the ComfyUI MCP to confirm the server, upload the exact `plan.json.uploads` files, and validate each workflow against the installed node catalog. Uploads include the six character photos, original venue photo and accepted Yard illustration. The two video workflows are alternatives, so submit only one.

At the live prices checked on November 2, 2026:

| Authorized choice | Requests | Estimated total |
| --- | --- | --- |
| 1080p opening + Yard edit | One 25-second video + one 2K image edit | $20.44 |
| 720p opening + Yard edit | One 25-second video + one 2K image edit | $8.35 |
| Yard edit only | One 2K image edit | $0.08 |

These are estimates; actual billing may vary. Recheck live prices and obtain spending authorization before generation. No paid retry is included automatically. Preparation, validation, assembly and game builds do not call a model.

## Generate, fetch and assemble

For the approved workflow, the MCP sequence is `auth_status`, `run_workflow` with `wait: false` and authorized `confirm_spend: true`, then `job` status/wait calls. Fetch the completed output with `fetch_outputs` using its `prompt_id` and a local `out_dir`. Keep the prompt ID and result receipt; if submission reports an error, check the queue/history before resubmitting.

The video Save node writes `ComfyUI/output/comfy-fighter-z/opening/opening-<resolution>_*.mp4`. After fetching and visually reviewing that actual movie, normalize it for browser playback:

```powershell
node tools/assemble-opening.cjs --input "C:\assets\cinematic-run\downloaded\opening.mp4" --out "C:\assets\cinematic-run\video-patch"
```

Assembly requires FFmpeg and FFprobe. It preserves the source dimensions and encodes H.264, YUV420P, AAC stereo and MP4 faststart. The video contains 600 frames at 24 fps: 25 seconds. Only small provider timing differences are trimmed/padded; sources shorter than 24.75 seconds, longer than 25.5 seconds, missing generated audio or outside 16:9 are rejected. It never turns a still image or short clip into a purported full opening. AAC container bookkeeping may differ by a few milliseconds; `video-build.json` records both stream and container durations.

The separate output contains:

```text
video-patch/
  video.json
  video-build.json
  raw/opening.mp4
```

`video.json` is the portable companion map:

```json
{
  "schema": "comfy-fighter-video/v1",
  "root": ".",
  "openingVideo": {
    "id": "opening",
    "src": "raw/opening.mp4",
    "duration": 25,
    "sha256": "<SHA-256 of the final MP4 bytes>"
  }
}
```

The builder verifies the mapped file/hash and copies it to `assets/video/opening.mp4`, with `openingVideo` in the runtime manifest. Existing image/audio contracts are unchanged.

## Remove the Yard border and integrate

`yard-clean.json` uses the accepted Yard artwork as the edit target and the original venue photo as a reconstruction reference. It asks Gemini Nano Banana 2.1 to remove only the superimposed directional speed lines, radial rays and comic border, preserving the indoor architecture, composition, lighting and fight plane. Actual ceiling beams, pipes and railings remain. It writes a partial `assets.json` containing only `yard` under `stage-patch/`.

Inspect all four stage edges and review the full movie for recognizable people, actual motion, sound and coherent action. Then merge only accepted outputs into a complete bundle:

```powershell
npm run merge:assets -- --base "C:\assets\accepted-saga-bundle" --patch "C:\assets\cinematic-run\stage-patch" --patch "C:\assets\cinematic-run\video-patch" --out "C:\assets\cinematic-complete"
npm run build:bundle -- --bundle "C:\assets\cinematic-complete" --out "C:\assets\cinematic-export"
npm run adopt:game -- --game "C:\assets\cinematic-export\game"
npm run build
```

For a stage-only update, omit the video patch. The merge retains all unaffected image/audio/video files, and adoption preserves the existing game code. Confirm opening playback, natural completion, Space-to-title skipping and the clean Yard in the browser. `config.stageStyle` keeps future full stage generations separate from the decorative UI art direction so menu speed-line accents do not return to the arena.
