const DEFAULT_TIME_ZONE = "America/New_York";
const DEFAULT_UTC_OFFSET = "-04:00";
const DEFAULT_TRAVEL_MINUTES = 30;
const DEFAULT_MAX_CANDIDATES_PER_DAY = 60;
const MINUTE_MS = 60_000;

export type AgendaBlockType = "event" | "travel" | "eating" | "sleeping" | "other";

export type AgendaScheduleEntry = {
  calendar?: string;
  techweekId?: string;
  techweek_id?: string;
  calendarBlockId?: string;
  calendar_block_id?: string;
  partifulId?: string;
  partiful_id?: string;
  rerankId?: string;
  rerank_id?: string;
  entryType?: string;
  entry_type?: string;
  blockType?: AgendaBlockType;
  block_type?: AgendaBlockType;
  status?: string;
  category?: string;
  start?: string;
  end?: string;
  actualStart?: string;
  actual_start?: string;
  actualEnd?: string;
  actual_end?: string;
  startEpochMs?: number;
  start_epoch_ms?: number;
  endEpochMs?: number;
  end_epoch_ms?: number;
  actualStartEpochMs?: number;
  actual_start_epoch_ms?: number;
  actualEndEpochMs?: number;
  actual_end_epoch_ms?: number;
  dayKey?: string;
  day_key?: string;
  weekday?: string;
  timeRange?: string;
  time_range?: string;
  title?: string;
  displayTitle?: string;
  display_title?: string;
  statusLabel?: string;
  status_label?: string;
  location?: string;
  venueQuery?: string;
  venue_query?: string;
  venuePrecision?: string;
  venue_precision?: string;
  routeMode?: string;
  route_mode?: string;
  travelMinutes?: string | number;
  travel_minutes?: string | number;
  routeDetails?: string;
  route_details?: string;
  subwaySegments?: string;
  subway_segments?: string;
  transitRisk?: string;
  transit_risk?: string;
  note?: string;
  salesCoaching?: string;
  sales_coaching?: string;
  rank?: string | number;
  tier?: string | number;
  opportunityScore?: string | number;
  opportunity_score?: string | number;
  eventUrl?: string;
  event_url?: string;
  googleMapsUrl?: string;
  google_maps_url?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lon?: number;
  [key: string]: unknown;
};

export type AgendaStatusUpdate = {
  id?: string;
  techweekId?: string;
  techweek_id?: string;
  calendarBlockId?: string;
  calendar_block_id?: string;
  partifulId?: string;
  partiful_id?: string;
  rerankId?: string;
  rerank_id?: string;
  status: string;
  reason?: string;
  updatedAt?: string;
};

export type AgendaStatusUpdates =
  | AgendaStatusUpdate[]
  | Record<string, string | AgendaStatusUpdate>;

export type AgendaRoutePoint = {
  id: string;
  name: string;
  location: string;
  venueQuery: string;
  venuePrecision?: string;
  latitude?: number;
  longitude?: number;
  sourceEventId?: string;
  sourceCalendarBlockId?: string;
};

export type AgendaRouteEstimateRequest = {
  origin: AgendaRoutePoint;
  destination: AgendaRoutePoint;
  dayKey: string;
  arriveBy: string;
  arriveByEpochMs: number;
  destinationEventId?: string;
  routeVersion?: string;
};

export type AgendaRouteEstimate = {
  mode: string;
  minutes: number;
  details: string;
  subwaySegments?: string;
  transitRisk?: string;
  distanceMeters?: number;
  googleMapsUrl?: string;
  source?: string;
};

export type AgendaRouteEstimator = (
  request: AgendaRouteEstimateRequest,
) => AgendaRouteEstimate | null | Promise<AgendaRouteEstimate | null>;

export type AgendaRecalculateOverrides = {
  pinnedEventIds?: string[];
  preferredEventIds?: string[];
  excludedEventIds?: string[];
  excludedBlockIds?: string[];
  lockedBlockIds?: string[];
  hardFixedBlockIds?: string[];
  preserveFixedBlocks?: boolean;
  includeReturnHome?: boolean;
  maxCandidatesPerDay?: number;
  travelMinutePenalty?: number;
  defaultTravelMinutes?: number;
  minTravelBufferMinutes?: number;
};

export type AgendaStateLike = {
  agendaOverrides?: AgendaRecalculateOverrides;
  eventStatusUpdates?: AgendaStatusUpdates;
  acceptedEventIds?: string[];
  pinnedEventIds?: string[];
  preferredEventIds?: string[];
  excludedEventIds?: string[];
  excludedBlockIds?: string[];
};

export type AgendaRecalculateInput = {
  scheduleEntries: AgendaScheduleEntry[];
  state?: AgendaStateLike;
  overrides?: AgendaRecalculateOverrides;
  statusUpdates?: AgendaStatusUpdates;
  acceptedEventIds?: string[];
  routeEstimator?: AgendaRouteEstimator;
  homeAnchor?: Partial<AgendaRoutePoint>;
  generatedAt?: string | Date;
  timeZone?: string;
  routeVersion?: string;
};

export type AgendaScoreBreakdown = Record<string, number>;

export type AgendaBlockSource = "selected_event" | "generated_travel" | "fixed_schedule";

export type AgendaBlock = {
  agendaBlockId: string;
  calendar: "schedule";
  techweekId: string;
  calendarBlockId: string;
  partifulId: string;
  rerankId: string;
  entryType: string;
  blockType: AgendaBlockType;
  source: AgendaBlockSource;
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
  title: string;
  displayTitle: string;
  location: string;
  venueQuery: string;
  venuePrecision: string;
  routeMode: string;
  travelMinutes: number | null;
  routeDetails: string;
  subwaySegments: string;
  transitRisk: string;
  note: string;
  rank: string;
  tier: string;
  opportunityScore: string;
  eventUrl: string;
  googleMapsUrl: string;
  routeEstimate?: AgendaRouteEstimate;
  score?: number;
  scoreBreakdown?: AgendaScoreBreakdown;
  generatedReason: string;
};

export type AgendaEventSummary = {
  id: string;
  techweekId: string;
  calendarBlockId: string;
  partifulId: string;
  rerankId: string;
  title: string;
  status: string;
  normalizedStatus: AgendaNormalizedStatus;
  category: string;
  dayKey: string;
  start: string;
  end: string;
  startEpochMs: number;
  endEpochMs: number;
  location: string;
  score: number;
  scoreBreakdown: AgendaScoreBreakdown;
  identifiers: string[];
  currentSchedule: boolean;
};

export type AgendaDropReason =
  | "status_excluded"
  | "missing_identity"
  | "missing_time"
  | "duplicate_lower_priority"
  | "fixed_block_conflict"
  | "candidate_limit"
  | "conflict"
  | "travel_conflict"
  | "lower_score";

export type AgendaDroppedEvent = {
  event: AgendaEventSummary;
  reason: AgendaDropReason;
  detail: string;
  conflictingEventIds: string[];
  conflictingBlockIds: string[];
};

export type AgendaWarning = {
  code: string;
  message: string;
  dayKey?: string;
  eventId?: string;
  blockId?: string;
};

export type AgendaSummary = {
  inputBlocks: number;
  inputEvents: number;
  candidateEvents: number;
  selectedBlocks: number;
  selectedEvents: number;
  travelBlocks: number;
  fixedBlocks: number;
  droppedEvents: number;
  conflictEvents: number;
  routeEstimateCount: number;
  fallbackRouteEstimateCount: number;
  byStatus: Record<string, number>;
  byDay: Record<
    string,
    {
      candidates: number;
      selectedEvents: number;
      selectedBlocks: number;
      droppedEvents: number;
      travelBlocks: number;
    }
  >;
};

export type AgendaRecalculateResult = {
  agendaRunId: string;
  generatedAt: string;
  timeZone: string;
  routeVersion: string;
  selectedBlocks: AgendaBlock[];
  selectedEvents: AgendaBlock[];
  travelBlocks: AgendaBlock[];
  droppedEvents: AgendaDroppedEvent[];
  conflictEvents: AgendaDroppedEvent[];
  warnings: AgendaWarning[];
  summary: AgendaSummary;
};

