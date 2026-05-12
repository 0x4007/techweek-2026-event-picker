import { chromium, devices, type Page } from "playwright";
import { router } from "../app/server.ts";

type JsonRecord = Record<string, unknown>;

type FakeCard = {
  name: string;
  company: string;
  role: string;
  contact: string;
  website: string;
};

type MockGatewayReply = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

const FIXTURE_CARD_HEIC = fileUrlPath(new URL("./fixtures/IMG_8538.HEIC", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fileUrlPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

async function withApp(test: (baseUrl: string) => Promise<void>) {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    router,
  );
  const addr = server.addr as Deno.NetAddr;
  try {
    await test(`http://127.0.0.1:${addr.port}`);
  } finally {
    await server.shutdown();
  }
}

async function withIphonePage(test: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    ...(devices["iPhone 14"] ?? devices["iPhone 13"]),
    locale: "en-US",
  });
  const page = await context.newPage();
  try {
    await test(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function withEnv(
  values: Record<string, string | null>,
  test: () => Promise<void>,
) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, Deno.env.get(key));
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    await test();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

async function collectConsoleLogs(test: (logs: string[]) => Promise<void>) {
  const original = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await test(logs);
  } finally {
    console.log = original;
  }
}

async function withMockGateway(
  draft: JsonRecord,
  test: (gatewayBodies: JsonRecord[]) => Promise<void>,
) {
  await withMockGatewayReplies([{ status: 200, body: gatewaySuccessBody(draft) }], test);
}

async function withMockGatewayReplies(
  replies: MockGatewayReply[],
  test: (gatewayBodies: JsonRecord[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const gatewayBodies: JsonRecord[] = [];
  let replyIndex = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/chat/completions") || url.endsWith("/responses")) {
      gatewayBodies.push({
        ...(JSON.parse(String(init?.body ?? "{}")) as JsonRecord),
        __url: url,
      });
      const reply = replies[Math.min(replyIndex, replies.length - 1)] ??
        { status: 502, body: "Missing mock gateway reply." };
      replyIndex += 1;
      const headers = new Headers(reply.headers);
      if (!headers.has("content-type") && typeof reply.body !== "string") {
        headers.set("content-type", "application/json");
      }
      return Promise.resolve(
        new Response(
          typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body),
          { status: reply.status ?? 200, headers },
        ),
      );
    }
    return original(input, init);
  }) as typeof fetch;

  try {
    await test(gatewayBodies);
  } finally {
    globalThis.fetch = original;
  }
}

function gatewaySuccessBody(draft: JsonRecord): JsonRecord {
  return {
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(draft) },
        finish_reason: "stop",
      },
    ],
    usage: null,
  };
}

async function writeFakeBusinessCardImage(card: FakeCard): Promise<string> {
  await Deno.mkdir(".codex", { recursive: true });
  const path = `.codex/e2e-card-${crypto.randomUUID()}.svg`;
  await Deno.writeTextFile(path, fakeBusinessCardSvg(card));
  return path;
}

async function writeFixtureBusinessCardJpeg(): Promise<string> {
  await Deno.mkdir(".codex", { recursive: true });
  const jpgPath = `.codex/e2e-fixture-card-${crypto.randomUUID()}.jpg`;
  const command = new Deno.Command("sips", {
    args: ["-s", "format", "jpeg", FIXTURE_CARD_HEIC, "--out", jpgPath],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`Could not convert fixture HEIC to JPEG for Chromium upload: ${stderr}`);
  }
  return jpgPath;
}

async function writeLargeBusinessCardPhoto(card: FakeCard): Promise<string> {
  await Deno.mkdir(".codex", { recursive: true });
  const jpgPath = `.codex/e2e-card-large-${crypto.randomUUID()}.jpg`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 3024, height: 4032 },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(`
      <style>
        body {
          width: 3024px;
          height: 4032px;
          margin: 0;
          display: grid;
          place-items: center;
          background: #f3f5f8;
        }
        svg {
          width: 2660px;
          height: auto;
          box-shadow: 0 44px 110px rgb(16 24 40 / 0.18);
        }
      </style>
      ${fakeBusinessCardSvg(card)}
    `);
    await page.screenshot({ path: jpgPath, type: "jpeg", quality: 88 });
  } finally {
    await browser.close();
  }
  return jpgPath;
}

function fakeBusinessCardSvg(card: FakeCard): string {
  const esc = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="820" viewBox="0 0 1400 820">
  <rect width="1400" height="820" rx="38" fill="#ffffff"/>
  <rect x="52" y="52" width="1296" height="716" rx="28" fill="#f6f8fb" stroke="#101828" stroke-width="5"/>
  <rect x="92" y="92" width="186" height="186" rx="28" fill="#007aff"/>
  <text x="185" y="210" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="86" font-weight="700" fill="#ffffff">AI</text>
  <text x="330" y="170" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="800" fill="#101828">${
    esc(card.name)
  }</text>
  <text x="334" y="248" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700" fill="#007aff">${
    esc(card.role)
  }</text>
  <text x="334" y="320" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="760" fill="#101828">${
    esc(card.company)
  }</text>
  <line x1="92" y1="420" x2="1308" y2="420" stroke="#d0d5dd" stroke-width="4"/>
  <text x="112" y="512" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="650" fill="#344054">${
    esc(card.contact)
  }</text>
  <text x="112" y="592" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="650" fill="#344054">${
    esc(card.website)
  }</text>
  <text x="112" y="684" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="600" fill="#667085">Engineering evidence, agent workflows, DevEx analytics</text>
