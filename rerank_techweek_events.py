#!/usr/bin/env python3
"""Rank NYC Tech Week events for UbiquityOS Accolades prospecting.

The output is intentionally spreadsheet-first: every event remains present, but
with ranked scores, terse rationale, access flags, and filterable tags.
"""

from __future__ import annotations

import csv
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape


INPUT = Path("techweek_nyc_events_with_descriptions.csv")
ALL_OUTPUT = Path("techweek_nyc_accolades_full_rerank.csv")
OPEN_OUTPUT = Path("techweek_nyc_accolades_practical_non_invite_rerank.csv")
INVITE_OUTPUT = Path("techweek_nyc_accolades_invite_or_apply_rerank.csv")
METADATA_ONLY_OUTPUT = Path("techweek_nyc_accolades_metadata_only_rerank.csv")
TOP_PICKS = Path("techweek_nyc_accolades_full_rerank_top_picks.md")
WORKBOOK_OUTPUT = Path("techweek_nyc_accolades_rerank.xlsx")


BUYER_PATTERNS = [
    (r"\bcto(s)?\b", 16, "CTO audience"),
    (r"\bvp(s)? of engineering\b|\bvpe\b|\bvp eng\b", 18, "VP engineering audience"),
    (r"\bhead(s)? of engineering\b|\bengineering leader(s)?\b", 17, "engineering leaders"),
    (r"\bengineering manager(s)?\b|\beng manager(s)?\b", 18, "engineering managers"),
    (r"\btechnical leader(s)?\b|\btechnology leader(s)?\b|\btech leader(s)?\b", 13, "technical leaders"),
    (r"\bplatform engineering\b|\bplatform engineer(s)?\b", 15, "platform engineering"),
    (r"\bhead(s)? of platform\b|\bplatform lead(s)?\b", 14, "platform leadership"),
    (r"\bdevex\b|\bdeveloper experience\b", 16, "DevEx"),
    (r"\bengineering operations\b|\beng ops\b", 15, "engineering operations"),
    (r"\binternal tools?\b", 12, "internal tools"),
    (r"\bdevops\b|\bsre\b|\bsite reliability\b", 11, "DevOps/SRE"),
    (r"\btechnical lead(s)?\b|\bengineering lead(s)?\b|\bai architect(s)?\b", 12, "technical leads"),
    (r"\bengineering and product leader(s)?\b|\bproduct and engineering leader(s)?\b", 13, "engineering/product leaders"),
    (r"\bsenior engineer(s)?\b", 9, "senior engineers"),
    (r"\bsoftware engineer(s|ing)?\b|\bdeveloper(s)?\b", 7, "software builders"),
    (r"\btechnical founder(s)?\b|\bfounder-engineer(s)?\b", 12, "technical founders"),
    (r"\bmaintainer(s)?\b|\bospo\b|\bopen source program\b", 12, "maintainers/OSPO"),
    (r"\bdeveloper relations\b|\bdevrel\b", 8, "DevRel"),
    (r"\bc[- ]suite\b|\bexecutive(s)?\b", 7, "executives"),
]

PRODUCT_PATTERNS = [
    (r"\bgithub\b|\bgitlab\b|\bpull request(s)?\b|\bpr review(s)?\b|\bcode review(s)?\b", 18, "GitHub/code review evidence"),
    (r"\bslack\b|\bcollaboration evidence\b|\bwork evidence\b|\bcontribution evidence\b", 15, "collaboration evidence"),
    (r"\bcontribution ledger\b|\breward(s|ing)?\b|\brecognition\b|\bincentive(s)?\b|\bbount(y|ies)\b|\bgrant(s)?\b", 13, "contribution rewards"),
    (r"\bmanager report(s)?\b|\baudit trail(s)?\b|\bauditable\b|\battribution\b|\bsource[- ]linked\b", 13, "manager/audit reporting"),
    (r"\bdeveloper productivity\b|\bengineering productivity\b|\bship(ping)? faster\b|\bsoftware delivery\b", 15, "engineering productivity"),
    (r"\bsoftware workflow(s)?\b|\bdeveloper workflow(s)?\b|\bengineering workflow(s)?\b|\bdevelopment process\b|\bsdlc\b|\bci/cd\b", 14, "engineering workflows"),
    (r"\bcoding agent(s)?\b|\bai coding\b|\bcodebase\b|\bcode base\b|\bide\b|\bmcp\b|\bagentic coding\b", 16, "AI coding workflows"),
    (r"\bspec(s)?\b|\brequirement(s)?\b|\bdocumentation\b|\btribal knowledge\b|\bknowledge base\b|\bsemantic context\b|\baudit trail(s)?\b", 10, "specs/knowledge capture"),
    (r"\bwrite, review, ship, and maintain code\b|\breview, ship, and maintain code\b|\bhow software gets built\b", 16, "software work practices"),
    (r"\brepository scanning\b|\bdependency and intent graph\b|\bblast radius\b|\bcode review misses\b", 14, "repository/code evidence"),
    (r"\bopen source\b|\boss\b", 11, "open source fit"),
]

