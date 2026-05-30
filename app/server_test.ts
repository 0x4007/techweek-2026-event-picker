import {
  buildLeadFollowUpEmailContent,
  deriveLeadPriorityForLead,
  deriveLeadPriorityFromEvent,
  extractEmailAddress,
  fallbackAgentAnswer,
  mergeDiscoveredPartifulEntries,
  mutateStateForTest,
  normalizeLeadEmail,
  normalizeLeadPhone,
  parseCsv,
  resetModelContextCacheForTest,
  router,
  type ScheduleEntry,
  sendResendTestEmail,
  setAccountSessionForTest,
  statusLabelForScheduleStatus,
  visibleAgentGatewayError,
} from "./server.ts";
import {
  readLatestResourceForUser,
  readResourceByHash,
  readStateEntry,
  readStateValue,
  setKvPathForTest,
  writeCacheValue,
  writeStateValue,
} from "./lib/kv_store.ts";
import type { PartifulSyncStatus, PartifulVenuePrecision } from "./lib/partiful_sync.ts";

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

type SeedAuthUser = {
  id: string;
  handle: string;
  isAdmin?: boolean;
  credentialIds?: string[];
};

async function seedAuthUser(user: SeedAuthUser): Promise<void> {
  const now = "2026-05-25T12:00:00.000Z";
  const credentialIds = user.credentialIds ?? [];
  await writeStateValue(`auth:user:${user.id}`, {
    id: user.id,
    handle: user.handle,
    isAdmin: Boolean(user.isAdmin),
    credentialIds,
    createdAt: now,
    updatedAt: now,
  });
  await writeStateValue(`auth:handle:${user.handle}`, user.id);
  const existing = await readStateValue<string[]>("auth:users:v1") ?? [];
  await writeStateValue("auth:users:v1", [...new Set([...existing, user.id])].sort());
}

function kvRouterTest(name: string, fn: () => Promise<void>) {
  Deno.test(name, async () => {
    await setKvPathForTest(":memory:");
    try {
      await fn();
    } finally {
      setAccountSessionForTest(undefined);
      await setKvPathForTest(undefined);
    }
  });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveCallback) => {
    resolve = resolveCallback;
  });
  return { promise, resolve };
}

async function withEnvValues(
  values: Record<string, string | null>,
  test: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, Deno.env.get(key));
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    await test();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
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

