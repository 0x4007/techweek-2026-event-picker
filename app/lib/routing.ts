export type CacheKeyPart = string | number | boolean;
export type CacheKey = readonly [string, ...CacheKeyPart[]];

export interface RoutingCacheSetOptions {
  expireIn?: number;
  tags?: readonly string[];
}

export interface RoutingCacheAdapter {
  get<T>(key: CacheKey): Promise<T | null | undefined>;
  set<T>(key: CacheKey, value: T, options?: RoutingCacheSetOptions): Promise<void>;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RoutePoint {
  id?: string;
  name: string;
  query?: string;
  venueQuery?: string;
  venue_query?: string;
  precision?: string;
  addressPrecision?: string;
  address_precision?: string;
  location?: string;
  lat: number;
  lon: number;
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  usedQuery: string;
  raw?: unknown;
}

export interface SubwayStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
  raw?: unknown;
}

export interface WalkingEstimate {
  minutes: number;
  meters: number;
}

export interface SubwayTripEstimate {
  estimatedMinutes: number;
  numTransfers: number | null;
  totalStops: number | null;
  riskLabel: string;
  segments: string[];
  raw?: unknown;
}

export type RouteMode = "walk" | "subway+walk";

export interface RouteEstimate {
  mode: RouteMode;
  minutes: number;
  details: string;
  fromStation: string;
  toStation: string;
  subwaySegments: string;
  risk: string;
  directWalk: WalkingEstimate;
  originStation?: SubwayStation;
  destinationStation?: SubwayStation;
  walkToStation?: WalkingEstimate;
  walkFromStation?: WalkingEstimate;
  subwayTrip?: SubwayTripEstimate;
}

export interface RoutingRequestOptions {
  cache?: RoutingCacheAdapter;
  fetcher?: FetchLike;
  userAgent?: string;
  routingVersion?: string;
}

export interface GeocodeOptions extends RoutingRequestOptions {
  endpoint?: string;
}

export interface LoadStationsOptions extends RoutingRequestOptions {
  endpoint?: string;
  limit?: number;
}

export interface WalkingEstimateOptions extends RoutingRequestOptions {
  stretchFactor?: number;
  metersPerMinute?: number;
}

export interface SubwayTripOptions extends RoutingRequestOptions {
  endpoint?: string;
}

export interface RouteBetweenOptions extends RoutingRequestOptions {
  stations?: readonly SubwayStation[];
  stationEndpoint?: string;
  stationLimit?: number;
  subwayTripEndpoint?: string;
  walkingStretchFactor?: number;
  walkingMetersPerMinute?: number;
  subwayBufferMinutes?: number;
}

export type DateLike = Date | string;

export interface OperationalRouteEvent {
  [key: string]: unknown;
  id: string;
  name: string;
  point: RoutePoint;
  start?: DateLike;
  startDt?: DateLike;
  start_dt?: DateLike;
  end?: DateLike;
  endDt?: DateLike;
  end_dt?: DateLike;
  actualStart?: DateLike;
  actualStartDt?: DateLike;
  actual_start_dt?: DateLike;
  actualEnd?: DateLike;
  actualEndDt?: DateLike;
  actual_end_dt?: DateLike;
  date?: string;
  location?: string;
  techweekId?: string;
  techweek_id?: string;
  partifulId?: string;
  partiful_id?: string;
  eventUrl?: string;
  event_url?: string;
  googleMapsUrl?: string;
  google_maps_url?: string;
}

export interface BufferBlockInput {
  date: string;
  start: string;
  end: string;
  title: string;
  location: string;
  note?: string;
}

export interface OperationalScheduleBlock {
  entryType: "event" | "travel" | "meal" | "sleep";
  calendar: "schedule";
  start: Date;
  end: Date;
  actualStart: Date;
  actualEnd: Date;
  title: string;
  location: string;
  techweekId: string;
  calendarBlockId: string;
  partifulId: string;
  status: string;
  statusLabel: string;
  category: string;
  categoryLabel: string;
  routeMode: RouteMode | "";
  travelMinutes: number | "";
  routeDetails: string;
  subwaySegments: string;
  transitRisk: string;
  note: string;
  eventUrl: string;
  googleMapsUrl: string;
  rank: string;
  tier: string;
  opportunityScore: string;
  fitSummary: string;
  venueQuery: string;
  venuePrecision: string;
  nextStep: string;
  notes: string;
  salesCoaching: string;
  sourceEventId?: string;
}

export interface BuildOperationalRouteOptions extends RouteBetweenOptions {
  routeIds?: readonly string[];
  homePoint?: RoutePoint;
  includeMeals?: boolean;
  includeSleep?: boolean;
  mealBlocks?: readonly BufferBlockInput[];
  sleepBlocks?: readonly BufferBlockInput[];
}

export const ROUTING_VERSION = "techweek-routing-v1";
export const DEFAULT_USER_AGENT = "techweek-2026-event-picker/1.0";
export const DEFAULT_WALKING_STRETCH_FACTOR = 1.25;
export const DEFAULT_WALKING_METERS_PER_MINUTE = 80;
export const DEFAULT_SUBWAY_BUFFER_MINUTES = 5;
export const HOME_BASE_LOCATION = "15 Cliff Street, New York, NY 10038";

