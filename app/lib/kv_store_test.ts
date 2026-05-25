import {
  cacheCounts,
  deleteCacheValue,
  listCacheValues,
  PUBLIC_STORE_HEALTH_ERROR,
  readCacheValue,
  readStateEntry,
  readStateValue,
  setKvPathForTest,
  storeHealth,
  writeCacheValue,
  writeStateValue,
  writeStateValueIfVersion,
} from "./kv_store.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("Deno KV state values round-trip", async () => {
  await withMemoryKv(async () => {
    const key = `state-test-${crypto.randomUUID()}`;
    await writeStateValue(key, { value: 42 });
    assertEquals(await readStateValue(key), { value: 42 });
  });
});

Deno.test("Deno KV state writes can reject stale versionstamps", async () => {
  await withMemoryKv(async () => {
    const key = `state-cas-test-${crypto.randomUUID()}`;
    const empty = await readStateEntry<{ value: number }>(key);
    assertEquals(empty, { value: null, versionstamp: null });

    const firstVersion = await writeStateValueIfVersion(key, empty.versionstamp, { value: 1 });
    if (!firstVersion) throw new Error("Expected initial conditional write to commit.");

    const staleVersion = await writeStateValueIfVersion(key, empty.versionstamp, { value: 2 });
    assertEquals(staleVersion, null);
    assertEquals(await readStateValue(key), { value: 1 });
  });
});

Deno.test("Deno KV cache honors TTL expiration for read, list, and counts", async () => {
  await withMemoryKv(async () => {
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
});

Deno.test("Deno KV cache reads legacy kv-json wrapped records", async () => {
  await withTempKvPath(async (path) => {
    const namespace = `legacy-cache-test-${crypto.randomUUID()}`;
    const rawKv = await Deno.openKv(path);
    await rawKv.set(["cache", namespace, "legacy"], {
      kind: "kv-json",
      storage: "inline",
      value: {
        kind: "cache",
        value: { value: 3 },
        metadata: { status: "legacy" },
        updatedAt: "2026-05-20T00:00:00.000Z",
        expiresAtMs: null,
      },
    });
    rawKv.close();

    assertEquals(await readCacheValue(namespace, "legacy"), { value: 3 });
    const listed = await listCacheValues(namespace);
    assertEquals(listed.map((item) => item.cacheId), ["legacy"]);
    assertEquals(listed[0].metadata, { status: "legacy" });
    assertEquals(await cacheCounts([namespace]), { [namespace]: 1 });
  });
});

Deno.test("Deno KV cache chunks values over the KV size limit", async () => {
  await withTempKvPath(async () => {
    const namespace = `large-cache-test-${crypto.randomUUID()}`;
    const large = { text: "x".repeat(140_000), nested: { value: 42 } };
    await writeCacheValue(namespace, "large", large, {
      ttlMs: 60_000,
      metadata: { status: "large" },
    });

    assertEquals(await readCacheValue(namespace, "large"), large);
    const listed = await listCacheValues(namespace);
    assertEquals(listed.map((item) => item.cacheId), ["large"]);
    assertEquals(listed[0].value, large);
    assertEquals(listed[0].metadata, { status: "large" });

    await deleteCacheValue(namespace, "large");
    assertEquals(await readCacheValue(namespace, "large"), null);
  });
});

Deno.test("Deno KV state reads legacy kv-json wrapped values", async () => {
  await withTempKvPath(async (path) => {
    const key = `legacy-state-test-${crypto.randomUUID()}`;
    const rawKv = await Deno.openKv(path);
    await rawKv.set(["state", key], {
      kind: "kv-json",
      storage: "inline",
      value: { value: 42 },
    });
    rawKv.close();

    assertEquals(await readStateValue(key), { value: 42 });
  });
});

Deno.test("Deno KV state reads legacy chunked kv-json values", async () => {
  await withTempKvPath(async (path) => {
    const key = `legacy-chunked-state-test-${crypto.randomUUID()}`;
    const value = { text: "x".repeat(120_000), nested: { value: 42 } };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const chunkSize = Math.ceil(bytes.byteLength / 3);
    const rawKv = await Deno.openKv(path);
    for (let index = 0; index < 3; index += 1) {
      await rawKv.set(
        ["chunk", "state", key, index],
        bytes.slice(index * chunkSize, (index + 1) * chunkSize),
      );
    }
    await rawKv.set(["state", key], {
      kind: "kv-json",
      storage: "chunked",
      chunkCount: 3,
    });
    rawKv.close();

    assertEquals(await readStateValue(key), value);
  });
});

Deno.test("Deno KV state chunks large unconditional and conditional writes", async () => {
  await withTempKvPath(async () => {
    const directKey = `large-state-direct-${crypto.randomUUID()}`;
    const conditionalKey = `large-state-cas-${crypto.randomUUID()}`;
    const large = { text: "x".repeat(140_000), nested: { value: 42 } };

    await writeStateValue(directKey, large);
    assertEquals(await readStateValue(directKey), large);

    const empty = await readStateEntry<typeof large>(conditionalKey);
    const version = await writeStateValueIfVersion(conditionalKey, empty.versionstamp, large);
    if (!version) throw new Error("Expected large conditional write to commit.");
    assertEquals(await readStateValue(conditionalKey), large);
  });
});

Deno.test("storeHealth reports Deno KV readiness", async () => {
  await withMemoryKv(async () => {
    const health = await storeHealth();
    if (health.status === "ready") {
      assertEquals(health, { backend: "deno-kv", status: "ready", error: "" });
    } else {
      assertEquals(health, {
        backend: "deno-kv",
        status: "error",
        error: PUBLIC_STORE_HEALTH_ERROR,
      });
    }
  });
});

async function withMemoryKv(fn: () => Promise<void>): Promise<void> {
  await setKvPathForTest(":memory:");
  try {
    await fn();
  } finally {
    await setKvPathForTest(undefined);
  }
}

async function withTempKvPath(fn: (path: string) => Promise<void>): Promise<void> {
  await Deno.mkdir(".codex", { recursive: true });
  const dir = await Deno.makeTempDir({ dir: ".codex" });
  const path = `${dir}/kv.sqlite3`;
  await setKvPathForTest(path);
  try {
    await fn(path);
  } finally {
    await setKvPathForTest(undefined);
    await Deno.remove(dir, { recursive: true });
  }
}