export type AgendaNormalizedStatus =
  | "registered"
  | "accepted"
  | "applied"
  | "waitlisted"
  | "excluded"
  | "unknown";

type RecalculateOptions = {
  preserveFixedBlocks: boolean;
  includeReturnHome: boolean;
  maxCandidatesPerDay: number;
  travelMinutePenalty: number;
  defaultTravelMinutes: number;
  minTravelBufferMinutes: number;
  pinnedEventIds: Set<string>;
  preferredEventIds: Set<string>;
  excludedEventIds: Set<string>;
  excludedBlockIds: Set<string>;
  lockedBlockIds: Set<string>;
  hardFixedBlockIds: Set<string>;
};

type NormalizedEvent = AgendaEventSummary & {
  entry: AgendaScheduleEntry;
  sourceIndex: number;
  sourceCalendar: string;
  currentSchedule: boolean;
  actualStartEpochMs: number;
  actualEndEpochMs: number;
  actualStart: string;
  actualEnd: string;
  displayTitle: string;
  venueQuery: string;
  venuePrecision: string;
  note: string;
  rank: string;
  tier: string;
  opportunityScore: string;
  eventUrl: string;
  googleMapsUrl: string;
  point: AgendaRoutePoint;
};

type FixedBlock = AgendaBlock & {
  hardConstraint: boolean;
};

type PlannedEvent = {
  candidate: NormalizedEvent;
  incomingRoute: AgendaRouteEstimate;
  incomingOrigin: AgendaRoutePoint;
  previousEventId: string | null;
};

type PlanAt = {
  totalScore: number;
  prevIndex: number | null;
  incomingRoute: AgendaRouteEstimate;
  incomingOrigin: AgendaRoutePoint;
  tieKey: string;
};

type PlanningContext = {
  input: AgendaRecalculateInput;
  generatedAt: string;
  timeZone: string;
  routeVersion: string;
  options: RecalculateOptions;
  home: AgendaRoutePoint;
  warnings: AgendaWarning[];
  routeCache: Map<string, Promise<AgendaRouteEstimate>>;
  routeEstimateCount: number;
  fallbackRouteEstimateCount: number;
  missingRouteEstimatorWarned: boolean;
};

type DuplicateChoice = {
  winner: NormalizedEvent;
  dropped: NormalizedEvent[];
};

export async function recalculateAgenda(
  input: AgendaRecalculateInput,
): Promise<AgendaRecalculateResult> {
  const generatedAt = normalizeGeneratedAt(input.generatedAt);
  const timeZone = input.timeZone || DEFAULT_TIME_ZONE;
  const routeVersion = input.routeVersion || "agenda-recalculate-v1";
  const options = mergeOptions(input);
  const home = normalizeHomeAnchor(input.homeAnchor);
  const context: PlanningContext = {
    input,
    generatedAt,
    timeZone,
    routeVersion,
    options,
    home,
    warnings: [],
    routeCache: new Map(),
    routeEstimateCount: 0,
    fallbackRouteEstimateCount: 0,
    missingRouteEstimatorWarned: false,
  };

  const statusUpdates = buildStatusUpdateMap(input);
  const drops: AgendaDroppedEvent[] = [];
  const normalizedEvents = normalizeEvents(input.scheduleEntries, statusUpdates, options, timeZone);
  const eventCount = normalizedEvents.length;
  const deduped = dedupeEvents(normalizedEvents);
  for (const dropped of deduped.flatMap((choice) => choice.dropped)) {
    drops.push(
      dropEvent(
        dropped,
        "duplicate_lower_priority",
        "Duplicate event row lost the deterministic merge.",
      ),
    );
  }

  const fixedBlocks = normalizeFixedBlocks(input.scheduleEntries, options, timeZone);
  const hardFixedBlocks = fixedBlocks.filter((block) => block.hardConstraint);
  const eligibleCandidates: NormalizedEvent[] = [];

  for (const { winner } of deduped) {
    const preliminaryDrop = preliminaryDropReason(winner, options, hardFixedBlocks);
    if (preliminaryDrop) {
      drops.push(preliminaryDrop);
      continue;
    }
    eligibleCandidates.push(winner);
  }

  const selectedBlocks: AgendaBlock[] = [];
  const selectedCandidateIds = new Set<string>();
  const byDay = groupCandidatesByDay(eligibleCandidates);
  const fixedByDay = groupFixedBlocksByDay(fixedBlocks);
  const allDayKeys = [...new Set([...byDay.keys(), ...fixedByDay.keys()])].sort();
  const limitedCandidates: NormalizedEvent[] = [];

  for (const dayKey of allDayKeys) {
    const dayCandidates = byDay.get(dayKey) ?? [];
    const { kept, dropped } = enforceCandidateLimit(dayCandidates, options.maxCandidatesPerDay);
    limitedCandidates.push(...kept);
    drops.push(...dropped);

    const selectedEvents = await planDay(
      context,
      dayKey,
      kept,
      hardFixedBlocksForDay(hardFixedBlocks, dayKey),
    );
    for (const planned of selectedEvents) {
      selectedCandidateIds.add(planned.candidate.id);
    }

    const dayBlocks = await buildDayBlocks(context, dayKey, selectedEvents);
    if (options.preserveFixedBlocks) {
      dayBlocks.push(...retainFixedBlocks(context, fixedByDay.get(dayKey) ?? [], dayBlocks));
    }
    selectedBlocks.push(...dayBlocks);
  }

  const selectedEvents = selectedBlocks.filter((block) => block.blockType === "event");
  const selectedEventIdSet = new Set(selectedEvents.map((block) => stableBlockEventId(block)));
  for (const candidate of limitedCandidates) {
    if (selectedCandidateIds.has(candidate.id)) continue;
    if (drops.some((drop) => drop.event.id === candidate.id)) continue;
    drops.push(classifyUnselectedCandidate(candidate, selectedEvents, selectedEventIdSet));
  }

  selectedBlocks.sort(compareBlocks);
  drops.sort(compareDrops);

  const travelBlocks = selectedBlocks.filter((block) => block.blockType === "travel");
  const conflictEvents = drops.filter((drop) =>
    drop.reason === "conflict" || drop.reason === "travel_conflict" ||
    drop.reason === "fixed_block_conflict"
  );
  const summary = buildSummary({
    inputBlocks: input.scheduleEntries.length,
    inputEvents: eventCount,
    candidates: limitedCandidates,
    selectedBlocks,
    droppedEvents: drops,
    routeEstimateCount: context.routeEstimateCount,
    fallbackRouteEstimateCount: context.fallbackRouteEstimateCount,
  });

  return {
    agendaRunId: buildAgendaRunId(generatedAt, selectedBlocks, drops),
    generatedAt,
    timeZone,
    routeVersion,
    selectedBlocks,
    selectedEvents,
    travelBlocks,
    droppedEvents: drops,
    conflictEvents,
    warnings: context.warnings,
    summary,
  };
}

function normalizeGeneratedAt(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return new Date(value).toISOString();
  return new Date().toISOString();
}

function mergeOptions(input: AgendaRecalculateInput): RecalculateOptions {
  const state = input.state ?? {};
  const stateOverrides = state.agendaOverrides ?? {};
  const direct = input.overrides ?? {};
  const merged: AgendaRecalculateOverrides = { ...stateOverrides, ...direct };

  return {
    preserveFixedBlocks: merged.preserveFixedBlocks ?? true,
    includeReturnHome: merged.includeReturnHome ?? true,
    maxCandidatesPerDay: positiveInteger(
      merged.maxCandidatesPerDay,
      DEFAULT_MAX_CANDIDATES_PER_DAY,
    ),
    travelMinutePenalty: finiteNumber(merged.travelMinutePenalty, 0.5),
    defaultTravelMinutes: positiveInteger(merged.defaultTravelMinutes, DEFAULT_TRAVEL_MINUTES),
    minTravelBufferMinutes: positiveInteger(merged.minTravelBufferMinutes, 0),
    pinnedEventIds: stringSet(
      state.pinnedEventIds,
      stateOverrides.pinnedEventIds,
      direct.pinnedEventIds,
    ),
    preferredEventIds: stringSet(
      state.preferredEventIds,
      stateOverrides.preferredEventIds,
      direct.preferredEventIds,
    ),
    excludedEventIds: stringSet(
      state.excludedEventIds,
      stateOverrides.excludedEventIds,
      direct.excludedEventIds,
    ),
    excludedBlockIds: stringSet(
      state.excludedBlockIds,
      stateOverrides.excludedBlockIds,
      direct.excludedBlockIds,
    ),
    lockedBlockIds: stringSet(stateOverrides.lockedBlockIds, direct.lockedBlockIds),
    hardFixedBlockIds: stringSet(stateOverrides.hardFixedBlockIds, direct.hardFixedBlockIds),
  };
}

