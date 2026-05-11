#!/usr/bin/env python3
"""Build a practical Tech Week schedule and importable calendars."""

from __future__ import annotations

import csv
import datetime as dt
import re
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL


RERANK_CSV = Path("techweek_nyc_accolades_full_rerank.csv")
SCHEDULE_CSV = Path("techweek_nyc_accolades_schedule.csv")
SCHEDULE_MD = Path("techweek_nyc_accolades_schedule.md")
PRIMARY_ICS = Path("techweek_nyc_accolades_primary_calendar.ics")
BACKUP_ICS = Path("techweek_nyc_accolades_backup_calendar.ics")
APPLY_ICS = Path("techweek_nyc_accolades_apply_calendar.ics")

TZID = "America/New_York"


PLAN = [
    {
        "id": "6408",
        "bucket": "primary",
        "duration": 90,
        "decision": "go",
        "note": "Start the week with a direct AI engineering-practice session near downtown.",
    },
    {
        "id": "44",
        "bucket": "primary",
        "duration": 75,
        "decision": "go_if_energy",
        "note": "Midtown is less convenient, but the AI-driven development angle is useful early-week pipeline work.",
    },
    {
        "id": "5978",
        "bucket": "primary",
        "duration": 180,
        "decision": "go",
        "note": "Best Monday evening fit for open-source founders, maintainers, and builders who understand contribution incentives.",
    },
    {
        "id": "5962",
        "bucket": "backup",
        "duration": 180,
        "decision": "backup",
        "note": "Strong technical founder room, but less directly Accolades-shaped than Open Source Must Win and requires Luma ticketing.",
    },
    {
        "id": "4551",
        "bucket": "primary",
        "duration": 105,
        "decision": "go_if_energy",
        "note": "Useful enterprise SDLC context before the higher-signal Tuesday afternoon/evening block.",
    },
    {
        "id": "4341",
        "bucket": "primary",
        "duration": 90,
        "decision": "go",
        "note": "Most explicit buyer fit: CTOs, VPs Engineering, Heads of Platform, senior engineers, developer productivity, AI adoption.",
    },
    {
        "id": "4522",
        "bucket": "backup",
        "duration": 90,
        "decision": "same_time_backup",
        "note": "Excellent enterprise AI control-plane audience, but conflicts with Visdom.",
    },
    {
        "id": "4161",
        "bucket": "primary",
        "duration": 180,
        "decision": "go",
        "note": "Anchor event: engineers, technical leads, and technical founders discussing how teams write, review, ship, and maintain code.",
    },
    {
        "id": "5925",
        "bucket": "backup",
        "duration": 120,
        "decision": "same_time_backup",
        "note": "Good infra-brand density, but Future of DevEx is more directly aligned.",
    },
    {
        "id": "5889",
        "bucket": "primary",
        "duration": 75,
        "decision": "go_if_energy",
        "note": "Technical builder session with engineering lead / AI architect language; useful but not mandatory.",
    },
    {
        "id": "4444",
        "bucket": "primary",
        "duration": 90,
        "decision": "go",
        "note": "Coding agents and IDEs are close to Accolades' GitHub/work-evidence wedge.",
    },
    {
        "id": "5529",
        "bucket": "primary",
        "duration": 75,
        "decision": "go",
        "note": "Strong product-fit event around LLMs as users, tool schemas, docs, guardrails, and engineering knowledge.",
    },
    {
        "id": "4664",
        "bucket": "primary",
        "duration": 120,
        "decision": "go",
        "note": "Convenient East Village follow-on with MCP ecosystem leaders.",
    },
    {
        "id": "5693",
        "bucket": "backup",
        "duration": 120,
        "decision": "same_time_backup",
        "note": "Strong brands and possible VP Eng density, but Midtown conflicts with the downtown MCP route.",
    },
    {
        "id": "5372",
        "bucket": "primary",
        "duration": 90,
        "decision": "go",
        "note": "Must-attend: engineering leaders and operators discussing agentic development process.",
    },
    {
        "id": "4191",
        "bucket": "primary",
        "duration": 90,
        "decision": "go",
        "note": "Same neighborhood as the 4pm anchor and very aligned with production AI agents.",
    },
    {
        "id": "5207",
        "bucket": "backup",
        "duration": 90,
        "decision": "late_backup",
        "note": "Late casual founder/builder option if you still have energy and no curated dinner lands.",
    },
    {
        "id": "5722",
        "bucket": "primary",
        "duration": 120,
        "decision": "taper_day",
        "note": "One Friday event only: autonomous systems / agent orchestration in Union Square.",
    },
    {
        "id": "5437",
        "bucket": "apply",
        "duration": 120,
        "decision": "apply_first",
        "note": "Very high buyer fit around enterprise AI governance, internal platforms, and production agents; conflicts with Future of DevEx.",
    },
    {
        "id": "5820",
        "bucket": "apply",
        "duration": 210,
        "decision": "apply_first",
        "note": "Curated AI founder and leader room; take it if accepted, then compress the rest of Wednesday.",
    },
    {
        "id": "4719",
        "bucket": "apply",
        "duration": 90,
        "decision": "apply_first",
        "note": "Excellent enterprise-agent reliability/control event in Union Square.",
    },
    {
        "id": "4778",
        "bucket": "apply",
        "duration": 120,
        "decision": "apply_first",
        "note": "Best explicit CTO / VP Engineering room; prioritize over most Wednesday open events if accepted.",
    },
    {
        "id": "4197",
        "bucket": "apply",
        "duration": 120,
        "decision": "apply_if_accepted",
        "note": "Very high executive tech density, but Brooklyn adds friction and it follows a crowded Wednesday.",
    },
    {
        "id": "4183",
        "bucket": "apply",
        "duration": 120,
        "decision": "apply_first",
        "note": "Private engineering/platform/security leader room; excellent direct-buyer fit.",
    },
    {
        "id": "5114",
        "bucket": "apply",
        "duration": 105,
        "decision": "apply_first",
        "note": "Codebase-as-spec topic is highly aligned; conflicts with Thursday dinner paths.",
    },
    {
        "id": "5231",
        "bucket": "apply",
        "duration": 120,
        "decision": "apply_first",
        "note": "Small off-record dinner with engineering/product leaders, operators, and AI infrastructure founders.",
    },
    {
        "id": "250",
        "bucket": "apply",
        "duration": 120,
        "decision": "apply_if_energy",
        "note": "Good technical AI salon, but Friday Brooklyn is a stretch after the main week.",
    },
]


