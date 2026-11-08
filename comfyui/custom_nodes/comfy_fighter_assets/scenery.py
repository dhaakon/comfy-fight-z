"""Living stage scenery: background characters, props and ambient effects for an accepted stage painting.

One reproducible graph per stage (comfyui/workflows/factory/stage-scenery.json), all inside ComfyUI:

  CFZSceneDirector   PAID, Gemini vision priced per token: reads the painting and plans the additions (who or
                     what, where it stands, how it moves) and the ambient effects anchored on features that are
                     already painted (beacons, billboards, vents, puddles, sky...), plus the weather.
  CFZStageScenery    PAID 2K edit: the painting repainted with exactly those additions, everything else kept.
  CFZSceneIsolate    PAID 2K edit: the additions alone, in place, on chroma green.
  CFZExtractScenery  local: cuts every addition out at its exact position and scale (the keyed outline,
                     confirmed where the scene really changed), keeps the scene's other changes as still layers,
                     and writes scenery/<stage>.json with the placed elements, the effects and the weather.

The game draws the clean painting as the plate and animates the elements and effects in the painting's own space,
so they keep its parallax and scale (build/public/render/scenery.js).
"""
import hashlib
from io import BytesIO
import json
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
import torch
from comfy_api.latest import io, ui
from comfy_execution.graph_utils import GraphBuilder

from . import EFFECT_TYPES, LAYER_MOTIONS, SCENERY_WEATHER, _atomic_write, _inside, _metadata, _scenery_definition, _slug
from .factories import KEY, Bundle, Project, _cloud, _collect, _members, _project, _reroll_input, _rerolled, _save, _text

PLAN_SCHEMA = "comfy-fighter-scene-plan/v1"
LAYOUT_SCHEMA = "comfy-fighter-scenery/v1"
DIRECTOR_MODELS = ["Gemini 3.8 Flash", "Gemini 3.1 Pro"]
# Output tokens include the model's thinking; the cap bounds the price of one plan.
DIRECTOR_MAX_TOKENS = 16384
MOTION_HINTS = {
    "idle": "stands and breathes", "cheer": "a spectator who bounces and cheers when the fight heats up",
    "hover": "floats in place", "drift": "travels slowly side to side", "bob": "floats up and down on water",
    "sway": "hangs or leans and rocks gently", "flicker": "a light, sign or hologram that flickers",
    "pulse": "glows or breathes rhythmically", "spin": "rotates in place", "still": "never moves",
}
EFFECT_HINTS = {
    "blink": "small blinking warning lights on antenna tips, tower tops, beacons or masts",
    "glow": "a lit sign, lamp, lantern or window cluster whose light flickers and breathes",
    "screen": "a billboard, TV or display screen whose picture cycles and glitches",
    "hologram": "a holographic projection that jitters with scanlines",
    "steam": "a vent, pipe, grate, manhole or pot giving off steam", "smoke": "a chimney, fire or exhaust giving off smoke",
    "sparks": "a broken cable, welding spot or machine spitting sparks", "torch": "a flame: torch, brazier, candle or campfire",
    "drip": "ledges, gutters or pipes dripping water", "searchlight": "the base of a searchlight whose beam sweeps the sky",
    "traffic": "an open sky or road lane where small distant vehicles pass", "birds": "open sky where small birds or bats fly by",
    "clouds": "sky where clouds drift", "fog": "a low band where mist or haze drifts", "lightning": "the sky a storm lights up",
    "ripples": "puddles, pools or a wet floor hit by raindrops", "shimmer": "water or glossy reflections that shimmer",
    "wave": "foliage, flags, banners, cloth or laundry swaying in the wind",
    "spin": "a tight square around a fan, wheel, turbine or radar dish that rotates",
    "flash": "a crowd area where camera flashes go off", "embers": "the air above a fire where embers rise",
    "fireflies": "grass or a garden at night where fireflies drift",
}
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


