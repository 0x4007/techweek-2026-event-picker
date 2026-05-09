# Tech Week 2026 Event Picker Agent Notes

## Project Purpose

This repository is being used to research, rank, schedule, and RSVP to NYC Tech Week 2026 events.

Primary user goal for the current run:
- Follow `SIGNUP_AGENT_HANDOFF.md` as the source of truth for what to sign up for.
- Register/apply to the prioritized primary and curated Partiful events first.
- Use backups only when primaries are full, unavailable, too inconvenient after venue reveal, or otherwise blocked.
- Prefer a plus-one when Partiful allows leaving the plus-one as TBD.
- Keep the user hands-off where possible.

## Local Handoff

Before continuing RSVP work, read:
- `SIGNUP_STATE_HANDOFF.md`
- `SIGNUP_AGENT_HANDOFF.md`
- `BACKUP_SIGNUP_AGENT_HANDOFF.md`
- `.codex/techweek-rsvp-profile.json`

Those files intentionally live locally in this repo so future agents have the event priority, attendee profile, answer policy, current browser session name, and known progress.

Version-control note:
- `.codex/techweek_signup_status.csv` is safe to track as the row-level RSVP status file.
- `.codex/techweek-rsvp-profile.json` includes personal contact details and is intentionally ignored by `.gitignore`.

Do not store transient Partiful/Firebase bearer tokens in repo files. Use the live browser session when available:

```bash
agent-browser --session techweek snapshot -i
```

If the browser session is expired or Partiful asks for SMS verification again, ask the user for the new 6-digit code after initiating login.

## Browser Automation

Use `agent-browser` for RSVP work. The active sessions used so far are:
- `techweek`: logged-in Partiful browser session for RSVP flows.
- `techweekfeed`: Tech Week calendar/feed scraping session.

Loaded global guidance for browser work:
- `~/.codex/agents/browser-debugging.md`

Useful commands:

```bash
agent-browser --session techweek snapshot -i
agent-browser --session techweek get url
agent-browser --session techweek eval 'document.title'
```

## Data Sources

Tech Week NYC calendar:
- `https://www.tech-week.com/calendar/nyc`

Calendar API discovered from the page:
- `POST /calendar/api/trpc/calendar.events?batch=1`
- Input shape includes `city: "nyc"`, `cursor`, `direction: "forward"`, and filters.

As of the latest feed pull:
- Total NYC Tech Week listings: `1401`
- Open listings with external RSVP links: `1204`
- Invite-only listings: `166`
- Open listings with no RSVP link: `31`
- All open external links found were on `partiful.com`

## RSVP Policy

Use the profile values in `.codex/techweek-rsvp-profile.json`.

For free/open Partiful events:
- Use the attendee name and phone from the profile.
- Use the profile email, LinkedIn URL, company, and title for host questions when asked.
- Add plus-one when Partiful allows "Skip, leave as TBD" or equivalent.
- Leave optional open-ended note/message fields blank unless the host requires an answer.
- For event-specific required questions, answer concisely and consistently with the profile.
- Do not claim false credentials, affiliations, investor status, student status, location, or experience.
- For "why attend" questions, use a concise founder/operator networking answer.
- For technology interest questions, prefer product, AI, founders, infrastructure, GTM, and NYC tech ecosystem answers when appropriate.
- For uncertain multiple-choice questions, choose the most general truthful option.

Skip or record as blocked when:
- Payment is required.
- A CAPTCHA or anti-abuse challenge appears.
- A required answer would need information the profile does not provide and a truthful generic answer is not possible.
- The event is invite-only, private, unavailable, sold out without waitlist, or lacks a working RSVP path.

## Known Progress

Current signup results are recorded in:
- `.codex/techweek_signup_status.csv`

Summary as of 2026-05-09:
- 12 primary targets from `SIGNUP_AGENT_HANDOFF.md` submitted.
- 9 apply/curated targets from `SIGNUP_AGENT_HANDOFF.md` submitted.
- 12 backup targets from `BACKUP_SIGNUP_AGENT_HANDOFF.md` processed.
- 4 direct registrations are marked `registered`.
- 29 targets are marked `applied` / pending host approval.
- 1 target is marked `waitlisted`.
- No Partiful signup blockers remain.
- `Camp AI: Agents at Work` was submitted after the user confirmed age 21+.
- `Software for Hardware` is registered on Partiful, but its secondary Luma ticket is a $20 paid checkout. User explicitly said not to complete it; keep it unpaid/skipped.
- `Steal These AI Workflows` has both the Partiful application and secondary Google Form build submission completed.

The first tested event, submitted before the priority handoff was read, was submitted successfully as an application:
- Event: `4am IRR - for the inner IRR nerd in you!`
- URL: `https://partiful.com/e/iyeVYNaUJxZqidnHixwa`
- Status shown after submission: `Pending`
- Count submitted: `2` including a TBD plus-one.

