export type StoredTwilioAuth = {
  version: 1;
  accountSid: string;
  authToken: string;
  phoneE164: string;
  createdAt: string;
  updatedAt: string;
};

export type TwilioMessage = {
  sid: string;
  accountSid: string;
  messagingServiceSid: string;
  from: string;
  to: string;
  body: string;
  direction: string;
  dateCreated: string;
};

export type PartifulCodeMessage = {
  code: string;
  message: TwilioMessage;
};

const DEFAULT_TWILIO_AUTH_RELATIVE_PATH = ".codex/secrets/techweek-twilio-auth.json";

export function defaultTwilioAuthFilePath(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set; pass --twilio-auth-file explicitly.");
  return `${home}/${DEFAULT_TWILIO_AUTH_RELATIVE_PATH}`;
}

export async function readStoredTwilioAuth(
  path = defaultTwilioAuthFilePath(),
): Promise<StoredTwilioAuth> {
  return validateStoredTwilioAuth(JSON.parse(await Deno.readTextFile(path)));
}

export async function writeStoredTwilioAuth(
  auth: StoredTwilioAuth,
  path = defaultTwilioAuthFilePath(),
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  try {
    await Deno.chmod(path, 0o600);
  } catch {
    // Best effort on filesystems that support POSIX permissions.
  }
}

export async function fetchTwilioMessages(
  auth: StoredTwilioAuth,
  options: { limit?: number; to?: string } = {},
): Promise<TwilioMessage[]> {
  const url = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Messages.json`,
  );
  url.searchParams.set("PageSize", String(Math.max(1, Math.min(options.limit ?? 20, 100))));
  if (options.to || auth.phoneE164) url.searchParams.set("To", options.to || auth.phoneE164);

  const response = await fetch(url, {
    headers: {
      authorization: `Basic ${btoa(`${auth.accountSid}:${auth.authToken}`)}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      stringValue(getPath(body, ["message"])) ||
        `Twilio messages request failed with HTTP ${response.status}.`,
    );
  }
  const messages = Array.isArray(getPath(body, ["messages"])) ? getPath(body, ["messages"]) : [];
  return (messages as unknown[]).map(normalizeTwilioMessage).filter((message) => message.sid);
}

export function latestPartifulCodeMessage(
  messages: readonly TwilioMessage[],
  options: { sinceMs?: number } = {},
): PartifulCodeMessage | null {
  for (
    const message of [...messages].sort((a, b) => dateMs(b.dateCreated) - dateMs(a.dateCreated))
  ) {
    if (options.sinceMs && dateMs(message.dateCreated) < options.sinceMs) continue;
    const code = extractPartifulVerificationCode(message.body);
    if (code) return { code, message };
  }
  return null;
}

export async function pollForPartifulCode(
  auth: StoredTwilioAuth,
  options: {
    intervalMs?: number;
    limit?: number;
    sinceMs?: number;
    timeoutMs?: number;
    to?: string;
  } = {},
): Promise<PartifulCodeMessage> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const messages = await fetchTwilioMessages(auth, {
      limit: options.limit ?? 20,
      to: options.to,
    });
    const code = latestPartifulCodeMessage(messages, { sinceMs: options.sinceMs });
    if (code) return code;
    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for a Partiful verification code in Twilio messages.");
}

export function extractPartifulVerificationCode(body: string): string {
  if (!/partiful/i.test(body)) return "";
  return body.match(/\b(\d{6})\b/)?.[1] ?? "";
}

function validateStoredTwilioAuth(value: unknown): StoredTwilioAuth {
  const record = asRecord(value);
  if (!record) throw new Error("Stored Twilio auth file is not a JSON object.");
  const auth = {
    version: numberValue(record.version),
    accountSid: stringValue(record.accountSid),
    authToken: stringValue(record.authToken),
    phoneE164: stringValue(record.phoneE164),
    createdAt: stringValue(record.createdAt),
    updatedAt: stringValue(record.updatedAt),
  };
  if (auth.version !== 1 || !auth.accountSid || !auth.authToken || !auth.phoneE164) {
    throw new Error("Stored Twilio auth file is missing accountSid, authToken, or phoneE164.");
  }
  return auth as StoredTwilioAuth;
}

function normalizeTwilioMessage(value: unknown): TwilioMessage {
  const record = asRecord(value) ?? {};
  return {
    sid: stringValue(record.sid),
    accountSid: stringValue(record.account_sid),
    messagingServiceSid: stringValue(record.messaging_service_sid),
    from: stringValue(record.from),
    to: stringValue(record.to),
    body: stringValue(record.body),
    direction: stringValue(record.direction),
    dateCreated: stringValue(record.date_created),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : ".";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
