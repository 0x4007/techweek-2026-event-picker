import { Pool } from "pg";

export type JsonRecord = Record<string, unknown>;

export type StoreHealth = {
  backend: "postgres" | "memory";
  status: "ready" | "error";
  error: string;
};

type QueryResult<T> = {
  rows: T[];
};

type Queryable = {
  query<T = JsonRecord>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

type MemoryCacheRecord = {
  kind: "cache";
  value: unknown;
  metadata: JsonRecord;
  updatedAt: string;
  expiresAtMs: number | null;
};

let poolPromise: Promise<Pool | null> | null = null;
let schemaPromise: Promise<void> | null = null;
const memoryStore = new Map<string, unknown>();

async function getPool(): Promise<Pool | null> {
  poolPromise ??= Promise.resolve().then(() => {
    const databaseUrl = Deno.env.get("DATABASE_URL");
    if (!databaseUrl) return null;
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
    if (!db) return { backend: "memory", status: "ready", error: "" };
    await db.query("select 1");
    return { backend: "postgres", status: "ready", error: "" };
  } catch (error) {
    return {
      backend: "postgres",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readStateValue<T>(key: string): Promise<T | null> {
  const db = await getQueryable();
  if (!db) return memoryGet<T>(`state:${key}`);
  const result = await db.query<{ value: T }>("select value from app_state where key = $1", [key]);
  return result.rows[0]?.value ?? null;
}

export async function writeStateValue<T>(key: string, value: T): Promise<void> {
  const db = await getQueryable();
  if (!db) {
    memorySet(`state:${key}`, value);
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
  if (!db) return memoryGetCache<T>(namespace, cacheId);
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
    memorySetCache(namespace, cacheId, value, options);
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
    memoryStore.delete(memoryCacheKey(namespace, cacheId));
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
    pruneExpiredMemoryCache(namespace);
    return [...memoryStore.entries()]
      .filter((entry): entry is [string, MemoryCacheRecord] =>
        entry[0].startsWith(`cache:${namespace}:`) && isMemoryCacheRecord(entry[1])
      )
      .sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt))
      .slice(0, limit)
      .map(([key, record]) => ({
        cacheId: key.replace(`cache:${namespace}:`, ""),
        value: record.value as T,
        metadata: record.metadata,
        updatedAt: record.updatedAt,
      }));
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
    for (const namespace of namespaces) pruneExpiredMemoryCache(namespace);
    return Object.fromEntries(
      namespaces.map((namespace) => [
        namespace,
        [...memoryStore.entries()].filter(([key, value]) =>
          key.startsWith(`cache:${namespace}:`) && isMemoryCacheRecord(value)
        ).length,
      ]),
    );
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

function memoryCacheKey(namespace: string, cacheId: string): string {
  return `cache:${namespace}:${cacheId}`;
}

function memoryGet<T>(key: string): T | null {
  return memoryStore.get(key) as T | undefined ?? null;
}

function memorySet<T>(key: string, value: T): void {
  memoryStore.set(key, value);
}

function memorySetCache<T>(
  namespace: string,
  cacheId: string,
  value: T,
  options: { ttlMs?: number; metadata?: JsonRecord },
): void {
  const nowMs = Date.now();
  memoryStore.set(memoryCacheKey(namespace, cacheId), {
    kind: "cache",
    value,
    metadata: options.metadata ?? {},
    updatedAt: new Date(nowMs).toISOString(),
    expiresAtMs: options.ttlMs === undefined ? null : nowMs + options.ttlMs,
  } satisfies MemoryCacheRecord);
}

function memoryGetCache<T>(namespace: string, cacheId: string): T | null {
  const key = memoryCacheKey(namespace, cacheId);
  const record = memoryStore.get(key);
  if (!isMemoryCacheRecord(record)) return null;
  if (memoryCacheExpired(record)) {
    memoryStore.delete(key);
    return null;
  }
  return record.value as T;
}

function pruneExpiredMemoryCache(namespace: string): void {
  const prefix = `cache:${namespace}:`;
  for (const [key, value] of memoryStore.entries()) {
    if (key.startsWith(prefix) && isMemoryCacheRecord(value) && memoryCacheExpired(value)) {
      memoryStore.delete(key);
    }
  }
}

function isMemoryCacheRecord(value: unknown): value is MemoryCacheRecord {
  return Boolean(
    value && typeof value === "object" && (value as { kind?: unknown }).kind === "cache",
  );
}

function memoryCacheExpired(record: MemoryCacheRecord): boolean {
  return record.expiresAtMs !== null && record.expiresAtMs <= Date.now();
}
