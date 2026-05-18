import { type AgendaScheduleEntry, recalculateAgenda } from "./agenda_recalculate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("recalculateAgenda generates meals and sleep around selected events", async () => {
  const entries: AgendaScheduleEntry[] = [
    eventEntry("TW-1", "Engineering Leaders Breakfast", "2026-06-01 10:00", "2026-06-01 11:00"),
    eventEntry("TW-2", "AI Agents Dinner", "2026-06-01 18:00", "2026-06-01 20:00"),
    {
      calendar: "schedule",
      calendarBlockId: "OLD-SLEEP",
      entryType: "sleep",
      blockType: "sleeping",
      start: "2026-06-01 20:00",
      end: "2026-06-02 04:00",
    },
  ];

  const agenda = await recalculateAgenda({
    scheduleEntries: entries,
    overrides: { includeReturnHome: false },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 20,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const logistics = agenda.selectedBlocks.filter((block) => block.source === "generated_logistics");
  assert(
    logistics.some((block) => block.blockType === "eating"),
    "Expected generated meal/reset block.",
  );
  assert(
    logistics.some((block) => block.blockType === "sleeping"),
    "Expected generated sleep block.",
  );
  assert(
    !agenda.selectedBlocks.some((block) => block.calendarBlockId === "OLD-SLEEP"),
    "Expected old fixed sleep block to be redesigned by default.",
  );
  assert(agenda.summary.generatedLogisticsBlocks >= 2, "Expected logistics summary count.");
});

Deno.test("recalculateAgenda excludes unpinned pre-7am events", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry("TW-early", "4am IRR - #NYTechWeek", "2026-06-01 04:00", "2026-06-01 05:00"),
      eventEntry(
        "TW-day",
        "Open Source Maintainer Roundtable",
        "2026-06-01 14:00",
        "2026-06-01 15:00",
      ),
    ],
    overrides: { includeReturnHome: false },
    generatedAt: "2026-05-14T12:00:00Z",
  });

  assert(
    !agenda.selectedEvents.some((block) => block.techweekId === "TW-early"),
    "Expected unpinned 4am event to be excluded.",
  );
  assert(
    agenda.droppedEvents.some((drop) => drop.event.techweekId === "TW-early"),
    "Expected early event to be reported as dropped.",
  );
});

Deno.test("recalculateAgenda schedules sleep late with low nightly variance", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry("TW-night-1", "AI Agents Dinner", "2026-06-01 18:00", "2026-06-01 19:00"),
      eventEntry(
        "TW-night-2",
        "Engineering Leadership Salon",
        "2026-06-02 16:00",
        "2026-06-02 17:00",
      ),
    ],
    overrides: { includeReturnHome: false },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 20,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const sleepBlocks = agenda.selectedBlocks.filter((block) => block.blockType === "sleeping");
  assert(sleepBlocks.length >= 2, "Expected generated sleep blocks for both route days.");
  const overnightSleeps = sleepBlocks.filter((block) => block.start.endsWith("03:30"));
  assert(overnightSleeps.length >= 2, "Expected late overnight sleep blocks after route days.");
  assert(
    overnightSleeps[0].start.endsWith("03:30"),
    `Expected first overnight sleep block to start late; got ${overnightSleeps[0].start}.`,
  );
  assert(
    overnightSleeps[1].start.endsWith("03:30"),
    `Expected second overnight sleep block to preserve bedtime variance; got ${
      overnightSleeps[1].start
    }.`,
  );
  const secondDayMorning = agenda.selectedBlocks.find((block) =>
    block.dayKey === "2026-06-02" && block.category === "morning"
  );
  assert(secondDayMorning, "Expected second day morning routine.");
  const secondDayWakeSleep = sleepBlocks.find((block) =>
    block.dayKey === secondDayMorning.dayKey && block.endEpochMs === secondDayMorning.startEpochMs
  );
  assert(secondDayWakeSleep, "Expected second day wake-up sleep to trail into morning.");
  assert(
    secondDayWakeSleep.start.endsWith("03:30"),
    "Expected overnight sleep to be grouped on the wake-up day with morning.",
  );
  assert(
    secondDayMorning.startEpochMs === secondDayWakeSleep.endEpochMs,
    "Expected the next day to start with morning routine immediately after generated sleep.",
  );
});

