# ComfyUI generation sources

This folder contains the recipes and inputs used to generate Comfy Fighter Z assets. It does not contain the browser game or generated run outputs.

| Path | Purpose |
| --- | --- |
| `workflows/comfy-hackathon.json` | Main factory: six characters, three environment slots, shared art and mapped `assets.json` |
| `workflows/comfy-audio.json` | Music, effects, announcer and fighter voices; 22 clips mapped by `audio.json` |
| `workflows/comfy-opening.json` | Optional 25-second Seedance opening, preceded by seven text-only fictional reference generations |
| `workflows/simple-image-generation.json` | Small cloud image example |
| `workflows/factory/` | Focused character, sprite-sheet and environment factories |
| `workflows/advanced/` | Expanded graphs for inspecting the native cloud nodes |
| `config/` | Canonical game configuration and separate reusable factory defaults |
| `custom_nodes/comfy_fighter_assets/` | Project-owned cloud factories, individual-sheet nodes and manifest exporters |
| `tools/` | Workflow preparation and custom-node installation scripts |
| `assets/` | Image/audio generation plans and mapping contracts |
| `ref/` | Accepted fictional sample references; replacement demo images are pending generation |
| `docs/` | [Advanced guide](docs/advanced.md), [factory details](docs/workflow-factory.md), [asset contract](docs/asset-contract.md), [repairs](docs/incremental-refresh.md) and [opening workflow](docs/video-workflow.md) |

Run commands from the repository root:

```powershell
npm run workflows
npm run nodes:install -- --comfy-root "C:\path\to\ComfyUI"
```

Workflow preparation writes recipes and matching browser downloads without calling a model. After installing the custom pack, restart ComfyUI and reload the editor. Open `comfyui/workflows/comfy-hackathon.json` with Nodes 2.0 enabled. Set its output root to a new absolute folder under `output/test-runs/` and use that same root for companion audio.

The default Invent fictional reference mode ignores the image selector and creates every source from text. Six fighters plus The Yard require 56 paid image calls; enabling all three environments requires 60. Explicit Upload mode requires 49 or 51 calls. The Yard is enabled, while the extra environment slots remain disabled. No earlier photographs or character sheets are default inputs.

All inference uses cloud/API models. Opening a workflow, preparing it, validating it or building a game does not authorize paid generation. Obtain spending authorization for each new batch. Review generated assets and merge accepted replacements into a complete source bundle before passing it to the builder in `build/`.
