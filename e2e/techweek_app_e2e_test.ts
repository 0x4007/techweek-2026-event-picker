import { chromium, devices, type Page, type Route } from "playwright";
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

const FIXTURE_CARD_JPEG = fileUrlPath(new URL("./fixtures/IMG_8538.jpg", import.meta.url));

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

async function withDesktopPage(test: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1040, height: 760 },
    deviceScaleFactor: 1,
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

async function waitForTestCondition(
  condition: () => boolean,
  message: string,
  timeoutMs = 2500,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
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
      const responseBody = reply.body instanceof ReadableStream
        ? reply.body
        : typeof reply.body === "string"
        ? reply.body
        : JSON.stringify(reply.body);
      return Promise.resolve(
        new Response(
          responseBody,
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

function gatewayStreamingStream(text: string, delayMs = 6): ReadableStream<Uint8Array> {
  return gatewayStreamingEventStream(gatewayStreamingEvents(text), delayMs);
}

function gatewayStreamingEventStream(
  events: string[],
  delayMs = 6,
  onEmit?: (index: number) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= events.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(events[index]));
      onEmit?.(index);
      index += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
  });
}

function gatewayStreamingEvents(text: string): string[] {
  const deltas = text
    .split(/(\n\n)/)
    .filter(Boolean)
    .map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
  return [...deltas, "data: [DONE]\n\n"];
}

function gatewayDeltaEvent(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

async function writeFakeBusinessCardImage(card: FakeCard): Promise<string> {
  await Deno.mkdir(".codex", { recursive: true });
  const path = `.codex/e2e-card-${crypto.randomUUID()}.svg`;
  await Deno.writeTextFile(path, fakeBusinessCardSvg(card));
  return path;
}

function writeFixtureBusinessCardJpeg(): string {
  return FIXTURE_CARD_JPEG;
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

type DevAgentMockRequest = {
  body: JsonRecord;
  method: string;
  url: URL;
};

type DevAgentMockResponse = {
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
};

async function routeDevAgentApi(
  page: Page,
  baseUrl: string,
  handler: (request: DevAgentMockRequest) => DevAgentMockResponse | Promise<DevAgentMockResponse>,
) {
  const origin = new URL(baseUrl).origin;
  const corsHeaders = {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, accept",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
  const fulfill = async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }

    const rawBody = request.postData() || "";
    let body: JsonRecord = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody) as JsonRecord;
      } catch {
        body = {};
      }
    }

    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.startsWith("/__pi-agent/")) {
      requestUrl.pathname = requestUrl.pathname.replace("/__pi-agent", "");
    }
    const response = await handler({
      body,
      method: request.method(),
      url: requestUrl,
    });
    const responseBody = typeof response.body === "string"
      ? response.body
      : JSON.stringify(response.body ?? {});
    await route.fulfill({
      status: response.status ?? 200,
      headers: {
        ...corsHeaders,
        "content-type": typeof response.body === "string" ? "text/plain" : "application/json",
        ...(response.headers || {}),
      },
      body: responseBody,
    });
  };
  await page.route("https://agent.pavlovcik.com/**", fulfill);
  await page.route(`${origin}/__pi-agent/**`, fulfill);
}