Deno.test("recalculateAgenda starts active days with morning routine and breakfast", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry(
        "TW-morning",
        "Developer Tools Masterclass",
        "2026-06-01 14:00",
        "2026-06-01 15:00",
      ),
    ],
    overrides: { includeReturnHome: false },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 20,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const morning = agenda.selectedBlocks.find((block) => block.category === "morning");
  const breakfast = agenda.selectedBlocks.find((block) => block.category === "breakfast");
  assert(morning, "Expected a generated morning routine block.");
  assert(breakfast, "Expected a generated breakfast block.");
  assert(
    morning.start === "2026-06-01 11:30" && morning.end === "2026-06-01 12:30",
    `Expected one-hour morning routine before breakfast; got ${morning.start}-${morning.end}.`,
  );
  const sleep = agenda.selectedBlocks.find((block) => block.blockType === "sleeping");
  assert(sleep, "Expected a generated sleep block before the first morning routine.");
  assert(
    sleep.endEpochMs === morning.startEpochMs,
    "Expected first-day morning routine to start immediately after sleep.",
  );
  assert(
    breakfast.start === "2026-06-01 12:30" && breakfast.end === "2026-06-01 13:30",
    `Expected one-hour breakfast immediately before first departure; got ${breakfast.start}-${breakfast.end}.`,
  );
  assert(
    agenda.selectedBlocks
      .filter((block) => block.category === "meal")
      .every((block) => block.startEpochMs >= breakfast.endEpochMs),
    "Expected regular meal blocks to stay after breakfast.",
  );
});

Deno.test("recalculateAgenda prefers consistent meal timing when route constraints allow it", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry("TW-dinner-1", "Late Platform Dinner", "2026-06-01 17:00", "2026-06-01 20:00"),
      eventEntry("TW-dinner-2", "Afternoon DevEx Session", "2026-06-02 12:00", "2026-06-02 13:00"),
    ],
    overrides: { includeReturnHome: false },
    preferences: {
      logistics: {
        meals: {
          windows: [
            {
              id: "DINNER",
              label: "Dinner / reset",
              start: "17:00",
              end: "22:00",
              preferredMinutes: 60,
              minimumMinutes: 30,
            },
          ],
        },
      },
    },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 0,
      details: "same venue",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const dinners = agenda.selectedBlocks
    .filter((block) => block.blockType === "eating" && block.category === "meal")
    .sort((a, b) => a.startEpochMs - b.startEpochMs);
  assert(dinners.length >= 2, "Expected dinner blocks on both days.");
  assert(
    dinners[0].start.endsWith("20:00"),
    `Expected first dinner after the late event; got ${dinners[0].start}.`,
  );
  assert(
    dinners[1].start.endsWith("19:30"),
    `Expected second dinner within 30 minutes of prior dinner; got ${dinners[1].start}.`,
  );
});

Deno.test("recalculateAgenda compresses meals to the user minimum on hectic days", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry(
        "TW-tight",
        "Platform Engineering Session",
        "2026-06-01 13:00",
        "2026-06-01 13:15",
      ),
    ],
    overrides: { includeReturnHome: false },
    preferences: {
      logistics: {
        meals: {
          windows: [
            {
              id: "SNACK",
              label: "Food / reset",
              start: "13:00",
              end: "13:45",
              preferredMinutes: 60,
              minimumMinutes: 30,
            },
          ],
        },
      },
    },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 0,
      details: "same venue",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const meal = agenda.selectedBlocks.find((block) =>
    block.blockType === "eating" && block.category === "meal"
  );
  assert(meal, "Expected compressed generated meal block.");
  assert(
    meal.endEpochMs - meal.startEpochMs === 30 * 60 * 1000,
    "Expected meal block to compress to 30 minutes.",
  );
});

