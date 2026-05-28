#!/usr/bin/env -S deno run --allow-read=.codex,data,app --allow-write=outputs/signed_up,outputs/sync,data/cache --allow-net=nominatim.openstreetmap.org,subwayinfo.nyc

import {
  buildOperationalRoute,
  type CacheKey,
  cleanAddress,
  DEFAULT_OPERATIONAL_ROUTE_IDS,
  geocode as routingGeocode,
  googleMapsSearchUrl,
  HOME_BASE_LOCATION,
  type OperationalRouteEvent,
  type OperationalScheduleBlock,
  type RouteMode,
  type RoutePoint,
  type RoutingCacheAdapter,
  type SubwayStation,
  type SubwayTripEstimate,
} from "../app/lib/routing.ts";

const ROOT = new URL("../", import.meta.url);
const STATUS_CSV = new URL(".codex/techweek_signup_status.csv", ROOT);
const RERANK_CSV = new URL("data/rankings/techweek_nyc_accolades_full_rerank.csv", ROOT);
const ADDED_RANKING_CSV = new URL(
  "data/rankings/techweek_nyc_added_events_ranked_2026-05-28.csv",
  ROOT,
);
const EVENT_PAGES_DIR = new URL("data/source/event_pages/", ROOT);
const GEOCODE_CACHE = new URL("data/cache/techweek_location_geocode_cache.json", ROOT);
const STATION_CACHE = new URL("data/cache/nyc_subway_stations_cache.json", ROOT);
const TRIP_CACHE = new URL("data/cache/techweek_subway_trip_cache.json", ROOT);

const DEFAULT_OUTPUT_DIR = new URL("outputs/signed_up/", ROOT);
const DEFAULT_SYNC_DIR = new URL("outputs/sync/", ROOT);
const OUTPUT_MD_NAME = "techweek_signed_up_transport_schedule.md";
const OUTPUT_CSV_NAME = "techweek_signed_up_transport_schedule.csv";
const OUTPUT_XLSX_NAME = "techweek_signed_up_transport_schedule.xlsx";
const SCHEDULE_ICS_NAME = "techweek_signed_up_operational_with_travel.ics";
const ALL_RSVP_ICS_NAME = "techweek_signed_up_all_rsvps_reference.ics";
const APPLE_SCRIPT_NAME = "sync_techweek_to_apple_calendar.applescript";

const SCHEDULE_CALENDAR = "NY Tech Week 2026 - Schedule";
const REFERENCE_CALENDAR = "NY Tech Week 2026 - All RSVPs";
const TZID = "America/New_York";
const UID_NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

type CsvRow = Record<string, string>;

interface LegacyGeocodeCacheRow {
  lat: number;
  lon: number;
  display_name?: string;
  displayName?: string;
  used_query?: string;
  usedQuery?: string;
}

interface SignedEvent extends OperationalRouteEvent {
  techweekId: string;
  techweek_id: string;
  eventKey: string;
  event_key: string;
  partifulId: string;
  partiful_id: string;
  canonicalName: string;
  canonical_name: string;
  status: string;
  statusLabel: string;
  status_label: string;
  category: string;
  categoryLabel: string;
  category_label: string;
  start: Date;
  start_dt: Date;
  end: Date;
  end_dt: Date;
  actualStart: Date;
  actual_start_dt: Date;
  actualEnd: Date;
  actual_end_dt: Date;
  date: string;
  weekday: string;
  location: string;
  venueQuery: string;
  venue_query: string;
  venuePrecision: string;
  venue_precision: string;
  rank: string;
  tier: string;
  opportunityScore: string;
  opportunity_score: string;
  fitSummary: string;
  fit_summary: string;
  eventUrl: string;
  event_url: string;
  googleMapsUrl: string;
  google_maps_url: string;
  nextStep: string;
  next_step: string;
  notes: string;
  routeNote: string;
  route_note: string;
  salesCoaching: string;
  sales_coaching: string;
}

export type CalendarRow = Omit<OperationalScheduleBlock, "calendar"> & {
  calendar: "schedule" | "reference";
  sourceEventId?: string;
};

export interface OutputPaths {
  md: URL;
  csv: URL;
  xlsx: URL;
  scheduleIcs: URL;
  allRsvpIcs: URL;
  appleScript: URL;
}

export interface BuildArtifacts {
  events: SignedEvent[];
  scheduleRows: CalendarRow[];
  allReferenceRows: CalendarRow[];
  referenceRows: CalendarRow[];
  combinedRows: CalendarRow[];
}

const STATUS_LABELS: Record<string, string> = {
  registered: "REG",
  applied: "PENDING",
  waitlisted: "WAITLIST",
};

const CATEGORY_LABELS: Record<string, string> = {
  primary: "PRIMARY",
  apply: "CURATED",
  backup: "BACKUP",
  "latest-added": "ADDED",
  "latest-added-route": "ADDED ROUTE",
};

const LOCATION_MAP_QUERIES: Record<string, string> = {
  [HOME_BASE_LOCATION]: HOME_BASE_LOCATION,
  "Financial District": "Financial District, New York, NY",
  "Flatiron": "Flatiron, New York, NY",
  "Lower East Side": "Lower East Side, New York, NY",
  "Midtown": "Midtown Manhattan, New York, NY",
  "SoHo": "SoHo, New York, NY",
  "Chelsea": "Chelsea, New York, NY",
  "Union Square": "Union Square, Manhattan, New York, NY",
  "East Village": "East Village, New York, NY",
  "Brooklyn": "Brooklyn, New York, NY",
};

const MANUAL_DURATIONS: Record<string, number> = {
  "6408": 60,
  "44": 60,
  "5978": 180,
  "5962": 180,
  "4551": 105,
  "4341": 90,
  "4161": 180,
  "4522": 180,
  "5925": 120,
  "5889": 75,
  "4444": 60,
  "5529": 75,
  "4664": 150,
  "5693": 120,
  "6642": 90,
  "5372": 180,
  "4191": 120,
  "5722": 180,
  "5437": 90,
  "5820": 210,
  "4719": 300,
  "4778": 120,
  "4197": 120,
  "4183": 180,
  "5114": 105,
  "5231": 120,
  "5207": 90,
  "250": 180,
};

const NEIGHBORHOOD_HINTS: Record<string, string> = {
  "Financial District": "Wall St, New York, NY",
  "Flatiron": "23rd Street and Broadway, New York, NY",
  "Union Square": "Union Square, Manhattan, New York, NY",
  "Lower East Side": "Delancey St Essex St, New York, NY",
  "Midtown": "Bryant Park, New York, NY",
  "SoHo": "Spring St and Broadway, New York, NY",
  "Chelsea": "23rd Street and 8th Avenue, New York, NY",
  "Nomad": "28th Street and Broadway, New York, NY",
  "NoHo": "Broadway-Lafayette St, New York, NY",
  "East Village": "Astor Place, New York, NY",
  "West Village": "West 4th Street Washington Square, New York, NY",
  "Greenwich Village": "West 4th Street Washington Square, New York, NY",
  "Tribeca": "Chambers St, New York, NY",
  "Brooklyn": "Barclays Center, Brooklyn, NY",
};

