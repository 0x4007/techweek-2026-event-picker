import { getEncoding } from "js-tiktoken";
import {
  type AgendaRecalculateResult,
  type AgendaRouteEstimate,
  type AgendaRouteEstimateRequest,
  type AgendaStatusUpdate,
  recalculateAgenda,
} from "./lib/agenda_recalculate.ts";
import {
  agendaRunCacheId,
  CACHE_NAMESPACES,
  type CacheNamespace,
  partifulEventCacheId,
  valueFingerprint,
} from "./lib/cache_keys.ts";
import {
  computePartifulSync,
  type NormalizedPartifulEvent,
  type PartifulMergedEvent,
} from "./lib/partiful_sync.ts";
import {
  type CacheKey,
  DEFAULT_USER_AGENT,
  geocode,
  googleMapsDirectionsUrl,
  HOME_POINT,
  pointMapsQuery,
  routeBetween,
  type RoutePoint,
  ROUTING_VERSION,
  type RoutingCacheAdapter,
  type RoutingCacheSetOptions,
} from "./lib/routing.ts";
import {
  cacheCounts,
  listCacheValues,
  readCacheValue,
  readStateValue,
  storeHealth,
  writeCacheValue,
  writeStateValue,
} from "./lib/postgres_store.ts";

const ROOT = new URL("../", import.meta.url);
const STATIC_DIR = new URL("./static/", import.meta.url);
const SCHEDULE_CSV = new URL(
  "../outputs/signed_up/techweek_signed_up_transport_schedule.csv",
  import.meta.url,
);
const RANKINGS_CSV = new URL(
  "../data/rankings/techweek_nyc_accolades_full_rerank.csv",
  import.meta.url,
);
const RSVP_PROFILE_JSON = new URL("../.codex/techweek-rsvp-profile.json", import.meta.url);
const TEXT_REWARDS_REPO = new URL(
  "file:///Users/nv/repos/ubiquity-os-marketplace/text-conversation-rewards/",
);
const OPERATIONAL_ICS = new URL(
  "../outputs/signed_up/techweek_signed_up_operational_with_travel.ics",
  import.meta.url,
);
const LOCAL_OCR_DIR = new URL("../.codex/ocr-local/", import.meta.url);
const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";
const PORT = 8787;
const TIME_ZONE = "America/New_York";
const AGENT_MODEL = "gpt-5.5";
const LOCAL_OCR_TIMEOUT_MS = 7_000;
const LOCAL_OCR_ROTATIONS = [0, 90, 180, 270] as const;
const LOCAL_OCR_HIGH_CONFIDENCE_SCORE = 8;
const TOKEN_ENCODING_NAME = "o200k_base";
const CHAT_MESSAGE_OVERHEAD_TOKENS = 4;
const CHAT_REQUEST_OVERHEAD_TOKENS = 3;
const MODEL_CONTEXT_CACHE_MS = 5 * 60 * 1000;
const TOKEN_ENCODER = getEncoding(TOKEN_ENCODING_NAME);
const PRODUCT_PLAYBOOK_CONTEXT_CHAR_BUDGET = 120_000;
const ROUTE_RUNBOOK_CONTEXT_CHAR_BUDGET = 90_000;
const EVENT_DOSSIER_CONTEXT_CHAR_BUDGET = 150_000;
const RANKED_OPPORTUNITY_MAP_CHAR_BUDGET = 190_000;
const RANKED_OPPORTUNITY_MAP_LIMIT = 260;
const ROUTING_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 45;
const PARTIFUL_SYNC_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 120;
const AGENDA_RUN_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PRODUCT_PLAYBOOK_FILES = [
  { label: "Repository README", url: new URL("README.md", TEXT_REWARDS_REPO), maxChars: 32_000 },
  {
    label: "Platform and Accolades context",
    url: new URL("docs/ubiquity-os-platform-and-accolades-context.md", TEXT_REWARDS_REPO),
    maxChars: 32_000,
  },
  {
    label: "Accolades whitepaper",
    url: new URL("docs/ubiquity-os-accolades-whitepaper.md", TEXT_REWARDS_REPO),
    maxChars: 38_000,
  },
  {
    label: "One-page sales brief",
    url: new URL("sales-collateral/one-page-sales-brief.md", TEXT_REWARDS_REPO),
    maxChars: 12_000,
  },
  {
    label: "Buyer discovery",
    url: new URL("sales-collateral/buyer-discovery.md", TEXT_REWARDS_REPO),
    maxChars: 10_000,
  },
  {
    label: "Messaging guide",
    url: new URL("sales-collateral/messaging.md", TEXT_REWARDS_REPO),
    maxChars: 14_000,
  },
  {
    label: "Event conversation guide",
    url: new URL("sales-collateral/event-conversation-guide.md", TEXT_REWARDS_REPO),
    maxChars: 10_000,
  },
  {
    label: "Objection battlecard",
    url: new URL("sales-collateral/objection-battlecard.md", TEXT_REWARDS_REPO),
    maxChars: 28_000,
  },
  {
    label: "Buyer persona matrix",
    url: new URL("sales-collateral/buyer-persona-matrix.md", TEXT_REWARDS_REPO),
    maxChars: 28_000,
  },
  {
    label: "Visual demo brief",
    url: new URL("sales-collateral/visual-demo-brief.md", TEXT_REWARDS_REPO),
    maxChars: 10_000,
  },
  {
    label: "Demo dashboard README",
    url: new URL("sales-collateral/demo-dashboard/README.md", TEXT_REWARDS_REPO),
    maxChars: 14_000,
  },
] as const;
const ROUTE_RUNBOOK_FILES = [
  {
    label: "Tech Week agenda",
    url: new URL("../docs/agenda/TECHWEEK_AGENDA.md", import.meta.url),
    maxChars: 28_000,
  },
  {
    label: "Primary signup handoff",
    url: new URL("../docs/handoffs/SIGNUP_AGENT_HANDOFF.md", import.meta.url),
    maxChars: 22_000,
  },
  {
    label: "Signup state handoff",
    url: new URL("../docs/handoffs/SIGNUP_STATE_HANDOFF.md", import.meta.url),
    maxChars: 22_000,
  },
  {
    label: "Backup signup handoff",
    url: new URL("../docs/handoffs/BACKUP_SIGNUP_AGENT_HANDOFF.md", import.meta.url),
    maxChars: 16_000,
  },
  {
    label: "Top picks and ranking rationale",
    url: new URL(
      "../data/rankings/techweek_nyc_accolades_full_rerank_top_picks.md",
      import.meta.url,
    ),
    maxChars: 36_000,
  },
] as const;
const CODEX_CLIENT_CONTEXT_FALLBACKS: Record<
  string,
  {
    contextWindowTokens: number;
    maxContextWindowTokens: number;
    autoCompactTokenLimitTokens: number;
    effectiveContextWindowPercent: number;
    maxOutputTokens: number;
    sourceLabel: string;
  }
> = {
  "gpt-5.5": {
    contextWindowTokens: 272_000,
    maxContextWindowTokens: 272_000,
    autoCompactTokenLimitTokens: 258_400,
    effectiveContextWindowPercent: 95,
    maxOutputTokens: 128_000,
    sourceLabel: "Codex CLI model cache for gpt-5.5",
  },
};
let modelContextCache:
  | { model: string; baseUrl: string; fetchedAtMs: number; info: ModelContextInfo }
  | null = null;

type CsvRow = Record<string, string>;

type ScheduleEntry = {
  calendar: string;
  techweekId: string;
  calendarBlockId: string;
  partifulId: string;
  rerankId: string;
  entryType: string;
  blockType: "event" | "travel" | "eating" | "sleeping" | "other";
  status: string;
  category: string;
  start: string;
  end: string;
  actualStart: string;
  actualEnd: string;
  startEpochMs: number;
  endEpochMs: number;
  actualStartEpochMs: number;
  actualEndEpochMs: number;
  dayKey: string;
  weekday: string;
  timeRange: string;
  title: string;
  displayTitle: string;
  statusLabel: string;
  location: string;
  venueQuery: string;
  venuePrecision: string;
  routeMode: string;
  travelMinutes: string;
  routeDetails: string;
  transitRisk: string;
  note: string;
  salesCoaching: string;
  rank: string;
  tier: string;
  opportunityScore: string;
  eventUrl: string;
  googleMapsUrl: string;
};

type DayGroup = {
  date: string;
  weekday: string;
  entries: ScheduleEntry[];
};

type EventNote = {
  note: string;
  updatedAt: string;
};

type LeadFollowUpEmail = {
  status: "sent" | "failed" | "skipped";
  to: string;
  subject: string;
  attemptedAt: string;
  sentAt: string;
  providerMessageId: string;
  error: string;
};

type Lead = {
  id: string;
  calendarBlockId: string;
  techweekId: string;
  eventTitle: string;
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  priority: "A" | "B" | "C";
  followUp: string;
  followUpEmail: LeadFollowUpEmail | null;
  createdAt: string;
  updatedAt: string;
};

type AppState = {
  version: 1;
  updatedAt: string;
  eventNotes: Record<string, EventNote>;
  leads: Lead[];
  dismissedBlocks: string[];
};

type StoredPartifulEvent = {
  syncedAt: string;
  normalizedEvent: NormalizedPartifulEvent;
  mergedEvent: PartifulMergedEvent<Record<string, unknown>>;
  statusChanged: boolean;
  matchedBy: string;
};

type AgendaRunMetadata = {
  agendaRunId: string;
  generatedAt: string;
  storedAt: string;
  summary: AgendaRecalculateResult["summary"];
};

type ProposedAction = {
  type: "event_note" | "google_sync_request";
  techweekId?: string;
  calendarBlockId?: string;
  reason?: string;
  note?: string;
  calendarBlockIds?: string[];
};

type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatMessage = {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
};

type GatewayConfig = {
  token: string;
  chatUrl: string;
  responsesUrl: string;
  modelsUrl: string;
  capabilitiesUrl: string;
};

type ModelContextInfo = {
  model: string;
  contextWindowTokens: number | null;
  maxContextWindowTokens: number | null;
  autoCompactTokenLimitTokens: number | null;
  effectiveContextWindowTokens: number | null;
  effectiveContextWindowPercent: number | null;
  maxOutputTokens: number | null;
  longPromptPricingThresholdTokens: number | null;
  source:
    | "gateway_capabilities_endpoint"
    | "codex_client_cache_fallback"
    | "gateway_models_endpoint"
    | "unknown";
  sourceUrl?: string;
  cacheHit: boolean;
  gatewayHost: string;
  api: {
    modelEndpointStatus: number | null;
    modelsEndpointStatus: number | null;
    capabilitiesEndpointStatus: number | null;
    listedByModelsEndpoint: boolean | null;
    listedByCapabilitiesEndpoint: boolean | null;
    metadataFieldsSeen: string[];
    capabilitiesFieldsSeen: string[];
    error: string;
  };
  notes: string[];
};

type AgentTokenUtilization = {
  tokenizer: {
    package: string;
    encoding: string;
    exactModelEncoding: boolean;
    note: string;
  };
  messageCount: number;
  contentTokens: number;
  estimatedEnvelopeTokens: number;
  estimatedInputTokens: number;
  requestJsonTokens: number;
  contextWindowTokens: number | null;
  maxContextWindowTokens: number | null;
  autoCompactTokenLimitTokens: number | null;
  effectiveContextWindowTokens: number | null;
  effectiveContextWindowPercent: number | null;
  maxOutputTokens: number | null;
  longPromptPricingThresholdTokens: number | null;
  percentOfContextWindow: number | null;
  percentOfEffectiveContextWindow: number | null;
  remainingContextTokens: number | null;
  remainingEffectiveContextTokens: number | null;
  remainingAfterMaxOutputTokens: number | null;
  exceedsContextWindow: boolean | null;
  exceedsEffectiveContextWindow: boolean | null;
  exceedsLongPromptPricingThreshold: boolean | null;
  byRole: Record<string, { messages: number; contentTokens: number; characters: number }>;
  messages: Array<{
    index: number;
    role: ChatMessage["role"];
    contentTokens: number;
    characters: number;
    preview: string;
  }>;
};

type AgentDebugPayload = {
  id: string;
  createdAt: string;
  endpoint: string;
  prompt: string;
  requestBody: ReturnType<typeof chatRequestBody>;
  modelContext: ModelContextInfo;
  utilization: AgentTokenUtilization;
};

type OcrRequestBody = {
  model: string;
  reasoning_effort: null;
  stream: false;
  messages: Array<{
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
  }>;
};

type LeadDraft = {
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  priority: Lead["priority"];
  followUp: string;
};

type LocalOcrOrientation = {
  imageDataUrl: string;
  raw: string;
  score: number;
  rotation: number;
};

type LocalOcrVariantText = {
  transcript: string;
  score: number;
  wordCount: number;
  meanConfidence: number;
};

type CommandResult = {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: Record<string, unknown>;
};

type ResendEmailConfig = {
  apiKey: string;
  from: string;
};

type EmailPayload = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
};

type ClientContext = {
  localIso?: unknown;
  localText?: unknown;
  timeZone?: unknown;
  isSecureContext?: unknown;
  coordinates?: {
    latitude?: unknown;
    longitude?: unknown;
    accuracyMeters?: unknown;
    capturedAt?: unknown;
  };
  locationStatus?: unknown;
  viewport?: {
    width?: unknown;
    height?: unknown;
    devicePixelRatio?: unknown;
  };
};

class ServerRoutingCache implements RoutingCacheAdapter {
  async get<T>(key: CacheKey): Promise<T | null> {
    return await readCacheValue<T>(routingCacheNamespace(key), routingCacheId(key));
  }

  async set<T>(
    key: CacheKey,
    value: T,
    options: RoutingCacheSetOptions = {},
  ): Promise<void> {
    const compactValue = compactRoutingCacheValue(value) as T;
    await writeCacheValue(routingCacheNamespace(key), routingCacheId(key), compactValue, {
      ttlMs: options.expireIn ?? ROUTING_CACHE_TTL_MS,
      metadata: { routingKey: [...key], tags: options.tags ?? [] },
    });
  }
}

function routingCacheNamespace(key: CacheKey): CacheNamespace {
  const group = String(key[1] ?? "");
  if (group === "geocode") return "geocode";
  if (group === "walk") return "walk";
  if (group === "subway-stations") return "stations";
  if (group === "subway-trip") return "subwayTrip";
  return "routeEdge";
}

function routingCacheId(key: CacheKey): string {
  return `routing:${valueFingerprint([...key])}`;
}

function compactRoutingCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactRoutingCacheValue);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "raw") continue;
    output[key] = compactRoutingCacheValue(item);
  }
  return output;
}

const routingPgCache = new ServerRoutingCache();

export function parseCsv(input: string): CsvRow[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...body] = rows.filter((item) => item.some((cell) => cell.trim()));
  if (!headers) return [];

  return body.map((cells) => {
    const item: CsvRow = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] ?? "";
    });
    return item;
  });
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function textResponse(body: string, contentType: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", contentType);
  return new Response(body, { ...init, headers });
}

function notFound(): Response {
  return json({ error: { message: "Not found" } }, { status: 404 });
}

function badRequest(message: string): Response {
  return json({ error: { message, type: "invalid_request_error" } }, { status: 400 });
}

function serverError(message: string, detail?: unknown): Response {
  return json({ error: { message, detail } }, { status: 500 });
}

