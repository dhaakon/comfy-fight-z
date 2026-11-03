"""Small V3 factory nodes that expand the installed native cloud image node."""
import hashlib
import json
from pathlib import Path
import re

import folder_paths
from PIL import Image
from comfy_api.latest import io, ui
from comfy_execution.graph_utils import GraphBuilder

from . import SHEETS, SCHEMA, AssetRecord, AssetRoot, CFZAssetRoot, _atomic_write, _inside, _json_object, _metadata, _reject_links, _root_path, _save_image, _slug

Project = io.Custom("CFZ_PROJECT")
Character = io.Custom("CFZ_CHARACTER")
Bundle = io.Custom("CFZ_BUNDLE")
MODELS = ["Gemini Nano Banana 2.1", "Nano Banana 2 (Gemini 3.1 Flash Image)"]
SOURCE_MODES = ["Upload reference", "Invent fictional reference"]
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
    return directory


def _character(name, description, special_name, special_description, intro_tagline, color, character_id):
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Character color must use #RRGGBB")
    return {"id": _slug(character_id, "Character ID"), "name": _text(name, "Character name", True),
            "description": _text(description, "Character description"), "color": color,
            "specialMove": {"name": _text(special_name, "Special move name", True), "description": _text(special_description, "Special move description", True)},
            "introTagline": _text(intro_tagline, "Intro tagline")}


def _checked_character(character):
    if not isinstance(character, dict):
        raise ValueError("Connect CFZ Character Definition or a character factory")
    if not isinstance(character.get("specialMove"), dict):
        raise ValueError("Character requires a special move name and description")
    return _character(character.get("name"), character.get("description", ""), character.get("specialMove", {}).get("name"),
                      character.get("specialMove", {}).get("description"), character.get("introTagline", ""), character.get("color"), character.get("id"))


def _character_inputs():
    return [io.String.Input("name", default="New Fighter"), io.String.Input("description", default="", multiline=True),
            io.String.Input("special_name", default="Energy Burst"), io.String.Input("special_description", default="A compact energy projectile released from the forward palm.", multiline=True),
            io.String.Input("intro_tagline", default="This fight is mine."), io.String.Input("color", default="#ffd23f", advanced=True),
            io.String.Input("character_id", default="fighter", advanced=True)]


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
    return {"fighters": [character] if character else [], "stages": [stage] if stage else [], "sheets": SHEETS}


