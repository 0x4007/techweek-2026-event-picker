# Clawpatch Repair Loop

Use this when continuing Clawpatch audit repairs in this repository.

## Branch safety

- Keep repair work on `clawpatch`.
- Do not push to `main`.
- Do not rename `clawpatch` back to `main`.
- Commit each focused fix separately.
- Keep the working tree clean between findings.

Check state:

```bash
git status --short --branch
clawpatch --no-input status --json
```

## Important local caveat

In this environment, `clawpatch fix` and `clawpatch revalidate` invoked a Codex provider subprocess that hung without output. Prefer the manual loop below unless that provider path has been fixed.

If a Clawpatch subprocess hangs, identify and terminate only the stuck Clawpatch/Codex process, then continue manually.

## Manual loop

1. Get the next open finding:

```bash
clawpatch --no-input next --json
```

2. Inspect the finding:

```bash
clawpatch show --finding <finding-id> --json
```

3. Read only the files needed for that finding.

4. Implement the smallest safe fix.

5. Add a targeted regression test when practical.

6. Commit the fix:

```bash
git add <changed-files>
git commit -m "fix: <short finding summary>"
```

7. Mark the finding fixed:

```bash
clawpatch --no-input triage \
  --finding <finding-id> \
  --status fixed \
  --note "Fixed in commit <sha> by <concise rationale>."
```

8. Repeat from step 1.

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

## Next known item

At the time this document was written, the next finding was:

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
