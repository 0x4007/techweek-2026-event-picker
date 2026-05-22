import {
  type AgendaBlock,
  type AgendaRecalculateResult,
  type AgendaRouteEstimate,
  type AgendaRouteEstimateRequest,
  type AgendaScheduleEntry,
  recalculateAgenda,
} from "./agenda_recalculate.ts";
import {
  type AgendaSignalPreference,
  type AgendaUserPreferencesInput,
  DEFAULT_AGENDA_USER_PREFERENCES,
} from "./agenda_preferences.ts";

const DEFAULT_TIME_ZONE = "America/New_York";
const DEFAULT_EVENT_DURATION_MINUTES = 60;
const DEFAULT_TRAVEL_MINUTES = 30;
const MAX_SOURCE_TEXT_CHARS = 200_000;
const MAX_IMPORT_EVENTS = 500;
const MAX_PLANNER_PLANS = 50;

export type PlannerEventSourceType = "csv" | "text";

export type PlannerProfile = {
  version: 1;
  displayName: string;
  timeZone: string;
  homeBase: string;
  preferencePrompt: string;
  priorityPrompt: string;
  logisticsPrompt: string;
  defaultEventDurationMinutes: number;
  defaultTravelMinutes: number;
  preferences: AgendaUserPreferencesInput;
  updatedAt: string;
};

export type PlannerImportedEvent = {
  id: string;
  importId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  location: string;
  category: string;
  status: string;
  priorityScore: number | null;
  url: string;
  raw: Record<string, string>;
};

export type PlannerImport = {
  id: string;
  name: string;
  sourceType: PlannerEventSourceType;
  sourceText: string;
  events: PlannerImportedEvent[];
  warnings: string[];
  createdAt: string;
};

export type PlannerPlanBlock = {
  id: string;
  type: AgendaBlock["blockType"];
  source: AgendaBlock["source"];
  title: string;
  start: string;
  end: string;
  dayKey: string;
  location: string;
  details: string;
  travelMinutes: number | null;
  score: number | null;
  sourceEventId: string;
  generatedReason: string;
};

export type PlannerPlan = {
  id: string;
  name: string;
  generatedAt: string;
  sourceImportIds: string[];
  blocks: PlannerPlanBlock[];
  summary: AgendaRecalculateResult["summary"];
  warnings: Array<{ code: string; message: string; dayKey?: string; eventId?: string }>;
  droppedEvents: AgendaRecalculateResult["droppedEvents"];
  agenda: AgendaRecalculateResult;
};

export type PlannerState = {
  version: 1;
  userId: string;
  profile: PlannerProfile;
  imports: PlannerImport[];
  plans: PlannerPlan[];
  activePlanId: string;
  createdAt: string;
  updatedAt: string;
};

export type PlannerSourceParseResult = {
  events: PlannerImportedEvent[];
  warnings: string[];
};

export type PlannerBuildPlanInput = {
  state: PlannerState;
  importIds?: string[];
  generatedAt?: string | Date;
};

export function defaultPlannerProfile(now = new Date().toISOString()): PlannerProfile {
  return {
    version: 1,
    displayName: "My planning profile",
    timeZone: DEFAULT_TIME_ZONE,
    homeBase: "Home",
    preferencePrompt:
      "Plan days that feel sustainable. Protect sleep, leave realistic travel buffers, and keep meals visible on the calendar.",
    priorityPrompt:
      "Prioritize events that match my stated goals, strong networking opportunities, required commitments, and high-signal learning.",
    logisticsPrompt:
      "Generate sleep, breakfast, lunch or dinner, reset time, and transportation around selected events.",
    defaultEventDurationMinutes: DEFAULT_EVENT_DURATION_MINUTES,
    defaultTravelMinutes: DEFAULT_TRAVEL_MINUTES,
    preferences: generalizedAgendaPreferencesFromPrompts("", ""),
    updatedAt: now,
  };
}