kvRouterTest("mutateState retries stale snapshot conflicts", async () => {
  const gate = createDeferred<void>();
  let p1Attempts = 0;
  let p2Attempts = 0;

  const p1 = mutateStateForTest(async (state, commit) => {
    p1Attempts += 1;
    if (p1Attempts === 1) {
      state.eventNotes = {
        ...state.eventNotes,
        stale: { note: "attempt-1", updatedAt: "2026-05-30T00:00:00.000Z" },
      };
      await gate.promise;
      return await commit(state);
    }
    state.eventNotes = {
      ...state.eventNotes,
      stale: { note: "retry", updatedAt: "2026-05-30T00:00:01.000Z" },
    };
    return await commit(state);
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const p2 = mutateStateForTest(async (state, commit) => {
    p2Attempts += 1;
    state.eventNotes = {
      ...state.eventNotes,
      fresh: { note: "primary", updatedAt: "2026-05-30T00:00:02.000Z" },
    };
    const updated = await commit(state);
    gate.resolve();
    return updated;
  });

  await Promise.all([p1, p2]);

  if (p1Attempts <= 1) {
    throw new Error(`Expected stale write retry, saw ${p1Attempts} mutateState attempts.`);
  }
  if (p2Attempts !== 1) {
    throw new Error(`Expected p2 to run once, saw ${p2Attempts} attempts.`);
  }

  const snapshot = await readStateEntry<Record<string, unknown>>("app_state_v1");
  const value = snapshot.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected app state to be stored.");
  }
  const rawNotes = (value as { eventNotes?: unknown }).eventNotes;
  if (!rawNotes || typeof rawNotes !== "object" || Array.isArray(rawNotes)) {
    throw new Error("Expected event notes in app state.");
  }
  const eventNotes = rawNotes as Record<string, unknown>;
  const freshNote = eventNotes.fresh as { note?: string; updatedAt?: string } | undefined;
  const staleNote = eventNotes.stale as { note?: string; updatedAt?: string } | undefined;
  if (!freshNote || freshNote.note !== "primary" || !staleNote || staleNote.note !== "retry") {
    throw new Error(
      `Expected both stale-retried and fresh event notes, got ${JSON.stringify(eventNotes)}`,
    );
  }
});

kvRouterTest("model-context endpoint stores and reuses KV cache entries", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const baseUrl = "https://mock-gateway.example";
  const model = "gpt-5.5";
  resetModelContextCacheForTest();

  try {
    await withEnvValues(
      {
        UOS_AI_TOKEN: "test-token",
        UOS_AI_BASE_URL: baseUrl,
      },
      async () => {
        globalThis.fetch = (
          input: string | URL | Request,
          _init?: RequestInit,
        ): Promise<Response> => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;
          calls.push(url);

          if (url.endsWith(`${baseUrl}/v1/models/${encodeURIComponent(model)}`)) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: model,
                  context_window_tokens: 24_000,
                  max_output_tokens: 8_000,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          }
          if (url.endsWith(`${baseUrl}/v1/models`)) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [{
                    id: model,
                    context_window_tokens: 24_000,
                  }],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          }
          if (url.endsWith(`${baseUrl}/uos/models/capabilities`)) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [{
                    id: model,
                    context_window_tokens: 32_000,
                    auto_compact_token_limit_tokens: 28_000,
                    max_output_tokens: 8_000,
                  }],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          }
          return Promise.resolve(
            new Response("unsupported test gateway endpoint", { status: 404 }),
          );
        };

        useAdminSessionForTest();
        try {
          const first = await router(
            new Request("http://localhost/api/model-context", {
              headers: ADMIN_STATE_HEADERS,
            }),
          );
          if (first.status !== 200) {
            throw new Error(`Expected first model-context request status 200, got ${first.status}`);
          }
          const firstPayload = await first.json() as { modelContext: { cacheHit?: boolean } };
          if (firstPayload.modelContext.cacheHit !== false) {
            throw new Error("Expected first model-context response to be a cache miss.");
          }

          const second = await router(
            new Request("http://localhost/api/model-context", {
              headers: ADMIN_STATE_HEADERS,
            }),
          );
          if (second.status !== 200) {
            throw new Error(
              `Expected second model-context request status 200, got ${second.status}`,
            );
          }
          const secondPayload = await second.json() as { modelContext: { cacheHit?: boolean } };
          if (secondPayload.modelContext.cacheHit !== true) {
            throw new Error("Expected second model-context response to be a cache hit.");
          }

          if (calls.length !== 3) {
            throw new Error(`Expected exactly 3 gateway calls with caching, got ${calls.length}`);
          }
        } finally {
          setAccountSessionForTest(undefined);
        }
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

type PartifulMergeRecord = Parameters<typeof mergeDiscoveredPartifulEntries>[1][number];

function makeDiscoveredPartifulMatch(overrides: {
  partifulId?: string;
  title?: string;
  status?: PartifulSyncStatus;
  rawStatus?: string;
  venue?: {
    label: string;
    address: string;
    googleMapsUrl: string;
    appleMapsUrl: string;
    precision: PartifulVenuePrecision;
  } | null;
} = {}): PartifulMergeRecord {
  const defaults: {
    partifulId: string;
    title: string;
    status: PartifulSyncStatus;
    rawStatus: string;
    venue: {
      label: string;
      address: string;
      googleMapsUrl: string;
      appleMapsUrl: string;
      precision: PartifulVenuePrecision;
    };
  } = {
    partifulId: "OF1vP5L8dtXKRtInyWKs",
    title: "Open Source Must Win - #NYTechWeek",
    status: "registered",
    rawStatus: "APPROVED",
    venue: {
      label: "Exact Venue, 123 Test St, New York, NY",
      address: "123 Test St, New York, NY 10003",
      googleMapsUrl: "https://maps.example/test",
      appleMapsUrl: "",
      precision: "exact",
    },
  };
  const payload = { ...defaults, ...overrides };
  return {
    cacheId: `partiful:${payload.partifulId}`,
    syncedAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z",
    normalizedEvent: {
      partifulId: payload.partifulId,
      eventUrl: `https://partiful.com/e/${payload.partifulId}`,
      title: payload.title,
      status: payload.status,
      rawStatus: payload.rawStatus,
      rawEventStatus: "PUBLISHED",
      description: "",
      startAt: "2026-06-01T22:00:00.000Z",
      endAt: "2026-06-02T01:00:00.000Z",
      updatedAt: "2026-05-29T12:00:00.000Z",
      approvedAt: "",
      rsvpCount: 1,
      guestCount: 20,
      plusOne: "none",
      venue: payload.venue === null ? null : payload.venue,
      source: "test",
    },
    mergedEvent: {
      eventUrl: `https://partiful.com/e/${payload.partifulId}`,
      partifulEventUrl: `https://partiful.com/e/${payload.partifulId}`,
      partifulId: payload.partifulId,
      partifulRawStatus: payload.rawStatus,
      partifulStatus: payload.rawStatus,
      partifulSyncedAt: "2026-05-29T12:00:00.000Z",
      status: payload.status,
      title: payload.title.replace(" - #NYTechWeek", ""),
    },
    statusChanged: false,
    matchedBy: "partiful_id",
  };
}

Deno.test("mergeDiscoveredPartifulEntries clobbers matching entries with live Partiful venue", () => {
  const merged = mergeDiscoveredPartifulEntries([scheduleEntry()], [
    makeDiscoveredPartifulMatch({}),
  ]);

  assertEquals(merged[0].location, "123 Test St, New York, NY 10003");
  assertEquals(merged[0].venueQuery, "123 Test St, New York, NY 10003");
  assertEquals(merged[0].venuePrecision, "partiful_exact");
  assertEquals(merged[0].googleMapsUrl, "https://maps.example/test");
  assertEquals(merged[0].displayTitle, "Open Source Must Win");
});

Deno.test("mergeDiscoveredPartifulEntries does not clobber travel rows with matching Partiful ids", () => {
  const travel = scheduleEntry({
    calendarBlockId: "TW-5978-TRAVEL-IN",
    entryType: "travel",
    blockType: "travel",
    status: "",
    statusLabel: "",
    title: "Travel: Home to Open Source Must Win",
    displayTitle: "Travel: Home to Open Source Must Win",
    location: "15 Cliff St to New York, NY",
    venueQuery: "15 Cliff St to New York, NY",
    venuePrecision: "route_context",
    routeMode: "transit",
    travelMinutes: "22",
    routeDetails: "Leave 22 min early.",
    googleMapsUrl: "https://maps.example/directions",
  });

  const merged = mergeDiscoveredPartifulEntries([travel], [makeDiscoveredPartifulMatch({})]);

  assertEquals(merged[0].entryType, "travel");
  assertEquals(merged[0].blockType, "travel");
  assertEquals(merged[0].title, "Travel: Home to Open Source Must Win");
  assertEquals(merged[0].displayTitle, "Travel: Home to Open Source Must Win");
  assertEquals(merged[0].location, "15 Cliff St to New York, NY");
  assertEquals(merged[0].venueQuery, "15 Cliff St to New York, NY");
  assertEquals(merged[0].venuePrecision, "route_context");
  assertEquals(merged[0].googleMapsUrl, "https://maps.example/directions");
  assertEquals(merged[0].status, "");
  assertEquals(merged[0].statusLabel, "");
  assertEquals(merged.length, 2);
  assertEquals(merged[1].blockType, "event");
  assertEquals(merged[1].displayTitle, "Open Source Must Win");
});

Deno.test("mergeDiscoveredPartifulEntries keeps exact schedule venues when live Partiful venue is less precise", () => {
  const merged = mergeDiscoveredPartifulEntries(
    [scheduleEntry({
      partifulId: "OF1vP5L8dtXKRtInyWKs",
      location: "Exact Venue, 123 Test St, New York, NY",
      venueQuery: "Exact Venue, 123 Test St, New York, NY",
      venuePrecision: "manual_exact_manhattan",
      googleMapsUrl: "https://maps.example/current-venue",
      title: "[PENDING] Open Source Must Win",
    })],
    [makeDiscoveredPartifulMatch({
      status: "registered",
      venue: {
        label: "New York City, New York",
        address: "New York, NY",
        googleMapsUrl: "https://maps.example/live-approximate",
        appleMapsUrl: "",
        precision: "approximate",
      },
    })],
  );

  assertEquals(merged[0].location, "Exact Venue, 123 Test St, New York, NY");
  assertEquals(merged[0].venueQuery, "Exact Venue, 123 Test St, New York, NY");
  assertEquals(merged[0].venuePrecision, "manual_exact_manhattan");
  assertEquals(merged[0].googleMapsUrl, "https://maps.example/current-venue");
  assertEquals(merged[0].title, "[REG] Open Source Must Win");
});

Deno.test("mergeDiscoveredPartifulEntries does not replace useful approximate venues with generic city text", () => {
  const merged = mergeDiscoveredPartifulEntries(
    [scheduleEntry({
      partifulId: "OF1vP5L8dtXKRtInyWKs",
      location: "SoHo",
      venueQuery: "Spring St and Broadway, New York, NY",
      venuePrecision: "approx_from_calendar_location",
      googleMapsUrl: "https://maps.example/current-neighborhood",
    })],
    [makeDiscoveredPartifulMatch({
      venue: {
        label: "New York, NY",
        address: "New York, NY",
        googleMapsUrl: "https://maps.example/generic-city",
        appleMapsUrl: "",
        precision: "exact",
      },
    })],
  );

  assertEquals(merged[0].location, "SoHo");
  assertEquals(merged[0].venueQuery, "Spring St and Broadway, New York, NY");
  assertEquals(merged[0].venuePrecision, "approx_from_calendar_location");
  assertEquals(merged[0].googleMapsUrl, "https://maps.example/current-neighborhood");
});

Deno.test("mergeDiscoveredPartifulEntries rebuilds map links when live Partiful venue updates and map link is missing", () => {
  const merged = mergeDiscoveredPartifulEntries(
    [scheduleEntry({
      partifulId: "OF1vP5L8dtXKRtInyWKs",
      location: "Old Venue, New York, NY",
      venueQuery: "Old Venue, New York, NY",
      venuePrecision: "manual_neighborhood",
      googleMapsUrl: "https://maps.example/current-venue",
      title: "[PENDING] Open Source Must Win",
    })],
    [makeDiscoveredPartifulMatch({
      status: "registered",
      venue: {
        label: "New Venue",
        address: "250 Test Ave, New York, NY",
        googleMapsUrl: "",
        appleMapsUrl: "",
        precision: "exact",
      },
    })],
  );

  assertEquals(merged[0].location, "250 Test Ave, New York, NY");
  assertEquals(merged[0].venueQuery, "250 Test Ave, New York, NY");
  assertEquals(merged[0].venuePrecision, "partiful_exact");
  assertEquals(
    merged[0].googleMapsUrl,
    "https://www.google.com/maps/search/?api=1&query=250+Test+Ave%2C+New+York%2C+NY",
  );
});

Deno.test("mergeDiscoveredPartifulEntries recomputes title status prefix from live Partiful status", () => {
  const merged = mergeDiscoveredPartifulEntries(
    [scheduleEntry({
      partifulId: "OF1vP5L8dtXKRtInyWKs",
      status: "PENDING_APPROVAL",
      title: "[PENDING] Open Source Must Win",
      venuePrecision: "manual_neighborhood",
    })],
    [makeDiscoveredPartifulMatch({
      title: "Open Source Must Win - #NYTechWeek",
      status: "registered",
      rawStatus: "APPROVED",
      venue: null,
    })],
  );

  assertEquals(merged[0].title, "[REG] Open Source Must Win");
  assertEquals(merged[0].displayTitle, "Open Source Must Win");
  assertEquals(merged[0].status, "registered");
  assertEquals(merged[0].statusLabel, "REG");
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

Deno.test("deriveLeadPriorityForLead combines event importance with qualification", () => {
  assertEquals(deriveLeadPriorityForLead(scheduleEntry({ tier: "A" }), {}), "B");
  assertEquals(
    deriveLeadPriorityForLead(scheduleEntry({ tier: "A" }), { role: "VP Engineering" }),
    "A",
  );
  assertEquals(
    deriveLeadPriorityForLead(scheduleEntry({ tier: "A" }), {
      buyerType: "Engineering leader",
      githubHeavy: "yes",
      aiCodingAdoption: "yes",
    }),
    "A",
  );
  assertEquals(
    deriveLeadPriorityForLead(scheduleEntry({ tier: "B" }), {
      buyerType: "Investor/advisor",
      githubHeavy: "no",
      aiCodingAdoption: "no",
    }),
    "C",
  );
  assertEquals(
    deriveLeadPriorityForLead(scheduleEntry({ tier: "C" }), {
      buyerType: "Founder/operator",
      githubHeavy: "yes",
      aiCodingAdoption: "yes",
      painMentioned: "Manual manager packet assembly.",
      followUp: "Review one repo next week.",
    }),
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

kvRouterTest(
  "Partiful sync endpoint ingests browser response snapshots and exposes readback",
  async () => {
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
  },
);

kvRouterTest("Partiful sync POST endpoints reject unauthenticated requests", async () => {
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

kvRouterTest("Partiful auto-sync admin trigger queues and reports KV state", async () => {
  useAdminSessionForTest();
  try {
    const queued = await router(
      new Request("http://localhost/api/sync/partiful/auto", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(queued.status, 202);
    const queuedBody = await queued.json() as Record<string, unknown>;
    assertEquals(queuedBody.action, "queued");
    assertEquals(getPath(queuedBody, ["partifulAutoSync", "status"]), "queued");

    const alreadyRunning = await router(
      new Request("http://localhost/api/sync/partiful/auto", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(alreadyRunning.status, 202);
    const alreadyRunningBody = await alreadyRunning.json() as Record<string, unknown>;
    assertEquals(alreadyRunningBody.action, "already_running");
    assertEquals(getPath(alreadyRunningBody, ["partifulAutoSync", "status"]), "queued");

    await mutateStateForTest(async (state, commit) => {
      state.partifulAutoSync = {
        ...state.partifulAutoSync,
        status: "completed",
        lastStartedAt: new Date().toISOString(),
        lastCompletedAt: new Date().toISOString(),
        lastRunId: "partiful-auto-recent-test",
        lastError: "",
      };
      return await commit(state);
    });

    const skipped = await router(
      new Request("http://localhost/api/sync/partiful/auto", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(skipped.status, 200);
    const skippedBody = await skipped.json() as Record<string, unknown>;
    assertEquals(skippedBody.action, "skipped");
    assertEquals(getPath(skippedBody, ["partifulAutoSync", "status"]), "completed");
  } finally {
    setAccountSessionForTest(undefined);
  }
});

kvRouterTest("sensitive API routes reject unauthenticated requests at the router", async () => {
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

kvRouterTest(
  "chat resources create latest and immutable public links with hash dedupe",
  async () => {
    await seedAuthUser({ id: "share_user_1", handle: "sharer" });
    useAccountSessionForTest({ id: "share_user_1", handle: "sharer" });
    const snapshot = {
      title: "Investor prep",
      messages: [
        { role: "user", content: "What should I ask at the event?" },
        { role: "assistant", content: "Lead with a concise founder question." },
      ],
    };
    const create = await router(
      new Request("http://localhost/api/resources/sharer/chat/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=share-session",
        },
        body: JSON.stringify(snapshot),
      }),
    );
    assertEquals(create.status, 201);
    const createBody = await create.json() as Record<string, unknown>;
    const hash = String(createBody.contentHash || "");
    const resourceId = String(createBody.resourceId || "");
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Expected SHA-256 hash, got ${hash}`);
    if (!resourceId) throw new Error("Expected resourceId.");
    if (!String(createBody.latestUrl || "").endsWith("/share/sharer/chat/latest")) {
      throw new Error(`Expected latest URL, got ${String(createBody.latestUrl || "")}`);
    }
    if (!String(createBody.immutableUrl || "").endsWith(`/share/sharer/chat/${hash}`)) {
      throw new Error(`Expected immutable URL, got ${String(createBody.immutableUrl || "")}`);
    }

    const latestRecord = await readLatestResourceForUser("share_user_1", "chat");
    assertEquals(latestRecord?.resourceId, resourceId);
    assertEquals((await readResourceByHash("chat", hash, "share_user_1"))?.resourceId, resourceId);

    setAccountSessionForTest(null);
    const latest = await router(new Request("http://localhost/api/share/sharer/chat/latest"));
    assertEquals(latest.status, 200);
    const latestBody = await latest.json() as Record<string, unknown>;
    assertEquals(getPath(latestBody, ["payload", "title"]), "Investor prep");
    assertEquals(getPath(latestBody, ["payload", "messageCount"]), 2);
    assertEquals(getPath(latestBody, ["payload", "messages"]), snapshot.messages);
    assertEquals(getPath(latestBody, ["payload", "createdByUserId"]), undefined);

    useAccountSessionForTest({ id: "share_user_1", handle: "sharer" });
    const duplicate = await router(
      new Request("http://localhost/api/resources/sharer/chat/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=share-session",
        },
        body: JSON.stringify(snapshot),
      }),
    );
    assertEquals(duplicate.status, 201);
    const duplicateBody = await duplicate.json() as Record<string, unknown>;
    assertEquals(duplicateBody.resourceId, resourceId);
    assertEquals(duplicateBody.contentHash, hash);

    const changed = await router(
      new Request("http://localhost/api/resources/sharer/chat/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=share-session",
        },
        body: JSON.stringify({
          ...snapshot,
          messages: [...snapshot.messages, { role: "user", content: "What changed?" }],
        }),
      }),
    );
    assertEquals(changed.status, 201);
    const changedBody = await changed.json() as Record<string, unknown>;
    if (changedBody.contentHash === hash || changedBody.resourceId === resourceId) {
      throw new Error("Expected changed chat payload to create a new immutable resource.");
    }

    setAccountSessionForTest(null);
    const immutable = await router(new Request(`http://localhost/api/share/sharer/chat/${hash}`));
    assertEquals(immutable.status, 200);
    const immutableBody = await immutable.json() as Record<string, unknown>;
    assertEquals(getPath(immutableBody, ["payload", "messages"]), snapshot.messages);
  },
);

kvRouterTest("static app fallback serves dotted share handle browser routes", async () => {
  const response = await router(new Request("http://localhost/share/jane.doe/chat/latest"));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
  const text = await response.text();
  if (!text.toLowerCase().includes("<!doctype html>")) {
    throw new Error("Expected dotted share route to serve the app shell.");
  }
});

kvRouterTest(
  "resource writes reject unauthenticated users, oversized chats, and non-owner deletes",
  async () => {
    await seedAuthUser({ id: "share_owner_2", handle: "sharer-two" });
    await seedAuthUser({ id: "share_other_2", handle: "not-owner" });

    setAccountSessionForTest(null);
    const unauthenticated = await router(
      new Request("http://localhost/api/resources/sharer-two/chat/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Share this" }] }),
      }),
    );
    assertEquals(unauthenticated.status, 401);

    useAccountSessionForTest({ id: "share_owner_2", handle: "sharer-two" });
    const oversized = await router(
      new Request("http://localhost/api/resources/sharer-two/chat/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=share-session",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(70_000) }] }),
      }),
    );
    assertEquals(oversized.status, 413);

    const create = await router(
      new Request("http://localhost/api/resources/sharer-two/chat/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "techweek_session=share-session",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Owner only" }],
        }),
      }),
    );
    assertEquals(create.status, 201);
    const createBody = await create.json() as Record<string, unknown>;
    const hash = String(createBody.contentHash || "");

    useAccountSessionForTest({ id: "share_other_2", handle: "not-owner" });
    const forbidden = await router(
      new Request(`http://localhost/api/resources/sharer-two/chat/${hash}`, {
        method: "DELETE",
        headers: { cookie: "techweek_session=share-session" },
      }),
    );
    assertEquals(forbidden.status, 403);

    useAccountSessionForTest({ id: "share_owner_2", handle: "sharer-two" });
    const revokeLatest = await router(
      new Request("http://localhost/api/resources/sharer-two/chat/latest", {
        method: "DELETE",
        headers: { cookie: "techweek_session=share-session" },
      }),
    );
    assertEquals(revokeLatest.status, 204);
    setAccountSessionForTest(null);
    assertEquals(
      (await router(new Request("http://localhost/api/share/sharer-two/chat/latest"))).status,
      404,
    );

    useAccountSessionForTest({ id: "share_owner_2", handle: "sharer-two" });
    const revokeHash = await router(
      new Request(`http://localhost/api/resources/sharer-two/chat/${hash}`, {
        method: "DELETE",
        headers: { cookie: "techweek_session=share-session" },
      }),
    );
    assertEquals(revokeHash.status, 204);
    setAccountSessionForTest(null);
    assertEquals(
      (await router(new Request(`http://localhost/api/share/sharer-two/chat/${hash}`))).status,
      404,
    );
  },
);

