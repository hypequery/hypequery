from __future__ import annotations

import json
import string
from collections.abc import Sequence
from pathlib import Path
from typing import Literal, cast

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from hypequery.protocol import (
    PROTOCOL_IDENTIFIER_LIMITS,
    ProtocolIdentifier,
    ProtocolIdentifierError,
    ProtocolQualifiedIdentifier,
    is_protocol_identifier,
    is_protocol_qualified_identifier,
    join_protocol_qualified_identifier,
    parse_protocol_identifier,
    parse_protocol_qualified_identifier,
    split_protocol_qualified_identifier,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "identifiers-v1"
)
FAILURE_CODES = {
    "HQ_IDENTIFIER_TYPE",
    "HQ_IDENTIFIER_EMPTY",
    "HQ_IDENTIFIER_TOO_LONG",
    "HQ_IDENTIFIER_INVALID_FORMAT",
    "HQ_IDENTIFIER_RESERVED",
    "HQ_IDENTIFIER_TOO_MANY_SEGMENTS",
}


def _fixtures(name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / name).read_text()))


def _materialize(generator: dict[str, object]) -> str:
    kind = generator.get("type")
    count = cast(int, generator.get("count"))
    if kind == "repeat-string":
        return cast(str, generator.get("value")) * count
    if kind == "qualified-segments":
        return ".".join([cast(str, generator.get("segment"))] * count)
    raise AssertionError(f"unknown generator {kind!r}")


@pytest.mark.parametrize("fixture", _fixtures("success.json"), ids=lambda item: str(item["id"]))
def test_shared_success_fixtures_preserve_spelling(fixture: dict[str, object]) -> None:
    value = cast(str, fixture["value"])
    expected = cast(list[str], fixture["segments"])
    if fixture["mode"] == "simple":
        parsed: ProtocolIdentifier = parse_protocol_identifier(value)
        assert parsed == value
        assert type(parsed) is str
        assert expected == [parsed]
        return

    parsed_qualified: ProtocolQualifiedIdentifier = parse_protocol_qualified_identifier(value)
    assert parsed_qualified == value
    assert type(parsed_qualified) is str
    assert list(split_protocol_qualified_identifier(parsed_qualified)) == expected
    assert join_protocol_qualified_identifier(expected) == parsed_qualified


@pytest.mark.parametrize("fixture", _fixtures("rejections.json"), ids=lambda item: str(item["id"]))
def test_shared_rejections_use_stable_codes(fixture: dict[str, object]) -> None:
    generator = fixture.get("generator")
    value = _materialize(generator) if type(generator) is dict else fixture.get("value")
    parser = (
        parse_protocol_identifier
        if fixture["mode"] == "simple"
        else parse_protocol_qualified_identifier
    )
    with pytest.raises(ProtocolIdentifierError) as raised:
        parser(value)
    assert raised.value.code == fixture["error"]
    assert str(raised.value) == fixture["error"]


def test_fixture_corpus_covers_every_failure_code_and_unique_id() -> None:
    fixtures = [*_fixtures("success.json"), *_fixtures("rejections.json")]
    ids = [fixture["id"] for fixture in fixtures]
    assert len(ids) == len(set(ids))
    assert {fixture["error"] for fixture in _fixtures("rejections.json")} == FAILURE_CODES


def test_exact_limits_and_validation_precedence() -> None:
    assert PROTOCOL_IDENTIFIER_LIMITS.max_segment_bytes == 128
    assert PROTOCOL_IDENTIFIER_LIMITS.max_qualified_bytes == 512
    assert PROTOCOL_IDENTIFIER_LIMITS.max_segments == 8
    assert parse_protocol_identifier("a" * 128) == "a" * 128
    assert parse_protocol_qualified_identifier(".".join(["a"] * 8))

    cases = [
        ("__hypequery" * 12, "HQ_IDENTIFIER_TOO_LONG", False),
        ("-" * 129, "HQ_IDENTIFIER_TOO_LONG", False),
        ("__hypequery-internal", "HQ_IDENTIFIER_INVALID_FORMAT", False),
        (".".join(["a" * 64] * 9), "HQ_IDENTIFIER_TOO_LONG", True),
        (".".join(["a"] * 9), "HQ_IDENTIFIER_TOO_MANY_SEGMENTS", True),
        (f"{'a' * 129}.b", "HQ_IDENTIFIER_TOO_LONG", True),
        ("orders..country", "HQ_IDENTIFIER_INVALID_FORMAT", True),
    ]
    for value, code, qualified in cases:
        parser = parse_protocol_qualified_identifier if qualified else parse_protocol_identifier
        with pytest.raises(ProtocolIdentifierError) as raised:
            parser(value)
        assert raised.value.code == code


