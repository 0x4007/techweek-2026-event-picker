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
  buildCallableSnapshot,
  callableResult,
  callPartifulFunction,
  defaultAuthFilePath,
  ensureFreshPartifulAuth,
  parseStoredPartifulAuthJson,
  partifulIdFromUrl,
  type PartifulTarget,
  readStoredPartifulAuth,
  type StoredPartifulAuth,
} from "../scripts/lib/partiful_headless.ts";
import {
  computePartifulSync,
  extractPartifulSnapshotPayloads,
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
  readSharedChat,
  readStateEntry,
  storeHealth,
  writeCacheValue,
  writeSharedChat,
  writeStateValueIfVersion,
} from "./lib/kv_store.ts";
import {
  AccountAuthError,
  accountSessionCookie,
  type AccountSessionState,
  accountSessionState,
  type AccountSessionUser,
  clearAccountSessionCookie,
  consumeAccountSessionHandoff,
  createAccountAgentToken,
  createAccountSessionHandoff,
  finishAccountLogin,
  finishAccountRegistration,
  listAccountAgentTokens,
  loginWithAccountAgentToken,
  logoutAccountSession,
  requireAccountSession as requireStoredAccountSession,
  requireAdminAccountSession as requireStoredAdminAccountSession,
  revokeAccountAgentToken,
  startAccountLogin,
  startAccountRegistration,
} from "./lib/account_auth.ts";

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
const PARTIFUL_AUTH_JSON_ENV = "TECHWEEK_PARTIFUL_AUTH_JSON";
const DEFAULT_PORT = 8788;
const DENO_DEPLOY_DEFAULT_PORT = 8000;
const TIME_ZONE = "America/New_York";
const AGENT_MODEL = "gpt-5.5";
const LOCAL_OCR_TIMEOUT_MS = 7_000;
const LOCAL_OCR_ROTATIONS = [0, 90, 180, 270] as const;
const LOCAL_OCR_HIGH_CONFIDENCE_SCORE = 8;
const TOKEN_ENCODING_NAME = "o200k_base";
const CHAT_MESSAGE_OVERHEAD_TOKENS = 4;
const CHAT_REQUEST_OVERHEAD_TOKENS = 3;
const CHAT_SHARE_MAX_PAYLOAD_BYTES = 64 * 1024;
const MODEL_CONTEXT_CACHE_MS = 5 * 60 * 1000;
const TOKEN_ENCODER = getEncoding(TOKEN_ENCODING_NAME);
const CHAT_SHARE_TEXT_ENCODER = new TextEncoder();
const PRODUCT_PLAYBOOK_CONTEXT_CHAR_BUDGET = 120_000;
const ROUTE_RUNBOOK_CONTEXT_CHAR_BUDGET = 90_000;
const EVENT_DOSSIER_CONTEXT_CHAR_BUDGET = 150_000;
const RANKED_OPPORTUNITY_MAP_CHAR_BUDGET = 190_000;
const RANKED_OPPORTUNITY_MAP_LIMIT = 260;
const ROUTING_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 45;
const PARTIFUL_SYNC_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 120;
const AGENDA_RUN_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const APP_STATE_KEY = "app_state_v1";
const PARTIFUL_AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const PARTIFUL_AUTO_SYNC_LOCK_TTL_MS = 5 * 60 * 1000;
const DENO_DEPLOY_HOSTNAME = "techweek-2026-event-picker.0x4007.deno.net";
const SAME_SITE_APP_HOSTNAME = "techweek.pavlovcik.com";
const SAME_SITE_PROXY_HEADER = "x-techweek-same-site-proxy";
void DENO_DEPLOY_HOSTNAME;
void SAME_SITE_APP_HOSTNAME;
void SAME_SITE_PROXY_HEADER;
const PORT_SCAN_ATTEMPTS = 150;
const INVITE_CODE_LENGTH = 10;
const INVITE_REFERRAL_PENDING_PREFIX = "techweek_invite_referral_";

type InviteReferralEntry = {
  userId: string;
  userHandle: string;
  claimedAt: string;
};

type InviteRecord = {
  ownerUserId: string;
  ownerHandle: string;
  createdAt: string;
  referrals: InviteReferralEntry[];
};

type InvitePayload = {
  code: string;
  shareUrl: string;
  ownerUserId: string;
  ownerHandle: string;
  createdAt: string;
  referrals: InviteReferralEntry[];
};

const LEAD_EXPORT_COLUMNS = [
  "id",
  "createdAt",
  "updatedAt",
  "eventTitle",
  "techweekId",
  "calendarBlockId",
  "name",
  "company",
  "role",
  "email",
  "phone",
  "buyerType",
  "githubHeavy",
  "aiCodingAdoption",
  "painMentioned",
  "strongQuote",
  "priority",
  "followUp",
  "nextStepDate",
  "notes",
  "followUpEmailStatus",
  "followUpEmailTo",
  "followUpEmailSubject",
  "followUpEmailAttemptedAt",
  "followUpEmailSentAt",
  "followUpEmailProviderMessageId",
  "followUpEmailError",
] as const;

function resolvePreferredPort(): number {
  const envPort = Deno.env.get("PORT");
  const parsedPort = Number.parseInt(envPort ?? "", 10);
  if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
    return parsedPort;
  }
  if (isDenoDeployRuntime()) {
    return DENO_DEPLOY_DEFAULT_PORT;
  }
  return DEFAULT_PORT;
}

function isDenoDeployRuntime(): boolean {
  return Boolean(Deno.env.get("DENO_DEPLOY") || Deno.env.get("DENO_DEPLOYMENT_ID"));
}

function findFreePort(startPort: number): number {
  let candidate = startPort;
  const maxPort = Math.min(65_535, startPort + PORT_SCAN_ATTEMPTS - 1);
  for (; candidate <= maxPort; candidate++) {
    try {
      const listener = Deno.listen({ hostname: "0.0.0.0", port: candidate });
      listener.close();
      return candidate;
    } catch (error) {
      if (error instanceof Deno.errors.AddrInUse) continue;
      throw error;
    }
  }
  throw new Error(
    `No free port available in range ${startPort}-${maxPort}. Set PORT explicitly to choose a free port.`,
  );
}
const MANUAL_AGENDA_ROUTE_POINTS = [
  {
    pattern: /\b(?:IBM One Madison|1 Madison Ave)\b/i,
    query: "1 Madison Ave, New York, NY 10010",
    precision: "manual_exact_manhattan",
    lat: 40.7408301,
    lon: -73.9868072,
  },
  {
    pattern: /\b135 Madison Ave\b/i,
    query: "135 Madison Ave, New York, NY",
    precision: "manual_exact_manhattan",
    lat: 40.7459513,
    lon: -73.984086,
  },
  {
    pattern: /\b1155\s+6th\s+Ave\b/i,
    query: "1155 6th Ave, New York, NY 10036",
    precision: "manual_exact_manhattan",
    lat: 40.7564611,
    lon: -73.9831996,
  },
  {
    pattern: /\b620\s+(?:8th|Eighth)\s+Ave\b/i,
    query: "620 8th Ave, New York, NY 10018",
    precision: "manual_exact_manhattan",
    lat: 40.756326,
    lon: -73.990245,
  },
  {
    pattern: /\b(?:Pho Dragon|47 W 14th St)\b/i,
    query: "47 W 14th St, New York, NY 10011",
    precision: "manual_exact_manhattan",
    lat: 40.737108,
    lon: -73.9958546,
  },
  {
    pattern: /\b(?:Delancey St Essex|Lower East Side)\b/i,
    query: "Delancey St Essex St, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.7186182,
    lon: -73.9881357,
  },
  {
    pattern: /\bBryant Park\b|\bMidtown\b/i,
    query: "Bryant Park, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.7537509,
    lon: -73.9835428,
  },
  {
    pattern: /\bSpring St(?:reet)? and Broadway\b|\bSoHo\b/i,
    query: "Spring St and Broadway, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.724329,
    lon: -73.997702,
  },
  {
    pattern: /\b23rd Street and 8th Avenue\b|\bChelsea\b/i,
    query: "23rd Street and 8th Avenue, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.744081,
    lon: -73.999562,
  },
  {
    pattern: /\b28th Street and Broadway\b|\bNomad\b/i,
    query: "28th Street and Broadway, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.7458,
    lon: -73.9888,
  },
  {
    pattern: /\bAstor Place\b|\bEast Village\b/i,
    query: "Astor Place, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.7298497,
    lon: -73.9913897,
  },
  {
    pattern: /\b(?:Union Square|201 Park Ave S)\b/i,
    query: "Union Square, Manhattan, New York, NY",
    precision: "manual_neighborhood",
    lat: 40.735736,
    lon: -73.990568,
  },
  {
    pattern: /\bBarclays Center\b|\bBrooklyn\b/i,
    query: "Barclays Center, Brooklyn, NY",
    precision: "manual_neighborhood",
    lat: 40.682511,
    lon: -73.975252,
  },
] as const;
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
    label: "Agenda preference profile prompt",
    url: new URL("./prompts/agenda-preferences.md", import.meta.url),
    maxChars: 12_000,
  },
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

export function resetModelContextCacheForTest(): void {
  modelContextCache = null;
}

type CsvRow = Record<string, string>;

