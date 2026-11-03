"""Local output tests; use the ComfyUI Python environment and set COMFYUI_ROOT. No server, GPU inference, or cloud calls."""
import importlib.util
import asyncio
import json
import os
from pathlib import Path
import tempfile
import sys
import unittest

import numpy as np


if os.environ.get("COMFYUI_ROOT"):
    sys.path.insert(0, os.environ["COMFYUI_ROOT"])

MODULE = Path(__file__).resolve().parents[1] / "custom_nodes" / "dad_fighter_assets" / "__init__.py"
spec = importlib.util.spec_from_file_location("dad_fighter_assets", MODULE)
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)


def config(expected=None):
    result = {"title": "Fixture Brawl", "fighters": [{"id": "dad", "name": "Dad", "color": "#ff8800"}],
              "stages": [{"id": "yard", "name": "Yard"}], "sheets": nodes.SHEETS}
    if expected is not None:
        result["expectedAssets"] = expected
    return result


class BundleNodesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="comfy-bundle-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.directory = self.base / "bundle"
        self.pixels = np.ones((1, 12, 16, 3), dtype=np.float32)

    def root(self, expected=None, directory=None):
        return nodes.DFZAssetRoot.execute(str(directory or self.directory), json.dumps(config(expected)))[0]

    def save(self, root, identity="dad_reference", **metadata):
        item = {"id": identity, "kind": "reference", "fighter": "dad", "key": True, **metadata}
        return nodes.DFZSaveAsset.execute(self.pixels, root, json.dumps(item))[0]

    def test_root_does_not_create_directory_and_rejects_relative_paths(self):
        self.root()
        self.assertFalse(self.directory.exists())
        with self.assertRaisesRegex(ValueError, "absolute"):
            nodes.DFZAssetRoot.execute("relative/bundle", json.dumps(config()))

    def test_saves_image_and_portable_manifest_with_no_private_paths(self):
        root = self.root(["dad_reference"])
        record = self.save(root)
        result = nodes.DFZExportManifest.execute(root, {"asset_0": record})
        output = Path(result.result[0])
        self.assertEqual(output, self.directory / "assets.json")
        manifest = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema"], "dad-fighter-assets/v1")
        self.assertEqual(manifest["root"], ".")
        self.assertEqual(manifest["assets"][0]["src"], f"raw/dad_reference-{record['sha256'][:16]}.png")
        self.assertEqual([manifest["assets"][0]["width"], manifest["assets"][0]["height"]], [16, 12])
        self.assertNotIn("_root", manifest["assets"][0])
        self.assertNotIn(str(self.base), output.read_text())
        self.assertEqual(len(manifest["assets"][0]["sha256"]), 64)

    def test_duplicate_ids_and_different_roots_are_rejected(self):
        root = self.root()
        record = self.save(root)
        with self.assertRaisesRegex(ValueError, "Duplicate asset"):
            nodes.DFZExportManifest.execute(root, {"asset_0": record, "asset_1": record})
        other = self.root(directory=self.base / "other")
        with self.assertRaisesRegex(ValueError, "same DFZ Asset Root"):
            nodes.DFZExportManifest.execute(other, {"asset_0": record})

    def test_partial_export_preserves_previously_complete_manifest(self):
        root = self.root(["dad_reference", "yard"])
        ref = self.save(root)
        stage = self.save(root, "yard", kind="stage", stage="yard")
        nodes.DFZExportManifest.execute(root, {"asset_0": ref, "asset_1": stage})
        previous = (self.directory / "assets.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "Incomplete asset bundle"):
            nodes.DFZExportManifest.execute(root, {"asset_0": ref})
        self.assertEqual((self.directory / "assets.json").read_bytes(), previous)

    def test_rerun_uses_new_raw_path_and_failed_export_keeps_old_bundle_usable(self):
        root = self.root(["dad_reference", "yard"])
        previous_ref = self.save(root)
        stage = self.save(root, "yard", kind="stage", stage="yard")
        nodes.DFZExportManifest.execute(root, {"asset_0": previous_ref, "asset_1": stage})
        previous_manifest = (self.directory / "assets.json").read_bytes()
        previous_image = (self.directory / previous_ref["src"]).read_bytes()
        self.pixels.fill(0.25)
        next_ref = self.save(root)
        self.assertNotEqual(previous_ref["src"], next_ref["src"])
        with self.assertRaisesRegex(ValueError, "Incomplete asset bundle"):
            nodes.DFZExportManifest.execute(root, {"asset_0": next_ref})
        self.assertEqual((self.directory / "assets.json").read_bytes(), previous_manifest)
        self.assertEqual((self.directory / previous_ref["src"]).read_bytes(), previous_image)

    def test_repeated_save_checks_existing_content_before_reuse(self):
        root = self.root()
        record = self.save(root)
        image_file = self.directory / record["src"]
        original = image_file.read_bytes()
        image_file.write_bytes(b"corrupt")
        repeated = self.save(root)
        self.assertEqual(repeated["src"], record["src"])
        self.assertEqual(image_file.read_bytes(), original)

    def test_missing_or_changed_files_cannot_be_advertised(self):
        root = self.root()
        record = self.save(root)
        file = self.directory / record["src"]
        file.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed after saving"):
            nodes.DFZExportManifest.execute(root, {"asset_0": record})
        file.unlink()
        with self.assertRaisesRegex(ValueError, "file is missing"):
            nodes.DFZExportManifest.execute(root, {"asset_0": record})
        self.assertFalse((self.directory / "assets.json").exists())

    def test_traversal_and_invalid_sprite_mapping_are_rejected(self):
        root = self.root()
        for identity in ("../outside", "x/y", "C:\\escape", "..", "a.png"):
            with self.assertRaises(ValueError):
                self.save(root, identity)
        with self.assertRaisesRegex(ValueError, "configured pose order"):
            self.save(root, "dad_sheet", kind="sprites", sheet="sheet", poses=list(reversed(nodes.SHEETS["sheet"])))
        self.assertFalse(self.directory.exists())

    def test_only_one_finite_image_is_saved(self):
        root = self.root()
        metadata = json.dumps({"id": "dad_reference", "kind": "reference", "fighter": "dad"})
        with self.assertRaisesRegex(ValueError, "exactly one"):
            nodes.DFZSaveAsset.execute(np.ones((2, 12, 16, 3)), root, metadata)
        self.pixels[0, 0, 0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "nonfinite"):
            nodes.DFZSaveAsset.execute(self.pixels, root, metadata)

    def test_root_symlink_is_rejected_when_platform_supports_links(self):
        target = self.base / "target"
        target.mkdir()
        try:
            os.symlink(target, self.directory, target_is_directory=True)
        except OSError:
            self.skipTest("Creating symlinks requires platform permission")
        with self.assertRaisesRegex(ValueError, "symlinks or junctions"):
            self.root()

    def test_invalid_config_and_empty_export_are_rejected(self):
        for invalid in ({}, {**config(), "fighters": []}, {**config(), "expectedAssets": ["dad", "DAD"]}):
            with self.assertRaises(ValueError):
                nodes.DFZAssetRoot.execute(str(self.directory), json.dumps(invalid))
        with self.assertRaisesRegex(ValueError, "at least one"):
            nodes.DFZExportManifest.execute(self.root(), {})

    def test_v3_extension_exposes_dynamic_asset_collection(self):
        extension = asyncio.run(nodes.comfy_entrypoint())
        self.assertEqual(asyncio.run(extension.get_node_list()),
                         [nodes.DFZAssetRoot, nodes.DFZSaveAsset, nodes.DFZExportManifest, nodes.DFZSaveAudio, nodes.DFZExportAudioManifest])
        inputs = nodes.DFZExportManifest.INPUT_TYPES()["required"]
        self.assertEqual(inputs["assets"][0], "COMFY_AUTOGROW_V3")
        self.assertEqual(inputs["assets"][1]["template"]["prefix"], "asset_")
        self.assertEqual(inputs["assets"][1]["template"]["min"], 1)
        self.assertEqual(nodes.DFZSaveAsset.RETURN_TYPES, ["DFZ_ASSET"])
        self.assertTrue(nodes.DFZExportManifest.OUTPUT_NODE)

    def test_source_images_keep_character_and_stage_metadata(self):
        value = config(["dad_source", "yard_source"])
        value["fighters"][0].update(sourceImage="ref/dad.jpeg", sourceInput="dad.jpeg", description="An original fighter.", specialMove={"name": "Flash", "description": "A camera flash projectile."})
        root = nodes.DFZAssetRoot.execute(str(self.directory), json.dumps(value))[0]
        first = self.save(root, "dad_source", kind="source")
        second = nodes.DFZSaveAsset.execute(self.pixels, root, json.dumps({"id": "yard_source", "kind": "source", "stage": "yard"}))[0]
        nodes.DFZExportManifest.execute(root, {"asset_0": first, "asset_1": second})
        manifest = json.loads((self.directory / "assets.json").read_text())
        self.assertEqual(manifest["game"]["fighters"][0]["specialMove"]["name"], "Flash")
        self.assertEqual(manifest["assets"][1]["stage"], "yard")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.save(root, "bad_source", kind="source", stage="yard")

    def test_audio_wav_and_manifest_preserve_samples_and_mapping(self):
        import wave
        value = config()
        value["expectedAudio"] = ["yard_music"]
        root = nodes.DFZAssetRoot.execute(str(self.directory), json.dumps(value))[0]
        samples = np.zeros((1, 2, 8000), dtype=np.float32)
        samples[0, 0, 100] = 0.5
        record = nodes.DFZSaveAudio.execute({"waveform": samples, "sample_rate": 8000}, root,
            json.dumps({"id": "yard_music", "kind": "audio", "category": "music", "loop": True}))[0]
        nodes.DFZExportAudioManifest.execute(root, {"audio_0": record})
        manifest = json.loads((self.directory / "audio.json").read_text())
        self.assertEqual(manifest["schema"], "dad-fighter-audio/v1")
        self.assertEqual(manifest["assets"][0]["duration"], 1)
        self.assertNotIn("_root", manifest["assets"][0])
        with wave.open(str(self.directory / record["src"]), "rb") as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()), (2, 2, 8000, 8000))
            decoded = np.frombuffer(audio.readframes(8000), dtype="<i2").reshape(-1, 2)
            self.assertEqual(decoded[100, 0], 16384)
        with self.assertRaisesRegex(ValueError, "Duplicate audio"):
            nodes.DFZExportAudioManifest.execute(root, {"audio_0": record, "audio_1": record})
        (self.directory / record["src"]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "missing or changed"):
            nodes.DFZExportAudioManifest.execute(root, {"audio_0": record})

    def test_audio_rejects_bad_shape_nonfinite_and_incomplete_collection(self):
        root = self.root()
        metadata = json.dumps({"id": "sfx_punch", "kind": "audio", "category": "sfx"})
        with self.assertRaisesRegex(ValueError, "one mono/stereo"):
            nodes.DFZSaveAudio.execute({"waveform": np.zeros((2, 1, 80)), "sample_rate": 8000}, root, metadata)
        with self.assertRaisesRegex(ValueError, "nonfinite"):
            nodes.DFZSaveAudio.execute({"waveform": np.full((1, 1, 80), np.nan), "sample_rate": 8000}, root, metadata)
        value = config(); value["expectedAudio"] = ["sfx_punch", "sfx_kick"]
        root = nodes.DFZAssetRoot.execute(str(self.directory), json.dumps(value))[0]
        record = nodes.DFZSaveAudio.execute({"waveform": np.zeros((1, 1, 80)), "sample_rate": 8000}, root, metadata)[0]
        with self.assertRaisesRegex(ValueError, "Incomplete audio"):
            nodes.DFZExportAudioManifest.execute(root, {"audio_0": record})
        self.assertFalse((self.directory / "audio.json").exists())


if __name__ == "__main__":
    unittest.main()
