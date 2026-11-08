"""Small V3 factory nodes that expand the installed native cloud image node."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re

import av
import folder_paths
from PIL import Image
from comfy_api.latest import Types, io, ui
from comfy_execution.graph_utils import GraphBuilder

from . import SHEETS, EXTRA_SHEETS, MOTION_SHEETS, DETAIL_SHEETS, ALL_SHEETS, STYLES, SCHEMA, AssetRecord, AssetRoot, CFZAssetRoot, _atomic_write, _inside, _json_object, _metadata, _reject_links, _root_path, _save_image, _scenery_definition, _slug

Project = io.Custom("CFZ_PROJECT")
Character = io.Custom("CFZ_CHARACTER")
Bundle = io.Custom("CFZ_BUNDLE")
MODELS = ["Gemini Nano Banana 2.1", "Nano Banana 2 (Gemini 3.1 Flash Image)"]
SOURCE_MODES = ["Upload reference", "Invent fictional reference"]
ROLES = ["Fighter", "Final boss"]
# Pose directions keep generated in-betweens readable; every attack faces RIGHT.
POSE_HINTS = {
    "idle": "relaxed fighting guard", "walk": "forward walking stride, left foot leading", "punch": "straight lead-hand jab fully extended",
    "kick": "high roundhouse kick fully extended", "block": "standing forearm guard", "hit": "recoiling from a torso hit", "special": "signature special attack release",
    "down": "lying knocked down horizontally", "win": "triumphant victory pose", "stance2": "upright fighting guard, second idle pose",
    "crouch": "low crouching guard", "sweep": "low sweeping leg kick with the attacking foot extended to the RIGHT of the hips", "launcher": "rising uppercut toward the RIGHT",
    "jump": "airborne rising jump with bent knees", "airkick": "airborne forward kick", "hpunch": "heavy rear-hand punch fully extended", "dash": "forward dash leaning toward right",
    "tumble": "airborne backward tumble", "walk2": "walking stride, right foot leading", "lkick": "quick low standing kick", "cjab": "crouching jab",
    "airpunch": "airborne punch", "throw": "empty-handed forward throwing motion without another person", "taunt": "playful confident taunt",
    "getup": "rising from one knee", "powerup": "powering up, clenched fists", "entrance": "confident entrance pose",
    "walk3": "walking passing position, feet together under the hips, upright", "walk4": "walking stride, long step with the rear heel lifting",
    "run": "sprinting run toward the right, torso leaning forward, front knee high", "run2": "sprinting run toward the right, opposite legs, rear foot pushing off",
    "backstep": "quick backward hop away from the right, both feet just off the ground, guard up", "jumpfall": "airborne falling, legs extending down to land, arms guarding",
    "crouchblock": "low crouching block with both forearms raised in front of the face", "hitlow": "crouching hit reaction, head snapped back while staying low",
    "hitheavy": "heavy stagger hit, body bent backwards, one foot lifting", "punchwind": "lead-hand jab chambered at the shoulder, about to strike right",
    "kickwind": "front knee raised and chambered before a kick to the right", "heavywind": "rear arm pulled far back, torso coiled for a heavy blow",
    "roll": "evasive forward roll, body tucked in a tight ball", "blowback": "powerful two-handed palm strike or spinning kick that blasts the opponent away to the right",
    "super": "dramatic super-move stance, both arms thrust forward to the right with compact energy", "dizzy": "dazed stagger, wobbly knees, hand on forehead",
    "win2": "second celebratory victory pose, different from the first", "lose": "defeated, kneeling on one knee with the head bowed",
    "load": "strike anticipation, weight shifted onto the rear foot, lead shoulder turned in, rear fist chambered at the hip, the same stance width and foot placement as idle",
    "punchwhip": "straight punch caught halfway through its extension toward the right, elbow still bent, torso rotating into the blow, a short speed streak on the fist",
    "kickwhip": "roundhouse kick caught halfway, knee chambered high and the foot snapping out toward the right, arms counterbalancing",
    "recoil": "follow-through after a heavy punch, the punching arm dropping past the hip, torso carried forward beyond the stance, rear heel lifted",
    "settle": "returning to guard after a strike, both hands rising back toward the chin, knees re-bending, weight centering between the feet",
    "stepin": "walking passing step, both feet nearly together beneath the hips, body slightly raised, guard up",
    "stepout": "the opposite walking passing step, the other foot passing beneath the hips, guard up",
    "dashload": "dash anticipation, deep knee bend with the torso pitched forward and both arms swept back",
    "dashpass": "mid-dash, a low forward leap with both feet just off the ground, body nearly horizontal, arms trailing",
    "idle1": "breathing frame 1 of the neutral stance, identical to idle with the chest beginning to rise",
    "idle2": "breathing frame 2 of the neutral stance, shoulders and fists a few pixels higher than idle",
    "idle3": "breathing frame 3 of the neutral stance, chest lifted, elbows drifting slightly outward",
    "idle4": "breathing frame 4 of the neutral stance, near the top of the inhale, fists at their highest",
    "idle5": "breathing frame 5 of the neutral stance, the deepest inhale with shoulders highest, feet unchanged",
    "apex": "compact jump apex, knees tucked up, body curled, arms close to the chest, the highest point of the jump",
    "land": "landing compression, knees deeply bent, feet planted wide, torso low, arms out for balance",
    "kickrecoil": "follow-through after the roundhouse, the kicking leg sweeping down and across past the body, torso turned, arms counterbalancing",
    "walkf1": "walking forward to the RIGHT, contact frame: the leading leg reaching ahead with its heel just touching the floor, the rear leg straight behind on the ball of the foot, torso upright, fists in a loose guard",
    "walkf2": "walking forward to the right, passing frame: the rear foot swinging forward past the planted front foot, knees close together under the hips, body at its highest point, both fists held up in the same fighting guard as the other walking frames",
    "walkf3": "walking forward to the right, second contact frame: the OTHER leg now leads with its heel touching the floor ahead and the first leg straight behind, guard up",
    "walkf4": "walking forward to the right, second passing frame: the trailing foot swinging forward past the planted foot, knees together under the hips, both fists held up in the same fighting guard",
    "walkb1": "walking BACKWARD while still facing RIGHT: the rear foot reaching back and landing on its toes behind the body, weight on the front leg, torso leaning slightly back, both forearms raised in a cautious guard",
    "walkb2": "walking backward while facing right, passing frame: the front foot sliding back past the planted rear foot, knees together under the hips, cautious high guard",
    "walkb3": "walking backward while facing right, second step: the other foot reaching back and landing on its toes, torso leaning slightly back, cautious guard",
    "walkb4": "walking backward while facing right, second passing frame: the feet passing under the hips, cautious guard",
    "crouchdown": "halfway down into the crouch: knees deeply bent and hips dropped so the whole body is clearly lower than standing (about four fifths of the standing height), guard held up, facing right",
    "roll1": "starting an evasive forward roll toward the RIGHT: diving low, head ducking toward the floor, both hands reaching to the ground, back rounded",
    "roll2": "mid forward roll toward the right: curled on the upper back and shoulders, knees tucked to the chest, legs over the body, compact and low",
    "roll3": "later in the forward roll: body rotated further, sitting up out of the tuck with knees still to the chest, feet coming down to the floor",
    "roll4": "finishing the roll: on one knee in a low crouch, coming up, facing right",
    "rollrise": "standing back up into the upright fighting guard after the roll, facing right",
    "sweepwind": "starting a low sweep kick: dropping into a deep crouch with one hand on the floor, the attacking leg beginning to swing outward to the RIGHT just above the floor",
    "sweepfull": "low sweep kick at full extension: crouched low on the bent planted leg with both hands on the floor, the attacking leg straight out ALONG THE FLOOR to the RIGHT with the foot at ankle height, never raised to the knee or hip",
    "sweepthrough": "sweep follow-through: the sweeping leg carried past its furthest point along the floor, body spinning low over the planted leg, hands on the floor, the whole body still close to the ground",
    "sweepback": "recovering from the sweep: drawing the leg back under the body into the low crouching guard, still crouched low (not standing), facing right",
    "guardhit": "absorbing a blocked hit, forearms crossed and jolted back, weight pushed onto the rear foot, feet sliding, head tucked",
}
# Arcade art beyond the 27 required poses: two optional in-between sheets and an ending illustration.
ARTWORK = {
    "portrait": ("1:1", False, "Close-up face and shoulders for character selection. Expressive confident anime fighter portrait, uncluttered dark background, no text."),
    "hero": ("2:3", True, "One complete full-body hero fighter in their signature special-move stance, facing RIGHT. Keep the energy close to the body, and include complete shoes and hands with safe padding. "),
    "cutin": ("16:9", False, "Dramatic horizontal special-move cut-in: face and upper torso, fast energy streaks, strong negative space, no text."),
    "ending": ("16:9", False, "Arcade ending illustration for this fighter after winning the neighborhood tournament: one calm cinematic epilogue scene with the same character, warm evening light, a fictional suburban setting, readable expression and pose. No other recognizable people, no text, captions, logos, borders or panels."),
}
EFFECTS = ["hit", "block", "projectile", "dust", "ko", "powerup", "dash", "launch", "spark"]
DEFAULT_STYLE = "Original 1990s shonen battle-anime fighting-game artwork. Bold clean ink, angular expressive eyes, two-tone cel shading, dynamic clear silhouettes and vivid energy. Preserve the supplied fictional character design, clothing and accessories; no real-person likenesses or copied franchise characters or costumes."
DEFAULT_STAGE_STYLE = "Anime fighting-game stage based on the supplied fictional environment design. Wide side-on camera and clear level fighting floor; keep architecture and furniture behind the fight plane. No real venue details, people, lettering, logos, floor emblems, speed-line borders or vignette."
KEY = "Flat uniform chroma green RGB(0,255,0), no green clothing, no floor shadows, no detached debris, no text, grid lines, borders or watermark."
SYSTEM_PROMPT = "Generate exactly one finished game-art image following the requested layout and reference. Do not return a collage unless a nine-cell sprite sheet is explicitly requested."


def _text(value, label, required=False):
    if not isinstance(value, str) or required and not value.strip():
        raise ValueError(f"{label} must be {'nonempty ' if required else ''}text")
    return value.strip()


def _project(project):
    if not isinstance(project, dict) or project.get("_type") != "CFZ_PROJECT":
        raise ValueError("Connect CFZ Project Settings")
    directory = _root_path(project.get("root_directory"))
    if project.get("model") not in MODELS:
        raise ValueError("Choose a supported native cloud image model")
    if project.get("video_model", VIDEO_MODELS[0]) not in VIDEO_MODELS or project.get("video_resolution", VIDEO_RESOLUTIONS[0]) not in VIDEO_RESOLUTIONS:
        raise ValueError("Choose a supported cloud video model and resolution")
    return directory


def _character(name, description, special_name, special_description, intro_tagline, color, character_id,
               fighting_style="balanced", super_name="", super_description="", win_quote="", ending="", role="Fighter"):
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Character color must use #RRGGBB")
    if fighting_style not in STYLES:
        raise ValueError(f"Fighting style must be one of {', '.join(STYLES)}")
    if role not in ROLES:
        raise ValueError("Role must be Fighter or Final boss")
    result = {"id": _slug(character_id, "Character ID"), "name": _text(name, "Character name", True),
              "description": _text(description, "Character description"), "color": color,
              "specialMove": {"name": _text(special_name, "Special move name", True), "description": _text(special_description, "Special move description", True)},
              "introTagline": _text(intro_tagline, "Intro tagline"), "style": fighting_style}
    if _text(super_name, "Super move name"):
        result["superMove"] = {"name": _text(super_name, "Super move name"), "description": _text(super_description, "Super move description", True)}
    for field, value, limit in (("winQuote", win_quote, 200), ("ending", ending, 800)):
        value = _text(value, field)
        if len(value) > limit:
            raise ValueError(f"{field} must be at most {limit} characters")
        if value:
            result[field] = value
    if role == "Final boss":
        result["boss"] = True
    return result


def _checked_character(character):
    if not isinstance(character, dict):
        raise ValueError("Connect CFZ Character Definition or a character factory")
    if not isinstance(character.get("specialMove"), dict):
        raise ValueError("Character requires a special move name and description")
    return _character(character.get("name"), character.get("description", ""), character.get("specialMove", {}).get("name"),
                      character.get("specialMove", {}).get("description"), character.get("introTagline", ""), character.get("color"), character.get("id"),
                      character.get("style", "balanced"), (character.get("superMove") or {}).get("name", ""), (character.get("superMove") or {}).get("description", ""),
                      character.get("winQuote", ""), character.get("ending", ""), "Final boss" if character.get("boss") else "Fighter")


def _character_inputs():
    return [io.String.Input("name", default="New Fighter"), io.String.Input("description", default="", multiline=True),
            io.String.Input("special_name", default="Energy Burst"), io.String.Input("special_description", default="A compact energy projectile released from the forward palm.", multiline=True),
            io.String.Input("intro_tagline", default="This fight is mine."), io.String.Input("color", default="#ffd23f", advanced=True),
            io.String.Input("character_id", default="fighter", advanced=True)]


def _arcade_inputs():
    return [io.Combo.Input("fighting_style", options=list(STYLES), default="balanced", optional=True,
                           tooltip="Gameplay archetype: specials, speed and damage. Free; does not change paid calls."),
            io.String.Input("super_name", default="", optional=True, tooltip="Super move name shown in the cut-in and called by the fighter's voice."),
            io.String.Input("super_description", default="", multiline=True, optional=True),
            io.String.Input("win_quote", default="", optional=True, tooltip="Arcade win-screen quote, up to 200 characters."),
            io.String.Input("ending", default="", multiline=True, optional=True, tooltip="Arcade ending text, up to 800 characters."),
            io.Combo.Input("role", options=ROLES, default="Fighter", optional=True, tooltip="Final boss closes Arcade mode. At most one per game.")]


def _arcade_values(kwargs):
    return [kwargs.get("fighting_style", "balanced"), kwargs.get("super_name", ""), kwargs.get("super_description", ""),
            kwargs.get("win_quote", ""), kwargs.get("ending", ""), kwargs.get("role", "Fighter")]


def _image_input():
    directory = Path(folder_paths.get_input_directory())
    files = [item.name for item in directory.iterdir() if item.is_file()] if directory.exists() else []
    images = folder_paths.filter_files_content_types(files, ["image"])
    return io.Combo.Input("image", options=[""] + sorted(images), default="", upload=io.UploadType.image, image_folder=io.FolderType.input,
                          tooltip="Used only in Upload reference mode. Invent fictional reference ignores this field completely. Disabled environment slots may remain empty.")


def _source_mode(value):
    if value not in SOURCE_MODES:
        raise ValueError("Source mode must be Upload reference or Invent fictional reference")
    return value


def _source_mode_input():
    return io.Combo.Input("source_mode", options=SOURCE_MODES, default=SOURCE_MODES[0], optional=True,
                          tooltip="Invent fictional reference creates a new source from text and never loads any selected/uploaded image. It adds one paid cloud image call.")


def _input_image(filename):
    if not isinstance(filename, str) or not filename.strip():
        raise ValueError("Upload or select a reference image before generating")
    directory = Path(folder_paths.get_input_directory()).resolve()
    file = Path(folder_paths.get_annotated_filepath(filename, str(directory)))
    _reject_links(file)
    file = file.resolve()
    if not file.is_relative_to(directory) or not file.is_file():
        raise ValueError("Reference image must be an existing file inside ComfyUI's input directory")
    return filename


def _image_hash(filename):
    _input_image(filename)
    return hashlib.sha256(Path(folder_paths.get_annotated_filepath(filename)).read_bytes()).hexdigest()


def _members(character=None, stage=None):
    return {"fighters": [character] if character else [], "stages": [stage] if stage else [], "sheets": SHEETS, "extraSheets": EXTRA_SHEETS, "motionSheets": MOTION_SHEETS, "detailSheets": DETAIL_SHEETS}


def _artwork(graph, project, character, identity, kind, offset):
    aspect, key, prompt = ARTWORK[kind]
    if kind == "cutin" and character.get("superMove"):
        prompt += f" Depict the super move {character['superMove']['name']}: {character['superMove']['description']}"
    if kind == "ending" and character.get("ending"):
        prompt += f" Ending story beat: {character['ending']}"
    generated = _cloud(graph, project, _description(project, character) + "\n" + prompt + (KEY if key else ""), identity, aspect, offset=offset)
    return _save(graph, project, generated.out(0), {"id": f"{character['id']}_{kind}", "kind": kind, "fighter": character["id"], "key": key}, _members(character=character))


def _cloud(graph, project, prompt, reference=None, aspect="1:1", resolution="1K", offset=0):
    inputs = {"prompt": prompt, "model": project["model"], "model.aspect_ratio": aspect, "model.resolution": resolution,
              "model.thinking_level": "MINIMAL", "seed": (project["seed"] + offset) % (2 ** 64),
              "response_modalities": "IMAGE", "system_prompt": SYSTEM_PROMPT}
    # One reference link, or a list of them (the ensemble and intro keyframes combine fighters and an arena).
    # A single link is itself a [node_id, output] pair, so it must not be unpacked as a list of images.
    single = reference is None or (isinstance(reference, (list, tuple)) and len(reference) == 2 and isinstance(reference[0], str) and isinstance(reference[1], int))
    references = [image for image in ([reference] if single else reference) if image is not None]
    for index, image in enumerate(references, 1):
        inputs[f"model.images.image_{index}"] = image
    return graph.node("GeminiNanoBanana2V2", **inputs)


def _save(graph, project, image, metadata, members):
    return graph.node("CFZSaveMappedAsset", project=project, image=image, asset_json=json.dumps(metadata), members_json=json.dumps(members)).out(0)


def _collect(graph, project, members, assets=(), bundles=()):
    inputs = {"project": project, "members_json": json.dumps(members)}
    inputs.update({f"assets.asset_{i}": asset for i, asset in enumerate(assets)})
    inputs.update({f"bundles.bundle_{i}": bundle for i, bundle in enumerate(bundles)})
    return graph.node("CFZCollectBundle", **inputs).out(0)


def _description(project, character):
    return (f"{project['style']}\nCHARACTER: {character['description']}\n"
            f"SPECIAL MOVE — {character['specialMove']['name']}: {character['specialMove']['description']}\n"
            "Keep one consistent complete character, recognizable hair, outfit and accessories. Exactly one of each accessory.")


VIDEO_MODELS = ["LTX-2.5 (Fast)", "Seedance 1.5 Pro"]
VIDEO_RESOLUTIONS = ["720p", "1080p"]
SEEDANCE_MODEL = "seedance-1-5-pro-251215"


def _reroll_input():
    return io.Int.Input("reroll", default=0, min=0, max=99, optional=True, advanced=True,
                        tooltip="Raise to redraw this node's images and clips with fresh seeds; every other node stays cached and unbilled.")


def _rerolled(project, reroll):
    return project if not reroll else {**project, "seed": (project["seed"] + int(reroll) * 1000) % (2 ** 64)}


class CFZProjectSettings(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZProjectSettings", display_name="CFZ Project Settings", category="Comfy Fighter Z",
            description="Shared output root and cloud model settings. Preparing this node makes no paid requests.",
            inputs=[io.String.Input("root_directory", default=str(Path(folder_paths.get_output_directory()) / "comfy-fighter-z")),
                    io.String.Input("title", default="Comfy Fighter Z"), io.String.Input("subtitle", default="Higgsfield Open Source Saga"),
                    io.String.Input("style", default=DEFAULT_STYLE, multiline=True, advanced=True),
                    io.String.Input("ui_style", default="Bold anime arcade tournament interface, midnight blue, vivid yellow, cyan and magenta; clear areas for readable game controls.", multiline=True, advanced=True),
                    io.String.Input("stage_style", default=DEFAULT_STAGE_STYLE, multiline=True, advanced=True),
                    io.Combo.Input("model", options=MODELS, default=MODELS[0], advanced=True),
                    io.Int.Input("seed", default=42, min=0, max=2 ** 64 - 1, advanced=True),
                    io.Combo.Input("video_model", options=VIDEO_MODELS, default=VIDEO_MODELS[0], optional=True, advanced=True,
                                   tooltip="Cloud video model for every clip: LTX-2.5 Fast (720p, $0.1287/s) or Seedance 1.5 Pro (720p about $0.026/s, 1080p about $0.059/s; cleaner motion)."),
                    io.Combo.Input("video_resolution", options=VIDEO_RESOLUTIONS, default=VIDEO_RESOLUTIONS[0], optional=True, advanced=True,
                                   tooltip="Clip resolution for Seedance; LTX-2.5 Fast always renders 720p.")],
            outputs=[Project.Output(display_name="project")])

    @classmethod
    def execute(cls, root_directory, title, subtitle, style, ui_style, stage_style, model, seed, video_model=VIDEO_MODELS[0], video_resolution=VIDEO_RESOLUTIONS[0]):
        project = {"_type": "CFZ_PROJECT", "root_directory": str(_root_path(root_directory)), "title": _text(title, "Game title", True),
                   "subtitle": _text(subtitle, "Subtitle"), "style": _text(style, "Art style"), "ui_style": _text(ui_style, "UI style"),
                   "stage_style": _text(stage_style, "Stage style"), "model": model, "seed": seed, "video_model": video_model, "video_resolution": video_resolution}
        _project(project)
        if not isinstance(seed, int) or not 0 <= seed < 2 ** 64:
            raise ValueError("Seed must be an unsigned 64-bit integer")
        return io.NodeOutput(project)


class CFZProjectAudioRoot(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZProjectAudioRoot", display_name="CFZ Shared Project Audio Root", category="Comfy Fighter Z",
            description="Connect the image project's settings so audio.json and assets.json use one output folder and title. Validates audio configuration locally; makes no paid requests.",
            inputs=[Project.Input("project"), io.String.Input("audio_config", default="{}", multiline=True)],
            outputs=[AssetRoot.Output(display_name="root")])

    @classmethod
    def execute(cls, project, audio_config):
        directory = _project(project)
        config = _json_object(audio_config, "audio_config")
        config.update(title=project["title"], subtitle=project["subtitle"])
        return CFZAssetRoot.execute(str(directory), json.dumps(config))


class CFZCharacterDefinition(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZCharacterDefinition", display_name="CFZ Character Definition", category="Comfy Fighter Z",
                         inputs=[*_character_inputs(), *_arcade_inputs()], outputs=[Character.Output(display_name="character")])

    @classmethod
    def execute(cls, name, description, special_name, special_description, intro_tagline, color, character_id, **kwargs):
        return io.NodeOutput(_character(name, description, special_name, special_description, intro_tagline, color, character_id, *_arcade_values(kwargs)))


class CFZFictionalReference(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZFictionalReference", display_name="CFZ Invent Fictional Reference", category="Comfy Fighter Z",
            description="PAID cloud generation: exactly one new reference image from text. No image input or previous-session file is read. Native cloud generation stays inside this custom node.",
            inputs=[Project.Input("project"), io.String.Input("prompt", default="One original adult anime parent hero, complete full body facing right, simple workwear, clean cel shading, flat chroma green background. No real-person likeness, existing character, text or logos.", multiline=True),
                    io.Combo.Input("aspect", options=["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "8:1", "1:8"], default="2:3"),
                    io.Combo.Input("resolution", options=["1K", "2K", "4K"], default="1K")],
            outputs=[io.Image.Output(display_name="reference")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, prompt, aspect, resolution):
        _project(project); graph = GraphBuilder()
        text = "Invent a wholly fictional reference from text alone. No photograph, previous-session image, real-person likeness or recognizable real venue is supplied or requested.\n" + _text(prompt, "Fictional reference prompt")
        generated = _cloud(graph, project, text, aspect=aspect, resolution=resolution, offset=100)
        return io.NodeOutput(generated.out(0), expand=graph.finalize())


class CFZCharacterFactory(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZCharacterFactory", display_name="CFZ Character Factory", category="Comfy Fighter Z",
            description="PAID cloud generation: Upload reference uses 10 images (7 without the optional arcade art; 4 or 5 without sheets); Invent fictional reference adds one source image. Arcade art adds two in-between sheets and an ending illustration. Invent creates its source from text and never reads the image field or earlier session files. Uses native Comfy cloud authentication.",
            inputs=[Project.Input("project"), _image_input(), *_character_inputs(),
                    io.Boolean.Input("include_sprite_sheets", default=True, advanced=True, tooltip="Disable only when connecting the identity and character outputs to individual CFZ Sprite Sheet nodes."),
                    _source_mode_input(), *_arcade_inputs(),
                    io.Boolean.Input("include_arcade_art", default=True, optional=True, advanced=True,
                                     tooltip="Adds the optional sheetD/sheetE in-between poses (when sheets are included) and a 16:9 arcade ending illustration: up to 3 more paid images."),
                    io.Boolean.Input("include_motion_art", default=True, optional=True, advanced=True,
                                     tooltip="Adds the optional sheetF/sheetG motion cels (strike load, whip, recoil, settle, passing steps, dash, a six-drawing breathing loop, jump apex, landing, guard hit): two more paid 2K sheets when sheets are included."),
                    _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="identity"), Character.Output(display_name="character")],
            enable_expand=True, is_api_node=True)

    @classmethod
    def fingerprint_inputs(cls, image, source_mode="Upload reference", **kwargs):
        return _image_hash(image) if _source_mode(source_mode) == "Upload reference" else "fictional-text-only"

    @classmethod
    def validate_inputs(cls, image, name, description, special_name, special_description, intro_tagline, color, character_id, source_mode="Upload reference", **kwargs):
        try:
            if _source_mode(source_mode) == "Upload reference":
                _input_image(image)
            _character(name, description, special_name, special_description, intro_tagline, color, character_id, *_arcade_values(kwargs))
            return True
        except ValueError as error:
            return str(error)

    @classmethod
    def execute(cls, project, image, name, description, special_name, special_description, intro_tagline, color, character_id, include_sprite_sheets=True, source_mode="Upload reference", include_arcade_art=True, include_motion_art=True, reroll=0, **kwargs):
        project = _rerolled(project, reroll)
        _project(project); _source_mode(source_mode)
        character = _character(name, description, special_name, special_description, intro_tagline, color, character_id, *_arcade_values(kwargs))
        members = _members(character=character); graph = GraphBuilder()
        common = _description(project, character)
        if source_mode == "Invent fictional reference":
            source_image = _cloud(graph, project, common + "\nInvent an entirely fictional adult fighting-game character from this text alone. No photograph, earlier image, real-person likeness or existing franchise character is supplied or requested. Exactly one complete full-body character, three-quarter side view facing RIGHT, relaxed fighting guard, clearly separated arms and legs, complete hands and both shoes, generous padding. " + KEY,
                                  aspect="2:3", offset=100).out(0)
        else:
            _input_image(image)
            source_image = graph.node("LoadImage", image=image).out(0)
        source = _save(graph, project, source_image, {"id": f"{character_id}_source", "kind": "source", "fighter": character_id, "key": False}, members)
        identity = _cloud(graph, project, common + "\nUse the supplied reference design as the visible appearance reference. One full-body model reference, complete head, both shoes and all accessories visible, three-quarter side view facing RIGHT, neutral fighting stance. Complete unseen footwear naturally. Leave generous padding. " + KEY, source_image, "2:3")
        assets = [source, _save(graph, project, identity.out(0), {"id": f"{character_id}_reference", "kind": "reference", "fighter": character_id, "key": True}, members)]
        kinds = ["portrait", "hero", "cutin"] + (["ending"] if include_arcade_art else [])
        for index, kind in enumerate(kinds, 1):
            assets.append(_artwork(graph, project, character, identity.out(0), kind, index))
        bundles = []
        if include_sprite_sheets:
            first = None
            for sheet in {**SHEETS, **(EXTRA_SHEETS if include_arcade_art else {}), **(MOTION_SHEETS if include_motion_art else {})}:
                node = graph.node("CFZSpriteSheet", project=project, character=character, reference=identity.out(0), sheet=sheet, **({"reference_sheet": first.out(1)} if first is not None else {}))
                bundles.append(node.out(0)); first = first or node
        bundle = _collect(graph, project, members, assets, bundles)
        return io.NodeOutput(bundle, identity.out(0), character, expand=graph.finalize())


def _sheet_note(sheet):
    """Key-pose sheets are not loops; the motion sheets are transition frames that must sit on the existing key poses."""
    if sheet == "sheetG":
        return ("Cells 1 to 5 are five consecutive breathing frames of the neutral idle stance: the identical silhouette, stance width, foot placement, head size and outfit, "
                "changing only the chest, shoulders, elbows and fists by a few pixels, progressively deeper from cell 1 to cell 5. Cells 6 to 9 are transition frames at the same scale. ")
    if sheet == "sheetH":
        return ("Cells 1 to 4 are one walking cycle moving to the RIGHT (contact, passing, opposite contact, passing) and cells 5 to 8 one walking cycle moving backward "
                "to the LEFT while the character keeps facing RIGHT with a cautious guard. Keep the identical scale, outfit, line weight and head size in every cell; only the legs, "
                "hips and arms change between cells, the fists stay up in the same closed-fist fighting guard in all eight walking cells (never swinging down, never an open palm), and every walking cell shows the body in the same side-on profile facing RIGHT (never turning toward the viewer). Cell 9 is a half crouch, clearly lower than standing, at the same scale. Exactly nine figures, one per cell. No text, labels, numbers, motion lines or effects anywhere. ")
    if sheet == "sheetI":
        return ("Cells 1 to 5 are one continuous evasive forward roll toward the RIGHT (dive, tucked roll, later tucked roll, kneeling, upright guard) and cells 6 to 9 one "
                "continuous low sweep kick toward the RIGHT in which cells 6 to 9 ALL show the character crouched low near the floor: 6 the chamber (hands on the floor, the leg starting outward), 7 the full extension (the leg straight out along the floor), 8 the follow-through (the leg swept past, still crouched with a hand on the floor), 9 the recovery (back in a low crouching guard). Keep the identical scale, outfit and line weight; the roll "
                "frames are compact and low to the floor, and every sweep cell stays crouched low with the sweeping leg along the floor at ankle height (never standing upright, never a raised kick). Exactly nine figures, one per cell. No text, labels, numbers, motion lines, swooshes or effects anywhere. ")
    if sheet == "sheetF":
        return "These nine cells are transition frames between this character's existing key poses: match the key-pose scale, line weight and stance exactly. "
    return "These are named key poses, not a nine-frame animation loop. "


class CFZSpriteSheet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSpriteSheet", display_name="CFZ Sprite Sheet", category="Comfy Fighter Z",
            description="PAID cloud generation: exactly one 2K 3x3 sheet for nine named poses, saved with an exact mapped pose layout. sheet, sheetB and sheetC hold the 27 required poses; optional sheetD and sheetE add in-betweens. Native cloud API; no local checkpoint.",
            inputs=[Project.Input("project"), Character.Input("character"), io.Image.Input("reference", raw_link=True), io.Combo.Input("sheet", options=list(ALL_SHEETS), default="sheet"),
                    io.Image.Input("reference_sheet", raw_link=True, optional=True, tooltip="An accepted sheet of the same character; new cells match its body scale, line weight and right-facing direction."),
                    _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="sheet_image")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, character, reference, sheet, reference_sheet=None, reroll=0):
        project = _rerolled(project, reroll)
        _project(project); character = _checked_character(character)
        if sheet not in ALL_SHEETS:
            raise ValueError("Sheet must be one of " + ", ".join(ALL_SHEETS))
        poses = ALL_SHEETS[sheet]; graph = GraphBuilder(); members = _members(character=character)
        def hint(pose):
            if pose == "special":
                return f"{character['specialMove']['name']}: {character['specialMove']['description']}"
            if pose == "super" and character.get("superMove"):
                # Pose only: the full effect text (walls, waves, beams) belongs to the cut-in; the game draws the super effect.
                return f"{character['superMove']['name']} stance: {POSE_HINTS['super']}, only a small glow at the hands"
            return POSE_HINTS[pose]
        layout = "; ".join(f"row {i // 3 + 1} column {i % 3 + 1}: {pose} ({hint(pose)})" for i, pose in enumerate(poses))
        prompt = (_description(project, character) + f"\nExactly one square 3x3 sprite sheet with these nine poses in row-major order: {layout}. "
                  "One complete fighter per cell, all standing and attack poses face RIGHT. Every pose includes the entire body, both shoes and accessories. "
                  "Choose one common body scale small enough for the widest kick and longest horizontal fallen pose. Standing figures are about 60% of cell height, with heads near 22% and shoes at 82%. "
                  "Every hand, shoe, hair tip, accessory and attached energy accent stays inside the central 76% of its cell, with at least 12% clear green on all four sides. The bottom row includes both feet and green below. "
                  "Keep canvas bands from 30% to 37% and 63% to 70% entirely empty green, with matching vertical green corridors between columns. No limbs cross cell boundaries. "
                  "Keep common body scale and consistent identity across all nine cells. Sweep kicks point right, launcher strikes upward-right, stance2 is an upright guard, crouch a low guard, down is a complete fallen body. "
                  "Keep special energy compact and attached to the palms; the game supplies the traveling projectile. " + _sheet_note(sheet) + "No duplicate bodies, detached props, labels or visible cell borders. "
                  + ("The second reference image is an accepted sheet of this character: match its body scale, line weight, colors and RIGHT-facing direction exactly, with the same cell padding. " if reference_sheet is not None else "") + KEY)
        generated = _cloud(graph, project, prompt, [reference, reference_sheet] if reference_sheet is not None else reference, "1:1", "2K", 10 + list(ALL_SHEETS).index(sheet))
        asset = _save(graph, project, generated.out(0), {"id": f"{character['id']}_{sheet}", "kind": "sprites", "fighter": character["id"], "sheet": sheet, "poses": poses, "key": True}, members)
        return io.NodeOutput(_collect(graph, project, members, [asset]), generated.out(0), expand=graph.finalize())


class CFZCharacterArt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZCharacterArt", display_name="CFZ Character Art", category="Comfy Fighter Z",
            description="PAID cloud generation: exactly one 1K portrait, hero, cut-in or arcade ending illustration from an accepted identity reference. Use it to add ending art to an existing fighter or to repair one image.",
            inputs=[Project.Input("project"), Character.Input("character"), io.Image.Input("reference", raw_link=True),
                    io.Combo.Input("kind", options=list(ARTWORK), default="ending")],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="image")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, character, reference, kind):
        _project(project); character = _checked_character(character)
        if kind not in ARTWORK:
            raise ValueError("Kind must be portrait, hero, cutin or ending")
        graph = GraphBuilder(); members = _members(character=character)
        asset = _artwork(graph, project, character, reference, kind, 1 + list(ARTWORK).index(kind))
        return io.NodeOutput(_collect(graph, project, members, [asset]), None, expand=graph.finalize())


class CFZEnvironmentFactory(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZEnvironmentFactory", display_name="CFZ Environment Factory", category="Comfy Fighter Z",
            description="PAID when enabled: Upload reference uses 1 stage image; Invent fictional reference uses 2 images (a new text-only source plus the playable stage). Invent never reads the image field or earlier session files. Disabled slots make zero cloud calls.",
            inputs=[Project.Input("project"), _image_input(), io.Boolean.Input("enabled", default=True), io.String.Input("name", default="New Environment"),
                    io.String.Input("description", default="", multiline=True), io.String.Input("stage_id", default="environment", advanced=True), _source_mode_input(), _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="stage")], enable_expand=True, is_api_node=True)

    @classmethod
    def fingerprint_inputs(cls, image, enabled, source_mode="Upload reference", **kwargs):
        if not enabled:
            return "disabled"
        return _image_hash(image) if _source_mode(source_mode) == "Upload reference" else "fictional-text-only"

    @classmethod
    def validate_inputs(cls, image, enabled, name, description, stage_id, source_mode="Upload reference"):
        if not enabled:
            return True
        try:
            if _source_mode(source_mode) == "Upload reference":
                _input_image(image)
            _slug(stage_id, "Stage ID")
            _text(name, "Stage name", True)
            _text(description, "Stage description")
            return True
        except ValueError as error:
            return str(error)

    @classmethod
    def execute(cls, project, image, enabled, name, description, stage_id, source_mode="Upload reference", reroll=0):
        project = _rerolled(project, reroll)
        directory = _project(project)
        if not enabled:
            return io.NodeOutput({"_type": "CFZ_BUNDLE", "_root": str(directory), "fighters": [], "stages": [], "assets": []}, None)
        _source_mode(source_mode)
        stage = {"id": _slug(stage_id, "Stage ID"), "name": _text(name, "Stage name", True), "description": _text(description, "Stage description")}
        members = _members(stage=stage); graph = GraphBuilder()
        if source_mode == "Invent fictional reference":
            source_image = _cloud(graph, project, f"{project['stage_style']}\nENVIRONMENT: {stage['description']}\nInvent a wholly fictional environment from this text alone. No photograph, earlier image or recognizable real venue is supplied or requested. Wide side-on arena composition, clear central fighting floor, props behind the fight plane, full-bleed natural surfaces. No people, text, logos, borders, speed lines or vignette.",
                                  aspect="16:9", resolution="2K", offset=130).out(0)
        else:
            _input_image(image)
            source_image = graph.node("LoadImage", image=image).out(0)
        source = _save(graph, project, source_image, {"id": f"{stage_id}_source", "kind": "source", "stage": stage_id, "key": False}, members)
        generated = _cloud(graph, project, f"{project['stage_style']}\nVENUE: {stage['description']}\nUse the supplied environment design as the spatial reference. Exactly one clean wide playable stage with an unobstructed horizontal playable floor at 82% image height. Full-bleed natural floor, ceiling and walls reach every edge. No text, branding, logos, emblems, borders, comic panels, speed-line borders or vignette.", source_image, "16:9", "2K", 30)
        asset = _save(graph, project, generated.out(0), {"id": stage_id, "kind": "stage", "stage": stage_id, "key": False}, members)
        return io.NodeOutput(_collect(graph, project, members, [source, asset]), generated.out(0), expand=graph.finalize())


class CFZSharedArtFactory(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSharedArtFactory", display_name="CFZ Shared Game Art", category="Comfy Fighter Z",
            description="PAID cloud generation: six images (title, selection, logo, HUD, icons and nine combat effects). Connect the stage image from an ENABLED environment factory as the reference.",
            inputs=[Project.Input("project"), io.Image.Input("stage_reference", raw_link=True), _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="select_image")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, stage_reference, reroll=0):
        project = _rerolled(project, reroll)
        if stage_reference is None:
            raise ValueError("Shared game art requires the stage image from an enabled environment factory")
        _project(project); graph = GraphBuilder(); members = _members(); assets = []; select_image = None
        jobs = [
            ("title", "16:9", "Dramatic game-title background based on the venue, animated energy and speed lines. No people or readable text; leave center space for the title overlay."),
            ("select", "16:9", "Character-selection backdrop based on the venue, subdued tournament lighting. No portraits, text, boxes or controls; leave central space for six fighter cards."),
            ("frame", "16:9", "ASSET TYPE: one isolated interface panel frame, not a scene. A rectangular arcade options-panel border filling the image edge to edge: riveted brass edges, charcoal inner band and thin deep-red trim with small corner ornaments. The entire interior is empty flat chroma green. No text, icons, figures or scenery. " + KEY),
            ("logo", "3:2", f"ASSET TYPE: one isolated typographic logo, not a scene or game screenshot. Render only the exact words {project['title']} as one centered arcade wordmark. Electric gold and white italic beveled lettering, thick black ink outline, restrained cyan and magenta edge accents, oversized final Z. Keep every letter complete with at least 12 percent empty padding. The entire background is perfectly uniform chroma green RGB(0,255,0). No people, faces, bodies, fighters, scenery, buildings, floors, health bars, interface mockups, subtitle, other words, numbers, frames or watermark."),
            ("hud", "16:9", "Thin cyan left and magenta right top-edge accents with yellow trim. All interior and fighting areas are empty flat chroma green. No text, numbers, character portraits or fake health bars. " + KEY.replace("borders or ", "")),
            ("icons", "1:1", "ASSET TYPE: one isolated geometric interface icon, not a scene or game screenshot. Render only a compact centered energy crest made of exactly three small linked rectangular workflow nodes and one central lightning bolt. Clean gold, white, cyan and magenta shapes with crisp black ink outlines and simple cel shading. Keep the complete emblem inside the central 70 percent of the canvas. The entire background is perfectly uniform chroma green RGB(0,255,0). No people, faces, bodies, fighters, scenery, buildings, floors, weapons, clothing, health bars, interface mockups, words, numbers, frames or watermark."),
        ]
        for index, (identity, aspect, prompt) in enumerate(jobs):
            # Scene-oriented UI styles can turn a logo or icon into a game illustration.
            # These two isolated assets carry their complete visual style in their own prompt.
            full_prompt = prompt if identity in {"logo", "icons", "frame"} else project["ui_style"] + "\n" + prompt
            generated = _cloud(graph, project, full_prompt, stage_reference if identity in {"title", "select"} else None, aspect, offset=40 + index)
            if identity == "frame":
                full_prompt = prompt  # the frame carries its own isolated-asset style, like the logo and icons
            if identity == "select":
                select_image = generated.out(0)
            assets.append(_save(graph, project, generated.out(0), {"id": identity, "kind": "ui", "key": identity in {"logo", "hud", "icons", "frame"}}, members))
        prompt = (project["style"] + "\nSquare 3x3 sheet of nine separate fighting-game effects in exact row-major order: " + ", ".join(EFFECTS) + ". "
                  "Each effect stays completely inside its cell with clear empty padding, no people or body parts. Compact impact bursts, shields and energy shapes. " + KEY)
        effect = _cloud(graph, project, prompt, None, "1:1", "2K", 49)
        assets.append(_save(graph, project, effect.out(0), {"id": "combat_effects", "kind": "effects", "poses": EFFECTS, "key": True}, members))
        return io.NodeOutput(_collect(graph, project, members, assets), select_image, expand=graph.finalize())


# Startup art and videos: a cast ensemble for the title screen, its looping menu animation and one
# introduction clip per fighter. Clips are silent 720p LTX videos; voices and music stay game audio.
VideoRecord = io.Custom("CFZ_VIDEO")
VIDEO_MODEL = "LTX-2.5 (Fast)"
ANIMATION_STYLE = ("Hand-drawn 2D cel animation in the style of a late-1990s shonen battle anime and arcade fighting game: bold clean ink, "
                   "flat cel shading, high-energy action with radial speed lines, impact frames and glowing aura effects.")


def _animate(graph, project, prompt, first_frame, duration, seed, last_frame=None, portrait=False):
    """One silent clip from a first frame (and optionally a last frame for a seamless loop) on the project's video model."""
    if project.get("video_model", VIDEO_MODELS[0]) == "Seedance 1.5 Pro":
        inputs = {"model": SEEDANCE_MODEL, "prompt": prompt, "resolution": project.get("video_resolution", VIDEO_RESOLUTIONS[0]),
                  "aspect_ratio": "9:16" if portrait else "16:9", "duration": int(duration), "generate_audio": False,
                  "seed": seed % 2147483648, "camera_fixed": False, "watermark": False}
        if last_frame is not None:
            return graph.node("ByteDanceFirstLastFrameNode", first_frame=first_frame, last_frame=last_frame, **inputs)
        return graph.node("ByteDanceImageToVideoNode", image=first_frame, **inputs)
    inputs = {"image": first_frame, "model": VIDEO_MODEL, "model.duration": str(duration), "model.resolution": "720x1280" if portrait else "1280x720",
              "model.fps": "24", "model.generate_audio": False, "prompt": prompt, "seed": seed % 4294967296}
    if last_frame is not None:
        inputs["last_frame"] = last_frame
    return graph.node("LtxApi25ImageToVideo", **inputs)