Deno.test("recalculateAgenda keeps final meals near the last event before returning home", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry(
        "TW-dinner",
        "Open Source Dinner",
        "2026-06-01 18:00",
        "2026-06-01 20:00",
        {
          location: "New York, NY",
          venueQuery: "Delancey St Essex St, New York, NY",
          venuePrecision: "approx_neighborhood_hidden",
        },
      ),
    ],
    preferences: {
      logistics: {
        meals: {
          windows: [
            {
              id: "DINNER",
              label: "Dinner / reset",
              start: "19:00",
              end: "22:00",
              preferredMinutes: 60,
              minimumMinutes: 30,
            },
          ],
        },
      },
    },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 20,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const meal = agenda.selectedBlocks.find((block) =>
    block.blockType === "eating" && block.category === "meal"
  );
  assert(meal, "Expected generated dinner block.");
  assert(
    meal.venueQuery === "Delancey St Essex St, New York, NY",
    `Expected dinner to stay near the final event; got ${meal.venueQuery}.`,
  );
  const returnHome = agenda.selectedBlocks.find((block) =>
    block.calendarBlockId.endsWith("-TRAVEL-HOME")
  );
  assert(returnHome, "Expected return-home travel block.");
  assert(
    returnHome.startEpochMs >= meal.endEpochMs,
    "Expected return-home travel to start after the final meal.",
  );
});

Deno.test("recalculateAgenda reuses stored travel blocks before live route fallback", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry(
        "TW-first",
        "From Copilot to Control Plane",
        "2026-06-02 16:00",
        "2026-06-02 17:30",
      ),
      {
        calendar: "schedule",
        techweekId: "TW-second",
        calendarBlockId: "TW-second-TRAVEL-IN",
        entryType: "travel",
        blockType: "travel",
        title: "Travel: From Copilot to Control Plane -> Future of DevEx",
        location: "From Copilot to Control Plane -> SoHo",
        venueQuery: "From Copilot to Control Plane -> Spring St and Broadway, New York, NY",
        routeMode: "subway+walk",
        travelMinutes: "24",
        routeDetails: "stored route",
      },
      eventEntry("TW-second", "Future of DevEx", "2026-06-02 18:00", "2026-06-02 21:00", {
        location: "SoHo",
        venueQuery: "Spring St and Broadway, New York, NY",
      }),
    ],
    overrides: { includeReturnHome: false, generateLogisticsBlocks: false },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 60,
      details: "too slow live fallback",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  assert(
    agenda.selectedEvents.some((block) => block.techweekId === "TW-second"),
    "Expected stored travel estimate to keep the second event feasible.",
  );
  const travel = agenda.travelBlocks.find((block) => block.techweekId === "TW-second");
  assert(
    travel?.travelMinutes === 24,
    `Expected stored 24-minute route; got ${travel?.travelMinutes}.`,
  );
});

Deno.test("recalculateAgenda labels latest-departure gaps as buffer blocks", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry("TW-a", "Spec Masterclass", "2026-06-01 14:00", "2026-06-01 15:00", {
        location: "Flatiron",
        venueQuery: "1 Madison Ave, New York, NY 10010",
      }),
      eventEntry("TW-b", "Vibe Coding", "2026-06-01 16:00", "2026-06-01 17:00", {
        location: "NoMad",
        venueQuery: "135 Madison Ave, New York, NY",
      }),
    ],
    overrides: { includeReturnHome: false },
    routeEstimator: ({ origin }) => ({
      mode: "estimated",
      minutes: origin.id === "home" ? 20 : 10,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const buffer = agenda.selectedBlocks.find((block) =>
    block.blockType === "other" && block.category === "buffer"
  );
  assert(buffer, "Expected a generated buffer block before latest-departure travel.");
  assert(
    buffer.start === "2026-06-01 15:00",
    `Expected buffer to start after event; got ${buffer.start}.`,
  );
  assert(
    buffer.end === "2026-06-01 15:50",
    `Expected buffer to end at departure; got ${buffer.end}.`,
  );
});

Deno.test("recalculateAgenda excludes not-going statuses without blocking going statuses", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry("TW-going", "Going Status Event", "2026-06-01 14:00", "2026-06-01 15:00", {
        status: "going",
      }),
      eventEntry("TW-not-going", "Declined Event", "2026-06-01 16:00", "2026-06-01 17:00", {
        status: "not going",
      }),
      eventEntry(
        "TW-not-going-token",
        "Provider Declined Event",
        "2026-06-01 18:00",
        "2026-06-01 19:00",
        {
          status: "NOT_GOING",
        },
      ),
    ],
    overrides: { includeReturnHome: false, generateLogisticsBlocks: false },
    generatedAt: "2026-05-14T12:00:00Z",
  });

  assert(
    agenda.selectedEvents.some((block) => block.techweekId === "TW-going"),
    "Expected positive going status to remain eligible.",
  );
  for (const techweekId of ["TW-not-going", "TW-not-going-token"]) {
    assert(
      !agenda.selectedEvents.some((block) => block.techweekId === techweekId),
      `Expected ${techweekId} to be excluded.`,
    );
    assert(
      agenda.droppedEvents.some((drop) =>
        drop.event.techweekId === techweekId && drop.reason === "status_excluded"
      ),
      `Expected ${techweekId} to be dropped for status exclusion.`,
    );
  }
});

