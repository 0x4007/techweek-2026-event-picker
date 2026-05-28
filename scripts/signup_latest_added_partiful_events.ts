#!/usr/bin/env -S deno run --allow-env=HOME --allow-read=.codex,/Users/nv/.codex --allow-write=.codex,data/rankings,/Users/nv/.codex --allow-net=api.partiful.com,securetoken.googleapis.com

import {
  callableResult,
  callPartifulFunction,
  defaultAuthFilePath,
  ensureFreshPartifulAuth,
  readStoredPartifulAuth,
} from "./lib/partiful_headless.ts";

const RESULTS_JSON = "data/rankings/techweek_nyc_added_signup_results_2026-05-28.json";
const RESULTS_CSV = "data/rankings/techweek_nyc_added_signup_results_2026-05-28.csv";
const STATUS_CSV = ".codex/techweek_signup_status.csv";

type Candidate = {
  category: "latest-added" | "latest-added-route";
  id: string;
  title: string;
  url: string;
};

type Question = {
  id: string;
  options?: string[];
  required?: boolean;
  text: string;
  type: string;
};

type Profile = {
  answer_policy: {
    default_required_text_answers: Record<string, string>;
  };
  attendee: {
    company: string;
    email: string;
    linkedin: string;
    name: string;
    phone_e164: string;
    title: string;
  };
};

type SignupResult = {
  action: string;
  category: string;
  count: number;
  currentStatus: string;
  eventId: string;
  maxCountPerGuest: string;
  notes: string;
  partifulUrl: string;
  rsvpStatus: string;
  title: string;
};

const CANDIDATES: Candidate[] = [
  {
    category: "latest-added",
    id: "Vkvjr5dBr2FmbI2yK5UB",
    title: "Data Center, Power & Enterprise Infrastructure Dinner",
    url: "https://partiful.com/e/Vkvjr5dBr2FmbI2yK5UB",
  },
  {
    category: "latest-added",
    id: "p74X9KDrgoLaDtU8BmvS",
    title: "SGLang Happy Hour: AI Infra in Finance",
    url: "https://partiful.com/e/p74X9KDrgoLaDtU8BmvS",
  },
  {
    category: "latest-added",
    id: "TjC1eG8CxxAKtYaVxrH2",
    title: "Investing in Agents: The Future of Autonomous AI",
    url: "https://partiful.com/e/TjC1eG8CxxAKtYaVxrH2",
  },
  {
    category: "latest-added",
    id: "tPlMvExfd6gOdgKCW6O7",
    title: "Tessera Labs x a16z: The Closing Gap",
    url: "https://partiful.com/e/tPlMvExfd6gOdgKCW6O7",
  },
  {
    category: "latest-added",
    id: "PhqnW15PCQAdoENB6aNl",
    title: "Founders, Investors & Builders - An Intimate NYC Cocktail Evening",
    url: "https://partiful.com/e/PhqnW15PCQAdoENB6aNl",
  },
  {
    category: "latest-added",
    id: "Vs2eC7nERtgF0PgNWfUo",
    title: "Founders x Investors AI Toolkit & Happy Hour",
    url: "https://partiful.com/e/Vs2eC7nERtgF0PgNWfUo",
  },
  {
    category: "latest-added",
    id: "u7UgtF8gTKW9BOKuG7k8",
    title: "Vesey Ventures & J.P. Morgan dinner: an evening of Agentic Commerce",
    url: "https://partiful.com/e/u7UgtF8gTKW9BOKuG7k8",
  },
  {
    category: "latest-added",
    id: "AzVoaw82pHkJLwh4XtEy",
    title: "Pull Up a Chair: A Coffee Salon on What It Would Take to Actually Fix Tech",
    url: "https://partiful.com/e/AzVoaw82pHkJLwh4XtEy",
  },
  {
    category: "latest-added",
    id: "MQvS9RrcXl6HcAEzfzhg",
    title: "The builder's table: AI finance leaders lunch with Vayu, Base44 & PwC",
    url: "https://partiful.com/e/MQvS9RrcXl6HcAEzfzhg",
  },
  {
    category: "latest-added",
    id: "hl2AIeWhZ1e2t6LveEGw",
    title: "AI on Main Street: How Chinatown's Small Businesses Are Using AI",
    url: "https://partiful.com/e/hl2AIeWhZ1e2t6LveEGw",
  },
  {
    category: "latest-added-route",
    id: "WJe6XcxPXwbpCiCVLCas",
    title: "The Semiconductor & AI Supply Chain Lunch: Investors & Operators",
    url: "https://partiful.com/e/WJe6XcxPXwbpCiCVLCas",
  },
  {
    category: "latest-added",
    id: "pmDosvwgBQPxLVDk8WWb",
    title: "Fintech Engineers Happy Hour",
    url: "https://partiful.com/e/pmDosvwgBQPxLVDk8WWb",
  },
  {
    category: "latest-added",
    id: "pIS8aostHgPm9GXmaN6X",
    title: "Voice AI Meetup: Build a Voice Agent in 1 hour",
    url: "https://partiful.com/e/pIS8aostHgPm9GXmaN6X",
  },
  {
    category: "latest-added",
    id: "gP80ioDptVy1W5Gx5Lv4",
    title: "From Startup to Scale: Using AI to Streamline and Grow",
    url: "https://partiful.com/e/gP80ioDptVy1W5Gx5Lv4",
  },
  {
    category: "latest-added",
    id: "tUV88fW7J763Q0ZLdTBI",
    title:
      "The Mooch and IBM's Gary Cohn on Owning the Future: Digital Sovereignty in the Age of AI",
    url: "https://partiful.com/e/tUV88fW7J763Q0ZLdTBI",
  },
  {
    category: "latest-added",
    id: "KIimVVdYB8fjaiE1UdZz",
    title: "Built in NYC: AI Edition",
    url: "https://partiful.com/e/KIimVVdYB8fjaiE1UdZz",
  },
];