async function installDevAgentEventSourceMock(page: Page, events: JsonRecord[]) {
  await page.addInitScript((streamEvents) => {
    type SourceRecord = { closed: boolean; url: string; withCredentials: boolean };
    const win = globalThis as unknown as {
      EventSource: unknown;
      __devEventSources: SourceRecord[];
    };
    win.__devEventSources = [];
    class MockEventSource extends EventTarget {
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      record: SourceRecord;

      constructor(url: string, options?: { withCredentials?: boolean }) {
        super();
        this.record = {
          closed: false,
          url: String(url),
          withCredentials: Boolean(options?.withCredentials),
        };
        win.__devEventSources.push(this.record);
        setTimeout(() => {
          const open = new Event("open");
          this.onopen?.(open);
          this.dispatchEvent(open);
          for (const event of streamEvents as JsonRecord[]) {
            const type = String(event.type || "message");
            const message = new MessageEvent(type, {
              data: JSON.stringify(event),
            });
            this.dispatchEvent(message);
            if (type === "message") this.onmessage?.(message);
          }
        }, 20);
      }

      close() {
        this.record.closed = true;
      }
    }
    win.EventSource = MockEventSource;
  }, events);
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
  name: "app ignores malformed hash navigation while loading agenda",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withIphonePage(async (page) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        await page.goto(`${baseUrl}/#%`);
        const nextTitle = page.locator("[data-next-title]");
        await nextTitle.waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const win = globalThis as unknown as {
            document: { querySelector(selector: string): { textContent?: string | null } | null };
          };
          const title = win.document.querySelector("[data-next-title]")?.textContent ?? "";
          return title && title !== "Loading agenda...";
        });

        assert(
          pageErrors.length === 0,
          `Expected malformed hash not to throw, got ${pageErrors.join("; ")}`,
        );
        assert(
          (await nextTitle.textContent()) !== "No agenda loaded",
          "Expected agenda to load after ignoring malformed hash.",
        );
      });
    });
  },
});

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
  name: "app follows dark system color scheme without a theme toggle",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withIphonePage(async (page) => {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.goto(baseUrl);
        await page.locator("[data-next-card]").waitFor();

        const theme = await page.evaluate(() => {
          type ElementLike = {
            textContent?: string | null;
            getAttribute?(name: string): string | null;
          };
          type DocumentLike = {
            body: ElementLike;
            documentElement: ElementLike;
            querySelector(selector: string): ElementLike | null;
            querySelectorAll(selector: string): ArrayLike<ElementLike>;
          };
          const win = globalThis as unknown as {
            document: DocumentLike;
            getComputedStyle(element: ElementLike): {
              backgroundColor: string;
              colorScheme: string;
              getPropertyValue(name: string): string;
            };
            matchMedia(query: string): { matches: boolean };
          };
          const brightness = (value: string) => {
            const channels = (value.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
            return channels.length === 3
              ? (channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114)
              : 255;
          };
          const root = win.getComputedStyle(win.document.documentElement);
          const card = win.document.querySelector("[data-next-card]");
          const darkThemeColorMeta = win.document.querySelector(
            'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]',
          );
          const themeControlLabels = Array.from(win.document.querySelectorAll("button, a"))
            .map((element) => element.textContent?.trim().toLowerCase() || "")
            .filter((text) => /\b(dark|light|theme)\b/.test(text));

          return {
            prefersDark: win.matchMedia("(prefers-color-scheme: dark)").matches,
            colorScheme: root.colorScheme,
            rootBackground: root.getPropertyValue("--bg").trim(),
            bodyBrightness: brightness(win.getComputedStyle(win.document.body).backgroundColor),
            cardBrightness: card ? brightness(win.getComputedStyle(card).backgroundColor) : 255,
            darkThemeColor: darkThemeColorMeta?.getAttribute
              ? darkThemeColorMeta.getAttribute("content")
              : null,
            themeControlLabels,
          };
        });

        assert(theme.prefersDark, "Expected Playwright to emulate dark system preference.");
        assert(
          theme.colorScheme.includes("dark"),
          `Expected dark color-scheme, got ${theme.colorScheme}`,
        );
        assert(
          theme.rootBackground === "#111112",
          `Expected dark root background, got ${theme.rootBackground}`,
        );
        assert(
          theme.bodyBrightness < 40,
          `Expected dark body background, got ${theme.bodyBrightness}`,
        );
        assert(
          theme.cardBrightness < 50,
          `Expected dark card background, got ${theme.cardBrightness}`,
        );
        assert(theme.darkThemeColor === "#111112", "Expected dark browser theme color metadata.");
        assert(
          theme.themeControlLabels.length === 0,
          `Expected no dark-mode UI controls, got ${theme.themeControlLabels.join(", ")}`,
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

    await withEnv({
      UOS_AI_TOKEN: "e2e-token",
      OPENAI_API_KEY: null,
      RESEND_API_KEY: null,
      RESEND_EMAIL_FROM: null,
    }, async () => {
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

                const followUpEmail = page.locator("[name=sendFollowUpEmail]");
                if (await followUpEmail.isChecked()) await followUpEmail.uncheck();
                assert(
                  !(await followUpEmail.isChecked()),
                  "Expected non-live OCR E2E to save without follow-up email.",
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
            }
          });

          assert(gatewayBodies.length === 1, "Expected one gateway OCR request.");
          assert(
            String(gatewayBodies[0].__url).endsWith("/chat/completions"),
            "Expected OCR to use the chat-completions image endpoint.",
          );
          assert(
            gatewayBodies[0].reasoning_effort === undefined,
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
    const cardPath = writeFixtureBusinessCardJpeg();
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

    await withEnv({
      UOS_AI_TOKEN: "e2e-token",
      OPENAI_API_KEY: null,
      RESEND_API_KEY: null,
      RESEND_EMAIL_FROM: null,
    }, async () => {
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

    await withEnv({
      UOS_AI_TOKEN: "e2e-token",
      OPENAI_API_KEY: null,
      RESEND_API_KEY: null,
      RESEND_EMAIL_FROM: null,
    }, async () => {
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

    await withEnv({
      UOS_AI_TOKEN: "e2e-token",
      OPENAI_API_KEY: null,
      RESEND_API_KEY: null,
      RESEND_EMAIL_FROM: null,
    }, async () => {
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

    await withEnv({
      UOS_AI_TOKEN: "e2e-token",
      OPENAI_API_KEY: null,
      RESEND_API_KEY: null,
      RESEND_EMAIL_FROM: null,
    }, async () => {
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

    const cardPath = writeFixtureBusinessCardJpeg();

    await collectConsoleLogs(async (logs) => {
      await withApp(async (baseUrl) => {
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
                  querySelectorAll(
                    selector: string,
                  ): ArrayLike<{ dataset?: { streaming?: string }; textContent?: string | null }>;
                };
              };
              return Array.from(win.document.querySelectorAll('[data-message="assistant"]')).some((
                item,
              ) => item.dataset?.streaming === "false" && item.textContent?.trim());
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
  name: "agent stream remains visible when the schedule refreshes mid-response",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withEnv({
        UOS_AI_TOKEN: "e2e-token",
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: `${baseUrl}/mock/v1`,
        UOS_AI_BASE_URL: null,
      }, async () => {
        const rows = Array.from(
          { length: 16 },
          (_, index) => `- Schedule refresh survivor row ${index + 1}\n`,
        );
        const stream = gatewayStreamingEventStream(
          [...rows.map(gatewayDeltaEvent), "data: [DONE]\n\n"],
          30,
        );

        await withMockGatewayReplies([
          {
            status: 200,
            body: stream,
            headers: { "content-type": "text/event-stream" },
          },
        ], async () => {
          await withIphonePage(async (page) => {
            let releaseAutoSync = () => {};
            const autoSyncCanReturn = new Promise<void>((resolve) => {
              releaseAutoSync = resolve;
            });
            let autoSyncRequests = 0;
            let scheduleReads = 0;

            await page.addInitScript(() => {
              const nativeSetTimeout = globalThis.setTimeout;
              const patchedSetTimeout = (
                handler: Parameters<typeof setTimeout>[0],
                timeout?: number,
                ...args: unknown[]
              ) => {
                const delay = timeout === 1_500 || timeout === 20_000 ? 20 : timeout;
                return nativeSetTimeout(handler, delay, ...args);
              };
              globalThis.setTimeout = patchedSetTimeout as typeof setTimeout;
            });

            await page.route(`${baseUrl}/api/schedule`, async (route) => {
              scheduleReads += 1;
              const response = await fetch(`${baseUrl}/api/schedule`);
              const body = await response.json() as JsonRecord;
              const sync = body.sync as JsonRecord | undefined;
              const partifulAuto = sync?.partifulAuto as JsonRecord | undefined;
              if (partifulAuto) partifulAuto.status = "completed";
              const appState = body.state as JsonRecord | undefined;
              const partifulAutoSync = appState?.partifulAutoSync as JsonRecord | undefined;
              if (partifulAutoSync) partifulAutoSync.status = "completed";
              await route.fulfill({
                status: response.status,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              });
            });
            await page.route(`${baseUrl}/api/sync/partiful/auto`, async (route) => {
              autoSyncRequests += 1;
              await autoSyncCanReturn;
              await route.fulfill({
                status: 202,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "started" }),
              });
            });

            await page.goto(baseUrl);
            await waitForTestCondition(
              () => autoSyncRequests > 0,
              "Expected the delayed auto-sync request to start.",
            );
            await page.locator("[data-chat-fab]").click({ force: true });
            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("Stream while the route refreshes.");
            await page.keyboard.press("Enter");
            await page.locator('[data-message="assistant"][data-streaming="true"]').waitFor();

            releaseAutoSync();

            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelectorAll(selector: string): ArrayLike<{
                    getAttribute(name: string): string | null;
                    textContent?: string | null;
                  }>;
                };
              };
              return Array.from(win.document.querySelectorAll('[data-message="assistant"]')).some(
                (item) =>
                  item.getAttribute("data-streaming") === "false" &&
                  item.textContent?.includes("Schedule refresh survivor row 16"),
              );
            });
            assert(
              scheduleReads >= 2,
              "Expected schedule to refresh during the streamed response.",
            );
          });
        });
      });
    });
  },
});

Deno.test({
  name: "development chat opens from a separate left-side launcher and loads Pi threads",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withDesktopPage(async (page) => {
        await installDevAgentEventSourceMock(page, [
          {
            id: 4,
            type: "agent.message",
            threadId: "thread-1",
            repoId: "0x4007/techweek-2026-event-picker",
            text: "Streamed update from SSE",
            createdAt: "2026-05-14T13:04:00Z",
          },
        ]);
        await routeDevAgentApi(page, baseUrl, ({ method, url }) => {
          if (method === "GET" && url.pathname === "/api/session") {
            return { body: { authenticated: true, user: { displayName: "Dev" } } };
          }
          if (method === "GET" && url.pathname === "/api/threads") {
            return {
              body: [
                {
                  threadId: "thread-1",
                  repoId: "0x4007/techweek-2026-event-picker",
                  title: "Mobile header polish",
                  latestText: "Ready to test",
                  phase: "running",
                  unread: true,
                  activeRunIds: ["run-1"],
                  createdAt: "2026-05-14T13:00:00Z",
                  updatedAt: "2026-05-14T13:03:00Z",
                },
                {
                  threadId: "thread-other",
                  repoId: "other-repo",
                  title: "Other repo thread",
                  latestText: "Should be filtered out",
                  phase: "queued",
                  unread: false,
                  activeRunIds: [],
                  createdAt: "2026-05-14T12:00:00Z",
                  updatedAt: "2026-05-14T12:00:00Z",
                },
              ],
            };
          }
          if (method === "GET" && url.pathname === "/api/threads/thread-1") {
            return {
              body: {
                threadId: "thread-1",
                repoId: "0x4007/techweek-2026-event-picker",
                title: "Mobile header polish",
                latestText: "Ready to test",
                phase: "running",
                unread: true,
                activeRunIds: ["run-1"],
                createdAt: "2026-05-14T13:00:00Z",
                updatedAt: "2026-05-14T13:03:00Z",
                messages: [
                  {
                    id: 1,
                    type: "user.message",
                    threadId: "thread-1",
                    text: "Fix the mobile header",
                    createdAt: "2026-05-14T13:00:00Z",
                  },
                  {
                    id: 2,
                    type: "agent.message",
                    threadId: "thread-1",
                    text: "I tightened the header layout.",
                    createdAt: "2026-05-14T13:01:00Z",
                  },
                  {
                    id: 3,
                    type: "command.started",
                    threadId: "thread-1",
                    data: { command: "deno task check" },
                    createdAt: "2026-05-14T13:02:00Z",
                  },
                ],
              },
            };
          }
          return { status: 404, body: { error: { message: "not found" } } };
        });

        await page.goto(baseUrl);

        const devLauncher = page.locator("[data-dev-chat-open]");
        await devLauncher.waitFor({ state: "visible" });
        const routeLauncherBox = await page.locator("[data-chat-open]").boundingBox();
        const devLauncherBox = await devLauncher.boundingBox();
        assert(routeLauncherBox, "Expected route chat launcher bounds.");
        assert(devLauncherBox, "Expected development chat launcher bounds.");
        assert(
          devLauncherBox.x < routeLauncherBox.x,
          `Expected development launcher on the left, got ${
            JSON.stringify({ devLauncherBox, routeLauncherBox })
          }`,
        );

        await devLauncher.click();
        const drawer = page.locator("[data-dev-agent-drawer]");
        await drawer.waitFor({ state: "visible" });
        const drawerBox = await drawer.boundingBox();
        assert(drawerBox, "Expected development drawer bounds.");
        assert(
          drawerBox.x < 4 && drawerBox.width <= 500,
          `Expected development drawer to sit on the left edge, got ${JSON.stringify(drawerBox)}`,
        );

        await drawer.locator("[data-dev-thread-row]").filter({
          hasText: "Mobile header polish",
        }).waitFor();
        assert(
          await drawer.locator("[data-dev-thread-row]").count() === 1,
          "Expected inbox to filter threads to the embedded repo.",
        );
        assert(
          await drawer.locator("[data-dev-deploy-control]").isVisible(),
          "Expected auto deploy control to be visible for deploy-enabled apps.",
        );
        assert(
          await drawer.locator("[data-dev-deploy]").isChecked(),
          "Expected auto deploy to default on.",
        );

        await drawer.locator("[data-dev-thread-row]").click();
        await drawer.locator('[data-message="user"]').filter({
          hasText: "Fix the mobile header",
        }).waitFor();
        await drawer.locator('[data-message="assistant"]').filter({
          hasText: "I tightened the header layout.",
        }).waitFor();
        await drawer.locator('[data-message="assistant"]').filter({
          hasText: "Streamed update from SSE",
        }).waitFor();
        assert(
          await drawer.locator("[data-dev-technical]").getByText("Technical details (1)")
            .isVisible(),
          "Expected non-visible events to render in collapsed technical details.",
        );

        const sources = await page.evaluate(() => {
          const win = globalThis as unknown as {
            __devEventSources?: Array<{ url: string; withCredentials: boolean }>;
          };
          return win.__devEventSources || [];
        });
        assert(sources.length === 1, `Expected one EventSource, got ${JSON.stringify(sources)}`);
        assert(
          sources[0].withCredentials,
          `Expected credentialed EventSource, got ${JSON.stringify(sources)}`,
        );
        assert(
          sources[0].url.includes("/api/threads/thread-1/events") &&
            sources[0].url.includes("after=3"),
          `Expected EventSource after cursor from historical events, got ${
            JSON.stringify(sources)
          }`,
        );

        const storedRouteMessages = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("techweek-chat") || "[]").length
        );
        assert(
          storedRouteMessages === 0,
          `Expected development chat to avoid route chat storage, got ${storedRouteMessages}`,
        );
        await assertNoHorizontalOverflow(page);
      });
    });
  },
});

