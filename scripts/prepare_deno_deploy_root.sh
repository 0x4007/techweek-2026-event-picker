#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'prepare_deno_deploy_root: %s\n' "$*" >&2
  exit 2
}

copy_if_exists() {
  local source="$1"
  local target_dir="$2"
  if [ -e "$source" ]; then
    cp "$source" "$target_dir/"
  fi
}

copy_dir_if_exists() {
  local source="$1"
  local target_dir="$2"
  if [ -d "$source" ]; then
    cp -R "$source" "$target_dir/"
  fi
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"
home_root="$(cd -- "${HOME:-/}" && pwd -P)"
tmp_root="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"

requested_root="${1:-.deploy-root}"
[ -n "$requested_root" ] || fail "deploy root path is required"

case "$requested_root" in
  "." | ".." | "/" | "$repo_root" | "$home_root")
    fail "refusing dangerous deploy root: $requested_root"
    ;;
esac

root_parent="$(dirname -- "$requested_root")"
root_name="$(basename -- "$requested_root")"
case "$root_name" in
  .deploy-root | deploy-root | *deploy*)
    ;;
  *)
    fail "deploy root must be a dedicated deploy-named directory, got: $requested_root"
    ;;
esac

[ -d "$root_parent" ] || fail "deploy root parent does not exist: $root_parent"
root_parent_abs="$(cd -- "$root_parent" && pwd -P)"
root="$root_parent_abs/$root_name"

case "$root" in
  "$repo_root" | "$home_root" | "/")
    fail "refusing dangerous deploy root: $root"
    ;;
  "$repo_root"/* | "$tmp_root"/*)
    ;;
  *)
    fail "deploy root must live under the repository or temp directory: $root"
    ;;
esac

rm -rf -- "$root"
mkdir -p \
  "$root/.github/workflows" \
  "$root/app" \
  "$root/e2e" \
  "$root/outputs/signed_up" \
  "$root/data/rankings" \
  "$root/docs/agenda" \
  "$root/docs/handoffs" \
  "$root/docs/text-conversation-rewards" \
  "$root/scripts/lib"

cp -R app/. "$root/app/"
[ ! -d e2e ] || cp -R e2e/. "$root/e2e/"
cp deno.json deno.lock README.md "$root/"
copy_if_exists .github/workflows/deno-deploy.yml "$root/.github/workflows"

cp \
  outputs/signed_up/techweek_signed_up_transport_schedule.csv \
  outputs/signed_up/techweek_signed_up_operational_with_travel.ics \
  "$root/outputs/signed_up/"

cp \
  data/rankings/techweek_nyc_accolades_full_rerank.csv \
  data/rankings/techweek_nyc_accolades_full_rerank_top_picks.md \
  "$root/data/rankings/"

copy_if_exists docs/agenda/TECHWEEK_AGENDA.md "$root/docs/agenda"
copy_if_exists docs/handoffs/SIGNUP_AGENT_HANDOFF.md "$root/docs/handoffs"
copy_if_exists docs/handoffs/SIGNUP_STATE_HANDOFF.md "$root/docs/handoffs"
copy_if_exists docs/handoffs/BACKUP_SIGNUP_AGENT_HANDOFF.md "$root/docs/handoffs"
copy_dir_if_exists docs/text-conversation-rewards "$root/docs"

cp -R scripts/lib/. "$root/scripts/lib/"
copy_if_exists scripts/build_signed_up_calendar.ts "$root/scripts"
copy_if_exists scripts/build_signed_up_calendar_test.ts "$root/scripts"
copy_if_exists scripts/sync_partiful_config_test.ts "$root/scripts"
copy_if_exists scripts/capture_partiful_auth_from_browser.ts "$root/scripts"
copy_if_exists scripts/login_account_with_agent_token.ts "$root/scripts"
copy_if_exists scripts/sync_partiful_headless.ts "$root/scripts"
copy_if_exists scripts/list_twilio_partiful_codes.ts "$root/scripts"
copy_if_exists scripts/login_partiful_with_twilio.ts "$root/scripts"
copy_if_exists scripts/prepare_deno_deploy_root.sh "$root/scripts"
copy_if_exists scripts/prepare_deno_deploy_root_test.ts "$root/scripts"
copy_if_exists scripts/snapshot_text_conversation_rewards.ts "$root/scripts"
