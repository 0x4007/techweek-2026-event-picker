#!/usr/bin/env python3
"""Create a transit-aware Tech Week schedule from the reranked events.

Routing sources:
- Nominatim/OpenStreetMap for geocoding exact venues.
- Fixed neighborhood centroids for hidden Partiful venues.
- SubwayInfo.nyc station and trip REST endpoints for subway estimates.
"""

from __future__ import annotations

import csv
import datetime as dt
import html
import json
import math
import re
import time
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from xml.sax.saxutils import escape


RERANK_CSV = Path("techweek_nyc_accolades_full_rerank.csv")
OUTPUT_CSV = Path("techweek_nyc_accolades_detailed_calendar.csv")
OUTPUT_MD = Path("techweek_nyc_accolades_detailed_calendar.md")
OUTPUT_XLSX = Path("techweek_nyc_accolades_detailed_calendar.xlsx")
PRIMARY_ICS = Path("techweek_nyc_accolades_primary_with_travel.ics")
APPLY_ICS = Path("techweek_nyc_accolades_apply_tentative.ics")
BACKUP_ICS = Path("techweek_nyc_accolades_backups_tentative.ics")

GEOCODE_CACHE = Path("techweek_location_geocode_cache.json")
STATION_CACHE = Path("nyc_subway_stations_cache.json")
TRIP_CACHE = Path("techweek_subway_trip_cache.json")
OSRM_CACHE = Path("techweek_osrm_foot_cache.json")

TZID = "America/New_York"
USER_AGENT = "techweek-2026-event-picker/1.0 (local planning script)"

HOME = {
    "id": "home_fidi",
    "name": "FiDi home base",
    "location": "Financial District",
    "venue_query": "Wall St, New York, NY",
    "address_precision": "approx_fidi_anchor",
    "lat": 40.706821,
    "lon": -74.009100,
}


PRIMARY_PLAN = [
    ("6408", "primary", "go", "Direct AI engineering-practice session near downtown."),
    ("44", "primary", "go_if_energy", "Useful AI-driven development session; easy hop from Flatiron."),
    ("5978", "primary", "go", "Best Monday evening fit for open-source founders, maintainers, and builders."),
    ("4551", "primary", "go_if_energy", "Enterprise SDLC context before the stronger Tuesday afternoon/evening block."),
    ("4341", "primary", "go", "Most explicit buyer fit: CTOs, VPs Engineering, Heads of Platform, senior engineers, developer productivity, AI adoption."),
    ("4161", "primary", "go", "Anchor event for engineers, technical leads, and founders discussing how teams write, review, ship, and maintain code."),
    ("5889", "primary", "optional", "Technical builder session; useful but skippable if you need a slower Wednesday start."),
    ("4444", "primary", "go", "Coding agents and IDEs are close to the GitHub/work-evidence wedge."),
    ("5529", "primary", "go", "Strong product-fit topic around LLM users, tool schemas, docs, guardrails, and engineering knowledge."),
    ("4664", "primary", "go", "Convenient NoHo/East Village follow-on with MCP ecosystem leaders."),
    ("5372", "primary", "go", "Must-attend: engineering leaders and operators discussing agentic development process."),
    ("5722", "primary", "taper_day", "One Friday event only: autonomous systems and agent orchestration in Union Square."),
]

APPLY_PLAN = [
    ("5437", "apply", "apply_first", "High buyer fit around enterprise AI governance, internal platforms, and production agents; conflicts with Future of DevEx."),
    ("5820", "apply", "apply_first", "Curated AI founder and leader room; if accepted, it replaces most Wednesday daytime open events."),
    ("4719", "apply", "apply_first", "Excellent enterprise-agent reliability/control event in Union Square."),
    ("4778", "apply", "apply_first", "Best explicit CTO / VP Engineering room; prioritize over most Wednesday evening open events if accepted."),
    ("4197", "apply", "apply_if_accepted", "High executive tech density, but Brooklyn adds friction after a crowded Wednesday."),
    ("4183", "apply", "apply_first", "Private engineering/platform/security leader room; excellent direct-buyer fit."),
    ("5114", "apply", "apply_first", "Codebase-as-spec topic is highly aligned; conflicts with Thursday dinner paths."),
    ("5231", "apply", "apply_first", "Small off-record dinner with engineering/product leaders, operators, and AI infrastructure founders."),
    ("250", "apply", "apply_if_energy", "Good technical AI salon, but Friday Brooklyn is a stretch after the main week."),
]

