"""Exercise the Comfy Fighter Z node pack's local logic without a running server.

Run with the Python environment of an installed ComfyUI (no models or cloud calls):
  COMFYUI_ROOT=<ComfyUI folder> <ComfyUI python> comfyui/tools/test_comfy_nodes.py
"""
import json
import os
import sys
import tempfile

COMFY = os.environ["COMFYUI_ROOT"]
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, COMFY)
sys.path.insert(0, os.path.join(REPO, "comfyui", "custom_nodes"))
os.chdir(COMFY)

import numpy as np  # noqa: E402
import comfy_fighter_assets as cfz  # noqa: E402
from comfy_fighter_assets import factories as fx  # noqa: E402

failures = []


def check(label, condition):
    print(("ok   " if condition else "FAIL ") + label)
    if not condition:
        failures.append(label)


def raises(label, fn):
    try:
        fn()
    except ValueError as error:
        print("ok   " + label + " -> " + str(error)[:90])
        return
    failures.append(label)
    print("FAIL " + label + " (no error)")


fighter = fx._character("Boss", "A fictional final boss.", "Big Burst", "A burst.", "Hello.", "#ff0000", "bossman",
                        "boss", "Mega Burst", "A huge burst.", "Too slow.", "The end.", "Final boss")
check("character carries arcade fields", fighter["style"] == "boss" and fighter["boss"] and fighter["superMove"]["name"] == "Mega Burst"
      and fighter["winQuote"] == "Too slow." and fighter["ending"] == "The end.")
check("checked character round-trips", fx._checked_character(fighter) == fighter)
plain = fx._character("Pat", "", "Zap", "A zap.", "", "#00ff00", "pat")
check("defaults stay compatible", plain["style"] == "balanced" and "boss" not in plain and "superMove" not in plain)
raises("unknown style rejected", lambda: fx._character("A", "", "Z", "z", "", "#000000", "a", "ninja"))
raises("super name needs a description", lambda: fx._character("A", "", "Z", "z", "", "#000000", "a", "balanced", "Mega", ""))

config = {"title": "T", "fighters": [fighter, plain], "stages": [{"id": "yard", "name": "Yard"}], "sheets": cfz.SHEETS, "extraSheets": cfz.EXTRA_SHEETS}
parsed = cfz._config(json.loads(json.dumps(config)))
check("config keeps extraSheets and fighter metadata", parsed["extraSheets"] == cfz.EXTRA_SHEETS and parsed["fighters"][0]["boss"] is True)
raises("two bosses rejected", lambda: cfz._config({**config, "fighters": [fighter, {**plain, "boss": True}]}))
raises("altered extra layout rejected", lambda: cfz._config({**config, "extraSheets": {"sheetD": cfz.EXTRA_SHEETS["sheetE"], "sheetE": cfz.EXTRA_SHEETS["sheetD"]}}))
record = cfz._metadata({"id": "pat_sheetD", "kind": "sprites", "fighter": "pat", "sheet": "sheetD", "poses": cfz.EXTRA_SHEETS["sheetD"], "key": True}, parsed)
check("sheetD metadata accepted", record["sheet"] == "sheetD")
check("ending kind accepted", cfz._metadata({"id": "pat_ending", "kind": "ending", "fighter": "pat"}, parsed)["kind"] == "ending")
raises("ending needs a fighter", lambda: cfz._metadata({"id": "x_ending", "kind": "ending"}, parsed))

# Complete export: build a temporary project root with saved images.
root = tempfile.mkdtemp(prefix="cfz-node-test-")
project = {"_type": "CFZ_PROJECT", "root_directory": root, "title": "T", "subtitle": "", "style": "s", "ui_style": "u",
           "stage_style": "st", "model": fx.MODELS[0], "seed": 1}
image = np.zeros((1, 12, 12, 3), dtype=np.float32)


def saved(meta, members):
    return cfz._save_image(image, fx._project(project), cfz._metadata(meta, members))


def bundle_for(character, extras):
    members = fx._members(character=character)
    records = [saved({"id": f"{character['id']}_{kind}", "kind": kind, "fighter": character["id"], "key": kind != "source"}, members)
               for kind in ["source", "reference", "portrait", "hero", "cutin"] + (["ending"] if extras else [])]
    for sheet, poses in (cfz.ALL_SHEETS if extras else cfz.SHEETS).items():
        records.append(saved({"id": f"{character['id']}_{sheet}", "kind": "sprites", "fighter": character["id"], "sheet": sheet, "poses": poses, "key": True}, members))
    return {"_type": "CFZ_BUNDLE", "_root": str(fx._project(project)), "fighters": [character], "stages": [], "assets": records}


stage = {"id": "yard", "name": "Yard", "description": "d"}
stage_members = fx._members(stage=stage)
shared_members = fx._members()
stage_bundle = {"_type": "CFZ_BUNDLE", "_root": str(fx._project(project)), "fighters": [], "stages": [stage],
                "assets": [saved({"id": "yard", "kind": "stage", "stage": "yard", "key": False}, stage_members),
                           saved({"id": "yard_source", "kind": "source", "stage": "yard", "key": False}, stage_members)]}
shared = [saved({"id": name, "kind": "ui", "key": name in {"logo", "hud", "icons"}}, shared_members) for name in ["title", "select", "logo", "hud", "icons"]]
shared.append(saved({"id": "combat_effects", "kind": "effects", "poses": fx.EFFECTS, "key": True}, shared_members))
shared_bundle = {"_type": "CFZ_BUNDLE", "_root": str(fx._project(project)), "fighters": [], "stages": [], "assets": shared}

bundles = {"bundle_0": bundle_for(fighter, True), "bundle_1": bundle_for(plain, False), "bundle_2": stage_bundle, "bundle_3": shared_bundle}
fx._export(project, bundles, True)
manifest = json.load(open(os.path.join(root, "assets.json"), encoding="utf-8"))
ids = {asset["id"] for asset in manifest["assets"]}
check("complete export keeps optional arcade records", {"bossman_sheetD", "bossman_sheetE", "bossman_ending"} <= ids and "pat_sheetD" not in ids)
check("complete export records extraSheets and boss", manifest["game"]["extraSheets"] == cfz.EXTRA_SHEETS and manifest["game"]["fighters"][0].get("boss") is True)
check("expected assets list matches", set(manifest["game"]["expectedAssets"]) == ids)
broken = dict(bundles)
broken["bundle_1"] = {**bundle_for(plain, False)}
broken["bundle_1"]["assets"] = [a for a in broken["bundle_1"]["assets"] if a["id"] != "pat_sheetB"]
raises("missing required sheet still rejected", lambda: fx._export(project, broken, True))
second_boss = {**plain, "boss": True}
raises("second boss rejected in export", lambda: fx._export(project, {**bundles, "bundle_1": bundle_for(second_boss, False)}, True))
print("\n%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
