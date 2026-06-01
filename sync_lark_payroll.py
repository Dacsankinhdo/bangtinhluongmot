#!/usr/bin/env python3
"""
Sync attendance data from a dynamic Lark Base source table into a fixed payroll table.

Usage:
  python sync_lark_payroll.py "https://dacsankinhdo.sg.larksuite.com/base/MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblnpozKA9FKISqQ&view=vewv0KTGjJ#time-settings"
  python sync_lark_payroll.py --dry-run "https://..."
  python sync_lark_payroll.py --self-test

The script always runs the SOURCE_URL parser test before calling Lark OpenAPI.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen


LARK_OPENAPI_HOST = "https://open.larksuite.com"

APP_ID = os.getenv("LARK_APP_ID", "cli_a975bd3a93b99eed")
APP_SECRET = os.getenv("LARK_APP_SECRET", "")

DESTINATION_APP_TOKEN = "MYsqbAZWwamm6NsDRUNlkRc0gEg"
DESTINATION_TABLE_ID = "tblgL5ME8fR2c8mc"

SOURCE_NAME_FIELD = "Name"
SOURCE_RESULT_FIELD = "Result"
DESTINATION_NAME_FIELD = "Tên NV"
DESTINATION_WORK_DAYS_FIELD = "Ngày công TT"
DESTINATION_LATE_COUNT_FIELD = "Số lần trễ"

SAMPLE_SOURCE_URL = (
    "https://dacsankinhdo.sg.larksuite.com/base/"
    "MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblnpozKA9FKISqQ&view=vewv0KTGjJ#time-settings"
)


@dataclass(frozen=True)
class SourceTable:
    app_token: str
    table_id: str


@dataclass
class AttendanceSummary:
    work_days: int = 0
    late_count: int = 0


class LarkApiError(RuntimeError):
    pass


def parse_source_url(source_url: str) -> SourceTable:
    """Extract source app token and table id from a Lark Base URL."""
    parsed = urlparse(source_url)
    path_parts = [part for part in parsed.path.split("/") if part]

    try:
        base_index = path_parts.index("base")
        app_token = path_parts[base_index + 1]
    except (ValueError, IndexError) as exc:
        raise ValueError("SOURCE_URL must contain /base/{app_token}") from exc

    query = parse_qs(parsed.query)
    table_values = query.get("table")
    if not table_values or not table_values[0]:
        raise ValueError("SOURCE_URL must contain query parameter table={table_id}")

    return SourceTable(app_token=app_token, table_id=table_values[0])


def run_parse_test() -> None:
    parsed = parse_source_url(SAMPLE_SOURCE_URL)
    assert parsed.app_token == "MYsqbAZWwamm6NsDRUNlkRc0gEg"
    assert parsed.table_id == "tblnpozKA9FKISqQ"
    print(
        "[OK] Parse test:",
        f"app_token={parsed.app_token}, table_id={parsed.table_id}",
    )


def api_request(
    method: str,
    path: str,
    *,
    token: str | None = None,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    query = f"?{urlencode(params)}" if params else ""
    url = f"{LARK_OPENAPI_HOST}{path}{query}"
    payload = json.dumps(body).encode("utf-8") if body is not None else None

    headers = {"Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(url, data=payload, headers=headers, method=method)

    try:
        with urlopen(request, timeout=30) as response:
            response_body = response.read().decode("utf-8")
    except HTTPError as exc:
        response_text = exc.read().decode("utf-8", errors="replace")
        raise LarkApiError(f"HTTP {exc.code} for {method} {path}: {response_text}") from exc
    except URLError as exc:
        raise LarkApiError(f"Network error for {method} {path}: {exc.reason}") from exc

    data = json.loads(response_body)
    if data.get("code") != 0:
        raise LarkApiError(f"Lark API error for {method} {path}: {data}")
    return data


def get_tenant_access_token() -> str:
    if not APP_SECRET:
        raise LarkApiError("Missing LARK_APP_SECRET environment variable")

    data = api_request(
        "POST",
        "/open-apis/auth/v3/tenant_access_token/internal",
        body={"app_id": APP_ID, "app_secret": APP_SECRET},
    )
    token = data.get("tenant_access_token")
    if not token:
        raise LarkApiError("tenant_access_token is missing from Lark response")
    return token


def list_records(
    app_token: str,
    table_id: str,
    token: str,
    field_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    page_token = ""

    while True:
        params: dict[str, Any] = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        if field_names:
            params["field_names"] = json.dumps(field_names, ensure_ascii=False)

        data = api_request(
            "GET",
            f"/open-apis/bitable/v1/apps/{quote(app_token)}/tables/{quote(table_id)}/records",
            token=token,
            params=params,
        )
        page_data = data.get("data") or {}
        records.extend(page_data.get("items") or [])

        if not page_data.get("has_more"):
            return records
        page_token = page_data.get("page_token") or ""
        if not page_token:
            raise LarkApiError("Lark response has_more=true but page_token is empty")


def batch_update_records(
    app_token: str,
    table_id: str,
    token: str,
    updates: list[dict[str, Any]],
) -> None:
    for index in range(0, len(updates), 500):
        chunk = updates[index : index + 500]
        api_request(
            "POST",
            f"/open-apis/bitable/v1/apps/{quote(app_token)}/tables/{quote(table_id)}/records/batch_update",
            token=token,
            body={"records": chunk},
        )


def cell_to_text(value: Any) -> str:
    """Normalize common Lark Base cell shapes into comparable plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value).strip()
    if isinstance(value, dict):
        for key in ("text", "name", "value"):
            if key in value:
                return cell_to_text(value[key])
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, list):
        return "".join(cell_to_text(item) for item in value).strip()
    return str(value).strip()