Deno.test({
  name: "development chat submits runs with deploy state and preserves failed prompts",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withDesktopPage(async (page) => {
        await installDevAgentEventSourceMock(page, []);
        const runBodies: JsonRecord[] = [];
        let runAttempts = 0;
        await routeDevAgentApi(page, baseUrl, ({ body, method, url }) => {
          if (method === "GET" && url.pathname === "/api/session") {
            return { body: { authenticated: true } };
          }
          if (method === "GET" && url.pathname === "/api/threads") {
            return { body: [] };
          }
          if (method === "POST" && url.pathname === "/api/runs") {
            runAttempts += 1;
            runBodies.push(body);
            if (runAttempts === 1) {
              return {
                status: 500,
                body: { error: { message: "Build runner unavailable" } },
              };
            }
            return {
              status: 202,
              body: {
                runId: "run-new",
                threadId: "thread-new",
                repoId: "0x4007/techweek-2026-event-picker",
                status: "queued",
                phase: "queued",
                eventsUrl: "/api/runs/run-new/events",
                threadEventsUrl: "/api/threads/thread-new/events",
              },
            };
          }
          if (method === "GET" && url.pathname === "/api/threads/thread-new") {
            return {
              body: {
                threadId: "thread-new",
                repoId: "0x4007/techweek-2026-event-picker",
                title: "Ship this change",
                latestText: "Queued agent run",
                phase: "queued",
                unread: true,
                activeRunIds: ["run-new"],
                createdAt: "2026-05-14T13:20:00Z",
                updatedAt: "2026-05-14T13:20:00Z",
                messages: [
                  {
                    id: 1,
                    type: "user.message",
                    threadId: "thread-new",
                    text: "Ship this change",
                    createdAt: "2026-05-14T13:20:00Z",
                  },
                  {
                    id: 2,
                    type: "phase.changed",
                    threadId: "thread-new",
                    phase: "queued",
                    text: "Queued agent run",
                    createdAt: "2026-05-14T13:20:01Z",
                  },
                ],
              },
            };
          }
          return { status: 404, body: { error: { message: "not found" } } };
        });

        await page.goto(baseUrl);
        await page.locator("[data-dev-chat-open]").click();
        const drawer = page.locator("[data-dev-agent-drawer]");
        await drawer.getByText("No threads yet.").waitFor();

        const textarea = drawer.locator("form[data-dev-chat-form] textarea");
        await drawer.locator("[data-dev-deploy]").uncheck();
        await textarea.fill("Failing prompt");
        await page.keyboard.press("Enter");
        await drawer.getByText("Build runner unavailable").waitFor();
        assert(
          await textarea.inputValue() === "Failing prompt",
          "Expected failed prompt submission to keep composer text.",
        );
        assert(
          runBodies[0]?.deploy === false,
          `Expected unchecked deploy state in failed request, got ${JSON.stringify(runBodies[0])}`,
        );

        await drawer.locator("[data-dev-deploy]").check();
        await textarea.fill("Ship this change");
        await page.keyboard.press("Enter");
        await drawer.locator('[data-message="user"]').filter({
          hasText: "Ship this change",
        }).waitFor();
        assert(await textarea.inputValue() === "", "Expected successful submission to clear text.");
        assert(
          runBodies[1]?.deploy === true &&
            runBodies[1]?.repoId === "0x4007/techweek-2026-event-picker" &&
            runBodies[1]?.title === "Ship this change",
          `Expected new run request to include repo, title, and deploy state, got ${
            JSON.stringify(runBodies[1])
          }`,
        );
      });
    });
  },
});