# ---------------------------------------------------------------------------------------------------- the plan
def _director_prompt(stage, direction, count):
    effects = "\n".join(f"   - {name} ({EFFECT_TYPES[name]}): {hint}" for name, hint in EFFECT_HINTS.items())
    motions = "; ".join(f"{name} - {hint}" for name, hint in MOTION_HINTS.items())
    return (
        "You are the background art director of a 1990s arcade fighting game. The image is the accepted painting of the stage "
        f"\"{stage['name']}\": {stage['description'] or 'see the image'}\n"
        + (f"Direction from the designer: {direction}\n" if direction else "")
        + "Plan its living background, the way classic arcade fighters animate their stages: background characters and props that "
        "belong in this place, and ambient effects on features that are ALREADY in the painting.\n\n"
        "Coordinates: boxes are \"box_2d\": [ymin, xmin, ymax, xmax] and points are [y, x], all normalized to 0-1000 over this image "
        "(0,0 is the top-left corner).\n\n"
        f"1. \"additions\": exactly {count} new things to paint into the scene. Each is wholly fictional (no real people, brands, logos "
        "or lettering) and fits the venue, its era and mood: spectators, workers, vendors, animals, robots, drones, vehicles, props. "
        "Mix them: at least half are characters or creatures, and at least two move through the air or across the background. Each has "
        "\"name\", \"description\" (what it looks like, its pose and colors, enough for a painter), \"kind\" (character, creature, "
        "vehicle, prop or light), \"box_2d\" (where it goes: standing ON an existing surface such as a ledge, balcony, rooftop, window, "
        "catwalk or the far background floor, or in open sky for things that fly; sized by perspective, smaller further away; a "
        "standing adult in the background is about 8-20% of the image height) and \"motion\", one of: " + motions + ". "
        "Keep the fighting floor clear: every box must end above y 640. Boxes must not overlap each other or important painted features.\n\n"
        "2. \"effects\": 10 to 24 ambient effects anchored on features ALREADY painted (not on the additions). Use only these types, "
        "with the geometry in brackets:\n" + effects + "\n"
        "   Each is {\"type\", \"box_2d\" | \"point\" | \"points\", \"label\" (the feature, e.g. \"red beacon on the left antenna\"), "
        "\"color\" (\"#rrggbb\", for lights)}. Boxes are tight around the feature and points exactly on it. Only use a type when the "
        "painting really shows that feature, and cover every matching feature (each antenna light, each billboard, each vent).\n\n"
        "3. \"weather\": one of " + ", ".join(SCENERY_WEATHER) + " - what falls in front of the fight, matching the painting.\n\n"
        "Return ONLY one JSON object: {\"weather\": ..., \"additions\": [...], \"effects\": [...]}. No markdown, no commentary."
    )