export type ScheduleEntry = {
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

type LeadSignal = "yes" | "no" | "unknown";

type LeadPriorityQualification = {
  role?: unknown;
  buyerType?: unknown;
  githubHeavy?: unknown;
  aiCodingAdoption?: unknown;
  painMentioned?: unknown;
  strongQuote?: unknown;
  followUp?: unknown;
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
  buyerType: string;
  githubHeavy: LeadSignal;
  aiCodingAdoption: LeadSignal;
  painMentioned: string;
  strongQuote: string;
  notes: string;
  priority: "A" | "B" | "C";
  followUp: string;
  nextStepDate: string;
  ocr?: OcrDraftMetadata;
  followUpEmail: LeadFollowUpEmail | null;
  createdAt: string;
  updatedAt: string;
};

type OcrDraftMetadata = {
  ocrSource?: string;
  attemptIndex?: number;
  outputWidth?: number;
  outputHeight?: number;
  dataUrlCharacters?: number;
  localOcrUsed?: boolean;
  localOcrMeanConfidence?: number;
};

type AppState = {
  version: 1;
  updatedAt: string;
  eventNotes: Record<string, EventNote>;
  leads: Lead[];
  dismissedBlocks: string[];
  activeAgendaRunId: string;
  partifulAutoSync: PartifulAutoSyncState;
  inviteCodeByUserId: Record<string, string>;
  inviteByCode: Record<string, InviteRecord>;
};

type PartifulAutoSyncState = {
  status: "idle" | "running" | "completed" | "failed";
  lastStartedAt: string;
  lastCompletedAt: string;
  lastRunId: string;
  lastAgendaRunId: string;
  lastError: string;
  nextAllowedAt: string;
};

type StoredPartifulEvent = {
  syncedAt: string;
  normalizedEvent: NormalizedPartifulEvent;
  mergedEvent: PartifulMergedEvent<Record<string, unknown>>;
  statusChanged: boolean;
  matchedBy: string;
};

type StoredPartifulEventRecord = {
  cacheId: string;
  syncedAt: string;
  updatedAt: string;
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
  type: "event_note";
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

type SharedChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SharedChatPayload = {
  shareId: string;
  createdAt: string;
  createdByUserId: string;
  title: string;
  messages: SharedChatMessage[];
  messageCount: number;
  deletedAt?: string;
  deletedByUserId?: string;
};

const CHAT_SHARE_ID_PATTERN = /^[0-9a-f]{32}$/;

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
  reasoning_effort?: string;
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
  buyerType: string;
  githubHeavy: LeadSignal;
  aiCodingAdoption: LeadSignal;
  painMentioned: string;
  strongQuote: string;
  nextStepDate: string;
  notes: string;
  followUp: string;
  ocr?: OcrDraftMetadata;
};

type LocalOcrOrientation = {
  imageDataUrl: string;
  raw: string;
  score: number;
  rotation: number;
  meanConfidence: number;
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
  userFocus?: {
    view?: unknown;
    viewLabel?: unknown;
    dayKey?: unknown;
    weekday?: unknown;
    date?: unknown;
    hash?: unknown;
  };
  viewport?: {
    width?: unknown;
    height?: unknown;
    devicePixelRatio?: unknown;
  };
};

let accountSessionForTest: AccountSessionState | undefined;
let stateMutationQueue: Promise<unknown> = Promise.resolve();

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
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function normalizeApiPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function setAccountSessionForTest(
  session: AccountSessionState | null | undefined,
): void {
  accountSessionForTest = session === undefined
    ? undefined
    : session ?? { authenticated: false, auth: "passkey" };
}

async function handleAccountSession(request: Request): Promise<Response> {
  const session = await readAccountSession(request);
  return json({ session });
}

async function requireAdminAccountSession(request: Request): Promise<Response | null> {
  try {
    if (accountSessionForTest !== undefined) {
      const session = await readAccountSession(request);
      if (!session.authenticated) {
        return json({ error: { message: "Authentication required." } }, { status: 401 });
      }
      if (session.user?.isAdmin !== true) {
        return json({ error: { message: "Admin access required." } }, { status: 403 });
      }
      return null;
    }
    await requireStoredAdminAccountSession(request);
  } catch (error) {
    if (error instanceof AccountAuthError) {
      return json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
  return null;
}

async function authorizeApiRoute(request: Request, url: URL): Promise<Response | null> {
  const pathname = normalizeApiPath(url.pathname);
  if (!url.pathname.startsWith("/api/")) return null;
  if (request.method === "GET" && url.pathname === "/api/health") return null;
  if (pathname.startsWith("/api/auth/")) return null;
  if (request.method === "GET" && pathname === "/api/account/session") return null;
  if (request.method === "GET" && pathname === "/api/account/invite") return null;
  if (request.method === "POST" && pathname === "/api/account/session/handoff") return null;
  if (request.method === "POST" && pathname === "/api/account/invite") return null;
  if (request.method === "POST" && pathname === "/api/chat/share") return null;
  if (request.method === "GET" && pathname.startsWith("/api/chat/share/")) return null;
  if (request.method === "DELETE" && pathname.startsWith("/api/chat/share/")) return null;
  return await requireAdminAccountSession(request);
}

function createSharedChatId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function isValidSharedChatId(shareId: string): boolean {
  return CHAT_SHARE_ID_PATTERN.test(shareId);
}

function normalizeSharedChatId(rawShareId: string): string | null {
  let shareId = "";
  try {
    shareId = decodeURIComponent(rawShareId).toLowerCase();
  } catch {
    return null;
  }
  return isValidSharedChatId(shareId) ? shareId : null;
}

function isSoftDeletedSharedChat(
  payload: SharedChatPayload,
): payload is SharedChatPayload & { deletedAt: string } {
  return typeof payload.deletedAt === "string" && payload.deletedAt.length > 0;
}

function parseSharedChatSnapshot(
  rawBody: unknown,
): { title: string; messages: SharedChatMessage[] } | Response {
  if (!rawBody || typeof rawBody !== "object") return badRequest("Expected a JSON body.");
  const raw = rawBody as Record<string, unknown>;
  const rawMessages = raw.messages;
  if (!Array.isArray(rawMessages)) return badRequest("messages is required and must be an array.");
  if (rawMessages.length === 0) return badRequest("At least one message is required.");

  const messages: SharedChatMessage[] = [];
  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== "object") {
      return badRequest("Each message must be an object.");
    }
    const role = (rawMessage as { role?: unknown }).role;
    const normalizedRole = role === "user" || role === "assistant" ? role : null;
    if (!normalizedRole) {
      return badRequest("Each message role must be user or assistant.");
    }

    const content = String((rawMessage as { content?: unknown }).content ?? "").trim();
    if (!content) {
      return badRequest("Each message must include non-empty content.");
    }

    messages.push({ role: normalizedRole, content });
  }

  if (!messages.length) return badRequest("At least one message is required.");
  return { title: sharedChatTitle(raw.title, messages), messages };
}

function sharedChatTitle(rawTitle: unknown, messages: SharedChatMessage[]): string {
  const title = textField(rawTitle, 240);
  if (title) return title;
  const firstUser = messages.find((message) => message.role === "user")?.content;
  const firstAssistant = messages.find((message) => message.role === "assistant")?.content;
  return textField(firstUser || firstAssistant || "Shared chat", 240);
}

async function handleChatShareCreate(request: Request): Promise<Response> {
  const authError = await requireAuthenticatedAccountSession(request);
  if (authError) return authError;
  const session = await readAccountSession(request);
  const user = session.user;
  if (!user) return json({ error: { message: "Account user unavailable." } }, { status: 401 });

  const parsedBody = parseSharedChatSnapshot(await request.json().catch(() => null));
  if (parsedBody instanceof Response) return parsedBody;

  const shareId = createSharedChatId();
  const payload: SharedChatPayload = {
    shareId,
    createdAt: new Date().toISOString(),
    createdByUserId: user.id,
    title: parsedBody.title,
    messages: parsedBody.messages,
    messageCount: parsedBody.messages.length,
  };

  const payloadBytes = CHAT_SHARE_TEXT_ENCODER.encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > CHAT_SHARE_MAX_PAYLOAD_BYTES) {
    return json({
      error: {
        message:
          "This chat snapshot is too large to share. Please shorten or trim the chat before sharing.",
      },
    }, { status: 413 });
  }

  await writeSharedChat(shareId, payload);
  return json({ shareId });
}

async function handleChatShareGet(rawShareId: string): Promise<Response> {
  const shareId = normalizeSharedChatId(rawShareId);
  if (!shareId) return notFound();

  const payload = await readSharedChat<SharedChatPayload>(shareId);
  if (!payload || isSoftDeletedSharedChat(payload)) return notFound();
  return json(payload);
}

async function handleChatShareDelete(request: Request, rawShareId: string): Promise<Response> {
  const authError = await requireAuthenticatedAccountSession(request);
  if (authError) return authError;
  const shareId = normalizeSharedChatId(rawShareId);
  if (!shareId) return notFound();

  const session = await readAccountSession(request);
  const user = session.user;
  if (!user) return json({ error: { message: "Account user unavailable." } }, { status: 401 });

  const payload = await readSharedChat<SharedChatPayload>(shareId);
  if (!payload || isSoftDeletedSharedChat(payload)) return notFound();
  if (payload.createdByUserId !== user.id) {
    return json({ error: { message: "Only the share creator can delete this chat." } }, {
      status: 403,
    });
  }

  const updatedPayload: SharedChatPayload = {
    ...payload,
    deletedAt: new Date().toISOString(),
    deletedByUserId: user.id,
    title: "",
    messages: [],
  };
  await writeSharedChat(shareId, updatedPayload);
  return new Response(null, { status: 204 });
}

async function handleAccountSessionHandoff(request: Request): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const body = recordValue(raw);
  const handoffToken = textField(body?.handoffToken, 2000);
  if (!handoffToken) return badRequest("handoffToken is required.");

  const targetOrigin = requestOrigin(request);
  const result = await consumeAccountSessionHandoff(request, handoffToken, targetOrigin);
  const session = result.session;

  const referralCode = normalizeInviteCode(textField(raw?.referralCode, 120));
  if (referralCode) {
    await claimReferralWithSessionReferralCode(
      session.user?.id || "",
      session.user?.handle || "",
      referralCode,
    );
  }

  return json({ session }, {
    headers: {
      "set-cookie": accountSessionCookie(result.sessionToken, session.expiresAt, request),
    },
  });
}

async function handleAuthRegisterStart(request: Request): Promise<Response> {
  return json(await startAccountRegistration(request));
}

async function handleAuthRegisterFinish(request: Request): Promise<Response> {
  const result = await finishAccountRegistration(request);
  return authFinishResponse(result, request);
}

async function handleAuthLoginStart(request: Request): Promise<Response> {
  return json(await startAccountLogin(request));
}

async function handleAuthLoginFinish(request: Request): Promise<Response> {
  const result = await finishAccountLogin(request);
  return authFinishResponse(result, request);
}

async function handleAuthAgentTokenLogin(request: Request): Promise<Response> {
  const result = await loginWithAccountAgentToken(request);
  return authFinishResponse(result, request);
}

async function handleAuthLogout(request: Request): Promise<Response> {
  await logoutAccountSession(request);
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearAccountSessionCookie(request) },
  });
}

async function handleAuthHandoff(request: Request): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const body = recordValue(raw);
  const targetOrigin = textField(body?.embedOrigin, 500) || textField(body?.origin, 500);
  return json(await createAccountSessionHandoff(request, targetOrigin));
}

async function handleAccountAgentTokensGet(): Promise<Response> {
  return json({ tokens: await listAccountAgentTokens() });
}

async function handleAccountAgentTokensPost(request: Request): Promise<Response> {
  const session = await readAccountSession(request);
  const user = session.user;
  if (!session.authenticated || user?.isAdmin !== true) {
    return json({ error: { message: "Admin access required." } }, { status: 403 });
  }
  return json(await createAccountAgentToken(request, user), { status: 201 });
}

async function handleAccountAgentTokenDelete(tokenId: string): Promise<Response> {
  const revoked = await revokeAccountAgentToken(tokenId);
  return revoked ? new Response(null, { status: 204 }) : notFound();
}

function authFinishResponse(
  result: { session: AccountSessionState; sessionToken: string; expiresAt?: string },
  request: Request,
): Response {
  return json({ session: result.session }, {
    headers: {
      "set-cookie": accountSessionCookie(result.sessionToken, result.expiresAt, request),
    },
  });
}

async function claimReferralWithSessionReferralCode(
  ownerUserId: string,
  ownerHandle: string,
  referralCode: string,
): Promise<void> {
  if (!ownerUserId || !referralCode) return;
  await claimReferralByCode(
    ownerUserId,
    ownerHandle || "Unknown",
    normalizeInviteCode(referralCode),
  );
}