Deno.test({
  name: "development chat returns to sign-in when the Pi session expires",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withDesktopPage(async (page) => {
        await installDevAgentEventSourceMock(page, []);
        await routeDevAgentApi(page, baseUrl, ({ method, url }) => {
          if (method === "GET" && url.pathname === "/api/session") {
            return { body: { authenticated: true, user: { displayName: "Dev" } } };
          }
          if (method === "GET" && url.pathname === "/api/threads") {
            return {
              status: 401,
              body: { error: { message: "Unauthorized" } },
            };
          }
          return { status: 404, body: { error: { message: "not found" } } };
        });

        await page.goto(baseUrl);
        await page.locator("[data-dev-chat-open]").click();
        const drawer = page.locator("[data-dev-agent-drawer]");
        await drawer.getByText("Sign in required.").waitFor();
        await drawer.getByText("Your Pi agent session expired. Sign in again.").waitFor();
        assert(
          !(await drawer.getByText("Pi agent unavailable.").isVisible()),
          "Expected expired sessions to show auth, not unavailable.",
        );
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
  name: "agent requests do not open a geolocation permission prompt",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withEnv({ UOS_AI_TOKEN: null, OPENAI_API_KEY: null }, async () => {
      await collectConsoleLogs(async (logs) => {
        await withApp(async (baseUrl) => {
          await withIphonePage(async (page) => {
            await page.addInitScript(() => {
              const win = globalThis as unknown as { __geoGetCurrentPositionCalls: number };
              win.__geoGetCurrentPositionCalls = 0;

              const geolocation = {
                getCurrentPosition() {
                  win.__geoGetCurrentPositionCalls += 1;
                },
              };
              const permissions = {
                query: (descriptor: { name?: string }) =>
                  Promise.resolve({
                    state: descriptor?.name === "geolocation" ? "prompt" : "denied",
                  }),
              };

              for (const target of [navigator, Navigator.prototype]) {
                try {
                  Object.defineProperty(target, "geolocation", {
                    configurable: true,
                    value: geolocation,
                  });
                } catch {
                  // Browser-owned property; try the next target.
                }
                try {
                  Object.defineProperty(target, "permissions", {
                    configurable: true,
                    value: permissions,
                  });
                } catch {
                  // Browser-owned property; try the next target.
                }
              }
            });

            await page.goto(baseUrl);
            await page.locator("[data-chat-fab]").click();
            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("What should I ask at this event?");
            const agentResponse = page.waitForResponse((response) =>
              response.url().endsWith("/api/agent/stream")
            );
            await page.keyboard.press("Enter");

            await page.locator('[data-message="user"]').filter({
              hasText: "What should I ask at this event?",
            }).waitFor();
            const response = await agentResponse;
            assert(
              response.status() === 503,
              `Expected missing-token 503, got ${response.status()}`,
            );

            const calls = await page.evaluate(() =>
              (globalThis as unknown as { __geoGetCurrentPositionCalls?: number })
                .__geoGetCurrentPositionCalls ?? 0
            );
            assert(calls === 0, "Expected agent context collection not to request geolocation.");
          });
        });

        const agentLog = jsonLogs(logs, "agent_context").at(-1);
        const clientContext = agentLog?.clientContext as JsonRecord | undefined;
        assert(
          clientContext?.locationStatus === "permission_prompt_not_requested",
          `Expected prompt-state location to be skipped, got ${clientContext?.locationStatus}`,
        );
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
            await page.locator("[data-chat-fab]").click({ force: true });
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    hasAttribute(name: string): boolean;
                  } | null;
                };
              };
              return !win.document.querySelector("[data-agent-drawer]")?.hasAttribute("hidden");
            });

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
  name: "agent streaming paces bursty completed rows on a smoothed cadence",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withEnv({
        UOS_AI_TOKEN: "e2e-token",
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: `${baseUrl}/mock/v1`,
        UOS_AI_BASE_URL: null,
      }, async () => {
        let emittedEvents = 0;
        const rowCount = 14;
        const events = Array.from(
          { length: rowCount },
          (_, index) => gatewayDeltaEvent(`- Smoothed row ${index + 1}\n`),
        );
        const stream = gatewayStreamingEventStream(
          [...events, "data: [DONE]\n\n"],
          1,
          () => {
            emittedEvents += 1;
          },
        );

        await withMockGatewayReplies([
          {
            status: 200,
            body: stream,
            headers: { "content-type": "text/event-stream" },
          },
        ], async () => {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            await page.locator("[data-chat-fab]").click({ force: true });
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    hasAttribute(name: string): boolean;
                  } | null;
                };
              };
              return !win.document.querySelector("[data-agent-drawer]")?.hasAttribute("hidden");
            });

            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("Give me bursty rows.");
            await page.keyboard.press("Enter");

            await waitForTestCondition(
              () => emittedEvents >= rowCount,
              "Expected the gateway to emit all bursty rows.",
            );
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    querySelectorAll(selector: string): ArrayLike<unknown>;
                  } | null;
                };
              };
              return (win.document.querySelector('[data-message="assistant"]')
                ?.querySelectorAll("li[data-stream-row]").length || 0) > 0;
            });
            await page.waitForTimeout(80);

            const pacedRows = await page.evaluate(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    querySelectorAll(selector: string): ArrayLike<unknown>;
                  } | null;
                };
                getComputedStyle(element: unknown): {
                  animationDuration: string;
                  animationName: string;
                };
              };
              const rows = Array.from(
                win.document.querySelector('[data-message="assistant"]')
                  ?.querySelectorAll("li[data-stream-row]") || [],
              );
              return {
                animationDuration: rows[0] ? win.getComputedStyle(rows[0]).animationDuration : "",
                animationName: rows[0] ? win.getComputedStyle(rows[0]).animationName : "",
                visibleRows: rows.length,
              };
            });
            assert(
              pacedRows.visibleRows > 0 && pacedRows.visibleRows < rowCount,
              `Expected bursty rows to be paced instead of all appearing at once, got ${
                JSON.stringify(pacedRows)
              }`,
            );
            assert(
              pacedRows.animationName === "stream-row-in" &&
                pacedRows.animationDuration === "0.44s",
              `Expected rows to use the slower opacity fade, got ${JSON.stringify(pacedRows)}`,
            );

            await page.waitForFunction((expectedRows) => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    dataset?: { streaming?: string };
                    querySelectorAll(selector: string): ArrayLike<unknown>;
                  } | null;
                };
              };
              const assistant = win.document.querySelector('[data-message="assistant"]');
              return assistant?.dataset?.streaming === "false" &&
                assistant.querySelectorAll("li[data-stream-row]").length === expectedRows;
            }, rowCount);
          });
        });
      });
    });
  },
});

