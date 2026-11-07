# New-game runbook

How to turn a cast file into a complete, installed Comfy Fighter Z game with five commands. Written so that a
person or an LLM agent can follow it verbatim; every step is a plain Node command, every output is a file, and the
only step that spends money says so and refuses to run without an explicit approval.

```
cast file ──prepare──▶ run folder ──run (paid)──▶ bundle ──review──▶ grids ──export──▶ strict export ──install──▶ /<slot>/
```

## 0. Prerequisites (once per machine)

| Need | Check | Fix |
| --- | --- | --- |
| Node 22 and the build dependencies | `node --version`, `ls build/node_modules` | `npm ci` |
| ComfyUI running with cloud nodes and the project node pack | `node build/tools/new-game.cjs run --run <any run> --approve-usd 0` must fail on the *estimate*, not on missing nodes | `node comfyui/tools/install-comfy-nodes.cjs --base-directory <ComfyUI base folder>` (Desktop: `%USERPROFILE%\Documents\ComfyUI`) or `--comfy-root <folder with main.py>`, then **restart ComfyUI**. An agent that cannot drive the Desktop app can run the same server headless: from the Desktop's `ComfyUI-Installs\<instance>` folder, `<base>\.venv\Scripts\python.exe -s ComfyUI/main.py --base-directory <base> --user-directory <base>\user --port 8188 --enable-cors-header "*" --input-directory <base>\input --output-directory <base>\output` (close the Desktop app first; it owns port 8188) |
| `comfy` CLI logged in to a workspace with credit | `comfy --help`, `comfy cloud status` | `comfy cloud login`; the sequential runner submits with `--allow-spend` |
| Chromium for the strict export | `npx playwright install chromium` or `PLAYWRIGHT_EXECUTABLE_PATH` | see `build/tools/build-bundle.cjs` |
| Spending authorization | the person who pays has named a cap | never run step 2 without it |
| (optional) node-pack unit checks | `COMFYUI_PYTHON=<ComfyUI python> COMFYUI_ROOT=<ComfyUI core folder> npm test` | Desktop: python is `<base>\.venv\Scripts\python.exe`, the core is `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\<install>\ComfyUI` |

## 1. Write the cast file

Copy `comfyui/casts/blue-wave-2026.json` and edit it. A cast file is `"castSchema": "comfy-fighter-cast/v1"` plus:

- `extends`: `comfyui/config/factory.json` supplies the art direction (`style`, `uiStyle`, `stageStyle`), the cloud model and the two sheet layouts; override any of the three style strings to re-theme the whole game.
- `id` (the default install slot), `title` (2–40 characters, shown on the title screen), `subtitle`.
- `videoModel` and `videoResolution`: `"Seedance 1.5 Pro"` at `"1080p"` (about $0.059/s; the reference casts use it — clean, on-model motion) or `"720p"` ($0.026/s), or `"LTX-2.5 (Fast)"` (always 720p, $0.1287/s, the template default; smears on fast motion). The project node carries the choice, so every clip node follows it.
- `fighters` (2–8): `id` (`[a-z][a-z0-9_]{1,23}`), `name`, `color` (`#rrggbb`), `description` (80–1600 characters, the full visual design: build, face, skin, hair, every garment with colors, "no hat/props/lettering", the silhouette), `specialMove {name, description}` (the projectile leaves the forward hand so the engine can launch it), optional `superMove`, `introTagline`, `introVoice` (one of the stock voices in `comfyui/tools/prepare-audio-workflows.cjs`), `style` (`balanced`, `grappler`, `speed`, `zoner`, `trickster`, `power`; `boss` with `"boss": true` for at most one final boss), `winQuote`, `ending`.
- `stages` (1–3): `id`, `name`, `description` (80+ characters, the fighting plane at 82 percent of the height, everything behind it).

Rules the validator enforces: every reference is invented from text (no `sourceInput`/`sourceImage`), ids are unique, the sheet layout equals `comfyui/config/game.json`, and descriptions never describe real people. Keep the fiction rule yourself as well: no real person, candidate, venue, brand or franchise, and no green garments (chroma key).

Satire casts are the one exception: `"publicFigures": true` plus a `fullName` per fighter and an `about` paragraph naming the subjects and sources (`comfyui/casts/midterm-2026.json`). Such a cast caricatures public figures from a short written description (age range, hair, glasses, build, attire) in the game's anime style; it never loads a photograph or recording, voices stay the stock synthetic ones, and taglines, quotes and endings stick to public record or obvious arcade jokes — nothing defamatory. The image model may still draw a generic person from the description; the names and the matchups carry the satire.

## 2. Prepare (free)

```
node build/tools/new-game.cjs prepare --cast comfyui/casts/<name>.json --out output/test-runs/<name>-<date>
```

Writes `workflow.json` (open it in ComfyUI to inspect), `workflow.api.json` (what runs), `plan.json` (the estimate), `cast.json` (the merged configuration) and `pipeline.json` (the step log). The estimate for six fighters and one arena with everything is about **$11.2** with Seedance 1.5 Pro at 1080p: 93 images ($5.55), 14 silent clips / 76 s ($4.48), 89 audio clips ($1.15); the same run on LTX-2.5 Fast is about $16.5 ($9.78 of video). `--no-media` drops the ensemble, menu loop, select loop, intros and idle loops (still art is used instead, ≈ $6.1); `--no-audio` drops the music, calls, effects and voices.