export function emptyPlannerState(userId: string, now = new Date().toISOString()): PlannerState {
  return {
    version: 1,
    userId,
    profile: defaultPlannerProfile(now),
    imports: [],
    plans: [],
    activePlanId: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizePlannerState(
  value: unknown,
  userId: string,
  now = new Date().toISOString(),
): PlannerState {
  const raw = recordValue(value);
  if (!raw) return emptyPlannerState(userId, now);
  const imports = arrayValue(raw.imports).map(normalizePlannerImport).filter((
    item,
  ): item is PlannerImport => Boolean(item));
  const plans = arrayValue(raw.plans).map(normalizePlannerPlan).filter((
    item,
  ): item is PlannerPlan => Boolean(item));
  const activePlanId = stringValue(raw.activePlanId);
  return {
    version: 1,
    userId: stringValue(raw.userId) || userId,
    profile: normalizePlannerProfile(raw.profile, now),
    imports: imports.slice(0, 25),
    plans: plans.slice(0, MAX_PLANNER_PLANS),
    activePlanId: plans.some((plan) => plan.id === activePlanId)
      ? activePlanId
      : plans[0]?.id ?? "",
    createdAt: stringValue(raw.createdAt) || now,
    updatedAt: stringValue(raw.updatedAt) || now,
  };
}

export function normalizePlannerProfile(value: unknown, now = new Date().toISOString()) {
  const base = defaultPlannerProfile(now);
  const raw = recordValue(value);
  if (!raw) return base;
  const preferencePrompt = textValue(raw.preferencePrompt, 8000) || base.preferencePrompt;
  const priorityPrompt = textValue(raw.priorityPrompt, 8000) || base.priorityPrompt;
  const preferences = recordValue(raw.preferences) ??
    generalizedAgendaPreferencesFromPrompts(preferencePrompt, priorityPrompt);
  return {
    version: 1 as const,
    displayName: textValue(raw.displayName, 160) || base.displayName,
    timeZone: textValue(raw.timeZone, 80) || base.timeZone,
    homeBase: textValue(raw.homeBase, 300) || base.homeBase,
    preferencePrompt,
    priorityPrompt,
    logisticsPrompt: textValue(raw.logisticsPrompt, 8000) || base.logisticsPrompt,
    defaultEventDurationMinutes: positiveInteger(
      raw.defaultEventDurationMinutes,
      base.defaultEventDurationMinutes,
    ),
    defaultTravelMinutes: positiveInteger(raw.defaultTravelMinutes, base.defaultTravelMinutes),
    preferences,
    updatedAt: textValue(raw.updatedAt, 80) || now,
  };
}

export function updatePlannerProfile(
  current: PlannerProfile,
  patch: unknown,
  now = new Date().toISOString(),
): PlannerProfile {
  const raw = recordValue(patch);
  if (!raw) return { ...current, updatedAt: now };
  const preferencePrompt = raw.preferencePrompt === undefined
    ? current.preferencePrompt
    : textValue(raw.preferencePrompt, 8000);
  const priorityPrompt = raw.priorityPrompt === undefined
    ? current.priorityPrompt
    : textValue(raw.priorityPrompt, 8000);
  const explicitPreferences = recordValue(raw.preferences);
  return {
    version: 1,
    displayName: raw.displayName === undefined
      ? current.displayName
      : textValue(raw.displayName, 160) || current.displayName,
    timeZone: raw.timeZone === undefined
      ? current.timeZone
      : textValue(raw.timeZone, 80) || current.timeZone,
    homeBase: raw.homeBase === undefined
      ? current.homeBase
      : textValue(raw.homeBase, 300) || current.homeBase,
    preferencePrompt,
    priorityPrompt,
    logisticsPrompt: raw.logisticsPrompt === undefined
      ? current.logisticsPrompt
      : textValue(raw.logisticsPrompt, 8000),
    defaultEventDurationMinutes: raw.defaultEventDurationMinutes === undefined
      ? current.defaultEventDurationMinutes
      : positiveInteger(raw.defaultEventDurationMinutes, current.defaultEventDurationMinutes),
    defaultTravelMinutes: raw.defaultTravelMinutes === undefined
      ? current.defaultTravelMinutes
      : positiveInteger(raw.defaultTravelMinutes, current.defaultTravelMinutes),
    preferences: explicitPreferences ??
      generalizedAgendaPreferencesFromPrompts(preferencePrompt, priorityPrompt),
    updatedAt: now,
  };
}

export function parsePlannerEventSource(input: {
  importId: string;
  name: string;
  sourceType: PlannerEventSourceType;
  sourceText: string;
  defaultDurationMinutes?: number;
}): PlannerSourceParseResult {
  const sourceText = input.sourceText.slice(0, MAX_SOURCE_TEXT_CHARS);
  const defaultDurationMinutes = positiveInteger(
    input.defaultDurationMinutes,
    DEFAULT_EVENT_DURATION_MINUTES,
  );
  if (input.sourceType === "csv") {
    return parseCsvPlannerEvents(input.importId, sourceText, defaultDurationMinutes);
  }
  return parseTextPlannerEvents(input.importId, sourceText, defaultDurationMinutes);
}

export async function buildPlannerPlan(input: PlannerBuildPlanInput): Promise<PlannerPlan> {
  const importIds = input.importIds?.length
    ? new Set(input.importIds.map((id) => id.trim()).filter(Boolean))
    : null;
  const imports = importIds
    ? input.state.imports.filter((item) => importIds.has(item.id))
    : input.state.imports;
  const importedEvents = imports.flatMap((item) => item.events);
  const entries = importedEvents.map(importedEventToAgendaEntry);
  const profile = input.state.profile;
  const userProvidedLogistics = importedEvents.some((event) =>
    plannerImportedEventBlockType(event) !== "event"
  );
  const userProvidedTripLogistics = importedEvents.some((event) =>
    plannerImportedEventBlockType(event) === "other"
  );
  const agenda = await recalculateAgenda({
    scheduleEntries: entries,
    generatedAt: input.generatedAt,
    timeZone: profile.timeZone || DEFAULT_TIME_ZONE,
    preferences: profile.preferences,
    homeAnchor: {
      id: "home",
      name: profile.homeBase || "Home",
      location: profile.homeBase || "Home",
      venueQuery: profile.homeBase || "Home",
      venuePrecision: profile.homeBase && profile.homeBase !== "Home" ? "user_profile" : "generic",
    },
    overrides: {
      defaultTravelMinutes: profile.defaultTravelMinutes,
      includeReturnHome: !hasExplicitHomeReturnBlock(importedEvents),
      generateLogisticsBlocks: !userProvidedLogistics,
      preserveFixedBlocks: true,
    },
    routeEstimator: userProvidedTripLogistics
      ? zeroPlannerRouteEstimate
      : (request) => defaultPlannerRouteEstimate(request, profile.defaultTravelMinutes),
    routeVersion: "general-planner-v1",
  });
  const blocks = agenda.selectedBlocks.map(plannerPlanBlockFromAgendaBlock);
  return {
    id: agenda.agendaRunId,
    name: defaultPlannerPlanName(blocks, agenda.generatedAt),
    generatedAt: agenda.generatedAt,
    sourceImportIds: imports.map((item) => item.id),
    blocks,
    summary: agenda.summary,
    warnings: agenda.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      dayKey: warning.dayKey,
      eventId: warning.eventId,
    })),
    droppedEvents: agenda.droppedEvents,
    agenda,
  };
}