def _box(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        y0, x0, y1, x1 = (min(1000.0, max(0.0, float(v))) / 1000.0 for v in value)
    except (TypeError, ValueError):
        return None
    y0, y1 = sorted((y0, y1)); x0, x1 = sorted((x0, x1))
    if x1 - x0 < .004 or y1 - y0 < .004:
        return None
    return {"x": round(x0, 4), "y": round(y0, 4), "w": round(x1 - x0, 4), "h": round(y1 - y0, 4)}


def _point(value):
    if isinstance(value, dict):
        value = [value.get("y"), value.get("x")]
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    try:
        y, x = (min(1000.0, max(0.0, float(v))) / 1000.0 for v in value)
    except (TypeError, ValueError):
        return None
    return {"x": round(x, 4), "y": round(y, 4)}


def _plan_json(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("The scene director returned an empty answer; raise its reroll to ask again")
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    body = fence.group(1) if fence else text
    start, end = body.find("{"), body.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("The scene director returned no JSON plan; raise its reroll to ask again")
    try:
        data = json.loads(body[start:end + 1])
    except ValueError as error:
        raise ValueError(f"The scene director's plan is not valid JSON ({error}); raise its reroll to ask again") from error
    if not isinstance(data, dict):
        raise ValueError("The scene director's plan must be a JSON object")
    return data


def _scene_plan(data, stage, count):
    """Validate the director's answer: fractions instead of 0-1000, known motions and effect types only."""
    additions = []
    for item in data.get("additions") or []:
        if not isinstance(item, dict):
            continue
        box = _box(item.get("box_2d", item.get("box")))
        name = str(item.get("name") or "").strip()[:80]
        description = str(item.get("description") or "").strip()[:400]
        if not box or not (name or description):
            continue
        additions.append({"name": name or description[:40], "description": description or name, "kind": str(item.get("kind") or "").strip()[:24],
                          "box": box, "motion": item.get("motion") if item.get("motion") in LAYER_MOTIONS else "idle"})
        if len(additions) >= count:
            break
    if not additions:
        raise ValueError("The scene director planned no usable additions; raise its reroll to ask again")
    effects = []
    for item in data.get("effects") or []:
        if not isinstance(item, dict) or item.get("type") not in EFFECT_TYPES:
            continue
        geometry, effect = EFFECT_TYPES[item["type"]], {"id": f"fx{len(effects) + 1}", "type": item["type"]}
        if geometry == "box":
            effect["box"] = _box(item.get("box_2d", item.get("box")))
        elif geometry == "point":
            effect["point"] = _point(item.get("point") if item.get("point") is not None else (item.get("points") or [None])[0])
        else:
            raw = item.get("points") if isinstance(item.get("points"), list) else [item.get("point")]
            effect["points"] = [p for p in (_point(value) for value in raw) if p][:16] or None
        if not effect.get("box", effect.get("point", effect.get("points"))):
            continue
        if isinstance(item.get("color"), str) and COLOR.match(item["color"]):
            effect["color"] = item["color"].lower()
        label = str(item.get("label") or "").strip()[:80]
        if label:
            effect["label"] = label
        effects.append(effect)
        if len(effects) >= 32:
            break
    weather = data.get("weather") if data.get("weather") in SCENERY_WEATHER else "none"
    plan = {"schema": PLAN_SCHEMA, "stage": stage["id"], "weather": weather, "additions": additions, "effects": effects}
    _scenery_definition({"weather": weather, "effects": effects})
    return plan


def _read_plan(plan, stage_id=None):
    data = json.loads(plan) if isinstance(plan, str) else plan
    if not isinstance(data, dict) or data.get("schema") != PLAN_SCHEMA or not data.get("additions"):
        raise ValueError("Connect the plan from a CFZ Scene Director")
    if stage_id and data.get("stage") != stage_id:
        raise ValueError(f"The scene plan is for {data.get('stage')}, not {stage_id}")
    return data


def _stage(stage_id, name, description):
    return {"id": _slug(stage_id, "Stage ID"), "name": _text(name, "Stage name", True), "description": _text(description, "Stage description")}


def _stage_inputs():
    return [io.String.Input("stage_id", default="environment"), io.String.Input("name", default="New Environment"),
            io.String.Input("description", default="", multiline=True)]


class CFZSceneDirector(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSceneDirector", display_name="CFZ Scene Director (plan living scenery)", category="Comfy Fighter Z",
            description="PAID, priced per token (Gemini vision, about $0.02-0.19 a plan): reads the accepted stage painting and plans the background "
                        "characters and props to add (what, where, how each moves), the ambient effects on features already in the painting "
                        "(beacons, billboards, vents, puddles, sky, foliage...) and the weather. Its plan drives the painter, the separation and the extraction.",
            inputs=[Project.Input("project"), io.Image.Input("stage", raw_link=True), *_stage_inputs(),
                    io.String.Input("direction", default="", multiline=True, optional=True, tooltip="Optional: what you want in the background. Empty lets the director decide from the painting."),
                    io.Int.Input("element_count", default=12, min=4, max=16, optional=True, tooltip="How many characters and props to add."),
                    io.Combo.Input("director_model", options=DIRECTOR_MODELS, default=DIRECTOR_MODELS[0], optional=True, advanced=True), _reroll_input()],
            outputs=[io.String.Output(display_name="plan")], enable_expand=True, is_api_node=True)

    @classmethod
    def validate_inputs(cls, stage_id, name, description, **kwargs):
        try:
            _stage(stage_id, name, description)
            return True
        except ValueError as error:
            return str(error)

    @classmethod
    def execute(cls, project, stage, stage_id, name, description, direction="", element_count=12, director_model=DIRECTOR_MODELS[0], reroll=0):
        project = _rerolled(project, reroll)
        _project(project)
        definition, count = _stage(stage_id, name, description), max(4, min(16, int(element_count)))
        if director_model not in DIRECTOR_MODELS:
            raise ValueError("Choose a supported scene director model")
        graph = GraphBuilder()
        answer = graph.node("GeminiNodeV3", **{
            "model": director_model, "model.prompt": _director_prompt(definition, _text(direction or "", "Direction"), count),
            "model.images.image_1": stage, "model.video_processing": "static", "model.thinking_level": "MEDIUM",
            "model.max_output_tokens": DIRECTOR_MAX_TOKENS, "model.seed": (project["seed"] + 160) % 2147483647,
            "model.system_prompt": "You answer with one valid JSON object only."})
        plan = graph.node("CFZScenePlan", text=answer.out(0), stage_id=definition["id"], name=definition["name"],
                          description=definition["description"], element_count=count)
        return io.NodeOutput(plan.out(0), expand=graph.finalize())


class CFZScenePlan(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZScenePlan", display_name="CFZ Scene Plan (internal)", category="Comfy Fighter Z/internal",
            description="Parses and validates the scene director's answer into a scenery plan.",
            inputs=[io.String.Input("text", multiline=True, force_input=True), *_stage_inputs(), io.Int.Input("element_count", default=12, min=4, max=16)],
            outputs=[io.String.Output(display_name="plan")])

    @classmethod
    def execute(cls, text, stage_id, name, description, element_count=12):
        plan = _scene_plan(_plan_json(text), _stage(stage_id, name, description), max(4, min(16, int(element_count))))
        return io.NodeOutput(json.dumps(plan, ensure_ascii=False), ui=ui.PreviewText(
            f"{len(plan['additions'])} additions, {len(plan['effects'])} effects, weather {plan['weather']}"))


# ------------------------------------------------------------------------------------------- painter and separation
def _additions_text(plan):
    lines = []
    for number, item in enumerate(plan["additions"], 1):
        box = item["box"]
        lines.append(f"{number}. {item['description']} - around x {box['x']:.2f}-{box['x'] + box['w']:.2f} and y {box['y']:.2f}-{box['y'] + box['h']:.2f} "
                     f"of the image (x left to right, y top to bottom), about {box['h']:.0%} of the image height.")
    return "\n".join(lines)


class CFZStageScenery(io.ComfyNode):
    """The stage painting repainted once with its planned background life added in place."""
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZStageScenery", display_name="CFZ Stage Scenery (populated scene)", category="Comfy Fighter Z",
            description="PAID cloud generation: exactly one 2K image edit. Repaints the accepted stage painting with the scene director's additions "
                        "in place, keeping everything else identical. Saved as the stage's populated scene.",
            inputs=[Project.Input("project"), io.Image.Input("stage_reference", raw_link=True), *_stage_inputs(),
                    io.String.Input("plan", multiline=True, force_input=True, optional=True, tooltip="The CFZ Scene Director's plan."),
                    io.String.Input("crowd", default="", multiline=True, optional=True, tooltip="Without a plan: who and what to add."), _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="scene")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, stage_reference, stage_id, name, description, plan=None, crowd="", reroll=0):
        project = _rerolled(project, reroll)
        _project(project)
        stage = _stage(stage_id, name, description)
        members = _members(stage=stage); graph = GraphBuilder()
        if plan:
            planned = _read_plan(plan, stage["id"])
            additions = f"Only ADD these {len(planned['additions'])} things, each painted where listed:\n{_additions_text(planned)}\nAdd nothing else. "
        else:
            additions = f"Only ADD: {_text(crowd, 'Crowd') or 'three or four invented background spectators and one or two small moving props that naturally belong in this venue'}. "
        prompt = ("Edit the supplied stage painting. Return the SAME image: identical framing, camera, perspective, horizon, lighting, palette, line art and every "
                  "existing object in exactly the same place and size. " + additions +
                  "Paint every addition in the same illustration style and lighting so it belongs in the scene, standing on existing surfaces at the correct "
                  "perspective scale, fully visible, each one separate and not overlapping another. Keep the playable floor in the lower part of the image empty. "
                  "No fighters, no real people, no text, logos or lettering. Do not crop, zoom, shift, recolor or redraw anything else.")
        generated = _cloud(graph, project, prompt, stage_reference, "16:9", "2K", 150)
        asset = _save(graph, project, generated.out(0), {"id": f"{stage['id']}_scene", "kind": "scene", "stage": stage["id"], "key": False}, members)
        return io.NodeOutput(_collect(graph, project, members, [asset]), generated.out(0), expand=graph.finalize())


class CFZSceneIsolate(io.ComfyNode):
    """The separation step: the scene's additions alone, in place, on chroma green."""
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSceneIsolate", display_name="CFZ Scene Isolate (separate background characters)", category="Comfy Fighter Z",
            description="PAID cloud generation: exactly one 2K image edit. Keeps only the characters and props the populated scene added, in place, "
                        "on chroma green, so CFZ Extract Scenery can key clean, exactly placed cut-outs.",
            inputs=[Project.Input("project"), io.Image.Input("scene", raw_link=True), *_stage_inputs(),
                    io.String.Input("plan", multiline=True, force_input=True, optional=True, tooltip="The CFZ Scene Director's plan: names what to keep."),
                    _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="isolated")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, scene, stage_id, name, description, plan=None, reroll=0):
        project = _rerolled(project, reroll)
        _project(project)
        stage = _stage(stage_id, name, description)
        members = _members(stage=stage); graph = GraphBuilder()
        keep = ("the background characters, creatures, drones, robots, vehicles, holograms and other small props that stand apart from the architecture"
                if not plan else "these added figures and props: " + "; ".join(item["name"] for item in _read_plan(plan, stage["id"])["additions"]))
        prompt = (f"Edit the supplied image. Keep ONLY {keep}. Keep each one exactly where it is, at exactly the same size, pose and pixels. "
                  "Replace EVERYTHING else (sky, buildings, billboards, railings, machinery, floor, reflections, glows, shadows and all line art) "
                  "with flat uniform chroma green RGB(0,255,0). Do not move, resize, redraw, add or remove any kept figure. No text. " + KEY)
        isolated = _cloud(graph, project, prompt, scene, "16:9", "2K", 151)
        asset = _save(graph, project, isolated.out(0), {"id": f"{stage['id']}_isolated", "kind": "scene", "stage": stage["id"], "key": True}, members)
        return io.NodeOutput(_collect(graph, project, members, [asset]), isolated.out(0), expand=graph.finalize())


