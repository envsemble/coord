#!/usr/bin/env python3
"""Read-only validation for planning registry v1 and flat plan metadata.

Uses stdlib only. Accepts the contract's plain/quoted scalars and flow/block
lists; this is deliberately not a general YAML parser or migration tool.
Quote string values that resemble implicit YAML booleans, nulls, numbers, or
timestamps. Plain ISO dates remain compatible only in the contract's date fields.
"""

from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path, PurePosixPath
import re
import sys


PLAN_FIELDS = {
    "schema_version", "kind", "id", "title", "repositories", "created",
    "updated", "design_status", "implementation_status", "accepted_at",
    "completed_at", "supersedes", "superseded_by",
}
REPO_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
WORK_ID = re.compile(r"work-[0-9]{4,}\Z")
DESIGN = {"draft", "accepted", "superseded", "abandoned"}
IMPLEMENTATION = {"unknown", "not_started", "in_progress", "partial", "complete"}
DATE_FIELDS = {"created", "updated", "accepted_at", "completed_at"}
# Conservatively cover implicit numeric spellings across YAML 1.1 and 1.2,
# rather than treating resolver differences as evidence of a string value.
IMPLICIT_NUMBER = re.compile(
    r"[+-]?(?:"
    r"0[bBoOxX][0-9a-fA-F_]+|"
    r"[0-9][0-9_]*(?::[0-9][0-9_]*)+(?:\.[0-9_]*)?|"
    r"(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:[eE][+-]?[0-9_]+)?|"
    r"\.(?:inf|nan))\Z",
    re.IGNORECASE,
)


def _split_flow(value: str, split_commas: bool = True) -> list[str]:
    """Split a flow sequence or remove a plain scalar comment outside quotes."""
    parts, start, quote, index = [], 0, None, 0
    while index < len(value):
        char = value[index]
        if quote:
            if quote == '"' and char == "\\":
                index += 2
                continue
            if char == quote:
                if quote == "'" and index + 1 < len(value) and value[index + 1] == "'":
                    index += 2
                    continue
                quote = None
        elif char in "\"'" and (index == start or value[start:index].isspace()):
            quote = char
        elif char == "," and split_commas:
            parts.append(value[start:index].strip())
            start = index + 1
        elif char == "#" and (index == 0 or value[index - 1].isspace()):
            value = value[:index]
            break
        index += 1
    if quote:
        raise ValueError("unterminated quoted scalar")
    parts.append(value[start:].strip())
    return parts


def _scalar(value: str, allow_date: bool = False):
    value = _split_flow(value, split_commas=False)[0].strip()
    if value.startswith('"'):
        parsed = json.loads(value)
        if not isinstance(parsed, str):
            raise ValueError("expected quoted string")
        return parsed
    if value.startswith("'"):
        if not re.fullmatch(r"'(?:[^']|'')*'", value):
            raise ValueError("invalid single-quoted scalar")
        return value[1:-1].replace("''", "'")
    lowered = value.lower()
    if lowered in {"null", "~", ""}:
        return None
    if lowered in {"true", "false", "yes", "no", "on", "off", "y", "n"}:
        return lowered in {"true", "yes", "on", "y"}
    if re.fullmatch(r"[+-]?[0-9]+", value):
        return int(value)
    plain_date = re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)
    if plain_date and allow_date:
        return value
    if (IMPLICIT_NUMBER.fullmatch(value) or plain_date
            or re.match(r"[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \t]+)[0-9]", value)):
        raise ValueError("ambiguous implicit YAML scalar; quote intended strings")
    if value.startswith(("{", "&", "*", "!", "|", ">")):
        raise ValueError("unsupported structured YAML; metadata uses scalars and lists")
    if re.search(r":(?=[ \t]|$)", value):
        raise ValueError("invalid plain scalar mapping delimiter; quote the string")
    if re.match(r"^(?:[@`,\]}%]|[-?](?:[ \t]|$))", value):
        raise ValueError("invalid plain scalar leading indicator; quote the string")
    return value


def _flow_list(value: str) -> list:
    """Find the closing bracket outside scalar quotes and YAML comments."""
    quote, start, index = None, 1, 1
    while index < len(value):
        char = value[index]
        if quote:
            if quote == '"' and char == "\\":
                index += 2
                continue
            if char == quote:
                if quote == "'" and index + 1 < len(value) and value[index + 1] == "'":
                    index += 2
                    continue
                quote = None
        elif char in "\"'" and (index == start or value[start:index].isspace()):
            quote = char
        elif char == ",":
            start = index + 1
        elif char == "#" and (index == 0 or value[index - 1].isspace()):
            break
        elif char == "]":
            if _split_flow(value[index + 1:], split_commas=False)[0].strip():
                raise ValueError("unexpected content after flow list")
            contents = value[1:index].strip()
            if not contents:
                return []
            parts = _split_flow(contents)
            # YAML flow lists permit a trailing comma; it is not a null item.
            if contents.endswith(","):
                parts.pop()
            return [_scalar(part) for part in parts]
        index += 1
    raise ValueError("missing flow list closing delimiter outside quotes/comments")