export function defaultPlannerPlanName(blocks: PlannerPlanBlock[], generatedAt: string): string {
  const dates = blocks
    .flatMap((block) => [plannerDatePart(block.start), plannerDatePart(block.end)])
    .filter(Boolean)
    .sort();
  const start = dates[0] || plannerDatePart(generatedAt) || "Unscheduled";
  const end = dates.at(-1) || start;
  return start === end ? `${start} agenda` : `${start} to ${end} agenda`;
}

export function plannerChatFallback(state: PlannerState, prompt: string): string {
  const activePlan = state.plans.find((plan) => plan.id === state.activePlanId) ?? state.plans[0];
  const importedEvents = state.imports.reduce((count, item) => count + item.events.length, 0);
  const cleanPrompt = prompt.trim().toLowerCase();
  if (!state.imports.length) {
    return [
      "I can plan once you import events.",
      "Upload CSV or plain text with event title, start time, end time, and location. I will turn it into a calendar with generated sleep, meals, and transportation.",
    ].join("\n\n");
  }
  if (!activePlan) {
    return [
      `I see ${importedEvents} imported events.`,
      "Run the planner and I will choose a feasible route, add travel, protect meals, and generate sleep blocks around the selected events.",
    ].join("\n\n");
  }
  const next =
    activePlan.blocks.find((block) => Date.parse(block.end.replace(" ", "T")) > Date.now()) ??
      activePlan.blocks[0];
  if (cleanPrompt.includes("why") || cleanPrompt.includes("summary")) {
    return [
      `The active plan selected ${activePlan.summary.selectedEvents} events and generated ${activePlan.summary.generatedLogisticsBlocks} logistics blocks.`,
      `${activePlan.summary.travelBlocks} transportation blocks, ${activePlan.summary.eatingBlocks} eating blocks, and ${activePlan.summary.sleepingBlocks} sleep blocks are on the calendar.`,
    ].join("\n\n");
  }
  if (cleanPrompt.includes("next") && next) {
    return [
      `Next block: ${next.title}`,
      `${next.start} to ${next.end}${next.location ? ` at ${next.location}` : ""}.`,
      next.details || next.generatedReason,
    ].filter(Boolean).join("\n");
  }
  return [
    `The plan is built from ${importedEvents} imported events and your profile prompts.`,
    `Selected events: ${activePlan.summary.selectedEvents}. Dropped conflicts: ${activePlan.summary.conflictEvents}. Generated logistics blocks: ${activePlan.summary.generatedLogisticsBlocks}.`,
  ].join("\n\n");
}

