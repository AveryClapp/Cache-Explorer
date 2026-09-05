"""SDK-free tests; these are not evidence of licensed IDA/Hex-Rays compatibility."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("bundle", REPO / "integrations/ida/hardware_explorer_bundle.py")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
SCHEMA = REPO / "frontend/src/binary/hotspots.schema.json"
FIXTURE = json.loads(Path(sys.argv.pop()).read_text())


class BundleTest(unittest.TestCase):
    def test_identity_and_rebase(self):
        bundle = core.validate_bundle(copy.deepcopy(FIXTURE), SCHEMA)
        digest = bundle["images"][0]["sha256"]
        rows = core.map_sites(bundle, digest, 0x400000)
        rebased = core.map_sites(bundle, bytes.fromhex(digest), 0x710000)
        self.assertEqual(rebased[0][0] - rows[0][0], 0x310000)
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            core.map_sites(bundle, "f" * 64, 0x400000)
        with self.assertRaisesRegex(ValueError, "overflows"):
            core.map_sites(bundle, digest, 0xffffffff)

    def test_invalid_fields(self):
        mutations = [
            lambda b: b.update(schemaVersion=2),
            lambda b: b["images"][0].update(loadedBase="0x400000"),
            lambda b: b["images"][0].update(sha256="d" * 64),
            lambda b: b["codeHotspots"][0]["lookup"].update(rva="0x1014"),
            lambda b: b["codeHotspots"][0]["metrics"].update(accesses=999),
            lambda b: b["codeHotspots"][0].update(navigationConfidence="pseudocode-nearest"),
        ]
        for mutate in mutations:
            bundle = copy.deepcopy(FIXTURE)
            mutate(bundle)
            with self.assertRaises(Exception):
                core.validate_bundle(bundle, SCHEMA)

    def test_duplicate_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            path.write_text('{"schemaVersion":1,"schemaVersion":2}')
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                core.read_bundle(path, SCHEMA)

    def test_annotations_and_nearest(self):
        user = "user comment\nkeep this too"
        annotated = core.update_annotation(user, "modeled misses=10")
        self.assertEqual(core.update_annotation(annotated), user)
        self.assertEqual(core.update_annotation(annotated, "new").count("[Hardware Explorer Preview]"), 1)
        self.assertEqual(core.nearest_mapping(0x1015, [0x900, 0x1010, 0x1100], lambda ea: 0x1000 <= ea < 0x1080), 0x1010)
        self.assertIsNone(core.nearest_mapping(1, [0x900], lambda _: False))


unittest.main()