def _cloud(graph, project, prompt, reference=None, aspect="1:1", resolution="1K", offset=0):
    inputs = {"prompt": prompt, "model": project["model"], "model.aspect_ratio": aspect, "model.resolution": resolution,
              "model.thinking_level": "MINIMAL", "seed": (project["seed"] + offset) % (2 ** 64),
              "response_modalities": "IMAGE", "system_prompt": SYSTEM_PROMPT}
    if reference is not None:
        inputs["model.images.image_1"] = reference
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
                    io.Int.Input("seed", default=42, min=0, max=2 ** 64 - 1, advanced=True)],
            outputs=[Project.Output(display_name="project")])

    @classmethod
    def execute(cls, root_directory, title, subtitle, style, ui_style, stage_style, model, seed):
        project = {"_type": "CFZ_PROJECT", "root_directory": str(_root_path(root_directory)), "title": _text(title, "Game title", True),
                   "subtitle": _text(subtitle, "Subtitle"), "style": _text(style, "Art style"), "ui_style": _text(ui_style, "UI style"),
                   "stage_style": _text(stage_style, "Stage style"), "model": model, "seed": seed}
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
                         inputs=_character_inputs(), outputs=[Character.Output(display_name="character")])

    @classmethod
    def execute(cls, name, description, special_name, special_description, intro_tagline, color, character_id):
        return io.NodeOutput(_character(name, description, special_name, special_description, intro_tagline, color, character_id))


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
            description="PAID cloud generation: Upload reference uses 7 images (4 without sheets); Invent fictional reference uses 8 images (5 without sheets). Invent creates its source from text and never reads the image field or earlier session files. Uses native Comfy cloud authentication.",
            inputs=[Project.Input("project"), _image_input(), *_character_inputs(),
                    io.Boolean.Input("include_sprite_sheets", default=True, advanced=True, tooltip="Disable only when connecting the identity and character outputs to three individual CFZ Sprite Sheet nodes."),
                    _source_mode_input()],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="identity"), Character.Output(display_name="character")],
            enable_expand=True, is_api_node=True)

    @classmethod
    def fingerprint_inputs(cls, image, source_mode="Upload reference", **kwargs):
        return _image_hash(image) if _source_mode(source_mode) == "Upload reference" else "fictional-text-only"

    @classmethod
    def validate_inputs(cls, image, name, description, special_name, special_description, intro_tagline, color, character_id, source_mode="Upload reference"):
        try:
            if _source_mode(source_mode) == "Upload reference":
                _input_image(image)
            _character(name, description, special_name, special_description, intro_tagline, color, character_id)
            return True
        except ValueError as error:
            return str(error)

    @classmethod
    def execute(cls, project, image, name, description, special_name, special_description, intro_tagline, color, character_id, include_sprite_sheets=True, source_mode="Upload reference"):
        _project(project); _source_mode(source_mode)
        character = _character(name, description, special_name, special_description, intro_tagline, color, character_id)
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
        artwork = [("portrait", "1:1", False, "Close-up face and shoulders for character selection. Expressive confident anime fighter portrait, uncluttered dark background, no text."),
                   ("hero", "2:3", True, "One complete full-body hero fighter in their signature special-move stance, facing RIGHT. Keep the energy close to the body, and include complete shoes and hands with safe padding. " + KEY),
                   ("cutin", "16:9", False, "Dramatic horizontal special-move cut-in: face and upper torso, fast energy streaks, strong negative space, no text.")]
        for index, (kind, aspect, key, prompt) in enumerate(artwork, 1):
            generated = _cloud(graph, project, common + "\n" + prompt, identity.out(0), aspect, offset=index)
            assets.append(_save(graph, project, generated.out(0), {"id": f"{character_id}_{kind}", "kind": kind, "fighter": character_id, "key": key}, members))
        bundles = []
        if include_sprite_sheets:
            for sheet in SHEETS:
                bundles.append(graph.node("CFZSpriteSheet", project=project, character=character, reference=identity.out(0), sheet=sheet).out(0))
        bundle = _collect(graph, project, members, assets, bundles)
        return io.NodeOutput(bundle, identity.out(0), character, expand=graph.finalize())


class CFZSpriteSheet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZSpriteSheet", display_name="CFZ Sprite Sheet", category="Comfy Fighter Z",
            description="PAID cloud generation: exactly one 2K 3x3 sheet for nine named poses, saved with an exact mapped pose layout. Native cloud API; no local checkpoint.",
            inputs=[Project.Input("project"), Character.Input("character"), io.Image.Input("reference", raw_link=True), io.Combo.Input("sheet", options=list(SHEETS), default="sheet")],
            outputs=[Bundle.Output(display_name="bundle"), io.Image.Output(display_name="sheet_image")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, character, reference, sheet):
        _project(project); character = _checked_character(character)
        if sheet not in SHEETS:
            raise ValueError("Sheet must be sheet, sheetB or sheetC")
        poses = SHEETS[sheet]; graph = GraphBuilder(); members = _members(character=character)
        layout = "; ".join(f"row {i // 3 + 1} column {i % 3 + 1}: {pose}" for i, pose in enumerate(poses))
        prompt = (_description(project, character) + f"\nExactly one square 3x3 sprite sheet with these nine poses in row-major order: {layout}. "
                  "One complete fighter per cell, all standing and attack poses face RIGHT. Every pose includes the entire body, both shoes and accessories. "
                  "Choose one common body scale small enough for the widest kick and longest horizontal fallen pose. Standing figures are about 60% of cell height, with heads near 22% and shoes at 82%. "
                  "Every hand, shoe, hair tip, accessory and attached energy accent stays inside the central 76% of its cell, with at least 12% clear green on all four sides. The bottom row includes both feet and green below. "
                  "Keep canvas bands from 30% to 37% and 63% to 70% entirely empty green, with matching vertical green corridors between columns. No limbs cross cell boundaries. "
                  "Keep common body scale and consistent identity across all nine cells. Sweep kicks point right, launcher strikes upward-right, stance2 is an upright guard, crouch a low guard, down is a complete fallen body. "
                  "Keep special energy compact and attached to the palms; the game supplies the traveling projectile. These are named key poses, not a nine-frame animation loop. No duplicate bodies, detached props, labels or visible cell borders. " + KEY)
        generated = _cloud(graph, project, prompt, reference, "1:1", "2K", 10 + list(SHEETS).index(sheet))
        asset = _save(graph, project, generated.out(0), {"id": f"{character['id']}_{sheet}", "kind": "sprites", "fighter": character["id"], "sheet": sheet, "poses": poses, "key": True}, members)
        return io.NodeOutput(_collect(graph, project, members, [asset]), generated.out(0), expand=graph.finalize())