async function requireAuthenticatedAccountSession(request: Request): Promise<Response | null> {
  try {
    if (accountSessionForTest !== undefined) {
      const session = await readAccountSession(request);
      if (!session.authenticated) {
        return json({ error: { message: "Authentication required." } }, { status: 401 });
      }
      return null;
    }
    await requireStoredAccountSession(request);
  } catch (error) {
    if (error instanceof AccountAuthError) {
      return json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
  return null;
}

async function handleAccountInviteGet(request: Request): Promise<Response> {
  const authError = await requireAuthenticatedAccountSession(request);
  if (authError) return authError;
  const session = await readAccountSession(request);
  const user = session.user;
  if (!user) return json({ error: { message: "Account user unavailable." } }, { status: 401 });

  const payload = await buildAccountInvitePayload(request, user);
  return json({ invite: payload });
}

async function handleAccountInviteClaim(request: Request): Promise<Response> {
  const authError = await requireAuthenticatedAccountSession(request);
  if (authError) return authError;
  const session = await readAccountSession(request);
  const user = session.user;
  if (!user) return json({ error: { message: "Account user unavailable." } }, { status: 401 });

  const body = await request.json().catch(() => null);
  const rawReferral = recordValue(body);
  const referralCode = normalizeInviteCode(textField(rawReferral?.referralCode, 120));

  let claimed = false;
  if (referralCode) {
    const result = await claimReferralByCode(user.id, user.handle || "Unknown", referralCode);
    if (result.errorMessage) {
      return json({ error: { message: result.errorMessage } }, { status: 400 });
    }
    claimed = result.claimed;
  }
  const payload = await buildAccountInvitePayload(request, user);
  return json({ invite: payload, claimed });
}

async function claimReferralByCode(
  userId: string,
  userHandle: string,
  referralCode: string,
): Promise<{ claimed: boolean; errorMessage?: string }> {
  const code = normalizeInviteCode(referralCode);
  if (!code) return { claimed: false, errorMessage: "Invalid referral code." };
  return await mutateState(async (state, commit) => {
    const inviter = state.inviteByCode[code];
    if (!inviter) return { claimed: false, errorMessage: "Invalid referral code." };
    if (inviter.ownerUserId === userId) {
      return { claimed: false, errorMessage: "" };
    }
    if (inviter.referrals.some((entry) => entry.userId === userId)) {
      return { claimed: false, errorMessage: "" };
    }
    inviter.referrals.push({
      userId,
      userHandle: userHandle || "Unknown",
      claimedAt: new Date().toISOString(),
    });
    await commit(state);
    return { claimed: true };
  });
}

async function buildAccountInvitePayload(
  request: Request,
  user: AccountSessionUser,
): Promise<InvitePayload> {
  const code = await upsertInviteRecordForUser(user);
  const state = await readState();
  const record = state.inviteByCode[code];
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("ref", code);
  return {
    code,
    shareUrl: url.toString(),
    ownerUserId: user.id,
    ownerHandle: user.handle,
    createdAt: record?.createdAt || new Date().toISOString(),
    referrals: [...(record?.referrals || [])],
  };
}

async function upsertInviteRecordForUser(user: AccountSessionUser): Promise<string> {
  const code = await ensureInviteCodeForUser(user);
  await setInviteCodeForUser(user.id, code, user.handle || "Unknown");
  return code;
}

function normalizeInviteCode(value: string): string {
  const normalized = textField(value, 120)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized.slice(0, INVITE_CODE_LENGTH);
}

async function ensureInviteCodeForUser(user: AccountSessionUser): Promise<string> {
  const existing = await getInviteCodeByUser(user.id);
  if (existing) return existing;

  let counter = 0;
  const seedParts = [user.id, user.handle || "", INVITE_REFERRAL_PENDING_PREFIX];
  while (counter < 20) {
    const seed = `${seedParts.join("|")}|${counter}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    const hex = Array.from(new Uint8Array(digest)).map((value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
    const code = normalizeInviteCode(hex);
    const conflict = (await readState()).inviteByCode[code]?.ownerUserId;
    if (!conflict) {
      await setInviteCodeForUser(user.id, code, user.handle || "");
      return code;
    }
    if (conflict === user.id) return code;
    counter += 1;
  }

  const random = Math.random().toString(36).slice(2).toUpperCase();
  const fallbackCode = normalizeInviteCode(`F${random}`);
  await setInviteCodeForUser(user.id, fallbackCode, user.handle || "");
  return fallbackCode || await ensureInviteCodeForUser(user);
}

async function getInviteCodeByUser(userId: string): Promise<string> {
  const state = await readState();
  const code = normalizeInviteCode(state.inviteCodeByUserId[userId] || "");
  if (!code) return "";
  if (state.inviteByCode[code]?.ownerUserId !== userId) {
    return "";
  }
  return code;
}

async function setInviteCodeForUser(userId: string, code: string, handle: string): Promise<void> {
  await mutateState(async (state, commit) => {
    const owner = state.inviteByCode[code];
    if (owner && owner.ownerUserId !== userId) {
      return;
    }
    state.inviteCodeByUserId[userId] = code;
    if (!state.inviteByCode[code]) {
      state.inviteByCode[code] = {
        ownerUserId: userId,
        ownerHandle: handle || "Unknown",
        createdAt: new Date().toISOString(),
        referrals: [],
      };
    }
    state.inviteByCode[code].ownerHandle = handle || "Unknown";
    await commit(state);
    return;
  });
}

async function readAccountSession(request: Request): Promise<AccountSessionState> {
  if (accountSessionForTest !== undefined) {
    if (!request.headers.get("cookie")?.includes("techweek_session=")) {
      return { authenticated: false, auth: "passkey" };
    }
    return accountSessionForTest;
  }
  return await accountSessionState(request);
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
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

async function serveStatic(pathname: string, method = "GET"): Promise<Response> {
  const path = normalizePath(pathname);
  const fileUrl = new URL(path, STATIC_DIR);
  if (!fileUrl.href.startsWith(STATIC_DIR.href)) return notFound();

  try {
    const info = await Deno.stat(fileUrl);
    if (!info.isFile) return notFound();
    const modifiedMs = info.mtime?.getTime() ?? 0;
    const version = `"${info.size.toString(36)}-${modifiedMs.toString(36)}"`;
    const headers = new Headers({
      "content-type": contentType(path),
      "cache-control": "no-store, max-age=0",
      "content-length": String(info.size),
      "etag": version,
      "x-static-version": version,
    });
    if (info.mtime) headers.set("last-modified", info.mtime.toUTCString());
    if (method === "HEAD") {
      return new Response(null, { headers });
    }

    const file = await Deno.readFile(fileUrl);
    return new Response(file, {
      headers,
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound && !pathname.includes(".")) {
      return serveStatic("/", method);
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

export function statusLabelForScheduleStatus(status: string, fallback = ""): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return fallback;
  if (
    normalized === "registered" || normalized === "going" || normalized === "approved" ||
    normalized === "accepted"
  ) {
    return "REG";
  }
  if (
    normalized === "applied" || normalized.includes("pending") || normalized.includes("applied")
  ) {
    return "PENDING";
  }
  if (normalized === "waitlisted" || normalized.includes("waitlist")) return "WAITLIST";
  return fallback || normalized.toUpperCase();
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

async function readAgendaCandidateEntries(): Promise<ScheduleEntry[]> {
  const [entries, partifulEvents] = await Promise.all([
    readScheduleEntries(),
    readStoredPartifulEvents(),
  ]);
  return mergeDiscoveredPartifulEntries(entries, partifulEvents);
}

function mergeDiscoveredPartifulEntries(
  entries: ScheduleEntry[],
  partifulEvents: StoredPartifulEventRecord[],
): ScheduleEntry[] {
  const existingIds = new Set(entries.map((entry) => entry.partifulId).filter(Boolean));
  const discovered = partifulEvents.flatMap((record) => {
    const event = record.normalizedEvent;
    if (!event.partifulId || existingIds.has(event.partifulId)) return [];
    const entry = scheduleEntryFromDiscoveredPartifulEvent(event);
    return entry ? [entry] : [];
  });
  return [...entries, ...discovered].sort((a, b) => a.startEpochMs - b.startEpochMs);
}

function scheduleEntryFromDiscoveredPartifulEvent(
  event: NormalizedPartifulEvent,
): ScheduleEntry | null {
  const start = localDateTimeFromIso(event.startAt);
  const end = localDateTimeFromIso(event.endAt) || fallbackEndTime(start);
  if (!start || !isConferenceWindow(start, event.title)) return null;
  const dayKey = start.slice(0, 10);
  const venue = event.venue;
  const title = stripHashTechWeek(event.title || `Partiful ${event.partifulId}`);
  const workFit = discoveredPartifulWorkFit(event);
  const opportunityScore = String(Math.max(0, Math.min(100, 45 + workFit)));
  return {
    calendar: "reference",
    techweekId: "",
    calendarBlockId: `PF-${event.partifulId}-REFERENCE`,
    partifulId: event.partifulId,
    rerankId: "",
    entryType: "event",
    blockType: "event",
    status: event.status,
    category: "discovered",
    start,
    end,
    actualStart: start,
    actualEnd: end,
    startEpochMs: parseLocalDateTime(start),
    endEpochMs: parseLocalDateTime(end),
    actualStartEpochMs: parseLocalDateTime(start),
    actualEndEpochMs: parseLocalDateTime(end),
    dayKey,
    weekday: formatWeekday(dayKey),
    timeRange: formatTimeRange(start, end),
    title,
    displayTitle: title,
    statusLabel: statusLabelForScheduleStatus(event.status),
    location: venue?.address || venue?.label || "New York, NY",
    venueQuery: venue?.address || venue?.label || "New York, NY",
    venuePrecision: venue?.precision || "unknown",
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    transitRisk: "",
    note: [
      "Discovered from live Partiful account sync.",
      event.description ? `Description: ${event.description}` : "",
    ].filter(Boolean).join(" "),
    salesCoaching: discoveredPartifulSalesCoaching(event, workFit),
    rank: "999",
    tier: workFit >= 45 ? "B" : "C",
    opportunityScore,
    eventUrl: event.eventUrl,
    googleMapsUrl: venue?.googleMapsUrl || "",
  };
}

function discoveredPartifulSalesCoaching(
  event: NormalizedPartifulEvent,
  workFit: number,
): string {
  const quality = workFit >= 45 ? "high-fit discovered Partiful event" : "low-confidence discovery";
  return [
    `Partiful discovery: ${quality}.`,
    "Evaluate the room for engineering leaders, founders, DevEx/platform teams, AI builders, and operators before redirecting the agenda.",
    event.description ? `Host description: ${event.description}` : "",
  ].filter(Boolean).join("\n");
}

function discoveredPartifulWorkFit(event: NormalizedPartifulEvent): number {
  const text = `${event.title} ${event.description}`.toLowerCase();
  const positives = [
    /engineering|developer|devex|platform|infrastructure|infra/,
    /cto|tech leader|vp engineering|head of engineering/,
    /open[ -]?source|github|maintainer|codebase/,
    /\bai\b|agent|mcp|llm|coding/,
    /enterprise|b2b|founder|operator|startup/,
    /api|workflow|automation|security|data/,
  ];
  const negatives = [
    /birthday|graduation|housewarming|wedding/,
    /fashion|beauty|dating|consumer social/,
    /wellness|fitness|yoga|run club/,
  ];
  const positive = positives.reduce((sum, pattern) => sum + (pattern.test(text) ? 12 : 0), 0);
  const negative = negatives.reduce((sum, pattern) => sum + (pattern.test(text) ? 30 : 0), 0);
  return Math.max(-45, Math.min(55, positive - negative));
}

function isConferenceWindow(localStart: string, title: string): boolean {
  const day = localStart.slice(0, 10);
  return (day >= "2026-06-01" && day <= "2026-06-07") || /#?nytechweek/i.test(title);
}

function localDateTimeFromIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return formatLocalDateTimeForSchedule(parsed);
}

function fallbackEndTime(start: string): string {
  const parsed = parseLocalDateTime(start);
  if (!Number.isFinite(parsed)) return "";
  return formatLocalDateTimeForSchedule(parsed + 90 * 60 * 1000);
}

function formatLocalDateTimeForSchedule(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function stripHashTechWeek(value: string): string {
  return value.replace(/\s*[-–—]?\s*#NYTechWeek\b/gi, "").trim();
}

function emptyState(): AppState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    eventNotes: {},
    leads: [],
    dismissedBlocks: [],
    activeAgendaRunId: "",
    partifulAutoSync: emptyPartifulAutoSyncState(),
    inviteCodeByUserId: {},
    inviteByCode: {},
  };
}

function emptyPartifulAutoSyncState(): PartifulAutoSyncState {
  return {
    status: "idle",
    lastStartedAt: "",
    lastCompletedAt: "",
    lastRunId: "",
    lastAgendaRunId: "",
    lastError: "",
    nextAllowedAt: "",
  };
}

function normalizeLeadPriority(value: unknown): Lead["priority"] {
  return value === "A" || value === "C" ? value : "B";
}

function normalizeLeadSignal(value: unknown): LeadSignal {
  const normalized = String(value || "unknown").trim().toLowerCase();
  if (normalized === "yes" || normalized === "no") return normalized;
  return "unknown";
}

function normalizeLeadNextStepDate(value: unknown): string {
  const normalized = textField(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

export function deriveLeadPriorityFromEvent(
  entry: Pick<ScheduleEntry, "tier" | "opportunityScore" | "rank">,
): "A" | "B" | "C" {
  const tier = String(entry.tier || "").trim().toUpperCase();
  if (tier === "S" || tier === "A") return "A";
  if (tier === "B") return "B";
  if (tier === "C") return "C";

  const score = Number.parseFloat(String(entry.opportunityScore || ""));
  if (Number.isFinite(score)) {
    if (score >= 60) return "A";
    if (score >= 40) return "B";
    return "C";
  }

  const rank = Number.parseInt(String(entry.rank || ""), 10);
  if (Number.isFinite(rank)) {
    if (rank <= 40) return "A";
    if (rank <= 150) return "B";
    return "C";
  }

  return "B";
}

export function deriveLeadPriorityForLead(
  entry: Pick<ScheduleEntry, "tier" | "opportunityScore" | "rank">,
  qualification: LeadPriorityQualification = {},
): "A" | "B" | "C" {
  const eventPriority = deriveLeadPriorityFromEvent(entry);
  let score = eventPriority === "A" ? 2 : eventPriority === "B" ? 1 : 0;

  const buyerType = textField(qualification.buyerType, 120).toLowerCase();
  const role = textField(qualification.role, 180).toLowerCase();
  const buyerAndRole = `${buyerType} ${role}`;
  if (
    /engineering leader|cto|vp eng|head of engineering|platform|devex|oss|devrel|maintainer|founder|operator/
      .test(buyerAndRole)
  ) {
    score += 2;
  } else if (/ic builder|builder|engineer|developer/.test(buyerAndRole)) {
    score += 1;
  } else if (/investor|advisor|gtm|sales|marketing|other/.test(buyerType)) {
    score -= 1;
  }

  const githubHeavy = normalizeLeadSignal(qualification.githubHeavy);
  const aiCodingAdoption = normalizeLeadSignal(qualification.aiCodingAdoption);
  if (githubHeavy === "yes") score += 1;
  if (githubHeavy === "no") score -= 1;
  if (aiCodingAdoption === "yes") score += 1;
  if (aiCodingAdoption === "no") score -= 1;

  if (textField(qualification.painMentioned, 1000)) score += 1;
  if (textField(qualification.strongQuote, 800)) score += 1;
  if (textField(qualification.followUp, 300)) score += 1;

  if (score >= 4) return "A";
  if (score >= 2) return "B";
  return "C";
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

function normalizeLeadOcrMetadata(value: unknown): OcrDraftMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const ocrSource = normalizeOcrContactField(raw.ocrSource, 120);
  const attemptIndex = normalizeOcrInteger(raw.attemptIndex);
  const outputWidth = normalizeOcrInteger(raw.outputWidth);
  const outputHeight = normalizeOcrInteger(raw.outputHeight);
  const dataUrlCharacters = normalizeOcrInteger(raw.dataUrlCharacters);
  const localOcrUsed = raw.localOcrUsed === true || raw.localOcrUsed === "true";
  const localOcrMeanConfidence = Number.isFinite(Number(raw.localOcrMeanConfidence))
    ? Number(raw.localOcrMeanConfidence)
    : undefined;
  const normalized = {
    ocrSource: ocrSource || undefined,
    attemptIndex,
    outputWidth,
    outputHeight,
    dataUrlCharacters,
    localOcrUsed: localOcrUsed || undefined,
    localOcrMeanConfidence: Number.isFinite(localOcrMeanConfidence)
      ? Math.round(localOcrMeanConfidence as number)
      : undefined,
  };
  if (
    normalized.ocrSource || normalized.attemptIndex !== undefined ||
    normalized.outputWidth !== undefined || normalized.outputHeight !== undefined ||
    normalized.dataUrlCharacters !== undefined || normalized.localOcrUsed !== undefined ||
    normalized.localOcrMeanConfidence !== undefined
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeOcrInteger(value: unknown): number | undefined {
  if (!Number.isFinite(Number(value))) return undefined;
  return Math.max(0, Math.round(Number(value)));
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
        buyerType: textField(lead.buyerType, 120),
        githubHeavy: normalizeLeadSignal(lead.githubHeavy),
        aiCodingAdoption: normalizeLeadSignal(lead.aiCodingAdoption),
        painMentioned: textField(lead.painMentioned, 1200),
        strongQuote: textField(lead.strongQuote, 900),
        notes: textField(lead.notes, 2400),
        ocr: normalizeLeadOcrMetadata(lead.ocr),
        priority: normalizeLeadPriority(lead.priority),
        followUp: textField(lead.followUp, 300),
        nextStepDate: normalizeLeadNextStepDate(lead.nextStepDate),
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

function normalizeOcrPlaceholder(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || [
      "na",
      "n/a",
      "none",
      "no",
      "nil",
      "n/a.",
      "not provided",
      "unknown",
      "-",
    ].includes(normalized)
    ? ""
    : value.trim();
}

function normalizeOcrContactField(value: unknown, maxLength = 320): string {
  return normalizeOcrPlaceholder(textField(value, maxLength));
}

function normalizeOcrEmail(value: unknown): string {
  const compact = normalizeOcrContactField(value, 320)
    .replace(/^(?:e-?mail|email)\s*[:=\-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([@.])\s*/g, "$1")
    .trim();
  return extractEmailAddress(compact).toLowerCase();
}

function normalizeOcrPhone(value: unknown): string {
  const compact = normalizeOcrContactField(value, 120)
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  const match = compact.match(/(?:ext|x|extension)\s*:?\s*(\d{1,6})/i);
  const extension = match?.[1] ? ` ext ${match[1]}` : "";
  const digits = compact.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}${extension}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}${extension}`;
  }
  return `+${digits}${extension}`.trim();
}

function positiveIntegerField(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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

type AppStateSnapshot = {
  state: AppState;
  versionstamp: string | null;
};

class StateWriteConflictError extends Error {
  constructor() {
    super("App state changed before the mutation could be committed.");
    this.name = "StateWriteConflictError";
  }
}

async function readState(): Promise<AppState> {
  return (await readStateSnapshot()).state;
}

async function readStateSnapshot(): Promise<AppStateSnapshot> {
  const parsed = await readStateEntry<Partial<AppState>>(APP_STATE_KEY);
  return {
    state: normalizeAppState(parsed.value),
    versionstamp: parsed.versionstamp,
  };
}

function normalizeAppState(parsed: Partial<AppState> | null): AppState {
  if (!parsed) return emptyState();
  return {
    version: 1,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    eventNotes: parsed.eventNotes ?? {},
    leads: normalizeLeads(parsed.leads),
    dismissedBlocks: parsed.dismissedBlocks ?? [],
    activeAgendaRunId: String(parsed.activeAgendaRunId ?? ""),
    partifulAutoSync: normalizePartifulAutoSync(parsed.partifulAutoSync),
    inviteCodeByUserId: normalizeInviteCodeByUserId(parsed.inviteCodeByUserId),
    inviteByCode: normalizeInviteByCode(parsed.inviteByCode),
  };
}

function normalizeInviteCodeByUserId(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [userId, code] of Object.entries(value)) {
    const normalizedUserId = textField(userId, 160);
    const normalizedCode = normalizeInviteCode(textField(code, 120));
    if (normalizedUserId && normalizedCode) {
      output[normalizedUserId] = normalizedCode;
    }
  }
  return output;
}

function normalizeInviteByCode(value: unknown): Record<string, InviteRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, InviteRecord> = {};
  for (const [code, record] of Object.entries(value)) {
    const normalizedCode = normalizeInviteCode(code);
    if (!normalizedCode) continue;
    const normalizedRecord = normalizeInviteRecord(record);
    if (normalizedRecord.ownerUserId) {
      output[normalizedCode] = normalizedRecord;
    }
  }
  return output;
}

function normalizeInviteRecord(value: unknown): InviteRecord {
  const raw = recordValue(value);
  const ownerUserId = textField(raw?.ownerUserId, 160);
  if (!ownerUserId) {
    return {
      ownerUserId: "",
      ownerHandle: "",
      createdAt: new Date().toISOString(),
      referrals: [],
    };
  }
  const referrals = Array.isArray(raw?.referrals)
    ? raw.referrals
      .map(normalizeInviteReferralEntry)
      .filter((entry) => Boolean(entry.userId && entry.userHandle))
    : [];
  return {
    ownerUserId,
    ownerHandle: textField(raw?.ownerHandle, 120),
    createdAt: textField(raw?.createdAt, 80) || new Date().toISOString(),
    referrals,
  };
}

function normalizeInviteReferralEntry(value: unknown): InviteReferralEntry {
  const raw = recordValue(value);
  return {
    userId: textField(raw?.userId, 160),
    userHandle: textField(raw?.userHandle, 120),
    claimedAt: textField(raw?.claimedAt, 80),
  };
}

async function writeStateIfUnchanged(
  state: AppState,
  versionstamp: string | null,
): Promise<AppState> {
  state.updatedAt = new Date().toISOString();
  const nextVersionstamp = await writeStateValueIfVersion(APP_STATE_KEY, versionstamp, state);
  if (!nextVersionstamp) throw new StateWriteConflictError();
  return state;
}

async function mutateState<T>(
  operation: (
    state: AppState,
    commit: (state: AppState) => Promise<AppState>,
  ) => Promise<T>,
): Promise<T> {
  const run = stateMutationQueue.catch(() => undefined).then(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const snapshot = await readStateSnapshot();
      try {
        return await operation(
          snapshot.state,
          (state) => writeStateIfUnchanged(state, snapshot.versionstamp),
        );
      } catch (error) {
        if (error instanceof StateWriteConflictError) continue;
        throw error;
      }
    }
    throw new StateWriteConflictError();
  });
  stateMutationQueue = run.then(() => undefined, () => undefined);
  return await run;
}