export function generalizedAgendaPreferencesFromPrompts(
  preferencePrompt: string,
  priorityPrompt: string,
): AgendaUserPreferencesInput {
  const positiveSignals = prioritySignalsFromPrompt(priorityPrompt);
  return {
    profileId: "general-planner",
    profileLabel: "General planning profile",
    firstClassBlockTypes: ["event", "travel", "eating", "sleeping"],
    logistics: structuredClone(DEFAULT_AGENDA_USER_PREFERENCES.logistics),
    planning: {
      ...structuredClone(DEFAULT_AGENDA_USER_PREFERENCES.planning),
      discoveredMinimumWorkFit: 0,
      workFitPositiveSignals: positiveSignals.length ? positiveSignals : [
        {
          label: "User priority language",
          pattern:
            "priority|important|required|must attend|goal|strategic|networking|learning|customer|partner",
          score: 24,
        },
      ],
      workFitNegativeSignals: negativeSignalsFromPrompt(preferencePrompt),
    },
  };
}

function parseCsvPlannerEvents(
  importId: string,
  sourceText: string,
  defaultDurationMinutes: number,
): PlannerSourceParseResult {
  const rows = parseCsv(sourceText);
  const warnings: string[] = [];
  const events: PlannerImportedEvent[] = [];
  rows.slice(0, MAX_IMPORT_EVENTS).forEach((row, index) => {
    const fields = normalizedRow(row);
    const title = firstField(fields, ["title", "event", "name", "summary"]) ||
      `Imported event ${index + 1}`;
    const date = firstField(fields, ["date", "day"]);
    const startText = joinDateAndTime(
      date,
      firstField(fields, [
        "start",
        "starttime",
        "start_time",
        "begins",
        "begin",
        "time",
      ]),
    );
    const endText = joinDateAndTime(
      date,
      firstField(fields, [
        "end",
        "endtime",
        "end_time",
        "ends",
        "finish",
      ]),
    );
    const start = normalizeDateTime(startText);
    const end = normalizeDateTime(endText) ||
      (start ? addMinutesToDateTime(start, defaultDurationMinutes) : "");
    if (!start) warnings.push(`Row ${index + 2}: missing parseable start time for "${title}".`);
    events.push({
      id: eventId(importId, index, `${title}|${start}|${end}|${JSON.stringify(row)}`),
      importId,
      title,
      description: firstField(fields, ["description", "details", "notes", "note"]),
      start,
      end,
      location: firstField(fields, ["location", "venue", "place", "address", "where"]),
      category: firstField(fields, ["category", "type", "tag"]) || "imported",
      status: firstField(fields, ["status", "rsvp"]) || "registered",
      priorityScore: numericField(firstField(fields, [
        "priority",
        "score",
        "opportunity",
        "opportunityscore",
        "opportunity_score",
      ])),
      url: firstField(fields, ["url", "link", "eventurl", "event_url"]),
      raw: row,
    });
  });
  if (rows.length > MAX_IMPORT_EVENTS) {
    warnings.push(
      `Imported first ${MAX_IMPORT_EVENTS} rows; ${
        rows.length - MAX_IMPORT_EVENTS
      } rows were skipped.`,
    );
  }
  return { events, warnings };
}

