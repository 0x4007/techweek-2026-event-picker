#!/usr/bin/env python3
"""Build signed-up Tech Week calendars with transit blocks.

Outputs:
- an operational route calendar with event and travel blocks
- an RSVP reference calendar with submitted non-test events that are not already scheduled
- CSV/Markdown files for quick review
- an AppleScript sync file for local Calendar.app
"""

from __future__ import annotations

import csv
import datetime as dt
import json
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


ROOT = Path(__file__).resolve().parents[1]

STATUS_CSV = ROOT / ".codex/techweek_signup_status.csv"
EVENT_PAGES_DIR = ROOT / "data/source/event_pages"

OUTPUT_MD = ROOT / "outputs/signed_up/techweek_signed_up_transport_schedule.md"
OUTPUT_CSV = ROOT / "outputs/signed_up/techweek_signed_up_transport_schedule.csv"
OUTPUT_XLSX = ROOT / "outputs/signed_up/techweek_signed_up_transport_schedule.xlsx"
SCHEDULE_ICS = ROOT / "outputs/signed_up/techweek_signed_up_operational_with_travel.ics"
ALL_RSVP_ICS = ROOT / "outputs/signed_up/techweek_signed_up_all_rsvps_reference.ics"
APPLE_SCRIPT = ROOT / "outputs/sync/sync_techweek_to_apple_calendar.applescript"
GOOGLE_VIA_APPLE_SCRIPT = ROOT / "outputs/sync/sync_techweek_to_google_calendar_via_apple.applescript"
GOOGLE_EVENTKIT_JSON = ROOT / "outputs/sync/techweek_google_schedule_eventkit.json"

SCHEDULE_CALENDAR = "NY Tech Week 2026 - Schedule"
REFERENCE_CALENDAR = "NY Tech Week 2026 - All RSVPs"
GOOGLE_VIA_APPLE_TARGET_CALENDAR = "Personal"

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


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def coaching(opening: str, ask: str, listen_for: str, follow_up: str) -> str:
    return "\n".join(
        [
            "Sales coaching:",
            "Pitch: Accolades credits the engineering work commit counts miss, using source-linked GitHub and Slack evidence.",
            f"Open: {opening}",
            f"Ask: {ask}",
            f"Listen for: {listen_for}",
            f"Follow-up: {follow_up}",
        ]
    )


