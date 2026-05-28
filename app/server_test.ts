import {
  buildLeadFollowUpEmailContent,
  deriveLeadPriorityForLead,
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
import {
  deleteSharedChat,
  purgeSoftDeletedSharedChats,
  readSharedChat,
  readStateValue,
  setKvPathForTest,
  writeCacheValue,
  writeSharedChat,
  writeStateValue,
} from "./lib/kv_store.ts";

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

kvRouterTest("chat share creates an authenticated snapshot and reads it publicly", async () => {
  useAccountSessionForTest({ id: "share_user_1", handle: "sharer" });
  const create = await router(
    new Request("http://localhost/api/chat/share", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "techweek_session=share-session",
      },
      body: JSON.stringify({
        title: "Investor prep",
        messages: [
          { role: "user", content: "What should I ask at the event?" },
          { role: "assistant", content: "Lead with a concise founder question." },
        ],
      }),
    }),
  );
  assertEquals(create.status, 200);
  const createBody = await create.json() as Record<string, unknown>;
  const shareId = String(createBody.shareId || "");
  if (!/^[0-9a-f]{32}$/.test(shareId)) {
    throw new Error(`Expected URL-safe chat share id, got ${shareId}`);
  }

  setAccountSessionForTest(null);
  const readback = await router(
    new Request(`http://localhost/api/chat/share/${shareId}`),
  );
  assertEquals(readback.status, 200);
  const shared = await readback.json() as Record<string, unknown>;
  assertEquals(shared.shareId, shareId);
  assertEquals(shared.createdByUserId, "share_user_1");
  assertEquals(shared.title, "Investor prep");
  assertEquals(shared.messageCount, 2);
  assertEquals(shared.messages, [
    { role: "user", content: "What should I ask at the event?" },
    { role: "assistant", content: "Lead with a concise founder question." },
  ]);

  const invalid = await router(new Request("http://localhost/api/chat/share/not-valid"));
  assertEquals(invalid.status, 404);
});

kvRouterTest("chat share rejects unauthenticated and oversized creates", async () => {
  setAccountSessionForTest(null);
  const unauthenticated = await router(
    new Request("http://localhost/api/chat/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Share this" }],
      }),
    }),
  );
  assertEquals(unauthenticated.status, 401);
  const unauthenticatedBody = await unauthenticated.json() as Record<string, unknown>;
  assertEquals(getPath(unauthenticatedBody, ["error", "message"]), "Authentication required.");

  useAccountSessionForTest({ id: "share_user_2", handle: "oversized" });
  const oversized = await router(
    new Request("http://localhost/api/chat/share", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "techweek_session=share-session",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "x".repeat(70_000) }],
      }),
    }),
  );
  assertEquals(oversized.status, 413);
  const oversizedBody = await oversized.json() as Record<string, unknown>;
  if (!String(getPath(oversizedBody, ["error", "message"]) || "").includes("too large")) {
    throw new Error("Expected oversized chat share response to include size guidance.");
  }
});

kvRouterTest("chat share owner can soft-delete and hide from public GET", async () => {
  useAccountSessionForTest({ id: "share_owner_1", handle: "sharer" });
  const create = await router(
    new Request("http://localhost/api/chat/share", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "techweek_session=share-session",
      },
      body: JSON.stringify({
        title: "Investor prep",
        messages: [
          { role: "user", content: "What should I ask at the event?" },
          { role: "assistant", content: "Lead with a concise founder question." },
        ],
      }),
    }),
  );
  assertEquals(create.status, 200);
  const createBody = await create.json() as Record<string, unknown>;
  const shareId = String(createBody.shareId || "");
  if (!/^[0-9a-f]{32}$/.test(shareId)) {
    throw new Error(`Expected URL-safe chat share id, got ${shareId}`);
  }

  const deleted = await router(
    new Request(`http://localhost/api/chat/share/${shareId}`, {
      method: "DELETE",
      headers: { cookie: "techweek_session=share-session" },
    }),
  );
  assertEquals(deleted.status, 204);

  setAccountSessionForTest(null);
  const hidden = await router(new Request(`http://localhost/api/chat/share/${shareId}`));
  assertEquals(hidden.status, 404);
});

kvRouterTest("chat share delete denies non-owners and missing shares", async () => {
  useAccountSessionForTest({ id: "share_owner_2", handle: "sharer-two" });
  const create = await router(
    new Request("http://localhost/api/chat/share", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "techweek_session=share-session",
      },
      body: JSON.stringify({
        title: "Investor prep",
        messages: [
          { role: "user", content: "What should I ask at the event?" },
          { role: "assistant", content: "Lead with a concise founder question." },
        ],
      }),
    }),
  );
  assertEquals(create.status, 200);
  const createBody = await create.json() as Record<string, unknown>;
  const shareId = String(createBody.shareId || "");
  useAccountSessionForTest({ id: "share_other_2", handle: "not-owner" });

  const forbidden = await router(
    new Request(`http://localhost/api/chat/share/${shareId}`, {
      method: "DELETE",
      headers: { cookie: "techweek_session=share-session" },
    }),
  );
  assertEquals(forbidden.status, 403);

  const missing = await router(
    new Request(
      "http://localhost/api/chat/share/00000000000000000000000000000000",
      {
        method: "DELETE",
        headers: { cookie: "techweek_session=share-session" },
      },
    ),
  );
  assertEquals(missing.status, 404);
});

kvRouterTest("soft-deleted shared chats are hard-deleted during cleanup", async () => {
  await writeSharedChat("share_keep", {
    shareId: "share_keep",
    createdAt: "2026-05-20T12:00:00.000Z",
    createdByUserId: "owner_keep",
    title: "Visible chat",
    messages: [{ role: "user", content: "Keep this" }],
    messageCount: 1,
  });
  await writeSharedChat("share_delete", {
    shareId: "share_delete",
    createdAt: "2026-05-20T12:00:00.000Z",
    createdByUserId: "owner_delete",
    title: "Deleted chat",
    messages: [{ role: "user", content: "Delete this" }],
    messageCount: 1,
    deletedAt: "2026-05-21T12:00:00.000Z",
    deletedByUserId: "owner_delete",
  });

  const removed = await purgeSoftDeletedSharedChats();
  assertEquals(removed, 1);
  assertEquals(await readSharedChat("share_keep"), {
    shareId: "share_keep",
    createdAt: "2026-05-20T12:00:00.000Z",
    createdByUserId: "owner_keep",
    title: "Visible chat",
    messages: [{ role: "user", content: "Keep this" }],
    messageCount: 1,
  });
  assertEquals(await readSharedChat("share_delete"), null);

  await deleteSharedChat("share_keep");
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
