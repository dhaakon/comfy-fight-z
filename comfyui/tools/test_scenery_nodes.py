"""Exercise the living-scenery nodes without a server or cloud calls: the director's plan parsing, the graphs the
paid nodes expand into, the local extraction on synthetic images and the asset exports.

  COMFYUI_ROOT=<ComfyUI folder> <ComfyUI python> comfyui/tools/test_scenery_nodes.py
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
import torch  # noqa: E402
import comfy_fighter_assets as cfz  # noqa: E402
from comfy_fighter_assets import factories as fx, scenery as sc  # noqa: E402

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


# --- plan parsing ---------------------------------------------------------------------------------------------
stage = {"id": "yard", "name": "Yard", "description": "A fictional yard."}
answer = {"weather": "rain", "additions": [
    {"name": "drone", "description": "a small camera drone", "kind": "prop", "box_2d": [100, 650, 200, 720], "motion": "hover"},
    {"name": "fan", "description": "a cheering fan", "box_2d": [300, 100, 560, 160], "motion": "dance"},
    {"name": "broken", "description": "no box"}],
    "effects": [{"type": "blink", "points": [[50, 500], [60, 520]], "color": "#FF3344", "label": "antenna"},
                {"type": "screen", "box_2d": [200, 300, 300, 450]}, {"type": "steam", "point": [500, 800]},
                {"type": "teleport", "box_2d": [0, 0, 10, 10]}, {"type": "glow", "box_2d": [10, 10, 10, 10]}]}
fenced = "Here you go:\n```json\n" + json.dumps(answer) + "\n```\nEnjoy."
check("plan JSON is found inside a fenced reply", sc._plan_json(fenced)["weather"] == "rain")
check("plan JSON is found inside prose", sc._plan_json("Plan: " + json.dumps(answer) + " done")["additions"][0]["name"] == "drone")
raises("an empty reply is rejected", lambda: sc._plan_json("  "))
raises("a reply without JSON is rejected", lambda: sc._plan_json("I cannot do that."))
plan = sc._scene_plan(answer, stage, 12)
check("additions convert box_2d to fractions", plan["additions"][0]["box"] == {"x": .65, "y": .1, "w": .07, "h": .1})
check("unknown motions fall back to idle; additions without a box are dropped", [a["motion"] for a in plan["additions"]] == ["hover", "idle"])
check("effects keep known types with valid geometry only", [e["type"] for e in plan["effects"]] == ["blink", "screen", "steam"]
      and plan["effects"][0]["points"][1] == {"x": .52, "y": .06} and plan["effects"][0]["color"] == "#ff3344" and plan["effects"][2]["point"] == {"x": .8, "y": .5})
check("effect ids are sequential", [e["id"] for e in plan["effects"]] == ["fx1", "fx2", "fx3"])
check("the element count caps the additions", len(sc._scene_plan(answer, stage, 1)["additions"]) == 1)
check("unknown weather becomes none", sc._scene_plan({**answer, "weather": "meteors"}, stage, 12)["weather"] == "none")
raises("a plan without usable additions is rejected", lambda: sc._scene_plan({"additions": [], "effects": []}, stage, 12))
raises("a plan for another stage is rejected", lambda: sc._read_plan(json.dumps(plan), "roof"))

# --- the graphs the paid nodes expand into ------------------------------------------------------------------------
root = tempfile.mkdtemp(prefix="cfz-scenery-test-")
project = {"_type": "CFZ_PROJECT", "root_directory": root, "title": "T", "subtitle": "", "style": "s", "ui_style": "u",
           "stage_style": "st", "model": fx.MODELS[0], "seed": 1}


def of(graph, class_type):
    return [(node_id, node) for node_id, node in graph.items() if node["class_type"] == class_type]


director = sc.CFZSceneDirector.execute(project, ["3", 0], "yard", "Yard", "A fictional yard.", "more pigeons", 10)
(gemini_id, gemini), = of(director.expand, "GeminiNodeV3")
(_, parse), = of(director.expand, "CFZScenePlan")
check("the director reads the painting with Gemini vision and a bounded answer", gemini["inputs"]["model.images.image_1"] == ["3", 0]
      and gemini["inputs"]["model"] == "Gemini 3.8 Flash" and gemini["inputs"]["model.max_output_tokens"] == sc.DIRECTOR_MAX_TOKENS
      and "exactly 10 new things" in gemini["inputs"]["model.prompt"] and "more pigeons" in gemini["inputs"]["model.prompt"])
check("the director's answer is parsed by CFZScenePlan", parse["inputs"]["text"] == [gemini_id, 0] and parse["inputs"]["element_count"] == 10)
painter = sc.CFZStageScenery.execute(project, ["3", 0], "yard", "Yard", "A fictional yard.", json.dumps(plan))
(painter_id, paint), = of(painter.expand, "GeminiNanoBanana2V2")
check("the painter adds exactly the planned additions where listed", "Only ADD these 2 things" in paint["inputs"]["prompt"]
      and "a small camera drone - around x 0.65-0.72 and y 0.10-0.20" in paint["inputs"]["prompt"] and paint["inputs"]["model.images.image_1"] == ["3", 0]
      and paint["inputs"]["model.resolution"] == "2K")
check("the populated scene is saved as <stage>_scene", any(json.loads(n["inputs"]["asset_json"])["id"] == "yard_scene" for _, n in of(painter.expand, "CFZSaveMappedAsset")))
isolate = sc.CFZSceneIsolate.execute(project, ["9", 1], "yard", "Yard", "A fictional yard.", json.dumps(plan))
(_, iso), = of(isolate.expand, "GeminiNanoBanana2V2")
check("the separation keeps the planned additions by name on chroma green", "these added figures and props: drone; fan" in iso["inputs"]["prompt"]
      and iso["inputs"]["model.images.image_1"] == ["9", 1] and "RGB(0,255,0)" in iso["inputs"]["prompt"])
check("the isolated layer is saved keyed as <stage>_isolated", any(json.loads(n["inputs"]["asset_json"]) == {"id": "yard_isolated", "kind": "scene", "stage": "yard", "key": True}
                                                                for _, n in of(isolate.expand, "CFZSaveMappedAsset")))

# --- extraction on synthetic images -----------------------------------------------------------------------------
W, H = 600, 340
plate = np.zeros((H, W, 3), np.uint8); plate[:] = (20, 30, 60); plate[250:] = (90, 90, 100)
plate[40:43, :] = (10, 10, 10)                                  # line art the separation edit may keep
scene = plate.copy()
scene[60:150, 400:430] = (220, 50, 40)                          # an added figure (planned: the drone)
scene[150:156, 380:450] = (40, 50, 80)                          # its halo, changed right under it: dropped
scene[300:304, 100:160] = (200, 220, 255)                       # a reflection the edit painted on the floor: still
isolated = np.zeros((H, W, 3), np.uint8); isolated[:] = (0, 255, 0)
isolated[60:150, 400:430] = (220, 50, 40); isolated[40:43, :] = (10, 10, 10)
tensor = lambda pixels: torch.from_numpy(pixels.astype(np.float32) / 255.0)[None]
figure_plan = {**plan, "additions": [{"name": "drone", "description": "a drone", "kind": "prop", "box": {"x": .66, "y": .17, "w": .06, "h": .27}, "motion": "hover"}]}
result = sc.CFZExtractScenery.execute(project, tensor(plate), tensor(scene), tensor(isolated), json.dumps(figure_plan), "yard", "Yard", "A fictional yard.")
bundle, review, layout_path = result.result
layers = bundle["assets"]
moving = [r for r in layers if r["motion"] != "still"]; still = [r for r in layers if r["motion"] == "still"]
check("one keyed figure and one still change are cut; the halo and the kept line art are not", len(moving) == 1 and len(still) == 1)
figure = moving[0]
check("the figure follows its planned motion and name", figure["motion"] == "hover" and figure["label"] == "drone" and figure["id"] == "yard_el1")
p = figure["place"]
check("the figure is cut at its exact place", abs(p["x"] * W - 400) <= 4 and abs(p["y"] * H - 60) <= 4 and abs(p["w"] * W - 30) <= 8 and abs(p["h"] * H - 90) <= 8)
with __import__("PIL").Image.open(os.path.join(root, figure["src"])) as cutout:
    alpha = np.asarray(cutout)[..., 3]
check("the cut-out keeps the figure opaque and its surroundings clear", cutout.mode == "RGBA" and alpha.max() == 255 and alpha[0, 0] == 0)
check("records map into assets.json as layer kind with their files", all(r["kind"] == "layer" and r["src"].startswith("raw/") and os.path.isfile(os.path.join(root, r["src"])) for r in layers))
check("the stage carries the plan's weather and effects", bundle["stages"][0]["scenery"]["weather"] == "rain" and [e["type"] for e in bundle["stages"][0]["scenery"]["effects"]] == ["blink", "screen", "steam"])
layout = json.load(open(layout_path, encoding="utf-8"))
check("the placement file lists elements and effects", layout["schema"] == sc.LAYOUT_SCHEMA and len(layout["elements"]) == 2 and len(layout["effects"]) == 3
      and os.path.isfile(os.path.join(root, "scenery", "yard-review.png")))
check("the review sheet is an image output", tuple(review.shape) == (1, 2 * round(H * 1280 / W), 1280, 3))
# A reviewer edits the placement file; a re-run keeps the id and the reviewed motion.
layout["elements"][[e["id"] for e in layout["elements"]].index("yard_el1")]["motion"] = "cheer"
open(layout_path, "w", encoding="utf-8").write(json.dumps(layout))
again = sc.CFZExtractScenery.execute(project, tensor(plate), tensor(scene), tensor(isolated), json.dumps(figure_plan), "yard", "Yard", "A fictional yard.").result[0]
check("a re-run keeps reviewed ids and motions", any(r["id"] == "yard_el1" and r["motion"] == "cheer" for r in again["assets"]))

# Plan-aware grouping: a spectator and the cat beside it touch but stay two elements; two pigeons apart are one.
crowd = plate.copy(); crowd[100:200, 100:130] = (200, 180, 60); crowd[170:200, 131:150] = (60, 200, 220)
crowd[80:88, 300:310] = (240, 240, 240); crowd[80:88, 330:340] = (240, 240, 240)
crowd_iso = np.zeros((H, W, 3), np.uint8); crowd_iso[:] = (0, 255, 0); crowd_iso[100:200, 100:130] = (200, 180, 60); crowd_iso[170:200, 131:150] = (60, 200, 220)
crowd_iso[80:88, 300:310] = (240, 240, 240); crowd_iso[80:88, 330:340] = (240, 240, 240)
crowd_plan = {**plan, "additions": [
    {"name": "spectator", "description": "a spectator", "kind": "character", "box": {"x": 100 / W, "y": 100 / H, "w": 30 / W, "h": 100 / H}, "motion": "cheer"},
    {"name": "cat", "description": "a cat", "kind": "creature", "box": {"x": 131 / W, "y": 170 / H, "w": 19 / W, "h": 30 / H}, "motion": "idle"},
    {"name": "pigeons", "description": "two pigeons", "kind": "creature", "box": {"x": 298 / W, "y": 78 / H, "w": 44 / W, "h": 12 / H}, "motion": "sway"}]}
crowd_root = tempfile.mkdtemp(prefix="cfz-scenery-crowd-")
crowd_cut = sc.CFZExtractScenery.execute({**project, "root_directory": crowd_root}, tensor(plate), tensor(crowd), tensor(crowd_iso), json.dumps(crowd_plan), "yard", "Yard", "A fictional yard.").result[0]
labels = sorted((r["label"], r["motion"]) for r in crowd_cut["assets"] if r["motion"] != "still")
check("touching additions stay separate and one addition's pieces join", labels == [("cat", "idle"), ("pigeons", "sway"), ("spectator", "cheer")])

# --- metadata and exports ------------------------------------------------------------------------------------------
members = {"fighters": [], "stages": [stage]}
check("layer metadata keeps place, motion, order and label", cfz._metadata({"id": "yard_el9", "kind": "layer", "stage": "yard", "place": {"x": .1, "y": .2, "w": .1, "h": .2},
                                                                              "motion": "drift", "order": 3, "label": "airship"}, members)
      == {"id": "yard_el9", "kind": "layer", "stage": "yard", "place": {"x": .1, "y": .2, "w": .1, "h": .2}, "motion": "drift", "order": 3, "label": "airship"})
raises("a layer needs a place", lambda: cfz._metadata({"id": "yard_el9", "kind": "layer", "stage": "yard"}, members))
raises("a layer motion must be known", lambda: cfz._metadata({"id": "yard_el9", "kind": "layer", "stage": "yard", "place": {"x": 0, "y": 0, "w": .1, "h": .1}, "motion": "moonwalk"}, members))
raises("a layer needs a stage", lambda: cfz._metadata({"id": "el9", "kind": "layer", "place": {"x": 0, "y": 0, "w": .1, "h": .1}}, members))
raises("scenery effects must be known", lambda: cfz._scenery_definition({"weather": "rain", "effects": [{"type": "teleport", "box": {"x": 0, "y": 0, "w": .1, "h": .1}}]}))
raises("scenery weather must be known", lambda: cfz._scenery_definition({"weather": "meteors"}))
saved = lambda meta: cfz._save_image(np.zeros((1, 8, 8, 3), np.float32), fx._project(project), cfz._metadata(meta, members))
scene_bundle = {"_type": "CFZ_BUNDLE", "_root": str(fx._project(project)), "fighters": [], "stages": [stage],
                "assets": [saved({"id": "yard_scene", "kind": "scene", "stage": "yard", "key": False}), saved({"id": "yard_isolated", "kind": "scene", "stage": "yard", "key": True})]}
fx._export(project, {"bundle_0": scene_bundle, "bundle_1": again}, False)
patch = json.load(open(os.path.join(root, "assets.json"), encoding="utf-8"))
check("the scenery patch carries the stage's scenery and placed layers", patch["partial"] is True and patch["game"]["stages"][0]["scenery"]["weather"] == "rain"
      and {a["id"] for a in patch["assets"]} == {"yard_scene", "yard_isolated", *(r["id"] for r in again["assets"])}
      and all("place" in a and "motion" in a for a in patch["assets"] if a["kind"] == "layer"))
other = {**again, "stages": [{**stage, "scenery": {"weather": "snow", "effects": []}}]}
raises("two different sceneries for one stage conflict", lambda: fx._merge(project, {"a": again, "b": other}))
check("a plain stage definition merges with its scenery", fx._merge(project, {"a": scene_bundle, "b": again})["stages"][0]["scenery"]["weather"] == "rain")
check("every scenery node defines its schema", all(cls.define_schema().node_id == cls.__name__ for cls in sc.SCENERY_NODES))
check("the director and both edits are paid API nodes; the plan and extraction are local",
      [cls.define_schema().is_api_node is True for cls in sc.SCENERY_NODES] == [True, False, True, True, False])
print("\n%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
