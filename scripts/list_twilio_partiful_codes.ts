#!/usr/bin/env -S deno run --allow-env=HOME --allow-read=/Users/nv/.codex --allow-net=api.twilio.com

import {
  defaultTwilioAuthFilePath,
  fetchTwilioMessages,
  latestPartifulCodeMessage,
  readStoredTwilioAuth,
} from "./lib/twilio_sms.ts";

type Args = {
  authFile: string;
  limit: number;
  sinceMinutes: number;
};

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const auth = await readStoredTwilioAuth(args.authFile);
  const messages = await fetchTwilioMessages(auth, { limit: args.limit });
  const sinceMs = args.sinceMinutes > 0 ? Date.now() - args.sinceMinutes * 60_000 : undefined;
  const latest = latestPartifulCodeMessage(messages, { sinceMs });
  console.log(JSON.stringify(
    {
      phoneE164: auth.phoneE164,
      messageCount: messages.length,
      latest: latest
        ? {
          code: latest.code,
          sid: latest.message.sid,
          from: latest.message.from,
          to: latest.message.to,
          dateCreated: latest.message.dateCreated,
          body: latest.message.body,
        }
        : null,
    },
    null,
    2,
  ));
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    authFile: defaultTwilioAuthFilePath(),
    limit: 20,
    sinceMinutes: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--twilio-auth-file") {
      args.authFile = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--twilio-auth-file=")) {
      args.authFile = arg.slice("--twilio-auth-file=".length);
    } else if (arg === "--limit") {
      args.limit = Number(requiredValue(argv[++index], arg));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--since-minutes") {
      args.sinceMinutes = Number(requiredValue(argv[++index], arg));
    } else if (arg.startsWith("--since-minutes=")) {
      args.sinceMinutes = Number(arg.slice("--since-minutes=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) throw new Error("--limit must be positive.");
  if (!Number.isFinite(args.sinceMinutes) || args.sinceMinutes < 0) {
    throw new Error("--since-minutes must be non-negative.");
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
