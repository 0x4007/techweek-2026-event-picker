#!/usr/bin/env bash
set -euo pipefail

root="${1:-.deploy-root}"

rm -rf "$root"
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
