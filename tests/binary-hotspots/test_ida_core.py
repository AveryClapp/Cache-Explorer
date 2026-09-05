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
FIXTURE_PATH = Path(sys.argv.pop())
FIXTURE = json.loads(FIXTURE_PATH.read_text())


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

    def test_codeview_against_ghidra_identity(self):
        image = FIXTURE_PATH.with_name('fixture.exe')
        codeview = json.loads(FIXTURE_PATH.with_name('ghidra-codeview.json').read_text())
        digest = FIXTURE['images'][0]['sha256']
        core.verify_codeview(image, digest, codeview)
        with self.assertRaisesRegex(ValueError, 'GUID/age mismatch'):
            core.verify_codeview(image, digest, {**codeview, 'age': codeview['age'] + 1})
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            core.verify_codeview(image, 'f' * 64, codeview)

    def test_annotation_refresh_reload_rebase_and_clear(self):
        digest = FIXTURE['images'][0]['sha256']
        comments = {0x401015: 'user note', 0x401021: 'keep too'}
        state = b''

        def save(data):
            nonlocal state
            state = data
            return True

        def write(ea, comment):
            comments[ea] = comment
            return True

        def refresh(notes, base=0x400000):
            core.refresh_annotations(state, digest, base, notes, comments.get, write, save)

        refresh({0x1015: 'first', 0x1021: 'second'})
        # A fresh call reads only persisted state; filtered/empty imports remove stale metrics.
        refresh({0x1021: 'new model'})
        self.assertEqual(comments[0x401015], 'user note')
        self.assertNotIn('second', comments[0x401021])
        comments = {ea + 0x310000: text for ea, text in comments.items()}
        refresh({}, 0x710000)
        self.assertEqual(comments, {0x711015: 'user note', 0x711021: 'keep too'})
        self.assertEqual(json.loads(state)['rvas'], [])

    def test_annotation_failure_retains_cleanup_ownership(self):
        digest = FIXTURE['images'][0]['sha256']
        saved = []
        comments = {}

        def write(ea, comment):
            if ea == 0x401021:
                return False
            comments[ea] = comment
            return True

        with self.assertRaisesRegex(RuntimeError, 'instruction comment'):
            core.refresh_annotations(None, digest, 0x400000, {0x1015: 'one', 0x1021: 'two'}, comments.get, write, lambda data: saved.append(data) or True)
        self.assertEqual(json.loads(saved[-1])['rvas'], [0x1015, 0x1021])
        core.refresh_annotations(saved[-1], digest, 0x400000, {}, comments.get, write, lambda data: saved.append(data) or True)
        self.assertEqual(comments[0x401015], '')
        with self.assertRaisesRegex(ValueError, 'mismatched'):
            core.refresh_annotations(saved[-1], 'f' * 64, 0x400000, {}, comments.get, write, lambda _: self.fail('Unexpected write'))
        with self.assertRaisesRegex(ValueError, 'overflows'):
            core.refresh_annotations(None, digest, 0x400000, {-1: 'invalid'}, comments.get, write, lambda _: self.fail('Unexpected write'))


unittest.main()