function createRequestId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function logJson(type: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify(
      {
        type,
        loggedAt: new Date().toISOString(),
        ...data,
      },
      null,
      2,
    ),
  );
}

function safeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 6).join("\n"),
    };
  }
  return { message: String(error) };
}

function truncateDebug(value: unknown, maxLength = 4000): unknown {
  if (typeof value === "string") {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...<truncated>` : value;
  }
  if (!value || typeof value !== "object") return value;
  const text = JSON.stringify(value);
  if (text.length <= maxLength) return value;
  return `${text.slice(0, maxLength)}...<truncated>`;
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return "index.html";
  const clean = pathname.replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return "index.html";
  return clean;
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function fileUrlPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

async function serveStatic(pathname: string): Promise<Response> {
  const path = normalizePath(pathname);
  const fileUrl = new URL(path, STATIC_DIR);
  if (!fileUrl.href.startsWith(STATIC_DIR.href)) return notFound();

  try {
    const file = await Deno.readFile(fileUrl);
    return new Response(file, {
      headers: {
        "content-type": contentType(path),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound && !pathname.includes(".")) {
      return serveStatic("/");
    }
    return notFound();
  }
}

function parseLocalDateTime(value: string): number {
  if (!value) return 0;
  const normalized = value.trim().replace(" ", "T");
  return Date.parse(`${normalized}:00-04:00`);
}

function formatWeekday(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00-04:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TIME_ZONE }).format(date);
}

function formatTimeRange(start: string, end: string): string {
  const startTime = start.slice(11, 16);
  const endTime = end.slice(11, 16);
  return `${startTime}-${endTime}`;
}

function stripStatusPrefix(title: string): { displayTitle: string; statusLabel: string } {
  const match = title.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) return { displayTitle: title, statusLabel: "" };
  return { displayTitle: match[2], statusLabel: match[1] };
}

function normalizeBlockType(entryType: string): ScheduleEntry["blockType"] {
  if (entryType === "event") return "event";
  if (entryType === "travel") return "travel";
  if (entryType === "meal") return "eating";
  if (entryType === "sleep") return "sleeping";
  return "other";
}

function toEntry(row: CsvRow): ScheduleEntry {
  const { displayTitle, statusLabel } = stripStatusPrefix(row.title ?? "");
  const dayKey = (row.start ?? "").slice(0, 10);
  const entryType = row.entry_type ?? "";
  return {
    calendar: row.calendar ?? "",
    techweekId: row.techweek_id ?? "",
    calendarBlockId: row.calendar_block_id ?? "",
    partifulId: row.partiful_id ?? "",
    rerankId: row.rerank_id ?? "",
    entryType,
    blockType: normalizeBlockType(entryType),
    status: row.status ?? "",
    category: row.category ?? "",
    start: row.start ?? "",
    end: row.end ?? "",
    actualStart: row.actual_start ?? "",
    actualEnd: row.actual_end ?? "",
    startEpochMs: parseLocalDateTime(row.start ?? ""),
    endEpochMs: parseLocalDateTime(row.end ?? ""),
    actualStartEpochMs: parseLocalDateTime(row.actual_start || row.start || ""),
    actualEndEpochMs: parseLocalDateTime(row.actual_end || row.end || ""),
    dayKey,
    weekday: formatWeekday(dayKey),
    timeRange: formatTimeRange(row.start ?? "", row.end ?? ""),
    title: row.title ?? "",
    displayTitle,
    statusLabel,
    location: row.location ?? "",
    venueQuery: row.venue_query ?? "",
    venuePrecision: row.venue_precision ?? "",
    routeMode: row.route_mode ?? "",
    travelMinutes: row.travel_minutes ?? "",
    routeDetails: row.route_details ?? "",
    transitRisk: row.transit_risk ?? "",
    note: row.note ?? "",
    salesCoaching: row.sales_coaching ?? "",
    rank: row.rank ?? "",
    tier: row.tier ?? "",
    opportunityScore: row.opportunity_score ?? "",
    eventUrl: row.event_url ?? "",
    googleMapsUrl: row.google_maps_url ?? "",
  };
}

function groupByDay(entries: ScheduleEntry[]): DayGroup[] {
  const days = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const current = days.get(entry.dayKey) ?? [];
    current.push(entry);
    days.set(entry.dayKey, current);
  }
  return [...days.entries()].map(([date, dayEntries]) => ({
    date,
    weekday: formatWeekday(date),
    entries: dayEntries.sort((a, b) => a.startEpochMs - b.startEpochMs),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

async function readScheduleEntries(): Promise<ScheduleEntry[]> {
  const csv = await Deno.readTextFile(SCHEDULE_CSV);
  return parseCsv(csv).map(toEntry).sort((a, b) => a.startEpochMs - b.startEpochMs);
}

function emptyState(): AppState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    eventNotes: {},
    leads: [],
    dismissedBlocks: [],
  };
}

function normalizeLeadPriority(value: unknown): Lead["priority"] {
  return value === "A" || value === "C" ? value : "B";
}

function normalizeLeadFollowUpEmail(value: unknown): LeadFollowUpEmail | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LeadFollowUpEmail>;
  const status = raw.status === "sent" || raw.status === "failed" || raw.status === "skipped"
    ? raw.status
    : "skipped";
  return {
    status,
    to: textField(raw.to, 320),
    subject: textField(raw.subject, 220),
    attemptedAt: textField(raw.attemptedAt, 80),
    sentAt: textField(raw.sentAt, 80),
    providerMessageId: textField(raw.providerMessageId, 220),
    error: textField(raw.error, 1200),
  };
}

function normalizeLeads(value: unknown): Lead[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const lead = item as Partial<Lead>;
      return {
        id: String(lead.id || crypto.randomUUID()),
        calendarBlockId: String(lead.calendarBlockId || ""),
        techweekId: String(lead.techweekId || ""),
        eventTitle: String(lead.eventTitle || "Unknown event"),
        name: String(lead.name || ""),
        company: String(lead.company || ""),
        role: String(lead.role || ""),
        email: String(lead.email || ""),
        phone: String(lead.phone || ""),
        notes: String(lead.notes || ""),
        priority: normalizeLeadPriority(lead.priority),
        followUp: String(lead.followUp || ""),
        followUpEmail: normalizeLeadFollowUpEmail(lead.followUpEmail),
        createdAt: String(lead.createdAt || new Date().toISOString()),
        updatedAt: String(lead.updatedAt || lead.createdAt || new Date().toISOString()),
      };
    })
    .filter((lead) =>
      lead.calendarBlockId && (lead.name || lead.company || lead.email || lead.phone)
    )
    .slice(0, 250);
}

function textField(value: unknown, maxLength = 1200): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function extractEmailAddress(value: string): string {
  const match = String(value || "").match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  );
  return match?.[0] ?? "";
}

function senderNameFromFromHeader(value: string): string {
  const trimmed = value.trim();
  const displayName = trimmed.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (displayName) return displayName;
  const email = extractEmailAddress(trimmed);
  if (!email) return "UbiquityOS";
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (char) => char.toUpperCase()) : "UbiquityOS";
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildLeadFollowUpEmailContent(input: {
  leadName?: string;
  eventTitle?: string;
  followUp?: string;
  from?: string;
}): { subject: string; text: string; html: string } {
  const eventTitle = textField(input.eventTitle, 140);
  const followUp = textField(input.followUp, 240);
  const name = firstName(textField(input.leadName, 160));
  const signature = senderNameFromFromHeader(textField(input.from, 320));
  const subject = truncateSingleLine(
    eventTitle ? `Great connecting at ${eventTitle}` : "Great connecting at NYC Tech Week",
    120,
  );
  const greeting = name ? `Hi ${name},` : "Hi,";
  const eventLine = eventTitle
    ? `Great connecting at ${eventTitle}.`
    : "Great connecting during NYC Tech Week.";
  const nextStep = followUp
    ? `The next step I had in mind: ${followUp}.`
    : "Open to comparing notes next week or looking at a short example?";
  const text = [
    greeting,
    "",
    eventLine,
    "I wanted to send the short version of what I mentioned: UbiquityOS Accolades turns GitHub work artifacts into source-linked contribution credit, covering specs, reviews, comments, and coordination rather than only commits.",
    nextStep,
    "",
    "Best,",
    signature,
  ].join("\n");
  const paragraphs = [
    greeting,
    eventLine,
    "I wanted to send the short version of what I mentioned: UbiquityOS Accolades turns GitHub work artifacts into source-linked contribution credit, covering specs, reviews, comments, and coordination rather than only commits.",
    nextStep,
    `Best,<br>${signature}`,
  ].map((line) => `<p>${escapeHtml(line).replaceAll("&lt;br&gt;", "<br>")}</p>`);
  return { subject, text, html: paragraphs.join("\n") };
}

function resendEmailConfig(): { config: ResendEmailConfig | null; missing: string[] } {
  const apiKey = textField(Deno.env.get("RESEND_API_KEY"), 500);
  const from = textField(Deno.env.get("RESEND_EMAIL_FROM"), 320);
  const missing = [
    ["RESEND_API_KEY", apiKey],
    ["RESEND_EMAIL_FROM", from],
  ].filter(([, value]) => !value).map(([key]) => key);
  return {
    config: missing.length ? null : { apiKey, from },
    missing,
  };
}

function emailPublicStatus(): { followUpConfigured: boolean; missing: string[]; provider: string } {
  const { config, missing } = resendEmailConfig();
  return {
    followUpConfigured: Boolean(config),
    missing,
    provider: "resend",
  };
}

function leadFollowUpEmailPayload(
  lead: Lead,
  entry: ScheduleEntry,
  config: ResendEmailConfig,
  to: string,
): EmailPayload {
  const content = buildLeadFollowUpEmailContent({
    leadName: lead.name,
    eventTitle: entry.displayTitle,
    followUp: lead.followUp,
    from: config.from,
  });
  return {
    to,
    from: config.from,
    subject: content.subject,
    text: content.text,
    html: content.html,
  };
}

function resendSendResult(body: unknown): {
  accepted: boolean;
  messageId: string;
  error: string;
} {
  if (!body || typeof body !== "object") return { accepted: true, messageId: "", error: "" };
  const raw = body as {
    id?: unknown;
    message?: unknown;
    name?: unknown;
    statusCode?: unknown;
    error?: { message?: unknown; name?: unknown } | unknown;
  };
  const messageId = String(raw.id ?? "");
  const error = raw.error && typeof raw.error === "object"
    ? String((raw.error as { message?: unknown }).message ?? JSON.stringify(raw.error))
    : String(raw.message ?? "");
  return {
    accepted: Boolean(messageId) && !error,
    messageId,
    error,
  };
}

async function sendLeadFollowUpEmail(
  lead: Lead,
  entry: ScheduleEntry,
  attemptedAt: string,
): Promise<LeadFollowUpEmail> {
  const to = textField(lead.email, 320);
  const { config, missing } = resendEmailConfig();
  const fallbackContent = buildLeadFollowUpEmailContent({
    leadName: lead.name,
    eventTitle: entry.displayTitle,
    followUp: lead.followUp,
    from: config?.from ?? "",
  });
  if (!to) {
    return {
      status: "skipped",
      to: "",
      subject: fallbackContent.subject,
      attemptedAt,
      sentAt: "",
      providerMessageId: "",
      error: "No email address found for this lead.",
    };
  }
  if (!config) {
    return {
      status: "failed",
      to,
      subject: fallbackContent.subject,
      attemptedAt,
      sentAt: "",
      providerMessageId: "",
      error: `Resend email configuration is missing: ${missing.join(", ")}`,
    };
  }

  const payload = leadFollowUpEmailPayload(lead, entry, config, to);
  return await sendResendEmailPayload(payload, config, attemptedAt);
}

async function sendResendEmailPayload(
  payload: EmailPayload,
  config: ResendEmailConfig,
  attemptedAt: string,
): Promise<LeadFollowUpEmail> {
  try {
    const response = await fetch(RESEND_EMAIL_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await readJsonOrText(response);
    const result = resendSendResult(body);
    if (!response.ok || !result.accepted) {
      return {
        status: "failed",
        to: payload.to,
        subject: payload.subject,
        attemptedAt,
        sentAt: "",
        providerMessageId: result.messageId,
        error: result.error || `Resend returned HTTP ${response.status}.`,
      };
    }
    return {
      status: "sent",
      to: payload.to,
      subject: payload.subject,
      attemptedAt,
      sentAt: new Date().toISOString(),
      providerMessageId: result.messageId,
      error: "",
    };
  } catch (error) {
    return {
      status: "failed",
      to: payload.to,
      subject: payload.subject,
      attemptedAt,
      sentAt: "",
      providerMessageId: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendResendTestEmail(to: string): Promise<LeadFollowUpEmail> {
  const attemptedAt = new Date().toISOString();
  const recipient = extractEmailAddress(to);
  const { config, missing } = resendEmailConfig();
  const content = buildLeadFollowUpEmailContent({
    leadName: "Test",
    eventTitle: "Tech Week CRM Resend email test",
    followUp: "Confirm this test email arrived.",
    from: config?.from ?? "",
  });
  if (!recipient) {
    return {
      status: "skipped",
      to: "",
      subject: content.subject,
      attemptedAt,
      sentAt: "",
      providerMessageId: "",
      error: "No email address found in the test recipient.",
    };
  }
  if (!config) {
    return {
      status: "failed",
      to: recipient,
      subject: content.subject,
      attemptedAt,
      sentAt: "",
      providerMessageId: "",
      error: `Resend email configuration is missing: ${missing.join(", ")}`,
    };
  }
  return await sendResendEmailPayload(
    {
      to: recipient,
      from: config.from,
      subject: content.subject,
      text: content.text,
      html: content.html,
    },
    config,
    attemptedAt,
  );
}

async function readState(): Promise<AppState> {
  const parsed = await readStateValue<Partial<AppState>>("app_state_v1");
  if (!parsed) return emptyState();
  return {
    version: 1,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    eventNotes: parsed.eventNotes ?? {},
    leads: normalizeLeads(parsed.leads),
    dismissedBlocks: parsed.dismissedBlocks ?? [],
  };
}

async function writeState(state: AppState): Promise<AppState> {
  state.updatedAt = new Date().toISOString();
  await writeStateValue("app_state_v1", state);
  return state;
}

function currentSchedulePointer(entries: ScheduleEntry[]): ScheduleEntry | null {
  const now = Date.now();
  const operational = entries.filter((entry) =>
    entry.calendar === "schedule" &&
    ["event", "travel", "eating"].includes(entry.blockType)
  );
  return operational.find((entry) => entry.endEpochMs > now) ??
    operational.find((entry) => entry.entryType === "event") ??
    entries.find((entry) => entry.calendar === "schedule") ??
    null;
}

function buildSchedulePayload(entries: ScheduleEntry[], state: AppState) {
  const schedule = entries.filter((entry) => entry.calendar === "schedule");
  const reference = entries.filter((entry) => entry.calendar === "reference");
  const scheduleEvents = schedule.filter((entry) => entry.blockType === "event");
  const referenceEvents = reference.filter((entry) => entry.blockType === "event");

  return {
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    source: relativePath(SCHEDULE_CSV),
    next: currentSchedulePointer(schedule),
    counts: {
      scheduleBlocks: schedule.length,
      scheduleEvents: scheduleEvents.length,
      referenceEvents: referenceEvents.length,
      eventBlocks: schedule.filter((entry) => entry.blockType === "event").length,
      travelBlocks: schedule.filter((entry) => entry.blockType === "travel").length,
      eatingBlocks: schedule.filter((entry) => entry.blockType === "eating").length,
      sleepingBlocks: schedule.filter((entry) => entry.blockType === "sleeping").length,
      mealBlocks: schedule.filter((entry) => entry.blockType === "eating").length,
    },
    days: groupByDay(schedule),
    referenceDays: groupByDay(reference),
    state,
    sync: {
      google: {
        status: "setup_required",
        mode: "ics_export",
        operationalIcs: "/api/ics/operational",
      },
    },
    email: emailPublicStatus(),
  };
}

function relativePath(url: URL): string {
  return decodeURIComponent(url.pathname.replace(decodeURIComponent(ROOT.pathname), ""));
}

async function handleSchedule(): Promise<Response> {
  const [entries, state] = await Promise.all([readScheduleEntries(), readState()]);
  return json(buildSchedulePayload(entries, state));
}

async function handleHealth(): Promise<Response> {
  let scheduleMtime = "";
  try {
    scheduleMtime = (await Deno.stat(SCHEDULE_CSV)).mtime?.toISOString() ?? "";
  } catch {
    scheduleMtime = "";
  }
  const stateStore = await storeHealth();
  return json({
    status: stateStore.status === "ready" ? "ready" : "degraded",
    gatewayConfigured: Boolean(Deno.env.get("UOS_AI_TOKEN") || Deno.env.get("OPENAI_API_KEY")),
    resendEmailConfigured: emailPublicStatus().followUpConfigured,
    stateStore,
    scheduleSource: relativePath(SCHEDULE_CSV),
    scheduleMtime,
  });
}

async function handleIcs(headOnly = false): Promise<Response> {
  const ics = await Deno.readTextFile(OPERATIONAL_ICS);
  return textResponse(headOnly ? "" : ics, "text/calendar; charset=utf-8", {
    headers: {
      "content-disposition": 'attachment; filename="techweek-operational-route.ics"',
    },
  });
}

async function handleStateAction(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Expected a JSON body.");
  const state = await readState();
  const now = new Date().toISOString();
  const type = String(body.type ?? "");

  if (type === "event_note") {
    const calendarBlockId = String(body.calendarBlockId ?? body.calendar_block_id ?? "").trim();
    if (!calendarBlockId) return badRequest("calendarBlockId is required.");
    state.eventNotes[calendarBlockId] = {
      note: String(body.note ?? "").trim(),
      updatedAt: now,
    };
    return json({ state: await writeState(state) });
  }

  if (type === "dismiss_block") {
    const calendarBlockId = String(body.calendarBlockId ?? body.calendar_block_id ?? "").trim();
    if (!calendarBlockId) return badRequest("calendarBlockId is required.");
    const dismissed = Boolean(body.dismissed ?? true);
    state.dismissedBlocks = dismissed
      ? [...new Set([...state.dismissedBlocks, calendarBlockId])]
      : state.dismissedBlocks.filter((item) => item !== calendarBlockId);
    return json({ state: await writeState(state) });
  }

  if (type === "lead_create") {
    const calendarBlockId = textField(body.calendarBlockId ?? body.calendar_block_id, 160);
    if (!calendarBlockId) return badRequest("calendarBlockId is required.");

    const entries = await readScheduleEntries();
    const entry = entries.find((item) => item.calendarBlockId === calendarBlockId);
    if (!entry || entry.blockType !== "event") {
      return badRequest("Lead must be associated with an event block.");
    }

    const lead: Lead = {
      id: crypto.randomUUID(),
      calendarBlockId,
      techweekId: entry.techweekId,
      eventTitle: entry.displayTitle,
      name: textField(body.name, 160),
      company: textField(body.company, 180),
      role: textField(body.role, 180),
      email: textField(body.email, 220),
      phone: textField(body.phone, 80),
      notes: textField(body.notes, 2000),
      priority: normalizeLeadPriority(body.priority),
      followUp: textField(body.followUp, 300),
      followUpEmail: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!lead.name && !lead.company && !lead.email && !lead.phone) {
      return badRequest("Add at least a name, company, email, or phone.");
    }

    const sendFollowUpEmail = body.sendFollowUpEmail === true || body.send_follow_up_email === true;
    if (sendFollowUpEmail) {
      lead.followUpEmail = await sendLeadFollowUpEmail(lead, entry, now);
    }

    state.leads = [lead, ...state.leads].slice(0, 250);
    return json({ state: await writeState(state), lead });
  }

  if (type === "lead_delete") {
    const id = textField(body.id, 160);
    if (!id) return badRequest("id is required.");
    state.leads = state.leads.filter((lead) => lead.id !== id);
    return json({ state: await writeState(state) });
  }

  return badRequest("Unsupported state action.");
}

async function handleAgendaRecalculate(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Expected a JSON object body.");
  }
  const result = await recalculateAgendaFromBody(body as Record<string, unknown>);
  await storeAgendaRun(result);
  return json({ agenda: result });
}

async function handleAgendaRun(id: string): Promise<Response> {
  const run = await readAgendaRun(id);
  if (!run) return notFound();
  return json({ agenda: run });
}

async function storeAgendaRun(result: AgendaRecalculateResult): Promise<void> {
  const metadata: AgendaRunMetadata = {
    agendaRunId: result.agendaRunId,
    generatedAt: result.generatedAt,
    storedAt: new Date().toISOString(),
    summary: result.summary,
  };
  await writeCacheValue("agendaRun", agendaRunCacheId(result.agendaRunId), result, {
    ttlMs: AGENDA_RUN_CACHE_TTL_MS,
    metadata: metadata as unknown as Record<string, unknown>,
  });
}

async function readAgendaRun(id: string): Promise<AgendaRecalculateResult | null> {
  return await readCacheValue<AgendaRecalculateResult>("agendaRun", agendaRunCacheId(id));
}

async function recalculateAgendaFromBody(
  body: Record<string, unknown>,
): Promise<AgendaRecalculateResult> {
  const [entries, state, storedStatusUpdates] = await Promise.all([
    readScheduleEntries(),
    readState(),
    readStoredPartifulStatusUpdates(),
  ]);
  const directStatusUpdates = Array.isArray(body.statusUpdates)
    ? body.statusUpdates as AgendaStatusUpdate[]
    : [];
  const acceptedEventIds = Array.isArray(body.acceptedEventIds)
    ? body.acceptedEventIds.map(String)
    : [];
  const overrides = recordValue(body.overrides) ?? undefined;
  const liveRouting = body.liveRouting !== false;

  return await recalculateAgenda({
    scheduleEntries: entries,
    state: {
      excludedBlockIds: state.dismissedBlocks,
    },
    overrides,
    statusUpdates: [...storedStatusUpdates, ...directStatusUpdates],
    acceptedEventIds,
    routeEstimator: liveRouting ? estimateAgendaRoute : undefined,
    routeVersion: liveRouting ? ROUTING_VERSION : "agenda-fallback-v1",
  });
}

async function readStoredPartifulStatusUpdates(): Promise<AgendaStatusUpdate[]> {
  const entries = await listCacheValues<StoredPartifulEvent>("partifulEvent", 1000);
  return entries.map((entry) => {
    const event = entry.value.normalizedEvent;
    return {
      partifulId: event.partifulId,
      status: event.status,
      reason: `Partiful sync status ${event.rawStatus || event.status}`,
      updatedAt: entry.value.syncedAt,
    };
  }).filter((item) => item.partifulId && item.status);
}

async function estimateAgendaRoute(
  request: AgendaRouteEstimateRequest,
): Promise<AgendaRouteEstimate> {
  const origin = await routePointFromAgendaPoint(request.origin);
  const destination = await routePointFromAgendaPoint(request.destination);
  const route = await routeBetween(origin, destination, {
    cache: routingPgCache,
    userAgent: DEFAULT_USER_AGENT,
    routingVersion: ROUTING_VERSION,
  });
  return {
    mode: route.mode,
    minutes: route.minutes,
    details: route.details,
    subwaySegments: route.subwaySegments,
    transitRisk: route.risk,
    distanceMeters: route.directWalk.meters,
    googleMapsUrl: googleMapsDirectionsUrl(
      pointMapsQuery(origin),
      pointMapsQuery(destination),
      route.mode,
    ),
    source: "osm_nominatim_subwayinfo",
  };
}

async function routePointFromAgendaPoint(point: {
  id?: string;
  name?: string;
  location?: string;
  venueQuery?: string;
  venuePrecision?: string;
  latitude?: number;
  longitude?: number;
}): Promise<RoutePoint> {
  const query = point.venueQuery || point.location || point.name || "New York, NY";
  if (isHomeAnchor(point, query)) return HOME_POINT;
  if (Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
    return {
      id: point.id,
      name: point.name || query,
      location: point.location,
      venueQuery: query,
      addressPrecision: point.venuePrecision || "provided_coordinates",
      lat: Number(point.latitude),
      lon: Number(point.longitude),
    };
  }
  const geocoded = await geocode(query, {
    cache: routingPgCache,
    userAgent: DEFAULT_USER_AGENT,
    routingVersion: ROUTING_VERSION,
  });
  return {
    id: point.id,
    name: point.name || query,
    location: point.location,
    venueQuery: query,
    addressPrecision: point.venuePrecision || "geocoded",
    lat: geocoded.lat,
    lon: geocoded.lon,
  };
}

function isHomeAnchor(point: { id?: string; name?: string }, query: string): boolean {
  const text = `${point.id ?? ""} ${point.name ?? ""} ${query}`.toLowerCase();
  return text.includes("fidi home") || text.includes("wall st, new york");
}

async function handlePartifulSync(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Expected a JSON body.");
  const raw = body as Record<string, unknown>;
  const snapshots = partifulSnapshotsFromBody(raw);
  if (snapshots.length === 0) {
    return badRequest("Provide snapshots, payloads, snapshot, or payload in the request body.");
  }

  const entries = await readScheduleEntries();
  const currentEvents = entries
    .filter((entry) => entry.blockType === "event")
    .map(partifulEventLikeFromEntry);
  const sync = computePartifulSync(currentEvents, snapshots, {
    includeRawPayload: raw.includeRawPayload === true,
    source: textField(raw.source, 120) || "api_supplied_snapshot",
  });

  await persistPartifulSync(sync.updatedEvents, sync.unmatchedSnapshots, sync.syncedAt);
  const responseBody: Record<string, unknown> = { sync };
  if (raw.recalculate === true) {
    const agenda = await recalculateAgendaFromBody({
      ...raw,
      statusUpdates: sync.updatedEvents.map((update) => ({
        partifulId: update.normalizedEvent.partifulId,
        status: update.normalizedEvent.status,
        reason: `Partiful sync status ${update.normalizedEvent.rawStatus}`,
        updatedAt: sync.syncedAt,
      })),
    });
    await storeAgendaRun(agenda);
    responseBody.agenda = agenda;
  }
  return json(responseBody);
}

function partifulSnapshotsFromBody(body: Record<string, unknown>): unknown[] {
  if (Array.isArray(body.snapshots)) return body.snapshots;
  if (Array.isArray(body.payloads)) return body.payloads;
  if (body.snapshot !== undefined) return [body.snapshot];
  if (body.payload !== undefined) return [body.payload];
  return [];
}

function partifulEventLikeFromEntry(entry: ScheduleEntry): Record<string, unknown> {
  return {
    calendarBlockId: entry.calendarBlockId,
    eventName: entry.displayTitle || entry.title,
    eventUrl: entry.eventUrl,
    id: entry.rerankId || entry.techweekId,
    location: entry.location,
    partifulId: entry.partifulId,
    rsvpStatus: entry.status,
    status: entry.status,
    techweekId: entry.techweekId,
    title: entry.displayTitle || entry.title,
    venue: entry.venueQuery,
  };
}

async function persistPartifulSync(
  updatedEvents: Array<{
    normalizedEvent: NormalizedPartifulEvent;
    mergedEvent: PartifulMergedEvent<Record<string, unknown>>;
    statusChanged: boolean;
    matchedBy: string;
  }>,
  unmatchedSnapshots: NormalizedPartifulEvent[],
  syncedAt: string,
): Promise<void> {
  const persistedIds = new Set<string>();
  for (const update of updatedEvents) {
    const normalizedEvent = compactNormalizedPartifulEvent(update.normalizedEvent);
    const cacheId = partifulEventCacheId(
      normalizedEvent.partifulId || normalizedEvent.eventUrl,
    );
    persistedIds.add(cacheId);
    await writeCacheValue(
      "partifulEvent",
      cacheId,
      {
        syncedAt,
        normalizedEvent,
        mergedEvent: update.mergedEvent,
        statusChanged: update.statusChanged,
        matchedBy: update.matchedBy,
      } satisfies StoredPartifulEvent,
      {
        ttlMs: PARTIFUL_SYNC_CACHE_TTL_MS,
        metadata: { status: normalizedEvent.status },
      },
    );
  }
  for (const event of unmatchedSnapshots) {
    const normalizedEvent = compactNormalizedPartifulEvent(event);
    const identity = normalizedEvent.partifulId || normalizedEvent.eventUrl;
    if (!identity) continue;
    const cacheId = partifulEventCacheId(identity);
    if (persistedIds.has(cacheId)) continue;
    await writeCacheValue(
      "partifulEvent",
      cacheId,
      {
        syncedAt,
        normalizedEvent,
        mergedEvent: {
          eventUrl: normalizedEvent.eventUrl,
          partifulEventUrl: normalizedEvent.eventUrl,
          partifulId: normalizedEvent.partifulId,
          partifulRawStatus: normalizedEvent.rawStatus,
          partifulStatus: normalizedEvent.rawStatus,
          partifulSyncedAt: syncedAt,
          status: normalizedEvent.status,
          title: normalizedEvent.title,
        },
        statusChanged: true,
        matchedBy: "none",
      } satisfies StoredPartifulEvent,
      {
        ttlMs: PARTIFUL_SYNC_CACHE_TTL_MS,
        metadata: { status: normalizedEvent.status, unmatched: true },
      },
    );
  }
}

function compactNormalizedPartifulEvent(
  event: NormalizedPartifulEvent,
): NormalizedPartifulEvent {
  const { rawPayload: _rawPayload, ...rest } = event;
  return rest;
}

async function handleCacheStatus(): Promise<Response> {
  const counts = await cacheCounts(CACHE_NAMESPACES);
  const health = await storeHealth();
  return json({
    backend: health.backend,
    counts,
  });
}

function handleGoogleSyncStatus(): Response {
  return json({
    status: "setup_required",
    message:
      "Direct Google Calendar write sync needs OAuth credentials. The current Deno app exposes the operational ICS export.",
    operationalIcs: "/api/ics/operational",
  }, { status: 501 });
}

function normalizeContextText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function singleLine(value: string): string {
  return normalizeContextText(value).replace(/\s+/g, " ").trim();
}

function clipContext(value: string, maxChars: number): string {
  const text = normalizeContextText(value);
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  const paragraphBreak = clipped.lastIndexOf("\n\n");
  const cut = paragraphBreak > maxChars * 0.72 ? clipped.slice(0, paragraphBreak) : clipped;
  return `${cut.trim()}\n[Context truncated at ${maxChars} characters.]`;
}

function truncateSingleLine(value: string, maxChars: number): string {
  const text = singleLine(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14)).trim()} [truncated]`;
}

function boundedContext(title: string, sections: string[], maxChars: number): string {
  const output = [title];
  let remaining = maxChars - title.length - 2;

  for (const section of sections.map(normalizeContextText).filter(Boolean)) {
    if (remaining <= 160) {
      output.push("[Context budget exhausted.]");
      break;
    }
    const chunk = section.length > remaining ? clipContext(section, remaining) : section;
    output.push(chunk);
    remaining -= chunk.length + 2;
    if (chunk.length < section.length) break;
  }

  return output.join("\n\n");
}

function contextSourcePath(url: URL): string {
  if (url.href.startsWith(ROOT.href)) return relativePath(url);
  return decodeURIComponent(url.pathname);
}

async function readContextFile(
  url: URL,
): Promise<{ text: string; error: string }> {
  try {
    return { text: normalizeContextText(await Deno.readTextFile(url)), error: "" };
  } catch (error) {
    return {
      text: "",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

async function fileContextText(
  title: string,
  files: ReadonlyArray<{ label: string; url: URL; maxChars: number }>,
  maxChars: number,
): Promise<string> {
  const sections = await Promise.all(
    files.map(async (file) => {
      const source = contextSourcePath(file.url);
      const result = await readContextFile(file.url);
      if (!result.text) {
        return `## ${file.label}\nSource: ${source}\n[Unavailable: ${
          result.error || "empty file"
        }]`;
      }
      return `## ${file.label}\nSource: ${source}\n${clipContext(result.text, file.maxChars)}`;
    }),
  );
  return boundedContext(title, sections, maxChars);
}

async function readRankingRows(): Promise<CsvRow[]> {
  const result = await readContextFile(RANKINGS_CSV);
  if (!result.text) return [];
  return parseCsv(result.text);
}

function rowValue(row: CsvRow | undefined, key: string): string {
  return row ? String(row[key] ?? "").trim() : "";
}

function rowRank(row: CsvRow): number {
  const rank = Number(row.rank);
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
}

function rankingIdForEntry(entry: ScheduleEntry): string {
  return entry.rerankId || entry.techweekId.replace(/^TW-/, "");
}

function rankingRowsById(rows: CsvRow[]): Map<string, CsvRow> {
  const byId = new Map<string, CsvRow>();
  for (const row of rows) {
    const id = rowValue(row, "id");
    if (id) byId.set(id, row);
  }
  return byId;
}

function compactRowField(row: CsvRow | undefined, key: string, maxChars = 700): string {
  return truncateSingleLine(rowValue(row, key), maxChars);
}

function crmLeadRubricContextText(): string {
  return [
    "# CRM lead capture and event matching context",
    "Lead capture should attach business-card and conversation notes to actual Tech Week event blocks only.",
    "Do not attach leads to travel, food, meal/reset, sleep, or other logistics blocks.",
    "Default lead event selection rule: use the current actual event by actual_start/actual_end; if no actual event is currently in progress, use the most recent previous actual event; if none exists, use the first upcoming actual event.",
    "For follow-up coaching, always consider the selected event's audience, host, topic, status, location, ranking, matched signals, and sales coaching.",
    "",
    "Lead priority rubric:",
    "- Priority A: CTO, VP Engineering, Head of Engineering, founder/technical founder, DevEx/platform/internal-tools leader, engineering operations leader, AI infra leader, open-source maintainer lead, or buyer with clear authority over GitHub workflows, engineering process, rewards, contractors, or contributor programs.",
    "- Priority B: engineer, product/ops lead, founder without obvious engineering-process ownership, investor/operator who can make useful intros, or someone with plausible but unconfirmed buyer fit.",
    "- Priority C: student, vendor, recruiter, generic community attendee, low-fit consumer/business role, or anyone with weak/no connection to engineering teams, GitHub workflows, DevEx, AI coding workflows, or contribution recognition.",
    "",
    "Follow-up guidance:",
    "- For A leads, propose a specific next step: 5-minute demo, sample manager packet review, one-repo pilot discussion, or intro to the person owning engineering process.",
    "- For B leads, ask one qualifying follow-up and preserve context from the event conversation.",
    "- For C leads, keep notes concise and avoid over-investing unless they offered a strong intro.",
    "- Never claim a lead was uploaded to an event unless the app state shows that lead under the selected actual event.",
  ].join("\n");
}

async function sanitizedProfileContextText(): Promise<string> {
  const result = await readContextFile(RSVP_PROFILE_JSON);
  if (!result.text) {
    return "# User operating profile\n[Profile file unavailable. Do not invent user details.]";
  }

  try {
    const parsed = JSON.parse(result.text) as Record<string, unknown>;
    const allowed = {
      project: parsed.project,
      preferences: parsed.preferences,
      answer_policy: parsed.answer_policy,
    };
    return [
      "# User operating profile",
      "Sanitized from .codex/techweek-rsvp-profile.json. Attendee contact fields are intentionally excluded.",
      JSON.stringify(allowed, null, 2),
    ].join("\n");
  } catch {
    return "# User operating profile\n[Profile JSON could not be parsed. Do not invent user details.]";
  }
}

async function productPlaybookContextText(): Promise<string> {
  return await fileContextText(
    "# Full Accolades product, sales, buyer, objection, and demo context",
    PRODUCT_PLAYBOOK_FILES,
    PRODUCT_PLAYBOOK_CONTEXT_CHAR_BUDGET,
  );
}

async function routeRunbookContextText(): Promise<string> {
  return await fileContextText(
    "# Tech Week route, signup, agenda, and ranking runbook context",
    ROUTE_RUNBOOK_FILES,
    ROUTE_RUNBOOK_CONTEXT_CHAR_BUDGET,
  );
}

function eventDossierContextText(entries: ScheduleEntry[], rankingRows: CsvRow[]): string {
  const byId = rankingRowsById(rankingRows);
  const eventEntries = entries
    .filter((entry) => entry.blockType === "event")
    .sort((a, b) => {
      if (a.calendar !== b.calendar) return a.calendar === "schedule" ? -1 : 1;
      return a.startEpochMs - b.startEpochMs;
    });

  const sections = eventEntries.map((entry, index) => {
    const row = byId.get(rankingIdForEntry(entry));
    const rowTitle = rowValue(row, "name");
    const title = rowTitle || entry.displayTitle;
    const description = rowValue(row, "event_description") || rowValue(row, "description_excerpt");
    return [
      `## ${index + 1}. ${title}`,
      `App schedule: calendar=${entry.calendar} status=${entry.status} category=${entry.category} day=${entry.weekday} ${entry.dayKey} time=${entry.timeRange} location=${entry.location}`,
      entry.venueQuery
        ? `Venue: ${entry.venueQuery} precision=${entry.venuePrecision || "unknown"}`
        : "",
      entry.eventUrl ? `URL: ${entry.eventUrl}` : "",
      row
        ? [
          "Ranking:",
          `rank=${rowValue(row, "rank")}`,
          `tier=${rowValue(row, "tier")}`,
          `action=${rowValue(row, "recommended_action")}`,
          `opportunity_score=${rowValue(row, "opportunity_score")}`,
          `practical_score=${rowValue(row, "practical_score")}`,
          `confidence=${rowValue(row, "confidence")}`,
          `access=${rowValue(row, "access_bucket")}`,
        ].filter(Boolean).join(" ")
        : "Ranking: no matching row found in full rerank CSV.",
      row
        ? [
          "Scores:",
          `buyer_fit=${rowValue(row, "buyer_fit_score")}`,
          `product_fit=${rowValue(row, "product_fit_score")}`,
          `topic_fit=${rowValue(row, "topic_fit_score")}`,
          `signal=${rowValue(row, "signal_score")}`,
          `location=${rowValue(row, "location_score")}`,
          `schedule=${rowValue(row, "schedule_score")}`,
          `negative=${rowValue(row, "negative_score")}`,
        ].filter(Boolean).join(" ")
        : "",
      row
        ? `Host/company: company=${compactRowField(row, "company", 240)} primary_host=${
          compactRowField(row, "primary_host", 240)
        } cohosts=${compactRowField(row, "cohosts", 500)} all_hosts=${
          compactRowField(row, "all_hosts", 600)
        }`
        : "",
      row ? `Fit summary: ${compactRowField(row, "fit_summary", 1200)}` : "",
      row ? `Matched signals: ${compactRowField(row, "matched_signals", 1600)}` : "",
      row ? `Caveats: ${compactRowField(row, "caveats", 900)}` : "",
      entry.note ? `Local signup/status note: ${singleLine(entry.note)}` : "",
      entry.salesCoaching ? `Local sales coaching:\n${clipContext(entry.salesCoaching, 1800)}` : "",
      description ? `Event description:\n${clipContext(description, 5200)}` : "",
    ].filter(Boolean).join("\n");
  });

  return boundedContext(
    "# Full dossiers for in-app schedule and reference events",
    sections,
    EVENT_DOSSIER_CONTEXT_CHAR_BUDGET,
  );
}

function rankedOpportunityMapContextText(entries: ScheduleEntry[], rankingRows: CsvRow[]): string {
  const selectedIds = new Set(
    entries.filter((entry) => entry.blockType === "event").map(rankingIdForEntry).filter(Boolean),
  );
  const rows = rankingRows
    .filter((row) => rowValue(row, "id") && rowValue(row, "name"))
    .sort((a, b) => rowRank(a) - rowRank(b))
    .slice(0, RANKED_OPPORTUNITY_MAP_LIMIT);

  const sections = rows.map((row) => {
    const id = rowValue(row, "id");
    const selection = selectedIds.has(id) ? "in_app_schedule_or_reference" : "not_selected";
    return [
      `#${rowValue(row, "rank")} ${rowValue(row, "tier")} ${rowValue(row, "name")}`,
      `id=${id}`,
      `selection=${selection}`,
      `date=${rowValue(row, "date")} ${rowValue(row, "time")} ${rowValue(row, "weekday")}`,
      `location=${compactRowField(row, "location", 160)}`,
      `company=${compactRowField(row, "company", 220)}`,
      `host=${compactRowField(row, "primary_host", 220)}`,
      `action=${compactRowField(row, "recommended_action", 120)}`,
      `access=${compactRowField(row, "access_bucket", 120)}`,
      `scores opportunity=${rowValue(row, "opportunity_score")} buyer=${
        rowValue(row, "buyer_fit_score")
      } product=${rowValue(row, "product_fit_score")} topic=${
        rowValue(row, "topic_fit_score")
      } signal=${rowValue(row, "signal_score")}`,
      `fit=${compactRowField(row, "fit_summary", 520)}`,
      `signals=${compactRowField(row, "matched_signals", 620)}`,
      `caveats=${compactRowField(row, "caveats", 360)}`,
      `excerpt=${
        truncateSingleLine(
          rowValue(row, "description_excerpt") || rowValue(row, "event_description"),
          720,
        )
      }`,
      `url=${rowValue(row, "event_url") || rowValue(row, "final_url")}`,
    ].filter((part) => !part.endsWith("=")).join(" | ");
  });

  return boundedContext(
    "# Broader ranked opportunity map for swaps, backups, and lead/event reasoning",
    [
      "Use this as context for alternatives and opportunity comparisons. It does not override the current in-app operational route.",
      ...sections,
    ],
    RANKED_OPPORTUNITY_MAP_CHAR_BUDGET,
  );
}

async function expandedAgentContext(
  prompt: string,
  entries: ScheduleEntry[],
  state: AppState,
  rawBody: Record<string, unknown>,
): Promise<string> {
  const [profile, productPlaybook, routeRunbook, rankingRows] = await Promise.all([
    sanitizedProfileContextText(),
    productPlaybookContextText(),
    routeRunbookContextText(),
    readRankingRows(),
  ]);

  return [
    clientContextText(rawBody.clientContext),
    crmLeadRubricContextText(),
    profile,
    productContextText(),
    productPlaybook,
    routeRunbook,
    eventDossierContextText(entries, rankingRows),
    rankedOpportunityMapContextText(entries, rankingRows),
    compactContext(prompt, entries, state),
  ].filter(Boolean).join("\n\n");
}

function compactContext(prompt: string, entries: ScheduleEntry[], state: AppState): string {
  const allEvents = entries.filter((entry) => entry.blockType === "event");
  const operational = entries.filter((entry) =>
    entry.calendar === "schedule" &&
    ["event", "travel", "eating", "sleeping"].includes(entry.blockType)
  );
  const routeBlocks = operational.filter((entry) => entry.blockType !== "event");
  const nextBlock = currentSchedulePointer(entries);
  const nextActualEvent =
    entries.find((entry) =>
      entry.calendar === "schedule" && entry.blockType === "event" && entry.endEpochMs > Date.now()
    ) ?? entries.find((entry) => entry.calendar === "schedule" && entry.blockType === "event");
  const promptNeedle = prompt.toLowerCase();
  const matching = entries.filter((entry) =>
    entry.techweekId && promptNeedle.includes(entry.techweekId.toLowerCase()) ||
    entry.displayTitle && promptNeedle.includes(entry.displayTitle.toLowerCase().slice(0, 18))
  ).slice(0, 3);
  const fullEventLines = allEvents.map((entry) => compactEntry(entry, state, true)).join("\n");
  const conciseEventLines = allEvents.map((entry) => compactEntry(entry, state, false)).join("\n");
  const eventLines = fullEventLines.length <= 52000 ? fullEventLines : conciseEventLines;
  const leadLines = state.leads.slice(0, 80).map(compactLead).join("\n");

  return [
    `Current date/time: ${
      new Date().toLocaleString("en-US", { timeZone: TIME_ZONE })
    } ${TIME_ZONE}.`,
    "This is the user's NYC Tech Week 2026 operational route plus reference/backups.",
    "Event IDs are included only for internal matching and data housekeeping. In user-facing responses, use full event titles instead of IDs.",
    nextBlock ? `App next block: ${compactEntry(nextBlock, state, false)}` : "",
    nextActualEvent ? `Next actual event: ${compactEntry(nextActualEvent, state, true)}` : "",
    "All actual event rows and their local data are included below when they fit the context budget.",
    "Registered means confirmed. Applied or pending means wait for host approval. Reference events are alternatives/backups, not the active route.",
    "Direct Google Calendar write sync is not configured in this app yet; do not claim changes were synced to Google Calendar.",
    "Supported local actions, if useful: event_note, google_sync_request.",
    'When proposing a local action, append one final line that starts with UOS_ACTIONS followed by minified JSON: {"actions":[...]}',
    `All actual events and data:\n${eventLines}`,
    `Non-event route blocks:\n${
      routeBlocks.map((entry) => compactEntry(entry, state, false)).join("\n")
    }`,
    leadLines
      ? `Captured CRM leads, newest first. Use these for follow-up coaching and relationship recall:\n${leadLines}`
      : "Captured CRM leads: none yet.",
    matching.length
      ? `Prompt matches:\n${matching.map((entry) => compactEntry(entry, state, true)).join("\n")}`
      : "",
  ].join("\n\n");
}

function compactLead(lead: Lead): string {
  return [
    `event=${lead.eventTitle}`,
    lead.name ? `name=${lead.name}` : "",
    lead.company ? `company=${lead.company}` : "",
    lead.role ? `role=${lead.role}` : "",
    lead.email ? `email=${lead.email}` : "",
    lead.phone ? `phone=${lead.phone}` : "",
    lead.priority ? `priority=${lead.priority}` : "",
    lead.followUp ? `follow_up=${lead.followUp}` : "",
    lead.followUpEmail ? `follow_up_email=${lead.followUpEmail.status}` : "",
    lead.notes ? `notes=${lead.notes}` : "",
    `created=${lead.createdAt}`,
  ].filter(Boolean).join(" | ");
}

function compactEntry(entry: ScheduleEntry, state: AppState, includeCoaching: boolean): string {
  const id = entry.techweekId || entry.calendarBlockId;
  const localNote = state.eventNotes[entry.calendarBlockId]?.note ?? "";
  const route = entry.entryType === "travel" ? entry.routeDetails : "";
  const note = entry.entryType !== "travel" ? entry.note : "";
  const coaching = includeCoaching ? coachingSummary(entry.salesCoaching) : "";
  return [
    id,
    entry.blockType,
    `calendar=${entry.calendar}`,
    entry.partifulId ? `partiful=${entry.partifulId}` : "",
    entry.rerankId ? `rerank=${entry.rerankId}` : "",
    `${entry.weekday} ${entry.dayKey} ${entry.timeRange}`,
    `${entry.status} ${entry.category}`.trim(),
    entry.statusLabel ? `label=${entry.statusLabel}` : "",
    entry.displayTitle,
    entry.location,
    entry.venueQuery ? `venue=${entry.venueQuery}` : "",
    entry.venuePrecision ? `venue_precision=${entry.venuePrecision}` : "",
    entry.rank ? `rank=${entry.rank}` : "",
    entry.tier ? `tier=${entry.tier}` : "",
    entry.opportunityScore ? `score=${entry.opportunityScore}` : "",
    entry.eventUrl ? `url=${entry.eventUrl}` : "",
    entry.googleMapsUrl ? `maps=${entry.googleMapsUrl}` : "",
    route ? `route=${route}` : "",
    entry.transitRisk ? `transit_risk=${entry.transitRisk}` : "",
    note ? `note=${note}` : "",
    coaching ? `coaching=${coaching}` : "",
    localNote ? `local_note=${localNote}` : "",
  ].filter(Boolean).join(" | ");
}

function coachingSummary(value: string): string {
  if (!value) return "";
  return value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(Open|Ask|Follow-up):/.test(line))
    .join(" ")
    .slice(0, 420);
}

function fallbackAgentAnswer(prompt: string, entries: ScheduleEntry[]): string {
  const upcoming = entries.filter((entry) =>
    entry.calendar === "schedule" &&
    ["event", "travel", "eating"].includes(entry.blockType) &&
    entry.endEpochMs > Date.now()
  );
  const next = upcoming[0] ??
    entries.find((entry) => entry.calendar === "schedule" && entry.entryType === "event");
  const nextEvent = upcoming.find((entry) => entry.entryType === "event") ??
    entries.find((entry) => entry.calendar === "schedule" && entry.entryType === "event");
  const backup =
    entries.find((entry) =>
      entry.calendar === "reference" && ["registered", "waitlisted"].includes(entry.status)
    ) ?? entries.find((entry) => entry.calendar === "reference" && entry.entryType === "event");

  const lines = [
    "The AI gateway returned an upstream error, so here is the local schedule answer.",
    "",
  ];
  if (next) {
    lines.push(`- **Next block:** ${next.weekday} ${next.timeRange}, ${next.displayTitle}.`);
    if (next.location) lines.push(`- **Location:** ${next.location}.`);
    if (next.routeDetails) lines.push(`- **Route:** ${next.routeDetails}`);
  }
  if (nextEvent && nextEvent.calendarBlockId !== next?.calendarBlockId) {
    lines.push(
      `- **Next event:** ${nextEvent.weekday} ${nextEvent.timeRange}, ${nextEvent.displayTitle}.`,
    );
  }
  if (/backup|fallback|fall through/i.test(prompt) && backup) {
    lines.push(
      `- **Backup to consider:** ${backup.weekday} ${backup.timeRange}, ${backup.displayTitle}.`,
    );
  }
  lines.push(
    "",
    "Retry the AI button in a moment; the app is still reading the local route correctly.",
  );
  return lines.join("\n");
}

function parseProposedActions(content: string): { visible: string; actions: ProposedAction[] } {
  const lines = content.split(/\r?\n/);
  const actionIndex = lines.findIndex((line) => line.trim().startsWith("UOS_ACTIONS "));
  if (actionIndex === -1) return { visible: content.trim(), actions: [] };

  const visible = lines.slice(0, actionIndex).join("\n").trim();
  const raw = lines.slice(actionIndex).join("\n").trim().replace(/^UOS_ACTIONS\s+/, "");
  try {
    const parsed = JSON.parse(raw) as { actions?: ProposedAction[] };
    return { visible, actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
  } catch {
    return { visible: content.trim(), actions: [] };
  }
}

function cardOcrPrompt(): string {
  return "Read this business card photo. It may be rotated, skewed, cropped, or partially obscured. Return only JSON with name, company, role, email, phone, and notes. Put websites, LinkedIn, or extra visible contact details in notes.";
}

function cardOcrChatBody(imageDataUrl: string): OcrRequestBody {
  return {
    model: AGENT_MODEL,
    reasoning_effort: null,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: cardOcrPrompt() },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };
}

function cardOcrTranscriptBody(transcript: string): OcrRequestBody {
  return {
    model: AGENT_MODEL,
    reasoning_effort: null,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "A local OCR engine read a business card image and produced the transcript below.",
              "Use the transcript to return only JSON with name, company, role, email, phone, and notes.",
              "Put websites, LinkedIn, or extra visible contact details in notes.",
              "Do not add commentary. Use null or an empty string for fields that are not present.",
              "",
              "OCR transcript:",
              transcript.slice(0, 4000),
            ].join("\n"),
          },
        ],
      },
    ],
  };
}

