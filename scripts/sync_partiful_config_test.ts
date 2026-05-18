function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Partiful sync local ports match app server port", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks?: Record<string, string>;
  };
  assert(!denoConfig.tasks?.["sync:partiful"], "Remove browser-backed sync:partiful task.");

  const source = await Deno.readTextFile("scripts/sync_partiful_headless.ts");
  const command = denoConfig.tasks?.["sync:partiful:headless"] ?? "";
  assert(command, "Missing deno task sync:partiful:headless.");
  for (const text of [source, command]) {
    assert(!text.includes("agent-browser"), "Headless sync must not call agent-browser.");
    assert(!text.includes("127.0.0.1"), "Headless sync must not depend on a local app server.");
    assert(!text.includes("localhost:"), "Headless sync must not depend on a local app server.");
    assert(!text.includes("/api/schedule"), "Headless sync must not read local schedule API.");
    assert(!text.includes("/api/sync/partiful"), "Headless sync must not post to local sync API.");
  }
  assert(
    command.includes("api.partiful.com") && command.includes("securetoken.googleapis.com"),
    "Headless sync task must allow the Partiful and Firebase token APIs.",
  );
});
