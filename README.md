# Tech Week 2026 Event Picker

Local workspace for researching, ranking, scheduling, and tracking NYC Tech Week 2026 events.

## Layout

- `AGENTS.md` - operational instructions for future agents.
- `.codex/` - active RSVP state and ignored personal profile data.
- `scripts/` - Python utilities for ranking, schedule generation, calendar sync helpers, and email
  checks.
- `data/source/` - raw Tech Week calendar exports and the ignored Partiful page cache.
- `data/rankings/` - scored/reranked event outputs and shortlist data.
- `data/cache/` - geocoding, subway, and routing caches used by schedule generators.
- `outputs/accolades/` - generated pre-RSVP planning calendars and detailed travel schedule.
- `outputs/signed_up/` - generated signed-up operational schedule, reference calendar, CSV, XLSX,
  and ICS files.
- `outputs/sync/` - generated AppleScript/EventKit calendar sync helpers.
- `docs/handoffs/` - RSVP handoff docs and signup priorities.
- `docs/agenda/` - user-facing agenda in Markdown, HTML, and DOCX.
- `docs/calendar/` - calendar sync notes.

## Common Commands

```bash
deno task start
deno task check
python3 scripts/build_signed_up_calendar.py
python3 scripts/sync_google_personal_day_batches.py --dry-run
python3 scripts/check_techweek_acceptance_emails.py
```

The Deno app runs at `http://localhost:8787` and serves a mobile route/backup/agent interface from
`app/`. It reads `outputs/signed_up/techweek_signed_up_transport_schedule.csv`, stores mutable
backend state in Postgres when `DATABASE_URL` is available, and uses the ignored `.env` gateway
token for AI requests.

For Deno Deploy, attach a managed Prisma Postgres database to the app. Generated schedule artifacts
under `outputs/signed_up/` are treated as read-only deployment inputs; notes, leads, and dismissed
blocks persist in Postgres across stateless requests. Deno Deploy injects `DATABASE_URL`;
`deno.json` declares the app target, and the Deploy app should be created as a dynamic runtime with
`app/server.ts` as the entrypoint.

Deploy-ready dynamic planning endpoints:

- `POST /api/agenda/recalculate` - creates a Postgres-persisted agenda proposal. Pass
  `{ "liveRouting": false }` to use deterministic fallback travel estimates, or omit it to use
  Nominatim/OpenStreetMap geocoding plus SubwayInfo.nyc routing with Postgres-backed caches.
- `GET /api/agenda/runs/:id` - reads a persisted agenda proposal from Postgres.
- `POST /api/sync/partiful` - accepts supplied Partiful snapshots, normalizes RSVP status changes,
  stores them in Postgres, and can recalculate when `{ "recalculate": true }` is provided.
- `GET /api/cache/routes` - reports Postgres cache counts for routing, agenda, and Partiful sync
  records.

CRM follow-up email can send through Resend when these ignored `.env` values are present:

```bash
RESEND_API_KEY=
RESEND_EMAIL_FROM="Tech Week CRM <followups@mail.pavlovcik.com>"
```

Use `onboarding@resend.dev` for quick free-tier testing. For real CRM follow-ups, verify a domain in
Resend and switch `RESEND_EMAIL_FROM` to a sender on that domain.

When configured, the CRM lead form enables the follow-up email checkbox and stores the send result
on the lead.

To send the live Resend test email to `test@pavlovcik.com`, run:

```bash
RUN_RESEND_EMAIL_TEST=1 deno test --env-file=.env --allow-env=RUN_RESEND_EMAIL_TEST,RESEND_API_KEY,RESEND_EMAIL_FROM --allow-net=api.resend.com --filter "sends Resend test email" app/server_test.ts
```

The private RSVP profile stays ignored at `.codex/techweek-rsvp-profile.json`; keep it out of
generated docs and tracked outputs.
