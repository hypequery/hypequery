"""Canonical JSON bytes match ``JSON.stringify`` for every string Python can hold."""

from __future__ import annotations

from hypequery.protocol._jcs import serialize_jcs


def test_unpaired_surrogates_are_escaped_like_json_stringify() -> None:
    # Expected bytes come from V8: JSON.stringify("a\\ud800b") and friends.
    assert serialize_jcs("a\ud800b", max_bytes=64) == '"a\\ud800b"'
    assert serialize_jcs("\udfff", max_bytes=64) == '"\\udfff"'
    assert serialize_jcs({"k\ud800": 1}, max_bytes=64) == '{"k\\ud800":1}'


def test_a_surrogate_pair_held_as_two_code_points_is_one_character() -> None:
    assert serialize_jcs("\ud83d\ude00", max_bytes=64) == '"\U0001f600"'
    assert serialize_jcs("\U0001f600", max_bytes=64) == '"\U0001f600"'


def test_keys_sort_by_utf16_code_unit_even_with_lone_surrogates() -> None:
    # ["b", "a\ud800", "a\uffff"].sort() in JavaScript.
    canonical = serialize_jcs({"b": 1, "a\ud800": 2, "a\uffff": 3}, max_bytes=64)
    assert canonical == '{"a\\ud800":2,"a\uffff":3,"b":1}'


def test_escaped_surrogates_count_toward_the_byte_budget_as_written() -> None:
    # "\\ud800" is six ASCII bytes in the canonical form, plus two quotes.
    assert serialize_jcs("\ud800", max_bytes=8) == '"\\ud800"'
