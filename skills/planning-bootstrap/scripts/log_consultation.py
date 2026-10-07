#!/usr/bin/env python3
"""Record reported planning-document consultation without requiring a running UI."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import sqlite3
import subprocess
import sys
import unicodedata
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
  document_key TEXT NOT NULL, path TEXT NOT NULL, task_id TEXT, session_id TEXT,
  timestamp TEXT NOT NULL, revision TEXT, content_hash TEXT);
CREATE INDEX IF NOT EXISTS event_document ON events(document_key);
CREATE TABLE IF NOT EXISTS failures (timestamp TEXT NOT NULL, detail TEXT NOT NULL);
"""

def filesystem_case_sensitive(root: Path) -> bool:
    """Read-only detection for the connected filesystem, including macOS volumes."""
    def probe(directory: Path, names: list[str]) -> bool | None:
        for name in names:
            alternate = re.sub(r"[a-zA-Z]", lambda match: match[0].swapcase(), name, count=1)
            if alternate == name:
                continue
            if alternate in names:
                return True
            try:
                original, other = (directory / name).lstat(), (directory / alternate).lstat()
                return (original.st_dev, original.st_ino) != (other.st_dev, other.st_ino)
            except FileNotFoundError:
                return True
            except OSError:
                continue
        return None
    try:
        result = probe(root, os.listdir(root))
        if result is not None:
            return result
        names = os.listdir(root.parent)
        if root.name in names:
            result = probe(root.parent, [root.name] + [name for name in names if name != root.name])
            if result is not None:
                return result
    except OSError:
        pass
    return True

def retained_relative(actual: Path, root: Path, case_sensitive: bool) -> str:
    original, parent = actual.parts, root.parts
    if len(original) <= len(parent) or not Path(*original[:len(parent)]).samefile(root):
        raise ValueError("Document is outside the planning folder")
    parts = list(original[len(parent):])
    # POSIX resolution can preserve a supplied spelling even when the filesystem
    # accepts a case or Unicode-normalization alias. Verify candidate identities;
    # normalization alone must never equate distinct files on another volume.
    def comparable(name: str) -> str:
        normalized = unicodedata.normalize("NFC", name)
        return normalized if case_sensitive else normalized.lower()
    directory = root
    for index, part in enumerate(parts):
        names = os.listdir(directory)
        spelling = part if part in names else next((name for name in names
            if comparable(name) == comparable(part) and (directory / name).samefile(directory / part)), None)
        if spelling is None:
            raise ValueError("Document entry is no longer available")
        parts[index] = spelling
        directory = directory / spelling
    return PurePosixPath(*parts).as_posix()

def data_directory(root: Path, base: Path | None = None) -> Path:
    override = base or os.environ.get("PLANNING_DASHBOARD_DATA_DIR")
    normalized = str(root.expanduser().resolve()).replace("\\", "/")
    if not filesystem_case_sensitive(root.expanduser().resolve()):
        normalized = normalized.lower()
    identity = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    cache_base = Path(override).expanduser().resolve() if override else Path.home() / ".cache" / "planning-dashboard"
    return cache_base / identity

def document_identity(relative: str, registry: dict, case_sensitive: bool = True) -> str:
    normalize = (lambda value: value) if case_sensitive else str.lower
    identity = normalize(relative)
    matches = [work for work in registry.get("work_items", [])
               if identity == normalize(work["path"])
               or identity.startswith(normalize(work["path"]) + "/")]
    selected = [work for work in matches if work.get("current_plan") is not None
                and normalize(work["current_plan"]) == identity]
    work = selected[0] if selected else max(matches, key=lambda item: len(item["path"]), default=None)
    if work:
        location = work["path"]
        return work["id"] + ":" + (Path(relative).name if identity == normalize(location) else relative[len(location) + 1:])
    return "root:" + relative

def normalized_location(value: object) -> str:
    if (not isinstance(value, str) or not value or "\\" in value or "\0" in value or ":" in value
            or value.startswith("/") or re.match(r"^[a-z]:", value, re.I) or ".." in value.split("/")):
        raise ValueError("Work and selected plan paths must be POSIX-relative paths without parent segments")
    normalized = str(PurePosixPath(value))
    if normalized.startswith("/") or re.match(r"^[a-z]:", normalized, re.I):
        raise ValueError("Work and selected plan paths must be POSIX-relative paths without drive syntax")
    if normalized == ".":
        raise ValueError("A work or plan path must identify a record inside the planning folder")
    return normalized

def cache_outside_planning(root: Path, destination: Path) -> Path:
    destination = destination.expanduser().resolve()
    planning = root.expanduser().resolve()
    normalize = (lambda value: value) if filesystem_case_sensitive(planning) else str.lower
    if tuple(map(normalize, destination.parts[:len(planning.parts)])) == tuple(map(normalize, planning.parts)):
        raise ValueError("Choose statistics storage outside the planning folder")
    return destination

