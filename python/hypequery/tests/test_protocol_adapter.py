from __future__ import annotations

import json
import subprocess
import sys
from typing import cast


def test_adapter_announces_pinned_families_and_hostile_suite() -> None:
    messages = "\n".join(
        (
            json.dumps({"type": "hello", "protocol": 1}),
            json.dumps({"type": "end"}),
            "",
        )
    )
    completed = subprocess.run(
        [sys.executable, "-m", "hypequery.protocol.adapter"],
        input=messages,
        text=True,
        capture_output=True,
        check=True,
    )
    hello = cast(dict[str, object], json.loads(completed.stdout.splitlines()[0]))
    assert hello["families"] == ["tagged-values-v1", "identifiers-v1", "expressions-v1"]
    suite = cast(dict[str, object], hello["hostileObjectSuite"])
    assert suite["count"] == 7
    assert suite["mechanisms"] == [
        "property-descriptor",
        "custom-mapping",
        "__iter__",
        "__str__",
        "dict-subclass",
        "__getattr__",
        "cycle",
    ]


def test_adapter_handles_identifier_success_and_rejection() -> None:
    messages = "\n".join(
        (
            json.dumps({"type": "hello", "protocol": 1}),
            json.dumps(
                {
                    "type": "case",
                    "seq": 1,
                    "family": "identifiers-v1",
                    "role": "success",
                    "case": {
                        "mode": "qualified",
                        "value": "orders.customer.country",
                    },
                }
            ),
            json.dumps(
                {
                    "type": "case",
                    "seq": 2,
                    "family": "identifiers-v1",
                    "role": "rejection",
                    "case": {"mode": "simple", "value": "__HypequeryInternal"},
                }
            ),
            json.dumps({"type": "end"}),
            "",
        )
    )
    completed = subprocess.run(
        [sys.executable, "-m", "hypequery.protocol.adapter"],
        input=messages,
        text=True,
        capture_output=True,
        check=True,
    )
    responses = [
        cast(dict[str, object], json.loads(line)) for line in completed.stdout.splitlines()
    ]
    success = cast(dict[str, object], responses[1]["output"])
    assert success["segments"] == ["orders", "customer", "country"]
    assert responses[2]["code"] == "HQ_IDENTIFIER_RESERVED"
