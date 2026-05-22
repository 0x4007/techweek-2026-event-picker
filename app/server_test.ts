import {
  buildLeadFollowUpEmailContent,
  deriveLeadPriorityFromEvent,
  extractEmailAddress,
  fallbackAgentAnswer,
  normalizeLeadEmail,
  normalizeLeadPhone,
  parseCsv,
  router,
  type ScheduleEntry,
  sendResendTestEmail,
  setAccountSessionForTest,
  statusLabelForScheduleStatus,
  visibleAgentGatewayError,
} from "./server.ts";
import { deleteCacheValue, readStateValue, writeCacheValue } from "./lib/postgres_store.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

const ADMIN_STATE_HEADERS = {
  "content-type": "application/json",
  cookie: "techweek_session=test-session",
};

async function registrationStartHeadersForCurrentStore(): Promise<{
  headers: Record<string, string>;
  cleanup: () => Promise<void> | void;
}> {
  const headers = { "content-type": "application/json" };
  const userIds = await readStateValue<string[]>("auth:users:v1") ?? [];
  if (!userIds.length) return { headers, cleanup: () => undefined };

  for (const userId of userIds) {
    const user = await readStateValue<{ id: string; isAdmin: boolean }>(`auth:user:${userId}`);
    if (!user?.isAdmin) continue;
    const token = `test-session-${crypto.randomUUID()}`;
    await writeCacheValue(
      "auth-session",
      token,
      {
        token,
        userId: user.id,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { ttlMs: 60_000, metadata: { userId: user.id } },
    );
    return {
      headers: { ...headers, cookie: `techweek_session=${token}` },
      cleanup: async () => {
        await deleteCacheValue("auth-session", token);
      },
    };
  }
  throw new Error("Expected an admin account in the existing auth store.");
}

function useAdminSessionForTest() {
  setAccountSessionForTest({
    authenticated: true,
    auth: "passkey",
    user: {
      id: "admin_123",
      handle: "admin",
      isAdmin: true,
      credentialCount: 1,
    },
    expiresAt: "2026-06-01T12:00:00.000Z",
  });
}

function useAccountSessionForTest(
  user: {
    id: string;
    handle: string;
    isAdmin?: boolean;
    credentialCount?: number;
  } | null,
) {
  if (!user) {
    setAccountSessionForTest(undefined);
    return;
  }
  setAccountSessionForTest({
    authenticated: true,
    auth: "passkey",
    user: {
      id: user.id,
      handle: user.handle,
      isAdmin: Boolean(user.isAdmin),
      credentialCount: user.credentialCount || 1,
    },
    expiresAt: "2026-06-01T12:00:00.000Z",
  });
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

Deno.test("lead OCR normalization is conservative and stable for email + phone", () => {
  assertEquals(
    normalizeLeadEmail(" Email: ADA.LOVELACE@Example.COM. "),
    "ada.lovelace@example.com",
  );
  assertEquals(normalizeLeadEmail("e-mail: lead@example.com,"), "lead@example.com");
  assertEquals(normalizeLeadPhone(" (555) 333-4444 "), "+1 555 333 4444");
  assertEquals(normalizeLeadPhone("+1 (555) 333-4444"), "+1 555 333 4444");
  assertEquals(normalizeLeadPhone("555.333.4444"), "+1 555 333 4444");
  assertEquals(normalizeLeadPhone("+44 20 7946 0958"), "+442079460958");
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

Deno.test("visibleAgentGatewayError renders upstream debug details instead of local route fallback", () => {
  const response = new Response(
    JSON.stringify({ error: { message: "upstream exploded" }, code: "bad_gateway" }),
    {
      status: 502,
      statusText: "Bad Gateway",
      headers: {
        "x-uos-request-id": "req_test_123",
        "x-deno-trace-id": "trace_test_456",
      },
    },
  );

  const answer = visibleAgentGatewayError(response, "gpt-5.5", {
    error: { message: "upstream exploded" },
    code: "bad_gateway",
  });

  for (
    const expected of [
      "AI gateway error",
      "HTTP 502 Bad Gateway",
      "gpt-5.5",
      "upstream exploded",
      "req_test_123",
      "trace_test_456",
      "bad_gateway",
    ]
  ) {
    if (!answer.includes(expected)) {
      throw new Error(`Expected gateway error answer to include ${expected}, got ${answer}`);
    }
  }
  for (const forbidden of ["Next block", "local schedule answer", "local event coaching"]) {
    if (answer.includes(forbidden)) {
      throw new Error(`Expected gateway error answer not to include ${forbidden}, got ${answer}`);
    }
  }
});

Deno.test("Partiful sync endpoint ingests browser response snapshots and exposes readback", async () => {
  useAdminSessionForTest();
  const response = await router(
    new Request("http://localhost/api/sync/partiful", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
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

  const readback = await router(
    new Request("http://localhost/api/sync/partiful", {
      headers: ADMIN_STATE_HEADERS,
    }),
  );
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
  setAccountSessionForTest(undefined);
});

Deno.test("planner endpoints allow authenticated non-admin users to import and plan", async () => {
  const userId = `planner_${crypto.randomUUID()}`;
  useAccountSessionForTest({
    id: userId,
    handle: "planner-user",
    isAdmin: false,
  });
  const headers = {
    "content-type": "application/json",
    cookie: "techweek_session=test-session",
  };

  try {
    const imported = await router(
      new Request("http://localhost/api/planner/imports", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "General planner test",
          sourceType: "csv",
          sourceText:
            "title,start,end,location,score\nMorning session,2026-06-01 10:00,2026-06-01 11:00,Hall A,80\nEvening mixer,2026-06-01 18:00,2026-06-01 20:00,Hall B,90",
        }),
      }),
    );
    if (imported.status !== 200) {
      throw new Error(`Expected planner import status 200, got ${imported.status}`);
    }
    const importedBody = await imported.json() as Record<string, unknown>;
    const importedEvents = getPath(importedBody, ["import", "events"]);
    if (!Array.isArray(importedEvents) || importedEvents.length !== 2) {
      throw new Error(`Expected two imported events, got ${JSON.stringify(importedEvents)}`);
    }

    const planned = await router(
      new Request("http://localhost/api/planner/plan", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }),
    );
    if (planned.status !== 200) {
      throw new Error(`Expected planner plan status 200, got ${planned.status}`);
    }
    const plannedBody = await planned.json() as Record<string, unknown>;
    const summary = getPath(plannedBody, ["plan", "summary"]) as Record<string, unknown>;
    if (Number(summary.selectedEvents) < 1) {
      throw new Error(
        `Expected selected events in planner summary, got ${JSON.stringify(summary)}`,
      );
    }
    if (Number(summary.generatedLogisticsBlocks) < 1) {
      throw new Error(
        `Expected generated logistics in planner summary, got ${JSON.stringify(summary)}`,
      );
    }
  } finally {
    setAccountSessionForTest(undefined);
    await Deno.remove(new URL(`../.codex/planner-states/${userId}.json`, import.meta.url)).catch(
      () => undefined,
    );
    await Deno.remove(new URL("../.codex/planner-states/", import.meta.url), { recursive: false })
      .catch(() => undefined);
  }
});

Deno.test("planner event endpoints create and update manual calendar events", async () => {
  const userId = `planner_events_${crypto.randomUUID()}`;
  useAccountSessionForTest({
    id: userId,
    handle: "planner-event-user",
    isAdmin: false,
  });
  const headers = {
    "content-type": "application/json",
    cookie: "techweek_session=test-session",
  };

  try {
    const created = await router(
      new Request("http://localhost/api/planner/events", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Manual calendar block",
          start: "2026-06-02T13:00",
          end: "2026-06-02T14:00",
          location: "Hall C",
          description: "Created from the calendar timeline.",
        }),
      }),
    );
    if (created.status !== 200) {
      throw new Error(`Expected planner event create status 200, got ${created.status}`);
    }
    const createdBody = await created.json() as Record<string, unknown>;
    const eventId = String(getPath(createdBody, ["event", "id"]) || "");
    if (!eventId.startsWith("manual_")) {
      throw new Error(`Expected manual event id, got ${eventId}`);
    }
    assertEquals(getPath(createdBody, ["event", "start"]), "2026-06-02 13:00");
    if (Number(getPath(createdBody, ["plan", "summary", "selectedEvents"])) < 1) {
      throw new Error(
        `Expected created event to generate a plan, got ${JSON.stringify(createdBody)}`,
      );
    }

    const updated = await router(
      new Request(`http://localhost/api/planner/events/${encodeURIComponent(eventId)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          title: "Updated calendar block",
          start: "2026-06-02T15:00",
          end: "2026-06-02T16:15",
          location: "Hall D",
          description: "Edited from the calendar timeline.",
        }),
      }),
    );
    if (updated.status !== 200) {
      throw new Error(`Expected planner event update status 200, got ${updated.status}`);
    }
    const updatedBody = await updated.json() as Record<string, unknown>;
    assertEquals(getPath(updatedBody, ["event", "title"]), "Updated calendar block");
    assertEquals(getPath(updatedBody, ["event", "start"]), "2026-06-02 15:00");
    const blocks = getPath(updatedBody, ["plan", "blocks"]);
    if (
      !Array.isArray(blocks) ||
      !blocks.some((block) =>
        getPath(block, ["sourceEventId"]) === eventId &&
        getPath(block, ["title"]) === "Updated calendar block"
      )
    ) {
      throw new Error(`Expected updated event block in plan, got ${JSON.stringify(blocks)}`);
    }
  } finally {
    setAccountSessionForTest(undefined);
    await Deno.remove(new URL(`../.codex/planner-states/${userId}.json`, import.meta.url)).catch(
      () => undefined,
    );
    await Deno.remove(new URL("../.codex/planner-states/", import.meta.url), { recursive: false })
      .catch(() => undefined);
  }
});

Deno.test("planner chat saves generated agendas that can be renamed and reactivated", async () => {
  const userId = `planner_history_${crypto.randomUUID()}`;
  useAccountSessionForTest({
    id: userId,
    handle: "planner-history-user",
    isAdmin: false,
  });
  const headers = {
    "content-type": "application/json",
    cookie: "techweek_session=test-session",
  };

  try {
    const imported = await router(
      new Request("http://localhost/api/planner/imports", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Agenda history test",
          sourceType: "csv",
          sourceText:
            "title,start,end,location,score\nMorning session,2026-06-03 10:00,2026-06-03 11:00,Hall A,80",
        }),
      }),
    );
    if (imported.status !== 200) {
      throw new Error(`Expected planner import status 200, got ${imported.status}`);
    }

    const chatted = await router(
      new Request("http://localhost/api/planner/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "Plan the strongest calendar for this day" }),
      }),
    );
    if (chatted.status !== 200) {
      throw new Error(`Expected planner chat status 200, got ${chatted.status}`);
    }
    const chattedBody = await chatted.json() as Record<string, unknown>;
    assertEquals(getPath(chattedBody, ["calendarUpdated"]), true);
    const toolCalls = getPath(chattedBody, ["toolCalls"]);
    if (
      !Array.isArray(toolCalls) ||
      !toolCalls.some((call) => getPath(call, ["name"]) === "render_calendar")
    ) {
      throw new Error(`Expected render_calendar tool call, got ${JSON.stringify(toolCalls)}`);
    }
    const firstPlanId = String(getPath(chattedBody, ["plan", "id"]) || "");
    assertEquals(
      getPath(chattedBody, ["plan", "name"]),
      "Plan the strongest calendar for this day",
    );

    const created = await router(
      new Request("http://localhost/api/planner/events", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Manual follow-up",
          start: "2026-06-04T13:00",
          end: "2026-06-04T14:00",
          location: "Hall B",
        }),
      }),
    );
    if (created.status !== 200) {
      throw new Error(`Expected planner event create status 200, got ${created.status}`);
    }
    const createdBody = await created.json() as Record<string, unknown>;
    const secondPlanId = String(getPath(createdBody, ["plan", "id"]) || "");
    if (!firstPlanId || !secondPlanId || firstPlanId === secondPlanId) {
      throw new Error(`Expected two saved plans, got ${firstPlanId} and ${secondPlanId}`);
    }

    const renamed = await router(
      new Request(`http://localhost/api/planner/plans/${encodeURIComponent(firstPlanId)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ name: "Baseline agenda", active: true }),
      }),
    );
    if (renamed.status !== 200) {
      throw new Error(`Expected planner plan update status 200, got ${renamed.status}`);
    }
    const renamedBody = await renamed.json() as Record<string, unknown>;
    assertEquals(getPath(renamedBody, ["planner", "activePlanId"]), firstPlanId);
    assertEquals(getPath(renamedBody, ["plan", "name"]), "Baseline agenda");
  } finally {
    setAccountSessionForTest(undefined);
    await Deno.remove(new URL(`../.codex/planner-states/${userId}.json`, import.meta.url)).catch(
      () => undefined,
    );
    await Deno.remove(new URL("../.codex/planner-states/", import.meta.url), { recursive: false })
      .catch(() => undefined);
  }
});