export const HOME_POINT: RoutePoint = {
  id: "home_15_cliff_street",
  name: HOME_BASE_LOCATION,
  location: HOME_BASE_LOCATION,
  venueQuery: HOME_BASE_LOCATION,
  addressPrecision: "exact_home_base",
  lat: 40.7084297,
  lon: -74.0056635,
};

export const DEFAULT_OPERATIONAL_ROUTE_IDS = [
  "6408",
  "44",
  "5978",
  "4551",
  "4341",
  "4161",
  "5889",
  "4444",
  "5529",
  "4664",
  "5372",
  "5114",
  "5722",
] as const;

export const DEFAULT_MEAL_BLOCKS: readonly BufferBlockInput[] = [
  {
    date: "2026-06-01",
    start: "12:15",
    end: "13:15",
    title: "Meal: Lunch / reset",
    location: HOME_BASE_LOCATION,
    note: "One-hour food buffer before leaving for the first event.",
  },
  {
    date: "2026-06-01",
    start: "21:00",
    end: "22:00",
    title: "Meal: Dinner after Open Source Must Win",
    location: "Lower East Side",
    note: "One-hour meal buffer before heading home.",
  },
  {
    date: "2026-06-02",
    start: "13:45",
    end: "14:45",
    title: "Meal: Lunch / reset",
    location: "Midtown",
    note: "One-hour break after the Enterprise SDLC session.",
  },
  {
    date: "2026-06-02",
    start: "21:00",
    end: "22:00",
    title: "Meal: Dinner after Future of DevEx",
    location: "SoHo",
    note: "One-hour meal buffer before heading home.",
  },
  {
    date: "2026-06-03",
    start: "10:45",
    end: "11:15",
    title: "Meal: Quick breakfast / lunch before dense Wednesday",
    location: HOME_BASE_LOCATION,
    note: "Hectic-day 30-minute food buffer before the midday run starts.",
  },
  {
    date: "2026-06-03",
    start: "15:00",
    end: "15:30",
    title: "Meal: Quick food / reset",
    location: "Midtown",
    note: "Hectic-day 30-minute grab-and-go slot before the next walk.",
  },
  {
    date: "2026-06-03",
    start: "20:30",
    end: "21:30",
    title: "Meal: Dinner after MCP in the Wild",
    location: "East Village",
    note: "One-hour meal buffer before heading home.",
  },
  {
    date: "2026-06-04",
    start: "14:30",
    end: "15:30",
    title: "Meal: Late lunch / reset",
    location: HOME_BASE_LOCATION,
    note: "One-hour meal buffer before leaving for the Thursday route.",
  },
  {
    date: "2026-06-04",
    start: "20:45",
    end: "21:45",
    title: "Meal: Dinner after Stop Making AI Guess",
    location: "Union Square",
    note: "One-hour meal buffer before heading home.",
  },
  {
    date: "2026-06-05",
    start: "15:10",
    end: "16:10",
    title: "Meal: Early dinner before Bare Metal",
    location: HOME_BASE_LOCATION,
    note: "One-hour food buffer before the Friday evening event.",
  },
];

export const DEFAULT_SLEEP_BLOCKS: readonly BufferBlockInput[] = [
  {
    date: "2026-06-01",
    start: "03:13",
    end: "11:13",
    title: "Sleep: 8 hours",
    location: HOME_BASE_LOCATION,
    note: "Staggered late sleep block; night-to-night bedtime shift stays within 30 minutes.",
  },
  {
    date: "2026-06-02",
    start: "02:43",
    end: "10:43",
    title: "Sleep: 8 hours",
    location: HOME_BASE_LOCATION,
    note: "Staggered late sleep block; wake leaves 30 minutes before the first travel block.",
  },
  {
    date: "2026-06-03",
    start: "02:45",
    end: "10:45",
    title: "Sleep: 8 hours",
    location: HOME_BASE_LOCATION,
    note: "Staggered late sleep block; wake lands on the quick breakfast/lunch block.",
  },
  {
    date: "2026-06-04",
    start: "03:15",
    end: "11:15",
    title: "Sleep: 8 hours",
    location: HOME_BASE_LOCATION,
    note: "Staggered late sleep block; night-to-night bedtime shift stays within 30 minutes.",
  },
  {
    date: "2026-06-05",
    start: "03:45",
    end: "11:45",
    title: "Sleep: 8 hours",
    location: HOME_BASE_LOCATION,
    note: "Staggered late sleep block; night-to-night bedtime shift stays within 30 minutes.",
  },
  {
    date: "2026-06-06",
    start: "04:15",
    end: "12:15",
    title: "Sleep: 8 hours",
    location: HOME_BASE_LOCATION,
    note: "Staggered late sleep block after the final Tech Week route day.",
  },
];

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function cleanAddress(address: string): string {
  return decodeHtmlEntities(address)
    .replace(/\bFL\s+\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, "");
}