function normalizePartifulAutoSync(value: unknown): PartifulAutoSyncState {
  const raw = recordValue(value);
  const state = emptyPartifulAutoSyncState();
  if (!raw) return state;
  const status = textField(raw.status, 40);
  return {
    status: status === "running" || status === "completed" || status === "failed" ? status : "idle",
    lastStartedAt: textField(raw.lastStartedAt, 80),
    lastCompletedAt: textField(raw.lastCompletedAt, 80),
    lastRunId: textField(raw.lastRunId, 120),
    lastAgendaRunId: textField(raw.lastAgendaRunId, 120),
    lastError: textField(raw.lastError, 500),
    nextAllowedAt: textField(raw.nextAllowedAt, 80),
  };
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

function buildSchedulePayload(
  entries: ScheduleEntry[],
  state: AppState,
  activeAgenda: AgendaRecalculateResult | null = null,
) {
  const schedule = activeAgenda
    ? activeAgenda.selectedBlocks.map((block) => agendaBlockToScheduleEntry(block, entries))
    : entries.filter((entry) => entry.calendar === "schedule");
  const reference = activeAgenda
    ? referenceEntriesForAgenda(entries, activeAgenda)
    : entries.filter((entry) => entry.calendar === "reference");
  const scheduleEvents = schedule.filter((entry) => entry.blockType === "event");
  const referenceEvents = reference.filter((entry) => entry.blockType === "event");

  return {
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    source: activeAgenda ? `agenda:${activeAgenda.agendaRunId}` : relativePath(SCHEDULE_CSV),
    activeAgenda: activeAgenda
      ? {
        agendaRunId: activeAgenda.agendaRunId,
        generatedAt: activeAgenda.generatedAt,
        summary: activeAgenda.summary,
      }
      : null,
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
      partifulAuto: state.partifulAutoSync,
    },
    email: emailPublicStatus(),
  };
}

type AgendaSelectedBlock = AgendaRecalculateResult["selectedBlocks"][number];

function referenceEntriesForAgenda(
  entries: ScheduleEntry[],
  agenda: AgendaRecalculateResult,
): ScheduleEntry[] {
  const selectedIds = new Set(
    agenda.selectedEvents.flatMap((block) =>
      [block.techweekId, block.partifulId, block.rerankId].filter(Boolean)
    ),
  );
  const statusById = agendaStatusById(agenda);
  return entries
    .filter((entry) => entry.blockType === "event" && !entryMatchesAnyAgendaId(entry, selectedIds))
    .map((entry) => referenceEntryFromEventEntry(entryWithAgendaStatus(entry, statusById)))
    .sort((a, b) => a.startEpochMs - b.startEpochMs);
}

function agendaBlockToScheduleEntry(
  block: AgendaSelectedBlock,
  originalEntries: ScheduleEntry[],
): ScheduleEntry {
  const original = findOriginalEntryForAgendaBlock(block, originalEntries);
  const { displayTitle, statusLabel } = stripStatusPrefix(block.title || original?.title || "");
  const status = block.status || original?.status || "";
  const start = block.start || original?.start || "";
  const end = block.end || original?.end || "";
  const actualStart = block.actualStart || start;
  const actualEnd = block.actualEnd || end;
  const dayKey = block.dayKey || start.slice(0, 10);
  return {
    calendar: "schedule",
    techweekId: block.techweekId || original?.techweekId || "",
    calendarBlockId: block.calendarBlockId || original?.calendarBlockId || block.agendaBlockId,
    partifulId: block.partifulId || original?.partifulId || "",
    rerankId: block.rerankId || original?.rerankId || "",
    entryType: block.entryType || original?.entryType || "",
    blockType: block.blockType || original?.blockType || "other",
    status,
    category: block.category || original?.category || "",
    start,
    end,
    actualStart,
    actualEnd,
    startEpochMs: block.startEpochMs || parseLocalDateTime(start),
    endEpochMs: block.endEpochMs || parseLocalDateTime(end),
    actualStartEpochMs: block.actualStartEpochMs || parseLocalDateTime(actualStart),
    actualEndEpochMs: block.actualEndEpochMs || parseLocalDateTime(actualEnd),
    dayKey,
    weekday: formatWeekday(dayKey),
    timeRange: formatTimeRange(start, end),
    title: block.title || original?.title || "",
    displayTitle: block.displayTitle || displayTitle || original?.displayTitle || "",
    statusLabel: statusLabelForScheduleStatus(status, statusLabel || original?.statusLabel || ""),
    location: block.location || original?.location || "",
    venueQuery: block.venueQuery || original?.venueQuery || "",
    venuePrecision: block.venuePrecision || original?.venuePrecision || "",
    routeMode: block.routeMode || original?.routeMode || "",
    travelMinutes: block.travelMinutes === null || block.travelMinutes === undefined
      ? original?.travelMinutes ?? ""
      : String(block.travelMinutes),
    routeDetails: block.routeDetails || original?.routeDetails || "",
    transitRisk: block.transitRisk || original?.transitRisk || "",
    note: block.note || original?.note || block.generatedReason || "",
    salesCoaching: original?.salesCoaching || "",
    rank: block.rank || original?.rank || "",
    tier: block.tier || original?.tier || "",
    opportunityScore: block.opportunityScore || original?.opportunityScore || "",
    eventUrl: block.eventUrl || original?.eventUrl || "",
    googleMapsUrl: block.googleMapsUrl || original?.googleMapsUrl || "",
  };
}