BACKUP_PLAN = [
    ("5962", "backup", "same_time_backup", "Strong technical founder room, but less directly Accolades-shaped than Open Source Must Win."),
    ("4522", "backup", "same_time_backup", "Excellent enterprise AI control-plane audience, but conflicts with Visdom."),
    ("5925", "backup", "same_time_backup", "Good infra-brand density, but Future of DevEx is more directly aligned."),
    ("5693", "backup", "same_time_backup", "Strong brands and possible VP Eng density, but Midtown conflicts with the downtown MCP route."),
    ("4191", "backup", "skip_unless_shipping_full", "Strong event, but it overlaps the higher-priority Shipping Faster panel."),
    ("5207", "backup", "late_backup", "Late casual founder/builder option if Thursday energy is still good and no curated dinner lands."),
]

MANUAL_DURATIONS = {
    "6408": 60,
    "44": 60,
    "5978": 180,
    "5962": 180,
    "4551": 105,
    "4341": 90,
    "4161": 180,
    "4522": 180,
    "5925": 120,
    "5889": 75,
    "4444": 60,
    "5529": 75,
    "4664": 150,
    "5693": 120,
    "5372": 180,
    "4191": 120,
    "5722": 180,
    "5437": 90,
    "5820": 210,
    "4719": 300,
    "4778": 120,
    "4197": 120,
    "4183": 180,
    "5114": 105,
    "5231": 120,
    "5207": 90,
    "250": 180,
}

NEIGHBORHOOD_HINTS = {
    "Financial District": "Wall St, New York, NY",
    "Flatiron": "23rd Street and Broadway, New York, NY",
    "Union Square": "Union Square, Manhattan, New York, NY",
    "Lower East Side": "Delancey St Essex St, New York, NY",
    "Midtown": "Bryant Park, New York, NY",
    "SoHo": "Spring St and Broadway, New York, NY",
    "Chelsea": "23rd Street and 8th Avenue, New York, NY",
    "Nomad": "28th Street and Broadway, New York, NY",
    "NoHo": "Broadway-Lafayette St, New York, NY",
    "East Village": "Astor Place, New York, NY",
    "West Village": "West 4th Street Washington Square, New York, NY",
    "Greenwich Village": "West 4th Street Washington Square, New York, NY",
    "Tribeca": "Chambers St, New York, NY",
    "Brooklyn": "Barclays Center, Brooklyn, NY",
}

NEIGHBORHOOD_POINTS = {
    "Financial District": (40.706821, -74.009100),
    "Flatiron": (40.740830, -73.986807),
    "Union Square": (40.735736, -73.990568),
    "Lower East Side": (40.718618, -73.988136),
    "Midtown": (40.753751, -73.983543),
    "SoHo": (40.724329, -73.997702),
    "Chelsea": (40.744081, -73.999562),
    "Nomad": (40.745800, -73.988800),
    "NoHo": (40.725297, -73.996204),
    "East Village": (40.729850, -73.991390),
    "West Village": (40.732338, -74.000495),
    "Greenwich Village": (40.732338, -74.000495),
    "Tribeca": (40.715478, -74.009266),
    "Brooklyn": (40.682511, -73.975252),
    "Hudson Yards": (40.754346, -74.002094),
}


@dataclass
class Point:
    name: str
    query: str
    precision: str
    lat: float
    lon: float


def read_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def http_json(url: str) -> tuple[object, dict[str, str]]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        headers = {key.lower(): value for key, value in response.headers.items()}
        return json.loads(response.read().decode("utf-8")), headers