Formula (list prices in `plan.rates`): per fighter 6 × 1K + 7 × 2K images (five key/in-between sheets plus the two motion sheets: sheetF strike transitions, sheetG breathing loop and air cels), per arena 2 × 2K, shared art 6 × 1K + 1 × 2K; media adds 2 × 1K per fighter, one 2K ensemble, 8 s + 8 s loops and 4 s + 6 s per fighter at the video model's per-second rate. A cast without `motionSheets` skips the two motion sheets ($0.14 per fighter) and plays with the 45-pose fallbacks.

## 3. Run (paid, explicit approval)

```
node build/tools/new-game.cjs run --run output/test-runs/<name>-<date> --approve-usd <at least plan.total.estimatedUSD>
```

Refuses when the approval is below the estimate, when the run already executed (`--resume` continues from ComfyUI's cache without re-billing finished nodes) or when the running ComfyUI lacks any node class of the workflow. Then it submits **one paid node at a time** through `comfyui/tools/run-sequential.cjs` (free-tier workspaces allow one concurrent job; a burst gets HTTP 429). Expect roughly 25–40 minutes for the full six-fighter run. The bundle lands in `<run>/bundle/` with `assets.json`, `video.json` and `audio.json`.

If a node fails: fix the cause (balance, rate limit, a prompt the model refused), then rerun with `--resume`. Record the actual charge from `comfy cloud status` next to the approval in `pipeline.json` or your ledger.

## 4. Review

```
node build/tools/new-game.cjs review --run output/test-runs/<name>-<date>
```

Produces `<run>/review/<fighter>.png` (every cel at the idle height, labelled with its size ratio; red frames are flagged), `review.json` and `review/README.md` with the checklist. Open every grid and every other image and look for: facing (every cel faces right), identity drift between sheets, text or grid lines inside cells, cropped limbs, off-theme interface art. Measurable problems (unsegmentable sheets, cells touching the sheet edge, upright poses off the idle height by more than 15 percent) are listed as flags.

To redraw one image or clip:

```
node build/tools/new-game.cjs reroll --run output/test-runs/<name>-<date> --node "Keystone | sheet C" --approve-usd 0.08
```

`--node` is a node id or exact title from `workflow.api.json` (the review grid names the sheet). The command raises that node's `reroll` input (a seed offset every paid factory and media node accepts), prices the node plus everything downstream of it (sheets B–E follow sheet A, about $0.36; the cast ensemble and menu loop follow any fighter), refuses without a matching `--approve-usd`, then submits the whole workflow once: ComfyUI redraws only the changed nodes and serves the rest from its cache. This needs the server's cache to be warm (no ComfyUI restart since the run); on a cold cache it would re-bill the whole game, so do sheet re-rolls right after the run. Never change the project `seed`, which re-bills the entire game. Review again after each re-roll.

For one derived image or clip — a portrait, hero, cut-in, ending, fight intro or select idle loop — use the cache-independent form:

```
node build/tools/new-game.cjs reroll-art --run output/test-runs/<name>-<date> --asset paxton_cutin --approve-usd 0.05      # one 1K image
node build/tools/new-game.cjs reroll-art --run output/test-runs/<name>-<date> --asset marshall_intro --approve-usd 0.57   # keyframe + 4 s clip
```

It uploads the fighter's accepted identity (and the stage, for an intro) from the bundle to ComfyUI, rebuilds the character from the cast text with the free definition node, generates with an offset seed, and patches the record in `assets.json` or `video.json` itself. A run made before the motion sheets existed gets them the same way:

```
node build/tools/new-game.cjs add-sheets --run output/test-runs/<name>-<date> --approve-usd 0.87   # sheetF + sheetG for every fighter, $0.144 per fighter
node build/tools/new-game.cjs add-sheets --run output/test-runs/<name>-<date> --sheets sheetH,sheetI --fighters <id> --approve-usd 0.15   # drawn walks, crouch-down, roll and sweep for one fighter
```

It uploads each fighter's identity and accepted sheet A (as `reference_sheet`), generates the two sheets one node at a time, appends their records and `game.motionSheets` to `assets.json`, and leaves everything else untouched. `--asset title_video` and `--asset select_video` redraw the menu loops from the accepted ensemble and select art the same way. `--video-model` / `--video-resolution` override the run's project settings for that clip (this is how a run made on LTX moves its clips to Seedance). Do these after any whole-workflow re-roll, because the whole-workflow exporters rewrite the manifests from their own cached records.

## 5. Export and install

```
node build/tools/new-game.cjs export  --run output/test-runs/<name>-<date>            # strict build + gameplay checks → output/exports/<name>-<date>
node build/tools/new-game.cjs install --run output/test-runs/<name>-<date> --slot <id> # → output/games/<id>, served at /<id>/
npm start                                                                             # main game at /, every slot beside it, GAME SELECT on each title screen
```

Omit `--slot` to make the new game the main one (`output/game`). `node build/tools/new-game.cjs status --run <run>` prints the step log. The exported `game/` folder is self-contained (`npm start` inside it serves one game; `GAME_MOUNTS='{"/":".","/other/":"../other/game"}'` serves several).

## Reference run

`comfyui/casts/blue-wave-2026.json` — six invented hometown champions inspired by the November 2026 midterm map (four from states that voted blue, two from deep-red states that flipped) on the fictional Statehouse Steps; see its `about` field. Prepared as `output/test-runs/blue-wave-20261105` (estimate $15.62).