function imageDebugSummary(imageDataUrl: string) {
  const match = imageDataUrl.match(/^data:([^;,]+)(?:;[^,]*)?,/);
  return {
    mimeType: match?.[1] || "unknown",
    dataUrlCharacters: imageDataUrl.length,
    approxBytes: Math.round((imageDataUrl.split(",", 2)[1]?.length ?? 0) * 0.75),
  };
}

function logOcrContext(requestId: string, body: OcrRequestBody, imageDataUrl: string) {
  const redactedBody = {
    ...body,
    messages: body.messages.map((item) => ({
      ...item,
      content: item.content.map((part) =>
        part.type === "image_url"
          ? {
            type: "image_url",
            image_url: { url: `data:image/*;base64,<${imageDataUrl.length} chars>` },
          }
          : part
      ),
    })),
  };
  logJson("ocr_context", {
    requestId,
    endpoint: "/api/leads/ocr",
    upstreamEndpoint: "/v1/chat/completions",
    image: imageDebugSummary(imageDataUrl),
    requestBody: redactedBody,
  });
}

function logOcrTranscriptContext(requestId: string, body: OcrRequestBody, transcript: string) {
  logJson("ocr_text_fallback_context", {
    requestId,
    endpoint: "/api/leads/ocr",
    upstreamEndpoint: "/v1/chat/completions",
    transcript: truncateDebug(transcript, 2000),
    requestBody: body,
  });
}

function debugHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (
    const key of [
      "x-uos-request-id",
      "x-deno-trace-id",
      "x-uos-warning",
      "x-ubq-upstream",
      "x-uos-router-revision",
      "retry-after",
    ]
  ) {
    const value = headers.get(key);
    if (value) result[key] = value;
  }
  return result;
}

function requestDebug(request: Request): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url,
    userAgent: request.headers.get("user-agent") ?? "",
    origin: request.headers.get("origin") ?? "",
    referer: request.headers.get("referer") ?? "",
    contentLength: request.headers.get("content-length") ?? "",
  };
}

function responseDebugHeaders(upstreamHeaders: Headers, requestId: string): Headers {
  const headers = copyDebugHeaders(upstreamHeaders);
  headers.set("x-techweek-request-id", requestId);
  return headers;
}

function endpointError(
  message: string,
  requestId: string,
  status: number,
  detail?: unknown,
  headers: Headers = new Headers(),
): Response {
  headers.set("x-techweek-request-id", requestId);
  return json({
    error: {
      message,
      requestId,
      detail: truncateDebug(detail),
    },
  }, { status, headers });
}

async function handleClientLog(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Expected a JSON body.");
  const raw = body as Record<string, unknown>;
  logJson("client_log", {
    requestId: textField(raw.requestId, 120),
    event: textField(raw.event, 120),
    page: textField(raw.page, 240),
    payload: truncateDebug(raw.payload, 5000),
    request: requestDebug(request),
  });
  return new Response(null, { status: 204 });
}

