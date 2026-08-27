from __future__ import annotations

import json
import math
import random
import shutil
import struct
import subprocess
from collections.abc import Iterator, Mapping
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from hypequery.protocol import (
    CanonicalValueLimits,
    ProtocolValueError,
    array_value,
    bytes_value,
    date_value,
    datetime_value,
    decimal_value,
    decode_canonical_value,
    encode_canonical_value,
    encode_canonical_value_to_string,
    enum_value,
    hash_canonical_value,
    integer_value,
    map_value,
    tuple_value,
    uuid_value,
    validate_canonical_value,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "tagged-values-v1"
)


def _fixtures(name: str) -> list[dict[str, object]]:
    parse_int = float if name == "success.json" else int
    return cast(
        list[dict[str, object]],
        json.loads((FIXTURES / name).read_text(), parse_int=parse_int),
    )


def _array(values: list[object]) -> dict[str, object]:
    return {"$hypequery": {"type": "array", "version": 1, "values": values}}


class _UnsafeAccessor(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise AssertionError(f"unsafe accessor invoked for {key!r}")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("unsafe iterator invoked")

    def __len__(self) -> int:
        raise AssertionError("unsafe length invoked")


def _materialize(generator: dict[str, object]) -> object:
    kind = generator.get("type")
    if kind == "nested-array":
        value = generator.get("leaf")
        for _ in range(cast(int, generator.get("depth", 0))):
            value = _array([value])
        return value
    if kind == "array":
        return _array([generator.get("value")] * cast(int, generator.get("items", 0)))
    if kind == "array-tree":
        items = cast(int, generator.get("itemsPerBranch", 0))
        branches = cast(int, generator.get("branches", 0))
        return _array([_array([generator.get("value")] * items) for _ in range(branches)])
    if kind == "repeat-string":
        return cast(str, generator.get("utf8", "")) * cast(int, generator.get("count", 0))
    if kind == "non-finite-float":
        values = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
        return values[cast(str, generator.get("value"))]
    if kind == "unsafe-accessor":
        return _UnsafeAccessor()
    raise AssertionError(f"unknown generator {kind!r}")


@pytest.mark.parametrize("fixture", _fixtures("success.json"), ids=lambda item: str(item["id"]))
def test_shared_success_fixtures(fixture: dict[str, object]) -> None:
    encoded = encode_canonical_value(fixture["value"])
    assert encoded.hex() == fixture["canonicalHex"]
    assert hash_canonical_value(fixture["value"]) == fixture["sha256"]
    assert encode_canonical_value(decode_canonical_value(encoded)) == encoded


@pytest.mark.parametrize("fixture", _fixtures("rejections.json"), ids=lambda item: str(item["id"]))
def test_shared_rejection_fixtures(fixture: dict[str, object]) -> None:
    def reject() -> None:
        if "sourceUtf8" in fixture:
            decode_canonical_value(cast(str, fixture["sourceUtf8"]))
            return
        generator = fixture.get("generator")
        value = _materialize(generator) if type(generator) is dict else fixture.get("value")
        validate_canonical_value(
            value,
            declared_clickhouse_type=cast(str | None, fixture.get("declaredClickHouseType")),
        )

    with pytest.raises(ProtocolValueError) as raised:
        reject()
    assert raised.value.code == fixture["error"]
    assert "region" not in str(raised.value)


def test_metadata_integral_floats_are_normalized_by_value() -> None:
    value = {
        "$hypequery": {
            "type": "integer",
            "version": 1.0,
            "bits": 8.0,
            "signed": True,
            "value": "1",
        }
    }
    assert encode_canonical_value_to_string(value) == (
        '{"$hypequery":{"bits":8,"signed":true,"type":"integer","value":"1","version":1}}'
    )
    value["$hypequery"]["version"] = 1.5
    with pytest.raises(ProtocolValueError, match="HQ_VALUE_INVALID_FORMAT"):
        validate_canonical_value(value)


def test_python_integers_require_an_explicit_integer_tag() -> None:
    with pytest.raises(ProtocolValueError) as raised:
        validate_canonical_value(42)
    assert raised.value.code == "HQ_VALUE_INTEGER_TAG_REQUIRED"
    assert integer_value(42, bits=64, signed=True)


def test_detached_snapshot_does_not_follow_input_mutation() -> None:
    original = _array(["original"])
    validated = cast(dict[str, object], validate_canonical_value(original))
    cast(list[object], cast(dict[str, object], original["$hypequery"])["values"])[0] = "changed"
    tag = cast(dict[str, object], validated["$hypequery"])
    assert cast(list[object], tag["values"])[0] == "original"


def test_hostile_objects_are_rejected_without_invoking_conversion_hooks() -> None:
    calls: list[str] = []

    class PropertyDescriptor:
        @property
        def value(self) -> object:
            calls.append("property")
            return None

    class CustomMapping(Mapping[str, object]):
        def __getitem__(self, key: str) -> object:
            calls.append("mapping-get")
            return None

        def __iter__(self) -> Iterator[str]:
            calls.append("mapping-iter")
            return iter(())

        def __len__(self) -> int:
            calls.append("mapping-len")
            return 0

    class CustomIter:
        def __iter__(self) -> Iterator[object]:
            calls.append("iter")
            return iter(())

    class CustomString:
        def __str__(self) -> str:
            calls.append("str")
            return "unsafe"

    class DictSubclass(dict[str, object]):
        pass

    class CustomGetattr:
        def __getattr__(self, name: str) -> object:
            calls.append(name)
            return None

    hostile: list[object] = [
        PropertyDescriptor(),
        CustomMapping(),
        CustomIter(),
        CustomString(),
        DictSubclass(),
        CustomGetattr(),
    ]
    for value in hostile:
        with pytest.raises(ProtocolValueError) as raised:
            validate_canonical_value(value)
        assert raised.value.code == "HQ_VALUE_UNSAFE_OBJECT"
    assert calls == []

    cycle = _array([])
    cast(list[object], cast(dict[str, object], cycle["$hypequery"])["values"]).append(cycle)
    with pytest.raises(ProtocolValueError) as raised:
        validate_canonical_value(cycle)
    assert raised.value.code == "HQ_VALUE_INVALID_FORMAT"


def test_python_type_constructors_are_exact_and_bounded() -> None:
    assert integer_value(2**255 - 1, bits=256, signed=True)
    assert decimal_value(Decimal("12.3400"), precision=9, scale=4)
    assert date_value(date(2149, 6, 6), clickhouse_type="Date")
    assert datetime_value(
        datetime(2026, 7, 13, 14, 30, 45, 123000, tzinfo=UTC),
        clickhouse_type="DateTime64",
        precision=9,
        timezone_name="Europe/Madrid",
    )
    assert uuid_value(UUID("01890f3e-7b7b-7cc2-98c4-dc0c0c07398f"))
    assert bytes_value(b"\x00\xff\x10")
    assert enum_value(label="unknown", code=-1, bits=8)
    assert array_value((True, False, None))
    assert tuple_value(("EMEA", True))
    mapped = map_value((("region", "EMEA"), ("region", "fallback")))
    entries = cast(list[object], cast(dict[str, object], mapped["$hypequery"])["entries"])
    assert len(entries) == 2


def test_duplicate_keys_invalid_utf8_and_lower_limits() -> None:
    with pytest.raises(ProtocolValueError, match="HQ_VALUE_DUPLICATE_KEY"):
        decode_canonical_value(
            '{"$hypequery":{"type":"tuple","version":1,"values":[{"a":1,"a":2}]}}'
        )
    with pytest.raises(ProtocolValueError, match="HQ_VALUE_INVALID_UNICODE"):
        decode_canonical_value(bytes((0xC3, 0x28)))
    with pytest.raises(ProtocolValueError, match="HQ_VALUE_TOO_LARGE"):
        decode_canonical_value('"é"', limits=CanonicalValueLimits(max_input_bytes=3))
    with pytest.raises(ValueError, match="protocol v1 maximum"):
        CanonicalValueLimits(max_depth=17)

    oversized_output = _array(["a" * 2_000 for _ in range(1_000)])
    with pytest.raises(ProtocolValueError) as raised:
        encode_canonical_value(oversized_output)
    assert raised.value.code == "HQ_VALUE_TOO_LARGE"


@given(st.floats(width=64, allow_nan=False, allow_infinity=False))
@settings(max_examples=1_000, deadline=None)
def test_finite_float_serialization_round_trips_binary64(value: float) -> None:
    assume(not (value == 0 and math.copysign(1.0, value) < 0))
    canonical = encode_canonical_value_to_string(value)
    parsed = float(canonical)
    assert struct.pack(">d", parsed) == struct.pack(">d", value)


@given(
    bits=st.sampled_from((8, 16, 32, 64, 128, 256)),
    signed=st.booleans(),
    lower=st.booleans(),
    delta=st.integers(min_value=-1, max_value=1),
)
@settings(max_examples=150)
def test_integer_constructor_checks_every_width_boundary(
    bits: int, signed: bool, lower: bool, delta: int
) -> None:
    minimum = -(1 << (bits - 1)) if signed else 0
    maximum = (1 << (bits - 1)) - 1 if signed else (1 << bits) - 1
    value = (minimum if lower else maximum) + delta
    if minimum <= value <= maximum:
        assert integer_value(value, bits=bits, signed=signed)  # type: ignore[arg-type]
    else:
        with pytest.raises(ProtocolValueError) as raised:
            integer_value(value, bits=bits, signed=signed)  # type: ignore[arg-type]
        assert raised.value.code == "HQ_VALUE_OUT_OF_RANGE"


def test_random_binary64_serialization_matches_ecmascript() -> None:
    randomizer = random.Random(0x8785)  # noqa: S311 - deterministic test corpus
    pairs: list[tuple[str, float]] = []
    for _ in range(10_000):
        bits = randomizer.getrandbits(64)
        value = struct.unpack(">d", bits.to_bytes(8, "big"))[0]
        if math.isfinite(value) and not (value == 0 and math.copysign(1.0, value) < 0):
            pairs.append((f"{bits:016x}", value))

    script = """
const fs = require('fs');
const hexes = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(hexes.map((hex) =>
  JSON.stringify(Buffer.from(hex, 'hex').readDoubleBE(0)))));
"""
    node = shutil.which("node")
    assert node is not None
    completed = subprocess.run(
        [node, "-e", script],
        input=json.dumps([item[0] for item in pairs]),
        text=True,
        capture_output=True,
        check=True,
    )
    expected = cast(list[str], json.loads(completed.stdout))
    actual = [encode_canonical_value_to_string(item[1]) for item in pairs]
    assert actual == expected
