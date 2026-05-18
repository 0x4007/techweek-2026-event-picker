# Clawpatch Repair Loop

Use this when continuing Clawpatch audit repairs in this repository.

## Branch safety

- Keep repair work on `clawpatch`.
- Do not push to `main`.
- Do not rename `clawpatch` back to `main`.
- Commit each focused fix separately.
- Keep the working tree clean between findings.

## Agent role

Future agents should act as Clawpatch orchestrators, not independent refactoring agents.

Default behavior:

- Let Clawpatch choose the next finding.
- Let Clawpatch attempt the fix.
- Let the finding define the scope.
- Do not browse the codebase looking for unrelated improvements.
- Do not manually redesign features or opportunistically clean nearby code.
- Do not implement code changes that are not tied to a Clawpatch finding.
- Do not change product behavior beyond the finding's minimum fix scope.
- Do not mark a finding fixed unless the committed change directly addresses that finding.

Manual implementation is only acceptable when the user explicitly asks for it after a Clawpatch
failure, block, or hang. Do not silently switch from `clawpatch fix` to hand-editing code.

If Clawpatch applies a patch but exits with a validation failure, treat the working tree as a
Clawpatch-produced draft:

- Inspect the changed files and validation output.
- Do not commit it until the validation issue is understood.
- Do not mark the finding fixed.
- Ask the user whether to debug the Clawpatch patch manually, retry Clawpatch, or discard only the
  Clawpatch-produced draft.

When manual fallback is used:

- Quote the finding ID in the work notes.
- Keep edits limited to the files implicated by evidence or the smallest required regression test.
- Commit the fix before moving to the next finding.
- Mark the finding fixed with the exact commit SHA and rationale.

Check state:

```bash
git status --short --branch
clawpatch --no-input status --json
```

## Important local caveat

Older runs in this environment saw `clawpatch fix` and `clawpatch revalidate` provider subprocesses
hang without output. Do not assume that means future agents should hand-edit by default. Start with
the Clawpatch CLI loop and use bounded timeouts so a hung provider does not wedge the session.

If a Clawpatch subprocess hangs, identify and terminate only the stuck Clawpatch/Codex process, then continue manually.

Recommended timeout wrapper:

```bash
timeout 180 clawpatch --no-input fix --finding <finding-id> --json
```

If `timeout` is not available, run the same command normally, watch for lack of output, and interrupt
only the stuck Clawpatch command.

## Clawpatch loop

1. Get the next open finding:

```bash
clawpatch --no-input next --json
```

2. Inspect the finding:

```bash
clawpatch show --finding <finding-id> --json
```

3. Ask Clawpatch to apply the fix:

```bash
timeout 180 clawpatch --no-input fix --finding <finding-id> --json
```

4. Check the result:

```bash
git status --short --branch
git diff --stat
```

5. If Clawpatch succeeded and left a focused patch, run only the targeted validation relevant to the
   changed files or the finding's suggested regression test. Do not run broad suites unless the user
   explicitly asks.

6. Commit the fix:

```bash
git add <changed-files>
git commit -m "fix: <short finding summary>"
```

7. Mark the finding fixed:

```bash
sha=$(git rev-parse --short HEAD)
clawpatch --no-input triage \
  --finding <finding-id> \
  --status fixed \
  --note "Fixed in commit ${sha} by <concise rationale>."
```

8. Repeat from step 1.

## Manual fallback loop

Use this only after the user explicitly approves manual repair.

1. Read only the files needed for the finding.

2. Implement the smallest safe fix.

3. Add a targeted regression test when practical.

4. Commit the fix:

```bash
git add <changed-files>
git commit -m "fix: <short finding summary>"
```

5. Mark the finding fixed:

```bash
sha=$(git rev-parse --short HEAD)
clawpatch --no-input triage \
  --finding <finding-id> \
  --status fixed \
  --note "Fixed in commit ${sha} by <concise rationale>."
```

6. Repeat the Clawpatch loop from step 1.

## Listing remaining findings

```bash
jq -r 'select(.status=="open") | [.severity,.triage,.findingId,.title] | @tsv' \
  .clawpatch/findings/*.json | sort
```

## Already handled on `clawpatch`

- Merged `feat/clawpatch-fix`.
- Merged `fix/markdown-render`.
- Restored OCR to orientation-only local OCR behavior.
- Fixed the quick-prompt horizontal fade bug.
- Added admin auth gates for sensitive API routes.
- Fixed Partiful status preservation issues.
- Fixed several state, cache, deploy-root, and agenda recalculation findings.

## Current known item

At the time this document was updated, the next finding was:

```text
fnd_sig-manual-deno-routing-2cb24a58_8dcea0ce2d
Station-list failures bypass the transit fallback
```

Expected scope:

```text
app/lib/routing.ts
app/lib/routing_test.ts
```

Fix direction:

```text
When station-list loading fails or returns empty, use the transit fallback estimate instead of throwing.
```

Latest observed command result:

```text
timeout 180 clawpatch --no-input fix --finding fnd_sig-manual-deno-routing-2cb24a58_8dcea0ce2d --json
error: validation failed after applying fix
```

That command left Clawpatch-produced edits in:

```text
app/lib/routing.ts
app/lib/routing_test.ts
```

Next agent should inspect those edits and the validation failure before deciding whether to keep,
repair, retry, or discard them. Do not mark the finding fixed until a focused commit passes targeted
validation.
