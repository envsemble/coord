import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

helper = Path(__file__).parents[1] / "log_consultation.py"
spec = importlib.util.spec_from_file_location("log_consultation", helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ConsultationTests(unittest.TestCase):
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