kvRouterTest("agenda recalculation creates a share-safe latest resource", async () => {
  await seedAuthUser({ id: "admin_123", handle: "admin", isAdmin: true });
  useAdminSessionForTest();
  const response = await router(
    new Request("http://localhost/api/agenda/recalculate", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
      body: JSON.stringify({
        activate: true,
        liveRouting: false,
        overrides: { excludedEventIds: ["TW-6408"] },
      }),
    }),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  const hash = String(getPath(body, ["resource", "contentHash"]) || "");
  const resourceId = String(getPath(body, ["resource", "resourceId"]) || "");
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Expected agenda hash, got ${hash}`);
  if (!resourceId) throw new Error("Expected agenda resource id.");

  setAccountSessionForTest(null);
  const latest = await router(new Request("http://localhost/api/share/admin/agenda/latest"));
  assertEquals(latest.status, 200);
  const latestBody = await latest.json() as Record<string, unknown>;
  assertEquals(getPath(latestBody, ["contentHash"]), hash);
  if (!Array.isArray(getPath(latestBody, ["payload", "days"]))) {
    throw new Error("Expected shared agenda days.");
  }
  assertEquals(getPath(latestBody, ["payload", "state"]), undefined);
  assertEquals(getPath(latestBody, ["payload", "sync"]), undefined);
  assertEquals(getPath(latestBody, ["payload", "email"]), undefined);

  const immutable = await router(new Request(`http://localhost/api/share/admin/agenda/${hash}`));
  assertEquals(immutable.status, 200);
  const immutableBody = await immutable.json() as Record<string, unknown>;
  assertEquals(
    getPath(immutableBody, ["payload", "days"]),
    getPath(latestBody, ["payload", "days"]),
  );

  useAccountSessionForTest({ id: "agenda-share-non-admin", handle: "admin" });
  const blocked = await router(
    new Request("http://localhost/api/resources/admin/agenda/share", {
      method: "POST",
      headers: { cookie: "techweek_session=share-session" },
    }),
  );
  assertEquals(blocked.status, 403);
  const blockedBody = await blocked.json() as Record<string, unknown>;
  assertEquals(getPath(blockedBody, ["error", "message"]), "Admin access required.");

  useAdminSessionForTest();
  const duplicate = await router(
    new Request("http://localhost/api/resources/admin/agenda/share", {
      method: "POST",
      headers: { cookie: "techweek_session=test-session" },
    }),
  );
  assertEquals(duplicate.status, 201);
  const duplicateBody = await duplicate.json() as Record<string, unknown>;
  assertEquals(duplicateBody.contentHash, hash);
  assertEquals(duplicateBody.resourceId, resourceId);
});

