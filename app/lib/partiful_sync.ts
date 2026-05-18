export type PartifulSyncStatus =
  | "registered"
  | "applied"
  | "waitlisted"
  | "rejected"
  | "skipped"
  | "unknown";

export type PartifulPlusOneState = "none" | "tbd" | "named" | "unknown";

export type PartifulVenuePrecision = "exact" | "approximate" | "hidden" | "unknown";

export type PartifulEventLike = {
  calendarBlockId?: string;
  calendar_block_id?: string;
  eventName?: string;
  event_name?: string;
  eventUrl?: string;
  event_url?: string;
  id?: string;
  location?: string;
  note?: string;
  notes?: string;
  partifulEventUrl?: string;
  partifulId?: string;
  partiful_id?: string;
  partifulRawStatus?: string;
  partifulStatus?: string;
  partifulUrl?: string;
  partiful_url?: string;
  rsvpStatus?: string;
  status?: string;
  techweekId?: string;
  techweek_id?: string;
  title?: string;
  url?: string;
  venue?: string;
  venue_revealed?: string | boolean;
  venueRevealed?: string | boolean;
  [key: string]: unknown;
};

export type NormalizedPartifulVenue = {
  label: string;
  address: string;
  googleMapsUrl: string;
  appleMapsUrl: string;
  precision: PartifulVenuePrecision;
};

export type NormalizedPartifulEvent = {
  partifulId: string;
  eventUrl: string;
  title: string;
  status: PartifulSyncStatus;
  rawStatus: string;
  rawEventStatus: string;
  description: string;
  startAt: string;
  endAt: string;
  updatedAt: string;
  approvedAt: string;
  rsvpCount: number | null;
  guestCount: number | null;
  plusOne: PartifulPlusOneState;
  venue: NormalizedPartifulVenue | null;
  source: string;
  rawPayload?: unknown;
};

export type PartifulSyncIssue = {
  code: string;
  message: string;
  partifulId?: string;
  eventUrl?: string;
  title?: string;
  detail?: unknown;
};

export type NormalizedPartifulSnapshotResult = {
  event: NormalizedPartifulEvent | null;
  errors: PartifulSyncIssue[];
  warnings: PartifulSyncIssue[];
};

export type PartifulStatusChange = {
  partifulId: string;
  eventUrl: string;
  title: string;
  previousStatus: PartifulSyncStatus;
  nextStatus: PartifulSyncStatus;
  previousRawStatus: string;
  nextRawStatus: string;
  changedAt: string;
  matchedBy: PartifulMatchKind;
  currentIndex: number | null;
};

export type PartifulSyncedFields = {
  eventUrl: string;
  partifulEventUrl: string;
  partifulId: string;
  partifulRawStatus: string;
  partifulStatus: string;
  partifulSyncedAt: string;
  status: PartifulSyncStatus;
  title: string;
};

export type PartifulMergedEvent<T extends PartifulEventLike = PartifulEventLike> =
  & T
  & PartifulSyncedFields;

export type PartifulEventUpdate<T extends PartifulEventLike = PartifulEventLike> = {
  currentEvent: T | null;
  currentIndex: number | null;
  mergedEvent: PartifulMergedEvent<T>;
  normalizedEvent: NormalizedPartifulEvent;
  previousStatus: PartifulSyncStatus;
  statusChanged: boolean;
  matchedBy: PartifulMatchKind;
};

export type PartifulMatchKind = "partiful_id" | "event_url" | "none";

export type PartifulEventIndexEntry<T extends PartifulEventLike = PartifulEventLike> = {
  event: T;
  index: number;
  keys: string[];
};

export type PartifulEventIndex<T extends PartifulEventLike = PartifulEventLike> = {
  byKey: Map<string, PartifulEventIndexEntry<T>>;
  duplicates: PartifulSyncIssue[];
};

export type SyncPartifulOptions = {
  includeRawPayload?: boolean;
  source?: string;
  syncedAt?: string;
};

export type PartifulSyncResult<T extends PartifulEventLike = PartifulEventLike> = {
  syncedAt: string;
  currentCount: number;
  snapshotCount: number;
  updatedEvents: PartifulEventUpdate<T>[];
  unchangedEvents: PartifulEventUpdate<T>[];
  statusChanges: PartifulStatusChange[];
  unmatchedSnapshots: NormalizedPartifulEvent[];
  errors: PartifulSyncIssue[];
  warnings: PartifulSyncIssue[];
};

export type PartifulSnapshotFetchTarget = {
  partifulId?: string;
  eventUrl?: string;
  payload?: unknown;
  [key: string]: unknown;
};

export type PartifulSnapshotFetcher = (
  target: PartifulSnapshotFetchTarget,
) => Promise<unknown>;

export type PartifulSnapshotExtractionResult = {
  snapshots: unknown[];
  warnings: PartifulSyncIssue[];
};

const REGISTERED_STATUS_KEYS = new Set([
  "APPROVED",
  "ACCEPTED",
  "ATTENDING",
  "CONFIRMED",
  "GOING",
  "ON_LIST",
  "ON_THE_LIST",
  "REGISTERED",
  "RSVPED",
  "RSVP_YES",
  "YOU_RE_IN",
  "YOURE_IN",
]);

