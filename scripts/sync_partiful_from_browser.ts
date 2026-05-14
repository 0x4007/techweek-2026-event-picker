#!/usr/bin/env -S deno run --allow-net=127.0.0.1:8787,localhost:8787 --allow-run=agent-browser

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
  baseUrl: string;
  session: string;
  limit: number;
  dryRun: boolean;
};

type BrowserSnapshot = {
  eventUrl: string;
  title: string;
  rsvpStatus: string;
  loginRequired: boolean;
  nextData: unknown;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_SESSION = "techweek";

const EXTRACTION_JS = String.raw`
(() => {
  const text = document.body?.innerText || "";
  const lower = text.toLowerCase();
  const nextText = document.querySelector("#__NEXT_DATA__")?.textContent || "";
  let nextData = null;
  try {
    nextData = nextText ? JSON.parse(nextText) : null;
  } catch {
    nextData = null;
  }
  let rsvpStatus = "";
  if (/(you['’]?re|you are) (in|going|on the list)/i.test(text)) {
    rsvpStatus = "APPROVED";
  } else if (/\b(request sent|pending approval|pending|application sent)\b/i.test(text)) {
    rsvpStatus = "PENDING_APPROVAL";
  } else if (/\b(waitlist|waitlisted)\b/i.test(text)) {
    rsvpStatus = "WAITLISTED_FOR_APPROVAL";
  }
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
  return JSON.stringify({
    eventUrl: location.href,
    title: ogTitle || document.title.replace(/\s*\|\s*Partiful\s*$/i, ""),
    rsvpStatus,
    loginRequired: !rsvpStatus && (/\b(login|sign in)\b/i.test(text) || lower.includes("get on the list")),
    nextData,
  });
})()
`;

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const targets = await readTargets(args.baseUrl);
  const selectedTargets = args.limit > 0 ? targets.slice(0, args.limit) : targets;
  const snapshots: Array<
    BrowserSnapshot & { expectedEventUrl: string; expectedPartifulId: string }
  > = [];

  for (const [index, target] of selectedTargets.entries()) {
    console.error(`[${index + 1}/${selectedTargets.length}] ${target.displayTitle}`);
    await agentBrowser(args.session, ["open", target.eventUrl]);
    await agentBrowser(args.session, ["wait", "1500"]);
    const snapshot = await readBrowserSnapshot(args.session);
    snapshots.push({
      ...snapshot,
      expectedEventUrl: target.eventUrl,
      expectedPartifulId: target.partifulId,
    });
  }

  const known = snapshots.filter((snapshot) => snapshot.rsvpStatus);
  const loginRequired = snapshots.filter((snapshot) => snapshot.loginRequired);
  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          count: snapshots.length,
          known: known.map(summarizeSnapshot),
          loginRequired: loginRequired.map(summarizeSnapshot),
        },
        null,
        2,
      ),
    );
    return;
  }

  const response = await fetch(`${args.baseUrl}/api/sync/partiful`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: `agent-browser:${args.session}`,
      recalculate: true,
      activate: true,
      responses: snapshots.map((snapshot) => ({
        eventUrl: snapshot.expectedEventUrl || snapshot.eventUrl,
        partifulId: snapshot.expectedPartifulId,
        title: snapshot.title,
        rsvpStatus: snapshot.rsvpStatus,
        nextData: snapshot.nextData,
      })),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Partiful sync failed with HTTP ${response.status}.`);
  }
  console.log(JSON.stringify(
    {
      snapshotCount: snapshots.length,
      knownStatusCount: known.length,
      loginRequiredCount: loginRequired.length,
      statusCounts: body.sync?.statusChanges?.length,
      agendaRunId: body.agenda?.agendaRunId,
      selectedEvents: body.agenda?.summary?.selectedEvents,
    },
    null,
    2,
  ));
}

async function readTargets(baseUrl: string): Promise<ScheduleEntry[]> {
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
  return entries.filter((entry) => {
    if (entry.blockType !== "event" || !entry.eventUrl.includes("partiful.com")) return false;
    const key = entry.partifulId || entry.eventUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readBrowserSnapshot(session: string): Promise<BrowserSnapshot> {
  const raw = await agentBrowser(session, ["eval", EXTRACTION_JS]);
  const value = JSON.parse(raw.trim()) as string;
  return JSON.parse(value) as BrowserSnapshot;
}

function summarizeSnapshot(
  snapshot: BrowserSnapshot & { expectedEventUrl?: string; expectedPartifulId?: string },
) {
  return {
    eventUrl: snapshot.expectedEventUrl || snapshot.eventUrl,
    partifulId: snapshot.expectedPartifulId || "",
    title: snapshot.title,
    rsvpStatus: snapshot.rsvpStatus,
    loginRequired: snapshot.loginRequired,
  };
}

async function agentBrowser(session: string, args: string[]): Promise<string> {
  const command = new Deno.Command("agent-browser", {
    args: ["--session", session, ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(stderr.trim() || stdout.trim() || `agent-browser ${args[0]} failed.`);
  }
  return stdout;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: DEFAULT_BASE_URL,
    session: DEFAULT_SESSION,
    limit: 0,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--base-url") {
      args.baseUrl = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--base-url=")) {
      args.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--session") {
      args.session = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--session=")) {
      args.session = arg.slice("--session=".length);
    } else if (arg === "--limit") {
      args.limit = Number(requiredValue(argv[++index], arg));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--dry-run") {
      args.dryRun = true;
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

if (import.meta.main) {
  await main();
}