kvRouterTest("Google Calendar write sync endpoint is removed", async () => {
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

kvRouterTest("account session reports setup state without a local session cookie", async () => {
  try {
    const response = await router(new Request("http://localhost/api/account/session"));
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(getPath(body, ["session", "authenticated"]), false);
    assertEquals(getPath(body, ["session", "auth"]), "setup_required");
    assertEquals(getPath(body, ["session", "setupRequired"]), true);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

kvRouterTest("auth registration start returns a standalone WebAuthn user id", async () => {
  setAccountSessionForTest(undefined);
  const response = await router(
    new Request("http://localhost/api/auth/register/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: "Nik Pavlovcik",
        client_origin: "http://localhost",
      }),
    }),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assertEquals(getPath(body, ["handle"]), "nik-pavlovcik");
  assertEquals(getPath(body, ["admin"]), true);
  const webAuthnUserId = decodeBase64urlText(String(getPath(body, ["publicKey", "user", "id"])));
  if (!webAuthnUserId.startsWith("user_")) {
    throw new Error(`Expected generated internal WebAuthn user id, got ${webAuthnUserId}`);
  }
  if (webAuthnUserId.includes("nik")) {
    throw new Error(`Expected WebAuthn user id not to expose handle, got ${webAuthnUserId}`);
  }
});

kvRouterTest("account session returns authenticated local passkey identity", async () => {
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

kvRouterTest("admin can mint, list, use, and revoke agent tokens for existing users", async () => {
  await seedAuthUser({
    id: "admin_agent_user",
    handle: "admin",
    isAdmin: true,
    credentialIds: ["cred_a", "cred_b"],
  });
  await seedAuthUser({
    id: "target_agent_user",
    handle: "target",
    credentialIds: ["cred_target"],
  });
  useAccountSessionForTest({
    id: "admin_agent_user",
    handle: "admin",
    isAdmin: true,
    credentialCount: 2,
  });

  const selfResponse = await router(
    new Request("http://localhost/api/account/agent-tokens", {
      method: "POST",
      headers: { cookie: "techweek_session=test-session" },
    }),
  );
  assertEquals(selfResponse.status, 201);
  const selfBody = await selfResponse.json() as Record<string, unknown>;
  assertEquals(getPath(selfBody, ["agentToken", "user", "id"]), "admin_agent_user");
  const selfRawToken = String(getPath(selfBody, ["token"]) || "");
  if (!selfRawToken.startsWith("techweek_agent_")) {
    throw new Error(`Expected raw agent token at creation, got ${selfRawToken}`);
  }

  const targetResponse = await router(
    new Request("http://localhost/api/account/agent-tokens", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
      body: JSON.stringify({ handle: "target", ttlDays: 1 }),
    }),
  );
  assertEquals(targetResponse.status, 201);
  const targetBody = await targetResponse.json() as Record<string, unknown>;
  const targetRawToken = String(getPath(targetBody, ["token"]) || "");
  const targetTokenId = String(getPath(targetBody, ["agentToken", "id"]) || "");
  assertEquals(getPath(targetBody, ["agentToken", "user", "id"]), "target_agent_user");
  if (!targetRawToken.startsWith("techweek_agent_")) {
    throw new Error(`Expected target raw agent token at creation, got ${targetRawToken}`);
  }

  const listResponse = await router(
    new Request("http://localhost/api/account/agent-tokens", {
      headers: ADMIN_STATE_HEADERS,
    }),
  );
  assertEquals(listResponse.status, 200);
  const listBody = await listResponse.json() as Record<string, unknown>;
  const listedTokens = getPath(listBody, ["tokens"]);
  if (!Array.isArray(listedTokens) || listedTokens.length !== 2) {
    throw new Error(`Expected two listed token metadata entries, got ${JSON.stringify(listBody)}`);
  }
  const serializedList = JSON.stringify(listBody);
  if (serializedList.includes(targetRawToken) || serializedList.includes(selfRawToken)) {
    throw new Error(
      `Expected listed token metadata not to expose raw token values: ${serializedList}`,
    );
  }

  setAccountSessionForTest(undefined);
  const loginResponse = await router(
    new Request("http://localhost/api/auth/agent-token/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: targetRawToken }),
    }),
  );
  assertEquals(loginResponse.status, 200);
  const setCookie = loginResponse.headers.get("set-cookie") || "";
  if (!setCookie.includes("techweek_session=")) {
    throw new Error(`Expected agent token login to set session cookie, got ${setCookie}`);
  }
  const loginBody = await loginResponse.json() as Record<string, unknown>;
  assertEquals(getPath(loginBody, ["session", "authenticated"]), true);
  assertEquals(getPath(loginBody, ["session", "auth"]), "agent_token");
  assertEquals(getPath(loginBody, ["session", "user", "id"]), "target_agent_user");

  const sessionCookie = setCookie.split(";")[0] || "";
  const sessionResponse = await router(
    new Request("http://localhost/api/account/session", {
      headers: { cookie: sessionCookie },
    }),
  );
  assertEquals(sessionResponse.status, 200);
  const sessionBody = await sessionResponse.json() as Record<string, unknown>;
  assertEquals(getPath(sessionBody, ["session", "auth"]), "agent_token");
  assertEquals(getPath(sessionBody, ["session", "user", "id"]), "target_agent_user");

  useAccountSessionForTest({
    id: "admin_agent_user",
    handle: "admin",
    isAdmin: true,
    credentialCount: 2,
  });
  const revokeResponse = await router(
    new Request(`http://localhost/api/account/agent-tokens/${targetTokenId}`, {
      method: "DELETE",
      headers: ADMIN_STATE_HEADERS,
    }),
  );
  assertEquals(revokeResponse.status, 204);

  setAccountSessionForTest(undefined);
  const revokedLoginResponse = await router(
    new Request("http://localhost/api/auth/agent-token/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: targetRawToken }),
    }),
  );
  assertEquals(revokedLoginResponse.status, 401);
  assertEquals(revokedLoginResponse.headers.get("set-cookie"), null);
});

kvRouterTest("agent token minting only targets existing accounts", async () => {
  await seedAuthUser({
    id: "admin_agent_missing_user",
    handle: "admin-missing",
    isAdmin: true,
  });
  useAccountSessionForTest({
    id: "admin_agent_missing_user",
    handle: "admin-missing",
    isAdmin: true,
  });
  try {
    const missingHandle = await router(
      new Request("http://localhost/api/account/agent-tokens", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
        body: JSON.stringify({ handle: "missing" }),
      }),
    );
    assertEquals(missingHandle.status, 404);

    const missingUserId = await router(
      new Request("http://localhost/api/account/agent-tokens", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
        body: JSON.stringify({ userId: "missing_user_id" }),
      }),
    );
    assertEquals(missingUserId.status, 404);

    const listResponse = await router(
      new Request("http://localhost/api/account/agent-tokens", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    const listBody = await listResponse.json() as Record<string, unknown>;
    assertEquals(getPath(listBody, ["tokens"]), []);
  } finally {
    setAccountSessionForTest(undefined);
  }
});

kvRouterTest("agent token login rejects malformed unknown and expired tokens", async () => {
  await seedAuthUser({ id: "expired_agent_user", handle: "expired-agent" });
  const expiredToken = `techweek_agent_${"A".repeat(43)}`;
  const expiredHash = await sha256Base64url(expiredToken);
  await writeCacheValue("auth-agent-token", expiredHash, {
    id: "agent_token_expired",
    tokenHash: expiredHash,
    userId: "expired_agent_user",
    userHandle: "expired-agent",
    userIsAdmin: false,
    userCredentialCount: 0,
    createdByUserId: "admin_agent_user",
    createdByHandle: "admin",
    createdAt: "2026-05-01T12:00:00.000Z",
    expiresAt: "2026-05-01T12:01:00.000Z",
  }, { ttlMs: 0 });

  for (
    const token of [
      "not-a-token",
      `techweek_agent_${"B".repeat(43)}`,
      expiredToken,
    ]
  ) {
    const response = await router(
      new Request("http://localhost/api/auth/agent-token/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    assertEquals(response.status, 401);
    assertEquals(response.headers.get("set-cookie"), null);
  }
});

kvRouterTest("account invite GET/POST reject unauthenticated requests", async () => {
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

kvRouterTest(
  "account invite GET returns stable code and payload for the same authenticated user",
  async () => {
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
  },
);

kvRouterTest("account invite claim records referral, ignores self-referral", async () => {
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

kvRouterTest(
  "agenda recalculation rejects unauthenticated activation without changing active agenda",
  async () => {
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
  },
);

kvRouterTest("state lead creation rejects unauthenticated follow-up email mutation", async () => {
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

kvRouterTest("concurrent lead creation preserves both state updates", async () => {
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

kvRouterTest("lead creation persists rapid capture qualification fields", async () => {
  useAdminSessionForTest();
  const leadName = `Qualified Lead ${crypto.randomUUID().slice(0, 8)}`;
  const create = await router(
    new Request("http://localhost/api/state", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
      body: JSON.stringify({
        type: "lead_create",
        calendarBlockId: "TW-5978-SCHEDULE",
        name: leadName,
        company: "Source Linked Labs",
        role: "VP Engineering",
        buyerType: "Engineering leader",
        githubHeavy: "yes",
        aiCodingAdoption: "yes",
        painMentioned: "Managers rebuild review evidence manually.",
        strongQuote: "Commits miss half the work.",
        followUp: "React to a sample manager packet.",
        nextStepDate: "2026-06-08",
        notes: "Met after the panel.",
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
    const body = await schedule.json() as Record<string, unknown>;
    const state = getPath(body, ["state"]) as Record<string, unknown> | undefined;
    const leads = Array.isArray(state?.leads) ? state.leads as unknown[] : [];
    const lead = leads.find((item) => getPath(item, ["id"]) === createdId) as
      | Record<string, unknown>
      | undefined;
    if (!lead) throw new Error("Expected persisted lead.");
    assertEquals(lead.buyerType, "Engineering leader");
    assertEquals(lead.githubHeavy, "yes");
    assertEquals(lead.aiCodingAdoption, "yes");
    assertEquals(lead.painMentioned, "Managers rebuild review evidence manually.");
    assertEquals(lead.strongQuote, "Commits miss half the work.");
    assertEquals(lead.followUp, "React to a sample manager packet.");
    assertEquals(lead.nextStepDate, "2026-06-08");
    assertEquals(lead.priority, "A");
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

kvRouterTest("CRM lead export API returns JSON, CSV, and state snapshots", async () => {
  useAdminSessionForTest();
  const leadName = `Export Lead ${crypto.randomUUID().slice(0, 8)}`;
  const create = await router(
    new Request("http://localhost/api/state", {
      method: "POST",
      headers: ADMIN_STATE_HEADERS,
      body: JSON.stringify({
        type: "lead_create",
        calendarBlockId: "TW-5978-SCHEDULE",
        name: leadName,
        company: "Export Labs",
        role: "Head of Engineering",
        email: "export@example.com",
        buyerType: "Engineering leader",
        githubHeavy: "yes",
        aiCodingAdoption: "yes",
        painMentioned: "Needs cleaner manager packets.",
        followUp: "Send sample packet.",
        notes: "CSV export regression, includes comma.",
      }),
    }),
  );
  if (create.status !== 200) throw new Error(`Expected create status 200, got ${create.status}`);
  const created = await create.json() as Record<string, unknown>;
  const createdId = String(getPath(created, ["lead", "id"]) || "");
  try {
    const leadsJson = await router(
      new Request("http://localhost/api/export/leads.json", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(leadsJson.status, 200);
    assertEquals(leadsJson.headers.get("content-type"), "application/json; charset=utf-8");
    const leadsPayload = await leadsJson.json() as Record<string, unknown>;
    assertEquals(getPath(leadsPayload, ["count"]), 1);
    const exportedLeads = Array.isArray(leadsPayload.leads) ? leadsPayload.leads : [];
    const exportedLead = exportedLeads[0] as Record<string, unknown> | undefined;
    assertEquals(exportedLead?.name, leadName);
    assertEquals(exportedLead?.priority, "A");

    const leadsCsv = await router(
      new Request("http://localhost/api/export/leads.csv", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(leadsCsv.status, 200);
    assertEquals(leadsCsv.headers.get("content-type"), "text/csv; charset=utf-8");
    const csv = await leadsCsv.text();
    if (!csv.startsWith("id,createdAt,updatedAt,eventTitle")) {
      throw new Error(`Expected CRM CSV header, got ${csv}`);
    }
    if (!csv.includes(leadName) || !csv.includes('"CSV export regression, includes comma."')) {
      throw new Error(`Expected CSV to include escaped lead row, got ${csv}`);
    }

    const stateJson = await router(
      new Request("http://localhost/api/export/state.json", {
        headers: ADMIN_STATE_HEADERS,
      }),
    );
    assertEquals(stateJson.status, 200);
    const statePayload = await stateJson.json() as Record<string, unknown>;
    assertEquals(getPath(statePayload, ["version"]), 1);
    const exportedState = getPath(statePayload, ["state"]) as Record<string, unknown> | undefined;
    const stateLeads = Array.isArray(exportedState?.leads) ? exportedState.leads : [];
    const stateLead = stateLeads[0] as Record<string, unknown> | undefined;
    assertEquals(stateLead?.id, createdId);
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

kvRouterTest("lead creation persists compact OCR provenance metadata", async () => {
  useAdminSessionForTest();
  const leadName = `OCR Metadata ${crypto.randomUUID().slice(0, 8)}`;
  const draft = {
    ocrSource: "canvas_auto_edge_crop",
    attemptIndex: 0,
    outputWidth: 1400,
    outputHeight: 820,
    dataUrlCharacters: 900000,
  };
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
        ocr: draft,
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

kvRouterTest("lead OCR endpoint is vision-only and returns no server OCR metadata", async () => {
  useAdminSessionForTest();
  const originalFetch = globalThis.fetch;
  const originalToken = Deno.env.get("UOS_AI_TOKEN");
  const calls: Array<{ url: string; body: string }> = [];
  Deno.env.set("UOS_AI_TOKEN", "test-vision-only-token");
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/chat/completions")) {
      calls.push({ url, body: String(init?.body ?? "{}") });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: `chatcmpl_${crypto.randomUUID()}`,
            object: "chat.completion",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  name: "Ada Lovelace",
                  company: "Analytica",
                  role: "Founder",
                  email: "ada@analytica.example",
                  phone: "+1 212 555 0101",
                }),
              },
              finish_reason: "stop",
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const response = await router(
      new Request("http://localhost/api/leads/ocr", {
        method: "POST",
        headers: ADMIN_STATE_HEADERS,
        body: JSON.stringify({
          requestId: "vision-only-ocr-test",
          eventTitle: "Beyond the Spec",
          imageDataUrl: "data:image/jpeg;base64,QUJD",
          clientMetadata: {
            attemptIndex: 0,
            image: {
              sourceExifOrientation: 6,
              ocrSource: "canvas_auto_edge_crop",
              outputWidth: 1234,
              outputHeight: 5678,
              ocrDataUrlCharacters: 424242,
            },
          },
        }),
      }),
    );
    if (response.status !== 200) {
      throw new Error(`Expected OCR status 200, got ${response.status}`);
    }
    const body = await response.json() as Record<string, unknown>;
    if (body.source !== "vision_only") {
      throw new Error(`Expected source vision_only, got ${body.source}`);
    }
    if ("ocrMetadata" in body) {
      throw new Error("Expected no ocrMetadata in OCR response.");
    }
    if (calls.length !== 1) {
      throw new Error(`Expected one upstream chat call, got ${calls.length}`);
    }
    const gatewayPayload = JSON.parse(calls[0].body) as {
      model?: string;
      messages?: Array<Record<string, unknown>>;
    };
    if (gatewayPayload.model !== "gpt-5.5") {
      throw new Error(`Expected gpt-5.5 gateway model, got ${gatewayPayload.model}`);
    }
    const firstMessage = gatewayPayload.messages?.[0];
    const content = Array.isArray(firstMessage?.content)
      ? firstMessage.content as Array<Record<string, unknown>>
      : [];
    const imagePart = content.find((part) => part.type === "image_url");
    if (!imagePart || typeof imagePart.image_url !== "object" || !imagePart.image_url) {
      throw new Error("Expected image_url content part in chat completion payload.");
    }
    const imageUrl = (imagePart.image_url as { url?: unknown }).url;
    if (imageUrl !== "data:image/jpeg;base64,QUJD") {
      throw new Error(`Expected original image payload to be sent to gateway, got ${imageUrl}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      Deno.env.delete("UOS_AI_TOKEN");
    } else {
      Deno.env.set("UOS_AI_TOKEN", originalToken);
    }
    setAccountSessionForTest(undefined);
  }
});

kvRouterTest("lead creation ignores invalid OCR metadata payloads", async () => {
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

async function sha256Base64url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