Deno.test({
  name: "agent streaming reveals only completed rows while the active row is still changing",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withEnv({
        UOS_AI_TOKEN: "e2e-token",
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: `${baseUrl}/mock/v1`,
        UOS_AI_BASE_URL: null,
      }, async () => {
        let emittedEvents = 0;
        const stream = gatewayStreamingEventStream(
          [
            gatewayDeltaEvent("Draft row should stay hidden while it streams"),
            gatewayDeltaEvent(" and keeps growing"),
            gatewayDeltaEvent("\nNext row is active now"),
            gatewayDeltaEvent(" and should stay hidden until it completes"),
            "data: [DONE]\n\n",
          ],
          180,
          () => {
            emittedEvents += 1;
          },
        );

        await withMockGatewayReplies([
          {
            status: 200,
            body: stream,
            headers: { "content-type": "text/event-stream" },
          },
        ], async () => {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            await page.locator("[data-chat-fab]").click();

            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("Give me a two row stream.");
            await page.keyboard.press("Enter");

            await waitForTestCondition(
              () => emittedEvents >= 2,
              "Expected the first active row chunks to be emitted.",
            );
            await page.waitForTimeout(40);

            const activeOnlyText = await page.locator('[data-message="assistant"]').textContent();
            assert(
              !activeOnlyText?.includes("Draft row should stay hidden"),
              `Expected the active row to stay hidden, got ${activeOnlyText}`,
            );

            await waitForTestCondition(
              () => emittedEvents >= 3,
              "Expected the second row to start streaming.",
            );
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelectorAll(selector: string): ArrayLike<unknown>;
                };
              };
              return win.document.querySelectorAll("[data-stream-row]").length === 1;
            });

            const laggedRows = await page.evaluate(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    textContent?: string | null;
                  } | null;
                  querySelectorAll(selector: string): ArrayLike<unknown>;
                };
              };
              const assistant = win.document.querySelector('[data-message="assistant"]');
              return {
                rowCount: win.document.querySelectorAll("[data-stream-row]").length,
                text: assistant?.textContent || "",
              };
            });
            assert(
              laggedRows.text.includes("Draft row should stay hidden while it streams"),
              `Expected the completed first row to be revealed, got ${JSON.stringify(laggedRows)}`,
            );
            assert(
              !laggedRows.text.includes("Next row is active now"),
              `Expected the active second row to stay hidden, got ${JSON.stringify(laggedRows)}`,
            );

            await page.locator('[data-message="assistant"]').filter({
              hasText: "Next row is active now",
            }).waitFor();
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): { dataset?: { streaming?: string } } | null;
                };
              };
              return win.document.querySelector('[data-message="assistant"]')?.dataset
                ?.streaming === "false";
            });
          });
        });
      });
    });
  },
});

