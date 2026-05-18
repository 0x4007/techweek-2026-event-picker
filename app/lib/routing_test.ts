import {
  buildOperationalRoute,
  type OperationalRouteEvent,
  routeBetween,
  type RoutePoint,
  type SubwayStation,
} from "./routing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const flatiron: RoutePoint = {
  name: "Flatiron",
  lat: 40.7408301,
  lon: -73.9868072,
};

const madisonSquare: RoutePoint = {
  name: "Madison Square",
  lat: 40.7459513,
  lon: -73.984086,
};

Deno.test("routeBetween returns short walks without calling subway APIs", async () => {
  let fetchCount = 0;
  const route = await routeBetween(flatiron, madisonSquare, {
    fetcher: () => {
      fetchCount += 1;
      throw new Error("unexpected network call");
    },
  });

  assert(route.mode === "walk", `Expected walk route; got ${route.mode}.`);
  assert(fetchCount === 0, `Expected no network calls; got ${fetchCount}.`);
});

Deno.test("routeBetween uses a conservative transit fallback when SubwayInfo is rate-limited", async () => {
  const stations: SubwayStation[] = [
    { id: "HOME", name: "Fulton St", lat: 40.709416, lon: -74.006571, lines: ["2", "3"] },
    { id: "BRY", name: "42 St-Bryant Park", lat: 40.754184, lon: -73.984591, lines: ["B", "D"] },
  ];
  const route = await routeBetween(
    { name: "Home", lat: 40.7084297, lon: -74.0056635 },
    { name: "Bryant Park", lat: 40.7537509, lon: -73.9835428 },
    {
      stations,
      fetcher: () => Promise.resolve(new Response("Too Many Requests", { status: 429 })),
    },
  );

  assert(route.mode === "subway+walk", `Expected transit fallback; got ${route.mode}.`);
  assert(route.risk === "transit_estimated", `Expected estimated transit risk; got ${route.risk}.`);
  assert(route.minutes >= 30, `Expected a conservative travel reserve; got ${route.minutes}.`);
});

Deno.test("routeBetween uses a conservative transit fallback when station loading is rate-limited", async () => {
  const route = await routeBetween(
    { name: "Home", lat: 40.7084297, lon: -74.0056635 },
    { name: "Bryant Park", lat: 40.7537509, lon: -73.9835428 },
    {
      fetcher: () => Promise.resolve(new Response("Too Many Requests", { status: 429 })),
    },
  );

  assert(route.mode === "subway+walk", `Expected transit fallback; got ${route.mode}.`);
  assert(route.risk === "transit_estimated", `Expected estimated transit risk; got ${route.risk}.`);
  assert(route.minutes >= 30, `Expected a conservative travel reserve; got ${route.minutes}.`);
});

Deno.test("buildOperationalRoute keeps shortened overlapping events valid", async () => {
  const events: OperationalRouteEvent[] = [
    {
      id: "first",
      name: "First event",
      point: { name: "Home", lat: 40.7084297, lon: -74.0056635 },
      start: "2026-06-01 10:00",
      end: "2026-06-01 11:00",
      location: "Home",
    },
    {
      id: "second",
      name: "Second event",
      point: { name: "Bryant Park", lat: 40.7537509, lon: -73.9835428 },
      start: "2026-06-01 10:10",
      end: "2026-06-01 11:10",
      location: "Bryant Park",
    },
  ];

  const rows = await buildOperationalRoute(events, {
    routeIds: ["first", "second"],
    includeMeals: false,
    includeSleep: false,
    stations: [],
  });
  const firstEvent = rows.find((row) => row.entryType === "event" && row.techweekId === "TW-first");

  assert(firstEvent, "Expected first event row.");
  for (const row of rows) {
    assert(
      row.end.getTime() >= row.start.getTime(),
      `${row.title} has end before start.`,
    );
  }
  assert(
    firstEvent.note.includes("route overlap is infeasible"),
    `Expected infeasible overlap note; got ${firstEvent.note}.`,
  );
});