async function main(): Promise<void> {
  const apply = Deno.args.includes("--apply");
  const writeStatus = Deno.args.includes("--write-status");
  const profile = JSON.parse(
    await Deno.readTextFile(".codex/techweek-rsvp-profile.json"),
  ) as Profile;
  const authFile = defaultAuthFilePath();
  const auth = await ensureFreshPartifulAuth(
    await readStoredPartifulAuth(authFile),
    authFile,
  );
  const results: SignupResult[] = [];

  for (const candidate of CANDIDATES) {
    const eventInfo = callableResult(
      await callPartifulFunction(auth, "getEventInfo", { params: { eventId: candidate.id } }),
    );
    const event = recordValue(path(eventInfo, ["event"]) ?? eventInfo);
    const questions = questionnaireQuestions(event);
    const currentGuest = await currentGuestStatus(auth, candidate.id);
    const maxCountPerGuest = numberValue(event.maxCountPerGuest);
    const ticketingEnabled = Boolean(event.ticketing || event.ticketingInfo || event.tickets);
    let result: SignupResult;

    if (currentGuest.status) {
      result = baseResult(
        candidate,
        "already-signed",
        currentGuest.status,
        currentGuest.count,
        event,
      );
      result.notes = "Existing Partiful guest record found; left unchanged.";
    } else if (stringValue(event.status) !== "PUBLISHED") {
      result = baseResult(candidate, "blocked", "", 0, event);
      result.notes = `Skipped because Partiful event status is ${
        stringValue(event.status) || "unknown"
      }.`;
    } else if (event.rsvpsEnabled === false) {
      result = baseResult(candidate, "blocked", "", 0, event);
      result.notes = "Skipped because RSVPs are disabled.";
    } else if (ticketingEnabled) {
      result = baseResult(candidate, "blocked", "", 0, event);
      result.notes = "Skipped because the event uses Partiful ticketing/checkout.";
    } else if (event.atCapacity === true && event.enableWaitlist !== true) {
      result = baseResult(candidate, "blocked", "", 0, event);
      result.notes = "Skipped because the event is at capacity and waitlist is not enabled.";
    } else {
      const answers = answerQuestions(questions, profile);
      if (answers.missing.length > 0) {
        result = baseResult(candidate, "blocked", "", 0, event);
        result.notes = `Skipped because required answers need review: ${
          answers.missing.join("; ")
        }`;
      } else {
        const rsvpStatus = stringValue(event.guestAction) === "APPLY"
          ? "PENDING_APPROVAL"
          : "GOING";
        const count = desiredCount(candidate, event);
        if (apply) {
          const response = callableResult(
            await callPartifulFunction(auth, "addGuest", {
              params: {
                eventId: candidate.id,
                rsvp: {
                  name: profile.attendee.name,
                  phoneNumber: profile.attendee.phone_e164,
                  count,
                  plusOnes: [],
                  message: "",
                  status: rsvpStatus,
                  timezone: "America/New_York",
                  questionnaireResponse: {
                    questionnaireVersion: Math.max(
                      0,
                      arrayValue(event.questionnaireVersions).length - 1,
                    ),
                    answers: answers.values,
                  },
                },
              },
            }),
          );
          const responseRecord = recordValue(response);
          result = baseResult(
            candidate,
            "submitted",
            stringValue(responseRecord.status) || rsvpStatus,
            numberValue(responseRecord.count) || count,
            event,
          );
          result.notes = `Submitted via Partiful API; linkedPlusOneFailures=${
            arrayValue(responseRecord.linkedPlusOneFailures).length
          }.`;
        } else {
          result = baseResult(candidate, "dry-run-submit", rsvpStatus, count, event);
          result.notes = "Dry run only; pass --apply to submit.";
        }
      }
    }

    results.push(result);
    console.error(
      `${result.action}: ${candidate.title} (${result.currentStatus || result.rsvpStatus})`,
    );
  }

  await Deno.writeTextFile(RESULTS_JSON, `${JSON.stringify(results, null, 2)}\n`);
  await Deno.writeTextFile(RESULTS_CSV, formatCsv(results));
  if (writeStatus) {
    await upsertStatusRows(results, profile);
  }
  console.log(JSON.stringify(summary(results), null, 2));
}

