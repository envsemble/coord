"""Disposable semantic fixtures for the read-only planning checker."""

import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_planning import parse_frontmatter, validate


class PlanningFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.work = self.root / "active/0001-example"
        self.work.mkdir(parents=True)
        self.plan = self.work / "plan.md"
        self.body = "# Useful plan\n\nPreserve this rationale and [evidence](evidence.txt).\n"
        (self.work / "evidence.txt").write_text("actual verification evidence\n", encoding="utf-8")
        self.header = {
            "schema_version": 1, "kind": "plan", "id": "work-0001",
            "title": "An example: preserves commas, quotes and detail",
            "repositories": ["example-app"], "created": None, "updated": "2026-10-06",
            "design_status": "accepted", "implementation_status": "unknown",
            "accepted_at": None, "completed_at": None, "supersedes": [], "superseded_by": None,
        }
        self.registry = {
            "schema_version": 1,
            "repositories": [{"id": "example-app", "name": "Example app", "path": "../app"}],
            "work_items": [{"id": "work-0001", "path": "active/0001-example", "repositories": ["example-app"], "current_plan": "active/0001-example/plan.md"}],
        }
        self.write()

    def write(self):
        self.plan.write_text("---\n" + "\n".join(key + ": " + json.dumps(value) for key, value in self.header.items()) + "\n---\n\n" + self.body, encoding="utf-8")
        (self.root / "planning.json").write_text(json.dumps(self.registry), encoding="utf-8")

    def test_normalized_fixture_and_read_only(self):
        def manifest():
            return {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in self.root.rglob("*") if path.is_file()}
        before = manifest()
        self.assertEqual(validate(self.root), ([], []))
        self.assertEqual(manifest(), before)

    def test_legacy_location_with_null_pointer(self):
        legacy = self.root / "legacy/old-notes"
        legacy.mkdir(parents=True)
        (legacy / "notes.md").write_text("Original unclassified record", encoding="utf-8")
        self.registry["work_items"].append({"id": "work-0002", "path": "legacy/old-notes", "repositories": [], "current_plan": None})
        self.write()
        errors, warnings = validate(self.root)
        self.assertFalse(errors)
        self.assertTrue(any("scope is unknown" in item for item in warnings))
        self.assertTrue(any("unidentified" in item for item in warnings))

    def test_single_legacy_plan_without_frontmatter(self):
        legacy = self.root / "old-plan.md"
        legacy.write_text("# Original legacy plan\nDo useful work.\n", encoding="utf-8")
        self.registry["work_items"].append({"id": "work-0002", "path": "old-plan.md", "repositories": ["example-app"], "current_plan": "old-plan.md"})
        self.write()
        errors, warnings = validate(self.root)
        self.assertFalse(errors)
        self.assertTrue(any("no frontmatter" in item for item in warnings))

    def test_duplicate_ids(self):
        self.registry["repositories"].append(copy.deepcopy(self.registry["repositories"][0]))
        self.registry["work_items"].append(copy.deepcopy(self.registry["work_items"][0]))
        self.write()
        errors, _ = validate(self.root)
        self.assertTrue(any("duplicate repository id" in item for item in errors))
        self.assertTrue(any("duplicate work id" in item for item in errors))

    def test_scope_mismatch(self):
        self.registry["repositories"].append({"id": "another-app", "name": "Another"})
        self.header["repositories"] = ["another-app"]
        self.write()
        self.assertTrue(any("scope disagrees" in item for item in validate(self.root)[0]))

    def test_pointer_and_path_containment(self):
        for value in ("../outside.md", "/absolute", "C:/outside.md", "active\\plan.md"):
            with self.subTest(value=value):
                self.registry["work_items"][0]["path"] = value
                self.write()
                self.assertTrue(validate(self.root)[0])

    def test_pointer_outside_own_work(self):
        other = self.root / "archive/other.md"
        other.parent.mkdir()
        other.write_text("Legacy plan", encoding="utf-8")
        self.registry["work_items"][0]["current_plan"] = "archive/other.md"
        self.write()
        self.assertTrue(any("outside its work item" in item for item in validate(self.root)[0]))

    def test_dates_and_completion_are_not_optimistic(self):
        self.header["created"] = "2026-02-30"
        self.header["completed_at"] = "2026-10-06"
        self.write()
        errors, _ = validate(self.root)
        self.assertTrue(any("created must be an ISO" in item for item in errors))
        self.assertTrue(any("requires complete" in item for item in errors))

    def test_explicit_id_and_unknown_scope_validation(self):
        self.header["id"] = "work-0099"
        self.header["repositories"] = ["unregistered"]
        self.write()
        errors, _ = validate(self.root)
        self.assertTrue(any("id disagrees" in item for item in errors))
        self.assertTrue(any("unknown repository" in item for item in errors))

    def test_metadata_plain_dates_block_lists_and_comments(self):
        text = "---\nschema_version: 1\ntitle: 'A title, with ''quotes''' # note\nupdated: 2026-10-06\nrepositories:\n  - example-app\nsupersedes: [] # none\n---\nFlexible body"
        parsed = parse_frontmatter(text)
        self.assertEqual(parsed["title"], "A title, with 'quotes'")
        self.assertEqual(parsed["updated"], "2026-10-06")
        self.assertEqual(parsed["repositories"], ["example-app"])
        self.assertEqual(parsed["supersedes"], [])

    def test_duplicate_metadata_not_silently_replaced(self):
        with self.assertRaisesRegex(ValueError, "duplicate metadata"):
            parse_frontmatter("---\nid: work-0001\nid: work-0002\n---\n")

    def test_supported_flow_lists_ignore_comment_brackets_and_trailing_comma(self):
        original = self.plan.read_text(encoding="utf-8")
        for value in ("[example-app] # compare [legacy]", "[example-app,]", "['example-app', ] # [legacy]"):
            with self.subTest(value=value):
                self.plan.write_text(original.replace('repositories: ["example-app"]', "repositories: " + value), encoding="utf-8")
                self.assertEqual(validate(self.root), ([], []))

    def test_flow_list_quoted_brackets_and_missing_uncommented_closing(self):
        parsed = parse_frontmatter('---\nrepositories: ["literal]bracket", \'other]value\',] # [comment]\n---\n')
        self.assertEqual(parsed["repositories"], ["literal]bracket", "other]value"])
        with self.assertRaisesRegex(ValueError, "closing delimiter"):
            parse_frontmatter("---\nrepositories: [example-app # comment ]\n---\n")

    def test_invalid_plain_title_mapping_delimiters_rejected(self):
        original = self.plan.read_text(encoding="utf-8")
        title_line = "title: " + json.dumps(self.header["title"])
        for value in ("Release: phase 2", "Release:\tphase 2", "Release:", "Release: # note"):
            with self.subTest(value=value):
                self.plan.write_text(original.replace(title_line, "title: " + value), encoding="utf-8")
                errors, _ = validate(self.root)
                self.assertTrue(any("invalid plain scalar mapping delimiter" in item for item in errors))

    def test_equivalent_quoted_titles_with_delimiters_accepted(self):
        original = self.plan.read_text(encoding="utf-8")
        title_line = "title: " + json.dumps(self.header["title"])
        for value in ('"Release: phase 2"', "'Release:'", "'it''s ready'", '"@release"', "'- release'", "'? release'", '"`release"'):
            with self.subTest(value=value):
                self.plan.write_text(original.replace(title_line, "title: " + value), encoding="utf-8")
                self.assertEqual(validate(self.root), ([], []))

    def test_valid_plain_title_colons_and_comments_remain_supported(self):
        original = self.plan.read_text(encoding="utf-8")
        title_line = "title: " + json.dumps(self.header["title"])
        for value, expected in (("Release:phase-2 # note", "Release:phase-2"), ("https://example.invalid/release # note", "https://example.invalid/release"), ("-release", "-release"), ("?release", "?release"), (":release", ":release")):
            with self.subTest(value=value):
                self.plan.write_text(original.replace(title_line, "title: " + value), encoding="utf-8")
                self.assertEqual(validate(self.root), ([], []))
                self.assertEqual(parse_frontmatter(self.plan.read_text(encoding="utf-8"))["title"], expected)

    def test_invalid_plain_leading_indicators_and_trailing_quoted_content(self):
        original = self.plan.read_text(encoding="utf-8")
        title_line = "title: " + json.dumps(self.header["title"])
        for value in ("'a' 'b'", "@release", "`release", "- release", "? release", "]release", "}release", ",release", "%release"):
            with self.subTest(value=value):
                self.plan.write_text(original.replace(title_line, "title: " + value), encoding="utf-8")
                self.assertTrue(validate(self.root)[0])

    def test_implicit_nonstring_titles_rejected_and_quoted_equivalents_accepted(self):
        original = self.plan.read_text(encoding="utf-8")
        title_line = "title: " + json.dumps(self.header["title"])
        variants = (
            "True", "FALSE", "TrUe", "yes", "NO", "On", "off", "y", "N",
            "Null", "NULL", "~", "1.5", "+12", "-2", "0b10", "0o10",
            "0123", "0xA", "1_000", "1e3", "1.0e+3", ".5", "1.",
            ".inf", "+.INF", "-.Inf", ".NaN", "1:20", "1:20.5",
            "2026-10-06", "2026-10-06T12:00:00Z", "2026-10-06 12:00:00+02:00",
        )
        for value in variants:
            with self.subTest(value=value):
                self.plan.write_text(original.replace(title_line, "title: " + value), encoding="utf-8")
                self.assertTrue(validate(self.root)[0], "implicit non-string title was certified")
                for quoted in (json.dumps(value), "'" + value + "'"):
                    self.plan.write_text(original.replace(title_line, "title: " + quoted), encoding="utf-8")
                    self.assertEqual(validate(self.root), ([], []))

    def test_ordinary_plain_titles_not_mistaken_for_implicit_types(self):
        original = self.plan.read_text(encoding="utf-8")
        title_line = "title: " + json.dumps(self.header["title"])
        for value in ("1st release", "v1.5", "1.5 release", "Release on Tuesday", "nothing null", "True story", "nullish", "2026-10-06 release"):
            with self.subTest(value=value):
                self.plan.write_text(original.replace(title_line, "title: " + value), encoding="utf-8")
                self.assertEqual(validate(self.root), ([], []))
                self.assertEqual(parse_frontmatter(self.plan.read_text(encoding="utf-8"))["title"], value)

    def test_implicit_typing_applies_to_flow_and_block_string_lists(self):
        self.registry["repositories"] = [{"id": "yes", "name": "Yes repository"}]
        self.registry["work_items"][0]["repositories"] = ["yes"]
        self.header["repositories"] = ["yes"]
        self.write()
        original = self.plan.read_text(encoding="utf-8")
        for raw, quoted in (("[yes]", "['yes']"), ("\n  - yes", "\n  - 'yes'")):
            with self.subTest(raw=raw):
                self.plan.write_text(original.replace('repositories: ["yes"]', "repositories: " + raw), encoding="utf-8")
                self.assertTrue(validate(self.root)[0])
                self.plan.write_text(original.replace('repositories: ["yes"]', "repositories: " + quoted), encoding="utf-8")
                self.assertEqual(validate(self.root), ([], []))

    def test_null_like_trailing_flow_content_is_not_a_comment(self):
        original = self.plan.read_text(encoding="utf-8")
        for value in ("null", "Null", "~"):
            with self.subTest(value=value):
                self.plan.write_text(original.replace('repositories: ["example-app"]', 'repositories: ["example-app"] ' + value), encoding="utf-8")
                self.assertTrue(any("unexpected content after flow list" in item for item in validate(self.root)[0]))

    def test_plain_iso_date_compatibility_is_scoped_to_date_fields(self):
        self.header.update(created="2026-10-06", accepted_at="2026-10-06", completed_at="2026-10-06", implementation_status="complete")
        self.write()
        content = self.plan.read_text(encoding="utf-8")
        for field in ("created", "updated", "accepted_at", "completed_at"):
            content = content.replace(field + ': "2026-10-06"', field + ": 2026-10-06")
        self.plan.write_text(content, encoding="utf-8")
        self.assertEqual(validate(self.root), ([], []))
        for field in ("created", "updated", "accepted_at", "completed_at"):
            self.assertEqual(parse_frontmatter(content)[field], "2026-10-06")
        for value in ("Null", "NULL", "~"):
            self.plan.write_text(content.replace("created: 2026-10-06", "created: " + value), encoding="utf-8")
            self.assertEqual(validate(self.root), ([], []))
            self.assertIsNone(parse_frontmatter(self.plan.read_text(encoding="utf-8"))["created"])

    @unittest.skipUnless(shutil.which("git"), "Git unavailable for recovery fixture")
    def test_actual_git_baseline_recovery_after_move(self):
        def git(*args):
            return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True).stdout
        git("init")
        # Exercise the supplied raw capture policy against inherited conversion.
        git("config", "core.autocrlf", "true")
        attributes = Path(__file__).resolve().parents[2] / "assets/planning/.gitattributes"
        (self.root / ".gitattributes").write_bytes(attributes.read_bytes())
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Retain baseline")
        originals = {"plan.md": self.plan.read_bytes(), "evidence.txt": (self.work / "evidence.txt").read_bytes()}
        archived = self.root / "archive/0001-example"
        archived.parent.mkdir()
        self.work.rename(archived)
        self.registry["work_items"][0].update(path="archive/0001-example", current_plan="archive/0001-example/plan.md")
        (self.root / "planning.json").write_text(json.dumps(self.registry), encoding="utf-8")
        self.assertFalse(validate(self.root)[0])
        for name, content in originals.items():
            self.assertEqual((archived / name).read_bytes(), content)
            # Restore into a distinct fixture path from the actual Git object.
            recovered = self.root / ("recovered-" + name)
            recovered.write_bytes(git("show", "HEAD:active/0001-example/" + name))
            self.assertEqual(recovered.read_bytes(), content)
        clone = self.root / "restore-check"
        subprocess.run(["git", "-c", "core.autocrlf=true", "clone", "--no-hardlinks", str(self.root), str(clone)], check=True, capture_output=True)
        for name, content in originals.items():
            self.assertEqual((clone / "active/0001-example" / name).read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
