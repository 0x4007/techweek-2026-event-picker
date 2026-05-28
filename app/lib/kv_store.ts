export type JsonRecord = Record<string, unknown>;

export type StoreHealth = {
  backend: "deno-kv";
  status: "ready" | "error";
  error: string;
};

export type StateValueSnapshot<T> = {
  value: T | null;
  versionstamp: string | null;
};

export const PUBLIC_STORE_HEALTH_ERROR = "state store unavailable";

type KvCacheRecord<T = unknown> = {
  value: T;
  metadata: JsonRecord;
  updatedAt: string;
  expiresAtMs: number | null;
};

type KvJsonEnvelope = {
  kind?: unknown;
  storage?: unknown;
  value?: unknown;
  chunkCount?: unknown;
  chunkId?: unknown;
};

type PreparedKvValue = {
  value: unknown;
  chunkId: string;
  chunkCount: number;
};

const INLINE_JSON_BYTE_LIMIT = 48_000;
const CHUNK_BYTE_SIZE = 48_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let kvPromise: Promise<Deno.Kv> | null = null;
let kvPathForTest: string | undefined;

export async function setKvPathForTest(path: string | undefined): Promise<void> {
  const existing = kvPromise ? await kvPromise.catch(() => null) : null;
  existing?.close();
  kvPromise = null;
  kvPathForTest = path;
}

async function getKv(): Promise<Deno.Kv> {
  kvPromise ??= Deno.openKv(kvPathForTest);
  return await kvPromise;
}

export async function storeHealth(): Promise<StoreHealth> {
  try {
    const kv = await getKv();
    const probeKey = ["health", "state-store"];
    await kv.get(probeKey);
    return { backend: "deno-kv", status: "ready", error: "" };
  } catch (error) {
    console.error("Deno KV state store health check failed:", error);
    return {
      backend: "deno-kv",
      status: "error",
      error: PUBLIC_STORE_HEALTH_ERROR,
    };
  }
}

export async function readStateValue<T>(key: string): Promise<T | null> {
  return (await readStateEntry<T>(key)).value;
}

export async function readStateEntry<T>(key: string): Promise<StateValueSnapshot<T>> {
  const kv = await getKv();
  const logicalKey = stateKey(key);
  const result = await kv.get<unknown>(logicalKey);
  return {
    value: result.value === null ? null : await readKvJsonValue<T>(kv, logicalKey, result.value),
    versionstamp: result.versionstamp,
  };
}

export async function readSharedChat<T>(shareId: string): Promise<T | null> {
  const kv = await getKv();
  const result = await kv.get<T>(["shared_chat", shareId]);
  if (result.value === null) return null;
  return await readKvJsonValue<T>(kv, ["shared_chat", shareId], result.value);
}

export async function listSharedChats<T>(limit = 1000): Promise<
  Array<{ shareId: string; value: T }>
