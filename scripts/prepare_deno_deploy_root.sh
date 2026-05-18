#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'prepare_deno_deploy_root: %s\n' "$*" >&2
  exit 2
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
  "$root/app" \
  "$root/outputs/signed_up" \
  "$root/data/rankings" \
  "$root/docs/agenda" \
  "$root/docs/handoffs" \
  "$root/scripts/lib"

cp -R app/. "$root/app/"
cp deno.json deno.lock README.md "$root/"

cp \
  outputs/signed_up/techweek_signed_up_transport_schedule.csv \
  outputs/signed_up/techweek_signed_up_operational_with_travel.ics \
  "$root/outputs/signed_up/"

cp \
  data/rankings/techweek_nyc_accolades_full_rerank.csv \
  data/rankings/techweek_nyc_accolades_full_rerank_top_picks.md \
  "$root/data/rankings/"

cp docs/agenda/TECHWEEK_AGENDA.md "$root/docs/agenda/"
cp \
  docs/handoffs/SIGNUP_AGENT_HANDOFF.md \
  docs/handoffs/SIGNUP_STATE_HANDOFF.md \
  docs/handoffs/BACKUP_SIGNUP_AGENT_HANDOFF.md \
  "$root/docs/handoffs/"

cp -R scripts/lib/. "$root/scripts/lib/"
cp scripts/build_signed_up_calendar.ts scripts/build_signed_up_calendar_test.ts "$root/scripts/"