Deno.test({
  name: "agent chat uses the markdown renderer for lists, quotes, rules, and safe links",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withIphonePage(async (page) => {
        const markdown = [
          "### During event",
          "Your conversation structure:",
          "",
          "1. Context",
          '   > "I am building contribution evidence."',
          "1. Discovery",
          '   > "How do you currently recognize review work?"',
          "1. Pain check",
          '   > "Has AI changed review volume?"',
          "",
          "---",
          "",
          "[Event link](https://example.com/event)",
          "[Unsafe link](javascript:alert(1))",
        ].join("\n");

        await page.addInitScript((content) => {
          localStorage.setItem(
            "techweek-chat:anonymous",
            JSON.stringify([{ role: "assistant", content }]),
          );
        }, markdown);
        await page.goto(baseUrl);
        await page.locator("[data-chat-fab]").click();
        await page.locator('[data-message="assistant"] h3', { hasText: "During event" }).waitFor();

        const rendered = await page.evaluate(() => {
          type QueryNode = {
            textContent?: string | null;
            getAttribute(name: string): string | null;
            getBoundingClientRect(): { top: number; bottom: number };
            querySelector(selector: string): QueryNode | null;
            querySelectorAll(selector: string): ArrayLike<QueryNode>;
          };
          const win = globalThis as unknown as {
            document: { querySelector(selector: string): QueryNode | null };
          };
          const message = win.document.querySelector('[data-message="assistant"]');
          const content = message?.querySelector("[data-message-content]");
          const links = Array.from(content?.querySelectorAll("a") || []);
          return {
            h3: content?.querySelector("h3")?.textContent || "",
            olCount: content?.querySelectorAll("ol").length || 0,
            liCount: content?.querySelectorAll("ol > li").length || 0,
            blockquoteCount: content?.querySelectorAll("blockquote").length || 0,
            hrCount: content?.querySelectorAll("hr").length || 0,
            firstListGap: (() => {
              const items = Array.from(content?.querySelectorAll("ol > li") || []);
              if (items.length < 2) return 0;
              return items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().bottom;
            })(),
            quoteGap: (() => {
              const firstItem = content?.querySelector("ol > li");
              const quote = firstItem?.querySelector("blockquote");
              if (!firstItem || !quote) return 0;
              return quote.getBoundingClientRect().top - firstItem.getBoundingClientRect().top;
            })(),
            safeLinkTarget: links[0]?.getAttribute("target") || "",
            safeLinkRel: links[0]?.getAttribute("rel") || "",
            unsafeHref: links.find((link) => link.textContent?.includes("Unsafe"))
              ?.getAttribute("href") || "",
            text: content?.textContent || "",
          };
        });

        assert(
          rendered.h3 === "During event" &&
            rendered.olCount === 1 &&
            rendered.liCount === 3 &&
            rendered.blockquoteCount === 3 &&
            rendered.hrCount === 1,
          `Expected mature markdown block rendering, got ${JSON.stringify(rendered)}`,
        );
        assert(
          rendered.firstListGap <= 8 && rendered.quoteGap > 0 && rendered.quoteGap <= 36,
          `Expected compact markdown vertical spacing, got ${JSON.stringify(rendered)}`,
        );
        assert(
          rendered.safeLinkTarget === "_blank" && rendered.safeLinkRel === "noreferrer",
          `Expected rendered links to be safe external links, got ${JSON.stringify(rendered)}`,
        );
        assert(
          !rendered.unsafeHref.startsWith("javascript:"),
          `Expected unsafe markdown link to be sanitized, got ${JSON.stringify(rendered)}`,
        );
        assert(
          !rendered.text.includes("---"),
          `Expected horizontal rule not to render as literal markdown, got ${
            JSON.stringify(rendered)
          }`,
        );
      });
    });
  },
});