> {
  const kv = await getKv();
  const entries: Array<{ shareId: string; value: T }> = [];
  const maxEntries = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : null;
  for await (const entry of kv.list<unknown>({ prefix: ["shared_chat"] })) {
    const shareId = typeof entry.key[1] === "string" ? entry.key[1] : "";
    if (!shareId) continue;
    let value: T | null = null;
    try {
      value = await readKvJsonValue<T>(kv, entry.key, entry.value);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const recordShareId = typeof record.shareId === "string" ? record.shareId : "";
    if (recordShareId !== shareId) continue;
    entries.push({ shareId, value });
    if (maxEntries !== null && entries.length >= maxEntries) break;
  }
  return entries;
}

export async function writeStateValue<T>(key: string, value: T): Promise<void> {
  const kv = await getKv();
  const logicalKey = stateKey(key);
  const previous = await kv.get<unknown>(logicalKey);
  const prepared = await prepareKvJsonValue(kv, logicalKey, value);
  await kv.set(logicalKey, prepared.value);
  await cleanupReplacedChunks(kv, logicalKey, previous.value, prepared);
}

export async function writeStateValueIfVersion<T>(
  key: string,
  versionstamp: string | null,
  value: T,
): Promise<string | null> {
  const kv = await getKv();
  const logicalKey = stateKey(key);
  const prepared = await prepareKvJsonValue(kv, logicalKey, value);
  const result = await kv.atomic()
    .check({ key: logicalKey, versionstamp })
    .set(logicalKey, prepared.value)
    .commit();
  if (result.ok) return result.versionstamp;
  await cleanupPreparedChunks(kv, logicalKey, prepared);
  return null;
}

export async function writeSharedChat<T>(shareId: string, value: T): Promise<void> {
  const kv = await getKv();
  const key = ["shared_chat", shareId];
  try {
    await kv.set(key, value);
    return;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    await purgeSoftDeletedSharedChatsInStore(kv, 200);
    await kv.set(key, value);
  }
}

export async function deleteSharedChat(shareId: string): Promise<void> {
  const kv = await getKv();
  const key: Deno.KvKey = ["shared_chat", shareId];
  const current = await kv.get<unknown>(key);
  if (current.value === null) return;
  await deleteStoredValue(kv, key, current.value);
}

export async function purgeSoftDeletedSharedChats(limit = 200): Promise<number> {
  const kv = await getKv();
  return await purgeSoftDeletedSharedChatsInStore(kv, limit);
}

export async function readCacheValue<T>(namespace: string, cacheId: string): Promise<T | null> {
  const kv = await getKv();
  const key = cacheKey(namespace, cacheId);
  const result = await kv.get<unknown>(key);
  const record = await cacheRecordFromValue<T>(kv, key, result.value);
  if (!record) return null;
  if (cacheExpired(record)) {
    await deleteStoredValue(kv, key, result.value);
    return null;
  }
  return record.value;
}

export async function writeCacheValue<T>(
  namespace: string,
  cacheId: string,
  value: T,
  options: { ttlMs?: number; metadata?: JsonRecord } = {},
): Promise<void> {
  const kv = await getKv();
  const nowMs = Date.now();
  const record: KvCacheRecord<T> = {
    value,
    metadata: options.metadata ?? {},
    updatedAt: new Date(nowMs).toISOString(),
    expiresAtMs: options.ttlMs === undefined ? null : nowMs + options.ttlMs,
  };
  const logicalKey = cacheKey(namespace, cacheId);
  const previous = await kv.get<unknown>(logicalKey);
  const prepared = await prepareKvJsonValue(kv, logicalKey, record, options.ttlMs);
  await kv.set(logicalKey, prepared.value, kvSetOptions(options.ttlMs));
  await cleanupReplacedChunks(kv, logicalKey, previous.value, prepared);
}

export async function deleteCacheValue(namespace: string, cacheId: string): Promise<void> {
  const kv = await getKv();
  const logicalKey = cacheKey(namespace, cacheId);
  const current = await kv.get<unknown>(logicalKey);
  await deleteStoredValue(kv, logicalKey, current.value);
}

export async function listCacheValues<T>(
  namespace: string,
  limit = 1000,
): Promise<Array<{ cacheId: string; value: T; metadata: JsonRecord; updatedAt: string }>> {
  const kv = await getKv();
  const entries: Array<{ cacheId: string; record: KvCacheRecord<T> }> = [];
  const expiredValues: Array<{ key: Deno.KvKey; value: unknown }> = [];
  for await (const entry of kv.list<unknown>({ prefix: cachePrefix(namespace) })) {
    const record = await cacheRecordFromValue<T>(kv, entry.key, entry.value);
    if (!record) continue;
    if (cacheExpired(record)) {
      expiredValues.push({ key: entry.key, value: entry.value });
      continue;
    }
    entries.push({
      cacheId: String(entry.key[2] ?? ""),
      record,
    });
  }
  await Promise.all(expiredValues.map((entry) => deleteStoredValue(kv, entry.key, entry.value)));
  return entries
    .sort((a, b) => Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt))
    .slice(0, limit)
    .map(({ cacheId, record }) => ({
      cacheId,
      value: record.value,
      metadata: record.metadata,
      updatedAt: record.updatedAt,
    }));
}