def _video_record(value):
    identity = _slug(value.get("id"), "Video id"); record = {"id": identity}
    if "fighter" in value:
        record["fighter"] = _slug(value["fighter"], "Video fighter")
        if identity not in {f"intro-{record['fighter']}", f"idle-{record['fighter']}"}:
            raise ValueError("Fighter videos use the ID intro-<fighter id> (introduction) or idle-<fighter id> (select-screen idle loop)")
    elif identity not in {"title", "select", "opening"}:
        raise ValueError("A video is the title loop, the select loop, the opening, intro-<fighter id> or idle-<fighter id>")
    return record


def _save_video(graph, project, video, metadata):
    return graph.node("CFZSaveVideo", project=project, video=video, asset_json=json.dumps(metadata)).out(0)


class CFZTitleArt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        fighters = [io.Image.Input(f"fighter_{index}", raw_link=True, optional=True) for index in range(1, 9)]
        return io.Schema(node_id="CFZTitleArt", display_name="CFZ Title Ensemble Art", category="Comfy Fighter Z",
            description="PAID cloud generation: one 2K startup-screen illustration of the cast together in the arena. Connect each character factory's identity image (up to eight) and the stage image. The game shows it behind the title menu, and CFZ Menu Video animates it.",
            inputs=[Project.Input("project"), io.Image.Input("stage_reference", raw_link=True), *fighters, _reroll_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="title_image")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, stage_reference, reroll=0, **fighters):
        project = _rerolled(project, reroll)
        _project(project)
        references = [fighters[name] for name in (f"fighter_{index}" for index in range(1, 9)) if fighters.get(name) is not None]
        if not references or stage_reference is None:
            raise ValueError("Connect at least one fighter identity image and the stage image from an enabled environment")
        graph = GraphBuilder(); members = _members(); count = len(references)
        prompt = (project["ui_style"] + f"\nOne wide 16:9 arcade title-screen key illustration of exactly {count} fighter{'s' if count > 1 else ''} caught mid-battle: "
                  f"one fighter from each of the first {count} reference image{'s' if count > 1 else ''}, in the arena from the last reference image. "
                  "Dramatic low camera angle and strong foreshortening: the fighters lunge, leap and strike toward each other across the upper two thirds of the frame, "
                  "fists and energy colliding in a bright shockwave with radial speed lines, flying debris and glowing auras, like a shonen battle-anime key visual. "
                  "Each fighter keeps the same face, hair, body, outfit, accessories and colors as their reference. "
                  "Keep the lower-middle third calm and uncluttered for the game logo and menu. No other people, no text, letters, logos, borders or interface.")
        generated = _cloud(graph, project, prompt, [*references, stage_reference], "16:9", "2K", offset=60)
        asset = _save(graph, project, generated.out(0), {"id": "ensemble", "kind": "ui", "key": False}, members)
        return io.NodeOutput(_collect(graph, project, members, [asset]), generated.out(0), expand=graph.finalize())


class CFZTitleVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZTitleVideo", display_name="CFZ Menu Video", category="Comfy Fighter Z",
            description="PAID cloud generation: one silent 720p LTX clip that loops the title ensemble behind the game menu; the same image is its first and last frame. Still art remains when motion is unavailable or reduced.",
            inputs=[Project.Input("project"), io.Image.Input("title_image", raw_link=True), io.Combo.Input("duration", options=["6", "8", "10"], default="8"), _reroll_input()],
            outputs=[VideoRecord.Output(display_name="video_asset")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, title_image, duration="8", reroll=0):
        project = _rerolled(project, reroll)
        _project(project)
        if title_image is None:
            raise ValueError("Connect the title image from CFZ Title Ensemble Art")
        graph = GraphBuilder()
        prompt = (ANIMATION_STYLE + " Seamless looping title-menu animation. Use the supplied image as the exact first and last frame. "
                  "The fighters break apart and trade a lightning-fast flurry of punches and kicks with afterimages and radial speed lines, "
                  "energy shockwaves ripple outward, sparks and debris fly, the camera shakes, then they slam back together into the exact opening clash. "
                  "Fast dynamic camera with a brief impact freeze, no cuts to other scenes. Keep every face, body, outfit and color unchanged. No new people, text or logos.")
        video = _animate(graph, project, prompt, title_image, duration, project["seed"] + 90, last_frame=title_image)
        return io.NodeOutput(_save_video(graph, project, video.out(0), {"id": "title"}), expand=graph.finalize())


class CFZSelectVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSelectVideo", display_name="CFZ Select Video", category="Comfy Fighter Z",
            description="PAID cloud generation: one silent 720p LTX loop of the character-select backdrop (lights, embers, camera drift), played behind the roster. The still backdrop stays as the fallback.",
            inputs=[Project.Input("project"), io.Image.Input("select_image", raw_link=True), io.Combo.Input("duration", options=["6", "8", "10"], default="8"), _reroll_input()],
            outputs=[VideoRecord.Output(display_name="video_asset")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, select_image, duration="8", reroll=0):
        project = _rerolled(project, reroll)
        _project(project)
        if select_image is None:
            raise ValueError("Connect the select backdrop image from CFZ Shared Art")
        graph = GraphBuilder()
        prompt = (ANIMATION_STYLE + " Seamless looping character-select backdrop animation. Use the supplied image as the exact first and last frame. "
                  "Arena lights flicker and sweep, embers and sparks drift upward, banners and loose debris stir in a hot wind, heat shimmer rises from the floor "
                  "and the camera drifts slowly with gentle parallax before returning to the opening framing. No people, no new objects, no text or logos.")
        video = _animate(graph, project, prompt, select_image, duration, project["seed"] + 95, last_frame=select_image)
        return io.NodeOutput(_save_video(graph, project, video.out(0), {"id": "select"}), expand=graph.finalize())


class CFZSelectIdleVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSelectIdleVideo", display_name="CFZ Select Idle Video", category="Comfy Fighter Z",
            description="PAID cloud generation: one 1K portrait keyframe of the fighter in a ready stance, then one silent portrait 720p LTX loop (first and last frame identical) that the character-select cards play.",
            inputs=[Project.Input("project"), Character.Input("character"), io.Image.Input("reference", raw_link=True),
                    io.Combo.Input("duration", options=["4", "6", "8"], default="6"), _reroll_input()],
            outputs=[VideoRecord.Output(display_name="video_asset")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, character, reference, duration="6", reroll=0):
        project = _rerolled(project, reroll)
        _project(project); character = _checked_character(character)
        if reference is None:
            raise ValueError("Connect the fighter's identity image")
        graph = GraphBuilder()
        keyframe = _cloud(graph, project, _description(project, character) + "\nOne portrait 9:16 full-body picture of this character alone, standing in a relaxed ready fighting stance facing RIGHT, "
                          "centered with clear space above the head and below the shoes, on a dark neutral tournament-floor backdrop lit by one soft spotlight. "
                          "Same face, hair, body, outfit, accessories and colors as the reference. No other people, no text, logos or interface.", [reference], "9:16", "1K", offset=75)
        prompt = (ANIMATION_STYLE + " Seamless looping character-select idle animation. Use the supplied image as the exact first and last frame. "
                  f"{character['name']} stays on the spot but never still: bouncing lightly on the toes, a quick shadow-boxing jab and a hop back into the guard, "
                  "fists flexing, a confident nod toward the viewer, hair and clothing whipping in a gust, then settles exactly into the opening pose. "
                  "Fixed camera, no cuts, no other people, no text or logos, no speech.")
        video = _animate(graph, project, prompt, keyframe.out(0), duration, project["seed"] + 85, last_frame=keyframe.out(0), portrait=True)
        return io.NodeOutput(_save_video(graph, project, video.out(0), {"id": f"idle-{character['id']}", "fighter": character["id"]}), expand=graph.finalize())


class CFZIntroVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZIntroVideo", display_name="CFZ Fighter Intro Video", category="Comfy Fighter Z",
            description="PAID cloud generation: one 1K 16:9 keyframe of the fighter in the arena, then one silent 720p LTX introduction clip played before fights. Voices stay separate; the sprite entrance remains the fallback.",
            inputs=[Project.Input("project"), Character.Input("character"), io.Image.Input("reference", raw_link=True), io.Image.Input("stage_reference", raw_link=True),
                    io.Combo.Input("duration", options=["4", "6", "8"], default="4"), _reroll_input()],
            outputs=[VideoRecord.Output(display_name="video_asset")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, character, reference, stage_reference, duration="4", reroll=0):
        project = _rerolled(project, reroll)
        _project(project); character = _checked_character(character)
        if reference is None or stage_reference is None:
            raise ValueError("Connect the fighter's identity image and the stage image")
        graph = GraphBuilder()
        keyframe = _cloud(graph, project, _description(project, character) + "\nOne wide 16:9 cinematic opening frame for this fighter's arcade introduction. "
                          "The same character from the first reference image stands full body slightly left of center in the arena from the second reference image, facing RIGHT, "
                          "in a confident ready stance with the complete head, hands and shoes and generous padding. Flat side-on camera at waist height on a level floor. "
                          "No other people, no text, logos or interface.", [reference, stage_reference], "16:9", "1K", offset=70)
        prompt = (ANIMATION_STYLE + f" Use the supplied image as the exact first frame. {character['name']} explodes into an arcade fighter introduction: "
                  f"a sudden burst of energy aura with radial speed lines, a lightning-fast dash toward the camera with afterimages, "
                  f"one explosive signature strike that shows {character['specialMove']['name']}, then a hard stop into a fighting stance facing right with a final flare of power. "
                  "Fast dynamic camera: a quick whip-pan and a dramatic low-angle push-in with a brief impact freeze, no cuts to other scenes. "
                  "Keep the same face, body, outfit and colors throughout and the arena unchanged. No other people, no text or logos, no speech.")
        video = _animate(graph, project, prompt, keyframe.out(0), duration, project["seed"] + 80)
        return io.NodeOutput(_save_video(graph, project, video.out(0), {"id": f"intro-{character['id']}", "fighter": character["id"]}), expand=graph.finalize())


class CFZSaveVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSaveVideo", display_name="CFZ Save Mapped Video (internal)", category="Comfy Fighter Z/internal",
                         inputs=[Project.Input("project"), io.Video.Input("video"), io.String.Input("asset_json")], outputs=[VideoRecord.Output(display_name="video_asset")])

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(cls, project, video, asset_json):
        directory = _project(project); record = _video_record(_json_object(asset_json, "asset_json"))
        buffer = BytesIO()
        video.save_to(buffer, format=Types.VideoContainer.MP4, codec=Types.VideoCodec.H264)
        return io.NodeOutput(_store_video(directory, record, buffer.getvalue()))


def _store_video(directory, record, content):
    """Write an MP4 under raw/ with a content-hash name and return its mapped record."""
    if not content:
        raise ValueError(f"Generated video is empty: {record['id']}")
    with av.open(BytesIO(content)) as container:
        if not container.streams.video:
            raise ValueError(f"Generated file has no video stream: {record['id']}")
        stream = container.streams.video[0]
        duration = container.duration / av.time_base if container.duration else float(stream.duration * stream.time_base)
        has_audio = len(container.streams.audio) > 0
    if not 0 < duration <= 300:
        raise ValueError(f"Generated video duration is out of range: {record['id']}")
    digest = hashlib.sha256(content).hexdigest(); relative = f"raw/{record['id']}-{digest[:16]}.mp4"
    destination = _inside(directory, relative)
    if not destination.is_file() or destination.read_bytes() != content:
        _atomic_write(destination, content)
    return {**record, "src": relative, "duration": round(float(duration), 3), "sha256": digest, "hasAudio": has_audio, "_root": str(directory)}


class CFZExportVideos(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZExportVideos", display_name="CFZ Export Videos", category="Comfy Fighter Z",
            description="Writes video.json beside assets.json: the looping menu video and each fighter's introduction. The builder plays them and falls back to still art and sprite entrances when a clip is missing.",
            inputs=[Project.Input("project"), io.Autogrow.Input("videos", template=io.Autogrow.TemplatePrefix(VideoRecord.Input("video"), prefix="video_", min=1, max=20))],
            outputs=[io.String.Output(display_name="manifest_path")], is_output_node=True)

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(cls, project, videos):
        path, preview = _export_videos(_project(project), videos.values())
        return io.NodeOutput(path, ui=preview)


