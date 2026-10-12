# Plan export

A plan export is one self-contained HTML file that carries a whole work item: its plan, ledger, glossary, decision records, supporting notes, evidence, attachments and diagrams with their revision history. Anyone can open it in a browser to read the plan offline. Atlas can import it into another planning folder as new work. This is the way to share a plan; `atlas model export` remains for a single model ([portable documents](portable-documents.md)).

```sh
atlas plan export work-0003 --planning-dir planning              # writes customer-notifications-work-0003.atlas-plan.html
atlas plan export active/0003-customer-notifications --out share.html
atlas plan import share.html --planning-dir planning --dry-run    # preview only
atlas plan import share.html --planning-dir planning
```

`--planning-dir` defaults to the current folder. Export names its file `<slug>-<work-id>.atlas-plan.html` in the current folder; it never replaces an existing file without `--force`. Import prints a preview (title, original ID and origin, the new number and folder, file count and size, diagrams) and then imports; it does not ask for confirmation, so use `--dry-run` to preview only. Both exit 0 on success, 1 for an invalid export or a refused folder, and 2 on usage errors.

The command and the app call the same code in `@envsemble/atlas-planning`: `exportPlan(planningRoot, work, { now })`, `readPlanExport(html)` and `importPlan(planningRoot, html | preview)`. `readPlanExport` returns a frozen preview that `importPlan` accepts in place of the file, so a preview-then-import flow reads the file once. Invalid input throws a `PlanExportError` with a `code` (`FORMAT`, `VERSION`, `PATH`, `DUPLICATE`, `INTEGRITY`, `LIMIT`, `SOURCE`, `WORK`, `TARGET`, `CONFLICT` or `ROLLBACK`) before anything is written, or after rolling back everything an import wrote. `ROLLBACK` means an import failed and could not undo all of its steps: its message gives the original failure and what was left behind (the work folder, or the entry in `planning.json`) and how to clean up.

## File format

The HTML contains:

- a content security policy as its first content: `default-src 'none'`, the viewer script allowed by its SHA-256 hash only, inline styles, images from `data:` and `blob:` URLs, and no connections, frames, objects, workers, forms or base URL;
- the read-only viewer, with its script and styles inline;
- `<script id="atlas-plan-export" type="application/json">`, the payload;
- `<script id="atlas-plan-view" type="application/json">`, derived viewer data (work status, document titles and prepared diagram scenes). Import ignores it.

Both JSON elements are inert data; every `<` in them is written as the JSON escape `\u003c`. The payload is the manifest with each file's bytes:

```json
{
  "format": "atlas/plan-export",
  "version": 1,
  "atlasVersion": "0.6.0",
  "exportedAt": "2026-10-10T12:00:00.000Z",
  "source": {
    "planningFolder": "planning",
    "workId": "work-0003",
    "title": "Customer order notifications",
    "location": "active",
    "path": "active/0003-customer-notifications",
    "currentPlan": "plan.md",
    "repositories": [{ "id": "shop", "name": "Northwind Shop" }]
  },
  "files": [
    { "path": "plan.md", "size": 2048, "sha256": "…", "data": "<base64>" }
  ]
}
```

`files` lists every file of the work folder by work-folder-relative POSIX path, sorted. It includes `.atlas/models` and `.atlas/history`, so diagrams keep their revisions. It leaves out Atlas's transient output (`.atlas/results`, `.atlas/prepared`, `.atlas/exports`, lock and temporary files), the agent-reported work statistics (`.atlas/statistics.jsonl`), other hidden files, `node_modules`, symbolic links and empty folders; export lists anything skipped as a warning. `currentPlan` is the registered main plan, a Markdown file relative to the work folder and outside `.atlas/`, or `null` for a legacy item without one. `repositories` carries the work's repository scope with their registered names (not local checkout paths). Git history is not exported.

Text in the manifest (title, planning folder, repository names and remotes, paths) may not contain control characters, so it cannot rewrite a terminal when it is shown.

Exports above 50 MB are written with a warning. A work folder may hold at most 300 MB of files: base64 makes the HTML a third larger, and one JavaScript string holds at most about 512 million characters, so a larger export could be neither written nor read back. Export refuses a larger folder (`LIMIT`) rather than dropping files; keep large evidence elsewhere and link to it. Export also refuses anything an import would refuse (non-portable paths, control characters, a main plan that is not Markdown), so every export it writes can be imported.

