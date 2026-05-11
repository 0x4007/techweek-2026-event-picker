#!/usr/bin/env python3
"""Search locally synced Apple Mail for Tech Week acceptance/status emails.

Default lower bound is 2026-05-09 18:00 America/New_York, per the user's
instruction to monitor approvals after that timestamp.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email
import re
import subprocess
import time
from email.header import decode_header, make_header
from pathlib import Path
from zoneinfo import ZoneInfo


DEFAULT_SINCE = "2026-05-09T18:00:00-04:00"
DEFAULT_RECIPIENT = "techweek2026@pavlovcik.com"
MAIL_ROOT = Path.home() / "Library/Mail"
ENVELOPE_INDEX = MAIL_ROOT / "V10/MailData/Envelope Index"

MUST_HAVE = re.compile(r"partiful|tech week|nytechweek|ny tech week|#nytechweek", re.I)
STATUS_TERMS = re.compile(
    r"approved|accepted|confirmed|you.?re in|you are in|going|guest list|host approved|"
    r"request approved|rsvp approved|off the waitlist|waitlist|pending|rejected|declined",
    re.I,
)


def decode(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def parse_date(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    parsed = email.utils.parsedate_to_datetime(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("America/New_York"))
    return parsed.astimezone(ZoneInfo("America/New_York"))


def text_from_message(message: email.message.Message) -> str:
    chunks: list[str] = []
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            if content_type not in {"text/plain", "text/html"}:
                continue
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                chunks.append(payload.decode(charset, errors="replace"))
    else:
        payload = message.get_payload(decode=True)
        if payload:
            charset = message.get_content_charset() or "utf-8"
            chunks.append(payload.decode(charset, errors="replace"))
    return "\n".join(chunks)


def summarize(path: Path, message: email.message.Message, body: str, date: dt.datetime) -> dict[str, str]:
    subject = decode(message.get("subject"))
    sender = decode(message.get("from"))
    snippet = re.sub(r"\s+", " ", body)
    match = STATUS_TERMS.search(snippet)
    if match:
        start = max(0, match.start() - 120)
        end = min(len(snippet), match.end() + 220)
        snippet = snippet[start:end]
    else:
        snippet = snippet[:340]
    return {
        "date": date.isoformat(timespec="seconds"),
        "from": sender,
        "subject": subject,
        "snippet": snippet.strip(),
        "path": str(path),
    }


def envelope_index_recipient_count(recipient: str) -> int:
    if not ENVELOPE_INDEX.exists():
        return 0
    sql = """
        select count(*)
        from messages m
        join recipients r on r.message = m.ROWID
        join addresses a on a.ROWID = r.address
        where lower(a.address) = lower(?);
    """
    try:
        output = subprocess.check_output(
            ["sqlite3", str(ENVELOPE_INDEX), ".parameter init", f".parameter set ?1 {recipient!r}", sql],
            text=True,
            timeout=15,
        )
        return int(output.strip() or "0")
    except Exception:
        # Fallback for sqlite3 versions where .parameter is awkward under subprocess.
        escaped = recipient.replace("'", "''")
        fallback_sql = sql.replace("lower(?)", f"lower('{escaped}')")
        try:
            output = subprocess.check_output(["sqlite3", str(ENVELOPE_INDEX), fallback_sql], text=True, timeout=15)
            return int(output.strip() or "0")
        except Exception:
            return 0


def rg_paths(pattern: str) -> set[Path]:
    try:
        output = subprocess.check_output(
            [
                "rg",
                "-i",
                "-l",
                pattern,
                str(MAIL_ROOT / "V10"),
                "-g",
                "*.emlx",
                "-g",
                "*.partial.emlx",
                "-g",
                "!**/Attachments/**",
            ],
            text=True,
            timeout=30,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return set()
    return {Path(line) for line in output.splitlines() if line}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default=DEFAULT_SINCE, help="ISO timestamp with timezone")
    parser.add_argument("--recipient", default=DEFAULT_RECIPIENT, help="Expected recipient/alias address")
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--full-scan", action="store_true", help="Scan every local .emlx under ~/Library/Mail")
    args = parser.parse_args()

    since = dt.datetime.fromisoformat(args.since).astimezone(ZoneInfo("America/New_York"))
    since_epoch = since.timestamp()
    matches: list[dict[str, str]] = []

    paths: set[Path] = set()
    if args.full_scan:
        paths.update(MAIL_ROOT.rglob("*.emlx"))
    else:
        # Fast path: recent synced files plus Spotlight hits for likely Tech Week mail.
        for path in MAIL_ROOT.rglob("*.emlx"):
            try:
                if path.stat().st_mtime >= since_epoch:
                    paths.add(path)
            except OSError:
                continue
        for query in ["partiful", '"Tech Week"', '"NYTechWeek"', '"NY Tech Week"']:
            try:
                output = subprocess.check_output(["mdfind", query], text=True, timeout=15)
            except Exception:
                continue
            for line in output.splitlines():
                if line.endswith(".emlx") and "/Library/Mail/" in line:
                    paths.add(Path(line))
        if args.recipient:
            paths.update(rg_paths(re.escape(args.recipient)))

    for path in sorted(paths, key=lambda item: item.stat().st_mtime if item.exists() else 0, reverse=True):
        try:
            raw = path.read_bytes()
            _, _, payload = raw.partition(b"\n")
            message = email.message_from_bytes(payload)
            date = parse_date(message.get("date"))
            if not date or date < since:
                continue
            subject = decode(message.get("subject"))
            sender = decode(message.get("from"))
            recipients = "\n".join(
                decode(message.get(header))
                for header in ["to", "cc", "bcc", "delivered-to", "x-original-to"]
                if message.get(header)
            )
            body = text_from_message(message)
            if args.recipient and args.recipient.lower() not in "\n".join([recipients, body]).lower():
                continue
            haystack = "\n".join([subject, sender, recipients, body])
            if MUST_HAVE.search(haystack) and STATUS_TERMS.search(haystack):
                matches.append(summarize(path, message, body, date))
        except Exception:
            continue

    matches.sort(key=lambda item: item["date"], reverse=True)
    print(f"Search since {since.isoformat(timespec='seconds')}")
    print(f"Recipient filter: {args.recipient}")
    print(f"Envelope Index recipient rows: {envelope_index_recipient_count(args.recipient) if args.recipient else 'n/a'}")
    print(f"Scanned files: {len(paths)}")
    print(f"Matches: {len(matches)}")
    for item in matches[: args.limit]:
        print()
        print(f"{item['date']} | {item['from']}")
        print(item["subject"])
        print(item["snippet"])
        print(item["path"])


if __name__ == "__main__":
    main()