def _export_videos(directory, items):
    manifest = {"schema": "comfy-fighter-video/v1", "root": "."}; intros = []; idles = []; seen = set()
    for item in items:
        if not isinstance(item, dict) or item.get("_root") != str(directory):
            raise ValueError("Every video must be saved under the same CFZ Project Settings root")
        record = {**_video_record(item), **{key: item[key] for key in ("src", "duration", "sha256", "hasAudio")}}
        file = _inside(directory, record["src"])
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError(f"Saved video is missing or changed: {record['id']}")
        if record["id"] in seen:
            raise ValueError(f"Duplicate video: {record['id']}")
        seen.add(record["id"])
        if "fighter" in record:
            (idles if record["id"].startswith("idle-") else intros).append(record)
        else:
            manifest[f"{record['id']}Video"] = record
    if intros:
        manifest["fighterIntros"] = intros
    if idles:
        manifest["selectIdles"] = idles
    destination = _inside(directory, "video.json")
    _atomic_write(destination, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return str(destination), ui.PreviewText(str(destination))


class CFZSaveMappedAsset(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSaveMappedAsset", display_name="CFZ Save Mapped Asset (internal)", category="Comfy Fighter Z/internal",
                         inputs=[Project.Input("project"), io.Image.Input("image"), io.String.Input("asset_json"), io.String.Input("members_json")], outputs=[AssetRecord.Output(display_name="asset")])

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(cls, project, image, asset_json, members_json):
        directory = _project(project); members = _json_object(members_json, "members_json")
        record = _metadata(_json_object(asset_json, "asset_json"), members)
        return io.NodeOutput(_save_image(image, directory, record))


def _merge(project, bundles, members=None, assets=()):
    directory = _project(project); records = list(assets); found = {"fighters": {}, "stages": {}}
    sources = [members or _members()]
    for bundle in bundles.values():
        if not isinstance(bundle, dict) or bundle.get("_type") != "CFZ_BUNDLE" or bundle.get("_root") != str(directory):
            raise ValueError("All bundles must use the same CFZ Project Settings output root")
        sources.append(bundle); records.extend(bundle["assets"])
    for source in sources:
        for category in found:
            for item in source.get(category, []):
                if not isinstance(item, dict):
                    raise ValueError(f"Invalid {category} definition")
                if category == "fighters":
                    item = _checked_character(item)
                else:
                    scenery = item.get("scenery")
                    item = {"id": _slug(item.get("id"), "Stage ID"), "name": _text(item.get("name"), "Stage name", True),
                            "description": _text(item.get("description", ""), "Stage description")}
                    if scenery is not None:
                        item["scenery"] = _scenery_definition(scenery)
                identity = _slug(item.get("id"), category + " ID"); previous = found[category].get(identity.casefold())
                if previous is not None:
                    # A stage's living scenery comes from one bundle; every other bundle names the same plain stage.
                    plain = lambda value: {key: entry for key, entry in value.items() if key != "scenery"}
                    if plain(previous) != plain(item) or "scenery" in previous and "scenery" in item and previous["scenery"] != item["scenery"]:
                        raise ValueError(f"Conflicting {category} definition: {identity}")
                    item = {**previous, **item} if "scenery" in item else previous
                found[category][identity.casefold()] = item
    identities = [record.get("id", "").casefold() for record in records]
    if len(set(identities)) != len(identities):
        raise ValueError("Duplicate mapped asset IDs in factory bundles")
    return {"_type": "CFZ_BUNDLE", "_root": str(directory), "fighters": list(found["fighters"].values()), "stages": list(found["stages"].values()), "assets": records}


class CFZCollectBundle(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZCollectBundle", display_name="CFZ Collect Bundle (internal)", category="Comfy Fighter Z/internal",
            inputs=[Project.Input("project"), io.String.Input("members_json"),
                    io.Autogrow.Input("assets", template=io.Autogrow.TemplatePrefix(AssetRecord.Input("asset"), prefix="asset_", min=0)),
                    io.Autogrow.Input("bundles", template=io.Autogrow.TemplatePrefix(Bundle.Input("bundle"), prefix="bundle_", min=0, max=100))], outputs=[Bundle.Output(display_name="bundle")])

    @classmethod
    def execute(cls, project, members_json, assets=None, bundles=None):
        return io.NodeOutput(_merge(project, bundles or {}, _json_object(members_json, "members_json"), list((assets or {}).values())))


def _export(project, bundles, complete):
    bundle = _merge(project, bundles); directory = _project(project)
    if not bundle["assets"]:
        raise ValueError("Connect at least one generated asset bundle")
    if complete and (len(bundle["fighters"]) < 2 or not bundle["stages"]):
        raise ValueError("A complete game requires at least two fighters and one enabled environment")
    config = {"title": project["title"], "subtitle": project["subtitle"], "fighters": bundle["fighters"], "stages": bundle["stages"], "sheets": SHEETS, "extraSheets": EXTRA_SHEETS, "motionSheets": MOTION_SHEETS, "detailSheets": DETAIL_SHEETS}
    if sum(1 for fighter in config["fighters"] if fighter.get("boss")) > 1:
        raise ValueError("A game can include at most one final boss")
    records = []
    for item in bundle["assets"]:
        if item.get("_root") != str(directory):
            raise ValueError("Saved assets must use the same project root")
        record = _metadata(item, config); digest = item.get("sha256", "")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid saved asset hash")
        relative = f"raw/{record['id']}-{digest[:16]}.png"
        if item.get("src") != relative:
            raise ValueError("Unexpected saved asset path")
        file = _inside(directory, relative)
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Mapped asset is missing or changed: {record['id']}")
        with Image.open(file) as image:
            if image.size != (item.get("width"), item.get("height")):
                raise ValueError(f"Mapped image dimensions changed: {record['id']}")
        record.update(src=relative, sha256=digest, width=item["width"], height=item["height"]); records.append(record)
    if complete:
        mappings = {name: {"kind": "ui"} for name in ["title", "select", "logo", "hud", "icons", "ensemble", "frame"]}
        mappings["combat_effects"] = {"kind": "effects", "poses": EFFECTS, "key": True}
        # The title ensemble and the menu frame are optional interface art; the game falls back to its built-in panels.
        optional = {"ensemble", "frame"}
        for fighter in config["fighters"]:
            for suffix in ["source", "reference", *ALL_SHEETS, "portrait", "hero", "cutin", "ending"]:
                expected_mapping = {"kind": "sprites" if suffix in ALL_SHEETS else suffix, "fighter": fighter["id"]}
                if suffix in ALL_SHEETS:
                    expected_mapping.update(sheet=suffix, poses=ALL_SHEETS[suffix], key=True)
                mappings[f"{fighter['id']}_{suffix}"] = expected_mapping
                if suffix in EXTRA_SHEETS or suffix in MOTION_SHEETS or suffix in DETAIL_SHEETS or suffix == "ending":
                    optional.add(f"{fighter['id']}_{suffix}")
        for stage in config["stages"]:
            mappings[stage["id"]] = {"kind": "stage", "stage": stage["id"]}
            mappings[f"{stage['id']}_source"] = {"kind": "source", "stage": stage["id"]}
        # Living scenery is optional per stage: its populated scene, isolated layer and cut-out elements.
        stage_ids = {stage["id"] for stage in config["stages"]}
        for record in records:
            if record["kind"] in {"scene", "layer"} and record.get("stage") in stage_ids:
                mappings[record["id"]] = {"kind": record["kind"], "stage": record["stage"]}
                optional.add(record["id"])
        actual = {record["id"] for record in records}
        # Arcade in-betweens and ending art are optional per fighter.
        expected = (set(mappings) - optional) | (optional & actual)
        if expected != actual:
            raise ValueError(f"Incomplete game assets; missing: {', '.join(sorted(expected - actual)) or 'none'}; unexpected: {', '.join(sorted(actual - expected)) or 'none'}")
        for record in records:
            mapping = mappings[record["id"]]
            if any(record.get(field) != value for field, value in mapping.items()) or any(field in record and field not in mapping for field in ("fighter", "stage", "sheet", "poses")):
                raise ValueError(f"Incorrect mapped kind, owner or layout for {record['id']}")
        for fighter in config["fighters"]:
            poses = [pose for record in records if record["kind"] == "sprites" and record.get("fighter") == fighter["id"] for pose in record["poses"]]
            required = {pose for sheet in SHEETS.values() for pose in sheet}
            if len(poses) != len(set(poses)) or not required <= set(poses):
                raise ValueError(f"Complete game requires all 27 poses for {fighter['id']}")
    config["expectedAssets"] = [record["id"] for record in records]
    manifest = {"schema": SCHEMA, "root": ".", "cloudOnly": True, "game": config, "assets": records}
    if not complete:
        manifest["partial"] = True
        previous = _inside(directory, "assets.json")
        if previous.exists() and not json.loads(previous.read_text(encoding="utf-8")).get("partial", False):
            raise ValueError("A patch cannot overwrite a complete assets.json; choose a separate patch root")
    destination = _inside(directory, "assets.json")
    _atomic_write(destination, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return io.NodeOutput(str(destination), ui=ui.PreviewText(str(destination)))


class CFZExportGameAssets(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZExportGameAssets", display_name="CFZ Export Complete Game", category="Comfy Fighter Z",
            description="Writes assets.json after verifying every image, all 27 poses per fighter, shared art and active stages. At least two fighters and one environment are required.",
            inputs=[Project.Input("project"), io.Autogrow.Input("bundles", template=io.Autogrow.TemplatePrefix(Bundle.Input("bundle"), prefix="bundle_", min=1, max=100))],
            outputs=[io.String.Output(display_name="manifest_path")], is_output_node=True)

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(cls, project, bundles):
        return _export(project, bundles, True)


class CFZExportAssetPatch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZExportAssetPatch", display_name="CFZ Export Asset Patch", category="Comfy Fighter Z",
            description="Writes a partial mapped assets.json in a separate patch root. Merge its asset IDs into a complete bundle before building a game; it never replaces a complete manifest.",
            inputs=[Project.Input("project"), io.Autogrow.Input("bundles", template=io.Autogrow.TemplatePrefix(Bundle.Input("bundle"), prefix="bundle_", min=1, max=100))],
            outputs=[io.String.Output(display_name="manifest_path")], is_output_node=True)

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(cls, project, bundles):
        return _export(project, bundles, False)


FACTORY_NODES = [CFZProjectSettings, CFZProjectAudioRoot, CFZCharacterDefinition, CFZFictionalReference, CFZCharacterFactory, CFZSpriteSheet, CFZCharacterArt, CFZEnvironmentFactory,
                 CFZSharedArtFactory, CFZTitleArt, CFZTitleVideo, CFZSelectVideo, CFZSelectIdleVideo, CFZIntroVideo, CFZSaveVideo, CFZExportVideos, CFZSaveMappedAsset, CFZCollectBundle, CFZExportGameAssets, CFZExportAssetPatch]