function draftDebug(draft: LeadDraft): Record<string, unknown> {
  return {
    hasName: Boolean(draft.name),
    hasCompany: Boolean(draft.company),
    hasRole: Boolean(draft.role),
    hasEmail: Boolean(draft.email),
    hasPhone: Boolean(draft.phone),
    hasNotes: Boolean(draft.notes),
    priority: draft.priority,
    followUpLength: draft.followUp.length,
  };
}

function leadDraftHasUsableFields(draft: LeadDraft): boolean {
  return Boolean(
    draft.name.trim() || draft.company.trim() || draft.email.trim() || draft.phone.trim(),
  );
}

function clientMetadata(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  return truncateDebug(value, 5000);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function shouldUseLocalOcr(rawBody: Record<string, unknown>): boolean {
  const metadata = recordValue(rawBody.clientMetadata);
  const image = recordValue(metadata?.image);
  const sourceExifOrientation = Number(image?.sourceExifOrientation ?? 1);
  const attemptIndex = Number(metadata?.attemptIndex ?? 0);
  return attemptIndex === 0 && Number.isFinite(sourceExifOrientation) && sourceExifOrientation > 1;
}

async function tryLocalOcrOrientation(
  requestId: string,
  imageDataUrl: string,
  rawBody: Record<string, unknown>,
): Promise<LocalOcrOrientation | null> {
  if (!shouldUseLocalOcr(rawBody)) return null;

  logJson("ocr_local_start", {
    requestId,
    strategy: "tesseract_first_for_oriented_phone_image",
    image: imageDebugSummary(imageDataUrl),
    clientMetadata: clientMetadata(rawBody.clientMetadata),
  });

  try {
    const result = await localOcrOrientationFromImageDataUrl(requestId, imageDataUrl);
    if (result) {
      logJson("ocr_local_orientation_success", {
        requestId,
        score: result.score,
        rotation: result.rotation,
        image: imageDebugSummary(result.imageDataUrl),
        rawCharacters: result.raw.length,
      });
      return result;
    }
    logJson("ocr_local_orientation_miss", { requestId });
    return null;
  } catch (error) {
    logJson("ocr_local_orientation_error", {
      requestId,
      error: safeError(error),
    });
    return null;
  }
}

async function localOcrOrientationFromImageDataUrl(
  requestId: string,
  imageDataUrl: string,
): Promise<LocalOcrOrientation | null> {
  await Deno.mkdir(LOCAL_OCR_DIR, { recursive: true });
  const safeId = safePathSegment(requestId);
  const inputPath = fileUrlPath(new URL(`${safeId}-${crypto.randomUUID()}.jpg`, LOCAL_OCR_DIR));
  const pathsToRemove = new Set<string>([inputPath]);

  try {
    await Deno.writeFile(inputPath, dataUrlBytes(imageDataUrl));
    const imageVariants = await localOcrImageVariants(inputPath, safeId, pathsToRemove);
    let best: (LocalOcrOrientation & { path: string }) | null = null;

    for (const variant of imageVariants) {
      const output = await commandOutputWithTimeout(
        "tesseract",
        [variant.path, "stdout", "--psm", "6", "-l", "eng", "tsv"],
        LOCAL_OCR_TIMEOUT_MS,
      );
      const parsed = parseTesseractTsv(output.stdout);
      logJson("ocr_local_variant", {
        requestId,
        rotation: variant.rotation,
        success: output.success,
        code: output.code,
        timedOut: output.timedOut,
        score: parsed.score,
        wordCount: parsed.wordCount,
        meanConfidence: parsed.meanConfidence,
        rawCharacters: output.stdout.length,
        stderr: truncateDebug(output.stderr, 600),
        error: output.error,
      });

      if (!output.success && !output.stdout.trim()) continue;
      const candidate = {
        imageDataUrl: "",
        raw: parsed.transcript,
        score: parsed.score,
        rotation: variant.rotation,
        path: variant.path,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }

    if (!best || best.score < LOCAL_OCR_HIGH_CONFIDENCE_SCORE) return null;
    return {
      imageDataUrl: await imagePathToDataUrl(best.path),
      raw: best.raw,
      score: best.score,
      rotation: best.rotation,
    };
  } finally {
    for (const path of pathsToRemove) {
      await Deno.remove(path).catch(() => undefined);
    }
  }
}

async function localOcrImageVariants(
  inputPath: string,
  safeId: string,
  pathsToRemove: Set<string>,
): Promise<Array<{ rotation: number; path: string }>> {
  const variants: Array<{ rotation: number; path: string }> = [{ rotation: 0, path: inputPath }];
  for (const rotation of LOCAL_OCR_ROTATIONS.filter((item) => item !== 0)) {
    const outputPath = fileUrlPath(
      new URL(`${safeId}-${crypto.randomUUID()}-rot${rotation}.jpg`, LOCAL_OCR_DIR),
    );
    pathsToRemove.add(outputPath);
    const result = await commandOutputWithTimeout(
      "magick",
      [
        inputPath,
        "-background",
        "white",
        "-alpha",
        "remove",
        "-rotate",
        String(rotation),
        outputPath,
      ],
      LOCAL_OCR_TIMEOUT_MS,
    );
    if (result.success) {
      variants.push({ rotation, path: outputPath });
    } else {
      logJson("ocr_local_rotate_error", {
        rotation,
        code: result.code,
        timedOut: result.timedOut,
        stderr: truncateDebug(result.stderr, 600),
        error: result.error,
      });
    }
  }
  return variants;
}

async function commandOutputWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  let child: Deno.ChildProcess | null = null;
  let timedOut = false;
  try {
    child = new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child?.kill("SIGKILL");
      } catch {
        // The process may have already exited.
      }
    }, timeoutMs);
    try {
      const output = await child.output();
      return {
        success: output.success && !timedOut,
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
        timedOut,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      success: false,
      code: null,
      stdout: "",
      stderr: "",
      timedOut,
      error: safeError(error),
    };
  }
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Image data URL is missing its base64 payload.");
  const encoded = dataUrl.slice(comma + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safePathSegment(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    const allowed = (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === "_" ||
      char === "." ||
      char === "-";
    result += allowed ? char : "_";
    if (result.length >= 140) break;
  }
  return result || "ocr";
}

function parseTesseractTsv(tsv: string): LocalOcrVariantText {
  const lines = tsv.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const words: string[] = [];
  let confidenceTotal = 0;
  let confidenceCount = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (cells.length < 12) continue;
    const confidence = Number(cells[10]);
    const text = cells.slice(11).join("\t").trim();
    if (!text) continue;
    words.push(text);
    if (Number.isFinite(confidence) && confidence >= 0) {
      confidenceTotal += confidence;
      confidenceCount++;
    }
  }

  const meanConfidence = confidenceCount ? confidenceTotal / confidenceCount : 0;
  return {
    transcript: words.join(" "),
    score: meanConfidence * Math.max(1, words.length),
    wordCount: words.length,
    meanConfidence,
  };
}

