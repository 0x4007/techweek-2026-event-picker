import {
  buildCallableSnapshot,
  callableResult,
  extractFirebaseAuthRecord,
  parseStoredPartifulAuthJson,
  partifulIdFromUrl,
} from "./partiful_headless.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("extractFirebaseAuthRecord reads Firebase IndexedDB rows", () => {
  const auth = extractFirebaseAuthRecord(
    {
      indexedDb: [{
        db: "firebaseLocalStorageDb",
        store: "firebaseLocalStorage",
        rows: [{
          fbase_key: "firebase:authUser:test-api-key:[DEFAULT]",
          value: {
            uid: "user-123",
            appName: "[DEFAULT]",
            stsTokenManager: {
              accessToken: "access-token",
              refreshToken: "refresh-token",
              expirationTime: 1770000000000,
            },
          },
        }],
      }],
    },
    "agent-browser:test",
    new Date("2026-05-14T12:00:00Z"),
  );

  assertEquals(
    auth && {
      source: auth.source,
      apiKey: auth.apiKey,
      userId: auth.userId,
      expiresAt: auth.expirationTime,
    },
    {
      source: "agent-browser:test",
      apiKey: "test-api-key",
      userId: "user-123",
      expiresAt: 1770000000000,
    },
  );
});

Deno.test("extractFirebaseAuthRecord reads Firebase Web Storage JSON strings", () => {
  for (const storageName of ["localStorage", "sessionStorage"]) {
    const auth = extractFirebaseAuthRecord(
      {
        [storageName]: {
          "firebase:authUser:test-api-key:[DEFAULT]": JSON.stringify({
            uid: "user-123",
            appName: "[DEFAULT]",
            stsTokenManager: {
              accessToken: `${storageName}-access-token`,
              refreshToken: `${storageName}-refresh-token`,
              expirationTime: 1770000000000,
            },
          }),
        },
        indexedDb: [],
      },
      `agent-browser:${storageName}`,
      new Date("2026-05-14T12:00:00Z"),
    );

    assertEquals(
      auth && {
        source: auth.source,
        apiKey: auth.apiKey,
        userId: auth.userId,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: auth.expirationTime,
      },
      {
        source: `agent-browser:${storageName}`,
        apiKey: "test-api-key",
        userId: "user-123",
        accessToken: `${storageName}-access-token`,
        refreshToken: `${storageName}-refresh-token`,
        expiresAt: 1770000000000,
      },
    );
  }
});

Deno.test("parseStoredPartifulAuthJson validates deploy secret payloads", () => {
  const auth = parseStoredPartifulAuthJson(JSON.stringify({
    version: 1,
    source: "test",
    capturedAt: "2026-05-14T12:00:00Z",
    updatedAt: "2026-05-14T12:00:00Z",
    apiKey: "api-key",
    appName: "[DEFAULT]",
    userId: "user-123",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expirationTime: 1770000000000,
  }));

  assertEquals({
    source: auth.source,
    userId: auth.userId,
    expirationTime: auth.expirationTime,
  }, {
    source: "test",
    userId: "user-123",
    expirationTime: 1770000000000,
  });
});

Deno.test("buildCallableSnapshot extracts viewer status from callable payloads", () => {
  const snapshot = buildCallableSnapshot(
    {
      eventUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs?c=s6u4EYds",
      partifulId: "OF1vP5L8dtXKRtInyWKs",
      title: "Open Source Must Win",
    },
    {
      result: {
        event: {
          title: "Open Source Must Win",
          publicShortUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
        },
      },
    },
    {
      result: {
        guests: [{
          userId: "user-123",
          status: "APPROVED",
          rsvp: { count: 2 },
        }],
      },
    },
    "user-123",
  );

  assertEquals({
    partifulId: snapshot.partifulId,
    title: snapshot.title,
    guest: snapshot.guest,
    rsvp: snapshot.rsvp,
  }, {
    partifulId: "OF1vP5L8dtXKRtInyWKs",
    title: "Open Source Must Win",
    guest: {
      userId: "user-123",
      status: "APPROVED",
      rsvp: { count: 2 },
    },
    rsvp: { count: 2 },
  });
});

Deno.test("callableResult unwraps Firebase callable responses", () => {
  assertEquals(callableResult({ result: { event: { title: "A" } } }), { event: { title: "A" } });
  assertEquals(callableResult({ result: { data: { event: { title: "B" } } } }), {
    event: { title: "B" },
  });
  assertEquals(partifulIdFromUrl("https://partiful.com/events/abc123?c=invite"), "abc123");
});