# ------------------------------------------------------------------------------------------------------ extraction
def _rgb(image):
    pixels = image.detach().cpu().numpy() if hasattr(image, "detach") else np.asarray(image)
    if pixels.ndim == 4:
        if pixels.shape[0] != 1:
            raise ValueError("Scenery images must be single images (batch size 1)")
        pixels = pixels[0]
    if pixels.ndim != 3 or pixels.shape[-1] < 3 or not np.isfinite(pixels).all():
        raise ValueError("Scenery images must be finite RGB images")
    return np.rint(np.clip(pixels[..., :3], 0.0, 1.0) * 255.0).astype(np.uint8)


def _fit(pixels, width, height):
    if pixels.shape[1] == width and pixels.shape[0] == height:
        return pixels
    return np.asarray(Image.fromarray(pixels).resize((width, height), Image.LANCZOS))


def _green_alpha(rgb):
    rgb = rgb.astype(np.int16)
    dominance = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
    return np.clip(1.0 - (dominance - 30) / 60.0, 0.0, 1.0)


def _anchor(group, anchors, w, h):
    """The planned addition a piece sits on: the box (grown by a fifth) holding its centre, nearest centre first."""
    cx, cy = (group["x0"] + group["x1"]) / 2 / w, (group["y0"] + group["y1"]) / 2 / h
    best = None
    for index, box in enumerate(anchors or []):
        gx, gy = box["w"] * .2 + .005, box["h"] * .2 + .005
        if box["x"] - gx <= cx <= box["x"] + box["w"] + gx and box["y"] - gy <= cy <= box["y"] + box["h"] + gy:
            distance = abs(cx - box["x"] - box["w"] / 2) / box["w"] + abs(cy - box["y"] - box["h"] / 2) / box["h"]
            if best is None or distance < best[0]:
                best = (distance, index)
    return None if best is None else best[1]


