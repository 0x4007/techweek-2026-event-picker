#!/usr/bin/env -S deno run --allow-env=HOME --allow-read=/Users/nv/.codex --allow-write=/Users/nv/.codex --allow-run=agent-browser --allow-net=api.twilio.com

import {
  defaultAuthFilePath,
  extractFirebaseAuthRecord,
  writeStoredPartifulAuth,
} from "./lib/partiful_headless.ts";
import {
  defaultTwilioAuthFilePath,
  pollForPartifulCode,
  readStoredTwilioAuth,
} from "./lib/twilio_sms.ts";

type Args = {
  partifulAuthFile: string;
  phone: string;
  session: string;
  timeoutMs: number;
  twilioAuthFile: string;
};

const DEFAULT_SESSION = "techweektwilio";

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
  const args = await parseArgs(Deno.args);
  const twilioAuth = await readStoredTwilioAuth(args.twilioAuthFile);
  const phone = args.phone || twilioAuth.phoneE164;
  if (!phone) throw new Error("No phone configured. Pass --phone or set phoneE164 in Twilio auth.");

  const startedAtMs = Date.now() - 15_000;
  await requestPartifulCode(args.session, phone);
  const codeMessage = await pollForPartifulCode(twilioAuth, {
    sinceMs: startedAtMs,
    timeoutMs: args.timeoutMs,
    to: phone,
  });
  await submitPartifulCode(args.session, codeMessage.code);
  const auth = await capturePartifulAuth(args.session);
  await writeStoredPartifulAuth(auth, args.partifulAuthFile);

  console.log(JSON.stringify(
    {
      session: args.session,
      phoneE164: phone,
      twilioMessageSid: codeMessage.message.sid,
      partifulAuthFile: args.partifulAuthFile,
      partifulUserId: auth.userId,
      expiresAt: new Date(auth.expirationTime).toISOString(),
    },
    null,
    2,
  ));
}

async function requestPartifulCode(session: string, phoneE164: string): Promise<void> {
  await agentBrowser(session, ["open", "https://partiful.com/login"]);
  await agentBrowser(session, ["wait", "1000"]);
  const phoneDigits = phoneForPartifulInput(phoneE164);
  await browserEval(
    session,
    `
(() => {
  const phone = ${JSON.stringify(phoneDigits)};
  const input = Array.from(document.querySelectorAll("input")).find((item) =>
    item.type === "tel" || /phone/i.test(item.placeholder || "")
  );
  if (!input) throw new Error("Partiful phone input not found.");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  input.focus();
  setter.call(input, "");
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  setter.call(input, phone);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: phone, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()
`,
  );
  await agentBrowser(session, ["wait", "500"]);
  await browserEval(
    session,
    `
(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    /^(login|continue|sign in|sign up)$/i.test((item.innerText || "").trim()) && !item.disabled
  );
  if (!button) throw new Error("Partiful login button not found or disabled.");
  button.click();
  return true;
})()
`,
  );
}

async function submitPartifulCode(session: string, code: string): Promise<void> {
  await agentBrowser(session, ["wait", "1500"]);
  await browserEval(
    session,
    `
(() => {
  const code = ${JSON.stringify(code)};
  const input = Array.from(document.querySelectorAll("input")).find((item) =>
    /0{4,6}|code/i.test(item.placeholder || "") || item.autocomplete === "one-time-code"
  );
  if (!input) throw new Error("Partiful verification code input not found.");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  input.focus();
  setter.call(input, "");
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  setter.call(input, code);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: code, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()
`,
  );
  await agentBrowser(session, ["wait", "500"]);
  await browserEval(
    session,
    `
(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    /^(i agree|continue|login|sign in)$/i.test((item.innerText || "").trim()) && !item.disabled
  );
  if (!button) throw new Error("Partiful verification submit button not found or disabled.");
  button.click();
  return true;
})()
`,
  );
  await agentBrowser(session, ["wait", "3000"]);
}

async function capturePartifulAuth(session: string) {
  const browserState = parseAgentBrowserEvalOutput(
    await agentBrowser(session, ["eval", FIREBASE_AUTH_EXTRACTION_JS]),
  );
  const auth = extractFirebaseAuthRecord(browserState, `agent-browser:${session}`);
  if (!auth) throw new Error("Partiful login completed but no Firebase auth token was found.");
  return auth;
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

async function browserEval(session: string, expression: string): Promise<unknown> {
  const raw = await agentBrowser(session, ["eval", expression]);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function parseAgentBrowserEvalOutput(stdout: string): unknown {
  const parsed = JSON.parse(stdout.trim());
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

function phoneForPartifulInput(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function parseArgs(argv: string[]): Args {
  const twilioAuthFile = defaultTwilioAuthFilePath();
  const defaultPartifulAuthFile = defaultAuthFilePath().replace(
    /partiful-auth\.json$/,
    "partiful-auth-twilio.json",
  );
  const args: Args = {
    partifulAuthFile: defaultPartifulAuthFile,
    phone: "",
    session: DEFAULT_SESSION,
    timeoutMs: 120_000,
    twilioAuthFile,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--twilio-auth-file") {
      args.twilioAuthFile = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--twilio-auth-file=")) {
      args.twilioAuthFile = arg.slice("--twilio-auth-file=".length);
    } else if (arg === "--partiful-auth-file") {
      args.partifulAuthFile = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--partiful-auth-file=")) {
      args.partifulAuthFile = arg.slice("--partiful-auth-file=".length);
    } else if (arg === "--phone") {
      args.phone = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--phone=")) {
      args.phone = arg.slice("--phone=".length);
    } else if (arg === "--session") {
      args.session = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--session=")) {
      args.session = arg.slice("--session=".length);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(requiredValue(argv[++index], arg));
    } else if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be at least 1000.");
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