</svg>`;
}

async function deleteLeadsByName(baseUrl: string, name: string) {
  const schedule = await fetchJson(`${baseUrl}/api/schedule`);
  const state = schedule.state as { leads?: Array<{ id?: string; name?: string }> };
  for (const lead of state.leads ?? []) {
    if (lead.name !== name || !lead.id) continue;
    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "lead_delete", id: lead.id }),
    });
  }
}

async function fetchJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url);
  assert(response.ok, `Expected ${url} to return 2xx, got ${response.status}`);
  return await response.json() as JsonRecord;
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const win = globalThis as unknown as {
      innerWidth: number;
      document: { documentElement: { scrollWidth: number } };
    };
    return {
      scrollWidth: win.document.documentElement.scrollWidth,
      innerWidth: win.innerWidth,
    };
  });
  assert(
    metrics.scrollWidth <= metrics.innerWidth,
    `Expected no horizontal overflow, got scrollWidth=${metrics.scrollWidth}, innerWidth=${metrics.innerWidth}`,
  );
}

async function selectedLeadEventText(page: Page): Promise<string> {
  return await page.locator("[data-lead-event] option:checked").textContent() ?? "";
}

async function leadEventOptionTexts(page: Page): Promise<string[]> {
  return await page.locator("[data-lead-event] option").evaluateAll((options) =>
    options.map((option) => option.textContent ?? "")
  );
}

function jsonLogs(logs: string[], type: string): JsonRecord[] {
  return logs.flatMap((line) => {
    try {
      const value = JSON.parse(line) as JsonRecord;
      return value.type === type ? [value] : [];
    } catch {
      return [];
    }
  });
}

function ocrImageUrl(body: JsonRecord): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const chatMessage = messages[0] as JsonRecord | undefined;
  const chatContent = Array.isArray(chatMessage?.content) ? chatMessage.content : [];
  const chatImage = chatContent.find((part) =>
    part && typeof part === "object" && (part as JsonRecord).type === "image_url"
  ) as JsonRecord | undefined;
  const chatImageUrl = (chatImage?.image_url as JsonRecord | undefined)?.url;
  if (typeof chatImageUrl === "string") return chatImageUrl;

  const input = Array.isArray(body.input) ? body.input : [];
  const message = input[0] as JsonRecord | undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  const image = content.find((part) =>
    part && typeof part === "object" && (part as JsonRecord).type === "input_image"
  ) as JsonRecord | undefined;
  return String(image?.image_url ?? "");
}

async function waitForCardScanResult(page: Page) {
  await page.waitForFunction(
    () => {
      const win = globalThis as unknown as {
        document: { querySelector(selector: string): { textContent?: string | null } | null };
      };
      const status = win.document.querySelector("[data-card-scan-status]")?.textContent ?? "";
      return status.startsWith("Card scanned.") || status.startsWith("Scan failed.");
    },
    null,
    { timeout: 45_000 },
  );
}

Deno.test({
  name: "CRM event selector uses current route event or previous event only",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withIphonePage(async (page) => {
        await page.addInitScript(() => {
          const fixedNow = new Date("2026-06-01T16:30:00-04:00").getTime();
          Date.now = () => fixedNow;
        });
        await page.goto(baseUrl);
        await page.getByRole("button", { name: "CRM" }).click();

        const selected = await selectedLeadEventText(page);
        assert(
          selected.includes("From Vibe Coding to AI-Driven Development"),
          `Expected current event selected, got ${selected}`,
        );

        const options = await leadEventOptionTexts(page);
        assert(options.length > 0, "Expected lead event options.");
        assert(
          options.every((text) =>
            !text.includes("Travel:") && !text.includes("Meal:") && !text.includes("Sleep:")
          ),
          "Expected lead event dropdown to exclude travel, food, and sleep blocks.",
        );
      });

      await withIphonePage(async (page) => {
        await page.addInitScript(() => {
          const fixedNow = new Date("2026-06-01T15:30:00-04:00").getTime();
          Date.now = () => fixedNow;
        });
        await page.goto(baseUrl);
        await page.getByRole("button", { name: "CRM" }).click();

        const selected = await selectedLeadEventText(page);
        assert(
          selected.includes("Beyond the Spec Masterclass"),
          `Expected previous event selected between events, got ${selected}`,
        );
        assert(
          !selected.includes("From Vibe Coding"),
          "Expected between-events fallback to avoid jumping to the next event.",
        );
      });
    });
  },
});

Deno.test({
  name: "iPhone CRM scans a card, saves/deletes the lead, and stays within the viewport",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const leadName = `E2E Lead ${crypto.randomUUID().slice(0, 8)}`;
    const cardPath = await writeFakeBusinessCardImage({
      name: leadName,
      company: "Control Plane Labs",
      role: "Founder",
      contact: "lead@example.com",
      website: "linkedin.com/in/e2e-lead",
    });
    const draft = {
      name: leadName,
      company: "Control Plane Labs",
      role: "Founder",
      email: "lead@example.com",
      phone: "+1 555 101 2020",
      notes: "Asked about agent audit trails. linkedin.com/in/e2e-lead",
      priority: "A",
      followUp: "Send product framing.",
    };

    await withEnv({ UOS_AI_TOKEN: "e2e-token", OPENAI_API_KEY: null }, async () => {
      await withMockGateway(draft, async (gatewayBodies) => {
        await collectConsoleLogs(async (logs) => {
          await withApp(async (baseUrl) => {
            try {
              await withIphonePage(async (page) => {
                await page.goto(baseUrl);
                await page.getByRole("button", { name: "CRM" }).click();
                await assertNoHorizontalOverflow(page);

                const input = page.locator("[data-card-input]");
                assert(
                  await input.getAttribute("capture") === "environment",
                  "Expected card scanner to prefer the rear camera on mobile.",
                );
                assert(
                  await input.getAttribute("hidden") === null,
                  "Expected the card input to use native label activation instead of a hidden JS click target.",
                );

                await input.setInputFiles(cardPath);
                await page.waitForFunction(
                  (expected) => {
                    const win = globalThis as unknown as {
                      document: { querySelector(selector: string): { value?: string } | null };
                    };
                    return win.document.querySelector("[name=name]")?.value === expected;
                  },
                  leadName,
                );

                assert(
                  await page.locator("[name=company]").inputValue() === draft.company,
                  "Expected OCR draft company to prefill.",
                );
                assert(
                  await page.locator("[name=email]").inputValue() === draft.email,
                  "Expected OCR draft email to prefill.",
                );
                assert(
                  await page.locator("[name=phone]").inputValue() === draft.phone,
                  "Expected OCR draft phone to prefill.",
                );
                assert(
                  await page.locator("[name=priority]").inputValue() === "A",
                  "Expected OCR draft priority to prefill.",
                );
                const scanStatus = await page.locator("[data-card-scan-status]").textContent() ??
                  "";
                assert(
                  scanStatus.startsWith("Card scanned. Review and save. ocr_"),
                  `Expected card scan status with debug ID, got ${scanStatus}`,
                );
                const preview = await page.locator("[data-card-preview]").evaluate((element) => {
                  const win = globalThis as unknown as {
                    getComputedStyle(
                      element: unknown,
                    ): { objectFit: string; objectPosition: string };
                  };
                  const image = element as unknown as {
                    hidden: boolean;
                    getBoundingClientRect(): { width: number; height: number };
                  };
                  const style = win.getComputedStyle(image);
                  const rect = image.getBoundingClientRect();
                  return {
                    hidden: image.hidden,
                    objectFit: style.objectFit,
                    objectPosition: style.objectPosition,
                    width: rect.width,
                    height: rect.height,
                  };
                });
                assert(!preview.hidden, "Expected scanned card preview to be visible.");
                assert(
                  preview.objectFit === "contain",
                  `Expected card preview to show the full image, got ${preview.objectFit}`,
                );
                assert(
                  preview.objectPosition === "50% 50%" ||
                    preview.objectPosition.toLowerCase().includes("center"),
                  `Expected centered card preview, got ${preview.objectPosition}`,
                );
                assert(
                  preview.width > 0 && preview.height > 0,
                  "Expected card preview to have a stable preview box.",
                );
                const storedImages = Number(
                  await page.evaluate(`new Promise((resolve, reject) => {
                    const request = indexedDB.open("techweek-card-images", 1);
                    request.addEventListener("success", () => {
                      const database = request.result;
                      const transaction = database.transaction("cards", "readonly");
                      const count = transaction.objectStore("cards").count();
                      count.addEventListener("success", () => {
                        database.close();
                        resolve(Number(count.result));
                      });
                      count.addEventListener(
                        "error",
                        () => reject(count.error || new Error("Could not count stored cards.")),
                      );
                    });
                    request.addEventListener(
                      "error",
                      () => reject(request.error || new Error("Could not open image DB.")),
                    );
                  })`),
                );
                assert(
                  storedImages > 0,
                  "Expected scanned card image to be stored in IndexedDB.",
                );

                await page.getByRole("button", { name: "Save lead" }).click();
                const leadCard = page.locator("article[data-lead]").filter({ hasText: leadName });
                await leadCard.waitFor({ state: "visible" });
                await assertNoHorizontalOverflow(page);

                const schedule = await fetchJson(`${baseUrl}/api/schedule`);
                const leads = (schedule.state as { leads?: Array<JsonRecord> }).leads ?? [];
                const saved = leads.find((lead) => lead.name === leadName);
                assert(saved, "Expected saved lead in app state.");
                assert(
                  String(saved.eventTitle).includes("Beyond the Spec Masterclass"),
                  "Expected saved lead to be associated with the current/default event.",
                );

                await page.getByRole("button", { name: `Delete ${leadName}` }).click();
                await leadCard.waitFor({ state: "detached" });
              });
            } finally {
              await deleteLeadsByName(baseUrl, leadName);
              await Deno.remove(cardPath).catch(() => {});
            }
          });

          assert(gatewayBodies.length === 1, "Expected one gateway OCR request.");
          assert(
            String(gatewayBodies[0].__url).endsWith("/chat/completions"),
            "Expected OCR to use the chat-completions image endpoint.",
          );
          assert(
            gatewayBodies[0].reasoning_effort === null,
            "Expected OCR to disable reasoning for the chat-completions call.",
          );
          const ocrLogs = jsonLogs(logs, "ocr_context");
          assert(ocrLogs.length === 1, "Expected OCR prompt context to be logged.");
          const ocrStartLogs = jsonLogs(logs, "ocr_start");
          assert(ocrStartLogs.length === 1, "Expected OCR start log.");
          assert(jsonLogs(logs, "ocr_upstream").length === 1, "Expected OCR upstream log.");
          assert(jsonLogs(logs, "ocr_success").length === 1, "Expected OCR success log.");
          assert(
            jsonLogs(logs, "client_log").some((log) => log.event === "ocr_image_stored"),
            "Expected client log for local IndexedDB image storage.",
          );
          const imagePrepared = jsonLogs(logs, "client_log").find((log) =>
            log.event === "ocr_image_prepared"
          );
          const imageMetadata = (imagePrepared?.payload as JsonRecord | undefined)
            ?.image as JsonRecord | undefined;
          assert(imageMetadata, "Expected client OCR image preparation metadata.");
          assert(
            imageMetadata.conversion === "canvas_auto_edge_crop",
            "Expected automatic edge-crop OCR metadata.",
          );
          assert(
            Number(imageMetadata.compressedDataUrlCharacters) <=
              Number(imageMetadata.targetDataUrlCharacters),
            `Expected OCR image payload under target, got ${imageMetadata.compressedDataUrlCharacters} chars.`,
          );
          assert(
            Array.isArray(imageMetadata.attempts) && imageMetadata.attempts.length === 3,
            "Expected OCR logs to include automatic crop and full-frame attempts.",
          );
          assert(
            typeof (imageMetadata.crop as JsonRecord | undefined)?.method === "string",
            "Expected OCR metadata to include automatic crop diagnostics.",
          );
          const loggedBody = ocrLogs[0].requestBody as JsonRecord;
          assert(
            String(ocrStartLogs[0].eventTitle).includes("Beyond the Spec"),
            "Expected OCR start log to include the selected event context.",
          );
          assert(
            JSON.stringify(loggedBody).includes("<") &&
              JSON.stringify(loggedBody).includes("chars>"),
            "Expected OCR log to redact raw image data while preserving image metadata.",
          );
        });
      });
    });
  },
});

Deno.test({
  name: "iPhone CRM scans the fixture card photo through the UI with local OCR fallback",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const cardPath = await writeFixtureBusinessCardJpeg();
    const leadName = `Fixture Lead ${crypto.randomUUID().slice(0, 8)}`;
    const draft = {
      name: leadName,
      company: "Fixture Company",
      role: "Chair",
      email: "fixture@example.com",
      phone: "+1 555 333 4444",
      notes: "Fixture card OCR path.",
      priority: "A",
      followUp: "Follow up from fixture card.",
    };

    await withEnv({ UOS_AI_TOKEN: "e2e-token", OPENAI_API_KEY: null }, async () => {
      await withMockGatewayReplies([
        { status: 502, body: "Upstream error" },
        { status: 200, body: gatewaySuccessBody(draft) },
      ], async (gatewayBodies) => {
        await collectConsoleLogs(async (logs) => {
          await withApp(async (baseUrl) => {
            try {
              await withIphonePage(async (page) => {
                await page.goto(baseUrl);
                await page.getByRole("button", { name: "CRM" }).click();
                await page.locator("[data-card-input]").setInputFiles(cardPath);
                await page.waitForFunction(
                  (expected) => {
                    const win = globalThis as unknown as {
                      document: { querySelector(selector: string): { value?: string } | null };
                    };
                    return win.document.querySelector("[name=name]")?.value === expected;
                  },
                  leadName,
                );

                assert(
                  await page.locator("[name=role]").inputValue() === "Chair",
                  "Expected fixture OCR draft role to prefill.",
                );
                assert(
                  await page.locator("[name=company]").inputValue() === "Fixture Company",
                  "Expected fixture OCR draft company to prefill.",
                );
                assert(
                  await page.locator("[name=email]").inputValue() === "fixture@example.com",
                  "Expected fixture OCR draft email to prefill.",
                );
                assert(
                  await page.locator("[name=phone]").inputValue() === "+1 555 333 4444",
                  "Expected fixture OCR draft phone to prefill.",
                );
                const preview = await page.locator("[data-card-preview]").evaluate((element) => {
                  const win = globalThis as unknown as {
                    getComputedStyle(element: unknown): { objectFit: string };
                  };
                  const image = element as unknown as { hidden: boolean };
                  return { hidden: image.hidden, objectFit: win.getComputedStyle(image).objectFit };
                });
                assert(!preview.hidden, "Expected fixture card preview to be visible.");
                assert(
                  preview.objectFit === "contain",
                  `Expected fixture preview to contain the full image, got ${preview.objectFit}`,
                );
              });
            } finally {
              await deleteLeadsByName(baseUrl, leadName);
              await Deno.remove(cardPath).catch(() => {});
            }
          });

          assert(gatewayBodies.length === 2, "Expected fixture OCR image call plus text fallback.");
          const imageUrl = ocrImageUrl(gatewayBodies[0]);
          assert(
            imageUrl.startsWith("data:image/jpeg;base64,"),
            "Expected fixture OCR to send a JPEG data URL.",
          );
          const imagePrepared = jsonLogs(logs, "client_log").find((log) =>
            log.event === "ocr_image_prepared"
          );
          const imageMetadata = (imagePrepared?.payload as JsonRecord | undefined)
            ?.image as JsonRecord | undefined;
          assert(imageMetadata, "Expected fixture image preparation metadata.");
          assert(
            Number(imageMetadata.originalDataUrlCharacters) > 1_000_000,
            "Expected the fixture to exercise the large phone-photo crop path.",
          );
          assert(
            imageMetadata.ocrSource === "canvas_auto_edge_crop",
            "Expected fixture OCR to use the automatic edge-cropped JPEG payload.",
          );
          assert(
            imageMetadata.sourceExifOrientation === 6,
            `Expected fixture JPEG EXIF orientation 6, got ${imageMetadata.sourceExifOrientation}.`,
          );
          assert(
            imageMetadata.preferredRotationDegrees === 270,
            `Expected fixture OCR to prefer 270-degree rotation, got ${imageMetadata.preferredRotationDegrees}.`,
          );
          const requestAttempts = jsonLogs(logs, "client_log").filter((log) =>
            log.event === "ocr_request_attempt"
          );
          assert(requestAttempts.length === 1, "Expected one browser OCR request.");
          const firstAttemptImage = (requestAttempts[0]?.payload as JsonRecord | undefined)
            ?.image as JsonRecord | undefined;
          assert(
            typeof firstAttemptImage?.crop === "object",
            "Expected the first fixture OCR request to include crop diagnostics.",
          );
          assert(
            jsonLogs(logs, "ocr_local_orientation_success").length === 1,
            "Expected local OCR orientation selection.",
          );
          assert(
            jsonLogs(logs, "ocr_upstream").length === 1,
            "Expected one image gateway OCR call.",
          );
          assert(
            jsonLogs(logs, "ocr_text_fallback_upstream").length === 1,
            "Expected one text fallback gateway OCR call.",
          );
        });
      });
    });
  },
});

Deno.test({
  name: "iPhone OCR retries adjusted payloads after a gateway 502 and splits email and phone",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const leadName = `Retry Lead ${crypto.randomUUID().slice(0, 8)}`;
    const cardPath = await writeLargeBusinessCardPhoto({
      name: leadName,
      company: "Retry Systems",
      role: "VP Engineering",
      contact: "retry@example.com",
      website: "linkedin.com/in/retry-lead",
    });
    const draft = {
      name: leadName,
      company: "Retry Systems",
      role: "VP Engineering",
      email: "retry@example.com",
      phone: "+1 555 909 8080",
      notes: "linkedin.com/in/retry-lead",
    };

    await withEnv({ UOS_AI_TOKEN: "e2e-token", OPENAI_API_KEY: null }, async () => {
      await withMockGatewayReplies(
        [
          { status: 502, body: "Upstream error" },
          { status: 200, body: gatewaySuccessBody(draft) },
        ],
        async (gatewayBodies) => {
          await collectConsoleLogs(async (logs) => {
            await withApp(async (baseUrl) => {
              try {
                await withIphonePage(async (page) => {
                  await page.goto(baseUrl);
                  await page.getByRole("button", { name: "CRM" }).click();
                  await page.locator("[data-card-input]").setInputFiles(cardPath);
                  await page.waitForFunction(
                    (expected) => {
                      const win = globalThis as unknown as {
                        document: { querySelector(selector: string): { value?: string } | null };
                      };
                      return win.document.querySelector("[name=name]")?.value === expected;
                    },
                    leadName,
                  );

                  const status = await page.locator("[data-card-scan-status]").textContent() ??
                    "";
                  assert(
                    status.startsWith("Card scanned. Review and save. ocr_"),
                    `Expected successful retry status, got ${status}`,
                  );
                  assert(
                    await page.locator("[name=email]").inputValue() === "retry@example.com",
                    "Expected retry OCR email to prefill.",
                  );
                  assert(
                    await page.locator("[name=phone]").inputValue() === "+1 555 909 8080",
                    "Expected retry OCR phone to prefill.",
                  );
                  assert(
                    await page.locator("[name=priority]").inputValue() === "A",
                    "Expected VP Engineering role to infer priority A when OCR omits priority.",
                  );
                });
              } finally {
                await deleteLeadsByName(baseUrl, leadName);
                await Deno.remove(cardPath).catch(() => {});
              }
            });

            assert(gatewayBodies.length === 2, `Expected one retry, got ${gatewayBodies.length}`);
            assert(
              gatewayBodies.every((body) => String(body.__url).endsWith("/chat/completions")),
              "Expected every OCR retry to use the chat-completions image endpoint.",
            );
            const imageUrls = gatewayBodies.map(ocrImageUrl);
            assert(
              imageUrls.every((url) => url.startsWith("data:image/jpeg;base64,")),
              "Expected gateway OCR calls to send JPEG data URLs.",
            );
            assert(
              imageUrls[0].length > 45_000,
              `Expected first OCR payload to preserve readable detail, got ${imageUrls[0].length}`,
            );
            assert(
              imageUrls[1] !== imageUrls[0],
              "Expected retry payload to use an adjusted OCR image candidate.",
            );

            const clientLogs = jsonLogs(logs, "client_log");
            const attempts = clientLogs.filter((log) => log.event === "ocr_request_attempt");
            assert(attempts.length === 2, `Expected two OCR attempts, got ${attempts.length}`);
            assert(
              String((attempts[1].payload as JsonRecord).attemptRequestId).endsWith("_r1"),
              "Expected retry request id to carry the _r1 suffix.",
            );
            assert(
              clientLogs.some((log) => log.event === "ocr_retry_after_failure"),
              "Expected retry-after-failure client log.",
            );

            const upstreamLogs = jsonLogs(logs, "ocr_upstream");
            assert(
              upstreamLogs.length === 2 &&
                upstreamLogs[0].status === 502 &&
                upstreamLogs[1].status === 200,
              `Expected upstream 502 then 200, got ${JSON.stringify(upstreamLogs)}`,
            );
            assert(jsonLogs(logs, "ocr_success").length === 1, "Expected one OCR success log.");
          });
        },
      );
    });
  },
});

Deno.test({
  name: "iPhone OCR does not retry gateway rate limits",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const cardPath = await writeFakeBusinessCardImage({
      name: "Rate Limit Lead",
      company: "Quota Systems",
      role: "Founder",
      contact: "quota@example.com",
      website: "linkedin.com/in/quota-lead",
    });

    await withEnv({ UOS_AI_TOKEN: "e2e-token", OPENAI_API_KEY: null }, async () => {
      await withMockGatewayReplies(
        [
          {
            status: 429,
            body: {
              error: {
                message: "Usage limit exceeded (50/50).",
                type: "invalid_request_error",
                code: "rate_limit_exceeded",
              },
            },
          },
        ],
        async (gatewayBodies) => {
          await collectConsoleLogs(async (logs) => {
            await withApp(async (baseUrl) => {
              try {
                await withIphonePage(async (page) => {
                  await page.goto(baseUrl);
                  await page.getByRole("button", { name: "CRM" }).click();
                  await page.locator("[data-card-input]").setInputFiles(cardPath);
                  await waitForCardScanResult(page);

                  const status = await page.locator("[data-card-scan-status]").textContent() ??
                    "";
                  const error = await page.locator("[data-lead-error]").textContent() ?? "";
                  assert(
                    status.startsWith("Scan failed. ocr_"),
                    `Expected scan failure status, got ${status}`,
                  );
                  assert(
                    /rate limit exceeded/i.test(error),
                    `Expected rate-limit error message, got ${error}`,
                  );
                });
              } finally {
                await Deno.remove(cardPath).catch(() => {});
              }
            });

            assert(
              gatewayBodies.length === 1,
              `Expected no retry on 429, got ${gatewayBodies.length}`,
            );
            const clientLogs = jsonLogs(logs, "client_log");
            assert(
              clientLogs.filter((log) => log.event === "ocr_request_attempt").length === 1,
              "Expected exactly one OCR request attempt.",
            );
            assert(
              !clientLogs.some((log) => log.event === "ocr_retry_after_failure"),
              "Expected no retry-after-failure log for rate limits.",
            );
            const responseLog = clientLogs.find((log) => log.event === "ocr_response");
            assert(
              (responseLog?.payload as JsonRecord | undefined)?.status === 429,
              `Expected client OCR response status 429, got ${JSON.stringify(responseLog)}`,
            );
          });
        },
      );
    });
  },
});

Deno.test({
  name: "iPhone OCR rejects empty drafts instead of showing scanned success",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const cardPath = await writeFakeBusinessCardImage({
      name: "Empty Draft Lead",
      company: "Null Systems",
      role: "Founder",
      contact: "empty@example.com",
      website: "linkedin.com/in/empty-draft",
    });
    const emptyDraft = { name: null, company: null, role: null, email: null, phone: null };

    await withEnv({ UOS_AI_TOKEN: "e2e-token", OPENAI_API_KEY: null }, async () => {
      await withMockGatewayReplies(
        [
          { status: 200, body: gatewaySuccessBody(emptyDraft) },
          { status: 200, body: gatewaySuccessBody(emptyDraft) },
          { status: 200, body: gatewaySuccessBody(emptyDraft) },
        ],
        async (gatewayBodies) => {
          await collectConsoleLogs(async (logs) => {
            await withApp(async (baseUrl) => {
              try {
                await withIphonePage(async (page) => {
                  await page.goto(baseUrl);
                  await page.getByRole("button", { name: "CRM" }).click();
                  await page.locator("[data-card-input]").setInputFiles(cardPath);
                  await waitForCardScanResult(page);

                  const status = await page.locator("[data-card-scan-status]").textContent() ??
                    "";
                  const error = await page.locator("[data-lead-error]").textContent() ?? "";
                  assert(
                    status.startsWith("Scan failed. ocr_"),
                    `Expected empty OCR draft to fail, got ${status}`,
                  );
                  assert(
                    /did not find any lead fields/i.test(error),
                    `Expected empty draft error, got ${error}`,
                  );
                  assert(
                    await page.locator("[name=name]").inputValue() === "",
                    "Expected empty draft not to fill the name field.",
                  );
                });
              } finally {
                await Deno.remove(cardPath).catch(() => {});
              }
            });

            assert(
              gatewayBodies.length === 3,
              "Expected empty OCR draft to exhaust automatic crop retries.",
            );
            assert(
              jsonLogs(logs, "ocr_error").some((log) => log.stage === "empty_draft"),
              "Expected server empty-draft error log.",
            );
            assert(
              !jsonLogs(logs, "ocr_success").length,
              "Expected no OCR success log for empty drafts.",
            );
          });
        },
      );
    });
  },
});

Deno.test({
  name: "live gateway OCR extracts the fixture business card photo",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    if (Deno.env.get("RUN_LIVE_OCR_E2E") !== "1") {
      console.warn("Skipping live OCR E2E. Set RUN_LIVE_OCR_E2E=1 to use gateway quota.");
      return;
    }
    if (!Deno.env.get("UOS_AI_TOKEN") && !Deno.env.get("OPENAI_API_KEY")) {
      console.warn("Skipping live OCR E2E because no gateway token is configured.");
      return;
    }

    const cardPath = await writeFixtureBusinessCardJpeg();

    await collectConsoleLogs(async (logs) => {
      await withApp(async (baseUrl) => {
        try {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            await page.getByRole("button", { name: "CRM" }).click();
            await page.locator("[data-card-input]").setInputFiles(cardPath);
            await page.waitForFunction(
              () => {
                const win = globalThis as unknown as {
                  document: {
                    querySelector(selector: string): { textContent?: string | null } | null;
                  };
                };
                const status = win.document.querySelector("[data-card-scan-status]")?.textContent ??
                  "";
                return status.startsWith("Card scanned.") || status.startsWith("Scan failed.");
              },
              null,
              { timeout: 75_000 },
            );

            const status = await page.locator("[data-card-scan-status]").textContent() ?? "";
            const error = await page.locator("[data-lead-error]").textContent() ?? "";
            assert(
              status.startsWith("Card scanned."),
              `Expected live OCR success, got: ${status} ${error}`,
            );

            const name = await page.locator("[name=name]").inputValue();
            const company = await page.locator("[name=company]").inputValue();
            const role = await page.locator("[name=role]").inputValue();
            const email = await page.locator("[name=email]").inputValue();
            const phone = await page.locator("[name=phone]").inputValue();

            assert(
              `${name} ${company} ${role} ${email} ${phone}`.trim().length > 0,
              "Expected live fixture OCR to extract at least one visible card field.",
            );
            assert(
              /gfgs|global/i.test(`${name} ${company} ${email}`),
              `Expected live fixture OCR to identify the visible organization, got ${
                JSON.stringify({ name, company, email })
              }`,
            );
            assert(
              /chair/i.test(`${role} ${company} ${email}`),
              `Expected live fixture OCR to identify the visible role, got ${
                JSON.stringify({ role, company, email })
              }`,
            );
            assert(
              /@/.test(email) || /\d{3}/.test(phone),
              `Expected live fixture OCR email or phone detail, got ${
                JSON.stringify({ email, phone })
              }`,
            );
          });
        } finally {
          await Deno.remove(cardPath).catch(() => {});
        }
      });

      const upstream = jsonLogs(logs, "ocr_upstream").at(-1);
      assert(upstream?.ok === true, "Expected live OCR upstream call to succeed.");
      assert(jsonLogs(logs, "ocr_success").length > 0, "Expected live OCR success log.");
    });
  },
});

Deno.test({
  name: "agent drawer sends with Enter, clears the composer, and exposes assistant copy controls",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withEnv({ UOS_AI_TOKEN: null, OPENAI_API_KEY: null }, async () => {
      await collectConsoleLogs(async () => {
        await withApp(async (baseUrl) => {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            await page.locator("[data-chat-fab]").click();
            await assertNoHorizontalOverflow(page);

            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("What should I do next?");
            await page.keyboard.press("Enter");

            await page.locator('[data-message="user"]').filter({
              hasText: "What should I do next?",
            }).waitFor();
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelectorAll(selector: string): ArrayLike<{ textContent?: string | null }>;
                };
              };
              return Array.from(win.document.querySelectorAll('[data-message="assistant"]')).some((
                item,
              ) => item.textContent?.includes("Service Unavailable"));
            });

            assert(
              await textarea.inputValue() === "",
              "Expected the composer to clear after keyboard submit.",
            );
            assert(
              await page.locator('form[data-chat-form] button[type="submit"]').isDisabled(),
              "Expected the send button to disable when the composer is empty.",
            );
            assert(
              await page.locator('[data-message="assistant"] [data-message-tools] button').last()
                .getAttribute("aria-label") === "Copy response",
              "Expected assistant messages to expose a copy response control.",
            );
            await assertNoHorizontalOverflow(page);
          });
        });
      });
    });
  },
});

Deno.test({
  name: "event Ask reopens the cached thread when the prompt context fingerprint is unchanged",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withEnv({ UOS_AI_TOKEN: null, OPENAI_API_KEY: null }, async () => {
      await withApp(async (baseUrl) => {
        await withIphonePage(async (page) => {
          await page.goto(baseUrl);

          const eventCard = page.locator('[data-entry][data-type="event"]').first();
          await eventCard.waitFor();
          const eventId = await eventCard.getAttribute("data-entry");
          assert(eventId, "Expected an event card id.");

          await eventCard.click();
          await page.locator("[data-event-actions] button").filter({ hasText: "Ask" }).click();
          await page.locator('[data-message="user"]').filter({
            hasText: "Give me event-specific coaching",
          }).waitFor();

          const firstSession = await page.evaluate(() => {
            const activeId = localStorage.getItem("techweek-chat-active-id") || "";
            const sessions = JSON.parse(localStorage.getItem("techweek-chat-history") || "[]");
            const active = sessions.find((session: { id?: string }) => session.id === activeId);
            return {
              activeId,
              sessionCount: sessions.length,
              messageCount: active?.messages?.length || 0,
              cacheKey: active?.meta?.cacheKey || "",
              kind: active?.meta?.kind || "",
            };
          });

          assert(
            firstSession.activeId.startsWith("event-chat-"),
            "Expected deterministic event chat id.",
          );
          assert(
            firstSession.cacheKey === firstSession.activeId,
            "Expected cached session key to match active session id.",
          );
          assert(
            firstSession.kind === "event_coaching",
            "Expected event coaching session metadata.",
          );
          assert(
            firstSession.messageCount === 1,
            "Expected the first event chat to persist one user prompt.",
          );

          await page.locator("[data-chat-close]").click();
          await page.locator(`[data-entry="${eventId}"]`).click();
          await page.locator("[data-event-actions] button").filter({ hasText: "Ask" }).click();

          await page.waitForFunction(
            (expectedId) => localStorage.getItem("techweek-chat-active-id") === expectedId,
            firstSession.activeId,
          );

          const secondSession = await page.evaluate(() => {
            const win = globalThis as unknown as {
              document: {
                querySelectorAll(selector: string): ArrayLike<{ textContent?: string | null }>;
              };
            };
            const activeId = localStorage.getItem("techweek-chat-active-id") || "";
            const sessions = JSON.parse(localStorage.getItem("techweek-chat-history") || "[]");
            const userMessages = Array.from(win.document.querySelectorAll('[data-message="user"]'))
              .map((item) => item.textContent || "");
            return { activeId, sessionCount: sessions.length, userMessages };
          });

          assert(
            secondSession.activeId === firstSession.activeId,
            "Expected the cached event chat to reopen.",
          );
          assert(
            secondSession.sessionCount === firstSession.sessionCount,
            "Expected no duplicate event chat session.",
          );
          assert(
            secondSession.userMessages.filter((text) =>
              text.includes("Give me event-specific coaching")
            ).length === 1,
            "Expected the repeated Ask click to avoid sending a duplicate prompt.",
          );
        });
      });
    });
  },
});

Deno.test({
  name: "chat history can delete the active chat and return to an empty thread",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withEnv({ UOS_AI_TOKEN: null, OPENAI_API_KEY: null }, async () => {
      await collectConsoleLogs(async () => {
        await withApp(async (baseUrl) => {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            await page.locator("[data-chat-fab]").click();

            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("Save this chat so I can delete it.");
            await page.keyboard.press("Enter");
            await page.locator('[data-message="user"]').filter({
              hasText: "Save this chat so I can delete it.",
            }).waitFor();

            const beforeDelete = await page.evaluate(() => ({
              activeId: localStorage.getItem("techweek-chat-active-id") || "",
              sessionCount:
                JSON.parse(localStorage.getItem("techweek-chat-history") || "[]").length,
            }));

            assert(beforeDelete.sessionCount === 1, "Expected one saved chat before deletion.");

            await page.locator("[data-chat-history-toggle]").click();
            await page.locator("[data-chat-history-delete]").first().click();
            await page.waitForFunction(() =>
              JSON.parse(localStorage.getItem("techweek-chat-history") || "[]").length === 0
            );

            const afterDelete = await page.evaluate(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelectorAll(selector: string): ArrayLike<{ textContent?: string | null }>;
                };
              };
              return {
                activeId: localStorage.getItem("techweek-chat-active-id") || "",
                currentMessages: JSON.parse(localStorage.getItem("techweek-chat") || "[]").length,
                sessionCount:
                  JSON.parse(localStorage.getItem("techweek-chat-history") || "[]").length,
                userMessages:
                  Array.from(win.document.querySelectorAll('[data-message="user"]')).length,
              };
            });

            assert(
              afterDelete.activeId !== beforeDelete.activeId,
              "Expected a fresh active chat id.",
            );
            assert(afterDelete.currentMessages === 0, "Expected current chat storage to be empty.");
            assert(afterDelete.sessionCount === 0, "Expected chat history storage to be empty.");
            assert(afterDelete.userMessages === 0, "Expected the visible deleted chat to clear.");
          });
        });
      });
    });
  },
});

Deno.test({
  name: "agent loading dots do not change message height and response headers have section spacing",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withIphonePage(async (page) => {
        await page.goto(baseUrl);
        await page.locator("[data-chat-fab]").click();
        await page.waitForTimeout(180);

        const metrics = await page.evaluate(`
          (async () => {
            await document.fonts?.ready;
            const log = document.querySelector("[data-chat-log]");
            log.replaceChildren();

            const streaming = document.createElement("section");
            streaming.dataset.message = "assistant";
            streaming.dataset.streaming = "true";
            const streamingBody = document.createElement("div");
            streamingBody.dataset.messageContent = "";
            streamingBody.innerHTML = "<p>Thinking</p>";
            streaming.append(streamingBody);
            log.append(streaming);

            const rich = document.createElement("section");
            rich.dataset.message = "assistant";
            const richBody = document.createElement("div");
            richBody.dataset.messageContent = "";
            richBody.innerHTML = "<p>Intro</p><h3>Next step</h3><p>Details</p>";
            rich.append(richBody);
            log.append(rich);

            const paragraph = streamingBody.querySelector("p");
            const heading = richBody.querySelector("h3");
            const intro = richBody.querySelector("p");
            const sample = () => ({
              messageHeight: streaming.getBoundingClientRect().height,
              paragraphHeight: paragraph.getBoundingClientRect().height,
              paragraphTop: paragraph.getBoundingClientRect().top,
              dotWhiteSpace: getComputedStyle(paragraph, "::after").whiteSpace,
              dotWidth: getComputedStyle(paragraph, "::after").width,
              dotVerticalAlign: getComputedStyle(paragraph, "::after").verticalAlign,
              headingGap: heading.getBoundingClientRect().top - intro.getBoundingClientRect().bottom,
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth,
            });

            return new Promise((resolve) => {
              const samples = [sample()];
              setTimeout(() => samples.push(sample()), 260);
              setTimeout(() => samples.push(sample()), 520);
              setTimeout(() => samples.push(sample()), 780);
              setTimeout(() => resolve(samples), 940);
            });
          })()
        `) as Array<{
          messageHeight: number;
          paragraphHeight: number;
          paragraphTop: number;
          dotWhiteSpace: string;
          dotWidth: string;
          dotVerticalAlign: string;
          headingGap: number;
          scrollWidth: number;
          innerWidth: number;
        }>;

        const variance = (values: number[]) => Math.max(...values) - Math.min(...values);
        assert(
          variance(metrics.map((item) => item.messageHeight)) < 0.5,
          "Expected dot animation to keep message height stable.",
        );
        assert(
          variance(metrics.map((item) => item.paragraphHeight)) < 0.5 &&
            variance(metrics.map((item) => item.paragraphTop)) < 0.5,
          "Expected dot animation to keep Thinking text stable.",
        );
        assert(
          metrics.every((item) =>
            item.dotWhiteSpace === "nowrap" && item.dotVerticalAlign === "baseline"
          ),
          "Expected dot pseudo-element to align without wrapping.",
        );
        assert(
          metrics.every((item) => item.headingGap >= 14),
          "Expected response headings to have extra spacing above them.",
        );
        assert(
          metrics.every((item) => item.scrollWidth <= item.innerWidth),
          "Expected injected agent content to stay within the viewport.",
        );
      });
    });
  },
});

Deno.test({
  name: "agent stream invocation logs the full prompt context before gateway auth",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withEnv({ UOS_AI_TOKEN: null, OPENAI_API_KEY: null }, async () => {
      await collectConsoleLogs(async (logs) => {
        await withApp(async (baseUrl) => {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            const status = await page.evaluate(async () => {
              const response = await fetch("/api/agent/stream", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  prompt: "E2E prompt logging check",
                  messages: [],
                  clientContext: {
                    localText: "5/11/2026, 7:30:00 PM",
                    localIso: "2026-05-11T23:30:00.000Z",
                    timeZone: "America/New_York",
                    isSecureContext: true,
                    locationStatus: "available",
                    coordinates: {
                      latitude: 40.7084,
                      longitude: -74.0057,
                      accuracyMeters: 20,
                      capturedAt: "2026-05-11T23:30:00.000Z",
                    },
                    viewport: { width: 390, height: 844, devicePixelRatio: 3 },
                  },
                }),
              });
              return response.status;
            });
            assert(status === 503, `Expected missing-token response after logging, got ${status}.`);
          });
        });

        const agentLogs = jsonLogs(logs, "agent_context");
        assert(agentLogs.length === 1, "Expected one agent prompt context log.");
        const requestBody = agentLogs[0].requestBody as { messages?: Array<JsonRecord> };
        const serialized = JSON.stringify(requestBody);
        assert(serialized.includes("E2E prompt logging check"), "Expected prompt in context log.");
        assert(serialized.includes("gps=40.7084,-74.0057"), "Expected GPS context in log.");
        assert(serialized.includes("All actual events and data"), "Expected event context in log.");
        assert(serialized.includes("Captured CRM leads"), "Expected CRM context in log.");

        const utilizationLogs = jsonLogs(logs, "agent_context_utilization");
        assert(utilizationLogs.length === 1, "Expected one agent context utilization log.");
        const utilizationLog = utilizationLogs[0] as {
          modelContext?: JsonRecord;
          utilization?: JsonRecord;
        };
        assert(
          utilizationLog.modelContext?.source === "codex_client_cache_fallback",
          "Expected Codex client cache fallback when gateway metadata is absent.",
        );
        assert(
          utilizationLog.modelContext?.contextWindowTokens === 272_000,
          "Expected 272K raw context override for the Codex/proxy gateway.",
        );
        assert(
          utilizationLog.modelContext?.effectiveContextWindowTokens === 258_400,
          "Expected 258.4K effective context budget for client-side calibration.",
        );
        assert(
          utilizationLog.utilization?.tokenizer &&
            Number(utilizationLog.utilization?.estimatedInputTokens) > 0,
          "Expected tokenizer and estimated input token count in utilization log.",
        );
      });
    });
  },
});