TOPIC_PATTERNS = [
    (r"\bdevtools?\b|\bdeveloper tool(s|ing)?\b|\bapi(s)?\b|\bsdk(s)?\b", 16, "devtools"),
    (r"\binfra(structure)?\b|\bcloud\b|\bplatform\b|\bdatabase(s)?\b|\bobservability\b", 13, "infra/platform"),
    (r"\bai\b|\bartificial intelligence\b|\bllm(s)?\b|\bagent(s|ic)?\b|\bgenai\b", 10, "AI"),
    (r"\benterprise\b|\bsecurity\b|\bgovernance\b|\bcompliance\b|\bprocurement\b", 10, "enterprise"),
    (r"\bsaas\b|\bb2b\b", 8, "B2B SaaS"),
    (r"\bcrypto\b|\bweb3\b|\bonchain\b|\bblockchain\b|\btoken(s)?\b", 8, "crypto/web3"),
]

SIGNAL_PATTERNS = [
    (r"\bcurated\b|\bhand[- ]selected\b|\bselected group\b", 9, "curated room"),
    (r"\bprivate\b|\binvite[- ]only\b|\bby invitation\b", 9, "private/invite"),
    (r"\bdinner\b|\broundtable\b|\bsalon\b|\bfireside\b", 8, "high-signal format"),
    (r"\b30[- ]person\b|\bsmall group\b|\blimited seats\b|\blimited capacity\b", 8, "small room"),
    (r"\bleader(s)?\b|\boperator(s)?\b|\bexecutive(s)?\b|\bbuilder(s)?\b", 5, "builders/operators"),
    (r"\bbuyers? and builders?\b|\bpeople buying\b|\bbuying ai\b", 8, "buyer-builder room"),
    (r"\bfounder(s)?\b", 4, "founders"),
    (r"\bhappy hour\b|\bmixer\b|\bnetwork(ing)?\b", 4, "networking format"),
]

NEGATIVE_PATTERNS = [
    (r"\bstudent(s)?\b|\bcollege\b|\bcampus\b|\bintern(s|ship)?\b", -16, "student-heavy"),
    (r"\bjob seeker(s)?\b|\bcareer fair\b|\bresume\b|\bhiring fair\b", -12, "career/job-seeker"),
    (r"\bwellness\b|\byoga\b|\brun club\b|\bworkout\b|\bpilates\b|\bmeditation\b", -12, "wellness/social"),
    (r"\bfashion\b|\bbeauty\b|\bfood\b|\brestaurant\b|\bconsumer brand\b", -10, "consumer/lifestyle"),
    (r"\bhealthcare\b|\bbiotech\b|\bclinical\b|\bpatient\b|\bmedtech\b", -7, "healthcare vertical"),
    (r"\breal estate\b|\bproptech\b|\bclimate\b|\benergy\b|\blegal\b|\bedtech\b|\bsports\b|\bhospitality\b|\btravel\b|\bneurotech\b|\bgaming\b", -7, "off-ICP vertical"),
    (r"\bmarketer(s)?\b|\bmarketing\b|\bbrand\b|\bcreator(s)?\b|\binfluencer(s)?\b|\brevops\b|\bgtm\b|\bads?\b|\bdtc\b|\be[- ]?com(merce)?\b", -12, "marketing/GTM/creator"),
    (r"\bwealth\b|\bprivate equity\b|\blp[- ]gp\b|\blp–gp\b|\bcapital markets\b|\bcultural infrastructure\b", -9, "finance/investor vertical"),
    (r"\binvestor(s)? only\b|\blp(s)?\b|\bfund manager(s)?\b", -8, "investor-heavy"),
    (r"\bhackathon\b", -8, "hackathon"),
    (r"\bbeginner(s)?\b|\bintro to\b|\b101\b", -5, "beginner content"),
]

