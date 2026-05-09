#!/usr/bin/env python3
"""Write operational Tech Week blocks to macOS Calendar.app in day batches.

This targets the Google-backed Calendar.app calendar named "Personal".
It intentionally does not scan/delete first because reads against that synced
calendar timed out over SSH. Use only when duplicate risk is acceptable.
"""

from __future__ import annotations

import argparse
import csv
import subprocess
from pathlib import Path


SCHEDULE_CSV = Path("techweek_signed_up_transport_schedule.csv")


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


def build_script(rows: list[dict[str, str]], calendar: str, timeout: int) -> str:
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
        f"with timeout of {timeout} seconds",
        '\ttell application "Calendar"',
        f"\t\tset targetCal to calendar {applescript_string(calendar)}",
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
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    for day in args.days:
        rows = load_rows(day)
        path = Path(f"sync_google_personal_june_{day:02d}.applescript")
        path.write_text(build_script(rows, args.calendar, args.timeout), encoding="utf-8")
        print(f"{path}: {len(rows)} blocks")
        if not args.dry_run and rows:
            subprocess.run(["osacompile", "-o", f"/tmp/{path.stem}.scpt", str(path)], check=True)
            subprocess.run(["osascript", str(path)], check=True)


if __name__ == "__main__":
    main()