const NEIGHBORHOOD_POINTS: Record<string, [number, number]> = {
  "Financial District": [40.706821, -74.009100],
  "Flatiron": [40.740830, -73.986807],
  "Union Square": [40.735736, -73.990568],
  "Lower East Side": [40.718618, -73.988136],
  "Midtown": [40.753751, -73.983543],
  "SoHo": [40.724329, -73.997702],
  "Chelsea": [40.744081, -73.999562],
  "Nomad": [40.745800, -73.988800],
  "NoHo": [40.725297, -73.996204],
  "East Village": [40.729850, -73.991390],
  "West Village": [40.732338, -74.000495],
  "Greenwich Village": [40.732338, -74.000495],
  "Tribeca": [40.715478, -74.009266],
  "Brooklyn": [40.682511, -73.975252],
  "Hudson Yards": [40.754346, -74.002094],
};

const MANUAL_POINTS: readonly {
  pattern: RegExp;
  normalizedQuery: string;
  lat: number;
  lon: number;
}[] = [
  {
    pattern: /\b1155\s+6th\s+Ave/i,
    normalizedQuery: "1155 6th Ave, New York, NY 10036",
    lat: 40.7564611,
    lon: -73.9831996,
  },
  {
    pattern: /\b620\s+(?:Eighth|8th)\s+Ave/i,
    normalizedQuery: "620 8th Ave, New York, NY 10018",
    lat: 40.756326,
    lon: -73.990245,
  },
];

const EVENT_NOTES: Record<string, string> = {
  "5978": "If this is not approved, use registered backup NYC B2B at Skinos instead.",
  "5372": "Leave early if needed so you can make the registered 19:00 Stop Making AI Guess event.",
  "5114":
    "Registered direct. This is the Thursday anchor unless a substantially better curated dinner approves.",
  "6642":
    "Latest-feed add with no direct conflict; keep on the route if approved, otherwise use as a reference-only lunch option.",
  "5962": "Partiful registered only. Secondary Luma checkout is $20 and was explicitly skipped.",
  "4200":
    "Registered backup near FiDi. Use if Open Source Must Win is not approved or is too low signal in practice.",
};