def parse_local(date_value: str, time_value: str) -> dt.datetime:
    hour, minute, second = [int(part) for part in time_value.split(":")]
    year, month, day = [int(part) for part in date_value.split("-")]
    return dt.datetime(year, month, day, hour, minute, second)


def escape_ics(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def text(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def load_events() -> dict[str, dict[str, str]]:
    with RERANK_CSV.open(newline="", encoding="utf-8-sig") as f:
        return {row["id"]: row for row in csv.DictReader(f)}


def enrich_plan(events_by_id: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    rows = []
    for item in PLAN:
        event = events_by_id[item["id"]]
        start = parse_local(event["date"], event["time"])
        end = start + dt.timedelta(minutes=item["duration"])
        rows.append(
            {
                "bucket": item["bucket"],
                "decision": item["decision"],
                "start": start.strftime("%Y-%m-%d %H:%M"),
                "end": end.strftime("%Y-%m-%d %H:%M"),
                "date": event["date"],
                "weekday": event["weekday"],
                "time": event["time"][:5],
                "end_time": end.strftime("%H:%M"),
                "location": event["location"],
                "name": event["name"],
                "host_company": event["host_company"],
                "rank": event["rank"],
                "tier": event["tier"],
                "opportunity_score": event["opportunity_score"],
                "practical_score": event["practical_score"],
                "access_bucket": event["access_bucket"],
                "event_url": event["event_url"],
                "why": item["note"],
                "fit_summary": event["fit_summary"],
                "caveats": event["caveats"],
                "description_excerpt": event["description_excerpt"],
            }
        )
    rows.sort(key=lambda row: (row["start"], {"primary": 0, "apply": 1, "backup": 2}[row["bucket"]]))
    return rows


def write_schedule_csv(rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "bucket",
        "decision",
        "start",
        "end",
        "date",
        "weekday",
        "time",
        "end_time",
        "location",
        "name",
        "host_company",
        "rank",
        "tier",
        "opportunity_score",
        "practical_score",
        "access_bucket",
        "event_url",
        "why",
        "fit_summary",
        "caveats",
        "description_excerpt",
    ]
    with SCHEDULE_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def calendar_lines(rows: list[dict[str, str]], bucket: str, calendar_name: str) -> list[str]:
    now = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//UbiquityOS//Tech Week Accolades Schedule//EN",
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
    for row in rows:
        if row["bucket"] != bucket:
            continue
        start = parse_local(row["date"], row["time"] + ":00")
        end = parse_local(row["date"], row["end_time"] + ":00")
        uid = uuid5(NAMESPACE_URL, f"techweek-2026-{bucket}-{row['event_url'] or row['name']}")
        summary_prefix = {"primary": "Tech Week", "backup": "Backup", "apply": "Apply"}[bucket]
        description = "\n".join(
            [
                row["why"],
                "",
                f"Fit: {row['fit_summary']}",
                f"Rank: {row['rank']} / Tier {row['tier']} / Opportunity {row['opportunity_score']}",
                f"Access: {row['access_bucket']}",
                f"URL: {row['event_url']}",
            ]
        )
        status = "TENTATIVE" if bucket in {"backup", "apply"} else "CONFIRMED"
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}@techweek-2026-event-picker",
                f"DTSTAMP:{now}",
                f"DTSTART;TZID={TZID}:{start.strftime('%Y%m%dT%H%M%S')}",
                f"DTEND;TZID={TZID}:{end.strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{escape_ics(summary_prefix + ': ' + row['name'])}",
                f"LOCATION:{escape_ics(row['location'])}",
                f"DESCRIPTION:{escape_ics(description)}",
                f"URL:{escape_ics(row['event_url'])}",
                f"STATUS:{status}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    return lines


def day_sections(rows: list[dict[str, str]], bucket: str) -> str:
    selected = [row for row in rows if row["bucket"] == bucket]
    dates = []
    for row in selected:
        key = (row["date"], row["weekday"])
        if key not in dates:
            dates.append(key)
    sections = []
    for date_value, weekday in dates:
        sections.append(f"### {weekday}, {date_value}")
        sections.append("")
        for row in selected:
            if row["date"] != date_value:
                continue
            sections.append(
                f"- {row['time']}-{row['end_time']} | {row['location']} | "
                f"[{row['name']}]({row['event_url']})"
            )
            sections.append(f"  - {row['decision']}: {row['why']}")
            sections.append(
                f"  - Rank {row['rank']}, tier {row['tier']}, opportunity {row['opportunity_score']}; {row['fit_summary']}"
            )
        sections.append("")
    return "\n".join(sections).strip()


def write_markdown(rows: list[dict[str, str]]) -> None:
    contents = [
        "# NYC Tech Week Accolades Schedule",
        "",
        "Assumption: primary calendar should be realistic from FiDi, favor downtown / near-downtown, and only include Midtown when the event has strong customer or strategic fit.",
        "",
        "## Primary Calendar",
        "",
        day_sections(rows, "primary"),
        "",
        "## Apply / Curated Targets",
        "",
        "These are worth applying to, but should not be the backbone of the plan until accepted.",
        "",
        day_sections(rows, "apply"),
        "",
        "## Backups",
        "",
        "Use these when a primary event is full, too far, or energy is lower than expected.",
        "",
        day_sections(rows, "backup"),
        "",
        "## Calendar Files",
        "",
        f"- Primary: [{PRIMARY_ICS.name}]({PRIMARY_ICS.name})",
        f"- Apply / tentative: [{APPLY_ICS.name}]({APPLY_ICS.name})",
        f"- Backups: [{BACKUP_ICS.name}]({BACKUP_ICS.name})",
    ]
    SCHEDULE_MD.write_text("\n".join(contents) + "\n", encoding="utf-8")


def main() -> None:
    rows = enrich_plan(load_events())
    write_schedule_csv(rows)
    write_markdown(rows)
    PRIMARY_ICS.write_text("\r\n".join(calendar_lines(rows, "primary", "NY Tech Week Accolades - Primary")) + "\r\n", encoding="utf-8")
    BACKUP_ICS.write_text("\r\n".join(calendar_lines(rows, "backup", "NY Tech Week Accolades - Backups")) + "\r\n", encoding="utf-8")
    APPLY_ICS.write_text("\r\n".join(calendar_lines(rows, "apply", "NY Tech Week Accolades - Apply")) + "\r\n", encoding="utf-8")
    print(f"wrote {SCHEDULE_MD}")
    print(f"wrote {SCHEDULE_CSV}")
    print(f"wrote {PRIMARY_ICS}")
    print(f"wrote {APPLY_ICS}")
    print(f"wrote {BACKUP_ICS}")


if __name__ == "__main__":
    main()