def geocode(query: str, cache: dict[str, dict]) -> dict:
    query = clean_address(query)
    if query in cache:
        return cache[query]
    candidates = [query]
    if "," in query:
        candidates.append(clean_address(query.split(",", 1)[1]))
    if "Avenue" in query:
        candidates.append(clean_address(query.replace("Avenue", "Ave")))
    if " Ave" in query:
        candidates.append(clean_address(re.sub(r"^[^,]+,\s*", "", query)))
    data = []
    used_query = query
    for candidate in dict.fromkeys(candidates):
        params = urllib.parse.urlencode({"q": candidate, "format": "jsonv2", "limit": 1, "countrycodes": "us"})
        url = f"https://nominatim.openstreetmap.org/search?{params}"
        data, _ = http_json(url)
        time.sleep(1.05)
        if data:
            used_query = candidate
            break
    if not data:
        raise RuntimeError(f"Nominatim could not geocode: {query}")
    result = data[0]
    cache[query] = {
        "lat": float(result["lat"]),
        "lon": float(result["lon"]),
        "display_name": result.get("display_name", ""),
        "used_query": used_query,
    }
    write_json(GEOCODE_CACHE, cache)
    return cache[query]


def osrm_foot_minutes(a: Point | dict, b: Point | dict, cache: dict[str, dict]) -> dict:
    key = f"{a['lon'] if isinstance(a, dict) else a.lon:.6f},{a['lat'] if isinstance(a, dict) else a.lat:.6f}->{b['lon'] if isinstance(b, dict) else b.lon:.6f},{b['lat'] if isinstance(b, dict) else b.lat:.6f}"
    if key in cache:
        return cache[key]
    a_lon = a["lon"] if isinstance(a, dict) else a.lon
    a_lat = a["lat"] if isinstance(a, dict) else a.lat
    b_lon = b["lon"] if isinstance(b, dict) else b.lon
    b_lat = b["lat"] if isinstance(b, dict) else b.lat
    straight_m = haversine_meters(a_lat, a_lon, b_lat, b_lon)
    meters = round(straight_m * 1.25)
    result = {"minutes": math.ceil(meters / 80), "meters": meters}
    cache[key] = result
    write_json(OSRM_CACHE, cache)
    return result


def load_stations() -> list[dict]:
    if STATION_CACHE.exists():
        return json.loads(STATION_CACHE.read_text(encoding="utf-8"))
    data, _ = http_json("https://subwayinfo.nyc/api/stations?limit=600")
    STATION_CACHE.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    return data


