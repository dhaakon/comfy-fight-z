# Game and builder source

This folder holds reusable application code and its dependencies. Despite its name, it is source-controlled build tooling, not the generated game directory.

| Path | Purpose |
| --- | --- |
| `public/` | Browser fighting game (`game.js`, `engine.js`, `anim.js`, `render/`), the phone controller page, the asset lab and the browser bundle builder |
| `public/assets/` | Accepted runtime media and manifest, adopted from the verified example export: the canonical seven-fighter cast with its art, clips and living scenery |
| `public/builder/templates/` | Generated download copies of the canonical recipes in `comfyui/workflows/` |
| `server/` | The Node multiplayer and phone-pairing server; `npm run bundle:server` packs it into every export as `start-server.cjs` |
| `crossovers/` | Crossover definitions (`ultra.json`) that `npm run crossover` composes from installed games |
| `deploy/` | Public hosting: the systemd unit, the nginx site, the release installer and the [hosting guide](deploy/README.md) |
| `docs/` | [Multiplayer and phone setup](docs/multiplayer.md) |
| `tools/` | Import, sprite processing, bundle merging, the cast-file pipeline (`new-game.cjs`), crossovers, video assembly, living scenery, game export, adoption, local serving, static-site packaging, the gameplay and phone probes, and the explainer and teaser recorders |
| `test/` | Node, Python custom-node and browser checks |
| `package.json`, `package-lock.json` | Node.js package scripts and pinned dependencies |
| `node_modules/` | Local dependencies installed by npm; ignored by Git |

Run the normal commands from the repository root; its scripts invoke the relocated tools and install dependencies into this package:

```powershell
npm ci
npm run example
npm start
```

The example checks, builds and tests the included arcade bundle (six fighters, the final boss and three arenas), then installs the game into `output/game/`. The server serves that directory at `http://127.0.0.1:8080` by default, plus every game installed under `output/games/<slot>/` at `/<slot>/`, listed on each title screen's GAME SELECT. Use `$env:PORT='8089'` before `npm start` for the hackathon preview. No ComfyUI server or cloud account is needed to build the included example.

For source development, `npm run build` rebuilds `output/game/` straight from `build/public/`. Its accepted runtime media is adopted from the verified example, so this is the same canonical cast and the quick way to see a code change. `npm run build:release` is the strict variant, which refuses an incomplete asset set. `npm test` runs the Node tests, including the gameplay metrics; `npm run test:browser`, `test:arcade` and `test:games` drive the built game in Chromium.

Use `/builder/` to load a complete generated source folder containing `assets.json` and its mapped files, plus optional `audio.json` and `video.json`. It can export a self-contained game directory or ZIP. `npm run build:bundle -- --bundle <absolute-source-folder> --out <absolute-new-export-folder>` automates strict export and browser checks. Place independent exports under `output/exports/`.

`node build/tools/new-game.cjs` (`prepare`, `run`, `review`, `reroll`, `title-card`, `add-media`, `add-scenery`, `add-sheets`, `export`, `install`) is the cast-file pipeline described in the [runbook](../comfyui/docs/new-game-runbook.md); `npm run crossover` composes installed games into one roster; `build/tools/capture-teaser.cjs` and `compose-explainer.cjs` record and cut the teaser ([video guide](../comfyui/docs/explainer-video.md)). See the [advanced guide](../comfyui/docs/advanced.md) for automated export, optional video and reviewed asset updates.

Normal builds preserve `build/public/assets/`. Adopt reviewed, verified canonical game media with `npm run adopt:game -- --game <absolute-exported-game-folder>`; keep the original source bundle separately. Custom rosters and additional environments belong in independent exports. Reports, screenshots and adoption backups belong under `output/diagnostics/`.

Build, import, merge, export and test commands do not submit cloud jobs. Keep cloud generation configuration and custom nodes in `comfyui/`; never put private reference photos, retired photo-derived media, credentials or raw run outputs in `public/`.