def test_non_bmp_and_surrogate_inputs_have_deterministic_byte_limits() -> None:
    invalid_at_limit = ["😀" * 32, "\ud800" * 42, "\ud800\udc00" * 32]
    too_long = ["😀" * 33, "\ud800" * 43, "\ud800\udc00" * 33]
    for value in invalid_at_limit:
        with pytest.raises(ProtocolIdentifierError) as raised:
            parse_protocol_identifier(value)
        assert raised.value.code == "HQ_IDENTIFIER_INVALID_FORMAT"
    for value in too_long:
        with pytest.raises(ProtocolIdentifierError) as raised:
            parse_protocol_identifier(value)
        assert raised.value.code == "HQ_IDENTIFIER_TOO_LONG"


def test_guards_and_join_are_strict() -> None:
    assert is_protocol_identifier("RevenueByDay")
    assert not is_protocol_identifier("orders.customer")
    assert is_protocol_qualified_identifier("orders.customer")
    assert not is_protocol_qualified_identifier("orders..customer")
    assert join_protocol_qualified_identifier(("orders", "customer")) == "orders.customer"

    cases: list[tuple[Sequence[object], str]] = [
        ([], "HQ_IDENTIFIER_EMPTY"),
        (["a"] * 9, "HQ_IDENTIFIER_TOO_MANY_SEGMENTS"),
        (["a", ""], "HQ_IDENTIFIER_INVALID_FORMAT"),
        (["a", 1], "HQ_IDENTIFIER_TYPE"),
        (["a" * 128] * 5, "HQ_IDENTIFIER_TOO_LONG"),
    ]
    for segments, code in cases:
        with pytest.raises(ProtocolIdentifierError) as raised:
            join_protocol_qualified_identifier(segments)
        assert raised.value.code == code


def test_hostile_objects_are_rejected_without_running_hooks_or_leaking_input() -> None:
    calls: list[str] = []

    class StringSubclass(str):
        def lower(self) -> str:
            calls.append("lower")
            return super().lower()

    class CustomString:
        def __str__(self) -> str:
            calls.append("str")
            return "unsafe"

    class CustomSequence:
        def __getitem__(self, index: int) -> object:
            calls.append("getitem")
            return "unsafe"

        def __len__(self) -> int:
            calls.append("len")
            return 1

    hostile_values: list[object] = [StringSubclass("orders"), CustomString()]
    for value in hostile_values:
        with pytest.raises(ProtocolIdentifierError) as raised:
            parse_protocol_identifier(value)
        assert raised.value.code == "HQ_IDENTIFIER_TYPE"
        assert not is_protocol_qualified_identifier(value)

    with pytest.raises(ProtocolIdentifierError) as raised:
        join_protocol_qualified_identifier(cast(Sequence[object], CustomSequence()))
    assert raised.value.code == "HQ_IDENTIFIER_TYPE"
    assert calls == []

    rejected = "customer-secret-value"
    with pytest.raises(ProtocolIdentifierError) as raised:
        parse_protocol_identifier(rejected)
    assert str(raised.value) == "HQ_IDENTIFIER_INVALID_FORMAT"
    assert rejected not in str(raised.value)


_VALID_IDENTIFIER = st.from_regex(r"[A-Za-z_][A-Za-z0-9_]{0,31}", fullmatch=True).filter(
    lambda value: not value.lower().startswith("__hypequery")
)
_SURROGATE_CATEGORIES: tuple[Literal["Cs"], ...] = ("Cs",)


@given(st.lists(_VALID_IDENTIFIER, min_size=1, max_size=8))
@settings(max_examples=500)
def test_qualified_identifier_properties(segments: list[str]) -> None:
    joined = join_protocol_qualified_identifier(segments)
    assert parse_protocol_qualified_identifier(joined) == joined
    assert list(split_protocol_qualified_identifier(joined)) == segments
    assert all(is_protocol_identifier(segment) for segment in segments)


@given(
    prefix=st.text(alphabet=string.ascii_letters + string.digits + "_", max_size=16),
    non_ascii=st.characters(
        min_codepoint=128,
        blacklist_categories=_SURROGATE_CATEGORIES,
    ),
)
@settings(max_examples=300)
def test_non_ascii_input_is_never_normalized(prefix: str, non_ascii: str) -> None:
    value = f"a{prefix}{non_ascii}"
    with pytest.raises(ProtocolIdentifierError) as raised:
        parse_protocol_identifier(value)
    assert raised.value.code == "HQ_IDENTIFIER_INVALID_FORMAT"