SALES_COACHING = {
    "6408": coaching(
        "Use the agent/spec theme. Say you are studying how specs, PRs, and Slack context survive agentic workflows.",
        "When an agent touches a ticket, what artifact proves who shaped the outcome?",
        "Specs as source of truth, issue quality, review quality, manager trust, missing context.",
        "Ask for 20 minutes with whoever owns engineering process or agent adoption.",
    ),
    "44": coaching(
        "Frame vibe coding as a team-process problem, not a solo productivity trick.",
        "What breaks when vibe coding becomes team development across reviews, specs, and handoffs?",
        "Review bottlenecks, low-trust AI output, unclear ownership, managers losing visibility.",
        "Send a short write-up on contribution evidence for AI-assisted teams.",
    ),
    "5978": coaching(
        "Open-source rooms should hear the maintainer-labor angle first.",
        "How do you credit review, triage, specs, and maintainer work that never becomes a commit?",
        "Contributor rewards, bounty systems, maintainer burnout, attribution disputes.",
        "Ask for intros to maintainers, DevRel leads, or teams running contributor programs.",
    ),
    "4551": coaching(
        "Use enterprise SDLC language: trustworthy artifacts, change control, and evidence trails.",
        "Which engineering artifacts stay reliable when AI changes how teams plan, review, and ship?",
        "Auditability, manager reports, PR review evidence, specs scattered across tools.",
        "Ask to compare their SDLC reporting process with an Accolades evidence report.",
    ),
    "4341": coaching(
        "This is the highest-priority CTO/platform room. Lead with the control-plane problem.",
        "What should managers measure once copilots are part of every development workflow?",
        "CTO/VP Eng pain, platform ownership, productivity reporting, GitHub/code review evidence.",
        "Push for a concrete post-Tech Week call if they own DevEx, platform, or engineering metrics.",
    ),
    "4161": coaching(
        "Use DevEx language and avoid sounding like HR analytics.",
        "Where does DevEx stop being tooling and start being contribution evidence?",
        "Internal developer platforms, friction measurement, review quality, invisible glue work.",
        "Ask who owns DevEx metrics and whether source-linked contribution evidence would help.",
    ),
    "5889": coaching(
        "Tie security and data controls to audit-ready engineering evidence.",
        "How are you proving AI-assisted engineering work was reviewed without leaking sensitive context?",
        "Security reviews, data access, compliance needs, audit trails, manager sign-off.",
        "Offer a follow-up focused on source-linked evidence without surveillance dashboards.",
    ),
    "4444": coaching(
        "Talk about the IDE as the point where human and agent work blur.",
        "When agents write code, what human work still needs credit?",
        "Prompting, spec writing, review corrections, architectural judgment, tool orchestration.",
        "Ask to sanity-check the Accolades framing with builders using coding agents daily.",
    ),
    "5529": coaching(
        "Use the event title directly: if agents are users, the system of record matters.",
        "If the agent is the user, what becomes the system of record for useful work?",
        "Tool schemas, docs, prompts, guardrails, review evidence, ownership boundaries.",
        "Ask for feedback on whether Accolades should track agent-orchestration evidence explicitly.",
    ),
    "4664": coaching(
        "MCP people will understand context plumbing. Map that to later evaluation.",
        "What context should tools expose so contribution can be evaluated after the work ships?",
        "Tool-call trails, context sources, agent actions, human review, integration ownership.",
        "Ask for technical feedback on evidence capture from tool and agent workflows.",
    ),
    "5372": coaching(
        "This is a direct AI-coding workflow room. Start with manager trust.",
        "What changed in your review process after AI started writing more code?",
        "Review overload, shallow approvals, unclear ownership, productivity claims without evidence.",
        "Ask for a buyer call with the engineering leader responsible for AI coding adoption.",
    ),
    "5114": coaching(
        "Use the codebase-as-spec theme and make Accolades feel complementary.",
        "What would make a codebase trustworthy enough for agents and managers?",
        "Source-linked context, specs in code, review trails, stale docs, manager confidence.",
        "Ask to exchange notes on codebase evidence and Accolades after the event.",
    ),
    "5722": coaching(
        "For agent fleet and autonomous systems people, focus on orchestration accountability.",
        "How do teams know who did useful orchestration, review, and correction work across agent fleets?",
        "Multi-agent coordination, operations work, incident reviews, hidden platform labor.",
        "Ask for intros to platform leads running agent or automation infrastructure.",
    ),
    "5110": coaching(
        "Use the Slack angle: work decisions often happen outside GitHub.",
        "Which important engineering decisions live in Slack, and do they ever make it into reviews or planning?",
        "Slack decisions, cross-functional handoffs, lost context, collaboration evidence.",
        "Ask whether Slack-linked contribution credit would help managers or team leads.",
    ),
    "5962": coaching(
        "Hardware and robotics teams have heavy coordination work before code ships.",
        "How do you credit specs, integration debugging, reviews, and ops work across hardware/software boundaries?",
        "Systems integration, test evidence, field debugging, cross-discipline ownership.",
        "Ask for founder/operator feedback rather than pushing a pure software-team sale.",
    ),
    "4200": coaching(
        "This is broad B2B. Keep the pitch short and qualify fast.",
        "Does your engineering team use GitHub and Slack heavily enough that contribution visibility is a management problem?",
        "Founder with 5+ engineers, remote team, AI coding adoption, performance-review pain.",
        "Ask for a warm intro to the CTO or VP Eng if the person is not the buyer.",
    ),
    "4522": coaching(
        "For MCP/control-plane conversations, talk about instrumenting context and actions.",
        "What needs to be logged so a manager can understand who influenced an agent-driven outcome?",
        "Context sources, tool permissions, traceability, review responsibility, platform ownership.",
        "Ask to compare notes with anyone building internal agent infrastructure.",
    ),
    "4224": coaching(
        "API and identity demos are a good opening for permissions plus evidence.",
        "When agents call internal APIs, how do you audit who requested, reviewed, and approved the work?",
        "API governance, permissions, review evidence, enterprise buyers, workflow logs.",
        "Ask for intros to teams responsible for developer platform or internal API governance.",
    ),
    "5415": coaching(
        "Use liability language carefully: evidence, review, and accountability.",
        "If AI-assisted work causes a problem, what evidence would you want before assigning responsibility?",
        "Audit trails, legal/compliance sensitivity, review records, decision provenance.",
        "Ask if source-linked engineering evidence would be useful for compliance conversations.",
    ),
    "5437": coaching(
        "Enterprise AI buyers care about governance and platform ownership.",
        "Where do manager reports and audit evidence fit into your enterprise AI rollout?",
        "Governance, internal platforms, production agents, executive reporting, risk controls.",
        "Ask for a specific post-event call with the platform, DevEx, or AI governance owner.",
    ),
    "5925": coaching(
        "Use infrastructure scale as the bridge into contribution evidence.",
        "In the agent era, what evidence do infra teams need to trust work done across tools and systems?",
        "Platform scale, agent infrastructure, toolchain visibility, engineering productivity.",
        "Ask for technical feedback from infra leaders rather than a generic founder follow-up.",
    ),
    "5820": coaching(
        "AI-native founders will understand the operating-model shift.",
        "How do AI-native teams evaluate human contribution when agents produce more of the visible output?",
        "Small teams scaling fast, agent-heavy workflows, contribution rewards, manager memory breaking down.",
        "Ask for a founder-to-founder product critique and one relevant buyer intro.",
    ),
    "4719": coaching(
        "Agent harnesses are about production reliability; connect that to human accountability.",
        "What human evidence needs to sit beside the harness output before an enterprise trusts agent work?",
        "Enterprise adoption, internal platforms, review gates, evaluation records, ownership.",
        "Ask to discuss how Accolades could consume evidence from agent harness workflows.",
    ),
    "4778": coaching(
        "This is a direct CTO room. Ask about pain before explaining the product.",
        "What is hardest for your managers to evaluate now that AI touches more engineering work?",
        "Performance reviews, planning evidence, PR quality, distributed-team context, DevEx ownership.",
        "If pain is clear, ask for a 20-minute CTO follow-up and permission to send a one-pager.",
    ),
    "5693": coaching(
        "Keep this practical: agents at work means work attribution is getting messy.",
        "When an agent helps ship something, who gets credit for the useful parts of the workflow?",
        "Agent orchestration, prompt/spec work, review corrections, workflow ownership.",
        "Ask for examples of workflows Accolades should recognize or avoid recognizing.",
    ),
    "4197": coaching(
        "Use leadership language: visibility without surveillance.",
        "What evidence do tech leaders wish they had for planning and reviews without turning into surveillance?",
        "Manager reporting, trust, team health, engineering productivity, executive visibility.",
        "Ask for a leadership-focused follow-up if they manage engineers or internal platforms.",
    ),
    "4191": coaching(
        "For agent scale, focus on attribution across many automated steps.",
        "When agents run at scale, how do you separate valuable human judgment from automated output?",
        "Evaluation gaps, agent ops, review ownership, platform labor, traceability.",
        "Ask to learn how they log agent work today and whether source-linked credit would fit.",
    ),
    "4826": coaching(
        "This is a live-demo room. Use your own build story, then ask about workflow data.",
        "Which parts of your AI workflow create useful evidence that managers should see later?",
        "Prompting, issue specs, PRs, Slack decisions, demos that could become repeatable workflows.",
        "Ask demo builders to name one evidence source Accolades should integrate first.",
    ),
    "4183": coaching(
        "This may be the best direct engineering-manager room. Be crisp and buyer-oriented.",
        "What do your managers use as evidence when deciding who moved a project forward?",
        "Performance-review pain, review quality, planning work, manager memory, team rewards.",
        "Ask for a concrete follow-up with the engineering leader or manager who owns the pain.",
    ),
    "5204": coaching(
        "This is less direct; use prediction and decision quality as the bridge.",
        "How do you know which people or artifacts actually improved a technical decision?",
        "Decision provenance, forecasts versus outcomes, accountability, source-linked context.",
        "Only pursue deep follow-up if they have an engineering team with GitHub/Slack pain.",
    ),
    "5231": coaching(
        "At dinner, sell softly. Use founder-to-founder learning first.",
        "How are AI builders changing how they reward and evaluate work inside their teams?",
        "AI-native operating models, fast-growing teams, founder pain, engineering leadership gaps.",
        "Ask for one sharp product critique and one relevant engineering-leader intro.",
    ),
    "5207": coaching(
        "Use the DM/agent framing to talk about decisions in conversational channels.",
        "When agents and teammates work in DMs, what context should be preserved for later credit or audit?",
        "Slack/DM work, agent conversations, missing provenance, informal decisions.",
        "Ask for feedback on Slack-first evidence capture if the person runs engineering workflows.",
    ),
    "250": coaching(
        "Treat this as a lower-pressure builder salon and look for AI-native founders.",
        "How does your team credit prompt work, specs, review, and product judgment around AI coding?",
        "Builder workflows, early team habits, contribution rewards, technical-founder pain.",
        "Ask for feedback or an intro; do not over-invest unless they match the ICP.",
    ),
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
    html_path_text = row.get("local_html_path") or ""
    html_path = Path(html_path_text)
    if html_path_text and not html_path.exists():
        moved_path = EVENT_PAGES_DIR / html_path.name
        if moved_path.exists():
            html_path = moved_path
    if html_path_text and html_path.exists():
        html_text = html_path.read_text(errors="ignore")
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
                "sales_coaching": SALES_COACHING.get(rerank_row["id"], ""),
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
        "sales_coaching": "",
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
        if row.get("sales_coaching"):
            lines.append("  - " + row["sales_coaching"].replace("\n", "\n  - "))
        lines.append(f"  - Venue basis: {row['venue_query']} ({row['venue_precision']})")
        lines.append(f"  - Rank {row['rank']}, tier {row['tier']}, score {row['opportunity_score']}; {row['fit_summary']}")
    return "\n".join(lines)


def write_markdown(schedule_rows: list[dict], reference_rows: list[dict], all_reference_rows: list[dict]) -> None:
    status_counts: dict[str, int] = {}
    for row in all_reference_rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
    contents = [
        "# Signed-Up NYC Tech Week Schedule",
        "",
        "Home anchor: FiDi / Wall St station. Travel blocks use OSM/Nominatim geocoding plus SubwayInfo.nyc station-trip estimates where subway beats walking. Hidden venues use neighborhood centroids until hosts reveal exact addresses.",
        "",
        "The operational calendar is the route to actually keep open. The all-RSVP calendar excludes scheduled route events, so enabling both calendars does not render duplicate event blocks.",
        "",
        f"RSVP status snapshot: {status_counts.get('registered', 0)} registered, {status_counts.get('applied', 0)} applied, {status_counts.get('waitlisted', 0)} waitlisted.",
        f"All-RSVP calendar rows after scheduled-event dedupe: {len(reference_rows)}.",
        "",
        "## Operational Route With Transit",
        "",
        md_day_sections(schedule_rows),
        "",
        "## All RSVP Reference, Scheduled Events Removed",
        "",
        "Use this as a toggleable reference calendar for alternatives, backups, and pending approvals not already on the operational route. Many entries conflict by design.",
        "",
        md_day_sections(reference_rows),
        "",
        "## Files",
        "",
        f"- Apple Calendar sync script: `{rel(APPLE_SCRIPT)}`",
        f"- Google-backed Calendar.app sync script: `{rel(GOOGLE_VIA_APPLE_SCRIPT)}`",
        f"- Operational import: `{rel(SCHEDULE_ICS)}`",
        f"- All-RSVP reference import: `{rel(ALL_RSVP_ICS)}`",
        f"- Spreadsheet: `{rel(OUTPUT_XLSX)}`",
        f"- CSV: `{rel(OUTPUT_CSV)}`",
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
        "sales_coaching": row.get("sales_coaching", ""),
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
                row.get("sales_coaching", ""),
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


def applescript_cleanup_handlers() -> list[str]:
    return [
        "on isManagedTechWeekEvent(theEvent)",
        "\tset eventSummary to \"\"",
        "\tset eventDescription to \"\"",
        "\tset eventUID to \"\"",
        "\ttell application \"Calendar\"",
        "\t\ttry",
        "\t\t\tset eventSummary to summary of theEvent as text",
        "\t\tend try",
        "\t\ttry",
        "\t\t\tset eventDescription to description of theEvent as text",
        "\t\tend try",
        "\t\ttry",
        "\t\t\tset eventUID to uid of theEvent as text",
        "\t\tend try",
        "\tend tell",
        "\tif eventUID contains \"techweek-2026-event-picker\" then return true",
        "\tif eventSummary starts with \"[TW-\" then return true",
        "\tif eventDescription contains \"CalendarBlockID: TW-\" then return true",
        "\tif eventDescription contains \"TechWeekID: TW-\" then return true",
        "\tif eventSummary starts with \"Tech Week:\" and eventDescription contains \"partiful.com\" then return true",
        "\tif eventSummary starts with \"Apply:\" and eventDescription contains \"partiful.com\" then return true",
        "\tif eventSummary starts with \"Backup:\" and eventDescription contains \"partiful.com\" then return true",
        "\tif eventSummary starts with \"Travel:\" and eventDescription contains \"Rank/tier/score:\" then return true",
        "\treturn false",
        "end isManagedTechWeekEvent",
        "",
        "on deleteManagedTechWeekEvents(targetCal, windowStart, windowEnd)",
        "\ttell application \"Calendar\"",
        "\t\tset existingEvents to every event of targetCal whose start date is greater than or equal to windowStart and start date is less than windowEnd",
        "\t\trepeat with existingEvent in existingEvents",
        "\t\t\tif my isManagedTechWeekEvent(existingEvent) then delete existingEvent",
        "\t\tend repeat",
        "\tend tell",
        "end deleteManagedTechWeekEvents",
    ]


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
            row.get("sales_coaching", ""),
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
        *applescript_cleanup_handlers(),
        "",
        "with timeout of 900 seconds",
        "tell application \"Calendar\"",
        "\tset scheduleName to " + applescript_string(SCHEDULE_CALENDAR),
        "\tset referenceName to " + applescript_string(REFERENCE_CALENDAR),
        "\tif not (exists calendar scheduleName) then make new calendar with properties {name:scheduleName}",
        "\tif not (exists calendar referenceName) then make new calendar with properties {name:referenceName}",
        "\tset scheduleCal to calendar scheduleName",
        "\tset referenceCal to calendar referenceName",
        "\tset windowStart to my makeDate(1, 0, 0)",
        "\tset windowEnd to my makeDate(8, 0, 0)",
        "\tmy deleteManagedTechWeekEvents(scheduleCal, windowStart, windowEnd)",
        "\tmy deleteManagedTechWeekEvents(referenceCal, windowStart, windowEnd)",
        "",
        "\t-- Operational route with transit blocks.",
    ]
    for row in sorted(schedule_rows, key=lambda item: item["start_dt"]):
        lines.append("\t" + applescript_event(row, "scheduleCal"))
    lines.append("")
    lines.append("\t-- Reference layer excludes events already present on the operational route to avoid duplicate rendering.")
    for row in sorted(reference_rows, key=lambda item: (item["start_dt"], item["title"])):
        lines.append("\t" + applescript_event(row, "referenceCal"))
    lines.extend(
        [
            "end tell",
            "end timeout",
            "",
        ]
    )
    APPLE_SCRIPT.write_text("\n".join(lines), encoding="utf-8")


def write_google_via_apple_applescript(schedule_rows: list[dict]) -> None:
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
        *applescript_cleanup_handlers(),
        "",
        "with timeout of 900 seconds",
        "tell application \"Calendar\"",
        "\tset targetName to " + applescript_string(GOOGLE_VIA_APPLE_TARGET_CALENDAR),
        "\tif not (exists calendar targetName) then error \"Google-backed target calendar not found: \" & targetName",
        "\tset targetCal to calendar targetName",
        "\tset windowStart to my makeDate(1, 0, 0)",
        "\tset windowEnd to my makeDate(8, 0, 0)",
        "\tmy deleteManagedTechWeekEvents(targetCal, windowStart, windowEnd)",
        "",
        "\t-- Operational route only. Alternatives/backups stay out of the Google-backed busy calendar.",
    ]
    for row in sorted(schedule_rows, key=lambda item: item["start_dt"]):
        lines.append("\t" + applescript_event(row, "targetCal"))
    lines.extend(
        [
            "end tell",
            "end timeout",
            "",
        ]
    )
    GOOGLE_VIA_APPLE_SCRIPT.write_text("\n".join(lines), encoding="utf-8")


