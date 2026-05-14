import { extractPartifulSnapshotPayloads, normalizePartifulSnapshot } from "./partiful_sync.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("extractPartifulSnapshotPayloads accepts browser response wrappers", () => {
  const extracted = extractPartifulSnapshotPayloads({
    source: "agent-browser:techweek",
    responses: [{
      eventUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
      json: {
        result: {
          data: {
            json: {
              event: {
                title: "Open Source Must Win",
                publicShortUrl: "https://partiful.com/e/OF1vP5L8dtXKRtInyWKs",
              },
              viewerGuest: {
                status: "APPROVED",
                rsvp: { count: 2 },
              },
            },
          },
        },
      },
    }],
  });

  assertEquals(extracted.warnings, []);
  assertEquals(extracted.snapshots.length, 1);

  const normalized = normalizePartifulSnapshot(extracted.snapshots[0]);
  assertEquals(normalized.errors, []);
  assertEquals(normalized.event?.partifulId, "OF1vP5L8dtXKRtInyWKs");
  assertEquals(normalized.event?.status, "registered");
  assertEquals(normalized.event?.rawStatus, "APPROVED");
  assertEquals(normalized.event?.rsvpCount, 2);
});

Deno.test("normalizePartifulSnapshot accepts direct live viewer RSVP state", () => {
  const normalized = normalizePartifulSnapshot({
    event: {
      ref: { id: "bETmU06uq4TtORng6I1l" },
      title: "Engineering Leaders After Hours",
    },
    viewerRsvp: {
      approvalStatus: "WAITLISTED_FOR_APPROVAL",
    },
  });

  assertEquals(normalized.errors, []);
  assertEquals(normalized.event?.partifulId, "bETmU06uq4TtORng6I1l");
  assertEquals(normalized.event?.status, "waitlisted");
  assertEquals(normalized.event?.rawStatus, "WAITLISTED_FOR_APPROVAL");
});

Deno.test("normalizePartifulSnapshot accepts Firebase callable Partiful responses", () => {
  const normalized = normalizePartifulSnapshot({
    result: {
      data: {
        event: {
          publicShortUrl: "https://partiful.com/e/abc123def",
          title: "Callable Event",
        },
        viewerGuest: {
          status: "PENDING_APPROVAL",
        },
      },
    },
  });

  assertEquals(normalized.errors, []);
  assertEquals(normalized.event?.partifulId, "abc123def");
  assertEquals(normalized.event?.status, "applied");
  assertEquals(normalized.event?.source, "partiful_callable_payload");
});
