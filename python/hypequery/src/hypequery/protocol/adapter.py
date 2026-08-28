"""RFC 0012 NDJSON adapter for the Python protocol implementation."""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Iterator, Mapping

from hypequery import __version__

from .errors import ProtocolIdentifierError, ProtocolValueError
from .identifiers import (
    parse_protocol_identifier,
    parse_protocol_qualified_identifier,
    split_protocol_qualified_identifier,
)
from .values import (
    decode_canonical_value,
    encode_canonical_value,
    hash_canonical_value,
    validate_canonical_value,
)

FAMILIES = ("tagged-values-v1", "identifiers-v1")
HOSTILE_OBJECT_SUITE = {
    "count": 7,
    "mechanisms": [
        "property-descriptor",
        "custom-mapping",
        "__iter__",
        "__str__",
        "dict-subclass",
        "__getattr__",
        "cycle",
    ],
}


class _UnsafeAccessor(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise AssertionError(f"unsafe accessor invoked for {key!r}")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("unsafe iterator invoked")

    def __len__(self) -> int:
        raise AssertionError("unsafe length invoked")


def _array(values: list[object]) -> dict[str, object]:
    return {"$hypequery": {"type": "array", "version": 1, "values": values}}


def _integer(generator: dict[str, object], key: str) -> int:
    value = generator.get(key, 0)
    if type(value) is not int:
        raise RuntimeError(f"generator field {key!r} must be an integer")
    return value


def _materialize_tagged_value(generator: dict[str, object]) -> object:
    kind = generator.get("type")
    if kind == "nested-array":
        value = generator.get("leaf")
        for _ in range(_integer(generator, "depth")):
            value = _array([value])
        return value
    if kind == "array":
        return _array([generator.get("value")] * _integer(generator, "items"))
    if kind == "array-tree":
        branch = [generator.get("value")] * _integer(generator, "itemsPerBranch")
        return _array([_array(list(branch)) for _ in range(_integer(generator, "branches"))])
    if kind == "repeat-string":
        text = generator.get("utf8", "")
        if type(text) is not str:
            raise RuntimeError("generator field 'utf8' must be a string")
        return text * _integer(generator, "count")
    if kind == "non-finite-float":
        values = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
        return values[str(generator.get("value"))]
    if kind == "unsafe-accessor":
        return _UnsafeAccessor()
    raise RuntimeError(f"unknown tagged-value generator: {kind!r}")


def _materialize_identifier(generator: dict[str, object]) -> str:
    kind = generator.get("type")
    if kind == "repeat-string":
        value = generator.get("value")
        if type(value) is not str:
            raise RuntimeError("generator field 'value' must be a string")
        return value * _integer(generator, "count")
    if kind == "qualified-segments":
        segment = generator.get("segment")
        if type(segment) is not str:
            raise RuntimeError("generator field 'segment' must be a string")
        return ".".join([segment] * _integer(generator, "count"))
    raise RuntimeError(f"unknown identifier generator: {kind!r}")


def _handle_tagged_value(role: str, case: dict[str, object]) -> dict[str, object]:
    try:
        if role == "success":
            # The runner's wire JSON has already erased JavaScript's distinction
            # between integer-looking and floating-point number tokens. Decode
            # the case as JSON again so Python ints at value positions regain
            # the binary64 semantics the fixture protocol defines.
            value = decode_canonical_value(
                json.dumps(case.get("value"), separators=(",", ":"), allow_nan=False)
            )
            return {
                "ok": True,
                "output": {
                    "canonicalHex": encode_canonical_value(value).hex(),
                    "sha256": hash_canonical_value(value),
                },
            }
        if "sourceUtf8" in case:
            source = case["sourceUtf8"]
            if type(source) is not str:
                raise RuntimeError("sourceUtf8 must be a string")
            decode_canonical_value(source)
        else:
            generator = case.get("generator")
            declared = case.get("declaredClickHouseType")
            declared_type = declared if type(declared) is str else None
            if type(generator) is dict:
                validate_canonical_value(
                    _materialize_tagged_value(generator),
                    declared_clickhouse_type=declared_type,
                )
            else:
                decode_canonical_value(
                    json.dumps(case.get("value"), separators=(",", ":"), allow_nan=False),
                    declared_clickhouse_type=declared_type,
                )
        return {"ok": True}
    except ProtocolValueError as error:
        return {"ok": False, "code": error.code}


def _handle_identifier(role: str, case: dict[str, object]) -> dict[str, object]:
    mode = case.get("mode")
    if mode not in ("simple", "qualified"):
        raise RuntimeError("identifier case mode must be 'simple' or 'qualified'")
    simple = mode == "simple"

    try:
        if role == "success":
            value = case.get("value")
            if simple:
                segments = [parse_protocol_identifier(value)]
            else:
                parsed = parse_protocol_qualified_identifier(value)
                segments = list(split_protocol_qualified_identifier(parsed))
            return {"ok": True, "output": {"segments": segments}}

        generator = case.get("generator")
        value = _materialize_identifier(generator) if type(generator) is dict else case.get("value")
        if simple:
            parse_protocol_identifier(value)
        else:
            parse_protocol_qualified_identifier(value)
        return {"ok": True}
    except ProtocolIdentifierError as error:
        return {"ok": False, "code": error.code}


def _handle(family: str, role: str, case: dict[str, object]) -> dict[str, object]:
    if family == "tagged-values-v1":
        return _handle_tagged_value(role, case)
    if family == "identifiers-v1":
        return _handle_identifier(role, case)
    raise RuntimeError(f"unsupported fixture family: {family!r}")


def main() -> int:
    """Run the adapter loop until the conformance runner sends ``end``."""

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            sys.stderr.write("adapter: unparseable line\n")
            return 2
        if type(message) is not dict:
            sys.stderr.write("adapter: message must be an object\n")
            return 2

        message_type = message.get("type")
        if message_type == "hello":
            if message.get("protocol") != 1:
                sys.stderr.write("adapter: unsupported protocol\n")
                return 2
            response: dict[str, object] = {
                "type": "hello",
                "protocol": 1,
                "implementation": "hypequery",
                "version": __version__,
                "language": "python",
                "families": list(FAMILIES),
                "hostileObjectSuite": HOSTILE_OBJECT_SUITE,
            }
        elif message_type == "case":
            family = message.get("family")
            if family not in FAMILIES:
                raise RuntimeError(f"unsupported fixture family: {family!r}")
            fixture_case = message.get("case")
            if type(fixture_case) is not dict:
                raise RuntimeError("fixture case must be an object")
            response = {
                "type": "result",
                "seq": message.get("seq"),
                **_handle(family, str(message.get("role")), fixture_case),
            }
        elif message_type == "end":
            return 0
        else:
            sys.stderr.write(f"adapter: unknown message type {message_type!r}\n")
            return 2
        sys.stdout.write(json.dumps(response, separators=(",", ":"), allow_nan=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
