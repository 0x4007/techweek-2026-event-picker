#!/usr/bin/env python3
"""Build signed-up Tech Week calendars with transit blocks.

Outputs:
- an operational route calendar with event and travel blocks
- an all-RSVP reference calendar with every submitted non-test event
- CSV/Markdown files for quick review
- an AppleScript sync file for local Calendar.app
"""

from __future__ import annotations

import csv
import datetime as dt
import math
import re
import zipfile
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from xml.sax.saxutils import escape

from build_techweek_transit_calendar import (
    GEOCODE_CACHE,
    HOME,
    MANUAL_DURATIONS,
    OSRM_CACHE,
    Point,
    RERANK_CSV,
    TRIP_CACHE,
    TZID,
    clean_address,
    extract_venue,
    geocode,
    jsonld_event,
    load_stations,
    local_dt_from_utc,
    parse_start,
    read_json,
    route_between,
)


STATUS_CSV = Path(".codex/techweek_signup_status.csv")

OUTPUT_MD = Path("techweek_signed_up_transport_schedule.md")
OUTPUT_CSV = Path("techweek_signed_up_transport_schedule.csv")
OUTPUT_XLSX = Path("techweek_signed_up_transport_schedule.xlsx")
SCHEDULE_ICS = Path("techweek_signed_up_operational_with_travel.ics")
ALL_RSVP_ICS = Path("techweek_signed_up_all_rsvps_reference.ics")
APPLE_SCRIPT = Path("sync_techweek_to_apple_calendar.applescript")

SCHEDULE_CALENDAR = "NY Tech Week 2026 - Schedule"
REFERENCE_CALENDAR = "NY Tech Week 2026 - All RSVPs"

# This is the practical attendance route from the rerank, adjusted to include
# the now-registered Thursday "Stop Making AI Guess" event.
OPERATIONAL_ROUTE_IDS = [
    "6408",  # Mon 14:00 Beyond the Spec
    "44",  # Mon 16:00 From Vibe Coding
    "5978",  # Mon 18:00 Open Source Must Win
    "4551",  # Tue 12:00 AI in Enterprise SDLC
    "4341",  # Tue 16:00 From Copilot to Control Plane
    "4161",  # Tue 18:00 Future of DevEx
    "5889",  # Wed 12:00 Building secure AI
    "4444",  # Wed 14:00 Future of Coding Agents and IDE
    "5529",  # Wed 16:00 Fireside: coding agents
    "4664",  # Wed 18:00 MCP in the Wild
    "5372",  # Thu 16:00 Shipping Faster with AI Coding Agents
    "5114",  # Thu 19:00 Stop Making AI Guess
    "5722",  # Fri 17:00 Bare Metal Happy Hour
]

EVENT_NOTES = {
    "5978": "If this is not approved, use registered backup NYC B2B at Skinos instead.",
    "5372": "Leave early if needed so you can make the registered 19:00 Stop Making AI Guess event.",
    "5114": "Registered direct. This is the Thursday anchor unless a substantially better curated dinner approves.",
    "5962": "Partiful registered only. Secondary Luma checkout is $20 and was explicitly skipped.",
    "4200": "Registered backup near FiDi. Use if Open Source Must Win is not approved or is too low signal in practice.",
}

STATUS_LABELS = {
    "registered": "REG",
    "applied": "PENDING",
    "waitlisted": "WAITLIST",
}

CATEGORY_LABELS = {
    "primary": "PRIMARY",
    "apply": "CURATED",
    "backup": "BACKUP",
}

MANUAL_POINTS = [
    (re.compile(r"\b1155\s+6th\s+Ave", re.I), "1155 6th Ave, New York, NY 10036", 40.7564611, -73.9831996),
    (re.compile(r"\b620\s+(?:Eighth|8th)\s+Ave", re.I), "620 8th Ave, New York, NY 10018", 40.756326, -73.990245),
]


def event_key_from_url(url: str) -> str:
    match = re.search(r"partiful\.com/(?:e|events)/([^?/#]+)", url or "")
    return match.group(1) if match else ""