ACCESS_RE = re.compile(
    r"\binvite[- ]only\b|\bby invitation\b|\bapply\b|\bapplication\b|\bapproval\b|"
    r"\bapproved\b|\bcurated\b|\bprivate\b|\bconfirmed by (the )?host\b|\bvenue shared\b|"
    r"\blimited seats\b|\blimited capacity\b",
)

TIME_RE = re.compile(r"^(\d{2}):(\d{2})")


@dataclass
class Score:
    value: int
    hits: list[str]


def clean(value: str | None) -> str:
    return (value or "").strip()


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def score_patterns(text: str, patterns: list[tuple[str, int, str]], cap: int | None = None) -> Score:
    total = 0
    hits: list[str] = []
    for pattern, points, label in patterns:
        if re.search(pattern, text):
            total += points
            if label not in hits:
                hits.append(label)
    if cap is not None:
        total = min(total, cap)
    return Score(total, hits)


def location_score(location: str) -> tuple[int, str]:
    loc = location.lower()
    if not loc:
        return 0, "unknown location"
    if "virtual" in loc:
        return -8, "virtual"
    if any(x in loc for x in ["financial district", "tribeca", "soho", "lower east side", "east village", "chinatown"]):
        return 8, "downtown convenient"
    if any(x in loc for x in ["flatiron", "union square", "nomad", "greenwich village", "west village"]):
        return 6, "near downtown"
    if any(x in loc for x in ["chelsea", "meatpacking", "gramercy"]):
        return 4, "reasonable Manhattan"
    if "midtown" in loc or "murray hill" in loc or "korea town" in loc or "kips bay" in loc or "hudson yards" in loc:
        return 2, "midtown reachable"
    if any(x in loc for x in ["brooklyn", "queens", "bronx", "long island", "upper manhattan", "upper east"]):
        return -5, "less convenient"
    return 0, "neutral location"


def schedule_score(date: str, weekday: str, time_value: str, time_bucket: str) -> tuple[int, str]:
    score = 0
    reasons: list[str] = []
    if weekday == "Monday":
        score += 6
        reasons.append("early-week push")
    elif weekday == "Tuesday":
        score += 8
        reasons.append("peak early-week day")
    elif weekday == "Wednesday":
        score += 7
        reasons.append("peak midweek day")
    elif weekday == "Thursday":
        score += 4
        reasons.append("still high-density")
    elif weekday == "Friday":
        score += 1
        reasons.append("taper day")
    elif weekday in {"Saturday", "Sunday"}:
        score -= 5
        reasons.append("weekend")
    if date == "2026-06-11":
        score -= 10
        reasons.append("outside main week")

    bucket = time_bucket.lower()
    if bucket == "evening":
        score += 5
        reasons.append("evening friendly")
    elif bucket == "afternoon":
        score += 3
        reasons.append("afternoon")
    elif bucket == "noon":
        score += 1
        reasons.append("midday")
    elif bucket == "morning":
        score -= 3
        reasons.append("morning drag")

    match = TIME_RE.match(time_value or "")
    if match:
        hour = int(match.group(1))
        if hour < 9:
            score -= 6
            reasons.append("very early")
        elif hour < 10:
            score -= 3
            reasons.append("early")
        elif hour >= 21:
            score -= 2
            reasons.append("late")

    return score, ", ".join(reasons) if reasons else "neutral schedule"


def access_bucket(row: dict[str, str], text: str) -> tuple[str, int]:
    if clean(row.get("invite_only")).lower() == "true":
        return "invite_only_source", -8
    if not clean(row.get("event_url")):
        return "metadata_only_no_url", -12
    if ACCESS_RE.search(text):
        return "apply_or_curated", -2
    return "open_or_rsvp", 5


def classify_action(tier: str, access: str, practical_score: int) -> str:
    if tier in {"S", "A"} and access in {"invite_only_source", "apply_or_curated"}:
        return "Apply first"
    if tier in {"S", "A"}:
        return "Register now"
    if tier == "B" and practical_score >= 48:
        return "Consider if it fits schedule"
    if tier == "B":
        return "Backup option"
    if tier == "C":
        return "Low priority"
    return "Skip"


def tier_for(score: int) -> str:
    if score >= 74:
        return "S"
    if score >= 60:
        return "A"
    if score >= 45:
        return "B"
    if score >= 30:
        return "C"
    return "D"


def confidence(row: dict[str, str], score: int, hit_count: int) -> str:
    has_desc = bool(clean(row.get("event_description")))
    if has_desc and score >= 60 and hit_count >= 5:
        return "high"
    if has_desc and hit_count >= 3:
        return "medium"
    if has_desc:
        return "low-medium"
    if hit_count >= 3:
        return "medium from metadata"
    return "low from metadata"