const SALES_COACHING: Record<string, string> = {
  "6408": coaching(
    "Use the agent/spec theme. Say you are studying how specs, PRs, and Slack context survive agentic workflows.",
    "When an agent touches a ticket, what artifact proves who shaped the outcome?",
    "Specs as source of truth, issue quality, review quality, manager trust, missing context.",
    "Ask for 20 minutes with whoever owns engineering process or agent adoption.",
  ),
  "44": coaching(
    "Frame vibe coding as a team-process problem, not a solo productivity trick.",
    "What breaks when vibe coding becomes team development across reviews, specs, and handoffs?",
    "Review bottlenecks, low-trust AI output, unclear ownership, managers losing visibility.",
    "Send a short write-up on contribution evidence for AI-assisted teams.",
  ),
  "5978": coaching(
    "Open-source rooms should hear the maintainer-labor angle first.",
    "How do you credit review, triage, specs, and maintainer work that never becomes a commit?",
    "Contributor rewards, bounty systems, maintainer burnout, attribution disputes.",
    "Ask for intros to maintainers, DevRel leads, or teams running contributor programs.",
  ),
  "4551": coaching(
    "Use enterprise SDLC language: trustworthy artifacts, change control, and evidence trails.",
    "Which engineering artifacts stay reliable when AI changes how teams plan, review, and ship?",
    "Auditability, manager reports, PR review evidence, specs scattered across tools.",
    "Ask to compare their SDLC reporting process with an Accolades evidence report.",
  ),
  "4341": coaching(
    "This is the highest-priority CTO/platform room. Lead with the control-plane problem.",
    "What should managers measure once copilots are part of every development workflow?",
    "CTO/VP Eng pain, platform ownership, productivity reporting, GitHub/code review evidence.",
    "Push for a concrete post-Tech Week call if they own DevEx, platform, or engineering metrics.",
  ),
  "4161": coaching(
    "Use DevEx language and avoid sounding like HR analytics.",
    "Where does DevEx stop being tooling and start being contribution evidence?",
    "Internal developer platforms, friction measurement, review quality, invisible glue work.",
    "Ask who owns DevEx metrics and whether source-linked contribution evidence would help.",
  ),
  "5889": coaching(
    "Tie security and data controls to audit-ready engineering evidence.",
    "How are you proving AI-assisted engineering work was reviewed without leaking sensitive context?",
    "Security reviews, data access, compliance needs, audit trails, manager sign-off.",
    "Offer a follow-up focused on source-linked evidence without surveillance dashboards.",
  ),
  "4444": coaching(
    "Talk about the IDE as the point where human and agent work blur.",
    "When agents write code, what human work still needs credit?",
    "Prompting, spec writing, review corrections, architectural judgment, tool orchestration.",
    "Ask to sanity-check the Accolades framing with builders using coding agents daily.",
  ),
  "5529": coaching(
    "Use the event title directly: if agents are users, the system of record matters.",
    "If the agent is the user, what becomes the system of record for useful work?",
    "Tool schemas, docs, prompts, guardrails, review evidence, ownership boundaries.",
    "Ask for feedback on whether Accolades should track agent-orchestration evidence explicitly.",
  ),
  "4664": coaching(
    "MCP people will understand context plumbing. Map that to later evaluation.",
    "What context should tools expose so contribution can be evaluated after the work ships?",
    "Tool-call trails, context sources, agent actions, human review, integration ownership.",
    "Ask for technical feedback on evidence capture from tool and agent workflows.",
  ),
  "5372": coaching(
    "This is a direct AI-coding workflow room. Start with manager trust.",
    "What changed in your review process after AI started writing more code?",
    "Review overload, shallow approvals, unclear ownership, productivity claims without evidence.",
    "Ask for a buyer call with the engineering leader responsible for AI coding adoption.",
  ),
  "5114": coaching(
    "Use the codebase-as-spec theme and make Accolades feel complementary.",
    "What would make a codebase trustworthy enough for agents and managers?",
    "Source-linked context, specs in code, review trails, stale docs, manager confidence.",
    "Ask to exchange notes on codebase evidence and Accolades after the event.",
  ),
  "5722": coaching(
    "For agent fleet and autonomous systems people, focus on orchestration accountability.",
    "How do teams know who did useful orchestration, review, and correction work across agent fleets?",
    "Multi-agent coordination, operations work, incident reviews, hidden platform labor.",
    "Ask for intros to platform leads running agent or automation infrastructure.",
  ),
  "5110": coaching(
    "Use the Slack angle: work decisions often happen outside GitHub.",
    "Which important engineering decisions live in Slack, and do they ever make it into reviews or planning?",
    "Slack decisions, cross-functional handoffs, lost context, collaboration evidence.",
    "Ask whether Slack-linked contribution credit would help managers or team leads.",
  ),
  "5962": coaching(
    "Hardware and robotics teams have heavy coordination work before code ships.",
    "How do you credit specs, integration debugging, reviews, and ops work across hardware/software boundaries?",
    "Systems integration, test evidence, field debugging, cross-discipline ownership.",
    "Ask for founder/operator feedback rather than pushing a pure software-team sale.",
  ),
  "4200": coaching(
    "This is broad B2B. Keep the pitch short and qualify fast.",
    "Does your engineering team use GitHub and Slack heavily enough that contribution visibility is a management problem?",
    "Founder with 5+ engineers, remote team, AI coding adoption, performance-review pain.",
    "Ask for a warm intro to the CTO or VP Eng if the person is not the buyer.",
  ),
  "4522": coaching(
    "For MCP/control-plane conversations, talk about instrumenting context and actions.",
    "What needs to be logged so a manager can understand who influenced an agent-driven outcome?",
    "Context sources, tool permissions, traceability, review responsibility, platform ownership.",
    "Ask to compare notes with anyone building internal agent infrastructure.",
  ),
  "4224": coaching(
    "API and identity demos are a good opening for permissions plus evidence.",
    "When agents call internal APIs, how do you audit who requested, reviewed, and approved the work?",
    "API governance, permissions, review evidence, enterprise buyers, workflow logs.",
    "Ask for intros to teams responsible for developer platform or internal API governance.",
  ),
  "5415": coaching(
    "Use liability language carefully: evidence, review, and accountability.",
    "If AI-assisted work causes a problem, what evidence would you want before assigning responsibility?",
    "Audit trails, legal/compliance sensitivity, review records, decision provenance.",
    "Ask if source-linked engineering evidence would be useful for compliance conversations.",
  ),
  "5437": coaching(
    "Enterprise AI buyers care about governance and platform ownership.",
    "Where do manager reports and audit evidence fit into your enterprise AI rollout?",
    "Governance, internal platforms, production agents, executive reporting, risk controls.",
    "Ask for a specific post-event call with the platform, DevEx, or AI governance owner.",
  ),
  "5925": coaching(
    "Use infrastructure scale as the bridge into contribution evidence.",
    "In the agent era, what evidence do infra teams need to trust work done across tools and systems?",
    "Platform scale, agent infrastructure, toolchain visibility, engineering productivity.",
    "Ask for technical feedback from infra leaders rather than a generic founder follow-up.",
  ),
  "5820": coaching(
    "AI-native founders will understand the operating-model shift.",
    "How do AI-native teams evaluate human contribution when agents produce more of the visible output?",
    "Small teams scaling fast, agent-heavy workflows, contribution rewards, manager memory breaking down.",
    "Ask for a founder-to-founder product critique and one relevant buyer intro.",
  ),
  "4719": coaching(
    "Agent harnesses are about production reliability; connect that to human accountability.",
    "What human evidence needs to sit beside the harness output before an enterprise trusts agent work?",
    "Enterprise adoption, internal platforms, review gates, evaluation records, ownership.",
    "Ask to discuss how Accolades could consume evidence from agent harness workflows.",
  ),
  "4778": coaching(
    "This is a direct CTO room. Ask about pain before explaining the product.",
    "What is hardest for your managers to evaluate now that AI touches more engineering work?",
    "Performance reviews, planning evidence, PR quality, distributed-team context, DevEx ownership.",
    "If pain is clear, ask for a 20-minute CTO follow-up and permission to send a one-pager.",
  ),
  "5693": coaching(
    "Keep this practical: agents at work means work attribution is getting messy.",
    "When an agent helps ship something, who gets credit for the useful parts of the workflow?",
    "Agent orchestration, prompt/spec work, review corrections, workflow ownership.",
    "Ask for examples of workflows Accolades should recognize or avoid recognizing.",
  ),
  "4197": coaching(
    "Use leadership language: visibility without surveillance.",
    "What evidence do tech leaders wish they had for planning and reviews without turning into surveillance?",
    "Manager reporting, trust, team health, engineering productivity, executive visibility.",
    "Ask for a leadership-focused follow-up if they manage engineers or internal platforms.",
  ),
  "4191": coaching(
    "For agent scale, focus on attribution across many automated steps.",
    "When agents run at scale, how do you separate valuable human judgment from automated output?",
    "Evaluation gaps, agent ops, review ownership, platform labor, traceability.",
    "Ask to learn how they log agent work today and whether source-linked credit would fit.",
  ),
  "4826": coaching(
    "This is a live-demo room. Use your own build story, then ask about workflow data.",
    "Which parts of your AI workflow create useful evidence that managers should see later?",
    "Prompting, issue specs, PRs, Slack decisions, demos that could become repeatable workflows.",
    "Ask demo builders to name one evidence source Accolades should integrate first.",
  ),
  "4183": coaching(
    "This may be the best direct engineering-manager room. Be crisp and buyer-oriented.",
    "What do your managers use as evidence when deciding who moved a project forward?",
    "Performance-review pain, review quality, planning work, manager memory, team rewards.",
    "Ask for a concrete follow-up with the engineering leader or manager who owns the pain.",
  ),
  "5204": coaching(
    "This is less direct; use prediction and decision quality as the bridge.",
    "How do you know which people or artifacts actually improved a technical decision?",
    "Decision provenance, forecasts versus outcomes, accountability, source-linked context.",
    "Only pursue deep follow-up if they have an engineering team with GitHub/Slack pain.",
  ),
  "5231": coaching(
    "At dinner, sell softly. Use founder-to-founder learning first.",
    "How are AI builders changing how they reward and evaluate work inside their teams?",
    "AI-native operating models, fast-growing teams, founder pain, engineering leadership gaps.",
    "Ask for one sharp product critique and one relevant engineering-leader intro.",
  ),
  "5207": coaching(
    "Use the DM/agent framing to talk about decisions in conversational channels.",
    "When agents and teammates work in DMs, what context should be preserved for later credit or audit?",
    "Slack/DM work, agent conversations, missing provenance, informal decisions.",
    "Ask for feedback on Slack-first evidence capture if the person runs engineering workflows.",
  ),
  "250": coaching(
    "Treat this as a lower-pressure builder salon and look for AI-native founders.",
    "How does your team credit prompt work, specs, review, and product judgment around AI coding?",
    "Builder workflows, early team habits, contribution rewards, technical-founder pain.",
    "Ask for feedback or an intro; do not over-invest unless they match the ICP.",
  ),
};

function coaching(opening: string, ask: string, listenFor: string, followUp: string): string {
  return [
    "Sales coaching:",
    "Pitch: Accolades credits the engineering work commit counts miss, using source-linked GitHub and Slack evidence.",
    `Open: ${opening}`,
    `Ask: ${ask}`,
    `Listen for: ${listenFor}`,
    `Follow-up: ${followUp}`,
  ].join("\n");
}

class LegacyRoutingCache implements RoutingCacheAdapter {
  #tripCache: Record<string, SubwayTripEstimate> | null = null;

  async get<T>(key: CacheKey): Promise<T | null | undefined> {
    const group = String(key[1] ?? "");
    if (group !== "subway-trip") {
      return undefined;
    }
    const edge = String(key[key.length - 1] ?? "");
    const cache = await this.#readTripCache();
    return cache[edge] as T | undefined;
  }

  async set<T>(key: CacheKey, value: T): Promise<void> {
    const group = String(key[1] ?? "");
    if (group !== "subway-trip") {
      return;
    }
    const edge = String(key[key.length - 1] ?? "");
    const cache = await this.#readTripCache();
    cache[edge] = value as SubwayTripEstimate;
    await writeJson(TRIP_CACHE, cache);
  }

