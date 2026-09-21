"""Reusable RFC 0012 NDJSON adapter loop.

An adapter wraps an implementation under test: it announces the fixture
families it supports, then answers one result line per case the conformance
runner sends. The loop lives here so every family's adapter shares one
transport, exactly as ``createStdioAdapter`` does for TypeScript.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable, Mapping
from typing import IO, TypeAlias

CONFORMANCE_PROTOCOL_VERSION = 1

#: ``(family, role, case, section) -> result``. A result is the ``ok`` record
#: the runner compares; the loop adds ``type`` and ``seq``.
CaseHandler: TypeAlias = Callable[[str, str, dict[str, object], object], dict[str, object]]


def run_stdio_adapter(
    *,
    implementation: str,
    version: str,
    language: str,
    families: tuple[str, ...],
    handle: CaseHandler,
    hostile_object_suite: Mapping[str, object] | None = None,
    stdin: IO[str] | None = None,
    stdout: IO[str] | None = None,
    stderr: IO[str] | None = None,
) -> int:
    """Run the adapter loop until the runner sends ``end`` or input closes.

    Returns the exit code the caller should use.
    """

    source = stdin if stdin is not None else sys.stdin
    sink = stdout if stdout is not None else sys.stdout
    errors = stderr if stderr is not None else sys.stderr

    for line in source:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            errors.write("adapter: unparseable line\n")
            return 2
        if type(message) is not dict:
            errors.write("adapter: message must be an object\n")
            return 2

        message_type = message.get("type")
        if message_type == "hello":
            if message.get("protocol") != CONFORMANCE_PROTOCOL_VERSION:
                errors.write("adapter: unsupported protocol\n")
                return 2
            response: dict[str, object] = {
                "type": "hello",
                "protocol": CONFORMANCE_PROTOCOL_VERSION,
                "implementation": implementation,
                "version": version,
                "language": language,
                "families": list(families),
            }
            if hostile_object_suite is not None:
                response["hostileObjectSuite"] = dict(hostile_object_suite)
        elif message_type == "case":
            family = message.get("family")
            if family not in families:
                raise RuntimeError(f"unsupported fixture family: {family!r}")
            fixture_case = message.get("case")
            if type(fixture_case) is not dict:
                raise RuntimeError("fixture case must be an object")
            response = {
                "type": "result",
                "seq": message.get("seq"),
                **handle(
                    family,
                    str(message.get("role")),
                    fixture_case,
                    message.get("section"),
                ),
            }
        elif message_type == "end":
            return 0
        else:
            errors.write(f"adapter: unknown message type {message_type!r}\n")
            return 2
        sink.write(json.dumps(response, separators=(",", ":"), allow_nan=False) + "\n")
        sink.flush()
    return 0