def techweek_id(event_id: str) -> str:
    return f"TW-{event_id}"


def row_value(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        if row.get(key):
            return row[key]
    return ""


def read_rerank_events() -> dict[str, dict[str, str]]:
    with RERANK_CSV.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    return {event_key_from_url(row["event_url"]): row for row in rows}


def read_status_rows() -> list[dict[str, str]]:
    with STATUS_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [row for row in rows if row["category"] != "test"]


def manual_point_for_query(name: str, query: str) -> tuple[Point, str, str] | None:
    for pattern, normalized_query, lat, lon in MANUAL_POINTS:
        if pattern.search(query or ""):
            return Point(name, normalized_query, "manual_exact_manhattan", lat, lon), normalized_query, "manual_exact_manhattan"
    return None


def geocode_is_usable(geo: dict[str, object]) -> bool:
    lat = float(geo["lat"])
    lon = float(geo["lon"])
    display_name = str(geo.get("display_name", ""))
    if not (40.65 <= lat <= 40.88 and -74.04 <= lon <= -73.90):
        return False
    return display_name.lower() not in {"new york, united states", "new york, new york, united states"}


def event_end_from_page(row: dict[str, str], start_dt: dt.datetime) -> dt.datetime:
    html_path = row.get("local_html_path") or ""
    if html_path and Path(html_path).exists():
        html_text = Path(html_path).read_text(errors="ignore")
        event_json = jsonld_event(html_text)
        end_dt = local_dt_from_utc(str(event_json.get("endDate", ""))) if event_json else None
        if end_dt and start_dt < end_dt <= start_dt + dt.timedelta(hours=10):
            return end_dt
    minutes = MANUAL_DURATIONS.get(row["id"], 90)
    return start_dt + dt.timedelta(minutes=minutes)


def status_location_is_exact(value: str) -> bool:
    if not value:
        return False
    lower = value.lower()
    if lower in {"tbc", "tbd", "new york, ny"}:
        return False
    return bool(re.search(r"\d", value) and "ny" in lower)


def venue_for_event(
    rerank_row: dict[str, str],
    status_row: dict[str, str],
    geocode_cache: dict[str, dict],
) -> tuple[Point, str, str, str]:
    point, meta = extract_venue(rerank_row, geocode_cache)
    venue_query = meta["venue_query"]
    venue_precision = meta["venue_precision"]
    display_location = status_row.get("venue_revealed") or rerank_row.get("location") or venue_query

    manual = manual_point_for_query(rerank_row["name"], venue_query)
    if manual:
        point, venue_query, venue_precision = manual

    revealed = status_row.get("venue_revealed", "").strip()
    if status_location_is_exact(revealed):
        query = clean_address(revealed)
        manual = manual_point_for_query(rerank_row["name"], query)
        if manual:
            point, venue_query, venue_precision = manual
            display_location = venue_query
            return point, venue_query, venue_precision, display_location
        try:
            geo = geocode(query, geocode_cache)
            if geocode_is_usable(geo):
                point = Point(rerank_row["name"], query, "exact_from_signup_status", geo["lat"], geo["lon"])
                venue_query = query
                venue_precision = "exact_from_signup_status"
                display_location = query
        except Exception:
            # Keep the event-page location if the RSVP text is not geocodable.
            pass

    return point, venue_query, venue_precision, display_location


def load_signed_events() -> list[dict]:
    rerank_by_key = read_rerank_events()
    geocode_cache = read_json(GEOCODE_CACHE, {})
    events = []
    missing = []

    for status_row in read_status_rows():
        key = event_key_from_url(status_row["partiful_url"])
        rerank_row = rerank_by_key.get(key)
        if not rerank_row:
            missing.append(status_row["event_name"])
            continue
        start_dt = parse_start(rerank_row)
        end_dt = event_end_from_page(rerank_row, start_dt)
        point, venue_query, venue_precision, display_location = venue_for_event(rerank_row, status_row, geocode_cache)
        rank = row_value(rerank_row, "rank", "\ufeffrank")
        events.append(
            {
                "id": rerank_row["id"],
                "techweek_id": techweek_id(rerank_row["id"]),
                "calendar_block_id": "",
                "event_key": key,
                "partiful_id": key,
                "name": status_row["event_name"],
                "canonical_name": rerank_row["name"],
                "category": status_row["category"],
                "status": status_row["status"],
                "status_label": STATUS_LABELS.get(status_row["status"], status_row["status"].upper()),
                "category_label": CATEGORY_LABELS.get(status_row["category"], status_row["category"].upper()),
                "start_dt": start_dt,
                "end_dt": end_dt,
                "actual_start_dt": start_dt,
                "actual_end_dt": end_dt,
                "date": rerank_row["date"],
                "weekday": rerank_row["weekday"],
                "location": display_location,
                "venue_query": venue_query,
                "venue_precision": venue_precision,
                "point": point,
                "rank": rank,
                "tier": rerank_row.get("tier", ""),
                "opportunity_score": rerank_row.get("opportunity_score", ""),
                "fit_summary": rerank_row.get("fit_summary", ""),
                "event_url": status_row["partiful_url"],
                "next_step": status_row.get("next_step", ""),
                "notes": status_row.get("notes", ""),
                "route_note": EVENT_NOTES.get(rerank_row["id"], ""),
            }
        )
    if missing:
        print("Missing rerank matches:", "; ".join(missing))
    return sorted(events, key=lambda row: (row["start_dt"], row["category"], row["name"]))


def schedule_title(event: dict) -> str:
    return f"[{event['techweek_id']}] [{event['status_label']}] {event['name']}"


def reference_title(event: dict) -> str:
    return f"[{event['techweek_id']}] [{event['status_label']} {event['category_label']}] {event['name']}"


def travel_row(
    start_dt: dt.datetime,
    end_dt: dt.datetime,
    title: str,
    location: str,
    route: dict,
    note: str,
    calendar_block_id: str,
    related_techweek_id: str,
    partiful_id: str,
    event_url: str,
) -> dict:
    return {
        "entry_type": "travel",
        "calendar": "schedule",
        "start_dt": start_dt,
        "end_dt": end_dt,
        "actual_start_dt": start_dt,
        "actual_end_dt": end_dt,
        "title": f"[{calendar_block_id}] {title}",
        "location": location,
        "techweek_id": related_techweek_id,
        "calendar_block_id": calendar_block_id,
        "partiful_id": partiful_id,
        "status": "registered",
        "status_label": "TRAVEL",
        "category": "travel",
        "category_label": "TRAVEL",
        "route_mode": route["mode"],
        "travel_minutes": route["minutes"],
        "route_details": route["details"],
        "subway_segments": route["subway_segments"],
        "transit_risk": route["risk"],
        "note": note,
        "event_url": event_url,
        "rank": "",
        "tier": "",
        "opportunity_score": "",
        "fit_summary": "",
        "venue_query": location,
        "venue_precision": "",
        "next_step": "",
        "notes": "",
    }


def schedule_event_row(event: dict) -> dict:
    note_parts = [
        event.get("route_note", ""),
        event.get("next_step", ""),
        event.get("notes", ""),
    ]
    return {
        **event,
        "entry_type": "event",
        "calendar": "schedule",
        "calendar_block_id": f"{event['techweek_id']}-SCHEDULE",
        "title": schedule_title(event),
        "route_mode": "",
        "travel_minutes": "",
        "route_details": "",
        "subway_segments": "",
        "transit_risk": "",
        "note": " ".join(part for part in note_parts if part).strip(),
    }


def reference_event_row(event: dict) -> dict:
    note_parts = [
        event.get("route_note", ""),
        event.get("next_step", ""),
        event.get("notes", ""),
    ]
    return {
        **event,
        "entry_type": "event",
        "calendar": "reference",
        "calendar_block_id": f"{event['techweek_id']}-REFERENCE",
        "title": reference_title(event),
        "route_mode": "",
        "travel_minutes": "",
        "route_details": "",
        "subway_segments": "",
        "transit_risk": "",
        "note": " ".join(part for part in note_parts if part).strip(),
    }


def build_operational_route(events: list[dict]) -> list[dict]:
    events_by_id = {event["id"]: event for event in events}
    selected = [events_by_id[event_id] for event_id in OPERATIONAL_ROUTE_IDS if event_id in events_by_id]
    selected.sort(key=lambda row: row["start_dt"])

    stations = load_stations()
    trip_cache = read_json(TRIP_CACHE, {})
    osrm_cache = read_json(OSRM_CACHE, {})

    rows: list[dict] = []
    by_day: dict[str, list[dict]] = {}
    for event in selected:
        by_day.setdefault(event["date"], []).append(event)

    for _, day_events in sorted(by_day.items()):
        previous_point: Point | dict = HOME
        previous_event_entry: dict | None = None
        for event in day_events:
            route = route_between(previous_point, event["point"], stations, trip_cache, osrm_cache)
            travel_minutes = route["minutes"]
            travel_start = event["start_dt"] - dt.timedelta(minutes=travel_minutes)
            travel_end = event["start_dt"]
            leave_note = ""

            if previous_event_entry and previous_event_entry["end_dt"] > travel_start:
                minutes_early = math.ceil((previous_event_entry["end_dt"] - travel_start).total_seconds() / 60)
                previous_actual_end = previous_event_entry["actual_end_dt"]
                previous_event_entry["end_dt"] = travel_start
                previous_event_entry["note"] = " ".join(
                    part
                    for part in [
                        previous_event_entry.get("note", ""),
                        f"Route calendar shortens this from the event's scheduled {previous_actual_end.strftime('%H:%M')} end; leave {minutes_early} min early for transit.",
                    ]
                    if part
                )
                leave_note = f"Leave previous event {minutes_early} min before its scheduled end."

            origin_name = previous_point["name"] if isinstance(previous_point, dict) else previous_point.name
            if travel_minutes > 0:
                rows.append(
                    travel_row(
                        travel_start,
                        travel_end,
                        f"{origin_name} -> {event['name']}",
                        f"{origin_name} -> {event['location']}",
                        route,
                        leave_note,
                        f"{event['techweek_id']}-TRAVEL-IN",
                        event["techweek_id"],
                        event["partiful_id"],
                        event["event_url"],
                    )
                )
            event_entry = schedule_event_row(event)
            rows.append(event_entry)
            previous_point = event["point"]
            previous_event_entry = event_entry

        if previous_event_entry:
            route = route_between(previous_point, HOME, stations, trip_cache, osrm_cache)
            rows.append(
                travel_row(
                    previous_event_entry["end_dt"],
                    previous_event_entry["end_dt"] + dt.timedelta(minutes=route["minutes"]),
                    f"{previous_point.name} -> FiDi home base",
                    f"{previous_point.name} -> FiDi home base",
                    route,
                    "",
                    f"TW-{previous_event_entry['start_dt'].strftime('%Y%m%d')}-TRAVEL-HOME",
                    previous_event_entry.get("techweek_id", ""),
                    previous_event_entry.get("partiful_id", ""),
                    previous_event_entry.get("event_url", ""),
                )
            )

    return sorted(rows, key=lambda row: row["start_dt"])


def fmt_dt(value: dt.datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def md_day_sections(rows: list[dict]) -> str:
    lines: list[str] = []
    current_date = ""
    for row in sorted(rows, key=lambda item: item["start_dt"]):
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
                lines.append(f"  - {row['note']}")
            continue
        link = f"[{row['title']}]({row['event_url']})"
        lines.append(f"- {time_range} | {row['location']} | {link}")
        if row["actual_end_dt"] != row["end_dt"]:
            lines.append(f"  - Scheduled event end: {row['actual_end_dt'].strftime('%H:%M')}; route calendar plans an earlier departure.")
        if row["note"]:
            lines.append(f"  - {row['note']}")
        lines.append(f"  - Venue basis: {row['venue_query']} ({row['venue_precision']})")
        lines.append(f"  - Rank {row['rank']}, tier {row['tier']}, score {row['opportunity_score']}; {row['fit_summary']}")
    return "\n".join(lines)


def write_markdown(schedule_rows: list[dict], reference_rows: list[dict]) -> None:
    status_counts: dict[str, int] = {}
    for row in reference_rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
    contents = [
        "# Signed-Up NYC Tech Week Schedule",
        "",
        "Home anchor: FiDi / Wall St station. Travel blocks use OSM/Nominatim geocoding plus SubwayInfo.nyc station-trip estimates where subway beats walking. Hidden venues use neighborhood centroids until hosts reveal exact addresses.",
        "",
        "The operational calendar is the route to actually keep open. The all-RSVP calendar is a reference layer for approvals, waitlist movement, and backups.",
        "",
        f"RSVP status snapshot: {status_counts.get('registered', 0)} registered, {status_counts.get('applied', 0)} applied, {status_counts.get('waitlisted', 0)} waitlisted.",
        "",
        "## Operational Route With Transit",
        "",
        md_day_sections(schedule_rows),
        "",
        "## All RSVP Reference",
        "",
        "Use this only as a toggleable reference calendar; many entries conflict by design.",
        "",
        md_day_sections(reference_rows),
        "",
        "## Files",
        "",
        f"- Apple Calendar sync script: `{APPLE_SCRIPT}`",
        f"- Operational import: `{SCHEDULE_ICS}`",
        f"- All-RSVP reference import: `{ALL_RSVP_ICS}`",
        f"- Spreadsheet: `{OUTPUT_XLSX}`",
        f"- CSV: `{OUTPUT_CSV}`",
    ]
    OUTPUT_MD.write_text("\n".join(contents) + "\n", encoding="utf-8")


def flat_csv_row(row: dict) -> dict[str, str]:
    return {
        "calendar": row.get("calendar", ""),
        "techweek_id": row.get("techweek_id", ""),
        "calendar_block_id": row.get("calendar_block_id", ""),
        "partiful_id": row.get("partiful_id", ""),
        "rerank_id": row.get("id", ""),
        "entry_type": row.get("entry_type", ""),
        "status": row.get("status", ""),
        "category": row.get("category", ""),
        "start": fmt_dt(row["start_dt"]),
        "end": fmt_dt(row["end_dt"]),
        "actual_start": fmt_dt(row.get("actual_start_dt", row["start_dt"])),
        "actual_end": fmt_dt(row.get("actual_end_dt", row["end_dt"])),
        "title": row.get("title", ""),
        "location": row.get("location", ""),
        "venue_query": row.get("venue_query", ""),
        "venue_precision": row.get("venue_precision", ""),
        "route_mode": str(row.get("route_mode", "")),
        "travel_minutes": str(row.get("travel_minutes", "")),
        "route_details": row.get("route_details", ""),
        "subway_segments": row.get("subway_segments", ""),
        "transit_risk": row.get("transit_risk", ""),
        "note": row.get("note", ""),
        "rank": row.get("rank", ""),
        "tier": row.get("tier", ""),
        "opportunity_score": row.get("opportunity_score", ""),
        "event_url": row.get("event_url", ""),
    }


def write_csv_output(rows: list[dict]) -> None:
    fieldnames = list(flat_csv_row(rows[0]).keys())
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(flat_csv_row(row))


def escape_ics(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def fold_ics_line(line: str) -> list[str]:
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return [line]
    chunks = []
    current = ""
    current_len = 0
    for char in line:
        char_len = len(char.encode("utf-8"))
        if current and current_len + char_len > 75:
            chunks.append(current)
            current = " " + char
            current_len = 1 + char_len
        else:
            current += char
            current_len += char_len
    chunks.append(current)
    return chunks


def ics_status(row: dict) -> str:
    if row["entry_type"] == "travel" or row["status"] == "registered":
        return "CONFIRMED"
    return "TENTATIVE"


def write_ics(path: Path, rows: list[dict], calendar_name: str, transparent: bool) -> None:
    now = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//UbiquityOS//Tech Week Signed-Up Calendar//EN",
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
    for row in sorted(rows, key=lambda item: (item["start_dt"], item["title"])):
        uid_source = row.get("calendar_block_id") or f"{path.name}-{row['title']}-{row['start_dt']}-{row['end_dt']}"
        uid = uuid5(NAMESPACE_URL, uid_source)
        description = "\n".join(
            part
            for part in [
                f"TechWeekID: {row.get('techweek_id', '')}",
                f"CalendarBlockID: {row.get('calendar_block_id', '')}",
                f"RerankID: {row.get('id', '')}",
                f"PartifulID: {row.get('partiful_id', '')}",
                row.get("note", ""),
                row.get("route_details", ""),
                f"RSVP status: {row.get('status', '')}",
                f"Category: {row.get('category', '')}",
                f"Venue basis: {row.get('venue_query', '')} ({row.get('venue_precision', '')})",
                f"Rank/tier/score: {row.get('rank', '')} / {row.get('tier', '')} / {row.get('opportunity_score', '')}",
                f"URL: {row.get('event_url', '')}",
            ]
            if part
        )
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}@techweek-2026-event-picker",
                f"DTSTAMP:{now}",
                f"DTSTART;TZID={TZID}:{row['start_dt'].strftime('%Y%m%dT%H%M%S')}",
                f"DTEND;TZID={TZID}:{row['end_dt'].strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{escape_ics(row['title'])}",
                f"LOCATION:{escape_ics(row.get('location') or row.get('venue_query', ''))}",
                f"DESCRIPTION:{escape_ics(description)}",
                f"STATUS:{ics_status(row)}",
                f"TRANSP:{'TRANSPARENT' if transparent else 'OPAQUE'}",
            ]
        )
        if row.get("event_url"):
            lines.append(f"URL:{escape_ics(row['event_url'])}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    folded = []
    for line in lines:
        folded.extend(fold_ics_line(line))
    path.write_text("\r\n".join(folded) + "\r\n", encoding="utf-8")


def excel_col(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_xml(row_index: int, col_index: int, value: str) -> str:
    ref = f"{excel_col(col_index)}{row_index}"
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value or "")[:32767])}</t></is></c>'


