# Fictional opening movie and clean stage

`comfy-opening.json` is a cloud Seedance 2.5 reference-to-video workflow for one **25-second lifelike fictional opening**, with synchronized sound. Seven `CFZFictionalReference` custom nodes first generate six imaginary adult character designs and the configured fictional arena from text. They feed Seedance directly; the recipe contains no `LoadImage` nodes or previous-session filenames. The prompt derives each fighter, special move, paired exchange and environment detail from `config/game.json`. It translates those designs into a filmed martial-arts sequence without using real people's photographs or a real venue reference.

The startup player shows an installed opening movie before the title screen. **Space skips directly to the title**; natural completion also opens the title. A bundle without a movie starts at the title. The fictional demo excludes the older photo-derived movie; preparing its replacement workflow does not mean a new film has been generated or installed.

## Prepare and validate

Prepare the standalone opening recipes without an existing asset bundle:

```powershell
node tools/prepare-cinematic-workflows.cjs --templates-only
```

This command writes `comfy-opening.json` and the 1080p/720p alternatives under `workflows/video/`. It does not write a run plan, create a stage-edit workflow, upload files or submit generation. `npm run workflows` includes this step. No fictional reference images need to exist first: the custom nodes generate them when an authorized run is submitted. The demo references and replacement movie are currently pending generation.

Once a complete fictional bundle has been generated and accepted, prepare an optional stage repair alongside the opening alternatives:

```powershell
node tools/prepare-cinematic-workflows.cjs --base "C:\assets\accepted-fictional-bundle" --out "C:\assets\cinematic-run"
```

The explicit `--base` must contain the accepted fictional `assets.json`, its configured stage PNG and its fictional environment `source` image. Its roster must match the current fictional configuration. The tool writes `plan.json`, two alternative opening workflows, and a separate `yard-clean.json` image-edit workflow under the new run's `workflows/`. The stage-edit filename is retained for compatibility; its actual asset ID and prompt follow `config.stages[0]`. The tool also refreshes the reusable opening recipes. The opening still creates seven fresh references internally; only the separate stage edit uses the two accepted images from the base bundle.

The installed `ByteDance2ReferenceNodeV2` schema supports Seedance 2.5 clips from **4 to 30 seconds in one-second steps**, at 480p, 720p or 1080p. This recipe uses 16:9, 25 seconds, seven reference images and native audio. The live node accepts up to 30 image references; no video/audio reference inputs are connected here. The seed controls rerunning/caching and does not promise deterministic visual results.

Use the ComfyUI MCP to confirm the server and validate the workflow against the installed node catalog, including this repository's custom node pack. The opening requires no image uploads. For the optional stage edit, upload only the two exact files in `plan.json.uploads`: the accepted fictional environment source and stage illustration. The two video workflows are alternatives, so submit only one.

At the installed ComfyUI price badges checked on November 3, 2026, the seven reference calls cost **$0.36036**: six 1K images at $0.048048 each and one 2K environment at $0.072072. These calls are additional to the video charge and are included in every opening total below:

| Optional run | Requests | Estimated total |
| --- | --- | --- |
| 1080p opening | Seven reference images + one 25-second video | $20.72 |
| 720p opening | Seven reference images + one 25-second video | $8.64 |
| 1080p opening + stage edit | Seven reference images + one 25-second video + one 2K edit | $20.79 |
| 720p opening + stage edit | Seven reference images + one 25-second video + one 2K edit | $8.71 |
| Stage edit only | One 2K image edit | $0.072 |

The video charges alone are approximately $20.362 at 1080p and $8.276 at 720p. These are estimates, not an authorization; actual billing may vary. Recheck live prices and obtain spending authorization for this optional batch before generation. The opening is excluded from the prepared fictional image/audio demo batch. No paid retry is included automatically. Preparation, validation, assembly and game builds do not call a model.

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

## Remove a stage border and integrate

`yard-clean.json` uses the accepted stage artwork as the edit target and its generated environment design as a reconstruction reference. It asks Gemini Nano Banana 2.1 to remove only superimposed directional speed lines, radial rays and comic borders, preserving the configured architecture or landscape, composition, lighting and fight plane. Actual structural lines remain. It writes a partial `assets.json` containing only the configured stage ID under `stage-patch/`.

Inspect all four stage edges and review the full movie for consistent fictional designs, actual motion, sound and coherent action. Then merge only accepted outputs into a complete fictional bundle:

```powershell
npm run merge:assets -- --base "C:\assets\accepted-fictional-bundle" --patch "C:\assets\cinematic-run\stage-patch" --patch "C:\assets\cinematic-run\video-patch" --out "C:\assets\cinematic-complete"
npm run build:bundle -- --bundle "C:\assets\cinematic-complete" --out "C:\assets\cinematic-export"
npm run adopt:game -- --game "C:\assets\cinematic-export\game"
npm run build
```

For a stage-only update, omit the video patch. The merge retains all unaffected image/audio/video files, and adoption preserves the existing game code. Use a fictional base bundle so retained media cannot reintroduce the previous cast. Confirm opening playback, natural completion, Space-to-title skipping and clean stage edges in the browser. `config.stageStyle` keeps future stage generations separate from the decorative UI art direction so menu speed-line accents do not return to the arena.
