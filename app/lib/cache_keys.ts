export const CACHE_NAMESPACES = [
  "geocode",
  "walk",
  "stations",
  "subwayTrip",
  "routeEdge",
  "agendaRun",
  "partifulEvent",
  "agentDebug",
] as const;

export type CacheNamespace = typeof CACHE_NAMESPACES[number];

const encoder = new TextEncoder();

export function stableFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function stableValueString(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Uint8Array) return JSON.stringify(Array.from(value));
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValueString(item ?? null)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) =>
        item !== undefined && typeof item !== "function" && typeof item !== "symbol"
      )
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${
      entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValueString(item)}`).join(",")
    }}`;
  }
  return "null";
}

export function valueFingerprint(value: unknown): string {
  return stableFingerprint(stableValueString(value));
}

export function agendaRunCacheId(input: string | unknown): string {
  if (typeof input === "string") return `run:${normalizeIdentifier(input)}`;
  return `input:${valueFingerprint(input)}`;
}

export function partifulEventCacheId(partifulIdOrUrl: string): string {
  return `event:${normalizePartifulEventId(partifulIdOrUrl)}`;
}

function normalizePartifulEventId(value: string): string {
  const trimmed = normalizeIdentifier(value);
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?partiful\.com\/e\/([^/?#]+)/i);
  const eventId = urlMatch?.[1] ?? trimmed.replace(/^\/?e\//i, "").split(/[/?#]/)[0];
  return normalizeIdentifier(decodeURIComponent(eventId));
}

function normalizeIdentifier(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error("Cache key identifier must not be empty.");
  return normalized;
}