def write_xlsx(rows: list[dict]) -> None:
    flat_rows = [flat_csv_row(row) for row in rows]
    fieldnames = list(flat_rows[0].keys())
    xml_rows = [
        '<row r="1">' + "".join(cell_xml(1, index, name) for index, name in enumerate(fieldnames, 1)) + "</row>"
    ]
    for row_index, row in enumerate(flat_rows, start=2):
        xml_rows.append(
            f'<row r="{row_index}">'
            + "".join(cell_xml(row_index, index, row.get(name, "")) for index, name in enumerate(fieldnames, 1))
            + "</row>"
        )
    last_col = excel_col(len(fieldnames))
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        "<sheetData>"
        + "".join(xml_rows)
        + "</sheetData>"
        + f'<autoFilter ref="A1:{last_col}{len(flat_rows) + 1}"/>'
        + "</worksheet>"
    )
    with zipfile.ZipFile(OUTPUT_XLSX, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        )
        z.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        )
        z.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Signed Up Schedule" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        z.writestr("xl/worksheets/sheet1.xml", sheet)


def applescript_string(value: str) -> str:
    return '"' + str(value or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def applescript_date(value: dt.datetime) -> str:
    return f"my makeDate({value.day}, {value.hour}, {value.minute})"


def applescript_description(row: dict) -> str:
    return "\n".join(
        part
        for part in [
            f"TechWeekID: {row.get('techweek_id', '')}",
            f"CalendarBlockID: {row.get('calendar_block_id', '')}",
            f"RerankID: {row.get('id', '')}",
            f"PartifulID: {row.get('partiful_id', '')}",
            row.get("note", ""),
            row.get("route_details", ""),
            f"RSVP status: {row.get('status', '')}",
            f"Category: {row.get('category', '')}",
            f"Venue basis: {row.get('venue_query', '')} ({row.get('venue_precision', '')})",
            f"Rank/tier/score: {row.get('rank', '')} / {row.get('tier', '')} / {row.get('opportunity_score', '')}",
            f"URL: {row.get('event_url', '')}",
        ]
        if part
    )


def applescript_event(row: dict, calendar_var: str) -> str:
    props = [
        f"summary:{applescript_string(row['title'])}",
        f"start date:{applescript_date(row['start_dt'])}",
        f"end date:{applescript_date(row['end_dt'])}",
        f"location:{applescript_string(row.get('location') or row.get('venue_query', ''))}",
        f"description:{applescript_string(applescript_description(row))}",
    ]
    return f"make new event at end of events of {calendar_var} with properties {{{', '.join(props)}}}"


def write_applescript(schedule_rows: list[dict], reference_rows: list[dict]) -> None:
    lines = [
        "on makeDate(dayValue, hourValue, minuteValue)",
        "\tset d to current date",
        "\tset year of d to 2026",
        "\tset month of d to June",
        "\tset day of d to dayValue",
        "\tset time of d to (hourValue * hours + minuteValue * minutes)",
        "\treturn d",
        "end makeDate",
        "",
        "tell application \"Calendar\"",
        "\tset scheduleName to " + applescript_string(SCHEDULE_CALENDAR),
        "\tset referenceName to " + applescript_string(REFERENCE_CALENDAR),
        "\tif not (exists calendar scheduleName) then make new calendar with properties {name:scheduleName}",
        "\tif not (exists calendar referenceName) then make new calendar with properties {name:referenceName}",
        "\tset scheduleCal to calendar scheduleName",
        "\tset referenceCal to calendar referenceName",
        "\tset windowStart to my makeDate(1, 0, 0)",
        "\tset windowEnd to my makeDate(8, 0, 0)",
        "\tdelete (every event of scheduleCal whose start date is greater than or equal to windowStart and start date is less than windowEnd)",
        "\tdelete (every event of referenceCal whose start date is greater than or equal to windowStart and start date is less than windowEnd)",
        "",
        "\t-- Operational route with transit blocks.",
    ]
    for row in sorted(schedule_rows, key=lambda item: item["start_dt"]):
        lines.append("\t" + applescript_event(row, "scheduleCal"))
    lines.append("")
    lines.append("\t-- Reference layer for every submitted RSVP. Toggle this calendar off when it gets noisy.")
    for row in sorted(reference_rows, key=lambda item: (item["start_dt"], item["title"])):
        lines.append("\t" + applescript_event(row, "referenceCal"))
    lines.extend(
        [
            "end tell",
            "",
        ]
    )
    APPLE_SCRIPT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    events = load_signed_events()
    schedule_rows = build_operational_route(events)
    reference_rows = [reference_event_row(event) for event in events]
    combined_rows = sorted(schedule_rows + reference_rows, key=lambda row: (row["start_dt"], row["calendar"], row["title"]))

    write_markdown(schedule_rows, reference_rows)
    write_csv_output(combined_rows)
    write_xlsx(combined_rows)
    write_ics(SCHEDULE_ICS, schedule_rows, SCHEDULE_CALENDAR, transparent=False)
    write_ics(ALL_RSVP_ICS, reference_rows, REFERENCE_CALENDAR, transparent=True)
    write_applescript(schedule_rows, reference_rows)

    print(f"wrote {OUTPUT_MD}")
    print(f"wrote {OUTPUT_CSV}")
    print(f"wrote {OUTPUT_XLSX}")
    print(f"wrote {SCHEDULE_ICS}")
    print(f"wrote {ALL_RSVP_ICS}")
    print(f"wrote {APPLE_SCRIPT}")


if __name__ == "__main__":
    main()
