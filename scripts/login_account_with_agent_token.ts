#!/usr/bin/env -S deno run --allow-read=.codex --allow-run=agent-browser

type Args = {
  expectedHandle: string;
  expectedUserId: string;
  origin: string;
  session: string;
  token: string;
  tokenFile: string;
};

type AgentTokenFile = {
  expectedHandle?: unknown;
  expectedUserId?: unknown;
  origin?: unknown;
  session?: unknown;
  token?: unknown;
};

const DEFAULT_SESSION = "techweek";
const DEFAULT_TOKEN_FILE = ".codex/techweek-agent-token.json";
const DEFAULT_ORIGIN = "http://localhost:8788";

async function main(): Promise<void> {
  const args = await parseArgs(Deno.args);
  const origin = normalizeOrigin(args.origin);
  if (!args.token) {
    throw new Error(`No agent token configured. Pass --token or set token in ${args.tokenFile}.`);
  }

  await agentBrowser(args.session, ["open", `${origin}/auth.html?mode=token`]);
  await agentBrowser(args.session, ["wait", "500"]);

  const login = await browserEval(args.session, loginExpression(args.token));
  const loginStatus = numberPath(login, ["status"]);
  if (loginStatus !== 200) {
    throw new Error(
      `Agent token login failed with status ${loginStatus}: ${JSON.stringify(login)}`,
    );
  }

  const verified = await browserEval(args.session, sessionExpression());
  const accountSession = recordPath(verified, ["body", "session"]);
  if (accountSession?.authenticated !== true) {
    throw new Error(
      `Agent token login did not create an authenticated session: ${JSON.stringify(verified)}`,
    );
  }
  const user = recordPath(accountSession, ["user"]);
  if (args.expectedHandle && user?.handle !== args.expectedHandle) {
    throw new Error(
      `Expected handle ${args.expectedHandle}, got ${String(user?.handle || "")}.`,
    );
  }
  if (args.expectedUserId && user?.id !== args.expectedUserId) {
    throw new Error(
      `Expected user id ${args.expectedUserId}, got ${String(user?.id || "")}.`,
    );
  }

  console.log(JSON.stringify(
    {
      origin,
      session: args.session,
      auth: accountSession.auth,
      user,
      expiresAt: accountSession.expiresAt,
    },
    null,
    2,
  ));
}

export async function parseArgs(argv: string[]): Promise<Args> {
  const cli: Partial<Args> = {};
  let tokenFile = DEFAULT_TOKEN_FILE;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--origin") {
      cli.origin = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--origin=")) {
      cli.origin = arg.slice("--origin=".length);
    } else if (arg === "--session") {
      cli.session = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--session=")) {
      cli.session = arg.slice("--session=".length);
    } else if (arg === "--token") {
      cli.token = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--token=")) {
      cli.token = arg.slice("--token=".length);
    } else if (arg === "--token-file") {
      tokenFile = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--token-file=")) {
      tokenFile = arg.slice("--token-file=".length);
    } else if (arg === "--expected-handle") {
      cli.expectedHandle = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--expected-handle=")) {
      cli.expectedHandle = arg.slice("--expected-handle=".length);
    } else if (arg === "--expected-user-id") {
      cli.expectedUserId = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--expected-user-id=")) {
      cli.expectedUserId = arg.slice("--expected-user-id=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const file = await readTokenFile(tokenFile);
  return {
    expectedHandle: cli.expectedHandle || stringValue(file.expectedHandle),
    expectedUserId: cli.expectedUserId || stringValue(file.expectedUserId),
    origin: cli.origin || stringValue(file.origin) || DEFAULT_ORIGIN,
    session: cli.session || stringValue(file.session) || DEFAULT_SESSION,
    token: cli.token || stringValue(file.token),
    tokenFile,
  };
}

async function readTokenFile(path: string): Promise<AgentTokenFile> {
  try {
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as AgentTokenFile : {};
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
}

function loginExpression(token: string): string {
  return `
(async () => {
  const response = await fetch("/api/auth/agent-token/login", {
    method: "POST",
    credentials: "include",
    headers: { "accept": "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token: ${JSON.stringify(token)} }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return JSON.stringify({ status: response.status, body });
})()
`;
}

function sessionExpression(): string {
  return `
(async () => {
  const response = await fetch("/api/account/session", {
    credentials: "include",
    headers: { "accept": "application/json" },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return JSON.stringify({ status: response.status, body });
})()
`;
}

async function browserEval(session: string, expression: string): Promise<unknown> {
  const raw = await agentBrowser(session, ["eval", expression]);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

async function agentBrowser(session: string, args: string[]): Promise<string> {
  const fullArgs = ["--session", session, ...args];
  let lastMessage = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const command = new Deno.Command("agent-browser", {
      args: fullArgs,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout);
    if (output.success) return stdout;
    const stderr = new TextDecoder().decode(output.stderr);
    lastMessage = stderr.trim() || stdout.trim() || `agent-browser ${args[0]} failed.`;
    if (!/Resource temporarily unavailable|Daemon failed to start/i.test(lastMessage)) break;
    await delay(750 * attempt);
  }
  throw new Error(`agent-browser ${fullArgs.join(" ")} failed: ${lastMessage}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid origin: ${value}`);
  }
}

function recordPath(value: unknown, path: string[]): Record<string, unknown> | null {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : null;
}

function numberPath(value: unknown, path: string[]): number {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return NaN;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : NaN;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

if (import.meta.main) {
  await main();
}