function parseTextPlannerEvents(
  importId: string,
  sourceText: string,
  defaultDurationMinutes: number,
): PlannerSourceParseResult {
  const warnings: string[] = [];
  const events: PlannerImportedEvent[] = [];
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  lines.slice(0, MAX_IMPORT_EVENTS).forEach((line, index) => {
    const parsed = parseTextEventLine(line, defaultDurationMinutes);
    if (!parsed) {
      warnings.push(`Line ${index + 1}: could not find a date and time.`);
      return;
    }
    events.push({
      id: eventId(importId, index, line),
      importId,
      title: parsed.title || `Imported event ${index + 1}`,
      description: parsed.description,
      start: parsed.start,
      end: parsed.end,
      location: parsed.location,
      category: "imported",
      status: "registered",
      priorityScore: null,
      url: parsed.url,
      raw: { line },
    });
  });
  if (lines.length > MAX_IMPORT_EVENTS) {
    warnings.push(
      `Imported first ${MAX_IMPORT_EVENTS} lines; ${
        lines.length - MAX_IMPORT_EVENTS
      } lines were skipped.`,
    );
  }
  return { events, warnings };
}

function parseTextEventLine(
  value: string,
  defaultDurationMinutes: number,
):
  | {
    title: string;
    description: string;
    start: string;
    end: string;
    location: string;
    url: string;
  }
  | null {
  const line = value.replace(/^[-*•]\s*/, "").trim();
  const match = line.match(
    /(?<date>\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})[\s,]+(?<start>\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s*(?:-|–|—|to)\s*(?<end>\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i,
  );
  if (!match?.groups) return null;
  const start = normalizeDateTime(`${match.groups.date} ${match.groups.start}`);
  if (!start) return null;
  let end = match.groups.end ? normalizeDateTime(`${datePart(start)} ${match.groups.end}`) : "";
  if (!end || Date.parse(end.replace(" ", "T")) <= Date.parse(start.replace(" ", "T"))) {
    end = match.groups.end
      ? addMinutesToDateTime(end || start, 24 * 60)
      : addMinutesToDateTime(start, defaultDurationMinutes);
  }
  let remainder = line.replace(match[0], "").replace(/^[\s:|,;-]+/, "").trim();
  const urlMatch = remainder.match(/https?:\/\/\S+/i);
  const url = urlMatch?.[0]?.replace(/[),.;]+$/, "") ?? "";
  if (url) remainder = remainder.replace(urlMatch![0], "").trim();
  let location = "";
  const locationMatch = remainder.match(/\s(?:@|at)\s([^|]+)$/i);
  if (locationMatch) {
    location = locationMatch[1].trim();
    remainder = remainder.slice(0, locationMatch.index).trim();
  }
  return {
    title: remainder || "Imported event",
    description: value,
    start,
    end,
    location,
    url,
  };
}