def parse_frontmatter(text: str) -> dict | None:
    lines = text.lstrip("\ufeff").splitlines()
    if not lines or lines[0] != "---":
        return None
    try:
        end = lines.index("---", 1)
    except ValueError as error:
        raise ValueError("missing frontmatter closing delimiter") from error
    fields, block_key = {}, None
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = re.fullmatch(r"\s*-\s+(.+)", line)
        if item and block_key:
            fields[block_key].append(_scalar(item.group(1)))
            continue
        match = re.fullmatch(r"([a-z_]+):\s*(.*)", line)
        if not match:
            raise ValueError("unsupported metadata line: " + line)
        key, value = match.groups()
        if key in fields:
            raise ValueError("duplicate metadata field: " + key)
        block_key = None
        if not value or value.lstrip().startswith("#"):
            if key in {"repositories", "supersedes"}:
                fields[key], block_key = [], key
            else:
                fields[key] = None
        elif value.startswith("["):
            fields[key] = _flow_list(value)
        else:
            fields[key] = _scalar(value, allow_date=key in DATE_FIELDS)
    return fields


def validate(root: Path) -> tuple[list[str], list[str]]:
    """Return errors/warnings without modifying any repository file."""
    root = root.resolve()
    errors, warnings = [], []
    try:
        registry = json.loads((root / "planning.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        return ["planning.json: " + str(error)], warnings
    if not isinstance(registry, dict):
        return ["planning.json must be an object"], warnings
    if type(registry.get("schema_version")) is not int or registry["schema_version"] != 1:
        errors.append("registry schema_version must be integer 1")
    for field in ("repositories", "work_items"):
        if not isinstance(registry.get(field), list):
            errors.append(field + " must be an array")
    if errors:
        return errors, warnings

    def scope(value, label):
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            errors.append(label + " must be an array of repository IDs")
            return set()
        if len(set(value)) != len(value):
            errors.append(label + " contains duplicate repository IDs")
        unknown = set(value) - repo_ids
        if unknown:
            errors.append(label + " contains unknown repository IDs: " + ", ".join(sorted(unknown)))
        return set(value)

    def contained(value, label):
        if not isinstance(value, str) or not value or "\\" in value:
            errors.append(label + " must be a nonempty POSIX relative path")
            return None
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or ":" in value or not path.parts:
            errors.append(label + " must stay inside planning")
            return None
        target = (root / value).resolve()
        if not target.is_relative_to(root):
            errors.append(label + " resolves outside planning")
            return None
        if not target.exists():
            errors.append(label + " does not exist: " + value)
        return target

    repo_ids = set()
    for index, entry in enumerate(registry["repositories"]):
        label = f"repositories[{index}]"
        if not isinstance(entry, dict):
            errors.append(label + " must be an object")
            continue
        repo_id = entry.get("id")
        if not isinstance(repo_id, str) or not REPO_ID.fullmatch(repo_id):
            errors.append(label + " has invalid id")
        elif repo_id in repo_ids:
            errors.append("duplicate repository id: " + repo_id)
        else:
            repo_ids.add(repo_id)
        if not isinstance(entry.get("name"), str) or not entry["name"].strip():
            errors.append(label + " needs a nonempty name")
        for field in ("path", "remote"):
            if field in entry and (not isinstance(entry[field], str) or not entry[field].strip()):
                errors.append(label + "." + field + " must be a nonempty string when supplied")

    work_ids, locations, plans = set(), set(), []
    for index, entry in enumerate(registry["work_items"]):
        label = f"work_items[{index}]"
        if not isinstance(entry, dict):
            errors.append(label + " must be an object")
            continue
        work_id = entry.get("id")
        if not isinstance(work_id, str) or not WORK_ID.fullmatch(work_id):
            errors.append(label + " has invalid id")
        elif work_id in work_ids:
            errors.append("duplicate work id: " + work_id)
        else:
            work_ids.add(work_id)
        location = contained(entry.get("path"), label + ".path")
        if location in locations and location is not None:
            errors.append(label + " duplicates a retained location")
        locations.add(location)
        work_scope = scope(entry.get("repositories"), label + ".repositories")
        if not work_scope:
            warnings.append(label + ": legacy repository scope is unknown")
        if "current_plan" not in entry:
            errors.append(label + " needs an explicit current_plan or null")
            continue
        pointer = entry["current_plan"]
        if pointer is None:
            warnings.append(label + ": main plan is unidentified")
            continue
        plan_path = contained(pointer, label + ".current_plan")
        if plan_path is None:
            continue
        if location is not None and not (plan_path == location or (location.is_dir() and plan_path.is_relative_to(location))):
            errors.append(label + ".current_plan is outside its work item")
        if not plan_path.is_file():
            errors.append(label + ".current_plan must identify a file")
            continue
        if location is not None and location.is_dir() and plan_path != location / 'plan.md':
            warnings.append(str(pointer) + ': retained legacy main plan name; normalize to root plan.md during organization')
        try:
            metadata = parse_frontmatter(plan_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            errors.append(str(pointer) + ": " + str(error))
            continue
        if metadata is None:
            warnings.append(str(pointer) + ": legacy plan has no frontmatter; metadata not validated")
            continue
        plans.append((str(pointer), metadata, work_id, work_scope))

    for pointer, metadata, work_id, work_scope in plans:
        prefix = pointer + ": "
        missing = PLAN_FIELDS - metadata.keys()
        if missing:
            errors.append(prefix + "missing fields: " + ", ".join(sorted(missing)))
        if type(metadata.get("schema_version")) is not int or metadata["schema_version"] != 1:
            errors.append(prefix + "schema_version must be integer 1")
        if metadata.get("kind") != "plan":
            errors.append(prefix + "kind must be plan")
        if metadata.get("id") != work_id:
            errors.append(prefix + "id disagrees with registry")
        if not isinstance(metadata.get("title"), str) or not metadata["title"].strip():
            errors.append(prefix + "title must be a nonempty string")
        if scope(metadata.get("repositories"), prefix + "repositories") != work_scope:
            errors.append(prefix + "repository scope disagrees with registry")
        for field, allowed in (("design_status", DESIGN), ("implementation_status", IMPLEMENTATION)):
            if not isinstance(metadata.get(field), str) or metadata[field] not in allowed:
                errors.append(prefix + "invalid " + field)
        for field in ("created", "updated", "accepted_at", "completed_at"):
            value = metadata.get(field)
            if value is None:
                continue
            try:
                if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                    raise ValueError()
                date.fromisoformat(value)
            except ValueError:
                errors.append(prefix + field + " must be an ISO date string or null")
        if metadata.get("completed_at") is not None and metadata.get("implementation_status") != "complete":
            errors.append(prefix + "completed_at requires complete implementation_status")
        if metadata.get("accepted_at") is not None and metadata.get("design_status") == "draft":
            errors.append(prefix + "draft cannot claim accepted_at")
        replaced = metadata.get("supersedes")
        if not isinstance(replaced, list) or any(not isinstance(item, str) or item not in work_ids for item in replaced):
            errors.append(prefix + "supersedes must list registered work IDs")
        elif len(set(replaced)) != len(replaced) or work_id in replaced:
            errors.append(prefix + "supersedes contains duplicate or self IDs")
        replacement = metadata.get("superseded_by")
        if replacement is not None and (not isinstance(replacement, str) or replacement not in work_ids or replacement == work_id):
            errors.append(prefix + "superseded_by must identify another registered work item or null")
    for entry in registry['work_items']:
        if not isinstance(entry, dict) or not isinstance(entry.get('path'), str):
            continue
        location = contained(entry['path'], 'ledger work location')
        if location is None or not location.is_dir():
            continue
        ledger = location / 'ledger.md'
        if not ledger.is_file():
            continue
        if contained(ledger.relative_to(root).as_posix(), 'ledger') is None:
            continue
        try:
            metadata = parse_frontmatter(ledger.read_text(encoding='utf-8-sig'))
            if metadata is None:
                continue  # Retained historical prose does not establish current activity.
            text_or_null = lambda value: value is None or isinstance(value, str) and bool(value.strip())
            required = {'schema_version', 'kind', 'work_id', 'updated', 'current', 'next', 'blocked'}
            valid = required <= metadata.keys() and type(metadata.get('schema_version')) is int and metadata['schema_version'] == 1 and metadata.get('kind') == 'ledger' and metadata.get('work_id') == entry.get('id')
            valid = valid and text_or_null(metadata.get('current')) and text_or_null(metadata.get('blocked')) and isinstance(metadata.get('next'), list) and all(isinstance(step, str) and bool(step.strip()) for step in metadata['next'])
            updated = metadata.get('updated')
            if updated is not None:
                valid = valid and isinstance(updated, str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', updated))
                if valid:
                    date.fromisoformat(updated)
            if not valid:
                raise ValueError('invalid ledger status metadata')
        except (OSError, ValueError) as error:
            errors.append(str(ledger.relative_to(root)) + ': ' + str(error))
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("planning_root", type=Path)
    args = parser.parse_args()
    errors, warnings = validate(args.planning_root)
    for message in warnings:
        print("WARNING: " + message)
    for message in errors:
        print("ERROR: " + message, file=sys.stderr)
    if not errors:
        print("Planning registry and selected plan metadata valid; files were not modified.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
