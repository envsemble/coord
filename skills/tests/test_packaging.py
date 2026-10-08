"""Validate portable skill packaging and invocation boundaries."""

import re
import unittest
from pathlib import Path

import yaml


GROUP = Path(__file__).resolve().parents[1]


class PackagingTests(unittest.TestCase):
    def test_public_skills_and_invocation_policy(self):
        expected = {
            "planning-bootstrap", "planning-organize", "planning-grill",
            "planning-implement", "planning-record", "babysit-pr",
            "atlas-modeling",
        }
        skills = {p.name: p for p in GROUP.iterdir() if (p / "SKILL.md").is_file()}
        self.assertEqual(set(skills), expected)
        for name, path in skills.items():
            with self.subTest(skill=name):
                text = (path / "SKILL.md").read_text(encoding="utf-8")
                header = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
                self.assertIsNotNone(header)
                meta = yaml.safe_load(header.group(1))
                self.assertEqual(meta["name"], name)
                self.assertTrue(isinstance(meta["description"], str) and meta["description"].strip())
                policy_file = path / "agents" / "openai.yaml"
                policy = yaml.safe_load(policy_file.read_text(encoding="utf-8")) if policy_file.exists() else {}
                implicit = policy.get("policy", {}).get("allow_implicit_invocation", True)
                self.assertEqual(implicit, name not in {"planning-implement", "babysit-pr"})

    def test_instruction_resource_links_exist(self):
        for path in GROUP.rglob("*.md"):
            if "assets" in path.parts or "tests" in path.parts:
                continue
            text = re.sub(r"```.*?```", "", path.read_text(encoding="utf-8"), flags=re.S)
            for target in re.findall(r"\]\(([^)]+)\)", text):
                if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                    continue
                local = target.split("#", 1)[0]
                with self.subTest(file=path.relative_to(GROUP), target=target):
                    self.assertTrue((path.parent / local).exists(), f"Missing resource: {target}")

    def test_retired_implementation_entrypoint_is_not_active(self):
        self.assertFalse((GROUP.parent / "implement-plan").exists())
        self.assertFalse((GROUP.parent / "babysit-pr").exists())


if __name__ == "__main__":
    unittest.main()