function importedEventToAgendaEntry(event: PlannerImportedEvent): AgendaScheduleEntry {
  const blockType = plannerImportedEventBlockType(event);
  const entryType = blockType === "sleeping"
    ? "sleep"
    : blockType === "eating"
    ? "meal"
    : blockType === "other"
    ? "fixed"
    : "event";
  return {
    calendar: blockType === "event" ? "reference" : "schedule",
    calendarBlockId: event.id,
    entryType,
    blockType,
    status: event.status || "registered",
    category: event.category || "imported",
    start: event.start,
    end: event.end,
    actualStart: event.start,
    actualEnd: event.end,
    dayKey: event.start.slice(0, 10),
    title: event.title,
    displayTitle: event.title,
    location: event.location,
    venueQuery: event.location,
    venuePrecision: event.location ? "imported" : "unknown",
    note: event.description,
    opportunityScore: event.priorityScore === null ? "" : String(event.priorityScore),
    eventUrl: event.url,
  };
}

function plannerImportedEventBlockType(event: PlannerImportedEvent): AgendaBlock["blockType"] {
  const category = event.category.trim().toLowerCase();
  const title = event.title.trim().toLowerCase();
  const text = `${category} ${title}`;
  if (/\b(sleep|overnight)\b/.test(text)) return "sleeping";
  if (/\b(breakfast|lunch|dinner|meal|hydrate|hydration)\b/.test(text)) return "eating";
  if (
    /\b(check[- ]?in|check[- ]?out|checkout|decompress|buffer|pack)\b/.test(text) ||
    /\b(travel|transfer|depart|return|rideshare|taxi|shuttle|airport to|to airport)\b/.test(text)
  ) {
    if (!/\bflight\b/.test(text)) return "other";
  }
  return "event";
}

function hasExplicitHomeReturnBlock(events: PlannerImportedEvent[]): boolean {
  return events.some((event) => {
    const text = `${event.title} ${event.location} ${event.description}`.toLowerCase();
    return /\b(return|arrive|back)\b/.test(text) &&
      /\b(home|manhattan|new york|nyc)\b/.test(text);
  });
}

function zeroPlannerRouteEstimate(request: AgendaRouteEstimateRequest): AgendaRouteEstimate {
  return {
    mode: "provided-itinerary",
    minutes: 0,
    details:
      `Explicit itinerary logistics already cover ${request.origin.name} to ${request.destination.name}.`,
    source: "planner-provided-itinerary",
  };
}

function defaultPlannerRouteEstimate(
  request: AgendaRouteEstimateRequest,
  defaultTravelMinutes: number,
): AgendaRouteEstimate {
  const samePlace = request.origin.venueQuery && request.destination.venueQuery &&
    request.origin.venueQuery.toLowerCase() === request.destination.venueQuery.toLowerCase();
  const minutes = samePlace ? 0 : positiveInteger(defaultTravelMinutes, DEFAULT_TRAVEL_MINUTES);
  return {
    mode: minutes === 0 ? "same-place" : "estimated",
    minutes,
    details: minutes === 0
      ? "Same imported location."
      : `Default travel buffer from ${request.origin.name} to ${request.destination.name}.`,
    source: "planner-default",
  };
}

function plannerPlanBlockFromAgendaBlock(block: AgendaBlock): PlannerPlanBlock {
  return {
    id: block.agendaBlockId || block.calendarBlockId,
    type: block.blockType,
    source: block.source,
    title: block.displayTitle || block.title,
    start: block.start,
    end: block.end,
    dayKey: block.dayKey,
    location: block.location || block.venueQuery,
    details: block.routeDetails || block.note,
    travelMinutes: block.travelMinutes,
    score: block.score ?? null,
    sourceEventId: plannerSourceEventIdFromAgendaBlock(block),
    generatedReason: block.generatedReason,
  };
}

function plannerSourceEventIdFromAgendaBlock(block: AgendaBlock): string {
  if (block.blockType !== "event") return block.calendarBlockId;
  return block.calendarBlockId.replace(/-SCHEDULE$/i, "");
}

function normalizePlannerImport(value: unknown): PlannerImport | null {
  const raw = recordValue(value);
  if (!raw) return null;
  const id = stringValue(raw.id);
  if (!id) return null;
  return {
    id,
    name: textValue(raw.name, 160) || "Imported events",
    sourceType: raw.sourceType === "csv" ? "csv" : "text",
    sourceText: textValue(raw.sourceText, MAX_SOURCE_TEXT_CHARS),
    events: arrayValue(raw.events).map((event) => normalizeImportedEvent(event, id)).filter((
      event,
    ): event is PlannerImportedEvent => Boolean(event)),
    warnings: arrayValue(raw.warnings).map((warning) => textValue(warning, 500)).filter(Boolean),
    createdAt: textValue(raw.createdAt, 80) || new Date().toISOString(),
  };
}

