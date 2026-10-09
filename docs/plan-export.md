# Plan export

A plan export is one self-contained HTML file that carries a whole work item: its plan, ledger, glossary, decision records, supporting notes, evidence, attachments and diagrams with their revision history. Anyone can open it in a browser to read the plan offline. Atlas can import it into another planning folder as new work. This is the way to share a plan; `atlas model export` remains for a single model ([portable documents](portable-documents.md)).

```sh
atlas plan export work-0003 --planning-dir planning              # writes customer-notifications-work-0003.atlas-plan.html
atlas plan export active/0003-customer-notifications --out share.html
atlas plan import share.html --planning-dir planning --dry-run    # preview only
atlas plan import share.html --planning-dir planning
```

`--planning-dir` defaults to the current folder. Export names its file `<slug>-<work-id>.atlas-plan.html` in the current folder; it never replaces a different existing file without `--force`. Import prints a preview (title, original ID and origin, the new number and folder, file count and size, diagrams) and then imports; it does not ask for confirmation, so use `--dry-run` to preview only. Both exit 0 on success, 1 for an invalid export or a refused folder, and 2 on usage errors.

The command and the app call the same code in `@envsemble/atlas-planning`: `exportPlan(planningRoot, work, { now })`, `readPlanExport(html)` and `importPlan(planningRoot, html)`. Invalid input throws a `PlanExportError` with a `code` (`FORMAT`, `VERSION`, `PATH`, `DUPLICATE`, `INTEGRITY`, `SOURCE`, `WORK`, `TARGET` or `CONFLICT`) before anything is written.

## File format

The HTML contains:

- a content security policy as its first content: `default-src 'none'`, the viewer script allowed by its SHA-256 hash only, inline styles, images from `data:` and `blob:` URLs, and no connections, frames, objects, workers, forms or base URL;
- the read-only viewer, with its script and styles inline;
- `<script id="atlas-plan-export" type="application/json">`, the payload;
- `<script id="atlas-plan-view" type="application/json">`, derived viewer data (work status, document titles and prepared diagram scenes). Import ignores it.

Both JSON elements are inert data; `<` is escaped as `<`. The payload is the manifest with each file's bytes:

```json
{
  "format": "atlas/plan-export",
  "version": 1,
  "atlasVersion": "0.5.0",
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

`files` lists every file of the work folder by work-folder-relative POSIX path, sorted. It includes `.atlas/models` and `.atlas/history`, so diagrams keep their revisions. It leaves out Atlas's transient output (`.atlas/results`, `.atlas/prepared`, `.atlas/exports`, lock and temporary files), other hidden files, `node_modules`, symbolic links and empty folders; export lists anything skipped as a warning. `currentPlan` is the registered main plan relative to the work folder, or `null` for a legacy item without one. `repositories` carries the work's repository scope with their registered names (not local checkout paths). Git history is not exported.

Exports above 50 MB are written with a warning; there is no hard cap, because export stays lossless.

## Viewer

The viewer looks like the Atlas app: the work page with its status, Plan, Ledger, Diagrams and Files tabs, and the About sidebar. Markdown renders with the app's GitHub-like styles, including the diagram cards under the headings a model explains. Diagrams use the shared React viewer and stay interactive. Every file can be downloaded.

Embedded content is displayed, never executed. Raw HTML in Markdown is shown as text. Links work only between exported files or to explicit `http`/`https` addresses, which open in a new tab when clicked. Images show only when they are exported files. HTML and other text attachments show as source, and images (including SVG) are shown through `<img>`, where they cannot run scripts. The page makes no network requests when it opens.

## Import

1. The file is read and validated as a whole: known format and version, no duplicate paths (compared without case and Unicode-normalization differences), and every path relative, contained and portable (no `..`, `.` or empty segments, no absolute or drive paths, no backslashes, no hidden segments except a leading `.atlas/`, no characters or device names Windows rejects). Every file's size and SHA-256 must match. An invalid file is rejected before anything is written.
2. The target must pass `atlas planning check`; otherwise the import is refused with guidance to bootstrap a planning repository.
3. The work gets the next free number: one more than the highest registered work ID, skipping any number an unregistered folder in `active/` or `archive/` already uses. It keeps the source's location: `<active|archive>/<NNNN>-<slug>/`. Importing the same file twice creates two work items.
4. The files are written to a hidden temporary folder beside the destination and renamed into place.
5. The work's identity is rewritten, and nothing else:
   - the main plan's `id` and the ledger's `work_id` metadata lines, keeping their quoting and line endings;
   - each diagram's `workId`, through a recorded model revision ("Imported as work-NNNN"), so revision integrity holds and captured snapshots stay snapshots. Context record paths that reach the work folder through the planning root (`../../active/0003-x/plan.md` or `active/0003-x/plan.md`) are rewritten work-relative in the same revision. Other files, earlier revisions and history files are byte-for-byte as exported.
6. `evidence/import-provenance.json` records the original planning folder, work ID, title, location and folder, the export time and Atlas version, and every rewrite. Re-importing an imported item keeps the earlier record and writes `import-provenance-2.json`.
7. The item is registered in `planning.json` by inserting its entry after the last one, in the style of its neighbours (indentation, inline or multi-line arrays, line endings and byte order mark); repositories the target does not know are registered the same way. The rest of the file is untouched.
8. Nothing is committed, and the README index is left for the user or an agent; the import notes say so. When the imported plan names other work in `supersedes` or `superseded_by`, the notes repeat what `atlas planning check` reports so it can be reconciled.