Deno.test({
  name: "agent streaming renders completed rows with final markdown before stream end",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withEnv({
        UOS_AI_TOKEN: "e2e-token",
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: `${baseUrl}/mock/v1`,
        UOS_AI_BASE_URL: null,
      }, async () => {
        let emittedEvents = 0;
        const stream = gatewayStreamingEventStream(
          [
            gatewayDeltaEvent("### Room read\n"),
            gatewayDeltaEvent("- Meet **CTOs**\n"),
            gatewayDeltaEvent("- Ask about `reviews`\n"),
            gatewayDeltaEvent("Final paragraph stays hidden"),
            gatewayDeltaEvent(" until done"),
            "data: [DONE]\n\n",
          ],
          120,
          () => {
            emittedEvents += 1;
          },
        );

        await withMockGatewayReplies([
          {
            status: 200,
            body: stream,
            headers: { "content-type": "text/event-stream" },
          },
        ], async () => {
          await withIphonePage(async (page) => {
            await page.goto(baseUrl);
            await page.locator("[data-chat-fab]").click();

            const textarea = page.locator("form[data-chat-form] textarea");
            await textarea.fill("Give me markdown coaching.");
            await page.keyboard.press("Enter");

            await waitForTestCondition(
              () => emittedEvents >= 2,
              "Expected the first list row to be emitted.",
            );
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    querySelector(selector: string): {
                      textContent?: string | null;
                    } | null;
                    querySelectorAll(selector: string): ArrayLike<unknown>;
                  } | null;
                };
              };
              const assistant = win.document.querySelector('[data-message="assistant"]');
              return assistant?.querySelector("h3, h4")?.textContent?.includes("Room read") &&
                assistant.querySelectorAll("li").length === 1;
            });
            const firstListItem = await page.evaluate(() => {
              type QueryNode = {
                textContent?: string | null;
                querySelector(selector: string): QueryNode | null;
              };
              const win = globalThis as unknown as {
                __streamFirstListItem?: unknown;
                document: { querySelector(selector: string): QueryNode | null };
                getComputedStyle(element: unknown): { animationName: string };
              };
              const firstItem = win.document
                .querySelector('[data-message="assistant"]')
                ?.querySelector("li") ?? null;
              win.__streamFirstListItem = firstItem;
              return {
                animation: firstItem ? win.getComputedStyle(firstItem).animationName : "",
                text: firstItem?.textContent || "",
              };
            });
            assert(
              firstListItem.animation === "stream-row-in",
              `Expected the first list row to fade in, got ${JSON.stringify(firstListItem)}`,
            );

            await waitForTestCondition(
              () => emittedEvents >= 3,
              "Expected completed markdown rows to be emitted.",
            );
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    querySelector(selector: string): {
                      textContent?: string | null;
                    } | null;
                    querySelectorAll(selector: string): ArrayLike<unknown>;
                  } | null;
                };
              };
              const assistant = win.document.querySelector('[data-message="assistant"]');
              return assistant?.querySelector("h3, h4")?.textContent?.includes("Room read") &&
                assistant.querySelectorAll("li").length === 2;
            });

            const streamingMarkdown = await page.evaluate(() => {
              type QueryNode = {
                dataset?: { streamingRows?: string };
                textContent?: string | null;
                querySelector(selector: string): QueryNode | null;
                querySelectorAll(selector: string): ArrayLike<unknown>;
              };
              const win = globalThis as unknown as {
                __streamHeading?: unknown;
                __streamFirstListItem?: unknown;
                __streamList?: unknown;
                document: { querySelector(selector: string): QueryNode | null };
                getComputedStyle(element: unknown): { animationName: string };
              };
              const assistant = win.document.querySelector('[data-message="assistant"]');
              const content = assistant?.querySelector("[data-message-content]");
              const heading = assistant?.querySelector("h3, h4") ?? null;
              const list = assistant?.querySelector("ul") ?? null;
              const listItems = Array.from(assistant?.querySelectorAll("li") || []);
              win.__streamHeading = heading;
              win.__streamList = list;
              return {
                contentHasStreamingRows: content?.dataset?.streamingRows === "true",
                heading: heading?.textContent || "",
                hasStrong: Boolean(assistant?.querySelector("strong")),
                hasCode: Boolean(assistant?.querySelector("code")),
                listItemRowCount: assistant?.querySelectorAll("li[data-stream-row]").length || 0,
                rowCount: assistant?.querySelectorAll("[data-stream-row]").length || 0,
                sameFirstListItem: win.__streamFirstListItem === listItems[0],
                secondListItemAnimation: listItems[1]
                  ? win.getComputedStyle(listItems[1]).animationName
                  : "",
                text: assistant?.textContent || "",
              };
            });

            assert(
              streamingMarkdown.contentHasStreamingRows,
              "Expected markdown streaming to mark the streaming content.",
            );
            assert(
              streamingMarkdown.heading === "Room read",
              `Expected heading markdown before completion, got ${
                JSON.stringify(streamingMarkdown)
              }`,
            );
            assert(
              streamingMarkdown.hasStrong && streamingMarkdown.hasCode,
              `Expected inline markdown before completion, got ${
                JSON.stringify(streamingMarkdown)
              }`,
            );
            assert(
              streamingMarkdown.rowCount === 3 && streamingMarkdown.listItemRowCount === 2,
              `Expected heading and list rows to be marked individually, got ${
                JSON.stringify(streamingMarkdown)
              }`,
            );
            assert(
              streamingMarkdown.sameFirstListItem &&
                streamingMarkdown.secondListItemAnimation === "stream-row-in",
              `Expected appended list rows to fade without replacing earlier rows, got ${
                JSON.stringify(streamingMarkdown)
              }`,
            );
            assert(
              !streamingMarkdown.text.includes("Final paragraph stays hidden"),
              `Expected active final row to stay hidden, got ${JSON.stringify(streamingMarkdown)}`,
            );

            await page.locator('[data-message="assistant"]').filter({
              hasText: "Final paragraph stays hidden until done",
            }).waitFor();
            await page.waitForFunction(() => {
              const win = globalThis as unknown as {
                document: {
                  querySelector(selector: string): {
                    getAttribute(name: string): string | null;
                  } | null;
                };
              };
              return win.document.querySelector('[data-message="assistant"]')?.getAttribute(
                "data-streaming",
              ) === "false";
            });

            const finalMarkdown = await page.evaluate(() => {
              type QueryNode = {
                textContent?: string | null;
                querySelector(selector: string): QueryNode | null;
              };
              const win = globalThis as unknown as {
                __streamHeading?: unknown;
                __streamList?: unknown;
                document: { querySelector(selector: string): QueryNode | null };
              };
              const assistant = win.document.querySelector('[data-message="assistant"]');
              return {
                sameHeading: win.__streamHeading === assistant?.querySelector("h3, h4"),
                sameList: win.__streamList === assistant?.querySelector("ul"),
                text: assistant?.textContent || "",
              };
            });
            assert(
              finalMarkdown.sameHeading && finalMarkdown.sameList,
              `Expected final render to preserve streamed markdown DOM, got ${
                JSON.stringify(finalMarkdown)
              }`,
            );
            assert(
              finalMarkdown.text.includes("Final paragraph stays hidden until done"),
              `Expected final active row to be revealed, got ${JSON.stringify(finalMarkdown)}`,
            );
          });
        });
      });
    });
  },
});