def haversine_minutes(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    return haversine_meters(a_lat, a_lon, b_lat, b_lon) / 80


def haversine_meters(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    radius_m = 6371000
    phi1 = math.radians(a_lat)
    phi2 = math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlambda = math.radians(b_lon - a_lon)
    value = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius_m * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def nearest_station(point: Point, stations: list[dict]) -> dict:
    return min(stations, key=lambda station: haversine_minutes(point.lat, point.lon, station["lat"], station["lon"]))


def subway_trip(origin: dict, destination: dict, cache: dict[str, dict]) -> dict:
    key = f"{origin['id']}->{destination['id']}"
    if key in cache:
        return cache[key]
    url = (
        "https://subwayinfo.nyc/api/trip?"
        + urllib.parse.urlencode({"origin_station_id": origin["id"], "destination_station_id": destination["id"]})
    )
    data, headers = http_json(url)
    if "estimatedMinutes" not in data:
        raise RuntimeError(f"SubwayInfo trip failed for {key}: {data}")
    result = {
        "estimatedMinutes": data["estimatedMinutes"],
        "numTransfers": data.get("numTransfers"),
        "totalStops": data.get("totalStops"),
        "riskLabel": data.get("disruptionAnalysis", {}).get("riskLabel", ""),
        "segments": [
            f"{segment.get('line')} {segment.get('fromStationName')} to {segment.get('toStationName')}"
            for segment in data.get("segments", [])
        ],
    }
    cache[key] = result
    write_json(TRIP_CACHE, cache)
    reset = int(headers.get("x-ratelimit-reset", "0") or 0)
    remaining = int(headers.get("x-ratelimit-remaining", "1") or 1)
    if remaining <= 1 and reset:
        time.sleep(max(1, reset - int(time.time()) + 1))
    else:
        time.sleep(6.2)
    return result


def clean_address(address: str) -> str:
    address = html.unescape(address)
    address = re.sub(r"\bFL\s+\d+\b", "", address, flags=re.I)
    address = re.sub(r"\s+", " ", address)
    address = re.sub(r"\s+,", ",", address)
    return address.strip(" ,")


def raw_decode_after(text: str, marker: str):
    index = text.find(marker)
    if index == -1:
        return None
    start = index + len(marker)
    try:
        value, _ = json.JSONDecoder().raw_decode(text[start:])
        return value
    except json.JSONDecodeError:
        return None


def jsonld_event(html_text: str) -> dict:
    for match in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html_text, flags=re.S):
        try:
            value = json.loads(html.unescape(match.group(1)))
        except json.JSONDecodeError:
            continue
        values = value if isinstance(value, list) else [value]
        for item in values:
            if isinstance(item, dict) and item.get("@type") == "Event":
                return item
    return {}


def local_dt_from_utc(value: str) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (parsed - dt.timedelta(hours=4)).replace(tzinfo=None)


def parse_start(row: dict[str, str]) -> dt.datetime:
    year, month, day = [int(part) for part in row["date"].split("-")]
    hour, minute, second = [int(part) for part in row["time"].split(":")]
    return dt.datetime(year, month, day, hour, minute, second)


def extract_venue(row: dict[str, str], geocode_cache: dict[str, dict]) -> tuple[Point, dict]:
    html_text = Path(row["local_html_path"]).read_text(errors="ignore") if row.get("local_html_path") else ""
    event_json = jsonld_event(html_text)
    loc = event_json.get("location", {}) if isinstance(event_json, dict) else {}
    venue_name = ""
    address = ""
    precision = "approx_neighborhood"

    if isinstance(loc, dict):
        venue_name = str(loc.get("name") or "")
        address_value = loc.get("address") or ""
        if isinstance(address_value, dict):
            address = ", ".join(str(address_value.get(key, "")) for key in ["streetAddress", "addressLocality", "addressRegion", "postalCode"] if address_value.get(key))
        else:
            address = str(address_value)

    if address and re.search(r"\d", address) and "new york" in address.lower():
        query = clean_address(address)
        if venue_name and venue_name.lower() not in {"new york, ny", "new york"}:
            query = f"{venue_name}, {query}"
        precision = "exact_from_event_page"
    else:
        loc_info = raw_decode_after(html_text, '"locationInfo":')
        maps_info = loc_info.get("mapsInfo", {}) if isinstance(loc_info, dict) else {}
        if isinstance(maps_info, dict):
            venue_name = venue_name or str(maps_info.get("name") or "")
            address_lines = maps_info.get("addressLines") or []
            joined = ", ".join(address_lines)
            if joined and re.search(r"\d", joined) and "NY" in joined:
                query = clean_address(joined)
                if venue_name and venue_name.lower() not in {"new york, ny", "new york"}:
                    query = f"{venue_name}, {query}"
                precision = "exact_from_partiful_maps"
            else:
                query = NEIGHBORHOOD_HINTS.get(row["location"], f"{row['location']}, Manhattan, NY")
                precision = "approx_neighborhood_hidden"
        elif isinstance(loc_info, dict) and loc_info.get("type") == "freeform":
            query = NEIGHBORHOOD_HINTS.get(row["location"], f"{row['location']}, Manhattan, NY")
            precision = "approx_freeform_hidden"
        else:
            query = NEIGHBORHOOD_HINTS.get(row["location"], f"{row['location']}, Manhattan, NY")
            precision = "approx_from_calendar_location"

    if precision.startswith("approx") and row["location"] in NEIGHBORHOOD_POINTS:
        lat, lon = NEIGHBORHOOD_POINTS[row["location"]]
        point = Point(name=row["name"], query=query, precision=precision, lat=lat, lon=lon)
    else:
        geo = geocode(query, geocode_cache)
        point = Point(name=row["name"], query=query, precision=precision, lat=geo["lat"], lon=geo["lon"])
    start = parse_start(row)
    end = start + dt.timedelta(minutes=MANUAL_DURATIONS.get(row["id"], 90))
    return point, {"venue_query": query, "venue_precision": precision, "start": start, "end": end}


def route_between(origin: Point | dict, destination: Point, stations: list[dict], trip_cache: dict, osrm_cache: dict) -> dict:
    direct_walk = osrm_foot_minutes(origin, destination, osrm_cache)
    origin_point = Point(origin["name"], origin["venue_query"], origin["address_precision"], origin["lat"], origin["lon"]) if isinstance(origin, dict) else origin
    destination_point = Point(destination["name"], destination["venue_query"], destination["address_precision"], destination["lat"], destination["lon"]) if isinstance(destination, dict) else destination
    origin_station = nearest_station(origin_point, stations)
    destination_station = nearest_station(destination_point, stations)
    walk_to_station = osrm_foot_minutes(origin_point, origin_station, osrm_cache)
    walk_from_station = osrm_foot_minutes(destination_station, destination_point, osrm_cache)
    if origin_station["id"] == destination_station["id"]:
        subway = {"estimatedMinutes": 0, "numTransfers": 0, "totalStops": 0, "riskLabel": "", "segments": []}
    else:
        subway = subway_trip(origin_station, destination_station, trip_cache)

    subway_total = walk_to_station["minutes"] + subway["estimatedMinutes"] + walk_from_station["minutes"] + 5
    if direct_walk["minutes"] <= subway_total - 5 or (
        direct_walk["minutes"] <= 25 and direct_walk["minutes"] <= subway_total + 8
    ):
        return {
            "mode": "walk",
            "minutes": direct_walk["minutes"],
            "details": f"Walk approx {direct_walk['minutes']} min / {direct_walk['meters']} m using OSM-geocoded points.",
            "from_station": "",
            "to_station": "",
            "subway_segments": "",
            "risk": "",
        }
    return {
        "mode": "subway+walk",
        "minutes": subway_total,
        "details": (
            f"Walk {walk_to_station['minutes']} min to {origin_station['name']} "
            f"({'/'.join(origin_station['lines'])}); subway {subway['estimatedMinutes']} min; "
            f"walk {walk_from_station['minutes']} min from {destination_station['name']} "
            f"({'/'.join(destination_station['lines'])}); includes 5 min buffer."
        ),
        "from_station": f"{origin_station['name']} ({'/'.join(origin_station['lines'])})",
        "to_station": f"{destination_station['name']} ({'/'.join(destination_station['lines'])})",
        "subway_segments": "; ".join(subway.get("segments", [])),
        "risk": subway.get("riskLabel", ""),
    }


def load_events() -> dict[str, dict[str, str]]:
    with RERANK_CSV.open(newline="", encoding="utf-8-sig") as f:
        return {row["id"]: row for row in csv.DictReader(f)}


def build_events() -> tuple[list[dict], dict[str, Point]]:
    events_by_id = load_events()
    geocode_cache = read_json(GEOCODE_CACHE, {})
    selected = []
    points = {}
    for event_id, bucket, decision, note in PRIMARY_PLAN + APPLY_PLAN + BACKUP_PLAN:
        row = events_by_id[event_id]
        point, meta = extract_venue(row, geocode_cache)
        points[event_id] = point
        selected.append(
            {
                **row,
                "bucket": bucket,
                "decision": decision,
                "schedule_note": note,
                "start_dt": meta["start"],
                "end_dt": meta["end"],
                "venue_query": meta["venue_query"],
                "venue_precision": meta["venue_precision"],
                "lat": point.lat,
                "lon": point.lon,
            }
        )
    selected.sort(key=lambda row: (row["start_dt"], {"primary": 0, "apply": 1, "backup": 2}[row["bucket"]]))
    return selected, points


def build_primary_with_travel(events: list[dict], points: dict[str, Point]) -> list[dict]:
    stations = load_stations()
    trip_cache = read_json(TRIP_CACHE, {})
    osrm_cache = read_json(OSRM_CACHE, {})
    primary_events = [event for event in events if event["bucket"] == "primary"]
    output: list[dict] = []
    by_day: dict[str, list[dict]] = {}
    for event in primary_events:
        by_day.setdefault(event["date"], []).append(event)

    for _, day_events in sorted(by_day.items()):
        previous_point: Point | dict = HOME
        previous_event: dict | None = None
        for event in sorted(day_events, key=lambda row: row["start_dt"]):
            point = points[event["id"]]
            route = route_between(previous_point, point, stations, trip_cache, osrm_cache)
            travel_minutes = route["minutes"]
            travel_end = event["start_dt"]
            travel_start = travel_end - dt.timedelta(minutes=travel_minutes)
            conflict_note = ""
            if previous_event is not None and previous_event["end_dt"] > travel_start:
                overlap = math.ceil((previous_event["end_dt"] - travel_start).total_seconds() / 60)
                conflict_note = f"Leave previous event {overlap} min before scheduled end."
                travel_start = previous_event["end_dt"] - dt.timedelta(minutes=travel_minutes)
                travel_end = previous_event["end_dt"]
            if travel_minutes > 0:
                output.append(
                    {
                        "entry_type": "travel",
                        "bucket": "primary",
                        "start_dt": travel_start,
                        "end_dt": travel_end,
                        "title": f"Travel to {event['name']}",
                        "location": f"{previous_point['name'] if isinstance(previous_point, dict) else previous_point.name} -> {event['location']}",
                        "event_id": event["id"],
                        "event_url": event["event_url"],
                        "route_mode": route["mode"],
                        "travel_minutes": travel_minutes,
                        "route_details": route["details"],
                        "subway_segments": route["subway_segments"],
                        "transit_risk": route["risk"],
                        "note": conflict_note,
                        "venue_precision": event["venue_precision"],
                        "venue_query": event["venue_query"],
                        "rank": event["rank"],
                        "tier": event["tier"],
                        "opportunity_score": event["opportunity_score"],
                    }
                )
            output.append(
                {
                    "entry_type": "event",
                    "bucket": "primary",
                    "start_dt": event["start_dt"],
                    "end_dt": event["end_dt"],
                    "title": event["name"],
                    "location": event["location"],
                    "event_id": event["id"],
                    "event_url": event["event_url"],
                    "route_mode": "",
                    "travel_minutes": "",
                    "route_details": "",
                    "subway_segments": "",
                    "transit_risk": "",
                    "note": event["schedule_note"],
                    "venue_precision": event["venue_precision"],
                    "venue_query": event["venue_query"],
                    "rank": event["rank"],
                    "tier": event["tier"],
                    "opportunity_score": event["opportunity_score"],
                    "fit_summary": event["fit_summary"],
                }
            )
            previous_point = point
            previous_event = event
        route = route_between(previous_point, HOME, stations, trip_cache, osrm_cache)
        travel_start = previous_event["end_dt"]
        travel_end = travel_start + dt.timedelta(minutes=route["minutes"])
        output.append(
            {
                "entry_type": "travel",
                "bucket": "primary",
                "start_dt": travel_start,
                "end_dt": travel_end,
                "title": "Travel back to FiDi",
                "location": f"{previous_point.name} -> FiDi home base",
                "event_id": "",
                "event_url": "",
                "route_mode": route["mode"],
                "travel_minutes": route["minutes"],
                "route_details": route["details"],
                "subway_segments": route["subway_segments"],
                "transit_risk": route["risk"],
                "note": "",
                "venue_precision": "approx_fidi_anchor",
                "venue_query": HOME["venue_query"],
                "rank": "",
                "tier": "",
                "opportunity_score": "",
            }
        )
    return output


def event_entries(events: list[dict], bucket: str) -> list[dict]:
    rows = []
    for event in events:
        if event["bucket"] != bucket:
            continue
        rows.append(
            {
                "entry_type": "event",
                "bucket": bucket,
                "start_dt": event["start_dt"],
                "end_dt": event["end_dt"],
                "title": event["name"],
                "location": event["location"],
                "event_id": event["id"],
                "event_url": event["event_url"],
                "route_mode": "",
                "travel_minutes": "",
                "route_details": "Tentative/apply or backup event; compare against the primary route before accepting.",
                "subway_segments": "",
                "transit_risk": "",
                "note": event["schedule_note"],
                "venue_precision": event["venue_precision"],
                "venue_query": event["venue_query"],
                "rank": event["rank"],
                "tier": event["tier"],
                "opportunity_score": event["opportunity_score"],
                "fit_summary": event["fit_summary"],
            }
        )
    return rows


def fmt_time(value: dt.datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def write_csv_output(rows: list[dict]) -> None:
    fieldnames = [
        "entry_type",
        "bucket",
        "start",
        "end",
        "title",
        "location",
        "event_id",
        "rank",
        "tier",
        "opportunity_score",
        "venue_precision",
        "venue_query",
        "route_mode",
        "travel_minutes",
        "route_details",
        "subway_segments",
        "transit_risk",
        "note",
        "event_url",
        "fit_summary",
    ]
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in sorted(rows, key=lambda r: (r["start_dt"], r["bucket"], r["entry_type"])):
            writer.writerow({**row, "start": fmt_time(row["start_dt"]), "end": fmt_time(row["end_dt"])})


def day_sections(rows: list[dict], bucket: str) -> str:
    selected = [row for row in rows if row["bucket"] == bucket]
    selected.sort(key=lambda row: row["start_dt"])
    lines: list[str] = []
    current_date = None
    for row in selected:
        date_label = row["start_dt"].strftime("%A, %Y-%m-%d")
        if date_label != current_date:
            if lines:
                lines.append("")
            lines.append(f"### {date_label}")
            lines.append("")
            current_date = date_label
        time_range = f"{row['start_dt'].strftime('%H:%M')}-{row['end_dt'].strftime('%H:%M')}"
        if row["entry_type"] == "travel":
            lines.append(f"- {time_range} | Travel | {row['route_mode']} | {row['title']}")
            lines.append(f"  - {row['travel_minutes']} min: {row['route_details']}")
            if row["note"]:
                lines.append(f"  - Schedule note: {row['note']}")
        else:
            link = f"[{row['title']}]({row['event_url']})" if row["event_url"] else row["title"]
            lines.append(f"- {time_range} | {row['location']} | {link}")
            lines.append(f"  - {row['note']}")
            lines.append(f"  - Venue: {row['venue_query']} ({row['venue_precision']})")
            lines.append(f"  - Rank {row['rank']}, tier {row['tier']}, score {row['opportunity_score']}; {row.get('fit_summary', '')}")
    return "\n".join(lines).strip()


def write_markdown(rows: list[dict]) -> None:
    contents = [
        "# NYC Tech Week Accolades Transit-Aware Calendar",
        "",
        "Home anchor: FiDi / Wall St station. Routing uses the event page address when available. If Partiful only reveals a neighborhood, the route uses a neighborhood centroid and marks the venue as approximate.",
        "",
        "Routing sources: Nominatim/OpenStreetMap for exact venue geocoding, fixed neighborhood centroids for hidden Partiful venues, local walking estimates from OSM coordinates, and SubwayInfo.nyc for subway station-to-station estimates. SubwayInfo estimates are current-route estimates, not guaranteed June 2026 service schedules.",
        "",
        "## Primary Calendar With Travel",
        "",
        day_sections(rows, "primary"),
        "",
        "## Apply / Curated Targets",
        "",
        "These are worth applying to, but they conflict with parts of the primary calendar and should replace those blocks only if accepted.",
        "",
        day_sections(rows, "apply"),
        "",
        "## Backups",
        "",
        "Use these if a primary event is full, hidden venue is inconvenient, or energy changes.",
        "",
        day_sections(rows, "backup"),
        "",
        "## Files",
        "",
        f"- Import primary calendar: `{PRIMARY_ICS.name}`",
        f"- Import apply/tentative calendar: `{APPLY_ICS.name}`",
        f"- Import backup calendar: `{BACKUP_ICS.name}`",
        f"- Spreadsheet: `{OUTPUT_XLSX.name}`",
        f"- CSV: `{OUTPUT_CSV.name}`",
    ]
    OUTPUT_MD.write_text("\n".join(contents) + "\n", encoding="utf-8")


def escape_ics(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def write_ics(path: Path, rows: list[dict], bucket: str, calendar_name: str) -> None:
    now = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//UbiquityOS//Tech Week Transit Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_ics(calendar_name)}",
        f"X-WR-TIMEZONE:{TZID}",
        "BEGIN:VTIMEZONE",
        f"TZID:{TZID}",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:-0500",
        "TZOFFSETTO:-0400",
        "TZNAME:EDT",
        "DTSTART:19700308T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:-0400",
        "TZOFFSETTO:-0500",
        "TZNAME:EST",
        "DTSTART:19701101T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]
    for row in sorted([r for r in rows if r["bucket"] == bucket], key=lambda r: r["start_dt"]):
        uid = uuid5(NAMESPACE_URL, f"{bucket}-{row['entry_type']}-{row['title']}-{row['start_dt']}")
        prefix = "Travel" if row["entry_type"] == "travel" else {"primary": "Tech Week", "apply": "Apply", "backup": "Backup"}[bucket]
        desc = "\n".join(
            [
                row.get("note", ""),
                row.get("route_details", ""),
                f"Venue: {row.get('venue_query', '')} ({row.get('venue_precision', '')})",
                f"Rank/tier/score: {row.get('rank', '')} / {row.get('tier', '')} / {row.get('opportunity_score', '')}",
                f"URL: {row.get('event_url', '')}",
            ]
        )
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}@techweek-2026-event-picker",
                f"DTSTAMP:{now}",
                f"DTSTART;TZID={TZID}:{row['start_dt'].strftime('%Y%m%dT%H%M%S')}",
                f"DTEND;TZID={TZID}:{row['end_dt'].strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{escape_ics(prefix + ': ' + row['title'])}",
                f"LOCATION:{escape_ics(row.get('venue_query') or row.get('location', ''))}",
                f"DESCRIPTION:{escape_ics(desc)}",
                f"URL:{escape_ics(row.get('event_url', ''))}",
                f"STATUS:{'CONFIRMED' if bucket == 'primary' else 'TENTATIVE'}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    path.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")


def excel_col(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_xml(row_index: int, col_index: int, value) -> str:
    ref = f"{excel_col(col_index)}{row_index}"
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value or "")[:32767])}</t></is></c>'


