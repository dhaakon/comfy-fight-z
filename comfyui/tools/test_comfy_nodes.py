"""Exercise the Comfy Fighter Z node pack's local logic without a running server.

Run with the Python environment of an installed ComfyUI (no models or cloud calls):
  COMFYUI_ROOT=<ComfyUI folder> <ComfyUI python> comfyui/tools/test_comfy_nodes.py
"""
import io
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

# The optional title ensemble is accepted in a complete export.
with_ensemble = dict(bundles)
with_ensemble["bundle_4"] = {"_type": "CFZ_BUNDLE", "_root": str(fx._project(project)), "fighters": [], "stages": [],
                             "assets": [saved({"id": "ensemble", "kind": "ui", "key": False}, shared_members)]}
fx._export(project, with_ensemble, True)
check("complete export keeps the optional title ensemble", "ensemble" in {a["id"] for a in json.load(open(os.path.join(root, "assets.json"), encoding="utf-8"))["assets"]})

# Videos: ID rules, MP4 storage with hashes, and the video.json exporter.
check("title and intro video IDs accepted", fx._video_record({"id": "title"}) == {"id": "title"}
      and fx._video_record({"id": "intro-pat", "fighter": "pat"}) == {"id": "intro-pat", "fighter": "pat"})
raises("intro ID must match its fighter", lambda: fx._video_record({"id": "intro-other", "fighter": "pat"}))
raises("unknown video kind rejected", lambda: fx._video_record({"id": "trailer"}))


