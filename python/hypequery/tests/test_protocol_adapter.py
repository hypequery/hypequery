from __future__ import annotations

import json
import subprocess
import sys
from typing import cast


def test_adapter_announces_pinned_family_and_hostile_suite() -> None:
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
    assert hello["families"] == ["tagged-values-v1"]
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