## Viewer

The viewer looks like the Atlas app: the work page with its status, Plan, Ledger, Diagrams and Files tabs, and the About sidebar. Markdown renders with the app's GitHub-like styles, including the diagram cards under the headings a model explains. Diagrams use the shared React viewer and stay interactive. Every file can be downloaded.

Embedded content is displayed, never executed. Raw HTML in Markdown is shown as text. Links work only between exported files or to explicit `http`/`https` addresses, which open in a new tab when clicked. Images show only when they are exported files. HTML and other text attachments show as source, and images (including SVG) are shown through `<img>`, where they cannot run scripts. The page makes no network requests when it opens.

## Import

1. The file is read and validated as a whole: known format and version, text without control characters, no duplicate paths, no files or folders that a case-insensitive or normalizing filesystem would merge (`Docs/` and `docs/`), and every path relative, contained and portable (no `..`, `.` or empty segments, no absolute or drive paths, no backslashes, no hidden segments except a leading `.atlas/`, no characters or device names Windows rejects, no invisible text-direction controls). Every file's size and SHA-256 must match. An invalid file is rejected before anything is written.
2. Imports into one planning folder take turns: an import holds `.atlas-import.lock` in the planning folder while it works. Another import waits for it (30 seconds by default). The lock records the process, host name, operating system and release that hold it. A lock whose holder is known to be gone (same host, system and release, process no longer running) is taken over at once; one Atlas cannot judge (another system sharing the folder or the host name, such as WSL beside Windows, or a damaged lock) only after ten minutes. A takeover happens under a second exclusive file, `.atlas-import.lock.takeover`, and removes the lock only if it is unchanged, so two waiters never take it together. Hidden temporary folders named `.atlas-import-<uuid>` that interrupted imports left more than an hour ago are removed, as a best effort that never stops an import.
3. The target must pass `atlas planning check`; otherwise the import is refused with guidance to bootstrap a planning repository.
4. The work gets the next free number: one more than the highest registered work ID, skipping any number an unregistered folder in `active/` or `archive/` already uses. It keeps the source's location: `<active|archive>/<NNNN>-<slug>/`, with the slug cut to 100 characters. Importing the same file twice creates two work items.
5. The files are written to a hidden temporary folder beside the destination and renamed into place.
6. The work's identity is rewritten:
   - the main plan's `id` and the ledger's `work_id` metadata lines, keeping their quoting, line endings and byte order mark;
   - each diagram's `workId`, through a recorded model revision ("Imported as work-NNNN", made with the diagram package's `relocateDocument`), so revision integrity holds and captured snapshots stay snapshots.
7. References to other work are cleared, because they name work in the source planning folder:
   - the plan's `supersedes` becomes `[]` and `superseded_by` becomes `null`;
   - diagram context record paths that reach the work folder through the planning root (`../../active/0003-x/plan.md` or `active/0003-x/plan.md`) are rewritten work-relative, and paths that point outside the work folder (such as `../../knowledge/…`) are removed, keeping the record's retained text. This happens in the same recorded model revision.

   Every other byte, including earlier revisions and history files, is as exported.

8. `evidence/import-provenance.json` records the original planning folder, work ID, title, location and folder, the export time and Atlas version, every rewrite and cleared reference with its original value, and the repositories it registered. It uses the export's own spelling of the evidence folder. When that name is taken (compared as a case-insensitive, normalizing filesystem would, so `Import-Provenance.json` counts), as when re-importing an imported item, the earlier record is kept and this one is written as `import-provenance-2.json`.
9. The item is registered in `planning.json` by inserting its entry after the last one, in the style of its neighbours (indentation, inline or multi-line arrays, line endings and byte order mark); repositories the target does not know are registered the same way, with their remotes. When a repository ID is already registered under another name or remote, the work uses the registered entry and the notes say so. The rest of the file is untouched.
10. The import runs `atlas planning check` on the result. If the import would add any error, everything it wrote is rolled back and it fails with `TARGET`, listing the errors. Each rollback step runs on its own: `planning.json` is restored only if it still holds the text this import wrote, the work folder is removed with retries, and a location folder the import created is removed when empty.
11. Nothing is committed, and the README index is left for the user or an agent; the import notes say so.