def summarize_text(value: str, limit: int = 260) -> str:
    text = normalize_space(value)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def score_row(row: dict[str, str]) -> dict[str, str | int]:
    name = clean(row.get("name"))
    description = clean(row.get("event_description"))
    hosts = clean(row.get("all_hosts")) or clean(row.get("primary_host")) or clean(row.get("company"))
    location = clean(row.get("location"))
    haystack = normalize_space(" ".join([name, description, hosts, location])).lower()

    buyer = score_patterns(haystack, BUYER_PATTERNS, cap=42)
    product = score_patterns(haystack, PRODUCT_PATTERNS, cap=38)
    topic = score_patterns(haystack, TOPIC_PATTERNS, cap=32)
    signal = score_patterns(haystack, SIGNAL_PATTERNS, cap=28)
    negative = score_patterns(haystack, NEGATIVE_PATTERNS)
    loc_score, loc_reason = location_score(location)
    sched_score, sched_reason = schedule_score(
        clean(row.get("date")),
        clean(row.get("weekday")),
        clean(row.get("time")),
        clean(row.get("time_bucket")),
    )
    access, access_reliability = access_bucket(row, haystack)

    description_bonus = 4 if description else -6
    opportunity_score = (
        buyer.value
        + product.value
        + topic.value
        + signal.value
        + loc_score
        + sched_score
        + description_bonus
        + negative.value
    )
    practical_score = opportunity_score + access_reliability

    if any(hit in buyer.hits for hit in ["CTO audience", "VP engineering audience", "engineering managers", "engineering leaders"]):
        practical_score += 5
        opportunity_score += 4
    if "GitHub/code review evidence" in product.hits and ("AI coding workflows" in product.hits or "devtools" in topic.hits):
        practical_score += 5
        opportunity_score += 5
    if "software work practices" in product.hits and ("DevEx" in buyer.hits or "technical leads" in buyer.hits):
        practical_score += 6
        opportunity_score += 6
    if "buyer-builder room" in signal.hits and topic.value >= 10:
        practical_score += 4
        opportunity_score += 5
    if access in {"invite_only_source", "apply_or_curated"} and signal.value >= 12:
        opportunity_score += 5

    core_fit = buyer.value + product.value
    strong_devtools_context = any(hit in topic.hits for hit in ["devtools", "infra/platform"]) and "AI" in topic.hits
    if core_fit < 12:
        opportunity_score = min(opportunity_score, 64 if strong_devtools_context else 56)
        practical_score = min(practical_score, 69 if strong_devtools_context else 61)
    elif core_fit < 24 and negative.value <= -12:
        opportunity_score = min(opportunity_score, 62)
        practical_score = min(practical_score, 67)
    elif core_fit < 24 and negative.value < 0:
        opportunity_score = min(opportunity_score, 70)
        practical_score = min(practical_score, 75)
    if "marketing/GTM/creator" in negative.hits and core_fit < 30:
        opportunity_score = min(opportunity_score, 58)
        practical_score = min(practical_score, 63)
    if "finance/investor vertical" in negative.hits and core_fit < 30:
        opportunity_score = min(opportunity_score, 60)
        practical_score = min(practical_score, 65)
    if "student-heavy" in negative.hits or "wellness/social" in negative.hits:
        opportunity_score = min(opportunity_score, 52)
        practical_score = min(practical_score, 57)

    opportunity_score = max(0, min(100, opportunity_score))
    practical_score = max(0, min(100, practical_score))
    tier = tier_for(opportunity_score)

    hits = buyer.hits + product.hits + topic.hits + signal.hits
    caveats = [loc_reason, sched_reason]
    if negative.hits:
        caveats.append("off-ICP signals: " + ", ".join(negative.hits[:3]))
    if not description:
        caveats.append("no fetched description")
    if access != "open_or_rsvp":
        caveats.append(access.replace("_", " "))

    fit_labels = []
    if buyer.hits:
        fit_labels.append("buyer: " + ", ".join(buyer.hits[:3]))
    if product.hits:
        fit_labels.append("product: " + ", ".join(product.hits[:3]))
    if topic.hits:
        fit_labels.append("topic: " + ", ".join(topic.hits[:3]))
    if signal.hits:
        fit_labels.append("signal: " + ", ".join(signal.hits[:2]))

    return {
        "opportunity_score": opportunity_score,
        "practical_score": practical_score,
        "tier": tier,
        "recommended_action": classify_action(tier, access, practical_score),
        "confidence": confidence(row, opportunity_score, len(hits)),
        "access_bucket": access,
        "buyer_fit_score": buyer.value,
        "product_fit_score": product.value,
        "topic_fit_score": topic.value,
        "signal_score": signal.value,
        "location_score": loc_score,
        "schedule_score": sched_score,
        "negative_score": negative.value,
        "fit_summary": "; ".join(fit_labels) if fit_labels else "weak explicit ICP signals",
        "matched_signals": ", ".join(hits[:12]),
        "caveats": "; ".join(caveats),
        "description_excerpt": summarize_text(description),
    }