function normalizeHomeAnchor(homeAnchor: Partial<AgendaRoutePoint> | undefined): AgendaRoutePoint {
  return {
    id: homeAnchor?.id || "home",
    name: homeAnchor?.name || "FiDi home base",
    location: homeAnchor?.location || "FiDi home base",
    venueQuery: homeAnchor?.venueQuery || homeAnchor?.location || "Wall St, New York, NY",
    venuePrecision: homeAnchor?.venuePrecision || "home_anchor",
    latitude: homeAnchor?.latitude,
    longitude: homeAnchor?.longitude,
  };
}

function buildStatusUpdateMap(input: AgendaRecalculateInput): Map<string, string> {
  const updates = new Map<string, string>();
  const add = (id: string | undefined, status: string | undefined) => {
    const normalizedId = id?.trim();
    const normalizedStatus = status?.trim();
    if (!normalizedId || !normalizedStatus) return;
    updates.set(normalizedId, normalizedStatus);
    if (normalizedId.startsWith("TW-")) updates.set(normalizedId.slice(3), normalizedStatus);
    else if (/^\d+$/.test(normalizedId)) updates.set(`TW-${normalizedId}`, normalizedStatus);
  };
  for (const id of input.state?.acceptedEventIds ?? []) add(id, "accepted");
  for (const id of input.acceptedEventIds ?? []) add(id, "accepted");
  appendStatusUpdates(updates, input.state?.eventStatusUpdates);
  appendStatusUpdates(updates, input.statusUpdates);
  return updates;
}

function appendStatusUpdates(
  updates: Map<string, string>,
  source: AgendaStatusUpdates | undefined,
): void {
  if (!source) return;
  if (Array.isArray(source)) {
    for (const update of source) addStatusUpdate(updates, update);
    return;
  }
  for (const [id, value] of Object.entries(source)) {
    if (typeof value === "string") {
      updates.set(id, value);
      if (id.startsWith("TW-")) updates.set(id.slice(3), value);
      else if (/^\d+$/.test(id)) updates.set(`TW-${id}`, value);
    } else {
      addStatusUpdate(updates, { ...value, id: value.id || id });
    }
  }
}

function addStatusUpdate(updates: Map<string, string>, update: AgendaStatusUpdate): void {
  const ids = [
    update.id,
    update.techweekId,
    update.techweek_id,
    update.calendarBlockId,
    update.calendar_block_id,
    update.partifulId,
    update.partiful_id,
    update.rerankId,
    update.rerank_id,
  ];
  for (const id of ids) {
    const clean = id?.trim();
    if (!clean) continue;
    updates.set(clean, update.status);
    if (clean.startsWith("TW-")) updates.set(clean.slice(3), update.status);
    else if (/^\d+$/.test(clean)) updates.set(`TW-${clean}`, update.status);
  }
}

function normalizeEvents(
  entries: AgendaScheduleEntry[],
  statusUpdates: Map<string, string>,
  options: RecalculateOptions,
  timeZone: string,
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const [sourceIndex, entry] of entries.entries()) {
    if (normalizeBlockType(entry) !== "event") continue;
    const identifiers = entryIdentifiers(entry);
    const id = canonicalEventId(entry, identifiers);
    const rawStatus = statusForEntry(entry, statusUpdates, identifiers);
    const normalizedStatus = normalizeStatus(rawStatus, stringField(entry, "title"));
    const startEpochMs = epochField(entry, ["actualStartEpochMs", "actual_start_epoch_ms"]) ||
      epochField(entry, ["startEpochMs", "start_epoch_ms"]) ||
      parseLocalDateTime(stringField(entry, "actualStart", "actual_start", "start"), timeZone);
    const endEpochMs = epochField(entry, ["actualEndEpochMs", "actual_end_epoch_ms"]) ||
      epochField(entry, ["endEpochMs", "end_epoch_ms"]) ||
      parseLocalDateTime(stringField(entry, "actualEnd", "actual_end", "end"), timeZone);
    const start = stringField(entry, "actualStart", "actual_start", "start") ||
      formatLocalDateTime(startEpochMs, timeZone);
    const end = stringField(entry, "actualEnd", "actual_end", "end") ||
      formatLocalDateTime(endEpochMs, timeZone);
    const calendarBlockId = stringField(entry, "calendarBlockId", "calendar_block_id");
    const techweekId = canonicalTechWeekId(entry);
    const rerankId = stringField(entry, "rerankId", "rerank_id");
    const partifulId = stringField(entry, "partifulId", "partiful_id");
    const title = stripStatusPrefix(stringField(entry, "displayTitle", "display_title", "title"));
    const location = stringField(entry, "location") ||
      stringField(entry, "venueQuery", "venue_query");
    const venueQuery = stringField(entry, "venueQuery", "venue_query") || location;
    const currentSchedule = stringField(entry, "calendar") === "schedule";
    const scoreBreakdown = scoreBreakdownForEvent({
      entry,
      normalizedStatus,
      identifiers,
      currentSchedule,
      options,
    });
    const score = scoreFromBreakdown(scoreBreakdown);
    const dayKey = stringField(entry, "dayKey", "day_key") || start.slice(0, 10) ||
      formatLocalDate(startEpochMs, timeZone);
    events.push({
      id,
      techweekId,
      calendarBlockId,
      partifulId,
      rerankId,
      title,
      displayTitle: title,
      status: rawStatus,
      normalizedStatus,
      category: stringField(entry, "category"),
      dayKey,
      start,
      end,
      startEpochMs,
      endEpochMs,
      actualStartEpochMs: startEpochMs,
      actualEndEpochMs: endEpochMs,
      actualStart: start,
      actualEnd: end,
      location,
      venueQuery,
      venuePrecision: stringField(entry, "venuePrecision", "venue_precision"),
      note: stringField(entry, "note"),
      rank: stringField(entry, "rank"),
      tier: stringField(entry, "tier"),
      opportunityScore: stringField(entry, "opportunityScore", "opportunity_score"),
      eventUrl: stringField(entry, "eventUrl", "event_url"),
      googleMapsUrl: stringField(entry, "googleMapsUrl", "google_maps_url"),
      score,
      scoreBreakdown,
      identifiers,
      currentSchedule,
      sourceCalendar: stringField(entry, "calendar"),
      entry,
      sourceIndex,
      point: pointForEvent({
        id,
        title,
        location,
        venueQuery,
        venuePrecision: stringField(entry, "venuePrecision", "venue_precision"),
        calendarBlockId,
        latitude: numberField(entry, "latitude", "lat"),
        longitude: numberField(entry, "longitude", "lon"),
      }),
    });
  }
  return events;
}

function dedupeEvents(events: NormalizedEvent[]): DuplicateChoice[] {
  const choices = new Map<string, DuplicateChoice>();
  for (const event of events) {
    const existing = choices.get(event.id);
    if (!existing) {
      choices.set(event.id, { winner: event, dropped: [] });
      continue;
    }
    if (compareEventPriority(event, existing.winner) < 0) {
      existing.dropped.push(existing.winner);
      existing.winner = event;
    } else {
      existing.dropped.push(event);
    }
  }
  return [...choices.values()].sort((a, b) => compareEventsByTime(a.winner, b.winner));
}