The request shape captured from Partiful used:
- `POST https://api.partiful.com/addGuest`
- `rsvp.count: 2`
- `rsvp.status: "PENDING_APPROVAL"` for events requiring host approval.
- `questionnaireResponse.answers` keyed by host questionnaire field IDs.

Do not assume every event has the same questionnaire IDs. Fetch/inspect each event before submitting answers.

## Calendar / Schedule State

The transport-aware signed-up calendar was generated and synced to Apple Calendar on 2026-05-09.

Current generated files:
- `build_signed_up_calendar.py`: source of truth for regenerating the signed-up calendar artifacts.
- `techweek_signed_up_transport_schedule.md`: human-readable operational route plus all-RSVP reference.
- `techweek_signed_up_transport_schedule.csv`: spreadsheet-friendly output with stable IDs, route blocks, and RSVP metadata.
- `techweek_signed_up_transport_schedule.xlsx`: Excel version of the same schedule.
- `techweek_signed_up_operational_with_travel.ics`: importable event + transit-block route calendar.
- `techweek_signed_up_all_rsvps_reference.ics`: importable reference calendar containing every submitted non-test RSVP.
- `sync_techweek_to_apple_calendar.applescript`: Calendar.app sync script generated by `build_signed_up_calendar.py`.

Apple Calendar sync behavior:
- Creates/updates `NY Tech Week 2026 - Schedule`.
- Creates/updates `NY Tech Week 2026 - All RSVPs`.
- Deletes only events in those two dedicated calendars whose start date is June 1-7, 2026 before recreating them.
- Does not touch the user's other calendars.
- To resync after edits, run:

```bash
python3 build_signed_up_calendar.py
osascript sync_techweek_to_apple_calendar.applescript
```

Calendar ID scheme:
- Actual Tech Week event IDs are `TW-<rerank_id>`, where `<rerank_id>` is the `id` column from `techweek_nyc_accolades_full_rerank.csv`.
- Scheduled event blocks use `TW-<rerank_id>-SCHEDULE`.
- All-RSVP reference blocks use `TW-<rerank_id>-REFERENCE`.
- Travel-to-event blocks use `TW-<rerank_id>-TRAVEL-IN`.
- Travel-home blocks use `TW-YYYYMMDD-TRAVEL-HOME`.
- The visible calendar title includes the stable ID.
- Event descriptions include `TechWeekID`, `CalendarBlockID`, `RerankID`, and `PartifulID`.
- The CSV includes `techweek_id`, `calendar_block_id`, `partiful_id`, and `rerank_id` columns for future updates.

Operational route currently blocks 13 events and 17 transit blocks:
- `TW-6408` Mon 2026-06-01 14:00 Beyond the Spec.
- `TW-44` Mon 2026-06-01 16:00 From Vibe Coding.
- `TW-5978` Mon 2026-06-01 18:00 Open Source Must Win.
- `TW-4551` Tue 2026-06-02 12:00 AI in Enterprise SDLC.
- `TW-4341` Tue 2026-06-02 16:00 From Copilot to Control Plane.
- `TW-4161` Tue 2026-06-02 18:00 Future of DevEx.
- `TW-5889` Wed 2026-06-03 12:00 Building secure AI.
- `TW-4444` Wed 2026-06-03 14:00 Future of Coding Agents and IDE.
- `TW-5529` Wed 2026-06-03 16:00 Fireside chat - When coding agents are the user? (`registered`).
- `TW-4664` Wed 2026-06-03 18:00 MCP in the Wild.
- `TW-5372` Thu 2026-06-04 16:00 Shipping Faster with AI Coding Agents.
- `TW-5114` Thu 2026-06-04 19:00 Stop Making AI Guess (`registered`).
- `TW-5722` Fri 2026-06-05 17:00 Bare Metal Happy Hour.

All-RSVP reference calendar excludes the earlier `4am IRR` test submission. Its current non-test snapshot is:
- 33 total submitted RSVPs.
- 4 registered.
- 28 applied / pending approval.
- 1 waitlisted.

Transit assumptions:
- Home anchor is FiDi / Wall St station.
- Exact venue addresses are preferred from RSVP status or cached Partiful event pages.
- Hidden venues use neighborhood centroids until hosts reveal exact addresses.
- Routing uses local OSM/Nominatim geocoding, local walking estimates, and SubwayInfo.nyc station-trip estimates.
- Some locations are manually pinned in `build_signed_up_calendar.py` to avoid bad geocodes, including `1155 6th Ave` and `620 8th Ave`.
- SubwayInfo estimates are current-route estimates, not guaranteed June 2026 service schedules.