  async #readTripCache(): Promise<Record<string, SubwayTripEstimate>> {
    if (this.#tripCache) {
      return this.#tripCache;
    }
    this.#tripCache = await readJson<Record<string, SubwayTripEstimate>>(TRIP_CACHE, {});
    return this.#tripCache;
  }
}

export function parseCsvRecords(input: string): CsvRow[] {
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
  if (!headers) {
    return [];
  }
  return body.map((cells) => {
    const item: CsvRow = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] ?? "";
    });
    return item;
  });
}

export function eventKeyFromUrl(url: string): string {
  return url.match(/partiful\.com\/(?:e|events)\/([^?/#]+)/)?.[1] ?? "";
}

export function formatCsvRows(rows: readonly CalendarRow[]): string {
  if (rows.length === 0) {
    return "";
  }
  const lines = [
    CSV_FIELD_NAMES.map(csvCell).join(","),
    ...rows.map((row) =>
      CSV_FIELD_NAMES.map((name) => csvCell(flatCsvRow(row)[name] ?? "")).join(",")
    ),
  ];
  return `\ufeff${lines.join("\n")}\n`;
}

export async function buildSignedUpArtifacts(): Promise<BuildArtifacts> {
  const events = await loadSignedEvents();
  const stations = await readJson<SubwayStation[]>(STATION_CACHE, []);
  const scheduleRows = await buildOperationalRoute(events, {
    cache: new LegacyRoutingCache(),
    routeIds: DEFAULT_OPERATIONAL_ROUTE_IDS,
    stations,
  }) as CalendarRow[];
  const allReferenceRows = events.map(referenceEventRow);
  const scheduledEventIds = new Set(
    scheduleRows
      .filter((row) => row.entryType === "event")
      .map((row) => row.sourceEventId)
      .filter(Boolean),
  );
  const referenceRows = allReferenceRows.filter((row) => !scheduledEventIds.has(row.sourceEventId));
  const combinedRows = [...scheduleRows, ...referenceRows].sort(compareRows);
  return { events, scheduleRows, allReferenceRows, referenceRows, combinedRows };
}

async function loadSignedEvents(): Promise<SignedEvent[]> {
  const rerankRows = await readRankingRows();
  const statusRows = (await readCsv(STATUS_CSV)).filter((row) => row.category !== "test");
  const rerankByKey = new Map(rerankRows.map((row) => [eventKeyFromUrl(row.event_url), row]));
  const geocodeCache = await readJson<Record<string, LegacyGeocodeCacheRow>>(GEOCODE_CACHE, {});
  const events: SignedEvent[] = [];
  const missing: string[] = [];

  for (const statusRow of statusRows) {
    const key = eventKeyFromUrl(statusRow.partiful_url);
    const rerankRow = rerankByKey.get(key);
    if (!rerankRow) {
      missing.push(statusRow.event_name);
      continue;
    }
    const start = parseStart(rerankRow);
    const end = await eventEndFromPage(rerankRow, start);
    const { point, venueQuery, venuePrecision, displayLocation } = await venueForEvent(
      rerankRow,
      statusRow,
      geocodeCache,
    );
    const rank = rowValue(rerankRow, "rank", "\ufeffrank");
    const techweekId = techweekIdFor(rerankRow.id);
    const statusLabel = STATUS_LABELS[statusRow.status] ?? statusRow.status.toUpperCase();
    const categoryLabel = CATEGORY_LABELS[statusRow.category] ?? statusRow.category.toUpperCase();

    events.push({
      id: rerankRow.id,
      techweekId,
      techweek_id: techweekId,
      eventKey: key,
      event_key: key,
      partifulId: key,
      partiful_id: key,
      name: statusRow.event_name,
      canonicalName: rerankRow.name,
      canonical_name: rerankRow.name,
      category: statusRow.category,
      status: statusRow.status,
      statusLabel,
      status_label: statusLabel,
      categoryLabel,
      category_label: categoryLabel,
      start,
      start_dt: start,
      end,
      end_dt: end,
      actualStart: start,
      actual_start_dt: start,
      actualEnd: end,
      actual_end_dt: end,
      date: rerankRow.date,
      weekday: rerankRow.weekday,
      location: displayLocation,
      venueQuery,
      venue_query: venueQuery,
      venuePrecision,
      venue_precision: venuePrecision,
      point,
      rank,
      tier: rerankRow.tier ?? "",
      opportunityScore: rerankRow.opportunity_score ?? "",
      opportunity_score: rerankRow.opportunity_score ?? "",
      fitSummary: rerankRow.fit_summary ?? "",
      fit_summary: rerankRow.fit_summary ?? "",
      eventUrl: statusRow.partiful_url,
      event_url: statusRow.partiful_url,
      googleMapsUrl: mappedGoogleMapsSearchUrl(venueQuery || displayLocation),
      google_maps_url: mappedGoogleMapsSearchUrl(venueQuery || displayLocation),
      nextStep: statusRow.next_step ?? "",
      next_step: statusRow.next_step ?? "",
      notes: statusRow.notes ?? "",
      routeNote: EVENT_NOTES[rerankRow.id] ?? "",
      route_note: EVENT_NOTES[rerankRow.id] ?? "",
      salesCoaching: SALES_COACHING[rerankRow.id] ?? "",
      sales_coaching: SALES_COACHING[rerankRow.id] ?? "",
    });
  }

  if (missing.length > 0) {
    console.warn(`Missing rerank matches: ${missing.join("; ")}`);
  }

  return events.sort((a, b) =>
    a.start.getTime() - b.start.getTime() ||
    a.category.localeCompare(b.category) ||
    a.name.localeCompare(b.name)
  );
}

async function readRankingRows(): Promise<CsvRow[]> {
  const rows = await readCsv(RERANK_CSV);
  const seen = new Set(rows.map((row) => eventKeyFromUrl(row.event_url)));
  try {
    const addedRows = await readCsv(ADDED_RANKING_CSV);
    for (const [index, row] of addedRows.entries()) {
      const key = eventKeyFromUrl(row.event_url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(normalizeAddedRankingRow(row, index));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return rows;
}

function normalizeAddedRankingRow(row: CsvRow, index: number): CsvRow {
  return {
    ...row,
    description_excerpt: row.rationale ?? "",
    event_description: row.rationale ?? "",
    fetch_error: "",
    fetch_status: row.fetch_status || "latest_feed",
    final_url: row.event_url,
    fit_summary: row.rationale ?? "",
    local_html_path: "",
    page_title: row.name,
    rank: row.rank || `added-${index + 1}`,
    recommended_action: row.tier === "A" ? "Apply first" : "Apply if useful",
  };
}

async function venueForEvent(
  rerankRow: CsvRow,
  statusRow: CsvRow,
  geocodeCache: Record<string, LegacyGeocodeCacheRow>,
): Promise<{
  point: RoutePoint;
  venueQuery: string;
  venuePrecision: string;
  displayLocation: string;
}> {
  const extracted = await extractVenue(rerankRow, geocodeCache);
  let point = extracted.point;
  let venueQuery = extracted.venueQuery;
  let venuePrecision = extracted.venuePrecision;
  let displayLocation = statusRow.venue_revealed || rerankRow.location || venueQuery;

  const manual = manualPointForQuery(rerankRow.name, venueQuery);
  if (manual) {
    point = manual.point;
    venueQuery = manual.venueQuery;
    venuePrecision = manual.venuePrecision;
  }

  const revealed = (statusRow.venue_revealed ?? "").trim();
  if (statusLocationIsExact(revealed)) {
    const query = cleanAddress(revealed);
    const manualRevealed = manualPointForQuery(rerankRow.name, query);
    if (manualRevealed) {
      return {
        point: manualRevealed.point,
        venueQuery: manualRevealed.venueQuery,
        venuePrecision: manualRevealed.venuePrecision,
        displayLocation: manualRevealed.venueQuery,
      };
    }
    try {
      const geo = await geocodeQuery(query, geocodeCache);
      if (geocodeIsUsable(geo)) {
        point = routePoint(
          rerankRow.name,
          query,
          "exact_from_signup_status",
          Number(geo.lat),
          Number(geo.lon),
          rerankRow.location,
        );
        venueQuery = query;
        venuePrecision = "exact_from_signup_status";
        displayLocation = query;
      }
    } catch {
      // Keep the event-page location if the RSVP text is not geocodable.
    }
  }

  return { point, venueQuery, venuePrecision, displayLocation };
}

async function extractVenue(
  row: CsvRow,
  geocodeCache: Record<string, LegacyGeocodeCacheRow>,
): Promise<{ point: RoutePoint; venueQuery: string; venuePrecision: string }> {
  const htmlPath = await localHtmlPath(row);
  const html = htmlPath ? await Deno.readTextFile(htmlPath).catch(() => "") : "";
  const eventJson = jsonldEvent(html);
  const location = asRecord(eventJson.location);
  let venueName = "";
  let address = "";
  let query = "";
  let precision = "approx_neighborhood";

  if (Object.keys(location).length > 0) {
    venueName = stringValue(location.name);
    const addressValue = location.address;
    if (addressValue && typeof addressValue === "object" && !Array.isArray(addressValue)) {
      const addressRecord = addressValue as Record<string, unknown>;
      address = ["streetAddress", "addressLocality", "addressRegion", "postalCode"]
        .map((key) => stringValue(addressRecord[key]))
        .filter(Boolean)
        .join(", ");
    } else {
      address = stringValue(addressValue);
    }
  }

  if (address && /\d/.test(address) && address.toLowerCase().includes("new york")) {
    query = cleanAddress(address);
    if (venueName && !["new york, ny", "new york"].includes(venueName.toLowerCase())) {
      query = `${venueName}, ${query}`;
    }
    precision = "exact_from_event_page";
  } else {
    const locInfo = asRecord(rawJsonDecodeAfter(html, '"locationInfo":'));
    const mapsInfo = asRecord(locInfo.mapsInfo);
    if (Object.keys(mapsInfo).length > 0) {
      venueName = venueName || stringValue(mapsInfo.name);
      const addressLines = Array.isArray(mapsInfo.addressLines)
        ? mapsInfo.addressLines.map(String)
        : [];
      const joined = addressLines.join(", ");
      if (joined && /\d/.test(joined) && joined.includes("NY")) {
        query = cleanAddress(joined);
        if (venueName && !["new york, ny", "new york"].includes(venueName.toLowerCase())) {
          query = `${venueName}, ${query}`;
        }
        precision = "exact_from_partiful_maps";
      } else {
        query = neighborhoodQuery(row.location);
        precision = "approx_neighborhood_hidden";
      }
    } else if (locInfo.type === "freeform") {
      query = neighborhoodQuery(row.location);
      precision = "approx_freeform_hidden";
    } else {
      query = neighborhoodQuery(row.location);
      precision = "approx_from_calendar_location";
    }
  }

  const neighborhoodPoint = NEIGHBORHOOD_POINTS[row.location];
  if (precision.startsWith("approx") && neighborhoodPoint) {
    const [lat, lon] = neighborhoodPoint;
    return {
      point: routePoint(row.name, query, precision, lat, lon, row.location),
      venueQuery: query,
      venuePrecision: precision,
    };
  }

  const geo = await geocodeQuery(query, geocodeCache);
  return {
    point: routePoint(row.name, query, precision, Number(geo.lat), Number(geo.lon), row.location),
    venueQuery: query,
    venuePrecision: precision,
  };
}

async function geocodeQuery(
  query: string,
  cache: Record<string, LegacyGeocodeCacheRow>,
): Promise<LegacyGeocodeCacheRow> {
  const cleaned = cleanAddress(query);
  if (cache[cleaned]) {
    return cache[cleaned];
  }
  const result = await routingGeocode(cleaned);
  const legacy = {
    lat: result.lat,
    lon: result.lon,
    display_name: result.displayName,
    used_query: result.usedQuery,
  };
  cache[cleaned] = legacy;
  await writeJson(GEOCODE_CACHE, cache);
  return legacy;
}

function manualPointForQuery(
  name: string,
  query: string,
): { point: RoutePoint; venueQuery: string; venuePrecision: string } | null {
  for (const manual of MANUAL_POINTS) {
    if (manual.pattern.test(query || "")) {
      return {
        point: routePoint(
          name,
          manual.normalizedQuery,
          "manual_exact_manhattan",
          manual.lat,
          manual.lon,
        ),
        venueQuery: manual.normalizedQuery,
        venuePrecision: "manual_exact_manhattan",
      };
    }
  }
  return null;
}

function routePoint(
  name: string,
  query: string,
  precision: string,
  lat: number,
  lon: number,
  location = query,
): RoutePoint {
  return {
    name,
    query,
    venueQuery: query,
    venue_query: query,
    precision,
    addressPrecision: precision,
    address_precision: precision,
    location,
    lat,
    lon,
  };
}

function referenceEventRow(event: SignedEvent): CalendarRow {
  const note = joinParts([event.routeNote, event.nextStep, event.notes]);
  return {
    entryType: "event",
    calendar: "reference",
    start: event.start,
    end: event.end,
    actualStart: event.actualStart,
    actualEnd: event.actualEnd,
    title: `[${event.statusLabel} ${event.categoryLabel}] ${event.name}`,
    location: event.location,
    techweekId: event.techweekId,
    calendarBlockId: `${event.techweekId}-REFERENCE`,
    partifulId: event.partifulId,
    status: event.status,
    statusLabel: event.statusLabel,
    category: event.category,
    categoryLabel: event.categoryLabel,
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    subwaySegments: "",
    transitRisk: "",
    note,
    eventUrl: event.eventUrl,
    googleMapsUrl: event.googleMapsUrl,
    rank: event.rank,
    tier: event.tier,
    opportunityScore: event.opportunityScore,
    fitSummary: event.fitSummary,
    venueQuery: event.venueQuery,
    venuePrecision: event.venuePrecision,
    nextStep: event.nextStep,
    notes: event.notes,
    salesCoaching: event.salesCoaching,
    sourceEventId: event.id,
  };
}

function writeMarkdown(
  scheduleRows: readonly CalendarRow[],
  referenceRows: readonly CalendarRow[],
  allReferenceRows: readonly CalendarRow[],
): string {
  const statusCounts = new Map<string, number>();
  for (const row of allReferenceRows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  }
  return [
    "# Signed-Up NYC Tech Week Schedule",
    "",
    `Home anchor: ${HOME_BASE_LOCATION}. Travel blocks use OSM/Nominatim geocoding plus SubwayInfo.nyc station-trip estimates where subway beats walking. Hidden venues use neighborhood centroids until hosts reveal exact addresses.`,
    "",
    "The operational calendar is the route to actually keep open. It includes events, transit, meal/reset blocks, staggered late 8-hour sleep blocks, and Google Maps links in every block's notes. The all-RSVP calendar excludes scheduled route events, so enabling both calendars does not render duplicate event blocks.",
    "",
    `RSVP status snapshot: ${statusCounts.get("registered") ?? 0} registered, ${
      statusCounts.get("applied") ?? 0
    } applied, ${statusCounts.get("waitlisted") ?? 0} waitlisted.`,
    `All-RSVP calendar rows after scheduled-event dedupe: ${referenceRows.length}.`,
    "",
    "## Operational Route With Transit",
    "",
    mdDaySections(scheduleRows),
    "",
    "## All RSVP Reference, Scheduled Events Removed",
    "",
    "Use this as a toggleable reference calendar for alternatives, backups, and pending approvals not already on the operational route. Many entries conflict by design.",
    "",
    mdDaySections(referenceRows),
    "",
    "## Files",
    "",
    `- Operational import: \`outputs/signed_up/${SCHEDULE_ICS_NAME}\``,
    `- All-RSVP reference import: \`outputs/signed_up/${ALL_RSVP_ICS_NAME}\``,
    `- Spreadsheet: \`outputs/signed_up/${OUTPUT_XLSX_NAME}\``,
    `- CSV: \`outputs/signed_up/${OUTPUT_CSV_NAME}\``,
    `- Apple Calendar sync script: \`outputs/sync/${APPLE_SCRIPT_NAME}\``,
  ].join("\n") + "\n";
}

function mdDaySections(rows: readonly CalendarRow[]): string {
  const lines: string[] = [];
  let currentDate = "";
  for (const row of [...rows].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const dateLabel = `${weekdayName(row.start)}, ${localDateKey(row.start)}`;
    if (dateLabel !== currentDate) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(`### ${dateLabel}`);
      lines.push("");
      currentDate = dateLabel;
    }
    const timeRange = `${formatLocalTime(row.start)}-${formatLocalTime(row.end)}`;
    if (row.entryType === "travel") {
      lines.push(`- ${timeRange} | Travel | ${row.routeMode} | ${row.title}`);
      lines.push(`  - ${row.travelMinutes} min: ${row.routeDetails}`);
      const mapsUrl = rowGoogleMapsUrl(row);
      if (mapsUrl) {
        lines.push(`  - Google Maps: ${mapsUrl}`);
      }
      if (row.note) {
        lines.push(`  - ${row.note}`);
      }
      continue;
    }
    if (row.entryType === "meal" || row.entryType === "sleep") {
      lines.push(`- ${timeRange} | ${row.location} | ${row.title}`);
      const mapsUrl = rowGoogleMapsUrl(row);
      if (mapsUrl) {
        lines.push(`  - Google Maps: ${mapsUrl}`);
      }
      if (row.note) {
        lines.push(`  - ${row.note}`);
      }
      continue;
    }
    const link = `[${row.title}](${row.eventUrl})`;
    lines.push(`- ${timeRange} | ${row.location} | ${link}`);
    if (row.actualEnd.getTime() !== row.end.getTime()) {
      lines.push(
        `  - Scheduled event end: ${
          formatLocalTime(row.actualEnd)
        }; route calendar plans an earlier departure.`,
      );
    }
    if (row.note) {
      lines.push(`  - ${row.note}`);
    }
    const mapsUrl = rowGoogleMapsUrl(row);
    if (mapsUrl) {
      lines.push(`  - Google Maps: ${mapsUrl}`);
    }
    if (row.salesCoaching) {
      lines.push(`  - ${row.salesCoaching.replaceAll("\n", "\n  - ")}`);
    }
    lines.push(`  - Venue basis: ${row.venueQuery} (${row.venuePrecision})`);
    lines.push(
      `  - Rank ${row.rank}, tier ${row.tier}, score ${row.opportunityScore}; ${row.fitSummary}`,
    );
  }
  return lines.join("\n");
}

async function writeIcs(
  rows: readonly CalendarRow[],
  calendarName: string,
  transparent: boolean,
): Promise<string> {
  const now = formatUtcDateTime(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UbiquityOS//Tech Week Signed-Up Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    `X-WR-TIMEZONE:${TZID}`,
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (
    const row of [...rows].sort((a, b) =>
      a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title)
    )
  ) {
    const uidSource = row.calendarBlockId ||
      `${calendarName}-${row.title}-${formatDateTime(row.start)}-${formatDateTime(row.end)}`;
    const uid = await uuid5(uidSource);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@techweek-2026-event-picker`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${TZID}:${formatDateTime(row.start)}`,
      `DTEND;TZID=${TZID}:${formatDateTime(row.end)}`,
      `SUMMARY:${escapeIcs(row.title)}`,
      `LOCATION:${escapeIcs(row.location || row.venueQuery)}`,
      `DESCRIPTION:${escapeIcs(descriptionForRow(row))}`,
      `STATUS:${icsStatus(row)}`,
      `TRANSP:${transparent ? "TRANSPARENT" : "OPAQUE"}`,
    );
    if (row.eventUrl) {
      lines.push(`URL:${escapeIcs(row.eventUrl)}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return lines.flatMap(foldIcsLine).join("\r\n") + "\r\n";
}

function descriptionForRow(row: CalendarRow): string {
  return joinPartsWithNewlines([
    `TechWeekID: ${row.techweekId}`,
    `CalendarBlockID: ${row.calendarBlockId}`,
    `RerankID: ${row.sourceEventId ?? ""}`,
    `PartifulID: ${row.partifulId}`,
    row.note,
    row.routeDetails,
    row.salesCoaching,
    `RSVP status: ${row.status}`,
    `Category: ${row.category}`,
    `Venue basis: ${row.venueQuery} (${row.venuePrecision})`,
    rowGoogleMapsUrl(row) ? `Google Maps: ${rowGoogleMapsUrl(row)}` : "",
    `Rank/tier/score: ${row.rank} / ${row.tier} / ${row.opportunityScore}`,
    `URL: ${row.eventUrl}`,
  ]);
}

function flatCsvRow(row: CalendarRow): Record<string, string> {
  return {
    calendar: row.calendar,
    techweek_id: row.techweekId,
    calendar_block_id: row.calendarBlockId,
    partiful_id: row.partifulId,
    rerank_id: row.sourceEventId ?? "",
    entry_type: row.entryType,
    status: row.status,
    category: row.category,
    start: formatHumanDateTime(row.start),
    end: formatHumanDateTime(row.end),
    actual_start: formatHumanDateTime(row.actualStart),
    actual_end: formatHumanDateTime(row.actualEnd),
    title: row.title,
    location: row.location,
    venue_query: row.venueQuery,
    venue_precision: row.venuePrecision,
    route_mode: String(row.routeMode),
    travel_minutes: String(row.travelMinutes),
    route_details: row.routeDetails,
    subway_segments: row.subwaySegments,
    transit_risk: row.transitRisk,
    note: row.note,
    sales_coaching: row.salesCoaching,
    rank: row.rank,
    tier: row.tier,
    opportunity_score: row.opportunityScore,
    event_url: row.eventUrl,
    google_maps_url: rowGoogleMapsUrl(row),
  };
}

const CSV_FIELD_NAMES = [
  "calendar",
  "techweek_id",
  "calendar_block_id",
  "partiful_id",
  "rerank_id",
  "entry_type",
  "status",
  "category",
  "start",
  "end",
  "actual_start",
  "actual_end",
  "title",
  "location",
  "venue_query",
  "venue_precision",
  "route_mode",
  "travel_minutes",
  "route_details",
  "subway_segments",
  "transit_risk",
  "note",
  "sales_coaching",
  "rank",
  "tier",
  "opportunity_score",
  "event_url",
  "google_maps_url",
];

function writeXlsx(rows: CalendarRow[]): Uint8Array {
  const flatRows = rows.map(flatCsvRow);
  const headers = CSV_FIELD_NAMES;
  const sheetRows = [
    headers,
    ...flatRows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
  const sheetData = sheetRows
    .map((cells, rowIndex) =>
      `<row r="${rowIndex + 1}">${
        cells.map((value, columnIndex) =>
          `<c r="${xlsxCellRef(rowIndex + 1, columnIndex)}" t="inlineStr"><is><t>${
            xmlEscape(value)
          }</t></is></c>`
        ).join("")
      }</row>`
    )
    .join("");
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: textBytes(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: textBytes(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: textBytes(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Schedule" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: textBytes(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: textBytes(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<sheetData>${sheetData}</sheetData>` +
          `</worksheet>`,
      ),
    },
  ]);
}

function xlsxCellRef(row: number, columnIndex: number): string {
  let index = columnIndex + 1;
  let letters = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return `${letters}${row}`;
}

function writeAppleScript(scheduleRows: CalendarRow[], referenceRows: CalendarRow[]): string {
  const lines = [
    "-- Generated by scripts/build_signed_up_calendar.ts",
    'tell application "Calendar"',
    `\tset scheduleName to ${applescriptString(SCHEDULE_CALENDAR)}`,
    `\tset referenceName to ${applescriptString(REFERENCE_CALENDAR)}`,
    "\tif not (exists calendar scheduleName) then make new calendar with properties {name:scheduleName}",
    "\tif not (exists calendar referenceName) then make new calendar with properties {name:referenceName}",
    "\tset scheduleCal to calendar scheduleName",
    "\tset referenceCal to calendar referenceName",
    ...scheduleRows.map((row) => `\t${applescriptEvent(row, "scheduleCal")}`),
    ...referenceRows.map((row) => `\t${applescriptEvent(row, "referenceCal")}`),
    "end tell",
    "",
  ];
  return lines.join("\n");
}

function applescriptEvent(row: CalendarRow, calendarVariable: string): string {
  return `make new event at end of events of ${calendarVariable} with properties {summary:${
    applescriptString(row.title)
  }, start date:${applescriptDate(row.start)}, end date:${applescriptDate(row.end)}, location:${
    applescriptString(row.location)
  }, description:${applescriptString(descriptionForRow(row))}}`;
}

function applescriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function applescriptDate(value: Date): string {
  return `date ${applescriptString(formatHumanDateTime(value))}`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

type ZipEntry = {
  name: string;
  data: Uint8Array;
};

function zipStore(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textBytes(entry.name);
    const crc = crc32(entry.data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    chunks.push(local);
    centralDirectory.push(concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += local.length;
  }
  const central = concatBytes(centralDirectory);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...chunks, central, end]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export async function writeOutputs(artifacts: BuildArtifacts, paths: OutputPaths): Promise<void> {
  for (const path of Object.values(paths)) {
    await Deno.mkdir(new URL(".", path), { recursive: true });
  }
  await Deno.writeTextFile(
    paths.md,
    writeMarkdown(artifacts.scheduleRows, artifacts.referenceRows, artifacts.allReferenceRows),
  );
  await Deno.writeTextFile(paths.csv, formatCsvRows(artifacts.combinedRows));
  await Deno.writeFile(paths.xlsx, writeXlsx(artifacts.combinedRows));
  await Deno.writeTextFile(
    paths.scheduleIcs,
    await writeIcs(artifacts.scheduleRows, SCHEDULE_CALENDAR, false),
  );
  await Deno.writeTextFile(
    paths.allRsvpIcs,
    await writeIcs(artifacts.referenceRows, REFERENCE_CALENDAR, true),
  );
  await Deno.writeTextFile(
    paths.appleScript,
    writeAppleScript(
      artifacts.scheduleRows,
      artifacts.referenceRows,
    ),
  );
}

function outputPaths(outputDir: URL): OutputPaths {
  return {
    md: new URL(OUTPUT_MD_NAME, outputDir),
    csv: new URL(OUTPUT_CSV_NAME, outputDir),
    xlsx: new URL(OUTPUT_XLSX_NAME, outputDir),
    scheduleIcs: new URL(SCHEDULE_ICS_NAME, outputDir),
    allRsvpIcs: new URL(ALL_RSVP_ICS_NAME, outputDir),
    appleScript: new URL(APPLE_SCRIPT_NAME, DEFAULT_SYNC_DIR),
  };
}

function parseArgs(args: readonly string[]): { dryRun: boolean; outputDir: URL } {
  let dryRun = false;
  let outputDir = DEFAULT_OUTPUT_DIR;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--output-dir") {
      const value = args[++i];
      if (!value) {
        throw new Error("--output-dir requires a path.");
      }
      outputDir = directoryUrl(value);
    } else if (arg.startsWith("--output-dir=")) {
      outputDir = directoryUrl(arg.slice("--output-dir=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun, outputDir };
}

async function main(): Promise<void> {
  const { dryRun, outputDir } = parseArgs(Deno.args);
  const paths = outputPaths(outputDir);
  const artifacts = await buildSignedUpArtifacts();
  if (!dryRun) {
    await writeOutputs(artifacts, paths);
  }
  const scheduleEvents = artifacts.scheduleRows.filter((row) => row.entryType === "event").length;
  console.log(
    [
      dryRun ? "built signed-up schedule (dry run)" : "wrote signed-up schedule",
      `events=${artifacts.events.length}`,
      `schedule_rows=${artifacts.scheduleRows.length}`,
      `schedule_events=${scheduleEvents}`,
      `reference_rows=${artifacts.referenceRows.length}`,
      `csv=${relativePath(paths.csv)}`,
      `md=${relativePath(paths.md)}`,
      `schedule_ics=${relativePath(paths.scheduleIcs)}`,
      `reference_ics=${relativePath(paths.allRsvpIcs)}`,
    ].join("\n"),
  );
}

function rowGoogleMapsUrl(row: CalendarRow): string {
  if (row.entryType === "meal" || row.entryType === "sleep") {
    return mappedGoogleMapsSearchUrl(row.venueQuery || row.location);
  }
  if (row.googleMapsUrl) {
    return row.googleMapsUrl;
  }
  if (row.entryType === "travel" && row.location.includes(" -> ")) {
    const [origin, destination] = row.location.split(" -> ", 2);
    return googleMapsDirectionsUrl(
      mapsQueryForLocation(origin),
      mapsQueryForLocation(destination),
      row.routeMode,
    );
  }
  return mappedGoogleMapsSearchUrl(row.venueQuery || row.location);
}

function mappedGoogleMapsSearchUrl(query: string): string {
  const mapped = mapsQueryForLocation(query);
  return mapped ? googleMapsSearchUrl(mapped) : "";
}

function googleMapsDirectionsUrl(
  origin: string,
  destination: string,
  routeMode: RouteMode | "" = "",
): string {
  if (!origin || !destination) {
    return "";
  }
  const params = new URLSearchParams({ api: "1", origin, destination });
  if (routeMode === "walk") {
    params.set("travelmode", "walking");
  } else if (routeMode === "subway+walk") {
    params.set("travelmode", "transit");
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function mapsQueryForLocation(location: string): string {
  const trimmed = String(location || "").trim();
  return LOCATION_MAP_QUERIES[trimmed] ?? trimmed;
}

async function eventEndFromPage(row: CsvRow, start: Date): Promise<Date> {
  const htmlPath = await localHtmlPath(row);
  if (htmlPath) {
    const html = await Deno.readTextFile(htmlPath).catch(() => "");
    const eventJson = jsonldEvent(html);
    const end = localDateTimeFromUtc(stringValue(eventJson.endDate));
    if (end && end.getTime() > start.getTime() && end.getTime() <= addHours(start, 10).getTime()) {
      return end;
    }
  }
  return addMinutes(start, MANUAL_DURATIONS[row.id] ?? 90);
}

async function localHtmlPath(row: CsvRow): Promise<URL | null> {
  const text = row.local_html_path || "";
  if (!text) {
    return null;
  }
  const direct = pathUrl(text);
  if (await exists(direct)) {
    return direct;
  }
  const moved = new URL(basename(text), EVENT_PAGES_DIR);
  return await exists(moved) ? moved : null;
}

function jsonldEvent(html: string): Record<string, unknown> {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]));
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of values) {
        const record = asRecord(item);
        if (record["@type"] === "Event") {
          return record;
        }
      }
    } catch {
      // Ignore malformed embedded JSON-LD.
    }
  }
  return {};
}

function rawJsonDecodeAfter(text: string, marker: string): unknown {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  let start = markerIndex + marker.length;
  while (/\s/.test(text[start] ?? "")) {
    start++;
  }
  const opener = text[start];
  if (opener !== "{" && opener !== "[") {
    if (text.slice(start, start + 4) === "null") {
      return null;
    }
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseStart(row: CsvRow): Date {
  const [year, month, day] = row.date.split("-").map(Number);
  const [hour, minute, second = 0] = row.time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function localDateTimeFromUtc(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return addHours(parsed, -4);
}

function statusLocationIsExact(value: string): boolean {
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  if (["tbc", "tbd", "new york, ny"].includes(lower)) {
    return false;
  }
  return /\d/.test(value) && lower.includes("ny");
}

function geocodeIsUsable(geo: LegacyGeocodeCacheRow): boolean {
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);
  const displayName = stringValue(geo.display_name ?? geo.displayName);
  if (!(40.65 <= lat && lat <= 40.88 && -74.04 <= lon && lon <= -73.90)) {
    return false;
  }
  return !["new york, united states", "new york, new york, united states"].includes(
    displayName.toLowerCase(),
  );
}

function neighborhoodQuery(location: string): string {
  return NEIGHBORHOOD_HINTS[location] ?? `${location}, Manhattan, NY`;
}

function compareRows(a: CalendarRow, b: CalendarRow): number {
  return a.start.getTime() - b.start.getTime() ||
    a.calendar.localeCompare(b.calendar) ||
    a.title.localeCompare(b.title);
}

function icsStatus(row: CalendarRow): string {
  if (
    row.entryType === "travel" || row.entryType === "meal" || row.entryType === "sleep" ||
    row.status === "registered"
  ) {
    return "CONFIRMED";
  }
  return "TENTATIVE";
}

function escapeIcs(value: string): string {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

export function foldIcsLine(line: string): string[] {
  const encoded = new TextEncoder().encode(line);
  if (encoded.length <= 75) {
    return [line];
  }
  const chunks: string[] = [];
  let current = "";
  let currentLength = 0;
  for (const char of line) {
    const charLength = new TextEncoder().encode(char).length;
    if (current && currentLength + charLength > 75) {
      chunks.push(current);
      current = ` ${char}`;
      currentLength = 1 + charLength;
    } else {
      current += char;
      currentLength += charLength;
    }
  }
  chunks.push(current);
  return chunks;
}

async function uuid5(name: string): Promise<string> {
  const namespace = uuidToBytes(UID_NAMESPACE_URL);
  const nameBytes = new TextEncoder().encode(name);
  const bytes = new Uint8Array(namespace.length + nameBytes.length);
  bytes.set(namespace);
  bytes.set(nameBytes, namespace.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  const uuid = hash.slice(0, 16);
  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  return bytesToUuid(uuid);
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

async function readCsv(path: URL): Promise<CsvRow[]> {
  return parseCsvRecords(await Deno.readTextFile(path));
}

async function readJson<T>(path: URL, fallback: T): Promise<T> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(path: URL, value: unknown): Promise<void> {
  await Deno.mkdir(new URL(".", path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: URL): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function pathUrl(path: string): URL {
  if (path.startsWith("/")) {
    return new URL(`file://${encodeURI(path)}`);
  }
  return new URL(path, ROOT);
}

function directoryUrl(path: string): URL {
  const url = pathUrl(path);
  return url.href.endsWith("/") ? url : new URL(`${url.href}/`);
}

function relativePath(path: URL): string {
  if (path.href.startsWith(ROOT.href)) {
    return decodeURIComponent(path.pathname.replace(ROOT.pathname, ""));
  }
  return decodeURIComponent(path.pathname);
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function rowValue(row: CsvRow, ...keys: string[]): string {
  for (const key of keys) {
    if (row[key]) {
      return row[key];
    }
  }
  return "";
}

function techweekIdFor(id: string): string {
  return `TW-${id}`;
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function addHours(value: Date, hours: number): Date {
  return addMinutes(value, hours * 60);
}

function formatLocalTime(value: Date): string {
  return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
}

function localDateKey(value: Date): string {
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

function formatHumanDateTime(value: Date): string {
  return `${localDateKey(value)} ${formatLocalTime(value)}`;
}

function formatDateTime(value: Date): string {
  return `${value.getUTCFullYear()}${pad2(value.getUTCMonth() + 1)}${pad2(value.getUTCDate())}T${
    pad2(value.getUTCHours())
  }${pad2(value.getUTCMinutes())}${pad2(value.getUTCSeconds())}`;
}

function formatUtcDateTime(value: Date): string {
  return `${value.getUTCFullYear()}${pad2(value.getUTCMonth() + 1)}${pad2(value.getUTCDate())}T${
    pad2(value.getUTCHours())
  }${pad2(value.getUTCMinutes())}${pad2(value.getUTCSeconds())}Z`;
}

function weekdayName(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(value);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return named[lower] ?? match;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function joinParts(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function joinPartsWithNewlines(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join("\n");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

if (import.meta.main) {
  await main();
}
