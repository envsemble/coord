import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

helper = Path(__file__).parents[1] / "log_consultation.py"
spec = importlib.util.spec_from_file_location("log_consultation", helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ConsultationTests(unittest.TestCase):
    def test_distinct_unicode_hardlink_names_do_not_establish_normalization_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            retained = "cafe\u0301.md"
            composed = "caf\u00e9.md"
            (root / retained).write_text("Original retained record\n", encoding="utf-8")
            if module.filesystem_normalizes_unicode(root, [retained]):
                self.skipTest("Filesystem resolves these names as one entry")
            os.link(root / retained, root / composed)
            self.assertFalse(module.filesystem_normalizes_unicode(root, [retained]))

    def test_unicode_work_keys_and_nested_ownership_use_retained_path_segments(self):
        parent = "active/" + "e\u0301" * 12
        composed = "active/" + "\u00e9" * 12
        registry = {"work_items": [{"id": "work-0001", "path": parent}, {"id": "work-0002", "path": composed + "/child"}]}
        self.assertEqual(module.document_identity(composed + "/plan.md", registry, True, True), "work-0001:plan.md")
        self.assertEqual(module.document_identity(parent + "/child/note.md", registry, True, True), "work-0002:note.md")

    def test_unicode_registry_aliases_keep_work_scope_without_merging_distinct_folders(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            retained = "active/cafe\u0301"
            composed = "active/caf\u00e9"
            (root / retained).mkdir(parents=True)
            (root / retained / "plan.md").write_text("Original plan\n", encoding="utf-8")
            equivalent = module.filesystem_normalizes_unicode(root, [retained + "/plan.md"])
            selected = composed if equivalent else retained
            entries = [{"id": "work-0001", "path": selected, "current_plan": selected + "/plan.md"}]
            files = [retained + "/plan.md"]
            if not equivalent:
                (root / composed).mkdir()
                (root / composed / "plan.md").write_text("Another distinct plan\n", encoding="utf-8")
                entries.append({"id": "work-0002", "path": composed, "current_plan": composed + "/plan.md"})
                files.append(composed + "/plan.md")
            (root / "planning.json").write_text(json.dumps({"schema_version": 1, "work_items": entries}), encoding="utf-8")
            destination = Path(directory) / "metrics"
            self.assertEqual(module.report(root, files, destination=destination), (len(entries), 0))
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                self.assertEqual(db.execute("SELECT document_key FROM events ORDER BY document_key").fetchall(), [(entry["id"] + ":plan.md",) for entry in entries])

    def test_native_normalization_alias_retains_original_document_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            work = root / "active/0001-example"
            work.mkdir(parents=True)
            name = "cafe\u0301.md"
            original = work / name
            original.write_text("Original Unicode filename\n", encoding="utf-8")
            supplied = work / "caf\u00e9.md"
            if not supplied.exists() or not supplied.samefile(original):
                self.skipTest("Connected filesystem does not resolve Unicode normalization aliases")
            retained = next(path.name for path in work.iterdir())
            registry = {"schema_version": 1, "work_items": [{"id": "work-0001", "path": "active/0001-example"}]}
            (root / "planning.json").write_text(json.dumps(registry), encoding="utf-8")
            destination = Path(directory) / "metrics"
            self.assertEqual(module.report(root, ["active/0001-example/caf\u00e9.md"], destination=destination), (1, 0))
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                self.assertEqual(db.execute("SELECT document_key, path FROM events").fetchone(), ("work-0001:" + retained, "active/0001-example/" + retained))
            self.assertEqual(original.read_text(encoding="utf-8"), "Original Unicode filename\n")

    def test_ambiguous_registry_locations_never_write_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            root.mkdir()
            (root / "note.md").write_text("Original note\n", encoding="utf-8")
            original = (root / "note.md").read_bytes()
            destination = Path(directory) / "metrics"
            item = {"id": "work-0001", "path": "note.md", "current_plan": "note.md"}
            def reject(items, message):
                (root / "planning.json").write_text(json.dumps({"schema_version": 1, "work_items": items}), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    module.report(root, ["note.md"], destination=destination)
                self.assertFalse(destination.exists())
            for location in ["old/../note.md", "legacy\\note.md", "/note.md", "C:/note.md", "./C:note.md", "./C:/note.md"]:
                reject([{**item, "path": location}], "POSIX-relative")
            reject([{**item, "current_plan": "old/../note.md"}], "POSIX-relative")
            reject([item, {**item, "id": "work-0002"}], "Duplicate")
            reject([item, {**item, "id": "work-0002", "path": ".//note.md/"}], "Duplicate")
            reject([item, {**item, "path": "other.md", "current_plan": "other.md"}], "Duplicate")
            reject([item, {**item, "id": "work-0002", "path": "other.md"}], "Conflicting selected plan")
            for identity in ["root", "work-1", "Work-0001", "", "work-0001:shadow"]:
                reject([{**item, "id": identity}], "Invalid planning work identities")
            if not module.filesystem_case_sensitive(root):
                reject([item, {**item, "id": "work-0002", "path": "Note.md", "current_plan": "Note.md"}], "Duplicate")
            for location in ["./note.md", ".//note.md", "note.md/"]:
                registry_file = root / "planning.json"
                registry_file.write_text(json.dumps({"schema_version": 1, "work_items": [{**item, "path": location, "current_plan": "./note.md"}]}), encoding="utf-8")
                registry_bytes = registry_file.read_bytes()
                self.assertEqual(module.report(root, ["note.md"], destination=destination), (1, 0))
                self.assertEqual(registry_file.read_bytes(), registry_bytes)
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                self.assertEqual(db.execute("SELECT DISTINCT document_key FROM events").fetchall(), [("work-0001:note.md",)])
            self.assertEqual((root / "note.md").read_bytes(), original)

    def test_selected_plans_precede_nested_locations_with_directory_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            parent = root / "active/0001-parent"
            child = parent / "nested"
            child.mkdir(parents=True)
            (child / "parent-plan.md").write_text("Parent plan\n", encoding="utf-8")
            (child / "child-plan.md").write_text("Child plan\n", encoding="utf-8")
            (parent / "note.md").write_text("Parent note\n", encoding="utf-8")
            (child / "note.md").write_text("Child note\n", encoding="utf-8")
            items = [{"id": "work-0001", "path": "active/0001-parent", "current_plan": "active/0001-parent/nested/parent-plan.md"}, {"id": "work-0002", "path": "active/0001-parent/nested", "current_plan": "active/0001-parent/nested/child-plan.md"}]
            destination = Path(directory) / "metrics"
            for ordering in [items, list(reversed(items))]:
                (root / "planning.json").write_text(json.dumps({"schema_version": 1, "work_items": ordering}), encoding="utf-8")
                self.assertEqual(module.report(root, ["active/0001-parent/nested/parent-plan.md", "active/0001-parent/nested/child-plan.md", "active/0001-parent/note.md", "active/0001-parent/nested/note.md"], destination=destination), (4, 0))
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                self.assertEqual(db.execute("SELECT DISTINCT document_key FROM events ORDER BY document_key").fetchall(), [("work-0001:nested/parent-plan.md",), ("work-0001:note.md",), ("work-0002:child-plan.md",), ("work-0002:note.md",)])

    def test_case_insensitive_registry_casing_preserves_work_document_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            work = root / "active/0001-example"
            work.mkdir(parents=True)
            document = work / "Plan.md"
            document.write_text("Original selected plan\n", encoding="utf-8")
            original = document.read_bytes()
            (root / "legacy.md").write_text("Legacy plan\n", encoding="utf-8")
            registry = {"schema_version": 1, "work_items": [{"id": "work-0001", "path": "ACTIVE/0001-EXAMPLE", "current_plan": "Active/0001-Example/pLAN.md"}, {"id": "work-0002", "path": "LEGACY.MD", "current_plan": "Legacy.md"}]}
            registry_file = root / "planning.json"
            registry_file.write_text(json.dumps(registry), encoding="utf-8")
            if module.filesystem_case_sensitive(root):
                self.skipTest("Connected filesystem is case-sensitive")
            registry_bytes = registry_file.read_bytes()
            destination = Path(directory) / "metrics"
            self.assertEqual(module.report(root, ["active/0001-example/Plan.md", "ACTIVE/0001-EXAMPLE/plan.md", str(document).upper(), "LEGACY.MD"], destination=destination), (2, 0))
            self.assertEqual(module.data_directory(root, destination), module.data_directory(root.parent / "PLANNING", destination))
            with self.assertRaisesRegex(ValueError, "outside the planning folder"):
                module.cache_outside_planning(root, root.parent / "PLANNING" / "cache")
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                self.assertEqual(db.execute("SELECT document_key FROM events ORDER BY document_key").fetchall(), [("work-0001:Plan.md",), ("work-0002:legacy.md",)])
            self.assertEqual(registry_file.read_bytes(), registry_bytes)
            self.assertEqual(document.read_bytes(), original)

    def test_closed_dashboard_collection_and_unknown_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            root.mkdir()
            (root / "planning.json").write_text(json.dumps({"schema_version": 1, "work_items": []}), encoding="utf-8")
            (root / "note.md").write_text("# Original note\n", encoding="utf-8")
            original = (root / "note.md").read_bytes()
            destination = Path(directory) / "metrics"
            self.assertEqual(module.report(root, ["note.md", "note.md"], destination=destination), (1, 0))
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                row = db.execute("SELECT source, document_key, task_id, session_id, content_hash FROM events").fetchone()
            self.assertEqual(row[:4], ("agent_report", "root:note.md", None, None))
            self.assertEqual(len(row[4]), 64)
            self.assertEqual((root / "note.md").read_bytes(), original)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["note.md", "planning.json"])
            with self.assertRaisesRegex(ValueError, "outside the planning folder"):
                module.report(root, ["note.md"], destination=root / "cache")
            module.record_collection_gap(root, root / "cache")
            self.assertFalse((root / "cache").exists())

    def test_archive_identity_preservation_and_rejected_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "planning"
            work = root / "active/0001-example"
            work.mkdir(parents=True)
            document = work / "plan.md"
            document.write_text("Planned work\n", encoding="utf-8")
            registry = {"schema_version": 1, "work_items": [{"id": "work-0001", "path": "active/0001-example"}]}
            (root / "planning.json").write_text(json.dumps(registry), encoding="utf-8")
            outside = Path(directory) / "outside.md"
            outside.write_text("Outside scope\n", encoding="utf-8")
            destination = Path(directory) / "metrics"
            self.assertEqual(module.report(root, ["active/0001-example/plan.md", "../outside.md"], "work-0001", destination=destination), (1, 1))
            target = root / "archive/0001-example"
            target.parent.mkdir()
            work.rename(target)
            registry["work_items"][0]["path"] = "archive/0001-example"
            (root / "planning.json").write_text(json.dumps(registry), encoding="utf-8")
            self.assertEqual(module.report(root, ["archive/0001-example/plan.md"], "work-0001", destination=destination), (1, 0))
            with closing(sqlite3.connect(module.data_directory(root, destination) / "usage.sqlite")) as db:
                keys = db.execute("SELECT DISTINCT document_key FROM events").fetchall()
                failures = db.execute("SELECT count(*) FROM failures").fetchone()[0]
            self.assertEqual(keys, [("work-0001:plan.md",)])
            self.assertEqual(failures, 1)