export async function cacheCounts(namespaces: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const namespace of namespaces) {
    counts[namespace] = (await listCacheValues(namespace)).length;
  }
  return counts;
}

function cachePrefix(namespace: string): Deno.KvKey {
  return ["cache", namespace];
}

function stateKey(key: string): Deno.KvKey {
  return ["state", key];
}

function cacheKey(namespace: string, cacheId: string): Deno.KvKey {
  return [...cachePrefix(namespace), cacheId];
}

async function purgeSoftDeletedSharedChatsInStore(
  kv: Deno.Kv,
  limit = 200,
): Promise<number> {
  const sharedChats = await listSharedChats<unknown>(0);
  const softDeleted = sharedChats
    .map((item) => {
      const value = item.value as Record<string, unknown>;
      return {
        key: ["shared_chat", item.shareId] as Deno.KvKey,
        deletedAt: typeof value.deletedAt === "string" ? value.deletedAt : "",
      };
    })
    .filter((item) => item.deletedAt);

  softDeleted.sort((left, right) => {
    const leftAt = Date.parse(left.deletedAt || "");
    const rightAt = Date.parse(right.deletedAt || "");
    if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return 0;
    if (Number.isNaN(leftAt)) return 1;
    if (Number.isNaN(rightAt)) return -1;
    return leftAt - rightAt;
  });

  const cleanupTargets = limit > 0 ? softDeleted.slice(0, limit) : softDeleted;
  await Promise.all(
    cleanupTargets.map(async (entry) => {
      const current = await kv.get<unknown>(entry.key);
      if (current.value !== null) {
        await deleteStoredValue(kv, entry.key, current.value);
      }
    }),
  );
  return cleanupTargets.length;
}

function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  const name = String((error as { name?: unknown }).name || "").toLowerCase();
  const messageMentionsQuota = message.includes("quota") ||
    message.includes("out of space") ||
    message.includes("storage limit") ||
    message.includes("storage exceeded");
  return name.includes("quota") || name.includes("full") || messageMentionsQuota ||
    (message.includes("storage") && message.includes("exceed"));
}

function kvSetOptions(ttlMs: number | undefined): { expireIn?: number } | undefined {
  return ttlMs && ttlMs > 0 ? { expireIn: ttlMs } : undefined;
}

function cacheExpired(record: KvCacheRecord): boolean {
  return record.expiresAtMs !== null && record.expiresAtMs <= Date.now();
}

async function cacheRecordFromValue<T>(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  value: unknown,
): Promise<KvCacheRecord<T> | null> {
  const unwrapped = await readKvJsonValue(kv, logicalKey, value);
  if (!unwrapped || typeof unwrapped !== "object") return null;
  const record = unwrapped as Record<string, unknown>;
  if (!Object.hasOwn(record, "value")) return null;
  return {
    value: record.value as T,
    metadata: jsonRecord(record.metadata),
    updatedAt: stringValue(record.updatedAt) || new Date(0).toISOString(),
    expiresAtMs: expiresAtMsValue(record.expiresAtMs),
  };
}

async function prepareKvJsonValue<T>(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  value: T,
  ttlMs?: number,
): Promise<PreparedKvValue> {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("Deno KV JSON values must be serializable.");
  }
  const bytes = encoder.encode(json);
  if (bytes.byteLength <= INLINE_JSON_BYTE_LIMIT) {
    return { value, chunkId: "", chunkCount: 0 };
  }

  const chunkId = crypto.randomUUID();
  const chunkCount = Math.ceil(bytes.byteLength / CHUNK_BYTE_SIZE);
  await Promise.all(
    Array.from({ length: chunkCount }, async (_, index) => {
      const start = index * CHUNK_BYTE_SIZE;
      const chunk = bytes.slice(start, start + CHUNK_BYTE_SIZE);
      await kv.set(chunkKey(logicalKey, chunkId, index), chunk, kvSetOptions(ttlMs));
    }),
  );

  return {
    value: {
      kind: "kv-json",
      storage: "chunked",
      chunkId,
      chunkCount,
      byteLength: bytes.byteLength,
    },
    chunkId,
    chunkCount,
  };
}