async function imagePathToDataUrl(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function callOcrGateway(
  chatUrl: string,
  token: string,
  body: OcrRequestBody,
): Promise<{ upstream: Response; model: string }> {
  const model = AGENT_MODEL;
  const upstream = await fetch(chatUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { upstream, model };
}

async function readGatewayBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function gatewayErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const candidate = body as { error?: { message?: unknown }; detail?: unknown };
    if (typeof candidate.error?.message === "string") return candidate.error.message;
    if (typeof candidate.detail === "string") return candidate.detail;
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return "Upstream error";
}

function responseOutputText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const response = body as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  const responsesText = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => String(item.text))
    .join("\n");
  if (responsesText) return responsesText;
  return (response.choices ?? [])
    .map((choice) => choice.message?.content)
    .flatMap((content) => {
      if (typeof content === "string") return [content];
      if (!Array.isArray(content)) return [];
      return content
        .filter((part) =>
          part && typeof part === "object" &&
          (part as { type?: unknown; text?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        )
        .map((part) => String((part as { text: string }).text));
    })
    .join("\n");
}

async function tryOcrTranscriptFallback(
  requestId: string,
  chatUrl: string,
  token: string,
  transcript: string,
): Promise<Response | null> {
  if (!transcript.trim()) return null;

  const fallbackBody = cardOcrTranscriptBody(transcript);
  logOcrTranscriptContext(requestId, fallbackBody, transcript);

  let result: { upstream: Response; model: string };
  try {
    result = await callOcrGateway(chatUrl, token, fallbackBody);
  } catch (error) {
    logJson("ocr_text_fallback_error", {
      requestId,
      stage: "gateway_fetch",
      error: safeError(error),
    });
    return null;
  }

  const responseBody = await readGatewayBody(result.upstream);
  const upstreamDebug = {
    model: result.model,
    ok: result.upstream.ok,
    status: result.upstream.status,
    statusText: result.upstream.statusText,
    headers: debugHeaders(result.upstream.headers),
    body: truncateDebug(responseBody),
  };
  logJson("ocr_text_fallback_upstream", {
    requestId,
    ...upstreamDebug,
  });

  if (!result.upstream.ok) return null;

  const content = responseOutputText(responseBody);
  if (!content) {
    logJson("ocr_text_fallback_error", {
      requestId,
      stage: "response_shape",
      upstream: upstreamDebug,
    });
    return null;
  }

  try {
    const draft = normalizeLeadDraft(extractJsonObject(content));
    if (!leadDraftHasUsableFields(draft)) {
      logJson("ocr_text_fallback_empty", {
        requestId,
        draft: draftDebug(draft),
        content: truncateDebug(content),
      });
      return null;
    }
    logJson("ocr_success", {
      requestId,
      model: result.model,
      source: "local_ocr_transcript_fallback",
      draft: draftDebug(draft),
      rawCharacters: content.length,
    });
    return json({ requestId, draft, raw: content, source: "local_ocr_transcript_fallback" }, {
      headers: responseDebugHeaders(result.upstream.headers, requestId),
    });
  } catch (error) {
    logJson("ocr_text_fallback_error", {
      requestId,
      stage: "parse_gateway_json",
      error: safeError(error),
      content: truncateDebug(content),
    });
    return null;
  }
}

async function handleLeadOcr(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const rawBody = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const requestId = textField(rawBody.requestId, 120) || createRequestId("ocr");
  if (!body || typeof body !== "object") {
    logJson("ocr_error", {
      requestId,
      stage: "parse_request_body",
      request: requestDebug(request),
    });
    return endpointError("Expected a JSON body.", requestId, 400);
  }

  const imageDataUrl = String(rawBody.imageDataUrl ?? rawBody.image_data_url ?? "");
  if (!imageDataUrl.startsWith("data:image/")) {
    logJson("ocr_error", {
      requestId,
      stage: "validate_image_data_url",
      request: requestDebug(request),
      clientMetadata: clientMetadata(rawBody.clientMetadata),
    });
    return endpointError("imageDataUrl must be a data:image URL.", requestId, 400);
  }
  if (imageDataUrl.length > 9_000_000) {
    logJson("ocr_error", {
      requestId,
      stage: "validate_image_size",
      request: requestDebug(request),
      image: imageDebugSummary(imageDataUrl),
      clientMetadata: clientMetadata(rawBody.clientMetadata),
    });
    return endpointError(
      "Image is too large. Try a closer crop or lower resolution photo.",
      requestId,
      400,
      imageDebugSummary(imageDataUrl),
    );
  }

  const eventTitle = textField(rawBody.eventTitle, 240);
  const image = imageDebugSummary(imageDataUrl);
  logJson("ocr_start", {
    requestId,
    eventTitle,
    request: requestDebug(request),
    image,
    clientMetadata: clientMetadata(rawBody.clientMetadata),
  });

  const localOrientation = await tryLocalOcrOrientation(requestId, imageDataUrl, rawBody);
  const gatewayImageDataUrl = localOrientation?.imageDataUrl ?? imageDataUrl;
  const gatewayImage = imageDebugSummary(gatewayImageDataUrl);
  const ocrBody = cardOcrChatBody(gatewayImageDataUrl);
  logOcrContext(requestId, ocrBody, gatewayImageDataUrl);

  const { token, chatUrl } = gatewayConfig();
  if (!token) {
    logJson("ocr_error", {
      requestId,
      stage: "gateway_config",
      message: "UOS_AI_TOKEN is not configured.",
    });
    return endpointError("UOS_AI_TOKEN is not configured.", requestId, 503);
  }

  let result: { upstream: Response; model: string };
  try {
    result = await callOcrGateway(chatUrl, token, ocrBody);
  } catch (error) {
    logJson("ocr_error", {
      requestId,
      stage: "gateway_fetch",
      error: safeError(error),
      image: gatewayImage,
    });
    return endpointError("Business card OCR failed.", requestId, 502, safeError(error));
  }

  const responseBody = await readGatewayBody(result.upstream);
  const upstreamDebug = {
    model: result.model,
    ok: result.upstream.ok,
    status: result.upstream.status,
    statusText: result.upstream.statusText,
    headers: debugHeaders(result.upstream.headers),
    body: truncateDebug(responseBody),
  };
  logJson("ocr_upstream", {
    requestId,
    ...upstreamDebug,
  });

  if (!result.upstream.ok) {
    if (result.upstream.status >= 500) {
      const textFallback = await tryOcrTranscriptFallback(
        requestId,
        chatUrl,
        token,
        localOrientation?.raw ?? "",
      );
      if (textFallback) return textFallback;
    }

    const upstreamMessage = gatewayErrorMessage(responseBody);
    const clientStatus = result.upstream.status === 429 ? 429 : 502;
    const clientMessage = result.upstream.status === 429
      ? "AI gateway rate limit exceeded."
      : "Business card OCR failed.";
    logJson("ocr_error", {
      requestId,
      stage: "gateway_response",
      message: upstreamMessage,
      upstream: upstreamDebug,
      image: gatewayImage,
    });
    return endpointError(
      clientMessage,
      requestId,
      clientStatus,
      {
        upstreamStatus: result.upstream.status,
        upstreamMessage,
        upstreamHeaders: debugHeaders(result.upstream.headers),
      },
      responseDebugHeaders(result.upstream.headers, requestId),
    );
  }

  const content = responseOutputText(responseBody);
  if (!content) {
    logJson("ocr_error", {
      requestId,
      stage: "response_shape",
      upstream: upstreamDebug,
    });
    return endpointError(
      "AI gateway returned an unexpected OCR response shape.",
      requestId,
      500,
      responseBody,
      responseDebugHeaders(result.upstream.headers, requestId),
    );
  }

  let draft: LeadDraft;
  try {
    draft = normalizeLeadDraft(extractJsonObject(content));
  } catch (error) {
    logJson("ocr_error", {
      requestId,
      stage: "parse_gateway_json",
      error: safeError(error),
      content: truncateDebug(content),
    });
    return endpointError(
      error instanceof Error ? error.message : "Could not parse OCR response.",
      requestId,
      500,
      { content },
      responseDebugHeaders(result.upstream.headers, requestId),
    );
  }
  if (!leadDraftHasUsableFields(draft)) {
    logJson("ocr_error", {
      requestId,
      stage: "empty_draft",
      draft: draftDebug(draft),
      content: truncateDebug(content),
    });
    return endpointError(
      "Business card OCR did not find any lead fields.",
      requestId,
      422,
      { content, draft: draftDebug(draft) },
      responseDebugHeaders(result.upstream.headers, requestId),
    );
  }

  logJson("ocr_success", {
    requestId,
    model: result.model,
    draft: draftDebug(draft),
    rawCharacters: content.length,
  });
  return json({ requestId, draft, raw: content }, {
    headers: responseDebugHeaders(result.upstream.headers, requestId),
  });
}

function extractJsonObject(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("OCR response did not contain JSON.");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function normalizeLeadDraft(value: unknown): LeadDraft {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const contact = raw.contact && typeof raw.contact === "object"
    ? raw.contact as Record<string, unknown>
    : {};
  const company = textField(raw.company, 180);
  const role = textField(raw.role ?? raw.title, 180);
  const notes = leadNotesText([
    raw.notes,
    raw.website,
    raw.linkedin,
    raw.linkedIn,
    raw.url,
    contact.website,
    contact.linkedin,
    contact.linkedIn,
    contact.url,
  ]);
  return {
    name: textField(raw.name, 160),
    company,
    role,
    email: textField(raw.email ?? contact.email, 220),
    phone: textField(raw.phone ?? contact.phone, 80),
    notes,
    priority: inferLeadDraftPriority(raw.priority, company, role, notes),
    followUp: textField(raw.followUp ?? raw.follow_up, 300),
  };
}

function leadNotesText(values: unknown[]): string {
  return [...new Set(values.map((value) => textField(value, 360)).filter(Boolean))]
    .join("; ")
    .slice(0, 1200);
}

function inferLeadDraftPriority(
  value: unknown,
  company: string,
  role: string,
  notes: string,
): Lead["priority"] {
  if (value === "A" || value === "B" || value === "C") return value;
  const text = `${company} ${role} ${notes}`;
  return /\b(founder|co-founder|cto|chief technology|vp|head of engineering|director|devex|developer experience|platform|ai infrastructure|staff engineer|principal engineer)\b/i
      .test(text)
    ? "A"
    : "B";
}

function gatewayConfig(): GatewayConfig {
  const token = Deno.env.get("UOS_AI_TOKEN") || Deno.env.get("OPENAI_API_KEY") || "";
  const configuredBase = Deno.env.get("OPENAI_BASE_URL") ||
    `${(Deno.env.get("UOS_AI_BASE_URL") || "https://ai.ubq.fi").replace(/\/+$/, "")}/v1`;
  const base = configuredBase.replace(/\/+$/, "");
  const gatewayRoot = base.replace(/\/v1$/, "");
  return {
    token,
    chatUrl: `${base}/chat/completions`,
    responsesUrl: `${base}/responses`,
    modelsUrl: `${base}/models`,
    capabilitiesUrl: `${gatewayRoot}/uos/models/capabilities`,
  };
}

async function resolveModelContextInfo(
  config: GatewayConfig,
  model: string,
): Promise<ModelContextInfo> {
  const baseUrl = config.modelsUrl.replace(/\/models$/, "");
  const cached = modelContextCache;
  if (
    cached && cached.model === model && cached.baseUrl === baseUrl &&
    Date.now() - cached.fetchedAtMs < MODEL_CONTEXT_CACHE_MS
  ) {
    return { ...cached.info, cacheHit: true };
  }

  const api: ModelContextInfo["api"] = {
    modelEndpointStatus: null,
    modelsEndpointStatus: null,
    capabilitiesEndpointStatus: null,
    listedByModelsEndpoint: null,
    listedByCapabilitiesEndpoint: null,
    metadataFieldsSeen: [],
    capabilitiesFieldsSeen: [],
    error: "",
  };

  let foundModel: Record<string, unknown> | null = null;
  let foundCapabilities: Record<string, unknown> | null = null;
  if (config.token) {
    try {
      const detail = await fetch(`${config.modelsUrl}/${encodeURIComponent(model)}`, {
        headers: { authorization: `Bearer ${config.token}` },
      });
      api.modelEndpointStatus = detail.status;
      const body = await readJsonOrText(detail);
      if (detail.ok && body && typeof body === "object") {
        foundModel = body as Record<string, unknown>;
      }

      const list = await fetch(config.modelsUrl, {
        headers: { authorization: `Bearer ${config.token}` },
      });
      api.modelsEndpointStatus = list.status;
      const listBody = await readJsonOrText(list);
      if (list.ok && listBody && typeof listBody === "object") {
        const data = (listBody as { data?: unknown }).data;
        if (Array.isArray(data)) {
          const listed = data.find((item) =>
            item && typeof item === "object" &&
            String((item as { id?: unknown }).id || "") === model
          );
          api.listedByModelsEndpoint = Boolean(listed);
          if (!foundModel && listed && typeof listed === "object") {
            foundModel = listed as Record<string, unknown>;
          }
        }
      }

      const capabilities = await fetch(config.capabilitiesUrl, {
        headers: { authorization: `Bearer ${config.token}` },
      });
      api.capabilitiesEndpointStatus = capabilities.status;
      const capabilitiesBody = await readJsonOrText(capabilities);
      if (capabilities.ok && capabilitiesBody && typeof capabilitiesBody === "object") {
        const data = (capabilitiesBody as { data?: unknown }).data;
        if (Array.isArray(data)) {
          const listed = data.find((item) =>
            item && typeof item === "object" &&
            String((item as { id?: unknown }).id || "") === model
          );
          api.listedByCapabilitiesEndpoint = Boolean(listed);
          if (listed && typeof listed === "object") {
            foundCapabilities = listed as Record<string, unknown>;
          }
        }
      }
    } catch (error) {
      api.error = error instanceof Error ? error.message : String(error);
    }
  } else {
    api.error =
      "Gateway token is not configured; skipped /models and /uos/models/capabilities lookup.";
  }

  const apiLimit = foundModel ? extractModelLimits(foundModel) : null;
  api.metadataFieldsSeen = foundModel ? modelLimitFieldNames(foundModel) : [];
  const capabilitiesLimit = foundCapabilities ? extractModelCapabilities(foundCapabilities) : null;
  api.capabilitiesFieldsSeen = foundCapabilities ? modelLimitFieldNames(foundCapabilities) : [];
  const fallback = CODEX_CLIENT_CONTEXT_FALLBACKS[model];
  const capabilityContextWindowTokens = capabilitiesLimit
    ? capabilitiesLimit.contextWindowTokens ??
      capabilitiesLimit.autoCompactTokenLimitTokens ??
      capabilitiesLimit.maxContextWindowTokens
    : null;
  const info: ModelContextInfo = capabilitiesLimit && capabilityContextWindowTokens
    ? {
      model,
      contextWindowTokens: capabilityContextWindowTokens,
      maxContextWindowTokens: capabilitiesLimit.maxContextWindowTokens ??
        capabilityContextWindowTokens,
      autoCompactTokenLimitTokens: capabilitiesLimit.autoCompactTokenLimitTokens,
      effectiveContextWindowTokens: capabilitiesLimit.autoCompactTokenLimitTokens ??
        capabilityContextWindowTokens,
      effectiveContextWindowPercent: null,
      maxOutputTokens: apiLimit?.maxOutputTokens ?? null,
      longPromptPricingThresholdTokens: apiLimit?.longPromptPricingThresholdTokens ?? null,
      source: "gateway_capabilities_endpoint",
      cacheHit: false,
      gatewayHost: safeUrlHost(baseUrl),
      api,
      notes: [
        "Model availability was read from /v1/models and context limits were read from /uos/models/capabilities.",
        "context_window_tokens is treated as the current usable context window; auto_compact_token_limit_tokens is used as the prompt calibration limit when present.",
      ],
    }
    : fallback
    ? {
      model,
      contextWindowTokens: fallback.contextWindowTokens,
      maxContextWindowTokens: fallback.maxContextWindowTokens,
      autoCompactTokenLimitTokens: fallback.autoCompactTokenLimitTokens,
      effectiveContextWindowTokens: fallback.autoCompactTokenLimitTokens,
      effectiveContextWindowPercent: fallback.effectiveContextWindowPercent,
      maxOutputTokens: fallback.maxOutputTokens,
      longPromptPricingThresholdTokens: null,
      source: "codex_client_cache_fallback",
      cacheHit: false,
      gatewayHost: safeUrlHost(baseUrl),
      api,
      notes: [
        "The gateway capabilities endpoint did not expose numeric context metadata for this model.",
        `Using ${fallback.sourceLabel} as a last-resort fallback.`,
        "When /uos/models/capabilities returns numeric values, those values should replace this fallback.",
      ],
    }
    : {
      model,
      contextWindowTokens: null,
      maxContextWindowTokens: null,
      autoCompactTokenLimitTokens: null,
      effectiveContextWindowTokens: null,
      effectiveContextWindowPercent: null,
      maxOutputTokens: null,
      longPromptPricingThresholdTokens: null,
      source: "unknown",
      cacheHit: false,
      gatewayHost: safeUrlHost(baseUrl),
      api,
      notes: [
        "No numeric context metadata was exposed by /uos/models/capabilities.",
        "The OpenAI-compatible /v1/models endpoint is intentionally used only for model listing, not context limits.",
      ],
    };

  modelContextCache = { model, baseUrl, fetchedAtMs: Date.now(), info };
  return info;
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 1000);
  }
}