const APPLIED_STATUS_KEYS = new Set([
  "APPLIED",
  "PENDING",
  "PENDING_APPROVAL",
  "REQUESTED",
  "REQUESTED_APPROVAL",
  "SUBMITTED",
]);

const WAITLIST_STATUS_KEYS = new Set([
  "WAITLIST",
  "WAITLISTED",
  "WAITLISTED_FOR_APPROVAL",
  "WAITLISTED_FOR_REVIEW",
]);

const REJECTED_STATUS_KEYS = new Set([
  "CANCELED",
  "CANCELLED",
  "DECLINED",
  "DENIED",
  "REJECTED",
  "REMOVED",
  "WITHDRAWN",
]);

const SKIPPED_STATUS_KEYS = new Set([
  "BLOCKED",
  "BLOCKER",
  "CAPTCHA",
  "CAPTCHA_REQUIRED",
  "INVITE_ONLY",
  "PAYMENT_REQUIRED",
  "PRIVATE",
  "SKIP",
  "SKIPPED",
  "SOLD_OUT",
  "UNAVAILABLE",
]);

export function normalizePartifulStatus(value: unknown): PartifulSyncStatus {
  const key = statusKey(value);
  if (!key) return "unknown";
  if (REGISTERED_STATUS_KEYS.has(key)) return "registered";
  if (APPLIED_STATUS_KEYS.has(key)) return "applied";
  if (WAITLIST_STATUS_KEYS.has(key)) return "waitlisted";
  if (REJECTED_STATUS_KEYS.has(key)) return "rejected";
  if (SKIPPED_STATUS_KEYS.has(key)) return "skipped";

  if (key.includes("WAITLIST")) return "waitlisted";
  if (key.includes("PENDING") || key.includes("APPLIED") || key.includes("SUBMITTED")) {
    return "applied";
  }
  if (
    key.includes("REJECT") || key.includes("DECLIN") || key.includes("DENIED") ||
    key.includes("WITHDRAW")
  ) {
    return "rejected";
  }
  if (
    key.includes("SKIP") || key.includes("BLOCK") || key.includes("CAPTCHA") ||
    key.includes("SOLD_OUT") || key.includes("PAYMENT")
  ) {
    return "skipped";
  }
  if (
    key.includes("APPROV") || key.includes("ACCEPT") || key.includes("GOING") ||
    key.includes("REGISTER") || key.includes("CONFIRM") || key.includes("YOU_RE_IN")
  ) {
    return "registered";
  }
  return "unknown";
}

