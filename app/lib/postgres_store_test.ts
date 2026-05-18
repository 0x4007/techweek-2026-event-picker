import { cacheCounts, listCacheValues, readCacheValue, writeCacheValue } from "./postgres_store.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("memory cache honors TTL expiration for read, list, and counts", async () => {
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
