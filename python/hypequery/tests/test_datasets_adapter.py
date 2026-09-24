"""The sql-portability-v1 conformance adapter's NDJSON contract."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import cast


def _run(*messages: dict[str, object]) -> list[dict[str, object]]:
    payload = "\n".join([*(json.dumps(message) for message in messages), ""])
    completed = subprocess.run(
        [sys.executable, "-m", "hypequery.datasets.adapter"],
        input=payload,
        text=True,
        capture_output=True,
        check=True,
    )
    return [cast(dict[str, object], json.loads(line)) for line in completed.stdout.splitlines()]


def test_adapter_announces_only_sql_portability() -> None:
    responses = _run({"type": "hello", "protocol": 1}, {"type": "end"})

    hello = responses[0]
    assert hello["families"] == ["sql-portability-v1"]
    assert hello["language"] == "python"
    # Only the protocol adapter declares an RFC 0012 hostile-object suite.
    assert "hostileObjectSuite" not in hello


def test_adapter_reports_expression_dependencies_and_issue_offsets() -> None:
    responses = _run(
        {"type": "hello", "protocol": 1},
        {
            "type": "case",
            "seq": 1,
            "family": "sql-portability-v1",
            "role": "portable",
            "case": {"id": "product", "sql": "price * quantity"},
        },
        {
            "type": "case",
            "seq": 2,
            "family": "sql-portability-v1",
            "role": "non-portable",
            "case": {"id": "modulo", "sql": "a % 2"},
        },
        {"type": "end"},
    )

    portable = cast(dict[str, object], responses[1]["output"])
    assert portable["dependencies"] == ["price", "quantity"]
    assert cast(dict[str, object], portable["expression"])["operator"] == "multiply"

    assert responses[2]["ok"] is False
    assert responses[2]["code"] == "HQ_SQL_PORT_UNSUPPORTED_OPERATOR"
    assert cast(dict[str, object], responses[2]["output"])["start"] == 2


def test_adapter_materializes_the_compact_repeat_form() -> None:
    responses = _run(
        {"type": "hello", "protocol": 1},
        {
            "type": "case",
            "seq": 1,
            "family": "sql-portability-v1",
            "role": "non-portable",
            "case": {
                "id": "repeat",
                "sqlRepeat": {"prefix": "a + ", "value": "(", "count": 40, "suffix": "b"},
            },
        },
        {"type": "end"},
    )

    assert responses[1]["ok"] is False
    assert responses[1]["code"] == "HQ_SQL_PORT_TOO_COMPLEX"
