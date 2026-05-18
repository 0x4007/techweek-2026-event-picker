import { parseArgs } from "./login_partiful_with_twilio.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("parseArgs does not copy phone from default Twilio auth when auth file is overridden", async () => {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir();
  try {
    Deno.env.set("HOME", home);
    await Deno.mkdir(`${home}/.codex/secrets`, { recursive: true });
    await Deno.writeTextFile(
      `${home}/.codex/secrets/techweek-twilio-auth.json`,
      JSON.stringify({
        version: 1,
        accountSid: "AC-default",
        authToken: "default-token",
        phoneE164: "+15550000001",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
      }),
    );

    const args = parseArgs(["--twilio-auth-file", "./alternate-twilio-auth.json"]);

    assertEquals(args.twilioAuthFile, "./alternate-twilio-auth.json");
    assertEquals(args.phone, "");
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
  }
});
