import {
  buildPlannerPlan,
  emptyPlannerState,
  parsePlannerEventSource,
  type PlannerImport,
  updatePlannerProfile,
} from "./general_planner.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parsePlannerEventSource imports CSV events", () => {
  const parsed = parsePlannerEventSource({
    importId: "import_test",
    name: "Test CSV",
    sourceType: "csv",
    sourceText:
      "title,start,end,location,score\nDemo Day,2026-06-01 10:00,2026-06-01 11:00,Main Hall,80\nDinner,2026-06-01 18:00,2026-06-01 20:00,Loft,70",
  });

  assert(parsed.events.length === 2, "Expected two imported CSV events.");
  assert(parsed.events[0].title === "Demo Day", "Expected CSV title mapping.");
  assert(parsed.events[0].priorityScore === 80, "Expected numeric score mapping.");
  assert(parsed.warnings.length === 0, "Expected no warnings for complete CSV.");
});

Deno.test("parsePlannerEventSource imports dated plain-text events", () => {
  const parsed = parsePlannerEventSource({
    importId: "text_test",
    name: "Text",
    sourceType: "text",
    sourceText: "2026-06-02 9:30am-10:30am Founder breakfast @ Cafe\nNo date here",
  });

  assert(parsed.events.length === 1, "Expected one parsed text event.");
  assert(parsed.events[0].title === "Founder breakfast", "Expected plain-text title cleanup.");
  assert(parsed.events[0].location === "Cafe", "Expected location extraction.");
  assert(parsed.warnings.length === 1, "Expected a warning for the unparseable line.");
});

Deno.test("buildPlannerPlan generates sleep, meals, and transportation", async () => {
  const state = emptyPlannerState("planner_test", "2026-05-19T12:00:00Z");
  const parsed = parsePlannerEventSource({
    importId: "import_plan",
    name: "Plan CSV",
    sourceType: "csv",
    sourceText:
      "title,start,end,location,score\nMorning session,2026-06-01 10:00,2026-06-01 11:00,Hall A,80\nEvening mixer,2026-06-01 18:00,2026-06-01 20:00,Hall B,90",
  });
  const plannerImport: PlannerImport = {
    id: "import_plan",
    name: "Plan CSV",
    sourceType: "csv",
    sourceText: "",
    events: parsed.events,
    warnings: parsed.warnings,
    createdAt: "2026-05-19T12:00:00Z",
  };
  state.imports = [plannerImport];

  const plan = await buildPlannerPlan({ state, generatedAt: "2026-05-19T12:00:00Z" });

  assert(plan.summary.selectedEvents >= 1, "Expected selected imported events.");
  assert(plan.summary.travelBlocks >= 1, "Expected generated transportation.");
  assert(plan.summary.eatingBlocks >= 1, "Expected generated meals.");
  assert(plan.summary.sleepingBlocks >= 1, "Expected generated sleep.");
});

Deno.test("buildPlannerPlan uses profile priority prompts for overlapping events", async () => {
  const state = emptyPlannerState("priority_test", "2026-05-19T12:00:00Z");
  state.profile = updatePlannerProfile(state.profile, {
    priorityPrompt: "AI infrastructure",
  }, "2026-05-19T12:00:00Z");
  const parsed = parsePlannerEventSource({
    importId: "priority_import",
    name: "Priority CSV",
    sourceType: "csv",
    sourceText:
      "title,start,end,location\nAI infrastructure roundtable,2026-06-01 14:00,2026-06-01 15:00,Hall A\nConsumer brand meetup,2026-06-01 14:00,2026-06-01 15:00,Hall B",
  });
  state.imports = [{
    id: "priority_import",
    name: "Priority CSV",
    sourceType: "csv",
    sourceText: "",
    events: parsed.events,
    warnings: parsed.warnings,
    createdAt: "2026-05-19T12:00:00Z",
  }];

  const plan = await buildPlannerPlan({ state, generatedAt: "2026-05-19T12:00:00Z" });
  const selectedTitles = plan.blocks.filter((block) => block.type === "event").map((block) =>
    block.title
  );

  assert(
    selectedTitles.includes("AI infrastructure roundtable"),
    `Expected priority-matching event to be selected, got ${selectedTitles.join(", ")}`,
  );
  assert(
    !selectedTitles.includes("Consumer brand meetup"),
    "Expected overlapping lower-priority event to be dropped.",
  );
});

Deno.test("buildPlannerPlan preserves researched trip logistics without replanning them as events", async () => {
  const state = emptyPlannerState("trip_test", "2026-05-19T12:00:00Z");
  const sourceText = [
    "title,start,end,location,description,status,score,category",
    '"Sleep block after race","2026-05-24 22:30","2026-05-25 07:30","Indianapolis hotel","Protect recovery before travel home.","planned",0.88,"sleep"',
    '"Breakfast + hotel checkout","2026-05-25 08:00","2026-05-25 10:00","Indianapolis hotel","Breakfast, pack, checkout.","planned",0.7,"meal"',
    '"Transfer to IND airport","2026-05-25 10:30","2026-05-25 11:15","Downtown Indianapolis to IND","Airport transfer buffer.","planned",0.74,"logistics"',
    '"Flight Indianapolis to NYC","2026-05-25 13:00","2026-05-25 15:15","Indianapolis International Airport to NYC-area airport","Assumed return flight.","planned",0.78,"flight"',
    '"Return airport to Manhattan","2026-05-25 15:15","2026-05-25 16:45","NYC-area airport to Manhattan, New York City","Buffer for bags and Memorial Day traffic.","planned",0.72,"logistics"',
  ].join("\n");
  const parsed = parsePlannerEventSource({
    importId: "trip_import",
    name: "Trip CSV",
    sourceType: "csv",
    sourceText,
  });
  state.imports = [{
    id: "trip_import",
    name: "Trip CSV",
    sourceType: "csv",
    sourceText,
    events: parsed.events,
    warnings: parsed.warnings,
    createdAt: "2026-05-19T12:00:00Z",
  }];

  const plan = await buildPlannerPlan({ state, generatedAt: "2026-05-19T12:00:00Z" });
  const selectedEventTitles = plan.blocks.filter((block) => block.type === "event").map((block) =>
    block.title
  );
  const fixedTitles = plan.blocks.filter((block) => block.source === "fixed_schedule").map((
    block,
  ) => block.title);
  const generatedTitles = plan.blocks.filter((block) => block.source === "generated_logistics")
    .map((block) => block.title);

  assert(
    selectedEventTitles.includes("Flight Indianapolis to NYC"),
    `Expected the flight commitment to remain selectable, got ${selectedEventTitles.join(", ")}`,
  );
  assert(
    !selectedEventTitles.includes("Sleep block after race"),
    "Expected researched sleep to be preserved as fixed logistics, not selected as an event.",
  );
  assert(
    fixedTitles.includes("Return airport to Manhattan"),
    `Expected explicit return logistics to be preserved, got ${fixedTitles.join(", ")}`,
  );
  assert(
    !plan.blocks.some((block) =>
      block.type === "travel" && block.title.includes("Indianapolis hotel -> Home")
    ),
    "Expected explicit trip-home logistics to suppress automatic daily return-home travel.",
  );
  assert(
    generatedTitles.length === 0,
    `Expected researched logistics import not to get duplicate generated routines, got ${
      generatedTitles.join(", ")
    }`,
  );
});