def record_collection_gap(root: Path, destination: Path) -> None:
    """Keep a coverage signal when the shared database cannot accept a write."""
    try:
        destination = cache_outside_planning(root, destination)
        destination.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        with (destination / "collection-gaps.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"source": "agent_report", "timestamp": timestamp}) + "\n")
    except (OSError, ValueError):
        pass  # A wholly unavailable cache cannot retain its own failure; main still discloses it.

def report(root: Path, files: list[str], task: str | None = None,
           session: str | None = None, destination: Path | None = None) -> tuple[int, int]:
    root = root.expanduser().resolve(strict=True)
    case_sensitive = filesystem_case_sensitive(root)
    normalize = (lambda value: value) if case_sensitive else str.lower
    registry = json.loads((root / "planning.json").read_text(encoding="utf-8-sig"))
    if not isinstance(registry, dict) or registry.get("schema_version") != 1:
        raise ValueError("Unrecognized planning registry")
    if not isinstance(registry.get("work_items"), list) or any(
        not isinstance(work, dict) or not isinstance(work.get("id"), str) or not re.fullmatch(r"work-[0-9]{4,}", work["id"])
        or not isinstance(work.get("path"), str) for work in registry["work_items"]
    ):
        raise ValueError("Invalid planning work identities")
    identities: set[str] = set()
    locations: set[str] = set()
    selected_plans: set[str] = set()
    for work in registry["work_items"]:
        location = normalized_location(work["path"])
        work["path"] = location
        identity = normalize(location)
        if work["id"] in identities or identity in locations:
            raise ValueError("Duplicate planning work identity or retained location")
        if work.get("current_plan") is not None:
            work["current_plan"] = normalized_location(work["current_plan"])
            selected = normalize(work["current_plan"])
            if selected in selected_plans:
                raise ValueError("Conflicting selected plan pointers")
            selected_plans.add(selected)
        identities.add(work["id"])
        locations.add(identity)
    destination = cache_outside_planning(root, data_directory(root, destination))
    destination.mkdir(parents=True, exist_ok=True)
    revision = None
    try:
        top = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=3, check=True)
        if tuple(map(normalize, Path(top.stdout.strip()).resolve().parts)) == tuple(map(normalize, root.parts)):
            result = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                                    capture_output=True, text=True, timeout=3, check=True)
            revision = result.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        pass
    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    recorded = failed = 0
    seen = set()
    connection = sqlite3.connect(destination / "usage.sqlite", timeout=2)
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
        with connection:
            connection.execute("INSERT OR IGNORE INTO metadata VALUES (?, ?)", ("agent_since", timestamp))
            for supplied in files:
                try:
                    candidate = Path(supplied)
                    if not candidate.is_absolute():
                        candidate = root / candidate
                    actual = candidate.resolve(strict=True)
                    relative = retained_relative(actual, root, case_sensitive)
                    if (not actual.is_file() or any(
                        part.startswith(".") or part in {"node_modules", "__pycache__", "dist", "build"}
                        for part in Path(relative).parts)):
                        raise ValueError("Unreadable planning document")
                    if relative in seen:
                        continue
                    seen.add(relative)
                    digest = hashlib.sha256()
                    with actual.open("rb") as source:
                        for block in iter(lambda: source.read(65536), b""):
                            digest.update(block)
                    connection.execute(
                        "INSERT INTO events (id, source, document_key, path, task_id, session_id, timestamp, revision, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), "agent_report", document_identity(relative, registry, case_sensitive),
                         relative, task or None, session or None, timestamp, revision, digest.hexdigest()))
                    recorded += 1
                except (OSError, ValueError):
                    connection.execute("INSERT INTO failures VALUES (?, ?)",
                                       (timestamp, "A requested consultation could not be recorded."))
                    failed += 1
    finally:
        connection.close()
    return recorded, failed

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("planning_root", type=Path)
    parser.add_argument("--files", nargs="+", required=True)
    parser.add_argument("--task", help="Known work/task identity; omit when unknown.")
    parser.add_argument("--session", help="Known chat/session identity; omit when unknown.")
    parser.add_argument("--data-dir", type=Path, help="Optional statistics cache base; the planning-root hash is appended.")
    arguments = parser.parse_args()
    try:
        recorded, failed = report(arguments.planning_root, arguments.files,
                                  arguments.task, arguments.session, arguments.data_dir)
        print(json.dumps({"reported_documents": recorded, "unrecorded_documents": failed}))
        if failed:
            print("Some usage reports were not recorded; continue the task.", file=sys.stderr)
    except (OSError, ValueError, sqlite3.Error) as error:
        record_collection_gap(arguments.planning_root, data_directory(arguments.planning_root, arguments.data_dir))
        print("Planning usage logging unavailable (" + type(error).__name__ + "); continue the task.", file=sys.stderr)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