function preliminaryDropReason(
  event: NormalizedEvent,
  options: RecalculateOptions,
  hardFixedBlocks: FixedBlock[],
): AgendaDroppedEvent | null {
  if (!event.id) {
    return dropEvent(
      event,
      "missing_identity",
      "Event has no stable TechWeek, Partiful, or calendar identity.",
    );
  }
  if (!Number.isFinite(event.startEpochMs) || !Number.isFinite(event.endEpochMs)) {
    return dropEvent(event, "missing_time", "Event is missing a parseable start or end time.");
  }
  if (event.endEpochMs <= event.startEpochMs) {
    return dropEvent(event, "missing_time", "Event end time is not after start time.");
  }
  if (matchesAnyIdentifier(event, options.excludedEventIds)) {
    return dropEvent(event, "status_excluded", "Event was excluded by agenda override.");
  }
  if (event.calendarBlockId && options.excludedBlockIds.has(event.calendarBlockId)) {
    return dropEvent(event, "status_excluded", "Calendar block was excluded by agenda override.");
  }
  if (event.normalizedStatus === "excluded") {
    return dropEvent(
      event,
      "status_excluded",
      `Status "${event.status}" is not eligible for planning.`,
    );
  }
  if (
    event.normalizedStatus === "waitlisted" && !event.currentSchedule &&
    !matchesAnyIdentifier(event, options.pinnedEventIds)
  ) {
    return dropEvent(
      event,
      "status_excluded",
      "Waitlisted reference events are only planned when already scheduled or pinned.",
    );
  }
  const overlaps = hardFixedBlocks.filter((block) =>
    intervalsOverlap(event.startEpochMs, event.endEpochMs, block.startEpochMs, block.endEpochMs)
  );
  if (overlaps.length > 0) {
    return dropEvent(
      event,
      "fixed_block_conflict",
      "Event overlaps a hard fixed block.",
      [],
      overlaps.map((block) => block.calendarBlockId),
    );
  }
  return null;
}

function enforceCandidateLimit(
  candidates: NormalizedEvent[],
  maxCandidates: number,
): { kept: NormalizedEvent[]; dropped: AgendaDroppedEvent[] } {
  if (candidates.length <= maxCandidates) {
    return { kept: candidates.sort(compareEventsByTime), dropped: [] };
  }
  const ranked = [...candidates].sort(compareEventPriority);
  const kept = ranked.slice(0, maxCandidates).sort(compareEventsByTime);
  const keptIds = new Set(kept.map((candidate) => candidate.id));
  const dropped = candidates
    .filter((candidate) => !keptIds.has(candidate.id))
    .map((candidate) =>
      dropEvent(
        candidate,
        "candidate_limit",
        `Per-day candidate cap kept the top ${maxCandidates} deterministic scores.`,
      )
    );
  return { kept, dropped };
}

async function planDay(
  context: PlanningContext,
  dayKey: string,
  candidates: NormalizedEvent[],
  hardFixedBlocks: FixedBlock[],
): Promise<PlannedEvent[]> {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort(compareEventsByTime);
  const planAt: Array<PlanAt | null> = Array(sorted.length).fill(null);

  for (const [index, candidate] of sorted.entries()) {
    const fromHome = await estimateRoute(context, {
      origin: context.home,
      destination: candidate.point,
      dayKey,
      arriveByEpochMs: candidate.startEpochMs,
      destinationEventId: candidate.id,
    });
    const homePlan = planForIncomingRoute(
      candidate,
      null,
      fromHome,
      context.home,
      context.options.travelMinutePenalty,
      hardFixedBlocks,
    );
    if (homePlan) planAt[index] = betterPlan(homePlan, planAt[index]);

    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previousPlan = planAt[previousIndex];
      if (!previousPlan) continue;
      const previousCandidate = sorted[previousIndex];
      if (previousCandidate.endEpochMs > candidate.startEpochMs) continue;
      const route = await estimateRoute(context, {
        origin: previousCandidate.point,
        destination: candidate.point,
        dayKey,
        arriveByEpochMs: candidate.startEpochMs,
        destinationEventId: candidate.id,
      });
      const nextPlan = planForIncomingRoute(
        candidate,
        {
          index: previousIndex,
          candidate: previousCandidate,
          plan: previousPlan,
        },
        route,
        previousCandidate.point,
        context.options.travelMinutePenalty,
        hardFixedBlocks,
      );
      if (nextPlan) planAt[index] = betterPlan(nextPlan, planAt[index]);
    }
  }

  let bestIndex: number | null = null;
  for (const [index, plan] of planAt.entries()) {
    if (!plan) continue;
    if (bestIndex === null || betterPlan(plan, planAt[bestIndex]) === plan) {
      bestIndex = index;
    }
  }
  if (bestIndex === null) return [];

  const selected: PlannedEvent[] = [];
  let cursor: number | null = bestIndex;
  while (cursor !== null) {
    const plan: PlanAt | null = planAt[cursor];
    if (!plan) break;
    const candidate = sorted[cursor];
    selected.push({
      candidate,
      incomingRoute: plan.incomingRoute,
      incomingOrigin: plan.incomingOrigin,
      previousEventId: plan.prevIndex === null ? null : sorted[plan.prevIndex].id,
    });
    cursor = plan.prevIndex;
  }

  return selected.reverse();
}

function planForIncomingRoute(
  candidate: NormalizedEvent,
  previous: { index: number; candidate: NormalizedEvent; plan: PlanAt } | null,
  incomingRoute: AgendaRouteEstimate,
  incomingOrigin: AgendaRoutePoint,
  travelMinutePenalty: number,
  hardFixedBlocks: FixedBlock[],
): PlanAt | null {
  const travelStartMs = candidate.startEpochMs - incomingRoute.minutes * MINUTE_MS;
  const previousEndMs = previous?.candidate.endEpochMs ?? Number.NEGATIVE_INFINITY;
  if (previousEndMs > travelStartMs) return null;
  if (intervalOverlapsFixedBlock(travelStartMs, candidate.startEpochMs, hardFixedBlocks)) {
    return null;
  }
  const totalScore = (previous?.plan.totalScore ?? 0) + candidate.score -
    incomingRoute.minutes * travelMinutePenalty;
  return {
    totalScore,
    prevIndex: previous?.index ?? null,
    incomingRoute,
    incomingOrigin,
    tieKey: `${
      previous?.plan.tieKey ?? ""
    }|${candidate.startEpochMs}:${candidate.id}:${incomingRoute.minutes}`,
  };
}

function betterPlan(candidate: PlanAt, incumbent: PlanAt | null): PlanAt {
  if (!incumbent) return candidate;
  if (Math.abs(candidate.totalScore - incumbent.totalScore) > 0.001) {
    return candidate.totalScore > incumbent.totalScore ? candidate : incumbent;
  }
  return candidate.tieKey < incumbent.tieKey ? candidate : incumbent;
}

async function buildDayBlocks(
  context: PlanningContext,
  dayKey: string,
  selectedEvents: PlannedEvent[],
): Promise<AgendaBlock[]> {
  const blocks: AgendaBlock[] = [];
  for (const planned of selectedEvents) {
    const travel = travelBlockForPlannedEvent(context, dayKey, planned);
    if (travel) blocks.push(travel);
    blocks.push(eventBlockForCandidate(planned.candidate));
  }
  if (context.options.includeReturnHome && selectedEvents.length > 0) {
    const last = selectedEvents[selectedEvents.length - 1];
    const route = await estimateRoute(context, {
      origin: last.candidate.point,
      destination: context.home,
      dayKey,
      arriveByEpochMs: last.candidate.endEpochMs,
    });
    const returnHome = returnHomeBlock(context, dayKey, last.candidate, route);
    if (returnHome) blocks.push(returnHome);
  }
  return blocks;
}