function agendaStatusById(agenda: AgendaRecalculateResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of agenda.selectedEvents) {
    addAgendaStatusKeys(map, [
      block.techweekId,
      block.calendarBlockId,
      block.partifulId,
      block.rerankId,
    ], block.status);
  }
  for (const drop of agenda.droppedEvents) {
    addAgendaStatusKeys(map, [
      drop.event.techweekId,
      drop.event.calendarBlockId,
      drop.event.partifulId,
      drop.event.rerankId,
      ...drop.event.identifiers,
    ], drop.event.status);
  }
  return map;
}

function addAgendaStatusKeys(
  map: Map<string, string>,
  ids: readonly string[],
  status: string,
): void {
  if (!status) return;
  for (const id of ids) {
    if (!id) continue;
    map.set(id, status);
    if (id.startsWith("TW-")) map.set(id.slice(3), status);
    else if (/^\d+$/.test(id)) map.set(`TW-${id}`, status);
  }
}

function entryWithAgendaStatus(
  entry: ScheduleEntry,
  statusById: Map<string, string>,
): ScheduleEntry {
  const ids = [
    entry.techweekId,
    entry.calendarBlockId,
    entry.partifulId,
    entry.rerankId,
  ].filter(Boolean);
  const status = ids.map((id) => statusById.get(id)).find(Boolean);
  if (!status) return entry;
  return {
    ...entry,
    status,
    statusLabel: statusLabelForScheduleStatus(status, entry.statusLabel),
  };
}

function findOriginalEntryForAgendaBlock(
  block: AgendaSelectedBlock,
  entries: ScheduleEntry[],
): ScheduleEntry | null {
  const ids = new Set([block.techweekId, block.partifulId, block.rerankId].filter(Boolean));
  return entries.find((entry) => entry.calendarBlockId === block.calendarBlockId) ??
    entries.find((entry) => entryMatchesAnyAgendaId(entry, ids)) ??
    null;
}

function referenceEntryFromEventEntry(entry: ScheduleEntry): ScheduleEntry {
  const techweekId = entry.techweekId || (entry.rerankId ? `TW-${entry.rerankId}` : "");
  return {
    ...entry,
    calendar: "reference",
    calendarBlockId: techweekId ? `${techweekId}-REFERENCE` : entry.calendarBlockId,
  };
}

function entryMatchesAnyAgendaId(entry: ScheduleEntry, ids: Set<string>): boolean {
  return ids.has(entry.techweekId) || ids.has(entry.partifulId) || ids.has(entry.rerankId);
}

function relativePath(url: URL): string {
  return decodeURIComponent(url.pathname.replace(decodeURIComponent(ROOT.pathname), ""));
}