export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const radiusMeters = 6_371_000;
  const phi1 = toRadians(aLat);
  const phi2 = toRadians(bLat);
  const dPhi = toRadians(bLat - aLat);
  const dLambda = toRadians(bLon - aLon);
  const value = Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * radiusMeters * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export const haversine = haversineMeters;

export function haversineMinutes(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  metersPerMinute = DEFAULT_WALKING_METERS_PER_MINUTE,
): number {
  return haversineMeters(aLat, aLon, bLat, bLon) / metersPerMinute;
}

export async function geocode(query: string, options: GeocodeOptions = {}): Promise<GeocodeResult> {
  const cleanedQuery = cleanAddress(query);
  if (!cleanedQuery) {
    throw new Error("Cannot geocode an empty query.");
  }

  const routingVersion = options.routingVersion ?? ROUTING_VERSION;
  const cacheKey: CacheKey = ["routing", "geocode", routingVersion, cleanedQuery];
  const cached = await cacheGet<GeocodeResult>(options.cache, cacheKey);
  if (cached) {
    return cached;
  }

  const endpoint = options.endpoint ?? "https://nominatim.openstreetmap.org/search";
  const fetcher = options.fetcher ?? fetch;
  const candidates = geocodeCandidates(cleanedQuery);
  let lastPayload: unknown = undefined;

  for (const candidate of candidates) {
    const params = new URLSearchParams({
      q: candidate,
      format: "jsonv2",
      limit: "1",
      countrycodes: "us",
    });
    const payload = await fetchJson<unknown>(`${endpoint}?${params}`, {
      fetcher,
      userAgent: options.userAgent,
    });
    lastPayload = payload;
    if (Array.isArray(payload) && payload.length > 0) {
      const item = asRecord(payload[0]);
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }
      const result: GeocodeResult = {
        lat,
        lon,
        displayName: stringValue(item.display_name),
        usedQuery: candidate,
        raw: item,
      };
      await cacheSet(options.cache, cacheKey, result);
      return result;
    }
  }

  throw new Error(
    `Nominatim could not geocode: ${cleanedQuery}; last payload: ${JSON.stringify(lastPayload)}`,
  );
}