def _groups(mask, minimum, anchors=None):
    """Connected regions grouped into elements. With planned boxes (anchors), the pieces of one addition always join
    and two additions never merge; a piece outside every box joins whatever it nearly touches (a dark body under a
    bright head). Holes inside each group's box are filled. Returns a label image and the kept groups."""
    labels, count = ndimage.label(mask)
    owner = np.zeros(mask.shape, np.int32)
    if not count:
        return owner, []
    h, w = mask.shape
    areas = np.bincount(labels.ravel())
    groups = [{"labels": [n + 1], "area": int(areas[n + 1]), "x0": s[1].start, "y0": s[0].start, "x1": s[1].stop - 1, "y1": s[0].stop - 1}
              for n, s in enumerate(ndimage.find_objects(labels)) if s is not None and areas[n + 1] >= 3]
    for group in groups:
        group["anchor"] = _anchor(group, anchors, w, h)
    # The painter may draw an addition larger or a little off its planned box: a sizeable piece outside every box takes
    # the nearest planned addition no piece claimed yet, if it is close and of a comparable height.
    taken = {group["anchor"] for group in groups if group["anchor"] is not None}
    for group in sorted((g for g in groups if g["anchor"] is None and g["area"] >= minimum * w * h), key=lambda g: -g["area"]):
        cx, cy, gh = (group["x0"] + group["x1"]) / 2 / w, (group["y0"] + group["y1"]) / 2 / h, (group["y1"] - group["y0"] + 1) / h
        options = [(abs(cx - box["x"] - box["w"] / 2) + abs(cy - box["y"] - box["h"] / 2), index) for index, box in enumerate(anchors or [])
                   if index not in taken and .5 <= gh / box["h"] <= 4]
        options = [option for option in options if option[0] <= .15]
        if options:
            group["anchor"] = min(options)[1]; taken.add(group["anchor"])
    gap = round(w * .008)
    merged = True
    while merged:
        merged = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                a, b = groups[i], groups[j]
                touching = a["x0"] - gap <= b["x1"] and b["x0"] - gap <= a["x1"] and a["y0"] - gap <= b["y1"] and b["y0"] - gap <= a["y1"]
                same = a["anchor"] is not None and a["anchor"] == b["anchor"]
                if same or touching and (a["anchor"] is None or b["anchor"] is None):
                    a.update(area=a["area"] + b["area"], x0=min(a["x0"], b["x0"]), y0=min(a["y0"], b["y0"]), x1=max(a["x1"], b["x1"]),
                             y1=max(a["y1"], b["y1"]), labels=a["labels"] + b["labels"], anchor=a["anchor"] if a["anchor"] is not None else b["anchor"])
                    del groups[j]; merged = True; break
            if merged:
                break
    kept = [g for g in groups if g["area"] >= minimum * w * h and g["x1"] - g["x0"] > 3 and g["y1"] - g["y0"] > 3]
    for number, group in enumerate(kept, 1):
        group["label"] = number
        window = (slice(group["y0"], group["y1"] + 1), slice(group["x0"], group["x1"] + 1))
        member = ndimage.binary_fill_holes(np.isin(labels[window], group["labels"]))
        owner[window][member & (owner[window] == 0)] = number
    return owner, kept


