import {
  type CalendarRow,
  displayLocationForVenue,
  eventKeyFromUrl,
  foldIcsLine,
  formatCsvRows,
  parseCsvRecords,
  statusLocationIsExact,
  writeOutputs,
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

Deno.test("statusLocationIsExact recognizes exact freeform Partiful addresses", () => {
  if (
    !statusLocationIsExact(
      "Materialize Offices, 436 Lafayette St, Floor 6, New York, NY 10003",
    )
  ) {
    throw new Error("Expected exact Materialize address to be treated as exact.");
  }
  if (statusLocationIsExact("New York, NY")) {
    throw new Error("Expected generic city venue to stay non-exact.");
  }
});

Deno.test("displayLocationForVenue does not let generic revealed venues hide exact queries", () => {
  const display = displayLocationForVenue(
    "New York, NY",
    "SoHo",
    "Materialize Offices, 436 Lafayette St, Floor 6, New York, NY 10003",
    "exact_from_partiful_freeform",
  );
  if (display !== "Materialize Offices, 436 Lafayette St, Floor 6, New York, NY 10003") {
    throw new Error(`Unexpected display location: ${display}`);
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

Deno.test("writeOutputs creates documented signed-up calendar artifacts", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const outputDir = new URL(`file://${tempDir.replaceAll("\\", "/")}/`);
    const paths = {
      md: new URL("techweek_signed_up_transport_schedule.md", outputDir),
      csv: new URL("techweek_signed_up_transport_schedule.csv", outputDir),
      xlsx: new URL("techweek_signed_up_transport_schedule.xlsx", outputDir),
      scheduleIcs: new URL("techweek_signed_up_operational_with_travel.ics", outputDir),
      allRsvpIcs: new URL("techweek_signed_up_all_rsvps_reference.ics", outputDir),
      appleScript: new URL("sync/sync_techweek_to_apple_calendar.applescript", outputDir),
    };
    const row = calendarRow("schedule");
    const referenceRow = calendarRow("reference");
    const artifacts = {
      events: [],
      scheduleRows: [row],
      allReferenceRows: [referenceRow],
      referenceRows: [referenceRow],
      combinedRows: [row, referenceRow],
    } satisfies Parameters<typeof writeOutputs>[0];

    await writeOutputs(artifacts, paths);

    for (const path of Object.values(paths)) {
      const stat = await Deno.stat(path);
      if (!stat.isFile || stat.size === 0) {
        throw new Error(`Expected non-empty artifact at ${path}`);
      }
    }
    const xlsx = await Deno.readFile(paths.xlsx);
    if (
      xlsx[0] !== 0x50 || xlsx[1] !== 0x4b || xlsx[2] !== 0x03 || xlsx[3] !== 0x04
    ) {
      throw new Error("Expected XLSX artifact to be a ZIP package.");
    }
    const appleScript = await Deno.readTextFile(paths.appleScript);
    if (!appleScript.includes('tell application "Calendar"')) {
      throw new Error(`Expected AppleScript Calendar sync body, got ${appleScript}`);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

function calendarRow(calendar: "schedule" | "reference"): CalendarRow {
  return {
    calendar,
    techweekId: "TW-1",
    calendarBlockId: `TW-1-${calendar.toUpperCase()}`,
    partifulId: "abc",
    sourceEventId: "1",
    entryType: "event" as const,
    status: "registered",
    category: "primary",
    start: new Date(Date.UTC(2026, 5, 1, 14, 0, 0)),
    end: new Date(Date.UTC(2026, 5, 1, 15, 0, 0)),
    actualStart: new Date(Date.UTC(2026, 5, 1, 14, 0, 0)),
    actualEnd: new Date(Date.UTC(2026, 5, 1, 15, 0, 0)),
    title: "[REG] Example Event",
    location: "New York, NY",
    venueQuery: "New York, NY",
    venuePrecision: "test",
    routeMode: "",
    travelMinutes: "",
    routeDetails: "",
    subwaySegments: "",
    transitRisk: "",
    note: "note",
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
  };
}
