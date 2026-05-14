export type StoredPartifulAuth = {
  version: 1;
  source: string;
  capturedAt: string;
  updatedAt: string;
  apiKey: string;
  appName: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expirationTime: number;
};

export type PartifulTarget = {
  eventUrl: string;
  partifulId: string;
  title: string;
};

export type CallableSnapshot = {
  eventUrl: string;
  partifulId: string;
  title: string;
  source: string;
  event?: unknown;
  guest?: unknown;
  rsvp?: unknown;
  raw?: {
    getEventInfo: unknown;
    getGuests?: unknown;
  };
};

const DEFAULT_AUTH_RELATIVE_PATH = ".codex/secrets/techweek-partiful-auth.json";
const TOKEN_REFRESH_LEEWAY_MS = 5 * 60 * 1000;
const PARTIFUL_ORIGIN = "https://partiful.com";
const PARTIFUL_REFERER = "https://partiful.com/";

export function defaultAuthFilePath(): string {
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error("HOME is not set; pass --auth-file explicitly.");
  }
  return `${home}/${DEFAULT_AUTH_RELATIVE_PATH}`;
}

export async function readStoredPartifulAuth(
  path = defaultAuthFilePath(),
): Promise<StoredPartifulAuth> {
  const text = await Deno.readTextFile(path);
  return parseStoredPartifulAuthJson(text, `Stored Partiful auth file ${path}`);
}

