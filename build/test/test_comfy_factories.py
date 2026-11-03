"""Exercise the real V3 graph contract with native validation and mocked cloud pixels.

Run using the ComfyUI Python environment with COMFYUI_ROOT set. These tests never
call the Gemini execute method, queue a prompt, or perform paid inference.
"""
import asyncio
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from test_comfy_nodes import nodes
from comfy_fighter_assets import factories as factory
from comfy_api.latest import _io, io
from comfy_api_nodes.nodes_gemini import GeminiNanoBanana2V2
from comfy_execution.graph_utils import is_link
import execution
import folder_paths
import nodes as comfy_nodes


def defaults(cls):
    return {key: spec[1]["default"] for key, spec in cls.INPUT_TYPES()["required"].items() if "default" in spec[1]}


class MockCloudGraph:
    """Resolve graph expansion while preserving V3 rawLink/dynamic input behavior."""
    def __init__(self, graph):
        self.graph = graph
        self.outputs = {}
        self.native_calls = []
        self.classes = {cls.__name__: cls for cls in nodes.FACTORY_NODES}
        self.classes.update(GeminiNanoBanana2V2=GeminiNanoBanana2V2, LoadImage=comfy_nodes.LoadImage)

    def value(self, value):
        return self.node(value[0])[value[1]] if is_link(value) else value

    def node(self, identity):
        if identity in self.outputs:
            return self.outputs[identity]
        spec = self.graph[identity]
        cls = self.classes[spec["class_type"]]
        if cls is comfy_nodes.LoadImage:
            result = cls().load_image(**spec["inputs"])
        else:
            finalized, _, v3 = _io.get_finalized_class_inputs(cls.INPUT_TYPES(), spec["inputs"])
            descriptors = {**finalized["required"], **finalized["optional"]}
            inputs = {key: value if descriptors[key][1].get("rawLink") else self.value(value) for key, value in spec["inputs"].items()}
            nested = _io.build_nested_inputs(inputs, v3)
            if cls is GeminiNanoBanana2V2:
                self.native_calls.append({"id": identity, "inputs": spec["inputs"], "nested": nested})
                # Deliberately tiny synthetic fixtures; no production assets are touched.
                pixels = np.full((1, 18, 18, 3), len(self.native_calls) / 100, dtype=np.float32)
                result = (pixels, "mock cloud output", pixels)
            else:
                output = cls.execute(**nested)
                if output.expand:
                    self.graph.update(output.expand)
                result = tuple(self.value(value) for value in output.result)
        self.outputs[identity] = result
        return result

    def validate_native_graph(self, testcase):
        # Use actual Comfy validation, including native Gemini DynamicCombo and
        # our Autogrow groups. Native execute() is never called.
        with patch.dict(comfy_nodes.NODE_CLASS_MAPPINGS, self.classes):
            validated = {}
            for identity in self.graph:
                result = asyncio.run(execution.validate_inputs("fixture-validation", self.graph, identity, validated))
                testcase.assertTrue(result[0], (identity, result, validated))


class CloudFactoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="cfz-factories-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.inputs = self.base / "input"
        self.inputs.mkdir()
        self.pixels = np.ones((1, 18, 18, 3), dtype=np.float32)
        Image.new("RGB", (18, 18), "navy").save(self.inputs / "photo.png")
        previous = folder_paths.get_input_directory()
        folder_paths.set_input_directory(str(self.inputs))
        self.addCleanup(folder_paths.set_input_directory, previous)
        self.project_args = {**defaults(factory.CFZProjectSettings), "root_directory": str(self.base / "out"), "title": "Fixture Fighters", "subtitle": "An original saga"}
        self.project = factory.CFZProjectSettings.execute(**self.project_args)[0]

    def character_args(self, index=0, sheets=True):
        return {**defaults(factory.CFZCharacterFactory), "project": self.project, "image": "photo.png", "name": f"Fighter {index}",
                "character_id": f"fighter{index}", "description": f"Reference fighter number {index}", "special_name": "Palm Flash",
                "special_description": "A bright cyan palm projectile", "intro_tagline": "Bring your best!", "include_sprite_sheets": sheets}

    def stage_args(self, index=0, enabled=True):
        return {**defaults(factory.CFZEnvironmentFactory), "project": self.project, "image": "photo.png" if enabled else "", "enabled": enabled,
                "name": f"Venue {index}", "stage_id": f"venue{index}", "description": "An indoor event venue"}

    def full_graph(self, fighters=6, enabled_stages=3):
        graph = {f"fighter{i}": {"class_type": "CFZCharacterFactory", "inputs": self.character_args(i)} for i in range(fighters)}
        graph.update({f"stage{i}": {"class_type": "CFZEnvironmentFactory", "inputs": self.stage_args(i, i < enabled_stages)} for i in range(3)})
        graph["shared"] = {"class_type": "CFZSharedArtFactory", "inputs": {"project": self.project, "stage_reference": ["stage0", 1]}}
        sources = [f"fighter{i}" for i in range(fighters)] + [f"stage{i}" for i in range(3)] + ["shared"]
        graph["export"] = {"class_type": "CFZExportGameAssets", "inputs": {"project": self.project, **{f"bundles.bundle_{i}": [name, 0] for i, name in enumerate(sources)}}}
        return MockCloudGraph(graph)

    def test_real_schema_marks_paid_factories_and_has_empty_upload_slots(self):
        for cls in [factory.CFZFictionalReference, factory.CFZCharacterFactory, factory.CFZEnvironmentFactory, factory.CFZSpriteSheet, factory.CFZSharedArtFactory]:
            self.assertTrue(cls.GET_NODE_INFO_V1()["api_node"])
            self.assertIn("PAID", cls.GET_NODE_INFO_V1()["description"])
        for cls in [factory.CFZProjectSettings, factory.CFZCharacterDefinition, factory.CFZExportGameAssets]:
            self.assertFalse(cls.GET_NODE_INFO_V1()["api_node"])
        for cls in [factory.CFZCharacterFactory, factory.CFZEnvironmentFactory]:
            upload = cls.INPUT_TYPES()["required"]["image"][1]
            self.assertEqual(upload["options"][0], "")
            self.assertTrue(upload["image_upload"])
            mode = cls.INPUT_TYPES()["optional"]["source_mode"][1]
            self.assertEqual(mode["default"], "Upload reference")
            self.assertEqual(mode["options"], ["Upload reference", "Invent fictional reference"])
        self.assertNotIn("control_after_generate", factory.CFZProjectSettings.INPUT_TYPES()["required"]["seed"][1])

    def test_full_six_fighter_three_environment_bundle_validates_and_maps_every_image(self):
        graph = self.full_graph()
        destination = Path(graph.node("export")[0])
        graph.validate_native_graph(self)
        manifest = json.loads(destination.read_text(encoding="utf-8"))
        self.assertEqual(len(graph.native_calls), 51)
        self.assertEqual(len(manifest["assets"]), 60)
        self.assertEqual(len(manifest["game"]["fighters"]), 6)
        self.assertEqual(len(manifest["game"]["stages"]), 3)
        self.assertEqual(manifest["game"]["subtitle"], "An original saga")
        self.assertEqual(manifest["game"]["fighters"][0]["specialMove"]["description"], "A bright cyan palm projectile")
        self.assertEqual(manifest["game"]["fighters"][0]["introTagline"], "Bring your best!")
        self.assertEqual(manifest["root"], ".")
        self.assertNotIn(str(self.base), destination.read_text(encoding="utf-8"))
        self.assertEqual(set(manifest["game"]["expectedAssets"]), {item["id"] for item in manifest["assets"]})
        for item in manifest["assets"]:
            self.assertEqual(hashlib.sha256((destination.parent / item["src"]).read_bytes()).hexdigest(), item["sha256"])
        for fighter in manifest["game"]["fighters"]:
            poses = [pose for item in manifest["assets"] if item["kind"] == "sprites" and item["fighter"] == fighter["id"] for pose in item["poses"]]
            self.assertEqual(poses, [pose for group in nodes.SHEETS.values() for pose in group])
        for call in graph.native_calls:
            self.assertEqual(call["nested"]["model"]["model"], "Gemini Nano Banana 2.1")
            self.assertEqual(call["nested"]["model"]["thinking_level"], "MINIMAL")
            self.assertNotIn("auth_token_comfy_org", call["inputs"])
            self.assertNotIn("api_key_comfy_org", call["inputs"])
        sheets = [call for call in graph.native_calls if "row 3 column 3" in call["inputs"]["prompt"]]
        self.assertEqual(len(sheets), 18)
        self.assertTrue(all(call["nested"]["model"]["resolution"] == "2K" for call in sheets))
        self.assertTrue(all("image_1" in call["nested"]["model"]["images"] for call in sheets))

    def test_default_one_stage_keeps_other_slots_truly_empty_and_free(self):
        graph = self.full_graph(enabled_stages=1)
        manifest = json.loads(Path(graph.node("export")[0]).read_text(encoding="utf-8"))
        self.assertEqual((len(graph.native_calls), len(manifest["assets"])), (49, 56))
        self.assertEqual([stage["id"] for stage in manifest["game"]["stages"]], ["venue0"])
        self.assertIsNone(graph.node("stage1")[1])
        disabled = factory.CFZEnvironmentFactory.execute(**{**self.stage_args(enabled=False), "image": "../outside.png", "stage_id": ""})
        self.assertIsNone(disabled.expand)
        self.assertEqual(disabled[0]["assets"], [])
        self.assertEqual(factory.CFZEnvironmentFactory.fingerprint_inputs(image="missing.png", enabled=False), "disabled")

    def test_fictional_mode_never_reads_stale_photos_and_maps_complete_new_bundle(self):
        for enabled_stages, expected_calls in [(1, 56), (3, 60)]:
            with self.subTest(enabled_stages=enabled_stages):
                graph = self.full_graph(enabled_stages=enabled_stages)
                for node in graph.graph.values():
                    if node["class_type"] in ["CFZCharacterFactory", "CFZEnvironmentFactory"]:
                        node["inputs"].update(source_mode="Invent fictional reference", image="previous-session-person.jpeg")
                with patch.object(factory, "_input_image", side_effect=AssertionError("An old input image was read")), \
                        patch.object(factory, "_image_hash", side_effect=AssertionError("An old input image was hashed")), \
                        patch.object(comfy_nodes.LoadImage, "load_image", side_effect=AssertionError("An old input image was loaded")):
                    destination = Path(graph.node("export")[0])
                    graph.validate_native_graph(self)
                    self.assertEqual(factory.CFZCharacterFactory.fingerprint_inputs(image="photo.png", source_mode="Invent fictional reference"), "fictional-text-only")
                    self.assertEqual(factory.CFZEnvironmentFactory.fingerprint_inputs(image="photo.png", enabled=True, source_mode="Invent fictional reference"), "fictional-text-only")
                manifest = json.loads(destination.read_text(encoding="utf-8"))
                self.assertEqual(len(graph.native_calls), expected_calls)
                self.assertEqual(len(manifest["assets"]), expected_calls)
                self.assertFalse(any(node["class_type"] == "LoadImage" for node in graph.graph.values()))
                self.assertNotIn("previous-session-person", destination.read_text(encoding="utf-8"))
                invented = [call for call in graph.native_calls if "from this text alone" in call["inputs"]["prompt"]]
                self.assertEqual(len(invented), 6 + enabled_stages)
                self.assertTrue(all(not any(key.startswith("model.images") for key in call["inputs"]) for call in invented))
                self.assertTrue(all(not call["nested"]["model"]["images"] for call in invented))

    def test_fictional_mode_validates_empty_input_and_disabled_environment_does_no_work(self):
        args = {**self.character_args(), "image": "", "source_mode": "Invent fictional reference"}
        validation = {key: value for key, value in args.items() if key not in ["project", "include_sprite_sheets"]}
        self.assertIs(factory.CFZCharacterFactory.validate_inputs(**validation), True)
        self.assertEqual(len([node for node in factory.CFZCharacterFactory.execute(**args).expand.values() if node["class_type"] == "GeminiNanoBanana2V2"]), 5)
        stage = {**self.stage_args(enabled=False), "image": "../previous-photo.jpg", "source_mode": "Invent fictional reference"}
        output = factory.CFZEnvironmentFactory.execute(**stage)
        self.assertIsNone(output.expand)
        self.assertEqual(output[0]["assets"], [])
        self.assertEqual(factory.CFZEnvironmentFactory.fingerprint_inputs(image=stage["image"], enabled=False, source_mode=stage["source_mode"]), "disabled")
        with self.assertRaisesRegex(ValueError, "Source mode"):
            factory.CFZCharacterFactory.execute(**{**args, "source_mode": "Use last photo"})

    def test_single_character_art_and_three_visible_sheet_nodes_do_not_duplicate_cloud_calls(self):
        graph = {"character": {"class_type": "CFZCharacterFactory", "inputs": self.character_args(sheets=False)}}
        for sheet in nodes.SHEETS:
            graph[sheet] = {"class_type": "CFZSpriteSheet", "inputs": {"project": self.project, "character": ["character", 2], "reference": ["character", 1], "sheet": sheet}}
        graph["export"] = {"class_type": "CFZExportAssetPatch", "inputs": {"project": self.project, **{f"bundles.bundle_{i}": [name, 0] for i, name in enumerate(["character", *nodes.SHEETS])}}}
        runner = MockCloudGraph(graph)
        manifest = json.loads(Path(runner.node("export")[0]).read_text(encoding="utf-8"))
        runner.validate_native_graph(self)
        self.assertEqual((len(runner.native_calls), len(manifest["assets"])), (7, 8))
        self.assertTrue(manifest["partial"])
        self.assertEqual(manifest["game"]["stages"], [])

    def test_individual_sheet_can_use_an_accepted_reference_without_regenerating_identity(self):
        character = factory._checked_character(factory.CFZCharacterDefinition.execute(**{key: value for key, value in self.character_args().items() if key in defaults(factory.CFZCharacterDefinition)})[0])
        graph = MockCloudGraph({"reference": {"class_type": "LoadImage", "inputs": {"image": "photo.png"}},
                               "sheet": {"class_type": "CFZSpriteSheet", "inputs": {"project": self.project, "character": character, "reference": ["reference", 0], "sheet": "sheetB"}}})
        bundle, image = graph.node("sheet")
        graph.validate_native_graph(self)
        self.assertEqual(len(graph.native_calls), 1)
        self.assertEqual(bundle["assets"][0]["poses"], nodes.SHEETS["sheetB"])
        self.assertEqual(bundle["assets"][0]["id"], "fighter0_sheetB")

    def test_fictional_reference_encapsulates_one_text_only_native_cloud_call(self):
        graph = MockCloudGraph({"reference": {"class_type": "CFZFictionalReference", "inputs": {
            "project": self.project, "prompt": "An invented silver-haired mechanic in navy coveralls.", "aspect": "2:3", "resolution": "1K"}}})
        with patch.object(factory, "_input_image", side_effect=AssertionError("Previous input was read")), \
                patch.object(comfy_nodes.LoadImage, "load_image", side_effect=AssertionError("Previous input was loaded")):
            image, = graph.node("reference")
            graph.validate_native_graph(self)
        self.assertEqual(image.shape, (1, 18, 18, 3))
        self.assertEqual(len(graph.native_calls), 1)
        self.assertEqual(len(graph.graph), 2)
        child = graph.native_calls[0]
        self.assertNotIn("model.images.image_1", child["inputs"])
        self.assertEqual(child["nested"]["model"]["images"], {})
        self.assertIn("text alone", child["inputs"]["prompt"])
        self.assertEqual(factory.CFZFictionalReference.GET_NODE_INFO_V1()["output"], ["IMAGE"])
        self.assertNotIn("image", factory.CFZFictionalReference.INPUT_TYPES()["required"])

    def test_native_execution_supplies_hidden_credentials_without_serializing_them(self):
        graph = self.full_graph(fighters=2, enabled_stages=1)
        graph.node("export")
        inputs = graph.native_calls[0]["inputs"]
        _, _, data = execution.get_input_data(inputs, GeminiNanoBanana2V2, "native-child", extra_data={"auth_token_comfy_org": "fixture-auth", "api_key_comfy_org": "fixture-key"})
        self.assertEqual(data["hidden_inputs"][io.Hidden.auth_token_comfy_org], "fixture-auth")
        self.assertEqual(data["hidden_inputs"][io.Hidden.api_key_comfy_org], "fixture-key")
        self.assertNotIn("fixture-auth", json.dumps(graph.graph))
        self.assertNotIn("fixture-key", json.dumps(graph.graph))

    def test_export_rejects_missing_duplicate_wrong_kind_and_altered_files_without_replacing_manifest(self):
        graph = self.full_graph(fighters=2, enabled_stages=1)
        output = Path(graph.node("export")[0]); previous = output.read_bytes()
        bundle = factory._merge(self.project, {name: graph.node(name)[0] for name in ["fighter0", "fighter1", "stage0", "shared"]})
        for mutate, error in [(lambda value: value["assets"].pop(), "Incomplete"),
                              (lambda value: value["assets"].append(value["assets"][0]), "Duplicate"),
                              (lambda value: next(item for item in value["assets"] if item["id"] == "title").update(kind="source", fighter="fighter0"), "Incorrect mapped")]:
            bad = copy.deepcopy(bundle); mutate(bad)
            with self.assertRaisesRegex(ValueError, error):
                factory.CFZExportGameAssets.execute(self.project, {"bundle_0": bad})
            self.assertEqual(output.read_bytes(), previous)
        item = bundle["assets"][0]
        (output.parent / item["src"]).write_bytes(b"corrupt image")
        with self.assertRaisesRegex(ValueError, "missing or changed"):
            factory.CFZExportGameAssets.execute(self.project, {"bundle_0": bundle})
        self.assertEqual(output.read_bytes(), previous)

    def test_patch_cannot_overwrite_a_complete_manifest_and_roots_cannot_mix(self):
        graph = self.full_graph(fighters=2, enabled_stages=1)
        output = Path(graph.node("export")[0]); previous = output.read_bytes()
        bundle = graph.node("fighter0")[0]
        with self.assertRaisesRegex(ValueError, "separate patch root"):
            factory.CFZExportAssetPatch.execute(self.project, {"bundle_0": bundle})
        self.assertEqual(output.read_bytes(), previous)
        with self.assertRaisesRegex(ValueError, "at least two fighters"):
            factory.CFZExportGameAssets.execute(self.project, {"bundle_0": bundle})
        other = {**self.project, "root_directory": str(self.base / "other")}
        with self.assertRaisesRegex(ValueError, "same CFZ"):
            factory.CFZExportAssetPatch.execute(other, {"bundle_0": bundle})

    def test_photo_changes_invalidate_factory_and_traversal_is_rejected(self):
        before = factory.CFZCharacterFactory.fingerprint_inputs(image="photo.png")
        Image.new("RGB", (18, 18), "red").save(self.inputs / "photo.png")
        self.assertNotEqual(before, factory.CFZCharacterFactory.fingerprint_inputs(image="photo.png"))
        Image.new("RGB", (18, 18), "red").save(self.base / "outside.png")
        for path in ["../outside.png", str(self.base / "outside.png"), "", "missing.png"]:
            with self.assertRaises(ValueError):
                factory.CFZCharacterFactory.execute(**{**self.character_args(), "image": path})


if __name__ == "__main__":
    unittest.main()