Deno.test("Partiful sync POST endpoints reject unauthenticated requests", async () => {
  setAccountSessionForTest(null);
  try {
    for (
      const path of [
        "/api/sync/partiful",
        "/api/sync/partiful/auto",
        "/api/sync/partiful/headless",
      ]
    ) {
      const response = await router(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      assertEquals(response.status, 401);
      const body = await response.json() as Record<string, unknown>;
      assertEquals(getPath(body, ["error", "message"]), "Authentication required.");
    }
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("sensitive API routes reject unauthenticated requests at the router", async () => {
  setAccountSessionForTest(null);
  try {
    const requests = [
      new Request("http://localhost/api/schedule"),
      new Request("http://localhost/api/ics/operational"),
      new Request("http://localhost/api/debug/agent/test"),
      new Request("http://localhost/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
      new Request("http://localhost/api/leads/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: "data:image/jpeg;base64,AA==" }),
      }),
    ];
    for (const request of requests) {
      const response = await router(request);
      assertEquals(response.status, 401);
      const body = await response.json() as Record<string, unknown>;
      assertEquals(getPath(body, ["error", "message"]), "Authentication required.");
    }
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("Google Calendar write sync endpoint is removed", async () => {
  useAdminSessionForTest();
  try {
    const response = await router(
      new Request("http://localhost/api/sync/google", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(response.status, 404);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("account session reports unauthenticated state without a local session cookie", async () => {
  try {
    const response = await router(new Request("http://localhost/api/account/session"));
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(getPath(body, ["session", "authenticated"]), false);
    const auth = getPath(body, ["session", "auth"]);
    if (auth !== "setup_required" && auth !== "passkey") {
      throw new Error(`Expected setup_required or passkey auth, got ${String(auth)}`);
    }
    assertEquals(getPath(body, ["session", "bootstrapConfigured"]), true);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("auth registration start returns a standalone WebAuthn user id", async () => {
  setAccountSessionForTest(undefined);
  const registration = await registrationStartHeadersForCurrentStore();
  try {
    const handle = `Nik Pavlovcik ${crypto.randomUUID()}`;
    const response = await router(
      new Request("http://localhost/api/auth/register/start", {
        method: "POST",
        headers: registration.headers,
        body: JSON.stringify({
          handle,
          admin: true,
          client_origin: "http://localhost",
        }),
      }),
    );
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    if (!String(getPath(body, ["handle"])).startsWith("nik-pavlovcik-")) {
      throw new Error(`Expected normalized handle, got ${String(getPath(body, ["handle"]))}`);
    }
    assertEquals(getPath(body, ["admin"]), true);
    const webAuthnUserId = decodeBase64urlText(String(getPath(body, ["publicKey", "user", "id"])));
    if (!webAuthnUserId.startsWith("user_")) {
      throw new Error(`Expected generated internal WebAuthn user id, got ${webAuthnUserId}`);
    }
    if (webAuthnUserId.includes("nik")) {
      throw new Error(`Expected WebAuthn user id not to expose handle, got ${webAuthnUserId}`);
    }
  } finally {
    await registration.cleanup();
  }
});

Deno.test("account session returns authenticated local passkey identity", async () => {
  setAccountSessionForTest({
    authenticated: true,
    auth: "passkey",
    user: {
      id: "user_123",
      handle: "nik",
      isAdmin: true,
      credentialCount: 2,
    },
    expiresAt: "2026-06-01T12:00:00.000Z",
  });
  try {
    const response = await router(
      new Request("http://localhost/api/account/session", {
        headers: { cookie: "other=value; techweek_session=test-session" },
      }),
    );
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(getPath(body, ["session", "authenticated"]), true);
    assertEquals(getPath(body, ["session", "user", "id"]), "user_123");
    assertEquals(getPath(body, ["session", "user", "handle"]), "nik");
    assertEquals(getPath(body, ["session", "user", "isAdmin"]), true);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("account invite GET/POST reject unauthenticated requests", async () => {
  setAccountSessionForTest(null);
  try {
    const getResponse = await router(
      new Request("http://localhost/api/account/invite"),
    );
    assertEquals(getResponse.status, 401);
    const getBody = await getResponse.json() as Record<string, unknown>;
    assertEquals(getPath(getBody, ["error", "message"]), "Authentication required.");

    const postResponse = await router(
      new Request("http://localhost/api/account/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referralCode: "ABCDE12345" }),
      }),
    );
    assertEquals(postResponse.status, 401);
    const postBody = await postResponse.json() as Record<string, unknown>;
    assertEquals(getPath(postBody, ["error", "message"]), "Authentication required.");
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("account invite GET returns stable code and payload for the same authenticated user", async () => {
  useAccountSessionForTest({ id: "invite_user_a", handle: "alice", isAdmin: true });
  try {
    const first = await router(
      new Request("http://localhost/api/account/invite", {
        headers: { cookie: "techweek_session=invite-session" },
      }),
    );
    assertEquals(first.status, 200);
    const firstBody = await first.json() as Record<string, unknown>;
    const firstInvite = getPath(firstBody, ["invite"]) as Record<string, unknown> | undefined;
    const firstCode = String(firstInvite?.code || "");
    assertEquals(firstCode.length > 0, true);
    assertEquals(firstInvite?.code, firstInvite?.code);
    const firstShare = String(firstInvite?.shareUrl || "");
    if (!firstShare.includes("/?ref=")) {
      throw new Error(`Expected share link to include ref, got ${firstShare}`);
    }

    const second = await router(
      new Request("http://localhost/api/account/invite", {
        headers: { cookie: "techweek_session=invite-session" },
      }),
    );
    assertEquals(second.status, 200);
    const secondBody = await second.json() as Record<string, unknown>;
    const secondInvite = getPath(secondBody, ["invite"]) as Record<string, unknown> | undefined;
    const secondCode = String(secondInvite?.code || "");
    assertEquals(secondCode, firstCode);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("account invite claim records referral, ignores self-referral", async () => {
  const testSuffix = crypto.randomUUID();
  const ownerId = `invite_owner_${testSuffix}`;
  const friendId = `invite_friend_${testSuffix}`;
  useAccountSessionForTest({ id: ownerId, handle: "owner" });
  try {
    const ownerInviteResponse = await router(
      new Request("http://localhost/api/account/invite", {
        headers: { cookie: "techweek_session=invite-session-owner" },
      }),
    );
    assertEquals(ownerInviteResponse.status, 200);
    const ownerInviteBody = await ownerInviteResponse.json() as Record<string, unknown>;
    const ownerInviteCode = String(getPath(ownerInviteBody, ["invite", "code"]) || "");
    assertEquals(ownerInviteCode.length > 0, true);

    useAccountSessionForTest({ id: friendId, handle: "friend" });
    const claimResponse = await router(
      new Request("http://localhost/api/account/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=invite-session-friend",
        },
        body: JSON.stringify({ referralCode: ownerInviteCode }),
      }),
    );
    assertEquals(claimResponse.status, 200);
    const claimBody = await claimResponse.json() as Record<string, unknown>;
    const claimedInvite = getPath(claimBody, ["invite"]) as Record<string, unknown> | undefined;
    const claimedReferrals = Array.isArray(claimedInvite?.referrals)
      ? claimedInvite.referrals as unknown[]
      : [];
    assertEquals(claimedReferrals.length, 0);
    assertEquals(claimBody?.claimed, true);

    useAccountSessionForTest({ id: ownerId, handle: "owner" });
    const selfResponse = await router(
      new Request("http://localhost/api/account/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=invite-session-owner",
        },
        body: JSON.stringify({ referralCode: ownerInviteCode }),
      }),
    );
    assertEquals(selfResponse.status, 200);
    const selfBody = await selfResponse.json() as Record<string, unknown>;
    assertEquals(selfBody?.claimed === false, true);

    const ownerReload = await router(
      new Request("http://localhost/api/account/invite", {
        headers: { cookie: "techweek_session=invite-session-owner" },
      }),
    );
    assertEquals(ownerReload.status, 200);
    const ownerReloadBody = await ownerReload.json() as Record<string, unknown>;
    const ownerReloadInvite = getPath(ownerReloadBody, ["invite"]) as
      | Record<string, unknown>
      | undefined;
    const ownerReferrals = Array.isArray(ownerReloadInvite?.referrals)
      ? ownerReloadInvite.referrals as unknown[]
      : [];
    assertEquals(ownerReferrals.length, 1);
  } finally {
    useAccountSessionForTest(null);
  }
});

Deno.test("agenda recalculation rejects unauthenticated activation without changing active agenda", async () => {
  useAdminSessionForTest();
  try {
    const before = await router(
      new Request("http://localhost/api/schedule", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    if (before.status !== 200) {
      throw new Error(`Expected schedule status 200, got ${before.status}`);
    }
    const beforeBody = await before.json() as Record<string, unknown>;
    const beforeRunId = getPath(beforeBody, ["state", "activeAgendaRunId"]);

    const response = await router(
      new Request("http://localhost/api/agenda/recalculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activate: true,
          liveRouting: false,
          overrides: { excludedEventIds: ["TW-6408"] },
        }),
      }),
    );

    assertEquals(response.status, 401);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(getPath(body, ["error", "message"]), "Authentication required.");
    if (getPath(body, ["agenda"]) !== undefined) {
      throw new Error("Unauthenticated recalculation should not return an agenda run.");
    }

    const after = await router(
      new Request("http://localhost/api/schedule", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    if (after.status !== 200) {
      throw new Error(`Expected schedule status 200, got ${after.status}`);
    }
    const afterBody = await after.json() as Record<string, unknown>;
    assertEquals(getPath(afterBody, ["state", "activeAgendaRunId"]), beforeRunId);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("state lead creation rejects unauthenticated follow-up email mutation", async () => {
  setAccountSessionForTest(null);
  try {
    const response = await router(
      new Request("http://localhost/api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "lead_create",
          calendarBlockId: "TW-5978-SCHEDULE",
          name: "Unauthenticated Lead",
          company: "Blocked Labs",
          email: "blocked@example.com",
          sendFollowUpEmail: true,
        }),
      }),
    );
    assertEquals(response.status, 401);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(getPath(body, ["error", "message"]), "Authentication required.");
    if (getPath(body, ["lead"]) !== undefined) {
      throw new Error("Unauthenticated lead creation should not return a lead.");
    }
  } finally {
    setAccountSessionForTest(undefined);
  }
});

Deno.test("concurrent lead creation preserves both state updates", async () => {
  useAdminSessionForTest();
  const firstLead = `Concurrent Lead A ${crypto.randomUUID().slice(0, 8)}`;
  const secondLead = `Concurrent Lead B ${crypto.randomUUID().slice(0, 8)}`;
  const createdIds: string[] = [];
  try {
    const [first, second] = await Promise.all([firstLead, secondLead].map((name) =>
      router(
        new Request("http://localhost/api/state", {
          method: "POST",
          headers: ADMIN_STATE_HEADERS,
          body: JSON.stringify({
            type: "lead_create",
            calendarBlockId: "TW-5978-SCHEDULE",
            name,
            company: "Concurrent Labs",
            email: `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, ".")}@example.com`,
          }),
        }),
      )
    ));
    for (const response of [first, second]) {
      assertEquals(response.status, 200);
      const body = await response.json() as Record<string, unknown>;
      const id = String(getPath(body, ["lead", "id"]) || "");
      if (id) createdIds.push(id);
    }

    const schedule = await router(
      new Request("http://localhost/api/schedule", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(schedule.status, 200);
    const body = await schedule.json() as Record<string, unknown>;
    const leads = getPath(body, ["state", "leads"]);
    if (!Array.isArray(leads)) throw new Error("Expected leads array.");
    for (const name of [firstLead, secondLead]) {
      if (!leads.some((lead) => getPath(lead, ["name"]) === name)) {
        throw new Error(`Expected concurrent lead ${name} to persist.`);
      }
    }
  } finally {
    for (const id of createdIds) {
      await router(
        new Request("http://localhost/api/state", {
          method: "POST",
          headers: ADMIN_STATE_HEADERS,
          body: JSON.stringify({ type: "lead_delete", id }),
        }),
      );
    }
    setAccountSessionForTest(undefined);
  }
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

Deno.test("lead creation persists compact OCR provenance metadata", async () => {
  useAdminSessionForTest();
  const leadName = `OCR Metadata ${crypto.randomUUID().slice(0, 8)}`;
  const create = await router(
    new Request("http://localhost/api/state", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
      body: JSON.stringify({
        type: "lead_create",
        calendarBlockId: "TW-5978-SCHEDULE",
        name: leadName,
        company: "Ada Labs",
        role: "Founder",
        email: "founder@example.com",
        phone: "+1 (212) 555-1111",
        priority: "A",
        followUp: "OCR provenance test",
        notes: "Seeded by server test.",
        ocr: {
          ocrSource: "canvas_auto_edge_crop",
          attemptIndex: 0,
          outputWidth: 1400,
          outputHeight: 820,
          dataUrlCharacters: 900000,
          localOcrUsed: true,
          localOcrMeanConfidence: 82.4,
        },
      }),
    }),
  );
  if (create.status !== 200) throw new Error(`Expected create status 200, got ${create.status}`);
  const created = await create.json() as Record<string, unknown>;
  const createdLead = getPath(created, ["lead"]) as { id?: unknown } | undefined;
  const createdId = String(createdLead?.id || "");
  try {
    if (!createdId) throw new Error("Expected lead id in create response.");

    const schedule = await router(
      new Request("http://localhost/api/schedule", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    if (schedule.status !== 200) {
      throw new Error(`Expected schedule status 200, got ${schedule.status}`);
    }
    const schedulePayload = await schedule.json() as Record<string, unknown>;
    const state = getPath(schedulePayload, ["state"]) as Record<string, unknown> | undefined;
    const leads = Array.isArray(state?.leads) ? state.leads as unknown[] : [];
    const lead = leads.find((item) => getPath(item, ["id"]) === createdId) as
      | Record<string, unknown>
      | undefined;
    if (!lead) throw new Error("Expected persisted lead.");
    const ocr = getPath(lead, ["ocr"]);
    if (!ocr || typeof ocr !== "object" || Array.isArray(ocr)) {
      throw new Error("Expected lead OCR provenance.");
    }
    const ocrValue = ocr as Record<string, unknown>;
    if (ocrValue.ocrSource !== "canvas_auto_edge_crop") {
      throw new Error(`Expected OCR source, got ${ocrValue.ocrSource}`);
    }
    if (ocrValue.attemptIndex !== 0) {
      throw new Error(`Expected attemptIndex 0, got ${ocrValue.attemptIndex}`);
    }
    if (ocrValue.outputWidth !== 1400) {
      throw new Error(`Expected outputWidth 1400, got ${ocrValue.outputWidth}`);
    }
    if (ocrValue.outputHeight !== 820) {
      throw new Error(`Expected outputHeight 820, got ${ocrValue.outputHeight}`);
    }
    if (ocrValue.dataUrlCharacters !== 900000) {
      throw new Error(`Expected dataUrlCharacters 900000, got ${ocrValue.dataUrlCharacters}`);
    }
    if (ocrValue.localOcrUsed !== true) {
      throw new Error(`Expected localOcrUsed true, got ${ocrValue.localOcrUsed}`);
    }
    if (ocrValue.localOcrMeanConfidence !== 82) {
      throw new Error(
        `Expected localOcrMeanConfidence 82, got ${ocrValue.localOcrMeanConfidence}`,
      );
    }
  } finally {
    if (createdId) {
      await router(
        new Request("http://localhost/api/state", {
          method: "POST",
          headers: ADMIN_STATE_HEADERS,
          body: JSON.stringify({ type: "lead_delete", id: createdId }),
        }),
      );
    }
    setAccountSessionForTest(undefined);
  }
});

Deno.test("lead creation ignores invalid OCR metadata payloads", async () => {
  useAdminSessionForTest();
  const leadName = `OCR Metadata Invalid ${crypto.randomUUID().slice(0, 8)}`;
  const create = await router(
    new Request("http://localhost/api/state", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
      body: JSON.stringify({
        type: "lead_create",
        calendarBlockId: "TW-5978-SCHEDULE",
        name: leadName,
        company: "Fallback Labs",
        role: "PM",
        email: "invalid@example.com",
        phone: "+1 (212) 555-2222",
        priority: "B",
        followUp: "Invalid OCR metadata regression test",
        notes: "Seeded by server test.",
        ocr: "should-be-an-object",
      }),
    }),
  );
  if (create.status !== 200) {
    throw new Error(`Expected create status 200, got ${create.status}`);
  }
  const created = await create.json() as Record<string, unknown>;
  const createdLead = getPath(created, ["lead"]) as { id?: unknown } | undefined;
  const createdId = String(createdLead?.id || "");
  try {
    if (!createdId) throw new Error("Expected lead id in create response.");

    const schedule = await router(
      new Request("http://localhost/api/schedule", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    if (schedule.status !== 200) {
      throw new Error(`Expected schedule status 200, got ${schedule.status}`);
    }
    const payload = await schedule.json() as Record<string, unknown>;
    const state = getPath(payload, ["state"]) as Record<string, unknown> | undefined;
    const leads = Array.isArray(state?.leads) ? state.leads as unknown[] : [];
    const lead = leads.find((item) => getPath(item, ["id"]) === createdId) as
      | Record<string, unknown>
      | undefined;
    if (!lead) throw new Error("Expected persisted lead.");
    if (lead.ocr !== undefined) {
      throw new Error(
        `Expected no OCR provenance for invalid input, got ${JSON.stringify(lead.ocr)}`,
      );
    }
  } finally {
    if (createdId) {
      await router(
        new Request("http://localhost/api/state", {
          method: "POST",
          headers: ADMIN_STATE_HEADERS,
          body: JSON.stringify({ type: "lead_delete", id: createdId }),
        }),
      );
    }
    setAccountSessionForTest(undefined);
  }
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

function decodeBase64urlText(value: string): string {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}
