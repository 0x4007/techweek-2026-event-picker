import {
  buildLeadFollowUpEmailContent,
  deriveLeadPriorityFromEvent,
  extractEmailAddress,
  fallbackAgentAnswer,
  parseCsv,
  router,
  type ScheduleEntry,
  sendResendTestEmail,
  statusLabelForScheduleStatus,
} from "./server.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("parseCsv handles quoted multiline fields", () => {
  const rows = parseCsv(
    'id,title,note\n1,"Hello, NYC","line one\nline two"\n2,Plain,"A ""quote"""',
  );
  assertEquals(rows, [
    { id: "1", title: "Hello, NYC", note: "line one\nline two" },
    { id: "2", title: "Plain", note: 'A "quote"' },
  ]);
});

Deno.test("parseCsv removes UTF-8 BOM", () => {
  const rows = parseCsv("\ufeffid,title\nTW-1,Event");
  assertEquals(rows, [{ id: "TW-1", title: "Event" }]);
});

Deno.test("extractEmailAddress returns the first email from a mixed contact field", () => {
  assertEquals(
    extractEmailAddress("linkedin.com/in/e2e; lead@example.com; +1 555 111 2222"),
    "lead@example.com",
  );
});

Deno.test("statusLabelForScheduleStatus follows live Partiful status", () => {
  assertEquals(statusLabelForScheduleStatus("registered", "PENDING"), "REG");
  assertEquals(statusLabelForScheduleStatus("PENDING_APPROVAL", "REG"), "PENDING");
  assertEquals(statusLabelForScheduleStatus("WAITLISTED_FOR_APPROVAL", "PENDING"), "WAITLIST");
});

Deno.test("buildLeadFollowUpEmailContent escapes HTML and includes event context", () => {
  const content = buildLeadFollowUpEmailContent({
    leadName: "Ada <Lovelace>",
    eventTitle: "Future of DevEx",
    followUp: "20 minute repo review",
    from: "Nik <followups@example.com>",
  });
  if (!content.subject.includes("Future of DevEx")) {
    throw new Error(`Expected subject to include event title, got ${content.subject}`);
  }
  if (!content.text.includes("Hi Ada,")) {
    throw new Error(`Expected first-name greeting, got ${content.text}`);
  }
  if (!content.text.includes("20 minute repo review")) {
    throw new Error("Expected follow-up note in text body.");
  }
  if (content.html.includes("<Lovelace>")) {
    throw new Error(`Expected HTML escaping, got ${content.html}`);
  }
});

Deno.test("deriveLeadPriorityFromEvent uses event ranking metadata", () => {
  assertEquals(deriveLeadPriorityFromEvent(scheduleEntry({ tier: "S" })), "A");
  assertEquals(
    deriveLeadPriorityFromEvent(scheduleEntry({ tier: "A", opportunityScore: "63" })),
    "A",
  );
  assertEquals(deriveLeadPriorityFromEvent(scheduleEntry({ tier: "B" })), "B");
  assertEquals(deriveLeadPriorityFromEvent(scheduleEntry({ tier: "C" })), "C");
  assertEquals(
    deriveLeadPriorityFromEvent(scheduleEntry({ tier: "", opportunityScore: "35", rank: "" })),
    "C",
  );
  assertEquals(
    deriveLeadPriorityFromEvent(scheduleEntry({ tier: "", opportunityScore: "", rank: "24" })),
    "A",
  );
});

Deno.test("fallbackAgentAnswer gives local event coaching when the prompt names an event", () => {
  const answer = fallbackAgentAnswer(
    'Give me event-specific coaching for "Open Source Must Win". Include room read, opening line, questions, who to meet, and follow-up.',
    [
      scheduleEntry({
        displayTitle: "Open Source Must Win",
        salesCoaching:
          "Sales coaching:\nPitch: Accolades credits the engineering work commit counts miss, using source-linked GitHub and Slack evidence.\nOpen: Open-source rooms should hear the maintainer-labor angle first.\nAsk: How do you credit review, triage, specs, and maintainer work that never becomes a commit?\nListen for: Contributor rewards, bounty systems, maintainer burnout, attribution disputes.\nFollow-up: Ask for intros to maintainers, DevRel leads, or teams running contributor programs.",
        venueQuery: "Delancey St Essex St, New York, NY",
      }),
      scheduleEntry({
        blockType: "eating",
        displayTitle: "Meal: Lunch / reset",
      }),
    ],
  );

  for (
    const expected of [
      "local event coaching",
      "Open Source Must Win",
      "Room Read",
      "maintainer-labor angle",
      "review, triage, specs",
      "DevRel leads",
    ]
  ) {
    if (!answer.includes(expected)) {
      throw new Error(`Expected fallback answer to include ${expected}, got ${answer}`);
    }
  }
  if (answer.includes("Next block")) {
    throw new Error(`Expected event-specific fallback instead of route fallback, got ${answer}`);
  }
});