function normalizeImportedEvent(value: unknown, importId: string): PlannerImportedEvent | null {
  const raw = recordValue(value);
  if (!raw) return null;
  const id = stringValue(raw.id);
  if (!id) return null;
  return {
    id,
    importId: stringValue(raw.importId) || importId,
    title: textValue(raw.title, 300) || "Imported event",
    description: textValue(raw.description, 4000),
    start: textValue(raw.start, 80),
    end: textValue(raw.end, 80),
    location: textValue(raw.location, 500),
    category: textValue(raw.category, 80) || "imported",
    status: textValue(raw.status, 80) || "registered",
    priorityScore: numericValue(raw.priorityScore),
    url: textValue(raw.url, 1000),
    raw: recordStringMap(raw.raw),
  };
}

function normalizePlannerPlan(value: unknown): PlannerPlan | null {
  const raw = recordValue(value);
  if (!raw) return null;
  const id = stringValue(raw.id);
  if (!id) return null;
  const generatedAt = textValue(raw.generatedAt, 80) || new Date().toISOString();
  const blocks = arrayValue(raw.blocks).map(normalizePlannerPlanBlock).filter((
    block,
  ): block is PlannerPlanBlock => Boolean(block));
  return {
    id,
    name: textValue(raw.name, 160) || defaultPlannerPlanName(blocks, generatedAt),
    generatedAt,
    sourceImportIds: arrayValue(raw.sourceImportIds).map(stringValue).filter(Boolean),
    blocks,
    summary: recordValue(raw.summary) as AgendaRecalculateResult["summary"],
    warnings: arrayValue(raw.warnings).map((warning) => recordValue(warning)).filter(Boolean).map(
      (warning) => ({
        code: textValue(warning?.code, 120),
        message: textValue(warning?.message, 500),
        dayKey: textValue(warning?.dayKey, 40) || undefined,
        eventId: textValue(warning?.eventId, 160) || undefined,
      }),
    ),
    droppedEvents: arrayValue(raw.droppedEvents) as AgendaRecalculateResult["droppedEvents"],
    agenda: recordValue(raw.agenda) as AgendaRecalculateResult,
  };
}

function plannerDatePart(value: string): string {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? "";
}

function normalizePlannerPlanBlock(value: unknown): PlannerPlanBlock | null {
  const raw = recordValue(value);
  if (!raw) return null;
  const id = stringValue(raw.id);
  if (!id) return null;
  return {
    id,
    type: blockTypeValue(raw.type),
    source: sourceValue(raw.source),
    title: textValue(raw.title, 300),
    start: textValue(raw.start, 80),
    end: textValue(raw.end, 80),
    dayKey: textValue(raw.dayKey, 40),
    location: textValue(raw.location, 500),
    details: textValue(raw.details, 1000),
    travelMinutes: numericValue(raw.travelMinutes),
    score: numericValue(raw.score),
    sourceEventId: textValue(raw.sourceEventId, 160),
    generatedReason: textValue(raw.generatedReason, 500),
  };
}

function prioritySignalsFromPrompt(prompt: string): AgendaSignalPreference[] {
  const cleaned = prompt.trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[\n,;]+/)
    .map((part) =>
      part
        .replace(/\b(prioriti[sz]e|prefer|focus on|optimi[sz]e for|events? about)\b/gi, "")
        .trim()
    )
    .filter((part) => part.length >= 3 && part.length <= 80);
  const candidates = parts.length > 1 ? parts : keywordCandidates(cleaned);
  return [...new Set(candidates.map((item) => item.toLowerCase()))].slice(0, 16).map(
    (phrase, index) => ({
      label: `Priority ${index + 1}: ${phrase}`,
      pattern: escapeRegExp(phrase).replaceAll(/\s+/g, "\\s+"),
      score: 24,
    }),
  );
}