def _overlap(p, q):
    ix = max(0.0, min(p["x"] + p["w"], q["x"] + q["w"]) - max(p["x"], q["x"]))
    iy = max(0.0, min(p["y"] + p["h"], q["y"] + q["h"]) - max(p["y"], q["y"]))
    inter = ix * iy
    return inter / (p["w"] * p["h"] + q["w"] * q["h"] - inter) if inter else 0.0


def _guess_motion(group, w, h, brightness):
    bw, bh = group["x1"] - group["x0"], group["y1"] - group["y0"]
    if brightness > 150 and bh < bw * 1.1:
        return "flicker"
    if group["y1"] < h * .42:
        return "hover"
    return "idle" if bh > bw * 1.15 else "sway"


def _png_layer(directory, identity, rgba):
    encoded = BytesIO()
    Image.fromarray(rgba, "RGBA").save(encoded, format="PNG")
    content = encoded.getvalue(); digest = hashlib.sha256(content).hexdigest()
    relative = f"raw/{identity}-{digest[:16]}.png"
    destination = _inside(directory, relative)
    if not destination.is_file() or destination.read_bytes() != content:
        _atomic_write(destination, content)
    return relative, digest


def _extract(plate, scene, isolated, plan, threshold=24, min_area=.00012, previous=None):
    """Cut the scene's additions out of it. Returns (figures, stills) as dicts with full-resolution boxes, RGBA
    pixels and a motion: figures follow the plan's addition they sit on, stills never move."""
    H, W = scene.shape[:2]
    plate, isolated = _fit(plate, W, H), _fit(isolated, W, H)
    k = min(1.0, 1100.0 / W); w, h = max(1, round(W * k)), max(1, round(H * k))

    def small(pixels, blur=True):
        image = Image.fromarray(pixels).resize((w, h), Image.BILINEAR)
        return np.asarray(image.filter(ImageFilter.GaussianBlur(1.5)) if blur else image)

    dist = np.abs(small(plate).astype(np.int16) - small(scene).astype(np.int16)).max(axis=2)
    changed = ndimage.binary_closing(ndimage.binary_opening(dist > threshold, np.ones((3, 3), bool)), np.ones((11, 11), bool))
    # The separation edit may keep the scene's unchanged line art on the green: a figure is keyed AND changed.
    figure_mask = (_green_alpha(small(isolated, False)) > .5) & ndimage.binary_dilation(changed, np.ones((9, 9), bool))
    additions = list(plan.get("additions", []))
    figure_owner, figures = _groups(figure_mask, min_area, [a["box"] for a in additions])
    rest_owner, stills = _groups(changed & ~ndimage.binary_dilation(figure_owner > 0, np.ones((7, 7), bool)), min_area)
    # Halo and scraps the edit changed around a figure are dropped: the clean plate shows there, so nothing ghosts.
    near = lambda s, f: (s["x0"] <= f["x1"] + (f["x1"] - f["x0"]) * .2 and s["x1"] >= f["x0"] - (f["x1"] - f["x0"]) * .2 and
                         s["y0"] <= f["y1"] + (f["y1"] - f["y0"]) * .2 and s["y1"] >= f["y0"] - (f["y1"] - f["y0"]) * .2)
    stills = [s for s in stills if not any(near(s, f) for f in figures)]
    key_alpha = _green_alpha(isolated)
    cut = []
    for kind, owner, groups in (("figure", figure_owner, figures), ("still", rest_owner, stills)):
        for group in sorted(groups, key=lambda g: g["x0"]):
            pad = 3
            x0, y0 = max(0, int(np.floor((group["x0"] - pad) / k))), max(0, int(np.floor((group["y0"] - pad) / k)))
            x1, y1 = min(W, int(np.ceil((group["x1"] + pad + 1) / k))), min(H, int(np.ceil((group["y1"] + pad + 1) / k)))
            ys = np.clip(np.rint(np.arange(y0, y1) * k).astype(int), 0, h - 1); xs = np.clip(np.rint(np.arange(x0, x1) * k).astype(int), 0, w - 1)
            if kind == "figure":
                member = ndimage.binary_dilation(owner == group["label"], np.ones((3, 3), bool))[np.ix_(ys, xs)]
                alpha = np.where(member, key_alpha[y0:y1, x0:x1], 0.0)
            else:
                yy, xx = np.meshgrid(np.arange(y0, y1) * k - .5, np.arange(x0, x1) * k - .5, indexing="ij")
                alpha = np.minimum(1.0, 1.4 * ndimage.map_coordinates((owner == group["label"]).astype(np.float32), [yy, xx], order=1, mode="nearest"))
            if alpha.max() <= 0:
                continue
            rgba = np.dstack([scene[y0:y1, x0:x1], np.rint(alpha * 255).astype(np.uint8)])
            solid = alpha > .5
            brightness = float(scene[y0:y1, x0:x1][solid].mean()) if solid.any() else 0.0
            place = {"x": round(x0 / W, 5), "y": round(y0 / H, 5), "w": round((x1 - x0) / W, 5), "h": round((y1 - y0) / H, 5)}
            cut.append({"kind": kind, "place": place, "rgba": rgba, "group": group, "brightness": brightness})
    # Motions: the plan's addition each figure sits on, else a guess. Reviewed values in the previous layout win.
    used = {item["group"]["anchor"] for item in cut if item["kind"] == "figure" and item["group"].get("anchor") is not None}
    for item in cut:
        if item["kind"] == "still":
            item.update(motion="still", label="scene change (glow, reflection)")
            continue
        if item["group"].get("anchor") is not None:
            addition = additions[item["group"]["anchor"]]
            item.update(motion=addition["motion"], label=addition["name"])
            continue
        scored = sorted(((max(_overlap(item["place"], a["box"]), .0001 if abs(item["place"]["x"] + item["place"]["w"] / 2 - a["box"]["x"] - a["box"]["w"] / 2) < .08
                              and abs(item["place"]["y"] + item["place"]["h"] / 2 - a["box"]["y"] - a["box"]["h"] / 2) < .12 else 0), n)
                         for n, a in enumerate(additions) if n not in used), reverse=True)
        if scored and scored[0][0] > 0:
            used.add(scored[0][1]); addition = additions[scored[0][1]]
            item.update(motion=addition["motion"], label=addition["name"])
        else:
            item.update(motion=_guess_motion(item["group"], w, h, item["brightness"]), label="unplanned addition")
    for item in cut:
        kept = max(((_overlap(item["place"], e["place"]), e) for e in (previous or {}).get("elements", [])), key=lambda pair: pair[0], default=(0, None))
        if kept[0] > .25:
            item["previous"] = kept[1]
    return cut


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _review(scene, plate, elements, effects):
    """Scene with every element boxed and labelled over the plate with every effect marked."""
    H, W = scene.shape[:2]; width = 1280; height = round(H * width / W)
    sheet = Image.new("RGB", (width, height * 2), "black")
    sheet.paste(Image.fromarray(scene).resize((width, height), Image.LANCZOS), (0, 0))
    sheet.paste(Image.fromarray(_fit(plate, W, H)).resize((width, height), Image.LANCZOS), (0, height))
    draw, font = ImageDraw.Draw(sheet), _font(15)

    def tag(x, y, text, color):
        box = draw.textbbox((x, y), text, font=font)
        draw.rectangle((box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2), fill="black"); draw.text((x, y), text, fill=color, font=font)

    for element in elements:
        p = element["place"]; x, y = p["x"] * width, p["y"] * height
        color = "#ffe600" if element["motion"] != "still" else "#9aa0a6"
        draw.rectangle((x, y, x + p["w"] * width, y + p["h"] * height), outline=color, width=2)
        tag(x + 2, max(0, y - 19), f"{element['id'].split('_')[-1]} {element['motion']}", color)
    for effect in effects:
        color = "#3df2ff"
        if "box" in effect:
            b = effect["box"]; x, y = b["x"] * width, height + b["y"] * height
            draw.rectangle((x, y, x + b["w"] * width, y + b["h"] * height), outline=color, width=2); tag(x + 2, y + 2, effect["type"], color)
        for p in ([effect["point"]] if "point" in effect else effect.get("points", [])):
            x, y = p["x"] * width, height + p["y"] * height
            draw.ellipse((x - 6, y - 6, x + 6, y + 6), outline=color, width=2)
        if "box" not in effect:
            first = effect["point"] if "point" in effect else effect["points"][0]
            tag(first["x"] * width + 8, height + first["y"] * height - 8, effect["type"], color)
    return sheet


