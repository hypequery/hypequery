"""Bounded, detached JSON snapshots without calling user serialization hooks."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import cast

from .._jcs import serialize_jcs
from ..errors import ProtocolValueError
from .errors import ProtocolClientContractError, client_error

CLIENT_MAX_BYTES = 1_048_576
#: ECMAScript's Number.MAX_SAFE_INTEGER: every integer up to here is one double.
_MAX_SAFE_INTEGER = 2**53


@dataclass
class _Budget:
    nodes: int = 0
    size: int = 0
    active: set[int] = field(default_factory=set)

    def charge(self, size: int) -> None:
        self.size += size
        if self.size > CLIENT_MAX_BYTES:
            client_error("HQ_CLIENT_LIMIT")

    def text(self, value: str) -> None:
        if len(value) > CLIENT_MAX_BYTES:
            client_error("HQ_CLIENT_LIMIT")
        # ensure_ascii=False detects isolated surrogates during UTF-8 encoding.
        self.charge(len(json.dumps(value, ensure_ascii=False).encode("utf-8")))

    def copy(self, value: object, depth: int) -> object:
        self.nodes += 1
        if depth > 16 or self.nodes > 100_000:
            client_error("HQ_CLIENT_LIMIT")
        if type(value) is str:
            self.text(value)
            return value
        if value is None or type(value) is bool:
            self.charge(4 if value is None or value is True else 5)
            return value
        if type(value) in (int, float):
            number = float(cast("int | float", value))
            if not math.isfinite(number):
                client_error("HQ_CLIENT_TYPE")
            # JSON numbers have binary64 semantics in this cross-language profile.
            # Past 2**53 the exact digits of the double differ from ECMAScript's
            # shortest round-trip form that TypeScript's JSON.stringify writes,
            # so such a value stays a float and canonicalizes through the same
            # number serializer.
            integral = number.is_integer() and abs(number) <= _MAX_SAFE_INTEGER
            result: int | float = int(number) if integral else number
            self.charge(len(serialize_jcs(result, max_bytes=CLIENT_MAX_BYTES)))
            return result
        if type(value) not in (dict, list) or id(value) in self.active:
            client_error("HQ_CLIENT_TYPE")
        self.active.add(id(value))
        try:
            if type(value) is list:
                items = cast(list[object], value)
                if len(items) > 20_000:
                    client_error("HQ_CLIENT_LIMIT")
                self.charge(max(len(items) - 1, 0) + 2)
                return [self.copy(item, depth + 1) for item in items]
            entries = cast(dict[object, object], value)
            if len(entries) > 20_000:
                client_error("HQ_CLIENT_LIMIT")
            self.charge(len(entries) + max(len(entries) - 1, 0) + 2)
            output: dict[str, object] = {}
            for key, item in entries.items():
                if type(key) is not str:
                    client_error("HQ_CLIENT_TYPE")
                self.text(key)
                output[key] = self.copy(item, depth + 1)
            return output
        finally:
            self.active.remove(id(value))


def snapshot_client_data(value: object) -> object:
    """Only exact built-in JSON types are accepted; no subclass hooks run."""
    try:
        return _Budget().copy(value, 1)
    except ProtocolClientContractError:
        raise
    except (OverflowError, UnicodeError, ValueError, TypeError):
        client_error("HQ_CLIENT_TYPE")


def client_canonical(value: object) -> str:
    try:
        return serialize_jcs(value, max_bytes=CLIENT_MAX_BYTES)
    except ProtocolValueError as error:
        client_error("HQ_CLIENT_LIMIT" if error.code == "HQ_VALUE_TOO_LARGE" else "HQ_CLIENT_TYPE")