def tiny_mp4(seconds=1, fps=8):
    import av
    buffer = io.BytesIO()
    with av.open(buffer, mode="w", format="mp4") as container:
        stream = container.add_stream("libx264" if "libx264" in av.codecs_available else "h264", rate=fps)
        stream.width, stream.height, stream.pix_fmt = 64, 64, "yuv420p"
        for index in range(seconds * fps):
            frame = av.VideoFrame.from_ndarray(np.full((64, 64, 3), index * 20 % 255, dtype=np.uint8), format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    return buffer.getvalue()


directory = fx._project(project)
title = fx._store_video(directory, {"id": "title"}, tiny_mp4())
intro = fx._store_video(directory, {"id": "intro-pat", "fighter": "pat"}, tiny_mp4(2))
check("stored video keeps a hashed MP4 path, duration and no audio", title["src"].startswith("raw/title-") and title["src"].endswith(".mp4")
      and 0.5 < title["duration"] <= 1.5 and title["hasAudio"] is False and os.path.isfile(os.path.join(root, title["src"])))
path, _ = fx._export_videos(directory, [title, intro])
videos = json.load(open(path, encoding="utf-8"))
check("video.json maps the title loop and fighter intros", videos["schema"] == "comfy-fighter-video/v1" and videos["titleVideo"]["id"] == "title"
      and [v["id"] for v in videos["fighterIntros"]] == ["intro-pat"] and "_root" not in videos["titleVideo"])
raises("duplicate videos rejected", lambda: fx._export_videos(directory, [title, title]))
open(os.path.join(root, intro["src"]), "ab").write(b"changed")
raises("changed video rejected", lambda: fx._export_videos(directory, [title, intro]))

# Cloud wiring: several references become image_1..image_n; video nodes declare their inputs.
graph = fx.GraphBuilder()
node = fx._cloud(graph, project, "prompt", [["10", 0], None, ["11", 1]], "16:9", "2K")
inputs = graph.finalize()[node.id]["inputs"]
check("multiple references map to consecutive image slots", inputs["model.images.image_1"] == ["10", 0] and inputs["model.images.image_2"] == ["11", 1] and "model.images.image_3" not in inputs)
for cls in (fx.CFZTitleArt, fx.CFZTitleCard, fx.CFZTitleVideo, fx.CFZIntroVideo, fx.CFZSaveVideo, fx.CFZExportVideos):
    check(f"{cls.__name__} schema defines", cls.define_schema().node_id == cls.__name__)
single = fx.GraphBuilder()
node = fx._cloud(single, project, "prompt", ["10", 0], "2:3")
inputs = single.finalize()[node.id]["inputs"]
check("a single reference link stays one image", inputs["model.images.image_1"] == ["10", 0] and "model.images.image_2" not in inputs)

# Expansions: inspect the native graphs nodes would queue, without running them.
def link(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int)


def expanded(output):
    graph = output.expand
    bad = [f"{key}={value!r}" for node in graph.values() for key, value in node["inputs"].items() if key.startswith("model.images.") and not link(value)]
    check("every cloud image input in the expansion is a link", not bad)
    return graph


def of(graph, class_type):
    return [(node_id, node) for node_id, node in graph.items() if node["class_type"] == class_type]


factory = expanded(fx.CFZCharacterFactory.execute(project, "", "Pat", "A fictional fighter.", "Zap", "A zap.", "Hi.", "#3355aa", "pat",
                                                 include_sprite_sheets=False, source_mode="Invent fictional reference", include_arcade_art=True))
geminis = of(factory, "GeminiNanoBanana2V2")
source_id = next(node_id for node_id, node in geminis if "model.images.image_1" not in node["inputs"])
check("invented factory: the identity uses the generated source as its only reference",
      any(node["inputs"].get("model.images.image_1") == [source_id, 0] and "model.images.image_2" not in node["inputs"] for _, node in geminis)
      and len(geminis) == 6)
intro = expanded(fx.CFZIntroVideo.execute(project, plain, ["5", 1], ["7", 1], "6"))
(keyframe_id, keyframe), = of(intro, "GeminiNanoBanana2V2")
(ltx_id, ltx), = of(intro, "LtxApi25ImageToVideo")
(_, saved_video), = of(intro, "CFZSaveVideo")
check("intro keyframe combines the identity and the arena", keyframe["inputs"]["model.images.image_1"] == ["5", 1] and keyframe["inputs"]["model.images.image_2"] == ["7", 1])
check("intro clip animates the keyframe silently at 720p", ltx["inputs"]["image"] == [keyframe_id, 0] and ltx["inputs"]["model"] == "LTX-2.5 (Fast)"
      and ltx["inputs"]["model.duration"] == "6" and ltx["inputs"]["model.resolution"] == "1280x720" and ltx["inputs"]["model.generate_audio"] is False and "last_frame" not in ltx["inputs"])
check("intro clip is saved as intro-<fighter>", saved_video["inputs"]["video"] == [ltx_id, 0] and json.loads(saved_video["inputs"]["asset_json"]) == {"id": "intro-pat", "fighter": "pat"})
ensemble = expanded(fx.CFZTitleArt.execute(project, ["7", 1], fighter_1=["2", 1], fighter_2=["8", 1]))
(_, art), = of(ensemble, "GeminiNanoBanana2V2")
check("ensemble references each fighter, then the arena", [art["inputs"].get(f"model.images.image_{i}") for i in (1, 2, 3, 4)] == [["2", 1], ["8", 1], ["7", 1], None]
      and art["inputs"]["model.aspect_ratio"] == "16:9" and art["inputs"]["model.resolution"] == "2K")
check("ensemble is saved as the ui/ensemble asset", any(json.loads(node["inputs"]["asset_json"]) == {"id": "ensemble", "kind": "ui", "key": False} for _, node in of(ensemble, "CFZSaveMappedAsset")))
card = expanded(fx.CFZTitleCard.execute(project, ["15", 1], title_text="Rogue Protocol", tagline_text="Comfy Fighter Z"))
(_, lettered), = of(card, "GeminiNanoBanana2V2")
check("title card letters the exact game name over the accepted key art", lettered["inputs"]["model.images.image_1"] == ["15", 1] and '"ROGUE PROTOCOL"' in lettered["inputs"]["prompt"]
      and '"COMFY FIGHTER Z"' in lettered["inputs"]["prompt"] and lettered["inputs"]["model.resolution"] == "2K" and lettered["inputs"]["system_prompt"] == fx.CARD_SYSTEM_PROMPT)
check("title card is saved as the ui/card asset", any(json.loads(node["inputs"]["asset_json"]) == {"id": "card", "kind": "ui", "key": False} for _, node in of(card, "CFZSaveMappedAsset")))
menu = expanded(fx.CFZTitleVideo.execute(project, ["15", 1], "8"))
(_, loop), = of(menu, "LtxApi25ImageToVideo")
check("menu video loops the ensemble as first and last frame", loop["inputs"]["image"] == ["15", 1] and loop["inputs"]["last_frame"] == ["15", 1] and loop["inputs"]["model.duration"] == "8")
seedance_project = {**project, "video_model": "Seedance 1.5 Pro", "video_resolution": "1080p"}
sd_intro = expanded(fx.CFZIntroVideo.execute(seedance_project, plain, ["5", 1], ["7", 1], "4"))
(_, sd), = of(sd_intro, "ByteDanceImageToVideoNode")
check("Seedance intro uses the 1.5 Pro image-to-video node at 1080p 16:9 for 4 s without audio",
      sd["inputs"]["model"] == "seedance-1-5-pro-251215" and sd["inputs"]["resolution"] == "1080p" and sd["inputs"]["aspect_ratio"] == "16:9"
      and sd["inputs"]["duration"] == 4 and sd["inputs"]["generate_audio"] is False and not of(sd_intro, "LtxApi25ImageToVideo"))
sd_idle = expanded(fx.CFZSelectIdleVideo.execute(seedance_project, plain, ["5", 1], "6"))
(_, sd_loop), = of(sd_idle, "ByteDanceFirstLastFrameNode")
check("Seedance idle loop uses first-last-frame at 9:16", sd_loop["inputs"]["aspect_ratio"] == "9:16" and sd_loop["inputs"]["first_frame"] == sd_loop["inputs"]["last_frame"] and sd_loop["inputs"]["duration"] == 6)
# Every other node that passes one reference through _cloud keeps exactly that one image.
for label, output in (("sprite sheet", fx.CFZSpriteSheet.execute(project, plain, ["5", 1], "sheetD")),
                      ("character art", fx.CFZCharacterArt.execute(project, plain, ["5", 1], "ending"))):
    (_, cloud), = of(expanded(output), "GeminiNanoBanana2V2")
    check(f"{label} uses its one accepted identity", cloud["inputs"]["model.images.image_1"] == ["5", 1] and "model.images.image_2" not in cloud["inputs"])
arena = expanded(fx.CFZEnvironmentFactory.execute(project, "", True, "Yard", "A fictional yard.", "yard", "Invent fictional reference"))
arena_source = next(node_id for node_id, node in of(arena, "GeminiNanoBanana2V2") if "model.images.image_1" not in node["inputs"])
check("invented arena: the stage uses its generated source", any(node["inputs"].get("model.images.image_1") == [arena_source, 0] for _, node in of(arena, "GeminiNanoBanana2V2")))
shared_art = expanded(fx.CFZSharedArtFactory.execute(project, ["7", 1]))
check("shared art: only title and select use the arena", sorted(json.dumps(node["inputs"].get("model.images.image_1")) for _, node in of(shared_art, "GeminiNanoBanana2V2"))
      == sorted([json.dumps(["7", 1])] * 2 + ["null"] * 5))
reference = expanded(fx.CFZFictionalReference.execute(project, "An invented fighter.", "2:3", "1K"))
check("fictional reference is text-only", all("model.images.image_1" not in node["inputs"] for _, node in of(reference, "GeminiNanoBanana2V2")))
print("\n%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