async function readKvJsonValue<T>(kv: Deno.Kv, logicalKey: Deno.KvKey, value: unknown): Promise<T> {
  const envelope = value && typeof value === "object" ? value as KvJsonEnvelope : null;
  if (envelope?.kind === "kv-json" && envelope.storage === "chunked") {
    return await readChunkedKvJsonValue<T>(kv, logicalKey, envelope);
  }
  if (envelope?.kind === "kv-json" && Object.hasOwn(envelope, "value")) {
    return envelope.value as T;
  }
  return value as T;
}

async function readChunkedKvJsonValue<T>(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  envelope: KvJsonEnvelope,
): Promise<T> {
  const chunkCount = Number(envelope.chunkCount ?? 0);
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    throw new Error(`Invalid chunked Deno KV value at ${JSON.stringify(logicalKey)}.`);
  }
  const chunkId = typeof envelope.chunkId === "string" ? envelope.chunkId : "";
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, async (_, index) => {
      const result = await kv.get<unknown>(chunkKey(logicalKey, chunkId, index));
      const bytes = bytesValue(result.value);
      if (!bytes) {
        throw new Error(`Missing Deno KV chunk ${index} at ${JSON.stringify(logicalKey)}.`);
      }
      return bytes;
    }),
  );
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(decoder.decode(bytes)) as T;
}

async function deleteStoredValue(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  value: unknown,
): Promise<void> {
  await cleanupStoredChunks(kv, logicalKey, value);
  await kv.delete(logicalKey);
}

async function cleanupReplacedChunks(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  previousValue: unknown,
  prepared: PreparedKvValue,
): Promise<void> {
  const previous = previousValue && typeof previousValue === "object"
    ? previousValue as KvJsonEnvelope
    : null;
  if (previous?.kind !== "kv-json" || previous.storage !== "chunked") return;
  if (typeof previous.chunkId === "string" && previous.chunkId === prepared.chunkId) return;
  await cleanupStoredChunks(kv, logicalKey, previousValue);
}

async function cleanupPreparedChunks(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  prepared: PreparedKvValue,
): Promise<void> {
  if (!prepared.chunkId || prepared.chunkCount < 1) return;
  await Promise.all(
    Array.from(
      { length: prepared.chunkCount },
      (_, index) => kv.delete(chunkKey(logicalKey, prepared.chunkId, index)),
    ),
  );
}

async function cleanupStoredChunks(
  kv: Deno.Kv,
  logicalKey: Deno.KvKey,
  value: unknown,
): Promise<void> {
  const envelope = value && typeof value === "object" ? value as KvJsonEnvelope : null;
  if (envelope?.kind !== "kv-json" || envelope.storage !== "chunked") return;
  const chunkCount = Number(envelope.chunkCount ?? 0);
  if (!Number.isInteger(chunkCount) || chunkCount < 1) return;
  const chunkId = typeof envelope.chunkId === "string" ? envelope.chunkId : "";
  await Promise.all(
    Array.from(
      { length: chunkCount },
      (_, index) => kv.delete(chunkKey(logicalKey, chunkId, index)),
    ),
  );
}

function chunkKey(logicalKey: Deno.KvKey, chunkId: string, index: number): Deno.KvKey {
  const prefix: Deno.KvKey = ["chunk", ...logicalKey];
  return chunkId ? [...prefix, chunkId, index] : [...prefix, index];
}

function bytesValue(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return Uint8Array.from(value as number[]);
  }
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([key, item]) => /^\d+$/.test(key) && Number.isInteger(item))) return null;
  return Uint8Array.from(
    entries
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, item]) => Number(item)),
  );
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function expiresAtMsValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
