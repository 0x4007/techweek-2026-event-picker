# Tech Week 2026 Event Picker

Local workspace for researching, ranking, scheduling, and tracking NYC Tech Week 2026 events.

## Layout

- `AGENTS.md` - operational instructions for future agents.
- `.codex/` - active RSVP state and ignored personal profile data.
- `scripts/` - Python utilities for ranking, schedule generation, calendar sync helpers, and email checks.
- `data/source/` - raw Tech Week calendar exports and the ignored Partiful page cache.
- `data/rankings/` - scored/reranked event outputs and shortlist data.
- `data/cache/` - geocoding, subway, and routing caches used by schedule generators.
- `outputs/accolades/` - generated pre-RSVP planning calendars and detailed travel schedule.
- `outputs/signed_up/` - generated signed-up operational schedule, reference calendar, CSV, XLSX, and ICS files.
- `outputs/sync/` - generated AppleScript/EventKit calendar sync helpers.
- `docs/handoffs/` - RSVP handoff docs and signup priorities.
- `docs/agenda/` - user-facing agenda in Markdown, HTML, and DOCX.
- `docs/calendar/` - calendar sync notes.

## Common Commands

```bash
python3 scripts/build_signed_up_calendar.py
python3 scripts/sync_google_personal_day_batches.py --dry-run
python3 scripts/check_techweek_acceptance_emails.py
```

The private RSVP profile stays ignored at `.codex/techweek-rsvp-profile.json`; keep it out of generated docs and tracked outputs.
