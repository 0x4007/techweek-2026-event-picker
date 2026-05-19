# Tech Week 2026 Event Picker Agent Notes

## Project Purpose

This repository is being used to research, rank, schedule, and RSVP to NYC Tech Week 2026 events.

Primary user goal for the current run:
- Follow `docs/handoffs/SIGNUP_AGENT_HANDOFF.md` as the source of truth for what to sign up for.
- Register/apply to the prioritized primary and curated Partiful events first.
- Use backups only when primaries are full, unavailable, too inconvenient after venue reveal, or otherwise blocked.
- Prefer a plus-one when Partiful allows leaving the plus-one as TBD.
- Keep the user hands-off where possible.

## Collaboration Defaults

- Use `localhost:<port>` for local URLs in docs/workflows, never `0.0.0.0:<port>` or `127.0.0.1:<port>`, so passkey sign-in continues to work.

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

The request shape captured from Partiful used:
- `POST https://api.partiful.com/addGuest`
- `rsvp.count: 2`
- `rsvp.status: "PENDING_APPROVAL"` for events requiring host approval.
- `questionnaireResponse.answers` keyed by host questionnaire field IDs.

Do not assume every event has the same questionnaire IDs. Fetch/inspect each event before submitting answers.

Calendar ID scheme:
- Actual Tech Week event IDs are `TW-<rerank_id>`, where `<rerank_id>` is the `id` column from `data/rankings/techweek_nyc_accolades_full_rerank.csv`.
- Scheduled event blocks use `TW-<rerank_id>-SCHEDULE`.
- All-RSVP reference blocks use `TW-<rerank_id>-REFERENCE`.
- Travel-to-event blocks use `TW-<rerank_id>-TRAVEL-IN`.
- Travel-home blocks use `TW-YYYYMMDD-TRAVEL-HOME`.
- Visible calendar titles should not include stable IDs; keep titles human-readable.
- Event descriptions include `TechWeekID`, `CalendarBlockID`, `RerankID`, and `PartifulID` for future dedupe and updates.
- Event descriptions include Google Maps links. Fixed-location blocks use search links; travel blocks use directions links.
- The CSV includes `techweek_id`, `calendar_block_id`, `partiful_id`, and `rerank_id` columns for future updates.

Transit assumptions:
- Developer home anchor is 15 Cliff Street, New York, NY 10038.
- Exact venue addresses are preferred from RSVP status or cached Partiful event pages.
- Hidden venues use neighborhood centroids until hosts reveal exact addresses.
- Routing uses local OSM/Nominatim geocoding, local walking estimates, and SubwayInfo.nyc station-trip estimates.
- Some locations are manually pinned in `scripts/build_signed_up_calendar.py` to avoid bad geocodes, including `1155 6th Ave` and `620 8th Ave`.
- SubwayInfo estimates are current-route estimates, not guaranteed June 2026 service schedules.
