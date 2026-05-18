# Tech Week 2026 Event Picker

Local workspace for researching, ranking, scheduling, and tracking NYC Tech Week 2026 events.

## Layout

- `AGENTS.md` - operational instructions for future agents.
- `.codex/` - active RSVP state and ignored personal profile data.
- `scripts/` - Deno and Python utilities for ranking, schedule generation, calendar sync helpers,
  and email checks.
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
deno task build:signed-up
deno task build:signed-up:dry-run
deno task partiful:auth:capture
deno task partiful:login:twilio
deno task sync:partiful
deno task sync:partiful:headless
deno task twilio:partiful-codes
python3 scripts/sync_google_personal_day_batches.py --dry-run
python3 scripts/check_techweek_acceptance_emails.py
```

The Deno app runs at `http://localhost:8788` and serves a mobile route/backup/agent interface from
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
  Nominatim/OpenStreetMap geocoding plus SubwayInfo.nyc routing with Postgres-backed caches. Pass
  `{ "activate": true }` to make the recalculated proposal the active `/api/schedule` payload.
  Optional `preferences` can override the default agenda profile from
  `app/lib/agenda_preferences.ts`; the human prompt lives at `app/prompts/agenda-preferences.md`.
- `GET /api/agenda/runs/:id` - reads a persisted agenda proposal from Postgres.
- `POST /api/sync/partiful` - accepts supplied Partiful snapshots, normalizes RSVP status changes,
  stores them in Postgres, and can recalculate when `{ "recalculate": true }` is provided.
- `GET /api/sync/partiful` - reads the latest stored Partiful RSVP state and status counts.
- `GET /api/cache/routes` - reports Postgres cache counts for routing, agenda, and Partiful sync
  records.

Partiful latest-state refresh is payload-driven at the backend boundary. For a browser-backed sync,
use a logged-in browser/session extractor to collect live Partiful page/API JSON and post it to the
app:

```json
{
  "source": "agent-browser:techweek",
  "recalculate": true,
  "activate": true,
  "responses": [
    {
      "eventUrl": "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
      "json": {
        "result": {
          "data": {
            "json": {
              "event": { "title": "Open Source Must Win" },
              "viewerGuest": { "status": "APPROVED", "rsvp": { "count": 2 } }
            }
          }
        }
      }
    }
  ]
}
```

Accepted snapshot containers include `snapshots`, `payloads`, `responses`, `targets`, `items`,
`snapshot`, `payload`, `nextData`, and `__NEXT_DATA__`. RSVP status can come from `guest`,
`viewerGuest`, `rsvp`, `viewerRsvp`, or equivalent status fields.

For local live refresh, start the app and run `deno task sync:partiful`. It uses the logged-in
`agent-browser --session techweek` browser session, posts snapshots to `/api/sync/partiful`, and
activates the recalculated agenda. If the Partiful session has expired, log in again before running
the sync task.

For headless sync, first capture the current Partiful Firebase auth token from the logged-in
browser:

```bash
deno task partiful:auth:capture
```

That writes `~/.codex/secrets/techweek-partiful-auth.json` with file mode `0600`; tokens are not
stored in the repo. After capture, run:

```bash
deno task sync:partiful:headless
```

The headless sync refreshes the Firebase ID token when needed, calls Partiful callable endpoints
(`getEventInfo` and `getGuests`) for the current schedule/reference Partiful IDs, posts normalized
snapshots to `/api/sync/partiful`, and activates the recalculated agenda.

Headless sync also calls Partiful's upcoming-events feed and adds newly visible conference-window
Partiful events into the agenda candidate pool. Unknown live Partiful events are scored from their
title/description against the work goal: engineering leaders, founders/operators, DevEx/platform, AI
agents, open source, GitHub workflows, infrastructure, APIs, and enterprise/B2B signals. The
recalculated agenda generates fresh meal/reset and sleep blocks around the selected route instead of
preserving stale logistics placeholders. The default preference profile was recovered from the May
11 Codex scheduling conversation: one-hour meals can compress to 30 minutes on hectic days, sleep
targets 8 hours, and bedtimes should stay as late as workable with no more than 30 minutes of
nightly variance when the selected route allows it.

The app route view has a local `Sync` action that calls `POST /api/sync/partiful/headless`, reads
the local Partiful token from `~/.codex/secrets`, syncs upcoming Partiful state, recalculates, and
activates the new agenda.

Twilio-backed Partiful login automation uses Twilio message logs directly, so it does not need an
inbound webhook or public tunnel. Store Twilio credentials at
`~/.codex/secrets/techweek-twilio-auth.json`:

```json
{
  "version": 1,
  "accountSid": "AC...",
  "authToken": "...",
  "phoneE164": "+18445121476",
  "createdAt": "2026-05-14T00:00:00.000Z",
  "updatedAt": "2026-05-14T00:00:00.000Z"
}
```

Then run:

```bash
deno task partiful:login:twilio
```

It opens Partiful in the separate `techweektwilio` browser session, requests a login code for the
Twilio number, polls Twilio for the latest Partiful OTP, submits the code, and writes the captured
Partiful token to `~/.codex/secrets/techweek-partiful-auth-twilio.json`. The existing
`techweek`/`techweek-partiful-auth.json` path remains the approval-sync account.

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