class CFZEnvironmentFactory(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CFZEnvironmentFactory", display_name="CFZ Environment Factory", category="Comfy Fighter Z",
            description="PAID when enabled: Upload reference uses 1 stage image; Invent fictional reference uses 2 images (a new text-only source plus the playable stage). Invent never reads the image field or earlier session files. Disabled slots make zero cloud calls.",
            inputs=[Project.Input("project"), _image_input(), io.Boolean.Input("enabled", default=True), io.String.Input("name", default="New Environment"),
                    io.String.Input("description", default="", multiline=True), io.String.Input("stage_id", default="environment", advanced=True), _source_mode_input()],
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
    def execute(cls, project, image, enabled, name, description, stage_id, source_mode="Upload reference"):
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
            inputs=[Project.Input("project"), io.Image.Input("stage_reference", raw_link=True)], outputs=[Bundle.Output(display_name="bundle")], enable_expand=True, is_api_node=True)

    @classmethod
    def execute(cls, project, stage_reference):
        if stage_reference is None:
            raise ValueError("Shared game art requires the stage image from an enabled environment factory")
        _project(project); graph = GraphBuilder(); members = _members(); assets = []
        jobs = [
            ("title", "16:9", "Dramatic game-title background based on the venue, animated energy and speed lines. No people or readable text; leave center space for the title overlay."),
            ("select", "16:9", "Character-selection backdrop based on the venue, subdued tournament lighting. No portraits, text, boxes or controls; leave central space for six fighter cards."),
            ("logo", "3:2", f"ASSET TYPE: one isolated typographic logo, not a scene or game screenshot. Render only the exact words {project['title']} as one centered arcade wordmark. Electric gold and white italic beveled lettering, thick black ink outline, restrained cyan and magenta edge accents, oversized final Z. Keep every letter complete with at least 12 percent empty padding. The entire background is perfectly uniform chroma green RGB(0,255,0). No people, faces, bodies, fighters, scenery, buildings, floors, health bars, interface mockups, subtitle, other words, numbers, frames or watermark."),
            ("hud", "16:9", "Thin cyan left and magenta right top-edge accents with yellow trim. All interior and fighting areas are empty flat chroma green. No text, numbers, character portraits or fake health bars. " + KEY.replace("borders or ", "")),
            ("icons", "1:1", "ASSET TYPE: one isolated geometric interface icon, not a scene or game screenshot. Render only a compact centered energy crest made of exactly three small linked rectangular workflow nodes and one central lightning bolt. Clean gold, white, cyan and magenta shapes with crisp black ink outlines and simple cel shading. Keep the complete emblem inside the central 70 percent of the canvas. The entire background is perfectly uniform chroma green RGB(0,255,0). No people, faces, bodies, fighters, scenery, buildings, floors, weapons, clothing, health bars, interface mockups, words, numbers, frames or watermark."),
        ]
        for index, (identity, aspect, prompt) in enumerate(jobs):
            # Scene-oriented UI styles can turn a logo or icon into a game illustration.
            # These two isolated assets carry their complete visual style in their own prompt.
            full_prompt = prompt if identity in {"logo", "icons"} else project["ui_style"] + "\n" + prompt
            generated = _cloud(graph, project, full_prompt, stage_reference if identity in {"title", "select"} else None, aspect, offset=40 + index)
            assets.append(_save(graph, project, generated.out(0), {"id": identity, "kind": "ui", "key": identity in {"logo", "hud", "icons"}}, members))
        prompt = (project["style"] + "\nSquare 3x3 sheet of nine separate fighting-game effects in exact row-major order: " + ", ".join(EFFECTS) + ". "
                  "Each effect stays completely inside its cell with clear empty padding, no people or body parts. Compact impact bursts, shields and energy shapes. " + KEY)
        effect = _cloud(graph, project, prompt, None, "1:1", "2K", 49)
        assets.append(_save(graph, project, effect.out(0), {"id": "combat_effects", "kind": "effects", "poses": EFFECTS, "key": True}, members))
        return io.NodeOutput(_collect(graph, project, members, assets), expand=graph.finalize())


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
                    item = {"id": _slug(item.get("id"), "Stage ID"), "name": _text(item.get("name"), "Stage name", True),
                            "description": _text(item.get("description", ""), "Stage description")}
                identity = _slug(item.get("id"), category + " ID"); previous = found[category].get(identity.casefold())
                if previous is not None and previous != item:
                    raise ValueError(f"Conflicting {category} definition: {identity}")
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
                    io.Autogrow.Input("bundles", template=io.Autogrow.TemplatePrefix(Bundle.Input("bundle"), prefix="bundle_", min=0))], outputs=[Bundle.Output(display_name="bundle")])

    @classmethod
    def execute(cls, project, members_json, assets=None, bundles=None):
        return io.NodeOutput(_merge(project, bundles or {}, _json_object(members_json, "members_json"), list((assets or {}).values())))