def sort_key(row: dict[str, str | int]) -> tuple:
    return (
        -int(row["opportunity_score"]),
        -int(row["practical_score"]),
        str(row.get("date", "")),
        str(row.get("time", "")),
        str(row.get("name", "")),
    )


def write_csv(path: Path, rows: list[dict[str, str | int]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def excel_col(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_xml(row_index: int, col_index: int, value: str | int) -> str:
    ref = f"{excel_col(col_index)}{row_index}"
    if isinstance(value, int):
        return f'<c r="{ref}"><v>{value}</v></c>'
    text = str(value or "")
    text = text[:32767]
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def worksheet_xml(rows: list[dict[str, str | int]], fieldnames: list[str]) -> str:
    last_col = excel_col(len(fieldnames))
    last_row = max(1, len(rows) + 1)
    widths = []
    for index, fieldname in enumerate(fieldnames, start=1):
        width = 16
        if fieldname in {"name", "event_url", "local_html_path", "fit_summary", "matched_signals", "caveats"}:
            width = 38
        elif fieldname in {"description_excerpt", "event_description"}:
            width = 60
        elif fieldname in {"rank", "tier", "date", "time", "location", "recommended_action"}:
            width = 14
        widths.append(f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>')

    xml_rows = []
    header_cells = [cell_xml(1, index, fieldname) for index, fieldname in enumerate(fieldnames, start=1)]
    xml_rows.append(f'<row r="1">{"".join(header_cells)}</row>')
    for row_index, row in enumerate(rows, start=2):
        cells = [cell_xml(row_index, index, row.get(fieldname, "")) for index, fieldname in enumerate(fieldnames, start=1)]
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
        'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f'<cols>{"".join(widths)}</cols>'
        f'<sheetData>{"".join(xml_rows)}</sheetData>'
        f'<autoFilter ref="A1:{last_col}{last_row}"/>'
        '</worksheet>'
    )


def write_xlsx(path: Path, sheets: list[tuple[str, list[dict[str, str | int]], list[str]]]) -> None:
    content_types = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    for index in range(1, len(sheets) + 1):
        content_types.append(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    content_types.append("</Types>")

    workbook_sheets = []
    workbook_rels = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ]
    for index, (name, _, _) in enumerate(sheets, start=1):
        workbook_sheets.append(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>')
        workbook_rels.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{index}.xml"/>'
        )
    workbook_rels.append(
        f'<Relationship Id="rId{len(sheets) + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )
    workbook_rels.append("</Relationships>")

    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{"".join(workbook_sheets)}</sheets>'
        '</workbook>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts>'
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>'
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as workbook_zip:
        workbook_zip.writestr("[Content_Types].xml", "".join(content_types))
        workbook_zip.writestr("_rels/.rels", root_rels)
        workbook_zip.writestr("xl/workbook.xml", workbook)
        workbook_zip.writestr("xl/_rels/workbook.xml.rels", "".join(workbook_rels))
        workbook_zip.writestr("xl/styles.xml", styles)
        for index, (_, rows, fieldnames) in enumerate(sheets, start=1):
            workbook_zip.writestr(f"xl/worksheets/sheet{index}.xml", worksheet_xml(rows, fieldnames))


def make_markdown(
    all_rows: list[dict[str, str | int]],
    open_rows: list[dict[str, str | int]],
    invite_rows: list[dict[str, str | int]],
    metadata_rows: list[dict[str, str | int]],
) -> str:
    def table(rows: list[dict[str, str | int]], limit: int) -> str:
        lines = ["| Rank | Tier | Date | Time | Location | Event | Action | Why |", "|---:|---|---|---|---|---|---|---|"]
        for row in rows[:limit]:
            why = str(row["fit_summary"]).replace("|", "/")
            event = f"[{row['name']}]({row['event_url']})" if row.get("event_url") else str(row["name"])
            lines.append(
                f"| {row['rank']} | {row['tier']} | {row['date']} | {str(row['time'])[:5]} | "
                f"{row['location']} | {event} | {row['recommended_action']} | {why} |"
            )
        return "\n".join(lines)

    return "\n\n".join(
        [
            "# NYC Tech Week Accolades Full Rerank",
            "Ranking goal: meet NYC local founders and find Accolades buyers, especially CTOs, engineering managers, DevEx, platform/internal-tools, AI infra, enterprise SaaS, open-source, and crypto/web3 teams.",
            "Scores combine ICP buyer fit, product/topic fit, room signal, location convenience from FiDi, early-week energy, description confidence, and access risk. The CSVs keep all rows for filtering.",
            "## Top Practical Non-Invite Picks",
            table(open_rows, 30),
            "## Top Invite / Apply / Curated Picks",
            table(invite_rows, 25),
            "## Top Overall Opportunities",
            table(all_rows, 40),
            "## Metadata-Only Rows Worth Manual Checking",
            table(metadata_rows, 15),
        ]
    ) + "\n"


def main() -> None:
    with INPUT.open(newline="", encoding="utf-8-sig") as f:
        source_rows = list(csv.DictReader(f))

    ranked: list[dict[str, str | int]] = []
    for source in source_rows:
        scored = score_row(source)
        ranked.append({**scored, **source})

    ranked.sort(key=sort_key)
    for index, row in enumerate(ranked, start=1):
        row["rank"] = index

    fieldnames = [
        "rank",
        "tier",
        "recommended_action",
        "opportunity_score",
        "practical_score",
        "confidence",
        "access_bucket",
        "buyer_fit_score",
        "product_fit_score",
        "topic_fit_score",
        "signal_score",
        "location_score",
        "schedule_score",
        "negative_score",
        "fit_summary",
        "matched_signals",
        "caveats",
        "description_excerpt",
    ] + [name for name in source_rows[0].keys()]

    write_csv(ALL_OUTPUT, ranked, fieldnames)

    open_rows = [row for row in ranked if row["access_bucket"] == "open_or_rsvp"]
    open_rows.sort(
        key=lambda row: (
            -int(row["practical_score"]),
            -int(row["opportunity_score"]),
            str(row.get("date", "")),
            str(row.get("time", "")),
            str(row.get("name", "")),
        )
    )
    for index, row in enumerate(open_rows, start=1):
        row["open_rank"] = index

    invite_rows = [row for row in ranked if row["access_bucket"] in {"invite_only_source", "apply_or_curated"}]
    invite_rows.sort(key=sort_key)
    for index, row in enumerate(invite_rows, start=1):
        row["invite_rank"] = index

    metadata_rows = [row for row in ranked if row["access_bucket"] == "metadata_only_no_url"]
    metadata_rows.sort(key=sort_key)
    for index, row in enumerate(metadata_rows, start=1):
        row["metadata_rank"] = index

    open_fieldnames = ["open_rank"] + fieldnames
    invite_fieldnames = ["invite_rank"] + fieldnames
    metadata_fieldnames = ["metadata_rank"] + fieldnames
    write_csv(OPEN_OUTPUT, open_rows, open_fieldnames)
    write_csv(INVITE_OUTPUT, invite_rows, invite_fieldnames)
    write_csv(METADATA_ONLY_OUTPUT, metadata_rows, metadata_fieldnames)
    write_xlsx(
        WORKBOOK_OUTPUT,
        [
            ("Practical Non-Invite", open_rows, open_fieldnames),
            ("Invite or Apply", invite_rows, invite_fieldnames),
            ("Full Rerank", ranked, fieldnames),
            ("Metadata Only", metadata_rows, metadata_fieldnames),
        ],
    )
    TOP_PICKS.write_text(make_markdown(ranked, open_rows, invite_rows, metadata_rows), encoding="utf-8")

    print(f"source rows: {len(source_rows)}")
    print(f"all ranked: {len(ranked)} -> {ALL_OUTPUT}")
    print(f"open/rsvp: {len(open_rows)} -> {OPEN_OUTPUT}")
    print(f"invite/apply/curated: {len(invite_rows)} -> {INVITE_OUTPUT}")
    print(f"metadata only/no URL: {len(metadata_rows)} -> {METADATA_ONLY_OUTPUT}")
    print(f"workbook: {WORKBOOK_OUTPUT}")
    print(f"top picks: {TOP_PICKS}")


if __name__ == "__main__":
    main()