class CFZExtractScenery(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZExtractScenery", display_name="CFZ Extract Scenery (placed layers + effects)", category="Comfy Fighter Z",
            description="Local, no cloud calls. Compares the populated scene with the clean painting and cuts every addition out at its exact "
                        "position and scale, using the isolated layer's key for clean edges. The scene's other changes stay as still layers. "
                        "Writes scenery/<stage>.json (placed elements, effects, weather) and a review sheet; reviewed motions on a re-run are kept.",
            inputs=[Project.Input("project"), io.Image.Input("stage"), io.Image.Input("scene"), io.Image.Input("isolated"),
                    io.String.Input("plan", multiline=True, force_input=True), *_stage_inputs(),
                    io.Int.Input("threshold", default=24, min=4, max=128, optional=True, advanced=True, tooltip="Colour difference that counts as a change."),
                    io.Float.Input("min_area", default=.00012, min=.00001, max=.01, step=.00001, optional=True, advanced=True, tooltip="Smallest element, as a fraction of the image.")],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="review"), io.String.Output(display_name="layout_path")])

    @classmethod
    def execute(cls, project, stage, scene, isolated, plan, stage_id, name, description, threshold=24, min_area=.00012):
        directory = _project(project)
        definition = _stage(stage_id, name, description); planned = _read_plan(plan, definition["id"])
        layout_file = _inside(directory, f"scenery/{definition['id']}.json")
        previous = json.loads(layout_file.read_text(encoding="utf-8")) if layout_file.is_file() else None
        plate_pixels, scene_pixels = _rgb(stage), _rgb(scene)
        cut = _extract(plate_pixels, scene_pixels, _rgb(isolated), planned, int(threshold), float(min_area), previous)
        taken = {e["id"] for e in (previous or {}).get("elements", [])}; used, number = set(), 1
        members = {"fighters": [], "stages": [definition]}
        elements, records = [], []
        for order, item in enumerate(cut):
            old = item.get("previous")
            if old and old["id"] not in used:
                identity, motion, label, depth = old["id"], old.get("motion", item["motion"]), old.get("label", item["label"]), old.get("order")
            else:
                while f"{definition['id']}_el{number}" in taken or f"{definition['id']}_el{number}" in used:
                    number += 1
                identity, motion, label, depth = f"{definition['id']}_el{number}", item["motion"], item["label"], None
            used.add(identity)
            relative, digest = _png_layer(directory, identity, item["rgba"])
            layer_order = depth if isinstance(depth, int) else (0 if motion == "still" else 1 + order)
            element = {"id": identity, "label": label, "src": relative, "place": item["place"], "motion": motion, "order": layer_order}
            record = _metadata({"id": identity, "kind": "layer", "stage": definition["id"], "key": False, "place": item["place"], "motion": motion,
                                "order": layer_order, "label": label}, members)
            record.update(src=relative, sha256=digest, width=int(item["rgba"].shape[1]), height=int(item["rgba"].shape[0]), _root=str(directory))
            elements.append(element); records.append(record)
        scenery = _scenery_definition({"weather": planned["weather"], "effects": planned["effects"]})
        layout = {"schema": LAYOUT_SCHEMA, "stage": definition["id"], "name": definition["name"],
                  "plate": {"width": int(scene_pixels.shape[1]), "height": int(scene_pixels.shape[0])},
                  "weather": scenery["weather"], "motions": list(LAYER_MOTIONS), "effectTypes": sorted(EFFECT_TYPES),
                  "elements": elements, "effects": scenery["effects"], "plan": planned}
        _atomic_write(layout_file, (json.dumps(layout, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        sheet = _review(scene_pixels, plate_pixels, elements, scenery["effects"])
        encoded = BytesIO(); sheet.save(encoded, format="PNG")
        _atomic_write(_inside(directory, f"scenery/{definition['id']}-review.png"), encoded.getvalue())
        bundle = {"_type": "CFZ_BUNDLE", "_root": str(directory), "fighters": [], "stages": [{**definition, "scenery": scenery}], "assets": records}
        review = torch.from_numpy(np.asarray(sheet, dtype=np.float32) / 255.0)[None]
        return io.NodeOutput(bundle, review, str(layout_file),
                             ui=ui.PreviewText(f"{sum(e['motion'] != 'still' for e in elements)} animated and {sum(e['motion'] == 'still' for e in elements)} still "
                                               f"element(s), {len(scenery['effects'])} effects, weather {scenery['weather']} -> {layout_file}"))


SCENERY_NODES = [CFZSceneDirector, CFZScenePlan, CFZStageScenery, CFZSceneIsolate, CFZExtractScenery]