export function parseStoredPartifulAuthJson(
  value: string,
  source = "Stored Partiful auth JSON",
): StoredPartifulAuth {
  try {
    return validateStoredPartifulAuth(JSON.parse(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source} is invalid: ${message}`);
  }
}

export async function writeStoredPartifulAuth(
  auth: StoredPartifulAuth,
  path = defaultAuthFilePath(),
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  try {
    await Deno.chmod(path, 0o600);
  } catch {
    // chmod is not available on every target filesystem; the write mode above is the primary guard.
  }
}

export function extractFirebaseAuthRecord(
  input: unknown,
  source = "agent-browser:techweek",
  now = new Date(),
): StoredPartifulAuth | null {
  const candidates: unknown[] = [];
  collectCandidates(input, candidates);

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;
    const value = asRecord(record.value) ?? record;
    const tokenManager = asRecord(value.stsTokenManager);
    const apiKey = stringValue(value.apiKey) || firebaseApiKeyFromStorageKey(record.fbase_key);
    const accessToken = stringValue(tokenManager?.accessToken);
    const refreshToken = stringValue(tokenManager?.refreshToken);
    const userId = stringValue(value.uid) || stringValue(value.userId);
    const expirationTime = numberValue(tokenManager?.expirationTime);

    if (!apiKey || !accessToken || !refreshToken || !userId || !expirationTime) continue;

    return {
      version: 1,
      source,
      capturedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      apiKey,
      appName: stringValue(value.appName) || "[DEFAULT]",
      userId,
      accessToken,
      refreshToken,
      expirationTime,
    };
  }

  return null;
}

export function partifulIdFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]?.toLowerCase();
      if ((segment === "e" || segment === "events") && segments[index + 1]) {
        return segments[index + 1] ?? "";
      }
    }
  } catch {
    const match = value.match(/partiful\.com\/(?:e|events)\/([^?/#]+)/i);
    return match?.[1] ?? "";
  }
  return "";
}

export async function ensureFreshPartifulAuth(
  auth: StoredPartifulAuth,
  path: string | null = defaultAuthFilePath(),
  now = Date.now(),
): Promise<StoredPartifulAuth> {
  if (auth.expirationTime - now > TOKEN_REFRESH_LEEWAY_MS) return auth;

  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${auth.apiKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": PARTIFUL_ORIGIN,
      "referer": PARTIFUL_REFERER,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      stringValue(getPath(body, ["error", "message"])) ||
        `Firebase token refresh failed with HTTP ${response.status}.`,
    );
  }

  const accessToken = stringValue(getPath(body, ["access_token"]));
  const refreshToken = stringValue(getPath(body, ["refresh_token"])) || auth.refreshToken;
  const expiresInSeconds = numberValue(getPath(body, ["expires_in"]));
  if (!accessToken || !expiresInSeconds) {
    throw new Error("Firebase token refresh response did not include an access token and expiry.");
  }

  const refreshed: StoredPartifulAuth = {
    ...auth,
    updatedAt: new Date(now).toISOString(),
    accessToken,
    refreshToken,
    expirationTime: now + expiresInSeconds * 1000,
  };
  if (path) {
    await writeStoredPartifulAuth(refreshed, path);
  }
  return refreshed;
}

export async function callPartifulFunction(
  auth: StoredPartifulAuth,
  functionName: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`https://api.partiful.com/${functionName}`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${auth.accessToken}`,
      "content-type": "application/json",
      "origin": PARTIFUL_ORIGIN,
      "referer": PARTIFUL_REFERER,
    },
    body: JSON.stringify({
      data: {
        ...payload,
        userId: auth.userId,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(getPath(body, ["error", "message"])) ||
      `Partiful ${functionName} failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (asRecord(body)?.error) {
    throw new Error(
      stringValue(getPath(body, ["error", "message"])) ||
        `Partiful ${functionName} returned an error.`,
    );
  }
  return body;
}

export function buildCallableSnapshot(
  target: PartifulTarget,
  getEventInfo: unknown,
  getGuests: unknown,
  userId: string,
): CallableSnapshot {
  const eventInfo = callableResult(getEventInfo);
  const guests = callableResult(getGuests);
  const event = firstRecord(
    getPath(eventInfo, ["event"]),
    getPath(eventInfo, ["eventInfo", "event"]),
    getPath(eventInfo, ["props", "pageProps", "event"]),
    looksLikeEvent(eventInfo) ? eventInfo : null,
  );
  const guest = firstRecord(
    getPath(eventInfo, ["guest"]),
    getPath(eventInfo, ["viewerGuest"]),
    getPath(eventInfo, ["myGuest"]),
    getPath(eventInfo, ["currentGuest"]),
    getPath(eventInfo, ["attendance"]),
    getPath(eventInfo, ["props", "pageProps", "guest"]),
    findViewerGuest(guests, userId),
  );
  const rsvp = firstRecord(
    getPath(eventInfo, ["rsvp"]),
    getPath(eventInfo, ["viewerRsvp"]),
    getPath(eventInfo, ["myRsvp"]),
    getPath(guest, ["rsvp"]),
  );

  return {
    eventUrl: target.eventUrl ||
      (target.partifulId ? `https://partiful.com/e/${target.partifulId}` : ""),
    partifulId: target.partifulId || partifulIdFromUrl(target.eventUrl),
    title: target.title || stringValue(getPath(event, ["title"])) ||
      stringValue(getPath(event, ["name"])),
    source: "partiful_headless_callable",
    ...(event ? { event } : {}),
    ...(guest ? { guest } : {}),
    ...(rsvp ? { rsvp } : {}),
    raw: {
      getEventInfo,
      ...(getGuests === undefined ? {} : { getGuests }),
    },
  };
}

export function callableResult(value: unknown): unknown {
  const root = asRecord(value);
  if (!root) return value;
  const result = asRecord(root.result);
  if (result) return result.data ?? result;
  return root.result ?? root.data ?? value;
}

function validateStoredPartifulAuth(value: unknown): StoredPartifulAuth {
  const record = asRecord(value);
  if (!record) throw new Error("Stored Partiful auth file is not a JSON object.");
  const auth = {
    version: numberValue(record.version),
    source: stringValue(record.source),
    capturedAt: stringValue(record.capturedAt),
    updatedAt: stringValue(record.updatedAt),
    apiKey: stringValue(record.apiKey),
    appName: stringValue(record.appName),
    userId: stringValue(record.userId),
    accessToken: stringValue(record.accessToken),
    refreshToken: stringValue(record.refreshToken),
    expirationTime: numberValue(record.expirationTime),
  };
  if (
    auth.version !== 1 || !auth.apiKey || !auth.userId || !auth.accessToken ||
    !auth.refreshToken || !auth.expirationTime
  ) {
    throw new Error("Stored Partiful auth file is missing required Firebase token fields.");
  }
  return auth as StoredPartifulAuth;
}

function findViewerGuest(value: unknown, userId: string): Record<string, unknown> | null {
  const candidates: unknown[] = [];
  collectCandidates(value, candidates);
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;
    const candidateUserId = stringValue(record.userId) ||
      stringValue(record.uid) ||
      stringValue(getPath(record, ["user", "id"])) ||
      stringValue(getPath(record, ["user", "uid"])) ||
      stringValue(getPath(record, ["user", "ref", "id"])) ||
      stringValue(getPath(record, ["ref", "parent", "id"]));
    if (candidateUserId === userId) return record;
  }
  return null;
}

function looksLikeEvent(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return Boolean(
    stringValue(record.title) || stringValue(record.name) || stringValue(record.publicShortUrl) ||
      stringValue(record.startDate) || stringValue(record.eventId),
  );
}

function collectCandidates(value: unknown, candidates: unknown[]): void {
  if (value === null || value === undefined) return;
  candidates.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, candidates);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectCandidates(nested, candidates);
  }
}

function firebaseApiKeyFromStorageKey(value: unknown): string {
  const text = stringValue(value);
  const match = text.match(/^firebase:authUser:([^:]+):/);
  return match?.[1] ?? "";
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : ".";
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record || !(segment in record)) return undefined;
    current = record[segment];
  }
  return current;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