def write_google_eventkit_json(schedule_rows: list[dict]) -> None:
    rows = []
    for row in sorted(schedule_rows, key=lambda item: item["start_dt"]):
        rows.append(
            {
                "calendar_block_id": row.get("calendar_block_id", ""),
                "techweek_id": row.get("techweek_id", ""),
                "partiful_id": row.get("partiful_id", ""),
                "rerank_id": row.get("id", ""),
                "entry_type": row.get("entry_type", ""),
                "status": row.get("status", ""),
                "category": row.get("category", ""),
                "title": row.get("title", ""),
                "location": row.get("location") or row.get("venue_query", ""),
                "start": fmt_dt(row["start_dt"]),
                "end": fmt_dt(row["end_dt"]),
                "notes": applescript_description(row),
                "url": row.get("event_url", ""),
            }
        )
    GOOGLE_EVENTKIT_JSON.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def main() -> None:
    for path in [
        OUTPUT_MD,
        OUTPUT_CSV,
        OUTPUT_XLSX,
        SCHEDULE_ICS,
        ALL_RSVP_ICS,
        APPLE_SCRIPT,
        GOOGLE_VIA_APPLE_SCRIPT,
        GOOGLE_EVENTKIT_JSON,
    ]:
        path.parent.mkdir(parents=True, exist_ok=True)

    events = load_signed_events()
    schedule_rows = build_operational_route(events)
    all_reference_rows = [reference_event_row(event) for event in events]
    scheduled_event_ids = {row["id"] for row in schedule_rows if row.get("entry_type") == "event"}
    reference_rows = [row for row in all_reference_rows if row.get("id") not in scheduled_event_ids]
    combined_rows = sorted(schedule_rows + reference_rows, key=lambda row: (row["start_dt"], row["calendar"], row["title"]))

    write_markdown(schedule_rows, reference_rows, all_reference_rows)
    write_csv_output(combined_rows)
    write_xlsx(combined_rows)
    write_ics(SCHEDULE_ICS, schedule_rows, SCHEDULE_CALENDAR, transparent=False)
    write_ics(ALL_RSVP_ICS, reference_rows, REFERENCE_CALENDAR, transparent=True)
    write_applescript(schedule_rows, reference_rows)
    write_google_via_apple_applescript(schedule_rows)
    write_google_eventkit_json(schedule_rows)

    print(f"wrote {OUTPUT_MD}")
    print(f"wrote {OUTPUT_CSV}")
    print(f"wrote {OUTPUT_XLSX}")
    print(f"wrote {SCHEDULE_ICS}")
    print(f"wrote {ALL_RSVP_ICS}")
    print(f"wrote {APPLE_SCRIPT}")
    print(f"wrote {GOOGLE_VIA_APPLE_SCRIPT}")
    print(f"wrote {GOOGLE_EVENTKIT_JSON}")


if __name__ == "__main__":
    main()