function extractModelLimits(model: Record<string, unknown>) {
  const flat = flattenModelMetadata(model);
  const contextWindowTokens = firstNumberField(flat, [
    "context_window",
    "contextWindow",
    "context_length",
    "contextLength",
    "max_context_length",
    "maxContextLength",
    "max_model_len",
    "maxModelLen",
    "input_token_limit",
    "inputTokenLimit",
    "max_input_tokens",
    "maxInputTokens",
    "top_provider.context_length",
    "top_provider.contextWindow",
    "metadata.context_window",
    "metadata.context_length",
    "metadata.max_context_length",
    "metadata.max_model_len",
  ]);
  const maxOutputTokens = firstNumberField(flat, [
    "max_output_tokens",
    "maxOutputTokens",
    "output_token_limit",
    "outputTokenLimit",
    "metadata.max_output_tokens",
    "metadata.output_token_limit",
    "top_provider.max_completion_tokens",
    "top_provider.maxOutputTokens",
  ]);
  const longPromptPricingThresholdTokens = firstNumberField(flat, [
    "long_prompt_pricing_threshold_tokens",
    "longPromptPricingThresholdTokens",
    "metadata.long_prompt_pricing_threshold_tokens",
  ]);
  return { contextWindowTokens, maxOutputTokens, longPromptPricingThresholdTokens };
}

function extractModelCapabilities(model: Record<string, unknown>) {
  const flat = flattenModelMetadata(model);
  const contextWindowTokens = firstNumberField(flat, [
    "context_window_tokens",
    "contextWindowTokens",
  ]);
  const maxContextWindowTokens = firstNumberField(flat, [
    "max_context_window_tokens",
    "maxContextWindowTokens",
  ]);
  const autoCompactTokenLimitTokens = firstNumberField(flat, [
    "auto_compact_token_limit_tokens",
    "autoCompactTokenLimitTokens",
  ]);
  return { contextWindowTokens, maxContextWindowTokens, autoCompactTokenLimitTokens };
}

function flattenModelMetadata(value: unknown, prefix = ""): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    result[path] = child;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      Object.assign(result, flattenModelMetadata(child, path));
    }
  }
  return result;
}

function firstNumberField(flat: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = flat[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  }
  return null;
}

function modelLimitFieldNames(model: Record<string, unknown>): string[] {
  const flat = flattenModelMetadata(model);
  return Object.keys(flat)
    .filter((key) => /context|token|model_len|completion/i.test(key))
    .sort();
}

function agentRequestBody(
  body: unknown,
): { prompt: string; rawBody: Record<string, unknown> } | Response {
  if (!body || typeof body !== "object") return badRequest("Expected a JSON body.");
  const rawBody = body as Record<string, unknown>;
  const prompt = String(rawBody.prompt ?? "").trim();
  if (!prompt) return badRequest("prompt is required.");
  return { prompt, rawBody };
}

function priorAgentMessages(rawBody: Record<string, unknown>) {
  return Array.isArray(rawBody.messages)
    ? (rawBody.messages as AgentMessage[])
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-6)
      .map((message) => ({ role: message.role, content: String(message.content ?? "") }))
    : [];
}

function clientContextText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "Client context: not provided.";
  }

  const context = value as ClientContext;
  const coords = context.coordinates;
  return [
    "Client context from the user's current browser/device:",
    typeof context.localText === "string" ? `local_time=${context.localText}` : "",
    typeof context.localIso === "string" ? `local_iso=${context.localIso}` : "",
    typeof context.timeZone === "string" ? `timezone=${context.timeZone}` : "",
    typeof context.isSecureContext === "boolean" ? `secure_context=${context.isSecureContext}` : "",
    coords && typeof coords.latitude === "number" && typeof coords.longitude === "number"
      ? `gps=${coords.latitude},${coords.longitude} accuracy_meters=${
        typeof coords.accuracyMeters === "number" ? Math.round(coords.accuracyMeters) : "unknown"
      } captured_at=${typeof coords.capturedAt === "string" ? coords.capturedAt : "unknown"}`
      : "",
    typeof context.locationStatus === "string" ? `gps_status=${context.locationStatus}` : "",
    context.viewport && typeof context.viewport.width === "number" &&
      typeof context.viewport.height === "number"
      ? `viewport=${context.viewport.width}x${context.viewport.height} dpr=${
        typeof context.viewport.devicePixelRatio === "number"
          ? context.viewport.devicePixelRatio
          : "unknown"
      }`
      : "",
  ].filter(Boolean).join("\n");
}

function productContextText(): string {
  return [
    "Product/sales context for event coaching:",
    "Product: UbiquityOS Accolades.",
    "",
    "Core positioning:",
    "- UbiquityOS Accolades is an evidence-backed contribution ledger for software teams: specs, reviews, comments, and coordination, not just commits.",
    "- Short pitch: Accolades turns GitHub work artifacts into source-linked contribution credit. Every point has a contributor, artifact, reason, policy, and source link.",
    "- Safer event version: We turn GitHub work artifacts into source-linked contribution credit. The goal is recognition beyond commits, not employee surveillance.",
    "- Trust line: Not employee scoring. Source-linked contribution evidence.",
    "- Category: contribution ledger, manager packet, audit trail for reward decisions, source-linked recognition.",
    "",
    "Company/platform context:",
    "- UbiquityOS is a GitHub-native automation platform where a lightweight kernel receives repository events, validates context, and routes work to modular plugins.",
    "- Plugins are independent product surfaces that consume structured GitHub context, apply domain logic, and write results back to GitHub or external systems.",
    "- Accolades is the productized contribution and conversation rewards plugin. It is the first GTM wedge because it turns a concrete workflow into a buyer-legible product.",
    "- Platform thesis: engineering work already happens across GitHub, Slack, Linear, Jira, and Discord; UbiquityOS converts those events into enforceable workflows, contribution records, rewards, and operational intelligence.",
    "",
    "Problem framing:",
    "- Commit counts miss useful engineering work: issue specs, clarifying comments, PR reviews, changes-requested reviews, architecture tradeoffs, simplification work, release coordination, maintainer labor, and unblocking decisions.",
    "- AI increases code volume, which makes review quality, spec quality, ownership, judgment, and accountability more important. Raw commit volume becomes a weaker contribution signal.",
    "- Traditional engineering dashboards collapse work into shallow counts: commits, PRs, comments, reviews, or messages. Those are easy to misread and can reward noise.",
    "- Managers need source-linked, explainable, configurable, auditable evidence that supports recognition and reward decisions without becoming surveillance.",
    "",
    "What Accolades can do today:",
    "- Evaluate GitHub issue comments, PR comments, specifications, and reviews in the context of the underlying issue or pull request.",
    "- Score relevance from 0 to 1 for contribution artifacts, then combine relevance with formatting, role, artifact type, review state, priority, and configured policy.",
    "- Recognize meaningful review work, including APPROVED and CHANGES_REQUESTED reviews, based on reviewed additions/deletions, priority labels, conclusive review state, and file exclusions.",
    "- Score structured communication such as paragraphs, lists, headings, links, images, code blocks, and tables without positioning it as pay-per-word.",
    "- Strip or discount noise such as commands, bot responses, quoted text, HTML comments, footnotes, hidden/minimized comments, duplicate links, and assignment-window gaming when configured.",
    "- Produce XP or reward totals per contributor, link credit back to source GitHub artifacts, post debuggable output to GitHub, persist reward/permit records, and generate claimable ERC20 permits when payout workflows are enabled.",
    "- Current implementation is working product logic in @ubiquity-os/text-conversation-rewards, not only a marketing prototype.",
    "",
    "Ledger record concept:",
    "- Useful record shape: contributor, artifact type, artifact URL, reason for credit, relevance/scoring explanation, policy applied, XP or reward value, review status, export or payout status.",
    "- The defensible claim is not perfect measurement of all engineering value. The claim is structured, inspectable contribution evidence from systems where work already happens.",
    "- Output should feel like a reviewable manager packet, not a leaderboard.",
    "",
    "Primary buyers and what to listen for:",
    "- VP Eng / CTO: wants evidence for valuable engineering work beyond commits; triggered by AI code volume, review load, invisible work, manager calibration, and low-trust productivity metrics.",
    "- EngOps: wants repeatable operating evidence for reporting and reviews without relying on memory or raw activity counts.",
    "- DevEx: wants developer trust and recognition for useful behaviors without asking engineers to perform for dashboards.",
    "- OSPO / maintainers: wants auditable contribution and reward allocation for open-source contributors, maintainers, grants, bounties, or community programs.",
    "- Engineering managers: wants source evidence for recognition, coaching, calibration, contractor review, and not missing quiet contributors.",
    "- Platform engineers/security reviewers: care about bounded GitHub scope, permissions, data handling, and low operational burden.",
    "- Finance/procurement only becomes primary when rewards, contractors, grants, or vendor approval enter the workflow.",
    "",
    "Strong positive event signals:",
    "- They say review work is invisible, open-source rewards are hard to allocate, contractor contribution is hard to evaluate, managers assemble evidence manually, AI code review is becoming painful, or a one-repo pilot sounds useful.",
    "- They ask for source links, manager packets, policy control, contributor evidence, payout auditability, or a sample dashboard.",
    "- They are GitHub-first, review-heavy, issue/spec-heavy, open-source, contractor-heavy, AI-tooling-heavy, or infrastructure/devtools oriented.",
    "",
    "Risk signals and safe responses:",
    "- Surveillance concern: validate it. Say Accolades is contribution evidence for existing GitHub artifacts, not monitoring, ranking, or automatic performance management.",
    "- Gaming concern: say any incentive system can be gamed if it rewards raw activity; Accolades is designed around source-linked artifacts, relevance, configurable policy, and human review.",
    "- Fairness concern: say Accolades is not a universal fairness engine; it makes evidence inspectable and policy-governed, with role-aware human interpretation.",
    "- AI distrust: say no one should trust an unexplained AI score; each record should show what counted, why, which policy applied, and where the source lives.",
    "- Slack concern: say the direction is Slack-linked decisions and coordination artifacts tied to issues/PRs/incidents, not raw Slack message scoring or DM analysis.",
    "- Manager misuse: say this should not be the sole basis for performance review, promotion, stack ranking, or compensation decisions.",
    "",
    "Discovery questions to ask at events:",
    "- How do you currently understand non-code engineering contribution?",
    "- Do specs, reviews, and issue comments factor into recognition, performance, reward, or contractor discussions?",
    "- Has AI changed review volume, review quality, or the questions managers ask about output?",
    "- Which useful work is under-recognized today: specs, reviews, issue triage, incident coordination, unblocking, maintainer labor, or architecture comments?",
    "- What would make contribution scoring feel useful instead of dangerous?",
    "- What should absolutely never be scored?",
    "- Would your team trust source-linked contribution evidence if every point showed the artifact, reason, policy, and source?",
    "- Who owns this problem: VP Eng, EngOps, DevEx, OSPO, platform, finance, or individual managers?",
    "- Would this be more useful for employees, contractors, open-source contributors, or maintainers?",
    "- Would you want XP, payouts, manager packets, audit exports, or all of the above?",
    "- Which repo has enough issue and PR discussion to make a one-repo pilot meaningful?",
    "",
    "Pilot framing:",
    "- Preferred ask: connect one GitHub repository, score recent closed issues and merged PRs, and export a manager packet showing who contributed, what counted, why it counted, which policy applied, and where the source evidence lives.",
    "- First pilot should be narrow, read-only where possible, GitHub-first, and non-compensatory until policy and trust are reviewed.",
    "- Do not require Slack, HRIS, or finance integration for the first pilot. Expand sources only after GitHub evidence is trusted.",
    "- Success criteria: buyer sees evidence they do not get from commits or existing analytics; managers can inspect and challenge records; output feels safe for limited internal discussion.",
    "",
    "What to say:",
    "- Evidence over activity.",
    "- Credit beyond commits.",
    "- Policy before points.",
    "- Every score needs a source link.",
    "- Recognition should be reviewable.",
    "- Source-linked contribution evidence.",
    "- Reviewable manager packet.",
    "- Configurable scoring policy.",
    "- Recognition beyond commits.",
    "- Audit trail for reward decisions.",
    "- One-repo pilot.",
    "",
    "What not to say:",
    "- Do not say we measure developer productivity.",
    "- Do not say we rank engineers.",
    "- Do not say we track Slack activity.",
    "- Do not say the AI decides who is valuable.",
    "- Do not say this replaces performance reviews.",
    "- Do not say it solves fairness automatically.",
    "- Do not lead with token payouts unless the buyer brings up rewards, contractors, grants, bounties, or open-source compensation.",
    "",
    "Event operating guidance:",
    "- Use events to test positioning and discover buyers, not collect generic contacts.",
    "- Open with: I am working on an evidence-backed contribution ledger for engineering teams. It recognizes specs, reviews, comments, and coordination, not just commits. I am trying to understand where this is useful versus dangerous.",
    "- If the room is AI/devtools-heavy, frame around AI making commit volume less meaningful and review/spec quality more important.",
    "- If the room is open-source/crypto-heavy, frame around auditable contribution and reward allocation for contributors and maintainers.",
    "- If the room is enterprise/EngOps-heavy, frame around manager packets, governance, and repeatable contribution evidence.",
    "- Strong follow-up ask: Would you be open to reacting to a 5-minute demo or sample manager packet next week?",
  ].join("\n");
}