function desiredCount(candidate: Candidate, event: Record<string, unknown>): number {
  const maxCount = numberValue(event.maxCountPerGuest);
  if (maxCount === 1) return 1;
  if (candidate.id === "hl2AIeWhZ1e2t6LveEGw") return 2;
  return 1;
}

function baseResult(
  candidate: Candidate,
  action: string,
  rsvpStatus: string,
  count: number,
  event: Record<string, unknown>,
): SignupResult {
  return {
    action,
    category: candidate.category,
    count,
    currentStatus: rsvpStatus,
    eventId: candidate.id,
    maxCountPerGuest: stringValue(event.maxCountPerGuest),
    notes: "",
    partifulUrl: candidate.url,
    rsvpStatus,
    title: stringValue(event.title) || candidate.title,
  };
}

function answerQuestions(
  questions: Question[],
  profile: Profile,
): { missing: string[]; values: Record<string, string> } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const question of questions) {
    const answer = answerQuestion(question, profile);
    if (answer) {
      values[question.id] = answer;
    } else if (question.required) {
      missing.push(question.text);
    }
  }
  return { missing, values };
}

function answerQuestion(question: Question, profile: Profile): string {
  const text = normalize(question.text);
  const options = question.options ?? [];
  const defaults = profile.answer_policy.default_required_text_answers;
  const attendee = profile.attendee;

  if (text.includes("how did you hear") || text.includes("who invited")) {
    return "NY Tech Week calendar";
  }
  if (text.includes("data center ecosystem")) {
    return option(options, "Enterprise buyer / IT / procurement");
  }
  if (text.includes("perspective would you bring")) {
    return "Founder/operator building AI products and evaluating the infrastructure constraints around compute, latency, and enterprise adoption.";
  }
  if (text.includes("who would be most valuable")) {
    return "AI infrastructure operators, compute providers, and enterprise leaders working on reliable agent infrastructure.";
  }
  if (text.includes("tell us more about how you use ai")) return defaults.ai_interest;
  if (text.includes("what brings you to this conversation")) {
    return option(options, "Comparing notes on semiconductors+infra");
  }
  if (text.includes("one question or theme")) {
    return "How supply-chain constraints and inference economics will shape practical AI infrastructure over the next few years.";
  }
  if (text.includes("commit to attending")) return option(options, "Yes");
  if (text.includes("photography") || text.includes("recording notice")) {
    return option(options, "I agree");
  }
  if (text.includes("will you be building a voice agent")) return option(options, "Yes");
  if (text.includes("ibm may use my contact data")) return "NO";
  if (text.includes("financing stage")) return option(options, "N/A");
  if (text.includes("raise capital")) return option(options, "N/A");
  if (text.includes("fenwick client")) return option(options, "No");
  if (text.includes("google product")) return option(options, "Gemini Pro");
  if (text.includes("experience level with ai")) return option(options, "Advanced");
  if (text.includes("sign me up to receive")) return option(options, "No");
  if (text.includes("dietary")) return "None";
  if (text === "name" || text.includes("full name") || text.includes("first and last name")) {
    return attendee.name;
  }
  if (text.includes("first name")) return nameParts(attendee.name).first;
  if (text.includes("last name")) return nameParts(attendee.name).last;
  if (text.includes("email")) return attendee.email;
  if (text.includes("linkedin")) return attendee.linkedin;
  if (text.includes("company")) return attendee.company;
  if (text.includes("job title") || text === "title" || text.includes("your role")) {
    return question.type === "select" ? option(options, "Founder") : attendee.title;
  }
  if (text.includes("best describes you")) {
    return option(options, "Founder / operator") || option(options, "Founder");
  }
  if (text.includes("achieve by attending")) return defaults.goals;
  if (text.includes("startup url")) return "";
  if (text.includes("github")) return "";
  return "";
}