Deno.test({
  name: "agent streaming does not keep forcing the chat log to the bottom",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withApp(async (baseUrl) => {
      await withEnv({
        UOS_AI_TOKEN: "e2e-token",
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: `${baseUrl}/mock/v1`,
        UOS_AI_BASE_URL: null,
      }, async () => {
        const longResponse = Array.from(
          { length: 90 },
          (_, index) =>
            `Paragraph ${
              index + 1
            }: Keep this early coaching readable while later text is still streaming into the same assistant response.`,
        ).join("\n\n");

        await withMockGatewayReplies([
          {
            status: 200,
            body: gatewayStreamingStream(longResponse),
            headers: { "content-type": "text/event-stream" },
          },
        ], async () => {
          await collectConsoleLogs(async () => {
            await withIphonePage(async (page) => {
              await page.goto(baseUrl);
              await page.locator("[data-chat-fab]").click();

              const textarea = page.locator("form[data-chat-form] textarea");
              await textarea.fill("Give me a long prep brief.");
              await page.keyboard.press("Enter");

              await page.waitForFunction(() => {
                const win = globalThis as unknown as {
                  document: {
                    querySelector(selector: string): { dataset?: { streaming?: string } } | null;
                    querySelectorAll(selector: string): ArrayLike<unknown>;
                  };
                };
                return win.document.querySelector('[data-message="assistant"]')?.dataset
                      ?.streaming === "true" &&
                  win.document.querySelectorAll("[data-stream-row]").length >= 6;
              });

              const streamingRows = await page.evaluate(() => {
                const win = globalThis as unknown as {
                  document: {
                    querySelector(selector: string): {
                      dataset?: { streamingRows?: string };
                      textContent?: string | null;
                    } | null;
                    querySelectorAll(selector: string): ArrayLike<{
                      textContent?: string | null;
                    }>;
                  };
                  getComputedStyle(element: unknown): {
                    animationDuration: string;
                    animationName: string;
                    transform: string;
                  };
                };
                const content = win.document.querySelector(
                  '[data-message="assistant"] [data-message-content]',
                );
                const rows = Array.from(win.document.querySelectorAll("[data-stream-row]"));
                return {
                  contentHasStreamingRows: content?.dataset?.streamingRows === "true",
                  firstAnimationDuration: rows[0]
                    ? win.getComputedStyle(rows[0]).animationDuration
                    : "",
                  firstAnimation: rows[0] ? win.getComputedStyle(rows[0]).animationName : "",
                  firstTransform: rows[0] ? win.getComputedStyle(rows[0]).transform : "",
                  rowCount: rows.length,
                  firstText: rows[0]?.textContent || "",
                };
              });
              assert(
                streamingRows.contentHasStreamingRows,
                "Expected streaming renderer to mark row-based streaming content.",
              );
              assert(
                streamingRows.firstAnimation === "stream-row-in",
                `Expected rows to fade in, got ${JSON.stringify(streamingRows)}`,
              );
              assert(
                streamingRows.firstAnimationDuration === "0.44s",
                `Expected rows to use the slower opacity fade, got ${
                  JSON.stringify(streamingRows)
                }`,
              );
              assert(
                streamingRows.firstTransform === "none",
                `Expected rows to fade without vertical motion, got ${
                  JSON.stringify(streamingRows)
                }`,
              );
              assert(
                streamingRows.firstText.includes("Paragraph 1"),
                `Expected the first streamed row to remain readable, got ${
                  JSON.stringify(streamingRows)
                }`,
              );

              await page.locator('[data-message="assistant"]').filter({
                hasText: "Paragraph 90",
              }).waitFor();
              await page.waitForFunction(() => {
                const win = globalThis as unknown as {
                  document: {
                    querySelector(selector: string): {
                      dataset?: { streaming?: string };
                      textContent?: string | null;
                    } | null;
                  };
                };
                return win.document.querySelector('[data-message="assistant"]')?.dataset
                  ?.streaming === "false";
              });

              const metrics = await page.evaluate(() => {
                const win = globalThis as unknown as {
                  document: {
                    querySelector(selector: string): {
                      clientHeight: number;
                      scrollHeight: number;
                      scrollTop: number;
                    } | null;
                  };
                };
                const log = win.document.querySelector("[data-chat-log]");
                if (!log) return null;
                return {
                  bottomGap: log.scrollHeight - log.clientHeight - log.scrollTop,
                  clientHeight: log.clientHeight,
                  scrollHeight: log.scrollHeight,
                  scrollTop: log.scrollTop,
                };
              });

              assert(metrics, "Expected chat log metrics.");
              assert(
                metrics.scrollHeight > metrics.clientHeight + 300,
                `Expected streamed response to overflow the chat log, got ${
                  JSON.stringify(metrics)
                }`,
              );
              assert(
                metrics.bottomGap > 160,
                `Expected streaming to preserve reader position instead of jumping to bottom, got ${
                  JSON.stringify(metrics)
                }`,
              );
            });
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
          metrics.every((item) => item.headingGap >= 10 && item.headingGap <= 14),
          "Expected response headings to have compact section spacing above them.",
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
