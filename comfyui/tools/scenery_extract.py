"""Re-run the free scenery extraction from a saved scenery patch folder, without ComfyUI or any cloud call.

The stage-scenery workflow keeps everything its paid nodes made in the patch folder: the populated scene, the isolated
layer and the director's plan (inside scenery/<stage>.json). This replays CFZ Extract Scenery on those files, for
example after the extractor improves or with another threshold, and rewrites the patch's partial assets.json. Then
apply the patch again with build/tools/stage-scenery.cjs.

  COMFYUI_ROOT=<ComfyUI folder> <ComfyUI python> comfyui/tools/scenery_extract.py --patch <patch folder> --stage <id>
      --plate <the accepted stage painting> [--fresh] [--threshold 24] [--min-area 0.00012]

--fresh drops the previous placement file first; otherwise reviewed ids and motions are kept on matching elements.
"""
import argparse
import json
import os
from pathlib import Path
import sys

COMFY = os.environ["COMFYUI_ROOT"]
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, COMFY)
sys.path.insert(0, os.path.join(REPO, "comfyui", "custom_nodes"))

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--patch", required=True); parser.add_argument("--stage", required=True); parser.add_argument("--plate", required=True)
parser.add_argument("--fresh", action="store_true"); parser.add_argument("--threshold", type=int, default=24); parser.add_argument("--min-area", type=float, default=.00012)
args = parser.parse_args()
root, plate_file = Path(args.patch).resolve(), Path(args.plate).resolve()
os.chdir(COMFY)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
import torch  # noqa: E402
from comfy_fighter_assets import factories as fx, scenery as sc  # noqa: E402


def tensor(path):
    with Image.open(path) as image:
        return torch.from_numpy(np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0)[None]


manifest = json.loads((root / "assets.json").read_text(encoding="utf-8"))
if not manifest.get("partial"):
    raise SystemExit(f"{root} is not a scenery patch (its assets.json is not partial).")
stage = next((item for item in manifest["game"]["stages"] if item["id"] == args.stage), None)
records = {item["id"]: item for item in manifest["assets"]}
scene, isolated = records.get(f"{args.stage}_scene"), records.get(f"{args.stage}_isolated")
layout_file = root / "scenery" / f"{args.stage}.json"
if not stage or not scene or not isolated or not layout_file.is_file():
    raise SystemExit(f"The patch lacks the {args.stage} stage, its scene, its isolated layer or scenery/{args.stage}.json.")
layout = json.loads(layout_file.read_text(encoding="utf-8"))
plan = layout["plan"] if layout.get("plan", {}).get("schema") == sc.PLAN_SCHEMA else {
    "schema": sc.PLAN_SCHEMA, "stage": args.stage, "weather": layout.get("weather", "none"), "additions": layout["plan"]["additions"], "effects": layout.get("effects", [])}
if args.fresh:
    layout_file.unlink()
project = {"_type": "CFZ_PROJECT", "root_directory": str(root), "title": manifest["game"]["title"], "subtitle": "", "style": "", "ui_style": "",
           "stage_style": "", "model": fx.MODELS[0], "seed": 0}
definition = {"id": stage["id"], "name": stage["name"], "description": stage.get("description", "")}
bundle, _, layout_path = sc.CFZExtractScenery.execute(project, tensor(plate_file), tensor(root / scene["src"]), tensor(root / isolated["src"]), json.dumps(plan),
                                                      definition["id"], definition["name"], definition["description"], args.threshold, args.min_area).result
saved = {"_type": "CFZ_BUNDLE", "_root": str(root), "fighters": [], "stages": [definition], "assets": [{**scene, "_root": str(root)}, {**isolated, "_root": str(root)}]}
fx._export(project, {"bundle_0": saved, "bundle_1": bundle}, False)
moving = [record for record in bundle["assets"] if record["motion"] != "still"]
print(f"{args.stage}: {len(moving)} animated and {len(bundle['assets']) - len(moving)} still element(s), {len(bundle['stages'][0]['scenery']['effects'])} effects -> {layout_path}")
for record in moving:
    print(f"  {record['id']:<16} {record['motion']:<8} {record.get('label', '')}")