def _export(project, bundles, complete):
    bundle = _merge(project, bundles); directory = _project(project)
    if not bundle["assets"]:
        raise ValueError("Connect at least one generated asset bundle")
    if complete and (len(bundle["fighters"]) < 2 or not bundle["stages"]):
        raise ValueError("A complete game requires at least two fighters and one enabled environment")
    config = {"title": project["title"], "subtitle": project["subtitle"], "fighters": bundle["fighters"], "stages": bundle["stages"], "sheets": SHEETS}
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
        mappings = {name: {"kind": "ui"} for name in ["title", "select", "logo", "hud", "icons"]}
        mappings["combat_effects"] = {"kind": "effects", "poses": EFFECTS, "key": True}
        for fighter in config["fighters"]:
            for suffix in ["source", "reference", *SHEETS, "portrait", "hero", "cutin"]:
                expected_mapping = {"kind": "sprites" if suffix in SHEETS else suffix, "fighter": fighter["id"]}
                if suffix in SHEETS:
                    expected_mapping.update(sheet=suffix, poses=SHEETS[suffix], key=True)
                mappings[f"{fighter['id']}_{suffix}"] = expected_mapping
        for stage in config["stages"]:
            mappings[stage["id"]] = {"kind": "stage", "stage": stage["id"]}
            mappings[f"{stage['id']}_source"] = {"kind": "source", "stage": stage["id"]}
        expected = set(mappings)
        actual = {record["id"] for record in records}
        if expected != actual:
            raise ValueError(f"Incomplete game assets; missing: {', '.join(sorted(expected - actual)) or 'none'}; unexpected: {', '.join(sorted(actual - expected)) or 'none'}")
        for record in records:
            mapping = mappings[record["id"]]
            if any(record.get(field) != value for field, value in mapping.items()) or any(field in record and field not in mapping for field in ("fighter", "stage", "sheet", "poses")):
                raise ValueError(f"Incorrect mapped kind, owner or layout for {record['id']}")
        for fighter in config["fighters"]:
            poses = [pose for record in records if record["kind"] == "sprites" and record.get("fighter") == fighter["id"] for pose in record["poses"]]
            if len(poses) != 27 or set(poses) != {pose for sheet in SHEETS.values() for pose in sheet}:
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
            inputs=[Project.Input("project"), io.Autogrow.Input("bundles", template=io.Autogrow.TemplatePrefix(Bundle.Input("bundle"), prefix="bundle_", min=1))],
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
            inputs=[Project.Input("project"), io.Autogrow.Input("bundles", template=io.Autogrow.TemplatePrefix(Bundle.Input("bundle"), prefix="bundle_", min=1))],
            outputs=[io.String.Output(display_name="manifest_path")], is_output_node=True)

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(cls, project, bundles):
        return _export(project, bundles, False)


FACTORY_NODES = [CFZProjectSettings, CFZProjectAudioRoot, CFZCharacterDefinition, CFZFictionalReference, CFZCharacterFactory, CFZSpriteSheet, CFZEnvironmentFactory,
                 CFZSharedArtFactory, CFZSaveMappedAsset, CFZCollectBundle, CFZExportGameAssets, CFZExportAssetPatch]
