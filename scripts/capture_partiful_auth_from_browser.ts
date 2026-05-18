#!/usr/bin/env -S deno run --allow-env=HOME --allow-read=/Users/nv/.codex --allow-write=/Users/nv/.codex --allow-run=agent-browser

import {
  defaultAuthFilePath,
  extractFirebaseAuthRecord,
  writeStoredPartifulAuth,
} from "./lib/partiful_headless.ts";

type Args = {
  authFile: string;
  session: string;
};

const DEFAULT_SESSION = "techweek";

const FIREBASE_AUTH_EXTRACTION_JS = String.raw`
(async () => {
  const out = { localStorage: {}, sessionStorage: {}, indexedDb: [] };
  for (const [key, value] of Object.entries(localStorage)) out.localStorage[key] = value;
  for (const [key, value] of Object.entries(sessionStorage)) out.sessionStorage[key] = value;

  function openDb(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  function readStore(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  try {
    const db = await openDb("firebaseLocalStorageDb");
    const stores = [...db.objectStoreNames];
    for (const storeName of stores) {
      out.indexedDb.push({ db: "firebaseLocalStorageDb", store: storeName, rows: await readStore(db, storeName) });
    }
    db.close();
  } catch (error) {
    out.indexedDbError = String(error && error.message ? error.message : error);
  }

  return JSON.stringify(out);
})()
`;

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  await agentBrowser(args.session, ["open", "https://partiful.com"]);
  await agentBrowser(args.session, ["wait", "1000"]);
  const browserState = parseAgentBrowserEvalOutput(
    await agentBrowser(args.session, ["eval", FIREBASE_AUTH_EXTRACTION_JS]),
  );
  const auth = extractFirebaseAuthRecord(browserState, `agent-browser:${args.session}`);
  if (!auth) {
    throw new Error(
      "No Partiful Firebase auth token found in the browser session. Log into Partiful in " +
        `agent-browser session "${args.session}", then rerun this command.`,
    );
  }

  await writeStoredPartifulAuth(auth, args.authFile);
  console.log(JSON.stringify(
    {
      authFile: args.authFile,
      source: auth.source,
      userId: auth.userId,
      expiresAt: new Date(auth.expirationTime).toISOString(),
    },
    null,
    2,
  ));
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

function parseAgentBrowserEvalOutput(stdout: string): unknown {
  const parsed = JSON.parse(stdout.trim());
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    authFile: "",
    session: DEFAULT_SESSION,
  };
  let hasAuthFile = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--auth-file") {
      args.authFile = requiredValue(argv[++index], arg);
      hasAuthFile = true;
    } else if (arg.startsWith("--auth-file=")) {
      args.authFile = arg.slice("--auth-file=".length);
      hasAuthFile = true;
    } else if (arg === "--session") {
      args.session = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--session=")) {
      args.session = arg.slice("--session=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!hasAuthFile) args.authFile = defaultAuthFilePath();
  return args;
}

function requiredValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

if (import.meta.main) {
  await main();
}
