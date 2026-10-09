# Model review in a PR or MR

`atlas model review --input request.json` is provider independent. It reads Atlas document JSON from explicit files or Git commits, validates the head, compares stable semantic identities and builds an offline review bundle. It never runs a source project's scripts or alters the model. Git revisions must exist locally; fetch the selected base/head before running.

```json
{
  "base": {
    "repository": ".",
    "ref": "<base-commit>",
    "path": "architecture.atlas.json"
  },
  "head": {
    "repository": ".",
    "ref": "<head-commit>",
    "path": "architecture.atlas.json"
  },
  "sources": [
    {
      "identity": "organization/project",
      "repository": "../project",
      "baseRef": "<implementation-base>",
      "headRef": "<implementation-head>"
    }
  ],
  "outputDirectory": "artifacts/review"
}
```

Paths resolve from the process working directory. Use `{ "file": "model.atlas.json" }` for a saved document without Git. Output must be new or empty. The bundle contains `review.json`, `summary.md`, original base/head documents, `index.html`, downloads and a SHA-256 manifest. Document revisions and resolved Git object IDs label the review; no timestamps or provider IDs enter reproducible output. The HTML inspects the head document and its retained baseline, if present. The explicit review base is the separate base document; it can differ from that retained baseline.

Exit **0** means no blocking findings within reported coverage. Exit **1** still produces artifacts for ontology errors, unresolved merge choices, mismatched authored scenario expectations, or changed/missing/stale evidence. Exit **2** means malformed input, unavailable commits, invalid references, renderer incompatibility or command failure. Warnings and unassessed evidence remain visible and do not silently become verified claims. A pipeline can add its own stricter policy by reading `review.json`.

Evidence mapping uses the exact `evidence.sources[].repo` identity. Regular Git files are compared at the explicit implementation base/head; retained commit pins are checked when available. File bytes, not names or line ranges alone, determine changes. A new or changed file is `changed`, a removed file `missing`, and unchanged-between-base/head content differing from the capture pin `stale`. No repository mapping or unavailable capture commit is `unassessed`. Without a capture pin, an unchanged file establishes only no change across the requested revisions. This does not verify conceptual equivalence, arbitrary dependencies, working-tree edits or live databases. Database changes require a new explicit capture and model comparison.

`npm run review:example -- artifacts/review` exercises the committed teaching pair. CI passes `--git` so artifacts label the actual pipeline commit. Set `ATLAS_REVIEW_HEAD` to a fetched commit and `ATLAS_REVIEW_CONFIG` to a request JSON to replace the demonstration with a real project review. Explicit config supplies its own base/head; no provider variable or moving branch silently chooses the architectural baseline.

GitHub Actions retains review and release artifacts even when a verification job fails. Atlas and the Worktrail consumer use the same core contract and artifact upload. These are artifact workflows, with no publishing token, deployment, auto-merge or release creation. [GitHub artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) describes retention/access behavior. Model contents and retained excerpts may be private; artifacts inherit the repository's access controls.
