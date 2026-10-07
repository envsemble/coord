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

def data_directory(root: Path, base: Path | None = None) -> Path:
    override = base or os.environ.get("PLANNING_DASHBOARD_DATA_DIR")
    normalized = str(root.expanduser().resolve()).replace("\\", "/")
    if os.name == "nt":
        normalized = normalized.lower()
    identity = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    cache_base = Path(override).expanduser().resolve() if override else Path.home() / ".cache" / "planning-dashboard"
    return cache_base / identity

def document_identity(relative: str, registry: dict) -> str:
    matches = [work for work in registry.get("work_items", [])
               if relative == work["path"] or relative.startswith(work["path"] + "/")]
    selected = [work for work in matches if work.get("current_plan") == relative]
    work = selected[0] if selected else max(matches, key=lambda item: len(item["path"]), default=None)
    if work:
        location = work["path"]
        return work["id"] + ":" + (Path(relative).name if relative == location else relative[len(location) + 1:])
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
    if destination.is_relative_to(root.expanduser().resolve()):
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
        identity = location.lower() if os.name == "nt" else location
        if work["id"] in identities or identity in locations:
            raise ValueError("Duplicate planning work identity or retained location")
        if work.get("current_plan") is not None:
            work["current_plan"] = normalized_location(work["current_plan"])
            selected = work["current_plan"].lower() if os.name == "nt" else work["current_plan"]
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
        if Path(top.stdout.strip()).resolve() == root:
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
                    relative = actual.relative_to(root).as_posix()
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
                        (str(uuid.uuid4()), "agent_report", document_identity(relative, registry),
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
