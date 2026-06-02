# Tech Week 2026 Event Picker Agent Notes

## Project Purpose

This repository is being used to research, rank, schedule, and RSVP to NYC Tech Week 2026 events.

Primary user goal for the current run:

- Follow `docs/handoffs/SIGNUP_AGENT_HANDOFF.md` as the source of truth for what to sign up for.
- Register/apply to the prioritized primary and curated Partiful events first.
- Use backups only when primaries are full, unavailable, too inconvenient after venue reveal, or
  otherwise blocked.
- Prefer a plus-one when Partiful allows leaving the plus-one as TBD.
- Keep the user hands-off where possible.

## Collaboration Defaults

- Use `localhost:<port>` for local URLs in docs/workflows, never `0.0.0.0:<port>` or
  `127.0.0.1:<port>`, so passkey sign-in continues to work.

```bash
agent-browser --session techweek snapshot -i
```

If the browser session is expired or Partiful asks for SMS verification again, ask the user for the
new 6-digit code after initiating login.

## Browser Automation

Use `agent-browser` for RSVP work. The active sessions used so far are:

- `techweek`: logged-in Partiful browser session for RSVP flows.
- `techweekfeed`: Tech Week calendar/feed scraping session.
- `techweek-verify`: local Tech Week app session authenticated with an agent token.

Loaded global guidance for browser work:

- `~/.codex/agents/browser-debugging.md`

Useful commands:

```bash
agent-browser --session techweek snapshot -i
agent-browser --session techweek get url
agent-browser --session techweek eval 'document.title'
```

## Local App Debugging

Use `agent-browser` to verify the local app. Always use `localhost:<port>` for local app URLs, never
`0.0.0.0:<port>` or `127.0.0.1:<port>`, so passkey and cookie behavior match the app's expected
origin.

First check whether the app is already running:

```bash
lsof -nP -iTCP:8788 -sTCP:LISTEN || true
curl -fsS http://localhost:8788/api/account/session
```

If no server is listening, start it with `deno task start`. The server auto-selects the next free
port if `8788` is occupied; use the printed port with `localhost:<port>`.

### Local Agent-Token Login

For account-scoped debugging, authenticate `agent-browser` with a user-scoped agent token instead of
using passkeys in the automation browser. A real admin mints the token from
`http://localhost:<port>/auth.html` after passkey login. Tokens are secrets: do not commit them, do
not paste them into docs, and remove/revoke them after verification.

Preferred local token file:

```json
{
  "origin": "http://localhost:8788",
  "session": "techweek-verify",
  "expectedHandle": "m1",
  "token": "techweek_agent_..."
}
```

Store that file at `.codex/techweek-agent-token.json`; it is ignored by git. Then run:

```bash
deno task account:agent-login -- --origin http://localhost:8788
```

If the user provides a token directly in chat for a one-off check, use it only against the requested
local origin:

```bash
deno task account:agent-login -- --origin http://localhost:8788 --session techweek-verify --token 'techweek_agent_...'
```

Successful output should show:

- `auth: "agent_token"`
- the expected `user.handle`
- `isAdmin: true` when admin access is required

### Agenda Verification

After token login, verify the browser context, not just `curl`, because the goal is to prove the
normal `techweek_session` cookie works in `agent-browser`:

```bash
agent-browser --session techweek-verify eval '
(async () => {
  const session = await fetch("/api/account/session", { credentials: "include" }).then((r) => r.json());
  const schedule = await fetch("/api/schedule", { credentials: "include" }).then((r) => r.json());
  return JSON.stringify({
    session: session.session,
    activeAgendaRunId: schedule.state?.activeAgendaRunId || schedule.activeAgenda?.agendaRunId || "",
    counts: schedule.counts,
    next: schedule.next ? {
      title: schedule.next.displayTitle || schedule.next.title || "",
      timeRange: schedule.next.timeRange || "",
      venue: schedule.next.venue || schedule.next.venueQuery || ""
    } : null
  }, null, 2);
})()
'
```

Then open the UI in the same session and confirm the visible account and agenda:

```bash
agent-browser --session techweek-verify open http://localhost:8788/
agent-browser --session techweek-verify wait 1200
agent-browser --session techweek-verify eval '
(() => JSON.stringify({
  title: document.title,
  accountLabel: document.querySelector("[data-account-label]")?.textContent?.trim() || "",
  accountButton: document.querySelector("[data-account-button]")?.getAttribute("aria-label") || "",
  visibleTextSample: document.body.innerText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20)
}, null, 2))()
'
```

The UI check should report `Signed in as <handle>` and show the same next agenda block returned by
`/api/schedule`.

## Deno Deploy

Before preview or production deploys, read `docs/handoffs/DENO_DEPLOY_FINDINGS.md`. It captures the
working credential source, deploy-root staging command, preview deploy command, production flag
difference, and auth-hub allowlist caveat for preview URLs.

## UI Contrast Guardrails

White-on-white or otherwise unreadable controls are release-blocking defects. For every HTML/CSS or
frontend behavior change, inspect the rendered UI in a browser before final handoff and verify every
visible button, link styled as a button, nav tab, and disabled/loading/auth state has readable
foreground/background contrast.

Button rules:

- Never place white or near-white text/icons on a white, near-white, translucent-white, or
  light-muted button background.
- Disabled buttons must stay readable; do not rely on opacity if it makes text blend into the
  button fill.
- If a button background can become light in any state, explicitly set dark text/icon color for that
  state.
- If a button background can become dark or accent-colored in any state, explicitly set a readable
  light text/icon color for that state.
- Verify both unauthenticated and authenticated account states because auth state often changes
  button labels, colors, and disabled behavior.

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
- Do not claim false credentials, affiliations, investor status, student status, location, or
  experience.
- For "why attend" questions, use a concise founder/operator networking answer.
- For technology interest questions, prefer product, AI, founders, infrastructure, GTM, and NYC tech
  ecosystem answers when appropriate.
- For uncertain multiple-choice questions, choose the most general truthful option.

Skip or record as blocked when:

- Payment is required.
- A CAPTCHA or anti-abuse challenge appears.
- A required answer would need information the profile does not provide and a truthful generic
  answer is not possible.
- The event is invite-only, private, unavailable, sold out without waitlist, or lacks a working RSVP
  path.

The request shape captured from Partiful used:

- `POST https://api.partiful.com/addGuest`
- `rsvp.count: 2`
- `rsvp.status: "PENDING_APPROVAL"` for events requiring host approval.
- `questionnaireResponse.answers` keyed by host questionnaire field IDs.

Do not assume every event has the same questionnaire IDs. Fetch/inspect each event before submitting
answers.

Calendar ID scheme:

- Actual Tech Week event IDs are `TW-<rerank_id>`, where `<rerank_id>` is the `id` column from
  `data/rankings/techweek_nyc_accolades_full_rerank.csv`.
- Scheduled event blocks use `TW-<rerank_id>-SCHEDULE`.
- All-RSVP reference blocks use `TW-<rerank_id>-REFERENCE`.
- Travel-to-event blocks use `TW-<rerank_id>-TRAVEL-IN`.
- Travel-home blocks use `TW-YYYYMMDD-TRAVEL-HOME`.
- Visible calendar titles should not include stable IDs; keep titles human-readable.
- Event descriptions include `TechWeekID`, `CalendarBlockID`, `RerankID`, and `PartifulID` for
  future dedupe and updates.
- Event descriptions include Google Maps links. Fixed-location blocks use search links; travel
  blocks use directions links.
- The CSV includes `techweek_id`, `calendar_block_id`, `partiful_id`, and `rerank_id` columns for
  future updates.

Transit assumptions:

- Developer home anchor is 15 Cliff Street, New York, NY 10038.
- Exact venue addresses are preferred from RSVP status or cached Partiful event pages.
- Hidden venues use neighborhood centroids until hosts reveal exact addresses.
- Routing uses local OSM/Nominatim geocoding, local walking estimates, and SubwayInfo.nyc
  station-trip estimates.
- Some locations are manually pinned in `scripts/build_signed_up_calendar.py` to avoid bad geocodes,
  including `1155 6th Ave` and `620 8th Ave`.
- SubwayInfo estimates are current-route estimates, not guaranteed June 2026 service schedules.
