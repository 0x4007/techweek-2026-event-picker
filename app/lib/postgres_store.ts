import { Pool } from "pg";

export type JsonRecord = Record<string, unknown>;

export type StoreHealth = {
  backend: "postgres" | "kv";
  status: "ready" | "error";
  error: string;
};

export const PUBLIC_STORE_HEALTH_ERROR = "state store unavailable";

type QueryResult<T> = {
  rows: T[];
};

type Queryable = {
  query<T = JsonRecord>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

type KvCacheRecord = {
  kind: "cache";
  value: unknown;
  metadata: JsonRecord;
  updatedAt: string;
  expiresAtMs: number | null;
};

type KvJsonRecord =
  | {
    kind: "kv-json";
    storage: "direct";
    value: unknown;
  }
  | {
    kind: "kv-json";
    storage: "chunked";
    chunkCount: number;
  };

const KV_DIRECT_JSON_BYTE_LIMIT = 48_000;
const KV_CHUNK_BYTE_LIMIT = 48_000;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

let poolPromise: Promise<Pool | null> | null = null;
let schemaPromise: Promise<void> | null = null;
let poolDatabaseUrl: string | null = null;

export function isPostgresStoreConfigured(databaseUrl = Deno.env.get("DATABASE_URL") ?? "") {
  return databaseUrl !== "";
}

async function getPool(): Promise<Pool | null> {
  const databaseUrl = Deno.env.get("DATABASE_URL") ?? "";
  if (poolPromise && poolDatabaseUrl !== databaseUrl) {
    poolPromise = null;
    schemaPromise = null;
  }
  poolPromise ??= Promise.resolve().then(() => {
    poolDatabaseUrl = databaseUrl;
    if (!isPostgresStoreConfigured(databaseUrl)) return null;
    return new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  });
  return await poolPromise;
}

async function getQueryable(): Promise<Queryable | null> {
  const pool = await getPool();
  if (!pool) return null;
  schemaPromise ??= ensureSchema(pool);
  await schemaPromise;
  return pool;
}

async function ensureSchema(db: Queryable): Promise<void> {
  await db.query(`
    create table if not exists app_state (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists app_cache (
      namespace text not null,
      cache_id text not null,
      value jsonb not null,
      metadata jsonb not null default '{}'::jsonb,
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (namespace, cache_id)
    );

    create index if not exists app_cache_namespace_idx on app_cache(namespace);
    create index if not exists app_cache_expires_at_idx on app_cache(expires_at);
  `);
}

export async function storeHealth(): Promise<StoreHealth> {
  try {
    const db = await getQueryable();
    if (!db) {
      await withKv(async (kv) => {
        await kv.get(["health"]);
      });
      return { backend: "kv", status: "ready", error: "" };
    }
    await db.query("select 1");
    return { backend: "postgres", status: "ready", error: "" };
  } catch (error) {
    console.error("State store health check failed:", error);
    return {
      backend: isPostgresStoreConfigured() ? "postgres" : "kv",
      status: "error",
      error: PUBLIC_STORE_HEALTH_ERROR,
    };
  }
}

export async function readStateValue<T>(key: string): Promise<T | null> {
  const db = await getQueryable();
  if (!db) {
    return await withKv(async (kv) => {
      return await kvGetJson<T>(kv, stateKvKey(key));
    });
  }
  const result = await db.query<{ value: T }>("select value from app_state where key = $1", [key]);
  return result.rows[0]?.value ?? null;
}

export async function writeStateValue<T>(key: string, value: T): Promise<void> {
  const db = await getQueryable();
  if (!db) {
    await withKv(async (kv) => {
      await kvSetJson(kv, stateKvKey(key), value);
    });
    return;
  }
  await db.query(
    `
      insert into app_state (key, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (key) do update
      set value = excluded.value,
          updated_at = now()
    `,
    [key, JSON.stringify(value)],
  );
}

export async function readCacheValue<T>(namespace: string, cacheId: string): Promise<T | null> {
  const db = await getQueryable();
  if (!db) return await kvGetCache<T>(namespace, cacheId);
  const result = await db.query<{ value: T }>(
    `
      select value
      from app_cache
      where namespace = $1
        and cache_id = $2
        and (expires_at is null or expires_at > now())
    `,
    [namespace, cacheId],
  );
  return result.rows[0]?.value ?? null;
}

export async function writeCacheValue<T>(
  namespace: string,
  cacheId: string,
  value: T,
  options: { ttlMs?: number; metadata?: JsonRecord } = {},
): Promise<void> {
  const db = await getQueryable();
  if (!db) {
    await kvSetCache(namespace, cacheId, value, options);
    return;
  }
  await db.query(
    `
      insert into app_cache (namespace, cache_id, value, metadata, expires_at, updated_at)
      values (
        $1,
        $2,
        $3::jsonb,
        $4::jsonb,
        case when $5::bigint is null then null else now() + ($5::bigint * interval '1 millisecond') end,
        now()
      )
      on conflict (namespace, cache_id) do update
      set value = excluded.value,
          metadata = excluded.metadata,
          expires_at = excluded.expires_at,
          updated_at = now()
    `,
    [
      namespace,
      cacheId,
      JSON.stringify(value),
      JSON.stringify(options.metadata ?? {}),
      options.ttlMs ?? null,
    ],
  );
}

export async function deleteCacheValue(namespace: string, cacheId: string): Promise<void> {
  const db = await getQueryable();
  if (!db) {
    await withKv(async (kv) => {
      await kvDeleteJson(kv, cacheKvKey(namespace, cacheId));
    });
    return;
  }
  await db.query("delete from app_cache where namespace = $1 and cache_id = $2", [
    namespace,
    cacheId,
  ]);
}

export async function listCacheValues<T>(
  namespace: string,
  limit = 1000,
): Promise<Array<{ cacheId: string; value: T; metadata: JsonRecord; updatedAt: string }>> {
  const db = await getQueryable();
  if (!db) {
    return await kvListCacheValues<T>(namespace, limit);
  }
  const result = await db.query<{
    cache_id: string;
    value: T;
    metadata: JsonRecord;
    updated_at: Date;
  }>(
    `
      select cache_id, value, metadata, updated_at
      from app_cache
      where namespace = $1
        and (expires_at is null or expires_at > now())
      order by updated_at desc
      limit $2
    `,
    [namespace, limit],
  );
  return result.rows.map((row) => ({
    cacheId: row.cache_id,
    value: row.value,
    metadata: row.metadata,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function cacheCounts(namespaces: readonly string[]): Promise<Record<string, number>> {
  const db = await getQueryable();
  if (!db) {
    const counts: Record<string, number> = {};
    for (const namespace of namespaces) {
      counts[namespace] = (await kvListCacheValues(namespace)).length;
    }
    return counts;
  }
  const result = await db.query<{ namespace: string; count: string }>(
    `
      select namespace, count(*)::text as count
      from app_cache
      where namespace = any($1::text[])
        and (expires_at is null or expires_at > now())
      group by namespace
    `,
    [namespaces],
  );
  const counts = Object.fromEntries(namespaces.map((namespace) => [namespace, 0]));
  for (const row of result.rows) counts[row.namespace] = Number(row.count);
  return counts;
}

async function withKv<T>(operation: (kv: Deno.Kv) => Promise<T>): Promise<T> {
  const kv = await Deno.openKv();
  try {
    return await operation(kv);
  } finally {
    kv.close();
  }
}

function stateKvKey(key: string): Deno.KvKey {
  return ["state", key];
}

function cacheKvKey(namespace: string, cacheId: string): Deno.KvKey {
  return ["cache", namespace, cacheId];
}

function kvChunkKey(key: Deno.KvKey, index: number): Deno.KvKey {
  return ["chunk", ...key, index];
}

async function kvSetJson<T>(
  kv: Deno.Kv,
  key: Deno.KvKey,
  value: T,
  options: { expireIn?: number } = {},
): Promise<void> {
  const previous = await kv.get<KvJsonRecord>(key);
  const previousChunkCount = isKvJsonChunkedRecord(previous.value) ? previous.value.chunkCount : 0;
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Cannot persist undefined JSON value.");
  const encoded = TEXT_ENCODER.encode(json);
  const setOptions = options.expireIn === undefined || options.expireIn <= 0
    ? undefined
    : { expireIn: options.expireIn };
  if (encoded.byteLength <= KV_DIRECT_JSON_BYTE_LIMIT) {
    await kv.set(
      key,
      { kind: "kv-json", storage: "direct", value } satisfies KvJsonRecord,
      setOptions,
    );
    await kvDeleteChunks(kv, key, previousChunkCount);
    return;
  }

  const chunkCount = Math.ceil(encoded.byteLength / KV_CHUNK_BYTE_LIMIT);
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * KV_CHUNK_BYTE_LIMIT;
    await kv.set(
      kvChunkKey(key, index),
      encoded.slice(start, start + KV_CHUNK_BYTE_LIMIT),
      setOptions,
    );
  }
  await kv.set(
    key,
    { kind: "kv-json", storage: "chunked", chunkCount } satisfies KvJsonRecord,
    setOptions,
  );
  await kvDeleteChunks(kv, key, Math.max(0, previousChunkCount - chunkCount), chunkCount);
}

async function kvGetJson<T>(kv: Deno.Kv, key: Deno.KvKey): Promise<T | null> {
  const result = await kv.get<KvJsonRecord | T>(key);
  return await kvDecodeJson<T>(kv, key, result.value);
}

async function kvDecodeJson<T>(
  kv: Deno.Kv,
  key: Deno.KvKey,
  value: unknown,
): Promise<T | null> {
  if (value === null) return null;
  if (!isKvJsonRecord(value)) return value as T;
  if (value.storage === "direct") return value.value as T;
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < value.chunkCount; index += 1) {
    const result = await kv.get<Uint8Array>(kvChunkKey(key, index));
    if (!(result.value instanceof Uint8Array)) return null;
    chunks.push(result.value);
  }
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(TEXT_DECODER.decode(merged)) as T;
}

async function kvDeleteJson(kv: Deno.Kv, key: Deno.KvKey): Promise<void> {
  const previous = await kv.get<KvJsonRecord>(key);
  await kv.delete(key);
  if (isKvJsonChunkedRecord(previous.value)) {
    await kvDeleteChunks(kv, key, previous.value.chunkCount);
  }
}

async function kvDeleteChunks(
  kv: Deno.Kv,
  key: Deno.KvKey,
  count: number,
  startIndex = 0,
): Promise<void> {
  for (let index = startIndex; index < startIndex + count; index += 1) {
    await kv.delete(kvChunkKey(key, index));
  }
}

async function kvSetCache<T>(
  namespace: string,
  cacheId: string,
  value: T,
  options: { ttlMs?: number; metadata?: JsonRecord },
): Promise<void> {
  const nowMs = Date.now();
  const record: KvCacheRecord = {
    kind: "cache",
    value,
    metadata: options.metadata ?? {},
    updatedAt: new Date(nowMs).toISOString(),
    expiresAtMs: options.ttlMs === undefined ? null : nowMs + options.ttlMs,
  };
  await withKv(async (kv) => {
    await kvSetJson(
      kv,
      cacheKvKey(namespace, cacheId),
      record,
      options.ttlMs === undefined || options.ttlMs <= 0 ? undefined : { expireIn: options.ttlMs },
    );
  });
}

async function kvGetCache<T>(namespace: string, cacheId: string): Promise<T | null> {
  return await withKv(async (kv) => {
    const key = cacheKvKey(namespace, cacheId);
    const record = await kvGetJson<KvCacheRecord>(kv, key);
    if (!isKvCacheRecord(record)) return null;
    if (kvCacheExpired(record)) {
      await kvDeleteJson(kv, key);
      return null;
    }
    return record.value as T;
  });
}

async function kvListCacheValues<T>(
  namespace: string,
  limit = 1000,
): Promise<Array<{ cacheId: string; value: T; metadata: JsonRecord; updatedAt: string }>> {
  return await withKv(async (kv) => {
    const items: Array<{ cacheId: string; value: T; metadata: JsonRecord; updatedAt: string }> = [];
    for await (
      const entry of kv.list<KvJsonRecord | KvCacheRecord>({ prefix: ["cache", namespace] }, {
        limit,
      })
    ) {
      const record = await kvDecodeJson<KvCacheRecord>(kv, entry.key, entry.value);
      if (!isKvCacheRecord(record)) continue;
      const cacheId = String(entry.key[2] ?? "");
      if (kvCacheExpired(record)) {
        await kvDeleteJson(kv, entry.key);
        continue;
      }
      items.push({
        cacheId,
        value: record.value as T,
        metadata: record.metadata,
        updatedAt: record.updatedAt,
      });
    }
    return items
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  });
}

function isKvCacheRecord(value: unknown): value is KvCacheRecord {
  return Boolean(
    value && typeof value === "object" && (value as { kind?: unknown }).kind === "cache",
  );
}

function isKvJsonRecord(value: unknown): value is KvJsonRecord {
  return Boolean(
    value && typeof value === "object" && (value as { kind?: unknown }).kind === "kv-json",
  );
}

function isKvJsonChunkedRecord(
  value: unknown,
): value is Extract<KvJsonRecord, { storage: "chunked" }> {
  return isKvJsonRecord(value) && value.storage === "chunked";
}

function kvCacheExpired(record: KvCacheRecord): boolean {
  return record.expiresAtMs !== null && record.expiresAtMs <= Date.now();
}
