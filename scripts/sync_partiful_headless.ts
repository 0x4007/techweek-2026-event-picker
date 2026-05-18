#!/usr/bin/env -S deno run --allow-env=HOME --allow-read=/Users/nv/.codex --allow-write=/Users/nv/.codex --allow-net=api.partiful.com,securetoken.googleapis.com

import { normalizePartifulSnapshot } from "../app/lib/partiful_sync.ts";
import {
  buildCallableSnapshot,
  callableResult,
  type CallableSnapshot,
  callPartifulFunction,
  defaultAuthFilePath,
  ensureFreshPartifulAuth,
  partifulIdFromUrl,
  type PartifulTarget,
  readStoredPartifulAuth,
  type StoredPartifulAuth,
} from "./lib/partiful_headless.ts";

type Args = {
  authFile: string;
  limit: number;
};

type SyncFailure = {
  eventUrl: string;
  message: string;
  partifulId: string;
  stage: string;
  title: string;
};

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const auth = await ensureFreshPartifulAuth(
    await readStoredPartifulAuth(args.authFile),
    args.authFile,
  );
  const targets = await readUpcomingPartifulTargets(auth);
  if (targets.length === 0) {
    throw new Error(
      "Partiful upcoming-events feed returned zero Tech Week targets. Not falling back to local schedule data.",
    );
  }

  const selectedTargets = args.limit > 0 ? targets.slice(0, args.limit) : targets;
  const snapshots: CallableSnapshot[] = [];
  const failures: SyncFailure[] = [];

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
        failures.push(partifulFailure(target, "getGuests", error));
      }
      snapshots.push(buildCallableSnapshot(target, getEventInfo, getGuests, auth.userId));
    } catch (error) {
      failures.push(partifulFailure(target, "getEventInfo", error));
    }
  }

  const normalized = snapshots.map((snapshot) =>
    normalizePartifulSnapshot(snapshot, { source: "partiful_headless_callable" })
  );
  const rows = normalized.map((result, index) => ({
    partifulId: result.event?.partifulId || snapshots[index]?.partifulId || "",
    title: result.event?.title || snapshots[index]?.title || "",
    status: result.event?.status || "unknown",
    rawStatus: result.event?.rawStatus || "",
    eventUrl: result.event?.eventUrl || snapshots[index]?.eventUrl || "",
    warnings: result.warnings.map((warning) => warning.message),
    errors: result.errors.map((error) => error.message),
  }));
  const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  const normalizationErrorCount = rows.reduce((sum, row) => sum + row.errors.length, 0);
  const unknownStatusCount = rows.filter((row) => row.status === "unknown").length;

  console.log(JSON.stringify(
    {
      authFile: args.authFile,
      authUserId: auth.userId,
      targetCount: selectedTargets.length,
      snapshotCount: snapshots.length,
      failureCount: failures.length,
      normalizationErrorCount,
      unknownStatusCount,
      registeredCount: statusCounts.registered ?? 0,
      statusCounts,
      failures,
      events: rows,
    },
    null,
    2,
  ));

  if (failures.length || normalizationErrorCount || unknownStatusCount) {
    throw new Error(
      `Partiful headless sync incomplete: ${failures.length} fetch failure(s), ` +
        `${normalizationErrorCount} normalization error(s), ${unknownStatusCount} unknown status(es).`,
    );
  }
}

async function readUpcomingPartifulTargets(auth: StoredPartifulAuth): Promise<PartifulTarget[]> {
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
    const title = stringValue(record.title) || `Partiful ${partifulId}`;
    if (!isConferenceWindow(stringValue(record.startDate), title)) return [];
    return [{
      eventUrl: `https://partiful.com/e/${partifulId}`,
      partifulId,
      title,
    }];
  });
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

function partifulFailure(target: PartifulTarget, stage: string, error: unknown): SyncFailure {
  return {
    eventUrl: target.eventUrl,
    message: error instanceof Error ? error.message : String(error),
    partifulId: target.partifulId,
    stage,
    title: target.title,
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    authFile: defaultAuthFilePath(),
    limit: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--auth-file") {
      args.authFile = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--auth-file=")) {
      args.authFile = arg.slice("--auth-file=".length);
    } else if (arg === "--limit") {
      args.limit = Number(requiredValue(argv[++index], arg));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
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

if (import.meta.main) {
  await main();
}