async function buildAgentMessages(
  prompt: string,
  entries: ScheduleEntry[],
  state: AppState,
  rawBody: Record<string, unknown>,
): Promise<ChatMessage[]> {
  const developerContext = await expandedAgentContext(prompt, entries, state, rawBody);
  return [
    {
      role: "system",
      content:
        "You are the embedded mobile calendar agent for NYC Tech Week 2026. Be concise, practical, and route-aware. For event coaching, tailor the advice to the specific event's audience, status, location, ranking, notes, and sales coaching data. Prefer compact markdown with short sections or bullets. Use full event titles in user-facing responses; never rely on TechWeek IDs, CalendarBlockIDs, RerankIDs, or Partiful IDs because they are internal housekeeping only. If the user asks for a calendar change, propose a local action rather than claiming it is complete.",
    },
    {
      role: "developer",
      content: developerContext,
    },
    ...priorAgentMessages(rawBody),
    { role: "user", content: prompt },
  ];
}

function chatRequestBody(model: string, stream: boolean, messages: ChatMessage[]) {
  return {
    model,
    reasoning_effort: null,
    stream,
    messages,
  };
}

function agentTokenUtilization(
  requestBody: ReturnType<typeof chatRequestBody>,
  modelContext: ModelContextInfo,
): AgentTokenUtilization {
  const messages = requestBody.messages.map((message, index) => {
    const contentTokens = countTokens(message.content);
    return {
      index,
      role: message.role,
      contentTokens,
      characters: message.content.length,
      preview: previewText(message.content),
    };
  });
  const byRole: AgentTokenUtilization["byRole"] = {};
  for (const message of messages) {
    const current = byRole[message.role] ?? { messages: 0, contentTokens: 0, characters: 0 };
    current.messages += 1;
    current.contentTokens += message.contentTokens;
    current.characters += message.characters;
    byRole[message.role] = current;
  }

  const contentTokens = messages.reduce((total, message) => total + message.contentTokens, 0);
  const estimatedEnvelopeTokens = CHAT_REQUEST_OVERHEAD_TOKENS +
    messages.length * CHAT_MESSAGE_OVERHEAD_TOKENS;
  const estimatedInputTokens = contentTokens + estimatedEnvelopeTokens;
  const requestJsonTokens = countTokens(JSON.stringify(requestBody));
  const contextWindowTokens = modelContext.contextWindowTokens;
  const maxContextWindowTokens = modelContext.maxContextWindowTokens;
  const autoCompactTokenLimitTokens = modelContext.autoCompactTokenLimitTokens;
  const effectiveContextWindowTokens = modelContext.effectiveContextWindowTokens;
  const effectiveContextWindowPercent = modelContext.effectiveContextWindowPercent;
  const maxOutputTokens = modelContext.maxOutputTokens;
  const longPromptPricingThresholdTokens = modelContext.longPromptPricingThresholdTokens;

  return {
    tokenizer: {
      package: "js-tiktoken",
      encoding: TOKEN_ENCODING_NAME,
      exactModelEncoding: false,
      note:
        "GPT-5.5 tokenizer metadata is not exposed by the gateway; o200k_base is used as the closest OpenAI-family estimator.",
    },
    messageCount: messages.length,
    contentTokens,
    estimatedEnvelopeTokens,
    estimatedInputTokens,
    requestJsonTokens,
    contextWindowTokens,
    maxContextWindowTokens,
    autoCompactTokenLimitTokens,
    effectiveContextWindowTokens,
    effectiveContextWindowPercent,
    maxOutputTokens,
    longPromptPricingThresholdTokens,
    percentOfContextWindow: contextWindowTokens
      ? roundPercent(estimatedInputTokens / contextWindowTokens)
      : null,
    percentOfEffectiveContextWindow: effectiveContextWindowTokens
      ? roundPercent(estimatedInputTokens / effectiveContextWindowTokens)
      : null,
    remainingContextTokens: contextWindowTokens ? contextWindowTokens - estimatedInputTokens : null,
    remainingEffectiveContextTokens: effectiveContextWindowTokens
      ? effectiveContextWindowTokens - estimatedInputTokens
      : null,
    remainingAfterMaxOutputTokens: contextWindowTokens && maxOutputTokens
      ? contextWindowTokens - estimatedInputTokens - maxOutputTokens
      : null,
    exceedsContextWindow: contextWindowTokens ? estimatedInputTokens > contextWindowTokens : null,
    exceedsEffectiveContextWindow: effectiveContextWindowTokens
      ? estimatedInputTokens > effectiveContextWindowTokens
      : null,
    exceedsLongPromptPricingThreshold: longPromptPricingThresholdTokens
      ? estimatedInputTokens > longPromptPricingThresholdTokens
      : null,
    byRole,
    messages,
  };
}

function countTokens(value: string): number {
  return TOKEN_ENCODER.encode(value).length;
}

function roundPercent(value: number): number {
  return Math.round(value * 10000) / 100;
}

function previewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 220);
}

async function logAgentContext({
  endpoint,
  stream,
  model,
  prompt,
  rawBody,
  messages,
  modelContext,
}: {
  endpoint: string;
  stream: boolean;
  model: string;
  prompt: string;
  rawBody: Record<string, unknown>;
  messages: ChatMessage[];
  modelContext: ModelContextInfo;
}): Promise<AgentDebugPayload> {
  const id = createRequestId("agent");
  const createdAt = new Date().toISOString();
  const requestBody = chatRequestBody(model, stream, messages);
  const utilization = agentTokenUtilization(requestBody, modelContext);
  const debugPayload = { id, createdAt, endpoint, prompt, requestBody, modelContext, utilization };
  await writeCacheValue("agentDebug", id, compactAgentDebugPayload(debugPayload), {
    ttlMs: AGENDA_RUN_CACHE_TTL_MS,
    metadata: { endpoint, model, stream },
  });
  console.log(
    JSON.stringify(
      {
        type: "agent_context",
        id,
        endpoint,
        loggedAt: createdAt,
        prompt,
        clientContext: rawBody.clientContext ?? null,
        historyMessageCount: Array.isArray(rawBody.messages) ? rawBody.messages.length : 0,
        requestBody,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        type: "agent_context_utilization",
        id,
        endpoint,
        loggedAt: createdAt,
        prompt,
        model,
        stream,
        modelContext,
        utilization,
      },
      null,
      2,
    ),
  );
  return debugPayload;
}

function compactAgentDebugPayload(payload: AgentDebugPayload): AgentDebugPayload {
  return {
    ...payload,
    requestBody: {
      ...payload.requestBody,
      messages: payload.requestBody.messages.map((message) => ({
        ...message,
        content: message.content.length > 6000
          ? `${message.content.slice(0, 6000)}...<truncated for debug storage>`
          : message.content,
      })),
    },
  };
}

async function handleAgentDebug(id: string): Promise<Response> {
  const payload = await readCacheValue<AgentDebugPayload>("agentDebug", id);
  if (!payload) return notFound();
  return json(payload);
}

async function handleModelContext(): Promise<Response> {
  const config = gatewayConfig();
  const modelContext = await resolveModelContextInfo(config, AGENT_MODEL);
  return json({
    model: AGENT_MODEL,
    modelContext,
    cacheTtlMs: MODEL_CONTEXT_CACHE_MS,
  });
}

function agentPromptText(requestBody: ReturnType<typeof chatRequestBody>): string {
  return requestBody.messages
    .map((message, index) =>
      [
        `===== MESSAGE ${
          index + 1
        } / ${requestBody.messages.length}: ${message.role.toUpperCase()} =====`,
        message.content,
      ].join("\n")
    )
    .join("\n\n");
}

async function callChatModel(
  chatUrl: string,
  token: string,
  messages: ChatMessage[],
  stream: boolean,
) {
  const callModel = async (model: string) => {
    const upstream = await fetch(chatUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(chatRequestBody(model, stream, messages)),
    });
    return { upstream, model };
  };

  return await callModel(AGENT_MODEL);
}

async function handleAgent(request: Request): Promise<Response> {
  const parsedBody = agentRequestBody(await request.json().catch(() => null));
  if (parsedBody instanceof Response) return parsedBody;
  const { prompt, rawBody } = parsedBody;

  const [entries, state] = await Promise.all([readScheduleEntries(), readState()]);
  const messages = await buildAgentMessages(prompt, entries, state, rawBody);
  const config = gatewayConfig();
  const modelContext = await resolveModelContextInfo(config, AGENT_MODEL);
  await logAgentContext({
    endpoint: "/api/agent",
    stream: false,
    model: AGENT_MODEL,
    prompt,
    rawBody,
    messages,
    modelContext,
  });

  if (!config.token) {
    return json({ error: { message: "UOS_AI_TOKEN is not configured." } }, { status: 503 });
  }

  let result = await callChatModel(config.chatUrl, config.token, messages, false);
  let responseText = await result.upstream.text();
  let body: unknown = responseText;
  try {
    body = JSON.parse(responseText);
  } catch {
    // Keep raw text.
  }

  if (isModelNotFound(body)) {
    result = await callChatModel(config.chatUrl, config.token, messages, false);
    responseText = await result.upstream.text();
    try {
      body = JSON.parse(responseText);
    } catch {
      body = responseText;
    }
  }

  if (!result.upstream.ok) {
    return json({
      message: fallbackAgentAnswer(prompt, entries),
      actions: [],
      fallback: true,
      gatewayError: body,
      model: result.model,
    }, {
      status: 200,
      headers: copyDebugHeaders(result.upstream.headers),
    });
  }

  const parsed = body as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: unknown;
  };
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return serverError("AI gateway returned an unexpected response shape.", parsed);
  }

  const { visible, actions } = parseProposedActions(content);
  return json({
    message: visible,
    actions,
    model: result.model,
    usage: parsed.usage ?? null,
  }, { headers: copyDebugHeaders(result.upstream.headers) });
}

async function handleAgentStream(request: Request): Promise<Response> {
  const parsedBody = agentRequestBody(await request.json().catch(() => null));
  if (parsedBody instanceof Response) return parsedBody;
  const { prompt, rawBody } = parsedBody;

  const [entries, state] = await Promise.all([readScheduleEntries(), readState()]);
  const messages = await buildAgentMessages(prompt, entries, state, rawBody);
  const config = gatewayConfig();
  const modelContext = await resolveModelContextInfo(config, AGENT_MODEL);
  const debugPayload = await logAgentContext({
    endpoint: "/api/agent/stream",
    stream: true,
    model: AGENT_MODEL,
    prompt,
    rawBody,
    messages,
    modelContext,
  });

  if (!config.token) {
    return json({ error: { message: "UOS_AI_TOKEN is not configured." } }, { status: 503 });
  }

  const result = await callChatModel(config.chatUrl, config.token, messages, true);
  if (!result.upstream.ok || !result.upstream.body) {
    const detail = await result.upstream.text().catch(() => "");
    return streamFallback(prompt, entries, result.model, detail);
  }

  const headers = new Headers(copyDebugHeaders(result.upstream.headers));
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");

  const decoder = new TextDecoder();
  let buffered = "";
  let visible = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse("meta", {
        type: "agent_prompt_debug",
        model: result.model,
        modelContext: debugPayload.modelContext,
        promptText: agentPromptText(debugPayload.requestBody),
        utilization: debugPayload.utilization,
      }));
      const reader = result.upstream.body!.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const chunks = buffered.split(/\r?\n\r?\n/);
          buffered = chunks.pop() ?? "";
          for (const chunk of chunks) {
            for (const line of chunk.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trimStart();
              if (!data || data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) {
                  visible += delta;
                  controller.enqueue(sse("delta", { text: delta }));
                }
              } catch {
                // Ignore malformed SSE fragments.
              }
            }
          }
        }
        const { visible: finalText, actions } = parseProposedActions(visible);
        controller.enqueue(sse("done", { text: finalText, actions, model: result.model }));
        controller.close();
      } catch (error) {
        controller.enqueue(sse("error", {
          message: error instanceof Error ? error.message : "Stream failed.",
        }));
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, { headers });
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamFallback(
  prompt: string,
  entries: ScheduleEntry[],
  model: string,
  detail: unknown,
): Response {
  const text = fallbackAgentAnswer(prompt, entries);
  const words = text.split(/(\s+)/);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse("meta", { model, fallback: true, gatewayError: detail }));
      for (const word of words) {
        controller.enqueue(sse("delta", { text: word }));
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      controller.enqueue(sse("done", { text, actions: [], model, fallback: true }));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

function isModelNotFound(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const maybe = body as { error?: { code?: unknown } };
  return maybe.error?.code === "model_not_found";
}

function copyDebugHeaders(headers: Headers): Headers {
  const result = new Headers();
  for (
    const key of [
      "x-uos-request-id",
      "x-deno-trace-id",
      "x-uos-warning",
      "x-ubq-upstream",
      "x-uos-router-revision",
    ]
  ) {
    const value = headers.get(key);
    if (value) result.set(key, value);
  }
  return result;
}

export async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") return await handleHealth();
    if (request.method === "GET" && url.pathname === "/api/schedule") return await handleSchedule();
    if (request.method === "POST" && url.pathname === "/api/agenda/recalculate") {
      return await handleAgendaRecalculate(request);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/agenda/runs/")) {
      return await handleAgendaRun(
        decodeURIComponent(url.pathname.replace("/api/agenda/runs/", "")),
      );
    }
    if (request.method === "GET" && url.pathname === "/api/cache/routes") {
      return await handleCacheStatus();
    }
    if (request.method === "GET" && url.pathname === "/api/model-context") {
      return await handleModelContext();
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/debug/agent/")) {
      return await handleAgentDebug(
        decodeURIComponent(url.pathname.replace("/api/debug/agent/", "")),
      );
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/api/ics/operational"
    ) {
      return await handleIcs(request.method === "HEAD");
    }
    if (request.method === "POST" && url.pathname === "/api/agent/stream") {
      return await handleAgentStream(request);
    }
    if (request.method === "POST" && url.pathname === "/api/agent") {
      return await handleAgent(request);
    }
    if (request.method === "POST" && url.pathname === "/api/leads/ocr") {
      return await handleLeadOcr(request);
    }
    if (request.method === "POST" && url.pathname === "/api/client-log") {
      return await handleClientLog(request);
    }
    if (request.method === "POST" && url.pathname === "/api/state") {
      return await handleStateAction(request);
    }
    if (request.method === "POST" && url.pathname === "/api/sync/partiful") {
      return await handlePartifulSync(request);
    }
    if (url.pathname === "/api/sync/google") return handleGoogleSyncStatus();
    if (url.pathname.startsWith("/api/")) return notFound();
    if (request.method !== "GET") return notFound();
    return await serveStatic(url.pathname);
  } catch (error) {
    console.error(error);
    return serverError(error instanceof Error ? error.message : "Unknown server error.");
  }
}

if (import.meta.main) {
  console.log(`Tech Week app running on http://localhost:${PORT}`);
  Deno.serve({ port: PORT, hostname: "0.0.0.0" }, router);
}
