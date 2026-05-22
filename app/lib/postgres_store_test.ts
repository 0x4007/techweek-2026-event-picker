import {
  cacheCounts,
  isPostgresStoreConfigured,
  listCacheValues,
  PUBLIC_STORE_HEALTH_ERROR,
  readCacheValue,
  readStateValue,
  storeHealth,
  writeCacheValue,
  writeStateValue,
} from "./postgres_store.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("local KV cache honors TTL expiration for read, list, and counts", async () => {
  if (Deno.env.get("DATABASE_URL")) return;
  const namespace = `ttl-test-${crypto.randomUUID()}`;
  await writeCacheValue(namespace, "expired", { value: 1 }, {
    ttlMs: 0,
    metadata: { status: "expired" },
  });
  await writeCacheValue(namespace, "fresh", { value: 2 }, {
    ttlMs: 60_000,
    metadata: { status: "fresh" },
  });

  assertEquals(await readCacheValue(namespace, "expired"), null);
  assertEquals(await readCacheValue(namespace, "fresh"), { value: 2 });

  const listed = await listCacheValues(namespace);
  assertEquals(listed.map((item) => item.cacheId), ["fresh"]);
  assertEquals(listed[0].metadata, { status: "fresh" });
  assertEquals(await cacheCounts([namespace]), { [namespace]: 1 });
});

Deno.test("local KV state persists values when Postgres is not configured", async () => {
  if (Deno.env.get("DATABASE_URL")) return;
  const key = `state-test-${crypto.randomUUID()}`;
  const value = { durable: true, createdAt: new Date().toISOString() };

  await writeStateValue(key, value);

  assertEquals(await readStateValue(key), value);
  const health = await storeHealth();
  assertEquals(health, { backend: "kv", status: "ready", error: "" });
});

Deno.test("local KV state persists large planner-sized values in chunks", async () => {
  if (Deno.env.get("DATABASE_URL")) return;
  const key = `large-state-test-${crypto.randomUUID()}`;
  const value = {
    durable: true,
    agenda: Array.from({ length: 150 }, (_, index) => ({
      id: `block-${index}`,
      title: `Planner block ${index}`,
      details: "x".repeat(900),
    })),
  };

  await writeStateValue(key, value);

  assertEquals(await readStateValue(key), value);
});

Deno.test("Postgres configuration helper distinguishes database and local persistence modes", () => {
  assertEquals(isPostgresStoreConfigured(""), false);
  assertEquals(isPostgresStoreConfigured("postgres://user:secret@db.example.com/app"), true);
});

Deno.test("storeHealth redacts Postgres errors from public health output", async () => {
  const previousDatabaseUrl = Deno.env.get("DATABASE_URL");
  const previousConsoleError = console.error;
  Deno.env.set("DATABASE_URL", "postgres://user:secret@127.0.0.1:1/sensitive_db");
  console.error = () => undefined;
  try {
    const health = await storeHealth();
    assertEquals(health, {
      backend: "postgres",
      status: "error",
      error: PUBLIC_STORE_HEALTH_ERROR,
    });
  } finally {
    console.error = previousConsoleError;
    if (previousDatabaseUrl === undefined) Deno.env.delete("DATABASE_URL");
    else Deno.env.set("DATABASE_URL", previousDatabaseUrl);
  }
});