function travelBlockForPlannedEvent(
  context: PlanningContext,
  dayKey: string,
  planned: PlannedEvent,
): AgendaBlock | null {
  const route = planned.incomingRoute;
  if (route.minutes <= 0) return null;
  const event = planned.candidate;
  const startEpochMs = event.startEpochMs - route.minutes * MINUTE_MS;
  return {
    agendaBlockId: `${event.id}-travel-in`,
    calendar: "schedule",
    techweekId: event.techweekId,
    calendarBlockId: `${safeIdentifier(event.id)}-TRAVEL-IN`,
    partifulId: event.partifulId,
    rerankId: event.rerankId,
    entryType: "travel",
    blockType: "travel",
    source: "generated_travel",
    status: "registered",
    category: "travel",
    start: formatLocalDateTime(startEpochMs, context.timeZone),
    end: formatLocalDateTime(event.startEpochMs, context.timeZone),
    actualStart: formatLocalDateTime(startEpochMs, context.timeZone),
    actualEnd: formatLocalDateTime(event.startEpochMs, context.timeZone),
    startEpochMs,
    endEpochMs: event.startEpochMs,
    actualStartEpochMs: startEpochMs,
    actualEndEpochMs: event.startEpochMs,
    dayKey,
    title: `Travel: ${planned.incomingOrigin.name} -> ${event.title}`,
    displayTitle: `Travel: ${planned.incomingOrigin.name} -> ${event.title}`,
    location: `${planned.incomingOrigin.location} -> ${event.location}`,
    venueQuery: `${planned.incomingOrigin.venueQuery} -> ${event.venueQuery}`,
    venuePrecision: "",
    routeMode: route.mode,
    travelMinutes: route.minutes,
    routeDetails: route.details,
    subwaySegments: route.subwaySegments ?? "",
    transitRisk: route.transitRisk ?? "",
    note: planned.previousEventId
      ? `Generated travel from ${planned.previousEventId} to ${event.id}.`
      : "Generated travel from home anchor.",
    rank: "",
    tier: "",
    opportunityScore: "",
    eventUrl: event.eventUrl,
    googleMapsUrl: route.googleMapsUrl || event.googleMapsUrl,
    routeEstimate: route,
    generatedReason: "Inserted so travel ends before the event starts.",
  };
}

function returnHomeBlock(
  context: PlanningContext,
  dayKey: string,
  lastEvent: NormalizedEvent,
  route: AgendaRouteEstimate,
): AgendaBlock | null {
  if (route.minutes <= 0) return null;
  const startEpochMs = lastEvent.endEpochMs;
  const endEpochMs = startEpochMs + route.minutes * MINUTE_MS;
  return {
    agendaBlockId: `${dayKey}-travel-home`,
    calendar: "schedule",
    techweekId: lastEvent.techweekId,
    calendarBlockId: `TW-${dayKey.replaceAll("-", "")}-TRAVEL-HOME`,
    partifulId: lastEvent.partifulId,
    rerankId: lastEvent.rerankId,
    entryType: "travel",
    blockType: "travel",
    source: "generated_travel",
    status: "registered",
    category: "travel",
    start: formatLocalDateTime(startEpochMs, context.timeZone),
    end: formatLocalDateTime(endEpochMs, context.timeZone),
    actualStart: formatLocalDateTime(startEpochMs, context.timeZone),
    actualEnd: formatLocalDateTime(endEpochMs, context.timeZone),
    startEpochMs,
    endEpochMs,
    actualStartEpochMs: startEpochMs,
    actualEndEpochMs: endEpochMs,
    dayKey,
    title: `Travel: ${lastEvent.location} -> ${context.home.name}`,
    displayTitle: `Travel: ${lastEvent.location} -> ${context.home.name}`,
    location: `${lastEvent.location} -> ${context.home.location}`,
    venueQuery: `${lastEvent.venueQuery} -> ${context.home.venueQuery}`,
    venuePrecision: "",
    routeMode: route.mode,
    travelMinutes: route.minutes,
    routeDetails: route.details,
    subwaySegments: route.subwaySegments ?? "",
    transitRisk: route.transitRisk ?? "",
    note: "Generated return-home travel estimate.",
    rank: "",
    tier: "",
    opportunityScore: "",
    eventUrl: lastEvent.eventUrl,
    googleMapsUrl: route.googleMapsUrl || "",
    routeEstimate: route,
    generatedReason: "Inserted after the last selected event of the day.",
  };
}

function eventBlockForCandidate(candidate: NormalizedEvent): AgendaBlock {
  return {
    agendaBlockId: `${candidate.id}-event`,
    calendar: "schedule",
    techweekId: candidate.techweekId,
    calendarBlockId: `${safeIdentifier(candidate.id)}-SCHEDULE`,
    partifulId: candidate.partifulId,
    rerankId: candidate.rerankId,
    entryType: "event",
    blockType: "event",
    source: "selected_event",
    status: candidate.status,
    category: candidate.category,
    start: candidate.start,
    end: candidate.end,
    actualStart: candidate.actualStart,
    actualEnd: candidate.actualEnd,
    startEpochMs: candidate.startEpochMs,
    endEpochMs: candidate.endEpochMs,
    actualStartEpochMs: candidate.actualStartEpochMs,
    actualEndEpochMs: candidate.actualEndEpochMs,
    dayKey: candidate.dayKey,
    title: candidate.title,
    displayTitle: candidate.displayTitle,
    location: candidate.location,
    venueQuery: candidate.venueQuery,
    venuePrecision: candidate.venuePrecision,
    routeMode: "",
    travelMinutes: null,
    routeDetails: "",
    subwaySegments: "",
    transitRisk: "",
    note: candidate.note,
    rank: candidate.rank,
    tier: candidate.tier,
    opportunityScore: candidate.opportunityScore,
    eventUrl: candidate.eventUrl,
    googleMapsUrl: candidate.googleMapsUrl,
    score: candidate.score,
    scoreBreakdown: candidate.scoreBreakdown,
    generatedReason: "Selected by deterministic agenda score and travel feasibility.",
  };
}

function retainFixedBlocks(
  context: PlanningContext,
  fixedBlocks: FixedBlock[],
  selectedDayBlocks: AgendaBlock[],
): AgendaBlock[] {
  const retained: AgendaBlock[] = [];
  for (const block of fixedBlocks) {
    if (block.blockType === "travel") continue;
    const overlap = selectedDayBlocks.find((selected) =>
      intervalsOverlap(
        block.startEpochMs,
        block.endEpochMs,
        selected.startEpochMs,
        selected.endEpochMs,
      )
    );
    if (overlap && !context.options.lockedBlockIds.has(block.calendarBlockId)) {
      context.warnings.push({
        code: "fixed_block_dropped",
        message: `Dropped fixed block "${block.title}" because it overlaps ${overlap.title}.`,
        dayKey: block.dayKey,
        blockId: block.calendarBlockId,
      });
      continue;
    }
    retained.push(block);
  }
  return retained;
}

async function estimateRoute(
  context: PlanningContext,
  request: {
    origin: AgendaRoutePoint;
    destination: AgendaRoutePoint;
    dayKey: string;
    arriveByEpochMs: number;
    destinationEventId?: string;
  },
): Promise<AgendaRouteEstimate> {
  const key = routeCacheKey(request.dayKey, request.origin, request.destination);
  const cached = context.routeCache.get(key);
  if (cached) return await cached;

  const promise = estimateRouteUncached(context, request);
  context.routeCache.set(key, promise);
  return await promise;
}

