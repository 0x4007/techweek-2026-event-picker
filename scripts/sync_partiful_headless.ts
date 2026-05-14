#!/usr/bin/env -S deno run --allow-env=HOME --allow-read=/Users/nv/.codex --allow-write=/Users/nv/.codex --allow-net=127.0.0.1:8787,localhost:8787,api.partiful.com,securetoken.googleapis.com

import {
  buildCallableSnapshot,
  callableResult,
  callPartifulFunction,
  defaultAuthFilePath,
  ensureFreshPartifulAuth,
  partifulIdFromUrl,
  readStoredPartifulAuth,
} from "./lib/partiful_headless.ts";

type ScheduleEntry = {
  blockType: string;
  displayTitle: string;
  eventUrl: string;
  partifulId: string;
};

type SchedulePayload = {
  days?: Array<{ entries?: ScheduleEntry[] }>;
  referenceDays?: Array<{ entries?: ScheduleEntry[] }>;
};

type Args = {
  authFile: string;
  baseUrl: string;
  discoverUpcoming: boolean;
  dryRun: boolean;
  limit: number;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const auth = await ensureFreshPartifulAuth(
    await readStoredPartifulAuth(args.authFile),
    args.authFile,
  );
  const targets = mergeTargets(
    await readTargets(args.baseUrl),
    args.discoverUpcoming ? await readUpcomingPartifulTargets(auth) : [],
  );
  const selectedTargets = args.limit > 0 ? targets.slice(0, args.limit) : targets;
  const snapshots = [];
  const failures = [];

  for (const [index, target] of selectedTargets.entries()) {
    console.error(`[${index + 1}/${selectedTargets.length}] ${target.title}`);
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
        failures.push({
          partifulId: target.partifulId,
          eventUrl: target.eventUrl,
          stage: "getGuests",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      snapshots.push(buildCallableSnapshot(target, getEventInfo, getGuests, auth.userId));
    } catch (error) {
      failures.push({
        partifulId: target.partifulId,
        eventUrl: target.eventUrl,
        stage: "getEventInfo",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (args.dryRun) {
    console.log(JSON.stringify(
      {
        authUserId: auth.userId,
        targetCount: selectedTargets.length,
        snapshotCount: snapshots.length,
        failureCount: failures.length,
        failures,
        snapshots: snapshots.map((snapshot) => ({
          partifulId: snapshot.partifulId,
          eventUrl: snapshot.eventUrl,
          title: snapshot.title,
          hasEvent: Boolean(snapshot.event),
          hasGuest: Boolean(snapshot.guest),
          hasRsvp: Boolean(snapshot.rsvp),
        })),
      },
      null,
      2,
    ));
    return;
  }

  const response = await fetch(`${args.baseUrl}/api/sync/partiful`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "partiful_headless_callable",
      recalculate: true,
      activate: true,
      responses: snapshots,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      stringValue(getPath(body, ["error", "message"])) ||
        `Partiful sync failed with HTTP ${response.status}.`,
    );
  }

  console.log(JSON.stringify(
    {
      targetCount: selectedTargets.length,
      snapshotCount: snapshots.length,
      failureCount: failures.length,
      failures,
      updatedEvents: getPath(body, ["sync", "updatedEvents", "length"]) ??
        arrayLength(getPath(body, ["sync", "updatedEvents"])),
      statusChanges: getPath(body, ["sync", "statusChanges", "length"]) ??
        arrayLength(getPath(body, ["sync", "statusChanges"])),
      agendaRunId: getPath(body, ["agenda", "agendaRunId"]),
      selectedEvents: getPath(body, ["agenda", "summary", "selectedEvents"]),
    },
    null,
    2,
  ));
}

async function readTargets(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/schedule`);
  if (!response.ok) {
    throw new Error(`Could not read schedule from ${baseUrl}; HTTP ${response.status}.`);
  }
  const payload = await response.json() as SchedulePayload;
  const entries = [
    ...(payload.days ?? []).flatMap((day) => day.entries ?? []),
    ...(payload.referenceDays ?? []).flatMap((day) => day.entries ?? []),
  ];
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    if (entry.blockType !== "event" || !entry.eventUrl.includes("partiful.com")) return [];
    const partifulId = entry.partifulId || partifulIdFromUrl(entry.eventUrl);
    const key = partifulId || entry.eventUrl;
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{
      eventUrl: entry.eventUrl,
      partifulId,
      title: entry.displayTitle,
    }];
  });
}

async function readUpcomingPartifulTargets(
  auth: Awaited<ReturnType<typeof readStoredPartifulAuth>>,
) {
  const response = await callPartifulFunction(auth, "getMyUpcomingEventsForHomePage", {});
  const data = callableResult(response);
  const events = Array.isArray(getPath(data, ["upcomingEvents"]))
    ? getPath(data, ["upcomingEvents"]) as unknown[]
    : [];
  return events.flatMap((event) => {
    const record = asRecord(event);
    if (!record) return [];
    const partifulId = stringValue(record.id) ||
      partifulIdFromUrl(stringValue(record.publicShortUrl));
    if (!partifulId) return [];
    const startDate = stringValue(record.startDate);
    if (!isConferenceWindow(startDate, stringValue(record.title))) return [];
    return [{
      eventUrl: `https://partiful.com/e/${partifulId}`,
      partifulId,
      title: stringValue(record.title) || `Partiful ${partifulId}`,
    }];
  });
}

function mergeTargets(
  primary: Awaited<ReturnType<typeof readTargets>>,
  discovered: typeof primary,
) {
  const merged = [];
  const seen = new Set<string>();
  for (const target of [...primary, ...discovered]) {
    const key = target.partifulId || target.eventUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }
  return merged;
}

function isConferenceWindow(startDate: string, title: string): boolean {
  const parsed = Date.parse(startDate);
  if (!Number.isFinite(parsed)) return /#?nytechweek/i.test(title);
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed));
  return (localDay >= "2026-06-01" && localDay <= "2026-06-07") || /#?nytechweek/i.test(title);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    authFile: defaultAuthFilePath(),
    baseUrl: DEFAULT_BASE_URL,
    discoverUpcoming: true,
    dryRun: false,
    limit: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--auth-file") {
      args.authFile = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--auth-file=")) {
      args.authFile = arg.slice("--auth-file=".length);
    } else if (arg === "--base-url") {
      args.baseUrl = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--base-url=")) {
      args.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--limit") {
      args.limit = Number(requiredValue(argv[++index], arg));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--no-discover-upcoming") {
      args.discoverUpcoming = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw new Error("--limit must be a non-negative number.");
  }
  return args;
}

function requiredValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

if (import.meta.main) {
  await main();
}
