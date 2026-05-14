# Agenda Preference Profile Prompt

Use this prompt when creating or updating a user's agenda preference profile for dynamic Tech Week
recalculation. Preferences should be saved as structured data compatible with
`AgendaUserPreferences` in `app/lib/agenda_preferences.ts`; this Markdown file is the human-readable
policy that explains how to interpret the fields.

## Current Default User Preferences

These preferences were recovered from local Codex history for this repository on May 11, 2026.

- Treat `event`, `travel`, `eating`, and `sleeping` as first-class schedule block types.
- Every active conference day should start with a generated morning routine block followed
  immediately by breakfast.
- The default morning routine is one hour to get ready.
- The default breakfast block is one hour and should be the first food block of the day.
- Place morning routine and breakfast dynamically after generated sleep when that prior sleep block
  exists; otherwise place them before the first generated departure or first event. Do not use a
  fixed wall-clock time.
- Schedule food every conference day when possible.
- Prefer one-hour meal/reset blocks.
- On hectic days, meals may compress to 30 minutes.
- Do not place regular lunch or dinner before the generated breakfast block.
- Prefer meal timing consistency within 30 minutes from day to day when the event route allows it.
- Use this priority order when schedule classes conflict: sleep first, then work events, then travel
  feasibility, then food. Sleep rules are hard; food timing is soft and may yield to strong work
  events and feasible travel.
- Schedule sleep as 8-hour blocks.
- Group overnight sleep on the wake-up day so that morning routine visibly trails sleep.
- If an active day has a morning routine but no generated same-day wake-up sleep, insert a pre-day
  sleep block ending exactly when morning routine starts.
- Prefer sleep as late as workable because the user is not a morning person.
- Keep bedtime variance between adjacent nights within 30 minutes when route constraints allow it.
- If Monday sleep starts at 2:00 a.m., Tuesday should ideally start no earlier than 1:30 a.m. and no
  later than 2:30 a.m.
- Use early-morning events before 7:00 a.m. only when explicitly pinned.
- Optimize event selection for the work goal: engineering leaders, DevEx/platform, AI agents, open
  source, GitHub workflows, infrastructure, APIs, founders/operators, and enterprise/B2B relevance.

## Future User Intake

When another user logs in or states preferences, collect these fields without adding new environment
variables or secrets:

- `logistics.morning.enabled`: whether to generate morning routine and breakfast blocks.
- `logistics.morning.getReadyMinutes`: time needed to get ready before breakfast.
- `logistics.morning.breakfastMinutes`: breakfast duration immediately after getting ready.
- `logistics.meals.maximumDailyShiftMinutes`: ideal maximum day-to-day meal timing movement.
- `logistics.meals.windows`: preferred food windows, ideal duration, and minimum duration.
- `logistics.sleep.targetMinutes`: target sleep duration.
- `logistics.sleep.minimumMinutes`: minimum acceptable sleep before warning.
- `logistics.sleep.preferredLatestBedtime`: the latest preferred bedtime for normal nights.
- `logistics.sleep.maximumNightlyVarianceMinutes`: allowed night-to-night bedtime movement.
- `logistics.sleep.windDownAfterLastEventMinutes`: normal decompression time after the last event.
- `logistics.sleep.nextMorningPrepMinutes`: time needed before the first next-day event.
- `planning.blockPriorities`: ranked schedule class priorities for conflict resolution.
- `planning.excludeUnpinnedEventsBefore`: earliest allowed unpinned event start time.
- `planning.workFitPositiveSignals`: regex-compatible signals that should improve event fit.
- `planning.workFitNegativeSignals`: regex-compatible signals that should reduce event fit.

The deterministic scheduler should consume the structured profile. LLM agents should use this prompt
only to explain, collect, or revise user preferences.