def normalize_name(name: str) -> str:
    return " ".join(name.split()).casefold()


def is_valid_attendance_record(name: str, result: str) -> bool:
    return bool(name) and bool(result)


def aggregate_attendance(records: list[dict[str, Any]]) -> dict[str, AttendanceSummary]:
    summaries: dict[str, AttendanceSummary] = {}
    display_names: dict[str, str] = {}

    for record in records:
        fields = record.get("fields") or {}
        name = cell_to_text(fields.get(SOURCE_NAME_FIELD))
        result = cell_to_text(fields.get(SOURCE_RESULT_FIELD))

        if not is_valid_attendance_record(name, result):
            continue

        name_key = normalize_name(name)
        display_names.setdefault(name_key, name)
        summary = summaries.setdefault(display_names[name_key], AttendanceSummary())
        summary.work_days += 1
        if result.casefold() == "very late":
            summary.late_count += 1

    return summaries


def build_destination_index(records: list[dict[str, Any]]) -> dict[str, str]:
    index: dict[str, str] = {}
    duplicates: list[str] = []

    for record in records:
        record_id = record.get("record_id")
        fields = record.get("fields") or {}
        name = cell_to_text(fields.get(DESTINATION_NAME_FIELD))
        if not record_id or not name:
            continue

        name_key = normalize_name(name)
        if name_key in index:
            duplicates.append(name)
            continue
        index[name_key] = record_id

    if duplicates:
        raise ValueError(
            "Destination table has duplicated employee names in field "
            f"{DESTINATION_NAME_FIELD}: {', '.join(sorted(set(duplicates)))}"
        )

    return index


def build_updates(
    summaries: dict[str, AttendanceSummary],
    destination_index: dict[str, str],
) -> tuple[list[dict[str, Any]], list[str]]:
    updates: list[dict[str, Any]] = []
    missing_names: list[str] = []

    for name, summary in sorted(summaries.items(), key=lambda item: normalize_name(item[0])):
        record_id = destination_index.get(normalize_name(name))
        if not record_id:
            missing_names.append(name)
            continue
        updates.append(
            {
                "record_id": record_id,
                "fields": {
                    DESTINATION_WORK_DAYS_FIELD: summary.work_days,
                    DESTINATION_LATE_COUNT_FIELD: summary.late_count,
                },
            }
        )

    return updates, missing_names


def sync_payroll(source_url: str, *, dry_run: bool = False) -> None:
    source = parse_source_url(source_url)
    print(f"Source app_token={source.app_token}, table_id={source.table_id}")

    token = get_tenant_access_token()
    print("Fetched tenant_access_token.")

    source_records = list_records(
        source.app_token,
        source.table_id,
        token,
        field_names=[SOURCE_NAME_FIELD, SOURCE_RESULT_FIELD],
    )
    summaries = aggregate_attendance(source_records)
    print(f"Read {len(source_records)} source records, summarized {len(summaries)} employees.")

    destination_records = list_records(
        DESTINATION_APP_TOKEN,
        DESTINATION_TABLE_ID,
        token,
        field_names=[
            DESTINATION_NAME_FIELD,
            DESTINATION_WORK_DAYS_FIELD,
            DESTINATION_LATE_COUNT_FIELD,
        ],
    )
    destination_index = build_destination_index(destination_records)
    updates, missing_names = build_updates(summaries, destination_index)

    print(f"Prepared {len(updates)} destination updates.")
    if missing_names:
        print(
            "[WARN] These names were not found in the payroll table:",
            ", ".join(missing_names),
        )

    if dry_run:
        print("[DRY RUN] No records were updated.")
        print(json.dumps(updates, ensure_ascii=False, indent=2))
        return

    if not updates:
        print("No matching destination records to update.")
        return

    batch_update_records(DESTINATION_APP_TOKEN, DESTINATION_TABLE_ID, token, updates)
    print(f"Updated {len(updates)} payroll records.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aggregate Lark Base attendance records into the fixed payroll table."
    )
    parser.add_argument(
        "source_url",
        nargs="?",
        default=os.getenv("SOURCE_URL"),
        help="Lark Base source URL. You can also set SOURCE_URL env var.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and summarize data, but do not update the payroll table.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Only run the SOURCE_URL parser test, then exit.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    run_parse_test()

    if args.self_test:
        return 0

    if not args.source_url:
        print("Missing SOURCE_URL. Pass it as an argument or set SOURCE_URL env var.", file=sys.stderr)
        return 2

    sync_payroll(args.source_url, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
