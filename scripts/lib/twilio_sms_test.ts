import { extractPartifulVerificationCode, latestPartifulCodeMessage } from "./twilio_sms.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("extractPartifulVerificationCode reads Partiful OTP messages", () => {
  assertEquals(
    extractPartifulVerificationCode("838352 is your Partiful verification code"),
    "838352",
  );
  assertEquals(extractPartifulVerificationCode("123456 is your unrelated code"), "");
});

Deno.test("latestPartifulCodeMessage returns newest code after cutoff", () => {
  const latest = latestPartifulCodeMessage([
    {
      sid: "SM-old",
      accountSid: "AC",
      messagingServiceSid: "MG",
      from: "+10000000000",
      to: "+18445121476",
      body: "111111 is your Partiful verification code",
      direction: "inbound",
      dateCreated: "Thu, 14 May 2026 07:30:00 +0000",
    },
    {
      sid: "SM-new",
      accountSid: "AC",
      messagingServiceSid: "MG",
      from: "+10000000000",
      to: "+18445121476",
      body: "222222 is your Partiful verification code",
      direction: "inbound",
      dateCreated: "Thu, 14 May 2026 07:40:00 +0000",
    },
  ], { sinceMs: Date.parse("2026-05-14T07:35:00Z") });

  assertEquals(latest && { code: latest.code, sid: latest.message.sid }, {
    code: "222222",
    sid: "SM-new",
  });
});
