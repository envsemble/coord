# Atlas skills

Seven agent skills for planning with Atlas. They work in Codex and Claude Code, and name no model or provider: review, model and effort choices come from the repository, the user and the harness configuration.

| Skill | Purpose | Invocation |
|---|---|---|
| [atlas-bootstrap](atlas-bootstrap/SKILL.md) | Create or adopt a planning repository with governance and explicit scope. | Automatic or by name |
| [atlas-organize](atlas-organize/SKILL.md) | Organize retained plans and evidence without losing originals. | Automatic or by name |
| [atlas-grill](atlas-grill/SKILL.md) | Clarify a design and record shared understanding as it settles. | Automatic or by name |
| [atlas-implement](atlas-implement/SKILL.md) | Implement an explicitly selected plan through review and CI. | By name only |
| [atlas-record](atlas-record/SKILL.md) | Retain useful outcomes, decisions and scoped knowledge. | Automatic or by name |
| [atlas-babysit-pr](atlas-babysit-pr/SKILL.md) | Carry existing PRs through the repository's review gate and current-head CI. | By name only |
| [atlas-model](atlas-model/SKILL.md) | Capture, author, revise, validate and reopen models while planning. | Automatic or by name |

Invoke a skill by name with `$atlas-implement` in Codex or `/atlas-implement` in Claude Code. The explicit-only skills declare that for both harnesses: `policy.allow_implicit_invocation: false` in `agents/openai.yaml` for Codex, and `disable-model-invocation: true` in the `SKILL.md` frontmatter for Claude Code.

## Install

The skills call the `atlas` command (`atlas planning check`, `atlas usage log`, `atlas model …`, `atlas mcp`), so install it first as described in [Install the atlas command](../README.md#install-the-atlas-command). Atlas needs only Node.

Copy the seven `atlas-*` folders as siblings into each harness's skills directory: `~/.codex/skills` for Codex and `~/.claude/skills` for Claude Code. This `skills` folder and its `tests` are not skills. Exactly one set should remain installed, so first move earlier copies to a dated backup outside the skills directories: `planning-*`, `worktrail-*`, `implement-plan`, `babysit-pr`, `atlas-modeling` and any previous `atlas-*` copies of these skills. Start a new agent session afterwards.

From an Atlas checkout on macOS or Linux:

```sh
backup="$HOME/skill-backups/$(date +%F)"
for harness in codex claude; do
  dir="$HOME/.$harness/skills"
  [ -d "$dir" ] || continue
  mkdir -p "$backup/$harness"
  for old in "$dir"/*/; do
    case "$(basename "$old")" in
      planning-*|worktrail-*|implement-plan|babysit-pr|atlas-modeling|atlas-bootstrap|atlas-organize|atlas-grill|atlas-implement|atlas-record|atlas-babysit-pr|atlas-model)
        mv "$old" "$backup/$harness/" ;;
    esac
  done
  cp -R skills/atlas-* "$dir/"
done
```

On Windows PowerShell:

```powershell
$backup = Join-Path $HOME "skill-backups\$(Get-Date -Format yyyy-MM-dd)"
$old = '^(planning-.+|worktrail-.+|implement-plan|babysit-pr|atlas-modeling|atlas-(bootstrap|organize|grill|implement|record|babysit-pr|model))$'
foreach ($harness in 'codex', 'claude') {
  $dir = Join-Path $HOME ".$harness\skills"
  if (-not (Test-Path $dir)) { continue }
  $target = New-Item -ItemType Directory -Force (Join-Path $backup $harness)
  Get-ChildItem -Directory $dir | Where-Object Name -Match $old | Move-Item -Destination $target
  Get-ChildItem -Directory skills\atlas-* | Copy-Item -Destination $dir -Recurse
}
```

Both scripts skip a harness whose skills directory does not exist; create it first for a harness you use but have not set up.

## Test

```sh
node --test "skills/tests/*.test.mjs"
```

The packaging test checks the skill set, frontmatter for both harnesses, explicit-only declarations, links, the `atlas` command contract, and that no retired names or model and provider names remain.
