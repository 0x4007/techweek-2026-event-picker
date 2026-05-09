# Google Calendar Sync Status

Last updated: 2026-05-09.

## Current Working Calendar Files

- `techweek_signed_up_operational_with_travel.ics`
  - 30 blocks.
  - Operational route only: 13 event blocks plus 17 transit/walk blocks.
  - This is the file to import into Google Calendar for the actual schedule.

- `techweek_signed_up_all_rsvps_reference.ics`
  - 20 blocks.
  - Alternatives/backups only. Scheduled route events are removed to avoid duplicate rendering.
  - Do not import this into the main busy calendar unless you intentionally want optional events visible.

## What Was Tried

1. Google Calendar connector / MCP
   - No Google Calendar connector tools or resources are exposed in this local runtime.

2. Google Calendar web import
   - `https://calendar.google.com/calendar/u/0/r/settings/import` redirects to the public Google Workspace Calendar page in the DevTools browser.
   - That browser is not logged into Google Calendar.

3. `gcalcli`
   - `pipx run gcalcli` installs and runs.
   - Current `gcalcli` requires a user-provided Google OAuth `client_id` and `client_secret`.
   - No OAuth client is configured locally, so it cannot list calendars or import yet.

4. macOS Calendar.app AppleScript targeting Google-backed `Personal`
   - Calendar.app shows a writable `Personal` calendar with description `pavlovcik@gmail.com`.
   - One bulk write/read pass was too slow and hit AppleEvent timeouts.
   - Day-by-day small batch writes completed successfully on 2026-05-09:
     - June 1: 7 blocks.
     - June 2: 6 blocks.
     - June 3: 9 blocks.
     - June 4: 5 blocks.
     - June 5: 3 blocks.
   - A later count/read verification against `Personal` still timed out, so cloud-side sync should be visually checked in Google Calendar.
   - The day-by-day helper is `sync_google_personal_day_batches.py`.

5. Swift / EventKit
   - `sync_techweek_google_eventkit.swift` was added as a direct EventKit sync attempt.
   - The Swift interpreter and compiled binary were denied Calendar access from this noninteractive session.
   - Leave this script available for a manual retry after granting Calendar permission if desired.

## Recommended Google Import Path

The operational route was also written into the Google-backed macOS `Personal` calendar in small day batches. If Google Calendar sync is enabled for that calendar, those events should appear in Google Calendar after macOS sync catches up.

Because the write path does not delete first, do not rerun it blindly unless duplicate `TW-` events are acceptable.

Open Google Calendar in a browser where you are logged in:

```text
https://calendar.google.com/calendar/u/0/r/settings/import
```

Import:

```text
/Users/nv/repos/0x4007/techweek-2026-event-picker/techweek_signed_up_operational_with_travel.ics
```

Choose the Google calendar you want to use for the actual schedule.

## If You Want CLI Sync Later

Create a Google OAuth Desktop client and then run:

```bash
pipx run gcalcli init
pipx run gcalcli import --calendar "Personal" techweek_signed_up_operational_with_travel.ics
```

Before re-importing, delete existing `TW-` events from the target calendar or use a dedicated Tech Week calendar to avoid duplicates.