async function estimateRouteUncached(
  context: PlanningContext,
  request: {
    origin: AgendaRoutePoint;
    destination: AgendaRoutePoint;
    dayKey: string;
    arriveByEpochMs: number;
    destinationEventId?: string;
  },
): Promise<AgendaRouteEstimate> {
  context.routeEstimateCount += 1;
  if (samePlace(request.origin, request.destination)) {
    return {
      mode: "walk",
      minutes: 0,
      details: "Origin and destination resolve to the same place.",
      source: "same_place",
    };
  }
  if (!context.input.routeEstimator) {
    if (!context.missingRouteEstimatorWarned) {
      context.warnings.push({
        code: "route_estimator_missing",
        message:
          "No routeEstimator was provided; agenda used default deploy-safe travel estimates.",
      });
      context.missingRouteEstimatorWarned = true;
    }
    return fallbackRoute(context, "route_estimator_missing");
  }

  try {
    const raw = await context.input.routeEstimator({
      origin: request.origin,
      destination: request.destination,
      dayKey: request.dayKey,
      arriveBy: formatLocalDateTime(request.arriveByEpochMs, context.timeZone),
      arriveByEpochMs: request.arriveByEpochMs,
      destinationEventId: request.destinationEventId,
      routeVersion: context.routeVersion,
    });
    const normalized = normalizeRouteEstimate(raw, context.options.minTravelBufferMinutes);
    if (normalized) return normalized;
    context.warnings.push({
      code: "route_estimator_empty",
      message:
        `Route estimator returned no usable estimate for ${request.origin.name} -> ${request.destination.name}.`,
      dayKey: request.dayKey,
      eventId: request.destinationEventId,
    });
    return fallbackRoute(context, "route_estimator_empty");
  } catch (error) {
    context.warnings.push({
      code: "route_estimator_error",
      message: `Route estimator failed for ${request.origin.name} -> ${request.destination.name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      dayKey: request.dayKey,
      eventId: request.destinationEventId,
    });
    return fallbackRoute(context, "route_estimator_error");
  }
}

function fallbackRoute(context: PlanningContext, source: string): AgendaRouteEstimate {
  context.fallbackRouteEstimateCount += 1;
  return {
    mode: "estimated",
    minutes: context.options.defaultTravelMinutes + context.options.minTravelBufferMinutes,
    details: "Default travel estimate; inject routeEstimator for exact OSM/subway routing.",
    transitRisk: "unknown",
    source,
  };
}

function normalizeRouteEstimate(
  route: AgendaRouteEstimate | null,
  minTravelBufferMinutes: number,
): AgendaRouteEstimate | null {
  if (!route) return null;
  const minutes = Math.max(0, Math.ceil(Number(route.minutes)));
  if (!Number.isFinite(minutes)) return null;
  const bufferedMinutes = minutes + minTravelBufferMinutes;
  return {
    ...route,
    minutes: bufferedMinutes,
    details: minTravelBufferMinutes > 0
      ? `${route.details}; includes ${minTravelBufferMinutes} min agenda buffer.`
      : route.details,
  };
}

function normalizeFixedBlocks(
  entries: AgendaScheduleEntry[],
  options: RecalculateOptions,
  timeZone: string,
): FixedBlock[] {
  const blocks: FixedBlock[] = [];
  for (const entry of entries) {
    const blockType = normalizeBlockType(entry);
    if (blockType === "event" || blockType === "travel") continue;
    if (stringField(entry, "calendar") && stringField(entry, "calendar") !== "schedule") continue;
    const startEpochMs = epochField(entry, ["actualStartEpochMs", "actual_start_epoch_ms"]) ||
      epochField(entry, ["startEpochMs", "start_epoch_ms"]) ||
      parseLocalDateTime(stringField(entry, "actualStart", "actual_start", "start"), timeZone);
    const endEpochMs = epochField(entry, ["actualEndEpochMs", "actual_end_epoch_ms"]) ||
      epochField(entry, ["endEpochMs", "end_epoch_ms"]) ||
      parseLocalDateTime(stringField(entry, "actualEnd", "actual_end", "end"), timeZone);
    if (
      !Number.isFinite(startEpochMs) || !Number.isFinite(endEpochMs) || endEpochMs <= startEpochMs
    ) {
      continue;
    }
    const calendarBlockId = stringField(entry, "calendarBlockId", "calendar_block_id") ||
      `fixed-${startEpochMs}-${endEpochMs}`;
    const dayKey = stringField(entry, "dayKey", "day_key") ||
      stringField(entry, "start").slice(0, 10) ||
      formatLocalDate(startEpochMs, timeZone);
    const title = stringField(entry, "title") || blockType;
    blocks.push({
      agendaBlockId: calendarBlockId,
      calendar: "schedule",
      techweekId: stringField(entry, "techweekId", "techweek_id"),
      calendarBlockId,
      partifulId: stringField(entry, "partifulId", "partiful_id"),
      rerankId: stringField(entry, "rerankId", "rerank_id"),
      entryType: stringField(entry, "entryType", "entry_type") || blockType,
      blockType,
      source: "fixed_schedule",
      status: stringField(entry, "status") || "registered",
      category: stringField(entry, "category") || blockType,
      start: stringField(entry, "actualStart", "actual_start", "start") ||
        formatLocalDateTime(startEpochMs, timeZone),
      end: stringField(entry, "actualEnd", "actual_end", "end") ||
        formatLocalDateTime(endEpochMs, timeZone),
      actualStart: stringField(entry, "actualStart", "actual_start", "start") ||
        formatLocalDateTime(startEpochMs, timeZone),
      actualEnd: stringField(entry, "actualEnd", "actual_end", "end") ||
        formatLocalDateTime(endEpochMs, timeZone),
      startEpochMs,
      endEpochMs,
      actualStartEpochMs: startEpochMs,
      actualEndEpochMs: endEpochMs,
      dayKey,
      title,
      displayTitle: title,
      location: stringField(entry, "location"),
      venueQuery: stringField(entry, "venueQuery", "venue_query"),
      venuePrecision: stringField(entry, "venuePrecision", "venue_precision"),
      routeMode: stringField(entry, "routeMode", "route_mode"),
      travelMinutes: nullableNumberField(entry, "travelMinutes", "travel_minutes"),
      routeDetails: stringField(entry, "routeDetails", "route_details"),
      subwaySegments: stringField(entry, "subwaySegments", "subway_segments"),
      transitRisk: stringField(entry, "transitRisk", "transit_risk"),
      note: stringField(entry, "note"),
      rank: stringField(entry, "rank"),
      tier: stringField(entry, "tier"),
      opportunityScore: stringField(entry, "opportunityScore", "opportunity_score"),
      eventUrl: stringField(entry, "eventUrl", "event_url"),
      googleMapsUrl: stringField(entry, "googleMapsUrl", "google_maps_url"),
      generatedReason: "Preserved fixed non-travel schedule block.",
      hardConstraint: blockType === "sleeping" || options.hardFixedBlockIds.has(calendarBlockId),
    });
  }
  return blocks.sort(compareBlocks);
}

function scoreBreakdownForEvent(input: {
  entry: AgendaScheduleEntry;
  normalizedStatus: AgendaNormalizedStatus;
  identifiers: string[];
  currentSchedule: boolean;
  options: RecalculateOptions;
}): AgendaScoreBreakdown {
  const { entry, normalizedStatus, identifiers, currentSchedule, options } = input;
  const breakdown: AgendaScoreBreakdown = {};
  const statusScore: Record<AgendaNormalizedStatus, number> = {
    registered: 1_000,
    accepted: 980,
    applied: 650,
    waitlisted: 220,
    unknown: 300,
    excluded: -5_000,
  };
  breakdown.status = statusScore[normalizedStatus];
  if (currentSchedule) breakdown.currentSchedule = 300;
  if (setHasAny(options.pinnedEventIds, identifiers)) breakdown.pinned = 650;
  if (setHasAny(options.preferredEventIds, identifiers)) breakdown.preferred = 160;

  const category = stringField(entry, "category").toLowerCase();
  if (category === "primary") breakdown.category = 90;
  else if (category === "apply" || category === "curated") breakdown.category = 55;
  else if (category === "backup") breakdown.category = 20;

  const opportunity = nullableNumberField(entry, "opportunityScore", "opportunity_score");
  if (opportunity !== null) breakdown.opportunity = clamp(opportunity, 0, 100);

  const rank = nullableNumberField(entry, "rank");
  if (rank !== null && rank > 0) breakdown.rank = Math.max(0, 80 - Math.min(rank, 80));

  const tier = stringField(entry, "tier").toLowerCase();
  if (tier.includes("top") || tier === "1" || tier === "a") breakdown.tier = 35;
  else if (tier === "2" || tier === "b") breakdown.tier = 20;

  return breakdown;
}

function scoreFromBreakdown(breakdown: AgendaScoreBreakdown): number {
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0);
}

function classifyUnselectedCandidate(
  candidate: NormalizedEvent,
  selectedEvents: AgendaBlock[],
  selectedEventIds: Set<string>,
): AgendaDroppedEvent {
  const overlaps = selectedEvents.filter((block) =>
    intervalsOverlap(
      candidate.startEpochMs,
      candidate.endEpochMs,
      block.startEpochMs,
      block.endEpochMs,
    )
  );
  if (overlaps.length > 0) {
    return dropEvent(
      candidate,
      "conflict",
      "A selected event with a higher deterministic route score occupies the same time window.",
      overlaps.map(stableBlockEventId).filter((id) => id && id !== candidate.id),
      overlaps.map((block) => block.calendarBlockId),
    );
  }
  const sameDaySelected = selectedEvents.filter((block) => block.dayKey === candidate.dayKey);
  const before = sameDaySelected.toReversed().find((block) =>
    block.endEpochMs <= candidate.startEpochMs
  );
  const after = sameDaySelected.find((block) => block.startEpochMs >= candidate.endEpochMs);
  if (before && after && selectedEventIds.has(stableBlockEventId(before))) {
    return dropEvent(
      candidate,
      "travel_conflict",
      "Event was not part of the highest-scoring travel-feasible sequence for the day.",
      [stableBlockEventId(before), stableBlockEventId(after)].filter(Boolean),
      [before.calendarBlockId, after.calendarBlockId],
    );
  }
  return dropEvent(
    candidate,
    "lower_score",
    "Event was eligible, but another deterministic combination scored higher.",
  );
}

function dropEvent(
  event: NormalizedEvent,
  reason: AgendaDropReason,
  detail: string,
  conflictingEventIds: string[] = [],
  conflictingBlockIds: string[] = [],
): AgendaDroppedEvent {
  return {
    event: summarizeEvent(event),
    reason,
    detail,
    conflictingEventIds: [...new Set(conflictingEventIds.filter(Boolean))],
    conflictingBlockIds: [...new Set(conflictingBlockIds.filter(Boolean))],
  };
}

function summarizeEvent(event: NormalizedEvent): AgendaEventSummary {
  return {
    id: event.id,
    techweekId: event.techweekId,
    calendarBlockId: event.calendarBlockId,
    partifulId: event.partifulId,
    rerankId: event.rerankId,
    title: event.title,
    status: event.status,
    normalizedStatus: event.normalizedStatus,
    category: event.category,
    dayKey: event.dayKey,
    start: event.start,
    end: event.end,
    startEpochMs: event.startEpochMs,
    endEpochMs: event.endEpochMs,
    location: event.location,
    score: event.score,
    scoreBreakdown: event.scoreBreakdown,
    identifiers: event.identifiers,
    currentSchedule: event.currentSchedule,
  };
}

function buildSummary(input: {
  inputBlocks: number;
  inputEvents: number;
  candidates: NormalizedEvent[];
  selectedBlocks: AgendaBlock[];
  droppedEvents: AgendaDroppedEvent[];
  routeEstimateCount: number;
  fallbackRouteEstimateCount: number;
}): AgendaSummary {
  const selectedEvents = input.selectedBlocks.filter((block) => block.blockType === "event");
  const travelBlocks = input.selectedBlocks.filter((block) => block.blockType === "travel");
  const fixedBlocks = input.selectedBlocks.filter((block) => block.source === "fixed_schedule");
  const byStatus: Record<string, number> = {};
  for (const candidate of input.candidates) {
    byStatus[candidate.normalizedStatus] = (byStatus[candidate.normalizedStatus] ?? 0) + 1;
  }
  const byDay: AgendaSummary["byDay"] = {};
  for (const candidate of input.candidates) {
    byDay[candidate.dayKey] ??= {
      candidates: 0,
      selectedEvents: 0,
      selectedBlocks: 0,
      droppedEvents: 0,
      travelBlocks: 0,
    };
    byDay[candidate.dayKey].candidates += 1;
  }
  for (const block of input.selectedBlocks) {
    byDay[block.dayKey] ??= {
      candidates: 0,
      selectedEvents: 0,
      selectedBlocks: 0,
      droppedEvents: 0,
      travelBlocks: 0,
    };
    byDay[block.dayKey].selectedBlocks += 1;
    if (block.blockType === "event") byDay[block.dayKey].selectedEvents += 1;
    if (block.blockType === "travel") byDay[block.dayKey].travelBlocks += 1;
  }
  for (const drop of input.droppedEvents) {
    byDay[drop.event.dayKey] ??= {
      candidates: 0,
      selectedEvents: 0,
      selectedBlocks: 0,
      droppedEvents: 0,
      travelBlocks: 0,
    };
    byDay[drop.event.dayKey].droppedEvents += 1;
  }
  const conflictEvents = input.droppedEvents.filter((drop) =>
    drop.reason === "conflict" || drop.reason === "travel_conflict" ||
    drop.reason === "fixed_block_conflict"
  );
  return {
    inputBlocks: input.inputBlocks,
    inputEvents: input.inputEvents,
    candidateEvents: input.candidates.length,
    selectedBlocks: input.selectedBlocks.length,
    selectedEvents: selectedEvents.length,
    travelBlocks: travelBlocks.length,
    fixedBlocks: fixedBlocks.length,
    droppedEvents: input.droppedEvents.length,
    conflictEvents: conflictEvents.length,
    routeEstimateCount: input.routeEstimateCount,
    fallbackRouteEstimateCount: input.fallbackRouteEstimateCount,
    byStatus,
    byDay,
  };
}

function groupCandidatesByDay(candidates: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
  const days = new Map<string, NormalizedEvent[]>();
  for (const candidate of candidates) {
    const current = days.get(candidate.dayKey) ?? [];
    current.push(candidate);
    days.set(candidate.dayKey, current);
  }
  return days;
}

function groupFixedBlocksByDay(blocks: FixedBlock[]): Map<string, FixedBlock[]> {
  const days = new Map<string, FixedBlock[]>();
  for (const block of blocks) {
    const current = days.get(block.dayKey) ?? [];
    current.push(block);
    days.set(block.dayKey, current);
  }
  return days;
}

function hardFixedBlocksForDay(blocks: FixedBlock[], dayKey: string): FixedBlock[] {
  return blocks.filter((block) => block.dayKey === dayKey);
}

function normalizeBlockType(entry: AgendaScheduleEntry): AgendaBlockType {
  const explicit = stringField(entry, "blockType", "block_type");
  if (
    explicit === "event" || explicit === "travel" || explicit === "eating" ||
    explicit === "sleeping"
  ) {
    return explicit;
  }
  const entryType = stringField(entry, "entryType", "entry_type");
  if (entryType === "event") return "event";
  if (entryType === "travel") return "travel";
  if (entryType === "meal") return "eating";
  if (entryType === "sleep") return "sleeping";
  return "other";
}

function statusForEntry(
  entry: AgendaScheduleEntry,
  updates: Map<string, string>,
  identifiers: string[],
): string {
  for (const id of identifiers) {
    const update = updates.get(id);
    if (update) return update;
  }
  return stringField(entry, "status") || "unknown";
}

function normalizeStatus(status: string, title: string): AgendaNormalizedStatus {
  const text = `${status} ${title}`.toLowerCase();
  if (
    /(rejected|declined|cancelled|canceled|blocked|unavailable|sold out|payment|required payment)/
      .test(text)
  ) {
    return "excluded";
  }
  if (/(waitlist|waitlisted)/.test(text)) return "waitlisted";
  if (/(registered|confirmed|going|attending)/.test(text)) return "registered";
  if (/(accepted|approved|you.?re in|you are in)/.test(text)) return "accepted";
  if (/(applied|pending|requested|approval)/.test(text)) return "applied";
  return "unknown";
}

function canonicalEventId(entry: AgendaScheduleEntry, identifiers: string[]): string {
  const techweekId = canonicalTechWeekId(entry);
  if (techweekId) return techweekId;
  const rerankId = stringField(entry, "rerankId", "rerank_id");
  if (rerankId) return `TW-${rerankId}`;
  const fromCalendarBlock = canonicalFromCalendarBlock(
    stringField(entry, "calendarBlockId", "calendar_block_id"),
  );
  if (fromCalendarBlock) return fromCalendarBlock;
  const partifulId = stringField(entry, "partifulId", "partiful_id");
  if (partifulId) return `partiful:${partifulId}`;
  return identifiers[0] ?? "";
}

function canonicalTechWeekId(entry: AgendaScheduleEntry): string {
  const raw = stringField(entry, "techweekId", "techweek_id");
  if (!raw) return "";
  return raw.startsWith("TW-") ? raw : `TW-${raw}`;
}

function canonicalFromCalendarBlock(calendarBlockId: string): string {
  const match = calendarBlockId.match(/^(TW-\d+)(?:-|$)/);
  return match?.[1] ?? "";
}

function entryIdentifiers(entry: AgendaScheduleEntry): string[] {
  const ids = new Set<string>();
  const add = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    ids.add(clean);
    if (clean.startsWith("TW-")) ids.add(clean.slice(3));
    else if (/^\d+$/.test(clean)) ids.add(`TW-${clean}`);
  };
  add(stringField(entry, "techweekId", "techweek_id"));
  add(stringField(entry, "calendarBlockId", "calendar_block_id"));
  add(canonicalFromCalendarBlock(stringField(entry, "calendarBlockId", "calendar_block_id")));
  add(stringField(entry, "partifulId", "partiful_id"));
  add(stringField(entry, "rerankId", "rerank_id"));
  return [...ids];
}

function pointForEvent(input: {
  id: string;
  title: string;
  location: string;
  venueQuery: string;
  venuePrecision: string;
  calendarBlockId: string;
  latitude: number | null;
  longitude: number | null;
}): AgendaRoutePoint {
  return {
    id: input.id,
    name: input.title,
    location: input.location || input.venueQuery || input.title,
    venueQuery: input.venueQuery || input.location || input.title,
    venuePrecision: input.venuePrecision,
    latitude: input.latitude ?? undefined,
    longitude: input.longitude ?? undefined,
    sourceEventId: input.id,
    sourceCalendarBlockId: input.calendarBlockId,
  };
}

function compareEventPriority(a: NormalizedEvent, b: NormalizedEvent): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.currentSchedule !== b.currentSchedule) return a.currentSchedule ? -1 : 1;
  if (a.startEpochMs !== b.startEpochMs) return a.startEpochMs - b.startEpochMs;
  return a.id.localeCompare(b.id);
}

function compareEventsByTime(a: NormalizedEvent, b: NormalizedEvent): number {
  if (a.startEpochMs !== b.startEpochMs) return a.startEpochMs - b.startEpochMs;
  if (a.endEpochMs !== b.endEpochMs) return a.endEpochMs - b.endEpochMs;
  return compareEventPriority(a, b);
}

function compareBlocks(a: AgendaBlock, b: AgendaBlock): number {
  if (a.startEpochMs !== b.startEpochMs) return a.startEpochMs - b.startEpochMs;
  if (a.endEpochMs !== b.endEpochMs) return a.endEpochMs - b.endEpochMs;
  const typeOrder: Record<AgendaBlockType, number> = {
    sleeping: 0,
    eating: 1,
    travel: 2,
    event: 3,
    other: 4,
  };
  if (typeOrder[a.blockType] !== typeOrder[b.blockType]) {
    return typeOrder[a.blockType] - typeOrder[b.blockType];
  }
  return a.calendarBlockId.localeCompare(b.calendarBlockId);
}

function compareDrops(a: AgendaDroppedEvent, b: AgendaDroppedEvent): number {
  if (a.event.startEpochMs !== b.event.startEpochMs) {
    return a.event.startEpochMs - b.event.startEpochMs;
  }
  return a.event.id.localeCompare(b.event.id);
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function intervalOverlapsFixedBlock(
  startMs: number,
  endMs: number,
  fixedBlocks: FixedBlock[],
): boolean {
  return fixedBlocks.some((block) =>
    intervalsOverlap(startMs, endMs, block.startEpochMs, block.endEpochMs)
  );
}

function samePlace(a: AgendaRoutePoint, b: AgendaRoutePoint): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  const left = `${a.latitude ?? ""},${a.longitude ?? ""}`;
  const right = `${b.latitude ?? ""},${b.longitude ?? ""}`;
  if (a.latitude !== undefined && a.longitude !== undefined && left === right) return true;
  const leftPlace = normalizePlace(a.venueQuery || a.location);
  const rightPlace = normalizePlace(b.venueQuery || b.location);
  return Boolean(leftPlace && rightPlace && leftPlace === rightPlace);
}

function normalizePlace(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function routeCacheKey(
  dayKey: string,
  origin: AgendaRoutePoint,
  destination: AgendaRoutePoint,
): string {
  return `${dayKey}:${origin.id}:${destination.id}`;
}

function stableBlockEventId(block: AgendaBlock): string {
  if (block.techweekId) return block.techweekId;
  if (block.rerankId) return `TW-${block.rerankId}`;
  if (block.partifulId) return `partiful:${block.partifulId}`;
  return canonicalFromCalendarBlock(block.calendarBlockId);
}

function matchesAnyIdentifier(event: NormalizedEvent, ids: Set<string>): boolean {
  return setHasAny(ids, event.identifiers) || ids.has(event.id);
}

function setHasAny(set: Set<string>, values: string[]): boolean {
  return values.some((value) => set.has(value));
}

function stringSet(...values: Array<string[] | undefined>): Set<string> {
  const set = new Set<string>();
  for (const array of values) {
    for (const value of array ?? []) {
      const clean = String(value).trim();
      if (!clean) continue;
      set.add(clean);
      if (clean.startsWith("TW-")) set.add(clean.slice(3));
      else if (/^\d+$/.test(clean)) set.add(`TW-${clean}`);
    }
  }
  return set;
}

function stringField(entry: AgendaScheduleEntry, ...keys: string[]): string {
  for (const key of keys) {
    const value = entry[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function numberField(entry: AgendaScheduleEntry, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = entry[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nullableNumberField(entry: AgendaScheduleEntry, ...keys: string[]): number | null {
  return numberField(entry, ...keys);
}

function epochField(entry: AgendaScheduleEntry, keys: string[]): number {
  for (const key of keys) {
    const value = entry[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function parseLocalDateTime(value: string, _timeZone: string): number {
  if (!value) return Number.NaN;
  const normalized = value.trim().replace(" ", "T");
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
    ? `${normalized}:00`
    : normalized;
  return Date.parse(`${withSeconds}${DEFAULT_UTC_OFFSET}`);
}

function formatLocalDate(epochMs: number, timeZone: string): string {
  return formatLocalDateTime(epochMs, timeZone).slice(0, 10);
}

function formatLocalDateTime(epochMs: number, timeZone: string): string {
  if (!Number.isFinite(epochMs)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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

function stripStatusPrefix(title: string): string {
  const match = title.match(/^\[[^\]]+\]\s*(.+)$/);
  return match?.[1]?.trim() || title;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(0, Math.floor(value));
}

function finiteNumber(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeIdentifier(value: string): string {
  const normalized = value.replace(/^partiful:/, "PF-").replaceAll(/[^A-Za-z0-9_-]/g, "-");
  return normalized || "UNKNOWN";
}

function buildAgendaRunId(
  generatedAt: string,
  selectedBlocks: AgendaBlock[],
  droppedEvents: AgendaDroppedEvent[],
): string {
  const timestamp = generatedAt.replaceAll(/\D/g, "").slice(0, 14);
  const hashInput = [
    generatedAt,
    ...selectedBlocks.map((block) => `${block.calendarBlockId}:${block.start}:${block.end}`),
    ...droppedEvents.map((drop) => `${drop.event.id}:${drop.reason}`),
  ].join("|");
  return `agenda-${timestamp}-${fnv1a(hashInput)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
