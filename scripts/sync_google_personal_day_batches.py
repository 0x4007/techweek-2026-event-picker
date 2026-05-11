#!/usr/bin/env python3
"""Write operational Tech Week blocks to macOS Calendar.app in day batches.

This targets the Google-backed Calendar.app calendar named "Personal".
Each day batch deletes prior managed Tech Week blocks for that day before
rewriting the current operational route.
"""

from __future__ import annotations

import argparse
import csv
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SCHEDULE_CSV = ROOT / "outputs/signed_up/techweek_signed_up_transport_schedule.csv"


def applescript_string(value: str) -> str:
    return '"' + str(value or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def applescript_date(value: str) -> str:
    date, time = value.split()
    day = int(date.split("-")[2])
    hour, minute = [int(part) for part in time.split(":")]
    return f"my makeDate({day}, {hour}, {minute})"


def description(row: dict[str, str]) -> str:
    return "\n".join(
        part
        for part in [
            f"TechWeekID: {row['techweek_id']}",
            f"CalendarBlockID: {row['calendar_block_id']}",
            f"PartifulID: {row['partiful_id']}",
            row["sales_coaching"],
            f"RSVP status: {row['status']}",
            f"Category: {row['category']}",
            row["note"],
            row["route_details"],
            f"URL: {row['event_url']}",
        ]
        if part
    )


def load_rows(day: int) -> list[dict[str, str]]:
    target = f"2026-06-{day:02d}"
    with SCHEDULE_CSV.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    return [row for row in rows if row["calendar"] == "schedule" and row["start"].startswith(target)]


def cleanup_handlers() -> list[str]:
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


def build_script(rows: list[dict[str, str]], calendar: str, timeout: int, day: int) -> str:
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
        *cleanup_handlers(),
        "",
        f"with timeout of {timeout} seconds",
        '\ttell application "Calendar"',
        f"\t\tset targetCal to calendar {applescript_string(calendar)}",
        f"\t\tset windowStart to my makeDate({day}, 0, 0)",
        f"\t\tset windowEnd to my makeDate({day + 1}, 0, 0)",
        "\t\tmy deleteManagedTechWeekEvents(targetCal, windowStart, windowEnd)",
    ]
    for row in rows:
        props = [
            f"summary:{applescript_string(row['title'])}",
            f"start date:{applescript_date(row['start'])}",
            f"end date:{applescript_date(row['end'])}",
            f"location:{applescript_string(row['location'])}",
            f"description:{applescript_string(description(row))}",
        ]
        lines.append("\t\tmake new event at end of events of targetCal with properties {" + ", ".join(props) + "}")
    lines += ["\tend tell", "end timeout", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--calendar", default="Personal")
    parser.add_argument("--days", nargs="+", type=int, default=[1, 2, 3, 4, 5])
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--process-timeout", type=int, default=360)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    for day in args.days:
        rows = load_rows(day)
        path = ROOT / f"outputs/sync/sync_google_personal_june_{day:02d}.applescript"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(build_script(rows, args.calendar, args.timeout, day), encoding="utf-8")
        print(f"{path}: {len(rows)} blocks", flush=True)
        if not args.dry_run and rows:
            subprocess.run(["osacompile", "-o", f"/tmp/{path.stem}.scpt", str(path)], check=True)
            try:
                subprocess.run(["osascript", str(path)], check=True, timeout=args.process_timeout)
            except subprocess.TimeoutExpired as exc:
                raise SystemExit(
                    f"{path} timed out after {args.process_timeout}s while syncing Calendar.app. "
                    "The target calendar is likely stalled; rerun with fewer --days or use the ICS import path."
                ) from exc


if __name__ == "__main__":
    main()
