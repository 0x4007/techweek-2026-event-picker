import {
  eventKeyFromUrl,
  foldIcsLine,
  formatCsvRows,
  parseCsvRecords,
} from "./build_signed_up_calendar.ts";

Deno.test("parseCsvRecords handles quoted commas, quotes, and newlines", () => {
  const rows = parseCsvRecords('\ufeffname,note\n"Alpha, Inc.","line 1\nline ""2"""\n');
  if (rows.length !== 1) {
    throw new Error(`Expected one row, got ${rows.length}`);
  }
  if (rows[0].name !== "Alpha, Inc.") {
    throw new Error(`Unexpected name: ${rows[0].name}`);
  }
  if (rows[0].note !== 'line 1\nline "2"') {
    throw new Error(`Unexpected note: ${JSON.stringify(rows[0].note)}`);
  }
});

Deno.test("eventKeyFromUrl extracts Partiful event ids", () => {
  const key = eventKeyFromUrl("https://partiful.com/e/OF1vP5L8dtXKRtInyWKs?c=s6u4EYds");
  if (key !== "OF1vP5L8dtXKRtInyWKs") {
    throw new Error(`Unexpected key: ${key}`);
  }
});

Deno.test("formatCsvRows emits the signed-up schedule header order", () => {
  const csv = formatCsvRows([
    {
      calendar: "schedule",
      techweekId: "TW-1",
      calendarBlockId: "TW-1-SCHEDULE",
      partifulId: "abc",
      sourceEventId: "1",
      entryType: "event",
      status: "registered",
      category: "primary",
      start: new Date(Date.UTC(2026, 5, 1, 14, 0, 0)),
      end: new Date(Date.UTC(2026, 5, 1, 15, 0, 0)),
      actualStart: new Date(Date.UTC(2026, 5, 1, 14, 0, 0)),
      actualEnd: new Date(Date.UTC(2026, 5, 1, 15, 0, 0)),
      title: "[REG] Example, Event",
      location: "New York, NY",
      venueQuery: "New York, NY",
      venuePrecision: "test",
      routeMode: "",
      travelMinutes: "",
      routeDetails: "",
      subwaySegments: "",
      transitRisk: "",
      note: 'quoted "note"',
      salesCoaching: "",
      rank: "1",
      tier: "S",
      opportunityScore: "100",
      fitSummary: "",
      eventUrl: "https://partiful.com/e/abc",
      googleMapsUrl: "",
      statusLabel: "REG",
      categoryLabel: "PRIMARY",
      nextStep: "",
      notes: "",
    },
  ]);
  if (!csv.startsWith("\ufeffcalendar,techweek_id,calendar_block_id,partiful_id,rerank_id")) {
    throw new Error(`Unexpected CSV header: ${csv.split("\n")[0]}`);
  }
  if (!csv.includes('"[REG] Example, Event"') || !csv.includes('"quoted ""note"""')) {
    throw new Error(`CSV did not quote fields correctly: ${csv}`);
  }
});

Deno.test("foldIcsLine folds long UTF-8 lines", () => {
  const folded = foldIcsLine(`SUMMARY:${"A".repeat(90)}`);
  if (folded.length < 2) {
    throw new Error("Expected folded line");
  }
  if (!folded[1].startsWith(" ")) {
    throw new Error("Expected continuation line to start with a space");
  }
});