export function extractPartifulId(value: unknown): string {
  const record = asRecord(value);
  if (record) {
    const directId = firstString(
      record.partifulId,
      record.partiful_id,
      record.partifulEventId,
      record.partiful_event_id,
      getPath(record, ["ref", "id"]),
    );
    if (looksLikePartifulId(directId)) return directId;

    const directUrl = firstString(
      record.partifulEventUrl,
      record.partifulUrl,
      record.partiful_url,
      record.eventUrl,
      record.event_url,
      record.url,
      record.publicUrl,
      record.publicShortUrl,
      record.canonicalUrl,
    );
    const fromUrl = extractPartifulId(directUrl);
    if (fromUrl) return fromUrl;

    const id = firstString(record.id, record.eventId, record.event_id);
    if (looksLikePartifulId(id)) return id;
    return "";
  }

  const text = stringValue(value);
  if (!text) return "";
  const direct = text.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (looksLikePartifulId(direct)) return direct;

  try {
    const url = new URL(text);
    const segments = url.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]?.toLowerCase();
      if ((segment === "e" || segment === "events") && looksLikePartifulId(segments[index + 1])) {
        return segments[index + 1] ?? "";
      }
    }
  } catch {
    const match = text.match(/partiful\.com\/(?:e|events)\/([A-Za-z0-9_-]{8,80})/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

export function normalizePartifulEventUrl(value: unknown): string {
  const partifulId = extractPartifulId(value);
  if (partifulId) return `https://partiful.com/e/${partifulId}`;

  const text = firstString(
    asRecord(value)?.partifulEventUrl,
    asRecord(value)?.partifulUrl,
    asRecord(value)?.partiful_url,
    asRecord(value)?.eventUrl,
    asRecord(value)?.event_url,
    asRecord(value)?.url,
    value,
  );
  if (!text) return "";
  return normalizeUrlForMatch(text);
}

export function partifulMatchKeys(value: unknown): string[] {
  const keys = new Set<string>();
  const partifulId = extractPartifulId(value);
  if (partifulId) keys.add(`partiful:${partifulId}`);

  const eventUrl = normalizePartifulEventUrl(value);
  if (eventUrl) keys.add(`url:${eventUrl}`);

  const record = asRecord(value);
  if (record) {
    for (
      const candidate of [
        record.partifulEventUrl,
        record.partifulUrl,
        record.partiful_url,
        record.eventUrl,
        record.event_url,
        record.url,
        record.publicShortUrl,
      ]
    ) {
      const normalized = normalizeUrlForMatch(stringValue(candidate));
      if (normalized) keys.add(`url:${normalized}`);
    }
  }

  return [...keys];
}

export function buildPartifulEventIndex<T extends PartifulEventLike>(
  events: readonly T[],
): PartifulEventIndex<T> {
  const byKey = new Map<string, PartifulEventIndexEntry<T>>();
  const duplicates: PartifulSyncIssue[] = [];

  events.forEach((event, index) => {
    const keys = partifulMatchKeys(event);
    for (const key of keys) {
      const previous = byKey.get(key);
      if (previous) {
        duplicates.push({
          code: "duplicate_current_event_key",
          message: `Multiple current events share Partiful match key ${key}.`,
          partifulId: extractPartifulId(event) || extractPartifulId(previous.event),
          eventUrl: normalizePartifulEventUrl(event) || normalizePartifulEventUrl(previous.event),
          title: eventTitle(event) || eventTitle(previous.event),
          detail: { key, previousIndex: previous.index, index },
        });
        continue;
      }
      byKey.set(key, { event, index, keys });
    }
  });

  return { byKey, duplicates };
}

export function findPartifulEvent<T extends PartifulEventLike>(
  index: PartifulEventIndex<T>,
  value: unknown,
): { entry: PartifulEventIndexEntry<T> | null; matchedBy: PartifulMatchKind } {
  for (const key of partifulMatchKeys(value)) {
    const entry = index.byKey.get(key);
    if (entry) {
      return {
        entry,
        matchedBy: key.startsWith("partiful:") ? "partiful_id" : "event_url",
      };
    }
  }
  return { entry: null, matchedBy: "none" };
}

export function normalizePartifulSnapshot(
  payload: unknown,
  options: SyncPartifulOptions = {},
): NormalizedPartifulSnapshotResult {
  const warnings: PartifulSyncIssue[] = [];
  const errors: PartifulSyncIssue[] = [];
  const unwrapped = unwrapPartifulPayload(payload);
  const root = unwrapped.root;
  const eventRecord = unwrapped.event ?? root;
  const rsvpRecord = unwrapped.rsvp;
  const guestRecord = unwrapped.guest;
  const source = options.source ?? unwrapped.source;

  if (!eventRecord && !root) {
    return {
      event: null,
      errors: [{
        code: "invalid_snapshot",
        message: "Partiful snapshot must be an object-like payload.",
      }],
      warnings,
    };
  }

  const partifulId = extractPartifulId(eventRecord) || extractPartifulId(root);
  const eventUrl = normalizePartifulEventUrl(eventRecord) || normalizePartifulEventUrl(root);
  const title = firstString(
    getPath(eventRecord, ["title"]),
    getPath(eventRecord, ["name"]),
    getPath(root, ["eventName"]),
    getPath(root, ["event_name"]),
    getPath(root, ["title"]),
    getPath(root, ["name"]),
  );

  const rawStatus = firstString(
    getPath(rsvpRecord, ["status"]),
    getPath(rsvpRecord, ["state"]),
    getPath(rsvpRecord, ["approvalStatus"]),
    getPath(rsvpRecord, ["rsvpStatus"]),
    getPath(guestRecord, ["rsvpStatus"]),
    getPath(guestRecord, ["status"]),
    getPath(guestRecord, ["state"]),
    getPath(guestRecord, ["guestStatus"]),
    getPath(guestRecord, ["approvalStatus"]),
    getPath(guestRecord, ["attendanceStatus"]),
    getPath(guestRecord, ["rsvp", "status"]),
    getPath(guestRecord, ["rsvp", "state"]),
    getPath(guestRecord, ["rsvp", "approvalStatus"]),
    getPath(root, ["guestStatus"]),
    getPath(root, ["viewerStatus"]),
    getPath(root, ["viewerRsvpStatus"]),
    getPath(root, ["viewerRSVPStatus"]),
    getPath(root, ["attendeeStatus"]),
    getPath(root, ["attendanceStatus"]),
    getPath(root, ["approvalStatus"]),
    getPath(root, ["rsvpStatus"]),
    getPath(root, ["rsvp_status"]),
    getPath(root, ["partifulRawStatus"]),
    getPath(root, ["partifulStatus"]),
    statusValueFromRoot(root),
  );
  const status = normalizePartifulStatus(rawStatus);
  const rawEventStatus = firstString(
    getPath(eventRecord, ["status"]),
    getPath(root, ["eventStatus"]),
    getPath(root, ["event_status"]),
  );

  if (!partifulId && !eventUrl) {
    errors.push({
      code: "missing_partiful_identity",
      message: "Partiful snapshot is missing both a Partiful event ID and event URL.",
      title,
    });
  }
  if (!rawStatus) {
    warnings.push({
      code: "missing_rsvp_status",
      message:
        "Partiful snapshot has no viewer/RSVP status; event publication status is not enough.",
      partifulId,
      eventUrl,
      title,
    });
  } else if (status === "unknown") {
    warnings.push({
      code: "unknown_rsvp_status",
      message: `Unrecognized Partiful RSVP status: ${rawStatus}.`,
      partifulId,
      eventUrl,
      title,
    });
  }

  if (errors.length > 0) return { event: null, errors, warnings };

  const rsvpCount = firstNumber(
    getPath(rsvpRecord, ["count"]),
    getPath(guestRecord, ["rsvp", "count"]),
    getPath(root, ["count"]),
    getPath(root, ["rsvpCount"]),
    getPath(root, ["rsvp_count"]),
  );

  const normalized: NormalizedPartifulEvent = {
    partifulId,
    eventUrl: eventUrl || (partifulId ? `https://partiful.com/e/${partifulId}` : ""),
    title,
    status,
    rawStatus,
    rawEventStatus,
    description: firstString(
      getPath(eventRecord, ["description"]),
      getPath(eventRecord, ["subtitle"]),
      getPath(root, ["description"]),
      getPath(root, ["eventDescription"]),
    ),
    startAt: firstString(
      getPath(eventRecord, ["startDate"]),
      getPath(eventRecord, ["startAt"]),
      getPath(root, ["start"]),
      getPath(root, ["startAt"]),
    ),
    endAt: firstString(
      getPath(eventRecord, ["endDate"]),
      getPath(eventRecord, ["endAt"]),
      getPath(root, ["end"]),
      getPath(root, ["endAt"]),
    ),
    updatedAt: firstString(
      getPath(eventRecord, ["updatedAt"]),
      getPath(root, ["updatedAt"]),
      getPath(root, ["updated_at"]),
    ),
    approvedAt: firstString(
      getPath(rsvpRecord, ["approvedAt"]),
      getPath(guestRecord, ["approvedAt"]),
      getPath(root, ["approvedAt"]),
      getPath(root, ["approved_at"]),
    ),
    rsvpCount,
    guestCount: firstNumber(
      getPath(eventRecord, ["guestCount"]),
      getPath(eventRecord, ["goingGuestCount"]),
      getPath(eventRecord, ["respondedGuestCount"]),
      getPath(root, ["guestCount"]),
      getPath(root, ["guest_count"]),
    ),
    plusOne: normalizePlusOneState(root, guestRecord, rsvpRecord, rsvpCount),
    venue: normalizeVenue(root, eventRecord),
    source,
    ...(options.includeRawPayload ? { rawPayload: payload } : {}),
  };

  return { event: normalized, errors, warnings };
}

export function normalizePartifulSnapshots(
  payloads: readonly unknown[],
  options: SyncPartifulOptions = {},
): {
  events: NormalizedPartifulEvent[];
  errors: PartifulSyncIssue[];
  warnings: PartifulSyncIssue[];
} {
  const events: NormalizedPartifulEvent[] = [];
  const errors: PartifulSyncIssue[] = [];
  const warnings: PartifulSyncIssue[] = [];

  for (const payload of payloads) {
    const result = normalizePartifulSnapshot(payload, options);
    if (result.event) events.push(result.event);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { events, errors, warnings };
}

export function extractPartifulSnapshotPayloads(input: unknown): PartifulSnapshotExtractionResult {
  const snapshots: unknown[] = [];
  const warnings: PartifulSyncIssue[] = [];
  const parsedInput = parseJsonLike(input);
  const root = asRecord(parsedInput);

  if (Array.isArray(parsedInput)) {
    for (const item of parsedInput) {
      snapshots.push(...partifulSnapshotPayloadsFromCandidate(item));
    }
    return { snapshots, warnings };
  }

  if (!root) {
    return {
      snapshots,
      warnings: [{
        code: "invalid_snapshot_container",
        message: "Partiful snapshot input must be a JSON object or array.",
      }],
    };
  }

  let foundExplicitSnapshotField = false;
  for (const field of PARTIFUL_SNAPSHOT_ARRAY_FIELDS) {
    const value = root[field];
    if (value === undefined) continue;
    foundExplicitSnapshotField = true;
    if (!Array.isArray(value)) {
      warnings.push({
        code: "invalid_snapshot_array",
        message: `Partiful snapshot field "${field}" must be an array when provided.`,
        detail: { field },
      });
      continue;
    }
    for (const item of value) {
      snapshots.push(...partifulSnapshotPayloadsFromCandidate(item, root));
    }
  }

  if (!foundExplicitSnapshotField && looksLikeSnapshotContainer(root)) {
    snapshots.push(...partifulSnapshotPayloadsFromCandidate(root));
    return { snapshots, warnings };
  }

  for (const field of PARTIFUL_SNAPSHOT_SINGLE_FIELDS) {
    const value = root[field];
    if (value === undefined) continue;
    foundExplicitSnapshotField = true;
    snapshots.push(...partifulSnapshotPayloadsFromCandidate(value, root));
  }

  return { snapshots, warnings };
}

export async function fetchPartifulSnapshots(
  targets: readonly PartifulSnapshotFetchTarget[],
  fetcher: PartifulSnapshotFetcher,
  options: SyncPartifulOptions = {},
): Promise<{
  events: NormalizedPartifulEvent[];
  errors: PartifulSyncIssue[];
  warnings: PartifulSyncIssue[];
}> {
  const payloads: unknown[] = [];
  const errors: PartifulSyncIssue[] = [];

  for (const target of targets) {
    if (target.payload !== undefined) {
      payloads.push(target.payload);
      continue;
    }
    try {
      payloads.push(await fetcher(target));
    } catch (error) {
      errors.push({
        code: "fetch_snapshot_failed",
        message: error instanceof Error ? error.message : String(error),
        partifulId: target.partifulId,
        eventUrl: target.eventUrl,
      });
    }
  }

  const normalized = normalizePartifulSnapshots(payloads, options);
  return {
    events: normalized.events,
    errors: [...errors, ...normalized.errors],
    warnings: normalized.warnings,
  };
}

export function computePartifulSync<T extends PartifulEventLike>(
  currentEvents: readonly T[],
  snapshots: readonly unknown[],
  options: SyncPartifulOptions = {},
): PartifulSyncResult<T> {
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const eventIndex = buildPartifulEventIndex(currentEvents);
  const normalized = normalizePartifulSnapshots(snapshots, options);
  const updatedEvents: PartifulEventUpdate<T>[] = [];
  const unchangedEvents: PartifulEventUpdate<T>[] = [];
  const statusChanges: PartifulStatusChange[] = [];
  const unmatchedSnapshots: NormalizedPartifulEvent[] = [];
  const warnings = [...eventIndex.duplicates, ...normalized.warnings];

  for (const normalizedEvent of normalized.events) {
    const match = findPartifulEvent(eventIndex, normalizedEvent);
    const currentEvent = match.entry?.event ?? null;
    const currentIndex = match.entry?.index ?? null;
    const previousStatus = currentEvent ? currentEventStatus(currentEvent) : "unknown";
    const effectiveStatus = normalizedEvent.status === "unknown" && previousStatus !== "unknown"
      ? previousStatus
      : normalizedEvent.status;
    const statusChanged = effectiveStatus !== "unknown" && effectiveStatus !== previousStatus;
    const mergedEvent = mergePartifulEvent(
      currentEvent,
      normalizedEvent,
      effectiveStatus,
      syncedAt,
    );
    const update: PartifulEventUpdate<T> = {
      currentEvent,
      currentIndex,
      mergedEvent,
      normalizedEvent,
      previousStatus,
      statusChanged,
      matchedBy: match.matchedBy,
    };

    if (!currentEvent) {
      unmatchedSnapshots.push(normalizedEvent);
      warnings.push({
        code: "unmatched_snapshot",
        message: "Partiful snapshot did not match a current event by Partiful ID or event URL.",
        partifulId: normalizedEvent.partifulId,
        eventUrl: normalizedEvent.eventUrl,
        title: normalizedEvent.title,
      });
    }

    if (statusChanged) {
      statusChanges.push({
        partifulId: normalizedEvent.partifulId,
        eventUrl: normalizedEvent.eventUrl,
        title: normalizedEvent.title,
        previousStatus,
        nextStatus: effectiveStatus,
        previousRawStatus: currentEventRawStatus(currentEvent),
        nextRawStatus: normalizedEvent.rawStatus,
        changedAt: syncedAt,
        matchedBy: match.matchedBy,
        currentIndex,
      });
    }

    if (!currentEvent || statusChanged || hasMeaningfulUpdate(currentEvent, normalizedEvent)) {
      updatedEvents.push(update);
    } else {
      unchangedEvents.push(update);
    }
  }

  return {
    syncedAt,
    currentCount: currentEvents.length,
    snapshotCount: snapshots.length,
    updatedEvents,
    unchangedEvents,
    statusChanges,
    unmatchedSnapshots,
    errors: normalized.errors,
    warnings,
  };
}

function unwrapPartifulPayload(payload: unknown): {
  root: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
  guest: Record<string, unknown> | null;
  rsvp: Record<string, unknown> | null;
  source: string;
} {
  const root = asRecord(payload);
  if (!root) return { root: null, event: null, guest: null, rsvp: null, source: "unknown" };

  const event = firstRecord(
    getPath(root, ["props", "pageProps", "event"]),
    getPath(root, ["pageProps", "event"]),
    getPath(root, ["__NEXT_DATA__", "props", "pageProps", "event"]),
    getPath(root, ["data", "event"]),
    getPath(root, ["result", "event"]),
    getPath(root, ["result", "eventInfo", "event"]),
    getPath(root, ["result", "data", "event"]),
    getPath(root, ["result", "data", "json", "event"]),
    getPath(root, ["event"]),
    looksLikePartifulEvent(root) ? root : null,
  );
  const guest = firstRecord(
    getPath(root, ["props", "pageProps", "guest"]),
    getPath(root, ["pageProps", "guest"]),
    getPath(root, ["__NEXT_DATA__", "props", "pageProps", "guest"]),
    getPath(root, ["data", "guest"]),
    getPath(root, ["data", "viewerGuest"]),
    getPath(root, ["data", "myGuest"]),
    getPath(root, ["result", "guest"]),
    getPath(root, ["result", "viewerGuest"]),
    getPath(root, ["result", "myGuest"]),
    getPath(root, ["result", "currentGuest"]),
    getPath(root, ["result", "data", "guest"]),
    getPath(root, ["result", "data", "viewerGuest"]),
    getPath(root, ["result", "data", "myGuest"]),
    getPath(root, ["result", "data", "currentGuest"]),
    getPath(root, ["result", "data", "json", "guest"]),
    getPath(root, ["result", "data", "json", "viewerGuest"]),
    getPath(root, ["result", "data", "json", "myGuest"]),
    getPath(root, ["guest"]),
    getPath(root, ["viewerGuest"]),
    getPath(root, ["viewer", "guest"]),
    getPath(root, ["myGuest"]),
    getPath(root, ["currentGuest"]),
    getPath(root, ["attendee"]),
    getPath(root, ["attendance"]),
  );
  const rsvp = firstRecord(
    getPath(root, ["rsvp"]),
    getPath(root, ["data", "rsvp"]),
    getPath(root, ["data", "viewerRsvp"]),
    getPath(root, ["data", "viewerRSVP"]),
    getPath(root, ["data", "myRsvp"]),
    getPath(root, ["result", "rsvp"]),
    getPath(root, ["result", "viewerRsvp"]),
    getPath(root, ["result", "viewerRSVP"]),
    getPath(root, ["result", "myRsvp"]),
    getPath(root, ["result", "data", "rsvp"]),
    getPath(root, ["result", "data", "viewerRsvp"]),
    getPath(root, ["result", "data", "viewerRSVP"]),
    getPath(root, ["result", "data", "myRsvp"]),
    getPath(root, ["result", "data", "json", "rsvp"]),
    getPath(root, ["result", "data", "json", "viewerRsvp"]),
    getPath(root, ["result", "data", "json", "viewerRSVP"]),
    getPath(root, ["result", "data", "json", "myRsvp"]),
    getPath(root, ["viewerRsvp"]),
    getPath(root, ["viewerRSVP"]),
    getPath(root, ["viewer", "rsvp"]),
    getPath(root, ["myRsvp"]),
    getPath(root, ["myRSVP"]),
    getPath(root, ["currentRsvp"]),
    getPath(root, ["attendee", "rsvp"]),
    getPath(root, ["attendance", "rsvp"]),
    getPath(guest, ["rsvp"]),
  );

  if (getPath(root, ["props", "pageProps", "event"])) {
    return { root, event, guest, rsvp, source: "partiful_next_page_props" };
  }
  if (getPath(root, ["__NEXT_DATA__", "props", "pageProps", "event"])) {
    return { root, event, guest, rsvp, source: "partiful_next_data" };
  }
  if (getPath(root, ["result", "data", "json"])) {
    return { root, event, guest, rsvp, source: "partiful_trpc_payload" };
  }
  if (getPath(root, ["result"])) {
    return { root, event, guest, rsvp, source: "partiful_callable_payload" };
  }
  if (event && event !== root) return { root, event, guest, rsvp, source: "partiful_api_payload" };
  return { root, event, guest, rsvp, source: "partiful_status_payload" };
}

function mergePartifulEvent<T extends PartifulEventLike>(
  currentEvent: T | null,
  normalizedEvent: NormalizedPartifulEvent,
  status: PartifulSyncStatus,
  syncedAt: string,
): PartifulMergedEvent<T> {
  const currentTitle = currentEvent ? eventTitle(currentEvent) : "";
  const currentUrl = currentEvent
    ? firstString(currentEvent.eventUrl, currentEvent.event_url, currentEvent.partifulEventUrl)
    : "";

  return {
    ...(currentEvent ?? {}),
    eventUrl: currentUrl || normalizedEvent.eventUrl,
    partifulEventUrl: normalizedEvent.eventUrl,
    partifulId: normalizedEvent.partifulId,
    partifulRawStatus: normalizedEvent.rawStatus,
    partifulStatus: normalizedEvent.rawStatus,
    partifulSyncedAt: syncedAt,
    status,
    title: currentTitle || normalizedEvent.title,
  } as PartifulMergedEvent<T>;
}

function hasMeaningfulUpdate(
  currentEvent: PartifulEventLike | null,
  normalizedEvent: NormalizedPartifulEvent,
): boolean {
  if (!currentEvent) return true;
  const currentRaw = currentEventRawStatus(currentEvent);
  if (normalizedEvent.rawStatus && normalizedEvent.rawStatus !== currentRaw) return true;

  const currentId = extractPartifulId(currentEvent);
  if (normalizedEvent.partifulId && currentId !== normalizedEvent.partifulId) return true;

  const currentUrl = normalizePartifulEventUrl(currentEvent);
  if (normalizedEvent.eventUrl && currentUrl && normalizedEvent.eventUrl !== currentUrl) {
    return true;
  }

  const currentTitle = eventTitle(currentEvent);
  if (normalizedEvent.title && currentTitle && normalizedEvent.title !== currentTitle) return true;

  const currentVenue = firstString(
    currentEvent.venue,
    currentEvent.location,
  );
  if (
    normalizedEvent.venue?.label && currentVenue && normalizedEvent.venue.label !== currentVenue
  ) {
    return true;
  }

  return false;
}

function normalizeVenue(
  root: Record<string, unknown> | null,
  eventRecord: Record<string, unknown> | null,
): NormalizedPartifulVenue | null {
  const locationInfo = firstRecord(
    getPath(eventRecord, ["locationInfo"]),
    getPath(root, ["locationInfo"]),
  );
  const mapsInfo = firstRecord(getPath(locationInfo, ["mapsInfo"]));
  const displayAddress = stringArray(getPath(locationInfo, ["displayAddressLines"])).join(", ");
  const mapsAddress = stringArray(getPath(mapsInfo, ["addressLines"])).join(", ");
  const approximateLocation = firstString(
    getPath(locationInfo, ["approximateLocation"]),
    getPath(mapsInfo, ["approximateLocation"]),
  );
  const venueText = firstString(
    getPath(root, ["venue"]),
    getPath(root, ["location"]),
    getPath(eventRecord, ["location"]),
    displayAddress,
    mapsAddress,
    approximateLocation,
  );
  if (!venueText) return null;

  const googleMapsUrl = firstString(
    getPath(locationInfo, ["googleMapsUrl"]),
    getPath(mapsInfo, ["googleMapsUrl"]),
    getPath(root, ["googleMapsUrl"]),
    getPath(root, ["google_maps_url"]),
  );
  const appleMapsUrl = firstString(
    getPath(locationInfo, ["appleMapsUrl"]),
    getPath(mapsInfo, ["appleMapsUrl"]),
    getPath(root, ["appleMapsUrl"]),
    getPath(root, ["apple_maps_url"]),
  );
  const precision = venuePrecision(root, locationInfo, mapsAddress, approximateLocation);

  return {
    label: venueText,
    address: mapsAddress || displayAddress || venueText,
    googleMapsUrl,
    appleMapsUrl,
    precision,
  };
}

function venuePrecision(
  root: Record<string, unknown> | null,
  locationInfo: Record<string, unknown> | null,
  mapsAddress: string,
  approximateLocation: string,
): PartifulVenuePrecision {
  const rawPrecision = statusKey(firstString(
    getPath(root, ["venuePrecision"]),
    getPath(root, ["venue_precision"]),
    getPath(locationInfo, ["type"]),
  ));
  if (rawPrecision.includes("EXACT") || rawPrecision === "STRUCTURED") return "exact";
  if (rawPrecision.includes("APPROX")) return "approximate";
  if (rawPrecision.includes("HIDDEN") || rawPrecision.includes("PRIVATE")) return "hidden";
  if (getPath(root, ["venue_revealed"]) === false || getPath(root, ["venueRevealed"]) === false) {
    return "hidden";
  }
  if (mapsAddress) return "exact";
  if (approximateLocation) return "approximate";
  return "unknown";
}

function normalizePlusOneState(
  root: Record<string, unknown> | null,
  guest: Record<string, unknown> | null,
  rsvp: Record<string, unknown> | null,
  rsvpCount: number | null,
): PartifulPlusOneState {
  const plusOneText = firstString(
    getPath(root, ["plusOne"]),
    getPath(root, ["plus_one"]),
    getPath(root, ["plusOneName"]),
    getPath(root, ["plus_one_name"]),
    getPath(guest, ["plusOne"]),
    getPath(guest, ["plusOneName"]),
    getPath(rsvp, ["plusOne"]),
    getPath(rsvp, ["plusOneName"]),
  );
  const plusOneKey = statusKey(plusOneText);
  if (plusOneKey.includes("NONE") || plusOneKey.includes("NO_PLUS")) return "none";
  if (plusOneKey.includes("TBD") || plusOneKey.includes("TO_BE_DETERMINED")) return "tbd";
  if (
    plusOneText && plusOneKey !== "FALSE" && plusOneKey !== "NO" && plusOneKey !== "0"
  ) {
    return "named";
  }

  const noteKey = statusKey(firstString(getPath(root, ["notes"]), getPath(root, ["note"])));
  if (
    noteKey.includes("PLUSONE_TBD") || noteKey.includes("PLUS_ONE_TBD") ||
    noteKey.includes("PLUSONE_TO_BE_DETERMINED") ||
    noteKey.includes("PLUS_ONE_TO_BE_DETERMINED")
  ) {
    return "tbd";
  }
  if (
    noteKey.includes("PLUSONE_NONE") || noteKey.includes("PLUS_ONE_NONE") ||
    noteKey.includes("PLUSONE_NO") || noteKey.includes("PLUS_ONE_NO")
  ) {
    return "none";
  }

  const guestNames = stringArray(
    getPath(rsvp, ["guestNames"]) ?? getPath(guest, ["guestNames"]) ??
      getPath(root, ["guestNames"]),
  );
  if (guestNames.length > 1) return "named";
  if (rsvpCount === 1) return "none";
  if (rsvpCount !== null && rsvpCount > 1) return "unknown";
  return "unknown";
}

function currentEventStatus(event: PartifulEventLike): PartifulSyncStatus {
  const status = firstString(
    event.status,
    event.rsvpStatus,
    event.partifulRawStatus,
    event.partifulStatus,
  );
  return normalizePartifulStatus(status);
}

function currentEventRawStatus(event: PartifulEventLike | null): string {
  if (!event) return "";
  return firstString(event.partifulRawStatus, event.partifulStatus, event.rsvpStatus, event.status);
}

function eventTitle(event: PartifulEventLike): string {
  return firstString(event.title, event.eventName, event.event_name, event.name);
}

function statusValueFromRoot(root: Record<string, unknown> | null): string {
  const raw = firstString(getPath(root, ["status"]));
  return normalizePartifulStatus(raw) === "unknown" ? "" : raw;
}

function looksLikePartifulEvent(record: Record<string, unknown>): boolean {
  return Boolean(
    record.ref || record.publicShortUrl || record.locationInfo || record.guestStatusCounts ||
      record.questionnaireVersions || extractPartifulId(record),
  );
}

const PARTIFUL_SNAPSHOT_ARRAY_FIELDS = [
  "snapshots",
  "payloads",
  "events",
  "partifulEvents",
  "targets",
  "items",
  "responses",
  "networkResponses",
  "pages",
] as const;

const PARTIFUL_SNAPSHOT_SINGLE_FIELDS = [
  "snapshot",
  "payload",
  "event",
  "partifulEvent",
  "nextData",
  "__NEXT_DATA__",
  "pageProps",
  "response",
] as const;

function partifulSnapshotPayloadsFromCandidate(
  candidate: unknown,
  inheritedMetadata: Record<string, unknown> | null = null,
): unknown[] {
  const parsed = parseJsonLike(candidate);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => partifulSnapshotPayloadsFromCandidate(item, inheritedMetadata));
  }

  const record = asRecord(parsed);
  if (!record) return [];
  const metadata = partifulSnapshotMetadata(record, inheritedMetadata);

  for (const field of ["snapshot", "payload", "body", "json", "nextData", "__NEXT_DATA__"]) {
    if (record[field] === undefined) continue;
    const payload = parseJsonLike(record[field]);
    if (Array.isArray(payload)) {
      return payload.flatMap((item) => partifulSnapshotPayloadsFromCandidate(item, metadata));
    }
    return [attachPartifulSnapshotMetadata(payload, metadata)];
  }

  const response = asRecord(record.response);
  if (response) {
    for (const field of ["body", "json", "payload"]) {
      if (response[field] === undefined) continue;
      return partifulSnapshotPayloadsFromCandidate(
        response[field],
        partifulSnapshotMetadata(response, metadata),
      );
    }
  }

  if (looksLikeSnapshotContainer(record)) {
    return [attachPartifulSnapshotMetadata(record, metadata)];
  }
  return [];
}

function looksLikeSnapshotContainer(record: Record<string, unknown>): boolean {
  return Boolean(
    getPath(record, ["props", "pageProps"]) ||
      getPath(record, ["__NEXT_DATA__", "props", "pageProps"]) ||
      getPath(record, ["result", "data", "json"]) ||
      record.pageProps ||
      record.event ||
      record.guest ||
      record.rsvp ||
      record.viewerGuest ||
      record.viewerRsvp ||
      record.myGuest ||
      record.myRsvp ||
      record.attendee ||
      record.attendance ||
      extractPartifulId(record),
  );
}

function partifulSnapshotMetadata(
  record: Record<string, unknown>,
  inheritedMetadata: Record<string, unknown> | null,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...(inheritedMetadata ?? {}) };
  for (
    const field of [
      "partifulId",
      "partiful_id",
      "partifulEventUrl",
      "partifulUrl",
      "partiful_url",
      "eventUrl",
      "event_url",
      "publicUrl",
      "publicShortUrl",
      "title",
      "eventName",
      "event_name",
      "rsvpStatus",
      "rsvp_status",
      "guestStatus",
      "viewerStatus",
      "viewerRsvpStatus",
      "viewerRSVPStatus",
      "attendeeStatus",
      "attendanceStatus",
      "approvalStatus",
      "partifulRawStatus",
      "partifulStatus",
      "source",
    ]
  ) {
    const value = record[field];
    if (value !== undefined && metadata[field] === undefined) metadata[field] = value;
  }

  const url = firstString(record.eventUrl, record.event_url, record.partifulUrl, record.url);
  if (url && extractPartifulId(url) && metadata.eventUrl === undefined) {
    metadata.eventUrl = normalizePartifulEventUrl(url);
  }
  return metadata;
}

function attachPartifulSnapshotMetadata(
  payload: unknown,
  metadata: Record<string, unknown>,
): unknown {
  const parsed = parseJsonLike(payload);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => attachPartifulSnapshotMetadata(item, metadata));
  }
  const record = asRecord(parsed);
  if (!record) {
    return Object.keys(metadata).length ? { ...metadata, payload: parsed } : parsed;
  }

  const output: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && output[key] === undefined) output[key] = value;
  }
  return output;
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function looksLikePartifulId(value: unknown): value is string {
  const text = stringValue(value);
  return /^[A-Za-z0-9_-]{8,80}$/.test(text);
}

function normalizeUrlForMatch(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  const partifulId = extractPartifulId(text);
  if (partifulId) return `https://partiful.com/e/${partifulId}`;

  try {
    const url = new URL(text);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    const trimmedPath = url.pathname.replace(/\/+$/, "");
    url.pathname = trimmedPath || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function statusKey(value: unknown): string {
  return stringValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = stringValue(value);
    if (!text) continue;
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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
  let current: unknown = value;
  for (const part of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}