async function handleSchedule(): Promise<Response> {
  const [entries, state] = await Promise.all([readAgendaCandidateEntries(), readState()]);
  const activeAgenda = state.activeAgendaRunId
    ? await readAgendaRun(state.activeAgendaRunId)
    : null;
  return json(buildSchedulePayload(entries, state, activeAgenda));
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
  const authorizationError = await requireAdminAccountSession(request);
  if (authorizationError) return authorizationError;

  const now = new Date().toISOString();
  const type = String(body.type ?? "");

  if (type === "event_note") {
    const calendarBlockId = String(body.calendarBlockId ?? body.calendar_block_id ?? "").trim();
    if (!calendarBlockId) return badRequest("calendarBlockId is required.");
    return await mutateState(async (state, commit) => {
      state.eventNotes[calendarBlockId] = {
        note: String(body.note ?? "").trim(),
        updatedAt: now,
      };
      return json({ state: await commit(state) });
    });
  }

  if (type === "dismiss_block") {
    const calendarBlockId = String(body.calendarBlockId ?? body.calendar_block_id ?? "").trim();
    if (!calendarBlockId) return badRequest("calendarBlockId is required.");
    const dismissed = Boolean(body.dismissed ?? true);
    return await mutateState(async (state, commit) => {
      state.dismissedBlocks = dismissed
        ? [...new Set([...state.dismissedBlocks, calendarBlockId])]
        : state.dismissedBlocks.filter((item) => item !== calendarBlockId);
      return json({ state: await commit(state) });
    });
  }

  if (type === "lead_create") {
    const calendarBlockId = textField(body.calendarBlockId ?? body.calendar_block_id, 160);
    if (!calendarBlockId) return badRequest("calendarBlockId is required.");

    const entries = await readScheduleEntries();
    const entry = entries.find((item) => item.calendarBlockId === calendarBlockId);
    if (!entry || entry.blockType !== "event") {
      return badRequest("Lead must be associated with an event block.");
    }

    const qualification = {
      role: textField(body.role, 180),
      buyerType: textField(body.buyerType, 120),
      githubHeavy: normalizeLeadSignal(body.githubHeavy),
      aiCodingAdoption: normalizeLeadSignal(body.aiCodingAdoption),
      painMentioned: textField(body.painMentioned, 1200),
      strongQuote: textField(body.strongQuote, 900),
      followUp: textField(body.followUp, 300),
    };
    const lead: Lead = {
      id: crypto.randomUUID(),
      calendarBlockId,
      techweekId: entry.techweekId,
      eventTitle: entry.displayTitle,
      name: textField(body.name, 160),
      company: textField(body.company, 180),
      role: qualification.role,
      email: normalizeLeadEmail(textField(body.email, 220)),
      phone: normalizeLeadPhone(textField(body.phone, 80)),
      buyerType: qualification.buyerType,
      githubHeavy: qualification.githubHeavy,
      aiCodingAdoption: qualification.aiCodingAdoption,
      painMentioned: qualification.painMentioned,
      strongQuote: qualification.strongQuote,
      notes: textField(body.notes, 2400),
      ocr: normalizeLeadOcrMetadata(body.ocr),
      priority: deriveLeadPriorityForLead(entry, qualification),
      followUp: qualification.followUp,
      nextStepDate: normalizeLeadNextStepDate(body.nextStepDate),
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

    return await mutateState(async (state, commit) => {
      state.leads = [lead, ...state.leads].slice(0, 250);
      return json({ state: await commit(state), lead });
    });
  }

  if (type === "lead_delete") {
    const id = textField(body.id, 160);
    if (!id) return badRequest("id is required.");
    return await mutateState(async (state, commit) => {
      state.leads = state.leads.filter((lead) => lead.id !== id);
      return json({ state: await commit(state) });
    });
  }

  return badRequest("Unsupported state action.");
}

async function handleExport(pathname: string): Promise<Response> {
  const state = await readState();
  const exportedAt = new Date().toISOString();
  if (pathname === "/api/export/state.json") {
    return json({
      exportedAt,
      version: state.version,
      state,
    }, exportHeaders("techweek-state-export.json"));
  }
  if (pathname === "/api/export/leads.json") {
    return json({
      exportedAt,
      count: state.leads.length,
      leads: state.leads,
    }, exportHeaders("techweek-crm-leads.json"));
  }
  if (pathname === "/api/export/leads.csv") {
    return textResponse(leadExportCsv(state.leads), "text/csv; charset=utf-8", {
      headers: exportHeaders("techweek-crm-leads.csv").headers,
    });
  }
  return notFound();
}

function exportHeaders(filename: string): ResponseInit {
  return {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  };
}

function leadExportCsv(leads: Lead[]): string {
  const rows = [
    LEAD_EXPORT_COLUMNS.join(","),
    ...leads.map((lead) =>
      LEAD_EXPORT_COLUMNS.map((column) => csvCell(leadExportValue(lead, column))).join(",")
    ),
  ];
  return `${rows.join("\n")}\n`;
}

function leadExportValue(lead: Lead, column: typeof LEAD_EXPORT_COLUMNS[number]): string {
  const email = lead.followUpEmail;
  switch (column) {
    case "followUpEmailStatus":
      return email?.status ?? "";
    case "followUpEmailTo":
      return email?.to ?? "";
    case "followUpEmailSubject":
      return email?.subject ?? "";
    case "followUpEmailAttemptedAt":
      return email?.attemptedAt ?? "";
    case "followUpEmailSentAt":
      return email?.sentAt ?? "";
    case "followUpEmailProviderMessageId":
      return email?.providerMessageId ?? "";
    case "followUpEmailError":
      return email?.error ?? "";
    default:
      return String(lead[column] ?? "");
  }
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

async function handleAgendaRecalculate(request: Request): Promise<Response> {
  const authorizationError = await requireAdminAccountSession(request);
  if (authorizationError) return authorizationError;

  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Expected a JSON object body.");
  }
  const raw = body as Record<string, unknown>;
  const result = await recalculateAgendaFromBody(raw);
  await storeAgendaRun(result);
  const responseBody: Record<string, unknown> = { agenda: result };
  if (raw.activate === true) {
    const [entries, updatedState] = await Promise.all([
      readAgendaCandidateEntries(),
      mutateState(async (state, commit) => {
        state.activeAgendaRunId = result.agendaRunId;
        return await commit(state);
      }),
    ]);
    responseBody.schedule = buildSchedulePayload(entries, updatedState, result);
  }
  return json(responseBody);
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
    readAgendaCandidateEntries(),
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
  const preferences = recordValue(body.preferences) ?? undefined;
  const liveRouting = body.liveRouting !== false;

  return await recalculateAgenda({
    scheduleEntries: entries,
    state: {
      excludedBlockIds: state.dismissedBlocks,
    },
    overrides,
    preferences,
    statusUpdates: [...storedStatusUpdates, ...directStatusUpdates],
    acceptedEventIds,
    routeEstimator: liveRouting ? estimateAgendaRoute : undefined,
    routeVersion: liveRouting ? ROUTING_VERSION : "agenda-fallback-v1",
  });
}

async function readStoredPartifulStatusUpdates(): Promise<AgendaStatusUpdate[]> {
  const entries = await readStoredPartifulEvents();
  return entries.map((entry) => {
    const event = entry.normalizedEvent;
    const status = entry.mergedEvent.status || event.status;
    return {
      partifulId: event.partifulId,
      status,
      reason: `Partiful sync status ${event.rawStatus || status}`,
      updatedAt: entry.syncedAt,
    };
  }).filter((item) => item.partifulId && item.status);
}

async function readStoredPartifulEvents(limit = 1000): Promise<StoredPartifulEventRecord[]> {
  const entries = await listCacheValues<StoredPartifulEvent>("partifulEvent", limit);
  return entries.map((entry) => ({
    cacheId: entry.cacheId,
    syncedAt: entry.value.syncedAt,
    updatedAt: entry.updatedAt,
    normalizedEvent: entry.value.normalizedEvent,
    mergedEvent: entry.value.mergedEvent,
    statusChanged: entry.value.statusChanged,
    matchedBy: entry.value.matchedBy,
  }));
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
  const manual = manualAgendaRoutePoint(point, query);
  if (manual) return manual;
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

function manualAgendaRoutePoint(
  point: {
    id?: string;
    name?: string;
    location?: string;
    venuePrecision?: string;
  },
  query: string,
): RoutePoint | null {
  const haystack = `${query} ${point.location ?? ""} ${point.name ?? ""}`;
  const match = MANUAL_AGENDA_ROUTE_POINTS.find((item) => item.pattern.test(haystack));
  if (!match) return null;
  return {
    id: point.id,
    name: point.name || match.query,
    location: point.location,
    venueQuery: match.query,
    addressPrecision: point.venuePrecision || match.precision,
    lat: match.lat,
    lon: match.lon,
  };
}

function isHomeAnchor(point: { id?: string; name?: string }, query: string): boolean {
  const text = `${point.id ?? ""} ${point.name ?? ""} ${query}`.toLowerCase();
  return text.includes("fidi home") || text.includes("wall st, new york");
}

async function handlePartifulSync(request: Request): Promise<Response> {
  const authorizationError = await requireAdminAccountSession(request);
  if (authorizationError) return authorizationError;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Expected a JSON body.");
  const raw = body as Record<string, unknown>;
  return await runPartifulSnapshotSync(raw);
}

async function runPartifulSnapshotSync(raw: Record<string, unknown>): Promise<Response> {
  const extracted = extractPartifulSnapshotPayloads(raw);
  const snapshots = extracted.snapshots;
  if (snapshots.length === 0) {
    return badRequest(
      "Provide Partiful snapshots through snapshots, payloads, responses, targets, snapshot, payload, nextData, or __NEXT_DATA__.",
    );
  }

  const entries = await readAgendaCandidateEntries();
  const currentEvents = entries
    .filter((entry) => entry.blockType === "event")
    .map(partifulEventLikeFromEntry);
  const computedSync = computePartifulSync(currentEvents, snapshots, {
    includeRawPayload: raw.includeRawPayload === true,
    source: textField(raw.source, 120) || "api_supplied_snapshot",
  });
  const sync = {
    ...computedSync,
    warnings: [...extracted.warnings, ...computedSync.warnings],
  };

  await persistPartifulSync(
    [...sync.updatedEvents, ...sync.unchangedEvents],
    sync.unmatchedSnapshots,
    sync.syncedAt,
  );
  const responseBody: Record<string, unknown> = {
    ingestion: {
      snapshotCount: snapshots.length,
      source: textField(raw.source, 120) || "api_supplied_snapshot",
    },
    sync,
  };
  if (raw.recalculate === true) {
    const agenda = await recalculateAgendaFromBody({
      ...raw,
      statusUpdates: sync.updatedEvents.map((update) => ({
        partifulId: update.normalizedEvent.partifulId,
        status: update.mergedEvent.status,
        reason: `Partiful sync status ${
          update.normalizedEvent.rawStatus || update.mergedEvent.status
        }`,
        updatedAt: sync.syncedAt,
      })),
    });
    await storeAgendaRun(agenda);
    responseBody.agenda = agenda;
    if (raw.activate === true) {
      const updatedState = await mutateState(async (state, commit) => {
        state.activeAgendaRunId = agenda.agendaRunId;
        return await commit(state);
      });
      responseBody.schedule = buildSchedulePayload(
        await readAgendaCandidateEntries(),
        updatedState,
        agenda,
      );
    }
  }
  return json(responseBody);
}

async function handlePartifulHeadlessSync(request: Request): Promise<Response> {
  const authorizationError = await requireAdminAccountSession(request);
  if (authorizationError) return authorizationError;

  const body = await request.json().catch(() => ({}));
  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  return await runPartifulHeadlessSync(raw);
}

async function runPartifulHeadlessSync(raw: Record<string, unknown>): Promise<Response> {
  const requestedAuthFile = textField(raw.authFile, 1000);
  let authSource: PartifulAuthSource;
  try {
    authSource = await readPartifulAuthSource(requestedAuthFile);
  } catch (error) {
    if (error instanceof PartifulAuthConfigurationError) {
      return json({
        error: {
          message: error.message,
          type: "configuration_error",
        },
      }, { status: 503 });
    }
    throw error;
  }
  let auth: StoredPartifulAuth;
  try {
    auth = await ensureFreshPartifulAuth(authSource.auth, authSource.persistPath);
  } catch (error) {
    return json({
      error: {
        message: partifulAuthRefreshErrorMessage(error, authSource),
        type: "partiful_auth_error",
      },
    }, { status: 503 });
  }
  const entries = await readAgendaCandidateEntries();
  const targets = mergePartifulTargets(
    partifulTargetsFromEntries(entries),
    await readUpcomingPartifulTargets(auth),
  );
  const limit = positiveIntegerField(raw.limit, 0);
  const selectedTargets = limit > 0 ? targets.slice(0, limit) : targets;
  const snapshots = [];
  const failures = [];

  for (const target of selectedTargets) {
    try {
      const getEventInfo = await callPartifulFunction(auth, "getEventInfo", {
        params: { eventId: target.partifulId },
      });
      let getGuests: unknown;
      try {
        getGuests = await callPartifulFunction(auth, "getGuests", {
          params: { eventId: target.partifulId },
        });
      } catch (error) {
        failures.push(partifulHeadlessFailure(target, "getGuests", error));
      }
      snapshots.push(buildCallableSnapshot(target, getEventInfo, getGuests, auth.userId));
    } catch (error) {
      failures.push(partifulHeadlessFailure(target, "getEventInfo", error));
    }
  }

  const syncResponse = await runPartifulSnapshotSync({
    source: "partiful_headless_local",
    recalculate: raw.recalculate !== false,
    activate: raw.activate !== false,
    liveRouting: raw.liveRouting !== false,
    responses: snapshots,
  });
  const responseBody = await syncResponse.json().catch(() => ({}));
  return json({
    ...responseBody,
    headless: {
      authSource: authSource.label,
      ...(authSource.authFile ? { authFile: authSource.authFile } : {}),
      targetCount: selectedTargets.length,
      snapshotCount: snapshots.length,
      failureCount: failures.length,
      failures,
    },
  }, { status: syncResponse.status });
}

type PartifulAuthSource = {
  auth: StoredPartifulAuth;
  authFile?: string;
  label: string;
  persistPath: string | null;
};

async function readPartifulAuthSource(requestedAuthFile = ""): Promise<PartifulAuthSource> {
  if (!requestedAuthFile) {
    const envAuth = textField(Deno.env.get(PARTIFUL_AUTH_JSON_ENV), 200_000);
    if (envAuth) {
      try {
        return {
          auth: parseStoredPartifulAuthJson(envAuth, PARTIFUL_AUTH_JSON_ENV),
          label: `deno_env:${PARTIFUL_AUTH_JSON_ENV}`,
          persistPath: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PartifulAuthConfigurationError(message);
      }
    }
  }

  let authFile: string;
  try {
    authFile = requestedAuthFile || defaultAuthFilePath();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PartifulAuthConfigurationError(message);
  }
  try {
    return {
      auth: await readStoredPartifulAuth(authFile),
      authFile,
      label: "local_file",
      persistPath: authFile,
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new PartifulAuthConfigurationError(
        `Partiful sync is not configured. Set the ${PARTIFUL_AUTH_JSON_ENV} Deno Deploy secret or run the local auth capture task to create ${authFile}.`,
      );
    }
    throw error;
  }
}

class PartifulAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartifulAuthConfigurationError";
  }
}

async function handlePartifulAutoSync(request: Request): Promise<Response> {
  const authorizationError = await requireAdminAccountSession(request);
  if (authorizationError) return authorizationError;

  const nowMs = Date.now();
  let queuedRunId = "";
  const response = await mutateState(async (state, commit) => {
    const decision = partifulAutoSyncDecision(state.partifulAutoSync, nowMs);

    if (decision.action === "already_running") {
      return json({
        action: "already_running",
        reason: decision.reason,
        partifulAutoSync: state.partifulAutoSync,
      }, { status: 202 });
    }

    if (decision.action === "skip_recent") {
      if (decision.staleRunning) {
        state.partifulAutoSync = {
          ...state.partifulAutoSync,
          status: "failed",
          lastCompletedAt: new Date(nowMs).toISOString(),
          lastError: "Previous automatic Partiful sync did not finish before its lock expired.",
        };
        await commit(state);
      }
      return json({
        action: "skipped",
        reason: decision.reason,
        partifulAutoSync: state.partifulAutoSync,
      });
    }

    const runId = `partiful-auto-${new Date(nowMs).toISOString().replaceAll(/[:.]/g, "-")}`;
    state.partifulAutoSync = {
      ...state.partifulAutoSync,
      status: "running",
      lastStartedAt: new Date(nowMs).toISOString(),
      lastRunId: runId,
      lastError: "",
      nextAllowedAt: new Date(nowMs + PARTIFUL_AUTO_SYNC_INTERVAL_MS).toISOString(),
    };
    await commit(state);
    queuedRunId = runId;
    return json({
      action: "started",
      partifulAutoSync: state.partifulAutoSync,
    }, { status: 202 });
  });
  if (queuedRunId) queuePartifulAutoSync(queuedRunId);
  return response;
}

type PartifulAutoSyncDecision =
  | {
    action: "start";
    reason: string;
    staleRunning: false;
  }
  | {
    action: "already_running" | "skip_recent";
    reason: string;
    staleRunning: boolean;
  };

function partifulAutoSyncDecision(
  sync: PartifulAutoSyncState,
  nowMs: number,
): PartifulAutoSyncDecision {
  const lastStartedMs = Date.parse(sync.lastStartedAt);
  const hasStarted = Number.isFinite(lastStartedMs);
  const ageMs = hasStarted ? nowMs - lastStartedMs : Number.POSITIVE_INFINITY;
  const isRecent = ageMs >= 0 && ageMs < PARTIFUL_AUTO_SYNC_INTERVAL_MS;
  const isFreshRunning = sync.status === "running" && ageMs >= 0 &&
    ageMs < PARTIFUL_AUTO_SYNC_LOCK_TTL_MS;
  const staleRunning = sync.status === "running" && hasStarted && !isFreshRunning;

  if (isFreshRunning) {
    return {
      action: "already_running",
      reason: "An automatic Partiful sync is already running.",
      staleRunning: false,
    };
  }

  if (isRecent && sync.status !== "failed") {
    return {
      action: "skip_recent",
      reason: "Automatic Partiful sync already started within the last 15 minutes.",
      staleRunning,
    };
  }

  return {
    action: "start",
    reason: "Automatic Partiful sync is due.",
    staleRunning: false,
  };
}

function queuePartifulAutoSync(runId: string): void {
  globalThis.setTimeout(() => {
    void runPartifulAutoSync(runId);
  }, 0);
}

async function runPartifulAutoSync(runId: string): Promise<void> {
  try {
    const syncResponse = await runPartifulHeadlessSync({
      liveRouting: false,
      recalculate: true,
      activate: true,
    });
    const syncBody = await syncResponse.json().catch(() => ({}));
    if (!syncResponse.ok) {
      throw new Error(partifulAutoSyncErrorMessage(syncBody, "Automatic Partiful sync failed."));
    }

    const liveAgenda = await recalculateAgendaFromBody({ liveRouting: true });
    await storeAgendaRun(liveAgenda);
    await mutateState(async (state, commit) => {
      if (state.partifulAutoSync.lastRunId !== runId) return;
      state.activeAgendaRunId = liveAgenda.agendaRunId;
      state.partifulAutoSync = {
        ...state.partifulAutoSync,
        status: "completed",
        lastCompletedAt: new Date().toISOString(),
        lastAgendaRunId: liveAgenda.agendaRunId,
        lastError: "",
      };
      await commit(state);
    });
  } catch (error) {
    console.error("[partiful:auto-sync]", error);
    await mutateState(async (state, commit) => {
      if (state.partifulAutoSync.lastRunId !== runId) return;
      state.partifulAutoSync = {
        ...state.partifulAutoSync,
        status: "failed",
        lastCompletedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      await commit(state);
    });
  }
}

function partifulAutoSyncErrorMessage(body: unknown, fallback: string): string {
  const record = recordValue(body);
  const error = recordValue(record?.error);
  return textField(error?.message, 500) || fallback;
}

function partifulAuthRefreshErrorMessage(error: unknown, authSource: PartifulAuthSource): string {
  const base = error instanceof Error ? error.message : String(error);
  const authFile = authSource.authFile ? ` at ${authSource.authFile}` : "";
  return `Partiful auth refresh failed for ${authSource.label}${authFile}: ${base}`;
}

function partifulTargetsFromEntries(entries: ScheduleEntry[]): PartifulTarget[] {
  return entries.flatMap((entry) => {
    if (entry.blockType !== "event" || !entry.eventUrl.includes("partiful.com")) return [];
    const partifulId = entry.partifulId || partifulIdFromUrl(entry.eventUrl);
    if (!partifulId) return [];
    return [{
      eventUrl: entry.eventUrl || `https://partiful.com/e/${partifulId}`,
      partifulId,
      title: entry.displayTitle || entry.title || `Partiful ${partifulId}`,
    }];
  });
}

async function readUpcomingPartifulTargets(auth: StoredPartifulAuth): Promise<PartifulTarget[]> {
  const response = await callPartifulFunction(auth, "getMyUpcomingEventsForHomePage", {});
  const data = callableResult(response);
  const dataRecord = recordValue(data);
  const events = Array.isArray(dataRecord?.upcomingEvents)
    ? dataRecord.upcomingEvents as unknown[]
    : [];
  return events.flatMap((event) => {
    const record = recordValue(event);
    if (!record) return [];
    const partifulId = textField(record.id, 120) ||
      partifulIdFromUrl(textField(record.publicShortUrl, 300));
    if (!partifulId) return [];
    const title = textField(record.title, 300) || `Partiful ${partifulId}`;
    if (!isConferenceIsoDate(textField(record.startDate, 80), title)) return [];
    return [{
      eventUrl: `https://partiful.com/e/${partifulId}`,
      partifulId,
      title,
    }];
  });
}

function mergePartifulTargets(...groups: PartifulTarget[][]): PartifulTarget[] {
  const targets: PartifulTarget[] = [];
  const seen = new Set<string>();
  for (const target of groups.flat()) {
    const key = target.partifulId || target.eventUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

function isConferenceIsoDate(value: string, title: string): boolean {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return /#?nytechweek/i.test(title);
  const day = formatLocalDateTimeForSchedule(parsed).slice(0, 10);
  return (day >= "2026-06-01" && day <= "2026-06-07") || /#?nytechweek/i.test(title);
}

function partifulHeadlessFailure(
  target: PartifulTarget,
  stage: string,
  error: unknown,
): Record<string, string> {
  return {
    partifulId: target.partifulId,
    eventUrl: target.eventUrl,
    title: target.title,
    stage,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function handlePartifulSyncRead(): Promise<Response> {
  const events = await readStoredPartifulEvents();
  const statusCounts: Record<string, number> = {};
  for (const event of events) {
    const status = event.mergedEvent.status || event.normalizedEvent.status || "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  return json({
    generatedAt: new Date().toISOString(),
    count: events.length,
    statusCounts,
    events,
  });
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
    const normalizedEvent = {
      ...compactNormalizedPartifulEvent(update.normalizedEvent),
      status: update.mergedEvent.status || update.normalizedEvent.status,
    };
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
        metadata: { status: update.mergedEvent.status || normalizedEvent.status },
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
    "Capture fields are: name, company, role, event met at, buyer type, GitHub-heavy status, AI coding adoption, pain mentioned, strong quote, follow-up ask, priority, and next step date.",
    "",
    "CRM priority is assigned automatically from selected-event importance plus lead qualification; it is not a manual CRM field.",
    "- Priority A: high-value event plus qualified buyer/product signals, or unusually strong qualification from a lower-priority event.",
    "- Priority B: useful event context or partial qualification, but more discovery is needed.",
    "- Priority C: weak event fit, off-ICP buyer type, missing GitHub/AI-coding signal, or no actionable pain/follow-up ask.",
    "Treat priority as a blended follow-up urgency. Still qualify each person from role, company, buyer type, pain, quote, GitHub-heavy status, AI coding adoption, and conversation context.",
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
    "Calendar export is available through the ICS link; do not propose direct Google Calendar sync actions.",
    "Supported local actions, if useful: event_note.",
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
    lead.buyerType ? `buyer_type=${lead.buyerType}` : "",
    lead.githubHeavy ? `github_heavy=${lead.githubHeavy}` : "",
    lead.aiCodingAdoption ? `ai_coding_adoption=${lead.aiCodingAdoption}` : "",
    lead.painMentioned ? `pain=${lead.painMentioned}` : "",
    lead.strongQuote ? `quote=${lead.strongQuote}` : "",
    lead.priority ? `priority=${lead.priority}` : "",
    lead.followUp ? `follow_up_ask=${lead.followUp}` : "",
    lead.nextStepDate ? `next_step_date=${lead.nextStepDate}` : "",
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

function normalizePromptMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findPromptEvent(prompt: string, entries: ScheduleEntry[]): ScheduleEntry | null {
  const events = entries.filter((entry) => entry.blockType === "event");
  const promptNeedle = normalizePromptMatchText(prompt);
  const quoted = [...prompt.matchAll(/"([^"]{3,})"/g)]
    .map((match) => normalizePromptMatchText(match[1]))
    .filter(Boolean);

  for (const quotedTitle of quoted) {
    const exact = events.find((entry) =>
      normalizePromptMatchText(entry.displayTitle) === quotedTitle
    );
    if (exact) return exact;
  }

  return events.find((entry) => {
    const techweekId = normalizePromptMatchText(entry.techweekId);
    const title = normalizePromptMatchText(entry.displayTitle);
    return techweekId && promptNeedle.includes(techweekId) ||
      title.length >= 8 && promptNeedle.includes(title.slice(0, 18));
  }) ?? null;
}

function coachingFields(value: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const match = line.trim().match(/^([^:]{2,32}):\s*(.+)$/);
    if (!match) continue;
    fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return fields;
}

function eventCoachingFallback(prompt: string, entries: ScheduleEntry[]): string | null {
  if (!/coaching|room read|opening line|who to meet|follow-up|questions/i.test(prompt)) {
    return null;
  }

  const event = findPromptEvent(prompt, entries);
  if (!event) return null;

  const fields = coachingFields(event.salesCoaching);
  const pitch = fields.pitch ||
    "Use the source-linked contribution evidence angle: credit beyond commits, with reviewable GitHub artifacts.";
  const roomRead = fields.open || fields["listen for"] ||
    "Look for engineering leaders, maintainers, DevRel, DevEx, and open-source operators who care about invisible contribution work.";
  const question = fields.ask ||
    "How do you credit review, triage, specs, and maintainer work that never becomes a commit?";
  const whoToMeet = fields["listen for"] ||
    "Maintainers, DevRel leads, OSPO owners, engineering leaders, and teams running contributor or bounty programs.";
  const followUp = fields["follow-up"] ||
    "Ask whether they would react to a five-minute sample manager packet or introduce the person who owns contributor recognition.";

  return [
    "The AI gateway returned an upstream error, so here is the local event coaching.",
    "",
    `**${event.displayTitle}**`,
    `- **When:** ${event.weekday} ${event.timeRange}.`,
    event.location || event.venueQuery
      ? `- **Location:** ${event.venueQuery || event.location}.`
      : "",
    event.status ? `- **Status:** ${event.status}.` : "",
    "",
    "**Room Read**",
    roomRead,
    "",
    "**Opening Line**",
    pitch,
    "",
    "**Questions**",
    `- ${question}`,
    "- Who owns contributor recognition, maintainer programs, or engineering evidence on your team?",
    "",
    "**Who To Meet**",
    whoToMeet,
    "",
    "**Follow-Up**",
    followUp,
  ].filter(Boolean).join("\n");
}

export function fallbackAgentAnswer(prompt: string, entries: ScheduleEntry[]): string {
  const eventFallback = eventCoachingFallback(prompt, entries);
  if (eventFallback) return eventFallback;

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

function transcriptLeadPrompt(eventTitle = ""): string {
  const eventContext = eventTitle ? ` Event title: ${eventTitle}.` : "";
  return `You are extracting CRM lead fields from a spoken transcript. ${eventContext} Return only JSON with:
name, company, role, email, phone, buyerType, githubHeavy, aiCodingAdoption, painMentioned,
strongQuote, followUp, nextStepDate, notes.
Rules:
- Use empty string when a field is not present.
- githubHeavy and aiCodingAdoption must be one of: "yes", "no", "unknown".
- buyerType should be "Unknown" only if genuinely unknown.
- nextStepDate must be YYYY-MM-DD only, otherwise use empty string.`;
}

function transcriptLeadChatBody(transcript: string, eventTitle = ""): OcrRequestBody {
  return {
    model: AGENT_MODEL,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: transcriptLeadPrompt(eventTitle) },
          { type: "text", text: `Transcript:\n${transcript}` },
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
    hasBuyerType: Boolean(draft.buyerType),
    hasGithubHeavy: draft.githubHeavy !== "unknown",
    hasAiCodingAdoption: draft.aiCodingAdoption !== "unknown",
    hasPainMentioned: Boolean(draft.painMentioned),
    hasStrongQuote: Boolean(draft.strongQuote),
    hasFollowUp: Boolean(draft.followUp),
    hasNextStepDate: Boolean(draft.nextStepDate),
    hasNotes: Boolean(draft.notes),
    followUpLength: draft.followUp.length,
  };
}

function leadDraftHasUsableFields(draft: LeadDraft): boolean {
  const hasText = [
    draft.name,
    draft.company,
    draft.role,
    draft.email,
    draft.phone,
    draft.buyerType,
    draft.painMentioned,
    draft.strongQuote,
    draft.followUp,
    draft.nextStepDate,
    draft.notes,
  ].some((value) => {
    const normalized = value.trim();
    return normalized && normalized.toLowerCase() !== "unknown";
  });
  const hasSignals = draft.githubHeavy !== "unknown" || draft.aiCodingAdoption !== "unknown";
  return hasText || hasSignals;
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
        meanConfidence: parsed.meanConfidence,
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
      meanConfidence: best.meanConfidence,
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

function parsedGatewayErrorBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function gatewayDebugLine(headers: Headers, key: string, label: string): string {
  const value = headers.get(key);
  return value ? `- **${label}:** \`${value}\`` : "";
}

export function visibleAgentGatewayError(upstream: Response, model: string, body: unknown): string {
  const parsedBody = parsedGatewayErrorBody(body);
  const message = gatewayErrorMessage(parsedBody);
  const debugBody = truncateDebug(parsedBody, 1600);
  const bodyText = typeof debugBody === "string" ? debugBody : JSON.stringify(debugBody, null, 2);
  const bodyFence = typeof parsedBody === "string" ? "text" : "json";
  const lines = [
    "AI gateway error.",
    "",
    `- **Status:** HTTP ${upstream.status}${upstream.statusText ? ` ${upstream.statusText}` : ""}`,
    `- **Model:** \`${model}\``,
    message ? `- **Message:** ${message}` : "",
    gatewayDebugLine(upstream.headers, "x-uos-request-id", "UOS request ID"),
    gatewayDebugLine(upstream.headers, "x-deno-trace-id", "Deno trace ID"),
    gatewayDebugLine(upstream.headers, "x-uos-warning", "UOS warning"),
    gatewayDebugLine(upstream.headers, "x-uos-router-revision", "Router revision"),
  ].filter(Boolean);

  if (bodyText.trim()) {
    lines.push("", "**Upstream Body**", `\`\`\`${bodyFence}`, bodyText, "```");
  }

  return lines.join("\n");
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

function buildLeadOcrMetadata(
  rawBody: Record<string, unknown>,
  localOrientation: LocalOcrOrientation | null,
): OcrDraftMetadata | null {
  const clientMetadata = recordValue(rawBody.clientMetadata);
  const imageMetadata = recordValue(clientMetadata?.image);
  const ocrSource = normalizeOcrContactField(imageMetadata?.ocrSource, 120);
  const attemptIndex = normalizeOcrInteger(
    clientMetadata?.attemptIndex ?? imageMetadata?.attemptIndex ?? imageMetadata?.retryIndex,
  );
  const outputWidth = normalizeOcrInteger(
    imageMetadata?.outputWidth,
  );
  const outputHeight = normalizeOcrInteger(
    imageMetadata?.outputHeight,
  );
  const dataUrlCharacters = normalizeOcrInteger(
    imageMetadata?.ocrDataUrlCharacters ??
      imageMetadata?.compressedDataUrlCharacters ??
      imageMetadata?.dataUrlCharacters ??
      imageMetadata?.originalDataUrlCharacters,
  );
  const localOcrMeanConfidenceValue = localOrientation?.meanConfidence;
  const localOcrMeanConfidence = Number.isFinite(Number(localOcrMeanConfidenceValue))
    ? Math.round(Number(localOcrMeanConfidenceValue))
    : undefined;
  const normalized: OcrDraftMetadata = {
    ocrSource: ocrSource || undefined,
    attemptIndex,
    outputWidth,
    outputHeight,
    dataUrlCharacters,
    localOcrUsed: Boolean(localOrientation) || undefined,
    localOcrMeanConfidence,
  };
  if (
    normalized.ocrSource || normalized.attemptIndex !== undefined ||
    normalized.outputWidth !== undefined || normalized.outputHeight !== undefined ||
    normalized.dataUrlCharacters !== undefined || normalized.localOcrUsed !== undefined ||
    normalized.localOcrMeanConfidence !== undefined
  ) {
    return normalized;
  }
  return null;
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
    source: localOrientation ? "vision_oriented_image" : "vision_only",
    localOcrUsed: Boolean(localOrientation),
    draft: draftDebug(draft),
    rawCharacters: content.length,
  });
  return json({
    requestId,
    draft,
    raw: content,
    source: localOrientation ? "vision_oriented_image" : "vision_only",
    ocrMetadata: buildLeadOcrMetadata(rawBody, localOrientation),
  }, {
    headers: responseDebugHeaders(result.upstream.headers, requestId),
  });
}

async function handleLeadTranscript(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const rawBody = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const requestId = textField(rawBody.requestId, 120) || createRequestId("transcript");
  if (!body || typeof body !== "object") {
    logJson("transcript_error", {
      requestId,
      stage: "parse_request_body",
      request: requestDebug(request),
    });
    return endpointError("Expected a JSON body.", requestId, 400);
  }

  if (typeof rawBody.transcript !== "string") {
    logJson("transcript_error", {
      requestId,
      stage: "validate_transcript",
      request: requestDebug(request),
      clientMetadata: clientMetadata(rawBody.clientMetadata),
    });
    return endpointError("transcript must be a non-empty string.", requestId, 400);
  }

  const transcript = rawBody.transcript.trim();
  if (!transcript) {
    logJson("transcript_error", {
      requestId,
      stage: "validate_transcript",
      request: requestDebug(request),
      clientMetadata: clientMetadata(rawBody.clientMetadata),
    });
    return endpointError("transcript must be a non-empty string.", requestId, 400);
  }

  const eventTitle = textField(rawBody.eventTitle, 240);
  logJson("transcript_start", {
    requestId,
    eventTitle,
    request: requestDebug(request),
    clientMetadata: clientMetadata(rawBody.clientMetadata),
    transcriptPreview: truncateDebug(transcript, 240),
    transcriptLength: transcript.length,
  });

  const { token, chatUrl } = gatewayConfig();
  if (!token) {
    logJson("transcript_error", {
      requestId,
      stage: "gateway_config",
      message: "UOS_AI_TOKEN is not configured.",
    });
    return endpointError("UOS_AI_TOKEN is not configured.", requestId, 503);
  }

  const transcriptBody = transcriptLeadChatBody(transcript, eventTitle);
  let result: { upstream: Response; model: string };
  try {
    result = await callOcrGateway(chatUrl, token, transcriptBody);
  } catch (error) {
    logJson("transcript_error", {
      requestId,
      stage: "gateway_fetch",
      error: safeError(error),
    });
    return endpointError("Lead transcript parsing failed.", requestId, 502, safeError(error));
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
  logJson("transcript_upstream", {
    requestId,
    ...upstreamDebug,
  });

  if (!result.upstream.ok) {
    const upstreamMessage = gatewayErrorMessage(responseBody);
    const clientStatus = result.upstream.status === 429 ? 429 : 502;
    const clientMessage = result.upstream.status === 429
      ? "AI gateway rate limit exceeded."
      : "Lead transcript parsing failed.";
    logJson("transcript_error", {
      requestId,
      stage: "gateway_response",
      message: upstreamMessage,
      upstream: upstreamDebug,
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
    logJson("transcript_error", {
      requestId,
      stage: "response_shape",
      upstream: upstreamDebug,
    });
    return endpointError(
      "AI gateway returned an unexpected transcript response shape.",
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
    logJson("transcript_error", {
      requestId,
      stage: "parse_gateway_json",
      error: safeError(error),
      content: truncateDebug(content),
    });
    return endpointError(
      error instanceof Error ? error.message : "Could not parse transcript response.",
      requestId,
      500,
      { content },
      responseDebugHeaders(result.upstream.headers, requestId),
    );
  }
  if (!leadDraftHasUsableFields(draft)) {
    logJson("transcript_error", {
      requestId,
      stage: "empty_draft",
      draft: draftDebug(draft),
      content: truncateDebug(content),
    });
    return endpointError(
      "Transcript parsing did not find any lead fields.",
      requestId,
      422,
      { content, draft: draftDebug(draft) },
      responseDebugHeaders(result.upstream.headers, requestId),
    );
  }

  logJson("transcript_success", {
    requestId,
    model: result.model,
    draft: draftDebug(draft),
    rawCharacters: content.length,
  });
  return json({
    requestId,
    draft,
  }, { headers: responseDebugHeaders(result.upstream.headers, requestId) });
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
  const buyerType = textField(raw.buyerType ?? raw.targetType, 120);
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
    name: normalizeOcrContactField(raw.name, 160),
    company,
    role,
    email: normalizeOcrEmail(raw.email ?? contact.email),
    phone: normalizeOcrPhone(raw.phone ?? contact.phone),
    buyerType,
    githubHeavy: normalizeLeadSignal(raw.githubHeavy ?? contact.githubHeavy),
    aiCodingAdoption: normalizeLeadSignal(raw.aiCodingAdoption ?? contact.aiCodingAdoption),
    painMentioned: textField(raw.painMentioned ?? raw.painPoints ?? raw.pain, 1200),
    strongQuote: textField(raw.strongQuote ?? raw.quote ?? raw.testimonial, 900),
    notes,
    followUp: textField(raw.followUpAsk ?? raw.followUp ?? raw.follow_up, 300),
    nextStepDate: normalizeLeadNextStepDate(raw.nextStepDate ?? raw.nextStepDateEstimate),
  };
}

export function normalizeLeadEmail(value: string): string {
  return normalizeOcrEmail(value);
}

export function normalizeLeadPhone(value: string): string {
  return normalizeOcrPhone(value);
}

function leadNotesText(values: unknown[]): string {
  return [...new Set(values.map((value) => textField(value, 360)).filter(Boolean))]
    .join("; ")
    .slice(0, 1200);
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
  const focus = context.userFocus && typeof context.userFocus === "object"
    ? context.userFocus
    : null;
  return [
    "Client context from the user's current browser/device:",
    focus
      ? "User is currently looking at this in-app context. Treat ambiguous questions as referring to this focus unless the user says otherwise."
      : "",
    focus ? `visible_view=${textField(focus.viewLabel || focus.view, 80)}` : "",
    focus && (focus.weekday || focus.date || focus.dayKey)
      ? `visible_day=${
        [textField(focus.weekday, 24), textField(focus.date || focus.dayKey, 32)].filter(Boolean)
          .join(" ")
      }`
      : "",
    focus ? `url_hash=${textField(focus.hash, 120)}` : "",
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
    const message = visibleAgentGatewayError(result.upstream, result.model, body);
    return json({
      message,
      actions: [],
      fallback: false,
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
    return streamGatewayError(result.upstream, result.model, detail);
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

function streamGatewayError(upstream: Response, model: string, detail: unknown): Response {
  const text = visibleAgentGatewayError(upstream, model, detail);
  const words = text.split(/(\s+)/);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse("meta", { model, fallback: false, gatewayError: detail }));
      for (const word of words) {
        controller.enqueue(sse("delta", { text: word }));
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      controller.enqueue(sse("done", { text, actions: [], model, fallback: false }));
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
    const pathname = normalizeApiPath(url.pathname);
    const sameSiteRedirect = redirectDenoDeployToSameSiteDomain(request, url);
    if (sameSiteRedirect) return sameSiteRedirect;
    const authorizationError = await authorizeApiRoute(request, url);
    if (authorizationError) return authorizationError;

    if (request.method === "GET" && pathname === "/api/health") return await handleHealth();
    if (request.method === "POST" && pathname === "/api/auth/register/start") {
      return await handleAuthRegisterStart(request);
    }
    if (request.method === "POST" && pathname === "/api/auth/register/finish") {
      return await handleAuthRegisterFinish(request);
    }
    if (request.method === "POST" && pathname === "/api/auth/login/start") {
      return await handleAuthLoginStart(request);
    }
    if (request.method === "POST" && pathname === "/api/auth/login/finish") {
      return await handleAuthLoginFinish(request);
    }
    if (request.method === "POST" && pathname === "/api/auth/agent-token/login") {
      return await handleAuthAgentTokenLogin(request);
    }
    if (request.method === "POST" && pathname === "/api/auth/logout") {
      return await handleAuthLogout(request);
    }
    if (request.method === "POST" && pathname === "/api/auth/handoff") {
      return await handleAuthHandoff(request);
    }
    if (request.method === "GET" && pathname === "/api/account/session") {
      return await handleAccountSession(request);
    }
    if (request.method === "GET" && pathname === "/api/account/invite") {
      return await handleAccountInviteGet(request);
    }
    if (request.method === "GET" && pathname === "/api/account/agent-tokens") {
      return await handleAccountAgentTokensGet();
    }
    if (request.method === "POST" && pathname === "/api/account/agent-tokens") {
      return await handleAccountAgentTokensPost(request);
    }
    if (request.method === "DELETE" && pathname.startsWith("/api/account/agent-tokens/")) {
      return await handleAccountAgentTokenDelete(
        decodeURIComponent(pathname.replace("/api/account/agent-tokens/", "")),
      );
    }
    if (request.method === "POST" && pathname === "/api/account/session/handoff") {
      return await handleAccountSessionHandoff(request);
    }
    if (request.method === "POST" && pathname === "/api/account/invite") {
      return await handleAccountInviteClaim(request);
    }
    if (request.method === "POST" && pathname === "/api/chat/share") {
      return await handleChatShareCreate(request);
    }
    if (request.method === "GET" && pathname.startsWith("/api/chat/share/")) {
      return await handleChatShareGet(pathname.replace("/api/chat/share/", ""));
    }
    if (request.method === "DELETE" && pathname.startsWith("/api/chat/share/")) {
      return await handleChatShareDelete(
        request,
        pathname.replace("/api/chat/share/", ""),
      );
    }
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
    if (request.method === "GET" && pathname.startsWith("/api/export/")) {
      return await handleExport(pathname);
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
    if (request.method === "POST" && url.pathname === "/api/leads/transcript") {
      return await handleLeadTranscript(request);
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
    if (request.method === "POST" && url.pathname === "/api/sync/partiful/auto") {
      return await handlePartifulAutoSync(request);
    }
    if (request.method === "POST" && url.pathname === "/api/sync/partiful/headless") {
      return await handlePartifulHeadlessSync(request);
    }
    if (request.method === "GET" && url.pathname === "/api/sync/partiful") {
      return await handlePartifulSyncRead();
    }
    if (url.pathname.startsWith("/api/")) return notFound();
    if (request.method !== "GET" && request.method !== "HEAD") return notFound();
    return await serveStatic(url.pathname, request.method);
  } catch (error) {
    if (error instanceof AccountAuthError) {
      return json({ error: { message: error.message } }, { status: error.status });
    }
    console.error(error);
    return serverError(error instanceof Error ? error.message : "Unknown server error.");
  }
}

function redirectDenoDeployToSameSiteDomain(request: Request, url: URL): Response | null {
  void request;
  void url;
  return null;
}

if (import.meta.main) {
  const onListen = ({ hostname, port: boundPort }: { hostname: string; port: number }) => {
    console.log(`Tech Week app running on http://${hostname}:${boundPort}`);
  };
  if (isDenoDeployRuntime()) {
    Deno.serve({ onListen }, router);
  } else {
    const port = findFreePort(resolvePreferredPort());
    Deno.serve({
      port,
      hostname: "0.0.0.0",
      onListen,
    }, router);
  }
}
