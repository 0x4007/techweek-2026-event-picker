function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Partiful sync local ports match app server port", async () => {
  const serverSource = await Deno.readTextFile("app/server.ts");
  const serverPort = Number(firstMatch(serverSource, /\bconst PORT = (\d+);/, "app server port"));
  assert(Number.isInteger(serverPort) && serverPort > 0, `Invalid app server port: ${serverPort}`);

  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks?: Record<string, string>;
  };
  const entries = [
    {
      path: "scripts/sync_partiful_from_browser.ts",
      task: "sync:partiful",
    },
    {
      path: "scripts/sync_partiful_headless.ts",
      task: "sync:partiful:headless",
    },
  ];

  for (const entry of entries) {
    const source = await Deno.readTextFile(entry.path);
    const expectedBaseUrl = `http://127.0.0.1:${serverPort}`;
    assert(
      source.includes(`const DEFAULT_BASE_URL = "${expectedBaseUrl}";`),
      `${entry.path} default base URL must match app server port ${serverPort}.`,
    );
    assertLocalNetTargets(source.split("\n", 1)[0] ?? "", serverPort, `${entry.path} shebang`);

    const command = denoConfig.tasks?.[entry.task] ?? "";
    assert(command, `Missing deno task ${entry.task}.`);
    assertLocalNetTargets(command, serverPort, `deno task ${entry.task}`);
  }
});

function firstMatch(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  assert(match?.[1], `Could not find ${label}.`);
  return match[1];
}

function assertLocalNetTargets(text: string, port: number, label: string): void {
  const expectedTargets = [`127.0.0.1:${port}`, `localhost:${port}`];
  for (const target of expectedTargets) {
    assert(text.includes(target), `${label} must allow ${target}.`);
  }

  const staleTargets = [...text.matchAll(/\b(?:127\.0\.0\.1|localhost):(\d+)\b/g)]
    .map((match) => match[0])
    .filter((target) => !expectedTargets.includes(target));
  assert(
    staleTargets.length === 0,
    `${label} allows non-server local target(s): ${staleTargets.join(", ")}.`,
  );
}