export async function loadStations(options: LoadStationsOptions = {}): Promise<SubwayStation[]> {
  const limit = options.limit ?? 600;
  const endpoint = options.endpoint ?? "https://subwayinfo.nyc/api/stations";
  const routingVersion = options.routingVersion ?? ROUTING_VERSION;
  const cacheKey: CacheKey = ["routing", "subway-stations", routingVersion, limit];
  const cached = await cacheGet<unknown[]>(options.cache, cacheKey);
  if (cached) {
    return cached.map(normalizeStation);
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const payload = await fetchJson<unknown>(`${endpoint}?${params}`, {
    fetcher: options.fetcher ?? fetch,
    userAgent: options.userAgent,
  });
  if (!Array.isArray(payload)) {
    throw new Error(`SubwayInfo stations response was not an array: ${JSON.stringify(payload)}`);
  }

  const stations = payload.map(normalizeStation);
  await cacheSet(options.cache, cacheKey, stations);
  return stations;
}

export function nearestStation(
  point: RoutePoint,
  stations: readonly SubwayStation[],
): SubwayStation {
  if (stations.length === 0) {
    throw new Error("Cannot find nearest station without station data.");
  }
  const normalizedPoint = normalizePoint(point);
  let nearest = stations[0];
  let nearestMinutes = haversineMinutes(
    normalizedPoint.lat,
    normalizedPoint.lon,
    nearest.lat,
    nearest.lon,
  );

  for (const station of stations.slice(1)) {
    const minutes = haversineMinutes(
      normalizedPoint.lat,
      normalizedPoint.lon,
      station.lat,
      station.lon,
    );
    if (minutes < nearestMinutes) {
      nearest = station;
      nearestMinutes = minutes;
    }
  }
  return nearest;
}

export async function subwayTrip(
  origin: SubwayStation,
  destination: SubwayStation,
  options: SubwayTripOptions = {},
): Promise<SubwayTripEstimate> {
  if (origin.id === destination.id) {
    return {
      estimatedMinutes: 0,
      numTransfers: 0,
      totalStops: 0,
      riskLabel: "",
      segments: [],
    };
  }

  const routingVersion = options.routingVersion ?? ROUTING_VERSION;
  const cacheKey: CacheKey = [
    "routing",
    "subway-trip",
    routingVersion,
    `${origin.id}->${destination.id}`,
  ];
  const cached = await cacheGet<SubwayTripEstimate>(options.cache, cacheKey);
  if (cached) {
    return cached;
  }

  const endpoint = options.endpoint ?? "https://subwayinfo.nyc/api/trip";
  const params = new URLSearchParams({
    origin_station_id: origin.id,
    destination_station_id: destination.id,
  });
  const payload = await fetchJson<unknown>(`${endpoint}?${params}`, {
    fetcher: options.fetcher ?? fetch,
    userAgent: options.userAgent,
  });
  const data = asRecord(payload);
  const estimatedMinutes = Number(data.estimatedMinutes);
  if (!Number.isFinite(estimatedMinutes)) {
    throw new Error(
      `SubwayInfo trip failed for ${origin.id}->${destination.id}: ${JSON.stringify(payload)}`,
    );
  }

  const disruptionAnalysis = asRecord(data.disruptionAnalysis);
  const segments = Array.isArray(data.segments)
    ? data.segments.map((segment) => formatSubwaySegment(asRecord(segment))).filter(Boolean)
    : [];
  const result: SubwayTripEstimate = {
    estimatedMinutes,
    numTransfers: nullableNumber(data.numTransfers),
    totalStops: nullableNumber(data.totalStops),
    riskLabel: stringValue(disruptionAnalysis.riskLabel),
    segments,
    raw: payload,
  };
  await cacheSet(options.cache, cacheKey, result);
  return result;
}

export async function walkingEstimate(
  origin: RoutePoint,
  destination: RoutePoint,
  options: WalkingEstimateOptions = {},
): Promise<WalkingEstimate> {
  const from = normalizePoint(origin);
  const to = normalizePoint(destination);
  const stretchFactor = options.stretchFactor ?? DEFAULT_WALKING_STRETCH_FACTOR;
  const metersPerMinute = options.metersPerMinute ?? DEFAULT_WALKING_METERS_PER_MINUTE;
  const routingVersion = options.routingVersion ?? ROUTING_VERSION;
  const cacheKey: CacheKey = [
    "routing",
    "walk",
    routingVersion,
    stretchFactor,
    metersPerMinute,
    pointFingerprint(from),
    pointFingerprint(to),
  ];
  const cached = await cacheGet<WalkingEstimate>(options.cache, cacheKey);
  if (cached) {
    return cached;
  }

  const straightMeters = haversineMeters(from.lat, from.lon, to.lat, to.lon);
  const meters = Math.round(straightMeters * stretchFactor);
  const result = {
    minutes: Math.ceil(meters / metersPerMinute),
    meters,
  };
  await cacheSet(options.cache, cacheKey, result);
  return result;
}

export async function routeBetween(
  origin: RoutePoint,
  destination: RoutePoint,
  options: RouteBetweenOptions = {},
): Promise<RouteEstimate> {
  const directWalk = await walkingEstimate(origin, destination, {
    cache: options.cache,
    fetcher: options.fetcher,
    metersPerMinute: options.walkingMetersPerMinute,
    routingVersion: options.routingVersion,
    stretchFactor: options.walkingStretchFactor,
    userAgent: options.userAgent,
  });
  if (directWalk.minutes <= 25) {
    return walkingRoute(directWalk);
  }

  const originPoint = normalizePoint(origin);
  const destinationPoint = normalizePoint(destination);
  let originStation: SubwayStation;
  let destinationStation: SubwayStation;
  try {
    const stations = options.stations ??
      await loadStations({
        cache: options.cache,
        endpoint: options.stationEndpoint,
        fetcher: options.fetcher,
        limit: options.stationLimit,
        routingVersion: options.routingVersion,
        userAgent: options.userAgent,
      });
    originStation = nearestStation(originPoint, stations);
    destinationStation = nearestStation(destinationPoint, stations);
  } catch (error) {
    return transitUnavailableRoute(directWalk, error);
  }
  const walkToStation = await walkingEstimate(originPoint, pointFromStation(originStation), {
    cache: options.cache,
    fetcher: options.fetcher,
    metersPerMinute: options.walkingMetersPerMinute,
    routingVersion: options.routingVersion,
    stretchFactor: options.walkingStretchFactor,
    userAgent: options.userAgent,
  });
  const walkFromStation = await walkingEstimate(
    pointFromStation(destinationStation),
    destinationPoint,
    {
      cache: options.cache,
      fetcher: options.fetcher,
      metersPerMinute: options.walkingMetersPerMinute,
      routingVersion: options.routingVersion,
      stretchFactor: options.walkingStretchFactor,
      userAgent: options.userAgent,
    },
  );
  let subway: SubwayTripEstimate;
  try {
    subway = await subwayTrip(originStation, destinationStation, {
      cache: options.cache,
      endpoint: options.subwayTripEndpoint,
      fetcher: options.fetcher,
      routingVersion: options.routingVersion,
      userAgent: options.userAgent,
    });
  } catch (error) {
    return transitUnavailableRoute(directWalk, error);
  }
  const subwayBufferMinutes = options.subwayBufferMinutes ?? DEFAULT_SUBWAY_BUFFER_MINUTES;
  const subwayTotal = walkToStation.minutes + subway.estimatedMinutes + walkFromStation.minutes +
    subwayBufferMinutes;

  if (
    directWalk.minutes <= subwayTotal - 5 ||
    (directWalk.minutes <= 25 && directWalk.minutes <= subwayTotal + 8)
  ) {
    return {
      ...walkingRoute(directWalk),
      originStation,
      destinationStation,
      walkToStation,
      walkFromStation,
      subwayTrip: subway,
    };
  }

  return {
    mode: "subway+walk",
    minutes: subwayTotal,
    details: `Walk ${walkToStation.minutes} min to ${formatStation(originStation)}; ` +
      `subway ${subway.estimatedMinutes} min; ` +
      `walk ${walkFromStation.minutes} min from ${formatStation(destinationStation)}; ` +
      `includes ${subwayBufferMinutes} min buffer.`,
    fromStation: formatStation(originStation),
    toStation: formatStation(destinationStation),
    subwaySegments: subway.segments.join("; "),
    risk: subway.riskLabel,
    directWalk,
    originStation,
    destinationStation,
    walkToStation,
    walkFromStation,
    subwayTrip: subway,
  };
}

function walkingRoute(directWalk: WalkingEstimate): RouteEstimate {
  return {
    mode: "walk",
    minutes: directWalk.minutes,
    details:
      `Walk approx ${directWalk.minutes} min / ${directWalk.meters} m using OSM-geocoded points.`,
    fromStation: "",
    toStation: "",
    subwaySegments: "",
    risk: "",
    directWalk,
  };
}

function transitUnavailableRoute(directWalk: WalkingEstimate, error: unknown): RouteEstimate {
  const reserveMinutes = Math.max(
    30,
    Math.min(directWalk.minutes, Math.ceil(directWalk.minutes * 0.65)),
  );
  const source = error instanceof Error && /\b429\b|too many requests/i.test(error.message)
    ? "the transit API is rate-limited"
    : "the transit API is unavailable";
  return {
    mode: "subway+walk",
    minutes: reserveMinutes,
    details:
      `Reserve approx ${reserveMinutes} min because ${source}; estimate is based on ${directWalk.minutes} min walking distance.`,
    fromStation: "",
    toStation: "",
    subwaySegments: "",
    risk: "transit_estimated",
    directWalk,
  };
}

export async function buildOperationalRoute(
  events: readonly OperationalRouteEvent[],
  options: BuildOperationalRouteOptions = {},
): Promise<OperationalScheduleBlock[]> {
  const routeIds = options.routeIds ?? DEFAULT_OPERATIONAL_ROUTE_IDS;
  const homePoint = normalizePoint(options.homePoint ?? HOME_POINT);
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const selected = routeIds
    .map((id) => eventsById.get(id))
    .filter((event): event is OperationalRouteEvent => Boolean(event))
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());

  const stations = options.stations ??
    await loadStations({
      cache: options.cache,
      endpoint: options.stationEndpoint,
      fetcher: options.fetcher,
      limit: options.stationLimit,
      routingVersion: options.routingVersion,
      userAgent: options.userAgent,
    });
  const rows: OperationalScheduleBlock[] = [];
  if (options.includeSleep !== false) {
    rows.push(...sleepRows(options.sleepBlocks ?? DEFAULT_SLEEP_BLOCKS));
  }

  const byDay = groupEventsByDay(selected);
  for (const [day, dayEvents] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dayRows: OperationalScheduleBlock[] = [];
    let previousPoint: RoutePoint = homePoint;
    let previousEventEntry: OperationalScheduleBlock | null = null;

    for (
      const event of dayEvents.sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())
    ) {
      const eventPoint = normalizePoint(event.point);
      const route = await routeBetween(previousPoint, eventPoint, { ...options, stations });
      const travelMinutes = route.minutes;
      const start = eventStart(event);
      const travelStart = addMinutes(start, -travelMinutes);
      const travelEnd = start;
      let leaveNote = "";

      if (previousEventEntry && previousEventEntry.end.getTime() > travelStart.getTime()) {
        const minutesEarly = Math.ceil(
          (previousEventEntry.end.getTime() - travelStart.getTime()) / 60_000,
        );
        const previousActualEnd = previousEventEntry.actualEnd;
        const shortenedEnd = travelStart.getTime() > previousEventEntry.start.getTime()
          ? travelStart
          : previousEventEntry.start;
        previousEventEntry.end = shortenedEnd;
        const infeasibleNote = shortenedEnd.getTime() === previousEventEntry.start.getTime()
          ? " Required travel would start before this event begins; route overlap is infeasible."
          : "";
        previousEventEntry.note = joinParts([
          previousEventEntry.note,
          `Route calendar shortens this from the event's scheduled ${
            formatLocalTime(previousActualEnd)
          } end; ` +
          `leave ${minutesEarly} min early for transit.${infeasibleNote}`,
        ]);
        leaveNote = `Leave previous event ${minutesEarly} min before its scheduled end.`;
      }

      const originName = previousPoint.name;
      if (travelMinutes > 0) {
        dayRows.push(travelRow({
          start: travelStart,
          end: travelEnd,
          title: `${originName} -> ${event.name}`,
          location: `${originName} -> ${stringEventValue(event, "location")}`,
          route,
          note: leaveNote,
          calendarBlockId: `${eventTechweekId(event)}-TRAVEL-IN`,
          relatedTechweekId: eventTechweekId(event),
          partifulId: eventPartifulId(event),
          eventUrl: eventUrl(event),
          googleMapsUrl: googleMapsDirectionsUrl(
            pointMapsQuery(previousPoint),
            pointMapsQuery(eventPoint),
            route.mode,
          ),
        }));
      }

      const eventEntry = scheduleEventRow(event);
      dayRows.push(eventEntry);
      previousPoint = eventPoint;
      previousEventEntry = eventEntry;
    }

    if (previousEventEntry) {
      const mealRowsForThisDay = options.includeMeals === false
        ? []
        : mealRowsForDay(day, options.mealBlocks ?? DEFAULT_MEAL_BLOCKS);
      dayRows.push(...mealRowsForThisDay);

      const route = await routeBetween(previousPoint, homePoint, { ...options, stations });
      const travelHomeStart = maxDate([
        previousEventEntry.end,
        ...mealRowsForThisDay
          .filter((row) => row.start.getTime() >= previousEventEntry.end.getTime())
          .map((row) => row.end),
      ]);
      dayRows.push(travelRow({
        start: travelHomeStart,
        end: addMinutes(travelHomeStart, route.minutes),
        title: `${previousPoint.name} -> ${homePoint.name}`,
        location: `${previousPoint.name} -> ${homePoint.location ?? homePoint.name}`,
        route,
        note: "",
        calendarBlockId: `TW-${localDateStamp(previousEventEntry.start)}-TRAVEL-HOME`,
        relatedTechweekId: previousEventEntry.techweekId,
        partifulId: previousEventEntry.partifulId,
        eventUrl: previousEventEntry.eventUrl,
        googleMapsUrl: googleMapsDirectionsUrl(
          pointMapsQuery(previousPoint),
          pointMapsQuery(homePoint),
          route.mode,
        ),
      }));
    }

    rows.push(...dayRows);
  }

  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function parseLocalDateTime(value: DateLike): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const trimmed = value.trim();
  const localMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T])(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (localMatch) {
    const [, year, month, day, hour, minute, second = "0"] = localMatch;
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid datetime: ${value}`);
  }
  return parsed;
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

export function localDateKey(value: Date): string {
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

export function localDateStamp(value: Date): string {
  return `${value.getUTCFullYear()}${pad2(value.getUTCMonth() + 1)}${pad2(value.getUTCDate())}`;
}

export function formatLocalTime(value: Date): string {
  return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
}

export function pointMapsQuery(point: RoutePoint): string {
  const normalized = normalizePoint(point);
  if (Number.isFinite(normalized.lat) && Number.isFinite(normalized.lon)) {
    return `${normalized.lat},${normalized.lon}`;
  }
  return normalized.query ?? normalized.location ?? normalized.name;
}

export function googleMapsDirectionsUrl(
  origin: string,
  destination: string,
  routeMode: RouteMode | "" = "",
): string {
  if (!origin || !destination) {
    return "";
  }
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
  });
  if (routeMode === "walk") {
    params.set("travelmode", "walking");
  } else if (routeMode === "subway+walk") {
    params.set("travelmode", "transit");
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

export function googleMapsSearchUrl(query: string): string {
  if (!query) {
    return "";
  }
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query })}`;
}

export function mealRowsForDay(
  dateValue: string,
  meals: readonly BufferBlockInput[] = DEFAULT_MEAL_BLOCKS,
): OperationalScheduleBlock[] {
  return meals.filter((meal) => meal.date === dateValue).map(mealRow);
}

export function sleepRows(
  sleeps: readonly BufferBlockInput[] = DEFAULT_SLEEP_BLOCKS,
): OperationalScheduleBlock[] {
  return sleeps.map(sleepRow);
}

function normalizePoint(point: RoutePoint): RoutePoint {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Point "${point.name}" has invalid coordinates: ${point.lat}, ${point.lon}`);
  }
  return {
    ...point,
    query: point.query ?? point.venueQuery ?? point.venue_query,
    precision: point.precision ?? point.addressPrecision ?? point.address_precision,
    lat,
    lon,
  };
}

function pointFromStation(station: SubwayStation): RoutePoint {
  return {
    id: station.id,
    name: station.name,
    precision: "subway_station",
    lat: station.lat,
    lon: station.lon,
  };
}

function pointFingerprint(point: RoutePoint): string {
  const normalized = normalizePoint(point);
  return [
    normalized.id ?? "",
    normalized.name,
    normalized.query ?? normalized.location ?? "",
    normalized.precision ?? "",
    normalized.lat.toFixed(6),
    normalized.lon.toFixed(6),
  ].join("|");
}

function geocodeCandidates(query: string): string[] {
  const candidates = [query];
  if (query.includes(",")) {
    candidates.push(cleanAddress(query.slice(query.indexOf(",") + 1)));
  }
  if (query.includes("Avenue")) {
    candidates.push(cleanAddress(query.replaceAll("Avenue", "Ave")));
  }
  if (query.includes(" Ave")) {
    candidates.push(cleanAddress(query.replace(/^[^,]+,\s*/, "")));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function normalizeStation(value: unknown): SubwayStation {
  const record = asRecord(value);
  const lat = Number(record.lat);
  const lon = Number(record.lon);
  if (!record.id || !record.name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Invalid SubwayInfo station: ${JSON.stringify(value)}`);
  }
  return {
    id: String(record.id),
    name: String(record.name),
    lat,
    lon,
    lines: stationLines(record.lines),
    raw: value,
  };
}

function stationLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,\s/]+/).map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function formatStation(station: SubwayStation): string {
  const lines = station.lines.join("/");
  return lines ? `${station.name} (${lines})` : station.name;
}

function formatSubwaySegment(segment: Record<string, unknown>): string {
  return joinParts([
    stringValue(segment.line),
    stringValue(segment.fromStationName),
    "to",
    stringValue(segment.toStationName),
  ]);
}

async function fetchJson<T>(
  url: string,
  options: { fetcher: FetchLike; userAgent?: string },
): Promise<T> {
  const response = await options.fetcher(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${response.statusText}: ${url}`);
  }
  return await response.json() as T;
}

async function cacheGet<T>(
  cache: RoutingCacheAdapter | undefined,
  key: CacheKey,
): Promise<T | undefined> {
  const value = await cache?.get<T>(key);
  return value ?? undefined;
}

async function cacheSet<T>(
  cache: RoutingCacheAdapter | undefined,
  key: CacheKey,
  value: T,
): Promise<void> {
  await cache?.set(key, value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
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
    return HTML_ENTITIES[lower] ?? match;
  });
}

function eventStart(event: OperationalRouteEvent): Date {
  const value = eventValue<DateLike>(event, "start", "startDt", "start_dt");
  if (!value) {
    throw new Error(`Event ${event.id} is missing a start datetime.`);
  }
  return parseLocalDateTime(value);
}

function eventEnd(event: OperationalRouteEvent): Date {
  const value = eventValue<DateLike>(event, "end", "endDt", "end_dt");
  if (!value) {
    throw new Error(`Event ${event.id} is missing an end datetime.`);
  }
  return parseLocalDateTime(value);
}

function eventActualStart(event: OperationalRouteEvent): Date {
  const value = eventValue<DateLike>(event, "actualStart", "actualStartDt", "actual_start_dt") ??
    eventValue<DateLike>(event, "start", "startDt", "start_dt");
  if (!value) {
    throw new Error(`Event ${event.id} is missing an actual start datetime.`);
  }
  return parseLocalDateTime(value);
}

function eventActualEnd(event: OperationalRouteEvent): Date {
  const value = eventValue<DateLike>(event, "actualEnd", "actualEndDt", "actual_end_dt") ??
    eventValue<DateLike>(event, "end", "endDt", "end_dt");
  if (!value) {
    throw new Error(`Event ${event.id} is missing an actual end datetime.`);
  }
  return parseLocalDateTime(value);
}

function groupEventsByDay(
  events: readonly OperationalRouteEvent[],
): Map<string, OperationalRouteEvent[]> {
  const byDay = new Map<string, OperationalRouteEvent[]>();
  for (const event of events) {
    const day = event.date ?? localDateKey(eventStart(event));
    const dayEvents = byDay.get(day) ?? [];
    dayEvents.push(event);
    byDay.set(day, dayEvents);
  }
  return byDay;
}

function scheduleEventRow(event: OperationalRouteEvent): OperationalScheduleBlock {
  const status = stringEventValue(event, "status") || "registered";
  const statusLabel = stringEventValue(event, "statusLabel", "status_label") ||
    (status ? status.toUpperCase() : "");
  const category = stringEventValue(event, "category") || "";
  const categoryLabel = stringEventValue(event, "categoryLabel", "category_label") ||
    (category ? category.toUpperCase() : "");
  return {
    entryType: "event",
    calendar: "schedule",
    start: eventStart(event),
    end: eventEnd(event),
    actualStart: eventActualStart(event),
    actualEnd: eventActualEnd(event),
    title: statusLabel ? `[${statusLabel}] ${event.name}` : event.name,
    location: stringEventValue(event, "location"),
    techweekId: eventTechweekId(event),
    calendarBlockId: `${eventTechweekId(event)}-SCHEDULE`,
    partifulId: eventPartifulId(event),
    status,
    statusLabel,
    category,
    categoryLabel,
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    subwaySegments: "",
    transitRisk: "",
    note: joinParts([
      stringEventValue(event, "routeNote", "route_note"),
      stringEventValue(event, "nextStep", "next_step"),
      stringEventValue(event, "notes"),
    ]),
    eventUrl: eventUrl(event),
    googleMapsUrl: stringEventValue(event, "googleMapsUrl", "google_maps_url") ||
      googleMapsSearchUrl(stringEventValue(event, "venueQuery", "venue_query", "location")),
    rank: stringEventValue(event, "rank"),
    tier: stringEventValue(event, "tier"),
    opportunityScore: stringEventValue(event, "opportunityScore", "opportunity_score"),
    fitSummary: stringEventValue(event, "fitSummary", "fit_summary"),
    venueQuery: stringEventValue(event, "venueQuery", "venue_query"),
    venuePrecision: stringEventValue(event, "venuePrecision", "venue_precision"),
    nextStep: stringEventValue(event, "nextStep", "next_step"),
    notes: stringEventValue(event, "notes"),
    salesCoaching: stringEventValue(event, "salesCoaching", "sales_coaching"),
    sourceEventId: event.id,
  };
}

function travelRow(input: {
  start: Date;
  end: Date;
  title: string;
  location: string;
  route: RouteEstimate;
  note: string;
  calendarBlockId: string;
  relatedTechweekId: string;
  partifulId: string;
  eventUrl: string;
  googleMapsUrl: string;
}): OperationalScheduleBlock {
  return {
    entryType: "travel",
    calendar: "schedule",
    start: input.start,
    end: input.end,
    actualStart: input.start,
    actualEnd: input.end,
    title: `Travel: ${input.title}`,
    location: input.location,
    techweekId: input.relatedTechweekId,
    calendarBlockId: input.calendarBlockId,
    partifulId: input.partifulId,
    status: "registered",
    statusLabel: "TRAVEL",
    category: "travel",
    categoryLabel: "TRAVEL",
    routeMode: input.route.mode,
    travelMinutes: input.route.minutes,
    routeDetails: input.route.details,
    subwaySegments: input.route.subwaySegments,
    transitRisk: input.route.risk,
    note: input.note,
    eventUrl: input.eventUrl,
    googleMapsUrl: input.googleMapsUrl,
    rank: "",
    tier: "",
    opportunityScore: "",
    fitSummary: "",
    venueQuery: input.location,
    venuePrecision: "",
    nextStep: "",
    notes: "",
    salesCoaching: "",
  };
}

function mealRow(meal: BufferBlockInput): OperationalScheduleBlock {
  const start = parseBufferDateTime(meal.date, meal.start);
  const end = parseBufferDateTime(meal.date, meal.end);
  const titleKey = meal.title.toLowerCase();
  const mealKind = titleKey.includes("lunch")
    ? "LUNCH"
    : titleKey.includes("dinner")
    ? "DINNER"
    : "FOOD";
  return {
    entryType: "meal",
    calendar: "schedule",
    start,
    end,
    actualStart: start,
    actualEnd: end,
    title: meal.title,
    location: meal.location,
    techweekId: "",
    calendarBlockId: `TW-${localDateStamp(start)}-MEAL-${mealKind}`,
    partifulId: "",
    status: "registered",
    statusLabel: "MEAL",
    category: "meal",
    categoryLabel: "MEAL",
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    subwaySegments: "",
    transitRisk: "",
    note: meal.note ?? "",
    eventUrl: "",
    googleMapsUrl: googleMapsSearchUrl(meal.location),
    rank: "",
    tier: "",
    opportunityScore: "",
    fitSummary: "",
    venueQuery: meal.location,
    venuePrecision: "meal_buffer",
    nextStep: "",
    notes: "",
    salesCoaching: "",
  };
}

function sleepRow(sleep: BufferBlockInput): OperationalScheduleBlock {
  const start = parseBufferDateTime(sleep.date, sleep.start);
  const end = parseBufferDateTime(sleep.date, sleep.end);
  return {
    entryType: "sleep",
    calendar: "schedule",
    start,
    end,
    actualStart: start,
    actualEnd: end,
    title: sleep.title,
    location: sleep.location,
    techweekId: "",
    calendarBlockId: `TW-${localDateStamp(start)}-SLEEP`,
    partifulId: "",
    status: "registered",
    statusLabel: "SLEEP",
    category: "sleep",
    categoryLabel: "SLEEP",
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    subwaySegments: "",
    transitRisk: "",
    note: sleep.note ?? "",
    eventUrl: "",
    googleMapsUrl: googleMapsSearchUrl(sleep.location),
    rank: "",
    tier: "",
    opportunityScore: "",
    fitSummary: "",
    venueQuery: sleep.location,
    venuePrecision: "sleep_buffer",
    nextStep: "",
    notes: "",
    salesCoaching: "",
  };
}

function parseBufferDateTime(date: string, time: string): Date {
  return parseLocalDateTime(`${date} ${time}`);
}

function eventTechweekId(event: OperationalRouteEvent): string {
  return stringEventValue(event, "techweekId", "techweek_id") || `TW-${event.id}`;
}

function eventPartifulId(event: OperationalRouteEvent): string {
  return stringEventValue(event, "partifulId", "partiful_id");
}

function eventUrl(event: OperationalRouteEvent): string {
  return stringEventValue(event, "eventUrl", "event_url");
}

function eventValue<T>(event: OperationalRouteEvent, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const value = event[key];
    if (value !== undefined && value !== null && value !== "") {
      return value as T;
    }
  }
  return undefined;
}

function stringEventValue(event: OperationalRouteEvent, ...keys: string[]): string {
  const value = eventValue<unknown>(event, ...keys);
  return value == null ? "" : String(value);
}

function joinParts(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function maxDate(values: readonly Date[]): Date {
  if (values.length === 0) {
    throw new Error("Cannot find max date of an empty list.");
  }
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
