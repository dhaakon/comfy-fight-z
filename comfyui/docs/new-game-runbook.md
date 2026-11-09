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
node build/tools/set-aside-sheets.cjs output/test-runs/<name>-<date> <id>_sheetH   # make room for a redraw (keeps the old PNG in set-aside/)
node build/tools/new-game.cjs add-sheets --run output/test-runs/<name>-<date> --sheets sheetH --fighters <id> --reference-sheet sheetF --approve-usd 0.08   # redraw against a clean nine-figure sheet
```

It uploads each fighter's identity and accepted sheet A (as `reference_sheet`), generates the two sheets one node at a time, appends their records and `game.motionSheets` to `assets.json`, and leaves everything else untouched. `--asset title_video` and `--asset select_video` redraw the menu loops from the accepted ensemble and select art the same way. `--video-model` / `--video-resolution` override the run's project settings for that clip (this is how a run made on LTX moves its clips to Seedance). Do these after any whole-workflow re-roll, because the whole-workflow exporters rewrite the manifests from their own cached records.

### Living stage scenery (optional)

Background characters, props and scene effects that live in the stage painting, Street Fighter style. It is one reproducible ComfyUI workflow per stage, `comfyui/workflows/factory/stage-scenery.json` (shipped muted: upload the accepted painting as `cfz-accepted-<stage>-stage.png`, select it, unmute). `add-scenery` runs the same graph for a run's bundle:

```
node build/tools/new-game.cjs add-scenery --run output/test-runs/<name>-<date> [--stages <id>] [--elements 12] [--direction "<what belongs in the background>"] --approve-usd 0.34
```

Per stage, at most about $0.33:

1. `CFZSceneDirector` (Gemini 3.8 Flash vision, priced per token, bounded at about $0.19 by its output cap) reads the accepted painting and plans the additions (what, where, how each moves), 10-24 effects on features already painted and the weather.
2. `CFZStageScenery` (one 2K edit, $0.072) repaints the painting with exactly those additions in place (`<stage>_scene`).
3. `CFZSceneIsolate` (one 2K edit, $0.072) keeps only the additions, in place, on chroma green (`<stage>_isolated`).
4. `CFZExtractScenery` (local, free) cuts every addition out at its exact position and scale. It keys the isolated layer where the scene really changed, groups the pieces by the plan's boxes (touching additions stay separate; one addition's pieces join; a piece the painter drew off its box takes the nearest unclaimed addition). It keeps the scene's other changes as still layers, drops scraps around a figure so nothing ghosts, and writes `scenery/<stage>.json` (elements with `place` fractions, `motion`, `order`, `label`; the effects; the weather; the full plan) and `scenery/<stage>-review.png`.
5. `CFZExportAssetPatch` writes a partial `assets.json` into the patch folder (`<run>/scenery/<stage>-<time>/` for `add-scenery`).

`node build/tools/stage-scenery.cjs apply --patch <patch> --bundle <bundle>` folds a patch into an accepted bundle (`add-scenery` does this): it verifies and copies the files, replaces the stage's `scene` and `layer` records and sets `game.stages[].scenery` ({weather, effects}).

Review `bundle/scenery/<stage>-review.png`. Then edit `bundle/scenery/<stage>.json` if needed: set an element's `motion` (`still`, `idle`, `cheer`, `hover`, `sway`, `flicker`, `pulse`, `drift`, `bob`, `spin`), delete a false element, change the weather or the effects (`blink`, `glow`, `screen`, `hologram`, `steam`, `smoke`, `sparks`, `torch`, `drip`, `searchlight`, `traffic`, `birds`, `clouds`, `fog`, `lightning`, `ripples`, `shimmer`, `wave`, `spin`, `flash`, `embers`, `fireflies`). Run `node build/tools/stage-scenery.cjs sync --bundle <bundle> --stage <id>` to map the edits back and redraw the review sheet.

To replay the free extraction from a saved patch, for example after the extractor improves (no ComfyUI server or cloud call), run `COMFYUI_ROOT=<ComfyUI> <ComfyUI python> comfyui/tools/scenery_extract.py --patch <patch> --stage <id> --plate <accepted painting> [--fresh]` and apply the patch again.

In the game, `build/public/render/scenery.js` draws the clean painting as the plate and animates the elements and effects in the painting's own space, so they keep its parallax and scale. `cheer` elements bounce and `flash` effects fire more often when hits, supers and K.O.s land. Weather falls over the fighters. A stage without scenery still gets weather from its description.

### Game-select title card (optional, one 2K image)

GAME SELECT shows each installed game as a card. Give the game its own title card before exporting: `CFZTitleCard` keeps the accepted cast ensemble (`ui/ensemble`) and letters the game's name across it, the subtitle (the edition) big with the title as the smaller line above.

```
node build/tools/new-game.cjs title-card --run output/test-runs/<name>-<date> --approve-usd 0.08 [--title "<big name>"] [--tagline "<smaller line>"]
```

It uploads the ensemble from the bundle (no cache needed), maps the result as `ui/card` in `assets.json` and logs the attempt in `pipeline.json`; a repeat draws a fresh seed. Read the lettering before exporting: short titles come out right, so redraw on any misspelling. The same step serves the included example (`--example`: the original cast's arcade ensemble, lettered with the title over the saga, added to `example/bundle` as a lossless WebP with provenance; then `npm run example -- --out <fresh> --no-install` and `node build/tools/adopt-game.cjs --game <export>/game`) and crossovers (`--crossover <definition>`, see section 6). The listing (`games.json`) puts the card first and names each game by its manifest `name` (adopt-game sets the original's title), else its subtitle. Games without a card fall back to their title art.

## 5. Export and install

```
node build/tools/new-game.cjs pack-media --run output/test-runs/<name>-<date>         # only when export asks for it (free, local)
node build/tools/new-game.cjs export  --run output/test-runs/<name>-<date>            # strict build + gameplay checks → output/exports/<name>-<date>
node build/tools/new-game.cjs install --run output/test-runs/<name>-<date> --slot <id> # → output/games/<id>, served at /<id>/
npm start                                                                             # main game at /, every slot beside it, GAME SELECT on each title screen
```

The package carries every source and a runtime copy of each clip and sound, and the builder caps it at 1 GiB. Seedance 1080p clips arrive at 17–33 Mbit/s, so a full cast on Seedance can pass the cap (Billionaires Brawl came to about 1.15 GiB). `export` adds up that floor before building and, when it cannot fit, refuses and names `pack-media`. That step re-encodes every clip above 12 Mbit/s as H.264 CRF 18 (visually lossless, SSIM 0.986–0.994 on the reference run; size, frame rate, frame count and duration verified) and every WAV as MP3 VBR q2 like the shipped example. The originals move to `<run>/originals/` and `pipeline.json` lists each conversion. Billionaires Brawl went from 322.6 to 130.2 MiB of media and an 827 MB package. If you stop the `npm start` server before `install` (a running server can lock the slot folder on Windows), stop its `node build/tools/serve.cjs` process too, not just the npm wrapper.

Omit `--slot` to make the new game the main one (`output/game`). `node build/tools/new-game.cjs status --run <run>` prints the step log. The exported `game/` folder is self-contained (`npm start` inside it serves one game; `GAME_MOUNTS='{"/":".","/other/":"../other/game"}'` serves several).

### Startup and select clips for a run without them (add-media)

A run prepared with `--no-media`, or one over accepted art, gets its clips afterwards: one fight introduction and one select idle loop per fighter, the title loop (animating `ui/ensemble`) and the select loop (animating `ui/select`).

```
node build/tools/new-game.cjs add-media --run output/test-runs/<name>-<date> --approve-usd <estimate> [--clips intro,idle,title,select,title-portrait,select-portrait] [--fighters a,b] [--title-image <file>] [--select-image <file>]
```

Each clip is drawn like `reroll-art` (the accepted identity, The Yard or the run's first arena, and the interface art uploaded from disk) and recorded in `video.json`. Clips already mapped are skipped, so a rerun after a failure resumes. On Seedance 1.5 Pro at 1080p a fighter costs about $0.686 (intro $0.284, idle $0.402) and each menu loop $0.472. `--title-image`/`--select-image` animate art kept outside the bundle.

The portrait cuts (`title-portrait`, `select-portrait`; not in the default set, so name them in `--clips`) are the phone versions of the two menu loops: `CFZTitleVideo`/`CFZSelectVideo` with `portrait` on first recompose the same art as a tall 9:16 key visual (one 2K image call, $0.072) and animate that cut as first and last frame, so each costs about $0.544 on Seedance 1.5 Pro at 1080p. They are recorded as `titleVideoPortrait`/`selectVideoPortrait`, flow through the builder, the example verifier, `adopt-game` and `install` like the wide loops, and `pack-media` always re-encodes them 720 wide (H.264 Main, CRF 22, at most 3.5 Mbit/s) because a phone downloads and decodes them. The game plays them only on an upright lite device (a phone held portrait); everywhere else the wide loops play, and the lite select screen animates only with the portrait cut.

### The original game over its accepted example art

The original cast lives in `comfyui/config/factory.json` and its reviewed art in `example/bundle`. To give it what newer casts have (clips, living scenery, a title card), prepare a run over that art and use the add-on steps; the full generation is refused on such a run, so the accepted art is never redrawn:

```
node build/tools/new-game.cjs prepare --cast comfyui/config/factory.json --out output/test-runs/canonical-<date> --accepted example/bundle   # free: copies the accepted bundle
node build/tools/new-game.cjs add-media --run output/test-runs/canonical-<date> --approve-usd 5.75 --title-image build/public/arcade/title-ensemble.webp --select-image build/public/arcade/select-backdrop.webp
node build/tools/new-game.cjs add-media --run output/test-runs/canonical-<date> --approve-usd 1.09 --clips title-portrait,select-portrait --title-image build/public/arcade/title-ensemble.webp --select-image build/public/arcade/select-backdrop.webp   # the phone cuts
node build/tools/new-game.cjs add-scenery --run output/test-runs/canonical-<date> --approve-usd 1.00                              # The Yard, Sunset Rooftop, Midnight Arcade
node build/tools/new-game.cjs review --run output/test-runs/canonical-<date>                                                        # read every clip and scenery sheet
node build/tools/new-game.cjs pack-media --run output/test-runs/canonical-<date>                                                    # web-encode the clips before they are versioned
node build/tools/merge-into-example.cjs --run output/test-runs/canonical-<date> --scenery --videos                                 # layers as lossless WebP, clips with digests, provenance
npm run example -- --out output/example/<fresh> --no-install                                                                         # strict build + gameplay checks
node build/tools/adopt-game.cjs --game output/example/<fresh>/game && npm run build                                                  # the main game's versioned runtime
```

The original game's menus show its arcade art (`build/public/arcade/`), so its title loop animates `title-ensemble.webp` and its select loop `select-backdrop.webp`. The example verifier accepts `video.json` and scenery layers on top of its image contract, each digest-checked with provenance; the populated scene renders stay in the run. `adopt-game` converts the layers to WebP and copies every clip, idle loops and the select loop included.

## 6. Crossover: every installed game in one roster (free)

```
node build/tools/new-game.cjs title-card --crossover build/crossovers/ultra.json --approve-usd 0.08   # once: the game-select card (paid, one 2K image)
node build/tools/crossover.cjs build/crossovers/ultra.json   # → output/games/ultra, served at /ultra/ after restarting npm start
```

The title card letters the four-game key-art composite with the crossover's subtitle and writes the file `interface.card` names (`output/crossovers/ultra/card.png`); the build refuses until it exists.

A crossover definition (`comfy-fighter-crossover/v1`; `build/crossovers/ultra.json` is the reference, Comfy Fighter Z: Ultra Dream Match) lists source games in roster order: the canonical runtime (`build/public`) and installed slots (`output/games/<id>`). It composes their verified runtimes without generating or re-processing anything, so it costs nothing and takes about 30 seconds:

- **Roster and arenas.** Every fighter keeps its poses, art, intro and idle clips, voice lines and moveset; every arena keeps its scenery and music. Fighter and arena ids must be unique across the games (the tool refuses a clash). Each gets a `series` field and the manifest lists `series` (id, `tag` for the select-screen row label, name).
- **One final boss.** `finalBoss` keeps `boss: true`; the other games' bosses become regular, selectable fighters with their boss moveset (labelled BOSS, not FINAL BOSS). `bossStage` is the arena of the final battle.
- **Arcade tour.** `arcade.perSeries` rivals from each game (shuffled game order), each in an arena of their own game, then the final boss: 2 × 4 games + 1 = nine battles for Ultra.
- **Shared presentation.** `shared` names the game whose announcer, menu, boss and result music, sound effects and hit effects serve every fight; the other games' copies are left out (listed in `installation.json`). `interface` maps ui ids to image files (Ultra uses the original arcade logo, backdrops and menu frame), `ensemble` makes a 2 × 2 key-art composite (the startup still and the GAME SELECT card) and `titleMontage` cuts the title loop from stills (slow push-in) and each game's own title loop with a white flash between them (1080p, CRF 20 capped at 12 Mbit/s).
- **Satire flag.** `publicFigures` must be declared; it is true when any source cast caricatures named public figures, and the credits then say so. The canonical cast and the included example stay fictional; a crossover is a separate slot.

The tool hard-links media from `output/` (copies tracked files from `build/public`), checks every mapped file and clip digest, writes `installation.json` and swaps the slot in only when everything checks out. Rebuild it after reinstalling any source game. With more than twelve fighters the select screen switches to the wide layout (one row per game, tiles sized to the screen) and arrow keys follow the grid as drawn.

## Reference run

`comfyui/casts/blue-wave-2026.json` — six invented hometown champions inspired by the November 2026 midterm map (four from states that voted blue, two from deep-red states that flipped) on the fictional Statehouse Steps; see its `about` field. Prepared as `output/test-runs/blue-wave-20261105` (estimate $15.62).
