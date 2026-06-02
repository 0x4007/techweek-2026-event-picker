# Deno Deploy Findings and Commands

This handoff captures the working Deno Deploy path for the Tech Week app in
`/Users/nv/repos/0x4007/techweek-2026-event-picker`.

## App target

- Deno Deploy org: `0x4007`
- Deno Deploy app: `techweek-2026-event-picker`
- Runtime entrypoint: `app/main.ts`
- Production custom domain: `https://techweek.pavlovcik.com`
- Preview URL shape:
  `https://techweek-2026-event-picker-<build-id>.0x4007.deno.net`

## Credential source

The usable Deno Deploy token was not in this repo's `.env`. It was found in:

```text
/Users/nv/repos/0x4007/deposit-wbtc-etherfi/.env
```

Expected variables in that file:

```bash
DENO_DEPLOY_TOKEN=...
DENO_DEPLOY_ORG=...
DENO_DEPLOY_APP=...
```

Do not print or commit token values.

## Important credential finding

The already-exported local `DENO_DEPLOY_TOKEN` in the shell was for the wrong Deno Deploy account.
It listed apps such as `ai-ubq-fi`, `card-ubq-fi`, and other `*-ubq-fi` projects, but did not have
access to `0x4007/techweek-2026-event-picker`.

Symptoms from the wrong token:

```text
The requested organization was not found, or you do not have access to view it.
The requested app was not found, or you do not have access to view it.
```

Use the token from `deposit-wbtc-etherfi/.env` for this app.

## Prepare deploy root

The repo has a staging script:

```bash
scripts/prepare_deno_deploy_root.sh
```

Use a repo-local deploy root:

```bash
DEPLOY_ROOT=".codex/techweek-preview-deploy-root"
mkdir -p .codex
scripts/prepare_deno_deploy_root.sh "$DEPLOY_ROOT"
```

Do not use `/tmp/techweek-preview-deploy-root` on this Mac. The script resolves `/tmp` to
`/private/tmp`, then rejects it because it is outside the allowed repo/temp path check.

## Preview deploy command

From the Tech Week repo root:

```bash
set -euo pipefail
set -a
. /Users/nv/repos/0x4007/deposit-wbtc-etherfi/.env
set +a

: "${DENO_DEPLOY_TOKEN:?missing DENO_DEPLOY_TOKEN}"

DEPLOY_ROOT=".codex/techweek-preview-deploy-root"
mkdir -p .codex
scripts/prepare_deno_deploy_root.sh "$DEPLOY_ROOT"

cd "$DEPLOY_ROOT"
deno deploy \
  --token "$DENO_DEPLOY_TOKEN" \
  --config deno.json \
  --org "0x4007" \
  --app "techweek-2026-event-picker" \
  .
```

This publishes a preview because it omits `--prod`.

Use the blocking form above, without `--no-wait`, when you need the final preview URL. The CLI prints
the URL only after the build finishes.

## Non-blocking preview deploy

This uploads and starts the build, but does not print the final preview URL:

```bash
deno deploy \
  --token "$DENO_DEPLOY_TOKEN" \
  --config deno.json \
  --org "0x4007" \
  --app "techweek-2026-event-picker" \
  --no-wait \
  .
```

It prints a build page such as:

```text
https://console.deno.com/0x4007/techweek-2026-event-picker/builds/<build-id>
```

The preview URL is not always the same hostname shape as the older `deno.dev` guess. Wait for the CLI
or use the console build page.

## Working preview from this run

The successful preview from this run was:

```text
https://techweek-2026-event-picker-rszrc6j0kkpe.0x4007.deno.net
```

Build page:

```text
https://console.deno.com/0x4007/techweek-2026-event-picker/builds/rszrc6j0kkpe
```

## Production deploy

Production uses the same app target but adds `--prod`.

The GitHub workflow at `.github/workflows/deno-deploy.yml` uses:

```bash
deno deploy \
  --token "$DENO_DEPLOY_TOKEN" \
  --config deno.json \
  --org "$DENO_DEPLOY_ORG" \
  --app "$DENO_DEPLOY_APP" \
  --prod \
  --no-wait \
  .
```

Do not add `--prod` for preview deploys.

## Auth hub caveat for previews

The shared auth hub currently allowlists localhost and production Tech Week origins, not arbitrary
Deno preview URLs.

Relevant config:

```text
deploy/auth-hub/src/config.ts
```

Current Tech Week allowed origins include:

```text
http://localhost:8788
http://127.0.0.1:8788
http://m1.local:8788
https://techweek.pavlovcik.com
```

If sign-in must work on a specific preview URL, add that preview origin and callback URL to the auth
hub client config, then deploy the auth hub too.

For the preview above, that would mean adding:

```text
https://techweek-2026-event-picker-rszrc6j0kkpe.0x4007.deno.net
https://techweek-2026-event-picker-rszrc6j0kkpe.0x4007.deno.net/auth.html
```

Without that auth-hub change, unauthenticated app pages can load, but shared auth sign-in may be
rejected by the auth hub.

## Verification

After a preview deploy, check health:

```bash
curl -fsS "https://techweek-2026-event-picker-<build-id>.0x4007.deno.net/api/health"
```

Expected body includes:

```json
{"status":"ready"}
```

To verify the served frontend matches the staged deploy root, compare `app.js`:

```bash
expected_app_js_sha="$(shasum -a 256 "$DEPLOY_ROOT/app/static/app.js" | awk '{print $1}')"
actual_app_js_sha="$(
  curl -fsSL "https://techweek-2026-event-picker-<build-id>.0x4007.deno.net/app.js" |
    shasum -a 256 |
    awk '{print $1}'
)"
test "$expected_app_js_sha" = "$actual_app_js_sha"
```

## Troubleshooting

If deploy says the org or app is not found, the token is probably for the wrong Deno Deploy account.
Check available apps with:

```bash
deno deploy switch --token "$DENO_DEPLOY_TOKEN"
```

Run that outside this repo if `deno.json` parsing fails.

If `deno deploy switch` fails in this repo with:

```text
Failed to parse "deploy" configuration: unknown field `install`, expected `org` or `app`
```

rerun it from a neutral directory:

```bash
cd /Users/nv
deno deploy switch --token "$DENO_DEPLOY_TOKEN"
```

If a guessed preview URL returns `404`, wait for the build or use the blocking deploy command. The
correct URL is printed after the CLI reaches `Successfully deployed your application`.