Deno.test("Partiful sync endpoint ingests browser response snapshots and exposes readback", async () => {
  const response = await router(
    new Request("http://localhost/api/sync/partiful", {
      method: "POST",
      body: JSON.stringify({
        source: "test-browser-session",
        responses: [{
          eventUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
          json: {
            result: {
              data: {
                json: {
                  event: {
                    title: "Open Source Must Win",
                    publicShortUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
                  },
                  viewerGuest: {
                    status: "APPROVED",
                    rsvp: { count: 2 },
                  },
                },
              },
            },
          },
        }],
      }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(`Expected Partiful sync status 200, got ${response.status}`);
  }

  const synced = await response.json() as Record<string, unknown>;
  assertEquals(getPath(synced, ["ingestion", "snapshotCount"]), 1);
  assertEquals(getPath(synced, ["sync", "errors"]), []);

  const readback = await router(new Request("http://localhost/api/sync/partiful"));
  if (readback.status !== 200) {
    throw new Error(`Expected Partiful readback status 200, got ${readback.status}`);
  }
  const stored = await readback.json() as Record<string, unknown>;
  const events = getPath(stored, ["events"]);
  if (!Array.isArray(events)) throw new Error("Expected Partiful readback events array.");
  const openSource = events.find((event) =>
    getPath(event, ["normalizedEvent", "partifulId"]) === "OF1vP5L8dtXKRtInyWKs"
  );
  assertEquals(getPath(openSource, ["normalizedEvent", "status"]), "registered");
  assertEquals(getPath(openSource, ["normalizedEvent", "rawStatus"]), "APPROVED");
});

Deno.test("Google Calendar write sync endpoint is removed", async () => {
  const response = await router(
    new Request("http://localhost/api/sync/google", { method: "POST" }),
  );
  assertEquals(response.status, 404);
});

Deno.test({
  name: "sends Resend test email to test@pavlovcik.com",
  async fn() {
    try {
      if (Deno.env.get("RUN_RESEND_EMAIL_TEST") !== "1") return;
    } catch {
      return;
    }
    const result = await sendResendTestEmail("test@pavlovcik.com");
    if (result.status !== "sent") {
      throw new Error(`Expected sent email, got ${result.status}: ${result.error}`);
    }
  },
});

function scheduleEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    calendar: "schedule",
    techweekId: "TW-5978",
    calendarBlockId: "TW-5978-SCHEDULE",
    partifulId: "OF1vP5L8dtXKRtInyWKs",
    rerankId: "5978",
    entryType: "event",
    blockType: "event",
    status: "registered",
    category: "primary",
    start: "2026-06-01 18:00",
    end: "2026-06-01 21:00",
    actualStart: "2026-06-01 18:00",
    actualEnd: "2026-06-01 21:00",
    startEpochMs: 0,
    endEpochMs: Number.MAX_SAFE_INTEGER,
    actualStartEpochMs: 0,
    actualEndEpochMs: Number.MAX_SAFE_INTEGER,
    dayKey: "2026-06-01",
    weekday: "Mon",
    timeRange: "18:00-21:00",
    title: "[REG] Open Source Must Win",
    displayTitle: "Open Source Must Win",
    statusLabel: "REG",
    location: "New York, NY",
    venueQuery: "",
    venuePrecision: "approx_neighborhood_hidden",
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    transitRisk: "",
    note: "",
    salesCoaching: "",
    rank: "37",
    tier: "A",
    opportunityScore: "64",
    eventUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
    googleMapsUrl: "",
    ...overrides,
  };
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
