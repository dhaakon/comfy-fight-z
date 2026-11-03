# Game and builder source

This folder holds reusable application code and its dependencies. Despite its name, it is source-controlled build tooling, not the generated game directory.

| Path | Purpose |
| --- | --- |
| `public/` | Browser fighting game, animation layer, asset lab and browser bundle builder |
| `public/assets/` | Accepted runtime media and manifest; currently the fictional pending manifest |
| `public/builder/templates/` | Generated download copies of the canonical recipes in `comfyui/workflows/` |
| `tools/` | Import, image processing, bundle merging, video assembly, game export, adoption and local serving |
| `test/` | Node, Python custom-node and browser checks |
| `package.json`, `package-lock.json` | Node.js package scripts and pinned dependencies |
| `node_modules/` | Local dependencies installed by npm; ignored by Git |

Run the normal commands from the repository root; its scripts invoke the relocated tools and install dependencies into this package:

```powershell
npm ci
npm run example
npm start
```

The example builds and tests the included six-fighter bundle, then installs the game into `output/game/`. The server serves that directory at `http://127.0.0.1:8080` by default. Use `$env:PORT='8089'` before `npm start` for the hackathon preview. No ComfyUI server or cloud account is needed to build the included example.

For source development, `npm run build` replaces `output/game/` with the lightweight canonical preview, whose artwork is pending. `npm run build:release` rejects that incomplete source asset set. Run `npm run example` again to restore the generated game.

Use `/builder/` to load a complete generated source folder containing `assets.json` and its mapped files, plus optional `audio.json` and `video.json`. It can export a self-contained game directory or ZIP. `npm run build:bundle -- --bundle <absolute-source-folder> --out <absolute-new-export-folder>` automates strict export and browser checks. Place independent exports under `output/exports/`.

See the [advanced guide](../comfyui/docs/advanced.md) for automated export, optional video and reviewed asset updates.

Normal builds preserve `build/public/assets/`. Adopt reviewed, verified canonical game media with `npm run adopt:game -- --game <absolute-exported-game-folder>`; keep the original source bundle separately. Custom rosters and additional environments belong in independent exports. Reports, screenshots and adoption backups belong under `output/diagnostics/`.

Build, import, merge, export and test commands do not submit cloud jobs. Keep cloud generation configuration and custom nodes in `comfyui/`; never put private reference photos, retired photo-derived media, credentials or raw run outputs in `public/`.