Deno.test("recalculateAgenda preserves hard fixed blocks over return-home travel", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry("TW-evening", "Evening Demo", "2026-06-01 18:00", "2026-06-01 20:00"),
      {
        calendar: "schedule",
        calendarBlockId: "HARD-FOLLOW-UP",
        entryType: "other",
        blockType: "other",
        start: "2026-06-01 20:15",
        end: "2026-06-01 21:15",
        actualStart: "2026-06-01 20:15",
        actualEnd: "2026-06-01 21:15",
        title: "Hard follow-up block",
        displayTitle: "Hard follow-up block",
        location: "New York, NY",
      },
    ],
    overrides: {
      preserveFixedBlocks: true,
      hardFixedBlockIds: ["HARD-FOLLOW-UP"],
      includeReturnHome: true,
      generateLogisticsBlocks: false,
    },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 60,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const hardBlock = agenda.selectedBlocks.find((block) =>
    block.calendarBlockId === "HARD-FOLLOW-UP"
  );
  assert(hardBlock, "Expected hard fixed block to be preserved.");
  assert(
    !agenda.travelBlocks.some((block) => block.calendarBlockId === "TW-20260601-TRAVEL-HOME"),
    "Expected overlapping return-home travel to be omitted.",
  );
  assert(
    agenda.warnings.some((warning) => warning.code === "return_home_fixed_block_conflict"),
    "Expected warning for omitted return-home travel.",
  );
  for (const block of agenda.selectedBlocks) {
    if (block.calendarBlockId === hardBlock.calendarBlockId) continue;
    assert(
      !(
        hardBlock.startEpochMs < block.endEpochMs &&
        block.startEpochMs < hardBlock.endEpochMs
      ),
      `Expected no overlap with hard fixed block, got ${block.calendarBlockId}.`,
    );
  }
});

Deno.test("recalculateAgenda keeps generated routes consistent with a non-default time zone", async () => {
  const agenda = await recalculateAgenda({
    scheduleEntries: [
      eventEntry(
        "TW-la",
        "AI Agents Workshop",
        "2026-06-01 14:00",
        "2026-06-01 15:00",
      ),
    ],
    timeZone: "America/Los_Angeles",
    overrides: {
      generateLogisticsBlocks: false,
      includeReturnHome: false,
    },
    routeEstimator: () => ({
      mode: "estimated",
      minutes: 30,
      details: "test route",
    }),
    generatedAt: "2026-05-14T12:00:00Z",
  });

  const event = agenda.selectedEvents.find((block) => block.techweekId === "TW-la");
  assert(event, "Expected LA event to be selected.");
  assert(event.start === "2026-06-01 14:00", "Expected event to display in LA local time.");
  assert(
    event.startEpochMs === Date.parse("2026-06-01T21:00:00Z"),
    "Expected LA 14:00 to parse as 21:00 UTC during daylight time.",
  );

  const travel = agenda.travelBlocks.find((block) => block.techweekId === "TW-la");
  assert(travel, "Expected generated travel to the LA event.");
  assert(
    travel.end === event.start,
    `Expected travel to end at event local start, got ${travel.end}.`,
  );
  assert(
    travel.endEpochMs === event.startEpochMs,
    "Expected travel end epoch to match event start epoch.",
  );
});

function eventEntry(
  techweekId: string,
  title: string,
  start: string,
  end: string,
  options: Partial<AgendaScheduleEntry> = {},
): AgendaScheduleEntry {
  return {
    calendar: "reference",
    techweekId,
    calendarBlockId: `${techweekId}-REFERENCE`,
    entryType: "event",
    blockType: "event",
    status: "registered",
    category: "discovered",
    start,
    end,
    actualStart: start,
    actualEnd: end,
    title,
    displayTitle: title,
    location: options.location ?? "New York, NY",
    venueQuery: options.venueQuery ?? "New York, NY",
    venuePrecision: options.venuePrecision ?? "",
    opportunityScore: 80,
    ...options,
  };
}