def write_xlsx(rows: list[dict]) -> None:
    fieldnames = [
        "entry_type",
        "bucket",
        "start",
        "end",
        "title",
        "location",
        "venue_precision",
        "venue_query",
        "route_mode",
        "travel_minutes",
        "route_details",
        "note",
        "rank",
        "tier",
        "opportunity_score",
        "event_url",
    ]
    flat_rows = []
    for row in sorted(rows, key=lambda r: (r["start_dt"], r["bucket"], r["entry_type"])):
        flat_rows.append({**row, "start": fmt_time(row["start_dt"]), "end": fmt_time(row["end_dt"])})
    xml_rows = []
    xml_rows.append("<row r=\"1\">" + "".join(cell_xml(1, i, name) for i, name in enumerate(fieldnames, 1)) + "</row>")
    for row_index, row in enumerate(flat_rows, start=2):
        xml_rows.append("<row r=\"%d\">%s</row>" % (row_index, "".join(cell_xml(row_index, i, row.get(name, "")) for i, name in enumerate(fieldnames, 1))))
    last_col = excel_col(len(fieldnames))
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        '<sheetData>' + "".join(xml_rows) + "</sheetData>"
        f'<autoFilter ref="A1:{last_col}{len(flat_rows)+1}"/>'
        "</worksheet>"
    )
    with zipfile.ZipFile(OUTPUT_XLSX, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Detailed Calendar" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", sheet)


def main() -> None:
    events, points = build_events()
    primary_rows = build_primary_with_travel(events, points)
    rows = primary_rows + event_entries(events, "apply") + event_entries(events, "backup")
    rows.sort(key=lambda row: (row["start_dt"], row["bucket"], row["entry_type"]))
    write_csv_output(rows)
    write_markdown(rows)
    write_ics(PRIMARY_ICS, rows, "primary", "NY Tech Week Accolades - Primary with Travel")
    write_ics(APPLY_ICS, rows, "apply", "NY Tech Week Accolades - Apply Tentative")
    write_ics(BACKUP_ICS, rows, "backup", "NY Tech Week Accolades - Backups")
    write_xlsx(rows)
    print(f"wrote {OUTPUT_MD}")
    print(f"wrote {OUTPUT_CSV}")
    print(f"wrote {OUTPUT_XLSX}")
    print(f"wrote {PRIMARY_ICS}")
    print(f"wrote {APPLY_ICS}")
    print(f"wrote {BACKUP_ICS}")


if __name__ == "__main__":
    main()