function negativeSignalsFromPrompt(prompt: string): AgendaSignalPreference[] {
  const avoidMatch = prompt.match(/\b(?:avoid|skip|deprioriti[sz]e)\b[:\s]+(.+)/i);
  if (!avoidMatch) return [];
  return avoidMatch[1].split(/[,;\n]+/).map((part) => part.trim()).filter((part) =>
    part.length >= 3 && part.length <= 80
  ).slice(0, 12).map((phrase, index) => ({
    label: `Avoid ${index + 1}: ${phrase.toLowerCase()}`,
    pattern: escapeRegExp(phrase).replaceAll(/\s+/g, "\\s+"),
    score: -40,
  }));
}

function keywordCandidates(value: string): string[] {
  const stop = new Set([
    "about",
    "after",
    "around",
    "events",
    "event",
    "goals",
    "high",
    "that",
    "with",
    "from",
    "this",
    "planning",
    "schedule",
    "prioritize",
    "priority",
    "strong",
  ]);
  return value.toLowerCase().match(/[a-z0-9][a-z0-9+.-]{2,}/g)?.filter((word) => !stop.has(word))
    .slice(0, 12) ?? [];
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
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
  const [headers, ...body] = rows.filter((cells) => cells.some((cell) => cell.trim()));
  if (!headers) return [];
  return body.map((cells) => {
    const output: Record<string, string> = {};
    headers.forEach((header, index) => {
      output[header.trim()] = cells[index]?.trim() ?? "";
    });
    return output;
  });
}

function normalizedRow(row: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    output[normalizeHeader(key)] = value;
  }
  return output;
}

function firstField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[normalizeHeader(key)]?.trim();
    if (value) return value;
  }
  return "";
}

function joinDateAndTime(date: string, time: string): string {
  if (!date) return time;
  if (!time) return date;
  if (/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(time)) return time;
  return `${date} ${time}`;
}

function normalizeDateTime(value: string): string {
  const date = parseDateTime(value);
  return date ? formatDateTime(date) : "";
}

function parseDateTime(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const iso = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s,]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
  );
  if (iso) {
    const hour = normalizeHour(iso[4], iso[6]);
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      hour,
      Number(iso[5] ?? 0),
    );
  }
  const mdy = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[T\s,]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
  );
  if (mdy) {
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    const hour = normalizeHour(mdy[4], mdy[6]);
    return new Date(year, Number(mdy[1]) - 1, Number(mdy[2]), hour, Number(mdy[5] ?? 0));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeHour(hour: string | undefined, meridiem: string | undefined): number {
  let value = Number(hour ?? 0);
  const marker = meridiem?.toLowerCase();
  if (marker === "pm" && value < 12) value += 12;
  if (marker === "am" && value === 12) value = 0;
  return value;
}

function addMinutesToDateTime(value: string, minutes: number): string {
  const date = parseDateTime(value);
  if (!date) return value;
  return formatDateTime(new Date(date.getTime() + minutes * 60_000));
}

function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${
    pad(date.getHours())
  }:${pad(date.getMinutes())}`;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function eventId(importId: string, index: number, text: string): string {
  return `evt_${importId}_${index + 1}_${stableHash(text)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordStringMap(value: unknown): Record<string, string> {
  const raw = recordValue(value);
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).map(([key, item]) => [key, stringValue(item)]),
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function textValue(value: unknown, maxLength: number): string {
  return stringValue(value).slice(0, maxLength);
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function numericField(value: string): number | null {
  return numericValue(value);
}

function numericValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function blockTypeValue(value: unknown): AgendaBlock["blockType"] {
  const text = stringValue(value);
  return text === "event" || text === "travel" || text === "eating" || text === "sleeping" ||
      text === "other"
    ? text
    : "other";
}

function sourceValue(value: unknown): AgendaBlock["source"] {
  const text = stringValue(value);
  return text === "selected_event" || text === "generated_travel" ||
      text === "generated_logistics" || text === "fixed_schedule"
    ? text
    : "selected_event";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