function option(options: string[], preferred: string): string {
  const exact = options.find((value) => normalize(value) === normalize(preferred));
  if (exact) return exact;
  return options.find((value) => normalize(value).includes(normalize(preferred))) ?? "";
}

async function currentGuestStatus(
  auth: Awaited<ReturnType<typeof readStoredPartifulAuth>>,
  eventId: string,
): Promise<{ count: number; status: string }> {
  try {
    const response = callableResult(
      await callPartifulFunction(auth, "getCurrentGuest", { params: { eventId } }),
    );
    const guest = recordValue(path(response, ["currentGuest"]));
    return { count: numberValue(guest.count), status: stringValue(guest.status) };
  } catch {
    return { count: 0, status: "" };
  }
}

async function upsertStatusRows(results: SignupResult[], profile: Profile): Promise<void> {
  const existing = parseCsvRecords(await Deno.readTextFile(STATUS_CSV));
  const byUrl = new Map(existing.map((row) => [row.partiful_url, row]));
  for (const result of results) {
    if (result.action !== "submitted" && result.action !== "already-signed") continue;
    byUrl.set(result.partifulUrl, {
      account: profile.attendee.email,
      category: result.category,
      event_name: cleanTitle(result.title),
      next_step: result.rsvpStatus === "GOING"
        ? "Registered; monitor for updates"
        : "Wait for host approval",
      notes: `${result.notes} rsvpStatus=${result.rsvpStatus}; count=${result.count}; plusOne=${
        result.count > 1 ? "TBD" : "none"
      }.`,
      partiful_url: result.partifulUrl,
      status: result.rsvpStatus === "GOING" ? "registered" : "applied",
      venue_revealed: "",
    });
  }
  const header = [
    "event_name",
    "category",
    "partiful_url",
    "status",
    "account",
    "venue_revealed",
    "next_step",
    "notes",
  ];
  await Deno.writeTextFile(
    STATUS_CSV,
    formatCsv(Array.from(byUrl.values()), header),
  );
}

function questionnaireQuestions(event: Record<string, unknown>): Question[] {
  const questionnaire = recordValue(event.questionnaire);
  const questions = arrayValue(questionnaire.questions);
  return questions.map((value) => {
    const record = recordValue(value);
    return {
      id: stringValue(record.id),
      options: arrayValue(record.options).map(String),
      required: Boolean(record.required),
      text: stringValue(record.text),
      type: stringValue(record.type),
    };
  }).filter((question) => question.id && question.text);
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*#NYTechWeek\s*$/i, "")
    .replace(/\s+#NYTechWeek\s*$/i, "")
    .trim();
}

function summary(results: SignupResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((counts, result) => {
    counts[result.action] = (counts[result.action] ?? 0) + 1;
    return counts;
  }, {});
}

function nameParts(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function formatCsv(rows: Record<string, unknown>[], header?: string[]): string {
  if (rows.length === 0) return "";
  const fields = header ?? Object.keys(rows[0]);
  return `${fields.map(csvCell).join(",")}\n${
    rows.map((row) => fields.map((field) => csvCell(row[field] ?? "")).join(",")).join("\n")
  }\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvRecords(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [rawHeader, ...records] = rows;
  if (!rawHeader) return [];
  const header = rawHeader.map((value, index) =>
    index === 0 ? value.replace(/^\ufeff/, "") : value
  );
  return records.filter((record) => record.some(Boolean)).map((record) =>
    Object.fromEntries(header.map((key, index) => [key, record[index] ?? ""]))
  );
}

function path(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    const record = recordValue(current);
    if (!(key in record)) return undefined;
    current = record[key];
  }
  return current;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

if (import.meta.main) {
  await main();
}
